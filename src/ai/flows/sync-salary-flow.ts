
'use server';

/**
 * @fileOverview A flow to sync employee salary data from GreytHR to Firestore.
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';
import { db } from '@/lib/firebase';
import { collection, writeBatch, getDocs, query, where, doc } from 'firebase/firestore';

const EmployeeSalaryDataSchema = z.object({
  employeeId: z.string(),
  name: z.string(),
  grossSalary: z.number(),
  netSalary: z.number(),
});

const SyncSalaryInputSchema = z.object({
  month: z.string().describe('The month to sync salaries for, in YYYY-MM-01 format.'),
});
export type SyncSalaryInput = z.infer<typeof SyncSalaryInputSchema>;

const SyncSalaryOutputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  updatedCount: z.number(),
  employees: z.array(EmployeeSalaryDataSchema).optional(),
});
export type SyncSalaryOutput = z.infer<typeof SyncSalaryOutputSchema>;

async function getGreytHRToken(): Promise<string> {
    const username = process.env.GREYTHR_USERNAME || "SEL";
    const password = process.env.GREYTHR_PASSWORD || "f1785459-9277-4136-88a9-ee48fd0146fe";

    if (!username || !password) {
        throw new Error("GreytHR credentials not found in environment variables.");
    }
    
    const encodedCredentials = Buffer.from(`${username}:${password}`).toString('base64');
    const url = "https://siddhartha.greythr.com/uas/v1/oauth2/client-token";

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            "Authorization": "Basic " + encodedCredentials
        },
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get GreytHR token: ${response.statusText} - ${errorText}`);
    }

    const json = await response.json();
    if (json.access_token) {
        return json.access_token;
    } else {
        throw new Error("Access Token not found in GreytHR response.");
    }
}

async function fetchAllSalaryData(token: string, domain: string, month: string): Promise<any[]> {
    let allData: any[] = [];
    let page = 1;
    const size = 100; // Fetch 100 records per page

    while (true) {
        const url = `https://api.greythr.com/payroll/v2/employees/salary/statement/${month}?page=${page}&size=${size}`;
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                "ACCESS-TOKEN": token,
                "x-greythr-domain": domain,
            },
        });

        if (response.status === 404) {
            // No data for this month, which is a valid scenario.
            // If it happens on the first page, return empty. Otherwise, we're done.
            if (page === 1) return [];
            break;
        }
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to fetch salary statement: ${response.statusText} - ${errorText}`);
        }

        const json = await response.json();
        const data = json.data || [];
        
        if (data.length > 0) {
            allData = allData.concat(data);
            page++;
        } else {
            // No more data to fetch
            break;
        }
    }
    return allData;
}

const syncSalaryFlow = ai.defineFlow(
  {
    name: 'syncSalaryFlow',
    inputSchema: SyncSalaryInputSchema,
    outputSchema: SyncSalaryOutputSchema,
  },
  async ({ month }) => {
    const token = await getGreytHRToken();
    const domain = "siddhartha.greythr.com";
    
    const salaryData = await fetchAllSalaryData(token, domain, month);

    if (salaryData.length === 0) {
        return { success: true, message: 'No salary data found for the selected month.', updatedCount: 0, employees: [] };
    }

    const employeesByNo: Record<string, { name: string; grossSalary: number; totalDeductions: number }> = {};

    salaryData.forEach(item => {
        const empNo = item.employeeNo;
        if (!employeesByNo[empNo]) {
            employeesByNo[empNo] = { name: item.employeeName, grossSalary: 0, totalDeductions: 0 };
        }
        if (item.itemName === 'INCOME' && item.description === 'GROSS') {
            employeesByNo[empNo].grossSalary = item.amount;
        }
        if (item.type === 'DEDUCT') {
            employeesByNo[empNo].totalDeductions += item.amount;
        }
    });
    
    const employeesRef = collection(db, 'employees');
    let updatedCount = 0;

    // Use a batch to update Firestore efficiently
    const batch = writeBatch(db);

    const employeesToReturn: { employeeId: string; name: string; grossSalary: number; netSalary: number }[] = [];

    for (const empNo in employeesByNo) {
        const salaryInfo = employeesByNo[empNo];
        const netSalary = salaryInfo.grossSalary - salaryInfo.totalDeductions;
        
        employeesToReturn.push({
            employeeId: empNo,
            name: salaryInfo.name,
            grossSalary: salaryInfo.grossSalary,
            netSalary: netSalary,
        });
        
        const q = query(employeesRef, where('employeeId', '==', empNo));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
            const docToUpdate = querySnapshot.docs[0];
            batch.update(docToUpdate.ref, {
                grossSalary: salaryInfo.grossSalary,
                netSalary: netSalary,
            });
            updatedCount++;
        }
    }

    await batch.commit();

    return { 
        success: true, 
        message: `Successfully synced salaries. ${updatedCount} employee records updated.`,
        updatedCount: updatedCount,
        employees: employeesToReturn,
    };
  }
);


export async function syncSalary(input: SyncSalaryInput): Promise<SyncSalaryOutput> {
  return syncSalaryFlow(input);
}

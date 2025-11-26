
'use server';

/**
 * @fileOverview A flow to sync employee salary data from GreytHR to Firestore.
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';
import { db } from '@/lib/firebase';
import { collection, writeBatch, getDocs, query, where, doc, getDoc, setDoc, addDoc } from 'firebase/firestore';
import type { SalaryDetail, Employee, SalarySyncLog } from '@/lib/types';
import { format, subDays } from 'date-fns';

const EmployeeSalaryDataSchema = z.object({
  employeeId: z.string(),
  name: z.string(),
  grossSalary: z.number(),
  netSalary: z.number(),
  salaryDetails: z.array(z.object({
    itemName: z.string(),
    description: z.string(),
    amount: z.number(),
    type: z.string(),
  })),
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
    const monthStr = format(new Date(month), 'yyyy-MM');

    const syncLogRef = doc(db, 'salarySyncLogs', monthStr);
    const syncLogSnap = await getDoc(syncLogRef);
    const lastSynced = syncLogSnap.exists() ? (syncLogSnap.data() as SalarySyncLog).lastSynced.toDate() : null;
    const oneDayAgo = subDays(new Date(), 1);

    if (lastSynced && lastSynced > oneDayAgo) {
      const q = query(collection(db, 'employees'), where('salaryMonth', '==', monthStr));
      const querySnapshot = await getDocs(q);
      const employeesFromDb = querySnapshot.docs.map(doc => doc.data() as Employee);
      return {
        success: true,
        message: 'Data is recent. Loaded from database.',
        updatedCount: 0,
        employees: employeesFromDb,
      };
    }
    
    const salaryData = await fetchAllSalaryData(token, domain, month);

    if (salaryData.length === 0) {
        return { success: true, message: 'No salary data found for the selected month.', updatedCount: 0, employees: [] };
    }

    const employeesDataMap: Record<string, { name: string; details: SalaryDetail[] }> = {};

    salaryData.forEach(item => {
        const empNo = item.employeeNo;
        if (!employeesDataMap[empNo]) {
            employeesDataMap[empNo] = { name: item.employeeName, details: [] };
        }
        employeesDataMap[empNo].details.push({
            itemName: item.itemName,
            description: item.description,
            amount: item.amount,
            type: item.type,
        });
    });
    
    const employeesRef = collection(db, 'employees');
    let updatedCount = 0;
    const batch = writeBatch(db);

    const employeesToReturn: z.infer<typeof EmployeeSalaryDataSchema>[] = [];

    for (const empNo in employeesDataMap) {
        const empData = employeesDataMap[empNo];
        const gross = empData.details.find(d => d.description === 'GROSS' && d.type === 'INCOME')?.amount || 0;
        const totalDeductions = empData.details
            .filter(d => d.type === 'DEDUCT')
            .reduce((sum, item) => sum + item.amount, 0);

        const netSalary = gross - totalDeductions;
        
        const salaryPayload = {
            employeeId: empNo,
            name: empData.name,
            grossSalary: gross,
            netSalary: netSalary,
            salaryDetails: empData.details,
            salaryMonth: monthStr,
        };
        employeesToReturn.push(salaryPayload);
        
        const q = query(employeesRef, where('employeeId', '==', empNo));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
            const docToUpdate = querySnapshot.docs[0];
            batch.update(docToUpdate.ref, salaryPayload);
            updatedCount++;
        } else {
            // If employee does not exist, create a new document
            const newDocRef = doc(employeesRef);
            batch.set(newDocRef, {
                // You might need to add other default employee fields here
                department: '',
                designation: '',
                email: '',
                phone: '',
                status: 'Active',
                ...salaryPayload,
            });
            updatedCount++;
        }
    }

    await batch.commit();

    await setDoc(syncLogRef, { lastSynced: new Date() });

    return { 
        success: true, 
        message: `Successfully synced salaries. ${updatedCount} employee records created/updated.`,
        updatedCount: updatedCount,
        employees: employeesToReturn,
    };
  }
);


export async function syncSalary(input: SyncSalaryInput): Promise<SyncSalaryOutput> {
  return await syncSalaryFlow(input);
}

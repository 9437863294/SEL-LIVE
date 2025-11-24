

'use server';

/**
 * @fileOverview A flow to sync employee salary data from GreytHR to Firestore.
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';
import { db } from '@/lib/firebase';
import { collection, writeBatch, getDocs, query, where, doc } from 'firebase/firestore';

const SyncSalaryInputSchema = z.object({
  month: z.string().describe('The month to sync salaries for, in YYYY-MM-01 format.'),
});
export type SyncSalaryInput = z.infer<typeof SyncSalaryInputSchema>;

const SyncSalaryOutputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  updatedCount: z.number(),
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

async function fetchSalaryData(token: string, domain: string, month: string): Promise<any[]> {
    const url = `https://api.greythr.com/payroll/v2/employees/salary/statement/${month}`;
    
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            "ACCESS-TOKEN": token,
            "x-greythr-domain": domain,
        },
    });

    if (response.status === 404) {
        // If the API returns Not Found, it means no data for that month.
        // Return an empty array to be handled gracefully.
        return [];
    }
    
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch salary statement: ${response.statusText} - ${errorText}`);
    }

    const json = await response.json();
    return json.data || [];
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
    
    const salaryData = await fetchSalaryData(token, domain, month);

    if (salaryData.length === 0) {
        return { success: true, message: 'No salary data found for the selected month.', updatedCount: 0 };
    }

    const employeesByNo: Record<string, { grossSalary: number; netSalary: number }> = {};

    salaryData.forEach(item => {
        const empNo = item.employeeNo;
        if (!employeesByNo[empNo]) {
            employeesByNo[empNo] = { grossSalary: 0, netSalary: 0 };
        }
        if (item.itemName === 'INCOME' && item.description === 'GROSS') {
            employeesByNo[empNo].grossSalary = item.amount;
        }
        // Initialize netSalary with grossSalary, deductions will be added (as they are negative)
        if (item.itemName === 'INCOME' && item.description === 'GROSS') {
            employeesByNo[empNo].netSalary = item.amount;
        }
    });

    // Now, iterate again to add all deductions.
    // The "TOTAL DEDUCTIONS" item from GreytHR is a negative value.
    salaryData.forEach(item => {
        const empNo = item.employeeNo;
        if (employeesByNo[empNo] && item.itemName === 'DEDUCT' && item.description === 'TOTAL DEDUCTIONS') {
            // Add the negative deduction amount to the gross salary
            employeesByNo[empNo].netSalary += item.amount;
        }
    });
    
    const employeesRef = collection(db, 'employees');
    let updatedCount = 0;

    // Use a batch to update Firestore efficiently
    const batch = writeBatch(db);

    for (const empNo in employeesByNo) {
        const q = query(employeesRef, where('employeeId', '==', empNo));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
            const docToUpdate = querySnapshot.docs[0];
            batch.update(docToUpdate.ref, {
                grossSalary: employeesByNo[empNo].grossSalary,
                netSalary: employeesByNo[empNo].netSalary,
            });
            updatedCount++;
        }
    }

    await batch.commit();

    return { 
        success: true, 
        message: `Successfully synced salaries. ${updatedCount} employee records updated.`,
        updatedCount: updatedCount,
    };
  }
);


export async function syncSalary(input: SyncSalaryInput): Promise<SyncSalaryOutput> {
  return syncSalaryFlow(input);
}

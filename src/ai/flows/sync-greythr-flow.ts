
'use server';

/**
 * @fileOverview A flow to sync employee data from GreytHR to Firestore.
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';
import { db } from '@/lib/firebase';
import { collection, writeBatch, getDocs, query, where, doc, setDoc } from 'firebase/firestore';

const EmployeeDataSchema = z.object({
    employeeId: z.string(),
    name: z.string(),
    email: z.string(),
    phone: z.string(),
    department: z.string(),
    designation: z.string(),
    status: z.string(),
});

const SyncGreytHRInputSchema = z.object({
  page: z.number().optional().default(1),
});
export type SyncGreytHRInput = z.infer<typeof SyncGreytHRInputSchema>;

const SyncGreytHROutputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  employees: z.array(EmployeeDataSchema).optional(),
  hasNextPage: z.boolean().optional(),
});

export type SyncGreytHROutput = z.infer<typeof SyncGreytHROutputSchema>;

async function getGreytHRToken(): Promise<string> {
    const username = process.env.GREYTHR_USERNAME;
    const password = process.env.GREYTHR_PASSWORD;

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


const syncGreytHRFlow = ai.defineFlow(
  {
    name: 'syncGreytHRFlow',
    inputSchema: SyncGreytHRInputSchema,
    outputSchema: SyncGreytHROutputSchema,
  },
  async ({ page = 1 }) => {
    const token = await getGreytHRToken();
    const domain = "siddhartha.greythr.com";
    
    const baseUrl = "https://api.greythr.com/employee/v2/employees";
    const size = 100;

    const url = `${baseUrl}?page=${page}&size=${size}&state=CURRENT`;
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            "ACCESS-TOKEN": token,
            "x-greythr-domain": domain,
        },
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch employees: ${response.statusText} - ${errorText}`);
    }

    const json = await response.json();
    const allData = json.data || [];
    
    const hasNextPage = allData.length === size;

    const filteredData = allData.filter((employee: any) => employee.employeeNo && employee.employeeNo.startsWith("E"));
    
    const employeesToReturn = filteredData.map((empData: any) => {
        return {
            employeeId: empData.employeeNo,
            name: empData.name,
            email: empData.email || '',
            phone: empData.mobile || '',
            department: 'N/A', // Temporarily removed
            designation: 'N/A', // Temporarily removed
            status: empData.status === 'Active' ? 'Active' : 'Inactive',
        };
    });

    const settingsRef = doc(db, 'settings', 'employeeSync');
    await setDoc(settingsRef, { lastSynced: new Date().toISOString() }, { merge: true });

    return { 
        success: true, 
        message: `Successfully fetched page ${page} with ${employeesToReturn.length} employees.`,
        employees: employeesToReturn,
        hasNextPage: hasNextPage
    };
  }
);


export async function syncGreytHR(input: SyncGreytHRInput): Promise<SyncGreytHROutput> {
  return syncGreytHRFlow(input);
}


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
    email: z.string().optional(),
    phone: z.string().optional(),
    status: z.string(),
    employeeNo: z.string().optional(),
    dateOfJoin: z.string().optional().nullable(),
    leavingDate: z.string().optional().nullable(),
    dateOfBirth: z.string().optional().nullable(),
    gender: z.string().optional(),
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
  currentPage: z.number().optional(),
});

export type SyncGreytHROutput = z.infer<typeof SyncGreytHROutputSchema>;

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

async function fetchPage(url: string, token: string, domain: string, page: number, size = 25) {
    const paginatedUrl = `${url}?page=${page}&size=${size}&state=CURRENT`;
    const response = await fetch(paginatedUrl, {
        method: 'GET',
        headers: {
            "ACCESS-TOKEN": token,
            "x-greythr-domain": domain,
        },
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch data from ${url}: ${response.statusText} - ${errorText}`);
    }

    return response.json();
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
    const pageSize = 25;
    
    const employeesUrl = "https://api.greythr.com/employee/v2/employees";
    
    const employeePageJson = await fetchPage(employeesUrl, token, domain, page, pageSize);
    const employeeData = employeePageJson.data || [];
    const hasNextPage = employeePageJson.pages.hasNext || false;
    
    const employeesToReturn = employeeData.map((empData: any) => ({
        employeeId: String(empData.employeeId),
        name: empData.name,
        email: empData.email || '',
        phone: empData.mobile || '',
        status: empData.status === 'Active' ? 'Active' : 'Inactive',
        employeeNo: empData.employeeNo,
        dateOfJoin: empData.dateOfJoin || null,
        leavingDate: empData.leavingDate || null,
        dateOfBirth: empData.dateOfBirth || null,
        gender: empData.gender || '',
    }));

    return { 
        success: true, 
        message: `Successfully fetched page ${page} with ${employeesToReturn.length} employees.`,
        employees: employeesToReturn,
        hasNextPage: hasNextPage,
        currentPage: page,
    };
  }
);


export async function syncGreytHR(input: SyncGreytHRInput): Promise<SyncGreytHROutput> {
  return syncGreytHRFlow(input);
}


// New flow for syncing all employees
const syncAllGreytHRFlow = ai.defineFlow(
  {
    name: 'syncAllGreytHRFlow',
    outputSchema: SyncGreytHROutputSchema,
  },
  async () => {
    const token = await getGreytHRToken();
    const domain = "siddhartha.greythr.com";
    const employeesUrl = "https://api.greythr.com/employee/v2/employees";
    
    let allEmployees: any[] = [];
    let page = 0; // APIs are often 0-indexed for pages
    let hasNext = true;
    const size = 2000; // Use a larger page size

    while(hasNext) {
        try {
            const pageJson = await fetchPage(employeesUrl, token, domain, page, size);
            const data = pageJson.data || [];
            allEmployees = allEmployees.concat(data);
            hasNext = pageJson.pages.hasNext;
            page++;
        } catch (error) {
            console.error(`Error fetching page ${page}:`, error);
            hasNext = false; // Stop on error
        }
    }
    
    const employeesToSave = allEmployees.map((empData: any) => ({
        employeeId: String(empData.employeeId),
        name: empData.name,
        email: empData.email || '',
        phone: empData.mobile || '',
        status: empData.status === 'Active' ? 'Active' : 'Inactive',
        employeeNo: empData.employeeNo,
        dateOfJoin: empData.dateOfJoin || null,
        leavingDate: empData.leavingDate || null,
        dateOfBirth: empData.dateOfBirth || null,
        gender: empData.gender || '',
    }));

    const batch = writeBatch(db);
    const employeesRef = collection(db, 'employees');

    employeesToSave.forEach(emp => {
      // Use employeeId as the document ID for easy upserting
      const docRef = doc(employeesRef, emp.employeeId);
      batch.set(docRef, emp);
    });

    await batch.commit();

    await setDoc(doc(db, 'settings', 'employeeSync'), { lastSynced: new Date().toISOString() });
    
    return {
        success: true,
        message: `Successfully synced ${employeesToSave.length} employees from all pages.`
    }
  }
);


export async function syncAllGreytHR(): Promise<SyncGreytHROutput> {
  return syncAllGreytHRFlow();
}



'use server';

/**
 * @fileOverview A flow to sync employee data from GreytHR to Firestore.
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';
import { db } from '@/lib/firebase';
import { collection, writeBatch, getDocs, query, where } from 'firebase/firestore';

const SyncGreytHROutputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  employeesSynced: z.number(),
});

export type SyncGreytHROutput = z.infer<typeof SyncGreytHROutputSchema>;

async function getGreytHRToken(): Promise<string> {
    const username = process.env.GREYTHR_USERNAME;
    const password = process.env.GREYTHR_PASSWORD;
    const domain = process.env.GREYTHR_DOMAIN;

    if (!username || !password || !domain) {
        throw new Error("GreytHR credentials or domain not found in environment variables.");
    }

    const encodedCredentials = Buffer.from(`${username}:${password}`).toString('base64');
    const url = `https://${domain}/uas/v1/oauth2/client-token`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            "Authorization": `Basic ${encodedCredentials}`
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
    outputSchema: SyncGreytHROutputSchema,
  },
  async () => {
    const token = await getGreytHRToken();
    const domain = process.env.GREYTHR_DOMAIN!;
    const baseUrl = "https://api.greythr.com/employee/v2/employees";
    let page = 1;
    const size = 100;
    const allData = [];

    // 1. Fetch all employees from GreytHR
    while (true) {
        const url = `${baseUrl}?page=${page}&size=${size}`;
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
        if (json.data && json.data.length > 0) {
            allData.push(...json.data);
            page++;
        } else {
            break;
        }
    }

    // 2. Filter employees
    const filteredData = allData.filter(employee => employee.employeeNo && employee.employeeNo.startsWith("E"));
    
    // 3. Write to Firestore
    const employeesRef = collection(db, 'employees');
    const batch = writeBatch(db);
    let employeesSynced = 0;

    for (const empData of filteredData) {
        // Check if employee already exists by employeeId
        const q = query(employeesRef, where("employeeId", "==", empData.employeeNo));
        const querySnapshot = await getDocs(q);

        const newEmployeeData = {
            employeeId: empData.employeeNo,
            name: empData.name,
            email: empData.email || '',
            phone: empData.mobile || '',
            department: '', // This needs to be mapped from categories or another source
            designation: '', // This also needs mapping
            status: empData.status === 'Active' ? 'Active' : 'Inactive',
        };

        if (querySnapshot.empty) {
            // Add new employee
            const newDocRef = doc(employeesRef);
            batch.set(newDocRef, newEmployeeData);
            employeesSynced++;
        } else {
            // Update existing employee
            const docToUpdate = querySnapshot.docs[0];
            batch.update(docToUpdate.ref, newEmployeeData);
            employeesSynced++;
        }
    }

    await batch.commit();

    return { 
        success: true, 
        message: `Successfully synced ${employeesSynced} employees.`,
        employeesSynced,
    };
  }
);


export async function syncGreytHR(): Promise<SyncGreytHROutput> {
  return syncGreytHRFlow();
}

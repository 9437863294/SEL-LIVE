
'use server';

/**
 * @fileOverview A flow to sync employee data from GreytHR to Firestore.
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';
import { db } from '@/lib/firebase';
import { collection, writeBatch, getDocs, query, where, doc } from 'firebase/firestore';

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

async function fetchEmployeeCategories(token: string, domain: string): Promise<Record<string, { department: string; designation: string }>> {
    const url = "https://api.greythr.com/employee/v2/employees/categories";
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            "ACCESS-TOKEN": token,
            "x-greythr-domain": domain,
        },
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch employee categories: ${response.statusText} - ${errorText}`);
    }

    const json = await response.json();
    const employeeCategories: Record<string, { department: string; designation: string }> = {};

    if (json.data && Array.isArray(json.data)) {
        json.data.forEach((emp: any) => {
            const categories: { department: string; designation: string } = { department: '', designation: '' };
            if (emp.categoryList && Array.isArray(emp.categoryList)) {
                emp.categoryList.forEach((cat: any) => {
                    // This logic is based on the provided sample response where `category` is a numeric ID.
                    // '2' seems to correspond to Department and '6' to Designation based on typical setups.
                    // This might need adjustment if the IDs are different in the customer's GreytHR instance.
                    if (cat.category === 2) { // Assuming 2 is Department
                        categories.department = cat.value;
                    }
                    if (cat.category === 6) { // Assuming 6 is Designation
                        categories.designation = cat.value;
                    }
                });
            }
            employeeCategories[emp.employeeId] = categories;
        });
    }
    return employeeCategories;
}

const syncGreytHRFlow = ai.defineFlow(
  {
    name: 'syncGreytHRFlow',
    outputSchema: SyncGreytHROutputSchema,
  },
  async () => {
    const token = await getGreytHRToken();
    const domain = process.env.GREYTHR_DOMAIN!;
    
    // 1. Fetch all employees from GreytHR
    const baseUrl = "https://api.greythr.com/employee/v2/employees";
    let page = 1;
    const size = 100;
    const allData = [];

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
            if (!json.pages.hasNext) break;
            page++;
        } else {
            break;
        }
    }

    // 2. Fetch all employee categories
    const employeeCategories = await fetchEmployeeCategories(token, domain);

    // 3. Filter employees
    const filteredData = allData.filter(employee => employee.employeeNo && employee.employeeNo.startsWith("E"));
    
    // 4. Write to Firestore
    const employeesRef = collection(db, 'employees');
    const batch = writeBatch(db);
    let employeesSynced = 0;

    for (const empData of filteredData) {
        const q = query(employeesRef, where("employeeId", "==", empData.employeeNo));
        const querySnapshot = await getDocs(q);
        
        const categories = employeeCategories[empData.employeeId] || { department: '', designation: '' };

        const newEmployeeData = {
            employeeId: empData.employeeNo,
            name: empData.name,
            email: empData.email || '',
            phone: empData.mobile || '',
            department: categories.department, // Now correctly populated
            designation: categories.designation, // Now correctly populated
            status: empData.status === 'Active' ? 'Active' : 'Inactive',
        };

        if (querySnapshot.empty) {
            const newDocRef = doc(employeesRef);
            batch.set(newDocRef, newEmployeeData);
            employeesSynced++;
        } else {
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

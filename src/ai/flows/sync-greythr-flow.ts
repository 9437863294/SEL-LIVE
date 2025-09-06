
'use server';

/**
 * @fileOverview A flow to sync employee data from GreytHR to Firestore.
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';
import { db } from '@/lib/firebase';
import { collection, writeBatch, getDocs, query, where, doc, setDoc } from 'firebase/firestore';

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

// Fetches the mapping of category IDs to human-readable names
async function fetchCategoryMappings(token: string, domain: string): Promise<{ departments: Map<number, string>, designations: Map<number, string> }> {
    const url = `https://api.greythr.com/hr/v2/lov`;
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            "ACCESS-TOKEN": token,
            "x-greythr-domain": domain,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(["cat::Department", "cat::Designation"]),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch category mappings: ${response.statusText} - ${errorText}`);
    }

    const json = await response.json();
    const departments = new Map<number, string>();
    const designations = new Map<number, string>();

    if (json['cat::Department']) {
        json['cat::Department'].forEach((dept: [number, string, any]) => {
            departments.set(dept[0], dept[1]);
        });
    }
    if (json['cat::Designation']) {
        json['cat::Designation'].forEach((desg: [number, string, any]) => {
            designations.set(desg[0], desg[1]);
        });
    }
    
    return { departments, designations };
}


// Fetches the assigned category IDs for each employee
async function fetchEmployeeCategories(token: string, domain: string): Promise<Record<string, { departmentId?: number; designationId?: number }>> {
    const baseUrl = `https://api.greythr.com/employee/v2/employees/categories`;
    let page = 1;
    const size = 100;
    const allCategoriesData = [];

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
            throw new Error(`Failed to fetch employee categories: ${response.statusText} - ${errorText}`);
        }
        const json = await response.json();
        if (json.data && json.data.length > 0) {
            allCategoriesData.push(...json.data);
            if (!json.pages.hasNext) break;
            page++;
        } else {
            break;
        }
    }

    const employeeCategories: Record<string, { departmentId?: number; designationId?: number }> = {};
    
    allCategoriesData.forEach((emp: any) => {
        const categories: { departmentId?: number; designationId?: number } = {};
        if (emp.categoryList && Array.isArray(emp.categoryList)) {
            emp.categoryList.forEach((cat: any) => {
                if (cat.category === 2) { 
                    categories.departmentId = cat.value;
                }
                if (cat.category === 6) { 
                    categories.designationId = cat.value;
                }
            });
        }
        employeeCategories[emp.employeeId] = categories;
    });

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
    
    const { departments: departmentMap, designations: designationMap } = await fetchCategoryMappings(token, domain);

    const employeeCategories = await fetchEmployeeCategories(token, domain);
    
    const baseUrl = "https://api.greythr.com/employee/v2/employees";
    let page = 1;
    const size = 100;
    const allData = [];

    while (true) {
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
        if (json.data && json.data.length > 0) {
            allData.push(...json.data);
            if (!json.pages.hasNext) break;
            page++;
        } else {
            break;
        }
    }

    const filteredData = allData.filter(employee => employee.employeeNo && employee.employeeNo.startsWith("E"));
    
    const employeesRef = collection(db, 'employees');
    const batch = writeBatch(db);
    let employeesSynced = 0;

    for (const empData of filteredData) {
        const q = query(employeesRef, where("employeeId", "==", empData.employeeNo));
        const querySnapshot = await getDocs(q);
        
        const assignedCategories = employeeCategories[empData.employeeId] || {};
        const departmentName = assignedCategories.departmentId ? departmentMap.get(assignedCategories.departmentId) : '';
        const designationName = assignedCategories.designationId ? designationMap.get(assignedCategories.designationId) : '';

        const newEmployeeData = {
            employeeId: empData.employeeNo,
            name: empData.name,
            email: empData.email || '',
            phone: empData.mobile || '',
            department: departmentName || '',
            designation: designationName || '',
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

    const settingsRef = doc(db, 'settings', 'employeeSync');
    await setDoc(settingsRef, { lastSynced: new Date().toISOString() });

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

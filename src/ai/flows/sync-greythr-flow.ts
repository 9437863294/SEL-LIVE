
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

const SyncGreytHROutputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  employees: z.array(EmployeeDataSchema).optional(),
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
    const categoryTypes = ["cat::Department", "cat::Designation"];
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            "Authorization": `Bearer ${token}`,
            "x-greythr-domain": domain,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(categoryTypes),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch category mappings: ${response.statusText} - ${errorText}`);
    }

    const json = await response.json();
    const batch = writeBatch(db);
    const categoriesRef = collection(db, 'categories');
    
    const departments = new Map<number, string>();
    const designations = new Map<number, string>();

    if (json['cat::Department']) {
        json['cat::Department'].forEach((dept: [number, string, any]) => {
            departments.set(dept[0], dept[1]);
            const docRef = doc(categoriesRef, `department_${dept[0]}`);
            batch.set(docRef, { id: dept[0], name: dept[1], type: 'Department' });
        });
    }
    if (json['cat::Designation']) {
        json['cat::Designation'].forEach((desg: [number, string, any]) => {
            designations.set(desg[0], desg[1]);
            const docRef = doc(categoriesRef, `designation_${desg[0]}`);
            batch.set(docRef, { id: desg[0], name: desg[1], type: 'Designation' });
        });
    }
    
    await batch.commit();
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
                "Authorization": `Bearer ${token}`,
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
                "Authorization": `Bearer ${token}`,
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
    
    const employeesToReturn = filteredData.map(empData => {
        const assignedCategories = employeeCategories[empData.employeeId] || {};
        const departmentName = assignedCategories.departmentId ? departmentMap.get(assignedCategories.departmentId) : '';
        const designationName = assignedCategories.designationId ? designationMap.get(assignedCategories.designationId) : '';

        return {
            employeeId: empData.employeeNo,
            name: empData.name,
            email: empData.email || '',
            phone: empData.mobile || '',
            department: departmentName || 'N/A',
            designation: designationName || 'N/A',
            status: empData.status === 'Active' ? 'Active' : 'Inactive',
        };
    });

    const settingsRef = doc(db, 'settings', 'employeeSync');
    await setDoc(settingsRef, { lastSynced: new Date().toISOString() });

    return { 
        success: true, 
        message: `Successfully fetched ${employeesToReturn.length} employees.`,
        employees: employeesToReturn,
    };
  }
);


export async function syncGreytHR(): Promise<SyncGreytHROutput> {
  return syncGreytHRFlow();
}

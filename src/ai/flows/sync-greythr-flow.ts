
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

async function fetchPage(url: string, token: string, domain: string, page: number, size = 100) {
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

async function fetchAllPages(url: string, token: string, domain: string) {
    let page = 1;
    const size = 100;
    let allData: any[] = [];
  
    while (true) {
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


async function fetchCategoryMappings(token: string, domain: string): Promise<Map<string, { department: string; designation: string }>> {
    const categoriesUrl = "https://api.greythr.com/employee/v2/employees/categories";
    const allCategories = await fetchAllPages(categoriesUrl, token, domain);

    const categoryMappings = new Map<string, { department: string; designation: string }>();

    allCategories.forEach((emp: any) => {
        let department = 'N/A';
        let designation = 'N/A';
        if (emp.categoryList) {
            for (const category of emp.categoryList) {
                if (category.category === 'Department') {
                    department = category.value;
                }
                if (category.category === 'Designation') {
                    designation = category.value;
                }
            }
        }
        categoryMappings.set(emp.employeeId, { department, designation });
    });
    return categoryMappings;
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
    
    const [employeePageJson, categoryMappings] = await Promise.all([
      fetchPage(employeesUrl, token, domain, page, pageSize),
      fetchCategoryMappings(token, domain),
    ]);
    
    const employeeData = employeePageJson.data || [];
    const hasNextPage = employeeData.length > 0;

    const filteredData = employeeData.filter((employee: any) => employee.employeeNo && employee.employeeNo.startsWith("E"));
    
    const employeesToReturn = filteredData.map((empData: any) => {
        const cats = categoryMappings.get(empData.employeeId) || { department: 'N/A', designation: 'N/A' };
        return {
            employeeId: empData.employeeNo,
            name: empData.name,
            email: empData.email || '',
            phone: empData.mobile || '',
            department: cats.department,
            designation: cats.designation,
            status: empData.status === 'Active' ? 'Active' : 'Inactive',
        };
    });

    const settingsRef = doc(db, 'settings', 'employeeSync');
    await setDoc(settingsRef, { lastSynced: new Date().toISOString() }, { merge: true });

    return { 
        success: true, 
        message: `Successfully fetched ${employeesToReturn.length} employees.`,
        employees: employeesToReturn,
        hasNextPage: hasNextPage,
        currentPage: page,
    };
  }
);


export async function syncGreytHR(input: SyncGreytHRInput): Promise<SyncGreytHROutput> {
  return syncGreytHRFlow(input);
}

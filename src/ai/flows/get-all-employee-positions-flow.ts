
'use server';

/**
 * @fileOverview A flow to fetch all employee position details from GreytHR and save to Firestore.
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';
import { db } from '@/lib/firebase';
import { collection, writeBatch, query, where, getDocs, doc, setDoc } from 'firebase/firestore';


const PositionDetailSchema = z.object({
    id: z.number(),
    category: z.string(),
    value: z.number(),
    effectiveFrom: z.string(),
    effectiveTo: z.string().nullable(),
});

const EmployeePositionSchema = z.object({
    employeeId: z.string(), // Changed to string
    categoryList: z.array(PositionDetailSchema),
});

// Input is now optional as we fetch all pages.
const GetAllEmployeePositionsInputSchema = z.object({
  page: z.number().optional().default(1), // Still accept a page for single-page refresh, but default flow fetches all
});
export type GetAllEmployeePositionsInput = z.infer<typeof GetAllEmployeePositionsInputSchema>;

const GetAllEmployeePositionsOutputSchema = z.object({
    success: z.boolean(),
    message: z.string(),
    data: z.array(EmployeePositionSchema).optional(),
});
export type GetAllEmployeePositionsOutput = z.infer<typeof GetAllEmployeePositionsOutputSchema>;


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
        headers: { "Authorization": "Basic " + encodedCredentials },
    });

    if (!response.ok) {
        throw new Error(`Failed to get GreytHR token: ${response.statusText}`);
    }

    const json = await response.json();
    return json.access_token;
}

async function fetchAllCategories(token: string, domain: string): Promise<Map<number, string>> {
    const url = "https://api.greythr.com/hr/v2/lov";
    const allCategoryTypes = ["cat::category"];
    
    const body = JSON.stringify(allCategoryTypes);

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            "ACCESS-TOKEN": token,
            "x-greythr-domain": domain,
            "Content-Type": "application/json",
        },
        body: body,
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch all categories from LOV: ${response.statusText}`);
    }

    const categoriesData = await response.json();
    const categoryIdToNameMap = new Map<number, string>();
    
    if (categoriesData['cat::category']) {
        categoriesData['cat::category'].forEach((cat: [number, string, any]) => {
            categoryIdToNameMap.set(cat[0], cat[1]);
        });
    }
    
    return categoryIdToNameMap;
}

async function getEmployeeIdMappings(token: string, domain: string): Promise<Map<number, string>> {
  const url = "https://api.greythr.com/employee/v2/employees";
  let page = 0;
  const size = 2000; // Fetch in larger chunks
  let hasNext = true;
  const mappings = new Map<number, string>();

  while(hasNext) {
    const paginatedUrl = `${url}?page=${page}&size=${size}`;
    const response = await fetch(paginatedUrl, {
      method: 'GET',
      headers: { "ACCESS-TOKEN": token, "x-greythr-domain": domain },
    });

    if (!response.ok) break;

    const json = await response.json();
    const data = json.data || [];
    data.forEach((emp: any) => {
        if(emp.employeeId && emp.employeeNo) {
            mappings.set(emp.employeeId, emp.employeeNo);
        }
    });

    hasNext = json.pages.hasNext;
    page++;
  }
  
  return mappings;
}

const getAllEmployeePositionsFlow = ai.defineFlow(
  {
    name: 'getAllEmployeePositionsFlow',
    inputSchema: GetAllEmployeePositionsInputSchema,
    outputSchema: GetAllEmployeePositionsOutputSchema,
  },
  async ({ page = 0 }) => {
    try {
        const token = await getGreytHRToken();
        const domain = "siddhartha.greythr.com";
        const pageSize = 2000; // Fetch in larger chunks
        
        const categoryIdToNameMap = await fetchAllCategories(token, domain);
        const employeeIdMap = await getEmployeeIdMappings(token, domain);
        
        let allPositions: any[] = [];
        let currentPage = 0;
        let hasNextPage = true;

        while(hasNextPage) {
            const url = `https://api.greythr.com/employee/v2/employees/categories?page=${currentPage}&size=${pageSize}`;
            const response = await fetch(url, {
                method: 'GET',
                headers: { "ACCESS-TOKEN": token, "x-greythr-domain": domain },
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch page ${currentPage}: ${response.statusText}`);
            }

            const json = await response.json();
            const data = json.data || [];
            allPositions = allPositions.concat(data);

            hasNextPage = json.pages.hasNext;
            currentPage++;
        }

        const transformedData = allPositions.map((empPos: any) => {
            const employeeNo = employeeIdMap.get(empPos.employeeId) || String(empPos.employeeId);
            return {
            ...empPos,
            employeeId: employeeNo, // Use the string employee number
            categoryList: empPos.categoryList.map((cat: any) => ({
                ...cat,
                category: categoryIdToNameMap.get(cat.category) || `ID: ${cat.category}`,
            }))
        }});

        // Save to Firestore
        const batch = writeBatch(db);
        const positionsRef = collection(db, 'employeePositions');

        transformedData.forEach(pos => {
            const docRef = doc(positionsRef, String(pos.employeeId));
            batch.set(docRef, pos);
        });

        await batch.commit();

        // Update last sync time
        await setDoc(doc(db, 'settings', 'employeePositionSync'), { lastSynced: new Date().toISOString() });

        return { 
            success: true, 
            message: `Successfully synced ${transformedData.length} employee position records.`,
            data: transformedData,
        };
    } catch (error: any) {
        console.error("Error in getAllEmployeePositionsFlow: ", error);
        return {
            success: false,
            message: error.message,
        };
    }
  }
);

export async function getAllEmployeePositions(input: GetAllEmployeePositionsInput): Promise<GetAllEmployeePositionsOutput> {
  return getAllEmployeePositionsFlow(input);
}

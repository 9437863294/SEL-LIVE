
'use server';

/**
 * @fileOverview A flow to fetch all employee position details from GreytHR with pagination.
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';

const PositionDetailSchema = z.object({
    id: z.number(),
    category: z.string(), // Changed to string to hold the name
    value: z.number(),
    effectiveFrom: z.string(),
    effectiveTo: z.string().nullable(),
});

const EmployeePositionSchema = z.object({
    employeeId: z.number(),
    categoryList: z.array(PositionDetailSchema),
});

const GetAllEmployeePositionsInputSchema = z.object({
  page: z.number().optional().default(1),
});
export type GetAllEmployeePositionsInput = z.infer<typeof GetAllEmployeePositionsInputSchema>;

const GetAllEmployeePositionsOutputSchema = z.object({
    success: z.boolean(),
    message: z.string(),
    data: z.array(EmployeePositionSchema).optional(),
    hasNextPage: z.boolean().optional(),
    currentPage: z.number().optional(),
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

async function fetchAllCategories(token: string, domain: string): Promise<Map<number, string>> {
    const url = "https://api.greythr.com/hr/v2/lov";
    const allCategoryTypes = [
        "cat::Department", "cat::Designation", "cat::Grade", "cat::Location",
        "cat::Company", "cat::Project Name", "cat::Project Division", 
        "cat::Cost Center", "cat::COST CENTER CODE", "cat::Shift", "cat::EMPLOYEE TYPE"
    ];
    
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
        const errorText = await response.text();
        throw new Error(`Failed to fetch all categories from LOV: ${response.statusText} - ${errorText}`);
    }

    const categoriesData = await response.json();
    const categoryMap = new Map<number, string>();

    // The lov endpoint returns a map where keys are "cat::CategoryName"
    // and values are arrays of [id, name, ...]. We also need a way to map
    // the category ID (e.g., 1 for Department) to its name ("Department").
    // Let's create a temporary map for that.
    const categoryIdToNameMap = new Map<number, string>();
    if (categoriesData['cat::category']) {
        categoriesData['cat::category'].forEach((cat: [number, string, any]) => {
             // Reconstruct the key format used in the main positions response
            const key = `cat::${cat[1]}`;
            // The API for positions uses just the ID (e.g. 1), not the key ('cat::Department')
            // So we need to know that ID 1 is "Department".
            categoryIdToNameMap.set(cat[0], cat[1]);
        });
    }

    // Now, populate the main map with value IDs to value names.
    // E.g., for "cat::Department", we map department ID (e.g., 29) to name ("Development").
    for (const catType of allCategoryTypes) {
        if (categoriesData[catType]) {
            categoriesData[catType].forEach((item: [number, string, any]) => {
                categoryMap.set(item[0], item[1]);
            });
        }
    }
    
    return categoryIdToNameMap;
}


const getAllEmployeePositionsFlow = ai.defineFlow(
  {
    name: 'getAllEmployeePositionsFlow',
    inputSchema: GetAllEmployeePositionsInputSchema,
    outputSchema: GetAllEmployeePositionsOutputSchema,
  },
  async ({ page = 1 }) => {
    const token = await getGreytHRToken();
    const domain = "siddhartha.greythr.com";
    const pageSize = 25;
    
    const url = `https://api.greythr.com/employee/v2/employees/categories?page=${page}&size=${pageSize}`;
    
    const [positionsResponse, categoryIdToNameMap] = await Promise.all([
      fetch(url, {
          method: 'GET',
          headers: {
              "ACCESS-TOKEN": token,
              "x-greythr-domain": domain,
          },
      }),
      fetchAllCategories(token, domain)
    ]);


    if (!positionsResponse.ok) {
        const errorText = await positionsResponse.text();
        throw new Error(`Failed to fetch position details: ${positionsResponse.statusText} - ${errorText}`);
    }

    const json = await positionsResponse.json();
    const positionsData = json.data || [];
    const pageInfo = json.pages || {};
    
    const transformedData = positionsData.map((empPos: any) => ({
      ...empPos,
      categoryList: empPos.categoryList.map((cat: any) => ({
        ...cat,
        // Use the map to convert category ID (e.g., 1) to its name (e.g., "Department")
        category: categoryIdToNameMap.get(cat.category) || `ID: ${cat.category}`,
      }))
    }));

    return { 
        success: true, 
        message: 'Successfully fetched position details.',
        data: transformedData,
        hasNextPage: pageInfo.hasNext,
        currentPage: page,
    };
  }
);


export async function getAllEmployeePositions(input: GetAllEmployeePositionsInput): Promise<GetAllEmployeePositionsOutput> {
  return getAllEmployeePositionsFlow(input);
}

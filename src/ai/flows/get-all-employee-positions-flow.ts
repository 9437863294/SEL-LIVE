
'use server';

/**
 * @fileOverview A flow to fetch all employee position details from GreytHR with pagination.
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';

const PositionDetailSchema = z.object({
    id: z.number(),
    category: z.number(),
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

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            "ACCESS-TOKEN": token,
            "x-greythr-domain": domain,
        },
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch position details: ${response.statusText} - ${errorText}`);
    }

    const json = await response.json();
    const positionsData = json.data || [];
    const pageInfo = json.pages || {};

    return { 
        success: true, 
        message: 'Successfully fetched position details.',
        data: positionsData,
        hasNextPage: pageInfo.hasNext,
        currentPage: page,
    };
  }
);


export async function getAllEmployeePositions(input: GetAllEmployeePositionsInput): Promise<GetAllEmployeePositionsOutput> {
  return getAllEmployeePositionsFlow(input);
}

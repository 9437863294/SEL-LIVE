
'use server';

/**
 * @fileOverview A flow to fetch position details for a single employee from GreytHR.
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

const GetEmployeePositionDetailsInputSchema = z.object({
  employeeId: z.string().describe("The ID of the employee to fetch details for."),
});
export type GetEmployeePositionDetailsInput = z.infer<typeof GetEmployeePositionDetailsInputSchema>;

const GetEmployeePositionDetailsOutputSchema = z.object({
    success: z.boolean(),
    message: z.string(),
    details: z.array(PositionDetailSchema).optional(),
});
export type GetEmployeePositionDetailsOutput = z.infer<typeof GetEmployeePositionDetailsOutputSchema>;


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


const getEmployeePositionDetailsFlow = ai.defineFlow(
  {
    name: 'getEmployeePositionDetailsFlow',
    inputSchema: GetEmployeePositionDetailsInputSchema,
    outputSchema: GetEmployeePositionDetailsOutputSchema,
  },
  async ({ employeeId }) => {
    const token = await getGreytHRToken();
    const domain = "siddhartha.greythr.com";
    
    const url = `https://api.greythr.com/employee/v2/employees/${employeeId}/categories`;

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

    const details = await response.json();

    return { 
        success: true, 
        message: 'Successfully fetched position details.',
        details: details,
    };
  }
);


export async function getEmployeePositionDetails(input: GetEmployeePositionDetailsInput): Promise<GetEmployeePositionDetailsOutput> {
  return getEmployeePositionDetailsFlow(input);
}

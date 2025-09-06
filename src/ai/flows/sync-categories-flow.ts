'use server';

/**
 * @fileOverview A flow to sync category data (departments and designations) from GreytHR to Firestore.
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';
import { db } from '@/lib/firebase';
import { collection, writeBatch, getDocs, query, doc } from 'firebase/firestore';

const SyncCategoriesOutputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  departmentCount: z.number(),
  designationCount: z.number(),
});

export type SyncCategoriesOutput = z.infer<typeof SyncCategoriesOutputSchema>;

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

async function fetchGreytHRCategoriesData(token: string, domain: string): Promise<any> {
    const url = "https://api.greythr.com/hr/v2/lov";
    const body = JSON.stringify(["cat::Department", "cat::Designation"]);

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
        throw new Error(`Failed to fetch categories from LOV endpoint: ${response.statusText} - ${errorText}`);
    }

    return response.json();
}

const syncGreytHRCategoriesFlow = ai.defineFlow(
  {
    name: 'syncGreytHRCategoriesFlow',
    outputSchema: SyncCategoriesOutputSchema,
  },
  async () => {
    const token = await getGreytHRToken();
    const domain = "siddhartha.greythr.com";
    
    const categoryData = await fetchGreytHRCategoriesData(token, domain);

    const departments = new Map<number, string>();
    const designations = new Map<number, string>();

    if (categoryData['cat::Department']) {
        categoryData['cat::Department'].forEach((dept: [number, string, any]) => {
            departments.set(dept[0], dept[1]);
        });
    }

    if (categoryData['cat::Designation']) {
        categoryData['cat::Designation'].forEach((desg: [number, string, any]) => {
            designations.set(desg[0], desg[1]);
        });
    }

    const categoriesRef = collection(db, 'categories');
    
    // Clear existing categories
    const existingCategoriesSnap = await getDocs(query(categoriesRef));
    if (!existingCategoriesSnap.empty) {
        const deleteBatch = writeBatch(db);
        existingCategoriesSnap.forEach(doc => {
            deleteBatch.delete(doc.ref);
        });
        await deleteBatch.commit();
    }
    
    // Add new categories
    const addBatch = writeBatch(db);
    departments.forEach((name, id) => {
        const docRef = doc(categoriesRef); // Auto-generate document ID
        addBatch.set(docRef, { id, name, type: 'Department' });
    });
    designations.forEach((name, id) => {
        const docRef = doc(categoriesRef); // Auto-generate document ID
        addBatch.set(docRef, { id, name, type: 'Designation' });
    });
    
    await addBatch.commit();

    return { 
        success: true, 
        message: 'Successfully synced categories.',
        departmentCount: departments.size,
        designationCount: designations.size,
    };
  }
);


export async function syncGreytHRCategories(): Promise<SyncCategoriesOutput> {
  return syncGreytHRCategoriesFlow();
}

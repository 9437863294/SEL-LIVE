'use server';

/**
 * @fileOverview A flow to sync category data (departments and designations) from GreytHR to Firestore.
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';
import { db } from '@/lib/firebase';
import { collection, writeBatch, getDocs, query } from 'firebase/firestore';

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

async function fetchAllCategories(token: string, domain: string) {
    const url = "https://api.greythr.com/employee/v2/employees/categories";
    let page = 1;
    const size = 100;
    let allCategories: any[] = [];
  
    while (true) {
        const paginatedUrl = `${url}?page=${page}&size=${size}`;
        const response = await fetch(paginatedUrl, {
            method: 'GET',
            headers: {
                "ACCESS-TOKEN": token,
                "x-greythr-domain": domain,
            },
        });
  
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to fetch categories: ${response.statusText} - ${errorText}`);
        }
  
        const json = await response.json();
        const data = json.data || [];
        
        if (data.length > 0) {
            allCategories = allCategories.concat(data);
            page++;
        } else {
            break;
        }
    }
    return allCategories;
}

const syncGreytHRCategoriesFlow = ai.defineFlow(
  {
    name: 'syncGreytHRCategoriesFlow',
    outputSchema: SyncCategoriesOutputSchema,
  },
  async () => {
    const token = await getGreytHRToken();
    const domain = "siddhartha.greythr.com";
    
    const allCategoryData = await fetchAllCategories(token, domain);

    const departments = new Map<number, string>();
    const designations = new Map<number, string>();

    allCategoryData.forEach(emp => {
      if (emp.categoryList) {
        emp.categoryList.forEach((cat: any) => {
          if (cat.category === 'Department' && !departments.has(cat.id)) {
            departments.set(cat.id, cat.value);
          }
          if (cat.category === 'Designation' && !designations.has(cat.id)) {
            designations.set(cat.id, cat.value);
          }
        });
      }
    });

    const categoriesRef = collection(db, 'categories');
    
    // Clear existing categories
    const existingCategoriesSnap = await getDocs(query(categoriesRef));
    const deleteBatch = writeBatch(db);
    existingCategoriesSnap.forEach(doc => {
        deleteBatch.delete(doc.ref);
    });
    await deleteBatch.commit();
    
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

'use server';

/**
 * @fileOverview A flow to sync all category data from GreytHR to Firestore.
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';
import { db } from '@/lib/firebase';
import { collection, writeBatch, getDocs, query, doc, type DocumentData, type DocumentReference } from 'firebase/firestore';
import { categoryDocId } from '@/lib/greythr';

const allCategoryTypes = [
    "cat::Department", "cat::Designation", "cat::Grade", "cat::Location",
    "cat::Company", "cat::Project Name", "cat::Project Division", 
    "cat::Cost Center", "cat::COST CENTER CODE", "cat::Shift", "cat::EMPLOYEE TYPE"
];

const CategoryCountSchema = z.record(z.string(), z.number());

const SyncCategoriesOutputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  counts: CategoryCountSchema,
});

export type SyncCategoriesOutput = z.infer<typeof SyncCategoriesOutputSchema>;

async function getGreytHRToken(): Promise<string> {
    const username = process.env.GREYTHR_USERNAME?.trim();
    const password = process.env.GREYTHR_PASSWORD?.trim();

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

    const categoriesRef = collection(db, 'categories');

    /**
     * Upserted under `categoryDocId`, not re-created under auto-generated ids.
     *
     * This flow used to delete the whole collection and add every value back with `doc(ref)`, which
     * had two consequences. A reader who loaded the Category screen mid-sync saw an empty master;
     * and because the hourly unified sync upserts the same values under deterministic ids, the next
     * run re-created all of them a second time — two documents for `Designation 47`, two identical
     * rows on screen, two React children with the same key. Sharing one id scheme makes the two
     * writers idempotent against each other instead.
     */
    const counts: Record<string, number> = {};
    const writes: Array<{ ref: DocumentReference; data: DocumentData }> = [];
    const written = new Set<string>();

    for (const catKey of allCategoryTypes) {
        const categoryName = catKey.replace('cat::', '');
        const data = categoryData[catKey];
        if (data) {
            counts[categoryName] = data.length;
            data.forEach((item: [number, string, any]) => {
                const id = categoryDocId(categoryName, item[0]);
                written.add(id);
                writes.push({ ref: doc(categoriesRef, id), data: { id: item[0], name: item[1], type: categoryName } });
            });
        }
    }

    /**
     * Then converge whatever earlier runs left behind under the old scheme.
     *
     * An auto-id document is either a duplicate of a value this run just wrote, or a value greytHR
     * has since dropped. The duplicate is deleted outright; the dropped one is first re-written
     * under its canonical id, because a retired category value is still referenced by historical
     * employee records and deleting it would turn those rows into blanks. Either way the collection
     * ends up with exactly one document per value, so this runs once in practice.
     */
    const existingSnap = await getDocs(query(categoriesRef));
    const deletions: DocumentReference[] = [];
    existingSnap.forEach(existing => {
        const data = existing.data();
        if (typeof data.type !== 'string' || (typeof data.id !== 'number' && typeof data.id !== 'string')) return;
        const canonical = categoryDocId(data.type, data.id);
        if (canonical === existing.id) return;
        if (!written.has(canonical)) {
            written.add(canonical);
            writes.push({ ref: doc(categoriesRef, canonical), data });
        }
        deletions.push(existing.ref);
    });

    /**
     * Committed in chunks, writes before deletes.
     *
     * A Firestore batch takes 500 operations and this run can exceed that on its own once the
     * re-keying above is counted. Ordering every write ahead of every delete means a chunk that
     * fails part-way leaves a duplicate behind — which the next run cleans up — rather than
     * deleting a value whose replacement never landed.
     */
    const operations: Array<{ ref: DocumentReference; data?: DocumentData }> = [
        ...writes,
        ...deletions.map(ref => ({ ref })),
    ];
    for (let index = 0; index < operations.length; index += 450) {
        const batch = writeBatch(db);
        for (const operation of operations.slice(index, index + 450)) {
            if (operation.data) batch.set(operation.ref, operation.data, { merge: true });
            else batch.delete(operation.ref);
        }
        await batch.commit();
    }

    return { 
        success: true, 
        message: 'Successfully synced all categories.',
        counts: counts,
    };
  }
);


export async function syncGreytHRCategories(): Promise<SyncCategoriesOutput> {
  return syncGreytHRCategoriesFlow();
}


'use server';

/**
 * @fileOverview DEPRECATED — superseded by `/api/greythr/sync`.
 *
 * Kept only so `src/ai/actions.ts` keeps compiling; nothing calls it. Do not wire it back up. It
 * has three defects that the replacement exists to fix, documented here so the next person to find
 * it does not assume it is a working fallback:
 *
 *   1. `empData.status === 'Active'` compares greytHR's *numeric* status code against a string, so
 *      the ternary below writes `Inactive` for every employee in the system. greytHR's `status` is
 *      employment type (Probation / Confirmed / Contract / Trainee) and never indicates whether
 *      somebody still works here.
 *   2. `if (!existingEmployeeIds.has(...))` means existing employees are only ever inserted, never
 *      updated — no promotion, resignation or email change has ever propagated.
 *   3. `state=CURRENT` excludes resigned employees, so nobody could be detected as having left.
 *
 * The replacement is `src/lib/greythr-sync-service.ts`, with the rules in `src/lib/greythr.ts` and
 * the console at `/employee/sync`. See `docs/greythr-integration.md`.
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';
import { db } from '@/lib/firebase';
import { collection, writeBatch, doc, setDoc, getDocs } from 'firebase/firestore';

const EmployeeDataSchema = z.object({
    employeeId: z.string(),
    name: z.string(),
    email: z.string().optional(),
    phone: z.string().optional(),
    status: z.string(),
    employeeNo: z.string().optional(),
    dateOfJoin: z.string().optional().nullable(),
    leavingDate: z.string().optional().nullable(),
    dateOfBirth: z.string().optional().nullable(),
    gender: z.string().optional(),
});

const SyncGreytHROutputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

export type SyncGreytHROutput = z.infer<typeof SyncGreytHROutputSchema>;

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

async function fetchPage(url: string, token: string, domain: string, page: number, size = 25) {
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

// Flow for syncing all employees
const syncAllGreytHRFlow = ai.defineFlow(
  {
    name: 'syncAllGreytHRFlow',
    outputSchema: SyncGreytHROutputSchema,
  },
  async () => {
    const token = await getGreytHRToken();
    const domain = "siddhartha.greythr.com";
    const employeesUrl = "https://api.greythr.com/employee/v2/employees";
    
    let allEmployees: any[] = [];
    let page = 0; // APIs are often 0-indexed for pages
    let hasNext = true;
    const size = 2000; // Use a larger page size

    while(hasNext) {
        try {
            const pageJson = await fetchPage(employeesUrl, token, domain, page, size);
            const data = pageJson.data || [];
            allEmployees = allEmployees.concat(data);
            hasNext = pageJson.pages.hasNext;
            page++;
        } catch (error) {
            console.error(`Error fetching page ${page}:`, error);
            hasNext = false; // Stop on error
        }
    }
    
    const employeesToSave = allEmployees.map((empData: any) => ({
        employeeId: String(empData.employeeId),
        name: empData.name,
        email: empData.email || '',
        phone: empData.mobile || '',
        status: empData.status === 'Active' ? 'Active' : 'Inactive',
        employeeNo: empData.employeeNo,
        dateOfJoin: empData.dateOfJoin || null,
        leavingDate: empData.leavingDate || null,
        dateOfBirth: empData.dateOfBirth || null,
        gender: empData.gender || '',
    }));

    const batch = writeBatch(db);
    const employeesRef = collection(db, 'employees');

    // Fetch existing employee IDs to avoid duplicates
    const existingEmployeesSnap = await getDocs(employeesRef);
    const existingEmployeeIds = new Set(existingEmployeesSnap.docs.map(doc => doc.id));

    let newEmployeesCount = 0;
    employeesToSave.forEach(emp => {
      // Only add employee if their ID doesn't already exist
      if (!existingEmployeeIds.has(emp.employeeId)) {
        const docRef = doc(employeesRef, emp.employeeId);
        batch.set(docRef, emp);
        newEmployeesCount++;
      }
    });

    if (newEmployeesCount > 0) {
      await batch.commit();
    }

    await setDoc(doc(db, 'settings', 'employeeSync'), { lastSynced: new Date().toISOString() });
    
    return {
        success: true,
        message: `Successfully synced from GreytHR. Added ${newEmployeesCount} new employees. ${employeesToSave.length - newEmployeesCount} employees were already up-to-date.`
    }
  }
);


export async function syncAllGreytHR(): Promise<SyncGreytHROutput> {
  return syncAllGreytHRFlow();
}

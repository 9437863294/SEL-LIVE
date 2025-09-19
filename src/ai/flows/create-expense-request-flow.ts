
'use server';
/**
 * @fileOverview A flow to create an expense request programmatically.
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';
import { db } from '@/lib/firebase';
import { collection, addDoc, doc, runTransaction, getDoc, serverTimestamp, query, where, getDocs } from 'firebase/firestore';
import { logUserActivity } from '@/lib/activity-logger';
import type { SerialNumberConfig, Department } from '@/lib/types';


export const CreateExpenseRequestInputSchema = z.object({
    departmentId: z.string(),
    projectId: z.string(),
    amount: z.number(),
    partyName: z.string(),
    description: z.string(),
    headOfAccount: z.string().optional(),
    subHeadOfAccount: z.string().optional(),
    remarks: z.string().optional(),
});
export type CreateExpenseRequestInput = z.infer<typeof CreateExpenseRequestInputSchema>;

export const CreateExpenseRequestOutputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  requestNo: z.string().optional(),
});
export type CreateExpenseRequestOutput = z.infer<typeof CreateExpenseRequestOutputSchema>;

const createExpenseRequestFlow = ai.defineFlow(
  {
    name: 'createExpenseRequestFlow',
    inputSchema: CreateExpenseRequestInputSchema,
    outputSchema: CreateExpenseRequestOutputSchema,
  },
  async (data) => {

    try {
      const deptRef = doc(db, 'departments', data.departmentId);
      const deptSnap = await getDoc(deptRef);
      if (!deptSnap.exists()) {
        throw new Error('Selected department not found.');
      }
      const selectedDept = deptSnap.data() as Department;

      const configRef = doc(db, 'departmentSerialConfigs', data.departmentId);
      const newRequestNo = await runTransaction(db, async (transaction) => {
        const configDoc = await transaction.get(configRef);
        if (!configDoc.exists()) {
          throw new Error(`Serial number configuration for ${selectedDept.name} not found!`);
        }
        const configData = configDoc.data() as SerialNumberConfig;
        const newIndex = configData.startingIndex;
        const formattedIndex = String(newIndex).padStart(4, '0');
        const requestNo = `${configData.prefix || ''}${configData.format || ''}${formattedIndex}${configData.suffix || ''}`;
        transaction.update(configRef, { startingIndex: newIndex + 1 });
        return requestNo;
      });

      const newExpenseRequest = {
        ...data,
        requestNo: newRequestNo,
        generatedByDepartment: selectedDept.name,
        // In a real app, you'd pass the current user's details. For this flow, we'll mark as system-generated.
        generatedByUser: 'System (Auto-generated)',
        generatedByUserId: 'system',
        receptionNo: '',
        receptionDate: '',
        createdAt: new Date().toISOString(),
      };

      await addDoc(collection(db, 'expenseRequests'), newExpenseRequest);

      // We might not have a user in this context, so logging is optional
      // or uses a system identity.
      
      return {
        success: true,
        message: `Expense request ${newRequestNo} has been successfully created.`,
        requestNo: newRequestNo,
      };

    } catch (error: any) {
      console.error('Error creating expense request via flow:', error);
      return {
        success: false,
        message: error.message || 'An unexpected error occurred.',
      };
    }
  }
);


export async function createExpenseRequest(input: CreateExpenseRequestInput): Promise<CreateExpenseRequestOutput> {
  return await createExpenseRequestFlow(input);
}


'use server';
/**
 * @fileOverview A flow to handle sending an email authorization request.
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';
import { db } from '@/lib/firebase';
import { collection, addDoc, query, where, getDocs } from 'firebase/firestore';

const SendEmailAuthorizationInputSchema = z.object({
  email: z.string().email().describe('The email address to send the authorization request to.'),
});
export type SendEmailAuthorizationInput = z.infer<typeof SendEmailAuthorizationInputSchema>;

const SendEmailAuthorizationOutputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});
export type SendEmailAuthorizationOutput = z.infer<typeof SendEmailAuthorizationOutputSchema>;


const sendEmailAuthorizationFlow = ai.defineFlow(
  {
    name: 'sendEmailAuthorizationFlow',
    inputSchema: SendEmailAuthorizationInputSchema,
    outputSchema: SendEmailAuthorizationOutputSchema,
  },
  async ({ email }) => {
    
    // In a real app, this would trigger a secure backend process:
    // 1. Generate a unique, secure token for the request.
    // 2. Store the pending request (email, token, expiry) in Firestore.
    // 3. Trigger an email (via a secure backend service like SendGrid or using Nodemailer) 
    //    to the user with a link like /authorize-email?token=...
    // For now, we'll just simulate it by adding a "Pending" record.
    
    const authorizationsRef = collection(db, 'emailAuthorizations');
    
    // Check if a request already exists for this email
    const q = query(authorizationsRef, where("email", "==", email));
    const querySnapshot = await getDocs(q);
    if (!querySnapshot.empty) {
        return {
            success: false,
            message: 'An authorization request for this email already exists.',
        }
    }

    const newAuth = {
      email,
      status: 'Pending' as const,
      createdAt: new Date().toISOString(),
    };
    
    await addDoc(authorizationsRef, newAuth);

    return {
        success: true,
        message: `Authorization request sent to ${email}.`,
    }
  }
);

export async function sendEmailAuthorization(input: SendEmailAuthorizationInput): Promise<SendEmailAuthorizationOutput> {
  return sendEmailAuthorizationFlow(input);
}

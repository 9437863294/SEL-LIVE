
'use server';
/**
 * @fileOverview A flow to fetch emails.
 *
 * - getEmails - A function that handles fetching emails.
 * - GetEmailsInput - The input type for the getEmails function.
 * - GetEmailsOutput - The return type for the getEmails function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';
import type { Email } from '@/lib/types';

const GetEmailsInputSchema = z.object({
  folder: z.string().describe('The folder to fetch emails from, e.g., "Inbox", "Sent".'),
});
export type GetEmailsInput = z.infer<typeof GetEmailsInputSchema>;


const EmailSchema = z.object({
    id: z.string(),
    sender: z.string(),
    initials: z.string(),
    subject: z.string(),
    body: z.string(),
    date: z.string(),
    read: z.boolean(),
});

const GetEmailsOutputSchema = z.object({
  emails: z.array(EmailSchema),
});
export type GetEmailsOutput = z.infer<typeof GetEmailsOutputSchema>;


const mockEmails: Email[] = [
  {
    id: '1',
    sender: 'Alex Doe',
    initials: 'AD',
    subject: 'Project Alpha Kick-off',
    body: 'Hi team, Just a reminder about the kick-off meeting tomorrow at 10 AM. Please come prepared to discuss the project timeline and initial deliverables. Looking forward to it!',
    date: '2 hours ago',
    read: false,
  },
  {
    id: '2',
    sender: 'Samantha Lee',
    initials: 'SL',
    subject: 'Q3 Report Final Draft',
    body: 'Attached is the final draft of the Q3 report. Please review and provide any feedback by EOD. Thanks!',
    date: 'Yesterday',
    read: true,
  },
   {
    id: '3',
    sender: 'Google Workspace',
    initials: 'GW',
    subject: 'Security Alert: New sign-in to your account',
    body: 'Your Google Account was just signed into from a new Windows device. You\'re getting this email to make sure it was you.',
    date: '3 days ago',
    read: true,
  },
   {
    id: '4',
    sender: 'HR Department',
    initials: 'HR',
    subject: 'Company Wide Holiday Announcement',
    body: 'Dear all, please note that the office will be closed on Monday for the public holiday. Enjoy your long weekend!',
    date: '4 days ago',
    read: true,
  },
];


const getEmailsFlow = ai.defineFlow(
  {
    name: 'getEmailsFlow',
    inputSchema: GetEmailsInputSchema,
    outputSchema: GetEmailsOutputSchema,
  },
  async (input) => {
    // In a real application, you would replace this with a call to the Gmail API
    // using the user's authenticated credentials.
    console.log(`Fetching emails for folder: ${input.folder}`);
    
    // For now, we return mock data.
    return {
        emails: mockEmails,
    };
  }
);

export async function getEmails(input: GetEmailsInput): Promise<GetEmailsOutput> {
  return getEmailsFlow(input);
}


'use server';

/**
 * @fileOverview A Genkit flow for generating signed URLs for file uploads to Firebase Storage.
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';
import * as admin from 'firebase-admin';

const UploadFileInputSchema = z.object({
  filename: z.string().describe('The name of the file to upload.'),
  contentType: z.string().describe('The MIME type of the file.'),
});

const UploadFileOutputSchema = z.object({
  url: z.string(),
});

// Helper function to initialize Firebase Admin SDK
function getFirebaseAdminApp() {
  if (admin.apps.length > 0) {
    return admin.apps[0]!;
  }

  const serviceAccount = {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  };

  if (!serviceAccount.projectId || !serviceAccount.clientEmail || !serviceAccount.privateKey) {
    throw new Error('Firebase Admin SDK service account credentials are not set correctly in environment variables.');
  }

  return admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  });
}

const generateUploadUrlFlow = ai.defineFlow(
  {
    name: 'generateUploadUrlFlow',
    inputSchema: UploadFileInputSchema,
    outputSchema: UploadFileOutputSchema,
  },
  async ({ filename, contentType }) => {
    try {
      getFirebaseAdminApp(); 
      const bucket = admin.storage().bucket();

      const file = bucket.file(filename);

      const options = {
        version: 'v4' as const,
        action: 'write' as const,
        expires: Date.now() + 15 * 60 * 1000, // 15 minutes
        contentType: contentType,
      };

      const [url] = await file.getSignedUrl(options);

      return { url };
    } catch (error: any) {
      console.error('Error generating signed URL:', error);
      throw new Error(`Failed to generate upload URL. ${error.message}`);
    }
  }
);

export async function generateUploadUrl(input: z.infer<typeof UploadFileInputSchema>): Promise<z.infer<typeof UploadFileOutputSchema>> {
  return await generateUploadUrlFlow(input);
}

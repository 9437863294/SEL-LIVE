
import { NextRequest, NextResponse } from 'next/server';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import 'server-only';

// This is a more robust way to initialize Firebase Admin SDK in Next.js server environments.
// It ensures that we don't try to re-initialize the app on every hot-reload.
const getAdminApp = () => {
  if (getApps().length > 0) {
    return getApps()[0];
  }

  // Construct the service account object from environment variables
  const serviceAccount = {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY,
  };

  if (!serviceAccount.projectId || !serviceAccount.clientEmail || !serviceAccount.privateKey) {
    throw new Error('Firebase Admin SDK service account credentials are not set correctly in environment variables.');
  }

  return initializeApp({
    credential: cert(serviceAccount),
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  });
};

export async function POST(req: NextRequest) {
  try {
    const adminApp = getAdminApp();
    const bucket = getStorage(adminApp).bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET);
    const { filename, contentType } = await req.json();

    if (!filename || !contentType) {
      return NextResponse.json({ error: 'Filename and contentType are required.' }, { status: 400 });
    }

    const file = bucket.file(filename);

    const options = {
      version: 'v4' as const,
      action: 'write' as const,
      expires: Date.now() + 15 * 60 * 1000, // 15 minutes
      contentType: contentType,
    };

    const [url] = await file.getSignedUrl(options);
    
    return NextResponse.json({ url }, { status: 200 });
  } catch (error) {
    console.error('Error generating signed URL:', error);
    // Provide a more descriptive error message in the response
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'Failed to generate upload URL. ' + errorMessage }, { status: 500 });
  }
}


import { NextRequest, NextResponse } from 'next/server';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';

// Ensure this file is not bundled on the client
import 'server-only';

// Construct the service account object from environment variables
const serviceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  // Replace the literal \n with actual newlines
  privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
};

const BUCKET_NAME = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;

// Initialize Firebase Admin SDK only if it hasn't been initialized yet
if (getApps().length === 0) {
  try {
    initializeApp({
      credential: cert(serviceAccount),
      storageBucket: BUCKET_NAME,
    });
  } catch (error: any) {
    console.error('Firebase Admin Initialization Error:', error.message);
    // This will prevent the server from starting if credentials are wrong
    throw new Error('Failed to initialize Firebase Admin SDK. Check service account credentials.');
  }
}

export async function POST(req: NextRequest) {
  if (!BUCKET_NAME) {
    return NextResponse.json({ error: 'Firebase Storage bucket name is not configured.' }, { status: 500 });
  }

  try {
    const { filename, contentType } = await req.json();

    if (!filename || !contentType) {
      return NextResponse.json({ error: 'Filename and contentType are required.' }, { status: 400 });
    }

    const bucket = getStorage().bucket(BUCKET_NAME);
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
    return NextResponse.json({ error: 'Failed to generate upload URL.' }, { status: 500 });
  }
}

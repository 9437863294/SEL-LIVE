
import { NextResponse } from 'next/server';
import { initializeApp, cert, getApps, App } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';

// A function to safely get the initialized Firebase Admin app
function getFirebaseAdminApp(): App {
    if (getApps().length > 0) {
        return getApps()[0];
    }
    
    // Ensure all required environment variables are present
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;

    if (!projectId || !privateKey || !clientEmail) {
        throw new Error('Firebase service account credentials are not set in environment variables.');
    }
    
    const serviceAccount = {
        projectId,
        privateKey,
        clientEmail,
    };

    return initializeApp({
        credential: cert(serviceAccount),
        storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    });
}


export async function POST(request: Request) {
    try {
        const adminApp = getFirebaseAdminApp();
        const { filename, contentType, path } = await request.json();

        if (!filename || !contentType || !path) {
            return NextResponse.json({ error: 'Missing filename, contentType, or path' }, { status: 400 });
        }

        const bucket = getStorage(adminApp).bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET);
        const file = bucket.file(path);

        const options = {
            version: 'v4' as const,
            action: 'write' as const,
            expires: Date.now() + 15 * 60 * 1000, // 15 minutes
            contentType,
        };
        
        const [url] = await file.getSignedUrl(options);

        return NextResponse.json({ url });
    } catch (error: any) {
        console.error('Error generating signed URL:', error);
        return NextResponse.json(
            { error: 'Failed to generate upload URL', details: error.message },
            { status: 500 }
        );
    }
}

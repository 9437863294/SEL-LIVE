import 'server-only';

import { applicationDefault, cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getDatabase } from 'firebase-admin/database';
import { getMessaging } from 'firebase-admin/messaging';

function getAdminApp() {
  if (getApps().length > 0) return getApp();

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const hasCompleteServiceAccount = Boolean(
    projectId
      && clientEmail
      && privateKey?.includes('-----BEGIN PRIVATE KEY-----')
      && privateKey.includes('-----END PRIVATE KEY-----')
  );

  // Local developers can opt in to the credential written by `gcloud auth
  // application-default login` (including service-account impersonation). Keep this explicit so a
  // missing credential never triggers a slow metadata-server lookup on every development request.
  const useApplicationDefaultCredentials =
    process.env.FIREBASE_USE_APPLICATION_DEFAULT_CREDENTIALS === 'true';
  const canUseLocalApplicationDefault = Boolean(
    useApplicationDefaultCredentials
      || process.env.GOOGLE_APPLICATION_CREDENTIALS
      || process.env.FIRESTORE_EMULATOR_HOST
  );

  if (
    process.env.NODE_ENV === 'development'
    && !hasCompleteServiceAccount
    && !canUseLocalApplicationDefault
  ) {
    throw new Error(
      'Firebase Admin credentials are not configured. Set the service-account variables, or run ' +
        '`gcloud auth application-default login` and set ' +
        'FIREBASE_USE_APPLICATION_DEFAULT_CREDENTIALS=true for keyless local development.',
    );
  }

  const credential = hasCompleteServiceAccount
    ? cert({ projectId: projectId!, clientEmail: clientEmail!, privateKey: privateKey! })
    : applicationDefault();

  return initializeApp({
    credential,
    projectId,
    databaseURL:
      process.env.FIREBASE_DATABASE_URL ||
      process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ||
      (projectId ? `https://${projectId}-default-rtdb.firebaseio.com` : undefined),
  });
}

export function getFirebaseAdminAuth() {
  return getAuth(getAdminApp());
}

export function getFirebaseAdminFirestore() {
  return getFirestore(getAdminApp());
}

export function getFirebaseAdminMessaging() {
  return getMessaging(getAdminApp());
}

export function getFirebaseAdminDatabase() {
  return getDatabase(getAdminApp());
}

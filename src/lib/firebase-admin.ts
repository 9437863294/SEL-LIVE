import 'server-only';

import { applicationDefault, cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
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

  const credential = hasCompleteServiceAccount
    ? cert({ projectId: projectId!, clientEmail: clientEmail!, privateKey: privateKey! })
    : applicationDefault();

  return initializeApp({ credential, projectId });
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

import 'server-only';

import type { DecodedIdToken } from 'firebase-admin/auth';
import { getFirebaseAdminFirestore } from '@/lib/firebase-admin';

export async function resolveAuthenticatedAppUserId(decodedToken: DecodedIdToken) {
  const firestore = getFirebaseAdminFirestore();
  const uidUser = await firestore.collection('users').doc(decodedToken.uid).get();
  if (uidUser.exists) return uidUser.id;

  const normalizedEmail = String(decodedToken.email || '').trim().toLowerCase();
  if (normalizedEmail) {
    const emailUsers = await firestore
      .collection('users')
      .where('email', '==', normalizedEmail)
      .limit(1)
      .get();
    if (!emailUsers.empty) return emailUsers.docs[0].id;
  }

  throw new Error('Authenticated account is not linked to an application user.');
}


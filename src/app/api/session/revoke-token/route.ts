/**
 * POST /api/session/revoke-token
 *
 * Revokes all Firebase Auth refresh tokens for a given user.
 * Called by an administrator after marking a session as inactive in Firestore,
 * ensuring the user cannot silently refresh their auth token even if their
 * browser tab was closed when the termination happened.
 *
 * Required env vars:
 *   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
 */

import { NextResponse } from 'next/server';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

function getAdminAuth() {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
  }
  return getAuth();
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { userId } = body as { userId?: string };

    if (!userId || typeof userId !== 'string' || userId.trim() === '') {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const auth = getAdminAuth();
    await auth.revokeRefreshTokens(userId.trim());

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[revoke-token] Failed:', err);
    return NextResponse.json(
      { error: 'Failed to revoke authentication tokens' },
      { status: 500 }
    );
  }
}

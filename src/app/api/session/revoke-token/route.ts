/** Revoke Firebase refresh tokens for the caller or for a session-management administrator. */

import { NextResponse } from 'next/server';
import {
  AccessDeniedError,
  accessErrorResponse,
  authenticateAccess,
} from '@/lib/access-control-server';
import { checkerFor } from '@/lib/access-control';
import { getFirebaseAdminAuth } from '@/lib/firebase-admin';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const context = await authenticateAccess(request);
    const body = await request.json().catch(() => ({}));
    const userId = typeof body?.userId === 'string' ? body.userId.trim() : '';

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const isSelf = userId === context.userId;
    const can = checkerFor(context.access);
    const canManageSessions =
      can('View', 'Settings.Session Management') ||
      can('Delete', 'Settings.Session Management');
    if (!isSelf && !canManageSessions) {
      throw new AccessDeniedError('Session Management permission is required to revoke another user.');
    }

    await getFirebaseAdminAuth().revokeRefreshTokens(userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const { message, status } = accessErrorResponse(error);
    return NextResponse.json({ error: message }, { status });
  }
}

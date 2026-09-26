import 'server-only';

import { NextResponse } from 'next/server';
import { checkerFor } from '@/lib/access-control';
import { AccessDeniedError, accessErrorResponse, authenticateAccess, type AccessRequestContext } from '@/lib/access-control-server';
import { logServerActivity, requestProvenance } from '@/lib/activity-logger-server';
import { getFirebaseAdminAuth, getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import { appearanceAdminRights, type AppearanceAdminRights } from './permissions';
import type { AppearanceActor } from './server';

/** The caller's auth uid, verified — what personal preferences are keyed by. */
export async function verifiedCaller(request: Request): Promise<{ uid: string; legacyUserId: string }> {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw new AccessDeniedError('Authentication required.', 401);
  const decoded = await getFirebaseAdminAuth().verifyIdToken(token);
  // The users document is usually keyed by uid; a few older ones are keyed otherwise and found by
  // email, exactly as AuthProvider does. Only needed to carry over pre-existing theme choices.
  let legacyUserId = decoded.uid;
  const byUid = await getFirebaseAdminFirestore().collection('users').doc(decoded.uid).get();
  if (!byUid.exists && decoded.email) {
    const byEmail = await getFirebaseAdminFirestore().collection('users').where('email', '==', decoded.email.toLowerCase()).limit(1).get();
    if (!byEmail.empty) legacyUserId = byEmail.docs[0].id;
  }
  return { uid: decoded.uid, legacyUserId };
}

export interface AdminCaller {
  context: AccessRequestContext;
  rights: AppearanceAdminRights;
  actor: AppearanceActor;
}

/** Resolve the caller's full effective access (roles, additive grants) into appearance rights. */
export async function adminCaller(request: Request): Promise<AdminCaller> {
  const context = await authenticateAccess(request);
  const rights = appearanceAdminRights(checkerFor(context.access));
  return { context, rights, actor: { userId: context.userId, userName: context.userName, userEmail: context.userEmail } };
}

export function requireRight(rights: AppearanceAdminRights, right: keyof AppearanceAdminRights, what: string) {
  if (!rights[right]) throw new AccessDeniedError(`You do not have permission to ${what}.`);
}

export function errorResponse(error: unknown) {
  const { message, status } = accessErrorResponse(error);
  if (status >= 500) console.error('[appearance]', error);
  return NextResponse.json({ error: message }, { status });
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    throw new AccessDeniedError('The request body must be JSON.', 400);
  }
}

/** Every company appearance change lands in the audit log the Audit Logs screen already reads. */
export async function auditAppearance(request: Request, caller: AdminCaller, action: string, details: Record<string, unknown>) {
  await logServerActivity({
    userId: caller.actor.userId,
    userName: caller.actor.userName,
    userEmail: caller.actor.userEmail ?? undefined,
    module: 'Settings',
    action,
    details: { area: 'Appearance', ...details },
    source: 'api',
    ...requestProvenance(request),
  });
}

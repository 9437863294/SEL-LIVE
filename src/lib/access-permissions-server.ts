import 'server-only';

/**
 * Keeps `userPermissions/{authUid}` — the resolved permissions the Firestore rules read — in step
 * with the access the API routes resolve. See `access-rules-permissions.ts` for why the document
 * exists and what it holds.
 *
 * When it is written:
 *   - at every app load, for the signed-in user (`POST /api/access/sync-permissions`, self);
 *   - after Access Management changes a role, a grant or a scope rule (same route, named users or
 *     everyone), so a change applies without waiting for the people affected to reload;
 *   - in bulk from the backfill script, for everyone at once.
 *
 * A deactivated user's document is rewritten with no permissions rather than deleted, so a rule
 * that reads it sees "holds nothing" instead of a missing document.
 */

import { FieldValue, type WriteBatch } from 'firebase-admin/firestore';
import { getFirebaseAdminAuth, getFirebaseAdminFirestore } from './firebase-admin';
import {
  AccessDeniedError,
  authenticateUserById,
  forgetAccessConfig,
  type AccessRequestContext,
} from './access-control-server';
import { buildUserPermissionsDoc, USER_PERMISSIONS_COLLECTION } from './access-rules-permissions';

/** Firestore batches cap at 500 writes. */
const BATCH_LIMIT = 400;

function docFromContext(context: AccessRequestContext) {
  return buildUserPermissionsDoc({
    userDocId: context.userId,
    permissions: context.permissions,
    roleNames: context.roleNames,
    projectIds: context.projectIds,
    departmentIds: context.departmentIds,
    active: true,
  });
}

function inactiveDoc(userDocId: string) {
  return buildUserPermissionsDoc({
    userDocId,
    permissions: {},
    roleNames: [],
    projectIds: [],
    departmentIds: [],
    active: false,
  });
}

/** Write the caller's own document from a context the route has already resolved. */
export async function syncOwnPermissions(context: AccessRequestContext): Promise<void> {
  if (!context.authUid) throw new Error('syncOwnPermissions needs a token-verified context');
  await getFirebaseAdminFirestore()
    .collection(USER_PERMISSIONS_COLLECTION)
    .doc(context.authUid)
    .set({ ...docFromContext(context), updatedAt: FieldValue.serverTimestamp() });
}

/**
 * The auth uid each `users` document signs in as: its own id for nearly every user, otherwise the
 * Firebase account with the same email. Users with no sign-in account are left out — nothing they
 * do reaches the rules.
 */
async function authUidsFor(userDocs: { id: string; email: string }[]): Promise<Map<string, string>> {
  const auth = getFirebaseAdminAuth();
  const byUid = new Set<string>();
  const byEmail = new Map<string, string>();
  let pageToken: string | undefined;
  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const account of page.users) {
      byUid.add(account.uid);
      if (account.email) byEmail.set(account.email.toLowerCase(), account.uid);
    }
    pageToken = page.pageToken;
  } while (pageToken);

  const out = new Map<string, string>();
  for (const user of userDocs) {
    if (byUid.has(user.id)) out.set(user.id, user.id);
    else if (user.email && byEmail.has(user.email.toLowerCase())) out.set(user.id, byEmail.get(user.email.toLowerCase())!);
  }
  return out;
}

export interface SyncSummary {
  written: number;
  inactive: number;
  skippedNoAccount: number;
  removedOrphans: number;
}

/**
 * Rewrite the documents for the given `users` ids, or for everybody when `userDocIds` is omitted.
 * Documents left behind by accounts that no longer map to any user are removed in the full run.
 */
export async function syncUserPermissions(userDocIds?: string[]): Promise<SyncSummary> {
  const firestore = getFirebaseAdminFirestore();
  // A full run follows a role or scope-rule change; resolve against those as saved, not as cached.
  if (!userDocIds) forgetAccessConfig();
  const users = userDocIds
    ? (await Promise.all(userDocIds.map((id) => firestore.collection('users').doc(id).get()))).filter((s) => s.exists)
    : (await firestore.collection('users').get()).docs;
  const uids = await authUidsFor(users.map((s) => ({ id: s.id, email: String(s.get('email') || '') })));

  const writes: { uid: string; data: Record<string, unknown> }[] = [];
  let inactive = 0;
  for (const user of users) {
    const uid = uids.get(user.id);
    if (!uid) continue;
    try {
      const context = await authenticateUserById(user.id);
      writes.push({ uid, data: docFromContext(context) as unknown as Record<string, unknown> });
    } catch (error) {
      if (!(error instanceof AccessDeniedError)) throw error;
      inactive++;
      writes.push({ uid, data: inactiveDoc(user.id) as unknown as Record<string, unknown> });
    }
  }

  let removedOrphans = 0;
  const deletes: string[] = [];
  if (!userDocIds) {
    const live = new Set(writes.map((w) => w.uid));
    const existing = await firestore.collection(USER_PERMISSIONS_COLLECTION).select().get();
    for (const doc of existing.docs) if (!live.has(doc.id)) deletes.push(doc.id);
    removedOrphans = deletes.length;
  }

  const ops = [
    ...writes.map((w) => (batch: WriteBatch) =>
      batch.set(firestore.collection(USER_PERMISSIONS_COLLECTION).doc(w.uid), { ...w.data, updatedAt: FieldValue.serverTimestamp() })),
    ...deletes.map((uid) => (batch: WriteBatch) =>
      batch.delete(firestore.collection(USER_PERMISSIONS_COLLECTION).doc(uid))),
  ];
  for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
    const batch = firestore.batch();
    for (const op of ops.slice(i, i + BATCH_LIMIT)) op(batch);
    await batch.commit();
  }

  return { written: writes.length, inactive, skippedNoAccount: users.length - uids.size, removedOrphans };
}

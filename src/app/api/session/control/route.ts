/**
 * The session controller: every write that ends somebody's session, and the session policy itself.
 *
 * Runs on the Admin SDK so it does not depend on what the console Firestore rules allow a browser
 * to write in `userSessions` — ending another person's session is exactly the write a client should
 * not be trusted with. Every action that ends a session is written to `userLogs`.
 *
 * Permissions (`Settings.Session Management`):
 *   - anyone signed in: `enforce` (own sessions), `terminate` of own sessions, `terminate-others`
 *   - `Delete`: terminate anybody's session, `terminate-user`, `terminate-all`, `sweep-stale`
 *   - `Edit` or `Delete`: `update-policy`. `Delete` is accepted because it is what every current
 *     session administrator already holds; `Edit` did not exist before the policy did.
 */

import { NextResponse } from 'next/server';
import { FieldValue, type Firestore, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import {
  AccessDeniedError,
  accessErrorResponse,
  authenticateAccess,
  type AccessRequestContext,
} from '@/lib/access-control-server';
import { checkerFor } from '@/lib/access-control';
import { getFirebaseAdminAuth, getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import { logServerActivity, requestProvenance } from '@/lib/activity-logger-server';
import {
  SESSION_POLICY_DOC,
  SWEEP_INTERVAL_MS,
  normalizeSessionPolicy,
  sessionsToEnforce,
  sessionsToSweep,
  type SessionLike,
  type SessionPolicy,
} from '@/lib/session-policy';

export const runtime = 'nodejs';

const SESSIONS = 'userSessions';
const RESOURCE = 'Settings.Session Management';
/** Firestore batches cap at 500 writes. */
const BATCH_LIMIT = 450;

type Terminator = 'user' | 'admin' | 'timeout' | 'policy';

function toMs(value: unknown): number | null {
  if (value && typeof value === 'object' && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  return null;
}

function asSessionLike(d: QueryDocumentSnapshot): SessionLike {
  const data = d.data();
  return {
    id: d.id,
    userId: String(data.userId || ''),
    startedMs: toMs(data.startedAt),
    lastActiveMs: toMs(data.lastActiveAt),
  };
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function readPolicy(db: Firestore): Promise<SessionPolicy> {
  const snap = await db.collection(SESSION_POLICY_DOC.collection).doc(SESSION_POLICY_DOC.id).get();
  return normalizeSessionPolicy(snap.exists ? snap.data() : null);
}

/** End the given sessions, skipping any already ended. Returns the ones actually ended. */
async function endSessions(
  db: Firestore,
  targets: Map<string, Terminator>,
  actor: { userId: string | null; userName: string | null },
): Promise<string[]> {
  if (targets.size === 0) return [];
  const ids = [...targets.keys()];
  const ended: string[] = [];
  for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
    const chunk = ids.slice(i, i + BATCH_LIMIT);
    const snaps = await db.getAll(...chunk.map((id) => db.collection(SESSIONS).doc(id)));
    const batch = db.batch();
    const before = ended.length;
    for (const snap of snaps) {
      if (!snap.exists || snap.data()?.isActive !== true) continue;
      batch.update(snap.ref, {
        isActive: false,
        terminatedAt: FieldValue.serverTimestamp(),
        terminatedBy: targets.get(snap.id),
        terminatedByUserId: actor.userId,
        terminatedByUserName: actor.userName,
      });
      ended.push(snap.id);
    }
    if (ended.length > before) await batch.commit();
  }
  return ended;
}

async function activeSessions(db: Firestore, userId?: string): Promise<QueryDocumentSnapshot[]> {
  let q = db.collection(SESSIONS).where('isActive', '==', true);
  if (userId) q = q.where('userId', '==', userId);
  return (await q.get()).docs;
}

/** Sweep everyone's stale and over-age sessions. Records `lastSweepAt` so automatic sweeps throttle. */
async function sweep(db: Firestore, policy: SessionPolicy, protectSessionId: string | null): Promise<string[]> {
  const docs = await activeSessions(db);
  const targets = sessionsToSweep(docs.map(asSessionLike), Date.now(), policy, protectSessionId);
  const ended = await endSessions(db, targets, { userId: null, userName: 'Session policy' });
  await db
    .collection(SESSION_POLICY_DOC.collection)
    .doc(SESSION_POLICY_DOC.id)
    .set({ lastSweepAt: FieldValue.serverTimestamp() }, { merge: true });
  return ended;
}

function audit(
  request: Request,
  ctx: AccessRequestContext,
  action: string,
  details: Record<string, unknown>,
) {
  void logServerActivity({
    userId: ctx.userId,
    userName: ctx.userName,
    userEmail: ctx.userEmail ?? undefined,
    module: 'Session Management',
    action,
    details,
    source: 'api',
    ...requestProvenance(request),
  });
}

async function revokeTokens(userIds: Iterable<string>) {
  const auth = getFirebaseAdminAuth();
  await Promise.all(
    [...new Set(userIds)].map((uid) =>
      auth.revokeRefreshTokens(uid).catch((err) => {
        // The Firestore termination is the primary mechanism; a user without an Auth record (or a
        // transient failure) must not fail the whole request.
        console.warn('[session-control] revokeRefreshTokens failed for', uid, err?.message || err);
      }),
    ),
  );
}

export async function GET(request: Request) {
  try {
    await authenticateAccess(request);
    const policy = await readPolicy(getFirebaseAdminFirestore());
    return NextResponse.json({ ok: true, policy, terminated: 0 });
  } catch (error) {
    const { message, status } = accessErrorResponse(error);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await authenticateAccess(request);
    const can = checkerFor(ctx.access);
    const canManage = can('Delete', RESOURCE);
    const canEditPolicy = canManage || can('Edit', RESOURCE);
    const requireManage = () => {
      if (!canManage) throw new AccessDeniedError(`Delete permission on ${RESOURCE} is required.`);
    };

    const body = await request.json().catch(() => ({}));
    const action = str(body?.action);
    const currentSessionId = str(body?.currentSessionId) || null;
    const db = getFirebaseAdminFirestore();
    const actor = { userId: ctx.userId, userName: ctx.userName };
    let policy = await readPolicy(db);

    switch (action) {
      /* Run at every sign-in: apply the policy to the caller's own sessions. */
      case 'enforce': {
        const own = await activeSessions(db, ctx.userId);
        const targets = sessionsToEnforce(own.map(asSessionLike), currentSessionId, Date.now(), policy);
        const ended = await endSessions(db, targets, { userId: null, userName: 'Session policy' });
        if (ended.length) {
          audit(request, ctx, 'Session Policy Enforced', { sessionIds: ended, currentSessionId });
        }

        let swept = 0;
        const sweepDue = !policy.lastSweepAt || Date.now() - policy.lastSweepAt > SWEEP_INTERVAL_MS;
        if (policy.autoSweepStale && sweepDue) {
          const sweptIds = await sweep(db, policy, currentSessionId);
          swept = sweptIds.length;
          if (swept) {
            void logServerActivity({
              userId: 'system',
              userName: 'System',
              module: 'Session Management',
              action: 'Auto Sweep Stale Sessions',
              details: { sessionIds: sweptIds, count: swept },
              source: 'server',
            });
          }
        }

        return NextResponse.json({
          ok: true,
          policy,
          terminated: ended.length + swept,
          currentTerminated: currentSessionId ? ended.includes(currentSessionId) : false,
        });
      }

      /* End specific sessions. Own sessions need no permission; anyone else's needs Delete. */
      case 'terminate': {
        const ids: string[] = Array.isArray(body?.sessionIds)
          ? [...new Set<string>(body.sessionIds.map(str).filter(Boolean))].slice(0, 500)
          : [];
        if (!ids.length) return NextResponse.json({ error: 'sessionIds is required' }, { status: 400 });
        const snaps = await db.getAll(...ids.map((id) => db.collection(SESSIONS).doc(id)));
        const foreign = snaps.some((s) => s.exists && s.data()?.userId !== ctx.userId);
        if (foreign) requireManage();
        const targets = new Map<string, Terminator>();
        for (const s of snaps) {
          if (!s.exists) continue;
          targets.set(s.id, s.data()?.userId === ctx.userId ? 'user' : 'admin');
        }
        const ended = await endSessions(db, targets, actor);
        audit(request, ctx, 'Terminate Sessions', {
          sessionIds: ended,
          users: [...new Set(snaps.filter((s) => ended.includes(s.id)).map((s) => s.data()?.userEmail || s.data()?.userId))],
        });
        return NextResponse.json({ ok: true, policy, terminated: ended.length });
      }

      /* Sign one person out everywhere, including tokens on devices that are offline. */
      case 'terminate-user': {
        const userId = str(body?.userId);
        if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 });
        const isSelf = userId === ctx.userId;
        if (!isSelf) requireManage();
        const docs = await activeSessions(db, userId);
        const targets = new Map<string, Terminator>();
        for (const d of docs) {
          if (isSelf && d.id === currentSessionId) continue;
          targets.set(d.id, isSelf ? 'user' : 'admin');
        }
        const ended = await endSessions(db, targets, actor);
        // Revoking refresh tokens signs out every device the person has, the current one included,
        // so it is only done when signing *someone else* out everywhere.
        if (!isSelf) await revokeTokens([userId]);
        audit(request, ctx, 'Sign Out User Everywhere', {
          targetUserId: userId,
          targetUser: docs[0]?.data()?.userEmail ?? null,
          sessionIds: ended,
          tokensRevoked: !isSelf,
        });
        return NextResponse.json({ ok: true, policy, terminated: ended.length });
      }

      /* "Sign out my other devices". */
      case 'terminate-others': {
        if (!currentSessionId) return NextResponse.json({ error: 'currentSessionId is required' }, { status: 400 });
        const docs = await activeSessions(db, ctx.userId);
        const targets = new Map<string, Terminator>();
        for (const d of docs) if (d.id !== currentSessionId) targets.set(d.id, 'user');
        const ended = await endSessions(db, targets, actor);
        if (ended.length) audit(request, ctx, 'Sign Out Other Devices', { sessionIds: ended, keptSessionId: currentSessionId });
        return NextResponse.json({ ok: true, policy, terminated: ended.length });
      }

      /* Emergency: sign out everybody except the caller's own current session. */
      case 'terminate-all': {
        requireManage();
        const docs = await activeSessions(db);
        const targets = new Map<string, Terminator>();
        const users = new Set<string>();
        for (const d of docs) {
          if (d.id === currentSessionId) continue;
          const uid = String(d.data().userId || '');
          targets.set(d.id, uid === ctx.userId ? 'user' : 'admin');
          if (uid && uid !== ctx.userId) users.add(uid);
        }
        const ended = await endSessions(db, targets, actor);
        await revokeTokens(users);
        audit(request, ctx, 'Sign Out All Sessions', { count: ended.length, users: users.size });
        return NextResponse.json({ ok: true, policy, terminated: ended.length });
      }

      case 'sweep-stale': {
        requireManage();
        const ended = await sweep(db, policy, currentSessionId);
        audit(request, ctx, 'Sweep Stale Sessions', { sessionIds: ended, count: ended.length });
        policy = await readPolicy(db);
        return NextResponse.json({ ok: true, policy, terminated: ended.length });
      }

      case 'update-policy': {
        if (!canEditPolicy) throw new AccessDeniedError(`Edit permission on ${RESOURCE} is required.`);
        const next = normalizeSessionPolicy({ ...policy, ...(body?.policy ?? {}) });
        const { updatedAt: _u, updatedByName: _n, lastSweepAt: _l, ...fields } = next;
        await db
          .collection(SESSION_POLICY_DOC.collection)
          .doc(SESSION_POLICY_DOC.id)
          .set(
            { ...fields, updatedAt: FieldValue.serverTimestamp(), updatedByUserId: ctx.userId, updatedByName: ctx.userName },
            { merge: true },
          );
        audit(request, ctx, 'Update Session Policy', { before: policy, after: fields });
        policy = await readPolicy(db);
        return NextResponse.json({ ok: true, policy, terminated: 0 });
      }

      default:
        return NextResponse.json({ error: `Unknown action "${action}"` }, { status: 400 });
    }
  } catch (error) {
    const { message, status } = accessErrorResponse(error);
    return NextResponse.json({ error: message }, { status });
  }
}

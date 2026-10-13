/**
 * Refreshes `userPermissions/{authUid}`, the resolved permissions the Firestore rules read.
 *
 *   { scope: 'self' }                 — the caller's own document. Any signed-in user; called by
 *                                       AuthProvider at every app load, so a role or grant change
 *                                       reaches the rules no later than the person's next visit.
 *   { scope: 'users', userIds: [...] } — named users, after Access Management changes their grant.
 *   { scope: 'all' }                  — everybody, after a role or a scope rule changes.
 *
 * The browser never chooses what goes into the document: it is always resolved here, from the same
 * roles, grants and scope rules every API route authorises against.
 */

import { NextResponse } from 'next/server';
import {
  AccessDeniedError,
  accessErrorResponse,
  authenticateAccess,
} from '@/lib/access-control-server';
import { canAssignAccess, canManageRoles, canRevokeAccess, checkerFor } from '@/lib/access-control';
import { syncOwnPermissions, syncUserPermissions } from '@/lib/access-permissions-server';

export const runtime = 'nodejs';

const MAX_NAMED_USERS = 500;

export async function POST(request: Request) {
  try {
    const context = await authenticateAccess(request);
    const body = (await request.json().catch(() => ({}))) as { scope?: unknown; userIds?: unknown };
    const scope = body?.scope === 'users' || body?.scope === 'all' ? body.scope : 'self';

    if (scope === 'self') {
      await syncOwnPermissions(context);
      return NextResponse.json({ ok: true, scope });
    }

    const can = checkerFor(context.access);
    // Named users may also be refreshed by the two kinds of administrator who change someone's access
    // without Assign or Manage Roles: revoke-only administrators (remove, suspend, deactivate) and
    // User Management editors (base role). The refresh only re-derives what the server already holds.
    const mayRefreshNamed = scope === 'users'
      && (canRevokeAccess(can) || can('Edit', 'Settings.User Management'));
    if (!canManageRoles(can) && !canAssignAccess(can) && !mayRefreshNamed) {
      throw new AccessDeniedError('Refreshing other people’s permissions requires Access Management rights.');
    }

    if (scope === 'users') {
      const userIds = Array.isArray(body.userIds)
        ? [...new Set(body.userIds.filter((id): id is string => typeof id === 'string' && id.trim() !== '').map((id) => id.trim()))]
        : [];
      if (!userIds.length) return NextResponse.json({ error: 'userIds is required' }, { status: 400 });
      if (userIds.length > MAX_NAMED_USERS) {
        return NextResponse.json({ error: `At most ${MAX_NAMED_USERS} users at a time` }, { status: 400 });
      }
      return NextResponse.json({ ok: true, scope, ...(await syncUserPermissions(userIds)) });
    }

    return NextResponse.json({ ok: true, scope, ...(await syncUserPermissions()) });
  } catch (error) {
    const { message, status } = accessErrorResponse(error);
    return NextResponse.json({ error: message }, { status });
  }
}

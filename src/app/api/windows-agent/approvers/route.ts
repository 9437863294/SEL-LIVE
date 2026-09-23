import {
  accessErrorResponse,
  authenticateAccess,
  requireAccess,
} from '@/lib/access-control-server';
import {
  normalizeUserAccessGrant,
  resolveEffectiveAccess,
  type RoleLike,
  type ScopeGrantConfig,
} from '@/lib/access-control';
import { getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import { WINDOWS_AGENT_RESOURCES, listAgentApprovers } from '@/lib/windows-agent-permissions';

export const runtime = 'nodejs';

/**
 * GET /api/windows-agent/approvers
 *
 * Who can approve closing the agent, removing it, or stopping its service — all three of which
 * check `Windows Agent / Devices / Edit`.
 *
 * ── Why this is a route and not a query in the browser ────────────────────────────────────────
 *
 * Answering it means reading every user, every role and every access grant. A Windows Agent
 * administrator is frequently *not* an access administrator, so those reads are refused to them
 * by the Firestore rules — the screen would work for two people in the company and fail for the
 * ones who need it. Resolving it here with the Admin SDK also means the browser receives a list
 * of names rather than the organisation's whole permission graph.
 *
 * Gated on `Devices / View`: anybody who can see the fleet can see who administers it. It is not
 * gated on `Devices / Edit`, deliberately — the person who most needs this list is the one who
 * does *not* hold the permission and has to find somebody who does.
 */
export async function GET(request: Request) {
  try {
    const context = await authenticateAccess(request);
    requireAccess(context, WINDOWS_AGENT_RESOURCES.devices, 'View');

    const firestore = getFirebaseAdminFirestore();
    const [usersSnapshot, rolesSnapshot, grantsSnapshot, scopeSnapshot] = await Promise.all([
      firestore.collection('users').get(),
      firestore.collection('roles').get(),
      firestore.collection('accessGrants').get(),
      // Optional: an installation that has never opened Access Management has none, and a
      // missing collection must not fail the request.
      firestore.collection('accessScopeGrants').get().catch(() => null),
    ]);

    const roles = rolesSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as RoleLike);
    const scopeGrants =
      scopeSnapshot?.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as ScopeGrantConfig) ?? [];

    const grants = new Map<string, Record<string, unknown>>();
    for (const doc of grantsSnapshot.docs) grants.set(doc.id, doc.data() as Record<string, unknown>);

    const users = usersSnapshot.docs.map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      return {
        id: doc.id,
        name: typeof data.name === 'string' ? data.name : null,
        email: typeof data.email === 'string' ? data.email : null,
        departmentName: typeof data.department === 'string' ? data.department : null,
        status: typeof data.status === 'string' ? data.status : 'Active',
        role: typeof data.role === 'string' ? data.role : '',
      };
    });

    const accessByUserId: Record<string, ReturnType<typeof resolveEffectiveAccess>> = {};
    for (const user of users) {
      accessByUserId[user.id] = resolveEffectiveAccess({
        user: {
          id: user.id,
          name: user.name ?? '',
          email: user.email ?? '',
          role: user.role,
          status: user.status,
        },
        roles,
        grant: normalizeUserAccessGrant(user.id, grants.get(user.id) ?? null),
        scopeGrants,
      });
    }

    const approvers = listAgentApprovers(users, accessByUserId);

    // Which roles carry the permission, because "grant a role that has Devices / Edit" is not an
    // instruction anybody can act on without first knowing which role that is. On this
    // installation the answer is "Office Work Agent Admin", and finding that out meant reading
    // twenty-eight role documents.
    const carryingRoles = roles
      .filter((role) => {
        const actions = (role as { permissions?: Record<string, string[]> }).permissions?.[
          WINDOWS_AGENT_RESOURCES.devices
        ];
        return Array.isArray(actions) && actions.includes('Edit');
      })
      .map((role) => String((role as { name?: string }).name || role.id))
      .sort((left, right) => left.localeCompare(right));

    return Response.json(
      {
        approvers,
        // So the screen can say "nobody can approve" as a finding rather than as an empty table.
        total: approvers.length,
        permission: `${WINDOWS_AGENT_RESOURCES.devices} / Edit`,
        carryingRoles,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const { message, status } = accessErrorResponse(error);
    return Response.json({ error: message }, { status });
  }
}

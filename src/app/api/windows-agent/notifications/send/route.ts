import { accessErrorResponse, authenticateAccess, requireAccess } from '@/lib/access-control-server';
import { WINDOWS_AGENT_RESOURCES } from '@/lib/windows-agent-permissions';
import { raiseAgentNotification } from '@/lib/windows-agent-notifications';
import type { AgentNotificationTarget } from '@/lib/windows-agent-model';

export const runtime = 'nodejs';

/**
 * POST /api/windows-agent/notifications/send
 *
 * §38's targeting, from the admin screens. The only notification route a *browser* calls; the
 * agent's own routes are device-authenticated and can only fetch and acknowledge.
 *
 * ── Why this is a route and not a client-side Firestore write ──────────────────────────────────
 *
 * Raising a notification means resolving a target to concrete recipients and then writing a
 * receipt for each one — potentially four hundred documents. Doing that from the browser would
 * need every user able to send an alert to also hold write access to `windowsNotificationReceipts`,
 * which is the collection the delivery report is computed from. Behind an Admin-SDK route, the
 * rules can keep receipts read-only to every browser, and the §39 statistics cannot be edited by
 * the person whose broadcast they measure.
 *
 * ── Broadcast is a separate permission, checked separately ─────────────────────────────────────
 *
 * `Send` covers a person, a role or a department. `Send Broadcast` is required for "everybody",
 * because a message to the whole company cannot be recalled once it has appeared on four hundred
 * desktops. The check is here rather than only in the UI: a hidden button is not a control.
 */
export async function POST(request: Request) {
  try {
    const context = await authenticateAccess(request);
    requireAccess(context, WINDOWS_AGENT_RESOURCES.notifications, 'Send');

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return Response.json({ error: 'A JSON body is required.' }, { status: 400 });

    const target = (body.target ?? {}) as AgentNotificationTarget;
    if (target.allEmployees) {
      requireAccess(context, WINDOWS_AGENT_RESOURCES.notifications, 'Send Broadcast');
    }

    const result = await raiseAgentNotification({
      type: (body.type as never) ?? 'ANNOUNCEMENT',
      priority: (body.priority as never) ?? 'NORMAL',
      title: String(body.title || ''),
      message: String(body.message || ''),
      deepLink: typeof body.deepLink === 'string' ? body.deepLink : null,
      actions: Array.isArray(body.actions) ? (body.actions as never) : [],
      target,
      module: String(body.module || 'Windows Agent'),
      itemId: typeof body.itemId === 'string' ? body.itemId : null,
      itemRef: typeof body.itemRef === 'string' ? body.itemRef : null,
      startAt: typeof body.startAt === 'string' ? body.startAt : undefined,
      expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : null,
      requireAcknowledgement: body.requireAcknowledgement === true,
      actor: { userId: context.userId, userName: context.userName },
    });

    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const { message, status } = accessErrorResponse(error);
    return Response.json({ error: message }, { status });
  }
}

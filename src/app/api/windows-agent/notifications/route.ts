import { agentErrorResponse, authenticateDevice, resolveAgentUser } from '@/lib/windows-agent-server';
import {
  fetchPendingNotifications,
  recordNotificationReceipt,
} from '@/lib/windows-agent-notifications';

export const runtime = 'nodejs';

/**
 * GET /api/windows-agent/notifications
 *
 * What this user's agent should show next. The heartbeat tells it *that* something is waiting;
 * this returns the content.
 *
 * Fetching marks each receipt `DELIVERED` — the notification has reached the machine, whether or
 * not the toast has appeared yet. That distinction matters for §39's report: `DELIVERED` means the
 * server did its job, `DISPLAYED` means Windows did, and `CLICKED` means the person did. Rolling
 * them together would hide the case worth finding, which is a PC that is fetching notifications
 * and never showing them.
 *
 * A POST rather than a bare GET would be more honest about the write, but the agent's retry logic
 * treats GET as safe to repeat — and repeating is safe here, because the receipt update refuses to
 * move backwards or to double-count.
 */
export async function GET(request: Request) {
  try {
    const authenticated = await authenticateDevice(request);
    const idToken =
      request.headers.get('x-sel-id-token')?.trim() ||
      (request.headers.get('authorization') || '').replace(/^Bearer /, '').trim();

    const user = await resolveAgentUser(idToken);
    const pending = await fetchPendingNotifications({ userId: user.userId });

    // Best-effort, and deliberately not awaited as a group failure: one receipt that will not
    // update must not cost the user the other nine notifications.
    await Promise.all(
      pending.map((entry) =>
        recordNotificationReceipt({
          notificationId: entry.id,
          userId: user.userId,
          deviceId: authenticated.device.id,
          status: 'DELIVERED',
        }).catch(() => null),
      ),
    );

    return Response.json(
      { notifications: pending },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const { body, status } = agentErrorResponse(error);
    return Response.json(body, { status });
  }
}

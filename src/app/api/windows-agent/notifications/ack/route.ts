import { agentErrorResponse, authenticateDevice, resolveAgentUser } from '@/lib/windows-agent-server';
import { recordNotificationReceipt } from '@/lib/windows-agent-notifications';
import type { NotificationReceiptStatus } from '@/lib/windows-agent-model';

export const runtime = 'nodejs';

/**
 * POST /api/windows-agent/notifications/ack
 *
 * §39's lifecycle, reported from the desktop: the toast appeared, was clicked, was snoozed, was
 * dismissed, or failed to display.
 *
 * Only the statuses an agent can legitimately witness are accepted. `CREATED`, `SENT` and
 * `EXPIRED` are the server's to set — an agent asserting `EXPIRED` would be reporting on a
 * decision it does not make, and accepting it would let a buggy client quietly clear its own
 * backlog and make the delivery report say everything arrived.
 */
const AGENT_REPORTABLE = new Set<NotificationReceiptStatus>([
  'DISPLAYED',
  'CLICKED',
  'ACKNOWLEDGED',
  'SNOOZED',
  'DISMISSED',
  'FAILED',
]);

export async function POST(request: Request) {
  try {
    const authenticated = await authenticateDevice(request);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return Response.json({ error: 'A JSON body is required.' }, { status: 400 });

    const notificationId = String(body.notificationId || '').trim();
    const status = String(body.status || '') as NotificationReceiptStatus;
    if (!notificationId) {
      return Response.json({ error: 'notificationId is required.' }, { status: 400 });
    }
    if (!AGENT_REPORTABLE.has(status)) {
      return Response.json({ error: `An agent cannot report "${status}".` }, { status: 400 });
    }

    const user = await resolveAgentUser(String(body.idToken || ''));
    const result = await recordNotificationReceipt({
      notificationId,
      userId: user.userId,
      deviceId: authenticated.device.id,
      status,
      snoozeMinutes: Number(body.snoozeMinutes) || undefined,
      failureReason: typeof body.failureReason === 'string' ? body.failureReason : null,
    });

    // `applied: false` is a normal outcome, not an error — it means the receipt already held this
    // status or a later one. The agent treats it as success and drops the item from its queue.
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const { body, status } = agentErrorResponse(error);
    return Response.json(body, { status });
  }
}

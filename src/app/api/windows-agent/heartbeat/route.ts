import {
  agentErrorResponse,
  authenticateDevice,
  recordHeartbeat,
  resolveAgentUser,
} from '@/lib/windows-agent-server';
import { fetchPendingNotifications } from '@/lib/windows-agent-notifications';
import type { AgentHeartbeatInput, HeartbeatResult } from '@/lib/windows-agent-model';

export const runtime = 'nodejs';

/**
 * POST /api/windows-agent/heartbeat
 *
 * §16's liveness beat, and — because an office PC behind NAT cannot be connected to — the module's
 * only server→agent channel. So the response carries rather more than an acknowledgement: the
 * effective policy (a change reaches a PC within one interval, with no restart), any pending
 * directives from the device page, the ids of notifications waiting to be shown, and an update
 * offer if one applies to this device's ring.
 *
 * The user token is optional. A PC sitting at the access gate with nobody signed in still beats,
 * and still needs its policy and its directives — that is precisely the state in which an
 * administrator most wants to be able to reach it.
 */
export async function POST(request: Request) {
  try {
    const authenticated = await authenticateDevice(request);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return Response.json({ error: 'A JSON body is required.' }, { status: 400 });

    const idToken = String(body.idToken || '');
    // A stale token must not break the beat — it means the session needs refreshing, not that the
    // machine has stopped existing. The agent sees an empty notification list and re-authenticates.
    const user = idToken ? await resolveAgentUser(idToken).catch(() => null) : null;

    const input: AgentHeartbeatInput = {
      sessionId: typeof body.sessionId === 'string' ? body.sessionId : null,
      sentAt: String(body.sentAt || new Date().toISOString()),
      presence: (body.presence as AgentHeartbeatInput['presence']) || 'ACTIVE',
      processName: typeof body.processName === 'string' ? body.processName : null,
      applicationName: typeof body.applicationName === 'string' ? body.applicationName : null,
      agentVersion: String(body.agentVersion || authenticated.agentVersion || 'unknown'),
      queuedSpanCount: Number(body.queuedSpanCount) || 0,
      idleSeconds: Number(body.idleSeconds) || 0,
    };

    const outcome = await recordHeartbeat({
      device: authenticated.device,
      user,
      input,
      ipAddress: authenticated.ipAddress,
    });

    const pending = user ? await fetchPendingNotifications({ userId: user.userId }) : [];

    const result: HeartbeatResult = {
      serverTime: outcome.serverTime,
      policy: outcome.policy,
      directives: outcome.directives,
      pendingNotificationIds: pending.map((entry) => entry.id),
      availableVersion: outcome.availableVersion,
    };

    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const { body, status } = agentErrorResponse(error);
    return Response.json(body, { status });
  }
}

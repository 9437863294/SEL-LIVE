import { getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import {
  agentErrorResponse,
  authenticateDevice,
  closeSessionDocument,
  ingestActivityBatch,
  resolveAgentUser,
  resolveEffectivePolicy,
} from '@/lib/windows-agent-server';
import type { SessionEndReason } from '@/lib/windows-agent-model';

export const runtime = 'nodejs';

const END_REASONS = new Set<SessionEndReason>([
  'USER_SIGNOUT',
  'WINDOWS_LOGOFF',
  'WINDOWS_SHUTDOWN',
  'WINDOWS_RESTART',
  'ADMIN_SIGNOUT',
  'AGENT_STOPPED',
]);

/**
 * POST /api/windows-agent/session/logout
 *
 * §28's orderly close. Takes a final batch of spans alongside the end reason, because the minutes
 * between the last scheduled flush and the shutdown are real work and there is no later
 * opportunity to send them — Windows gives a service only a few seconds' notice, which is enough
 * for one request and not enough for two.
 *
 * The final spans are ingested *before* the session is closed, deliberately. Closing first would
 * set the session's end instant, and every one of those last spans would then be clamped to a
 * window that had already shut — silently discarding exactly the data this route exists to save.
 *
 * `logoutEstimated` stays false here. This is an observed sign-out, and §28 is explicit that an
 * inferred end must be distinguishable from a witnessed one; the reaper is what sets the flag.
 */
export async function POST(request: Request) {
  try {
    const authenticated = await authenticateDevice(request);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return Response.json({ error: 'A JSON body is required.' }, { status: 400 });

    const sessionId = String(body.sessionId || '').trim();
    if (!sessionId) return Response.json({ error: 'sessionId is required.' }, { status: 400 });

    const rawReason = String(body.endReason || 'USER_SIGNOUT') as SessionEndReason;
    const endReason = END_REASONS.has(rawReason) ? rawReason : 'USER_SIGNOUT';
    const endedAt = typeof body.endedAt === 'string' ? body.endedAt : new Date().toISOString();

    const finalSpans = Array.isArray(body.finalSpans) ? body.finalSpans : [];
    if (finalSpans.length) {
      const user = await resolveAgentUser(String(body.idToken || '')).catch(() => null);
      if (user) {
        const departmentIds = [user.departmentId, authenticated.device.departmentId].filter(
          (value): value is string => Boolean(value),
        );
        const policy = await resolveEffectivePolicy({
          userId: user.userId,
          deviceId: authenticated.device.id,
          departmentIds,
        });
        await ingestActivityBatch({
          sessionId,
          deviceId: authenticated.device.id,
          userId: user.userId,
          rawSpans: finalSpans,
          policy,
        }).catch((error) => {
          // A malformed final batch must not prevent the session from closing cleanly — an open
          // session is worse than a lost minute, because the reaper will later mark it unclean.
          console.error('[windows-agent] Final batch ingest failed:', error);
        });
      }
    }

    await closeSessionDocument(getFirebaseAdminFirestore(), sessionId, {
      endReason,
      endedAt,
      estimated: false,
    });

    return Response.json({ ok: true, endReason, endedAt }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const { body, status } = agentErrorResponse(error);
    return Response.json(body, { status });
  }
}

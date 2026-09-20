import {
  MAX_SPANS_PER_BATCH,
  agentErrorResponse,
  authenticateDevice,
  ingestActivityBatch,
  resolveEffectivePolicy,
  resolveAgentUser,
} from '@/lib/windows-agent-server';

export const runtime = 'nodejs';

/**
 * POST /api/windows-agent/activity/batch
 *
 * §31's batched upload — the only route that writes activity, and the reason §31 exists: the agent
 * coalesces foreground-window changes locally and ships two to five minutes of them at a time,
 * rather than writing to Firestore as focus moves.
 *
 * Two properties this route guarantees, both enforced in `ingestActivityBatch` rather than here:
 *
 *   • **A replayed batch changes nothing.** Span ids are client-generated and become the document
 *     ids, and the ingest reads which already exist before folding any counters. An agent whose
 *     network dropped after the write but before the response can — and does — send the same batch
 *     again, and the day's totals do not move.
 *
 *   • **Nothing the agent asserts is taken at face value.** Durations, categories, idle
 *     classification and the work date are all recomputed server-side, and window titles and
 *     browser domains are stripped unless the *effective policy* permits them. A tampered agent
 *     can withhold data, which shows up as a gap; it cannot manufacture active hours or capture
 *     what a policy forbids.
 */
export async function POST(request: Request) {
  try {
    const authenticated = await authenticateDevice(request);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return Response.json({ error: 'A JSON body is required.' }, { status: 400 });

    const sessionId = String(body.sessionId || '').trim();
    if (!sessionId) return Response.json({ error: 'sessionId is required.' }, { status: 400 });

    const user = await resolveAgentUser(String(body.idToken || ''));

    const departmentIds = [user.departmentId, authenticated.device.departmentId].filter(
      (value): value is string => Boolean(value),
    );
    const policy = await resolveEffectivePolicy({
      userId: user.userId,
      deviceId: authenticated.device.id,
      departmentIds,
    });

    const spans = Array.isArray(body.spans) ? body.spans : [];
    if (spans.length > MAX_SPANS_PER_BATCH) {
      return Response.json(
        { error: `A batch may carry at most ${MAX_SPANS_PER_BATCH} spans.` },
        { status: 413 },
      );
    }

    const result = await ingestActivityBatch({
      sessionId,
      deviceId: authenticated.device.id,
      userId: user.userId,
      rawSpans: spans,
      policy,
    });

    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const { body, status } = agentErrorResponse(error);
    return Response.json(body, { status });
  }
}

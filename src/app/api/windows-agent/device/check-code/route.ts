import { agentErrorResponse, checkEnrollmentCode } from '@/lib/windows-agent-server';

export const runtime = 'nodejs';

/**
 * POST /api/windows-agent/device/check-code
 *
 * Does this enrolment code work, without using it up?
 *
 * The agent's setup screen asks before it writes a configuration, so a mistyped or expired code is
 * refused while the person who can fix it is still standing at the PC. Without this the code was
 * accepted on trust, written to disk, and failed hours later in a log file nobody reads — the
 * machine sat there looking installed and never appeared in the fleet.
 *
 * Unauthenticated, like the registration route beside it, and a strictly smaller exposure: one
 * document read by id, no writes, and nothing in the response that redeeming the code would not
 * have revealed. See `checkEnrollmentCode` for why it is deliberately not audited.
 *
 * A refusal is a 403 carrying the reason — "expired", "disabled", "reached its registration limit"
 * — because those four situations need four different actions from whoever is installing.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return Response.json({ error: 'A JSON body is required.' }, { status: 400 });
    }

    const result = await checkEnrollmentCode((body as Record<string, unknown>).enrollmentCode);

    return Response.json(
      { valid: true, ...result },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const { body, status } = agentErrorResponse(error);
    return Response.json({ valid: false, ...body }, { status });
  }
}

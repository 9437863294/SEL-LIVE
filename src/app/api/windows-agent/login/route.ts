import {
  agentErrorResponse,
  authenticateDevice,
  loadWindowsAgentSettings,
  openOrResumeSession,
  resolveAgentUser,
} from '@/lib/windows-agent-server';
import { buildMorningSummary } from '@/lib/windows-agent-morning';
import type { AgentLoginResult } from '@/lib/windows-agent-model';

export const runtime = 'nodejs';

/**
 * POST /api/windows-agent/login
 *
 * §5's sign-in: the device credential and the user token together, as §40 requires. The device is
 * verified first, because a blocked PC should be told it is blocked without anybody's password
 * having been checked against it.
 *
 * Every refusal carries a `code` from `LoginRejectionCode` alongside its message. The gate branches
 * on the code — "not approved yet" polls, "blocked" stops, "not assigned" offers the IT contact —
 * and shows the message, so the wording can be improved without shipping a new agent.
 *
 * The morning summary (§6) is assembled here rather than fetched separately so that the gate has
 * everything it needs in one round trip. If those reads fail the sign-in still succeeds with zeroes
 * on the dashboard: a slow Office Hub index must never be the reason somebody cannot use their PC.
 */
export async function POST(request: Request) {
  try {
    const authenticated = await authenticateDevice(request);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return Response.json({ error: 'A JSON body is required.' }, { status: 400 });

    const user = await resolveAgentUser(String(body.idToken || ''));
    const settings = await loadWindowsAgentSettings();

    const session = await openOrResumeSession({
      user,
      device: authenticated.device,
      agentVersion: String(body.agentVersion || authenticated.agentVersion || '') || null,
      ipAddress: authenticated.ipAddress,
      offlineLogin: body.offlineLogin === true,
    });

    const morningSummary = await buildMorningSummary({
      userId: user.userId,
      userName: user.name,
      checkInAt: session.loginAt,
    });

    const result: AgentLoginResult = {
      sessionId: session.sessionId,
      userId: user.userId,
      userName: user.name,
      employeeId: user.employeeId,
      departmentName: user.departmentName,
      photoURL: user.photoURL,
      loginAt: session.loginAt,
      resumed: session.resumed,
      lateLogin: session.lateLogin,
      policy: session.policy,
      morningSummary,
    };

    return Response.json(
      { ...result, selfViewEnabled: settings.employeeSelfViewEnabled },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const { body, status } = agentErrorResponse(error);
    return Response.json(body, { status });
  }
}

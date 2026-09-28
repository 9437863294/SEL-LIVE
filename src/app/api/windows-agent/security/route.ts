import {
  agentErrorResponse,
  authenticateDevice,
  recordDeviceSecurityPosture,
} from '@/lib/windows-agent-server';

export const runtime = 'nodejs';

/**
 * POST /api/windows-agent/security
 *
 * The LocalSystem service uses this without an employee session. Device authentication proves
 * which enrolled PC reported the posture; the response is the authoritative fleet baseline and
 * any SEL LIVE-issued maintenance exception that is still inside its expiry.
 */
export async function POST(request: Request) {
  try {
    const authenticated = await authenticateDevice(request);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await recordDeviceSecurityPosture({
      device: authenticated.device,
      posture: body.posture,
      ipAddress: authenticated.ipAddress,
    });

    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const { body, status } = agentErrorResponse(error);
    return Response.json(body, { status });
  }
}


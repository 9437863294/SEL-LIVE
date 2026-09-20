import { agentErrorResponse, clientIpOf, registerDevice } from '@/lib/windows-agent-server';

export const runtime = 'nodejs';

/**
 * POST /api/windows-agent/device/register
 *
 * §45's enrolment. The one route in the module that accepts an unauthenticated caller, because a
 * PC being set up has no credential yet — the enrolment code is what stands in for one.
 *
 * That makes the code the whole of the security boundary, so it is worth being clear about what it
 * does and does not buy. A leaked code lets somebody register a machine; it does not let them see
 * anybody's data, because registration issues a device credential and nothing more, and a device
 * credential cannot open a session without a real employee signing in on it. An installation that
 * wants a second gate sets `autoApprove: false` on the code, which leaves every new machine
 * `PENDING` until an administrator approves it on the devices page.
 *
 * The response carries the device secret in clear. It is the only time it is ever transmitted; the
 * installer writes it straight into DPAPI-protected storage, and Firestore holds only a scrypt
 * hash. HTTPS is therefore not optional here in a way it merely *should* be elsewhere.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return Response.json({ error: 'A JSON body is required.' }, { status: 400 });
    }

    const result = await registerDevice(
      {
        enrollmentCode: String((body as Record<string, unknown>).enrollmentCode || ''),
        facts: (body as Record<string, unknown>).facts as never,
        agentVersion: String((body as Record<string, unknown>).agentVersion || ''),
        deviceId:
          typeof (body as Record<string, unknown>).deviceId === 'string'
            ? String((body as Record<string, unknown>).deviceId)
            : undefined,
      },
      { ipAddress: clientIpOf(request) },
    );

    return Response.json(result, {
      status: 201,
      // Belt and braces against an intermediate cache holding a device secret.
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const { body, status } = agentErrorResponse(error);
    return Response.json(body, { status });
  }
}

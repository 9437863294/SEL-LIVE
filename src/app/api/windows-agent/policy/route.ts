import {
  agentErrorResponse,
  authenticateDevice,
  loadWindowsAgentSettings,
  resolveAgentUser,
  resolveEffectivePolicy,
} from '@/lib/windows-agent-server';
import { DEFAULT_MONITORING_DISCLOSURE } from '@/lib/windows-agent';

export const runtime = 'nodejs';

/**
 * GET /api/windows-agent/policy
 *
 * The effective policy for this device, and for the user on it when one is signed in.
 *
 * The heartbeat already returns this, so the route exists for the two moments where there is no
 * heartbeat to piggyback on: the agent's cold start, before anybody has signed in and while it is
 * deciding whether to show the access gate at all; and the tray's "Agent status" panel, which
 * shows the person being monitored exactly what is in force on their machine.
 *
 * That second use is why the monitoring disclosure comes back with it. §52 asks for a page telling
 * employees what is collected, and the most useful place to say so is on the PC doing the
 * collecting — with the resolved policy beside it, so somebody can see that window titles are off
 * rather than take it on trust.
 */
export async function GET(request: Request) {
  try {
    const authenticated = await authenticateDevice(request);
    const idToken =
      request.headers.get('x-sel-id-token')?.trim() ||
      (request.headers.get('authorization') || '').replace(/^Bearer /, '').trim();

    const user = idToken ? await resolveAgentUser(idToken).catch(() => null) : null;
    const departmentIds = [user?.departmentId, authenticated.device.departmentId].filter(
      (value): value is string => Boolean(value),
    );

    const [policy, settings] = await Promise.all([
      resolveEffectivePolicy({
        userId: user?.userId ?? null,
        deviceId: authenticated.device.id,
        departmentIds,
      }),
      loadWindowsAgentSettings(),
    ]);

    return Response.json(
      {
        policy,
        device: {
          deviceId: authenticated.device.id,
          deviceName: authenticated.device.deviceName,
          status: authenticated.device.status,
          departmentName: authenticated.device.departmentName,
          assignedLocation: authenticated.device.assignedLocation,
        },
        disclosure: {
          ...DEFAULT_MONITORING_DISCLOSURE,
          // Administrator-written preamble, if there is one. The lists themselves are not editable
          // — they describe what the code does, and a policy page that could disagree with the
          // code would be worse than no policy page.
          statement: settings.monitoringPolicyText,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const { body, status } = agentErrorResponse(error);
    return Response.json(body, { status });
  }
}

import {
  agentErrorResponse,
  authenticateDevice,
  writeAudit,
} from '@/lib/windows-agent-server';
import { resolveDeviceSecurityPolicy } from '@/lib/windows-agent-security';

export const runtime = 'nodejs';

/** Tell an enrolled PC whether a protected local action requires SEL LIVE approval. */
export async function POST(request: Request) {
  try {
    const authenticated = await authenticateDevice(request);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action || '').toUpperCase();
    if (action !== 'UNINSTALL') {
      return Response.json({ error: 'Unsupported security action.' }, { status: 400 });
    }

    const policy = resolveDeviceSecurityPolicy(authenticated.device.securityPolicy);
    const blocked = policy.uninstallBlocked;
    if (!blocked) {
      await writeAudit({
        action: 'AGENT_UNINSTALL_APPROVED',
        actorId: 'device-policy',
        actorName: 'SEL LIVE device policy',
        targetType: 'device',
        targetId: authenticated.deviceId,
        targetLabel: authenticated.device.deviceName || authenticated.deviceId,
        oldValue: null,
        newValue: { uninstallBlocked: false },
        reason: 'Removal is allowed by the persistent policy assigned to this computer.',
        ipAddress: authenticated.ipAddress,
        userAgent: authenticated.agentVersion,
      });
    }

    return Response.json({ action, blocked }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const { body, status } = agentErrorResponse(error);
    return Response.json(body, { status });
  }
}

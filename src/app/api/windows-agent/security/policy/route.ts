import {
  AccessDeniedError,
  accessErrorResponse,
  authenticateAccess,
  requireAccess,
} from '@/lib/access-control-server';
import { getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import {
  WINDOWS_AGENT_COLLECTIONS,
  resolveDeviceSecurityPolicy,
  type WindowsDevice,
} from '@/lib/windows-agent';
import { WINDOWS_AGENT_RESOURCES } from '@/lib/windows-agent-permissions';
import { clientIpOf, writeAudit } from '@/lib/windows-agent-server';

export const runtime = 'nodejs';

/** Persist the security controls for one PC. The browser never writes this field directly. */
export async function POST(request: Request) {
  try {
    const actor = await authenticateAccess(request);
    requireAccess(actor, WINDOWS_AGENT_RESOURCES.devices, 'Edit');

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : '';
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
    if (!deviceId) throw new AccessDeniedError('A device is required.', 400);
    if (!reason) throw new AccessDeniedError('A reason is required for the audit log.', 400);

    const firestore = getFirebaseAdminFirestore();
    const reference = firestore.collection(WINDOWS_AGENT_COLLECTIONS.devices).doc(deviceId);
    const snapshot = await reference.get();
    if (!snapshot.exists) throw new AccessDeniedError('Device not found.', 404);

    const device = { id: snapshot.id, ...(snapshot.data() as Omit<WindowsDevice, 'id'>) };
    const previous = resolveDeviceSecurityPolicy(device.securityPolicy);
    const policy = resolveDeviceSecurityPolicy(body.policy);
    const now = new Date().toISOString();

    await reference.update({
      securityPolicy: policy,
      updatedAt: now,
      updatedBy: actor.userId,
      updatedByName: actor.userName,
    });
    await writeAudit({
      action: 'DEVICE_SECURITY_POLICY_UPDATED',
      actorId: actor.userId,
      actorName: actor.userName,
      targetType: 'device',
      targetId: device.id,
      targetLabel: device.deviceName,
      oldValue: previous,
      newValue: policy,
      reason,
      ipAddress: clientIpOf(request),
      userAgent: request.headers.get('user-agent'),
    });

    return Response.json({ policy }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      const access = accessErrorResponse(error);
      return Response.json({ error: access.message }, { status: access.status });
    }
    console.error('[windows-agent] Device security policy update failed:', error);
    return Response.json({ error: 'The device security policy could not be updated.' }, { status: 500 });
  }
}

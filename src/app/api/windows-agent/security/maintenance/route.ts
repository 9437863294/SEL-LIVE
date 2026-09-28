import { randomUUID } from 'node:crypto';

import {
  AccessDeniedError,
  accessErrorResponse,
  authenticateAccess,
  requireAccess,
} from '@/lib/access-control-server';
import { getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import {
  WINDOWS_AGENT_COLLECTIONS,
  type WindowsDevice,
  type WindowsDeviceMaintenanceAccess,
} from '@/lib/windows-agent';
import { WINDOWS_AGENT_RESOURCES } from '@/lib/windows-agent-permissions';
import { clientIpOf, writeAudit } from '@/lib/windows-agent-server';

export const runtime = 'nodejs';

const MINUTES_MIN = 5;
const MINUTES_MAX = 8 * 60;

/** Issue or revoke a time-bounded exception to the fleet device-security baseline. */
export async function POST(request: Request) {
  try {
    const actor = await authenticateAccess(request);
    requireAccess(actor, WINDOWS_AGENT_RESOURCES.devices, 'Edit');

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : '';
    const action = String(body.action || '').toUpperCase();
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
    if (!deviceId) throw new AccessDeniedError('A device is required.', 400);
    if (!reason) throw new AccessDeniedError('A maintenance reason is required for the audit log.', 400);
    if (action !== 'GRANT' && action !== 'REVOKE') {
      throw new AccessDeniedError('The maintenance action must be GRANT or REVOKE.', 400);
    }

    const firestore = getFirebaseAdminFirestore();
    const reference = firestore.collection(WINDOWS_AGENT_COLLECTIONS.devices).doc(deviceId);
    const snapshot = await reference.get();
    if (!snapshot.exists) throw new AccessDeniedError('Device not found.', 404);
    const device = { id: snapshot.id, ...(snapshot.data() as Omit<WindowsDevice, 'id'>) };
    const now = new Date();
    let maintenance: WindowsDeviceMaintenanceAccess;

    if (action === 'GRANT') {
      const requestedMinutes = Math.round(Number(body.durationMinutes) || 0);
      const durationMinutes = Math.min(MINUTES_MAX, Math.max(MINUTES_MIN, requestedMinutes));
      const requestedAccount = typeof body.windowsAccount === 'string'
        ? body.windowsAccount.trim().slice(0, 128)
        : '';
      const knownAccounts = device.securityPosture?.windowsAccounts ?? [];
      if (requestedAccount && !knownAccounts.includes(requestedAccount)) {
        throw new AccessDeniedError('That Windows account is not currently loaded on this device.', 400);
      }
      const windowsAccount = requestedAccount && knownAccounts.includes(requestedAccount)
        ? requestedAccount
        : null;
      maintenance = {
        grantId: randomUUID(),
        status: 'ACTIVE',
        grantedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + durationMinutes * 60_000).toISOString(),
        grantedBy: actor.userId,
        grantedByName: actor.userName,
        reason,
        // The first supported maintenance capability. Service/uninstall protections remain under
        // SYSTEM even during a window, so a local account never becomes unrestricted.
        allowTaskManager: true,
        windowsAccount,
        temporaryLocalAdmin: Boolean(windowsAccount),
      };

      await reference.update({
        maintenanceAccess: maintenance,
        updatedAt: now.toISOString(),
        updatedBy: actor.userId,
        updatedByName: actor.userName,
      });
      await writeAudit({
        action: 'MAINTENANCE_ACCESS_GRANTED',
        actorId: actor.userId,
        actorName: actor.userName,
        targetType: 'device',
        targetId: device.id,
        targetLabel: device.deviceName,
        oldValue: device.maintenanceAccess ?? null,
        newValue: maintenance,
        reason,
        ipAddress: clientIpOf(request),
        userAgent: request.headers.get('user-agent'),
      });
    } else {
      const current = device.maintenanceAccess;
      if (!current || current.status !== 'ACTIVE') {
        throw new AccessDeniedError('This device has no active maintenance window.', 409);
      }
      maintenance = {
        ...current,
        status: 'REVOKED',
        revokedAt: now.toISOString(),
        revokedBy: actor.userId,
        revokedByName: actor.userName,
      };
      await reference.update({
        maintenanceAccess: maintenance,
        updatedAt: now.toISOString(),
        updatedBy: actor.userId,
        updatedByName: actor.userName,
      });
      await writeAudit({
        action: 'MAINTENANCE_ACCESS_REVOKED',
        actorId: actor.userId,
        actorName: actor.userName,
        targetType: 'device',
        targetId: device.id,
        targetLabel: device.deviceName,
        oldValue: current,
        newValue: maintenance,
        reason,
        ipAddress: clientIpOf(request),
        userAgent: request.headers.get('user-agent'),
      });
    }

    return Response.json({ maintenance }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      const access = accessErrorResponse(error);
      return Response.json({ error: access.message }, { status: access.status });
    }
    console.error('[windows-agent] Maintenance access failed:', error);
    return Response.json({ error: 'Maintenance access could not be changed.' }, { status: 500 });
  }
}

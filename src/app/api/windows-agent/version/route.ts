import { getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import { WINDOWS_AGENT_COLLECTIONS } from '@/lib/windows-agent';
import { compareVersions } from '@/lib/windows-agent-rules';
import {
  agentErrorResponse,
  authenticateDevice,
  resolveEffectivePolicy,
} from '@/lib/windows-agent-server';

export const runtime = 'nodejs';

/**
 * GET /api/windows-agent/version
 *
 * §43's update check. Returns the newest stable build released to this device's ring, together
 * with the two facts the agent must verify before it runs anything: the package hash and the
 * Authenticode subject the installer has to be signed by.
 *
 * Returning both is the point. A URL alone would mean an agent that installs whatever is served
 * from it — so whoever controls that URL, or the DNS in front of it, controls code execution as
 * SYSTEM on every office PC. The agent checks the SHA-256 after download and refuses to run an
 * installer whose signature subject does not match, and this route is where it learns what to
 * expect. Neither check is worth anything if it is optional, so a version document missing either
 * field is not offered as an update at all.
 *
 * `minimumSupportedVersion` is the escape hatch for a security fix: an agent below it is told to
 * update even if its ring is `HELD`, because "this build has a vulnerability" is not a decision
 * that should wait on a staged rollout.
 */
export async function GET(request: Request) {
  try {
    const authenticated = await authenticateDevice(request);
    const firestore = getFirebaseAdminFirestore();
    const ring = authenticated.device.updateRing || 'BROAD';
    const current = authenticated.agentVersion || authenticated.device.agentVersion || '0.0.0';

    const snapshot = await firestore
      .collection(WINDOWS_AGENT_COLLECTIONS.versions)
      .where('channel', '==', 'STABLE')
      .get()
      .catch(() => null);

    if (!snapshot || snapshot.empty) {
      return Response.json({ update: null, current }, { headers: { 'Cache-Control': 'no-store' } });
    }

    let best: Record<string, unknown> | null = null;
    let forced = false;

    for (const doc of snapshot.docs) {
      const data = doc.data();
      if (data.withdrawnAt) continue;
      const version = String(data.version || doc.id);
      const packageUrl = String(data.packageUrl || '');
      const packageSha256 = String(data.packageSha256 || '');
      const signatureSubject = String(data.signatureSubject || '');
      if (!packageUrl.startsWith('https://') || !packageSha256 || !signatureSubject) continue;
      if (compareVersions(version, current) <= 0) continue;

      const minimum = data.minimumSupportedVersion ? String(data.minimumSupportedVersion) : null;
      const mandatory = Boolean(minimum && compareVersions(current, minimum) < 0);
      const inRing = Array.isArray(data.rings) && data.rings.includes(ring);
      if (!inRing && !mandatory) continue;

      if (!best || compareVersions(version, String(best.version)) > 0) {
        best = {
          version,
          packageUrl,
          packageSha256,
          signatureSubject,
          packageSizeBytes: data.packageSizeBytes ?? null,
          releaseNotes: String(data.releaseNotes || ''),
        };
        forced = mandatory;
      }
    }

    /**
     * `autoUpdateEnabled` is applied here rather than on the PC.
     *
     * The agent's updater runs as SYSTEM in the service, which has no user session and so no way
     * to fetch a policy of its own — and every other part of this decision (the ring, the
     * withdrawn flag, the minimum supported version) is already made here. Splitting the last
     * one across the wire would mean two places to look when a machine will not update.
     *
     * A mandatory build is offered regardless. Switching auto-update off is a statement about
     * routine releases, not about a security fix.
     */
    if (best && !forced) {
      const policy = await resolveEffectivePolicy({
        userId: authenticated.device.lastSeenUserId ?? null,
        deviceId: authenticated.deviceId,
        departmentIds: authenticated.device.departmentId ? [authenticated.device.departmentId] : [],
      }).catch(() => null);

      if (policy && policy.settings.autoUpdateEnabled === false) {
        return Response.json(
          { update: null, mandatory: false, current },
          { headers: { 'Cache-Control': 'no-store' } },
        );
      }
    }

    return Response.json(
      { update: best, mandatory: forced, current },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const { body, status } = agentErrorResponse(error);
    return Response.json(body, { status });
  }
}

import {
  AccessDeniedError,
  accessErrorResponse,
  authenticateAccess,
  requireAccess,
} from '@/lib/access-control-server';
import { WINDOWS_AGENT_RESOURCES } from '@/lib/windows-agent-permissions';
import {
  agentErrorResponse,
  authenticateDevice,
  writeAudit,
} from '@/lib/windows-agent-server';

export const runtime = 'nodejs';

/**
 * POST /api/windows-agent/exit-approval
 *
 * Decides whether the agent may be closed on one computer. The answer is a SEL LIVE
 * administrator's to give, and it is given here rather than on the PC.
 *
 * ── Why a SEL LIVE administrator and not a Windows one ────────────────────────────────────────
 *
 * The obvious implementation is a UAC prompt, and it is the wrong one. Plenty of employees are
 * local administrators on their own laptop — that is an operating-system fact about who set the
 * machine up, and it says nothing about whether they may stop their own attendance recording.
 * Meanwhile the HR or IT staff who genuinely should decide may have no Windows rights on that PC
 * at all. Asking Windows answers a question nobody asked.
 *
 * So the check is against this application's own roles: `Windows Agent / Devices / Edit`, the
 * same permission that already covers blocking a device and forcing a re-authentication.
 *
 * ── Two credentials, and both are required ────────────────────────────────────────────────────
 *
 * The device secret in the headers proves the request came from an enrolled agent, so this is
 * not an endpoint the world can call to generate approval records. The `Authorization` bearer
 * token is the *approver's* — a different person from whoever is signed in to the agent, which
 * is the whole point — and is what the permission check runs against.
 *
 * ── Why the server decides rather than the agent ──────────────────────────────────────────────
 *
 * A desktop process can be ended from Task Manager regardless, and §7 of the documentation says
 * so plainly. This is not pretending otherwise. What it buys is that the ordinary, discoverable
 * way to close the agent produces a record naming who authorised it — which is what an
 * attendance system needs when somebody asks why a PC stopped reporting at half past two. Had
 * the agent evaluated permissions locally, that record would be a claim by the machine rather
 * than a decision by the server.
 */
export async function POST(request: Request) {
  try {
    // Order matters only for the error the caller sees first: an unenrolled machine should be
    // told that, rather than being asked to produce an administrator it cannot use anyway.
    const authenticated = await authenticateDevice(request);

    const approver = await authenticateAccess(request);
    requireAccess(approver, WINDOWS_AGENT_RESOURCES.devices, 'Edit');

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 300) : null;

    // Closing the agent and removing it are both authorised here, by the same permission, and
    // recorded as different actions. One pauses recording until the next sign-in; the other ends
    // it and leaves a machine indistinguishable from one that was never enrolled. An audit trail
    // that called them the same thing would answer "why did this PC stop reporting in March"
    // with "somebody closed the agent", which would be wrong.
    const uninstall = String(body.action || '').toUpperCase() === 'UNINSTALL';

    await writeAudit({
      action: uninstall ? 'AGENT_UNINSTALL_APPROVED' : 'AGENT_EXIT_APPROVED',
      actorId: approver.userId,
      actorName: approver.userName,
      targetType: 'device',
      targetId: authenticated.deviceId,
      targetLabel: authenticated.device.deviceName || authenticated.deviceId,
      reason: reason || null,
      ipAddress: authenticated.ipAddress,
      userAgent: authenticated.agentVersion,
    });

    return Response.json(
      {
        approved: true,
        approvedBy: approver.userId,
        approvedByName: approver.userName,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    // Two error vocabularies meet here. A device-authentication failure is an AgentRequestError;
    // a permission failure is an AccessDeniedError. Both are mapped, and by type rather than by
    // status code, so neither logs the other's errors as unexpected. The distinction is not
    // pedantic: "this computer is not enrolled" and "you are not allowed to do that" send an
    // employee to completely different people.
    if (error instanceof AccessDeniedError) {
      const access = accessErrorResponse(error);
      return Response.json({ error: access.message, approved: false }, { status: access.status });
    }

    // A rejected or expired approver token arrives as a Firebase `auth/…` error rather than an
    // AccessDeniedError, and 401 is the honest answer: the credential was the problem.
    const code = (error as { errorInfo?: { code?: string }; code?: string })?.errorInfo?.code
      ?? (error as { code?: string })?.code;
    if (typeof code === 'string' && code.startsWith('auth/')) {
      return Response.json(
        { error: 'That SEL LIVE sign-in was not accepted. Check the email and password.', approved: false },
        { status: 401 },
      );
    }

    const { body, status } = agentErrorResponse(error);
    return Response.json({ ...body, approved: false }, { status });
  }
}

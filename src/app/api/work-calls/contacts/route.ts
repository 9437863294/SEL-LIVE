import {
  accessErrorResponse,
  authenticateAccess,
  requireAccess,
} from '@/lib/access-control-server';
import { WINDOWS_AGENT_RESOURCES } from '@/lib/windows-agent-permissions';
import { WorkCallError, searchContacts, upsertContact } from '@/lib/work-calls-server';

export const runtime = 'nodejs';

/**
 * GET /api/work-calls/contacts — search the work directory (§R).
 *
 * Any signed-in employee may read it. A shared list of the site managers and clients somebody
 * has to ring is not sensitive within the company, and gating it behind an administrative
 * permission would mean the people who actually make the calls could not see it — which is the
 * usual way a directory ends up back in everybody's phone contacts instead.
 */
export async function GET(request: Request) {
  try {
    await authenticateAccess(request);

    const url = new URL(request.url);
    const contacts = await searchContacts({
      query: url.searchParams.get('q') ?? undefined,
      contactType: url.searchParams.get('type') ?? undefined,
      projectId: url.searchParams.get('projectId') ?? undefined,
      limit: Number(url.searchParams.get('limit')) || undefined,
    });

    return Response.json({ contacts }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const { message, status } = accessErrorResponse(error);
    return Response.json({ error: message }, { status });
  }
}

/**
 * POST /api/work-calls/contacts — add or edit a contact.
 *
 * Editing the shared directory is an administrative act, so this one is gated. `Devices / Edit`
 * on the Windows Agent resource rather than a permission of its own: a new node starts out
 * granted to nobody, and on day one not a single person could add the first contact.
 */
export async function POST(request: Request) {
  try {
    const context = await authenticateAccess(request);
    requireAccess(context, WINDOWS_AGENT_RESOURCES.devices, 'Edit');

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return Response.json({ error: 'A JSON body is required.' }, { status: 400 });

    const contact = await upsertContact(
      body,
      { userId: context.userId, userName: context.userName },
      typeof body.contactId === 'string' ? body.contactId : undefined,
    );

    return Response.json({ contact }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof WorkCallError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    const { message, status } = accessErrorResponse(error);
    return Response.json({ error: message }, { status });
  }
}

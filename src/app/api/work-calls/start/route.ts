import { accessErrorResponse, authenticateAccess } from '@/lib/access-control-server';
import { WorkCallError, startCall } from '@/lib/work-calls-server';

export const runtime = 'nodejs';

/**
 * POST /api/work-calls/start — record that a number was handed to the dialer (§S).
 *
 * Called by the app immediately before it follows a `tel:` link, because once the dialer takes
 * over the web layer may be suspended and gets no further chance.
 *
 * Creates a `DIALLED` record and nothing more. Whether a call happened, and for how long, is
 * settled by /end — see the header of `work-calls-model.ts` for why a dial on its own is
 * deliberately worth no time at all.
 *
 * No permission beyond being signed in: this records the caller's own action against their own
 * timeline, which is the same footing as any other thing an employee does in the ERP.
 */
export async function POST(request: Request) {
  try {
    const context = await authenticateAccess(request);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return Response.json({ error: 'A JSON body is required.' }, { status: 400 });

    const call = await startCall(body, {
      userId: context.userId,
      // The employee number is denormalised onto the call so attendance reports do not need a
      // join per row; taken from the verified context, never from the request.
      employeeId: null,
    });

    return Response.json({ call }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof WorkCallError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    const { message, status } = accessErrorResponse(error);
    return Response.json({ error: message }, { status });
  }
}

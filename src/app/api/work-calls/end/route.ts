import { accessErrorResponse, authenticateAccess } from '@/lib/access-control-server';
import { WorkCallError, endCall } from '@/lib/work-calls-server';

export const runtime = 'nodejs';

/**
 * POST /api/work-calls/end — confirm or cancel a dialled call (§S, §T).
 *
 * Called when the app becomes visible again, or when the employee taps "that call didn't
 * happen". The duration rules are applied server-side, so a client cannot send a figure that
 * skips the four-hour ceiling or the five-second floor.
 *
 * A call the rules refuse is stored as `NOT_CONFIRMED` with the reason rather than rejected:
 * the dial did happen and the record should say so, but it contributes no time to the timeline.
 * Refusing the request instead would leave the phone holding a call it could never settle.
 *
 * Confirming a call that is already settled returns it unchanged rather than erroring, because a
 * phone retrying after a dropped connection should not be punished for succeeding twice.
 */
export async function POST(request: Request) {
  try {
    const context = await authenticateAccess(request);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return Response.json({ error: 'A JSON body is required.' }, { status: 400 });

    const call = await endCall(body, { userId: context.userId });

    return Response.json({ call }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof WorkCallError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    const { message, status } = accessErrorResponse(error);
    return Response.json({ error: message }, { status });
  }
}

import { accessErrorResponse, authenticateAccess } from '@/lib/access-control-server';
import { todayWorkDate } from '@/lib/windows-agent-rules';
import { summarizeCalls } from '@/lib/work-calls-model';
import { callsForDay } from '@/lib/work-calls-server';

export const runtime = 'nodejs';

/**
 * GET /api/work-calls/today — the caller's own calls for one office-local day (§S, §AL).
 *
 * Two jobs. The obvious one is the day's list. The one that matters more: it returns any call
 * still sitting in `DIALLED`, so the app can pick the confirmation back up.
 *
 * Without this, a phone that was killed while the dialer was in front — which Android does
 * routinely, and which is the single most likely thing to happen to a backgrounded web view —
 * would lose the call entirely. The employee made it, and nothing would ever ask them about it.
 *
 * Only ever the caller's own calls. Reading a colleague's call log needs the activity permission
 * and belongs on the administrative screens, not on an endpoint the phone holds a token for.
 */
export async function GET(request: Request) {
  try {
    const context = await authenticateAccess(request);

    const url = new URL(request.url);
    const workDate = url.searchParams.get('date') || todayWorkDate();

    const calls = await callsForDay(context.userId, workDate);

    return Response.json(
      {
        workDate,
        calls,
        outstanding: calls.filter((call) => call.state === 'DIALLED'),
        summary: summarizeCalls(calls),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const { message, status } = accessErrorResponse(error);
    return Response.json({ error: message }, { status });
  }
}

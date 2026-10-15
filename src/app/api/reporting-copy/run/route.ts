import { NextResponse } from 'next/server';
import { accessErrorResponse, authenticateAccess, requireAccess } from '@/lib/access-control-server';
import { REPORTING_COPY_RESOURCE } from '@/lib/reporting-copy';
import { advanceReportingCopy, readReportingCopy, requestReportingCopyRun } from '@/lib/reporting-copy-server';

export const runtime = 'nodejs';
/**
 * A slice runs inside this request: up to CONTINUE_SLICE_MS of copying, plus the page in flight at
 * the deadline (or a subcollection discovery started at the beginning) and the reads around it.
 */
export const maxDuration = 120;
export const dynamic = 'force-dynamic';

/** How long "Refresh now" copies before answering, so the screen shows the run moving. */
const FIRST_SLICE_MS = 20_000;
/** How long each `continue` from the open settings screen copies; the screen calls again at once. */
const CONTINUE_SLICE_MS = 40_000;

/**
 * Settings › Reporting Database, Run permission. Body `{ action }`:
 *
 * - `start` (the default): "Refresh now". Records the request and copies a short first slice. A
 *   request while a run is already going is answered with that run rather than queued behind it.
 *   `full: true` makes it a Full refresh: subcollections are looked up again (instead of the
 *   week-old cached names) and every collection is checked for deletions to the end.
 * - `continue`: carry the run in progress on by one slice (the same claim and lease as the
 *   scheduler tick). The screen calls this back to back while it is open, so a run finishes without
 *   the 15-minute tick. Another slice holding a live lease is not an error: `{ busy: true }`.
 *
 * Both answer with the slice's result and the updated `overview`.
 */
export async function POST(request: Request) {
  try {
    const context = await authenticateAccess(request);
    requireAccess(context, REPORTING_COPY_RESOURCE, 'Run');
    const body = (await request.json().catch(() => null)) as { action?: unknown; full?: unknown } | null;
    const action = body?.action ?? 'start';
    if (action !== 'start' && action !== 'continue') {
      return NextResponse.json({ error: 'action must be "start" or "continue".' }, { status: 400 });
    }

    if (action === 'continue') {
      const slice = await advanceReportingCopy({ budgetMs: CONTINUE_SLICE_MS, mode: 'continue' });
      return NextResponse.json({ busy: slice.action === 'busy', slice, overview: await readReportingCopy() });
    }

    const requested = await requestReportingCopyRun(context.userId, context.userName, { full: body?.full === true });
    const slice = requested.queued ? await advanceReportingCopy({ budgetMs: FIRST_SLICE_MS }) : null;
    return NextResponse.json({ ...requested, busy: slice?.action === 'busy', slice, overview: await readReportingCopy() });
  } catch (error) {
    const { message, status } = accessErrorResponse(error);
    return NextResponse.json({ error: message }, { status });
  }
}

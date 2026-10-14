import { NextResponse } from 'next/server';
import { accessErrorResponse, authenticateAccess, requireAccess } from '@/lib/access-control-server';
import { REPORTING_COPY_RESOURCE } from '@/lib/reporting-copy';
import { advanceReportingCopy, readReportingCopy, requestReportingCopyRun } from '@/lib/reporting-copy-server';

export const runtime = 'nodejs';
/** The first slice runs inside this request; the budget below keeps it well under this. */
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/** How long "Refresh now" copies before answering. The scheduler tick carries the run on from there. */
const FIRST_SLICE_MS = 20_000;

/**
 * "Refresh now". Records the request, then starts the run with a short first slice so the screen
 * shows it moving; the 15-minute tick (`/api/reporting-copy/tick`) does the rest. A request while a
 * run is already going is answered with that run rather than queued behind it.
 */
export async function POST(request: Request) {
  try {
    const context = await authenticateAccess(request);
    requireAccess(context, REPORTING_COPY_RESOURCE, 'Run');
    const requested = await requestReportingCopyRun(context.userId);
    const slice = requested.queued ? await advanceReportingCopy({ budgetMs: FIRST_SLICE_MS }) : null;
    return NextResponse.json({ ...requested, slice, overview: await readReportingCopy() });
  } catch (error) {
    const { message, status } = accessErrorResponse(error);
    return NextResponse.json({ error: message }, { status });
  }
}

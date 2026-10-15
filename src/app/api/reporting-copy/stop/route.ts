import { NextResponse } from 'next/server';
import { accessErrorResponse, authenticateAccess, requireAccess } from '@/lib/access-control-server';
import { REPORTING_COPY_RESOURCE } from '@/lib/reporting-copy';
import { readReportingCopy, stopReportingCopyRun } from '@/lib/reporting-copy-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Stop the refresh in progress (Run permission). A slice copying right now finishes its page and
 * ends the run as `stopped`; with none copying (a run left waiting for a scheduler that never came)
 * the run ends here. What was copied is kept. Answers `{ outcome, reason, overview }`, where
 * outcome is `stopped`, `signalled` (the slice will end it within a page) or `nothing`.
 */
export async function POST(request: Request) {
  try {
    const context = await authenticateAccess(request);
    requireAccess(context, REPORTING_COPY_RESOURCE, 'Run');
    const stop = await stopReportingCopyRun(context.userName);
    return NextResponse.json({ ...stop, overview: await readReportingCopy() });
  } catch (error) {
    const { message, status } = accessErrorResponse(error);
    return NextResponse.json({ error: message }, { status });
  }
}

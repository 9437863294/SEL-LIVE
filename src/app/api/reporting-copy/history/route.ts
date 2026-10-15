import { NextResponse } from 'next/server';
import { accessErrorResponse, authenticateAccess, requireAccess } from '@/lib/access-control-server';
import { REPORTING_COPY_HISTORY_KEEP, REPORTING_COPY_RESOURCE } from '@/lib/reporting-copy';
import { listReportingCopyHistory } from '@/lib/reporting-copy-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The finished refreshes of the reporting copy, newest first (`?limit=`, at most 50). View permission. */
export async function GET(request: Request) {
  try {
    const context = await authenticateAccess(request);
    requireAccess(context, REPORTING_COPY_RESOURCE, 'View');
    const limit = Number(new URL(request.url).searchParams.get('limit') ?? REPORTING_COPY_HISTORY_KEEP);
    return NextResponse.json({ runs: await listReportingCopyHistory(limit) });
  } catch (error) {
    const { message, status } = accessErrorResponse(error);
    return NextResponse.json({ error: message }, { status });
  }
}

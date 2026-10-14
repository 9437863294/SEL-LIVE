import { NextResponse } from 'next/server';
import { accessErrorResponse, authenticateAccess, requireAccess } from '@/lib/access-control-server';
import { parseReportingCopySettings, REPORTING_COPY_RESOURCE } from '@/lib/reporting-copy';
import { readReportingCopy, saveReportingCopySettings } from '@/lib/reporting-copy-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Settings › Reporting Database: the refresh schedule of the MongoDB reporting copy, and what the
 * job last did. `reportingCopy/*` is server-only in the Firestore rules, so this route is the
 * screen's only way in.
 */
export async function GET(request: Request) {
  try {
    const context = await authenticateAccess(request);
    requireAccess(context, REPORTING_COPY_RESOURCE, 'View');
    return NextResponse.json(await readReportingCopy());
  } catch (error) {
    const { message, status } = accessErrorResponse(error);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PUT(request: Request) {
  try {
    const context = await authenticateAccess(request);
    requireAccess(context, REPORTING_COPY_RESOURCE, 'Edit');
    const parsed = parseReportingCopySettings(await request.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    return NextResponse.json(await saveReportingCopySettings(parsed.value, context.userId));
  } catch (error) {
    const { message, status } = accessErrorResponse(error);
    return NextResponse.json({ error: message }, { status });
  }
}

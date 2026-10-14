import { NextResponse } from 'next/server';
import { checkerFor } from '@/lib/access-control';
import { AccessDeniedError, accessErrorResponse, authenticateAccess } from '@/lib/access-control-server';
import { logServerActivity, requestProvenance } from '@/lib/activity-logger-server';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { COMPANY_PROFILE_RESOURCE } from '@/lib/company-profile';
import { getCompanyProfile, readStoredCompanyProfile, saveCompanyProfile } from '@/lib/company-profile-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Settings › Company Profile: the company's name, address, tax numbers, document design and UI
 * text. Any signed-in user reads it (every letterhead needs it); only `Settings.Company Profile ›
 * Edit` writes it.
 */
export async function GET(request: Request) {
  try {
    const context = await authenticateAccess(request);
    // `?stored=1`: the document itself (no logo fallback, no cache), for the settings screen.
    if (new URL(request.url).searchParams.get('stored') === '1') {
      const can = checkerFor(context.access);
      if (!can('View', COMPANY_PROFILE_RESOURCE) && !can('Edit', COMPANY_PROFILE_RESOURCE)) {
        throw new AccessDeniedError('You do not have permission to open the company profile settings.', 403);
      }
      return NextResponse.json(await readStoredCompanyProfile());
    }
    return NextResponse.json(await getCompanyProfile());
  } catch (error) {
    const { message, status } = accessErrorResponse(error);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PUT(request: Request) {
  try {
    const context = await authenticateAccess(request);
    if (!checkerFor(context.access)('Edit', COMPANY_PROFILE_RESOURCE)) {
      throw new AccessDeniedError('You do not have permission to edit the company profile.', 403);
    }
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Send the company profile as a JSON object.' }, { status: 400 });
    }
    const before = await getCompanyProfile();
    const saved = await saveCompanyProfile(body, context);
    const changed = (Object.keys(saved) as (keyof typeof saved)[]).filter((key) => JSON.stringify(saved[key]) !== JSON.stringify(before[key]));
    await logServerActivity({
      userId: context.userId,
      userName: context.userName,
      userEmail: context.userEmail ?? undefined,
      module: ACTIVITY_MODULES.SETTINGS,
      action: 'Company Profile Updated',
      source: 'api',
      recordRef: 'settings/companyProfile',
      details: { changed, legalName: saved.legalName, gstRegistrations: saved.gstRegistrations.length },
      ...requestProvenance(request),
    });
    // The settings screen keeps editing the stored document, not the logo-filled copy.
    return NextResponse.json({ profile: saved, stored: await readStoredCompanyProfile() });
  } catch (error) {
    const { message, status } = accessErrorResponse(error);
    return NextResponse.json({ error: message }, { status });
  }
}

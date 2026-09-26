import { NextResponse } from 'next/server';
import { AccessDeniedError } from '@/lib/access-control-server';
import { adminCaller, errorResponse } from '@/lib/appearance/api';
import { canOpenAppearanceAdmin } from '@/lib/appearance/permissions';
import { listVersions, readDraft, readPublished } from '@/lib/appearance/server';

export const runtime = 'nodejs';

/** Everything the Company Branding and Theme Management screens need, for those allowed to see it. */
export async function GET(request: Request) {
  try {
    const caller = await adminCaller(request);
    if (!canOpenAppearanceAdmin(caller.rights)) throw new AccessDeniedError('You do not have permission to manage company appearance.');
    const published = await readPublished();
    const [draft, versions] = await Promise.all([readDraft(published), listVersions()]);
    return NextResponse.json({ rights: caller.rights, published, draft, versions });
  } catch (error) {
    return errorResponse(error);
  }
}

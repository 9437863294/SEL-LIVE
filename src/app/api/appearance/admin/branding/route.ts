import { NextResponse } from 'next/server';
import { cleanText } from '@/lib/appearance/model';
import { adminCaller, auditAppearance, errorResponse, readJson, requireRight } from '@/lib/appearance/api';
import { saveBranding } from '@/lib/appearance/server';

export const runtime = 'nodejs';

/** Save company branding. It goes live at once, as a version that can be restored. */
export async function PUT(request: Request) {
  try {
    const caller = await adminCaller(request);
    requireRight(caller.rights, 'editBranding', 'change company branding');
    const body = await readJson(request);
    const note = cleanText(body.note, 200) ?? 'Updated branding';
    const result = await saveBranding(caller.actor, body.branding, note);
    await auditAppearance(request, caller, 'Company branding updated', { version: result.published.version, note, changes: result.changes });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}

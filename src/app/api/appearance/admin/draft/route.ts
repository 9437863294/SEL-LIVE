import { NextResponse } from 'next/server';
import { adminCaller, auditAppearance, errorResponse, readJson, requireRight } from '@/lib/appearance/api';
import { saveDraft } from '@/lib/appearance/server';

export const runtime = 'nodejs';

/** Save the theme draft. Nobody else sees it until it is published. */
export async function PUT(request: Request) {
  try {
    const caller = await adminCaller(request);
    requireRight(caller.rights, 'editThemes', 'edit the company theme');
    const body = await readJson(request);
    const draft = await saveDraft(caller.actor, body.draft);
    await auditAppearance(request, caller, 'Appearance theme draft saved', { basedOnVersion: draft.basedOnVersion });
    return NextResponse.json({ draft });
  } catch (error) {
    return errorResponse(error);
  }
}

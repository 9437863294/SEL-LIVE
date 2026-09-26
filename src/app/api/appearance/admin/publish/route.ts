import { NextResponse } from 'next/server';
import { cleanText } from '@/lib/appearance/model';
import { adminCaller, auditAppearance, errorResponse, readJson, requireRight } from '@/lib/appearance/api';
import { publishDraft } from '@/lib/appearance/server';

export const runtime = 'nodejs';

/**
 * Publish the saved draft as the next version. New company defaults reach everyone who has not
 * chosen for themselves; nobody's own preferences are touched.
 */
export async function POST(request: Request) {
  try {
    const caller = await adminCaller(request);
    requireRight(caller.rights, 'publishThemes', 'publish the company theme');
    const body = await readJson(request);
    const note = cleanText(body.note, 200) ?? 'Published theme';
    const result = await publishDraft(caller.actor, note);
    await auditAppearance(request, caller, 'Appearance theme published', { version: result.published.version, note, changes: result.changes });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}

import { NextResponse } from 'next/server';
import { AccessDeniedError } from '@/lib/access-control-server';
import { DIRECT_DEFAULT_FIELDS, cleanText, isOneOf } from '@/lib/appearance/model';
import { adminCaller, auditAppearance, errorResponse, readJson, requireRight } from '@/lib/appearance/api';
import { countPreference, publishDefault } from '@/lib/appearance/server';

export const runtime = 'nodejs';

/** How many people chose this setting for themselves, and so would not see a new default. */
export async function GET(request: Request) {
  try {
    const caller = await adminCaller(request);
    requireRight(caller.rights, 'publishThemes', 'publish the company theme');
    const field = new URL(request.url).searchParams.get('field');
    if (!isOneOf(DIRECT_DEFAULT_FIELDS, field)) throw new AccessDeniedError('Unknown setting.', 400);
    return NextResponse.json({ chosen: await countPreference(field) });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Make one setting's company default live straight away, from an administrator's own choice on My
 * Appearance — optionally removing everyone's own choice of it, so it reaches them too.
 */
export async function POST(request: Request) {
  try {
    const caller = await adminCaller(request);
    requireRight(caller.rights, 'publishThemes', 'publish the company theme');
    const body = await readJson(request);
    const clearChoices = body.clearChoices === true;
    const result = await publishDefault(caller.actor, body.field, body.value, { clearChoices, note: cleanText(body.note, 200) ?? null });
    await auditAppearance(request, caller, 'Appearance company default set', {
      field: String(body.field),
      value: String(body.value),
      version: result.published.version,
      clearedChoices: result.cleared,
    });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}

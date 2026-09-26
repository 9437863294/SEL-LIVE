import { NextResponse } from 'next/server';
import { AccessDeniedError } from '@/lib/access-control-server';
import { adminCaller, auditAppearance, errorResponse, readJson, requireRight } from '@/lib/appearance/api';
import { restoreVersion, type RestoreScope } from '@/lib/appearance/server';

export const runtime = 'nodejs';

const SCOPES: RestoreScope[] = ['all', 'theme', 'branding'];

/**
 * Restore an earlier published version — as a new version, so the restore can itself be undone.
 * Restoring the theme needs publish rights; restoring only the branding needs branding rights.
 */
export async function POST(request: Request) {
  try {
    const caller = await adminCaller(request);
    const body = await readJson(request);
    const version = Number(body.version);
    const scope = SCOPES.find((s) => s === body.scope) ?? 'all';
    if (!Number.isInteger(version) || version < 1) throw new AccessDeniedError('Choose a version to restore.', 400);
    if (scope !== 'branding') requireRight(caller.rights, 'publishThemes', 'restore a company theme');
    if (scope !== 'theme') requireRight(caller.rights, 'editBranding', 'restore company branding');
    const result = await restoreVersion(caller.actor, version, scope);
    await auditAppearance(request, caller, 'Appearance version restored', {
      restoredFrom: version,
      scope,
      version: result.published.version,
      changes: result.changes,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && /does not exist/.test(error.message)) return NextResponse.json({ error: error.message }, { status: 404 });
    return errorResponse(error);
  }
}

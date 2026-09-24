import { mailRoute, readJson } from '@/lib/mail-hub/route';
import { deleteSignature, listSignatures, saveSignature } from '@/lib/mail-hub/workflow-service';

/** Personal signatures, and department signatures (Templates › Manage). `DELETE ?id=`. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = mailRoute('signatures.list', async ({ context }) => ({ signatures: await listSignatures(context) }));

export const POST = mailRoute('signatures.save', async ({ request, context }) => {
  const body = await readJson<{ id?: string; name?: string; html?: string; scope?: 'personal' | 'department'; departmentId?: string | null; departmentName?: string | null; defaultForAccountId?: string | null }>(request, 100_000);
  return {
    signature: await saveSignature(context, {
      id: body.id ?? null,
      name: String(body.name ?? ''),
      html: String(body.html ?? ''),
      scope: body.scope === 'department' ? 'department' : 'personal',
      departmentId: body.departmentId ?? null,
      departmentName: body.departmentName ?? null,
      defaultForAccountId: body.defaultForAccountId ?? null,
    }),
  };
});

export const DELETE = mailRoute('signatures.delete', async ({ context, url }) => {
  await deleteSignature(context, url.searchParams.get('id') ?? '');
  return { ok: true };
});

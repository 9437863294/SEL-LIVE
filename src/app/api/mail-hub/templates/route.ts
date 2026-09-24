import type { MailContentScope } from '@/lib/mail-hub/model';
import { mailRoute, readJson } from '@/lib/mail-hub/route';
import { deleteTemplate, listTemplates, saveTemplate } from '@/lib/mail-hub/workflow-service';

/**
 * Reusable templates. Personal ones are anyone's to keep; department and organisation-wide ones
 * need Mail Hub › Templates › Manage. `DELETE ?id=` removes one the caller may edit.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = mailRoute('templates.list', async ({ context }) => ({ templates: await listTemplates(context) }));

export const POST = mailRoute('templates.save', async ({ request, context }) => {
  const body = await readJson<{ id?: string; name?: string; subject?: string; html?: string; scope?: MailContentScope; departmentId?: string | null; departmentName?: string | null }>(request, 400_000);
  return {
    template: await saveTemplate(context, {
      id: body.id ?? null,
      name: String(body.name ?? ''),
      subject: String(body.subject ?? ''),
      html: String(body.html ?? ''),
      scope: body.scope ?? 'personal',
      departmentId: body.departmentId ?? null,
      departmentName: body.departmentName ?? null,
    }),
  };
});

export const DELETE = mailRoute('templates.delete', async ({ context, url }) => {
  await deleteTemplate(context, url.searchParams.get('id') ?? '');
  return { ok: true };
});

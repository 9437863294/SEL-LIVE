import { MAIL_LINK_RECORD_TYPES, type MailLinkRecordType } from '@/lib/mail-hub/model';
import { mailRoute, readJson } from '@/lib/mail-hub/route';
import { MailHubError } from '@/lib/mail-hub/server';
import { addLink, linksForThread, requireThread } from '@/lib/mail-hub/workflow-service';

/** Link a conversation to an ERP record (project, vendor, PO, invoice, approval, task, meeting, …). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = mailRoute<{ threadId: string }>('links.list', async ({ context, params }) => {
  await requireThread(context, params.threadId, 'read');
  return { links: await linksForThread(params.threadId) };
});

export const POST = mailRoute<{ threadId: string }>('links.add', async ({ request, context, params }) => {
  const body = await readJson<{ recordType?: string; recordPath?: string; messageId?: string | null }>(request, 5_000);
  if (!MAIL_LINK_RECORD_TYPES.includes(body.recordType as MailLinkRecordType)) throw new MailHubError('Choose what kind of record to link.', 400);
  if (!body.recordPath) throw new MailHubError('Choose a record.', 400);
  return addLink(context, params.threadId, { recordType: body.recordType as MailLinkRecordType, recordPath: body.recordPath, messageId: body.messageId ?? null });
});

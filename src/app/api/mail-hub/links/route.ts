import { MAIL_LINK_RECORD_TYPES, type MailLinkRecordType } from '@/lib/mail-hub/model';
import { mailRoute } from '@/lib/mail-hub/route';
import { MailHubError } from '@/lib/mail-hub/server';
import { linksForRecord } from '@/lib/mail-hub/workflow-service';

/**
 * Emails linked to one ERP record (`GET /api/mail-hub/links?recordType=purchaseOrder&recordId=…`),
 * for a "Related email" panel on the record's own page. Only links in mailboxes the caller can read.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = mailRoute('links.forRecord', async ({ context, url }) => {
  const type = url.searchParams.get('recordType') as MailLinkRecordType;
  const id = url.searchParams.get('recordId') ?? '';
  if (!MAIL_LINK_RECORD_TYPES.includes(type) || !id) throw new MailHubError('recordType and recordId are required.', 400);
  return { links: await linksForRecord(context, type, id) };
});

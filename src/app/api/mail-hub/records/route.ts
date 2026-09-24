import { MAIL_LINK_RECORD_TYPES, type MailLinkRecordType } from '@/lib/mail-hub/model';
import { mailRoute } from '@/lib/mail-hub/route';
import { MailHubError } from '@/lib/mail-hub/server';
import { searchRecords } from '@/lib/mail-hub/workflow-service';

/**
 * Find ERP records to link an email to (`GET /api/mail-hub/records?type=vendor&q=steel`). Each type
 * requires access to its own module, so the picker never lists records the caller could not open.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = mailRoute('records.search', async ({ context, url }) => {
  const type = url.searchParams.get('type') as MailLinkRecordType;
  if (!MAIL_LINK_RECORD_TYPES.includes(type)) throw new MailHubError('Unknown record type.', 400);
  return { records: await searchRecords(context, type, (url.searchParams.get('q') ?? '').slice(0, 100)) };
});

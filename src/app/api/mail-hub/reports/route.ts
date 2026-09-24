import { mailRoute } from '@/lib/mail-hub/route';
import { MailHubError } from '@/lib/mail-hub/server';
import { buildReports } from '@/lib/mail-hub/workflow-service';

/** Shared-mailbox workload reports: volume, open work, response times, overdue, by person and department. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export const GET = mailRoute('reports', async ({ context, url }) => {
  const to = url.searchParams.get('to') ?? new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const from = url.searchParams.get('from') ?? new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) throw new MailHubError('Choose a valid date range.', 400);
  return buildReports(context, { from: new Date(from).toISOString(), to: new Date(to).toISOString(), sharedMailboxId: url.searchParams.get('sharedMailboxId') });
});

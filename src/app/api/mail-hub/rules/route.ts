import type { MailRoutingRule } from '@/lib/mail-hub/model';
import { mailRoute, readJson } from '@/lib/mail-hub/route';
import { MailHubError } from '@/lib/mail-hub/server';
import { deleteRoutingRule, listRoutingRules, saveRoutingRule } from '@/lib/mail-hub/workflow-service';

/**
 * Routing rules for a shared mailbox: conditions on sender, recipients and subject that assign new
 * inbound conversations and set their response deadline. Managers of the mailbox and Mail Hub
 * administrators only.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = mailRoute('rules.list', async ({ context, url }) => {
  const sharedMailboxId = url.searchParams.get('sharedMailboxId');
  if (!sharedMailboxId) throw new MailHubError('Choose a shared mailbox.', 400);
  return { rules: await listRoutingRules(context, sharedMailboxId) };
});

export const POST = mailRoute('rules.save', async ({ request, context }) => {
  const body = await readJson<Partial<MailRoutingRule> & { sharedMailboxId?: string }>(request, 10_000);
  if (!body.sharedMailboxId) throw new MailHubError('Choose a shared mailbox.', 400);
  return { rule: await saveRoutingRule(context, { ...body, sharedMailboxId: body.sharedMailboxId }) };
});

export const DELETE = mailRoute('rules.delete', async ({ context, url }) => {
  await deleteRoutingRule(context, url.searchParams.get('id') ?? '');
  return { ok: true };
});

import { suggestForThread } from '@/lib/mail-hub/ai-service';
import { mailRoute, readJson } from '@/lib/mail-hub/route';
import { MailHubError } from '@/lib/mail-hub/server';

/**
 * An AI summary or draft reply for one conversation — returned as text for review, never sent,
 * never saved. Opt-in, permission-gated, and limited to a thread the caller can read.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export const POST = mailRoute('ai.suggest', async ({ request, context }) => {
  const body = await readJson<{ threadId?: string; kind?: string; instructions?: string }>(request, 5_000);
  if (!body.threadId) throw new MailHubError('Choose a conversation.', 400);
  const kind = body.kind === 'reply' ? 'reply' : 'summary';
  return suggestForThread(context, body.threadId, { kind, instructions: body.instructions ?? null });
});

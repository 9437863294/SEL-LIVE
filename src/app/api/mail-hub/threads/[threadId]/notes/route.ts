import { mailRoute, readJson } from '@/lib/mail-hub/route';
import { addNote, notesForThread, requireThread } from '@/lib/mail-hub/workflow-service';

/**
 * Internal notes on a conversation. Plain text, stored in their own collection, visible to whoever
 * can read the conversation — and structurally unable to reach an outgoing email.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = mailRoute<{ threadId: string }>('notes.list', async ({ context, params }) => {
  await requireThread(context, params.threadId, 'read');
  return { notes: await notesForThread(params.threadId) };
});

export const POST = mailRoute<{ threadId: string }>('notes.add', async ({ request, context, params }) => {
  const body = await readJson<{ body?: string; mentionUserIds?: string[] }>(request, 20_000);
  return { note: await addNote(context, params.threadId, { body: String(body.body ?? ''), mentionUserIds: Array.isArray(body.mentionUserIds) ? body.mentionUserIds.map(String) : [] }) };
});

import { connectImap, listAccountViews, toAccountView } from '@/lib/mail-hub/accounts-service';
import { mailRoute, readJson } from '@/lib/mail-hub/route';
import { readableAccounts } from '@/lib/mail-hub/server';
import { runSyncNow } from '@/lib/mail-hub/worker';

/**
 * `GET` — the caller's connected mailboxes, with sync status and recovery advice.
 * `POST` — connect a company IMAP/SMTP mailbox. The password is verified against both servers,
 * sealed (`secrets.ts`) and never returned; the server host comes from an administrator's preset.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export const GET = mailRoute('accounts.list', async ({ context }) => ({
  accounts: await listAccountViews(context, await readableAccounts(context)),
}));

export const POST = mailRoute('accounts.connect-imap', async ({ request, context }) => {
  const body = await readJson<{ presetId?: string; emailAddress?: string; password?: string; username?: string; kind?: 'personal' | 'shared'; accountId?: string }>(request, 10_000);
  const account = await connectImap(context, {
    presetId: String(body.presetId ?? ''),
    emailAddress: String(body.emailAddress ?? ''),
    password: String(body.password ?? ''),
    username: body.username ?? null,
    kind: body.kind,
    accountId: body.accountId ?? null,
  });
  // Start the first sync now so the inbox is not empty when the user lands on it.
  await runSyncNow(account.id).catch((error) => console.error('[mail-hub] first sync', error));
  return { account: toAccountView(account), message: `${account.emailAddress} is connected.` };
});

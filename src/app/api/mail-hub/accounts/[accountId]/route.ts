import { disconnectAccount, ensureWatch, toAccountView } from '@/lib/mail-hub/accounts-service';
import { mailRoute, readJson } from '@/lib/mail-hub/route';
import { audit, requireMailbox } from '@/lib/mail-hub/server';
import { syncStore } from '@/lib/mail-hub/store';
import { runSyncNow } from '@/lib/mail-hub/worker';

/**
 * `POST {action: 'sync' | 'resync'}` — sync now, or rebuild the ERP's copy from scratch.
 * `DELETE` — disconnect: stop the watch, revoke at the provider where possible, delete the sealed
 * credential, and purge the cached mail (see `accounts-service.ts` for what is kept).
 *
 * Both need `canManageConnection`: the owner of a personal mailbox, or for a shared one the person
 * who connected it or a Mail Hub administrator — which does not include reading it.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export const POST = mailRoute<{ accountId: string }>('accounts.sync', async ({ request, context, params }) => {
  const resolved = await requireMailbox(context, params.accountId, 'manage');
  const body = await readJson<{ action?: string }>(request, 2_000);
  if (body.action === 'resync') {
    await syncStore.updateAccount(resolved.account.id, { sync: { ...resolved.account.sync, phase: 'recovery', listing: null, lastError: null, nextAttemptAt: null } });
    await audit(context, 'account.resync', `Requested a full resync of ${resolved.account.emailAddress}`, { accountId: resolved.account.id });
  } else {
    // "Retry now" clears a provider back-off the user has decided not to wait out.
    await syncStore.updateAccount(resolved.account.id, { sync: { ...resolved.account.sync, nextAttemptAt: null } });
  }
  if (resolved.account.watch.kind === 'imap-poll' && resolved.account.provider !== 'imap') await ensureWatch(resolved.account).catch(() => {});
  const ran = await runSyncNow(resolved.account.id);
  const account = await syncStore.getAccount(resolved.account.id);
  return { ran, account: account ? toAccountView(account) : null };
});

export const DELETE = mailRoute<{ accountId: string }>('accounts.disconnect', async ({ context, params }) => {
  const resolved = await requireMailbox(context, params.accountId, 'manage');
  return disconnectAccount(context, resolved);
});

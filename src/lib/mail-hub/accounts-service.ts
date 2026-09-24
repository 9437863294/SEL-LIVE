import 'server-only';

/**
 * Mail Hub — connecting, reconnecting, watching and disconnecting mailboxes.
 *
 * ── Disconnection and what it deletes ──────────────────────────────────────────────────────────
 *
 * Disconnecting stops the provider watch, revokes the grant where the provider allows it (Google),
 * deletes the sealed credential, and marks the account `disconnected` — in that order, so a
 * failure part-way still leaves the ERP unable to use the grant. A purge job then deletes the
 * cached copy of the mailbox (folders, messages, bodies, cursors, drafts and their uploads).
 *
 * Kept after a purge, deliberately:
 *   - **ERP record links**, with their subject/sender/date snapshot — a PO that was discussed by
 *     email should still say so after the buyer changes jobs.
 *   - **Follow-ups**, which are ERP work items.
 *   - **Audit events**, which are never deleted by the module.
 *   - For a **shared** mailbox, the thread documents that carry assignments and statuses (with
 *     their search tokens and snippet cleared), so a reconnection resumes the team's queue.
 * Deleted: internal notes on a *personal* mailbox's threads (they were about that person's mail).
 */

import { createHmac } from 'node:crypto';

import { AccessDeniedError, authenticateUserById } from '../access-control-server';
import { graphNotificationUrl, stateSecret } from './config';
import { exchangeCode, revokeOAuthGrant, type OAuthStateRecord } from './oauth';
import { missingScopes } from './oauth-shared';
import {
  MAIL_HUB_COLLECTIONS as C,
  type MailAccount,
  type MailAccountKind,
  type MailAccountView,
  type MailProvider,
  type MailSharedMailbox,
} from './model';
import { mailHubCapabilities } from './permissions';
import { ImapAdapter } from './providers/imap';
import { DEFAULT_CAPABILITIES, ProviderAuthError } from './providers/types';
import { imapLogin, normalizeEmail, recoveryAdvice, resolveImapPreset, stableHash } from './rules';
import { deleteCredential, storeCredential } from './secrets';
import {
  MailHubError,
  adapterForAccount,
  adminSettings,
  audit,
  enqueueSync,
  type MailContext,
  type ResolvedMailbox,
} from './server';
import { clean, db, deleteWhere, getOne, jobQueue } from './store';
import { emptySyncState } from './sync-engine';
import { getFirebaseAdminBucket } from '../firebase-admin';

export function toAccountView(account: MailAccount): MailAccountView {
  const { organizationId: _organizationId, ...rest } = account;
  return { ...rest, recovery: recoveryAdvice(account) };
}

export const accountDocId = (ownerUserId: string, provider: MailProvider, address: string, kind: MailAccountKind) =>
  `ma_${stableHash(`${ownerUserId}|${provider}|${normalizeEmail(address)}|${kind}`)}`;

export function graphClientState(accountId: string): string {
  return createHmac('sha256', stateSecret()).update(`graph-subscription:${accountId}`).digest('base64url');
}

function newAccount(input: {
  id: string;
  ownerUserId: string;
  ownerName: string;
  organizationId: string;
  provider: MailProvider;
  kind: MailAccountKind;
  emailAddress: string;
  loginIdentity: string | null;
  displayName: string | null;
  providerAccountId: string | null;
  grantedScopes: string[];
  imapServerId: string | null;
  syncWindowDays: number;
}): MailAccount {
  const now = new Date().toISOString();
  return {
    ...input,
    status: 'connecting',
    statusReason: null,
    capabilities: DEFAULT_CAPABILITIES[input.provider],
    identities: [],
    sync: emptySyncState(),
    watch: { kind: 'none', subscriptionId: null, expiresAt: null, nextPollAt: now, lastNotificationAt: null, lastError: null },
    settings: { syncWindowDays: input.syncWindowDays, cacheBodies: true },
    createdAt: now,
    updatedAt: now,
    disconnectedAt: null,
  };
}

/* ── watches ──────────────────────────────────────────────────────────────────────────────── */

/**
 * Start or renew change notifications, falling back to polling. A failed watch is not a failed
 * connection: the account polls until the next renewal attempt succeeds.
 */
export async function ensureWatch(account: MailAccount): Promise<void> {
  const nowIso = new Date().toISOString();
  const pollFallback = (error: string | null) =>
    db()
      .collection(C.accounts)
      .doc(account.id)
      .set({ watch: { ...account.watch, kind: 'imap-poll', lastError: error, nextPollAt: account.watch.nextPollAt ?? nowIso } }, { merge: true });

  if (account.provider === 'imap') return void (await pollFallback(null));
  const adapter = await adapterForAccount(account);
  try {
    if (!adapter.watch) return void (await pollFallback(null));
    const result = await adapter.watch({
      notificationUrl: graphNotificationUrl(),
      clientState: graphClientState(account.id),
      existingSubscriptionId: account.watch.subscriptionId,
    });
    await db()
      .collection(C.accounts)
      .doc(account.id)
      .set(
        {
          watch: {
            ...account.watch,
            kind: result.kind,
            subscriptionId: result.subscriptionId,
            expiresAt: result.expiresAt,
            lastError: null,
            // Push providers still get a slow safety-net poll; see the worker's sweep.
            nextPollAt: account.watch.nextPollAt ?? nowIso,
          },
        },
        { merge: true },
      );
  } catch (error) {
    if (error instanceof ProviderAuthError) throw error;
    await pollFallback(error instanceof Error ? error.message : String(error));
  } finally {
    await adapter.close?.().catch(() => {});
  }
}

/* ── OAuth ────────────────────────────────────────────────────────────────────────────────── */

export async function completeOAuthConnection(record: OAuthStateRecord, code: string): Promise<{ account: MailAccount; message: string }> {
  const tokens = await exchangeCode(record, code);
  const missing = missingScopes(record.provider, record.scopes, tokens.grantedScopes);
  if (tokens.grantedScopes.length && missing.length) {
    throw new MailHubError(
      `Some permissions were not granted: ${missing.join(', ')}. Connect again and leave every permission ticked.`,
      400,
    );
  }
  if (!tokens.email) throw new MailHubError('The provider did not say which account was authorised.', 400);

  // Re-read the user and their permissions now: the state record proves who started the flow,
  // but what they may do is decided at completion, not ten minutes ago.
  const actor = await authenticateUserById(record.userId);
  const caps = mailHubCapabilities(actor.access);
  const settings = await adminSettings();
  if (!settings.enabledProviders.includes(record.provider)) throw new MailHubError('This provider has been disabled by your administrator.', 403);

  let account: MailAccount;
  if (record.purpose === 'reconnect') {
    const existing = record.accountId ? await getOne<MailAccount>(C.accounts, record.accountId) : null;
    const may = existing && (existing.ownerUserId === record.userId || (existing.kind === 'shared' && caps.canAdministerConnections));
    if (!existing || !may) throw new MailHubError('That mailbox could not be found.', 404);
    const expected = normalizeEmail(existing.loginIdentity ?? existing.emailAddress);
    if (normalizeEmail(tokens.email) !== expected) {
      throw new MailHubError(`You signed in as ${tokens.email}, but this connection belongs to ${expected}. Sign in with that account.`, 400);
    }
    account = { ...existing, status: 'connecting', statusReason: null, grantedScopes: tokens.grantedScopes, disconnectedAt: null, updatedAt: new Date().toISOString() };
  } else if (record.purpose === 'shared') {
    if (!caps.canAdministerConnections) throw new AccessDeniedError('Connecting a shared mailbox requires Mail Hub › Settings › Administer.');
    const target = normalizeEmail(record.targetAddress ?? tokens.email);
    if (record.provider === 'gmail' && target !== normalizeEmail(tokens.email)) {
      throw new MailHubError(
        `Gmail cannot reach another mailbox through ${tokens.email}. Sign in as ${target} itself to connect it as a shared mailbox.`,
        400,
      );
    }
    account = newAccount({
      id: accountDocId(record.userId, record.provider, target, 'shared'),
      ownerUserId: record.userId,
      ownerName: actor.userName,
      organizationId: actor.organizationId,
      provider: record.provider,
      kind: 'shared',
      emailAddress: target,
      loginIdentity: normalizeEmail(tokens.email),
      displayName: null,
      providerAccountId: tokens.subject,
      grantedScopes: tokens.grantedScopes,
      imapServerId: null,
      syncWindowDays: settings.defaultSyncWindowDays,
    });
  } else {
    if (!caps.canConnectAccount) throw new AccessDeniedError('Connecting a mailbox requires Mail Hub › Accounts › Connect.');
    account = newAccount({
      id: accountDocId(record.userId, record.provider, tokens.email, 'personal'),
      ownerUserId: record.userId,
      ownerName: actor.userName,
      organizationId: actor.organizationId,
      provider: record.provider,
      kind: 'personal',
      emailAddress: normalizeEmail(tokens.email),
      loginIdentity: normalizeEmail(tokens.email),
      displayName: tokens.name,
      providerAccountId: tokens.subject,
      grantedScopes: tokens.grantedScopes,
      imapServerId: null,
      syncWindowDays: settings.defaultSyncWindowDays,
    });
    const existing = await getOne<MailAccount>(C.accounts, account.id);
    if (existing) {
      // The same mailbox connected again: keep its sync state and cursors, replace the grant.
      account = { ...existing, status: 'connecting', statusReason: null, grantedScopes: tokens.grantedScopes, disconnectedAt: null, updatedAt: new Date().toISOString() };
    }
  }

  await storeCredential({
    accountId: account.id,
    ownerUserId: account.ownerUserId,
    provider: record.provider,
    payload: { type: 'oauth', refreshToken: tokens.refreshToken, scopes: record.scopes, tenant: tokens.tenant },
  });

  // Prove the grant reaches the mailbox before calling it connected.
  const adapter = await adapterForAccount(account);
  try {
    const profile = await adapter.getProfile();
    account = { ...account, identities: profile.identities, displayName: account.displayName ?? profile.displayName, providerAccountId: profile.providerAccountId ?? account.providerAccountId };
  } catch (error) {
    await deleteCredential(account.id).catch(() => {});
    if (record.purpose === 'shared' && record.provider === 'microsoft') {
      throw new MailHubError(`${tokens.email} does not have access to ${account.emailAddress} in Exchange. Ask your Microsoft 365 administrator to grant Full Access.`, 400);
    }
    throw error;
  } finally {
    await adapter.close?.().catch(() => {});
  }

  if (account.sync.phase === 'recovery' || record.purpose === 'reconnect') {
    // A reconnection after a long gap is safest treated as a fresh generation.
    account.sync = { ...account.sync, phase: account.sync.initialSyncComplete ? 'recovery' : 'initial', listing: null, consecutiveFailures: 0, lastError: null, nextAttemptAt: null };
  }
  await db().collection(C.accounts).doc(account.id).set(clean(account));

  if (record.purpose === 'shared') await ensureSharedMailboxRecord(account, actor.userId);

  await ensureWatch(account).catch((error) => console.error('[mail-hub] watch setup failed', error));
  await enqueueSync(account.id, 'connected');
  await audit(
    { userId: actor.userId, userName: actor.userName },
    record.purpose === 'reconnect' ? 'account.reconnect' : 'account.connect',
    `${record.purpose === 'reconnect' ? 'Reconnected' : 'Connected'} ${account.emailAddress} (${record.provider}${account.kind === 'shared' ? ', shared' : ''})`,
    { accountId: account.id, detail: { scopes: tokens.grantedScopes, purpose: record.purpose } },
  );
  return { account, message: `${account.emailAddress} is connected. The first sync is running.` };
}

async function ensureSharedMailboxRecord(account: MailAccount, userId: string): Promise<void> {
  const existing = await db().collection(C.sharedMailboxes).where('accountId', '==', account.id).limit(1).get();
  if (!existing.empty) return;
  const now = new Date().toISOString();
  const mailbox: Omit<MailSharedMailbox, 'id'> = {
    name: account.emailAddress,
    address: account.emailAddress,
    provider: account.provider,
    accountId: account.id,
    departmentId: null,
    departmentName: null,
    responseHours: 24,
    // Active, but unreadable until an administrator adds members and their provider grants verify.
    active: true,
    createdAt: now,
    createdById: userId,
    updatedAt: now,
  };
  await db().collection(C.sharedMailboxes).add(mailbox);
}

/* ── IMAP ─────────────────────────────────────────────────────────────────────────────────── */

export async function connectImap(
  context: MailContext,
  input: { presetId: string; emailAddress: string; password: string; username?: string | null; kind?: MailAccountKind; accountId?: string | null },
): Promise<MailAccount> {
  const kind = input.kind === 'shared' ? 'shared' : 'personal';
  if (kind === 'shared' && !context.caps.canAdministerConnections) throw new AccessDeniedError('Connecting a shared mailbox requires Mail Hub › Settings › Administer.');
  if (kind === 'personal' && !context.caps.canConnectAccount && !input.accountId) throw new AccessDeniedError('Connecting a mailbox requires Mail Hub › Accounts › Connect.');
  const settings = await adminSettings();
  if (!settings.enabledProviders.includes('imap')) throw new MailHubError('The company mailbox option has been disabled by your administrator.', 403);
  const resolved = resolveImapPreset(settings.imapServers, input.presetId, input.emailAddress);
  if (!resolved.ok) throw new MailHubError(resolved.reason, 400);
  if (!input.password || input.password.length > 1024) throw new MailHubError('Enter the mailbox password.', 400);

  const emailAddress = normalizeEmail(input.emailAddress);
  const username = imapLogin(resolved.preset, emailAddress, input.username);
  const adapter = new ImapAdapter({ preset: resolved.preset, username, password: input.password, emailAddress });
  try {
    await adapter.verifyCredentials();
  } finally {
    await adapter.close();
  }

  const id = input.accountId ?? accountDocId(context.userId, 'imap', emailAddress, kind);
  const existing = await getOne<MailAccount>(C.accounts, id);
  if (existing && existing.ownerUserId !== context.userId && !(existing.kind === 'shared' && context.caps.canAdministerConnections)) {
    throw new MailHubError('That mailbox could not be found.', 404);
  }
  let account =
    existing ??
    newAccount({
      id,
      ownerUserId: context.userId,
      ownerName: context.userName,
      organizationId: context.organizationId,
      provider: 'imap',
      kind,
      emailAddress,
      loginIdentity: emailAddress,
      displayName: null,
      providerAccountId: `imap:${resolved.preset.imapHost}:${username}`,
      grantedScopes: [],
      imapServerId: resolved.preset.id,
      syncWindowDays: settings.defaultSyncWindowDays,
    });
  account = { ...account, status: 'connecting', statusReason: null, imapServerId: resolved.preset.id, disconnectedAt: null, updatedAt: new Date().toISOString() };

  await storeCredential({ accountId: id, ownerUserId: account.ownerUserId, provider: 'imap', payload: { type: 'password', username, password: input.password } });
  await db().collection(C.accounts).doc(id).set(clean(account));
  if (kind === 'shared') await ensureSharedMailboxRecord(account, context.userId);
  await ensureWatch(account);
  await enqueueSync(id, 'connected');
  await audit(context, existing ? 'account.reconnect' : 'account.connect', `${existing ? 'Reconnected' : 'Connected'} ${emailAddress} (IMAP via ${resolved.preset.label})`, { accountId: id });
  return account;
}

/* ── disconnect and purge ─────────────────────────────────────────────────────────────────── */

export async function disconnectAccount(context: MailContext, resolved: ResolvedMailbox): Promise<{ revoked: boolean; message: string }> {
  const { account } = resolved;
  let revoked = false;

  // 1. Stop notifications while the grant still works.
  try {
    const adapter = await adapterForAccount(account);
    try {
      if (account.watch.kind === 'gmail-watch' || account.watch.kind === 'graph-subscription') await adapter.stopWatch?.(account.watch.subscriptionId);
    } finally {
      await adapter.close?.().catch(() => {});
    }
  } catch {
    // An already-dead grant cannot stop anything; the subscription expires on its own.
  }
  // 2. Revoke at the provider (Google), 3. forget the secret, 4. mark disconnected.
  if (account.provider === 'gmail' || account.provider === 'microsoft') revoked = await revokeOAuthGrant(account.id, account.provider);
  await deleteCredential(account.id);
  const now = new Date().toISOString();
  await db()
    .collection(C.accounts)
    .doc(account.id)
    .set(
      {
        status: 'disconnected',
        statusReason: `Disconnected by ${context.userName}`,
        disconnectedAt: now,
        updatedAt: now,
        watch: { kind: 'none', subscriptionId: null, expiresAt: null, nextPollAt: null, lastNotificationAt: null, lastError: null },
      },
      { merge: true },
    );

  // Purge now, and once more shortly after in case an in-flight sync wrote after the first pass.
  await jobQueue.enqueue({ type: 'account.purge', accountId: account.id, dedupeKey: `purge:${account.id}` });
  await jobQueue.enqueue({ type: 'account.purge', accountId: account.id, dedupeKey: `purge2:${account.id}`, runAt: new Date(Date.now() + 10 * 60_000).toISOString() });
  await audit(context, 'account.disconnect', `Disconnected ${account.emailAddress}`, { accountId: account.id, sharedMailboxId: resolved.sharedMailbox?.id ?? null, detail: { revoked } });

  const message =
    account.provider === 'gmail'
      ? revoked
        ? 'Disconnected, and Google confirmed the ERP’s access is revoked.'
        : 'Disconnected. Google did not confirm the revocation — check myaccount.google.com/permissions to be certain.'
      : account.provider === 'microsoft'
        ? 'Disconnected, and the ERP’s stored access was deleted. To remove the app’s consent entirely, visit myapps.microsoft.com.'
        : 'Disconnected, and the stored password was deleted. Change the mailbox password if it may have been shared.';
  return { revoked, message };
}

export async function purgeAccount(accountId: string): Promise<{ deleted: number }> {
  const account = await getOne<MailAccount>(C.accounts, accountId);
  // Only a disconnected account is purged; a reconnect between the two passes cancels the second.
  if (!account || account.status !== 'disconnected') return { deleted: 0 };
  let deleted = 0;
  deleted += await deleteWhere(C.bodies, 'accountId', accountId, 100_000);
  deleted += await deleteWhere(C.messages, 'accountId', accountId, 100_000);
  deleted += await deleteWhere(C.folders, 'accountId', accountId);
  deleted += await deleteWhere(C.cursors, 'accountId', accountId);

  // Drafts and scheduled sends die with the connection, and so do their uploaded attachments.
  const outbound = await db().collection(C.outbound).where('accountId', '==', accountId).where('status', 'in', ['draft', 'scheduled', 'queued', 'failed']).get();
  for (const doc of outbound.docs) {
    const uploads = (doc.get('attachments') as { uploadId: string }[] | undefined) ?? [];
    await deleteUploads(uploads.map((entry) => entry.uploadId));
    await doc.ref.set({ status: 'cancelled', lastError: 'The mailbox was disconnected.', updatedAt: new Date().toISOString() }, { merge: true });
  }

  if (account.kind === 'personal') {
    deleted += await deleteWhere(C.notes, 'accountId', accountId);
    deleted += await deleteWhere(C.threads, 'accountId', accountId, 100_000);
  } else {
    // Keep the team's queue; drop what described the mail itself.
    for (;;) {
      const page = await db().collection(C.threads).where('accountId', '==', accountId).where('snippet', '!=', '').limit(400).get();
      if (page.empty) break;
      const batch = db().batch();
      page.docs.forEach((doc) => batch.set(doc.ref, { snippet: '', searchTokens: [], participants: [], viewKeys: [] }, { merge: true }));
      await batch.commit();
      if (page.size < 400) break;
    }
  }
  return { deleted };
}

export async function deleteUploads(uploadIds: string[]): Promise<void> {
  for (const uploadId of uploadIds) {
    const snapshot = await db().collection(C.uploads).doc(uploadId).get();
    const path = snapshot.get('storagePath') as string | undefined;
    if (path) await getFirebaseAdminBucket().file(path).delete({ ignoreNotFound: true }).catch(() => {});
    await snapshot.ref.delete().catch(() => {});
  }
}

export async function listAccountViews(context: MailContext, readable: ResolvedMailbox[]): Promise<(MailAccountView & { access: { canRead: boolean; canSend: boolean; canModify: boolean; canManage: boolean; via: string; reason: string | null }; sharedMailboxId: string | null; sharedMailboxName: string | null })[]> {
  const managed = context.caps.canAdministerConnections
    ? (await db().collection(C.accounts).where('kind', '==', 'shared').get()).docs.map((doc) => ({ ...(doc.data() as MailAccount), id: doc.id }))
    : (await db().collection(C.accounts).where('ownerUserId', '==', context.userId).where('kind', '==', 'shared').get()).docs.map((doc) => ({ ...(doc.data() as MailAccount), id: doc.id }));
  const byId = new Map(readable.map((entry) => [entry.account.id, entry]));
  const rows = readable.map((entry) => ({
    ...toAccountView(entry.account),
    access: {
      canRead: entry.decision.canRead,
      canSend: entry.decision.canSend,
      canModify: entry.decision.canModify,
      canManage: entry.decision.canManageConnection,
      via: entry.decision.via,
      reason: entry.decision.reason,
    },
    sharedMailboxId: entry.sharedMailbox?.id ?? null,
    sharedMailboxName: entry.sharedMailbox?.name ?? null,
  }));
  for (const account of managed) {
    if (byId.has(account.id)) continue;
    rows.push({
      ...toAccountView(account),
      access: { canRead: false, canSend: false, canModify: false, canManage: true, via: 'none', reason: 'You manage this connection but are not a member of the shared mailbox.' },
      sharedMailboxId: null,
      sharedMailboxName: null,
    });
  }
  return rows;
}


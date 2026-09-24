import 'server-only';

/**
 * Mail Hub — the server's request context, access resolution, provider factory and audit.
 *
 * Every API route starts with `mailContext(request)` and reaches mail only through
 * `requireMailbox`, which is where `decideMailboxAccess` is applied to real documents. There is no
 * other way for a route to load an account's messages, so there is no route that can forget the
 * check — and the check is made before a single message document is read.
 *
 * A denied mailbox answers **404, not 403**. "This mailbox exists but is not yours" is itself
 * information about a colleague's mail; "not found" is the same answer an id that never existed
 * gets.
 */

import { FieldValue } from 'firebase-admin/firestore';

import {
  AccessDeniedError,
  accessErrorResponse,
  authenticateAccess,
  type AccessRequestContext,
} from '../access-control-server';
import { getFirebaseAdminFirestore } from '../firebase-admin';
import { gmailPubSubTopic } from './config';
import { accessTokenFor, forgetAccessToken } from './oauth';
import {
  DEFAULT_MAIL_ADMIN_SETTINGS,
  DEFAULT_MAIL_USER_SETTINGS,
  MAIL_HUB_COLLECTIONS as C,
  MAIL_HUB_SETTINGS_DOC_ID,
  type MailAccount,
  type MailAuditAction,
  type MailHubAdminSettings,
  type MailMailboxMember,
  type MailSharedMailbox,
  type MailUserSettings,
} from './model';
import { decideMailboxAccess, mailHubCapabilities, type MailboxAccessDecision, type MailHubCapabilities } from './permissions';
import { GmailAdapter } from './providers/gmail';
import { GraphAdapter } from './providers/graph';
import { ImapAdapter } from './providers/imap';
import { ProviderAuthError, type MailProviderAdapter } from './providers/types';
import { imapLogin } from './rules';
import { readCredential, SecretUnavailableError } from './secrets';
import { clean, db, getOne, jobQueue } from './store';

export class MailHubError extends Error {
  readonly status: number;
  readonly detail: string | null;
  constructor(message: string, status = 400, detail: string | null = null) {
    super(message);
    this.name = 'MailHubError';
    this.status = status;
    this.detail = detail;
  }
}

export interface MailContext extends AccessRequestContext {
  caps: MailHubCapabilities;
}

export async function mailContext(request: Request, options: { requireModule?: boolean } = {}): Promise<MailContext> {
  const context = await authenticateAccess(request);
  const caps = mailHubCapabilities(context.access);
  if (options.requireModule !== false && !caps.canOpenModule && !caps.canConnectAccount) {
    throw new AccessDeniedError('Access to Mail Hub is required.');
  }
  return { ...context, caps };
}

export function requireCap(context: MailContext, allowed: boolean, what: string): void {
  if (!allowed) throw new AccessDeniedError(`${what} requires a Mail Hub permission you do not hold.`);
}

/** The JSON error every route returns. Provider and configuration failures say what to do. */
export function mailErrorResponse(error: unknown, operation: string): Response {
  if (error instanceof MailHubError) {
    return Response.json({ error: error.message, ...(error.detail ? { detail: error.detail } : {}) }, { status: error.status });
  }
  if (error instanceof SecretUnavailableError) {
    console.error(`[mail-hub] ${operation}: secret store unavailable`, error.message);
    return Response.json({ error: 'Mail Hub cannot read its stored credentials on this server.', detail: error.message }, { status: 503 });
  }
  if (error instanceof ProviderAuthError) {
    return Response.json({ error: error.message, detail: error.detail, action: 'reconnect' }, { status: 409 });
  }
  if (error instanceof Error && error.name.startsWith('Provider')) {
    return Response.json({ error: error.message }, { status: error.name === 'ProviderNotFoundError' ? 404 : 502 });
  }
  const { message, status } = accessErrorResponse(error);
  if (status >= 500) console.error(`[mail-hub] ${operation} failed`, error);
  return Response.json({ error: message }, { status });
}

/* ── settings ─────────────────────────────────────────────────────────────────────────────── */

export async function adminSettings(): Promise<MailHubAdminSettings> {
  const stored = await getOne<MailHubAdminSettings>(C.settings, MAIL_HUB_SETTINGS_DOC_ID);
  return { ...DEFAULT_MAIL_ADMIN_SETTINGS, ...(stored ?? {}) };
}

export async function userSettings(userId: string): Promise<MailUserSettings> {
  const stored = await getOne<MailUserSettings>(C.userSettings, userId);
  return { ...DEFAULT_MAIL_USER_SETTINGS, ...(stored ?? {}), userId, updatedAt: stored?.updatedAt ?? new Date(0).toISOString() };
}

/* ── mailbox access ───────────────────────────────────────────────────────────────────────── */

export interface ResolvedMailbox {
  account: MailAccount;
  decision: MailboxAccessDecision;
  sharedMailbox: MailSharedMailbox | null;
  membership: MailMailboxMember | null;
}

export const memberDocId = (sharedMailboxId: string, userId: string) => `${sharedMailboxId}__${userId}`;

export async function resolveMailbox(context: MailContext, accountId: string): Promise<ResolvedMailbox | null> {
  const account = await getOne<MailAccount>(C.accounts, accountId);
  if (!account) return null;
  let sharedMailbox: MailSharedMailbox | null = null;
  let membership: MailMailboxMember | null = null;
  if (account.kind === 'shared') {
    const snapshot = await db().collection(C.sharedMailboxes).where('accountId', '==', account.id).limit(1).get();
    sharedMailbox = snapshot.empty ? null : ({ ...(snapshot.docs[0].data() as MailSharedMailbox), id: snapshot.docs[0].id });
    if (sharedMailbox) membership = await getOne<MailMailboxMember>(C.members, memberDocId(sharedMailbox.id, context.userId));
  }
  const decision = decideMailboxAccess({ viewerId: context.userId, capabilities: context.caps, account, sharedMailbox, membership });
  return { account, decision, sharedMailbox, membership };
}

type Need = 'read' | 'modify' | 'send' | 'notes' | 'assign' | 'manage';

export async function requireMailbox(context: MailContext, accountId: string, need: Need = 'read'): Promise<ResolvedMailbox> {
  const resolved = accountId ? await resolveMailbox(context, accountId) : null;
  const d = resolved?.decision;
  const allowed =
    !!d &&
    (need === 'read'
      ? d.canRead
      : need === 'modify'
        ? d.canModify
        : need === 'send'
          ? d.canSend
          : need === 'notes'
            ? d.canAddNotes
            : need === 'assign'
              ? d.canAssign || d.canWorkOwnAssignment
              : d.canManageConnection);
  if (!resolved || !allowed) {
    // Readable (or manageable) but not this action: 403 with the reason.
    if (resolved && (d?.canRead || d?.canManageConnection)) throw new AccessDeniedError(d.reason ?? 'You cannot do that in this mailbox.');
    // Otherwise 404. Only a member — who already knows the mailbox exists — is told why.
    throw new MailHubError('Mailbox not found.', 404, resolved?.membership ? (d?.reason ?? null) : null);
  }
  return resolved;
}

/** Every account the caller can read: their own, plus shared mailboxes they are a verified member of. */
export async function readableAccounts(context: MailContext): Promise<ResolvedMailbox[]> {
  const own = await db().collection(C.accounts).where('ownerUserId', '==', context.userId).get();
  const memberships = await db().collection(C.members).where('userId', '==', context.userId).get();
  const out: ResolvedMailbox[] = [];
  const seen = new Set<string>();
  for (const doc of own.docs) {
    const account = { ...(doc.data() as MailAccount), id: doc.id };
    if (account.kind === 'shared') continue;
    const decision = decideMailboxAccess({ viewerId: context.userId, capabilities: context.caps, account });
    out.push({ account, decision, sharedMailbox: null, membership: null });
    seen.add(account.id);
  }
  for (const doc of memberships.docs) {
    const membership = { ...(doc.data() as MailMailboxMember), id: doc.id };
    const sharedMailbox = await getOne<MailSharedMailbox>(C.sharedMailboxes, membership.sharedMailboxId);
    if (!sharedMailbox || seen.has(sharedMailbox.accountId)) continue;
    const account = await getOne<MailAccount>(C.accounts, sharedMailbox.accountId);
    if (!account) continue;
    const decision = decideMailboxAccess({ viewerId: context.userId, capabilities: context.caps, account, sharedMailbox, membership });
    out.push({ account, decision, sharedMailbox, membership });
    seen.add(account.id);
  }
  return out;
}

/* ── provider adapters ────────────────────────────────────────────────────────────────────── */

export async function adapterForAccount(account: MailAccount): Promise<MailProviderAdapter> {
  if (account.provider === 'imap') {
    const credential = await readCredential(account.id);
    if (!credential || credential.type !== 'password') throw new ProviderAuthError('No stored password for this mailbox.');
    const settings = await adminSettings();
    const preset = settings.imapServers.find((entry) => entry.id === account.imapServerId);
    if (!preset) throw new ProviderAuthError('The mail server this mailbox used is no longer configured.', 'Ask your administrator, then reconnect.');
    return new ImapAdapter({
      preset,
      username: credential.username || imapLogin(preset, account.emailAddress),
      password: credential.password,
      emailAddress: account.emailAddress,
    });
  }
  const tokens = {
    get: () => accessTokenFor(account),
    invalidate: () => forgetAccessToken(account.id),
  };
  if (account.provider === 'gmail') return new GmailAdapter(tokens, { pubsubTopic: gmailPubSubTopic() });
  // A shared Microsoft 365 mailbox reached through a delegate's login.
  const delegated = account.loginIdentity && account.loginIdentity.toLowerCase() !== account.emailAddress.toLowerCase();
  return new GraphAdapter(tokens, delegated ? account.emailAddress : null);
}

export async function withAdapter<T>(account: MailAccount, task: (adapter: MailProviderAdapter) => Promise<T>): Promise<T> {
  const adapter = await adapterForAccount(account);
  try {
    return await task(adapter);
  } catch (error) {
    if (error instanceof ProviderAuthError && account.status !== 'reauth_required' && account.status !== 'disconnected') {
      await db().collection(C.accounts).doc(account.id).set({ status: 'reauth_required', statusReason: error.detail ?? error.message, updatedAt: new Date().toISOString() }, { merge: true });
    }
    throw error;
  } finally {
    await adapter.close?.().catch(() => {});
  }
}

/* ── jobs ─────────────────────────────────────────────────────────────────────────────────── */

export function enqueueSync(accountId: string, reason: string, delayMs = 0) {
  return jobQueue.enqueue({
    type: 'sync',
    accountId,
    dedupeKey: `sync:${accountId}`,
    payload: { reason },
    runAt: new Date(Date.now() + delayMs).toISOString(),
  });
}

/* ── audit ────────────────────────────────────────────────────────────────────────────────── */

/**
 * Append an audit event. Append-only: the collection's rules deny every client write, and no
 * server code path updates or deletes an event — including account purge, which keeps them.
 */
export async function audit(
  actor: { userId: string; userName: string },
  action: MailAuditAction,
  summary: string,
  refs: { accountId?: string | null; sharedMailboxId?: string | null; threadId?: string | null; messageId?: string | null; detail?: Record<string, unknown> } = {},
): Promise<void> {
  try {
    await db().collection(C.audit).add(
      clean({
        action,
        actorId: actor.userId,
        actorName: actor.userName,
        accountId: refs.accountId ?? null,
        sharedMailboxId: refs.sharedMailboxId ?? null,
        threadId: refs.threadId ?? null,
        messageId: refs.messageId ?? null,
        summary: summary.slice(0, 500),
        detail: refs.detail ?? {},
        at: new Date().toISOString(),
      }),
    );
  } catch (error) {
    // An audit failure is logged loudly but does not fail the user's action — except for sends
    // from a shared mailbox, which `compose-service` audits *before* sending.
    console.error('[mail-hub] audit write failed', action, error);
  }
}

/**
 * "Who viewed" for shared mailboxes, without writing an event on every click: one event per
 * person, thread and hour, keyed deterministically so concurrent opens collapse.
 */
export async function auditSharedView(context: MailContext, resolved: ResolvedMailbox, threadId: string): Promise<void> {
  if (!resolved.sharedMailbox) return;
  const hour = new Date().toISOString().slice(0, 13);
  const id = `view__${threadId}__${context.userId}__${hour}`.replace(/[^A-Za-z0-9_-]/g, '_');
  await db()
    .collection(C.audit)
    .doc(id)
    .create({
      action: 'shared.thread.view',
      actorId: context.userId,
      actorName: context.userName,
      accountId: resolved.account.id,
      sharedMailboxId: resolved.sharedMailbox.id,
      threadId,
      messageId: null,
      summary: `Viewed a thread in ${resolved.sharedMailbox.name}`,
      detail: {},
      at: new Date().toISOString(),
    })
    .catch((error: { code?: number }) => {
      if (error?.code !== 6) console.error('[mail-hub] view audit failed', error);
    });
}

export const serverTimestamp = () => FieldValue.serverTimestamp();
export const firestore = () => getFirebaseAdminFirestore();

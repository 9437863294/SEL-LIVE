import 'server-only';

/**
 * Mail Hub — drafts, sending, scheduling and uploads.
 *
 * ── Which account sends ────────────────────────────────────────────────────────────────────────
 *
 * From a personal mailbox: that mailbox, and only as its own address or a send-as identity the
 * provider has verified (`mayUseFromAddress`).
 *
 * From a shared mailbox: **the member's own connected account**, with the shared address as From.
 * The shared mailbox's syncing credentials never send on a member's behalf. That makes the provider
 * the final judge of impersonation — Gmail refuses a From that is not an accepted send-as alias,
 * Exchange refuses `/users/{shared}/sendMail` without SendAs/SendOnBehalf, and a correctly
 * configured SMTP server refuses a mismatched sender — on top of the ERP's own two checks.
 *
 * Sends from a shared mailbox are audited *before* the provider is called and again with the
 * outcome, so "who sent this from accounts@" is answerable even if the process dies mid-send.
 */

import { createHash, randomBytes } from 'node:crypto';

import { authenticateUserById } from '../access-control-server';
import { dispatchNotificationServer } from '../notifications-server';
import { getFirebaseAdminBucket } from '../firebase-admin';
import { deleteUploads } from './accounts-service';
import { buildOutgoingContent, validateSchedule, type ComposeRequest } from './compose';
import { buildRawMessage } from './mime';
import {
  MAIL_HUB_ACTIVITY_MODULE,
  MAIL_HUB_COLLECTIONS as C,
  type MailAccount,
  type MailMessage,
  type MailOutbound,
  type MailSignature,
  type MailUpload,
} from './model';
import { canSeeContent, mailHubCapabilities, mayUseFromAddress } from './permissions';
import {
  emailDomain,
  forwardSubject,
  outboundMessageId,
  plainTextToHtml,
  quotedBlock,
  replyRecipients,
  replySubject,
  sanitizeFilename,
  validateAttachment,
  validateCompose,
} from './rules';
import { sanitizeMailHtml } from './sanitize';
import { scanBytes } from './scan';
import { executeSend, type SendDeps, type SendOutcome } from './send-engine';
import {
  MailHubError,
  adapterForAccount,
  adminSettings,
  audit,
  enqueueSync,
  requireMailbox,
  withAdapter,
  type MailContext,
  type ResolvedMailbox,
} from './server';
import { clean, db, getMany, getOne, jobQueue, sendStore } from './store';

/* ── quoting and prefill ──────────────────────────────────────────────────────────────────── */

/** The source body as quotable HTML: sanitised, links left pointing where the sender meant. */
async function quotableBody(account: MailAccount, message: MailMessage): Promise<string> {
  const body = await withAdapter(account, (adapter) => adapter.fetchBody(message.providerMessageId));
  if (body.html) return sanitizeMailHtml(body.html, { allowRemoteContent: true, rewriteLinks: false }).html;
  return plainTextToHtml(body.text ?? message.snippet);
}

export async function composePrefill(resolved: ResolvedMailbox, message: MailMessage, mode: 'reply' | 'replyAll' | 'forward') {
  const own = [resolved.account.emailAddress, ...resolved.account.identities.map((identity) => identity.address), ...(resolved.sharedMailbox ? [resolved.sharedMailbox.address] : [])];
  const recipients = mode === 'forward' ? { to: [], cc: [] } : replyRecipients(message, own, mode);
  const quoted = quotedBlock(message, await quotableBody(resolved.account, message), mode);
  return {
    mode,
    to: recipients.to,
    cc: recipients.cc,
    subject: mode === 'forward' ? forwardSubject(message.subject) : replySubject(message.subject),
    quotedHtml: quoted,
    forwardableAttachments: mode === 'forward' ? message.attachments.filter((entry) => !entry.inline && !entry.blocked) : [],
    fromAddress: resolved.sharedMailbox ? resolved.sharedMailbox.address : resolved.account.emailAddress,
  };
}

/* ── the sending account ──────────────────────────────────────────────────────────────────── */

interface SendingPlan {
  /** The mailbox the message is composed in (and whose thread it joins). */
  source: ResolvedMailbox;
  /** The account whose provider login transmits it. */
  sender: ResolvedMailbox;
  fromAddress: string;
  fromName: string | null;
}

async function planSending(context: MailContext, request: ComposeRequest, intent: 'draft' | 'send' | 'schedule'): Promise<SendingPlan> {
  const source = await requireMailbox(context, request.accountId, 'read');
  const forSend = intent !== 'draft';

  if (source.account.kind === 'personal') {
    if (forSend && !source.decision.canSend) throw new MailHubError('Sending requires Mail Hub › Compose › Send, and an active connection.', 403);
    const fromAddress = request.fromAddress || source.account.emailAddress;
    if (!mayUseFromAddress(source.account, fromAddress)) {
      throw new MailHubError(`${source.account.emailAddress} is not allowed to send as ${fromAddress}. Only addresses your provider has verified can be used.`, 403);
    }
    const identity = source.account.identities.find((entry) => entry.address === fromAddress);
    return { source, sender: source, fromAddress, fromName: identity?.name ?? source.account.displayName ?? context.userName };
  }

  const mailbox = source.sharedMailbox;
  if (!mailbox) throw new MailHubError('Mailbox not found.', 404);
  if (!source.decision.canModify) throw new MailHubError('Readers of this shared mailbox cannot compose from it.', 403);
  if (forSend && !source.decision.canSend) {
    throw new MailHubError(
      source.decision.reason ??
        'Sending from this shared mailbox needs Mail Hub › Shared Mail › Send, send rights on your membership, and a provider-verified send grant on your own connected account.',
      403,
    );
  }
  const memberAccountId = source.membership?.memberAccountId;
  const sender = memberAccountId ? await requireMailbox(context, memberAccountId, forSend ? 'send' : 'read') : null;
  if (forSend && (!sender || sender.account.kind !== 'personal' || sender.account.provider !== source.account.provider)) {
    throw new MailHubError('Connect your own account with the same provider as this shared mailbox, and re-verify your membership, before sending from it.', 403);
  }
  return { source, sender: sender ?? source, fromAddress: mailbox.address, fromName: mailbox.name };
}

/* ── saving ───────────────────────────────────────────────────────────────────────────────── */

export async function saveOutbound(
  context: MailContext,
  request: ComposeRequest,
  intent: 'draft' | 'send' | 'schedule',
): Promise<{ outbound: MailOutbound; result: SendOutcome | null }> {
  const plan = await planSending(context, request, intent);
  const settings = await adminSettings();
  const now = new Date();

  let existing: MailOutbound | null = null;
  if (request.outboundId) {
    existing = await getOne<MailOutbound>(C.outbound, request.outboundId);
    if (!existing || existing.ownerUserId !== context.userId) throw new MailHubError('Draft not found.', 404);
    if (!['draft', 'scheduled', 'failed'].includes(existing.status)) throw new MailHubError('This message has already been sent or is being sent.', 409);
  }

  // Source message: must live in the mailbox being composed in.
  let source: MailMessage | null = null;
  if (request.mode !== 'new' && request.sourceMessageId) {
    source = await getOne<MailMessage>(C.messages, request.sourceMessageId);
    if (!source || source.accountId !== plan.source.account.id) throw new MailHubError('The message being answered was not found.', 404);
  }

  // Signature: yours, or your department's.
  let signatureHtml: string | null = null;
  if (request.signatureId) {
    const signature = await getOne<MailSignature>(C.signatures, request.signatureId);
    const visible = signature && canSeeContent({ viewerId: context.userId, viewerDepartmentIds: context.departmentIds, scope: signature.scope, ownerId: signature.ownerId, departmentId: signature.departmentId });
    if (!signature || !visible) throw new MailHubError('That signature is not available to you.', 404);
    signatureHtml = signature.html;
  }

  // Uploaded attachments: yours only.
  const uploads = [...(await getMany<MailUpload>(C.uploads, request.uploadIds)).values()].filter((upload) => upload.ownerUserId === context.userId);
  if (uploads.length !== request.uploadIds.length) throw new MailHubError('An attachment was not found. Upload it again.', 404);
  const forwarded =
    request.mode === 'forward' && source
      ? (existing?.forwardedAttachments ?? source.attachments.filter((entry) => !entry.inline && !entry.blocked).map((entry) => ({ attachmentId: entry.id, filename: entry.filename, contentType: entry.contentType, size: entry.size })))
      : [];
  const attachmentBytes = uploads.reduce((sum, upload) => sum + upload.size, 0) + forwarded.reduce((sum, entry) => sum + entry.size, 0);

  const quotedHtml = source && request.includeQuote ? quotedBlock(source, await quotableBody(plan.source.account, source), request.mode as 'reply' | 'replyAll' | 'forward') : null;
  const content = buildOutgoingContent({ bodyHtml: request.bodyHtml, signatureHtml, quotedHtml });

  const errors = validateCompose({
    to: request.to,
    cc: request.cc,
    bcc: request.bcc,
    subject: request.subject,
    html: content.html,
    attachmentBytes,
    maxAttachmentBytes: Math.min(plan.sender.account.capabilities.maxAttachmentBytes, settings.maxAttachmentBytes),
    forSend: intent !== 'draft',
  });
  if (intent === 'schedule') {
    const scheduleError = request.scheduledAt ? validateSchedule(request.scheduledAt, now) : 'Choose when to send it.';
    if (scheduleError) errors.push(scheduleError);
  }
  if (errors.length) throw new MailHubError(errors[0], 400, errors.slice(1).join(' ') || null);

  const id = existing?.id ?? db().collection(C.outbound).doc().id;
  const sameAccountThread = source && plan.sender.account.id === source.accountId;
  const outbound: MailOutbound = {
    id,
    ownerUserId: context.userId,
    ownerName: context.userName,
    accountId: plan.sender.account.id,
    sourceAccountId: plan.source.account.id,
    sharedMailboxId: plan.source.sharedMailbox?.id ?? null,
    fromAddress: plan.fromAddress,
    fromName: plan.fromName,
    to: request.to,
    cc: request.cc,
    bcc: request.bcc,
    subject: request.subject,
    html: content.html,
    text: content.text,
    composerBodyHtml: sanitizeMailHtml(request.bodyHtml, { allowRemoteContent: true, rewriteLinks: false }).html,
    signatureId: request.signatureId,
    includeQuote: request.includeQuote,
    attachments: uploads.map((upload) => ({ uploadId: upload.id, filename: upload.filename, contentType: upload.contentType, size: upload.size })),
    forwardedAttachments: forwarded,
    mode: request.mode,
    sourceMessageId: source?.id ?? null,
    threadId: source?.threadId ?? null,
    providerThreadId: sameAccountThread ? (source?.providerThreadId ?? null) : null,
    inReplyTo: request.mode === 'forward' ? null : (source?.internetMessageId ?? null),
    references: source && request.mode !== 'forward' ? [...source.references, ...(source.internetMessageId ? [source.internetMessageId] : [])].slice(-20) : [],
    // Fixed once. Every retry sends this same id, which is what makes duplicate detection possible.
    messageIdHeader: existing?.messageIdHeader ?? outboundMessageId(id, emailDomain(plan.fromAddress), randomBytes(6).toString('hex')),
    status: intent === 'draft' ? 'draft' : intent === 'schedule' ? 'scheduled' : 'queued',
    scheduledAt: intent === 'schedule' ? request.scheduledAt : null,
    attempts: existing?.attempts ?? 0,
    leaseUntil: null,
    lastError: null,
    providerMessageId: null,
    providerDraftId: existing?.providerDraftId ?? null,
    sentAt: null,
    aiAssisted: request.aiAssisted || Boolean(existing?.aiAssisted),
    createdAt: existing?.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString(),
  };
  await db().collection(C.outbound).doc(id).set(clean(outbound));
  // Uploads attached to a message live as long as the message needs them.
  for (const upload of uploads) await db().collection(C.uploads).doc(upload.id).set({ expiresAt: new Date(now.getTime() + 400 * 86_400_000).toISOString() }, { merge: true });

  if (intent === 'draft') {
    void mirrorDraft(plan.sender.account, outbound).catch(() => {});
    return { outbound, result: null };
  }

  if (intent === 'schedule') {
    await jobQueue.enqueue({ type: 'send.outbound', dedupeKey: `send:${id}`, payload: { outboundId: id }, runAt: outbound.scheduledAt as string });
    await audit(context, 'scheduled.create', `Scheduled "${outbound.subject}" for ${outbound.scheduledAt}`, {
      accountId: outbound.accountId,
      sharedMailboxId: outbound.sharedMailboxId,
      threadId: outbound.threadId,
      detail: { outboundId: id, recipients: outbound.to.length + outbound.cc.length + outbound.bcc.length },
    });
    return { outbound, result: null };
  }

  if (outbound.sharedMailboxId) {
    await audit(context, 'send.shared', `Sending "${outbound.subject}" from ${outbound.fromAddress}`, {
      accountId: outbound.sourceAccountId,
      sharedMailboxId: outbound.sharedMailboxId,
      threadId: outbound.threadId,
      detail: { outboundId: id, phase: 'attempt', via: outbound.accountId, to: outbound.to.map((entry) => entry.address) },
    });
  }
  const result = await executeSend(sendDeps(), id);
  if (result.status === 'retry') {
    await jobQueue.enqueue({ type: 'send.outbound', dedupeKey: `send:${id}`, payload: { outboundId: id }, runAt: new Date(Date.now() + (result.retryAfterMs ?? 60_000)).toISOString() });
  }
  return { outbound: { ...outbound, status: result.status === 'sent' || result.status === 'duplicate-prevented' ? 'sent' : result.status === 'failed' ? 'failed' : 'queued' }, result };
}

async function mirrorDraft(account: MailAccount, outbound: MailOutbound): Promise<void> {
  if (!account.capabilities.drafts || account.status !== 'active') return;
  const adapter = await adapterForAccount(account);
  try {
    if (!adapter.saveDraft) return;
    const raw = await buildRaw(outbound, { includeAttachments: false });
    const { providerDraftId } = await adapter.saveDraft(raw, outbound.providerDraftId);
    await db().collection(C.outbound).doc(outbound.id).set({ providerDraftId }, { merge: true });
  } finally {
    await adapter.close?.().catch(() => {});
  }
}

export async function discardDraft(context: MailContext, outboundId: string): Promise<void> {
  const outbound = await getOne<MailOutbound>(C.outbound, outboundId);
  if (!outbound || outbound.ownerUserId !== context.userId) throw new MailHubError('Draft not found.', 404);
  if (outbound.status !== 'draft' && outbound.status !== 'failed') throw new MailHubError('Only drafts can be discarded.', 409);
  await db().collection(C.outbound).doc(outboundId).set({ status: 'cancelled', updatedAt: new Date().toISOString() }, { merge: true });
  await deleteUploads(outbound.attachments.map((entry) => entry.uploadId));
  const account = await getOne<MailAccount>(C.accounts, outbound.accountId);
  if (account && outbound.providerDraftId) {
    await withAdapter(account, async (adapter) => adapter.deleteDraft?.(outbound.providerDraftId as string)).catch(() => {});
  }
}

export async function cancelScheduled(context: MailContext, outboundId: string): Promise<void> {
  const ref = db().collection(C.outbound).doc(outboundId);
  const outcome = await db().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const outbound = snapshot.exists ? ({ ...(snapshot.data() as MailOutbound), id: snapshot.id }) : null;
    if (!outbound || outbound.ownerUserId !== context.userId) return 'missing';
    // The compare-and-set that makes "cancel a second before it goes" safe: once the send claim has
    // moved it to `sending`, it is too late, and the user is told so instead of being told it worked.
    if (outbound.status !== 'scheduled') return outbound.status;
    tx.set(ref, { status: 'draft', scheduledAt: null, updatedAt: new Date().toISOString() }, { merge: true });
    return 'ok';
  });
  if (outcome === 'missing') throw new MailHubError('Scheduled message not found.', 404);
  if (outcome !== 'ok') throw new MailHubError(outcome === 'sent' || outcome === 'sending' ? 'Too late — this message has already been sent.' : 'This message is not scheduled.', 409);
  const outbound = await getOne<MailOutbound>(C.outbound, outboundId);
  await audit(context, 'scheduled.cancel', `Cancelled scheduled "${outbound?.subject ?? ''}"`, { accountId: outbound?.accountId, sharedMailboxId: outbound?.sharedMailboxId, detail: { outboundId } });
}

/* ── building and sending ─────────────────────────────────────────────────────────────────── */

async function buildRaw(outbound: MailOutbound, options: { includeAttachments?: boolean } = {}): Promise<Buffer> {
  const attachments: { filename: string; contentType: string; content: Uint8Array }[] = [];
  if (options.includeAttachments !== false) {
    const uploads = await getMany<MailUpload>(C.uploads, outbound.attachments.map((entry) => entry.uploadId));
    for (const entry of outbound.attachments) {
      const upload = uploads.get(entry.uploadId);
      if (!upload) throw new MailHubError(`The attachment ${entry.filename} is no longer available.`, 410);
      const [content] = await getFirebaseAdminBucket().file(upload.storagePath).download();
      attachments.push({ filename: upload.filename, contentType: upload.contentType, content });
    }
    if (outbound.forwardedAttachments.length && outbound.sourceMessageId && outbound.sourceAccountId) {
      const [source, account] = await Promise.all([getOne<MailMessage>(C.messages, outbound.sourceMessageId), getOne<MailAccount>(C.accounts, outbound.sourceAccountId)]);
      if (source && account) {
        await withAdapter(account, async (adapter) => {
          for (const entry of outbound.forwardedAttachments) {
            const meta = source.attachments.find((item) => item.id === entry.attachmentId);
            if (!meta || meta.blocked) continue;
            const file = await adapter.fetchAttachment(source.providerMessageId, meta.providerAttachmentId);
            attachments.push({ filename: sanitizeFilename(file.filename), contentType: file.contentType, content: file.content });
          }
        });
      }
    }
  }
  return buildRawMessage({
    from: { name: outbound.fromName, address: outbound.fromAddress },
    to: outbound.to,
    cc: outbound.cc,
    bcc: outbound.bcc,
    subject: outbound.subject,
    html: outbound.html,
    text: outbound.text,
    messageId: outbound.messageIdHeader,
    inReplyTo: outbound.inReplyTo,
    references: outbound.references.map((id) => `<${id.replace(/^<|>$/g, '')}>`),
    attachments,
    keepBcc: true,
  });
}

/**
 * Re-decide, at send time, whether the owner may still send this. The same `requireMailbox` checks
 * as the compose request, run against the owner's permissions and memberships *now*.
 */
async function authorizeAtSendTime(outbound: MailOutbound): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const access = await authenticateUserById(outbound.ownerUserId);
    const context: MailContext = { ...access, caps: mailHubCapabilities(access.access) };
    const sender = await requireMailbox(context, outbound.accountId, 'send');
    if (outbound.sharedMailboxId) {
      const source = await requireMailbox(context, outbound.sourceAccountId as string, 'send');
      if (source.sharedMailbox?.id !== outbound.sharedMailboxId || source.sharedMailbox.address !== outbound.fromAddress) return { ok: false, reason: 'The shared mailbox changed since this was written.' };
      if (source.membership?.memberAccountId !== sender.account.id) return { ok: false, reason: 'Your membership now sends through a different account.' };
    } else if (!mayUseFromAddress(sender.account, outbound.fromAddress)) {
      return { ok: false, reason: `This mailbox may no longer send as ${outbound.fromAddress}.` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'You may no longer send from this mailbox.' };
  }
}

export function sendDeps(): SendDeps {
  return {
    store: sendStore,
    adapterFor: async (outbound) => {
      const account = await getOne<MailAccount>(C.accounts, outbound.accountId);
      if (!account) throw new MailHubError('The sending mailbox no longer exists.', 410);
      return adapterForAccount(account);
    },
    buildRaw: (outbound) => buildRaw(outbound),
    authorize: authorizeAtSendTime,
    onSent: async (outbound, detail) => {
      const actor = { userId: outbound.ownerUserId, userName: outbound.ownerName };
      await audit(actor, outbound.sharedMailboxId ? 'send.shared' : 'send.personal', `Sent "${outbound.subject}" from ${outbound.fromAddress}`, {
        accountId: outbound.sourceAccountId ?? outbound.accountId,
        sharedMailboxId: outbound.sharedMailboxId,
        threadId: outbound.threadId,
        detail: { outboundId: outbound.id, phase: 'sent', duplicatePrevented: detail.verifiedDuplicate, scheduled: Boolean(outbound.scheduledAt), aiAssisted: outbound.aiAssisted },
      });
      // The provider has the message and its Sent copy; the ERP's copy of the files is no longer needed.
      await deleteUploads(outbound.attachments.map((entry) => entry.uploadId)).catch(() => {});
      if (outbound.providerDraftId) {
        const account = await getOne<MailAccount>(C.accounts, outbound.accountId);
        if (account) await withAdapter(account, async (adapter) => adapter.deleteDraft?.(outbound.providerDraftId as string)).catch(() => {});
      }
      await enqueueSync(outbound.accountId, 'sent', 3_000);
      if (outbound.sourceAccountId && outbound.sourceAccountId !== outbound.accountId) await enqueueSync(outbound.sourceAccountId, 'sent', 5_000);
    },
    onFailed: async (outbound, reason) => {
      await audit({ userId: outbound.ownerUserId, userName: outbound.ownerName }, 'send.failed', `Could not send "${outbound.subject}"`, {
        accountId: outbound.accountId,
        sharedMailboxId: outbound.sharedMailboxId,
        detail: { outboundId: outbound.id, reason },
      });
      await dispatchNotificationServer(
        { userIds: [outbound.ownerUserId] },
        {
          type: 'mail_send_failed',
          title: 'An email could not be sent',
          body: `"${outbound.subject || '(no subject)'}" was not sent: ${reason}`,
          module: MAIL_HUB_ACTIVITY_MODULE,
          severity: 'WARNING',
          itemId: outbound.id,
          link: '/mail/drafts',
        },
      );
    },
  };
}

/* ── uploads ──────────────────────────────────────────────────────────────────────────────── */

export async function storeUpload(context: MailContext, file: File): Promise<MailUpload> {
  const settings = await adminSettings();
  const filename = sanitizeFilename(file.name);
  const contentType = (file.type || 'application/octet-stream').toLowerCase();
  const verdict = validateAttachment({ filename: file.name, contentType, size: file.size }, { maxBytes: settings.maxAttachmentBytes });
  if (!verdict.ok) throw new MailHubError(verdict.reason, 400);
  const content = new Uint8Array(await file.arrayBuffer());
  const scan = await scanBytes(content, filename);
  if (scan.status === 'infected') throw new MailHubError('This file contains malware and cannot be attached.', 400);
  if (scan.status === 'unavailable') throw new MailHubError('The attachment scanner is unavailable. Try again in a few minutes.', 503);

  const id = db().collection(C.uploads).doc().id;
  const storagePath = `mail-hub/uploads/${context.userId}/${id}/${filename}`;
  await getFirebaseAdminBucket().file(storagePath).save(Buffer.from(content), {
    contentType,
    resumable: false,
    metadata: { contentDisposition: 'attachment', metadata: { ownerUserId: context.userId } },
  });
  const now = new Date();
  const upload: MailUpload = {
    id,
    ownerUserId: context.userId,
    filename,
    contentType,
    size: content.byteLength,
    storagePath,
    sha256: createHash('sha256').update(content).digest('hex'),
    scanStatus: scan.status,
    createdAt: now.toISOString(),
    // An upload never attached to a saved message is abandoned after this long.
    expiresAt: new Date(now.getTime() + settings.uploadRetentionDays * 86_400_000).toISOString(),
  };
  await db().collection(C.uploads).doc(id).set(upload);
  return upload;
}

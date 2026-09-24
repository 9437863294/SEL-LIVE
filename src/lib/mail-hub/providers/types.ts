/**
 * The contract every mail provider adapter implements.
 *
 * The sync engine, the send pipeline and the API routes speak only this interface. Gmail's history
 * ids, Graph's delta links and IMAP's MODSEQ values pass through it as opaque cursor strings, and
 * provider message ids as opaque `providerMessageId`s — nothing above this line parses them.
 *
 * Errors are typed because the engine's recovery depends on *which* failure happened:
 *
 *   - `ProviderAuthError`      → the grant is gone; mark `reauth_required`, stop retrying.
 *   - `ProviderRateLimitError` → keep everything applied so far, retry after `retryAfterMs`.
 *   - `ProviderCursorExpiredError` → the cursor is unusable; rebuild with a recovery listing.
 *   - `ProviderUnavailableError`   → transient; exponential backoff.
 *   - `ProviderNotFoundError`  → the message is gone; treat as a removal.
 *
 * Pure types plus error classes — no I/O — so tests can build fake adapters against it.
 */

import type {
  MailAddress,
  MailCursorKind,
  MailFolderRole,
  MailIdentity,
  MailProvider,
  MailProviderCapabilities,
} from '../model.ts';

export class ProviderError extends Error {
  constructor(message: string, readonly detail: string | null = null) {
    super(message);
    this.name = 'ProviderError';
  }
}

export class ProviderAuthError extends ProviderError {
  constructor(message = 'The provider rejected the stored authorization.', detail: string | null = null) {
    super(message, detail);
    this.name = 'ProviderAuthError';
  }
}

export class ProviderRateLimitError extends ProviderError {
  constructor(readonly retryAfterMs: number, message = 'The provider is rate-limiting requests.') {
    super(message);
    this.name = 'ProviderRateLimitError';
  }
}

export class ProviderCursorExpiredError extends ProviderError {
  constructor(readonly scope: string, message = 'The sync cursor is no longer valid.') {
    super(message);
    this.name = 'ProviderCursorExpiredError';
  }
}

export class ProviderUnavailableError extends ProviderError {
  constructor(message = 'The provider is unavailable.', detail: string | null = null) {
    super(message, detail);
    this.name = 'ProviderUnavailableError';
  }
}

export class ProviderNotFoundError extends ProviderError {
  constructor(message = 'The item no longer exists at the provider.') {
    super(message);
    this.name = 'ProviderNotFoundError';
  }
}

export class ProviderUnsupportedError extends ProviderError {
  constructor(message = 'This mailbox does not support that action.') {
    super(message);
    this.name = 'ProviderUnsupportedError';
  }
}

/* ── shapes ───────────────────────────────────────────────────────────────────────────────── */

export interface ProviderFolder {
  providerFolderId: string;
  name: string;
  role: MailFolderRole;
  kind: 'folder' | 'label';
  parentProviderFolderId: string | null;
  unreadCount: number | null;
  totalCount: number | null;
  /** Whether the engine should list and track this folder. */
  synced: boolean;
  imap?: { uidValidity: string | null; uidNext: number | null; highestModSeq: string | null } | null;
}

export interface ProviderAttachmentMeta {
  providerAttachmentId: string;
  filename: string;
  contentType: string;
  size: number;
  inline: boolean;
  contentId: string | null;
}

export interface ProviderMessageHeader {
  /** Identity of the ERP document. Stable across label/flag changes (and, for Graph, moves). */
  stableKey: string;
  providerMessageId: string;
  providerThreadId: string | null;
  /** Conversation identity: Gmail thread id, Graph conversation id, IMAP References root. */
  threadKey: string;
  providerFolderIds: string[];
  internetMessageId: string | null;
  inReplyTo: string | null;
  references: string[];
  from: MailAddress | null;
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  replyTo: MailAddress[];
  subject: string;
  snippet: string;
  sentAt: string | null;
  receivedAt: string;
  isRead: boolean;
  isFlagged: boolean;
  isDraft: boolean;
  attachments: ProviderAttachmentMeta[];
  sizeBytes: number | null;
  providerVersion: string | null;
}

/**
 * One change.
 *
 * `authoritative` means the header's folder list is the complete truth (Gmail labels). A `folder`
 * scope means "this message is (or is no longer) in this folder" — the only statement Graph's
 * per-folder delta and IMAP's per-folder state can make.
 */
export type ProviderChange =
  | { kind: 'upsert'; header: ProviderMessageHeader; scope: 'authoritative' | { folder: string } }
  | { kind: 'remove'; stableKey: string; scope: 'global' | { folder: string } };

export interface ProviderCursor {
  scope: string;
  kind: MailCursorKind;
  value: string;
}

export interface ProviderListPage {
  changes: ProviderChange[];
  nextPageToken: string | null;
  /** Graph's delta listing ends in a delta link — the folder's first cursor. */
  cursor?: ProviderCursor | null;
  /** Ids whose metadata could not be fetched; the engine retries them later. */
  failedIds?: string[];
}

export interface ProviderChangePage {
  changes: ProviderChange[];
  cursor: ProviderCursor;
  more: boolean;
  failedIds?: string[];
}

export interface ProviderProfile {
  emailAddress: string;
  displayName: string | null;
  providerAccountId: string;
  identities: MailIdentity[];
}

export interface ProviderMessageBody {
  html: string | null;
  text: string | null;
  attachments: ProviderAttachmentMeta[];
}

export interface ProviderAttachmentContent {
  filename: string;
  contentType: string;
  content: Uint8Array;
}

export type ProviderMessageAction =
  | { type: 'markRead'; value: boolean }
  | { type: 'flag'; value: boolean }
  | { type: 'archive' }
  | { type: 'trash' }
  | { type: 'untrash' }
  | { type: 'delete' }
  | { type: 'move'; providerFolderId: string }
  | { type: 'labels'; add: string[]; remove: string[] };

export interface ProviderSendInput {
  /** RFC 5322 message, already built by `mime.ts`. */
  raw: Uint8Array;
  messageIdHeader: string;
  providerThreadId: string | null;
  /** Graph: sending as a shared mailbox the member's own login has SendAs on. */
  sendAsMailbox: string | null;
}

export interface ProviderWatchResult {
  kind: 'gmail-watch' | 'graph-subscription' | 'imap-poll';
  subscriptionId: string | null;
  expiresAt: string | null;
  /** Gmail returns the history id the watch starts from. */
  cursor?: ProviderCursor | null;
}

export interface ProviderGrantCheck {
  read: 'verified' | 'missing' | 'unverified';
  send: 'verified' | 'missing' | 'unverified';
  method: string;
  detail: string | null;
}

export interface MailProviderAdapter {
  readonly provider: MailProvider;
  readonly capabilities: MailProviderCapabilities;

  getProfile(): Promise<ProviderProfile>;
  listFolders(): Promise<ProviderFolder[]>;

  /** The folders (or `null` = the whole mailbox) a full listing walks, in order. */
  listingScopes(folders: ProviderFolder[]): (string | null)[];
  /** Cursors captured *before* a listing starts, so nothing that changes during it is lost. */
  baselineCursors(folders: ProviderFolder[]): Promise<ProviderCursor[]>;
  listPage(input: { scope: string | null; pageToken: string | null; since: string | null; pageSize: number }): Promise<ProviderListPage>;
  changesSince(cursor: ProviderCursor, folders: ProviderFolder[]): Promise<ProviderChangePage>;
  fetchHeader(providerMessageId: string): Promise<ProviderMessageHeader | null>;

  fetchBody(providerMessageId: string): Promise<ProviderMessageBody>;
  fetchAttachment(providerMessageId: string, providerAttachmentId: string): Promise<ProviderAttachmentContent>;
  modify(providerMessageId: string, action: ProviderMessageAction, folders: ProviderFolder[]): Promise<void>;

  send(input: ProviderSendInput): Promise<{ providerMessageId: string | null }>;
  /** Whether a message with this Message-ID is already in the sent mail — the duplicate-send check. */
  findSentByMessageId(messageIdHeader: string): Promise<boolean>;
  saveDraft?(raw: Uint8Array, existingDraftId: string | null): Promise<{ providerDraftId: string }>;
  deleteDraft?(providerDraftId: string): Promise<void>;
  search?(query: string, limit: number): Promise<ProviderMessageHeader[]>;

  watch?(input: { notificationUrl: string; clientState: string }): Promise<ProviderWatchResult>;
  stopWatch?(subscriptionId: string | null): Promise<void>;
  /** Revoke the grant at the provider. Returns whether the provider confirmed it. */
  revoke(): Promise<boolean>;
  verifyMailboxGrant?(sharedAddress: string): Promise<ProviderGrantCheck>;
  close?(): Promise<void>;
}

export const DEFAULT_CAPABILITIES: Record<MailProvider, MailProviderCapabilities> = {
  gmail: {
    labels: true,
    folders: false,
    archive: true,
    move: true,
    // `gmail.modify` can trash but not permanently delete — by design, least privilege.
    permanentDelete: false,
    drafts: true,
    serverSearch: true,
    pushNotifications: true,
    sendAs: true,
    flag: true,
    maxAttachmentBytes: 25 * 1024 * 1024,
  },
  microsoft: {
    labels: false,
    folders: true,
    archive: true,
    move: true,
    permanentDelete: true,
    drafts: true,
    serverSearch: true,
    pushNotifications: true,
    sendAs: true,
    flag: true,
    // `sendMail` with a MIME body is capped at 4 MB per request, base64 included.
    maxAttachmentBytes: 3 * 1024 * 1024,
  },
  imap: {
    labels: false,
    folders: true,
    archive: true,
    move: true,
    permanentDelete: true,
    drafts: true,
    serverSearch: true,
    pushNotifications: false,
    sendAs: false,
    flag: true,
    maxAttachmentBytes: 20 * 1024 * 1024,
  },
};

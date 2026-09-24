/**
 * Mail Hub — the common ERP mail model (docs/mail-hub.md).
 *
 * Everything the ERP stores about mail is described here, in one provider-neutral vocabulary. The
 * three providers each have their own identity scheme — Gmail message ids and label ids, Microsoft
 * Graph immutable ids and folder ids, IMAP `UIDVALIDITY:UID` pairs that change whenever a message
 * moves — and none of that is allowed to leak into the fields screens and workflows read. Where a
 * provider identifier has to be kept (to fetch a body, to move a message back), it lives in a field
 * whose name says so: `providerMessageId`, `providerFolderId`, `providerThreadId`.
 *
 * IMAP messages are keyed by location (`folder:UIDVALIDITY:UID`), so a move there is a removal and
 * an arrival. That is harmless for ERP workflows because links, notes and assignments hang off the
 * *thread*, whose key (the References root) survives any move.
 *
 * ── Who can read these documents ──────────────────────────────────────────────────────────────
 *
 * Nobody, directly. Every collection below is denied to the client SDK in `firestore.rules`; the
 * browser reaches mail only through `/api/mail-hub/*`, which decides access with
 * `mail-hub/permissions.ts`. That is deliberate rather than a convenience: a personal mailbox must
 * not become readable to an administrator merely because an administrator can edit roles, and a
 * Firestore rule that says "owner or admin" is exactly the rule this module exists to avoid.
 *
 * Pure: no imports, so it runs under `node --test` and in both server and browser bundles.
 */

/* ── providers ─────────────────────────────────────────────────────────────────────────────── */

export const MAIL_PROVIDERS = ['gmail', 'microsoft', 'imap'] as const;
export type MailProvider = (typeof MAIL_PROVIDERS)[number];

export const MAIL_PROVIDER_LABELS: Record<MailProvider, string> = {
  gmail: 'Google Workspace / Gmail',
  microsoft: 'Microsoft 365 / Outlook',
  imap: 'Company mailbox (IMAP/SMTP)',
};

/**
 * What a provider can do, as the UI needs to know it.
 *
 * Buttons are shown from this, not from the provider name, so an IMAP server without MOVE or a
 * Graph tenant that forbids a feature degrades by hiding the action rather than failing on click.
 */
export interface MailProviderCapabilities {
  /** Gmail labels: a message may carry several at once. */
  labels: boolean;
  /** Real folders: a message is in exactly one. */
  folders: boolean;
  archive: boolean;
  move: boolean;
  /** Permanent deletion (Gmail's `gmail.modify` scope deliberately cannot). */
  permanentDelete: boolean;
  drafts: boolean;
  /** Full-text search executed by the provider. */
  serverSearch: boolean;
  /** Webhook-style change notifications (Gmail watch, Graph subscriptions). */
  pushNotifications: boolean;
  /** Addresses other than the primary one that the provider lets this login send as. */
  sendAs: boolean;
  flag: boolean;
  maxAttachmentBytes: number;
}

/* ── accounts ──────────────────────────────────────────────────────────────────────────────── */

export type MailAccountKind = 'personal' | 'shared';

export type MailAccountStatus =
  /** OAuth or IMAP verification finished; the first sync has not. */
  | 'connecting'
  | 'active'
  /** The refresh token was revoked or expired, or the password changed. User action needed. */
  | 'reauth_required'
  /** Repeated non-auth failures (provider down, quota). The worker keeps retrying with backoff. */
  | 'error'
  | 'disconnected';

export type MailSyncPhase = 'idle' | 'initial' | 'incremental' | 'recovery' | 'paused';

export interface MailSyncState {
  phase: MailSyncPhase;
  initialSyncComplete: boolean;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  /** Earliest time the worker should try again, honouring provider `Retry-After`. */
  nextAttemptAt: string | null;
  /** Initial sync progress, for the status chip. */
  messagesSynced: number;
  /**
   * Initial/recovery listing position: which folder, which page. Saved after every page so a run
   * that hits its time budget or a rate limit resumes rather than starts over.
   */
  listing: { folderQueue: string[]; pageToken: string | null; since: string | null } | null;
  /** Message ids whose fetch failed; retried before the cursor moves again. Bounded. */
  pendingRefetch: string[];
  /** Incremented at the start of every full (initial or recovery) listing. */
  generation: number;
}

export interface MailWatchState {
  kind: 'gmail-watch' | 'graph-subscription' | 'imap-poll' | 'none';
  subscriptionId: string | null;
  expiresAt: string | null;
  /** Next scheduled poll for providers (or failed watches) that fall back to polling. */
  nextPollAt: string | null;
  lastNotificationAt: string | null;
  lastError: string | null;
}

export interface MailAccountSettings {
  /** How far back the initial sync reaches. */
  syncWindowDays: number;
  /** Whether opened bodies are cached; if false every open is a provider fetch. */
  cacheBodies: boolean;
}

export interface MailIdentity {
  address: string;
  name: string | null;
  /** Provider has confirmed this login may send as the address. */
  verified: boolean;
}

export interface MailAccount {
  id: string;
  ownerUserId: string;
  ownerName: string;
  organizationId: string;
  provider: MailProvider;
  kind: MailAccountKind;
  emailAddress: string;
  displayName: string | null;
  /** Gmail user id, Graph user id, or `imap:<host>:<login>`. */
  providerAccountId: string | null;
  status: MailAccountStatus;
  statusReason: string | null;
  capabilities: MailProviderCapabilities;
  grantedScopes: string[];
  identities: MailIdentity[];
  /** IMAP preset used, when provider is imap. */
  imapServerId: string | null;
  sync: MailSyncState;
  watch: MailWatchState;
  settings: MailAccountSettings;
  createdAt: string;
  updatedAt: string;
  disconnectedAt: string | null;
}

/** What `/api/mail-hub/accounts` returns. The same as the stored account minus nothing secret — no secret is ever on it. */
export type MailAccountView = Omit<MailAccount, 'organizationId'> & {
  recovery: MailRecoveryAdvice | null;
};

export interface MailRecoveryAdvice {
  severity: 'info' | 'warning' | 'error';
  title: string;
  steps: string[];
  action: 'reconnect' | 'retry' | 'wait' | 'contact-admin' | null;
}

/* ── folders ───────────────────────────────────────────────────────────────────────────────── */

export const MAIL_FOLDER_ROLES = ['inbox', 'sent', 'drafts', 'archive', 'trash', 'spam', 'all', 'custom'] as const;
export type MailFolderRole = (typeof MAIL_FOLDER_ROLES)[number];

export interface MailFolder {
  id: string;
  accountId: string;
  ownerUserId: string;
  providerFolderId: string;
  name: string;
  role: MailFolderRole;
  kind: 'folder' | 'label';
  parentId: string | null;
  unreadCount: number | null;
  totalCount: number | null;
  /** Folders the sync engine walks. Gmail labels are all synced through one listing. */
  synced: boolean;
  /** IMAP change-detection state for this folder. */
  imap: { uidValidity: string | null; uidNext: number | null; highestModSeq: string | null } | null;
  updatedAt: string;
}

/* ── messages and threads ─────────────────────────────────────────────────────────────────── */

export interface MailAddress {
  name: string | null;
  address: string;
}

export interface MailAttachmentMeta {
  id: string;
  /** Provider attachment id (Gmail/Graph) or MIME part path (IMAP). */
  providerAttachmentId: string;
  filename: string;
  contentType: string;
  size: number;
  inline: boolean;
  contentId: string | null;
  /** Result of `validateAttachment` against the policy; blocked files cannot be downloaded. */
  blocked: boolean;
  blockedReason: string | null;
  scanStatus: 'not-scanned' | 'clean' | 'infected' | 'unavailable';
}

export interface MailMessage {
  id: string;
  accountId: string;
  ownerUserId: string;
  sharedMailboxId: string | null;
  threadId: string;
  providerMessageId: string;
  providerThreadId: string | null;
  internetMessageId: string | null;
  inReplyTo: string | null;
  references: string[];
  folderIds: string[];
  /** Query keys: `acct:<id>:role:<role>`, `acct:<id>:folder:<id>`. See `messageViewKeys`. */
  viewKeys: string[];
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
  direction: 'inbound' | 'outbound';
  hasAttachments: boolean;
  attachments: MailAttachmentMeta[];
  sizeBytes: number | null;
  /** Gmail historyId / Graph changeKey / IMAP modseq — the version the stored copy reflects. */
  providerVersion: string | null;
  searchTokens: string[];
  bodyState: 'none' | 'cached';
  /** Soft delete: the provider no longer has it in any synced folder. */
  deleted: boolean;
  /**
   * The account's sync generation when this copy was last confirmed by a listing. After a recovery
   * relisting, anything in the window still carrying an older generation vanished at the provider
   * while the cursor was unusable, and is tombstoned.
   */
  syncGeneration: number;
  syncedAt: string;
}

/** Cached body. A separate document so lists never load it and retention can delete it alone. */
export interface MailMessageBody {
  messageId: string;
  accountId: string;
  ownerUserId: string;
  html: string | null;
  text: string | null;
  remoteContentCount: number;
  cachedAt: string;
  expiresAt: string;
}

export type MailAssignmentStatus = 'open' | 'pending' | 'closed';

export interface MailAssignment {
  assigneeId: string | null;
  assigneeName: string | null;
  status: MailAssignmentStatus;
  /** Response deadline. */
  dueAt: string | null;
  assignedAt: string | null;
  assignedById: string | null;
  assignedByName: string | null;
  departmentId: string | null;
}

export interface MailThread {
  id: string;
  accountId: string;
  ownerUserId: string;
  sharedMailboxId: string | null;
  providerThreadId: string | null;
  subject: string;
  snippet: string;
  participants: MailAddress[];
  messageCount: number;
  unreadCount: number;
  hasAttachments: boolean;
  isFlagged: boolean;
  lastMessageAt: string;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  firstInboundAt: string | null;
  /** First outbound reply after the first inbound message — the response-time measure. */
  firstResponseAt: string | null;
  /** The newest message is inbound and nobody has replied since. */
  awaitingReply: boolean;
  folderIds: string[];
  viewKeys: string[];
  searchTokens: string[];
  assignment: MailAssignment | null;
  linkCount: number;
  noteCount: number;
  deleted: boolean;
  updatedAt: string;
}

/* ── sync cursors ──────────────────────────────────────────────────────────────────────────── */

export type MailCursorKind = 'gmail-history' | 'graph-delta' | 'imap-modseq';

export interface MailSyncCursor {
  id: string;
  accountId: string;
  /** `account` for Gmail; the folder id for Graph and IMAP, which track change per folder. */
  scope: string;
  kind: MailCursorKind;
  value: string;
  updatedAt: string;
}

/* ── shared mailboxes ──────────────────────────────────────────────────────────────────────── */

export interface MailSharedMailbox {
  id: string;
  name: string;
  address: string;
  provider: MailProvider;
  /** The connected account (kind `shared`) used to sync it. Its credentials never send as a member. */
  accountId: string;
  departmentId: string | null;
  departmentName: string | null;
  /** Default response deadline for new inbound threads, in hours. 0 = none. */
  responseHours: number;
  active: boolean;
  createdAt: string;
  createdById: string;
  updatedAt: string;
}

export type MailMemberRole = 'reader' | 'responder' | 'manager';

export type MailProviderGrantStatus = 'verified' | 'missing' | 'unverified' | 'error';

export interface MailProviderGrant {
  read: MailProviderGrantStatus;
  send: MailProviderGrantStatus;
  /** How it was established — shown on the permissions page so an admin can judge it. */
  method: string | null;
  checkedAt: string | null;
  detail: string | null;
}

export interface MailMailboxMember {
  id: string;
  sharedMailboxId: string;
  userId: string;
  userName: string;
  role: MailMemberRole;
  /** ERP-side permission to send from this mailbox; the provider grant must also say yes. */
  canSend: boolean;
  /** The member's own connected account used to verify and exercise their provider grant. */
  memberAccountId: string | null;
  providerGrant: MailProviderGrant;
  grantedById: string;
  grantedAt: string;
  updatedAt: string;
}

/* ── ERP workflow records ──────────────────────────────────────────────────────────────────── */

export const MAIL_LINK_RECORD_TYPES = [
  'project',
  'employee',
  'vendor',
  'customer',
  'purchaseOrder',
  'invoice',
  'approval',
  'siteAccountStatement',
  'task',
  'meeting',
] as const;
export type MailLinkRecordType = (typeof MAIL_LINK_RECORD_TYPES)[number];

export const MAIL_LINK_RECORD_LABELS: Record<MailLinkRecordType, string> = {
  project: 'Project',
  employee: 'Employee',
  vendor: 'Vendor',
  customer: 'Customer',
  purchaseOrder: 'Purchase order',
  invoice: 'Invoice / bill',
  approval: 'E-Approval',
  siteAccountStatement: 'Site account statement',
  task: 'Task',
  meeting: 'Meeting',
};

export interface MailRecordLink {
  id: string;
  threadId: string;
  messageId: string | null;
  accountId: string;
  ownerUserId: string;
  sharedMailboxId: string | null;
  recordType: MailLinkRecordType;
  recordId: string;
  /** Full document path for collection-group records (POs, bills). */
  recordPath: string;
  recordLabel: string;
  /** Kept so the ERP record still says what the email was after the mailbox is disconnected. */
  snapshot: { subject: string; from: string | null; date: string | null };
  createdById: string;
  createdByName: string;
  createdAt: string;
}

/**
 * An internal note on a thread.
 *
 * Its own collection, never a field of a message or draft: the send pipeline builds outgoing mail
 * from the composer's fields and the quoted message body only, so there is no code path by which a
 * note can be serialised into an email. `tests/mail-hub-send.test.mjs` pins that property.
 */
export interface MailInternalNote {
  id: string;
  threadId: string;
  accountId: string;
  sharedMailboxId: string | null;
  authorId: string;
  authorName: string;
  body: string;
  mentionUserIds: string[];
  createdAt: string;
}

export type MailPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface MailFollowUp {
  id: string;
  threadId: string;
  accountId: string;
  sharedMailboxId: string | null;
  subject: string;
  title: string;
  ownerId: string;
  ownerName: string;
  createdById: string;
  createdByName: string;
  dueAt: string;
  priority: MailPriority;
  /** Minutes before `dueAt` to remind the owner. */
  reminderOffsets: number[];
  status: 'open' | 'done' | 'cancelled';
  /** Set when an Office Hub task was created alongside the follow-up. */
  officeHubTaskId: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ── templates, signatures, rules ──────────────────────────────────────────────────────────── */

export type MailContentScope = 'personal' | 'department' | 'global';

export interface MailTemplate {
  id: string;
  name: string;
  subject: string;
  html: string;
  scope: MailContentScope;
  ownerId: string;
  departmentId: string | null;
  departmentName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MailSignature {
  id: string;
  name: string;
  html: string;
  scope: 'personal' | 'department';
  ownerId: string;
  departmentId: string | null;
  departmentName: string | null;
  /** Personal signatures only: the account it is the default for (`*` = every account). */
  defaultForAccountId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MailRoutingRule {
  id: string;
  sharedMailboxId: string;
  name: string;
  enabled: boolean;
  order: number;
  conditions: { fromContains: string | null; subjectContains: string | null; toContains: string | null };
  actions: { assignToUserId: string | null; assignToUserName: string | null; deadlineHours: number | null };
  createdById: string;
  updatedAt: string;
}

export interface MailUserSettings {
  userId: string;
  notifyOnAssignment: boolean;
  /** Minutes before a response deadline to warn the assignee. 0 = never. */
  deadlineWarningMinutes: number;
  /** Hours between repeat reminders for overdue replies. 0 = remind once. */
  overdueReminderHours: number;
  /** Opt-in: AI suggestions are unavailable until this is true. */
  aiOptIn: boolean;
  /** Load remote images automatically from these sender domains. Empty by default. */
  trustedImageDomains: string[];
  keyboardShortcuts: boolean;
  updatedAt: string;
}

export const DEFAULT_MAIL_USER_SETTINGS: Omit<MailUserSettings, 'userId' | 'updatedAt'> = {
  notifyOnAssignment: true,
  deadlineWarningMinutes: 120,
  overdueReminderHours: 24,
  aiOptIn: false,
  trustedImageDomains: [],
  keyboardShortcuts: true,
};

/** Administrator-managed module configuration (`mailHubSettings/global`). */
export interface MailHubAdminSettings {
  /** IMAP/SMTP servers users may connect to. Nothing else is reachable — see `imapServerAllowed`. */
  imapServers: MailImapServerPreset[];
  enabledProviders: MailProvider[];
  defaultSyncWindowDays: number;
  bodyCacheDays: number;
  /** Uploaded compose attachments are deleted this long after the send (or abandonment). */
  uploadRetentionDays: number;
  maxAttachmentBytes: number;
  updatedAt: string | null;
  updatedById: string | null;
}

export interface MailImapServerPreset {
  id: string;
  label: string;
  imapHost: string;
  imapPort: number;
  /** `tls` = implicit TLS (993); `starttls` = upgrade. Plain text is never offered. */
  imapSecurity: 'tls' | 'starttls';
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: 'tls' | 'starttls';
  /** Login is the full email address (most servers) or the local part. */
  usernameStyle: 'email' | 'local-part';
  /** Only addresses at these domains may connect through this preset. Empty = any. */
  allowedDomains: string[];
}

export const DEFAULT_MAIL_ADMIN_SETTINGS: MailHubAdminSettings = {
  imapServers: [],
  enabledProviders: ['gmail', 'microsoft', 'imap'],
  defaultSyncWindowDays: 90,
  bodyCacheDays: 14,
  uploadRetentionDays: 7,
  maxAttachmentBytes: 20 * 1024 * 1024,
  updatedAt: null,
  updatedById: null,
};

/* ── outbound ──────────────────────────────────────────────────────────────────────────────── */

export type MailComposeMode = 'new' | 'reply' | 'replyAll' | 'forward';

export type MailOutboundStatus =
  | 'draft'
  | 'scheduled'
  /** Handed to the worker (or the request) for sending. */
  | 'queued'
  /** A send attempt holds the lease. If it dies here, the retry verifies before resending. */
  | 'sending'
  | 'sent'
  | 'failed'
  | 'cancelled';

export interface MailOutboundAttachment {
  uploadId: string;
  filename: string;
  contentType: string;
  size: number;
}

export interface MailOutbound {
  id: string;
  ownerUserId: string;
  ownerName: string;
  accountId: string;
  /** Set when sending from a shared mailbox: the account whose provider grant sends it. */
  sharedMailboxId: string | null;
  fromAddress: string;
  fromName: string | null;
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  subject: string;
  html: string;
  text: string;
  attachments: MailOutboundAttachment[];
  mode: MailComposeMode;
  /** The message being replied to or forwarded. */
  sourceMessageId: string | null;
  threadId: string | null;
  providerThreadId: string | null;
  inReplyTo: string | null;
  references: string[];
  /** Generated once, at creation. Re-sends reuse it, which is how a retry detects a prior success. */
  messageIdHeader: string;
  status: MailOutboundStatus;
  scheduledAt: string | null;
  attempts: number;
  leaseUntil: string | null;
  lastError: string | null;
  providerMessageId: string | null;
  providerDraftId: string | null;
  sentAt: string | null;
  /** True when the body began as an AI suggestion. Recorded; never sent without a human pressing Send. */
  aiAssisted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MailUpload {
  id: string;
  ownerUserId: string;
  filename: string;
  contentType: string;
  size: number;
  storagePath: string;
  sha256: string;
  scanStatus: MailAttachmentMeta['scanStatus'];
  createdAt: string;
  expiresAt: string;
}

/* ── audit and jobs ────────────────────────────────────────────────────────────────────────── */

export const MAIL_AUDIT_ACTIONS = [
  'account.connect',
  'account.reconnect',
  'account.disconnect',
  'account.resync',
  'shared.create',
  'shared.update',
  'shared.member.grant',
  'shared.member.update',
  'shared.member.revoke',
  'shared.grant.verify',
  'shared.thread.view',
  'assignment.change',
  'note.add',
  'link.add',
  'link.remove',
  'followup.create',
  'followup.update',
  'send.personal',
  'send.shared',
  'send.failed',
  'scheduled.create',
  'scheduled.cancel',
  'template.change',
  'signature.change',
  'rule.change',
  'settings.change',
  'ai.suggest',
  'attachment.blocked',
] as const;
export type MailAuditAction = (typeof MAIL_AUDIT_ACTIONS)[number];

export interface MailAuditEvent {
  id: string;
  action: MailAuditAction;
  actorId: string;
  actorName: string;
  accountId: string | null;
  sharedMailboxId: string | null;
  threadId: string | null;
  messageId: string | null;
  summary: string;
  detail: Record<string, unknown>;
  at: string;
}

export const MAIL_JOB_TYPES = [
  'sync',
  'watch.renew',
  'send.outbound',
  'account.purge',
  'grants.verify',
  'notify.sweep',
  'retention.sweep',
] as const;
export type MailJobType = (typeof MAIL_JOB_TYPES)[number];

export type MailJobStatus = 'queued' | 'running' | 'done' | 'dead';

export interface MailJob {
  id: string;
  type: MailJobType;
  accountId: string | null;
  payload: Record<string, unknown>;
  status: MailJobStatus;
  runAt: string;
  attempts: number;
  maxAttempts: number;
  leaseUntil: string | null;
  /** A duplicate enqueue arrived while this job ran; run it once more when it finishes. */
  rerun: boolean;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ── collections ───────────────────────────────────────────────────────────────────────────── */

export const MAIL_HUB_COLLECTIONS = {
  accounts: 'mailHubAccounts',
  credentials: 'mailHubCredentials',
  oauthStates: 'mailHubOAuthStates',
  folders: 'mailHubFolders',
  messages: 'mailHubMessages',
  bodies: 'mailHubBodies',
  threads: 'mailHubThreads',
  cursors: 'mailHubSyncCursors',
  sharedMailboxes: 'mailHubSharedMailboxes',
  members: 'mailHubMailboxMembers',
  links: 'mailHubLinks',
  notes: 'mailHubNotes',
  followUps: 'mailHubFollowUps',
  templates: 'mailHubTemplates',
  signatures: 'mailHubSignatures',
  routingRules: 'mailHubRoutingRules',
  userSettings: 'mailHubUserSettings',
  settings: 'mailHubSettings',
  outbound: 'mailHubOutbound',
  uploads: 'mailHubUploads',
  audit: 'mailHubAuditEvents',
  jobs: 'mailHubJobs',
} as const;

export const MAIL_HUB_SETTINGS_DOC_ID = 'global';
export const MAIL_HUB_ACTIVITY_MODULE = 'Mail Hub';
export const MAIL_HUB_BASE_PATH = '/mail';

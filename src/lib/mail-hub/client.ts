'use client';

/**
 * Mail Hub — the browser's side. Every call is a `fetch` to `/api/mail-hub/*` carrying the user's
 * Firebase ID token. The browser holds no provider token, no mailbox password and reads no Mail
 * Hub collection directly (`firestore.rules` denies them all); it asks the server, which decides.
 */

import { auth } from '../firebase';
import type {
  MailAccountView,
  MailAddress,
  MailAttachmentMeta,
  MailAuditEvent,
  MailComposeMode,
  MailFolder,
  MailFollowUp,
  MailHubAdminSettings,
  MailImapServerPreset,
  MailInternalNote,
  MailLinkRecordType,
  MailMailboxMember,
  MailOutbound,
  MailPriority,
  MailRecordLink,
  MailRoutingRule,
  MailSharedMailbox,
  MailSignature,
  MailTemplate,
  MailUserSettings,
} from './model';
import type { MailHubCapabilities } from './permissions';

export class MailApiError extends Error {
  readonly status: number;
  readonly detail: string | null;
  readonly action: string | null;
  constructor(message: string, status: number, detail: string | null, action: string | null) {
    super(message);
    this.name = 'MailApiError';
    this.status = status;
    this.detail = detail;
    this.action = action;
  }
}

async function token(): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new MailApiError('Your session has expired. Sign in again.', 401, null, null);
  return user.getIdToken();
}

export async function mailFetch<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const response = await fetch(path, {
    ...rest,
    headers: {
      Authorization: `Bearer ${await token()}`,
      ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(rest.headers ?? {}),
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new MailApiError(String(data.error ?? `Request failed (${response.status}).`), response.status, (data.detail as string) ?? null, (data.action as string) ?? null);
  }
  return data as T;
}

/** Fetch a binary (attachment) with the bearer token, as a Blob. */
export async function mailBlob(path: string): Promise<{ blob: Blob; scanStatus: string | null }> {
  const response = await fetch(path, { headers: { Authorization: `Bearer ${await token()}` } });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new MailApiError(data.error ?? `Download failed (${response.status}).`, response.status, null, null);
  }
  return { blob: await response.blob(), scanStatus: response.headers.get('x-mail-scan-status') };
}

/* ── shapes the pages use ─────────────────────────────────────────────────────────────────── */

export type AccountRow = MailAccountView & {
  access: { canRead: boolean; canSend: boolean; canModify: boolean; canManage: boolean; via: string; reason: string | null };
  sharedMailboxId: string | null;
  sharedMailboxName: string | null;
};

export interface Bootstrap {
  user: { id: string; name: string; email: string | null; departmentIds: string[] };
  capabilities: MailHubCapabilities;
  accounts: AccountRow[];
  folders: Record<string, MailFolder[]>;
  providers: { provider: 'gmail' | 'microsoft' | 'imap'; label: string; enabled: boolean; available: boolean; problems: string[] }[];
  imapServers: Pick<MailImapServerPreset, 'id' | 'label' | 'allowedDomains' | 'usernameStyle'>[];
  settings: MailUserSettings;
  signatures: (MailSignature & { editable: boolean })[];
}

export interface ThreadSummary {
  id: string;
  accountId: string;
  sharedMailboxId: string | null;
  subject: string;
  snippet: string;
  participants: MailAddress[];
  messageCount: number;
  unreadCount: number;
  hasAttachments: boolean;
  isFlagged: boolean;
  lastMessageAt: string;
  awaitingReply: boolean;
  assignment: { assigneeId: string | null; assigneeName: string | null; status: 'open' | 'pending' | 'closed'; dueAt: string | null } | null;
  deadline: 'none' | 'on-track' | 'due-soon' | 'overdue' | 'answered';
  linkCount: number;
  noteCount: number;
}

export interface MessageItem {
  id: string;
  accountId: string;
  threadId: string;
  from: MailAddress | null;
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
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
  folderIds: string[];
}

export interface ThreadDetail {
  thread: ThreadSummary;
  account: { id: string; emailAddress: string; provider: string; kind: 'personal' | 'shared'; capabilities: MailAccountView['capabilities']; status: string };
  sharedMailbox: { id: string; name: string; address: string } | null;
  access: { canModify: boolean; canSend: boolean; canAssign: boolean; canWorkOwnAssignment: boolean; canAddNotes: boolean };
  messages: MessageItem[];
  links: (MailRecordLink & { href: string | null })[];
  notes: MailInternalNote[];
  followUps: MailFollowUp[];
}

export interface BodyView {
  html: string | null;
  text: string | null;
  remoteContentBlocked: number;
  suspiciousLinks: number;
  remoteAllowed: boolean;
  attachments: MailAttachmentMeta[];
}

export type SharedMailboxRow = MailSharedMailbox & {
  accountStatus: string;
  accountRecovery: string | null;
  membership: MailMailboxMember | null;
  access: { canRead: boolean; canSend: boolean; canAssign: boolean; reason: string | null };
};

/* ── calls ────────────────────────────────────────────────────────────────────────────────── */

const q = (params: Record<string, string | number | null | undefined | boolean>) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '' && value !== false) search.set(key, String(value));
  });
  const text = search.toString();
  return text ? `?${text}` : '';
};

export const mailApi = {
  bootstrap: () => mailFetch<Bootstrap>('/api/mail-hub/bootstrap'),
  accounts: () => mailFetch<{ accounts: AccountRow[] }>('/api/mail-hub/accounts'),
  connectImap: (input: { presetId: string; emailAddress: string; password: string; username?: string; kind?: 'personal' | 'shared'; accountId?: string }) =>
    mailFetch<{ message: string }>('/api/mail-hub/accounts', { method: 'POST', json: input }),
  authorizeUrl: (provider: 'gmail' | 'microsoft', params: { purpose: string; accountId?: string; address?: string; sharedMailboxId?: string; returnTo?: string }) =>
    mailFetch<{ authorizeUrl: string }>(`/api/mail-hub/oauth/${provider}/authorize${q(params)}`),
  syncAccount: (accountId: string, action: 'sync' | 'resync' = 'sync') => mailFetch<{ ran: string }>(`/api/mail-hub/accounts/${accountId}`, { method: 'POST', json: { action } }),
  disconnect: (accountId: string) => mailFetch<{ revoked: boolean; message: string }>(`/api/mail-hub/accounts/${accountId}`, { method: 'DELETE' }),

  threads: (params: { view?: string; accountId?: string | null; folderId?: string | null; filter?: string | null; before?: string | null; limit?: number }) =>
    mailFetch<{ threads: ThreadSummary[]; nextBefore: string | null }>(`/api/mail-hub/threads${q(params)}`),
  thread: (threadId: string) => mailFetch<ThreadDetail>(`/api/mail-hub/threads/${encodeURIComponent(threadId)}`),
  body: (messageId: string, remote = false) => mailFetch<BodyView>(`/api/mail-hub/messages/${encodeURIComponent(messageId)}/body${q({ remote: remote ? 1 : null })}`),
  attachmentUrl: (messageId: string, attachmentId: string, inline = false) =>
    `/api/mail-hub/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}${q({ inline: inline ? 1 : null })}`,
  action: (input: { threadId?: string; messageIds?: string[]; action: { type: string; value?: boolean; folderId?: string } }) =>
    mailFetch<{ applied: number; failed: string[] }>('/api/mail-hub/messages/actions', { method: 'POST', json: input }),
  search: (params: { q: string; scope?: 'local' | 'provider'; accountId?: string | null }) =>
    mailFetch<{ threads: ThreadSummary[]; notes: string[]; searchedProvider: boolean }>(`/api/mail-hub/search${q(params)}`),

  prefill: (messageId: string, mode: 'reply' | 'replyAll' | 'forward') =>
    mailFetch<{ to: MailAddress[]; cc: MailAddress[]; subject: string; quotedHtml: string; forwardableAttachments: MailAttachmentMeta[]; fromAddress: string }>(
      `/api/mail-hub/compose/prefill${q({ messageId, mode })}`,
    ),
  compose: (input: ComposePayload & { intent: 'draft' | 'send' | 'schedule' }) =>
    mailFetch<{ outbound: { id: string; status: string; scheduledAt: string | null }; message: string; result: { status: string; error?: string } | null }>('/api/mail-hub/compose', {
      method: 'POST',
      json: input,
    }),
  outbound: (status: string) => mailFetch<{ outbound: Omit<MailOutbound, 'html' | 'text'>[] }>(`/api/mail-hub/outbound${q({ status })}`),
  outboundOne: (id: string) => mailFetch<{ outbound: MailOutbound }>(`/api/mail-hub/outbound/${id}`),
  cancelScheduled: (id: string) => mailFetch<{ message: string }>(`/api/mail-hub/outbound/${id}`, { method: 'POST', json: { action: 'cancel' } }),
  discard: (id: string) => mailFetch(`/api/mail-hub/outbound/${id}`, { method: 'DELETE' }),
  upload: async (file: File) => {
    const form = new FormData();
    form.set('file', file);
    return mailFetch<{ upload: { id: string; filename: string; contentType: string; size: number; scanStatus: string } }>('/api/mail-hub/uploads', { method: 'POST', body: form });
  },

  assignment: (threadId: string, input: { assigneeId?: string | null; status?: string; dueAt?: string | null }) =>
    mailFetch(`/api/mail-hub/threads/${threadId}/assignment`, { method: 'PATCH', json: input }),
  addNote: (threadId: string, body: string, mentionUserIds: string[] = []) =>
    mailFetch<{ note: MailInternalNote }>(`/api/mail-hub/threads/${threadId}/notes`, { method: 'POST', json: { body, mentionUserIds } }),
  records: (type: MailLinkRecordType, query: string) =>
    mailFetch<{ records: { id: string; path: string; label: string; secondary: string; href: string }[] }>(`/api/mail-hub/records${q({ type, q: query })}`),
  addLink: (threadId: string, input: { recordType: MailLinkRecordType; recordPath: string; messageId?: string | null }) =>
    mailFetch(`/api/mail-hub/threads/${threadId}/links`, { method: 'POST', json: input }),
  removeLink: (linkId: string) => mailFetch(`/api/mail-hub/links/${encodeURIComponent(linkId)}`, { method: 'DELETE' }),
  addFollowUp: (threadId: string, input: { title: string; ownerId?: string | null; dueAt: string; priority: MailPriority; reminderOffsets: number[]; officeHubTaskId?: string | null }) =>
    mailFetch<{ followUp: MailFollowUp }>(`/api/mail-hub/threads/${threadId}/followups`, { method: 'POST', json: input }),
  updateFollowUp: (id: string, input: Partial<Pick<MailFollowUp, 'status' | 'dueAt' | 'priority'>>) => mailFetch(`/api/mail-hub/followups/${id}`, { method: 'PATCH', json: input }),
  tasks: () => mailFetch<{ followUps: MailFollowUp[]; assigned: ThreadSummary[] }>('/api/mail-hub/tasks'),

  templates: () => mailFetch<{ templates: (MailTemplate & { editable: boolean })[] }>('/api/mail-hub/templates'),
  saveTemplate: (input: Partial<MailTemplate>) => mailFetch<{ template: MailTemplate }>('/api/mail-hub/templates', { method: 'POST', json: input }),
  deleteTemplate: (id: string) => mailFetch(`/api/mail-hub/templates${q({ id })}`, { method: 'DELETE' }),
  signatures: () => mailFetch<{ signatures: (MailSignature & { editable: boolean })[] }>('/api/mail-hub/signatures'),
  saveSignature: (input: Partial<MailSignature>) => mailFetch<{ signature: MailSignature }>('/api/mail-hub/signatures', { method: 'POST', json: input }),
  deleteSignature: (id: string) => mailFetch(`/api/mail-hub/signatures${q({ id })}`, { method: 'DELETE' }),
  rules: (sharedMailboxId: string) => mailFetch<{ rules: MailRoutingRule[] }>(`/api/mail-hub/rules${q({ sharedMailboxId })}`),
  saveRule: (input: Partial<MailRoutingRule> & { sharedMailboxId: string }) => mailFetch<{ rule: MailRoutingRule }>('/api/mail-hub/rules', { method: 'POST', json: input }),
  deleteRule: (id: string) => mailFetch(`/api/mail-hub/rules${q({ id })}`, { method: 'DELETE' }),
  settings: () => mailFetch<{ settings: MailUserSettings }>('/api/mail-hub/settings'),
  saveSettings: (input: Partial<MailUserSettings>) => mailFetch<{ settings: MailUserSettings }>('/api/mail-hub/settings', { method: 'PUT', json: input }),
  adminSettings: () =>
    mailFetch<{ settings: MailHubAdminSettings; environment: { provider: string; available: boolean; problems: string[] }[] }>('/api/mail-hub/admin-settings'),
  saveAdminSettings: (input: Partial<MailHubAdminSettings>) => mailFetch<{ settings: MailHubAdminSettings }>('/api/mail-hub/admin-settings', { method: 'PUT', json: input }),

  shared: () => mailFetch<{ sharedMailboxes: SharedMailboxRow[] }>('/api/mail-hub/shared'),
  updateShared: (id: string, input: Partial<MailSharedMailbox>) => mailFetch(`/api/mail-hub/shared/${id}`, { method: 'PATCH', json: input }),
  members: (id: string) => mailFetch<{ members: MailMailboxMember[] }>(`/api/mail-hub/shared/${id}/members`),
  saveMember: (id: string, input: { userId: string; role: string; canSend: boolean }) => mailFetch(`/api/mail-hub/shared/${id}/members`, { method: 'POST', json: input }),
  removeMember: (id: string, userId: string) => mailFetch(`/api/mail-hub/shared/${id}/members/${userId}`, { method: 'DELETE' }),
  verifyMember: (id: string, userId: string, memberAccountId?: string | null) =>
    mailFetch<{ grant: MailMailboxMember['providerGrant'] }>(`/api/mail-hub/shared/${id}/members/${userId}`, { method: 'POST', json: { action: 'verify', memberAccountId } }),
  users: (query: string) => mailFetch<{ users: { id: string; name: string; email: string }[] }>(`/api/mail-hub/users${q({ q: query })}`),

  reports: (params: { from: string; to: string; sharedMailboxId?: string | null }) => mailFetch<MailReportView>(`/api/mail-hub/reports${q(params)}`),
  audit: (params: { sharedMailboxId?: string | null; mine?: boolean; before?: string | null }) =>
    mailFetch<{ events: MailAuditEvent[] }>(`/api/mail-hub/audit${q({ sharedMailboxId: params.sharedMailboxId, mine: params.mine ? 1 : null, before: params.before })}`),
  ai: (threadId: string, kind: 'summary' | 'reply', instructions?: string) =>
    mailFetch<{ text: string; kind: string; reviewRequired: true }>('/api/mail-hub/ai', { method: 'POST', json: { threadId, kind, instructions } }),
  linkCheck: (url: string, warning: string | null) =>
    mailFetch<{ url: string; host: string; warnings: string[]; verdict: 'safe' | 'unsafe' | 'unknown'; threats: string[]; checkedWithSafeBrowsing: boolean }>(
      `/api/mail-hub/link-check${q({ u: url, w: warning })}`,
    ),
};

export interface ComposePayload {
  outboundId?: string | null;
  accountId: string;
  sharedMailboxId?: string | null;
  fromAddress: string;
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  subject: string;
  bodyHtml: string;
  signatureId: string | null;
  includeQuote: boolean;
  mode: MailComposeMode;
  sourceMessageId: string | null;
  uploadIds: string[];
  scheduledAt: string | null;
  aiAssisted: boolean;
}

export interface MailReportView {
  assignedVolume: number;
  openWork: number;
  overdue: number;
  answered: number;
  medianResponseHours: number | null;
  averageResponseHours: number | null;
  byAssignee: { userId: string; name: string; open: number; overdue: number; closed: number; medianResponseHours: number | null }[];
  byDepartment: { department: string; open: number; overdue: number; assigned: number }[];
  followUps: { open: number; overdue: number; done: number };
  perMailbox: { id: string; name: string; address: string; assigned: number; open: number; overdue: number; medianResponseHours: number | null }[];
  mailboxes: { id: string; name: string }[];
}

/** Navigate to a provider's consent screen. */
export async function startOAuth(provider: 'gmail' | 'microsoft', params: Parameters<typeof mailApi.authorizeUrl>[1]) {
  const { authorizeUrl } = await mailApi.authorizeUrl(provider, params);
  window.location.assign(authorizeUrl);
}

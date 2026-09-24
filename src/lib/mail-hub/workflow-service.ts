import 'server-only';

/**
 * Mail Hub — the ERP side of mail: record links, internal notes, assignments, follow-ups,
 * templates, signatures, routing rules, shared-mailbox administration, reports and the audit trail.
 *
 * None of this is ever sent. Internal notes, assignments and follow-ups live in their own
 * collections, are written only through the functions below, and have no path into
 * `compose-service.ts` — see `compose.ts` for the other half of that guarantee.
 */

import { AccessDeniedError, authenticateUserById } from '../access-control-server';
import { canAccessModule } from '../access-control';
import { dispatchNotificationOnce, dispatchNotificationServer } from '../notifications-server';
import {
  MAIL_HUB_ACTIVITY_MODULE,
  MAIL_HUB_COLLECTIONS as C,
  MAIL_HUB_SETTINGS_DOC_ID,
  MAIL_LINK_RECORD_LABELS,
  MAIL_LINK_RECORD_TYPES,
  type MailAccount,
  type MailAssignment,
  type MailAuditEvent,
  type MailContentScope,
  type MailFollowUp,
  type MailHubAdminSettings,
  type MailImapServerPreset,
  type MailInternalNote,
  type MailLinkRecordType,
  type MailMailboxMember,
  type MailMemberRole,
  type MailPriority,
  type MailRecordLink,
  type MailRoutingRule,
  type MailSharedMailbox,
  type MailSignature,
  type MailTemplate,
  type MailThread,
  type MailUserSettings,
} from './model';
import { canEditContent, canSeeContent, decideMailboxAccess, grantIsFresh, mailHubCapabilities } from './permissions';
import {
  PRIORITY_RANK,
  buildMailReport,
  deadlineState,
  displayAddress,
  dueFollowUpReminders,
  stableHash,
} from './rules';
import { sanitizeMailHtml } from './sanitize';
import {
  MailHubError,
  adapterForAccount,
  adminSettings,
  audit,
  memberDocId,
  requireMailbox,
  resolveMailbox,
  userSettings,
  type MailContext,
} from './server';
import { clean, db, getMany, getOne } from './store';

const nowIso = () => new Date().toISOString();

export async function requireThread(context: MailContext, threadId: string, need: Parameters<typeof requireMailbox>[2] = 'read') {
  const thread = await getOne<MailThread>(C.threads, threadId);
  if (!thread) throw new MailHubError('Conversation not found.', 404);
  const resolved = await requireMailbox(context, thread.accountId, need);
  return { thread, resolved };
}

/* ── ERP record registry ──────────────────────────────────────────────────────────────────── */

interface RecordSource {
  collection: string;
  group?: boolean;
  /** Module the viewer must be able to open to link, or see, records of this type. */
  module: string;
  labelFields: string[];
  secondaryFields: string[];
  href: (id: string, path: string) => string;
}

const RECORDS: Record<MailLinkRecordType, RecordSource> = {
  project: { collection: 'projects', module: 'Project Management', labelFields: ['projectName', 'name', 'title'], secondaryFields: ['projectCode', 'code', 'clientName'], href: () => '/project-management' },
  employee: { collection: 'employees', module: 'Employee', labelFields: ['name', 'employeeName', 'fullName'], secondaryFields: ['employeeNo', 'designation', 'department'], href: (id) => `/employee/${id}` },
  vendor: { collection: 'vendors', module: 'Vendor Management', labelFields: ['name', 'vendorName', 'companyName'], secondaryFields: ['vendorCode', 'gstin', 'email'], href: () => '/vendor-management' },
  customer: { collection: 'clients', module: 'Project Management', labelFields: ['name', 'clientName', 'companyName'], secondaryFields: ['code', 'email'], href: () => '/project-management/settings/clients' },
  purchaseOrder: { collection: 'purchaseOrders', group: true, module: 'Project Management', labelFields: ['poNumber', 'poNo', 'reference', 'title'], secondaryFields: ['vendorName', 'status'], href: (id) => `/project-management/purchase-orders/${id}` },
  invoice: { collection: 'bills', group: true, module: 'Billing Recon', labelFields: ['billNo', 'billNumber', 'invoiceNo', 'reference'], secondaryFields: ['vendorName', 'status', 'amount'], href: () => '/billing-recon' },
  approval: { collection: 'eApprovalRequests', module: 'E-Approval', labelFields: ['referenceNo', 'reference', 'subject', 'title'], secondaryFields: ['subject', 'status'], href: (id) => `/e-approval/${id}` },
  siteAccountStatement: { collection: 'siteAccountProjects', module: 'Site Account Statement', labelFields: ['projectName', 'name', 'title'], secondaryFields: ['projectCode', 'code'], href: () => '/site-account-statement' },
  task: { collection: 'officeHubTasks', module: 'Office Hub', labelFields: ['title'], secondaryFields: ['reference', 'status'], href: (id) => `/office-hub/tasks/${id}` },
  meeting: { collection: 'officeHubMeetings', module: 'Office Hub', labelFields: ['title'], secondaryFields: ['date', 'status'], href: (id) => `/office-hub/meetings/${id}` },
};

const firstText = (data: Record<string, unknown>, fields: string[]) => {
  for (const field of fields) {
    const value = data[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return '';
};

function assertRecordAccess(context: MailContext, type: MailLinkRecordType): RecordSource {
  if (!MAIL_LINK_RECORD_TYPES.includes(type)) throw new MailHubError('Unknown record type.', 400);
  const source = RECORDS[type];
  if (!canAccessModule(context.access, source.module)) {
    throw new AccessDeniedError(`Linking to ${MAIL_LINK_RECORD_LABELS[type].toLowerCase()} records requires access to ${source.module}.`);
  }
  return source;
}

export async function searchRecords(context: MailContext, type: MailLinkRecordType, query: string) {
  const source = assertRecordAccess(context, type);
  const base = source.group ? db().collectionGroup(source.collection) : db().collection(source.collection);
  // A bounded scan, filtered in memory: none of these collections share a searchable field, and
  // a picker needs "contains", which Firestore cannot index. Recent-first where the field exists.
  const snapshot = await base.limit(400).get();
  const needle = query.trim().toLowerCase();
  return snapshot.docs
    .map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      const label = firstText(data, source.labelFields) || doc.id;
      const secondary = source.secondaryFields.map((field) => firstText(data, [field])).filter(Boolean).join(' · ');
      return { id: doc.id, path: doc.ref.path, label, secondary, href: source.href(doc.id, doc.ref.path) };
    })
    .filter((row) => !needle || `${row.label} ${row.secondary}`.toLowerCase().includes(needle))
    .slice(0, 25);
}

export async function addLink(context: MailContext, threadId: string, input: { recordType: MailLinkRecordType; recordPath: string; messageId?: string | null }) {
  const { thread, resolved } = await requireThread(context, threadId, 'read');
  const source = assertRecordAccess(context, input.recordType);
  // The path must be in the registered collection — never an arbitrary document the caller names.
  const segments = input.recordPath.split('/');
  if (segments.length % 2 !== 0 || segments[segments.length - 2] !== source.collection || (!source.group && segments.length !== 2)) {
    throw new MailHubError('That record is not of the chosen type.', 400);
  }
  const record = await db().doc(input.recordPath).get();
  if (!record.exists) throw new MailHubError('That record no longer exists.', 404);
  const id = `${threadId}__${input.recordType}__${stableHash(input.recordPath)}`;
  const firstMessage = await db().collection(C.messages).where('threadId', '==', threadId).orderBy('receivedAt').limit(1).get();
  const first = firstMessage.docs[0]?.data();
  const link: MailRecordLink = {
    id,
    threadId,
    messageId: input.messageId ?? null,
    accountId: thread.accountId,
    ownerUserId: resolved.account.ownerUserId,
    sharedMailboxId: thread.sharedMailboxId,
    recordType: input.recordType,
    recordId: record.id,
    recordPath: input.recordPath,
    recordLabel: firstText(record.data() ?? {}, source.labelFields) || record.id,
    snapshot: { subject: thread.subject, from: first?.from ? displayAddress(first.from) : null, date: first?.receivedAt ?? thread.lastMessageAt },
    createdById: context.userId,
    createdByName: context.userName,
    createdAt: nowIso(),
  };
  const created = await db().runTransaction(async (tx) => {
    const ref = db().collection(C.links).doc(id);
    if ((await tx.get(ref)).exists) return false;
    tx.set(ref, clean(link));
    tx.set(db().collection(C.threads).doc(threadId), { linkCount: (thread.linkCount ?? 0) + 1 }, { merge: true });
    return true;
  });
  if (created) await audit(context, 'link.add', `Linked "${thread.subject}" to ${MAIL_LINK_RECORD_LABELS[input.recordType]} ${link.recordLabel}`, { accountId: thread.accountId, sharedMailboxId: thread.sharedMailboxId, threadId });
  return { link, created };
}

export async function removeLink(context: MailContext, linkId: string) {
  const link = await getOne<MailRecordLink>(C.links, linkId);
  if (!link) throw new MailHubError('Link not found.', 404);
  const resolved = await requireMailbox(context, link.accountId, 'read');
  if (link.createdById !== context.userId && !resolved.decision.canAssign && resolved.decision.via !== 'owner') {
    throw new AccessDeniedError('Only whoever made the link, or someone who can assign in this mailbox, can remove it.');
  }
  await db().collection(C.links).doc(linkId).delete();
  const thread = await getOne<MailThread>(C.threads, link.threadId);
  if (thread) await db().collection(C.threads).doc(thread.id).set({ linkCount: Math.max(0, (thread.linkCount ?? 1) - 1) }, { merge: true });
  await audit(context, 'link.remove', `Unlinked ${link.recordLabel}`, { accountId: link.accountId, sharedMailboxId: link.sharedMailboxId, threadId: link.threadId });
}

export async function linksForThread(threadId: string) {
  const snapshot = await db().collection(C.links).where('threadId', '==', threadId).get();
  return snapshot.docs.map((doc) => {
    const link = { ...(doc.data() as MailRecordLink), id: doc.id };
    return { ...link, href: RECORDS[link.recordType]?.href(link.recordId, link.recordPath) ?? null };
  });
}

/**
 * The emails linked to an ERP record — for a panel on the record's own page. Only links whose
 * mailbox the viewer can read are returned; a colleague's personal mail linked to the same PO
 * stays invisible, and so does the fact that it exists.
 */
export async function linksForRecord(context: MailContext, type: MailLinkRecordType, recordId: string) {
  assertRecordAccess(context, type);
  const snapshot = await db().collection(C.links).where('recordType', '==', type).where('recordId', '==', recordId).limit(200).get();
  const decisions = new Map<string, boolean>();
  const out = [];
  for (const doc of snapshot.docs) {
    const link = { ...(doc.data() as MailRecordLink), id: doc.id };
    if (!decisions.has(link.accountId)) decisions.set(link.accountId, Boolean((await resolveMailbox(context, link.accountId))?.decision.canRead));
    if (decisions.get(link.accountId)) out.push(link);
  }
  return out;
}

/* ── internal notes ───────────────────────────────────────────────────────────────────────── */

export async function addNote(context: MailContext, threadId: string, input: { body: string; mentionUserIds?: string[] }) {
  const { thread, resolved } = await requireThread(context, threadId, 'notes');
  const body = input.body.replace(/\r\n/g, '\n').trim().slice(0, 5000);
  if (!body) throw new MailHubError('Write something first.', 400);
  const note: Omit<MailInternalNote, 'id'> = {
    threadId,
    accountId: thread.accountId,
    sharedMailboxId: thread.sharedMailboxId,
    authorId: context.userId,
    authorName: context.userName,
    body,
    mentionUserIds: [...new Set(input.mentionUserIds ?? [])].slice(0, 20),
    createdAt: nowIso(),
  };
  const ref = await db().collection(C.notes).add(note);
  await db().collection(C.threads).doc(threadId).set({ noteCount: (thread.noteCount ?? 0) + 1 }, { merge: true });
  if (thread.sharedMailboxId) {
    await audit(context, 'note.add', `Added an internal note on "${thread.subject}"`, { accountId: thread.accountId, sharedMailboxId: thread.sharedMailboxId, threadId });
    // Only members who can read the mailbox are told; a mention cannot widen who sees the note.
    const recipients: string[] = [];
    for (const userId of note.mentionUserIds.filter((id) => id !== context.userId)) {
      const member = await getOne<MailMailboxMember>(C.members, memberDocId(thread.sharedMailboxId, userId));
      if (member && grantIsFresh(member.providerGrant.read, member.providerGrant.checkedAt, new Date())) recipients.push(userId);
    }
    if (recipients.length) {
      await dispatchNotificationServer(
        { userIds: recipients },
        { type: 'mail_note_mention', title: `${context.userName} mentioned you`, body: `On "${thread.subject}" in ${resolved.sharedMailbox?.name ?? 'a shared mailbox'}`, module: MAIL_HUB_ACTIVITY_MODULE, itemId: threadId, link: `/mail/shared?thread=${threadId}` },
      );
    }
  }
  return { ...note, id: ref.id };
}

export async function notesForThread(threadId: string) {
  const snapshot = await db().collection(C.notes).where('threadId', '==', threadId).orderBy('createdAt').limit(200).get();
  return snapshot.docs.map((doc) => ({ ...(doc.data() as MailInternalNote), id: doc.id }));
}

/* ── assignment ───────────────────────────────────────────────────────────────────────────── */

export async function updateAssignment(
  context: MailContext,
  threadId: string,
  input: { assigneeId?: string | null; status?: MailAssignment['status']; dueAt?: string | null },
) {
  const { thread, resolved } = await requireThread(context, threadId, 'assign');
  if (!resolved.sharedMailbox) throw new MailHubError('Assignments are for shared mailboxes.', 400);
  const before = thread.assignment ?? { assigneeId: null, assigneeName: null, status: 'open', dueAt: null, assignedAt: null, assignedById: null, assignedByName: null, departmentId: resolved.sharedMailbox.departmentId };
  const next: MailAssignment = { ...before };
  const d = resolved.decision;

  if (input.assigneeId !== undefined && input.assigneeId !== before.assigneeId) {
    const takingItYourself = input.assigneeId === context.userId && !before.assigneeId;
    if (!d.canAssign && !takingItYourself) throw new AccessDeniedError('Assigning others requires Mail Hub › Shared Mail › Assign.');
    if (input.assigneeId) {
      const member = await getOne<MailMailboxMember>(C.members, memberDocId(resolved.sharedMailbox.id, input.assigneeId));
      if (!member || member.role === 'reader') throw new MailHubError('Assign it to a responder or manager of this mailbox.', 400);
      next.assigneeName = member.userName;
    } else {
      next.assigneeName = null;
    }
    next.assigneeId = input.assigneeId;
    next.assignedAt = nowIso();
    next.assignedById = context.userId;
    next.assignedByName = context.userName;
  }
  const ownsIt = before.assigneeId === context.userId || next.assigneeId === context.userId;
  if (input.status && input.status !== before.status) {
    if (!d.canAssign && !ownsIt) throw new AccessDeniedError('Only the assignee, or someone who can assign, can change the status.');
    next.status = input.status;
  }
  if (input.dueAt !== undefined && input.dueAt !== before.dueAt) {
    if (!d.canAssign && !ownsIt) throw new AccessDeniedError('Only the assignee, or someone who can assign, can change the deadline.');
    if (input.dueAt && Number.isNaN(Date.parse(input.dueAt))) throw new MailHubError('That deadline is not a valid date.', 400);
    next.dueAt = input.dueAt ? new Date(input.dueAt).toISOString() : null;
  }

  await db().collection(C.threads).doc(threadId).set({ assignment: clean(next), updatedAt: nowIso() }, { merge: true });
  await audit(context, 'assignment.change', `Updated assignment on "${thread.subject}"`, {
    accountId: thread.accountId,
    sharedMailboxId: resolved.sharedMailbox.id,
    threadId,
    detail: { before, after: next },
  });
  if (next.assigneeId && next.assigneeId !== before.assigneeId && next.assigneeId !== context.userId) {
    await notifyAssigned({ userId: next.assigneeId, threadId, subject: thread.subject, mailboxName: resolved.sharedMailbox.name, byName: context.userName, dueAt: next.dueAt });
  }
  return next;
}

export async function notifyAssigned(input: { userId: string; threadId: string; subject: string; mailboxName: string; byName: string; dueAt: string | null }) {
  const settings = await userSettings(input.userId);
  if (!settings.notifyOnAssignment) return;
  await dispatchNotificationOnce(
    { userIds: [input.userId] },
    {
      type: 'mail_assigned',
      title: `Email assigned to you — ${input.mailboxName}`,
      body: `${input.byName} assigned "${input.subject}"${input.dueAt ? `, reply due ${new Date(input.dueAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}` : ''}.`,
      module: MAIL_HUB_ACTIVITY_MODULE,
      severity: 'INFO',
      itemId: input.threadId,
      link: `/mail/shared?thread=${input.threadId}`,
    },
    `mail-assigned-${input.threadId}-${input.userId}-${stableHash(input.dueAt ?? '')}`,
  );
}

/* ── follow-ups ───────────────────────────────────────────────────────────────────────────── */

const PRIORITIES: MailPriority[] = ['low', 'normal', 'high', 'urgent'];

export async function createFollowUp(
  context: MailContext,
  threadId: string,
  input: { title: string; ownerId?: string | null; dueAt: string; priority?: MailPriority; reminderOffsets?: number[]; officeHubTaskId?: string | null },
) {
  const { thread, resolved } = await requireThread(context, threadId, 'read');
  const title = input.title.trim().slice(0, 300);
  if (!title) throw new MailHubError('Give the follow-up a title.', 400);
  if (Number.isNaN(Date.parse(input.dueAt))) throw new MailHubError('Choose a due date.', 400);
  let ownerId = input.ownerId || context.userId;
  let ownerName = context.userName;
  if (ownerId !== context.userId) {
    // Someone else can only own a follow-up on mail they can read: a shared-mailbox member.
    if (!resolved.sharedMailbox || !resolved.decision.canAssign) throw new AccessDeniedError('You can only give follow-ups on shared mailboxes to other members, with the Assign permission.');
    const member = await getOne<MailMailboxMember>(C.members, memberDocId(resolved.sharedMailbox.id, ownerId));
    if (!member) throw new MailHubError('The owner must be a member of this shared mailbox.', 400);
    ownerName = member.userName;
  } else {
    ownerId = context.userId;
  }
  const followUp: Omit<MailFollowUp, 'id'> = {
    threadId,
    accountId: thread.accountId,
    sharedMailboxId: thread.sharedMailboxId,
    subject: thread.subject,
    title,
    ownerId,
    ownerName,
    createdById: context.userId,
    createdByName: context.userName,
    dueAt: new Date(input.dueAt).toISOString(),
    priority: PRIORITIES.includes(input.priority as MailPriority) ? (input.priority as MailPriority) : 'normal',
    reminderOffsets: [...new Set((input.reminderOffsets ?? [60]).filter((value) => Number.isFinite(value) && value >= 0 && value <= 20_160))].slice(0, 5),
    status: 'open',
    officeHubTaskId: input.officeHubTaskId ?? null,
    completedAt: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  const ref = await db().collection(C.followUps).add(clean(followUp));
  await audit(context, 'followup.create', `Follow-up "${title}" on "${thread.subject}"`, { accountId: thread.accountId, sharedMailboxId: thread.sharedMailboxId, threadId, detail: { ownerId } });
  if (ownerId !== context.userId) {
    await dispatchNotificationServer(
      { userIds: [ownerId] },
      { type: 'mail_followup_assigned', title: 'Email follow-up for you', body: `${context.userName}: ${title}`, module: MAIL_HUB_ACTIVITY_MODULE, itemId: ref.id, link: '/mail/tasks' },
    );
  }
  return { ...followUp, id: ref.id };
}

export async function updateFollowUp(context: MailContext, id: string, input: { status?: MailFollowUp['status']; dueAt?: string; priority?: MailPriority; officeHubTaskId?: string | null }) {
  const followUp = await getOne<MailFollowUp>(C.followUps, id);
  if (!followUp || (followUp.ownerId !== context.userId && followUp.createdById !== context.userId)) throw new MailHubError('Follow-up not found.', 404);
  const patch: Partial<MailFollowUp> = { updatedAt: nowIso() };
  if (input.status && ['open', 'done', 'cancelled'].includes(input.status)) {
    patch.status = input.status;
    patch.completedAt = input.status === 'done' ? nowIso() : null;
  }
  if (input.dueAt && !Number.isNaN(Date.parse(input.dueAt))) patch.dueAt = new Date(input.dueAt).toISOString();
  if (input.priority && PRIORITIES.includes(input.priority)) patch.priority = input.priority;
  if (input.officeHubTaskId !== undefined) patch.officeHubTaskId = input.officeHubTaskId;
  await db().collection(C.followUps).doc(id).set(clean(patch), { merge: true });
  await audit(context, 'followup.update', `Updated follow-up "${followUp.title}"`, { accountId: followUp.accountId, sharedMailboxId: followUp.sharedMailboxId, threadId: followUp.threadId, detail: patch });
  return { ...followUp, ...patch };
}

export async function myWork(context: MailContext) {
  const [owned, assigned] = await Promise.all([
    db().collection(C.followUps).where('ownerId', '==', context.userId).where('status', '==', 'open').limit(200).get(),
    db().collection(C.threads).where('assignment.assigneeId', '==', context.userId).where('assignment.status', 'in', ['open', 'pending']).limit(200).get(),
  ]);
  const now = new Date();
  const threads: MailThread[] = [];
  for (const doc of assigned.docs) {
    const thread = { ...(doc.data() as MailThread), id: doc.id };
    // Still verify access: an assignment outlives a revoked membership.
    const resolved = await resolveMailbox(context, thread.accountId);
    if (resolved?.decision.canRead) threads.push(thread);
  }
  return {
    followUps: owned.docs
      .map((doc) => ({ ...(doc.data() as MailFollowUp), id: doc.id }))
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]),
    assigned: threads
      .map((thread) => ({ thread, deadline: deadlineState(thread, now) }))
      .sort((a, b) => (a.thread.assignment?.dueAt ?? '9999').localeCompare(b.thread.assignment?.dueAt ?? '9999')),
  };
}

/* ── templates and signatures ─────────────────────────────────────────────────────────────── */

export async function listTemplates(context: MailContext) {
  const snapshot = await db().collection(C.templates).limit(500).get();
  return snapshot.docs
    .map((doc) => ({ ...(doc.data() as MailTemplate), id: doc.id }))
    .filter((template) => canSeeContent({ viewerId: context.userId, viewerDepartmentIds: context.departmentIds, scope: template.scope, ownerId: template.ownerId, departmentId: template.departmentId }))
    .map((template) => ({ ...template, editable: canEditContent({ viewerId: context.userId, viewerDepartmentIds: context.departmentIds, capabilities: context.caps, scope: template.scope, ownerId: template.ownerId, departmentId: template.departmentId }) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveTemplate(context: MailContext, input: { id?: string | null; name: string; subject: string; html: string; scope: MailContentScope; departmentId?: string | null; departmentName?: string | null }) {
  const scope: MailContentScope = ['personal', 'department', 'global'].includes(input.scope) ? input.scope : 'personal';
  const existing = input.id ? await getOne<MailTemplate>(C.templates, input.id) : null;
  const target = { scope, ownerId: existing?.ownerId ?? context.userId, departmentId: scope === 'department' ? (input.departmentId ?? null) : null };
  const check = (entry: { scope: MailContentScope; ownerId: string | null; departmentId: string | null }) =>
    canEditContent({ viewerId: context.userId, viewerDepartmentIds: context.departmentIds, capabilities: context.caps, ...entry });
  if ((existing && !check(existing)) || !check(target)) throw new AccessDeniedError('Department and organisation templates need Mail Hub › Templates › Manage.');
  if (!input.name.trim()) throw new MailHubError('Name the template.', 400);
  const template: Omit<MailTemplate, 'id'> = {
    name: input.name.trim().slice(0, 120),
    subject: input.subject.replace(/[\r\n]+/g, ' ').slice(0, 300),
    html: sanitizeMailHtml(input.html, { allowRemoteContent: true, rewriteLinks: false }).html.slice(0, 200_000),
    scope,
    ownerId: target.ownerId,
    departmentId: target.departmentId,
    departmentName: scope === 'department' ? (input.departmentName ?? null) : null,
    createdAt: existing?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
  };
  const ref = existing ? db().collection(C.templates).doc(existing.id) : db().collection(C.templates).doc();
  await ref.set(clean(template));
  await audit(context, 'template.change', `${existing ? 'Updated' : 'Created'} template "${template.name}" (${scope})`, { detail: { templateId: ref.id } });
  return { ...template, id: ref.id };
}

export async function deleteTemplate(context: MailContext, id: string) {
  const existing = await getOne<MailTemplate>(C.templates, id);
  if (!existing) throw new MailHubError('Template not found.', 404);
  if (!canEditContent({ viewerId: context.userId, viewerDepartmentIds: context.departmentIds, capabilities: context.caps, scope: existing.scope, ownerId: existing.ownerId, departmentId: existing.departmentId })) throw new AccessDeniedError('You cannot delete this template.');
  await db().collection(C.templates).doc(id).delete();
  await audit(context, 'template.change', `Deleted template "${existing.name}"`, { detail: { templateId: id } });
}

export async function listSignatures(context: MailContext) {
  const snapshot = await db().collection(C.signatures).limit(500).get();
  return snapshot.docs
    .map((doc) => ({ ...(doc.data() as MailSignature), id: doc.id }))
    .filter((signature) => canSeeContent({ viewerId: context.userId, viewerDepartmentIds: context.departmentIds, scope: signature.scope, ownerId: signature.ownerId, departmentId: signature.departmentId }))
    .map((signature) => ({ ...signature, editable: canEditContent({ viewerId: context.userId, viewerDepartmentIds: context.departmentIds, capabilities: context.caps, scope: signature.scope, ownerId: signature.ownerId, departmentId: signature.departmentId }) }));
}

export async function saveSignature(context: MailContext, input: { id?: string | null; name: string; html: string; scope: 'personal' | 'department'; departmentId?: string | null; departmentName?: string | null; defaultForAccountId?: string | null }) {
  const scope = input.scope === 'department' ? 'department' : 'personal';
  const existing = input.id ? await getOne<MailSignature>(C.signatures, input.id) : null;
  const target = { scope, ownerId: existing?.ownerId ?? context.userId, departmentId: scope === 'department' ? (input.departmentId ?? null) : null } as const;
  const check = (entry: { scope: 'personal' | 'department'; ownerId: string | null; departmentId: string | null }) =>
    canEditContent({ viewerId: context.userId, viewerDepartmentIds: context.departmentIds, capabilities: context.caps, ...entry });
  if ((existing && !check(existing)) || !check(target)) throw new AccessDeniedError('Department signatures need Mail Hub › Templates › Manage.');
  const signature: Omit<MailSignature, 'id'> = {
    name: input.name.trim().slice(0, 120) || 'Signature',
    html: sanitizeMailHtml(input.html, { allowRemoteContent: true, rewriteLinks: false }).html.slice(0, 50_000),
    scope,
    ownerId: target.ownerId,
    departmentId: target.departmentId,
    departmentName: scope === 'department' ? (input.departmentName ?? null) : null,
    defaultForAccountId: scope === 'personal' ? (input.defaultForAccountId ?? null) : null,
    createdAt: existing?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
  };
  const ref = existing ? db().collection(C.signatures).doc(existing.id) : db().collection(C.signatures).doc();
  await ref.set(clean(signature));
  await audit(context, 'signature.change', `${existing ? 'Updated' : 'Created'} ${scope} signature "${signature.name}"`, { detail: { signatureId: ref.id } });
  return { ...signature, id: ref.id };
}

export async function deleteSignature(context: MailContext, id: string) {
  const existing = await getOne<MailSignature>(C.signatures, id);
  if (!existing) throw new MailHubError('Signature not found.', 404);
  if (!canEditContent({ viewerId: context.userId, viewerDepartmentIds: context.departmentIds, capabilities: context.caps, scope: existing.scope, ownerId: existing.ownerId, departmentId: existing.departmentId })) throw new AccessDeniedError('You cannot delete this signature.');
  await db().collection(C.signatures).doc(id).delete();
}

/* ── user settings and routing rules ──────────────────────────────────────────────────────── */

export async function saveUserSettings(context: MailContext, input: Partial<MailUserSettings>) {
  const current = await userSettings(context.userId);
  const next: MailUserSettings = {
    ...current,
    notifyOnAssignment: typeof input.notifyOnAssignment === 'boolean' ? input.notifyOnAssignment : current.notifyOnAssignment,
    deadlineWarningMinutes: Number.isFinite(input.deadlineWarningMinutes) ? Math.min(10_080, Math.max(0, Number(input.deadlineWarningMinutes))) : current.deadlineWarningMinutes,
    overdueReminderHours: Number.isFinite(input.overdueReminderHours) ? Math.min(168, Math.max(0, Number(input.overdueReminderHours))) : current.overdueReminderHours,
    // Opting in is the user's decision alone, and only possible with the permission.
    aiOptIn: typeof input.aiOptIn === 'boolean' ? input.aiOptIn && context.caps.canUseAi : current.aiOptIn,
    trustedImageDomains: Array.isArray(input.trustedImageDomains)
      ? [...new Set(input.trustedImageDomains.map((entry) => String(entry).trim().toLowerCase()).filter((entry) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(entry)))].slice(0, 50)
      : current.trustedImageDomains,
    keyboardShortcuts: typeof input.keyboardShortcuts === 'boolean' ? input.keyboardShortcuts : current.keyboardShortcuts,
    userId: context.userId,
    updatedAt: nowIso(),
  };
  await db().collection(C.userSettings).doc(context.userId).set(clean(next));
  return next;
}

async function requireMailboxManager(context: MailContext, sharedMailboxId: string): Promise<MailSharedMailbox> {
  const mailbox = await getOne<MailSharedMailbox>(C.sharedMailboxes, sharedMailboxId);
  if (!mailbox) throw new MailHubError('Shared mailbox not found.', 404);
  if (context.caps.canAdministerConnections) return mailbox;
  const member = await getOne<MailMailboxMember>(C.members, memberDocId(sharedMailboxId, context.userId));
  if (member?.role === 'manager' && context.caps.canAssignShared) return mailbox;
  throw new AccessDeniedError('Only managers of this mailbox (with Assign) or Mail Hub administrators can change its rules.');
}

export async function listRoutingRules(context: MailContext, sharedMailboxId: string) {
  await requireMailboxManager(context, sharedMailboxId);
  const snapshot = await db().collection(C.routingRules).where('sharedMailboxId', '==', sharedMailboxId).get();
  return snapshot.docs.map((doc) => ({ ...(doc.data() as MailRoutingRule), id: doc.id })).sort((a, b) => a.order - b.order);
}

export async function saveRoutingRule(context: MailContext, input: Partial<MailRoutingRule> & { sharedMailboxId: string }) {
  await requireMailboxManager(context, input.sharedMailboxId);
  const assignTo = input.actions?.assignToUserId ?? null;
  let assignToName: string | null = null;
  if (assignTo) {
    const member = await getOne<MailMailboxMember>(C.members, memberDocId(input.sharedMailboxId, assignTo));
    if (!member || member.role === 'reader') throw new MailHubError('Rules can only assign to responders or managers of this mailbox.', 400);
    assignToName = member.userName;
  }
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : null);
  const rule: Omit<MailRoutingRule, 'id'> = {
    sharedMailboxId: input.sharedMailboxId,
    name: text(input.name) ?? 'Rule',
    enabled: input.enabled !== false,
    order: Number.isFinite(input.order) ? Number(input.order) : 100,
    conditions: { fromContains: text(input.conditions?.fromContains), subjectContains: text(input.conditions?.subjectContains), toContains: text(input.conditions?.toContains) },
    actions: { assignToUserId: assignTo, assignToUserName: assignToName, deadlineHours: Number.isFinite(input.actions?.deadlineHours) && Number(input.actions?.deadlineHours) > 0 ? Math.min(720, Number(input.actions?.deadlineHours)) : null },
    createdById: context.userId,
    updatedAt: nowIso(),
  };
  if (!rule.conditions.fromContains && !rule.conditions.subjectContains && !rule.conditions.toContains) throw new MailHubError('A rule needs at least one condition.', 400);
  const ref = input.id ? db().collection(C.routingRules).doc(input.id) : db().collection(C.routingRules).doc();
  if (input.id) {
    const existing = await getOne<MailRoutingRule>(C.routingRules, input.id);
    if (!existing || existing.sharedMailboxId !== input.sharedMailboxId) throw new MailHubError('Rule not found.', 404);
  }
  await ref.set(clean(rule));
  await audit(context, 'rule.change', `Saved routing rule "${rule.name}"`, { sharedMailboxId: input.sharedMailboxId, detail: rule });
  return { ...rule, id: ref.id };
}

export async function deleteRoutingRule(context: MailContext, id: string) {
  const rule = await getOne<MailRoutingRule>(C.routingRules, id);
  if (!rule) throw new MailHubError('Rule not found.', 404);
  await requireMailboxManager(context, rule.sharedMailboxId);
  await db().collection(C.routingRules).doc(id).delete();
  await audit(context, 'rule.change', `Deleted routing rule "${rule.name}"`, { sharedMailboxId: rule.sharedMailboxId });
}

/* ── shared mailbox administration ────────────────────────────────────────────────────────── */

export async function listSharedMailboxes(context: MailContext) {
  const snapshot = await db().collection(C.sharedMailboxes).get();
  const mailboxes = snapshot.docs.map((doc) => ({ ...(doc.data() as MailSharedMailbox), id: doc.id }));
  const mine = await db().collection(C.members).where('userId', '==', context.userId).get();
  const memberships = new Map(mine.docs.map((doc) => [doc.get('sharedMailboxId') as string, { ...(doc.data() as MailMailboxMember), id: doc.id }]));
  const accounts = await getMany<MailAccount>(C.accounts, mailboxes.map((mailbox) => mailbox.accountId));
  return mailboxes
    .filter((mailbox) => context.caps.canAdministerConnections || memberships.has(mailbox.id))
    .map((mailbox) => {
      const account = accounts.get(mailbox.accountId);
      const membership = memberships.get(mailbox.id) ?? null;
      const decision = account ? decideMailboxAccess({ viewerId: context.userId, capabilities: context.caps, account, sharedMailbox: mailbox, membership }) : null;
      return {
        ...mailbox,
        accountStatus: account?.status ?? 'disconnected',
        accountRecovery: account ? (account.status === 'active' ? null : account.statusReason) : 'The syncing connection is missing.',
        membership,
        access: decision ? { canRead: decision.canRead, canSend: decision.canSend, canAssign: decision.canAssign, reason: decision.reason } : { canRead: false, canSend: false, canAssign: false, reason: 'Not connected' },
      };
    });
}

export async function updateSharedMailbox(context: MailContext, id: string, input: Partial<Pick<MailSharedMailbox, 'name' | 'departmentId' | 'departmentName' | 'responseHours' | 'active'>>) {
  if (!context.caps.canAdministerConnections) throw new AccessDeniedError('Mail Hub › Settings › Administer is required.');
  const mailbox = await getOne<MailSharedMailbox>(C.sharedMailboxes, id);
  if (!mailbox) throw new MailHubError('Shared mailbox not found.', 404);
  const patch = clean({
    ...(typeof input.name === 'string' && input.name.trim() ? { name: input.name.trim().slice(0, 120) } : {}),
    ...(input.departmentId !== undefined ? { departmentId: input.departmentId || null, departmentName: input.departmentName ?? null } : {}),
    ...(Number.isFinite(input.responseHours) ? { responseHours: Math.min(720, Math.max(0, Number(input.responseHours))) } : {}),
    ...(typeof input.active === 'boolean' ? { active: input.active } : {}),
    updatedAt: nowIso(),
  });
  await db().collection(C.sharedMailboxes).doc(id).set(patch, { merge: true });
  await audit(context, 'shared.update', `Updated shared mailbox ${mailbox.address}`, { sharedMailboxId: id, accountId: mailbox.accountId, detail: patch });
  return { ...mailbox, ...patch };
}

export async function listMembers(context: MailContext, sharedMailboxId: string) {
  const mailbox = await getOne<MailSharedMailbox>(C.sharedMailboxes, sharedMailboxId);
  if (!mailbox) throw new MailHubError('Shared mailbox not found.', 404);
  const self = await getOne<MailMailboxMember>(C.members, memberDocId(sharedMailboxId, context.userId));
  if (!context.caps.canAdministerConnections && !self) throw new MailHubError('Shared mailbox not found.', 404);
  const snapshot = await db().collection(C.members).where('sharedMailboxId', '==', sharedMailboxId).get();
  return snapshot.docs.map((doc) => ({ ...(doc.data() as MailMailboxMember), id: doc.id })).sort((a, b) => a.userName.localeCompare(b.userName));
}

const ROLES: MailMemberRole[] = ['reader', 'responder', 'manager'];

export async function upsertMember(context: MailContext, sharedMailboxId: string, input: { userId: string; role: MailMemberRole; canSend: boolean }) {
  if (!context.caps.canAdministerConnections) throw new AccessDeniedError('Mail Hub › Settings › Administer is required to change mailbox members.');
  const mailbox = await getOne<MailSharedMailbox>(C.sharedMailboxes, sharedMailboxId);
  if (!mailbox) throw new MailHubError('Shared mailbox not found.', 404);
  const user = await db().collection('users').doc(input.userId).get();
  if (!user.exists) throw new MailHubError('That user was not found.', 404);
  const id = memberDocId(sharedMailboxId, input.userId);
  const existing = await getOne<MailMailboxMember>(C.members, id);
  const member: MailMailboxMember = {
    id,
    sharedMailboxId,
    userId: input.userId,
    userName: String(user.get('name') || user.get('email') || input.userId),
    role: ROLES.includes(input.role) ? input.role : 'reader',
    canSend: Boolean(input.canSend),
    memberAccountId: existing?.memberAccountId ?? null,
    // A new membership starts unverified: the ERP grant alone never opens the mailbox.
    providerGrant: existing?.providerGrant ?? { read: 'unverified', send: 'unverified', method: null, checkedAt: null, detail: 'Waiting for the member to verify access with their own account.' },
    grantedById: existing?.grantedById ?? context.userId,
    grantedAt: existing?.grantedAt ?? nowIso(),
    updatedAt: nowIso(),
  };
  await db().collection(C.members).doc(id).set(clean(member));
  await audit(context, existing ? 'shared.member.update' : 'shared.member.grant', `${existing ? 'Updated' : 'Added'} ${member.userName} as ${member.role} of ${mailbox.address}`, {
    sharedMailboxId,
    accountId: mailbox.accountId,
    detail: { userId: input.userId, role: member.role, canSend: member.canSend, before: existing ? { role: existing.role, canSend: existing.canSend } : null },
  });
  if (!existing) {
    await dispatchNotificationServer(
      { userIds: [input.userId] },
      { type: 'mail_shared_access', title: `You were added to ${mailbox.name}`, body: 'Verify your access with your own connected account to start reading it.', module: MAIL_HUB_ACTIVITY_MODULE, itemId: sharedMailboxId, link: '/mail/shared' },
    );
  }
  return member;
}

export async function removeMember(context: MailContext, sharedMailboxId: string, userId: string) {
  if (!context.caps.canAdministerConnections) throw new AccessDeniedError('Mail Hub › Settings › Administer is required to change mailbox members.');
  const id = memberDocId(sharedMailboxId, userId);
  const existing = await getOne<MailMailboxMember>(C.members, id);
  if (!existing) throw new MailHubError('Member not found.', 404);
  await db().collection(C.members).doc(id).delete();
  await audit(context, 'shared.member.revoke', `Removed ${existing.userName} from the shared mailbox`, { sharedMailboxId, detail: { userId } });
}

/**
 * Check the provider grant with the member's *own* connected account.
 *
 * Run by the member ("Verify my access"), by an administrator for a member, and by the worker
 * every twelve hours. The member's account must be theirs and of the same provider; the provider
 * answers whether that login can reach the shared mailbox.
 */
export async function verifyMemberGrant(actor: { userId: string; userName: string; isAdmin: boolean }, sharedMailboxId: string, userId: string, memberAccountId?: string | null) {
  if (actor.userId !== userId && !actor.isAdmin) throw new AccessDeniedError('Only the member or a Mail Hub administrator can verify this membership.');
  const mailbox = await getOne<MailSharedMailbox>(C.sharedMailboxes, sharedMailboxId);
  const member = await getOne<MailMailboxMember>(C.members, memberDocId(sharedMailboxId, userId));
  if (!mailbox || !member) throw new MailHubError('Membership not found.', 404);

  const accountId = memberAccountId ?? member.memberAccountId;
  const account = accountId ? await getOne<MailAccount>(C.accounts, accountId) : null;
  const checkedAt = nowIso();
  let grant: MailMailboxMember['providerGrant'];
  if (!account || account.ownerUserId !== userId || account.kind !== 'personal' || account.provider !== mailbox.provider || account.status === 'disconnected') {
    grant = { read: 'missing', send: 'missing', method: null, checkedAt, detail: `Connect your own ${mailbox.provider === 'gmail' ? 'Google' : mailbox.provider === 'microsoft' ? 'Microsoft 365' : 'company'} account first, then verify.` };
  } else {
    const adapter = await adapterForAccount(account);
    try {
      if (!adapter.verifyMailboxGrant) grant = { read: 'unverified', send: 'unverified', method: null, checkedAt, detail: 'This provider cannot verify mailbox access.' };
      else {
        const result = await adapter.verifyMailboxGrant(mailbox.address);
        grant = { read: result.read, send: result.send, method: result.method, checkedAt, detail: result.detail };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      grant = { read: 'error', send: 'error', method: null, checkedAt: member.providerGrant.checkedAt, detail: `Verification failed: ${message}` };
      // A transient error keeps the previous (still-fresh) result rather than locking the member out.
      if (member.providerGrant.read === 'verified') grant = { ...member.providerGrant, detail: `Last re-check failed: ${message}` };
    } finally {
      await adapter.close?.().catch(() => {});
    }
  }
  await db().collection(C.members).doc(member.id).set(clean({ providerGrant: grant, memberAccountId: account?.id ?? member.memberAccountId, updatedAt: checkedAt }), { merge: true });
  await audit({ userId: actor.userId, userName: actor.userName }, 'shared.grant.verify', `Provider grant for ${member.userName} on ${mailbox.address}: read ${grant.read}, send ${grant.send}`, {
    sharedMailboxId,
    detail: { userId, method: grant.method, read: grant.read, send: grant.send },
  });
  return grant;
}

export async function reverifyAllGrants(): Promise<number> {
  const snapshot = await db().collection(C.members).where('providerGrant.read', '==', 'verified').limit(500).get();
  let checked = 0;
  for (const doc of snapshot.docs) {
    const member = { ...(doc.data() as MailMailboxMember), id: doc.id };
    const age = Date.now() - Date.parse(member.providerGrant.checkedAt ?? '0');
    if (age < 12 * 3_600_000) continue;
    await verifyMemberGrant({ userId: 'system', userName: 'Mail Hub', isAdmin: true }, member.sharedMailboxId, member.userId).catch((error) => console.error('[mail-hub] grant re-verify failed', member.id, error));
    checked += 1;
  }
  return checked;
}

/* ── admin settings ───────────────────────────────────────────────────────────────────────── */

export async function saveAdminSettings(context: MailContext, input: Partial<MailHubAdminSettings>) {
  if (!context.caps.canAdministerConnections) throw new AccessDeniedError('Mail Hub › Settings › Administer is required.');
  const current = await adminSettings();
  const presets: MailImapServerPreset[] = Array.isArray(input.imapServers)
    ? input.imapServers.slice(0, 20).map((preset, index) => {
        const host = (value: unknown) => {
          const text = String(value ?? '').trim().toLowerCase();
          if (!/^[a-z0-9.-]+$/.test(text) || !text.includes('.')) throw new MailHubError(`Server ${index + 1}: enter a valid host name.`, 400);
          return text;
        };
        const port = (value: unknown, fallback: number) => {
          const number = Number(value ?? fallback);
          if (!Number.isInteger(number) || number < 1 || number > 65535) throw new MailHubError(`Server ${index + 1}: enter a valid port.`, 400);
          return number;
        };
        const security = (value: unknown): 'tls' | 'starttls' => (value === 'starttls' ? 'starttls' : 'tls');
        return {
          id: String(preset.id || `srv_${stableHash(`${preset.imapHost}${index}`)}`).slice(0, 60),
          label: String(preset.label || preset.imapHost).slice(0, 80),
          imapHost: host(preset.imapHost),
          imapPort: port(preset.imapPort, 993),
          imapSecurity: security(preset.imapSecurity),
          smtpHost: host(preset.smtpHost),
          smtpPort: port(preset.smtpPort, 465),
          smtpSecurity: security(preset.smtpSecurity),
          usernameStyle: preset.usernameStyle === 'local-part' ? 'local-part' : 'email',
          allowedDomains: (preset.allowedDomains ?? []).map((entry) => String(entry).trim().toLowerCase()).filter(Boolean).slice(0, 20),
          smtpEnforcesSender: Boolean(preset.smtpEnforcesSender),
          appendSentCopy: preset.appendSentCopy !== false,
        };
      })
    : current.imapServers;
  const next: MailHubAdminSettings = {
    imapServers: presets,
    enabledProviders: Array.isArray(input.enabledProviders) ? input.enabledProviders.filter((entry) => ['gmail', 'microsoft', 'imap'].includes(entry)) : current.enabledProviders,
    defaultSyncWindowDays: Number.isFinite(input.defaultSyncWindowDays) ? Math.min(365, Math.max(7, Number(input.defaultSyncWindowDays))) : current.defaultSyncWindowDays,
    bodyCacheDays: Number.isFinite(input.bodyCacheDays) ? Math.min(90, Math.max(0, Number(input.bodyCacheDays))) : current.bodyCacheDays,
    uploadRetentionDays: Number.isFinite(input.uploadRetentionDays) ? Math.min(30, Math.max(1, Number(input.uploadRetentionDays))) : current.uploadRetentionDays,
    maxAttachmentBytes: Number.isFinite(input.maxAttachmentBytes) ? Math.min(35 * 1024 * 1024, Math.max(1024 * 1024, Number(input.maxAttachmentBytes))) : current.maxAttachmentBytes,
    updatedAt: nowIso(),
    updatedById: context.userId,
  };
  await db().collection(C.settings).doc(MAIL_HUB_SETTINGS_DOC_ID).set(clean(next));
  await audit(context, 'settings.change', 'Updated Mail Hub connection settings', { detail: { imapServers: next.imapServers.map((entry) => entry.imapHost), enabledProviders: next.enabledProviders } });
  return next;
}

/* ── reports ──────────────────────────────────────────────────────────────────────────────── */

/**
 * Operational reports over **shared** mailboxes only — counts and times, never content. Personal
 * mailboxes never feed anybody else's report; a person sees their own follow-up numbers.
 */
export async function buildReports(context: MailContext, input: { from: string; to: string; sharedMailboxId?: string | null }) {
  if (!context.caps.canViewReports) throw new AccessDeniedError('Mail Hub › Reports › View is required.');
  const mailboxes = (await db().collection(C.sharedMailboxes).get()).docs.map((doc) => ({ ...(doc.data() as MailSharedMailbox), id: doc.id }));
  const scope = input.sharedMailboxId ? mailboxes.filter((mailbox) => mailbox.id === input.sharedMailboxId) : mailboxes;
  const threads: MailThread[] = [];
  for (const mailbox of scope) {
    const snapshot = await db().collection(C.threads).where('sharedMailboxId', '==', mailbox.id).where('lastMessageAt', '>=', input.from).limit(5000).get();
    threads.push(...snapshot.docs.map((doc) => ({ ...(doc.data() as MailThread), id: doc.id })));
  }
  const followUps = (await db().collection(C.followUps).where('sharedMailboxId', 'in', scope.length ? scope.map((mailbox) => mailbox.id).slice(0, 30) : ['-']).limit(5000).get()).docs.map((doc) => doc.data() as MailFollowUp);

  const assigneeIds = [...new Set(threads.map((thread) => thread.assignment?.assigneeId).filter((id): id is string => Boolean(id)))];
  const users = await getMany<{ employeeId?: string }>('users', assigneeIds);
  const employees = await getMany<{ department?: string }>('employees', [...users.values()].map((user) => user.employeeId).filter((id): id is string => Boolean(id)));
  const departmentOf = (userId: string) => {
    const employeeId = users.get(userId)?.employeeId;
    return (employeeId && employees.get(employeeId)?.department) || null;
  };
  const report = buildMailReport({ threads, followUps, departmentOf, from: input.from, to: input.to, now: new Date() });
  const perMailbox = scope.map((mailbox) => {
    const subset = threads.filter((thread) => thread.sharedMailboxId === mailbox.id);
    const single = buildMailReport({ threads: subset, followUps: [], departmentOf, from: input.from, to: input.to, now: new Date() });
    return { id: mailbox.id, name: mailbox.name, address: mailbox.address, assigned: single.assignedVolume, open: single.openWork, overdue: single.overdue, medianResponseHours: single.medianResponseHours };
  });
  return { ...report, perMailbox, mailboxes: mailboxes.map((mailbox) => ({ id: mailbox.id, name: mailbox.name })) };
}

/* ── audit ────────────────────────────────────────────────────────────────────────────────── */

/**
 * The audit trail an administrator may read: shared-mailbox activity and configuration changes.
 * Events about a person's own mailbox (their sends, their links) are shown to that person only —
 * administering Mail Hub does not make somebody's personal subject lines readable.
 */
export async function listAudit(context: MailContext, input: { sharedMailboxId?: string | null; mineOnly?: boolean; before?: string | null; limit?: number }) {
  const limit = Math.min(input.limit ?? 100, 200);
  if (input.mineOnly || !context.caps.canViewAudit) {
    let query = db().collection(C.audit).where('actorId', '==', context.userId).orderBy('at', 'desc').limit(limit);
    if (input.before) query = query.where('at', '<', input.before);
    return (await query.get()).docs.map((doc) => ({ ...(doc.data() as MailAuditEvent), id: doc.id }));
  }
  let query = input.sharedMailboxId
    ? db().collection(C.audit).where('sharedMailboxId', '==', input.sharedMailboxId).orderBy('at', 'desc').limit(limit)
    : db().collection(C.audit).orderBy('at', 'desc').limit(limit * 3);
  if (input.before) query = query.where('at', '<', input.before);
  const events = (await query.get()).docs.map((doc) => ({ ...(doc.data() as MailAuditEvent), id: doc.id }));
  const adminVisible = (event: MailAuditEvent) =>
    Boolean(event.sharedMailboxId) || /^(account\.|shared\.|template\.|settings\.|rule\.|signature\.)/.test(event.action);
  return events.filter(adminVisible).slice(0, limit);
}

/* ── notification sweep ───────────────────────────────────────────────────────────────────── */

/**
 * Deadline warnings, overdue reminders and follow-up reminders. Each notification has a dedupe key
 * built from the event (thread + deadline + stage, or follow-up + offset), so running the sweep
 * every few minutes sends each reminder once; overdue repeats are keyed by the reminder window.
 */
export async function notificationSweep(now = new Date()): Promise<{ warnings: number; overdue: number; followUps: number }> {
  let warnings = 0;
  let overdue = 0;
  let followUps = 0;
  const horizon = new Date(now.getTime() + 7 * 86_400_000).toISOString();
  const threads = await db().collection(C.threads).where('assignment.status', 'in', ['open', 'pending']).where('assignment.dueAt', '<=', horizon).limit(1000).get();
  const settingsCache = new Map<string, MailUserSettings>();
  for (const doc of threads.docs) {
    const thread = { ...(doc.data() as MailThread), id: doc.id };
    const assignee = thread.assignment?.assigneeId;
    if (!assignee || !thread.assignment?.dueAt || !thread.awaitingReply) continue;
    const settings = settingsCache.get(assignee) ?? (await userSettings(assignee));
    settingsCache.set(assignee, settings);
    const state = deadlineState(thread, now, settings.deadlineWarningMinutes);
    const dueKey = stableHash(thread.assignment.dueAt);
    if (state === 'due-soon' && settings.deadlineWarningMinutes > 0) {
      warnings += await dispatchNotificationOnce(
        { userIds: [assignee] },
        { type: 'mail_reply_due', title: 'Reply due soon', body: `"${thread.subject}" needs a reply by ${new Date(thread.assignment.dueAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}.`, module: MAIL_HUB_ACTIVITY_MODULE, severity: 'WARNING', itemId: thread.id, link: `/mail/shared?thread=${thread.id}` },
        `mail-due-${thread.id}-${dueKey}`,
      );
    } else if (state === 'overdue') {
      const window = settings.overdueReminderHours > 0 ? Math.floor((now.getTime() - Date.parse(thread.assignment.dueAt)) / (settings.overdueReminderHours * 3_600_000)) : 0;
      overdue += await dispatchNotificationOnce(
        { userIds: [assignee] },
        { type: 'mail_reply_overdue', title: 'Reply overdue', body: `"${thread.subject}" was due ${new Date(thread.assignment.dueAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} and has not been answered.`, module: MAIL_HUB_ACTIVITY_MODULE, severity: 'CRITICAL', itemId: thread.id, link: `/mail/shared?thread=${thread.id}` },
        `mail-overdue-${thread.id}-${dueKey}-${window}`,
      );
    }
  }

  const due = await db().collection(C.followUps).where('status', '==', 'open').where('dueAt', '<=', horizon).limit(1000).get();
  for (const doc of due.docs) {
    const followUp = { ...(doc.data() as MailFollowUp), id: doc.id };
    for (const offset of dueFollowUpReminders(followUp, now)) {
      followUps += await dispatchNotificationOnce(
        { userIds: [followUp.ownerId] },
        {
          type: 'mail_followup_due',
          title: offset === 0 ? 'Email follow-up due now' : 'Email follow-up coming up',
          body: `${followUp.title} — "${followUp.subject}"`,
          module: MAIL_HUB_ACTIVITY_MODULE,
          severity: offset === 0 ? 'WARNING' : 'INFO',
          itemId: followUp.id,
          link: '/mail/tasks',
        },
        `mail-followup-${followUp.id}-${offset}-${stableHash(followUp.dueAt)}`,
      );
    }
  }
  return { warnings, overdue, followUps };
}

/* ── helpers for the routes ───────────────────────────────────────────────────────────────── */

export async function contextForUser(userId: string): Promise<MailContext> {
  const access = await authenticateUserById(userId);
  return { ...access, caps: mailHubCapabilities(access.access) };
}

export { RECORDS as MAIL_RECORD_SOURCES };

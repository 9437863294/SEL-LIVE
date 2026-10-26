import 'server-only';

/**
 * The records that hang off a bill or a project: follow-ups (with payment commitments), comments,
 * documents, retention releases and collection targets.
 *
 * Follow-ups keep three rollups on the bill (last follow-up, next follow-up, next commitment) so the
 * outstanding register can filter and sort on them without reading every follow-up. The rollup is
 * recomputed from all of the bill's follow-ups inside the same transaction that writes one.
 *
 * Documents are stored with the Admin SDK under `bill-tracking/{organization}/{bill}/…` and served
 * only through the API, which checks the caller's access to the bill's project. The storage rules
 * deny that prefix to clients, so a guessed path is useless.
 */

import { FieldValue } from 'firebase-admin/firestore';

import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { getFirebaseAdminBucket } from '@/lib/firebase-admin';
import { dispatchNotificationServer } from '@/lib/notifications-server';

import { financialYearOf, isoWeekRange } from '../calculations.ts';
import { subtractMoney } from '../money.ts';
import { followUpRollup } from '../reports.ts';
import type { BillComment, BillDocument, BillDocumentCategory, BillFollowUp, CollectionTarget, RetentionRelease } from '../types';
import type { z } from 'zod';
import type { commitmentUpdateSchema, followUpInputSchema, retentionReleaseSchema, targetInputSchema } from '../schemas';
import { BtError, db, type BtContext } from './context';
import { BT_COLLECTIONS, clean, loadBill, loadProject, loadConfig, logActivity, logActivityTx, nowIso, userName } from './store';

/* ── follow-ups ──────────────────────────────────────────────────────────── */

async function writeRollup(context: BtContext, billId: string, extra: { followUp?: Omit<BillFollowUp, 'id'> & { organizationId: string }; followUpId?: string; patch?: Record<string, unknown> }): Promise<string> {
  const firestore = db();
  const billRef = firestore.collection(BT_COLLECTIONS.bills).doc(billId);
  const newRef = extra.followUp ? firestore.collection(BT_COLLECTIONS.followUps).doc() : undefined;
  await firestore.runTransaction(async (transaction) => {
    const existing = await transaction.get(firestore.collection(BT_COLLECTIONS.followUps).where('billId', '==', billId));
    const billSnapshot = await transaction.get(billRef);
    const followUps = existing.docs
      .map((doc) => ({ ...(doc.data() as BillFollowUp), id: doc.id }))
      .map((entry) => (extra.followUpId === entry.id && extra.patch ? ({ ...entry, ...extra.patch } as BillFollowUp) : entry));
    if (extra.followUp && newRef) {
      transaction.set(newRef, clean(extra.followUp));
      followUps.push({ ...(extra.followUp as unknown as BillFollowUp), id: newRef.id });
    }
    if (extra.followUpId && extra.patch) transaction.update(firestore.collection(BT_COLLECTIONS.followUps).doc(extra.followUpId), clean(extra.patch));
    const rollup = followUpRollup(followUps, context.today);
    transaction.update(billRef, {
      lastFollowUpDate: rollup.lastFollowUpDate ?? FieldValue.delete(),
      nextFollowUpDate: rollup.nextFollowUpDate ?? FieldValue.delete(),
      nextCommitmentDate: rollup.nextCommitmentDate ?? FieldValue.delete(),
      nextCommitmentAmount: rollup.nextCommitmentAmount ?? FieldValue.delete(),
      version: (Number(billSnapshot.data()?.version) || 1) + 1,
      updatedAt: nowIso(),
    });
    logActivityTx(transaction, context, {
      entityType: 'followup',
      entityId: newRef?.id ?? extra.followUpId ?? billId,
      billId,
      projectId: String(billSnapshot.data()?.projectId ?? ''),
      action: extra.followUp ? (extra.followUp.commitment ? 'commitment_added' : 'followup_added') : 'commitment_updated',
      summary: extra.followUp
        ? `${extra.followUp.method} follow-up${extra.followUp.commitment ? ` · client committed ₹${extra.followUp.commitment.amount.toLocaleString('en-IN')} by ${extra.followUp.commitment.date}` : ''}`
        : `Commitment marked ${String((extra.patch?.commitment as { status?: string } | undefined)?.status ?? '').replace(/_/g, ' ')}`,
      next: extra.followUp ? { discussion: extra.followUp.discussion.slice(0, 200) } : extra.patch,
    });
  });
  return newRef?.id ?? extra.followUpId ?? '';
}

export async function addFollowUp(context: BtContext, billId: string, input: z.infer<typeof followUpInputSchema>): Promise<{ id: string }> {
  const bill = await loadBill(context, billId);
  context.require('Follow-ups', 'Add', bill.projectId);
  const ownerId = input.ownerId ?? bill.collectionOwnerId ?? context.userId;
  const followUp = clean({
    organizationId: context.organizationId,
    billId,
    projectId: bill.projectId,
    followUpDate: input.followUpDate,
    method: input.method,
    contactPerson: input.contactPerson,
    discussion: input.discussion,
    nextFollowUpDate: input.nextFollowUpDate,
    ownerId,
    ownerName: (await userName(ownerId)) ?? undefined,
    commitment: input.commitment ? { ...input.commitment, status: 'pending' as const } : undefined,
    status: 'open' as const,
    createdBy: context.userId,
    createdByName: context.userName,
    createdAt: nowIso(),
  });
  const id = await writeRollup(context, billId, { followUp });
  return { id };
}

export async function updateCommitment(context: BtContext, billId: string, followUpId: string, input: z.infer<typeof commitmentUpdateSchema>): Promise<void> {
  const bill = await loadBill(context, billId);
  context.require('Follow-ups', 'Edit', bill.projectId);
  const snapshot = await db().collection(BT_COLLECTIONS.followUps).doc(followUpId).get();
  const followUp = snapshot.data() as BillFollowUp | undefined;
  if (!followUp || followUp.billId !== billId) throw new BtError('Follow-up not found.', 404);
  if (!followUp.commitment) throw new BtError('This follow-up has no commitment.', 409);
  const fulfilledAmount = input.fulfilledAmount ?? followUp.commitment.fulfilledAmount;
  if (input.status === 'partially_fulfilled' && !fulfilledAmount) throw new BtError('Enter the amount received against the commitment.');
  const commitment = clean({ ...followUp.commitment, status: input.status, fulfilledAmount, fulfilledDate: input.fulfilledDate ?? followUp.commitment.fulfilledDate });
  await writeRollup(context, billId, { followUpId, patch: { commitment, ...(input.closeFollowUp ? { status: 'closed' } : {}) } });
}

/* ── comments ────────────────────────────────────────────────────────────── */

export async function addComment(context: BtContext, billId: string, text: string, mentions: string[]): Promise<{ id: string }> {
  const bill = await loadBill(context, billId);
  context.require('Bills', 'View', bill.projectId);
  const ref = db().collection(BT_COLLECTIONS.comments).doc();
  const comment: Omit<BillComment, 'id'> & { organizationId: string; projectId: string } = {
    organizationId: context.organizationId,
    billId,
    projectId: bill.projectId,
    text,
    mentions,
    createdBy: context.userId,
    createdByName: context.userName,
    createdAt: nowIso(),
  };
  await ref.set(comment);
  await logActivity(context, { entityType: 'comment', entityId: ref.id, billId, projectId: bill.projectId, action: 'comment_added', summary: `Comment: ${text.slice(0, 120)}` });
  const recipients = mentions.filter((id) => id !== context.userId);
  if (recipients.length) {
    try {
      await dispatchNotificationServer(
        { userIds: recipients },
        { type: 'record_assigned', module: ACTIVITY_MODULES.BILL_TRACKING, title: `${context.userName} mentioned you on a bill`, body: text.slice(0, 180), itemId: billId, itemRef: bill.gstInvoiceNumber || bill.billSerialNumber, link: `/bill-tracking/bills/${billId}`, organizationId: context.organizationId },
      );
    } catch {
      // Best-effort.
    }
  }
  return { id: ref.id };
}

/* ── documents ───────────────────────────────────────────────────────────── */

export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

const safeFileName = (name: string) => name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-120) || 'file';

export async function uploadDocument(context: BtContext, billId: string, file: File, category: BillDocumentCategory): Promise<{ id: string }> {
  const bill = await loadBill(context, billId);
  context.require('Bills', 'Edit', bill.projectId);
  if (file.size > MAX_DOCUMENT_BYTES) throw new BtError('Attachments are limited to 20 MB.', 413);
  const storagePath = `bill-tracking/${context.organizationId}/${billId}/${Date.now()}-${safeFileName(file.name)}`;
  await getFirebaseAdminBucket()
    .file(storagePath)
    .save(Buffer.from(await file.arrayBuffer()), { contentType: file.type || 'application/octet-stream', resumable: false });
  const ref = db().collection(BT_COLLECTIONS.documents).doc();
  const document: Omit<BillDocument, 'id'> & { organizationId: string; projectId: string } = clean({
    organizationId: context.organizationId,
    billId,
    projectId: bill.projectId,
    category,
    fileName: file.name,
    contentType: file.type || undefined,
    size: file.size,
    storagePath,
    uploadedBy: context.userId,
    uploadedByName: context.userName,
    uploadedAt: nowIso(),
  });
  await ref.set(document);
  await logActivity(context, { entityType: 'document', entityId: ref.id, billId, projectId: bill.projectId, action: 'document_uploaded', summary: `${category} uploaded: ${file.name}` });
  return { id: ref.id };
}

export async function readDocument(context: BtContext, documentId: string): Promise<{ document: BillDocument; data: Buffer }> {
  const snapshot = await db().collection(BT_COLLECTIONS.documents).doc(documentId).get();
  const document = snapshot.exists ? ({ ...(snapshot.data() as BillDocument & { organizationId: string }), id: snapshot.id }) : undefined;
  if (!document || (document as BillDocument & { organizationId: string }).organizationId !== context.organizationId || document.isDeleted) throw new BtError('Document not found.', 404);
  const bill = await loadBill(context, document.billId, { includeDeleted: true });
  context.require('Bills', 'View', bill.projectId);
  const [data] = await getFirebaseAdminBucket().file(document.storagePath).download();
  return { document, data };
}

export async function removeDocument(context: BtContext, documentId: string): Promise<void> {
  const ref = db().collection(BT_COLLECTIONS.documents).doc(documentId);
  const snapshot = await ref.get();
  const document = snapshot.data() as (BillDocument & { organizationId: string }) | undefined;
  if (!document || document.organizationId !== context.organizationId) throw new BtError('Document not found.', 404);
  const bill = await loadBill(context, document.billId, { includeDeleted: true });
  context.require('Bills', 'Edit', bill.projectId);
  // The file is kept: financial attachments are evidence, and the audit trail refers to them.
  await ref.update({ isDeleted: true, deletedBy: context.userId, deletedAt: nowIso() });
  await logActivity(context, { entityType: 'document', entityId: documentId, billId: document.billId, projectId: bill.projectId, action: 'document_removed', summary: `${document.category} removed from the bill: ${document.fileName}` });
}

/* ── retention releases ──────────────────────────────────────────────────── */

export async function addRetentionRelease(context: BtContext, input: z.infer<typeof retentionReleaseSchema>): Promise<{ id: string }> {
  context.require('Retention', 'Manage', input.projectId);
  const config = await loadConfig(context.organizationId);
  const project = await loadProject(input.projectId, config.projectProfiles);
  const against = input.againstBillId ? await loadBill(context, input.againstBillId) : undefined;
  if (against && against.projectId !== input.projectId) throw new BtError('The bill belongs to a different project.');
  const ref = db().collection(BT_COLLECTIONS.retention).doc();
  const release: Omit<RetentionRelease, 'id'> & { organizationId: string } = clean({
    organizationId: context.organizationId,
    projectId: project.id,
    projectNameSnapshot: project.name,
    againstBillId: against?.id,
    againstBillSerial: against ? against.gstInvoiceNumber || against.billSerialNumber : undefined,
    retentionBillId: input.retentionBillId,
    kind: input.kind,
    releaseDate: input.releaseDate,
    amount: input.amount,
    remarks: input.remarks,
    status: 'active',
    createdBy: context.userId,
    createdByName: context.userName,
    createdAt: nowIso(),
  });
  await ref.set(release);
  await logActivity(context, { entityType: 'retention', entityId: ref.id, billId: against?.id, projectId: project.id, action: 'retention_released', summary: `Retention release ₹${input.amount.toLocaleString('en-IN')} recorded for ${project.name}` });
  return { id: ref.id };
}

export async function cancelRetentionRelease(context: BtContext, releaseId: string, reason: string): Promise<void> {
  const ref = db().collection(BT_COLLECTIONS.retention).doc(releaseId);
  const snapshot = await ref.get();
  const release = snapshot.data() as (RetentionRelease & { organizationId: string }) | undefined;
  if (!release || release.organizationId !== context.organizationId) throw new BtError('Release not found.', 404);
  context.require('Retention', 'Manage', release.projectId);
  if (release.collectionId) throw new BtError('This release came from a receipt on a retention bill; cancel that receipt instead.', 409);
  if (release.status === 'cancelled') return;
  await ref.update({ status: 'cancelled', cancelledBy: context.userId, cancelledAt: nowIso(), cancelReason: reason });
  await logActivity(context, { entityType: 'retention', entityId: releaseId, projectId: release.projectId, action: 'retention_release_cancelled', summary: `Retention release ₹${release.amount} cancelled`, reason });
}

/* ── targets ─────────────────────────────────────────────────────────────── */

export async function saveTarget(context: BtContext, input: z.infer<typeof targetInputSchema>, targetId?: string): Promise<{ id: string }> {
  if (input.projectId) context.require('Targets', 'Manage', input.projectId);
  else {
    context.require('Targets', 'Manage');
    if (context.scope !== null) throw new BtError('A company-wide target needs All Projects access; choose a project.', 403);
  }
  const config = await loadConfig(context.organizationId);
  const project = input.projectId ? await loadProject(input.projectId, config.projectProfiles) : undefined;
  if (input.billId) {
    const bill = await loadBill(context, input.billId);
    if (project && bill.projectId !== project.id) throw new BtError('The bill belongs to a different project.');
  }
  const ref = targetId ? db().collection(BT_COLLECTIONS.targets).doc(targetId) : db().collection(BT_COLLECTIONS.targets).doc();
  const existing = targetId ? await ref.get() : null;
  if (targetId && (!existing?.exists || existing.data()?.organizationId !== context.organizationId)) throw new BtError('Target not found.', 404);
  const weekRange = isoWeekRange(input.week);
  if (!weekRange) throw new BtError('Use an ISO week such as 2026-W41.');
  const target: Omit<CollectionTarget, 'id'> & { organizationId: string } = clean({
    organizationId: context.organizationId,
    // A week straddling 31 March belongs to the FY its Monday falls in.
    financialYear: financialYearOf(weekRange.from),
    week: input.week,
    projectId: project?.id,
    projectNameSnapshot: project?.name,
    billId: input.billId,
    amount: input.amount,
    responsibleId: input.responsibleId,
    responsibleName: await userName(input.responsibleId),
    probability: input.probability,
    expectedDate: input.expectedDate,
    remarks: input.remarks,
    createdBy: (existing?.data()?.createdBy as string | undefined) ?? context.userId,
    createdAt: (existing?.data()?.createdAt as string | undefined) ?? nowIso(),
    updatedAt: nowIso(),
  });
  await ref.set(target);
  await logActivity(context, { entityType: 'target', entityId: ref.id, projectId: project?.id, action: targetId ? 'target_updated' : 'target_set', summary: `Collection target ₹${input.amount.toLocaleString('en-IN')} for ${input.week}${project ? ` · ${project.name}` : ''}` });
  return { id: ref.id };
}

export async function deleteTarget(context: BtContext, targetId: string): Promise<void> {
  const ref = db().collection(BT_COLLECTIONS.targets).doc(targetId);
  const snapshot = await ref.get();
  const target = snapshot.data() as (CollectionTarget & { organizationId: string }) | undefined;
  if (!target || target.organizationId !== context.organizationId) throw new BtError('Target not found.', 404);
  context.require('Targets', 'Manage', target.projectId);
  // Targets are plans, not financial records — removing one is allowed, and audited.
  await ref.delete();
  await logActivity(context, { entityType: 'target', entityId: targetId, projectId: target.projectId, action: 'target_removed', summary: `Collection target ${target.week} (₹${target.amount}) removed`, previous: { amount: target.amount, week: target.week } });
}

export const commitmentShortfall = (commitment: NonNullable<BillFollowUp['commitment']>) => subtractMoney(commitment.amount, commitment.fulfilledAmount ?? 0);

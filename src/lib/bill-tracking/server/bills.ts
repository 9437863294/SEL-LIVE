import 'server-only';

/**
 * Bill lifecycle on the server: create, edit, delete (soft), workflow, status override, net
 * mismatch resolution, due-date revision and bulk planning actions.
 *
 * Every write is a Firestore transaction that re-reads the bill, recomputes all derived totals from
 * its source values (`deriveBillTotals`) and writes the audit entry in the same commit. A client
 * that loaded the bill an hour ago cannot overwrite a receipt recorded since: the receipt list is
 * always taken from the fresh read, and `expectedVersion` refuses a stale editor outright.
 */

import { FieldValue } from 'firebase-admin/firestore';

import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { dispatchNotificationServer, resolveRoleRecipientsServer } from '@/lib/notifications-server';

import {
  addDays,
  deriveBillTotals,
  financialYearOf,
  isPastApproval,
  isRetentionKind,
  monthKeyOf,
  nextWorkflowStatus,
  resubmitTarget,
} from '../calculations.ts';
import { isEnabledForProject } from '../categories.ts';
import { isNoteType } from '../certification.ts';
import { computeDeductions, splitGst, suggestGst, totalFromComponents, type RegistrationSetup } from '../gst.ts';
import { formatBillNumber } from '../defaults.ts';
import { roundMoney } from '../money.ts';
import { buildSearchTokens } from '../reports.ts';
import type { BillInput, WorkflowAction } from '../schemas';
import type {
  Bill,
  BillDeduction,
  BillPaymentStatus,
  BillTrackingConfig,
  BillWorkflowStatus,
  DueDateRevision,
} from '../types';
import { BtError, db, type BtContext } from './context';
import {
  BT_COLLECTIONS,
  clean,
  diffFields,
  loadClient,
  loadConfig,
  loadGstSetup,
  loadProject,
  logActivityTx,
  nowIso,
  userName,
  type ClientRecord,
  type ProjectRecord,
} from './store';

type StoredBill = Bill & { organizationId: string };

const AUDITED_FIELDS = [
  'billSerialNumber',
  'gstInvoiceNumber',
  'transactionType',
  'billDate',
  'financialYear',
  'submissionDate',
  'passedDate',
  'expectedPaymentDate',
  'projectId',
  'clientId',
  'dgmOffice',
  'description',
  'billTypeName',
  'billCategoryName',
  'taxableAmount',
  'gstAmount',
  'gstType',
  'gstPercent',
  'cgstAmount',
  'sgstAmount',
  'igstAmount',
  'gstRegistrationId',
  'againstBillId',
  'deductions',
  'netReceivable',
  'targetWeek',
  'collectionOwnerId',
  'currentStage',
  'remarks',
  'retentionExpectedReleaseDate',
  'retentionDisputed',
] as const;

/** Fields that, once a bill is approved, change only with `Edit After Approval` and a reason. */
const PROTECTED_FIELDS = ['taxableAmount', 'gstAmount', 'deductions', 'gstInvoiceNumber', 'billDate', 'projectId', 'transactionType', 'againstBillId'] as const;

export const calculationOptions = (config: BillTrackingConfig) => ({
  tolerance: config.settings.tolerance,
  roundNetToRupee: config.settings.roundNetToRupee,
});

/** A month closed by finance accepts no new or changed financial records without Close Month. */
export function assertMonthOpen(context: BtContext, config: BillTrackingConfig, dateKeys: (string | undefined)[], what: string): void {
  const closed = dateKeys.filter(Boolean).map((key) => monthKeyOf(key as string)).find((month) => config.settings.closedMonths.includes(month));
  if (closed && !context.can('Settings', 'Close Month')) {
    throw new BtError(`${closed} is closed for editing. ${what} needs a finance administrator to reopen the month.`, 423);
  }
}

/**
 * Deduction lines, recomputed from the bill's own figures with the configured formulas (a % of the
 * taxable or gross less other deductions; GST on GST-applicable deductions). The form's figures are a
 * preview only.
 */
export function resolveDeductions(lines: BillInput['deductions'], config: BillTrackingConfig, context: { taxable: number; gross: number; gstType?: BillInput['gstType'] }, existing: readonly BillDeduction[] = []): BillDeduction[] {
  for (const line of lines) {
    const type = config.deductionTypes.find((entry) => entry.id === line.deductionTypeId);
    // A type retired after a bill used it stays valid on that bill; a new line needs an active type.
    const previously = existing.find((entry) => entry.id === line.id && entry.deductionTypeId === line.deductionTypeId);
    if (!type || (!type.active && !previously)) throw new BtError(`Deduction type ${line.deductionTypeId} is not available.`);
  }
  return computeDeductions(lines, config.deductionTypes, { ...context, roundToRupee: config.settings.roundDeductionsToRupee }).map((line) => clean(line));
}

/** Due date from the project's (or client's, or the module's) credit days. */
export function computeDueDate(baseDate: string, project: ProjectRecord, client: ClientRecord | undefined, config: BillTrackingConfig): string {
  const days = project.creditDays ?? client?.paymentTermsDays ?? config.settings.defaultCreditDays;
  return addDays(baseDate, days);
}

/** GST fields of a bill from the input: CGST + SGST or IGST components, or the legacy single total. */
export function composeGst(input: Pick<BillInput, 'gstType' | 'gstPercent' | 'taxableAmount' | 'gstAmount' | 'cgstAmount' | 'sgstAmount' | 'igstAmount'>) {
  if (!input.gstType) {
    return { gstAmount: roundMoney(input.gstAmount), gstPercent: input.gstPercent, gstType: undefined, cgstRate: undefined, sgstRate: undefined, igstRate: undefined, cgstAmount: undefined, sgstAmount: undefined, igstAmount: undefined };
  }
  const rate = input.gstType === 'none' ? 0 : (input.gstPercent ?? 0);
  const computed = splitGst(input.taxableAmount, input.gstType, rate);
  const cgstAmount = input.gstType === 'cgst-sgst' ? roundMoney(input.cgstAmount ?? computed.cgstAmount) : 0;
  const sgstAmount = input.gstType === 'cgst-sgst' ? roundMoney(input.sgstAmount ?? computed.sgstAmount) : 0;
  const igstAmount = input.gstType === 'igst' ? roundMoney(input.igstAmount ?? computed.igstAmount) : 0;
  return {
    gstType: input.gstType,
    gstPercent: rate,
    cgstRate: computed.cgstRate,
    sgstRate: computed.sgstRate,
    igstRate: computed.igstRate,
    cgstAmount,
    sgstAmount,
    igstAmount,
    gstAmount: totalFromComponents(input.gstType, { cgstAmount, sgstAmount, igstAmount }),
  };
}

/**
 * A credit note must name the invoice it adjusts (a debit note may). The invoice has to be a live
 * bill of the same project that is not itself a note. Credit notes brought in from the legacy
 * workbook carry no reference, so they are not forced to have one until someone links them.
 */
function composeNoteLink(input: BillInput, against: StoredBill | undefined, existing: StoredBill | undefined, projectId: string) {
  const isNote = input.transactionType === 'credit_note' || input.transactionType === 'debit_note';
  if (!isNote) return { againstBillId: undefined, againstBillRef: undefined, againstBillDate: undefined };
  if (!input.againstBillId) {
    if (input.transactionType === 'credit_note' && existing?.source !== 'excel_import') throw new BtError('Choose the invoice this credit note is against.');
    return { againstBillId: undefined, againstBillRef: undefined, againstBillDate: undefined };
  }
  if (!against || against.id !== input.againstBillId) throw new BtError('The invoice this note is against was not found.', 404);
  if (against.isDeleted) throw new BtError('The invoice this note is against has been deleted.');
  if (against.projectId !== projectId) throw new BtError('A credit or debit note must be against an invoice of the same project.');
  if (against.transactionType === 'credit_note' || against.transactionType === 'debit_note') throw new BtError('Choose an invoice, not another credit or debit note.');
  if (existing && against.id === existing.id) throw new BtError('A note cannot be against itself.');
  return { againstBillId: against.id, againstBillRef: against.gstInvoiceNumber || against.billSerialNumber || against.id, againstBillDate: against.billDate };
}

interface ComposeArgs {
  context: BtContext;
  input: BillInput;
  config: BillTrackingConfig;
  project: ProjectRecord;
  client?: ClientRecord;
  existing?: StoredBill;
  ownerName?: string;
  /** The invoice a credit/debit note adjusts, loaded by the caller. */
  against?: StoredBill;
  gstSetup?: RegistrationSetup;
}

/** Builds every stored field of a bill from validated input plus masters; derived totals included. */
export function composeBill({ context, input, config, project, client, existing, ownerName, against, gstSetup }: ComposeArgs): Omit<StoredBill, 'id' | 'createdAt' | 'createdBy' | 'version'> & Partial<Pick<StoredBill, 'createdAt' | 'createdBy' | 'version'>> {
  const billType = config.billTypes.find((entry) => entry.id === input.billTypeId);
  const keeping = existing?.billTypeId === input.billTypeId;
  if (!billType) throw new BtError(keeping ? 'This bill’s sub category was deleted from Settings — choose another.' : 'Choose a sub category.');
  if (!billType.active && !keeping) throw new BtError(`Sub category ${billType.name} is inactive.`);
  // A sub category is offered per project; one already on the bill survives a later narrowing.
  if (!isEnabledForProject(billType, project.id) && !(keeping && existing?.projectId === project.id)) {
    throw new BtError(`Sub category ${billType.name} is not enabled for ${project.name}. Enable it in Settings → Bill categories, or choose another.`);
  }
  const category = config.billCategories.find((entry) => entry.id === billType.categoryId);

  const derivedFy = financialYearOf(input.billDate);
  const financialYear = input.financialYear && input.financialYear !== derivedFy ? input.financialYear : derivedFy;
  if (financialYear !== derivedFy && !context.can('Bills', 'Approve', project.id)) {
    throw new BtError(`The bill date falls in FY ${derivedFy}; only an approver can file it under ${financialYear}.`, 403);
  }

  const clientId = input.clientId ?? project.clientId;
  const clientName = client?.name ?? (clientId === project.clientId ? project.clientName : undefined);

  // GST: from the type, rate and the components entered (the components decide the total); a bill
  // without a type (imported legacy rows) keeps its single GST figure.
  const gst = composeGst(input);
  const suggestion = suggestGst(gstSetup, { projectId: project.id, chosenRegistrationId: input.gstRegistrationId, clientGstin: client?.gstin });
  if (input.gstRegistrationId && !gstSetup?.registrations.some((entry) => entry.id === input.gstRegistrationId)) {
    throw new BtError('That GST registration is not in Expenses → GST registrations.');
  }

  const note = composeNoteLink(input, against, existing, project.id);
  // The client's certification belongs to an invoice; a bill turned into a note cannot keep one.
  if (existing?.certification && isNoteType(input.transactionType)) {
    throw new BtError('This bill has a client certification. Remove the certification before turning it into a credit or debit note.', 409);
  }
  const deductions = resolveDeductions(input.deductions, config, { taxable: input.taxableAmount, gross: roundMoney(input.taxableAmount + gst.gstAmount), gstType: gst.gstType }, existing?.deductions);
  const collections = existing?.collections ?? [];
  const totals = deriveBillTotals(
    {
      taxableAmount: input.taxableAmount,
      gstAmount: gst.gstAmount,
      deductions,
      collections,
      paymentStatusOverride: existing?.paymentStatusOverride,
    },
    calculationOptions(config),
  );

  // Due date: kept as is on edit (revisions go through `changeDueDate`), computed or typed on create.
  let dueDate = existing?.dueDate;
  let originalDueDate = existing?.originalDueDate;
  if (!existing) {
    dueDate = input.dueDate ?? computeDueDate(input.submissionDate ?? input.billDate, project, client, config);
    originalDueDate = dueDate;
  } else if (!existing.dueDate) {
    dueDate = input.dueDate ?? computeDueDate(input.submissionDate ?? input.billDate, project, client, config);
    originalDueDate = dueDate;
  }

  const bill = {
    financialYear,
    serialNumber: input.serialNumber ?? existing?.serialNumber,
    billSerialNumber: input.billSerialNumber ?? existing?.billSerialNumber,
    transactionType: input.transactionType,
    ...note,
    gstInvoiceNumber: input.gstInvoiceNumber,
    billDate: input.billDate,
    submissionDate: input.submissionDate,
    passedDate: input.passedDate,
    dueDate,
    originalDueDate,
    dueDateRevisions: existing?.dueDateRevisions,
    expectedPaymentDate: input.expectedPaymentDate,
    projectId: project.id,
    projectNameSnapshot: project.name,
    clientId,
    clientNameSnapshot: clientName,
    dgmOffice: input.dgmOffice ?? project.dgmOffice,
    description: input.description,
    billTypeId: billType.id,
    billTypeName: billType.name,
    billCategory: billType.categoryId,
    billCategoryName: category?.name ?? existing?.billCategoryName,
    isRetentionBill: billType.isRetentionBill || input.transactionType === 'retention_bill',
    taxableAmount: roundMoney(input.taxableAmount),
    ...gst,
    gstRegistrationId: suggestion.registration?.id,
    gstRegistrationLabel: suggestion.registration ? suggestion.registration.label || suggestion.registration.stateName : undefined,
    gstRegistrationGstin: suggestion.registration?.gstin,
    clientGstin: client?.gstin,
    deductions,
    // Recorded separately (`certification.ts` on the server); an edit of the raised bill keeps it.
    certification: existing?.certification,
    grossAmount: totals.grossAmount,
    totalDeduction: totals.totalDeduction,
    statutoryDeduction: totals.statutoryDeduction,
    retentionDeducted: totals.retentionDeducted,
    netReceivable: totals.netReceivable,
    totalReceived: totals.totalReceived,
    outstandingAmount: totals.outstandingAmount,
    shortfallSurplus: totals.shortfallSurplus,
    lastReceiptDate: totals.lastReceiptDate,
    paymentStatus: totals.paymentStatus,
    paymentStatusOverride: existing?.paymentStatusOverride,
    collections,
    workflowStatus: existing?.workflowStatus ?? 'draft',
    returnedFrom: existing?.returnedFrom,
    currentStage: input.currentStage,
    targetWeek: input.targetWeek,
    receivedWeek: existing?.receivedWeek,
    collectionOwnerId: input.collectionOwnerId,
    collectionOwnerName: input.collectionOwnerId ? (ownerName ?? existing?.collectionOwnerName) : undefined,
    retentionExpectedReleaseDate: input.retentionExpectedReleaseDate,
    retentionDisputed: input.retentionDisputed,
    lastFollowUpDate: existing?.lastFollowUpDate,
    nextFollowUpDate: existing?.nextFollowUpDate,
    nextCommitmentDate: existing?.nextCommitmentDate,
    nextCommitmentAmount: existing?.nextCommitmentAmount,
    remarks: input.remarks,
    typeV2: existing?.typeV2,
    taxableOrAdvance: input.taxableOrAdvance ?? existing?.taxableOrAdvance,
    legacyStatus: existing?.legacyStatus,
    legacyTimestamp: existing?.legacyTimestamp,
    importedNetAmount: existing?.importedNetAmount,
    importedTotalDeduction: existing?.importedTotalDeduction,
    importedReceived: existing?.importedReceived,
    netMismatch: existing?.netMismatch,
    importJobId: existing?.importJobId,
    importRowNumber: existing?.importRowNumber,
    importFingerprint: existing?.importFingerprint,
    source: existing?.source ?? 'manual',
    organizationId: context.organizationId,
    updatedAt: nowIso(),
    updatedBy: context.userId,
    updatedByName: context.userName,
    isDeleted: false,
  } satisfies Partial<StoredBill>;

  return { ...bill, searchTokens: buildSearchTokens(bill) } as ReturnType<typeof composeBill>;
}

/** The invoice a credit/debit note names, if any (scope is checked by composeBill's same-project rule). */
async function loadAgainst(context: BtContext, billId: string | undefined): Promise<StoredBill | undefined> {
  if (!billId) return undefined;
  const snapshot = await db().collection(BT_COLLECTIONS.bills).doc(billId).get();
  if (!snapshot.exists) return undefined;
  const bill = { ...(snapshot.data() as StoredBill), id: snapshot.id };
  return bill.organizationId === context.organizationId ? bill : undefined;
}

/** Rejects a second live bill with the same non-empty GST invoice number in the same project. */
async function assertUniqueInvoice(context: BtContext, projectId: string, invoice: string | undefined, ignoreId?: string): Promise<void> {
  if (!invoice) return;
  const snapshot = await db()
    .collection(BT_COLLECTIONS.bills)
    .where('organizationId', '==', context.organizationId)
    .where('projectId', '==', projectId)
    .where('gstInvoiceNumber', '==', invoice)
    .where('isDeleted', '==', false)
    .limit(2)
    .get();
  const clash = snapshot.docs.find((doc) => doc.id !== ignoreId);
  if (clash) throw new BtError(`GST invoice ${invoice} is already recorded on this project (bill ${clash.data().billSerialNumber ?? clash.id}).`, 409, { billId: clash.id });
}

export async function createBill(context: BtContext, input: BillInput): Promise<{ id: string }> {
  context.require('Bills', 'Add', input.projectId);
  const config = await loadConfig(context.organizationId);
  assertMonthOpen(context, config, [input.billDate], 'Adding a bill dated in it');
  const project = await loadProject(input.projectId, config.projectProfiles);
  const client = await loadClient(input.clientId ?? project.clientId);
  await assertUniqueInvoice(context, project.id, input.gstInvoiceNumber);
  const ownerName = await userName(input.collectionOwnerId);
  const [against, gstSetup] = await Promise.all([loadAgainst(context, input.againstBillId), loadGstSetup()]);

  const firestore = db();
  const ref = firestore.collection(BT_COLLECTIONS.bills).doc();
  await firestore.runTransaction(async (transaction) => {
    const composed = composeBill({ context, input, config, project, client, ownerName, against, gstSetup });
    let billSerialNumber = composed.billSerialNumber;
    if ((input.autoNumber || !billSerialNumber) && config.settings.numbering.enabled) {
      const counterRef = firestore.collection(BT_COLLECTIONS.counters).doc(`${context.organizationId}_${composed.financialYear}`);
      const counter = await transaction.get(counterRef);
      const next = (counter.exists ? Number(counter.data()?.value ?? 0) : 0) + 1;
      transaction.set(counterRef, { value: next, updatedAt: nowIso() }, { merge: true });
      billSerialNumber = formatBillNumber(config.settings.numbering.pattern, composed.financialYear, next, config.settings.numbering.padding);
    }
    const bill = clean({
      ...composed,
      billSerialNumber,
      searchTokens: buildSearchTokens({ ...composed, billSerialNumber }),
      createdAt: nowIso(),
      createdBy: context.userId,
      createdByName: context.userName,
      version: 1,
    });
    transaction.set(ref, bill);
    logActivityTx(transaction, context, {
      entityType: 'bill',
      entityId: ref.id,
      billId: ref.id,
      projectId: project.id,
      action: 'bill_created',
      summary: `Bill ${billSerialNumber ?? ''} created for ${project.name} — net ${bill.netReceivable}`,
      next: { netReceivable: bill.netReceivable, taxableAmount: bill.taxableAmount, gstAmount: bill.gstAmount },
    });
  });
  return { id: ref.id };
}

export async function updateBill(context: BtContext, billId: string, input: BillInput): Promise<{ id: string; version: number }> {
  const config = await loadConfig(context.organizationId);
  const firestore = db();
  const ref = firestore.collection(BT_COLLECTIONS.bills).doc(billId);
  const preview = await ref.get();
  if (!preview.exists) throw new BtError('Bill not found.', 404);
  const before = { ...(preview.data() as StoredBill), id: preview.id };
  if (before.organizationId !== context.organizationId) throw new BtError('Bill not found.', 404);
  context.require('Bills', 'Edit', before.projectId);
  if (input.projectId !== before.projectId) context.require('Bills', 'Edit', input.projectId);
  if (before.isDeleted) throw new BtError('A deleted bill cannot be edited.', 410);

  const project = await loadProject(input.projectId, config.projectProfiles);
  const client = await loadClient(input.clientId ?? project.clientId);
  await assertUniqueInvoice(context, project.id, input.gstInvoiceNumber, billId);
  const ownerName = await userName(input.collectionOwnerId);
  const [against, gstSetup] = await Promise.all([loadAgainst(context, input.againstBillId), loadGstSetup()]);

  let version = 0;
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = { ...(snapshot.data() as StoredBill), id: snapshot.id };
    if (input.expectedVersion !== undefined && input.expectedVersion !== current.version) {
      throw new BtError('Someone else changed this bill while you were editing it. Reload to see their changes, then edit again.', 409);
    }
    const composed = composeBill({ context, input, config, project, client, existing: current, ownerName, against, gstSetup });

    const protectedChange = PROTECTED_FIELDS.filter((key) => JSON.stringify(current[key] ?? null) !== JSON.stringify((composed as Record<string, unknown>)[key] ?? null));
    if (protectedChange.length && isPastApproval(current.workflowStatus)) {
      if (!context.can('Bills', 'Edit After Approval', current.projectId)) {
        throw new BtError(`This bill is ${current.workflowStatus.replace(/_/g, ' ')}; changing ${protectedChange.join(', ')} needs Edit After Approval.`, 403);
      }
      if (!input.changeReason) throw new BtError('Give a reason for changing financial details of an approved bill.');
    }
    const financialChange = protectedChange.length > 0;
    if (financialChange) assertMonthOpen(context, config, [current.billDate, composed.billDate], 'Changing a bill dated in it');

    version = (current.version ?? 1) + 1;
    transaction.set(ref, clean({ ...composed, createdAt: current.createdAt, createdBy: current.createdBy, createdByName: current.createdByName, version }));
    const diff = diffFields(current as unknown as Record<string, unknown>, composed as unknown as Record<string, unknown>, AUDITED_FIELDS);
    if (diff) {
      logActivityTx(transaction, context, {
        entityType: 'bill',
        entityId: billId,
        billId,
        projectId: current.projectId,
        action: financialChange ? 'bill_amount_changed' : 'bill_edited',
        summary: `Bill ${current.billSerialNumber ?? ''} edited: ${Object.keys(diff.next).join(', ')}`,
        ...diff,
        reason: input.changeReason,
      });
    }
  });
  return { id: billId, version };
}

export async function deleteBill(context: BtContext, billId: string, reason: string): Promise<void> {
  const config = await loadConfig(context.organizationId);
  const ref = db().collection(BT_COLLECTIONS.bills).doc(billId);
  await db().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new BtError('Bill not found.', 404);
    const bill = { ...(snapshot.data() as StoredBill), id: snapshot.id };
    if (bill.organizationId !== context.organizationId) throw new BtError('Bill not found.', 404);
    context.require('Bills', 'Delete', bill.projectId);
    if (bill.isDeleted) return;
    if (bill.collections.some((entry) => entry.status !== 'cancelled')) {
      throw new BtError('Cancel the receipts recorded against this bill before deleting it.', 409);
    }
    assertMonthOpen(context, config, [bill.billDate], 'Deleting a bill dated in it');
    transaction.update(ref, { isDeleted: true, deletedAt: nowIso(), deletedBy: context.userId, deleteReason: reason, paymentStatus: 'cancelled', outstandingAmount: 0, version: (bill.version ?? 1) + 1, updatedAt: nowIso(), updatedBy: context.userId });
    logActivityTx(transaction, context, { entityType: 'bill', entityId: billId, billId, projectId: bill.projectId, action: 'bill_deleted', summary: `Bill ${bill.billSerialNumber ?? ''} deleted (soft)`, previous: { netReceivable: bill.netReceivable }, reason });
  });
}

/* ── workflow ────────────────────────────────────────────────────────────── */

const ACTION_RULES: Record<WorkflowAction, { from: BillWorkflowStatus[] | 'any_open'; to: BillWorkflowStatus | 'next' | 'resubmit'; permission: [Parameters<BtContext['require']>[0], string] }> = {
  submit: { from: ['draft'], to: 'submitted', permission: ['Bills', 'Edit'] },
  start_verification: { from: ['submitted'], to: 'under_verification', permission: ['Bills', 'Verify'] },
  verify: { from: ['under_verification', 'submitted'], to: 'verified', permission: ['Bills', 'Verify'] },
  // Under verification, Verified and Approved are optional: approval needs no verification first,
  // and a bill can be marked raised from any step before it.
  approve: { from: ['submitted', 'under_verification', 'verified'], to: 'approved', permission: ['Bills', 'Approve'] },
  raise: { from: ['draft', 'submitted', 'under_verification', 'verified', 'approved'], to: 'raised', permission: ['Bills', 'Edit'] },
  // Certified is reached by recording the client's certification (server/certification.ts), not by a button.
  start_followup: { from: ['raised', 'certified'], to: 'payment_followup', permission: ['Bills', 'Edit'] },
  reconcile: { from: ['payment_followup', 'raised', 'certified'], to: 'reconciliation', permission: ['Bills', 'Verify'] },
  close: { from: ['reconciliation', 'payment_followup', 'raised', 'certified'], to: 'closed', permission: ['Bills', 'Approve'] },
  return: { from: ['submitted', 'under_verification', 'verified', 'approved'], to: 'returned', permission: ['Bills', 'Verify'] },
  resubmit: { from: ['returned'], to: 'resubmit', permission: ['Bills', 'Edit'] },
  reopen: { from: ['closed'], to: 'payment_followup', permission: ['Bills', 'Approve'] },
};

/** Base-role names holding a Bill Tracking permission — the recipients of "needs your action". */
async function rolesHolding(resource: string, action: string): Promise<string[]> {
  const roles = await db().collection('roles').get();
  return roles.docs.filter((doc) => (doc.data().permissions?.[`Bill Tracking.${resource}`] ?? []).includes(action)).map((doc) => String(doc.data().name ?? doc.id));
}

export async function applyWorkflowAction(context: BtContext, billId: string, action: WorkflowAction, remarks?: string): Promise<{ status: BillWorkflowStatus }> {
  const rule = ACTION_RULES[action];
  const ref = db().collection(BT_COLLECTIONS.bills).doc(billId);
  let result = 'draft' as BillWorkflowStatus;
  let bill: StoredBill | undefined;
  await db().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new BtError('Bill not found.', 404);
    bill = { ...(snapshot.data() as StoredBill), id: snapshot.id };
    if (bill.organizationId !== context.organizationId || bill.isDeleted) throw new BtError('Bill not found.', 404);
    context.require(rule.permission[0], rule.permission[1], bill.projectId);
    if (rule.from !== 'any_open' && !rule.from.includes(bill.workflowStatus)) {
      throw new BtError(`A ${bill.workflowStatus.replace(/_/g, ' ')} bill cannot be moved by "${action.replace(/_/g, ' ')}".`, 409);
    }
    if (action === 'return' && !remarks) throw new BtError('Say what needs correcting when returning a bill.');
    if (action === 'close' && bill.paymentStatus !== 'received' && bill.paymentStatus !== 'adjusted') {
      throw new BtError('Only a fully received or adjusted bill can be closed. Record the remaining receipt or override the status with a reason.', 409);
    }
    const to: BillWorkflowStatus = rule.to === 'resubmit' ? resubmitTarget(bill.returnedFrom) : rule.to === 'next' ? (nextWorkflowStatus(bill.workflowStatus) ?? bill.workflowStatus) : rule.to;
    result = to;
    transaction.update(ref, clean({
      workflowStatus: to,
      returnedFrom: action === 'return' ? bill.workflowStatus : action === 'resubmit' ? FieldValue.delete() : bill.returnedFrom,
      version: (bill.version ?? 1) + 1,
      updatedAt: nowIso(),
      updatedBy: context.userId,
      updatedByName: context.userName,
    }));
    logActivityTx(transaction, context, {
      entityType: 'bill',
      entityId: billId,
      billId,
      projectId: bill.projectId,
      action: `workflow_${action}`,
      summary: `Bill ${bill.billSerialNumber ?? ''}: ${bill.workflowStatus.replace(/_/g, ' ')} → ${to.replace(/_/g, ' ')}`,
      previous: { workflowStatus: bill.workflowStatus },
      next: { workflowStatus: to },
      reason: remarks,
    });
  });

  // Notifications after commit: a failed notification must never roll back a workflow step.
  if (bill) {
    const reference = bill.gstInvoiceNumber || bill.billSerialNumber || bill.id;
    const link = `/bill-tracking/bills/${bill.id}`;
    const base = { module: ACTIVITY_MODULES.BILL_TRACKING, itemId: bill.id, itemRef: reference, link, organizationId: context.organizationId };
    try {
      if (result === 'submitted' || result === 'under_verification') {
        const roles = await rolesHolding('Bills', 'Verify');
        const userIds = (await resolveRoleRecipientsServer(roles)).filter((id) => id !== context.userId);
        await dispatchNotificationServer({ userIds }, { ...base, type: 'approval_required', title: 'Bill submitted for verification', body: `${reference} · ${bill.projectNameSnapshot} · net ₹${bill.netReceivable.toLocaleString('en-IN')}` });
      } else if (result === 'verified') {
        const roles = await rolesHolding('Bills', 'Approve');
        const userIds = (await resolveRoleRecipientsServer(roles)).filter((id) => id !== context.userId);
        await dispatchNotificationServer({ userIds }, { ...base, type: 'approval_required', title: 'Bill verified — approval needed', body: `${reference} · ${bill.projectNameSnapshot}` });
      } else if (result === 'returned' || result === 'approved') {
        const userIds = [bill.createdBy, bill.collectionOwnerId].filter((id): id is string => Boolean(id) && id !== context.userId);
        await dispatchNotificationServer({ userIds }, { ...base, type: 'step_entry', severity: result === 'returned' ? 'WARNING' : 'INFO', title: result === 'returned' ? 'Bill returned for correction' : 'Bill approved', body: `${reference} · ${remarks ?? bill.projectNameSnapshot}` });
      }
    } catch {
      // Delivery is best-effort; the audit trail already records the step.
    }
  }
  return { status: result };
}

/* ── controlled corrections ──────────────────────────────────────────────── */

export async function overridePaymentStatus(context: BtContext, billId: string, status: BillPaymentStatus | null, reason: string): Promise<void> {
  const config = await loadConfig(context.organizationId);
  const ref = db().collection(BT_COLLECTIONS.bills).doc(billId);
  await db().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const bill = { ...(snapshot.data() as StoredBill), id: snapshot.id };
    if (!snapshot.exists || bill.organizationId !== context.organizationId || bill.isDeleted) throw new BtError('Bill not found.', 404);
    context.require('Bills', 'Override Status', bill.projectId);
    if (status === 'cancelled') throw new BtError('Delete the bill instead of overriding it to cancelled.');
    const override = status ? { status, reason, by: context.userId, at: nowIso() } : undefined;
    const totals = deriveBillTotals({ ...bill, paymentStatusOverride: override }, calculationOptions(config));
    transaction.update(ref, {
      paymentStatusOverride: override ?? FieldValue.delete(),
      paymentStatus: totals.paymentStatus,
      outstandingAmount: totals.outstandingAmount,
      version: (bill.version ?? 1) + 1,
      updatedAt: nowIso(),
      updatedBy: context.userId,
    });
    logActivityTx(transaction, context, {
      entityType: 'bill',
      entityId: billId,
      billId,
      projectId: bill.projectId,
      action: status ? 'status_override' : 'status_override_cleared',
      summary: status ? `Payment status overridden to ${status.replace(/_/g, ' ')} (computed: ${totals.computedPaymentStatus.replace(/_/g, ' ')})` : 'Payment status override removed',
      previous: { paymentStatus: bill.paymentStatus, outstandingAmount: bill.outstandingAmount },
      next: { paymentStatus: totals.paymentStatus, outstandingAmount: totals.outstandingAmount },
      reason,
    });
  });
}

/**
 * Resolves an import net mismatch. The bill's net is always the calculated one (it follows the
 * source values); resolving records that finance reviewed the difference and why — the imported
 * figure stays on the bill for the record.
 */
export async function resolveNetMismatch(context: BtContext, billId: string, resolution: string, reason: string): Promise<void> {
  const ref = db().collection(BT_COLLECTIONS.bills).doc(billId);
  await db().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const bill = { ...(snapshot.data() as StoredBill), id: snapshot.id };
    if (!snapshot.exists || bill.organizationId !== context.organizationId) throw new BtError('Bill not found.', 404);
    context.require('Bills', 'Verify', bill.projectId);
    if (!bill.netMismatch) throw new BtError('This bill has no net mismatch to resolve.', 409);
    const netMismatch = { ...bill.netMismatch, resolvedBy: context.userId, resolvedAt: nowIso(), resolution: `${resolution}: ${reason}` };
    transaction.update(ref, { netMismatch, version: (bill.version ?? 1) + 1, updatedAt: nowIso(), updatedBy: context.userId });
    logActivityTx(transaction, context, { entityType: 'bill', entityId: billId, billId, projectId: bill.projectId, action: 'net_mismatch_resolved', summary: `Net mismatch resolved (imported ${bill.netMismatch.imported}, calculated ${bill.netMismatch.calculated})`, reason });
  });
}

export async function changeDueDate(context: BtContext, billId: string, dueDate: string, reason: string): Promise<void> {
  const ref = db().collection(BT_COLLECTIONS.bills).doc(billId);
  await db().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const bill = { ...(snapshot.data() as StoredBill), id: snapshot.id };
    if (!snapshot.exists || bill.organizationId !== context.organizationId || bill.isDeleted) throw new BtError('Bill not found.', 404);
    context.require('Bills', 'Approve', bill.projectId);
    const revision: DueDateRevision = clean({ previousDueDate: bill.dueDate, dueDate, reason, changedBy: context.userId, changedByName: context.userName, changedAt: nowIso() });
    transaction.update(ref, {
      dueDate,
      originalDueDate: bill.originalDueDate ?? bill.dueDate ?? dueDate,
      dueDateRevisions: [...(bill.dueDateRevisions ?? []), revision],
      version: (bill.version ?? 1) + 1,
      updatedAt: nowIso(),
      updatedBy: context.userId,
    });
    logActivityTx(transaction, context, { entityType: 'bill', entityId: billId, billId, projectId: bill.projectId, action: 'due_date_changed', summary: `Due date ${bill.dueDate ?? '—'} → ${dueDate}`, previous: { dueDate: bill.dueDate ?? null }, next: { dueDate }, reason });
  });
}

/** Planning fields only — amounts are never bulk-editable. */
export async function bulkUpdate(context: BtContext, billIds: string[], action: string, values: { ownerId?: string; targetWeek?: string; date?: string }): Promise<{ updated: number; skipped: number }> {
  const ownerName = await userName(values.ownerId);
  let updated = 0;
  let skipped = 0;
  for (const billId of billIds) {
    const ref = db().collection(BT_COLLECTIONS.bills).doc(billId);
    await db().runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const bill = { ...(snapshot.data() as StoredBill), id: snapshot.id };
      if (!snapshot.exists || bill.organizationId !== context.organizationId || bill.isDeleted || !context.can('Bills', 'Edit', bill.projectId)) {
        skipped += 1;
        return;
      }
      const patch: Record<string, unknown> =
        action === 'assign_owner'
          ? { collectionOwnerId: values.ownerId ?? FieldValue.delete(), collectionOwnerName: ownerName ?? FieldValue.delete() }
          : action === 'set_target_week'
            ? { targetWeek: values.targetWeek ?? FieldValue.delete() }
            : action === 'set_next_follow_up'
              ? { nextFollowUpDate: values.date ?? FieldValue.delete() }
              : { expectedPaymentDate: values.date ?? FieldValue.delete() };
      transaction.update(ref, { ...patch, version: (bill.version ?? 1) + 1, updatedAt: nowIso(), updatedBy: context.userId });
      logActivityTx(transaction, context, { entityType: 'bill', entityId: billId, billId, projectId: bill.projectId, action: `bulk_${action}`, summary: `Bulk update: ${action.replace(/_/g, ' ')}`, next: { ...values, ownerName } });
      updated += 1;
    });
  }
  return { updated, skipped };
}

export const isRetentionLine = (line: BillDeduction) => isRetentionKind(line.kind);

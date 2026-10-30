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
  isRetentionKind,
  isoWeekOf,
  monthKeyOf,
  protectedChanges,
  type BillDerivedTotals,
} from '../calculations.ts';
import { isEnabledForProject } from '../categories.ts';
import { isNoteType } from '../certification.ts';
import { actionBlocked, amountsLocked, isPastApproval, isRoleStep, moveTarget, nextStepAfter, stepDoers, stepLabel, workflowStep, type WorkflowActor, type WorkflowMove } from '../workflow.ts';
import { computeDeductions, keepsIssuedLines, splitGst, suggestGst, totalFromComponents, type DeductionContext, type RegistrationSetup } from '../gst.ts';
import { formatBillNumber } from '../defaults.ts';
import { noteDeductionBase } from '../note-rules.ts';
import { roundMoney, toPaise } from '../money.ts';
import { buildSearchTokens } from '../reports.ts';
import type { BillInput, WorkflowAction } from '../schemas';
import type {
  Bill,
  BillDeduction,
  BillPaymentStatus,
  BillTrackingConfig,
  BillWorkflowStatus,
  DeductionTypeMaster,
  DueDateRevision,
} from '../types';
import { BtError, db, type BtContext, type BtResource } from './context';
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
  'adjustsNoteId',
  'deductions',
  'netReceivable',
  'targetWeek',
  'collectionOwnerId',
  'currentStage',
  'remarks',
  'retentionExpectedReleaseDate',
  'retentionDisputed',
  'releasesRetention',
] as const;

export const calculationOptions = (config: BillTrackingConfig) => ({
  tolerance: config.settings.tolerance,
  roundNetToRupee: config.settings.roundNetToRupee,
});

/**
 * Every derived total as a bill stores it. A write that changes a source value — the bill, a
 * receipt, the client's certification — stores all of them, so the net, outstanding and status
 * always agree, and the raised deductions' total and net stay beside the effective ones (the
 * certified ones once certified) for raised vs certified.
 */
export const derivedFields = (totals: BillDerivedTotals) => ({
  grossAmount: totals.grossAmount,
  totalDeduction: totals.totalDeduction,
  statutoryDeduction: totals.statutoryDeduction,
  retentionDeducted: totals.retentionDeducted,
  netReceivable: totals.netReceivable,
  raisedTotalDeduction: totals.raisedTotalDeduction,
  raisedNetReceivable: totals.raisedNetReceivable,
  totalReceived: totals.totalReceived,
  outstandingAmount: totals.outstandingAmount,
  shortfallSurplus: totals.shortfallSurplus,
  paymentStatus: totals.paymentStatus,
});

/**
 * The update that stores a bill's recomputed totals in place: all of them, the last receipt date,
 * and RECEIVED WEEK — the week the bill became fully paid, as the legacy sheet recorded it.
 */
export function totalsUpdate(bill: Pick<Bill, 'paymentStatus'>, totals: BillDerivedTotals): Record<string, unknown> {
  const update: Record<string, unknown> = { ...derivedFields(totals), lastReceiptDate: totals.lastReceiptDate ?? FieldValue.delete() };
  if (totals.paymentStatus === 'received' && bill.paymentStatus !== 'received' && totals.lastReceiptDate) update.receivedWeek = isoWeekOf(totals.lastReceiptDate);
  if (totals.paymentStatus !== 'received' && bill.paymentStatus === 'received') update.receivedWeek = FieldValue.delete();
  return update;
}

/** A month closed by finance accepts no new or changed financial records without Close Month. */
export function assertMonthOpen(context: BtContext, config: BillTrackingConfig, dateKeys: (string | undefined)[], what: string): void {
  const closed = dateKeys.filter(Boolean).map((key) => monthKeyOf(key as string)).find((month) => config.settings.closedMonths.includes(month));
  if (closed && !context.can('Settings', 'Close Month')) {
    throw new BtError(`${closed} is closed for editing. ${what} needs a finance administrator to reopen the month.`, 423);
  }
}

/**
 * Deduction lines, recomputed from the bill's own figures with the configured formulas (a % of the
 * taxable or gross less other deductions; GST on GST-applicable deductions) — or, for the heads a note
 * rule covers on a debit note, from the invoice plus its notes (`invoiceBase`). The form's figures are
 * a preview only.
 */
export function resolveDeductions(lines: BillInput['deductions'], config: BillTrackingConfig, context: { taxable: number; gross: number; gstType?: BillInput['gstType']; invoiceBase?: DeductionContext['invoiceBase'] }, existing: readonly BillDeduction[] = []): BillDeduction[] {
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

/**
 * A note settling a debit note's certification names that debit note. It must be a live debit note
 * against the same invoice — a note is never raised against another note — and not itself one settling
 * another. Any other bill drops the link.
 */
function composeAdjusts(input: BillInput, adjusted: StoredBill | undefined, existing: StoredBill | undefined, againstBillId: string | undefined) {
  if (!input.adjustsNoteId || !isNoteType(input.transactionType)) return { adjustsNoteId: undefined, adjustsNoteRef: undefined };
  if (!adjusted || adjusted.id !== input.adjustsNoteId) throw new BtError('The debit note this note settles was not found.', 404);
  const reference = adjusted.gstInvoiceNumber || adjusted.billSerialNumber || adjusted.id;
  if (adjusted.isDeleted) throw new BtError(`Debit note ${reference}, which this note settles, has been deleted.`);
  if (adjusted.transactionType !== 'debit_note' || adjusted.adjustsNoteId) throw new BtError('A note can settle only a debit note’s own certification.');
  if (existing && adjusted.id === existing.id) throw new BtError('A note cannot settle itself.');
  if ((adjusted.againstBillId ?? null) !== (againstBillId ?? null)) {
    throw new BtError(`A note settling debit note ${reference} is raised against the same invoice${adjusted.againstBillRef ? `, ${adjusted.againstBillRef}` : ''}.`);
  }
  return { adjustsNoteId: adjusted.id, adjustsNoteRef: reference };
}

/** A slab rate kept to 4 dp, as `retention.ts` reads it, so a stored rate always matches its slab key. */
export const roundSlabRate = (rate: number | null): number | null => (rate === null ? null : Math.round(rate * 10000) / 10000);

/**
 * The retention head a bill or release names as the slab it releases. It has to be in the deduction
 * master and be a retention kind; a head retired since stays valid, as retention may still be held under it.
 */
export function retentionHead(config: BillTrackingConfig, deductionTypeId: string): DeductionTypeMaster {
  const type = config.deductionTypes.find((entry) => entry.id === deductionTypeId);
  if (!type) throw new BtError('That retention head is no longer in Settings → Deduction type master. Choose another.');
  if (!isRetentionKind(type.kind)) throw new BtError(`${type.name} is not a retention head. Only retention can be released.`);
  return type;
}

/**
 * The retention slab a retention bill releases; receipts on it release that slab. Any other bill
 * drops it, so a bill changed into an invoice no longer claims to release retention.
 */
function composeReleasesRetention(input: BillInput, config: BillTrackingConfig, isRetentionBill: boolean): Bill['releasesRetention'] {
  if (!isRetentionBill || !input.releasesRetention) return undefined;
  const type = retentionHead(config, input.releasesRetention.deductionTypeId);
  return { deductionTypeId: type.id, rate: roundSlabRate(input.releasesRetention.rate) };
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
  /** The live notes against that invoice: a note rule takes a debit note's deductions of the invoice plus them. */
  invoiceNotes?: readonly StoredBill[];
  /** The debit note whose certification this note settles (`adjustsNoteId`), loaded by the caller. */
  adjusted?: StoredBill;
  gstSetup?: RegistrationSetup;
}

/** Builds every stored field of a bill from validated input plus masters; derived totals included. */
export function composeBill({ context, input, config, project, client, existing, ownerName, against, invoiceNotes = [], adjusted, gstSetup }: ComposeArgs):Omit<StoredBill, 'id' | 'createdAt' | 'createdBy' | 'version'> & Partial<Pick<StoredBill, 'createdAt' | 'createdBy' | 'version'>> {
  const billType = config.billTypes.find((entry) => entry.id === input.billTypeId);
  const keeping = existing?.billTypeId === input.billTypeId;
  if (!billType) throw new BtError(keeping ? 'This bill’s sub category was deleted from Settings — choose another.' : 'Choose a sub category.');
  if (!billType.active && !keeping) throw new BtError(`Sub category ${billType.name} is inactive.`);
  // A sub category is offered per project; one already on the bill survives a later narrowing.
  if (!isEnabledForProject(billType, project.id) && !(keeping && existing?.projectId === project.id)) {
    throw new BtError(`Sub category ${billType.name} is not enabled for ${project.name}. Enable it in Settings → Bill categories, or choose another.`);
  }
  const category = config.billCategories.find((entry) => entry.id === billType.categoryId);
  const isRetentionBill = billType.isRetentionBill || input.transactionType === 'retention_bill';
  const releasesRetention = composeReleasesRetention(input, config, isRetentionBill);

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
  // A credit note takes value off its invoice and a debit note adds to it: a figure of the other sign
  // would turn one into the other while it still counts as itself.
  const figures = [input.taxableAmount, gst.gstAmount, gst.cgstAmount ?? 0, gst.sgstAmount ?? 0, gst.igstAmount ?? 0].map(toPaise);
  if (input.transactionType === 'credit_note' && figures.some((value) => value > 0)) {
    throw new BtError('A credit note carries negative figures: enter its taxable value and GST below zero (−10,000, not 10,000).');
  }
  if (input.transactionType === 'debit_note' && figures.some((value) => value < 0)) {
    throw new BtError('A debit note carries positive figures: enter its taxable value and GST above zero. To reduce an invoice, raise a credit note.');
  }
  const suggestion = suggestGst(gstSetup, { projectId: project.id, chosenRegistrationId: input.gstRegistrationId, clientGstin: client?.gstin });
  if (input.gstRegistrationId && !gstSetup?.registrations.some((entry) => entry.id === input.gstRegistrationId)) {
    throw new BtError('That GST registration is not in Expenses → GST registrations.');
  }
  // A bill stored without a registration (imported rows) keeps none until someone chooses one: working
  // one out on an unrelated edit would change a protected field behind the user's back.
  const registration = existing && !existing.gstRegistrationId && !input.gstRegistrationId ? undefined : suggestion.registration;

  const note = composeNoteLink(input, against, existing, project.id);
  const adjusts = composeAdjusts(input, adjusted, existing, note.againstBillId);
  // A certified bill stays one the client certifies: it cannot turn into another kind of note, or into
  // a note settling a debit note (a certified debit note may still be edited as one).
  if (existing?.certification && ((isNoteType(input.transactionType) && input.transactionType !== existing.transactionType) || adjusts.adjustsNoteId)) {
    throw new BtError(
      adjusts.adjustsNoteId
        ? 'This bill has a client certification, so it cannot settle another debit note’s. Remove the certification first.'
        : 'This bill has a client certification. Remove the certification before turning it into a credit or debit note.',
      409,
    );
  }
  // A debit note under a note rule takes the rule's heads of the invoice plus its notes up to it,
  // fixed now so a later note does not move it.
  const noteBase = note.againstBillId
    ? noteDeductionBase(
        config.settings.noteRules,
        { id: existing?.id, transactionType: input.transactionType, billDate: input.billDate, createdAt: existing?.createdAt, taxableAmount: roundMoney(input.taxableAmount), gstAmount: gst.gstAmount },
        against,
        invoiceNotes,
        config.deductionTypes,
      )
    : undefined;
  // An edit that changes neither the lines nor the figures they are worked out from keeps the lines as
  // issued: a later change to a deduction head in Settings, or a note added since, never alters an
  // issued bill behind an unrelated edit (a remark, the stage, the owner).
  const keepLines =
    existing !== undefined &&
    keepsIssuedLines(existing, { transactionType: input.transactionType, billDate: input.billDate, againstBillId: note.againstBillId, gstType: gst.gstType, taxableAmount: input.taxableAmount, gstAmount: gst.gstAmount, cgstAmount: gst.cgstAmount, sgstAmount: gst.sgstAmount, igstAmount: gst.igstAmount }, input.deductions);
  const deductions =
    keepLines && existing
      ? (existing.deductions ?? []).map((line, index) => clean({ ...line, remarks: input.deductions[index].remarks, deductionDate: input.deductions[index].deductionDate }))
      : resolveDeductions(input.deductions, config, { taxable: input.taxableAmount, gross: roundMoney(input.taxableAmount + gst.gstAmount), gstType: gst.gstType, invoiceBase: noteBase }, existing?.deductions);
  // Left out of the invoice's certification check only when the note bills the balance under its
  // rule — it carries lines taken of the invoice plus its notes. A note raised to match the client's
  // certification carries none, so it counts there like any other.
  const outsideCertification = noteBase && !noteBase.rule.countInCertification && deductions.some((line) => line.invoiceBase !== undefined) ? true : undefined;
  const collections = existing?.collections ?? [];
  const totals = deriveBillTotals(
    {
      taxableAmount: input.taxableAmount,
      gstAmount: gst.gstAmount,
      deductions,
      collections,
      paymentStatusOverride: existing?.paymentStatusOverride,
      // A certified bill stays paid against its certified deductions, whatever the edit does to the raised ones.
      certification: existing?.certification,
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
    ...adjusts,
    outsideCertification,
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
    isRetentionBill,
    taxableAmount: roundMoney(input.taxableAmount),
    ...gst,
    gstRegistrationId: registration?.id,
    gstRegistrationLabel: registration ? registration.label || registration.stateName : undefined,
    gstRegistrationGstin: registration?.gstin,
    clientGstin: client?.gstin,
    deductions,
    // Recorded separately (`certification.ts` on the server); an edit of the raised bill keeps it.
    certification: existing?.certification,
    ...derivedFields(totals),
    lastReceiptDate: totals.lastReceiptDate,
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
    // Always present (from the input): `updateBill` rewrites the whole document.
    releasesRetention,
    lastFollowUpDate: existing?.lastFollowUpDate,
    nextFollowUpDate: existing?.nextFollowUpDate,
    nextCommitmentDate: existing?.nextCommitmentDate,
    nextCommitmentAmount: existing?.nextCommitmentAmount,
    remarks: input.remarks,
    typeV2: existing?.typeV2,
    // As sent: the bill form always sends it, so clearing "Bill / PI" clears it.
    taxableOrAdvance: input.taxableOrAdvance,
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

/**
 * The live notes against the invoice a debit note names — the base a note rule takes its deductions
 * of. Read only for a debit note against an invoice while some rule is active.
 */
async function loadInvoiceNotes(context: BtContext, input: BillInput, config: BillTrackingConfig): Promise<StoredBill[]> {
  if (input.transactionType !== 'debit_note' || !input.againstBillId || !config.settings.noteRules?.some((rule) => rule.active)) return [];
  const snapshot = await db().collection(BT_COLLECTIONS.bills).where('againstBillId', '==', input.againstBillId).get();
  return snapshot.docs.map((doc) => ({ ...(doc.data() as StoredBill), id: doc.id })).filter((bill) => bill.organizationId === context.organizationId && !bill.isDeleted);
}

/** How many live notes settle this debit note's certification (`adjustsNoteId`). */
async function settlingNotesCount(context: BtContext, billId: string): Promise<number> {
  const snapshot = await db().collection(BT_COLLECTIONS.bills).where('adjustsNoteId', '==', billId).get();
  return snapshot.docs.filter((doc) => doc.data().organizationId === context.organizationId && !doc.data().isDeleted).length;
}

/**
 * What still points at a bill — live notes against it or settling it, receipts allocated to it,
 * retention released against it — in words, so it is not deleted or moved to another project from
 * under them.
 */
async function dependentsOf(context: BtContext, bill: StoredBill): Promise<string[]> {
  const firestore = db();
  const [notes, releasedAgainst, releasedBy, settling] = await Promise.all([
    firestore.collection(BT_COLLECTIONS.bills).where('againstBillId', '==', bill.id).get(),
    firestore.collection(BT_COLLECTIONS.retention).where('againstBillId', '==', bill.id).get(),
    firestore.collection(BT_COLLECTIONS.retention).where('retentionBillId', '==', bill.id).get(),
    bill.transactionType === 'debit_note' ? settlingNotesCount(context, bill.id) : Promise.resolve(0),
  ]);
  const ours = (doc: FirebaseFirestore.QueryDocumentSnapshot) => doc.data().organizationId === context.organizationId;
  const liveNotes = notes.docs.filter((doc) => ours(doc) && !doc.data().isDeleted).length;
  const releases = new Set([...releasedAgainst.docs, ...releasedBy.docs].filter((doc) => ours(doc) && doc.data().status === 'active').map((doc) => doc.id)).size;
  const receipts = (bill.collections ?? []).filter((entry) => entry.status !== 'cancelled').length;
  const count = (n: number, one: string, many: string) => (n ? `${n} ${n === 1 ? one : many}` : '');
  return [
    count(liveNotes, 'credit/debit note against it', 'credit/debit notes against it'),
    count(settling, 'note settling its certification', 'notes settling its certification'),
    count(receipts, 'receipt', 'receipts'),
    count(releases, 'retention release', 'retention releases'),
  ].filter(Boolean);
}

/** "a, b and c". */
const inWords = (parts: readonly string[]) => (parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : (parts[0] ?? ''));

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
  const [against, gstSetup, invoiceNotes, adjusted] = await Promise.all([loadAgainst(context, input.againstBillId), loadGstSetup(), loadInvoiceNotes(context, input, config), loadAgainst(context, input.adjustsNoteId)]);

  const firestore = db();
  const ref = firestore.collection(BT_COLLECTIONS.bills).doc();
  await firestore.runTransaction(async (transaction) => {
    const composed = composeBill({ context, input, config, project, client, ownerName, against, invoiceNotes, adjusted, gstSetup });
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
  // Imported statements share one number across their Supply, Civil and Erection lines: check only a
  // number (or project) that changes, so editing one line is not refused for its siblings.
  if ((input.gstInvoiceNumber ?? '') !== (before.gstInvoiceNumber ?? '') || input.projectId !== before.projectId) {
    await assertUniqueInvoice(context, project.id, input.gstInvoiceNumber, billId);
  }
  // Its receipts, releases and notes stay on the old project: a bill with any of them cannot move.
  if (input.projectId !== before.projectId) {
    const blocking = await dependentsOf(context, before);
    if (blocking.length) throw new BtError(`This bill has ${inWords(blocking)} on ${before.projectNameSnapshot}, so it cannot move to another project. Cancel or move those first.`, 409);
  }
  // A debit note other notes settle stays a debit note against the same invoice, or they settle nothing.
  if (before.transactionType === 'debit_note' && (input.transactionType !== 'debit_note' || (input.againstBillId ?? null) !== (before.againstBillId ?? null))) {
    const settling = await settlingNotesCount(context, billId);
    if (settling) throw new BtError(`${settling === 1 ? 'A note settles' : `${settling} notes settle`} this debit note’s certification, so it stays a debit note against the same invoice. Delete or re-link ${settling === 1 ? 'that note' : 'those notes'} first.`, 409);
  }
  const ownerName = await userName(input.collectionOwnerId);
  const [against, gstSetup, invoiceNotes, adjusted] = await Promise.all([loadAgainst(context, input.againstBillId), loadGstSetup(), loadInvoiceNotes(context, input, config), loadAgainst(context, input.adjustsNoteId)]);

  let version = 0;
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = { ...(snapshot.data() as StoredBill), id: snapshot.id };
    if (input.expectedVersion !== undefined && input.expectedVersion !== current.version) {
      throw new BtError('Someone else changed this bill while you were editing it. Reload to see their changes, then edit again.', 409);
    }
    const composed = composeBill({ context, input, config, project, client, existing: current, ownerName, against, invoiceNotes, adjusted, gstSetup });

    // Compared by value (`protectedChanges`, shared with the bill form): a renamed head or the key order
    // Firestore returns is no change. A returned bill is locked when resubmitting it would skip approval.
    const protectedChange = protectedChanges(current, composed);
    if (protectedChange.length && amountsLocked(current, config.settings)) {
      if (!context.can('Bills', 'Edit After Approval', current.projectId)) {
        throw new BtError(`This bill is at “${stepLabel(config.settings, current.workflowStatus)}”; changing ${protectedChange.join(', ')} needs Edit After Approval.`, 403);
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
  // A note against a deleted invoice would keep adjusting nothing, and a release would point at
  // nothing: what depends on the bill goes first.
  const preview = await ref.get();
  const live = preview.exists ? { ...(preview.data() as StoredBill), id: preview.id } : undefined;
  if (live && live.organizationId === context.organizationId && !live.isDeleted) {
    context.require('Bills', 'Delete', live.projectId);
    const blocking = await dependentsOf(context, live);
    if (blocking.length) throw new BtError(`This bill still has ${inWords(blocking)}. Delete or re-link the notes, and cancel the receipts and releases, before deleting it.`, 409);
  }
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
// Which moves exist, which stages are in use and who may make each move live in `workflow.ts`,
// shared with the bill page; here they are applied inside the transaction.

/** Base-role names holding a Bill Tracking permission — "needs your action" when nobody is named. */
async function rolesHolding(resource: string, action: string): Promise<string[]> {
  const roles = await db().collection('roles').get();
  return roles.docs.filter((doc) => (doc.data().permissions?.[`Bill Tracking.${resource}`] ?? []).includes(action)).map((doc) => String(doc.data().name ?? doc.id));
}

export const workflowActor = (context: BtContext): WorkflowActor => ({ userId: context.userId, can: (resource, action, projectId) => context.can(resource as BtResource, action, projectId) });

/**
 * Tells the people a bill now waits for — the named people of its next stage in use, if that stage
 * notifies — or, with nobody named, the roles holding that stage's permission (the early stages).
 * Best-effort: delivery never undoes the step, which the audit trail already records.
 */
export async function notifyWaiting(context: BtContext, bill: StoredBill, settings: BillTrackingConfig['settings'], status: BillWorkflowStatus, remarks?: string, previousStatus: BillWorkflowStatus = bill.workflowStatus): Promise<void> {
  const reference = bill.gstInvoiceNumber || bill.billSerialNumber || bill.id;
  const base = { module: ACTIVITY_MODULES.BILL_TRACKING, itemId: bill.id, itemRef: reference, link: `/bill-tracking/bills/${bill.id}`, organizationId: context.organizationId };
  const others = (ids: (string | undefined)[]) => [...new Set(ids.filter((id): id is string => Boolean(id) && id !== context.userId))];
  try {
    if (status === 'returned') {
      await dispatchNotificationServer({ userIds: others([bill.createdBy, bill.collectionOwnerId]) }, { ...base, type: 'step_entry', severity: 'WARNING', title: 'Bill returned for correction', body: `${reference} · ${remarks ?? bill.projectNameSnapshot}` });
      return;
    }
    // Reaching the step that locks the amounts (Approved, by default) is news for the preparer.
    const entered = workflowStep(settings, status);
    if (!isRoleStep(status) && entered.locksAmounts && !isPastApproval(previousStatus, settings)) {
      await dispatchNotificationServer({ userIds: others([bill.createdBy, bill.collectionOwnerId]) }, { ...base, type: 'step_entry', severity: 'INFO', title: `Bill ${entered.label.toLowerCase()}`, body: `${reference} · ${remarks ?? bill.projectNameSnapshot}` });
    }
    const next = nextStepAfter(status, settings);
    if (!next) return;
    const step = workflowStep(settings, next);
    const named = others(stepDoers(step, bill));
    if (named.length) {
      if (step.notify) await dispatchNotificationServer({ userIds: named }, { ...base, type: 'approval_required', title: `Bill waiting for you · ${step.label}`, body: `${reference} · ${bill.projectNameSnapshot} · net ₹${bill.netReceivable.toLocaleString('en-IN')}` });
      return;
    }
    // With nobody named, the roles holding the step's permission hear of it — for the review steps
    // before the bill is raised that wait on Verify or Approve; Add and Edit are nearly everyone's, so not told.
    const alerting = step.permissions.filter((permission) => permission === 'Verify' || permission === 'Approve');
    if (isRoleStep(next) || !alerting.length) return;
    const roles = [...new Set((await Promise.all(alerting.map((permission) => rolesHolding('Bills', permission)))).flat())];
    const userIds = (await resolveRoleRecipientsServer(roles)).filter((id) => id !== context.userId);
    await dispatchNotificationServer({ userIds }, { ...base, type: 'approval_required', title: `Bill waiting · ${step.label}`, body: `${reference} · ${bill.projectNameSnapshot} · net ₹${bill.netReceivable.toLocaleString('en-IN')}` });
  } catch {
    // Delivery is best-effort; the audit trail already records the step.
  }
}

export async function applyWorkflowAction(context: BtContext, billId: string, action: WorkflowAction, remarks?: string, toStep?: BillWorkflowStatus): Promise<{ status: BillWorkflowStatus }> {
  const { settings } = await loadConfig(context.organizationId);
  const move: WorkflowMove = { action, to: toStep };
  const ref = db().collection(BT_COLLECTIONS.bills).doc(billId);
  let result = 'draft' as BillWorkflowStatus;
  let bill: StoredBill | undefined;
  await db().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new BtError('Bill not found.', 404);
    bill = { ...(snapshot.data() as StoredBill), id: snapshot.id };
    if (bill.organizationId !== context.organizationId || bill.isDeleted) throw new BtError('Bill not found.', 404);
    // Named on the stage, or holding its permission on the bill's project (unless only the named may).
    const blocked = actionBlocked(move, bill, settings, workflowActor(context));
    // A permission refusal is 403; a move that does not fit where the bill stands is a conflict.
    if (blocked) throw new BtError(blocked, /permission|assigned/.test(blocked) ? 403 : 409);
    if (action === 'return' && !remarks) throw new BtError('Say what needs correcting when returning a bill.');
    const to = moveTarget(move, bill, settings);
    if (!to) throw new BtError('Say which step to move the bill into.');
    if (to === 'closed' && bill.paymentStatus !== 'received' && bill.paymentStatus !== 'adjusted') {
      throw new BtError('Only a fully received or adjusted bill can be closed. Record the remaining receipt or override the status with a reason.', 409);
    }
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
      summary: `Bill ${bill.billSerialNumber ?? ''}: ${stepLabel(settings, bill.workflowStatus)} → ${stepLabel(settings, to)}`,
      previous: { workflowStatus: bill.workflowStatus },
      next: { workflowStatus: to },
      reason: remarks,
    });
  });

  // After commit: a failed notification must never roll back a workflow step.
  if (bill) await notifyWaiting(context, bill, settings, result, remarks, bill.workflowStatus);
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
    assertMonthOpen(context, config, [bill.billDate], 'Overriding the payment status of a bill dated in it');
    const override = status ? { status, reason, by: context.userId, at: nowIso() } : undefined;
    const totals = deriveBillTotals({ ...bill, paymentStatusOverride: override }, calculationOptions(config));
    transaction.update(ref, {
      paymentStatusOverride: override ?? FieldValue.delete(),
      ...derivedFields(totals),
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
 * Resolves an import net mismatch: the workbook's net against the net of the bill as raised (never a
 * certification's). The bill's net always follows its source values; resolving records that finance
 * reviewed the difference and why — the imported figure stays on the bill for the record.
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

'use client';

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  Timestamp,
  where,
  writeBatch,
  type DocumentData,
  type Transaction,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  ACTIVE_ASSIGNMENT_STATUSES,
  DEFAULT_FD_SETTINGS,
  FD_COLLECTIONS,
  FD_SETTINGS_PATH,
  RESERVED_ASSIGNMENT_STATUSES,
  assignmentOutstanding,
  calculateAvailableAmount,
  calculateEligibleValue,
  deriveOperationalStatus,
  toDate,
  type FDAssignment,
  type FDApprovalRecord,
  type FDAuditEntry,
  type FDClosure,
  type FDReleaseRequest,
  type FDReplacementRequest,
  type FDRenewal,
  type FixedDeposit,
  type FixedDepositSettings,
} from '@/lib/fixed-deposit';

export type FDActor = {
  userId: string;
  userName: string;
  role?: string;
  organizationId: string;
  organizationName?: string;
};

const round = (value: number) => Number(Number(value || 0).toFixed(2));
const now = () => Timestamp.now();
const assignableStatuses = ['ACTIVE', 'PARTIALLY_UTILIZED', 'MATURITY_APPROACHING'];

function assertOrganization(recordOrganizationId: string, actor: FDActor) {
  if (recordOrganizationId !== actor.organizationId && actor.role !== 'Super Admin') {
    throw new Error('You cannot act on another organization’s fixed deposit.');
  }
}

function audit(
  transaction: Transaction,
  actor: FDActor,
  input: Omit<FDAuditEntry, 'id' | 'organizationId' | 'module' | 'userId' | 'userName' | 'userRole' | 'createdAt'>,
) {
  const reference = doc(collection(db, FD_COLLECTIONS.audit));
  transaction.set(reference, {
    organizationId: actor.organizationId,
    module: 'Fixed Deposit Management',
    ...input,
    userId: actor.userId,
    userName: actor.userName,
    userRole: actor.role || '',
    createdAt: now(),
  } satisfies Omit<FDAuditEntry, 'id'>);
  return reference.id;
}

function approval(
  transaction: Transaction,
  actor: FDActor,
  input: Omit<FDApprovalRecord, 'id' | 'organizationId' | 'module' | 'requestedBy' | 'requestedByName' | 'requestedAt' | 'status'>,
) {
  const reference = doc(collection(db, FD_COLLECTIONS.approvals));
  transaction.set(reference, {
    organizationId: actor.organizationId,
    module: 'Fixed Deposit Management',
    ...input,
    requestedBy: actor.userId,
    requestedByName: actor.userName,
    requestedAt: now(),
    status: 'PENDING',
  } satisfies Omit<FDApprovalRecord, 'id'>);
  return reference.id;
}

function closeApproval(transaction: Transaction, approvalId: string | undefined, status: FDApprovalRecord['status'], comments: string, actor: FDActor) {
  if (!approvalId) return;
  transaction.update(doc(db, FD_COLLECTIONS.approvals, approvalId), { status, decidedBy: actor.userId, decidedByName: actor.userName, decidedAt: now(), comments });
}

function requiredApprover(settings: FixedDepositSettings, amount: number, fallback = 'Finance Manager') {
  return settings.approvalRules.find((rule) => amount >= rule.minimumAmount && (rule.maximumAmount === null || amount <= rule.maximumAmount))?.approverRole || fallback;
}

function assertApprover(actor: FDActor, requiredRole?: string) {
  if (actor.role === 'Super Admin') return;
  if (requiredRole && actor.role !== requiredRole) throw new Error(`This action requires ${requiredRole} approval.`);
}

function summaryPatch(fd: FixedDeposit, bg: number, lc: number, reserved: number) {
  const eligible = round(fd.eligibleValue || calculateEligibleValue(fd.principalAmount, fd.eligibleMarginPercentage || 100));
  const safeBg = Math.max(0, round(bg));
  const safeLc = Math.max(0, round(lc));
  const safeReserved = Math.max(0, round(reserved));
  const available = calculateAvailableAmount(eligible, safeBg, safeLc, safeReserved);
  const computed = {
    ...fd,
    eligibleValue: eligible,
    bgUtilizedAmount: safeBg,
    lcUtilizedAmount: safeLc,
    reservedAmount: safeReserved,
    totalUtilizedAmount: round(safeBg + safeLc + safeReserved),
    availableAmount: available,
  };
  return { ...computed, status: deriveOperationalStatus(computed) };
}

function safeFd(data: DocumentData, id: string) {
  return { id, ...data } as FixedDeposit;
}

export async function getFixedDepositSettings() {
  const snapshot = await getDoc(doc(db, ...FD_SETTINGS_PATH));
  return snapshot.exists() ? { ...DEFAULT_FD_SETTINGS, ...snapshot.data() } as FixedDepositSettings : DEFAULT_FD_SETTINGS;
}

export async function updateFixedDepositDetails(fdId: string, changes: Partial<Pick<FixedDeposit,
  'holderName' | 'holderType' | 'jointHolderName' | 'nomineeName' | 'pan' | 'beneficialOwner' | 'projectId' | 'projectName' |
  'fdType' | 'purpose' | 'sourceOfFunds' | 'principalAmount' | 'interestRate' | 'interestCalculationMethod' |
  'interestPaymentFrequency' | 'tenureDays' | 'tenureMonths' | 'valueDate' | 'maturityDate' | 'expectedInterest' |
  'maturityAmount' | 'expectedTds' | 'expectedNetProceeds' | 'prematureClosurePenalty' | 'eligibleMarginPercentage' |
  'lienMarked' | 'lienHolder' | 'lienDate' | 'lienAmount' | 'lienPurpose' | 'bankConfirmationReference' | 'autoRenewal' | 'remarks'
>>, actor: FDActor) {
  return runTransaction(db, async (transaction) => {
    const reference = doc(db, FD_COLLECTIONS.deposits, fdId);
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) throw new Error('Fixed deposit not found.');
    const fd = safeFd(snapshot.data(), snapshot.id); assertOrganization(fd.organizationId, actor);
    if (!['DRAFT', 'REJECTED', 'PENDING_APPROVAL', 'ON_HOLD'].includes(fd.status) && fd.approvalStatus === 'APPROVED') throw new Error('Approved active FDs cannot be materially edited. Use the controlled renewal, closure, assignment, or replacement workflow.');
    const nextPrincipal = Number(changes.principalAmount ?? fd.principalAmount); const nextMargin = Number(changes.eligibleMarginPercentage ?? fd.eligibleMarginPercentage);
    const eligibleValue = calculateEligibleValue(nextPrincipal, nextMargin); const availableAmount = calculateAvailableAmount(eligibleValue, fd.bgUtilizedAmount, fd.lcUtilizedAmount, fd.reservedAmount);
    transaction.update(reference, { ...changes, eligibleValue, availableAmount, totalUtilizedAmount: round(fd.bgUtilizedAmount + fd.lcUtilizedAmount + fd.reservedAmount), approvalStatus: fd.approvalStatus === 'PENDING' ? 'DRAFT' : fd.approvalStatus, status: fd.status === 'PENDING_APPROVAL' ? 'DRAFT' : fd.status, updatedBy: actor.userId, updatedByName: actor.userName, updatedAt: now() });
    audit(transaction, actor, { recordType: 'FD', recordId: fd.id, fdId: fd.id, action: 'FD_UPDATED', summary: `${fd.referenceNumber} updated`, previousValue: { principalAmount: fd.principalAmount, maturityDate: fd.maturityDate, interestRate: fd.interestRate }, newValue: changes as Record<string, unknown>, page: `/fixed-deposit/${fd.id}` });
  });
}

export async function submitFixedDepositForApproval(fdId: string, actor: FDActor) {
  const settings = await getFixedDepositSettings();
  return runTransaction(db, async (transaction) => {
    const reference = doc(db, FD_COLLECTIONS.deposits, fdId);
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) throw new Error('Fixed deposit not found.');
    const fd = safeFd(snapshot.data(), snapshot.id);
    assertOrganization(fd.organizationId, actor);
    if (!['DRAFT', 'REJECTED', 'RETURNED'].includes(fd.approvalStatus)) throw new Error('Only a draft or returned FD can be submitted.');
    const approvalId = approval(transaction, actor, { recordType: 'FD', recordId: fd.id, fdId: fd.id, amount: fd.principalAmount, requiredRole: requiredApprover(settings, fd.principalAmount) });
    transaction.update(reference, { status: 'PENDING_APPROVAL', approvalStatus: 'PENDING', workflowStage: 'FINANCE_VERIFICATION', currentAssigneeIds: [], approvalId, updatedBy: actor.userId, updatedByName: actor.userName, updatedAt: now() });
    audit(transaction, actor, { recordType: 'FD', recordId: fd.id, fdId: fd.id, action: 'FD_SUBMITTED', summary: `${fd.referenceNumber} submitted for approval`, previousValue: { status: fd.status }, newValue: { status: 'PENDING_APPROVAL', approvalId }, page: `/fixed-deposit/${fd.id}` });
    return approvalId;
  });
}

export async function decideFixedDepositApproval(fdId: string, action: 'APPROVE' | 'REJECT' | 'RETURN' | 'ON_HOLD' | 'REQUEST_DOCUMENTS', comments: string, actor: FDActor) {
  const settings = await getFixedDepositSettings();
  return runTransaction(db, async (transaction) => {
    const reference = doc(db, FD_COLLECTIONS.deposits, fdId);
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) throw new Error('Fixed deposit not found.');
    const fd = safeFd(snapshot.data(), snapshot.id);
    assertOrganization(fd.organizationId, actor);
    if (fd.createdBy === actor.userId) throw new Error('You cannot approve your own FD request.');
    if (fd.approvalStatus !== 'PENDING') throw new Error('This FD is not pending approval.');
    assertApprover(actor, requiredApprover(settings, fd.principalAmount));
    if (action === 'APPROVE' && settings.requireFdReceipt && !fd.fdReceiptUrl) throw new Error('FD receipt is required before activation.');
    const status = action === 'APPROVE' ? 'ACTIVE' : action === 'ON_HOLD' ? 'ON_HOLD' : 'DRAFT';
    const approvalStatus = action === 'APPROVE' ? 'APPROVED' : action === 'REJECT' ? 'REJECTED' : 'RETURNED';
    const patch: Record<string, unknown> = { status, approvalStatus, approvalComments: comments, workflowStage: action === 'APPROVE' ? 'COMPLETED' : 'DRAFT', updatedBy: actor.userId, updatedByName: actor.userName, updatedAt: now() };
    if (action === 'APPROVE') Object.assign(patch, { approvedBy: actor.userId, approvedByName: actor.userName, approvedAt: now(), eligibleValue: calculateEligibleValue(fd.principalAmount, fd.eligibleMarginPercentage), availableAmount: calculateEligibleValue(fd.principalAmount, fd.eligibleMarginPercentage) });
    if (action === 'ON_HOLD') patch.holdReason = comments;
    transaction.update(reference, patch);
    closeApproval(transaction, fd.approvalId, action === 'APPROVE' ? 'APPROVED' : action === 'REJECT' ? 'REJECTED' : action === 'ON_HOLD' ? 'ON_HOLD' : action === 'REQUEST_DOCUMENTS' ? 'DOCUMENTS_REQUESTED' : 'RETURNED', comments, actor);
    audit(transaction, actor, { recordType: 'FD', recordId: fd.id, fdId: fd.id, action: `FD_${action}`, summary: `${fd.referenceNumber}: ${action.replaceAll('_', ' ')}`, previousValue: { status: fd.status, approvalStatus: fd.approvalStatus }, newValue: { status, approvalStatus }, reason: comments, page: `/fixed-deposit/${fd.id}` });
  });
}

export type AssignmentInstrumentInput = {
  instrumentType: 'BG' | 'LC';
  instrumentId?: string;
  instrumentNumber: string;
  bankId: string;
  bankName: string;
  projectId?: string;
  projectName?: string;
  partyName?: string;
  instrumentAmount: number;
  marginPercentage: number;
  requiredMarginAmount: number;
  assignmentDate: string;
  obligationEndDate: string;
  expectedReleaseDate: string;
  purpose?: string;
  remarks?: string;
  exceptionApproved?: boolean;
  exceptionReason?: string;
  reserveOnly?: boolean;
  items: Array<{ fdId: string; amount: number }>;
};

export async function createFdAssignments(input: AssignmentInstrumentInput, actor: FDActor) {
  const settings = await getFixedDepositSettings();
  if (!input.instrumentNumber.trim()) throw new Error(`${input.instrumentType} number is required.`);
  if (!input.bankId || !input.assignmentDate || !input.obligationEndDate) throw new Error('Instrument bank, assignment date, and obligation end date are required.');
  if (!input.items.length) throw new Error('Select at least one fixed deposit.');
  if (new Set(input.items.map((item) => item.fdId)).size !== input.items.length) throw new Error('The same FD cannot be selected twice.');
  const requestedTotal = round(input.items.reduce((total, item) => total + Number(item.amount || 0), 0));
  if (requestedTotal <= 0) throw new Error('Assignment amount must be positive.');
  if (input.requiredMarginAmount > 0 && Math.abs(requestedTotal - input.requiredMarginAmount) > 0.01 && !input.exceptionApproved) throw new Error(`Total FD assignment must equal the required margin of ${input.requiredMarginAmount}. Record an authorised exception to proceed with a different amount.`);
  const status: FDAssignment['status'] = input.reserveOnly || settings.requireAssignmentApproval ? 'RESERVED' : 'ACTIVE';
  const fdRefs = input.items.map((item) => doc(db, FD_COLLECTIONS.deposits, item.fdId));
  return runTransaction(db, async (transaction) => {
    const snapshots = await Promise.all(fdRefs.map((reference) => transaction.get(reference)));
    const fds = snapshots.map((snapshot) => {
      if (!snapshot.exists()) throw new Error('One of the selected FDs no longer exists.');
      return safeFd(snapshot.data(), snapshot.id);
    });
    fds.forEach((fd, index) => {
      assertOrganization(fd.organizationId, actor);
      if (!assignableStatuses.includes(fd.status)) throw new Error(`${fd.fdNumber} is not available for assignment.`);
      if (fd.approvalStatus !== 'APPROVED') throw new Error(`${fd.fdNumber} is not approved.`);
      const amount = round(input.items[index].amount);
      if (amount <= 0 || amount > Number(fd.availableAmount || 0)) throw new Error(`${fd.fdNumber} has only ${fd.availableAmount || 0} available.`);
      if (input.bankId && fd.bankId !== input.bankId && !settings.allowCrossBankAssignment && !input.exceptionApproved) throw new Error(`${fd.fdNumber} belongs to a different bank.`);
      const maturity = toDate(fd.maturityDate);
      const obligation = new Date(`${input.obligationEndDate}T23:59:59`);
      if (maturity && input.obligationEndDate && maturity.getTime() < obligation.getTime() && !input.exceptionApproved) throw new Error(`${fd.fdNumber} matures before the ${input.instrumentType} obligation ends.`);
    });
    const createdIds: string[] = [];
    fds.forEach((fd, index) => {
      const amount = round(input.items[index].amount);
      const assignmentRef = doc(collection(db, FD_COLLECTIONS.assignments));
      const reservationRef = status === 'RESERVED' ? doc(collection(db, FD_COLLECTIONS.reservations)) : null;
      const approvalId = status === 'RESERVED' ? approval(transaction, actor, { recordType: 'ASSIGNMENT', recordId: assignmentRef.id, fdId: fd.id, amount, requiredRole: requiredApprover(settings, amount) }) : '';
      transaction.set(assignmentRef, {
        organizationId: fd.organizationId, fdId: fd.id, fdNumber: fd.fdNumber, instrumentType: input.instrumentType, instrumentId: input.instrumentId || input.instrumentNumber, instrumentNumber: input.instrumentNumber.trim(), bankId: input.bankId, bankName: input.bankName,
        projectId: input.projectId || '', projectName: input.projectName || '', partyName: input.partyName || '', assignmentAmount: amount, releasedAmount: 0, activeAmount: amount, assignmentDate: Timestamp.fromDate(new Date(`${input.assignmentDate}T12:00:00`)), obligationEndDate: Timestamp.fromDate(new Date(`${input.obligationEndDate}T12:00:00`)), expectedReleaseDate: input.expectedReleaseDate ? Timestamp.fromDate(new Date(`${input.expectedReleaseDate}T12:00:00`)) : null,
        actualReleaseDate: null, marginPercentage: input.marginPercentage, purpose: input.purpose || '', status, approvalId, reservationId: reservationRef?.id || '', remarks: input.remarks || '', exceptionApproved: Boolean(input.exceptionApproved), exceptionReason: input.exceptionReason || '', createdBy: actor.userId, createdByName: actor.userName, createdAt: now(), updatedBy: actor.userId, updatedByName: actor.userName, updatedAt: now(),
      } satisfies Omit<FDAssignment, 'id'>);
      if (reservationRef) {
        const expiry = new Date(); expiry.setDate(expiry.getDate() + settings.reservationExpiryDays);
        transaction.set(reservationRef, { organizationId: fd.organizationId, fdId: fd.id, fdNumber: fd.fdNumber, assignmentId: assignmentRef.id, instrumentType: input.instrumentType, instrumentId: input.instrumentId || input.instrumentNumber, instrumentNumber: input.instrumentNumber.trim(), amount, reservedAt: now(), expiryDate: Timestamp.fromDate(expiry), status: 'ACTIVE', createdBy: actor.userId, createdByName: actor.userName, remarks: input.remarks || '' });
      }
      const next = status === 'RESERVED' ? summaryPatch(fd, fd.bgUtilizedAmount, fd.lcUtilizedAmount, fd.reservedAmount + amount) : summaryPatch(fd, fd.bgUtilizedAmount + (input.instrumentType === 'BG' ? amount : 0), fd.lcUtilizedAmount + (input.instrumentType === 'LC' ? amount : 0), fd.reservedAmount);
      transaction.update(fdRefs[index], { bgUtilizedAmount: next.bgUtilizedAmount, lcUtilizedAmount: next.lcUtilizedAmount, reservedAmount: next.reservedAmount, totalUtilizedAmount: next.totalUtilizedAmount, availableAmount: next.availableAmount, status: next.status, updatedBy: actor.userId, updatedByName: actor.userName, updatedAt: now() });
      audit(transaction, actor, { recordType: 'ASSIGNMENT', recordId: assignmentRef.id, fdId: fd.id, action: status === 'RESERVED' ? 'ASSIGNMENT_RESERVED' : 'ASSIGNMENT_ACTIVATED', summary: `${amount} assigned from ${fd.fdNumber} to ${input.instrumentType} ${input.instrumentNumber}`, newValue: { amount, status, instrumentType: input.instrumentType, instrumentNumber: input.instrumentNumber }, reason: input.remarks, page: `/fixed-deposit/${fd.id}` });
      createdIds.push(assignmentRef.id);
    });
    return createdIds;
  });
}

export async function decideAssignment(assignmentId: string, action: 'APPROVE' | 'REJECT' | 'RETURN', comments: string, actor: FDActor) {
  const settings = await getFixedDepositSettings();
  return runTransaction(db, async (transaction) => {
    const assignmentRef = doc(db, FD_COLLECTIONS.assignments, assignmentId);
    const assignmentSnap = await transaction.get(assignmentRef);
    if (!assignmentSnap.exists()) throw new Error('Assignment not found.');
    const assignment = { id: assignmentSnap.id, ...assignmentSnap.data() } as FDAssignment;
    const fdRef = doc(db, FD_COLLECTIONS.deposits, assignment.fdId);
    const fdSnap = await transaction.get(fdRef);
    if (!fdSnap.exists()) throw new Error('Fixed deposit not found.');
    const fd = safeFd(fdSnap.data(), fdSnap.id);
    assertOrganization(fd.organizationId, actor);
    if (assignment.createdBy === actor.userId) throw new Error('You cannot approve your own assignment.');
    assertApprover(actor, requiredApprover(settings, assignment.assignmentAmount));
    if (!RESERVED_ASSIGNMENT_STATUSES.includes(assignment.status)) throw new Error('Assignment is no longer awaiting approval.');
    const amount = assignmentOutstanding(assignment);
    if (action === 'APPROVE') {
      const next = summaryPatch(fd, fd.bgUtilizedAmount + (assignment.instrumentType === 'BG' ? amount : 0), fd.lcUtilizedAmount + (assignment.instrumentType === 'LC' ? amount : 0), fd.reservedAmount - amount);
      transaction.update(assignmentRef, { status: 'ACTIVE', updatedBy: actor.userId, updatedByName: actor.userName, updatedAt: now(), remarks: [assignment.remarks, comments].filter(Boolean).join('\n') });
      transaction.update(fdRef, { bgUtilizedAmount: next.bgUtilizedAmount, lcUtilizedAmount: next.lcUtilizedAmount, reservedAmount: next.reservedAmount, totalUtilizedAmount: next.totalUtilizedAmount, availableAmount: next.availableAmount, status: next.status, updatedAt: now(), updatedBy: actor.userId, updatedByName: actor.userName });
      if (assignment.reservationId) transaction.update(doc(db, FD_COLLECTIONS.reservations, assignment.reservationId), { status: 'CONVERTED', releasedAt: now(), releasedBy: actor.userId });
    } else {
      const next = summaryPatch(fd, fd.bgUtilizedAmount, fd.lcUtilizedAmount, fd.reservedAmount - amount);
      transaction.update(assignmentRef, { status: action === 'REJECT' ? 'REJECTED' : 'CANCELLED', updatedBy: actor.userId, updatedByName: actor.userName, updatedAt: now(), remarks: [assignment.remarks, comments].filter(Boolean).join('\n') });
      transaction.update(fdRef, { reservedAmount: next.reservedAmount, totalUtilizedAmount: next.totalUtilizedAmount, availableAmount: next.availableAmount, status: next.status, updatedAt: now(), updatedBy: actor.userId, updatedByName: actor.userName });
      if (assignment.reservationId) transaction.update(doc(db, FD_COLLECTIONS.reservations, assignment.reservationId), { status: 'CANCELLED', releasedAt: now(), releasedBy: actor.userId, remarks: comments });
    }
    closeApproval(transaction, assignment.approvalId, action === 'APPROVE' ? 'APPROVED' : action === 'REJECT' ? 'REJECTED' : 'RETURNED', comments, actor);
    audit(transaction, actor, { recordType: 'ASSIGNMENT', recordId: assignment.id, fdId: fd.id, action: `ASSIGNMENT_${action}`, summary: `${assignment.instrumentType} ${assignment.instrumentNumber}: ${action}`, previousValue: { status: assignment.status }, newValue: { status: action === 'APPROVE' ? 'ACTIVE' : action === 'REJECT' ? 'REJECTED' : 'CANCELLED' }, reason: comments, page: `/fixed-deposit/${fd.id}` });
  });
}

export async function requestAssignmentRelease(input: { assignmentId: string; amount: number; effectiveDate: string; reason: string; bankConfirmationReference?: string; authorizedOverride?: boolean }, actor: FDActor) {
  return runTransaction(db, async (transaction) => {
    const assignmentRef = doc(db, FD_COLLECTIONS.assignments, input.assignmentId);
    const assignmentSnap = await transaction.get(assignmentRef);
    if (!assignmentSnap.exists()) throw new Error('Assignment not found.');
    const assignment = { id: assignmentSnap.id, ...assignmentSnap.data() } as FDAssignment;
    assertOrganization(assignment.organizationId, actor);
    const outstanding = assignmentOutstanding(assignment);
    const amount = round(input.amount);
    if (!ACTIVE_ASSIGNMENT_STATUSES.includes(assignment.status)) throw new Error('Only an active assignment can be released.');
    if (amount <= 0 || amount > outstanding) throw new Error(`Release amount must be between 0 and ${outstanding}.`);
    if (!input.bankConfirmationReference?.trim() && !input.authorizedOverride) throw new Error('Bank release confirmation or an authorised override is required.');
    const releaseRef = doc(collection(db, FD_COLLECTIONS.releases));
    const approvalId = approval(transaction, actor, { recordType: 'RELEASE', recordId: releaseRef.id, fdId: assignment.fdId, amount, requiredRole: input.authorizedOverride ? 'Director Finance' : 'Finance Manager' });
    transaction.set(releaseRef, { organizationId: assignment.organizationId, assignmentId: assignment.id, fdId: assignment.fdId, fdNumber: assignment.fdNumber, instrumentType: assignment.instrumentType, instrumentNumber: assignment.instrumentNumber, releaseType: amount === outstanding ? 'FULL' : 'PARTIAL', releaseAmount: amount, requestDate: now(), effectiveReleaseDate: Timestamp.fromDate(new Date(`${input.effectiveDate}T12:00:00`)), reason: input.reason, bankConfirmationReference: input.bankConfirmationReference || '', authorizedOverride: Boolean(input.authorizedOverride), status: 'PENDING_APPROVAL', approvalId, createdBy: actor.userId, createdByName: actor.userName, createdAt: now() } satisfies Omit<FDReleaseRequest, 'id'> & { approvalId: string });
    audit(transaction, actor, { recordType: 'RELEASE', recordId: releaseRef.id, fdId: assignment.fdId, action: 'RELEASE_REQUESTED', summary: `${amount} release requested from ${assignment.fdNumber}`, newValue: { amount, assignmentId: assignment.id }, reason: input.reason, page: '/fixed-deposit/releases' });
    return releaseRef.id;
  });
}

export async function decideReleaseRequest(releaseId: string, action: 'APPROVE' | 'REJECT', comments: string, actor: FDActor) {
  return runTransaction(db, async (transaction) => {
    const releaseRef = doc(db, FD_COLLECTIONS.releases, releaseId);
    const releaseSnap = await transaction.get(releaseRef);
    if (!releaseSnap.exists()) throw new Error('Release request not found.');
    const release = { id: releaseSnap.id, ...releaseSnap.data() } as FDReleaseRequest;
    if (release.createdBy === actor.userId) throw new Error('You cannot approve your own release request.');
    assertOrganization(release.organizationId, actor);
    assertApprover(actor, release.authorizedOverride ? 'Director Finance' : 'Finance Manager');
    if (release.status !== 'PENDING_APPROVAL') throw new Error('Release request has already been decided.');
    if (action === 'REJECT') {
      transaction.update(releaseRef, { status: 'REJECTED', approvedBy: actor.userId, approvedByName: actor.userName, approvedAt: now(), comments });
      closeApproval(transaction, release.approvalId, 'REJECTED', comments, actor);
      audit(transaction, actor, { recordType: 'RELEASE', recordId: release.id, fdId: release.fdId, action: 'RELEASE_REJECTED', summary: `${release.fdNumber} release rejected`, reason: comments, page: '/fixed-deposit/releases' });
      return;
    }
    const assignmentRef = doc(db, FD_COLLECTIONS.assignments, release.assignmentId);
    const fdRef = doc(db, FD_COLLECTIONS.deposits, release.fdId);
    const [assignmentSnap, fdSnap] = await Promise.all([transaction.get(assignmentRef), transaction.get(fdRef)]);
    if (!assignmentSnap.exists() || !fdSnap.exists()) throw new Error('Assignment or FD no longer exists.');
    const assignment = { id: assignmentSnap.id, ...assignmentSnap.data() } as FDAssignment;
    const fd = safeFd(fdSnap.data(), fdSnap.id);
    const outstanding = assignmentOutstanding(assignment);
    if (release.releaseAmount > outstanding) throw new Error('Assignment balance changed; release amount is no longer valid.');
    const remaining = round(outstanding - release.releaseAmount);
    const next = summaryPatch(fd, fd.bgUtilizedAmount - (assignment.instrumentType === 'BG' ? release.releaseAmount : 0), fd.lcUtilizedAmount - (assignment.instrumentType === 'LC' ? release.releaseAmount : 0), fd.reservedAmount);
    transaction.update(assignmentRef, { releasedAmount: round(Number(assignment.releasedAmount || 0) + release.releaseAmount), activeAmount: remaining, actualReleaseDate: release.effectiveReleaseDate, status: remaining > 0 ? 'PARTIALLY_RELEASED' : 'RELEASED', releasedBy: actor.userId, releasedByName: actor.userName, releaseReference: release.bankConfirmationReference || comments, updatedBy: actor.userId, updatedByName: actor.userName, updatedAt: now() });
    transaction.update(fdRef, { bgUtilizedAmount: next.bgUtilizedAmount, lcUtilizedAmount: next.lcUtilizedAmount, totalUtilizedAmount: next.totalUtilizedAmount, availableAmount: next.availableAmount, status: next.status, updatedBy: actor.userId, updatedByName: actor.userName, updatedAt: now() });
    transaction.update(releaseRef, { status: 'COMPLETED', approvedBy: actor.userId, approvedByName: actor.userName, approvedAt: now(), comments });
    closeApproval(transaction, release.approvalId, 'APPROVED', comments, actor);
    audit(transaction, actor, { recordType: 'RELEASE', recordId: release.id, fdId: fd.id, action: 'ASSIGNMENT_RELEASED', summary: `${release.releaseAmount} released from ${assignment.instrumentType} ${assignment.instrumentNumber}`, previousValue: { activeAmount: outstanding }, newValue: { activeAmount: remaining }, reason: comments || release.reason, page: `/fixed-deposit/${fd.id}` });
  });
}

export type RenewalRequestInput = {
  fdId: string; interestReceived: number; tdsAmount: number; renewalPrincipalAmount: number; additionalDepositAmount: number; withdrawalAmount: number; newFdNumber: string; newInterestRate: number; newMaturityDate: string; newMaturityAmount: number; renewalReason: string; assignmentsTransferred: boolean;
};

export async function requestFdRenewal(input: RenewalRequestInput, actor: FDActor) {
  return runTransaction(db, async (transaction) => {
    const fdRef = doc(db, FD_COLLECTIONS.deposits, input.fdId);
    const fdSnap = await transaction.get(fdRef);
    if (!fdSnap.exists()) throw new Error('Fixed deposit not found.');
    const fd = safeFd(fdSnap.data(), fdSnap.id); assertOrganization(fd.organizationId, actor);
    if (['CLOSED', 'PREMATURELY_CLOSED', 'RENEWED', 'CANCELLED', 'REPLACED'].includes(fd.status)) throw new Error('This FD cannot be renewed.');
    if (!input.newFdNumber.trim() || !input.newMaturityDate || input.renewalPrincipalAmount <= 0) throw new Error('New FD number, principal, and maturity date are required.');
    const renewalRef = doc(collection(db, FD_COLLECTIONS.renewals));
    const approvalId = approval(transaction, actor, { recordType: 'RENEWAL', recordId: renewalRef.id, fdId: fd.id, amount: input.renewalPrincipalAmount, requiredRole: 'Finance Manager' });
    transaction.set(renewalRef, { organizationId: fd.organizationId, oldFdId: fd.id, oldFdNumber: fd.fdNumber, newFdNumber: input.newFdNumber.trim(), oldPrincipalAmount: fd.principalAmount, oldMaturityAmount: fd.maturityAmount, interestReceived: round(input.interestReceived), tdsAmount: round(input.tdsAmount), renewalPrincipalAmount: round(input.renewalPrincipalAmount), additionalDepositAmount: round(input.additionalDepositAmount), withdrawalAmount: round(input.withdrawalAmount), newInterestRate: Number(input.newInterestRate), newMaturityDate: Timestamp.fromDate(new Date(`${input.newMaturityDate}T12:00:00`)), newMaturityAmount: round(input.newMaturityAmount), renewalRequestDate: now(), assignmentsTransferred: input.assignmentsTransferred, status: 'PENDING_APPROVAL', renewalReason: input.renewalReason, approvalId, remarks: input.renewalReason, createdBy: actor.userId, createdByName: actor.userName, createdAt: now() } satisfies Omit<FDRenewal, 'id'>);
    transaction.update(fdRef, { status: 'RENEWAL_PENDING', renewalStatus: 'PENDING_APPROVAL', updatedBy: actor.userId, updatedByName: actor.userName, updatedAt: now() });
    audit(transaction, actor, { recordType: 'RENEWAL', recordId: renewalRef.id, fdId: fd.id, action: 'RENEWAL_REQUESTED', summary: `Renewal requested for ${fd.fdNumber}`, newValue: { newFdNumber: input.newFdNumber, renewalPrincipalAmount: input.renewalPrincipalAmount }, reason: input.renewalReason, page: `/fixed-deposit/${fd.id}` });
    return renewalRef.id;
  });
}

export async function approveFdRenewal(renewalId: string, bankConfirmationReference: string, actor: FDActor) {
  return runTransaction(db, async (transaction) => {
    const renewalRef = doc(db, FD_COLLECTIONS.renewals, renewalId); const renewalSnap = await transaction.get(renewalRef);
    if (!renewalSnap.exists()) throw new Error('Renewal request not found.');
    const renewal = { id: renewalSnap.id, ...renewalSnap.data() } as FDRenewal; assertOrganization(renewal.organizationId, actor);
    if (renewal.createdBy === actor.userId) throw new Error('You cannot approve your own renewal request.');
    assertApprover(actor, 'Finance Manager');
    if (renewal.status !== 'PENDING_APPROVAL') throw new Error('Renewal is not pending approval.');
    transaction.update(renewalRef, { status: 'SUBMITTED_TO_BANK', bankSubmissionDate: now(), bankConfirmationReference, approvedBy: actor.userId, approvedByName: actor.userName, approvedAt: now() });
    closeApproval(transaction, renewal.approvalId, 'APPROVED', bankConfirmationReference, actor);
    audit(transaction, actor, { recordType: 'RENEWAL', recordId: renewal.id, fdId: renewal.oldFdId, action: 'RENEWAL_APPROVED', summary: `${renewal.oldFdNumber} renewal approved and submitted to bank`, newValue: { status: 'SUBMITTED_TO_BANK' }, approvalReference: bankConfirmationReference, page: `/fixed-deposit/${renewal.oldFdId}` });
  });
}

export async function rejectFdRenewal(renewalId: string, comments: string, actor: FDActor) {
  return runTransaction(db, async (transaction) => {
    const renewalRef = doc(db, FD_COLLECTIONS.renewals, renewalId); const renewalSnap = await transaction.get(renewalRef);
    if (!renewalSnap.exists()) throw new Error('Renewal request not found.');
    const renewal = { id: renewalSnap.id, ...renewalSnap.data() } as FDRenewal; assertOrganization(renewal.organizationId, actor); assertApprover(actor, 'Finance Manager');
    if (renewal.createdBy === actor.userId) throw new Error('You cannot decide your own renewal request.');
    const fdRef = doc(db, FD_COLLECTIONS.deposits, renewal.oldFdId); const fdSnap = await transaction.get(fdRef); if (!fdSnap.exists()) throw new Error('Fixed deposit not found.'); const fd = safeFd(fdSnap.data(), fdSnap.id);
    transaction.update(renewalRef, { status: 'REJECTED', remarks: [renewal.remarks, comments].filter(Boolean).join('\n') });
    transaction.update(fdRef, { renewalStatus: 'REJECTED', status: deriveOperationalStatus({ ...fd, status: 'ACTIVE' }), updatedAt: now(), updatedBy: actor.userId, updatedByName: actor.userName });
    closeApproval(transaction, renewal.approvalId, 'REJECTED', comments, actor);
    audit(transaction, actor, { recordType: 'RENEWAL', recordId: renewal.id, fdId: renewal.oldFdId, action: 'RENEWAL_REJECTED', summary: `${renewal.oldFdNumber} renewal rejected`, reason: comments, page: `/fixed-deposit/${renewal.oldFdId}` });
  });
}

export async function completeFdRenewal(renewalId: string, bankConfirmationReference: string, actor: FDActor) {
  const renewalSnapshot = await getDoc(doc(db, FD_COLLECTIONS.renewals, renewalId));
  if (!renewalSnapshot.exists()) throw new Error('Renewal request not found.');
  const renewalOutside = { id: renewalSnapshot.id, ...renewalSnapshot.data() } as FDRenewal;
  const assignmentSnapshot = await getDocs(query(collection(db, FD_COLLECTIONS.assignments), where('fdId', '==', renewalOutside.oldFdId)));
  const assignmentRefs = assignmentSnapshot.docs.filter((entry) => [...ACTIVE_ASSIGNMENT_STATUSES, ...RESERVED_ASSIGNMENT_STATUSES].includes((entry.data() as FDAssignment).status)).map((entry) => doc(db, FD_COLLECTIONS.assignments, entry.id));
  return runTransaction(db, async (transaction) => {
    const renewalRef = doc(db, FD_COLLECTIONS.renewals, renewalId); const oldFdRef = doc(db, FD_COLLECTIONS.deposits, renewalOutside.oldFdId);
    const [renewalSnap, oldFdSnap, ...assignmentSnaps] = await Promise.all([transaction.get(renewalRef), transaction.get(oldFdRef), ...assignmentRefs.map((reference) => transaction.get(reference))]);
    if (!renewalSnap.exists() || !oldFdSnap.exists()) throw new Error('Renewal or old FD is missing.');
    const renewal = { id: renewalSnap.id, ...renewalSnap.data() } as FDRenewal; const oldFd = safeFd(oldFdSnap.data(), oldFdSnap.id); assertOrganization(oldFd.organizationId, actor);
    if (renewal.status !== 'SUBMITTED_TO_BANK') throw new Error('Renewal must be approved and submitted to bank first.');
    const activeAssignments = assignmentSnaps.filter((snapshot) => snapshot.exists()).map((snapshot) => ({ id: snapshot.id, ...snapshot.data() } as FDAssignment));
    const assignmentTotal = activeAssignments.reduce((total, item) => total + assignmentOutstanding(item), 0);
    if (renewal.assignmentsTransferred && round(assignmentTotal) !== round(oldFd.totalUtilizedAmount)) throw new Error('FD assignment position changed. Review the renewal impact again.');
    const newFdRef = doc(collection(db, FD_COLLECTIONS.deposits));
    const newEligible = calculateEligibleValue(renewal.renewalPrincipalAmount, oldFd.eligibleMarginPercentage);
    const newAvailable = calculateAvailableAmount(newEligible, oldFd.bgUtilizedAmount, oldFd.lcUtilizedAmount, oldFd.reservedAmount);
    const { id: _oldFdId, ...oldFdData } = oldFd;
    transaction.set(newFdRef, { ...oldFdData, referenceNumber: `${oldFd.referenceNumber}/R${String(Date.now()).slice(-4)}`, fdNumber: renewal.newFdNumber || `${oldFd.fdNumber}-R`, principalAmount: renewal.renewalPrincipalAmount, interestRate: renewal.newInterestRate, valueDate: now(), creationDate: now(), maturityDate: renewal.newMaturityDate, maturityAmount: renewal.newMaturityAmount, expectedInterest: round(renewal.newMaturityAmount - renewal.renewalPrincipalAmount), expectedTds: 0, expectedNetProceeds: renewal.newMaturityAmount, interestReceived: 0, eligibleValue: newEligible, availableAmount: newAvailable, status: newAvailable <= 0 ? 'FULLY_UTILIZED' : newAvailable < newEligible ? 'PARTIALLY_UTILIZED' : 'ACTIVE', renewalStatus: 'NOT_REQUIRED', closureStatus: 'NOT_INITIATED', approvalStatus: 'APPROVED', approvedBy: actor.userId, approvedByName: actor.userName, approvedAt: now(), createdBy: actor.userId, createdByName: actor.userName, createdAt: now(), updatedBy: actor.userId, updatedByName: actor.userName, updatedAt: now(), isDeleted: false });
    if (renewal.assignmentsTransferred) activeAssignments.forEach((assignment, index) => transaction.update(assignmentRefs[index], { previousFdId: oldFd.id, fdId: newFdRef.id, fdNumber: renewal.newFdNumber || `${oldFd.fdNumber}-R`, updatedBy: actor.userId, updatedByName: actor.userName, updatedAt: now() }));
    transaction.update(oldFdRef, { status: 'RENEWED', renewalStatus: 'RENEWED', bgUtilizedAmount: renewal.assignmentsTransferred ? 0 : oldFd.bgUtilizedAmount, lcUtilizedAmount: renewal.assignmentsTransferred ? 0 : oldFd.lcUtilizedAmount, reservedAmount: renewal.assignmentsTransferred ? 0 : oldFd.reservedAmount, totalUtilizedAmount: renewal.assignmentsTransferred ? 0 : oldFd.totalUtilizedAmount, availableAmount: 0, updatedBy: actor.userId, updatedByName: actor.userName, updatedAt: now() });
    transaction.update(renewalRef, { newFdId: newFdRef.id, status: 'RENEWED', bankConfirmationDate: now(), bankConfirmationReference, assignmentsTransferred: renewal.assignmentsTransferred });
    audit(transaction, actor, { recordType: 'RENEWAL', recordId: renewal.id, fdId: oldFd.id, action: 'RENEWAL_COMPLETED', summary: `${oldFd.fdNumber} renewed as ${renewal.newFdNumber}`, previousValue: { oldFdId: oldFd.id }, newValue: { newFdId: newFdRef.id }, approvalReference: bankConfirmationReference, page: `/fixed-deposit/${newFdRef.id}` });
    return newFdRef.id;
  });
}

export async function requestFdClosure(input: { fdId: string; closureType: FDClosure['closureType']; proposedDate: string; principalAmount?: number; actualInterest: number; tdsAmount: number; penaltyAmount: number; otherCharges: number; creditAccountId: string; reason: string }, actor: FDActor) {
  return runTransaction(db, async (transaction) => {
    const fdRef = doc(db, FD_COLLECTIONS.deposits, input.fdId); const fdSnap = await transaction.get(fdRef);
    if (!fdSnap.exists()) throw new Error('Fixed deposit not found.');
    const fd = safeFd(fdSnap.data(), fdSnap.id); assertOrganization(fd.organizationId, actor);
    const blockedAmount = round(fd.bgUtilizedAmount + fd.lcUtilizedAmount + fd.reservedAmount);
    if (blockedAmount > 0) throw new Error(`Closure blocked by active or reserved assignments totalling ${blockedAmount}.`);
    if (fd.status === 'ON_HOLD') throw new Error('FD is on hold and cannot be closed.');
    if (['CLOSED', 'PREMATURELY_CLOSED', 'RENEWED', 'REPLACED', 'CANCELLED'].includes(fd.status)) throw new Error('FD is already in a terminal state.');
    const closurePrincipal = input.closureType === 'PARTIAL' ? round(Number(input.principalAmount || 0)) : fd.principalAmount;
    if (input.closureType === 'PARTIAL' && (closurePrincipal <= 0 || closurePrincipal >= fd.principalAmount)) throw new Error('Partial closure principal must be greater than zero and less than the FD principal.');
    const closureRef = doc(collection(db, FD_COLLECTIONS.closures));
    const requiredRole = input.closureType === 'PREMATURE' ? 'Director Finance' : 'Finance Manager';
    const approvalId = approval(transaction, actor, { recordType: 'CLOSURE', recordId: closureRef.id, fdId: fd.id, amount: fd.principalAmount, requiredRole });
    const net = round(closurePrincipal + input.actualInterest - input.tdsAmount - input.penaltyAmount - input.otherCharges);
    const expectedInterest = input.closureType === 'PARTIAL' ? round(fd.expectedInterest * (closurePrincipal / fd.principalAmount)) : fd.expectedInterest;
    transaction.set(closureRef, { organizationId: fd.organizationId, fdId: fd.id, fdNumber: fd.fdNumber, closureType: input.closureType, requestDate: now(), proposedClosureDate: Timestamp.fromDate(new Date(`${input.proposedDate}T12:00:00`)), actualClosureDate: null, principalAmount: closurePrincipal, expectedInterest, actualInterest: round(input.actualInterest), tdsAmount: round(input.tdsAmount), penaltyAmount: round(input.penaltyAmount), otherCharges: round(input.otherCharges), netProceeds: net, creditAccountId: input.creditAccountId, activeAssignmentCount: 0, blockingAssignmentAmount: 0, status: 'PENDING_APPROVAL', approvalId, remarks: input.reason, financialLoss: round(closurePrincipal + expectedInterest - net), createdBy: actor.userId, createdByName: actor.userName, createdAt: now() } satisfies Omit<FDClosure, 'id'>);
    transaction.update(fdRef, { status: 'CLOSURE_PENDING', closureStatus: 'PENDING_APPROVAL', updatedBy: actor.userId, updatedByName: actor.userName, updatedAt: now() });
    audit(transaction, actor, { recordType: 'CLOSURE', recordId: closureRef.id, fdId: fd.id, action: 'CLOSURE_REQUESTED', summary: `${input.closureType} closure requested for ${fd.fdNumber}`, newValue: { netProceeds: net }, reason: input.reason, page: `/fixed-deposit/${fd.id}` });
    return closureRef.id;
  });
}

export async function decideFdClosure(closureId: string, action: 'APPROVE' | 'REJECT', comments: string, actor: FDActor) {
  return runTransaction(db, async (transaction) => {
    const closureRef = doc(db, FD_COLLECTIONS.closures, closureId); const closureSnap = await transaction.get(closureRef);
    if (!closureSnap.exists()) throw new Error('Closure request not found.');
    const closure = { id: closureSnap.id, ...closureSnap.data() } as FDClosure; assertOrganization(closure.organizationId, actor);
    if (closure.createdBy === actor.userId) throw new Error('You cannot approve your own closure request.');
    assertApprover(actor, closure.closureType === 'PREMATURE' ? 'Director Finance' : 'Finance Manager');
    if (closure.status !== 'PENDING_APPROVAL') throw new Error('Closure is not pending approval.');
    const fdRef = doc(db, FD_COLLECTIONS.deposits, closure.fdId); const fdSnap = await transaction.get(fdRef);
    if (!fdSnap.exists()) throw new Error('Fixed deposit not found.');
    const fd = safeFd(fdSnap.data(), fdSnap.id);
    if (action === 'APPROVE') {
      if (fd.totalUtilizedAmount > 0) throw new Error('Closure is now blocked by active obligations.');
      transaction.update(closureRef, { status: 'SUBMITTED_TO_BANK', approvedBy: actor.userId, approvedByName: actor.userName, approvedAt: now(), approvalNote: comments });
      transaction.update(fdRef, { closureStatus: 'SUBMITTED_TO_BANK', updatedAt: now(), updatedBy: actor.userId, updatedByName: actor.userName });
    } else {
      transaction.update(closureRef, { status: 'REJECTED', approvedBy: actor.userId, approvedByName: actor.userName, approvedAt: now(), approvalNote: comments });
      transaction.update(fdRef, { status: deriveOperationalStatus({ ...fd, status: 'ACTIVE' }), closureStatus: 'REJECTED', updatedAt: now(), updatedBy: actor.userId, updatedByName: actor.userName });
    }
    closeApproval(transaction, closure.approvalId, action === 'APPROVE' ? 'APPROVED' : 'REJECTED', comments, actor);
    audit(transaction, actor, { recordType: 'CLOSURE', recordId: closure.id, fdId: fd.id, action: `CLOSURE_${action}`, summary: `${fd.fdNumber} closure ${action.toLowerCase()}`, reason: comments, page: `/fixed-deposit/${fd.id}` });
  });
}

export async function completeFdClosure(closureId: string, input: { bankReference: string; actualDate: string; actualInterest: number; tdsAmount: number; penaltyAmount: number; otherCharges: number }, actor: FDActor) {
  return runTransaction(db, async (transaction) => {
    const closureRef = doc(db, FD_COLLECTIONS.closures, closureId); const closureSnap = await transaction.get(closureRef);
    if (!closureSnap.exists()) throw new Error('Closure request not found.');
    const closure = { id: closureSnap.id, ...closureSnap.data() } as FDClosure; assertOrganization(closure.organizationId, actor);
    if (!['SUBMITTED_TO_BANK', 'BANK_CONFIRMED', 'AMOUNT_RECEIVED'].includes(closure.status)) throw new Error('Closure must be approved and submitted to bank first.');
    if (!input.bankReference.trim()) throw new Error('Bank closure reference is required.');
    const fdRef = doc(db, FD_COLLECTIONS.deposits, closure.fdId); const fdSnap = await transaction.get(fdRef);
    if (!fdSnap.exists()) throw new Error('Fixed deposit not found.');
    const fd = safeFd(fdSnap.data(), fdSnap.id); if (fd.totalUtilizedAmount > 0) throw new Error('Closure is blocked by active obligations.');
    const net = round(closure.principalAmount + input.actualInterest - input.tdsAmount - input.penaltyAmount - input.otherCharges);
    const partial = closure.closureType === 'PARTIAL';
    const remainingPrincipal = partial ? Math.max(0, round(fd.principalAmount - closure.principalAmount)) : 0;
    const terminalStatus = closure.closureType === 'PREMATURE' ? 'PREMATURELY_CLOSED' : 'CLOSED';
    transaction.update(closureRef, { status: 'COMPLETED', actualClosureDate: Timestamp.fromDate(new Date(`${input.actualDate}T12:00:00`)), actualInterest: round(input.actualInterest), tdsAmount: round(input.tdsAmount), penaltyAmount: round(input.penaltyAmount), otherCharges: round(input.otherCharges), netProceeds: net, bankReference: input.bankReference, financialLoss: round(fd.maturityAmount - net) });
    const remainingRatio = fd.principalAmount > 0 ? remainingPrincipal / fd.principalAmount : 0; const remainingInterest = round(fd.expectedInterest * remainingRatio); const remainingTds = round(fd.expectedTds * remainingRatio);
    transaction.update(fdRef, partial ? { principalAmount: remainingPrincipal, expectedInterest: remainingInterest, maturityAmount: round(remainingPrincipal + remainingInterest), expectedTds: remainingTds, expectedNetProceeds: round(remainingPrincipal + remainingInterest - remainingTds), eligibleValue: calculateEligibleValue(remainingPrincipal, fd.eligibleMarginPercentage), availableAmount: calculateEligibleValue(remainingPrincipal, fd.eligibleMarginPercentage), status: 'ACTIVE', closureStatus: 'COMPLETED', interestReceived: round(Number(fd.interestReceived || 0) + input.actualInterest), updatedAt: now(), updatedBy: actor.userId, updatedByName: actor.userName } : { status: terminalStatus, closureStatus: 'COMPLETED', availableAmount: 0, interestReceived: round(Number(fd.interestReceived || 0) + input.actualInterest), updatedAt: now(), updatedBy: actor.userId, updatedByName: actor.userName });
    audit(transaction, actor, { recordType: 'CLOSURE', recordId: closure.id, fdId: fd.id, action: 'CLOSURE_COMPLETED', summary: `${fd.fdNumber} closure completed`, newValue: { netProceeds: net, status: partial ? 'ACTIVE' : terminalStatus }, approvalReference: input.bankReference, page: `/fixed-deposit/${fd.id}` });
  });
}

export async function requestFdReplacement(input: { assignmentId: string; replacementFdId: string; amount: number; reason: string }, actor: FDActor) {
  return runTransaction(db, async (transaction) => {
    const assignmentRef = doc(db, FD_COLLECTIONS.assignments, input.assignmentId); const replacementFdRef = doc(db, FD_COLLECTIONS.deposits, input.replacementFdId);
    const [assignmentSnap, replacementFdSnap] = await Promise.all([transaction.get(assignmentRef), transaction.get(replacementFdRef)]);
    if (!assignmentSnap.exists() || !replacementFdSnap.exists()) throw new Error('Assignment or replacement FD not found.');
    const assignment = { id: assignmentSnap.id, ...assignmentSnap.data() } as FDAssignment; const replacementFd = safeFd(replacementFdSnap.data(), replacementFdSnap.id); assertOrganization(assignment.organizationId, actor); assertOrganization(replacementFd.organizationId, actor);
    const amount = round(input.amount); if (amount <= 0 || amount > assignmentOutstanding(assignment)) throw new Error('Replacement amount exceeds the old assignment balance.'); if (amount > replacementFd.availableAmount) throw new Error('Replacement FD has insufficient available balance.');
    const replacementRef = doc(collection(db, FD_COLLECTIONS.replacements)); const approvalId = approval(transaction, actor, { recordType: 'REPLACEMENT', recordId: replacementRef.id, fdId: assignment.fdId, amount, requiredRole: 'Director Finance' });
    transaction.set(replacementRef, { organizationId: assignment.organizationId, oldFdId: assignment.fdId, oldFdNumber: assignment.fdNumber, oldAssignmentId: assignment.id, replacementFdId: replacementFd.id, replacementFdNumber: replacementFd.fdNumber, replacementAmount: amount, reason: input.reason, status: 'PENDING_APPROVAL', approvalId, createdBy: actor.userId, createdByName: actor.userName, createdAt: now(), updatedAt: now() } satisfies Omit<FDReplacementRequest, 'id'> & { approvalId: string });
    audit(transaction, actor, { recordType: 'REPLACEMENT', recordId: replacementRef.id, fdId: assignment.fdId, action: 'REPLACEMENT_REQUESTED', summary: `${assignment.fdNumber} assignment replacement requested with ${replacementFd.fdNumber}`, newValue: { replacementFdId: replacementFd.id, amount }, reason: input.reason, page: '/fixed-deposit/assignments' });
    return replacementRef.id;
  });
}

export async function rejectFdReplacement(replacementId: string, comments: string, actor: FDActor) {
  return runTransaction(db, async (transaction) => {
    const replacementRef = doc(db, FD_COLLECTIONS.replacements, replacementId); const snapshot = await transaction.get(replacementRef);
    if (!snapshot.exists()) throw new Error('Replacement request not found.');
    const replacement = { id: snapshot.id, ...snapshot.data() } as FDReplacementRequest; assertOrganization(replacement.organizationId, actor); assertApprover(actor, 'Director Finance');
    if (replacement.createdBy === actor.userId) throw new Error('You cannot decide your own replacement request.');
    if (!['PENDING_APPROVAL', 'REQUESTED'].includes(replacement.status)) throw new Error('Replacement request has already been decided.');
    transaction.update(replacementRef, { status: 'REJECTED', updatedAt: now() }); closeApproval(transaction, replacement.approvalId, 'REJECTED', comments, actor);
    audit(transaction, actor, { recordType: 'REPLACEMENT', recordId: replacement.id, fdId: replacement.oldFdId, action: 'REPLACEMENT_REJECTED', summary: `${replacement.oldFdNumber} replacement rejected`, reason: comments, page: '/fixed-deposit/assignments' });
  });
}

export async function completeFdReplacement(replacementId: string, bankConfirmationReference: string, actor: FDActor) {
  return runTransaction(db, async (transaction) => {
    const replacementRef = doc(db, FD_COLLECTIONS.replacements, replacementId); const replacementSnap = await transaction.get(replacementRef);
    if (!replacementSnap.exists()) throw new Error('Replacement request not found.');
    const replacement = { id: replacementSnap.id, ...replacementSnap.data() } as FDReplacementRequest; assertOrganization(replacement.organizationId, actor); assertApprover(actor, 'Director Finance');
    if (replacement.createdBy === actor.userId) throw new Error('You cannot approve your own replacement request.');
    if (!['PENDING_APPROVAL', 'APPROVED', 'BANK_CONFIRMED'].includes(replacement.status)) throw new Error('Replacement request cannot be completed.');
    if (!bankConfirmationReference.trim()) throw new Error('Bank confirmation is required before releasing the old assignment.');
    const assignmentRef = doc(db, FD_COLLECTIONS.assignments, replacement.oldAssignmentId); const oldFdRef = doc(db, FD_COLLECTIONS.deposits, replacement.oldFdId); const newFdRef = doc(db, FD_COLLECTIONS.deposits, replacement.replacementFdId);
    const [assignmentSnap, oldFdSnap, newFdSnap] = await Promise.all([transaction.get(assignmentRef), transaction.get(oldFdRef), transaction.get(newFdRef)]);
    if (!assignmentSnap.exists() || !oldFdSnap.exists() || !newFdSnap.exists()) throw new Error('Replacement records changed or no longer exist.');
    const assignment = { id: assignmentSnap.id, ...assignmentSnap.data() } as FDAssignment; const oldFd = safeFd(oldFdSnap.data(), oldFdSnap.id); const newFd = safeFd(newFdSnap.data(), newFdSnap.id);
    const amount = replacement.replacementAmount; if (assignmentOutstanding(assignment) < amount || newFd.availableAmount < amount) throw new Error('Assignment balances changed; review replacement again.');
    const newAssignmentRef = doc(collection(db, FD_COLLECTIONS.assignments));
    const { id: _oldAssignmentId, ...assignmentData } = assignment;
    transaction.set(newAssignmentRef, { ...assignmentData, fdId: newFd.id, fdNumber: newFd.fdNumber, assignmentAmount: amount, releasedAmount: 0, activeAmount: amount, status: 'ACTIVE', previousFdId: oldFd.id, previousAssignmentId: assignment.id, approvalId: replacement.id, createdBy: actor.userId, createdByName: actor.userName, createdAt: now(), updatedBy: actor.userId, updatedByName: actor.userName, updatedAt: now(), releaseReference: '' });
    const newSummary = summaryPatch(newFd, newFd.bgUtilizedAmount + (assignment.instrumentType === 'BG' ? amount : 0), newFd.lcUtilizedAmount + (assignment.instrumentType === 'LC' ? amount : 0), newFd.reservedAmount);
    const oldSummary = summaryPatch(oldFd, oldFd.bgUtilizedAmount - (assignment.instrumentType === 'BG' ? amount : 0), oldFd.lcUtilizedAmount - (assignment.instrumentType === 'LC' ? amount : 0), oldFd.reservedAmount);
    transaction.update(newFdRef, { bgUtilizedAmount: newSummary.bgUtilizedAmount, lcUtilizedAmount: newSummary.lcUtilizedAmount, totalUtilizedAmount: newSummary.totalUtilizedAmount, availableAmount: newSummary.availableAmount, status: newSummary.status, updatedAt: now(), updatedBy: actor.userId, updatedByName: actor.userName });
    transaction.update(oldFdRef, { bgUtilizedAmount: oldSummary.bgUtilizedAmount, lcUtilizedAmount: oldSummary.lcUtilizedAmount, totalUtilizedAmount: oldSummary.totalUtilizedAmount, availableAmount: oldSummary.availableAmount, status: oldSummary.status, updatedAt: now(), updatedBy: actor.userId, updatedByName: actor.userName });
    const remaining = round(assignmentOutstanding(assignment) - amount);
    transaction.update(assignmentRef, { activeAmount: remaining, releasedAmount: round(assignment.releasedAmount + amount), status: remaining > 0 ? 'PARTIALLY_RELEASED' : 'REPLACED', releaseReference: bankConfirmationReference, releasedBy: actor.userId, releasedByName: actor.userName, updatedAt: now(), updatedBy: actor.userId, updatedByName: actor.userName });
    transaction.update(replacementRef, { status: 'COMPLETED', bankConfirmationReference, approvedBy: actor.userId, approvedAt: now(), updatedAt: now(), newAssignmentId: newAssignmentRef.id });
    closeApproval(transaction, replacement.approvalId, 'APPROVED', bankConfirmationReference, actor);
    audit(transaction, actor, { recordType: 'REPLACEMENT', recordId: replacement.id, fdId: oldFd.id, action: 'REPLACEMENT_COMPLETED', summary: `Assignment moved from ${oldFd.fdNumber} to ${newFd.fdNumber}`, newValue: { newAssignmentId: newAssignmentRef.id, amount }, approvalReference: bankConfirmationReference, page: `/fixed-deposit/${newFd.id}` });
  });
}

export async function recalculateFdUtilization(organizationId: string, actor: FDActor) {
  if (organizationId !== actor.organizationId && actor.role !== 'Super Admin') throw new Error('Organization mismatch.');
  const [fdSnapshot, assignmentSnapshot] = await Promise.all([
    getDocs(query(collection(db, FD_COLLECTIONS.deposits), where('organizationId', '==', organizationId))),
    getDocs(query(collection(db, FD_COLLECTIONS.assignments), where('organizationId', '==', organizationId))),
  ]);
  const assignments = assignmentSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as FDAssignment));
  const batch = writeBatch(db);
  fdSnapshot.docs.forEach((fdDoc) => {
    const fd = safeFd(fdDoc.data(), fdDoc.id); const linked = assignments.filter((item) => item.fdId === fd.id);
    const bg = linked.filter((item) => item.instrumentType === 'BG' && ACTIVE_ASSIGNMENT_STATUSES.includes(item.status)).reduce((total, item) => total + assignmentOutstanding(item), 0);
    const lc = linked.filter((item) => item.instrumentType === 'LC' && ACTIVE_ASSIGNMENT_STATUSES.includes(item.status)).reduce((total, item) => total + assignmentOutstanding(item), 0);
    const reserved = linked.filter((item) => RESERVED_ASSIGNMENT_STATUSES.includes(item.status)).reduce((total, item) => total + assignmentOutstanding(item), 0);
    const next = summaryPatch(fd, bg, lc, reserved);
    batch.update(fdDoc.ref, { bgUtilizedAmount: next.bgUtilizedAmount, lcUtilizedAmount: next.lcUtilizedAmount, reservedAmount: next.reservedAmount, totalUtilizedAmount: next.totalUtilizedAmount, availableAmount: next.availableAmount, status: next.status, updatedBy: actor.userId, updatedByName: actor.userName, updatedAt: now() });
  });
  await batch.commit();
  return fdSnapshot.size;
}

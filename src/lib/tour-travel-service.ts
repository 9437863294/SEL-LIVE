'use client';

import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type Transaction,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { withCreateAudit, withUpdateAudit, type AuditActor } from '@/lib/audit-fields';
import {
  ADVANCE_REFERENCE_REQUIRED_MODES,
  DEFAULT_TRAVEL_APPROVAL_STAGES,
  DEFAULT_TRAVEL_SETTINGS,
  LOCKED_CLAIM_STATUSES,
  TT_COLLECTIONS,
  billFingerprint,
  calculateDailyAllowance,
  evaluateExpenseAgainstPolicy,
  evaluateOutstandingAdvances,
  evaluateTourClosure,
  financialYearForTravelDate,
  isExpenseWithinTourWindow,
  nightsBetween,
  resolveApprovalChain,
  resolveCityClass,
  resolveEntitlement,
  resolveStageApprovers,
  roundMoney,
  summarizeSettlement,
  travelDocumentNumber,
  type AdvancePaymentMode,
  type CityClass,
  type ClaimStatus,
  type ExpenseCategory,
  type RecoveryMode,
  type TourStatus,
  type TravelAdvance,
  type TravelApprovalEntry,
  type TravelApprovalRule,
  type TravelCityClass,
  type TravelClaim,
  type TravelClaimItem,
  type TravelDocKind,
  type TravelEntitlement,
  type TravelExpense,
  type TravelRequest,
  type TravelSettings,
  type VerificationDecision,
} from '@/lib/tour-travel';

/**
 * Write-side service for the Tour, Travel & Expense module.
 *
 * Every state transition lives here rather than in the components that trigger it, for three
 * reasons: the control rules of spec section 51 have to hold no matter which screen (or the mobile
 * client) initiates the change; document numbers must be allocated inside a transaction so two
 * simultaneous requests can't share a sequence; and every transition owes an audit entry, which is
 * far easier to guarantee in one module than across thirty call sites.
 *
 * Uses the Firestore *client* SDK — the same choice bank-guarantee-service.ts and
 * letter-of-credit-service.ts made — so these functions run under the signed-in user's security
 * rules. Server-side callers (cron routes, accounting posting) need the Admin-SDK equivalents.
 */

export interface TravelActor extends AuditActor {
  userId: string;
  userName: string;
  organizationId: string;
  organizationName?: string;
}

/** Thrown for a rule violation the user can act on, so callers can show the message verbatim. */
export class TravelControlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TravelControlError';
  }
}

const requireActor = (actor: TravelActor | null | undefined): TravelActor => {
  if (!actor?.userId || !actor.organizationId) throw new TravelControlError('You must be signed in to perform this action.');
  return actor;
};

/* ------------------------------------------------------------------------------------------------
 * Settings & configuration loading
 * ---------------------------------------------------------------------------------------------- */

/**
 * Loads an organization's travel settings, deep-merged over the defaults.
 *
 * Merging one level into each section rather than spreading the whole document means a settings doc
 * saved before a new option existed still resolves that option to its default instead of
 * `undefined` — which is what would otherwise turn a missing `controls.flagDuplicateBills` into a
 * silently disabled duplicate check.
 */
export async function loadTravelSettings(organizationId: string): Promise<TravelSettings> {
  const snapshot = await getDoc(doc(db, TT_COLLECTIONS.settings, organizationId));
  const saved = snapshot.exists() ? (snapshot.data() as Partial<TravelSettings>) : {};
  const base = DEFAULT_TRAVEL_SETTINGS;
  return {
    ...base,
    ...saved,
    organizationId,
    general: { ...base.general, ...(saved.general || {}) },
    allowances: { ...base.allowances, ...(saved.allowances || {}) },
    controls: { ...base.controls, ...(saved.controls || {}) },
    notifications: { ...base.notifications, ...(saved.notifications || {}) },
    accounting: { ...base.accounting, ...(saved.accounting || {}) },
  };
}

const activeDocs = async <T>(collectionName: string, organizationId: string): Promise<T[]> => {
  const snapshot = await getDocs(query(collection(db, collectionName), where('organizationId', '==', organizationId)));
  return snapshot.docs.map(entry => ({ id: entry.id, ...entry.data() }) as T);
};

export const loadTravelEntitlements = (organizationId: string) =>
  activeDocs<TravelEntitlement>(TT_COLLECTIONS.entitlements, organizationId);

export const loadTravelCityClasses = (organizationId: string) =>
  activeDocs<TravelCityClass>(TT_COLLECTIONS.cityClasses, organizationId);

export const loadTravelApprovalRules = (organizationId: string) =>
  activeDocs<TravelApprovalRule>(TT_COLLECTIONS.approvalRules, organizationId);

/* ------------------------------------------------------------------------------------------------
 * Document numbering
 * ---------------------------------------------------------------------------------------------- */

const counterKey = (organizationId: string, kind: TravelDocKind, financialYear: string) =>
  `${organizationId}__${kind}__${financialYear}`.replace(/\//g, '_');

interface NumberParams {
  organizationId: string;
  organizationName?: string;
  kind: TravelDocKind;
  financialYear: string;
}

/** A sequence read from its counter but not yet committed. */
interface ReservedNumber {
  number: string;
  counterRef: ReturnType<typeof doc>;
  sequence: number;
  params: NumberParams;
}

/**
 * Reads the next sequence for a document kind and formats its number, *without* writing anything.
 *
 * Split from the counter increment because Firestore requires every read in a transaction to happen
 * before every write. A caller that needs two numbers — `approveTravelClaim` allocates a settlement
 * and then either a payment or a recovery — must therefore reserve both up front and only then start
 * writing; doing it inline per document put a counter read after the settlement write and made the
 * whole transaction fail.
 */
async function reserveTravelNumber(transaction: Transaction, params: NumberParams): Promise<ReservedNumber> {
  const counterRef = doc(db, TT_COLLECTIONS.counters, counterKey(params.organizationId, params.kind, params.financialYear));
  const counter = await transaction.get(counterRef);
  const sequence = Number(counter.data()?.nextSequence || 1);
  return {
    number: travelDocumentNumber({
      kind: params.kind,
      orgCode: orgCodeFrom(params.organizationName || params.organizationId),
      financialYear: params.financialYear,
      sequence,
    }),
    counterRef,
    sequence,
    params,
  };
}

/** Commits a reserved sequence. Must be called in the transaction's write phase. */
function commitTravelNumber(transaction: Transaction, reserved: ReservedNumber) {
  transaction.set(
    reserved.counterRef,
    {
      organizationId: reserved.params.organizationId,
      kind: reserved.params.kind,
      financialYear: reserved.params.financialYear,
      nextSequence: reserved.sequence + 1,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

/**
 * Allocates and commits a single document number. Safe for the common case of one number per
 * transaction, where the counter read still precedes every write. Users never generate these
 * numbers themselves (spec section 49).
 */
async function nextTravelNumber(transaction: Transaction, params: NumberParams): Promise<string> {
  const reserved = await reserveTravelNumber(transaction, params);
  commitTravelNumber(transaction, reserved);
  return reserved.number;
}

/** Initials of a multi-word organization name, or the first letters of a single word. */
const orgCodeFrom = (value: string) => {
  const words = (value || '').trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return words.map(word => word[0]).join('').toUpperCase().slice(0, 6);
  return (words[0] || 'SEL').toUpperCase().slice(0, 6);
};

/* ------------------------------------------------------------------------------------------------
 * Audit
 * ---------------------------------------------------------------------------------------------- */

/**
 * Appends an audit entry. Deliberately fire-and-forget from the caller's perspective but awaited
 * internally, because a state transition that succeeded while its audit entry failed is worse than
 * a visible error — control rule 51.10 requires the history.
 */
export async function logTravelAudit(input: {
  actor: TravelActor;
  entityType: 'request' | 'advance' | 'booking' | 'expense' | 'claim' | 'claimItem' | 'settlement' | 'payment' | 'recovery' | 'settings';
  entityId: string;
  travelRequestId?: string;
  action: string;
  summary: string;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  remarks?: string;
}) {
  await addDoc(collection(db, TT_COLLECTIONS.auditLogs), {
    organizationId: input.actor.organizationId,
    entityType: input.entityType,
    entityId: input.entityId,
    travelRequestId: input.travelRequestId || null,
    action: input.action,
    summary: input.summary,
    oldValue: input.oldValue ?? null,
    newValue: input.newValue ?? null,
    userId: input.actor.userId,
    userName: input.actor.userName,
    remarks: input.remarks || '',
    createdAt: serverTimestamp(),
  });
}

/* ------------------------------------------------------------------------------------------------
 * Tour request
 * ---------------------------------------------------------------------------------------------- */

export interface TravelRequestInput {
  employeeId: string;
  employeeUserId: string;
  employeeName: string;
  employeeCode?: string;
  designation?: string;
  grade: string;
  departmentId?: string;
  departmentName?: string;
  reportingManagerId?: string;
  hodId?: string;
  costCentre?: string;
  branchId?: string;
  branchName?: string;

  tourType: TravelRequest['tourType'];
  purpose: string;
  isInternational?: boolean;
  isEmergency?: boolean;
  emergencyReason?: string;

  projectId?: string;
  projectName?: string;
  projectCode?: string;
  projectSiteId?: string;
  projectSiteName?: string;
  clientId?: string;
  clientName?: string;
  projectManagerId?: string;
  workOrderNo?: string;

  departureDate: string;
  returnDate: string;
  departureAt?: string;
  returnAt?: string;

  itinerary: TravelRequest['itinerary'];
  accommodation: TravelRequest['accommodation'];
  estimate: TravelRequest['estimate'];

  advanceRequired?: boolean;
  advanceRequestedAmount?: number;
  groupTourId?: string | null;
  isGroupCoordinator?: boolean;
  policyExceptions?: TravelRequest['policyExceptions'];
}

function validateRequestInput(input: TravelRequestInput, settings: TravelSettings) {
  if (!input.employeeId || !input.employeeUserId) throw new TravelControlError('Select the travelling employee.');
  if (!input.purpose?.trim()) throw new TravelControlError('Enter the purpose of the tour.');
  if (!input.departureDate || !input.returnDate) throw new TravelControlError('Enter the departure and return dates.');
  if (input.returnDate < input.departureDate) throw new TravelControlError('The return date cannot precede the departure date.');
  if (!input.itinerary?.length) throw new TravelControlError('Add at least one journey leg.');
  // Control rule 51.6 — a project-type tour must name a project, or its cost can never reach the
  // project ledger.
  if (input.tourType === 'Project/Site Visit' && !input.projectId) {
    throw new TravelControlError('A project/site visit must be linked to a project.');
  }
  if (input.isEmergency) {
    if (!settings.general.allowEmergencyTours) throw new TravelControlError('Emergency tours are disabled for this organization.');
    if (!input.emergencyReason?.trim()) throw new TravelControlError('An emergency tour requires a reason.');
  }
}

/**
 * Creates a tour request in DRAFT.
 *
 * An emergency tour is created already travel-approved-in-fact but flagged
 * `postFactoApprovalRequired`, per spec section 43: the employee can travel, and the approval chain
 * still has to close afterwards. Everything else starts at DRAFT and only acquires an approval
 * chain at submission.
 */
export async function createTravelRequest(input: TravelRequestInput, actor: TravelActor): Promise<{ id: string; referenceNumber: string }> {
  const me = requireActor(actor);
  const settings = await loadTravelSettings(me.organizationId);
  validateRequestInput(input, settings);

  const financialYear = financialYearForTravelDate(new Date());
  const durationDays = Math.max(1, nightsBetween(input.departureDate, input.returnDate) + 1);

  return runTransaction(db, async transaction => {
    const referenceNumber = await nextTravelNumber(transaction, {
      organizationId: me.organizationId,
      organizationName: me.organizationName,
      kind: 'request',
      financialYear,
    });
    const requestRef = doc(collection(db, TT_COLLECTIONS.requests));
    const payload: Omit<TravelRequest, 'id'> = {
      organizationId: me.organizationId,
      organizationName: me.organizationName || '',
      referenceNumber,
      financialYear,
      requestDate: new Date().toISOString().slice(0, 10),

      employeeId: input.employeeId,
      employeeUserId: input.employeeUserId,
      employeeName: input.employeeName,
      employeeCode: input.employeeCode || '',
      designation: input.designation || '',
      grade: input.grade,
      departmentId: input.departmentId || '',
      departmentName: input.departmentName || '',
      reportingManagerId: input.reportingManagerId || '',
      hodId: input.hodId || '',
      costCentre: input.costCentre || '',
      branchId: input.branchId || '',
      branchName: input.branchName || '',

      tourType: input.tourType,
      purpose: input.purpose.trim(),
      isInternational: !!input.isInternational,
      isEmergency: !!input.isEmergency,
      emergencyReason: input.emergencyReason || '',
      postFactoApprovalRequired: !!input.isEmergency,

      projectId: input.projectId || '',
      projectName: input.projectName || '',
      projectCode: input.projectCode || '',
      projectSiteId: input.projectSiteId || '',
      projectSiteName: input.projectSiteName || '',
      clientId: input.clientId || '',
      clientName: input.clientName || '',
      projectManagerId: input.projectManagerId || '',
      workOrderNo: input.workOrderNo || '',

      departureDate: input.departureDate,
      returnDate: input.returnDate,
      departureAt: input.departureAt || `${input.departureDate}T09:00`,
      returnAt: input.returnAt || `${input.returnDate}T18:00`,
      durationDays,

      itinerary: input.itinerary,
      accommodation: input.accommodation || [],
      estimate: input.estimate,
      approvedAmount: null,

      advanceRequired: !!input.advanceRequired,
      advanceRequestedAmount: roundMoney(input.advanceRequestedAmount || 0),

      groupTourId: input.groupTourId || null,
      isGroupCoordinator: !!input.isGroupCoordinator,

      // An emergency tour is already travelling; a normal one waits for approval.
      status: input.isEmergency ? 'IN_PROGRESS' : 'DRAFT',
      approvalStages: [],
      currentStageIndex: 0,
      currentApprovers: [],
      approvalHistory: [],
      stageEnteredAt: null,
      approvalDeadline: null,
      policyExceptions: input.policyExceptions || [],
      travelCompletedAt: null,
      claimId: null,
      cancellation: null,
      revisionOf: null,
      revisionNumber: 0,
    };

    transaction.set(requestRef, { ...payload, ...withCreateAudit(me) });
    return { id: requestRef.id, referenceNumber };
  }).then(async result => {
    await logTravelAudit({
      actor: me,
      entityType: 'request',
      entityId: result.id,
      travelRequestId: result.id,
      action: 'Created',
      summary: `Tour request ${result.referenceNumber} created for ${input.employeeName}.`,
      newValue: { status: input.isEmergency ? 'IN_PROGRESS' : 'DRAFT', estimate: input.estimate.total },
    });
    return result;
  });
}

/**
 * Submits a DRAFT request into its approval chain.
 *
 * The chain is resolved *now* and frozen onto the request. Resolving it lazily at each approval
 * instead would let an administrator editing the approval matrix mid-flight change who still has to
 * approve a tour that is already halfway through — which would leave the approval history
 * describing a chain that no longer exists.
 *
 * A stage that resolves to nobody is skipped rather than stalling the tour, except when it's the
 * only stage: a chain with no reachable approver at all is a configuration error the submitter
 * needs to see, not a tour that silently self-approves.
 */
export async function submitTravelRequest(
  requestId: string,
  actor: TravelActor,
  options: { roleMembers?: Record<string, string[]> } = {},
): Promise<{ status: TourStatus; approvers: string[] }> {
  const me = requireActor(actor);
  const [settings, rules] = await Promise.all([
    loadTravelSettings(me.organizationId),
    loadTravelApprovalRules(me.organizationId),
  ]);

  const requestRef = doc(db, TT_COLLECTIONS.requests, requestId);
  const snapshot = await getDoc(requestRef);
  if (!snapshot.exists()) throw new TravelControlError('Tour request not found.');
  const request = { id: snapshot.id, ...snapshot.data() } as TravelRequest;
  if (!['DRAFT', 'IN_PROGRESS'].includes(request.status)) {
    throw new TravelControlError(`A ${request.status} request cannot be submitted.`);
  }

  const configured = resolveApprovalChain(rules, {
    amount: request.estimate.total,
    tourType: request.tourType,
    isInternational: request.isInternational,
    projectId: request.projectId,
  });
  if (!configured.length && settings.general.requireApprovalRule) {
    throw new TravelControlError('No approval rule matches this tour. Ask an administrator to configure the approval matrix.');
  }
  const stages = configured.length ? configured : DEFAULT_TRAVEL_APPROVAL_STAGES;

  // Control rule 51.14 is enforced inside resolveStageApprovers, which drops the traveller from
  // every stage — so a manager raising their own tour skips their own approval rather than being
  // handed it.
  const resolved = stages
    .map(stage => ({ stage, approvers: resolveStageApprovers(stage, request, options.roleMembers) }))
    .filter(entry => entry.approvers.length > 0);

  if (!resolved.length) {
    throw new TravelControlError('No approver could be resolved for this tour. Check the reporting manager, HOD and approval matrix.');
  }

  const first = resolved[0];
  await updateDoc(requestRef, {
    status: 'UNDER_APPROVAL' satisfies TourStatus,
    approvalStages: resolved.map(entry => entry.stage),
    currentStageIndex: 0,
    currentApprovers: first.approvers,
    stageEnteredAt: serverTimestamp(),
    submittedAt: serverTimestamp(),
    ...withUpdateAudit(me),
  });
  await logTravelAudit({
    actor: me,
    entityType: 'request',
    entityId: requestId,
    travelRequestId: requestId,
    action: 'Submitted',
    summary: `Tour ${request.referenceNumber} submitted for approval to ${first.stage.name}.`,
    oldValue: { status: request.status },
    newValue: { status: 'UNDER_APPROVAL', stage: first.stage.name },
  });
  return { status: 'UNDER_APPROVAL', approvers: first.approvers };
}

export type TourApprovalAction = TravelApprovalEntry['action'];

/**
 * Records an approval decision and moves the tour to wherever that decision leads.
 *
 * Approve on the last stage lands on APPROVED (or straight to TRAVEL_SCHEDULED for an emergency
 * tour, whose travel already happened — its post-facto flag clears here). Reject is terminal. Send
 * Back returns the request to DRAFT with the chain cleared, because a re-submitted tour must be
 * re-evaluated against the matrix rather than resuming mid-chain with a stale estimate.
 *
 * 'Approve with Modification' writes `approvedAmount` and leaves `estimate` untouched — the
 * employee's original figure is part of the record (spec section 10).
 */
export async function actOnTravelRequest(
  requestId: string,
  action: TourApprovalAction,
  actor: TravelActor,
  options: { remarks?: string; modifiedAmount?: number | null; roleMembers?: Record<string, string[]> } = {},
): Promise<{ status: TourStatus; approvers: string[] }> {
  const me = requireActor(actor);
  const requestRef = doc(db, TT_COLLECTIONS.requests, requestId);
  const snapshot = await getDoc(requestRef);
  if (!snapshot.exists()) throw new TravelControlError('Tour request not found.');
  const request = { id: snapshot.id, ...snapshot.data() } as TravelRequest;

  if (request.status !== 'UNDER_APPROVAL' && !request.postFactoApprovalRequired) {
    throw new TravelControlError(`A ${request.status} request is not awaiting approval.`);
  }
  if (request.employeeUserId === me.userId) {
    throw new TravelControlError('You cannot approve your own tour request.');
  }
  if (request.currentApprovers?.length && !request.currentApprovers.includes(me.userId)) {
    throw new TravelControlError('This approval is assigned to someone else.');
  }
  if ((action === 'Reject' || action === 'Send Back') && !options.remarks?.trim()) {
    throw new TravelControlError('A remark is required when rejecting or sending back a request.');
  }

  const stageIndex = Number(request.currentStageIndex || 0);
  const stage = request.approvalStages?.[stageIndex];
  const entry = {
    stageId: stage?.id || String(stageIndex + 1),
    stageName: stage?.name || 'Approval',
    action,
    userId: me.userId,
    userName: me.userName,
    remarks: options.remarks || '',
    modifiedAmount: action === 'Approve with Modification' ? roundMoney(options.modifiedAmount || 0) : null,
    timestamp: serverTimestamp(),
  };
  const history = [...(request.approvalHistory || []), entry as unknown as TravelApprovalEntry];

  // Clarification requests and forwards are recorded but leave the tour where it is — the approver
  // is asking a question, not making a decision.
  if (action === 'Request Clarification' || action === 'Forward') {
    await updateDoc(requestRef, { approvalHistory: history, ...withUpdateAudit(me) });
    await logTravelAudit({
      actor: me, entityType: 'request', entityId: requestId, travelRequestId: requestId,
      action, summary: `${action} on tour ${request.referenceNumber} at ${entry.stageName}.`, remarks: options.remarks,
    });
    return { status: request.status, approvers: request.currentApprovers || [] };
  }

  if (action === 'Reject') {
    await updateDoc(requestRef, {
      status: 'REJECTED' satisfies TourStatus,
      approvalHistory: history,
      currentApprovers: [],
      rejectionReason: options.remarks || '',
      ...withUpdateAudit(me),
    });
    await logTravelAudit({
      actor: me, entityType: 'request', entityId: requestId, travelRequestId: requestId,
      action: 'Rejected', summary: `Tour ${request.referenceNumber} rejected at ${entry.stageName}.`,
      oldValue: { status: request.status }, newValue: { status: 'REJECTED' }, remarks: options.remarks,
    });
    return { status: 'REJECTED', approvers: [] };
  }

  if (action === 'Send Back') {
    await updateDoc(requestRef, {
      status: 'DRAFT' satisfies TourStatus,
      approvalHistory: history,
      approvalStages: [],
      currentStageIndex: 0,
      currentApprovers: [],
      stageEnteredAt: null,
      ...withUpdateAudit(me),
    });
    await logTravelAudit({
      actor: me, entityType: 'request', entityId: requestId, travelRequestId: requestId,
      action: 'Sent back', summary: `Tour ${request.referenceNumber} sent back for correction from ${entry.stageName}.`,
      oldValue: { status: request.status }, newValue: { status: 'DRAFT' }, remarks: options.remarks,
    });
    return { status: 'DRAFT', approvers: [] };
  }

  // Approve / Approve with Modification.
  const nextIndex = stageIndex + 1;
  const nextStage = request.approvalStages?.[nextIndex];
  const nextApprovers = nextStage ? resolveStageApprovers(nextStage, request, options.roleMembers) : [];

  if (nextStage && nextApprovers.length) {
    await updateDoc(requestRef, {
      approvalHistory: history,
      currentStageIndex: nextIndex,
      currentApprovers: nextApprovers,
      stageEnteredAt: serverTimestamp(),
      ...(entry.modifiedAmount ? { approvedAmount: entry.modifiedAmount } : {}),
      ...withUpdateAudit(me),
    });
    await logTravelAudit({
      actor: me, entityType: 'request', entityId: requestId, travelRequestId: requestId,
      action: 'Approved', summary: `Tour ${request.referenceNumber} approved at ${entry.stageName}; forwarded to ${nextStage.name}.`,
      newValue: { stage: nextStage.name }, remarks: options.remarks,
    });
    return { status: 'UNDER_APPROVAL', approvers: nextApprovers };
  }

  const finalStatus: TourStatus = request.isEmergency ? 'IN_PROGRESS' : 'APPROVED';
  await updateDoc(requestRef, {
    status: finalStatus,
    approvalHistory: history,
    currentApprovers: [],
    postFactoApprovalRequired: false,
    approvedAt: serverTimestamp(),
    ...(entry.modifiedAmount ? { approvedAmount: entry.modifiedAmount } : {}),
    ...withUpdateAudit(me),
  });
  await logTravelAudit({
    actor: me, entityType: 'request', entityId: requestId, travelRequestId: requestId,
    action: 'Approved', summary: `Tour ${request.referenceNumber} fully approved.`,
    oldValue: { status: request.status }, newValue: { status: finalStatus }, remarks: options.remarks,
  });
  return { status: finalStatus, approvers: [] };
}

/** Marks travel finished, which is what opens the claim window. */
export async function markTravelCompleted(requestId: string, actor: TravelActor) {
  const me = requireActor(actor);
  const requestRef = doc(db, TT_COLLECTIONS.requests, requestId);
  const snapshot = await getDoc(requestRef);
  if (!snapshot.exists()) throw new TravelControlError('Tour request not found.');
  const request = snapshot.data() as TravelRequest;
  if (!['APPROVED', 'TRAVEL_SCHEDULED', 'IN_PROGRESS'].includes(request.status)) {
    throw new TravelControlError(`A ${request.status} tour cannot be marked complete.`);
  }
  await updateDoc(requestRef, {
    status: 'COMPLETED' satisfies TourStatus,
    travelCompletedAt: serverTimestamp(),
    ...withUpdateAudit(me),
  });
  await logTravelAudit({
    actor: me, entityType: 'request', entityId: requestId, travelRequestId: requestId,
    action: 'Travel completed', summary: `Travel completed for tour ${request.referenceNumber}.`,
    oldValue: { status: request.status }, newValue: { status: 'COMPLETED' },
  });
}

/** Cancels a tour, recording cancellation charges and expected refunds (spec section 40). */
export async function cancelTravelRequest(
  requestId: string,
  actor: TravelActor,
  input: { reason: string; ticketCancellationCharge?: number; hotelCancellationCharge?: number; refundExpected?: number },
) {
  const me = requireActor(actor);
  if (!input.reason?.trim()) throw new TravelControlError('A cancellation reason is required.');
  const requestRef = doc(db, TT_COLLECTIONS.requests, requestId);
  const snapshot = await getDoc(requestRef);
  if (!snapshot.exists()) throw new TravelControlError('Tour request not found.');
  const request = snapshot.data() as TravelRequest;
  if (['CLOSED', 'CANCELLED'].includes(request.status)) throw new TravelControlError('This tour is already closed or cancelled.');

  await updateDoc(requestRef, {
    status: 'CANCELLED' satisfies TourStatus,
    currentApprovers: [],
    cancellation: {
      reason: input.reason.trim(),
      cancelledBy: me.userId,
      cancelledByName: me.userName,
      cancelledAt: serverTimestamp(),
      ticketCancellationCharge: roundMoney(input.ticketCancellationCharge || 0),
      hotelCancellationCharge: roundMoney(input.hotelCancellationCharge || 0),
      refundExpected: roundMoney(input.refundExpected || 0),
      refundReceived: 0,
    },
    ...withUpdateAudit(me),
  });
  await logTravelAudit({
    actor: me, entityType: 'request', entityId: requestId, travelRequestId: requestId,
    action: 'Cancelled', summary: `Tour ${request.referenceNumber} cancelled.`,
    oldValue: { status: request.status }, newValue: { status: 'CANCELLED' }, remarks: input.reason,
  });
}

/* ------------------------------------------------------------------------------------------------
 * Travel advance
 * ---------------------------------------------------------------------------------------------- */

/**
 * Runs the outstanding-advance control for an employee (spec section 12) so the UI can warn or
 * block *before* the user fills in a request. Exposed separately from `requestTravelAdvance`
 * because the tour request form needs the same answer while the advance doesn't exist yet.
 */
export async function checkOutstandingAdvances(employeeId: string, organizationId: string) {
  const settings = await loadTravelSettings(organizationId);
  const snapshot = await getDocs(query(
    collection(db, TT_COLLECTIONS.advances),
    where('organizationId', '==', organizationId),
    where('employeeId', '==', employeeId),
  ));
  const advances = snapshot.docs.map(entry => entry.data() as TravelAdvance);
  return evaluateOutstandingAdvances(advances, {
    overdueAfterDays: settings.general.advanceSettlementDeadlineDays,
    policy: settings.general.outstandingAdvancePolicy,
  });
}

/**
 * Raises an advance request against an approved tour.
 *
 * The outstanding-advance control runs here as well as in the UI, because the UI check is advisory
 * and a mobile client or a stale tab could otherwise slip past it. `overrideReason` is the only way
 * past a Block, and it is recorded on the advance rather than just in the audit log so the override
 * is visible on the document a Finance reviewer is actually looking at.
 */
export async function requestTravelAdvance(
  input: { travelRequestId: string; requestedAmount: number; requestReason?: string; overrideReason?: string },
  actor: TravelActor,
): Promise<{ id: string; referenceNumber: string }> {
  const me = requireActor(actor);
  const amount = roundMoney(input.requestedAmount);
  if (amount <= 0) throw new TravelControlError('Enter the advance amount.');

  const requestSnapshot = await getDoc(doc(db, TT_COLLECTIONS.requests, input.travelRequestId));
  if (!requestSnapshot.exists()) throw new TravelControlError('Tour request not found.');
  const request = { id: requestSnapshot.id, ...requestSnapshot.data() } as TravelRequest;
  if (!['APPROVED', 'TRAVEL_SCHEDULED', 'IN_PROGRESS'].includes(request.status)) {
    throw new TravelControlError('An advance can only be requested against an approved tour.');
  }
  if (amount > request.estimate.total) {
    throw new TravelControlError(`The advance cannot exceed the approved estimate of ${request.estimate.total}.`);
  }

  const check = await checkOutstandingAdvances(request.employeeId, me.organizationId);
  if (check.action === 'Block' && !input.overrideReason?.trim()) {
    throw new TravelControlError(`${check.message} A new advance is blocked until it is settled.`);
  }
  if ((check.action === 'Require Finance override' || check.action === 'Require Director approval') && !input.overrideReason?.trim()) {
    throw new TravelControlError(`${check.message} An override reason is required to proceed.`);
  }

  const financialYear = financialYearForTravelDate(new Date());
  const result = await runTransaction(db, async transaction => {
    const referenceNumber = await nextTravelNumber(transaction, {
      organizationId: me.organizationId,
      organizationName: me.organizationName,
      kind: 'advance',
      financialYear,
    });
    const advanceRef = doc(collection(db, TT_COLLECTIONS.advances));
    const payload: Omit<TravelAdvance, 'id'> = {
      organizationId: me.organizationId,
      referenceNumber,
      financialYear,
      travelRequestId: request.id,
      travelRequestNumber: request.referenceNumber,
      employeeId: request.employeeId,
      employeeUserId: request.employeeUserId,
      employeeName: request.employeeName,
      departmentId: request.departmentId || '',
      projectId: request.projectId || '',
      projectName: request.projectName || '',
      costCentre: request.costCentre || '',
      requestedAmount: amount,
      approvedAmount: 0,
      paidAmount: 0,
      settledAmount: 0,
      requestReason: input.requestReason || '',
      status: 'REQUESTED',
      paidOn: null,
      outstandingOverride: input.overrideReason?.trim()
        ? {
            action: check.action,
            outstandingAmount: check.outstandingAmount,
            oldestAgeDays: check.oldestAgeDays,
            reason: input.overrideReason.trim(),
            overriddenBy: me.userId,
            overriddenByName: me.userName,
            overriddenAt: serverTimestamp() as never,
          }
        : null,
    };
    transaction.set(advanceRef, { ...payload, requestedAt: serverTimestamp(), ...withCreateAudit(me) });
    return { id: advanceRef.id, referenceNumber };
  });

  await logTravelAudit({
    actor: me, entityType: 'advance', entityId: result.id, travelRequestId: request.id,
    action: 'Requested', summary: `Advance ${result.referenceNumber} of ${amount} requested against ${request.referenceNumber}.`,
    newValue: { requestedAmount: amount, outstandingCheck: check.action },
    remarks: input.overrideReason,
  });
  return result;
}

/** Finance approval of an advance, optionally at a reduced amount. */
export async function approveTravelAdvance(
  advanceId: string,
  actor: TravelActor,
  input: { approvedAmount: number; remarks?: string },
) {
  const me = requireActor(actor);
  const approvedAmount = roundMoney(input.approvedAmount);
  if (approvedAmount <= 0) throw new TravelControlError('Enter the approved advance amount.');

  const advanceRef = doc(db, TT_COLLECTIONS.advances, advanceId);
  const snapshot = await getDoc(advanceRef);
  if (!snapshot.exists()) throw new TravelControlError('Advance not found.');
  const advance = snapshot.data() as TravelAdvance;
  if (advance.status !== 'REQUESTED') throw new TravelControlError(`A ${advance.status} advance cannot be approved.`);
  if (advance.employeeUserId === me.userId) throw new TravelControlError('You cannot approve your own advance request.');
  if (approvedAmount > advance.requestedAmount) {
    throw new TravelControlError('The approved amount cannot exceed the requested amount.');
  }

  await updateDoc(advanceRef, {
    approvedAmount,
    status: 'PAYMENT_PENDING',
    approvedBy: me.userId,
    approvedByName: me.userName,
    approvedAt: serverTimestamp(),
    ...withUpdateAudit(me),
  });
  await logTravelAudit({
    actor: me, entityType: 'advance', entityId: advanceId, travelRequestId: advance.travelRequestId,
    action: 'Approved', summary: `Advance ${advance.referenceNumber} approved for ${approvedAmount}.`,
    oldValue: { requestedAmount: advance.requestedAmount }, newValue: { approvedAmount }, remarks: input.remarks,
  });
}

export async function rejectTravelAdvance(advanceId: string, actor: TravelActor, reason: string) {
  const me = requireActor(actor);
  if (!reason?.trim()) throw new TravelControlError('A rejection reason is required.');
  const advanceRef = doc(db, TT_COLLECTIONS.advances, advanceId);
  const snapshot = await getDoc(advanceRef);
  if (!snapshot.exists()) throw new TravelControlError('Advance not found.');
  const advance = snapshot.data() as TravelAdvance;
  if (advance.status !== 'REQUESTED') throw new TravelControlError(`A ${advance.status} advance cannot be rejected.`);

  await updateDoc(advanceRef, { status: 'REJECTED', rejectionReason: reason.trim(), ...withUpdateAudit(me) });
  await logTravelAudit({
    actor: me, entityType: 'advance', entityId: advanceId, travelRequestId: advance.travelRequestId,
    action: 'Rejected', summary: `Advance ${advance.referenceNumber} rejected.`, remarks: reason,
  });
}

/**
 * Records a disbursement against an approved advance.
 *
 * Payments accumulate — an advance can be paid in parts — so `paidAmount` is incremented inside a
 * transaction rather than assigned, and `paidOn` is stamped only on the first payment because it is
 * the ageing anchor: re-stamping it on a top-up would reset the age of money the employee has been
 * holding for weeks.
 */
export async function recordAdvancePayment(
  advanceId: string,
  actor: TravelActor,
  input: {
    amount: number;
    paymentDate: string;
    mode: AdvancePaymentMode;
    bankAccount?: string;
    transactionReference?: string;
    chequeNumber?: string;
    voucherNumber?: string;
    accountingDate?: string;
    remarks?: string;
  },
) {
  const me = requireActor(actor);
  const amount = roundMoney(input.amount);
  if (amount <= 0) throw new TravelControlError('Enter the payment amount.');
  if (!input.paymentDate) throw new TravelControlError('Enter the payment date.');
  if (ADVANCE_REFERENCE_REQUIRED_MODES.includes(input.mode) && !input.transactionReference?.trim()) {
    throw new TravelControlError(`A transaction reference (UTR) is required for a ${input.mode} payment.`);
  }
  if (input.mode === 'Cheque' && !input.chequeNumber?.trim()) {
    throw new TravelControlError('A cheque number is required for a cheque payment.');
  }

  const advanceRef = doc(db, TT_COLLECTIONS.advances, advanceId);
  const paymentRef = doc(collection(db, TT_COLLECTIONS.advancePayments));

  const result = await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(advanceRef);
    if (!snapshot.exists()) throw new TravelControlError('Advance not found.');
    const advance = snapshot.data() as TravelAdvance;
    if (!['APPROVED', 'PAYMENT_PENDING', 'PAID'].includes(advance.status)) {
      throw new TravelControlError(`A ${advance.status} advance cannot be paid.`);
    }
    const alreadyPaid = roundMoney(advance.paidAmount || 0);
    if (roundMoney(alreadyPaid + amount) > roundMoney(advance.approvedAmount)) {
      throw new TravelControlError(`Paying ${amount} would exceed the approved advance of ${advance.approvedAmount} (already paid ${alreadyPaid}).`);
    }

    transaction.set(paymentRef, {
      organizationId: me.organizationId,
      advanceId,
      travelRequestId: advance.travelRequestId,
      amount,
      paymentDate: input.paymentDate,
      mode: input.mode,
      bankAccount: input.bankAccount || '',
      transactionReference: input.transactionReference || '',
      chequeNumber: input.chequeNumber || '',
      voucherNumber: input.voucherNumber || '',
      accountingDate: input.accountingDate || input.paymentDate,
      remarks: input.remarks || '',
      paidBy: me.userId,
      paidByName: me.userName,
      createdAt: serverTimestamp(),
    });
    transaction.update(advanceRef, {
      paidAmount: increment(amount),
      // Only fully disbursed advances read as PAID; a part payment stays PAYMENT_PENDING so the
      // balance is visibly still owed to the employee and a further payment can be recorded.
      status: roundMoney(alreadyPaid + amount) >= roundMoney(advance.approvedAmount) ? 'PAID' : 'PAYMENT_PENDING',
      // Only the first disbursement sets the ageing anchor.
      ...(advance.paidOn ? {} : { paidOn: input.paymentDate }),
      ...withUpdateAudit(me),
    });
    return { advance, referenceNumber: advance.referenceNumber };
  });

  await logTravelAudit({
    actor: me, entityType: 'advance', entityId: advanceId, travelRequestId: result.advance.travelRequestId,
    action: 'Payment recorded', summary: `${amount} paid against advance ${result.referenceNumber} by ${input.mode}.`,
    newValue: { amount, mode: input.mode, transactionReference: input.transactionReference || '' },
  });
  return { id: paymentRef.id };
}

/* ------------------------------------------------------------------------------------------------
 * Expense capture
 * ---------------------------------------------------------------------------------------------- */

/**
 * Saves one expense captured during the journey.
 *
 * Two advisory flags are computed at capture rather than at verification, so the employee sees the
 * problem while the bill is still in their hand: an expense dated outside the approved tour window
 * (control rule 51.5), and a bill whose fingerprint already exists for this employee (control rule
 * 51.3). Neither blocks the save — both are judgements for the verifier, and refusing the save
 * would just push the employee to alter the date.
 */
export async function captureTravelExpense(
  input: {
    travelRequestId: string;
    expenseDate: string;
    category: ExpenseCategory;
    amount: number;
    vendor?: string;
    description?: string;
    gstAmount?: number;
    invoiceNumber?: string;
    invoiceDate?: string;
    gstin?: string;
    paymentMode: TravelExpense['paymentMode'];
    city?: string;
    quantity?: number;
    billAvailable?: boolean;
    billReference?: string;
    billFileName?: string;
    billFileType?: string;
    billFileSize?: number;
    fileHash?: string;
    mileage?: TravelExpense['mileage'];
  },
  actor: TravelActor,
): Promise<{ id: string; flags: string[] }> {
  const me = requireActor(actor);
  const amount = roundMoney(input.amount);
  if (amount <= 0) throw new TravelControlError('Enter the expense amount.');
  if (!input.expenseDate) throw new TravelControlError('Enter the expense date.');

  const [settings, cityClasses, requestSnapshot] = await Promise.all([
    loadTravelSettings(me.organizationId),
    loadTravelCityClasses(me.organizationId),
    getDoc(doc(db, TT_COLLECTIONS.requests, input.travelRequestId)),
  ]);
  if (!requestSnapshot.exists()) throw new TravelControlError('Tour request not found.');
  const request = { id: requestSnapshot.id, ...requestSnapshot.data() } as TravelRequest;

  if (settings.general.requireApprovedTour && !['APPROVED', 'TRAVEL_SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CLAIM_PENDING'].includes(request.status)) {
    throw new TravelControlError('Expenses can only be captured against an approved tour.');
  }
  if (amount > settings.controls.requireBillAbove && input.billAvailable === false) {
    throw new TravelControlError(`A bill is required for an expense above ${settings.controls.requireBillAbove}.`);
  }

  const flags: string[] = [];
  const window = isExpenseWithinTourWindow(input.expenseDate, request, settings.general.expenseDateToleranceDays);
  if (!window.withinWindow) flags.push(window.reason);

  if (settings.controls.flagDuplicateBills && (input.invoiceNumber || input.fileHash)) {
    const fingerprint = billFingerprint({ vendor: input.vendor, invoiceNumber: input.invoiceNumber, invoiceDate: input.invoiceDate, amount });
    const existing = await getDocs(query(
      collection(db, TT_COLLECTIONS.expenses),
      where('organizationId', '==', me.organizationId),
      where('employeeId', '==', request.employeeId),
    ));
    const duplicate = existing.docs.some(entry => {
      const other = entry.data() as TravelExpense;
      if (other.deleted) return false;
      if (input.fileHash && other.fileHash === input.fileHash) return true;
      return !!input.invoiceNumber && billFingerprint(other) === fingerprint;
    });
    if (duplicate) flags.push('Possible duplicate claim — a matching bill already exists for this employee.');
  }

  const cityClass = resolveCityClass(cityClasses, input.city, settings.general.defaultCityClass);
  const expenseRef = await addDoc(collection(db, TT_COLLECTIONS.expenses), {
    organizationId: me.organizationId,
    travelRequestId: request.id,
    travelRequestNumber: request.referenceNumber,
    employeeId: request.employeeId,
    employeeUserId: request.employeeUserId,
    expenseDate: input.expenseDate,
    category: input.category,
    vendor: input.vendor || '',
    description: input.description || '',
    amount,
    gstAmount: roundMoney(input.gstAmount || 0),
    invoiceNumber: input.invoiceNumber || '',
    invoiceDate: input.invoiceDate || '',
    gstin: input.gstin || '',
    paymentMode: input.paymentMode,
    city: input.city || '',
    cityClass,
    quantity: Math.max(1, Number(input.quantity) || 1),
    billAvailable: input.billAvailable !== false,
    billReference: input.billReference || '',
    billFileName: input.billFileName || '',
    billFileType: input.billFileType || '',
    billFileSize: Number(input.billFileSize || 0),
    fileHash: input.fileHash || '',
    mileage: input.mileage || null,
    projectId: request.projectId || '',
    projectName: request.projectName || '',
    costCentre: request.costCentre || '',
    claimed: false,
    claimId: null,
    flags,
    deleted: false,
    ...withCreateAudit(me),
  });

  await logTravelAudit({
    actor: me, entityType: 'expense', entityId: expenseRef.id, travelRequestId: request.id,
    action: 'Captured', summary: `${input.category} expense of ${amount} captured for ${request.referenceNumber}.`,
    newValue: { amount, category: input.category, flags },
  });
  return { id: expenseRef.id, flags };
}

/** Soft-deletes a captured expense, keeping the record and the reason (control rule 51.15). */
export async function deleteTravelExpense(expenseId: string, actor: TravelActor, reason: string) {
  const me = requireActor(actor);
  if (!reason?.trim()) throw new TravelControlError('A reason is required to remove an expense.');
  const expenseRef = doc(db, TT_COLLECTIONS.expenses, expenseId);
  const snapshot = await getDoc(expenseRef);
  if (!snapshot.exists()) throw new TravelControlError('Expense not found.');
  const expense = snapshot.data() as TravelExpense;
  if (expense.claimed) throw new TravelControlError('This expense is already part of a claim and cannot be removed.');

  await updateDoc(expenseRef, { deleted: true, deletedBy: me.userId, deletedReason: reason.trim(), ...withUpdateAudit(me) });
  await logTravelAudit({
    actor: me, entityType: 'expense', entityId: expenseId, travelRequestId: expense.travelRequestId,
    action: 'Deleted', summary: `Expense of ${expense.amount} removed from ${expense.travelRequestNumber}.`, remarks: reason,
  });
}

/* ------------------------------------------------------------------------------------------------
 * Claim
 * ---------------------------------------------------------------------------------------------- */

/**
 * Builds a claim from a completed tour, snapshotting every unclaimed expense into an immutable
 * claim line and generating the DA line the employee should never have to compute.
 *
 * Each line records the policy ceiling that applied *at this moment* (`policyLimit`,
 * `policyAllowedAmount`), so a later entitlement revision can't retroactively change what a
 * historic claim was measured against. Company-paid bookings are pulled in as `paidByCompany`
 * lines: they make the tour's true cost visible on the statement and are deducted at settlement,
 * never reimbursed (control rule 51.12).
 */
export async function createClaimFromTour(
  travelRequestId: string,
  actor: TravelActor,
): Promise<{ id: string; referenceNumber: string; itemCount: number }> {
  const me = requireActor(actor);
  const [settings, entitlements, requestSnapshot] = await Promise.all([
    loadTravelSettings(me.organizationId),
    loadTravelEntitlements(me.organizationId),
    getDoc(doc(db, TT_COLLECTIONS.requests, travelRequestId)),
  ]);
  if (!requestSnapshot.exists()) throw new TravelControlError('Tour request not found.');
  const request = { id: requestSnapshot.id, ...requestSnapshot.data() } as TravelRequest;

  if (settings.general.requireApprovedTour && !['COMPLETED', 'CLAIM_PENDING'].includes(request.status)) {
    throw new TravelControlError('A claim can only be raised against a completed tour.');
  }
  if (request.claimId) throw new TravelControlError('A claim already exists for this tour.');

  const [expenseSnapshot, bookingSnapshot, advanceSnapshot] = await Promise.all([
    getDocs(query(collection(db, TT_COLLECTIONS.expenses), where('travelRequestId', '==', travelRequestId))),
    getDocs(query(collection(db, TT_COLLECTIONS.bookings), where('travelRequestId', '==', travelRequestId))),
    getDocs(query(collection(db, TT_COLLECTIONS.advances), where('travelRequestId', '==', travelRequestId))),
  ]);

  const expenses = expenseSnapshot.docs
    .map(entry => ({ id: entry.id, ...entry.data() }) as TravelExpense)
    .filter(expense => !expense.deleted && !expense.claimed);
  const companyBookings = bookingSnapshot.docs
    .map(entry => ({ id: entry.id, ...entry.data() }))
    .filter(booking => (booking as { paidByCompany?: boolean; cancelled?: boolean }).paidByCompany && !(booking as { cancelled?: boolean }).cancelled);
  const advancePaid = roundMoney(
    advanceSnapshot.docs.reduce((sum, entry) => sum + Number((entry.data() as TravelAdvance).paidAmount || 0), 0),
  );

  // The DA line the system owes the employee (spec section 19). Built here rather than captured so
  // it always reflects the actual journey window and the grade's rate.
  const daEntitlement = resolveEntitlement(entitlements, { grade: request.grade, cityClass: settings.general.defaultCityClass });
  const da = settings.allowances.autoCalculateDa
    ? calculateDailyAllowance({
        departureAt: request.departureAt,
        returnAt: request.returnAt,
        ratePerDay: daEntitlement?.daPerDay || 0,
        slabs: settings.allowances.daSlabs,
      })
    : null;

  type PendingItem = Omit<TravelClaimItem, 'id' | 'claimId'>;
  const buildItem = (source: {
    expenseId: string | null;
    expenseDate: string;
    category: ExpenseCategory;
    vendor?: string;
    description?: string;
    quantity?: number;
    amount: number;
    gstAmount?: number;
    cityClass?: CityClass;
    paidByCompany?: boolean;
    bookingId?: string | null;
    billReference?: string;
    fileHash?: string;
    flags?: string[];
  }): PendingItem => {
    const entitlement = resolveEntitlement(entitlements, {
      grade: request.grade,
      cityClass: source.cityClass || settings.general.defaultCityClass,
    });
    const evaluation = evaluateExpenseAgainstPolicy({
      category: source.category,
      claimedAmount: source.amount,
      entitlement,
      quantity: source.quantity,
      categoryCap: settings.allowances.categoryCaps?.[source.category] ?? null,
    });
    return {
      organizationId: me.organizationId,
      travelRequestId: request.id,
      expenseId: source.expenseId,
      expenseDate: source.expenseDate,
      category: source.category,
      vendor: source.vendor || '',
      description: source.description || '',
      quantity: source.quantity || 1,
      claimedAmount: evaluation.claimedAmount,
      gstAmount: roundMoney(source.gstAmount || 0),
      policyLimit: evaluation.limit,
      policyAllowedAmount: evaluation.allowedAmount,
      policyNote: evaluation.note,
      approvedAmount: null,
      disallowedAmount: 0,
      decision: 'PENDING',
      paidByCompany: !!source.paidByCompany,
      bookingId: source.bookingId || null,
      billReference: source.billReference || '',
      fileHash: source.fileHash || '',
      flags: source.flags || [],
      accountingHead: settings.accounting.categoryLedgers?.[source.category] || '',
      projectId: request.projectId || '',
      projectName: request.projectName || '',
      costCentre: request.costCentre || '',
    };
  };

  const items: PendingItem[] = [
    ...expenses.map(expense =>
      buildItem({
        expenseId: expense.id,
        expenseDate: expense.expenseDate,
        category: expense.category,
        vendor: expense.vendor,
        description: expense.description,
        quantity: expense.quantity,
        amount: expense.amount,
        gstAmount: expense.gstAmount,
        cityClass: expense.cityClass,
        billReference: expense.billReference,
        fileHash: expense.fileHash,
        flags: expense.flags,
      }),
    ),
    ...companyBookings.map(booking => {
      const record = booking as { id: string; bookingType: string; vendorName?: string; totalAmount?: number; invoiceNumber?: string; checkIn?: string; createdAt?: unknown };
      const category: ExpenseCategory =
        record.bookingType === 'Flight' ? 'Airfare'
        : record.bookingType === 'Hotel' ? 'Hotel'
        : record.bookingType === 'Train' ? 'Train'
        : record.bookingType === 'Bus' ? 'Bus' : 'Local Conveyance';
      return buildItem({
        expenseId: null,
        expenseDate: record.checkIn || request.departureDate,
        category,
        vendor: record.vendorName,
        description: `Company-paid ${record.bookingType.toLowerCase()} booking`,
        amount: Number(record.totalAmount || 0),
        paidByCompany: true,
        bookingId: record.id,
      });
    }),
  ];

  if (da && da.amount > 0) {
    items.push(
      buildItem({
        expenseId: null,
        expenseDate: request.returnDate,
        category: 'Daily Allowance',
        description: `${da.totalUnits} day(s) at ${da.ratePerDay}/day (${da.totalHours} hours travelled)`,
        quantity: Math.max(1, Math.ceil(da.totalUnits)),
        amount: da.amount,
      }),
    );
  }

  if (!items.length) throw new TravelControlError('There are no expenses to claim for this tour.');

  const summary = summarizeSettlement({ items, advancePaid });
  const financialYear = financialYearForTravelDate(new Date());

  const created = await runTransaction(db, async transaction => {
    const referenceNumber = await nextTravelNumber(transaction, {
      organizationId: me.organizationId,
      organizationName: me.organizationName,
      kind: 'claim',
      financialYear,
    });
    const claimRef = doc(collection(db, TT_COLLECTIONS.claims));
    const payload: Omit<TravelClaim, 'id'> = {
      organizationId: me.organizationId,
      referenceNumber,
      financialYear,
      travelRequestId: request.id,
      travelRequestNumber: request.referenceNumber,
      employeeId: request.employeeId,
      employeeUserId: request.employeeUserId,
      employeeName: request.employeeName,
      departmentId: request.departmentId || '',
      departmentName: request.departmentName || '',
      projectId: request.projectId || '',
      projectName: request.projectName || '',
      costCentre: request.costCentre || '',
      reportingManagerId: request.reportingManagerId || '',
      claimDate: new Date().toISOString().slice(0, 10),
      totalClaimed: summary.totalClaimed,
      totalApproved: summary.totalApproved,
      totalDisallowed: summary.totalDisallowed,
      companyPaid: summary.companyPaid,
      advancePaid: summary.advancePaid,
      netPayable: summary.payableToEmployee,
      netRecoverable: summary.recoverableFromEmployee,
      approvedEstimate: roundMoney(request.approvedAmount ?? request.estimate.total),
      status: 'DRAFT',
      itemCount: items.length,
      history: [],
      settlementId: null,
      paymentId: null,
      recoveryId: null,
      financePosted: false,
    };
    transaction.set(claimRef, { ...payload, ...withCreateAudit(me) });
    return { id: claimRef.id, referenceNumber };
  });

  // Items and the expense back-references are written outside the transaction: a tour can carry
  // more line items than a single transaction's document budget allows, and a batch keeps the
  // write atomic per chunk without capping how many bills a long tour may hold.
  const batch = writeBatch(db);
  for (const item of items) {
    batch.set(doc(collection(db, TT_COLLECTIONS.claimItems)), { ...item, claimId: created.id, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  }
  for (const expense of expenses) {
    batch.update(doc(db, TT_COLLECTIONS.expenses, expense.id), { claimed: true, claimId: created.id, updatedAt: serverTimestamp() });
  }
  batch.update(doc(db, TT_COLLECTIONS.requests, request.id), { claimId: created.id, status: 'SETTLEMENT_PENDING' satisfies TourStatus, updatedAt: serverTimestamp() });
  await batch.commit();

  await logTravelAudit({
    actor: me, entityType: 'claim', entityId: created.id, travelRequestId: request.id,
    action: 'Created', summary: `Claim ${created.referenceNumber} created with ${items.length} line(s) totalling ${summary.totalClaimed}.`,
    newValue: { totalClaimed: summary.totalClaimed, advancePaid: summary.advancePaid, itemCount: items.length },
  });
  return { ...created, itemCount: items.length };
}

/** Reads every line of a claim. */
export async function loadClaimItems(claimId: string): Promise<TravelClaimItem[]> {
  const snapshot = await getDocs(query(collection(db, TT_COLLECTIONS.claimItems), where('claimId', '==', claimId)));
  return snapshot.docs
    .map(entry => ({ id: entry.id, ...entry.data() }) as TravelClaimItem)
    .sort((a, b) => a.expenseDate.localeCompare(b.expenseDate) || a.category.localeCompare(b.category));
}

/**
 * Recomputes and writes a claim's denormalized totals from its lines.
 *
 * Called after every line-level change rather than computed on read, because the dashboard, the
 * approvals inbox and the reports all aggregate across claims and can't afford a sub-read per
 * claim. `summarizeSettlement` is the single source of the arithmetic, so the stored totals and
 * the settlement statement can never disagree.
 */
async function refreshClaimTotals(claimId: string, actor: TravelActor): Promise<TravelClaim> {
  const claimRef = doc(db, TT_COLLECTIONS.claims, claimId);
  const [claimSnapshot, items] = await Promise.all([getDoc(claimRef), loadClaimItems(claimId)]);
  if (!claimSnapshot.exists()) throw new TravelControlError('Claim not found.');
  const claim = { id: claimSnapshot.id, ...claimSnapshot.data() } as TravelClaim;
  const summary = summarizeSettlement({ items, advancePaid: claim.advancePaid });
  await updateDoc(claimRef, {
    totalClaimed: summary.totalClaimed,
    totalApproved: summary.totalApproved,
    totalDisallowed: summary.totalDisallowed,
    companyPaid: summary.companyPaid,
    netPayable: summary.payableToEmployee,
    netRecoverable: summary.recoverableFromEmployee,
    itemCount: items.length,
    ...withUpdateAudit(actor),
  });
  return { ...claim, ...summary, netPayable: summary.payableToEmployee, netRecoverable: summary.recoverableFromEmployee };
}

const assertClaimEditable = (claim: TravelClaim) => {
  if (LOCKED_CLAIM_STATUSES.includes(claim.status)) {
    throw new TravelControlError(`A ${claim.status} claim is financially locked and cannot be edited.`);
  }
};

/** Submits a DRAFT claim for verification. Lines are immutable from this point. */
export async function submitTravelClaim(claimId: string, actor: TravelActor): Promise<{ status: ClaimStatus }> {
  const me = requireActor(actor);
  const claimRef = doc(db, TT_COLLECTIONS.claims, claimId);
  const snapshot = await getDoc(claimRef);
  if (!snapshot.exists()) throw new TravelControlError('Claim not found.');
  const claim = { id: snapshot.id, ...snapshot.data() } as TravelClaim;
  if (!['DRAFT', 'CORRECTION_REQUIRED'].includes(claim.status)) {
    throw new TravelControlError(`A ${claim.status} claim cannot be submitted.`);
  }

  const settings = await loadTravelSettings(me.organizationId);
  if (settings.controls.requireExceptionReason) {
    const items = await loadClaimItems(claimId);
    const unexplained = items.filter(item => item.policyLimit != null && item.claimedAmount > item.policyLimit && !item.exceptionReason?.trim());
    if (unexplained.length) {
      throw new TravelControlError(
        `${unexplained.length} line(s) exceed entitlement and need an exception reason before submission: ${unexplained.map(item => item.category).join(', ')}.`,
      );
    }
  }

  const status: ClaimStatus = claim.reportingManagerId ? 'MANAGER_REVIEW' : 'FINANCE_REVIEW';
  await updateDoc(claimRef, { status, submittedAt: serverTimestamp(), correctionRemarks: '', ...withUpdateAudit(me) });
  await logTravelAudit({
    actor: me, entityType: 'claim', entityId: claimId, travelRequestId: claim.travelRequestId,
    action: 'Submitted', summary: `Claim ${claim.referenceNumber} submitted for ${status === 'MANAGER_REVIEW' ? 'manager' : 'finance'} review.`,
    oldValue: { status: claim.status }, newValue: { status },
  });
  return { status };
}

/**
 * Records a verification decision on one claim line.
 *
 * This is the function control rule 51.8 is really about: it writes `approvedAmount`,
 * `disallowedAmount` and `decision`, and it never touches `claimedAmount`. A reduction therefore
 * always leaves both figures on the record, which is what makes the "Claimed | Policy | Allowed |
 * Disallowed" view of spec section 22 honest and what lets an employee see why they were paid less
 * than they asked for.
 */
export async function verifyClaimItem(
  itemId: string,
  actor: TravelActor,
  input: { decision: VerificationDecision; approvedAmount?: number; remarks?: string; accountingHead?: string; costCentre?: string },
): Promise<{ claimId: string }> {
  const me = requireActor(actor);
  const itemRef = doc(db, TT_COLLECTIONS.claimItems, itemId);
  const itemSnapshot = await getDoc(itemRef);
  if (!itemSnapshot.exists()) throw new TravelControlError('Claim line not found.');
  const item = { id: itemSnapshot.id, ...itemSnapshot.data() } as TravelClaimItem;

  const claimSnapshot = await getDoc(doc(db, TT_COLLECTIONS.claims, item.claimId));
  if (!claimSnapshot.exists()) throw new TravelControlError('Claim not found.');
  const claim = { id: claimSnapshot.id, ...claimSnapshot.data() } as TravelClaim;
  assertClaimEditable(claim);
  if (!['SUBMITTED', 'MANAGER_REVIEW', 'FINANCE_REVIEW'].includes(claim.status)) {
    throw new TravelControlError(`A ${claim.status} claim is not under verification.`);
  }

  const approvedAmount = (() => {
    switch (input.decision) {
      case 'DISALLOWED':
      case 'BILL_REQUESTED':
        return 0;
      case 'ACCEPTED':
        return item.claimedAmount;
      case 'REDUCED': {
        const value = roundMoney(input.approvedAmount || 0);
        if (value <= 0) throw new TravelControlError('Enter the reduced amount to allow.');
        if (value > item.claimedAmount) throw new TravelControlError('The allowed amount cannot exceed the amount claimed.');
        return value;
      }
      default:
        throw new TravelControlError('Select a verification decision.');
    }
  })();

  if ((input.decision === 'REDUCED' || input.decision === 'DISALLOWED') && !input.remarks?.trim()) {
    throw new TravelControlError('A remark is required when reducing or disallowing a line.');
  }

  await updateDoc(itemRef, {
    // claimedAmount is deliberately absent from this update — see the function comment.
    approvedAmount,
    disallowedAmount: roundMoney(item.claimedAmount - approvedAmount),
    decision: input.decision,
    verifierRemarks: input.remarks || '',
    verifiedBy: me.userId,
    verifiedByName: me.userName,
    verifiedAt: serverTimestamp(),
    ...(input.accountingHead ? { accountingHead: input.accountingHead } : {}),
    ...(input.costCentre ? { costCentre: input.costCentre } : {}),
    updatedAt: serverTimestamp(),
  });
  await refreshClaimTotals(item.claimId, me);
  await logTravelAudit({
    actor: me, entityType: 'claimItem', entityId: itemId, travelRequestId: item.travelRequestId,
    action: `Verified — ${input.decision}`,
    summary: `${item.category} line on ${claim.referenceNumber}: claimed ${item.claimedAmount}, allowed ${approvedAmount}.`,
    oldValue: { approvedAmount: item.approvedAmount, decision: item.decision },
    newValue: { approvedAmount, decision: input.decision },
    remarks: input.remarks,
  });
  return { claimId: item.claimId };
}

/** Records the employee's justification for a line above entitlement (spec section 23). */
export async function setClaimItemException(itemId: string, actor: TravelActor, reason: string) {
  const me = requireActor(actor);
  if (!reason?.trim()) throw new TravelControlError('Enter the exception reason.');
  const itemRef = doc(db, TT_COLLECTIONS.claimItems, itemId);
  const snapshot = await getDoc(itemRef);
  if (!snapshot.exists()) throw new TravelControlError('Claim line not found.');
  const item = snapshot.data() as TravelClaimItem;
  await updateDoc(itemRef, { exceptionReason: reason.trim(), updatedAt: serverTimestamp() });
  await logTravelAudit({
    actor: me, entityType: 'claimItem', entityId: itemId, travelRequestId: item.travelRequestId,
    action: 'Exception reason recorded', summary: `Exception reason added for ${item.category} line.`, remarks: reason,
  });
}

/** Approves an exception, allowing the excess over entitlement to be paid. */
export async function approveClaimItemException(itemId: string, actor: TravelActor, remarks?: string) {
  const me = requireActor(actor);
  const itemRef = doc(db, TT_COLLECTIONS.claimItems, itemId);
  const snapshot = await getDoc(itemRef);
  if (!snapshot.exists()) throw new TravelControlError('Claim line not found.');
  const item = { id: snapshot.id, ...snapshot.data() } as TravelClaimItem;
  if (!item.exceptionReason?.trim()) throw new TravelControlError('This line has no exception reason to approve.');

  await updateDoc(itemRef, {
    exceptionApprovedBy: me.userId,
    exceptionApprovedByName: me.userName,
    exceptionApprovedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await logTravelAudit({
    actor: me, entityType: 'claimItem', entityId: itemId, travelRequestId: item.travelRequestId,
    action: 'Exception approved', summary: `Exception approved on ${item.category} line for ${item.claimedAmount}.`, remarks,
  });
}

/** Moves a manager-reviewed claim on to Finance. */
export async function completeManagerReview(claimId: string, actor: TravelActor, remarks?: string) {
  const me = requireActor(actor);
  const claimRef = doc(db, TT_COLLECTIONS.claims, claimId);
  const snapshot = await getDoc(claimRef);
  if (!snapshot.exists()) throw new TravelControlError('Claim not found.');
  const claim = { id: snapshot.id, ...snapshot.data() } as TravelClaim;
  if (claim.status !== 'MANAGER_REVIEW') throw new TravelControlError(`A ${claim.status} claim is not awaiting manager review.`);
  if (claim.employeeUserId === me.userId) throw new TravelControlError('You cannot verify your own claim.');

  await updateDoc(claimRef, {
    status: 'FINANCE_REVIEW' satisfies ClaimStatus,
    managerVerifiedBy: me.userId,
    managerVerifiedByName: me.userName,
    managerVerifiedAt: serverTimestamp(),
    ...withUpdateAudit(me),
  });
  await logTravelAudit({
    actor: me, entityType: 'claim', entityId: claimId, travelRequestId: claim.travelRequestId,
    action: 'Manager verified', summary: `Claim ${claim.referenceNumber} verified by manager and sent to Finance.`,
    oldValue: { status: claim.status }, newValue: { status: 'FINANCE_REVIEW' }, remarks,
  });
}

/** Returns a claim to the employee for correction. */
export async function returnClaimForCorrection(claimId: string, actor: TravelActor, remarks: string) {
  const me = requireActor(actor);
  if (!remarks?.trim()) throw new TravelControlError('Explain what the employee needs to correct.');
  const claimRef = doc(db, TT_COLLECTIONS.claims, claimId);
  const snapshot = await getDoc(claimRef);
  if (!snapshot.exists()) throw new TravelControlError('Claim not found.');
  const claim = { id: snapshot.id, ...snapshot.data() } as TravelClaim;
  assertClaimEditable(claim);

  await updateDoc(claimRef, {
    status: 'CORRECTION_REQUIRED' satisfies ClaimStatus,
    correctionRemarks: remarks.trim(),
    ...withUpdateAudit(me),
  });
  await logTravelAudit({
    actor: me, entityType: 'claim', entityId: claimId, travelRequestId: claim.travelRequestId,
    action: 'Returned for correction', summary: `Claim ${claim.referenceNumber} returned for correction.`,
    oldValue: { status: claim.status }, newValue: { status: 'CORRECTION_REQUIRED' }, remarks,
  });
}

export async function rejectTravelClaim(claimId: string, actor: TravelActor, reason: string) {
  const me = requireActor(actor);
  if (!reason?.trim()) throw new TravelControlError('A rejection reason is required.');
  const claimRef = doc(db, TT_COLLECTIONS.claims, claimId);
  const snapshot = await getDoc(claimRef);
  if (!snapshot.exists()) throw new TravelControlError('Claim not found.');
  const claim = { id: snapshot.id, ...snapshot.data() } as TravelClaim;
  assertClaimEditable(claim);

  await updateDoc(claimRef, { status: 'REJECTED' satisfies ClaimStatus, rejectionReason: reason.trim(), ...withUpdateAudit(me) });
  await logTravelAudit({
    actor: me, entityType: 'claim', entityId: claimId, travelRequestId: claim.travelRequestId,
    action: 'Rejected', summary: `Claim ${claim.referenceNumber} rejected.`, remarks: reason,
  });
}

/**
 * Final approval of a claim, which produces the settlement and whatever it implies.
 *
 * The three outcomes of spec section 21 are all handled here, in one transaction with the claim
 * update, so a claim can never end up APPROVED without the matching payment or recovery existing:
 *
 *   net > 0 → a TravelPayment in PENDING, claim → PAYMENT_PENDING
 *   net = 0 → nothing to move, claim → SETTLED
 *   net < 0 → a TravelRecovery in PENDING, claim → RECOVERY_PENDING
 *
 * Every unverified line is treated as accepted at its claimed amount by `summarizeSettlement`.
 * That's deliberate — `requireFullVerification` decides whether that's allowed at all, and when it
 * is (a small claim Finance waved through) the employee should be paid what they asked for rather
 * than nothing.
 */
export async function approveTravelClaim(
  claimId: string,
  actor: TravelActor,
  options: { remarks?: string; requireFullVerification?: boolean } = {},
): Promise<{ status: ClaimStatus; settlementId: string; paymentId: string | null; recoveryId: string | null }> {
  const me = requireActor(actor);
  const items = await loadClaimItems(claimId);
  if (!items.length) throw new TravelControlError('This claim has no lines to approve.');

  if (options.requireFullVerification !== false) {
    // BILL_REQUESTED counts as undecided, not as a decision: the verifier is still waiting for the
    // document, and approving the claim now would silently settle that line at zero.
    const pending = items.filter(item => item.decision === 'PENDING' || item.decision === 'BILL_REQUESTED');
    if (pending.length) {
      throw new TravelControlError(`${pending.length} line(s) are still unverified or awaiting a bill.`);
    }
  }
  // A line above entitlement can only be paid once someone has approved the exception.
  const unapprovedException = items.find(item =>
    item.policyLimit != null && (item.approvedAmount ?? item.claimedAmount) > item.policyLimit && !item.exceptionApprovedBy,
  );
  if (unapprovedException) {
    throw new TravelControlError(`The ${unapprovedException.category} line exceeds entitlement and needs exception approval before the claim can be approved.`);
  }

  const financialYear = financialYearForTravelDate(new Date());
  const claimRef = doc(db, TT_COLLECTIONS.claims, claimId);

  const result = await runTransaction(db, async transaction => {
    const claimSnapshot = await transaction.get(claimRef);
    if (!claimSnapshot.exists()) throw new TravelControlError('Claim not found.');
    const claim = { id: claimSnapshot.id, ...claimSnapshot.data() } as TravelClaim;
    if (!['MANAGER_REVIEW', 'FINANCE_REVIEW', 'SUBMITTED'].includes(claim.status)) {
      throw new TravelControlError(`A ${claim.status} claim cannot be approved.`);
    }
    if (claim.employeeUserId === me.userId) throw new TravelControlError('You cannot approve your own claim.');

    const summary = summarizeSettlement({ items, advancePaid: claim.advancePaid });

    /*
     * READ PHASE. Both document numbers are reserved before anything is written, because Firestore
     * requires every transaction read to precede every write — allocating the payment/recovery
     * number inline after the settlement write made this transaction fail outright.
     */
    const followUpKind: TravelDocKind | null =
      summary.payableToEmployee > 0 ? 'payment' : summary.recoverableFromEmployee > 0 ? 'recovery' : null;
    const settlementNumber = await reserveTravelNumber(transaction, {
      organizationId: me.organizationId, organizationName: me.organizationName, kind: 'settlement', financialYear,
    });
    const followUpNumber = followUpKind
      ? await reserveTravelNumber(transaction, {
          organizationId: me.organizationId, organizationName: me.organizationName, kind: followUpKind, financialYear,
        })
      : null;

    /* WRITE PHASE. Nothing above this line may write; nothing below it may read. */
    commitTravelNumber(transaction, settlementNumber);
    if (followUpNumber) commitTravelNumber(transaction, followUpNumber);

    const settlementRef = doc(collection(db, TT_COLLECTIONS.settlements));
    transaction.set(settlementRef, {
      organizationId: me.organizationId,
      referenceNumber: settlementNumber.number,
      financialYear,
      claimId,
      claimNumber: claim.referenceNumber,
      travelRequestId: claim.travelRequestId,
      travelRequestNumber: claim.travelRequestNumber,
      employeeId: claim.employeeId,
      employeeUserId: claim.employeeUserId,
      employeeName: claim.employeeName,
      totalClaimed: summary.totalClaimed,
      totalApproved: summary.totalApproved,
      totalDisallowed: summary.totalDisallowed,
      companyPaid: summary.companyPaid,
      advancePaid: summary.advancePaid,
      net: summary.net,
      payableToEmployee: summary.payableToEmployee,
      recoverableFromEmployee: summary.recoverableFromEmployee,
      outcome: summary.outcome,
      settledBy: me.userId,
      settledByName: me.userName,
      settledAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    });

    let paymentId: string | null = null;
    let recoveryId: string | null = null;
    let status: ClaimStatus = 'SETTLED';

    if (followUpKind === 'payment' && followUpNumber) {
      const paymentRef = doc(collection(db, TT_COLLECTIONS.payments));
      transaction.set(paymentRef, {
        organizationId: me.organizationId,
        referenceNumber: followUpNumber.number,
        financialYear,
        settlementId: settlementRef.id,
        claimId,
        travelRequestId: claim.travelRequestId,
        employeeId: claim.employeeId,
        employeeUserId: claim.employeeUserId,
        employeeName: claim.employeeName,
        amount: summary.payableToEmployee,
        status: 'PENDING',
        createdAt: serverTimestamp(),
      });
      paymentId = paymentRef.id;
      status = 'PAYMENT_PENDING';
    } else if (followUpKind === 'recovery' && followUpNumber) {
      const recoveryRef = doc(collection(db, TT_COLLECTIONS.recoveries));
      transaction.set(recoveryRef, {
        organizationId: me.organizationId,
        referenceNumber: followUpNumber.number,
        financialYear,
        settlementId: settlementRef.id,
        claimId,
        travelRequestId: claim.travelRequestId,
        employeeId: claim.employeeId,
        employeeUserId: claim.employeeUserId,
        employeeName: claim.employeeName,
        amount: summary.recoverableFromEmployee,
        recoveredAmount: 0,
        status: 'PENDING',
        createdAt: serverTimestamp(),
      });
      recoveryId = recoveryRef.id;
      status = 'RECOVERY_PENDING';
    }

    transaction.update(claimRef, {
      status,
      totalApproved: summary.totalApproved,
      totalDisallowed: summary.totalDisallowed,
      companyPaid: summary.companyPaid,
      netPayable: summary.payableToEmployee,
      netRecoverable: summary.recoverableFromEmployee,
      settlementId: settlementRef.id,
      paymentId,
      recoveryId,
      approvedBy: me.userId,
      approvedByName: me.userName,
      approvedAt: serverTimestamp(),
      ...withUpdateAudit(me),
    });

    return { status, settlementId: settlementRef.id, settlementNumber: settlementNumber.number, paymentId, recoveryId, claim, summary };
  });

  await logTravelAudit({
    actor: me, entityType: 'claim', entityId: claimId, travelRequestId: result.claim.travelRequestId,
    action: 'Approved',
    summary: `Claim ${result.claim.referenceNumber} approved — ${result.summary.outcome} (${result.summary.net}). Settlement ${result.settlementNumber}.`,
    newValue: { status: result.status, net: result.summary.net, outcome: result.summary.outcome },
    remarks: options.remarks,
  });
  return { status: result.status, settlementId: result.settlementId, paymentId: result.paymentId, recoveryId: result.recoveryId };
}

/* ------------------------------------------------------------------------------------------------
 * Reimbursement payment & recovery
 * ---------------------------------------------------------------------------------------------- */

/**
 * Records the reimbursement payment and settles the advance against the claim in one transaction.
 *
 * Settling the advance here rather than at claim approval matters: the advance is only truly
 * absorbed once the balancing payment has actually left the bank, and settling it earlier would
 * make an employee with a pending reimbursement look square with the company on the ageing report.
 */
export async function recordReimbursementPayment(
  paymentId: string,
  actor: TravelActor,
  input: {
    paymentDate: string;
    mode: AdvancePaymentMode;
    bankAccount?: string;
    bankName?: string;
    transactionReference?: string;
    voucherNumber?: string;
  },
) {
  const me = requireActor(actor);
  if (!input.paymentDate) throw new TravelControlError('Enter the payment date.');
  if (ADVANCE_REFERENCE_REQUIRED_MODES.includes(input.mode) && !input.transactionReference?.trim()) {
    throw new TravelControlError(`A transaction reference (UTR) is required for a ${input.mode} payment.`);
  }

  const paymentRef = doc(db, TT_COLLECTIONS.payments, paymentId);
  const paymentSnapshot = await getDoc(paymentRef);
  if (!paymentSnapshot.exists()) throw new TravelControlError('Payment not found.');
  const payment = paymentSnapshot.data() as { claimId: string; travelRequestId: string; amount: number; status: string; referenceNumber: string };
  if (payment.status !== 'PENDING') throw new TravelControlError(`A ${payment.status} payment cannot be paid again.`);

  const advanceSnapshot = await getDocs(query(
    collection(db, TT_COLLECTIONS.advances),
    where('travelRequestId', '==', payment.travelRequestId),
  ));

  await runTransaction(db, async transaction => {
    transaction.update(paymentRef, {
      status: 'PAID',
      paymentDate: input.paymentDate,
      mode: input.mode,
      bankAccount: input.bankAccount || '',
      bankName: input.bankName || '',
      transactionReference: input.transactionReference || '',
      voucherNumber: input.voucherNumber || '',
      paidBy: me.userId,
      paidByName: me.userName,
      ...withUpdateAudit(me),
    });
    transaction.update(doc(db, TT_COLLECTIONS.claims, payment.claimId), {
      status: 'PAID' satisfies ClaimStatus,
      ...withUpdateAudit(me),
    });
    for (const entry of advanceSnapshot.docs) {
      const advance = entry.data() as TravelAdvance;
      const outstanding = roundMoney(advance.paidAmount || 0) - roundMoney(advance.settledAmount || 0);
      if (outstanding <= 0) continue;
      transaction.update(entry.ref, {
        settledAmount: roundMoney(Number(advance.settledAmount || 0) + outstanding),
        status: 'SETTLED',
        ...withUpdateAudit(me),
      });
    }
  });

  await logTravelAudit({
    actor: me, entityType: 'payment', entityId: paymentId, travelRequestId: payment.travelRequestId,
    action: 'Paid', summary: `Reimbursement ${payment.referenceNumber} of ${payment.amount} paid by ${input.mode}.`,
    newValue: { amount: payment.amount, mode: input.mode, transactionReference: input.transactionReference || '' },
  });
}

/**
 * Records money coming back from an employee against a recovery (spec section 25).
 *
 * Recoveries can arrive in parts (a payroll deduction spread over two months), so the amount
 * accumulates and the status only reaches RECOVERED once the full figure is in. The advance is
 * settled at that point, for the same reason payments settle it: until the money is actually back,
 * the employee is still holding company funds.
 */
export async function recordRecovery(
  recoveryId: string,
  actor: TravelActor,
  input: { amount: number; mode: RecoveryMode; receivedOn: string; transactionReference?: string; payrollPeriod?: string; adjustedAgainstClaimId?: string; remarks?: string },
) {
  const me = requireActor(actor);
  const amount = roundMoney(input.amount);
  if (amount <= 0) throw new TravelControlError('Enter the recovered amount.');
  if (!input.receivedOn) throw new TravelControlError('Enter the date the amount was recovered.');
  if (input.mode === 'Payroll Deduction' && !input.payrollPeriod?.trim()) {
    throw new TravelControlError('Specify the payroll period for a payroll deduction.');
  }

  const recoveryRef = doc(db, TT_COLLECTIONS.recoveries, recoveryId);
  const result = await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(recoveryRef);
    if (!snapshot.exists()) throw new TravelControlError('Recovery not found.');
    const recovery = snapshot.data() as { amount: number; recoveredAmount: number; status: string; claimId: string; travelRequestId: string; referenceNumber: string };
    if (['RECOVERED', 'WAIVED'].includes(recovery.status)) throw new TravelControlError('This recovery is already closed.');

    const recovered = roundMoney(Number(recovery.recoveredAmount || 0) + amount);
    if (recovered > roundMoney(recovery.amount)) {
      throw new TravelControlError(`Recovering ${amount} would exceed the outstanding recovery of ${roundMoney(recovery.amount - Number(recovery.recoveredAmount || 0))}.`);
    }
    const fullyRecovered = recovered >= roundMoney(recovery.amount);

    transaction.update(recoveryRef, {
      recoveredAmount: recovered,
      status: fullyRecovered ? 'RECOVERED' : 'PARTIALLY_RECOVERED',
      mode: input.mode,
      receivedOn: input.receivedOn,
      transactionReference: input.transactionReference || '',
      payrollPeriod: input.payrollPeriod || '',
      adjustedAgainstClaimId: input.adjustedAgainstClaimId || null,
      remarks: input.remarks || '',
      ...withUpdateAudit(me),
    });
    if (fullyRecovered) {
      transaction.update(doc(db, TT_COLLECTIONS.claims, recovery.claimId), { status: 'SETTLED' satisfies ClaimStatus, ...withUpdateAudit(me) });
    }
    return { recovery, fullyRecovered, recovered };
  });

  // Advance settlement happens after the transaction because the advances have to be queried, and a
  // transaction can't run a query. A partial recovery leaves the advance open on purpose.
  if (result.fullyRecovered) {
    const advanceSnapshot = await getDocs(query(
      collection(db, TT_COLLECTIONS.advances),
      where('travelRequestId', '==', result.recovery.travelRequestId),
    ));
    const batch = writeBatch(db);
    for (const entry of advanceSnapshot.docs) {
      const advance = entry.data() as TravelAdvance;
      const outstanding = roundMoney(advance.paidAmount || 0) - roundMoney(advance.settledAmount || 0);
      if (outstanding <= 0) continue;
      batch.update(entry.ref, { settledAmount: roundMoney(Number(advance.settledAmount || 0) + outstanding), status: 'SETTLED', updatedAt: serverTimestamp() });
    }
    await batch.commit();
  }

  await logTravelAudit({
    actor: me, entityType: 'recovery', entityId: recoveryId, travelRequestId: result.recovery.travelRequestId,
    action: result.fullyRecovered ? 'Fully recovered' : 'Partially recovered',
    summary: `${amount} recovered against ${result.recovery.referenceNumber} by ${input.mode}.`,
    newValue: { recoveredAmount: result.recovered, mode: input.mode }, remarks: input.remarks,
  });
}

/* ------------------------------------------------------------------------------------------------
 * Closure
 * ---------------------------------------------------------------------------------------------- */

/**
 * Gathers everything the closure gate needs and reports what's still outstanding, without writing.
 * The tour detail page calls this to render the checklist; `closeTour` calls it to decide.
 */
export async function evaluateTourClosureState(travelRequestId: string) {
  const [requestSnapshot, advanceSnapshot, claimSnapshot] = await Promise.all([
    getDoc(doc(db, TT_COLLECTIONS.requests, travelRequestId)),
    getDocs(query(collection(db, TT_COLLECTIONS.advances), where('travelRequestId', '==', travelRequestId))),
    getDocs(query(collection(db, TT_COLLECTIONS.claims), where('travelRequestId', '==', travelRequestId))),
  ]);
  if (!requestSnapshot.exists()) throw new TravelControlError('Tour request not found.');
  const request = { id: requestSnapshot.id, ...requestSnapshot.data() } as TravelRequest;
  const claim = claimSnapshot.docs.map(entry => ({ id: entry.id, ...entry.data() }) as TravelClaim)[0];

  const advanceOutstanding = roundMoney(
    advanceSnapshot.docs.reduce((sum, entry) => {
      const advance = entry.data() as TravelAdvance;
      if (['REJECTED', 'CANCELLED'].includes(advance.status)) return sum;
      return sum + Math.max(0, roundMoney(advance.paidAmount || 0) - roundMoney(advance.settledAmount || 0));
    }, 0),
  );

  const [paymentSnapshot, recoverySnapshot] = await Promise.all([
    claim?.paymentId ? getDoc(doc(db, TT_COLLECTIONS.payments, claim.paymentId)) : Promise.resolve(null),
    claim?.recoveryId ? getDoc(doc(db, TT_COLLECTIONS.recoveries, claim.recoveryId)) : Promise.resolve(null),
  ]);
  const payment = paymentSnapshot?.exists() ? (paymentSnapshot.data() as { amount: number; status: string }) : null;
  const recovery = recoverySnapshot?.exists() ? (recoverySnapshot.data() as { amount: number; recoveredAmount: number; status: string }) : null;

  const readiness = evaluateTourClosure({
    travelCompleted: ['COMPLETED', 'CLAIM_PENDING', 'SETTLEMENT_PENDING', 'CLOSED'].includes(request.status),
    claimSubmitted: !!claim && claim.status !== 'DRAFT',
    claimApproved: !!claim && ['APPROVED', 'PAYMENT_PENDING', 'PAID', 'RECOVERY_PENDING', 'SETTLED'].includes(claim.status),
    advanceOutstanding,
    recoveryOutstanding: recovery && recovery.status !== 'WAIVED' ? roundMoney(recovery.amount - (recovery.recoveredAmount || 0)) : 0,
    reimbursementOutstanding: payment && payment.status === 'PENDING' ? roundMoney(payment.amount) : 0,
    financePosted: !!claim?.financePosted,
  });
  return { request, claim, readiness, advanceOutstanding };
}

/**
 * Closes a tour, but only once every component of spec section 26 is genuinely done. Refuses with
 * the full remaining checklist rather than one blocker at a time, so the user can see what's left
 * in one attempt.
 */
export async function closeTour(travelRequestId: string, actor: TravelActor, remarks?: string) {
  const me = requireActor(actor);
  const state = await evaluateTourClosureState(travelRequestId);
  if (!state.readiness.ready) {
    throw new TravelControlError(`This tour cannot be closed yet:\n• ${state.readiness.blockers.join('\n• ')}`);
  }
  await updateDoc(doc(db, TT_COLLECTIONS.requests, travelRequestId), {
    status: 'CLOSED' satisfies TourStatus,
    ...withUpdateAudit(me),
  });
  await logTravelAudit({
    actor: me, entityType: 'request', entityId: travelRequestId, travelRequestId,
    action: 'Closed', summary: `Tour ${state.request.referenceNumber} closed.`,
    oldValue: { status: state.request.status }, newValue: { status: 'CLOSED' }, remarks,
  });
}

/**
 * Marks the accounting entry posted for a claim, which is the last closure prerequisite.
 * Phase 1 records the fact and the voucher; Phase 2 posts the actual journal to the project cost
 * ledger (spec sections 34 and 36).
 */
export async function markClaimFinancePosted(claimId: string, actor: TravelActor, input: { voucherNumber?: string; remarks?: string } = {}) {
  const me = requireActor(actor);
  const claimRef = doc(db, TT_COLLECTIONS.claims, claimId);
  const snapshot = await getDoc(claimRef);
  if (!snapshot.exists()) throw new TravelControlError('Claim not found.');
  const claim = { id: snapshot.id, ...snapshot.data() } as TravelClaim;
  if (!['PAID', 'SETTLED'].includes(claim.status)) {
    throw new TravelControlError('Only a paid or settled claim can be posted to accounts.');
  }

  await updateDoc(claimRef, { financePosted: true, financePostedAt: serverTimestamp(), ...withUpdateAudit(me) });
  await logTravelAudit({
    actor: me, entityType: 'claim', entityId: claimId, travelRequestId: claim.travelRequestId,
    action: 'Finance posted', summary: `Claim ${claim.referenceNumber} posted to accounts.`,
    newValue: { voucherNumber: input.voucherNumber || '' }, remarks: input.remarks,
  });
}

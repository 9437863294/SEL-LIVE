'use client';

import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Transaction,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { withCreateAudit, withUpdateAudit, type AuditActor } from '@/lib/audit-fields';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { dispatchNotification } from '@/lib/notifications';
import {
  DEFAULT_HR_SETTINGS,
  HR_COLLECTIONS,
  annualManpowerCost,
  canReleaseOffer,
  canReviseFeedback,
  ctcIncreasePercent,
  deriveRecruitingStatus,
  evaluateCtcAgainstBand,
  evaluateRequirementClosure,
  evaluateRequirementSla,
  evaluateStageMove,
  financialYearForHrDate,
  hrCurrency,
  hrDocumentNumber,
  HR_APPROVAL_STAGE_LABELS,
  interviewFeedbackScore,
  isRecruitingStatus,
  isTerminalRequirementStatus,
  LIVE_OFFER_STATUSES,
  PIPELINE_STAGES,
  REPLACEMENT_REQUIREMENT_TYPES,
  requirementStatusForStage,
  resolveDueEscalations,
  resolveRequirementApprovalChain,
  resolveStageApprovers,
  roundMoney,
  stageForScreeningResult,
  summarizeDocumentChecklist,
  summarizePanelFeedback,
  summarizeRequirementFill,
  type ApplicationStage,
  type ApprovalAction,
  type Candidate,
  type CandidateApplication,
  type CompensationApproval,
  type DocumentVerificationStatus,
  type HrApprovalStage,
  type HrEntityType,
  type HrOffer,
  type HrRequirement,
  type HrSettings,
  type Interview,
  type InterviewFeedback,
  type InterviewRatings,
  type InterviewRecommendation,
  type JoiningRecord,
  type PreJoiningDocument,
  type RequirementApprovalContext,
  type RequirementHoldReason,
  type RequirementPriority,
  type RequirementStatus,
  type ScreeningRecord,
  type ScreeningResult,
  type SelectionProposal,
  type StageApproverContext,
} from '@/lib/hr-requirement';
import type { HrDocKind } from '@/lib/hr-policy';

/**
 * Write-side service for HR Requirement Management.
 *
 * Every state transition lives here rather than in the component that triggers it, for the same
 * three reasons the travel module gives: the control rules of spec section 63 have to hold whichever
 * screen (or the mobile client, or the SLA cron) initiates the change; requirement and offer numbers
 * must be allocated inside a transaction so two simultaneous submissions cannot share a sequence;
 * and every transition owes an activity entry, which is far easier to guarantee in one module than
 * across a hundred call sites.
 *
 * Uses the Firestore *client* SDK — as `tour-travel-service.ts` and `bank-guarantee-service.ts` do —
 * so these functions run under the signed-in user's security rules. The escalation cron of section
 * 41 needs Admin-SDK equivalents of `evaluateRequirementEscalations` and `expireStaleOffers`.
 */

export interface HrActor extends AuditActor {
  userId: string;
  userName: string;
  organizationId: string;
  organizationName?: string;
}

/** Thrown for a rule violation the user can act on, so callers can show the message verbatim. */
export class HrControlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HrControlError';
  }
}

const requireActor = (actor: HrActor | null | undefined): HrActor => {
  if (!actor?.userId || !actor.organizationId) {
    throw new HrControlError('You must be signed in to perform this action.');
  }
  return actor;
};

const todayIso = () => new Date().toISOString().slice(0, 10);

/* ------------------------------------------------------------------------------------------------
 * Settings
 * ---------------------------------------------------------------------------------------------- */

/**
 * Loads an organisation's HR settings, deep-merged over the defaults.
 *
 * Merged one level into each section rather than spread wholesale, so a settings document saved
 * before an option existed resolves that option to its default instead of `undefined` — which is
 * what would otherwise turn a missing `sla.pauseOnHold` into a silently un-paused clock.
 */
export async function loadHrSettings(organizationId: string): Promise<HrSettings> {
  const snapshot = await getDoc(doc(db, HR_COLLECTIONS.settings, organizationId));
  const saved = snapshot.exists() ? (snapshot.data() as Partial<HrSettings>) : {};
  const base = DEFAULT_HR_SETTINGS;
  return {
    ...base,
    ...saved,
    organizationId,
    general: { ...base.general, ...(saved.general || {}) },
    approvals: { ...base.approvals, ...(saved.approvals || {}) },
    sla: { ...base.sla, ...(saved.sla || {}) },
    compensation: { ...base.compensation, ...(saved.compensation || {}) },
    offers: { ...base.offers, ...(saved.offers || {}) },
    documents: { ...base.documents, ...(saved.documents || {}) },
    interviews: { ...base.interviews, ...(saved.interviews || {}) },
    notifications: { ...base.notifications, ...(saved.notifications || {}) },
    referrals: { ...base.referrals, ...(saved.referrals || {}) },
    masters: { ...base.masters, ...(saved.masters || {}) },
  };
}

export async function saveHrSettings(
  organizationId: string,
  patch: Partial<HrSettings>,
  actor: HrActor,
): Promise<void> {
  const acting = requireActor(actor);
  await setDoc(
    doc(db, HR_COLLECTIONS.settings, organizationId),
    { ...patch, organizationId, ...withUpdateAudit(acting) },
    { merge: true },
  );
  await logHrActivity({
    actor: acting,
    entityType: 'settings',
    entityId: organizationId,
    action: 'Settings updated',
    summary: `Updated HR settings: ${Object.keys(patch).join(', ') || 'no sections'}`,
    newValue: patch as Record<string, unknown>,
  });
}

/** The CTC band for a grade, from the grade master (spec section 9). */
export function ctcBandForGrade(settings: HrSettings, grade: string | undefined): { min: number; max: number } {
  const band = (settings.masters.ctcBands || []).find(row => row.grade === grade);
  return { min: Number(band?.min) || 0, max: Number(band?.max) || 0 };
}

export const isSeniorManagementGrade = (settings: HrSettings, grade: string | undefined) =>
  Boolean(grade) && (settings.masters.seniorManagementGrades || []).includes(grade as string);

/* ------------------------------------------------------------------------------------------------
 * Document numbering (control rule 63.1)
 * ---------------------------------------------------------------------------------------------- */

const counterKey = (organizationId: string, kind: HrDocKind, financialYear: string) =>
  `${organizationId}__${kind}__${financialYear}`.replace(/\//g, '_');

interface NumberParams {
  organizationId: string;
  kind: HrDocKind;
  financialYear: string;
}

interface ReservedNumber {
  number: string;
  counterRef: ReturnType<typeof doc>;
  sequence: number;
  params: NumberParams;
}

/**
 * Reads the next sequence for a document kind and formats its number *without* writing anything.
 *
 * Split from the increment because Firestore requires every read in a transaction to precede every
 * write. A caller needing two numbers — accepting an offer allocates a joining record while reading
 * the offer — must reserve both up front and only then start writing.
 */
async function reserveHrNumber(transaction: Transaction, params: NumberParams): Promise<ReservedNumber> {
  const counterRef = doc(db, HR_COLLECTIONS.counters, counterKey(params.organizationId, params.kind, params.financialYear));
  const counter = await transaction.get(counterRef);
  const sequence = Number(counter.data()?.nextSequence || 1);
  return {
    number: hrDocumentNumber({ kind: params.kind, financialYear: params.financialYear, sequence }),
    counterRef,
    sequence,
    params,
  };
}

/** Commits a reserved sequence. Must be called in the transaction's write phase. */
function commitHrNumber(transaction: Transaction, reserved: ReservedNumber) {
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

async function nextHrNumber(transaction: Transaction, params: NumberParams): Promise<string> {
  const reserved = await reserveHrNumber(transaction, params);
  commitHrNumber(transaction, reserved);
  return reserved.number;
}

/**
 * Allocates a number outside a transaction, for records where a collision is recoverable and the
 * caller is not already inside one (candidates, referrals, agencies). Requirements, offers and
 * joinings never use this path.
 */
async function allocateHrNumber(organizationId: string, kind: HrDocKind): Promise<string> {
  const financialYear = financialYearForHrDate();
  return runTransaction(db, transaction => nextHrNumber(transaction, { organizationId, kind, financialYear }));
}

/**
 * Allocates the next employee code (spec section 36).
 *
 * Deliberately not part of the `HR-…` document series: employee codes look like `E10023`, they are
 * read aloud, printed on ID cards and typed into attendance machines, and they run for the life of
 * the organisation rather than resetting each financial year. So this uses its own perpetual
 * counter, seeded at the configured start.
 */
async function nextEmployeeCode(
  transaction: Transaction,
  organizationId: string,
  format: { prefix: string; start: number; width: number },
): Promise<string> {
  const counterRef = doc(db, HR_COLLECTIONS.counters, `${organizationId}__employeeCode`);
  const counter = await transaction.get(counterRef);
  const sequence = Number(counter.data()?.nextSequence || format.start || 1);
  transaction.set(
    counterRef,
    { organizationId, kind: 'employeeCode', nextSequence: sequence + 1, updatedAt: serverTimestamp() },
    { merge: true },
  );
  return `${format.prefix || 'E'}${String(sequence).padStart(Math.max(1, format.width || 5), '0')}`;
}

/* ------------------------------------------------------------------------------------------------
 * Activity log (spec section 57, control rule 63.10)
 * ---------------------------------------------------------------------------------------------- */

/**
 * Appends an activity entry. Awaited internally rather than fired and forgotten, because a
 * transition that succeeded while its audit entry failed is worse than a visible error.
 *
 * `requirementId` is stamped on child records too, so a requirement's Activity tab is one query
 * instead of a fan-out across nine collections.
 */
export async function logHrActivity(input: {
  actor: HrActor;
  entityType: HrEntityType;
  entityId: string;
  requirementId?: string | null;
  action: string;
  summary: string;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  remarks?: string;
}): Promise<void> {
  await addDoc(collection(db, HR_COLLECTIONS.activities), {
    organizationId: input.actor.organizationId,
    entityType: input.entityType,
    entityId: input.entityId,
    requirementId: input.requirementId ?? null,
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
 * Notifications (spec section 49)
 * ---------------------------------------------------------------------------------------------- */

/**
 * Sends one of section 49's notifications, if the organisation has that event switched on.
 *
 * Deliberately never awaited by the transition that triggers it and never allowed to throw:
 * `dispatchNotification` swallows its own errors, and a requirement that was approved but whose
 * notification failed must stay approved. The settings flag is checked here rather than at each call
 * site so that switching an event off in settings actually switches it off everywhere.
 */
async function notifyHr(input: {
  event: keyof HrSettings['notifications'];
  settings: HrSettings;
  recipients: { userIds?: Array<string | undefined>; roles?: string[] };
  title: string;
  body: string;
  link?: string;
  itemId?: string;
  itemRef?: string;
  severity?: 'INFO' | 'WARNING' | 'CRITICAL';
  organizationId: string;
}): Promise<void> {
  if (!input.settings.notifications[input.event]) return;
  const userIds = Array.from(new Set((input.recipients.userIds || []).filter((id): id is string => Boolean(id))));
  if (userIds.length === 0 && !input.recipients.roles?.length) return;

  await dispatchNotification(
    { userIds, roles: input.recipients.roles },
    {
      type: 'record_assigned',
      module: ACTIVITY_MODULES.HR_RECRUITMENT,
      title: input.title,
      body: input.body,
      link: input.link,
      itemId: input.itemId,
      itemRef: input.itemRef,
      severity: input.severity || 'INFO',
      organizationId: input.organizationId,
    },
  );
}

/** Roles that stand in for the HR-side escalation audiences of section 41. */
const ESCALATION_ROLES: Record<string, string[]> = {
  HR_MANAGER: ['HR Manager'],
  HR_HEAD: ['HR Head'],
  DIRECTOR: ['Director', 'Director HR', 'MD', 'ED'],
};

/* ------------------------------------------------------------------------------------------------
 * Loaders
 * ---------------------------------------------------------------------------------------------- */

const docsFor = async <T>(collectionName: string, organizationId: string): Promise<T[]> => {
  const snapshot = await getDocs(query(collection(db, collectionName), where('organizationId', '==', organizationId)));
  return snapshot.docs.map(entry => ({ id: entry.id, ...entry.data() }) as T);
};

export const loadRequirements = (organizationId: string) => docsFor<HrRequirement>(HR_COLLECTIONS.requirements, organizationId);
export const loadCandidates = (organizationId: string) => docsFor<Candidate>(HR_COLLECTIONS.candidates, organizationId);
export const loadManpowerPlans = (organizationId: string) => docsFor(HR_COLLECTIONS.manpowerPlans, organizationId);

export async function loadRequirement(requirementId: string): Promise<HrRequirement | null> {
  const snapshot = await getDoc(doc(db, HR_COLLECTIONS.requirements, requirementId));
  return snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as HrRequirement) : null;
}

export async function loadApplicationsForRequirement(requirementId: string): Promise<CandidateApplication[]> {
  const snapshot = await getDocs(
    query(collection(db, HR_COLLECTIONS.applications), where('requirementId', '==', requirementId)),
  );
  return snapshot.docs.map(entry => ({ id: entry.id, ...entry.data() }) as CandidateApplication);
}

export async function loadApplicationsForCandidate(candidateId: string): Promise<CandidateApplication[]> {
  const snapshot = await getDocs(
    query(collection(db, HR_COLLECTIONS.applications), where('candidateId', '==', candidateId)),
  );
  return snapshot.docs.map(entry => ({ id: entry.id, ...entry.data() }) as CandidateApplication);
}

export async function loadRequirementActivity(requirementId: string) {
  const snapshot = await getDocs(
    query(
      collection(db, HR_COLLECTIONS.activities),
      where('requirementId', '==', requirementId),
      orderBy('createdAt', 'desc'),
    ),
  );
  return snapshot.docs.map(entry => ({ id: entry.id, ...entry.data() }));
}

/* ------------------------------------------------------------------------------------------------
 * Requirement creation and editing (spec sections 5–11)
 * ---------------------------------------------------------------------------------------------- */

export type RequirementInput = Omit<
  HrRequirement,
  | 'id'
  | 'organizationId'
  | 'requirementNumber'
  | 'status'
  | 'createdAt'
  | 'createdBy'
  | 'createdByName'
  | 'updatedAt'
  | 'updatedBy'
  | 'updatedByName'
>;

function validateRequirementInput(input: RequirementInput, settings: HrSettings) {
  if (!input.departmentId) throw new HrControlError('Select the department raising this requirement.');
  if (!input.designation?.trim()) throw new HrControlError('Select the designation.');
  if (!input.jobTitle?.trim()) throw new HrControlError('Enter the job title.');
  if (!input.grade?.trim()) throw new HrControlError('Select the grade.');
  if (!input.requestedQuantity || input.requestedQuantity < 1) {
    throw new HrControlError('Enter how many positions are required.');
  }
  if (!input.employmentType) throw new HrControlError('Select the employment type.');
  if (!input.requiredJoiningDate) throw new HrControlError('Enter the required joining date.');
  if (!input.qualification?.trim()) throw new HrControlError('Enter the minimum qualification.');
  if (input.minExperienceYears === undefined || input.minExperienceYears === null) {
    throw new HrControlError('Enter the minimum experience required.');
  }
  if (
    input.maxExperienceYears !== undefined &&
    Number(input.maxExperienceYears) > 0 &&
    Number(input.maxExperienceYears) < Number(input.minExperienceYears)
  ) {
    throw new HrControlError('Maximum experience cannot be less than the minimum.');
  }

  // Control rule 63.11 — a replacement must name who is being replaced.
  if (REPLACEMENT_REQUIREMENT_TYPES.includes(input.requirementType) && !input.replacement?.employeeId) {
    throw new HrControlError('Select the employee being replaced.');
  }

  // Spec section 10 — headcount-adding requirements owe a justification.
  if (settings.general.requireJustificationForNewPositions) {
    const adding = ['New Position', 'Additional Manpower', 'Expansion', 'Management Requirement'];
    if (adding.includes(input.requirementType) && !input.justification?.businessJustification?.trim()) {
      throw new HrControlError('A business justification is required for a new position.');
    }
  }

  if (input.requirementType === 'Emergency Requirement' && !settings.general.allowEmergencyRequirements) {
    throw new HrControlError('Emergency requirements are disabled for this organisation.');
  }

  // Spec section 7 — a gender requirement has to be justified where it is stated at all.
  if (input.genderRequirement && input.genderRequirement !== 'Any' && !input.genderRequirementJustification?.trim()) {
    throw new HrControlError('State the occupational justification for a gender-specific requirement.');
  }
}

/**
 * Creates a requirement in DRAFT with its permanent number (spec section 5).
 *
 * The number is allocated at creation rather than at submission so the requester can quote it while
 * gathering attachments and approvals off-system — an EPC requisition routinely gets discussed
 * before it is submitted, and a draft nobody can refer to gets re-created instead of finished.
 */
export async function createRequirement(
  input: RequirementInput,
  actor: HrActor,
): Promise<{ id: string; requirementNumber: string }> {
  const acting = requireActor(actor);
  const settings = await loadHrSettings(acting.organizationId);
  validateRequirementInput(input, settings);

  const financialYear = financialYearForHrDate(new Date(input.requirementDate || todayIso()));
  const band = ctcBandForGrade(settings, input.grade);
  const bandCheck = evaluateCtcAgainstBand({
    proposedCtc: Number(input.budget?.expectedCtc) || 0,
    bandMin: input.budget?.bandMin ?? band.min,
    bandMax: input.budget?.bandMax ?? band.max,
    tolerancePercent: settings.compensation.tolerancePercent,
  });

  return runTransaction(db, async transaction => {
    const requirementNumber = await nextHrNumber(transaction, {
      organizationId: acting.organizationId,
      kind: 'requirement',
      financialYear,
    });

    const ref = doc(collection(db, HR_COLLECTIONS.requirements));
    transaction.set(ref, {
      ...input,
      organizationId: acting.organizationId,
      requirementNumber,
      requirementDate: input.requirementDate || todayIso(),
      status: 'DRAFT' satisfies RequirementStatus,
      budget: {
        ...(input.budget || {}),
        bandMin: input.budget?.bandMin ?? band.min,
        bandMax: input.budget?.bandMax ?? band.max,
        ctcAboveBand: !bandCheck.withinBand && bandCheck.varianceAmount > 0,
        ctcVariancePercent: bandCheck.variancePercent,
      },
      applicationCount: 0,
      screeningCount: 0,
      interviewingCount: 0,
      selectedCount: 0,
      offeredCount: 0,
      offerAcceptedCount: 0,
      joinedCount: 0,
      cancelledPositions: 0,
      slaTargetDays: settings.sla.targets[input.priority as RequirementPriority] || settings.sla.targets.Normal,
      slaHeldDays: 0,
      escalationsSent: [],
      ...withCreateAudit(acting),
    });

    return { id: ref.id, requirementNumber };
  }).then(async result => {
    await logHrActivity({
      actor: acting,
      entityType: 'requirement',
      entityId: result.id,
      requirementId: result.id,
      action: 'Requirement created',
      summary: `Created ${result.requirementNumber} — ${input.requestedQuantity} × ${input.designation}`,
      newValue: { designation: input.designation, quantity: input.requestedQuantity, type: input.requirementType },
    });
    return result;
  });
}

/**
 * Edits a requirement.
 *
 * Only a DRAFT or sent-back requisition is freely editable. After approval the approved quantity is
 * frozen (control rule 63.3): scope comes down through cancelling positions or partial closure, so
 * that "what was approved" stays answerable for the rest of the requirement's life.
 */
export async function updateRequirement(
  requirementId: string,
  patch: Partial<RequirementInput>,
  actor: HrActor,
): Promise<void> {
  const acting = requireActor(actor);
  const existing = await loadRequirement(requirementId);
  if (!existing) throw new HrControlError('Requirement not found.');
  if (isTerminalRequirementStatus(existing.status)) {
    throw new HrControlError('A closed, cancelled or filled requirement cannot be edited.');
  }

  const editableStatuses: RequirementStatus[] = ['DRAFT', 'REJECTED'];
  const freelyEditable = editableStatuses.includes(existing.status);

  if (!freelyEditable) {
    if (patch.requestedQuantity !== undefined && patch.requestedQuantity !== existing.requestedQuantity) {
      throw new HrControlError(
        'The approved number of positions cannot be changed. Cancel positions or close the requirement partially instead.',
      );
    }
    const frozen: Array<keyof RequirementInput> = ['designation', 'grade', 'employmentType', 'departmentId', 'requirementType'];
    for (const field of frozen) {
      if (patch[field] !== undefined && patch[field] !== existing[field]) {
        throw new HrControlError(`${String(field)} cannot be changed after approval. Raise a new requirement instead.`);
      }
    }
  }

  await updateDoc(doc(db, HR_COLLECTIONS.requirements, requirementId), {
    ...patch,
    ...withUpdateAudit(acting),
  });

  await logHrActivity({
    actor: acting,
    entityType: 'requirement',
    entityId: requirementId,
    requirementId,
    action: 'Requirement updated',
    summary: `Updated ${existing.requirementNumber}`,
    newValue: patch as Record<string, unknown>,
  });
}

/* ------------------------------------------------------------------------------------------------
 * Approval workflow (spec sections 12–15)
 * ---------------------------------------------------------------------------------------------- */

export interface ApprovalResolutionContext extends StageApproverContext {
  /** Sanctioned-strength facts from the manpower plan, for the section 13 conditions. */
  withinManpowerPlan?: boolean;
  aboveSanctionedStrength?: boolean;
}

/** Builds the matrix's matching context from a requirement plus the plan position. */
export function approvalContextFor(
  requirement: HrRequirement,
  settings: HrSettings,
  planFacts: { withinManpowerPlan?: boolean; aboveSanctionedStrength?: boolean } = {},
): RequirementApprovalContext {
  return {
    requirementType: requirement.requirementType,
    employmentType: requirement.employmentType,
    priority: requirement.priority,
    grade: requirement.grade,
    departmentId: requirement.departmentId,
    projectId: requirement.projectId,
    positions: requirement.requestedQuantity,
    expectedCtc: requirement.budget?.expectedCtc,
    replacedEmployeeCtc: requirement.replacement?.currentCtc,
    seniorManagement: isSeniorManagementGrade(settings, requirement.grade),
    ctcAboveBand: Boolean(requirement.budget?.ctcAboveBand),
    withinManpowerPlan: planFacts.withinManpowerPlan,
    aboveSanctionedStrength: planFacts.aboveSanctionedStrength,
  };
}

/**
 * Whether a requirement pushes the department/project past its sanctioned strength (section 13).
 *
 * Answered from the manpower plan rather than from a live headcount query, because the plan is what
 * was approved: a department running two people under strength because of an unfilled resignation is
 * still within its sanction, and treating today's headcount as the ceiling would route perfectly
 * ordinary replacements to a Director.
 */
export async function evaluateAgainstManpowerPlan(
  requirement: Pick<HrRequirement, 'organizationId' | 'departmentId' | 'projectId' | 'designation' | 'requestedQuantity'>,
): Promise<{ withinManpowerPlan: boolean; aboveSanctionedStrength: boolean; planId?: string; sanctioned?: number; existing?: number }> {
  const constraints = [
    where('organizationId', '==', requirement.organizationId),
    where('designation', '==', requirement.designation),
  ];
  if (requirement.projectId) constraints.push(where('projectId', '==', requirement.projectId));
  else constraints.push(where('departmentId', '==', requirement.departmentId));

  const snapshot = await getDocs(query(collection(db, HR_COLLECTIONS.manpowerPlans), ...constraints));
  const plans = snapshot.docs
    .map(entry => ({ id: entry.id, ...entry.data() }) as { id: string; approvedStrength?: number; existingStrength?: number; status?: string })
    .filter(plan => plan.status !== 'Closed');

  if (plans.length === 0) {
    // No plan row for this designation: the requirement is by definition not covered by a sanction,
    // which is exactly the "above sanctioned strength" case the matrix should route upwards.
    return { withinManpowerPlan: false, aboveSanctionedStrength: true };
  }

  const plan = plans[0];
  const sanctioned = Number(plan.approvedStrength) || 0;
  const existing = Number(plan.existingStrength) || 0;
  const headroom = sanctioned - existing;
  const within = requirement.requestedQuantity <= headroom;
  return {
    withinManpowerPlan: within,
    aboveSanctionedStrength: !within,
    planId: plan.id,
    sanctioned,
    existing,
  };
}

function stageLabel(stage: HrApprovalStage): string {
  return stage.label || HR_APPROVAL_STAGE_LABELS[stage.key] || stage.key;
}

/**
 * Advances a requirement to the next unsatisfied approval stage, or to APPROVED.
 *
 * Stages whose only approver is the person who raised the requisition are skipped when
 * `skipSelfApproval` is on — a requesting manager approving their own request is a rubber stamp that
 * makes the trail longer without making it stronger. An optional stage with no resolvable approver is
 * skipped too; a *mandatory* stage with no approver is an error, because silently dropping it would
 * quietly widen everyone's spending authority.
 */
async function advanceApprovalStage(
  requirement: HrRequirement,
  fromIndex: number,
  settings: HrSettings,
  context: ApprovalResolutionContext,
): Promise<{
  status: RequirementStatus;
  stageIndex: number;
  stageKey: HrApprovalStage['key'] | null;
  stageLabelText: string;
  pendingApproverIds: string[];
}> {
  const stages = requirement.approvalStages || [];

  for (let index = fromIndex; index < stages.length; index += 1) {
    const stage = stages[index];
    const approvers = resolveStageApprovers(stage, context).filter(id => {
      if (!settings.approvals.skipSelfApproval) return true;
      return id !== requirement.requestingManagerId;
    });

    if (approvers.length === 0) {
      if (stage.optional) continue;
      const unfiltered = resolveStageApprovers(stage, context);
      if (unfiltered.length === 0) {
        throw new HrControlError(
          `No approver is configured for the "${stageLabel(stage)}" stage. Ask HR to complete the approval matrix.`,
        );
      }
      // Every resolvable approver was the requester themselves; there is nobody else to ask, so the
      // stage is genuinely satisfied.
      continue;
    }

    return {
      status: requirementStatusForStage(stage.key),
      stageIndex: index,
      stageKey: stage.key,
      stageLabelText: stageLabel(stage),
      pendingApproverIds: approvers,
    };
  }

  return { status: 'APPROVED', stageIndex: stages.length, stageKey: null, stageLabelText: '', pendingApproverIds: [] };
}

/**
 * Submits a requirement for approval (spec sections 12, 13).
 *
 * Resolves the chain at submission and stores it on the requirement, rather than resolving it fresh
 * at each decision. A matrix edited halfway through an approval would otherwise re-route a
 * requisition mid-flight, leaving approvers who had already signed off on a chain that no longer
 * contains them.
 */
export async function submitRequirement(
  requirementId: string,
  actor: HrActor,
  context: ApprovalResolutionContext = {},
): Promise<{ status: RequirementStatus; pendingApproverIds: string[]; stageLabel: string }> {
  const acting = requireActor(actor);
  const requirement = await loadRequirement(requirementId);
  if (!requirement) throw new HrControlError('Requirement not found.');
  if (!['DRAFT', 'REJECTED'].includes(requirement.status)) {
    throw new HrControlError('Only a draft or returned requirement can be submitted.');
  }

  const settings = await loadHrSettings(acting.organizationId);
  validateRequirementInput(requirement as unknown as RequirementInput, settings);

  const planFacts =
    context.withinManpowerPlan === undefined && context.aboveSanctionedStrength === undefined
      ? await evaluateAgainstManpowerPlan(requirement)
      : { withinManpowerPlan: context.withinManpowerPlan, aboveSanctionedStrength: context.aboveSanctionedStrength };

  if (settings.general.blockAboveSanctionedStrength && planFacts.aboveSanctionedStrength) {
    throw new HrControlError(
      'This requirement exceeds the sanctioned manpower for the designation. Revise the manpower plan first.',
    );
  }

  const chain = resolveRequirementApprovalChain(
    approvalContextFor(requirement, settings, planFacts),
    settings.approvals.rules || [],
    settings.approvals.fallbackStages,
  );
  if (chain.stages.length === 0) {
    throw new HrControlError('No approval chain is configured. Ask HR to set up the approval matrix.');
  }

  const withChain: HrRequirement = { ...requirement, approvalStages: chain.stages };
  const next = await advanceApprovalStage(withChain, 0, settings, {
    ...context,
    departmentId: requirement.departmentId,
    projectId: requirement.projectId,
    departmentHodId: context.departmentHodId || requirement.departmentHodId,
    projectHeadId: context.projectHeadId || requirement.projectHeadId,
    requestingManagerId: context.requestingManagerId || requirement.requestingManagerId,
  });

  await updateDoc(doc(db, HR_COLLECTIONS.requirements, requirementId), {
    status: next.status,
    approvalRuleId: chain.ruleId,
    approvalRuleName: chain.ruleName,
    approvalStages: chain.stages,
    approvalStageIndex: next.stageIndex,
    currentApprovalStage: next.stageKey,
    currentApprovalStageLabel: next.stageLabelText,
    pendingApproverIds: next.pendingApproverIds,
    fastTrack: chain.fastTrack,
    submittedAt: serverTimestamp(),
    rejectionReason: '',
    ...withUpdateAudit(acting),
  });

  await logHrActivity({
    actor: acting,
    entityType: 'requirement',
    entityId: requirementId,
    requirementId,
    action: 'Submitted for approval',
    summary: `Submitted ${requirement.requirementNumber} — ${chain.ruleName}${
      chain.matchedOn.length ? ` (${chain.matchedOn.join(', ')})` : ''
    }`,
    newValue: { status: next.status, stage: next.stageLabelText, approvers: next.pendingApproverIds },
  });

  await notifyHr({
    event: 'approvalRequested',
    settings,
    organizationId: acting.organizationId,
    recipients: { userIds: next.pendingApproverIds },
    title: `Approval needed: ${requirement.requirementNumber}`,
    body: `${requirement.requestedQuantity} × ${requirement.designation} for ${requirement.departmentName}${
      requirement.projectName ? ` (${requirement.projectName})` : ''
    }, raised by ${requirement.requestingManagerName}.`,
    link: `/hr/approvals`,
    itemId: requirementId,
    itemRef: requirement.requirementNumber,
    severity: requirement.priority === 'Critical' ? 'CRITICAL' : 'INFO',
  });

  return { status: next.status, pendingApproverIds: next.pendingApproverIds, stageLabel: next.stageLabelText };
}

/**
 * Records one approver's decision (spec section 14).
 *
 * Every action writes an approval document before the requirement moves, so the trail survives even
 * if the requirement write fails — an approval that happened but left no record is the one thing an
 * audit cannot recover from.
 *
 * "Send back" returns the requisition to the requester as a draft with its chain cleared, because a
 * requirement whose quantity or CTC changed after the HOD signed off must not keep that signature.
 * "Request clarification" leaves the stage where it is: the approver still has to decide.
 */
export async function actOnRequirement(
  requirementId: string,
  action: ApprovalAction,
  actor: HrActor,
  options: {
    remarks?: string;
    condition?: string;
    forwardToUserId?: string;
    forwardToUserName?: string;
    context?: ApprovalResolutionContext;
  } = {},
): Promise<{ status: RequirementStatus; stageLabel: string; pendingApproverIds: string[] }> {
  const acting = requireActor(actor);
  const requirement = await loadRequirement(requirementId);
  if (!requirement) throw new HrControlError('Requirement not found.');

  const pending = requirement.pendingApproverIds || [];
  const stages = requirement.approvalStages || [];
  const stageIndex = requirement.approvalStageIndex ?? 0;
  const stage = stages[stageIndex];

  if (!stage) throw new HrControlError('This requirement is not awaiting an approval decision.');

  /*
   * The assignment is the authority. A user who appears in `pendingApproverIds` may act on the
   * stage whether or not their role separately carries an approve permission — the approval matrix
   * placed them there deliberately, and demanding a matching role permission on top is how a
   * correctly configured chain ends up stuck on someone the system refuses to let act.
   */
  if (!pending.includes(acting.userId)) {
    throw new HrControlError('This approval is not assigned to you.');
  }

  if (
    (['Reject', 'Send Back', 'Request Clarification', 'Approve With Condition'] as ApprovalAction[]).includes(action) &&
    !options.remarks?.trim()
  ) {
    throw new HrControlError('Enter a reason for this action.');
  }
  if (action === 'Forward' || action === 'Delegate') {
    if (!options.forwardToUserId) throw new HrControlError('Select the person to forward this to.');
    if (action === 'Forward' && !requirement.approvalStages?.length) {
      throw new HrControlError('This requirement has no approval chain to forward within.');
    }
  }

  const settings = await loadHrSettings(acting.organizationId);

  await addDoc(collection(db, HR_COLLECTIONS.requirementApprovals), {
    organizationId: acting.organizationId,
    requirementId,
    requirementNumber: requirement.requirementNumber,
    stageKey: stage.key,
    stageLabel: stageLabel(stage),
    stageIndex,
    action,
    approverId: acting.userId,
    approverName: acting.userName,
    forwardedToId: options.forwardToUserId || null,
    forwardedToName: options.forwardToUserName || null,
    remarks: options.remarks || '',
    condition: options.condition || '',
    actedAt: serverTimestamp(),
    ...withCreateAudit(acting),
  });

  const resolutionContext: ApprovalResolutionContext = {
    ...(options.context || {}),
    departmentId: requirement.departmentId,
    projectId: requirement.projectId,
    departmentHodId: options.context?.departmentHodId || requirement.departmentHodId,
    projectHeadId: options.context?.projectHeadId || requirement.projectHeadId,
    requestingManagerId: options.context?.requestingManagerId || requirement.requestingManagerId,
  };

  let patch: Record<string, unknown>;
  let outcome: { status: RequirementStatus; stageLabel: string; pendingApproverIds: string[] };

  switch (action) {
    case 'Reject': {
      patch = {
        status: 'REJECTED' satisfies RequirementStatus,
        currentApprovalStage: null,
        currentApprovalStageLabel: '',
        pendingApproverIds: [],
        rejectedAt: serverTimestamp(),
        rejectionReason: options.remarks || '',
      };
      outcome = { status: 'REJECTED', stageLabel: '', pendingApproverIds: [] };
      break;
    }

    case 'Send Back': {
      patch = {
        status: 'DRAFT' satisfies RequirementStatus,
        approvalStageIndex: 0,
        currentApprovalStage: null,
        currentApprovalStageLabel: '',
        pendingApproverIds: [],
        rejectionReason: options.remarks || '',
      };
      outcome = { status: 'DRAFT', stageLabel: '', pendingApproverIds: [] };
      break;
    }

    case 'Request Clarification': {
      // The stage stays put; only the requester is asked for something.
      patch = {};
      outcome = {
        status: requirement.status,
        stageLabel: stageLabel(stage),
        pendingApproverIds: pending,
      };
      break;
    }

    case 'Forward':
    case 'Delegate': {
      const delegate = options.forwardToUserId as string;
      patch = { pendingApproverIds: Array.from(new Set([...pending.filter(id => id !== acting.userId), delegate])) };
      outcome = {
        status: requirement.status,
        stageLabel: stageLabel(stage),
        pendingApproverIds: patch.pendingApproverIds as string[],
      };
      break;
    }

    case 'Approve':
    case 'Approve With Condition':
    default: {
      const next = await advanceApprovalStage(
        { ...requirement, approvalStages: stages },
        stageIndex + 1,
        settings,
        resolutionContext,
      );

      const approved = next.status === 'APPROVED';
      patch = {
        status: approved ? ('RECRUITER_ASSIGNMENT_PENDING' satisfies RequirementStatus) : next.status,
        approvalStageIndex: next.stageIndex,
        currentApprovalStage: next.stageKey,
        currentApprovalStageLabel: next.stageLabelText,
        pendingApproverIds: next.pendingApproverIds,
      };

      if (approved) {
        // The SLA clock starts at approval, not at creation (spec section 40): holding a recruiter
        // to time that ran while Finance deliberated is what discredits SLA reporting.
        const targetDays =
          requirement.slaTargetDays ||
          settings.sla.targets[requirement.priority] ||
          settings.sla.targets.Normal;
        patch.approvedAt = serverTimestamp();
        patch.slaStartedAt = serverTimestamp();
        patch.slaTargetDays = targetDays;
        patch.slaState = 'On track';
        patch.slaConsumedPercent = 0;
        if (!requirement.targetClosureDate) {
          const target = new Date();
          target.setDate(target.getDate() + targetDays);
          patch.targetClosureDate = target.toISOString().slice(0, 10);
        }
      }

      outcome = {
        status: patch.status as RequirementStatus,
        stageLabel: next.stageLabelText,
        pendingApproverIds: next.pendingApproverIds,
      };
      break;
    }
  }

  if (Object.keys(patch).length > 0) {
    await updateDoc(doc(db, HR_COLLECTIONS.requirements, requirementId), { ...patch, ...withUpdateAudit(acting) });
  }

  await logHrActivity({
    actor: acting,
    entityType: 'requirement',
    entityId: requirementId,
    requirementId,
    action,
    summary: `${action} at ${stageLabel(stage)} — ${requirement.requirementNumber}`,
    oldValue: { status: requirement.status, stage: stageLabel(stage) },
    newValue: { status: outcome.status, stage: outcome.stageLabel },
    remarks: options.remarks,
  });

  /*
   * Who hears about a decision depends on the decision. A rejection or a send-back concerns the
   * requester; an approval that moves the chain on concerns the next approver, who otherwise has no
   * way of knowing the requisition has reached them.
   */
  if (outcome.status === 'REJECTED') {
    await notifyHr({
      event: 'requirementRejected',
      settings,
      organizationId: acting.organizationId,
      recipients: { userIds: [requirement.requestingManagerId, requirement.departmentHodId] },
      title: `Requirement rejected: ${requirement.requirementNumber}`,
      body: `${acting.userName} rejected ${requirement.requestedQuantity} × ${requirement.designation}. ${options.remarks || ''}`.trim(),
      link: `/hr/requirements/${requirementId}`,
      itemId: requirementId,
      itemRef: requirement.requirementNumber,
      severity: 'WARNING',
    });
  } else if (outcome.status === 'DRAFT') {
    await notifyHr({
      event: 'requirementRejected',
      settings,
      organizationId: acting.organizationId,
      recipients: { userIds: [requirement.requestingManagerId] },
      title: `Returned for revision: ${requirement.requirementNumber}`,
      body: `${acting.userName} sent it back. ${options.remarks || ''}`.trim(),
      link: `/hr/requirements/${requirementId}/edit`,
      itemId: requirementId,
      itemRef: requirement.requirementNumber,
      severity: 'WARNING',
    });
  } else if (outcome.status === 'RECRUITER_ASSIGNMENT_PENDING') {
    await notifyHr({
      event: 'requirementApproved',
      settings,
      organizationId: acting.organizationId,
      recipients: { userIds: [requirement.requestingManagerId, requirement.departmentHodId], roles: ['HR Manager', 'HR Head'] },
      title: `Requirement approved: ${requirement.requirementNumber}`,
      body: `${requirement.requestedQuantity} × ${requirement.designation} is approved and needs a recruiter.`,
      link: `/hr/requirements/${requirementId}`,
      itemId: requirementId,
      itemRef: requirement.requirementNumber,
    });
  } else if (outcome.pendingApproverIds.length > 0 && action !== 'Request Clarification') {
    await notifyHr({
      event: 'approvalRequested',
      settings,
      organizationId: acting.organizationId,
      recipients: { userIds: outcome.pendingApproverIds },
      title: `Approval needed: ${requirement.requirementNumber}`,
      body: `${requirement.requestedQuantity} × ${requirement.designation} has reached ${outcome.stageLabel}.`,
      link: `/hr/approvals`,
      itemId: requirementId,
      itemRef: requirement.requirementNumber,
    });
  }

  if (action === 'Request Clarification') {
    await notifyHr({
      event: 'approvalRequested',
      settings,
      organizationId: acting.organizationId,
      recipients: { userIds: [requirement.requestingManagerId] },
      title: `Clarification requested: ${requirement.requirementNumber}`,
      body: `${acting.userName} asked: ${options.remarks || 'see the requirement'}`,
      link: `/hr/requirements/${requirementId}`,
      itemId: requirementId,
      itemRef: requirement.requirementNumber,
    });
  }

  return outcome;
}

/** Assigns recruiters and a target closure date (spec section 15). */
export async function assignRecruiter(
  requirementId: string,
  input: {
    primaryRecruiterId: string;
    primaryRecruiterName: string;
    secondaryRecruiterId?: string;
    secondaryRecruiterName?: string;
    targetClosureDate?: string;
  },
  actor: HrActor,
): Promise<void> {
  const acting = requireActor(actor);
  const requirement = await loadRequirement(requirementId);
  if (!requirement) throw new HrControlError('Requirement not found.');
  if (isTerminalRequirementStatus(requirement.status)) {
    throw new HrControlError('This requirement is closed.');
  }
  if (!input.primaryRecruiterId) throw new HrControlError('Select the primary recruiter.');

  const openStatuses: RequirementStatus[] = ['APPROVED', 'RECRUITER_ASSIGNMENT_PENDING'];
  await updateDoc(doc(db, HR_COLLECTIONS.requirements, requirementId), {
    primaryRecruiterId: input.primaryRecruiterId,
    primaryRecruiterName: input.primaryRecruiterName,
    secondaryRecruiterId: input.secondaryRecruiterId || '',
    secondaryRecruiterName: input.secondaryRecruiterName || '',
    recruiterAssignedAt: serverTimestamp(),
    targetClosureDate: input.targetClosureDate || requirement.targetClosureDate || '',
    // Assignment is what opens a requirement for sourcing; a re-assignment leaves the status alone.
    status: openStatuses.includes(requirement.status) ? ('OPEN' satisfies RequirementStatus) : requirement.status,
    ...withUpdateAudit(acting),
  });

  await logHrActivity({
    actor: acting,
    entityType: 'requirement',
    entityId: requirementId,
    requirementId,
    action: 'Recruiter assigned',
    summary: `Assigned ${input.primaryRecruiterName} to ${requirement.requirementNumber}`,
    newValue: { primaryRecruiterId: input.primaryRecruiterId, targetClosureDate: input.targetClosureDate },
  });

  const settings = await loadHrSettings(acting.organizationId);
  await notifyHr({
    event: 'recruiterAssigned',
    settings,
    organizationId: acting.organizationId,
    recipients: { userIds: [input.primaryRecruiterId, input.secondaryRecruiterId] },
    title: `Assigned to you: ${requirement.requirementNumber}`,
    body: `${requirement.requestedQuantity} × ${requirement.designation} for ${requirement.departmentName}${
      input.targetClosureDate ? `, target ${input.targetClosureDate}` : ''
    }.`,
    link: `/hr/requirements/${requirementId}`,
    itemId: requirementId,
    itemRef: requirement.requirementNumber,
    severity: requirement.priority === 'Critical' ? 'WARNING' : 'INFO',
  });
}

/* ------------------------------------------------------------------------------------------------
 * Hold, cancel, close, reopen (spec sections 38, 42, 43, 44)
 * ---------------------------------------------------------------------------------------------- */

export async function holdRequirement(
  requirementId: string,
  input: { reason: RequirementHoldReason; remarks?: string },
  actor: HrActor,
): Promise<void> {
  const acting = requireActor(actor);
  const requirement = await loadRequirement(requirementId);
  if (!requirement) throw new HrControlError('Requirement not found.');
  if (!isRecruitingStatus(requirement.status)) {
    throw new HrControlError('Only a requirement under recruitment can be put on hold.');
  }
  if (!input.reason) throw new HrControlError('Select a hold reason.');

  await updateDoc(doc(db, HR_COLLECTIONS.requirements, requirementId), {
    status: 'ON_HOLD' satisfies RequirementStatus,
    holdReason: input.reason,
    holdRemarks: input.remarks || '',
    heldAt: serverTimestamp(),
    heldBy: acting.userId,
    ...withUpdateAudit(acting),
  });

  await logHrActivity({
    actor: acting,
    entityType: 'requirement',
    entityId: requirementId,
    requirementId,
    action: 'Requirement held',
    summary: `${requirement.requirementNumber} placed on hold — ${input.reason}`,
    remarks: input.remarks,
  });
}

/**
 * Resumes a held requirement, adding the held time to `slaHeldDays`.
 *
 * The days are accumulated on release rather than computed on read, because a requirement can be
 * held more than once and only the record of each interval survives — a single `heldAt` cannot tell
 * you about the fortnight it spent on hold two months ago.
 */
export async function resumeRequirement(requirementId: string, actor: HrActor): Promise<void> {
  const acting = requireActor(actor);
  const requirement = await loadRequirement(requirementId);
  if (!requirement) throw new HrControlError('Requirement not found.');
  if (requirement.status !== 'ON_HOLD') throw new HrControlError('This requirement is not on hold.');

  const heldFrom = requirement.heldAt?.toDate?.();
  const heldDays = heldFrom ? Math.max(0, Math.floor((Date.now() - heldFrom.getTime()) / 86_400_000)) : 0;

  const fill = summarizeRequirementFill({
    requestedQuantity: requirement.requestedQuantity,
    joinedCount: requirement.joinedCount,
    offerAcceptedCount: requirement.offerAcceptedCount,
    offeredCount: requirement.offeredCount,
    inPipelineCount: requirement.applicationCount,
    cancelledPositions: requirement.cancelledPositions,
  });

  await updateDoc(doc(db, HR_COLLECTIONS.requirements, requirementId), {
    status: deriveRecruitingStatus({
      offered: requirement.offeredCount,
      selected: requirement.selectedCount,
      interviewing: requirement.interviewingCount,
      screening: requirement.screeningCount,
      sourced: requirement.applicationCount,
      joined: fill.joined,
      requested: fill.effectiveRequired,
    }),
    holdReason: null,
    holdRemarks: '',
    heldAt: null,
    slaHeldDays: (Number(requirement.slaHeldDays) || 0) + heldDays,
    ...withUpdateAudit(acting),
  });

  await logHrActivity({
    actor: acting,
    entityType: 'requirement',
    entityId: requirementId,
    requirementId,
    action: 'Requirement resumed',
    summary: `${requirement.requirementNumber} resumed after ${heldDays} ${heldDays === 1 ? 'day' : 'days'} on hold`,
  });
}

/**
 * Cancels a requirement or some of its positions (spec section 43).
 *
 * Never deletes: the requisition, its candidates and its approvals all stay, and the affected
 * applications are moved to the talent pool by default rather than rejected — a candidate who did
 * nothing wrong should not carry a rejection because a project slipped.
 */
export async function cancelRequirement(
  requirementId: string,
  input: {
    reason: string;
    positionsCancelled?: number;
    candidateDisposition?: 'Talent Pool' | 'Rejected' | 'Leave As Is';
  },
  actor: HrActor,
): Promise<{ cancelledPositions: number; applicationsMoved: number }> {
  const acting = requireActor(actor);
  const requirement = await loadRequirement(requirementId);
  if (!requirement) throw new HrControlError('Requirement not found.');
  if (isTerminalRequirementStatus(requirement.status)) {
    throw new HrControlError('This requirement is already closed.');
  }
  if (!input.reason?.trim()) throw new HrControlError('Enter a cancellation reason.');

  const fill = summarizeRequirementFill({
    requestedQuantity: requirement.requestedQuantity,
    joinedCount: requirement.joinedCount,
    cancelledPositions: requirement.cancelledPositions,
  });

  const requested = Math.max(0, Number(input.positionsCancelled) || fill.balance);
  const cancellable = fill.balance;
  if (requested > cancellable) {
    throw new HrControlError(
      `Only ${cancellable} unfilled ${cancellable === 1 ? 'position' : 'positions'} can be cancelled on this requirement.`,
    );
  }

  const partial = requested < cancellable;
  const disposition = input.candidateDisposition || 'Talent Pool';
  let applicationsMoved = 0;

  // Full cancellation releases the pipeline; a partial one leaves it working the remaining seats.
  if (!partial && disposition !== 'Leave As Is') {
    const applications = await loadApplicationsForRequirement(requirementId);
    const live = applications.filter(app => PIPELINE_STAGES.includes(app.stage as never));
    const batch = writeBatch(db);
    for (const application of live) {
      batch.update(doc(db, HR_COLLECTIONS.applications, application.id), {
        stage: disposition === 'Rejected' ? 'REJECTED' : 'TALENT_POOL',
        previousStage: application.stage,
        stageChangedAt: serverTimestamp(),
        stageChangedBy: acting.userId,
        exitReason: 'Requirement cancelled',
        exitRemarks: input.reason,
        exitedAt: serverTimestamp(),
        ...withUpdateAudit(acting),
      });
      applicationsMoved += 1;
    }
    if (applicationsMoved > 0) await batch.commit();
  }

  await updateDoc(doc(db, HR_COLLECTIONS.requirements, requirementId), {
    cancelledPositions: (Number(requirement.cancelledPositions) || 0) + requested,
    ...(partial
      ? {}
      : {
          status: 'CANCELLED' satisfies RequirementStatus,
          cancellationReason: input.reason,
          cancelledAt: serverTimestamp(),
          pendingApproverIds: [],
          currentApprovalStage: null,
        }),
    ...withUpdateAudit(acting),
  });

  await logHrActivity({
    actor: acting,
    entityType: 'requirement',
    entityId: requirementId,
    requirementId,
    action: partial ? 'Positions cancelled' : 'Requirement cancelled',
    summary: partial
      ? `Cancelled ${requested} of ${cancellable} open positions on ${requirement.requirementNumber}`
      : `Cancelled ${requirement.requirementNumber}${applicationsMoved ? `; ${applicationsMoved} candidates released` : ''}`,
    remarks: input.reason,
  });

  await notifyHr({
    event: 'requirementCancelled',
    settings: await loadHrSettings(acting.organizationId),
    organizationId: acting.organizationId,
    recipients: {
      userIds: [requirement.primaryRecruiterId, requirement.requestingManagerId, requirement.departmentHodId],
      roles: ['HR Manager', 'HR Head'],
    },
    title: partial
      ? `Positions cancelled: ${requirement.requirementNumber}`
      : `Requirement cancelled: ${requirement.requirementNumber}`,
    body: partial
      ? `${requested} of ${cancellable} open positions for ${requirement.designation} were cancelled. ${input.reason}`
      : `${requirement.designation} was cancelled. ${input.reason}${
          applicationsMoved ? ` ${applicationsMoved} candidates released to ${disposition.toLowerCase()}.` : ''
        }`,
    link: `/hr/requirements/${requirementId}`,
    itemId: requirementId,
    itemRef: requirement.requirementNumber,
    severity: 'WARNING',
  });

  return { cancelledPositions: requested, applicationsMoved };
}

/** Closes a requirement (spec section 38). */
export async function closeRequirement(
  requirementId: string,
  input: { closureType: 'Fully Filled' | 'Partially Filled'; reason?: string },
  actor: HrActor,
): Promise<void> {
  const acting = requireActor(actor);
  const requirement = await loadRequirement(requirementId);
  if (!requirement) throw new HrControlError('Requirement not found.');

  const [applications, offers, joinings] = await Promise.all([
    loadApplicationsForRequirement(requirementId),
    getDocs(query(collection(db, HR_COLLECTIONS.offers), where('requirementId', '==', requirementId))),
    getDocs(query(collection(db, HR_COLLECTIONS.joiningRecords), where('requirementId', '==', requirementId))),
  ]);

  const liveOffers = offers.docs
    .map(entry => entry.data() as HrOffer)
    .filter(offer => LIVE_OFFER_STATUSES.includes(offer.status) && offer.status !== 'ACCEPTED').length;
  const joiningRecords = joinings.docs.map(entry => entry.data() as JoiningRecord);
  const upcoming = joiningRecords.filter(row => ['CONFIRMED', 'CONFIRMATION_PENDING', 'DOCUMENTS_PENDING'].includes(row.status)).length;
  const joined = joiningRecords.filter(row => row.status === 'JOINED').length;
  const active = applications.filter(app => PIPELINE_STAGES.includes(app.stage as never) && app.stage !== 'JOINED').length;

  const readiness = evaluateRequirementClosure({
    status: requirement.status,
    requestedQuantity: requirement.requestedQuantity,
    joinedCount: joined,
    liveOfferCount: liveOffers,
    upcomingJoiningCount: upcoming,
    activeCandidateCount: active,
  });

  if (readiness.blockers.length > 0) throw new HrControlError(readiness.blockers[0]);
  if (input.closureType === 'Partially Filled' && !input.reason?.trim()) {
    throw new HrControlError('A reason is required to close a requirement partially.');
  }
  if (input.closureType === 'Fully Filled' && !readiness.canCloseFullyFilled) {
    throw new HrControlError('This requirement is not fully filled. Close it as partially filled instead.');
  }

  await updateDoc(doc(db, HR_COLLECTIONS.requirements, requirementId), {
    status: (input.closureType === 'Fully Filled' ? 'FILLED' : 'CLOSED') satisfies RequirementStatus,
    closureType: input.closureType,
    closureReason: input.reason || '',
    closedAt: serverTimestamp(),
    closedBy: acting.userId,
    closedByName: acting.userName,
    joinedCount: joined,
    pendingApproverIds: [],
    ...withUpdateAudit(acting),
  });

  await logHrActivity({
    actor: acting,
    entityType: 'requirement',
    entityId: requirementId,
    requirementId,
    action: 'Requirement closed',
    summary: `${requirement.requirementNumber} closed as ${input.closureType.toLowerCase()} (${joined}/${requirement.requestedQuantity} joined)`,
    remarks: input.reason,
  });
}

/**
 * Raises a replacement requirement linked to the original (spec section 44).
 *
 * Copies the position, skills and budget rather than the recruitment state, and links both ways, so
 * that a position resigned out of six months after it was filled still traces back to the original
 * sanction instead of appearing as fresh headcount.
 */
export async function createReplacementRequirement(
  originalRequirementId: string,
  input: {
    quantity: number;
    replacement: NonNullable<HrRequirement['replacement']>;
    requiredJoiningDate: string;
    priority?: RequirementPriority;
  },
  actor: HrActor,
): Promise<{ id: string; requirementNumber: string }> {
  const acting = requireActor(actor);
  const original = await loadRequirement(originalRequirementId);
  if (!original) throw new HrControlError('Original requirement not found.');
  if (!input.replacement?.employeeId) throw new HrControlError('Select the employee being replaced.');

  const created = await createRequirement(
    {
      requirementDate: todayIso(),
      departmentId: original.departmentId,
      departmentName: original.departmentName,
      projectId: original.projectId,
      projectName: original.projectName,
      siteId: original.siteId,
      siteName: original.siteName,
      locationId: original.locationId,
      location: original.location,
      requestingManagerId: acting.userId,
      requestingManagerName: acting.userName,
      departmentHodId: original.departmentHodId,
      projectHeadId: original.projectHeadId,
      requirementType: 'Replacement',
      requirementReason: input.replacement.reason,
      replacement: input.replacement,
      designation: original.designation,
      jobTitle: original.jobTitle,
      grade: original.grade,
      requestedQuantity: Math.max(1, Math.floor(input.quantity) || 1),
      employmentType: original.employmentType,
      reportingToId: original.reportingToId,
      reportingToName: original.reportingToName,
      requiredJoiningDate: input.requiredJoiningDate,
      priority: input.priority || original.priority,
      minExperienceYears: original.minExperienceYears,
      maxExperienceYears: original.maxExperienceYears,
      qualification: original.qualification,
      specialization: original.specialization,
      skills: original.skills,
      budget: { ...original.budget, expectedCtc: input.replacement.currentCtc ?? original.budget?.expectedCtc },
      originalRequirementId,
    } as RequirementInput,
    acting,
  );

  await updateDoc(doc(db, HR_COLLECTIONS.requirements, originalRequirementId), {
    linkedRequirementIds: Array.from(new Set([...(original.linkedRequirementIds || []), created.id])),
    ...withUpdateAudit(acting),
  });

  await logHrActivity({
    actor: acting,
    entityType: 'requirement',
    entityId: created.id,
    requirementId: created.id,
    action: 'Replacement requirement created',
    summary: `${created.requirementNumber} raised against ${original.requirementNumber} for ${input.replacement.employeeName}`,
  });

  return created;
}

/** Generates a set of draft requirements from a manpower template (spec sections 50, 51). */
export async function generateRequirementsFromTemplate(
  input: {
    templateId: string;
    projectId: string;
    projectName: string;
    departmentId: string;
    departmentName: string;
    locationId?: string;
    location?: string;
    requiredJoiningDate: string;
    requestingManagerId?: string;
    requestingManagerName?: string;
  },
  actor: HrActor,
): Promise<Array<{ id: string; requirementNumber: string; designation: string }>> {
  const acting = requireActor(actor);
  const snapshot = await getDoc(doc(db, HR_COLLECTIONS.requirementTemplates, input.templateId));
  if (!snapshot.exists()) throw new HrControlError('Template not found.');
  const template = snapshot.data() as { name: string; lines?: Array<Record<string, unknown>> };
  const lines = template.lines || [];
  if (lines.length === 0) throw new HrControlError('This template has no manpower lines.');

  const created: Array<{ id: string; requirementNumber: string; designation: string }> = [];
  for (const line of lines) {
    const result = await createRequirement(
      {
        requirementDate: todayIso(),
        departmentId: input.departmentId,
        departmentName: input.departmentName,
        projectId: input.projectId,
        projectName: input.projectName,
        locationId: input.locationId,
        location: input.location,
        requestingManagerId: input.requestingManagerId || acting.userId,
        requestingManagerName: input.requestingManagerName || acting.userName,
        requirementType: 'Project Requirement',
        designation: String(line.designation || ''),
        jobTitle: String(line.designation || ''),
        grade: String(line.grade || 'Staff'),
        requestedQuantity: Math.max(1, Number(line.quantity) || 1),
        employmentType: (line.employmentType as HrRequirement['employmentType']) || 'Permanent',
        requiredJoiningDate: input.requiredJoiningDate,
        priority: (line.priority as RequirementPriority) || 'Normal',
        minExperienceYears: Number(line.minExperienceYears) || 0,
        qualification: String(line.qualification || 'As applicable'),
        skills: { primarySkills: [] },
        budget: {},
      } as RequirementInput,
      acting,
    );
    created.push({ ...result, designation: String(line.designation || '') });
  }

  await logHrActivity({
    actor: acting,
    entityType: 'requirement',
    entityId: input.projectId,
    action: 'Bulk requirements generated',
    summary: `Generated ${created.length} draft requirements for ${input.projectName} from "${template.name}"`,
    newValue: { templateId: input.templateId, count: created.length },
  });

  return created;
}

/* ------------------------------------------------------------------------------------------------
 * Requirement counters and SLA (spec sections 37, 40, 41)
 * ---------------------------------------------------------------------------------------------- */

/**
 * Recomputes a requirement's denormalised counters from its children.
 *
 * Called after every stage move, offer and joining. The stored counters exist so the register can
 * filter and the dashboard can aggregate without reading every application; they are never trusted
 * for a decision — closure, fill status and the SLA all recompute from here first (control rule
 * 63.4).
 */
export async function refreshRequirementCounters(requirementId: string): Promise<HrRequirement | null> {
  const requirement = await loadRequirement(requirementId);
  if (!requirement) return null;

  const [applications, offerSnapshot, joiningSnapshot] = await Promise.all([
    loadApplicationsForRequirement(requirementId),
    getDocs(query(collection(db, HR_COLLECTIONS.offers), where('requirementId', '==', requirementId))),
    getDocs(query(collection(db, HR_COLLECTIONS.joiningRecords), where('requirementId', '==', requirementId))),
  ]);

  const offers = offerSnapshot.docs.map(entry => entry.data() as HrOffer);
  const joinings = joiningSnapshot.docs.map(entry => entry.data() as JoiningRecord);

  const atStage = (stages: ApplicationStage[]) => applications.filter(app => stages.includes(app.stage)).length;
  const joinedCount = joinings.filter(row => row.status === 'JOINED').length;
  const offerAcceptedCount = offers.filter(offer => offer.status === 'ACCEPTED').length;
  const offeredCount = offers.filter(offer => offer.status === 'SENT' || offer.status === 'VIEWED').length;

  const counters = {
    applicationCount: applications.filter(app => PIPELINE_STAGES.includes(app.stage as never)).length,
    screeningCount: atStage(['NEW', 'SCREENING', 'SHORTLISTED']),
    interviewingCount: atStage(['INTERVIEW_1', 'INTERVIEW_2', 'FINAL_INTERVIEW']),
    selectedCount: atStage(['SELECTED', 'COMPENSATION_APPROVAL']),
    offeredCount,
    offerAcceptedCount,
    joinedCount,
  };

  const fill = summarizeRequirementFill({
    requestedQuantity: requirement.requestedQuantity,
    joinedCount,
    offerAcceptedCount,
    offeredCount,
    inPipelineCount: counters.applicationCount,
    cancelledPositions: requirement.cancelledPositions,
  });

  /*
   * Status is only re-derived while the requirement is actually recruiting. A held, cancelled or
   * closed requirement keeps the status a person gave it — recomputing would quietly reopen a
   * requisition somebody deliberately paused.
   */
  const patch: Record<string, unknown> = { ...counters };
  if (isRecruitingStatus(requirement.status)) {
    patch.status = deriveRecruitingStatus({
      offered: counters.offeredCount + offerAcceptedCount,
      selected: counters.selectedCount,
      interviewing: counters.interviewingCount,
      screening: counters.screeningCount,
      sourced: counters.applicationCount,
      joined: fill.joined,
      requested: fill.effectiveRequired,
    });
  }

  await updateDoc(doc(db, HR_COLLECTIONS.requirements, requirementId), patch);
  return { ...requirement, ...patch } as HrRequirement;
}

/**
 * Recomputes SLA state and returns the escalation levels that have newly come due (section 41).
 *
 * The caller sends the notifications and then calls `recordEscalationsSent`, rather than this
 * function notifying directly, because the daily cron and the requirement workspace both call it and
 * only one of them should be capable of raising mail.
 */
export async function evaluateRequirementEscalations(
  requirementId: string,
  settings?: HrSettings,
): Promise<{
  sla: ReturnType<typeof evaluateRequirementSla>;
  due: ReturnType<typeof resolveDueEscalations>;
  requirement: HrRequirement;
} | null> {
  const requirement = await loadRequirement(requirementId);
  if (!requirement) return null;
  const config = settings || (await loadHrSettings(requirement.organizationId));

  const sla = evaluateRequirementSla({
    startedAt: requirement.slaStartedAt?.toDate?.() || null,
    targetDays: requirement.slaTargetDays || config.sla.targets[requirement.priority] || config.sla.targets.Normal,
    heldDays: requirement.slaHeldDays,
    pauseOnHold: config.sla.pauseOnHold,
  });

  const due =
    config.sla.escalationEnabled && !isTerminalRequirementStatus(requirement.status)
      ? resolveDueEscalations(sla.consumedPercent, config.sla.escalationLadder, requirement.escalationsSent || [])
      : [];

  await updateDoc(doc(db, HR_COLLECTIONS.requirements, requirementId), {
    slaConsumedPercent: sla.consumedPercent,
    slaState: sla.state,
  });

  return { sla, due, requirement };
}

/**
 * Notifies an escalation ladder's audiences and records that it fired (spec section 41).
 *
 * Sending and recording live together so the two cannot come apart: a level that was notified but not
 * recorded would fire again on the next cron run, and one recorded but not notified would silence an
 * escalation that everyone believes went out.
 */
export async function recordEscalationsSent(
  requirementId: string,
  levels: Array<{ atPercent: number; label?: string; notify: string[] }>,
  consumedPercent: number,
  actor: HrActor,
): Promise<void> {
  const acting = requireActor(actor);
  if (levels.length === 0) return;
  const requirement = await loadRequirement(requirementId);
  if (!requirement) return;

  const settings = await loadHrSettings(acting.organizationId);
  for (const level of levels) {
    const userIds: Array<string | undefined> = [];
    const roles: string[] = [];
    for (const audience of level.notify) {
      switch (audience) {
        case 'RECRUITER':
          userIds.push(requirement.primaryRecruiterId, requirement.secondaryRecruiterId);
          break;
        case 'DEPARTMENT_HOD':
          userIds.push(requirement.departmentHodId);
          break;
        case 'REQUESTING_MANAGER':
          userIds.push(requirement.requestingManagerId);
          break;
        default:
          roles.push(...(ESCALATION_ROLES[audience] || [audience]));
      }
    }

    await notifyHr({
      event: consumedPercent >= 100 ? 'requirementOverdue' : 'slaApproaching',
      settings,
      organizationId: acting.organizationId,
      recipients: { userIds, roles },
      title:
        consumedPercent >= 100
          ? `Overdue: ${requirement.requirementNumber}`
          : `SLA warning: ${requirement.requirementNumber}`,
      body: `${requirement.requestedQuantity} × ${requirement.designation} — ${Math.round(consumedPercent)}% of the ${
        requirement.slaTargetDays || settings.sla.targets[requirement.priority]
      }-day SLA consumed${level.label ? ` (${level.label})` : ''}.`,
      link: `/hr/requirements/${requirementId}`,
      itemId: requirementId,
      itemRef: requirement.requirementNumber,
      severity: consumedPercent >= 120 ? 'CRITICAL' : 'WARNING',
    });
  }

  const batch = writeBatch(db);
  for (const level of levels) {
    batch.set(doc(collection(db, HR_COLLECTIONS.escalations)), {
      organizationId: acting.organizationId,
      requirementId,
      requirementNumber: requirement.requirementNumber,
      atPercent: level.atPercent,
      label: level.label || '',
      notified: level.notify,
      consumedPercent,
      createdAt: serverTimestamp(),
    });
  }
  batch.update(doc(db, HR_COLLECTIONS.requirements, requirementId), {
    escalationsSent: Array.from(new Set([...(requirement.escalationsSent || []), ...levels.map(level => level.atPercent)])),
  });
  await batch.commit();
}

/* ------------------------------------------------------------------------------------------------
 * Candidates (spec sections 19, 20)
 * ---------------------------------------------------------------------------------------------- */

export type CandidateInput = Omit<
  Candidate,
  'id' | 'organizationId' | 'candidateNumber' | 'createdAt' | 'createdBy' | 'createdByName' | 'updatedAt' | 'updatedBy' | 'updatedByName'
>;

/**
 * Creates a candidate in the master (spec section 19).
 *
 * Duplicate detection is the caller's to run and show (section 20) — the screen has to offer "use
 * the existing profile" before this is reached. What this enforces is narrower and non-negotiable:
 * a candidate needs a name and at least one reachable identifier, or the master fills up with rows
 * nobody can match against or ring.
 */
export async function createCandidate(input: CandidateInput, actor: HrActor): Promise<{ id: string; candidateNumber: string }> {
  const acting = requireActor(actor);
  if (!input.name?.trim()) throw new HrControlError("Enter the candidate's name.");
  if (!input.mobile?.trim() && !input.email?.trim()) {
    throw new HrControlError('Enter a mobile number or an email address for the candidate.');
  }

  const candidateNumber = await allocateHrNumber(acting.organizationId, 'candidate');
  const ref = await addDoc(collection(db, HR_COLLECTIONS.candidates), {
    ...input,
    organizationId: acting.organizationId,
    candidateNumber,
    applicationCount: 0,
    ...withCreateAudit(acting),
  });

  await logHrActivity({
    actor: acting,
    entityType: 'candidate',
    entityId: ref.id,
    action: 'Candidate added',
    summary: `Added candidate ${input.name} (${candidateNumber}) from ${input.source}`,
  });

  return { id: ref.id, candidateNumber };
}

export async function updateCandidate(candidateId: string, patch: Partial<CandidateInput>, actor: HrActor): Promise<void> {
  const acting = requireActor(actor);
  await updateDoc(doc(db, HR_COLLECTIONS.candidates, candidateId), { ...patch, ...withUpdateAudit(acting) });
  await logHrActivity({
    actor: acting,
    entityType: 'candidate',
    entityId: candidateId,
    action: 'Candidate updated',
    summary: `Updated candidate profile`,
    newValue: patch as Record<string, unknown>,
  });
}

/**
 * Sets or clears the do-not-hire flag (spec section 19).
 *
 * A reason is mandatory in both directions. An unexplained flag on a person's record is indefensible
 * if it is ever questioned, and an unexplained *removal* is how a flag that mattered disappears.
 */
export async function setCandidateDoNotHire(
  candidateId: string,
  input: { doNotHire: boolean; reason: string },
  actor: HrActor,
): Promise<void> {
  const acting = requireActor(actor);
  if (!input.reason?.trim()) throw new HrControlError('Enter the reason for this decision.');

  await updateDoc(doc(db, HR_COLLECTIONS.candidates, candidateId), {
    doNotHire: input.doNotHire,
    doNotHireReason: input.reason,
    doNotHireBy: input.doNotHire ? acting.userId : '',
    doNotHireAt: input.doNotHire ? serverTimestamp() : null,
    ...withUpdateAudit(acting),
  });

  await logHrActivity({
    actor: acting,
    entityType: 'candidate',
    entityId: candidateId,
    action: input.doNotHire ? 'Marked do not hire' : 'Cleared do not hire',
    summary: input.doNotHire ? 'Candidate marked do-not-hire' : 'Do-not-hire flag removed',
    remarks: input.reason,
  });
}

/** Adds a candidate to a talent-pool category (spec section 48). */
export async function addToTalentPool(
  input: { candidateId: string; candidateName: string; category: string; reason?: string; sourceRequirementId?: string },
  actor: HrActor,
): Promise<string> {
  const acting = requireActor(actor);
  if (!input.category) throw new HrControlError('Select a talent-pool category.');

  const candidateSnapshot = await getDoc(doc(db, HR_COLLECTIONS.candidates, input.candidateId));
  const candidate = candidateSnapshot.exists() ? (candidateSnapshot.data() as Candidate) : null;

  const ref = await addDoc(collection(db, HR_COLLECTIONS.talentPool), {
    organizationId: acting.organizationId,
    candidateId: input.candidateId,
    candidateName: input.candidateName,
    category: input.category,
    designation: candidate?.currentDesignation || '',
    skills: candidate?.skills || [],
    totalExperienceYears: candidate?.totalExperienceYears || 0,
    locationId: candidate?.locationId || '',
    location: candidate?.currentLocation || '',
    addedReason: input.reason || '',
    sourceRequirementId: input.sourceRequirementId || '',
    active: true,
    addedAt: serverTimestamp(),
    ...withCreateAudit(acting),
  });

  await updateDoc(doc(db, HR_COLLECTIONS.candidates, input.candidateId), {
    inTalentPool: true,
    talentPoolCategories: Array.from(new Set([...(candidate?.talentPoolCategories || []), input.category])),
    ...withUpdateAudit(acting),
  });

  return ref.id;
}

/* ------------------------------------------------------------------------------------------------
 * Applications and pipeline (spec sections 21–23)
 * ---------------------------------------------------------------------------------------------- */

/**
 * Attaches a candidate to a requirement (spec section 21).
 *
 * Enforces three things: the requirement must be recruiting (control rule 63.2), a do-not-hire
 * candidate cannot be applied without the flag being cleared first, and the same candidate cannot
 * hold two live applications against one requirement — the second is the accident that makes a
 * pipeline count meaningless.
 */
export async function createApplication(
  input: {
    requirementId: string;
    candidateId: string;
    source?: Candidate['source'];
    sourceDetail?: string;
    agencyId?: string;
    recruiterId?: string;
    recruiterName?: string;
    isInternal?: boolean;
  },
  actor: HrActor,
): Promise<{ id: string; applicationNumber: string }> {
  const acting = requireActor(actor);

  const [requirement, candidateSnapshot] = await Promise.all([
    loadRequirement(input.requirementId),
    getDoc(doc(db, HR_COLLECTIONS.candidates, input.candidateId)),
  ]);
  if (!requirement) throw new HrControlError('Requirement not found.');
  if (!candidateSnapshot.exists()) throw new HrControlError('Candidate not found.');
  const candidate = { id: candidateSnapshot.id, ...candidateSnapshot.data() } as Candidate;

  if (!isRecruitingStatus(requirement.status)) {
    throw new HrControlError(
      `Candidates can only be added to a requirement that is open for recruitment. This one is ${requirement.status.toLowerCase().replace(/_/g, ' ')}.`,
    );
  }
  if (candidate.doNotHire) {
    throw new HrControlError(`${candidate.name} is marked do-not-hire: ${candidate.doNotHireReason || 'no reason recorded'}.`);
  }

  const existing = await getDocs(
    query(
      collection(db, HR_COLLECTIONS.applications),
      where('requirementId', '==', input.requirementId),
      where('candidateId', '==', input.candidateId),
    ),
  );
  const liveDuplicate = existing.docs
    .map(entry => entry.data() as CandidateApplication)
    .find(app => PIPELINE_STAGES.includes(app.stage as never));
  if (liveDuplicate) {
    throw new HrControlError(`${candidate.name} is already in this requirement's pipeline at ${liveDuplicate.stage.replace(/_/g, ' ').toLowerCase()}.`);
  }

  const applicationNumber = await allocateHrNumber(acting.organizationId, 'application');
  const ref = await addDoc(collection(db, HR_COLLECTIONS.applications), {
    organizationId: acting.organizationId,
    applicationNumber,
    requirementId: requirement.id,
    requirementNumber: requirement.requirementNumber,
    candidateId: candidate.id,
    candidateName: candidate.name,
    candidateMobile: candidate.mobile || '',
    designation: requirement.designation,
    departmentId: requirement.departmentId,
    projectId: requirement.projectId || '',
    stage: 'NEW' satisfies ApplicationStage,
    stagesReached: ['NEW'],
    stageChangedAt: serverTimestamp(),
    stageChangedBy: acting.userId,
    source: input.source || candidate.source,
    sourceDetail: input.sourceDetail || candidate.sourceDetail || '',
    agencyId: input.agencyId || candidate.agencyId || '',
    recruiterId: input.recruiterId || requirement.primaryRecruiterId || '',
    recruiterName: input.recruiterName || requirement.primaryRecruiterName || '',
    isInternal: Boolean(input.isInternal || candidate.isInternal),
    interviewCount: 0,
    appliedAt: serverTimestamp(),
    ...withCreateAudit(acting),
  });

  await updateDoc(doc(db, HR_COLLECTIONS.candidates, candidate.id), {
    applicationCount: (Number(candidate.applicationCount) || 0) + 1,
    lastApplicationAt: serverTimestamp(),
  });

  await logHrActivity({
    actor: acting,
    entityType: 'application',
    entityId: ref.id,
    requirementId: requirement.id,
    action: 'Candidate added',
    summary: `${candidate.name} added to ${requirement.requirementNumber} from ${input.source || candidate.source}`,
  });

  const recruiterId = input.recruiterId || requirement.primaryRecruiterId;
  if (recruiterId && recruiterId !== acting.userId) {
    const settings = await loadHrSettings(acting.organizationId);
    await notifyHr({
      event: 'candidateAssigned',
      settings,
      organizationId: acting.organizationId,
      recipients: { userIds: [recruiterId] },
      title: `Candidate added: ${candidate.name}`,
      body: `${candidate.name} is in the pipeline for ${requirement.requirementNumber} — ${requirement.designation}.`,
      link: `/hr/requirements/${requirement.id}`,
      itemId: ref.id,
      itemRef: applicationNumber,
    });
  }

  await refreshRequirementCounters(requirement.id);
  return { id: ref.id, applicationNumber };
}

/** Moves an application between pipeline stages (spec section 22). */
export async function moveApplicationStage(
  applicationId: string,
  to: ApplicationStage,
  actor: HrActor,
  options: { reason?: string; remarks?: string } = {},
): Promise<void> {
  const acting = requireActor(actor);
  const snapshot = await getDoc(doc(db, HR_COLLECTIONS.applications, applicationId));
  if (!snapshot.exists()) throw new HrControlError('Application not found.');
  const application = { id: snapshot.id, ...snapshot.data() } as CandidateApplication;

  const [selection, offers] = await Promise.all([
    application.selectionProposalId
      ? getDoc(doc(db, HR_COLLECTIONS.selectionProposals, application.selectionProposalId))
      : Promise.resolve(null),
    getDocs(query(collection(db, HR_COLLECTIONS.offers), where('applicationId', '==', applicationId))),
  ]);

  const proposal = selection?.exists() ? (selection.data() as SelectionProposal) : null;
  const offerAccepted = offers.docs.some(entry => (entry.data() as HrOffer).status === 'ACCEPTED');

  const move = evaluateStageMove({
    from: application.stage,
    to,
    compensationApproved:
      proposal?.compensationApprovalStatus === 'APPROVED' || proposal?.compensationApprovalStatus === 'NOT_REQUIRED',
    offerAccepted,
  });
  if (!move.allowed) throw new HrControlError(move.reason);

  const exiting = !PIPELINE_STAGES.includes(to as never);
  await updateDoc(doc(db, HR_COLLECTIONS.applications, applicationId), {
    stage: to,
    previousStage: application.stage,
    stagesReached: Array.from(new Set([...(application.stagesReached || [application.stage]), to])),
    stageChangedAt: serverTimestamp(),
    stageChangedBy: acting.userId,
    ...(exiting
      ? { exitReason: options.reason || '', exitRemarks: options.remarks || '', exitedAt: serverTimestamp() }
      : {}),
    ...withUpdateAudit(acting),
  });

  await logHrActivity({
    actor: acting,
    entityType: 'application',
    entityId: applicationId,
    requirementId: application.requirementId,
    action: 'Stage changed',
    summary: `${application.candidateName}: ${application.stage.replace(/_/g, ' ').toLowerCase()} → ${to.replace(/_/g, ' ').toLowerCase()}`,
    oldValue: { stage: application.stage },
    newValue: { stage: to },
    remarks: options.remarks || options.reason,
  });

  // A candidate leaving the pipeline for the talent pool should be findable there next time.
  if (to === 'TALENT_POOL') {
    await addToTalentPool(
      {
        candidateId: application.candidateId,
        candidateName: application.candidateName,
        category: application.designation || 'General',
        reason: options.reason || 'Not taken forward on this requirement',
        sourceRequirementId: application.requirementId,
      },
      acting,
    ).catch(() => undefined);
  }

  await refreshRequirementCounters(application.requirementId);
}

/** Records an HR screening decision and moves the application accordingly (spec section 23). */
export async function recordScreening(
  applicationId: string,
  input: Omit<ScreeningRecord, 'screenedBy' | 'screenedByName' | 'screenedAt'> & { result: ScreeningResult },
  actor: HrActor,
): Promise<{ stage: ApplicationStage }> {
  const acting = requireActor(actor);
  const snapshot = await getDoc(doc(db, HR_COLLECTIONS.applications, applicationId));
  if (!snapshot.exists()) throw new HrControlError('Application not found.');
  const application = { id: snapshot.id, ...snapshot.data() } as CandidateApplication;

  const stage = stageForScreeningResult(input.result);
  await updateDoc(doc(db, HR_COLLECTIONS.applications, applicationId), {
    screening: {
      ...input,
      screenedBy: acting.userId,
      screenedByName: acting.userName,
      screenedAt: serverTimestamp(),
    },
    stage,
    previousStage: application.stage,
    stagesReached: Array.from(new Set([...(application.stagesReached || [application.stage]), 'SCREENING', stage])),
    stageChangedAt: serverTimestamp(),
    stageChangedBy: acting.userId,
    ...withUpdateAudit(acting),
  });

  await logHrActivity({
    actor: acting,
    entityType: 'application',
    entityId: applicationId,
    requirementId: application.requirementId,
    action: 'Screening recorded',
    summary: `${application.candidateName} screened — ${input.result}`,
    newValue: { result: input.result, recommendation: input.recruiterRecommendation },
  });

  await refreshRequirementCounters(application.requirementId);
  return { stage };
}

/* ------------------------------------------------------------------------------------------------
 * Interviews (spec sections 24–26)
 * ---------------------------------------------------------------------------------------------- */

export async function scheduleInterview(
  input: {
    applicationId: string;
    round: Interview['round'];
    roundNumber?: number;
    mode: Interview['mode'];
    scheduledAt: string;
    durationMinutes?: number;
    location?: string;
    meetingLink?: string;
    interviewerIds: string[];
    interviewerNames?: string[];
  },
  actor: HrActor,
): Promise<{ id: string; interviewNumber: string }> {
  const acting = requireActor(actor);
  if (!input.interviewerIds?.length) throw new HrControlError('Select at least one interviewer.');
  if (!input.scheduledAt) throw new HrControlError('Pick the interview date and time.');

  const snapshot = await getDoc(doc(db, HR_COLLECTIONS.applications, input.applicationId));
  if (!snapshot.exists()) throw new HrControlError('Application not found.');
  const application = { id: snapshot.id, ...snapshot.data() } as CandidateApplication;

  const requirement = await loadRequirement(application.requirementId);
  if (requirement && !isRecruitingStatus(requirement.status)) {
    throw new HrControlError('Interviews cannot be scheduled against a requirement that is not recruiting.');
  }

  const interviewNumber = await allocateHrNumber(acting.organizationId, 'interview');
  const roundNumber = input.roundNumber || (Number(application.interviewCount) || 0) + 1;

  const ref = await addDoc(collection(db, HR_COLLECTIONS.interviews), {
    organizationId: acting.organizationId,
    interviewNumber,
    requirementId: application.requirementId,
    requirementNumber: application.requirementNumber,
    applicationId: application.id,
    candidateId: application.candidateId,
    candidateName: application.candidateName,
    designation: application.designation || '',
    round: input.round,
    roundNumber,
    mode: input.mode,
    scheduledAt: input.scheduledAt,
    durationMinutes: input.durationMinutes || 45,
    location: input.location || '',
    meetingLink: input.meetingLink || '',
    interviewerIds: input.interviewerIds,
    interviewerNames: input.interviewerNames || [],
    expectedFeedbackCount: input.interviewerIds.length,
    status: 'SCHEDULED',
    ...withCreateAudit(acting),
  });

  // The interview round the candidate has reached is part of the pipeline, so the board moves too.
  const stage: ApplicationStage =
    input.round === 'Final Round' || input.round === 'Director Round'
      ? 'FINAL_INTERVIEW'
      : roundNumber >= 2
        ? 'INTERVIEW_2'
        : 'INTERVIEW_1';

  await updateDoc(doc(db, HR_COLLECTIONS.applications, application.id), {
    interviewCount: roundNumber,
    stage,
    previousStage: application.stage,
    stagesReached: Array.from(new Set([...(application.stagesReached || [application.stage]), stage])),
    stageChangedAt: serverTimestamp(),
    stageChangedBy: acting.userId,
    ...withUpdateAudit(acting),
  });

  await logHrActivity({
    actor: acting,
    entityType: 'interview',
    entityId: ref.id,
    requirementId: application.requirementId,
    action: 'Interview scheduled',
    summary: `${input.round} for ${application.candidateName} on ${input.scheduledAt}`,
    newValue: { interviewers: input.interviewerIds, mode: input.mode },
  });

  const settings = await loadHrSettings(acting.organizationId);
  await notifyHr({
    event: 'interviewScheduled',
    settings,
    organizationId: acting.organizationId,
    recipients: { userIds: input.interviewerIds },
    title: `Interview scheduled: ${application.candidateName}`,
    body: `${input.round} on ${input.scheduledAt} (${input.mode}) for ${application.designation || 'a role'} — ${application.requirementNumber}.`,
    link: '/hr/interviews/my',
    itemId: ref.id,
    itemRef: interviewNumber,
  });

  await refreshRequirementCounters(application.requirementId);
  return { id: ref.id, interviewNumber };
}

export async function rescheduleInterview(
  interviewId: string,
  input: { scheduledAt: string; reason: string },
  actor: HrActor,
): Promise<void> {
  const acting = requireActor(actor);
  if (!input.reason?.trim()) throw new HrControlError('Enter a reason for rescheduling.');
  const snapshot = await getDoc(doc(db, HR_COLLECTIONS.interviews, interviewId));
  if (!snapshot.exists()) throw new HrControlError('Interview not found.');
  const interview = snapshot.data() as Interview;

  await updateDoc(doc(db, HR_COLLECTIONS.interviews, interviewId), {
    scheduledAt: input.scheduledAt,
    rescheduledFromAt: interview.scheduledAt,
    rescheduleReason: input.reason,
    status: 'RESCHEDULED',
    ...withUpdateAudit(acting),
  });

  await logHrActivity({
    actor: acting,
    entityType: 'interview',
    entityId: interviewId,
    requirementId: interview.requirementId,
    action: 'Interview rescheduled',
    summary: `${interview.round} for ${interview.candidateName} moved to ${input.scheduledAt}`,
    remarks: input.reason,
  });
}

export async function cancelInterview(interviewId: string, reason: string, actor: HrActor): Promise<void> {
  const acting = requireActor(actor);
  if (!reason?.trim()) throw new HrControlError('Enter a reason for cancelling.');
  const snapshot = await getDoc(doc(db, HR_COLLECTIONS.interviews, interviewId));
  if (!snapshot.exists()) throw new HrControlError('Interview not found.');
  const interview = snapshot.data() as Interview;

  await updateDoc(doc(db, HR_COLLECTIONS.interviews, interviewId), {
    status: 'CANCELLED',
    cancellationReason: reason,
    ...withUpdateAudit(acting),
  });

  await logHrActivity({
    actor: acting,
    entityType: 'interview',
    entityId: interviewId,
    requirementId: interview.requirementId,
    action: 'Interview cancelled',
    summary: `${interview.round} for ${interview.candidateName} cancelled`,
    remarks: reason,
  });
}

/**
 * Submits an interviewer's feedback (spec sections 25, 26; control rule 63.6).
 *
 * Append-only. A correction is written as a *new* document pointing at what it supersedes, with its
 * own author, timestamp and stated reason, and only when someone with the authority to allow it says
 * so. The original is never overwritten, so a panel's objection cannot be edited away after a
 * selection decision goes the other way.
 */
export async function submitInterviewFeedback(
  input: {
    interviewId: string;
    ratings: InterviewRatings;
    recommendation: InterviewRecommendation;
    strengths?: string;
    concerns?: string;
    comments?: string;
    /** Set when correcting an earlier submission; requires authorisation. */
    revisionOf?: string;
    revisionReason?: string;
  },
  actor: HrActor,
  options: { hasRevisePermission?: boolean } = {},
): Promise<{ id: string; score: number }> {
  const acting = requireActor(actor);
  const snapshot = await getDoc(doc(db, HR_COLLECTIONS.interviews, input.interviewId));
  if (!snapshot.exists()) throw new HrControlError('Interview not found.');
  const interview = { id: snapshot.id, ...snapshot.data() } as Interview;
  const settings = await loadHrSettings(acting.organizationId);

  if (!interview.interviewerIds?.includes(acting.userId) && !options.hasRevisePermission) {
    throw new HrControlError('Only a panel member can submit feedback for this interview.');
  }
  if (!input.recommendation) throw new HrControlError('Select your recommendation.');
  if (
    settings.interviews.requireCommentsOnRejection &&
    input.recommendation === 'Not Recommended' &&
    !input.comments?.trim()
  ) {
    throw new HrControlError('Comments are required when you do not recommend a candidate.');
  }

  const existingSnapshot = await getDocs(
    query(
      collection(db, HR_COLLECTIONS.interviewFeedback),
      where('interviewId', '==', input.interviewId),
      where('interviewerId', '==', acting.userId),
    ),
  );
  const existing = existingSnapshot.docs.map(entry => ({ id: entry.id, ...entry.data() }) as InterviewFeedback);
  const live = existing.filter(row => row.submitted && !existing.some(other => other.revisionOf === row.id));

  if (live.length > 0 && !input.revisionOf) {
    const guard = canReviseFeedback({
      submitted: true,
      isAuthor: true,
      hasRevisePermission: Boolean(options.hasRevisePermission),
      allowAuthorRevision: settings.interviews.allowAuthorFeedbackRevision,
    });
    throw new HrControlError(
      guard.allowed
        ? 'You have already submitted feedback. Submit a revision instead of a second evaluation.'
        : guard.reason,
    );
  }

  if (input.revisionOf) {
    const guard = canReviseFeedback({
      submitted: true,
      isAuthor: live.some(row => row.id === input.revisionOf),
      hasRevisePermission: Boolean(options.hasRevisePermission),
      allowAuthorRevision: settings.interviews.allowAuthorFeedbackRevision,
    });
    if (!guard.allowed) throw new HrControlError(guard.reason);
    if (!input.revisionReason?.trim()) throw new HrControlError('State why the feedback is being revised.');
  }

  const score = interviewFeedbackScore(input.ratings);
  const ref = await addDoc(collection(db, HR_COLLECTIONS.interviewFeedback), {
    organizationId: acting.organizationId,
    interviewId: interview.id,
    applicationId: interview.applicationId,
    requirementId: interview.requirementId,
    candidateId: interview.candidateId,
    interviewerId: acting.userId,
    interviewerName: acting.userName,
    ratings: input.ratings,
    score,
    recommendation: input.recommendation,
    strengths: input.strengths || '',
    concerns: input.concerns || '',
    comments: input.comments || '',
    submitted: true,
    submittedAt: serverTimestamp(),
    revisionOf: input.revisionOf || null,
    revisionNumber: input.revisionOf ? (live.length || 0) + 1 : 1,
    revisionReason: input.revisionReason || '',
    revisionAuthorisedBy: input.revisionOf ? acting.userId : '',
    ...withCreateAudit(acting),
  });

  await recomputeInterviewSummary(interview.id);

  await logHrActivity({
    actor: acting,
    entityType: 'feedback',
    entityId: ref.id,
    requirementId: interview.requirementId,
    action: input.revisionOf ? 'Feedback revised' : 'Feedback submitted',
    summary: `${acting.userName} — ${input.recommendation} for ${interview.candidateName} (${score}/5)`,
    remarks: input.revisionReason,
  });

  return { id: ref.id, score };
}

/**
 * Recomputes an interview's panel summary from its feedback.
 *
 * Superseded revisions are dropped first, so a corrected evaluation counts once rather than twice —
 * otherwise a single revision would drag the panel average halfway back to the original score.
 */
export async function recomputeInterviewSummary(interviewId: string): Promise<void> {
  const [interviewSnapshot, feedbackSnapshot] = await Promise.all([
    getDoc(doc(db, HR_COLLECTIONS.interviews, interviewId)),
    getDocs(query(collection(db, HR_COLLECTIONS.interviewFeedback), where('interviewId', '==', interviewId))),
  ]);
  if (!interviewSnapshot.exists()) return;
  const interview = interviewSnapshot.data() as Interview;

  const all = feedbackSnapshot.docs.map(entry => ({ id: entry.id, ...entry.data() }) as InterviewFeedback);
  const superseded = new Set(all.map(row => row.revisionOf).filter(Boolean) as string[]);
  const effective = all.filter(row => !superseded.has(row.id));

  const summary = summarizePanelFeedback(
    effective.map(row => ({ ratings: row.ratings, recommendation: row.recommendation, submitted: row.submitted })),
    interview.expectedFeedbackCount,
  );

  await updateDoc(doc(db, HR_COLLECTIONS.interviews, interviewId), {
    averageScore: summary.averageScore,
    panelRecommendation: summary.panelRecommendation,
    hasDissent: summary.hasDissent,
    status: summary.pendingCount === 0 ? 'COMPLETED' : 'FEEDBACK_PENDING',
    completedAt: summary.pendingCount === 0 ? serverTimestamp() : null,
  });

  await updateDoc(doc(db, HR_COLLECTIONS.applications, interview.applicationId), {
    latestInterviewScore: summary.averageScore,
    panelRecommendation: summary.panelRecommendation,
  });
}

/* ------------------------------------------------------------------------------------------------
 * Selection and compensation approval (spec sections 27, 28)
 * ---------------------------------------------------------------------------------------------- */

/**
 * Raises a selection proposal (spec section 27).
 *
 * Decides on the spot whether compensation approval is needed, from the grade band and the
 * configured tolerance, and records the variance that made the decision. A proposal inside the band
 * is marked NOT_REQUIRED rather than left blank, so the offer gate has a definite answer instead of
 * an absent one.
 */
export async function createSelectionProposal(
  input: {
    applicationId: string;
    proposedCtc: number;
    proposedJoiningDate?: string;
    noticePeriodDays?: number;
    relocationRequired?: boolean;
    relocationSupport?: string;
    specialConditions?: string;
  },
  actor: HrActor,
): Promise<{ id: string; proposalNumber: string; requiresCompensationApproval: boolean }> {
  const acting = requireActor(actor);
  const snapshot = await getDoc(doc(db, HR_COLLECTIONS.applications, input.applicationId));
  if (!snapshot.exists()) throw new HrControlError('Application not found.');
  const application = { id: snapshot.id, ...snapshot.data() } as CandidateApplication;

  const [requirement, candidateSnapshot, settings] = await Promise.all([
    loadRequirement(application.requirementId),
    getDoc(doc(db, HR_COLLECTIONS.candidates, application.candidateId)),
    loadHrSettings(acting.organizationId),
  ]);
  if (!requirement) throw new HrControlError('Requirement not found.');
  if (!isRecruitingStatus(requirement.status)) {
    throw new HrControlError('This requirement is not open for selection.');
  }
  const candidate = candidateSnapshot.exists() ? (candidateSnapshot.data() as Candidate) : null;
  if (!input.proposedCtc || input.proposedCtc <= 0) throw new HrControlError('Enter the proposed CTC.');

  const band = ctcBandForGrade(settings, requirement.grade);
  const bandMin = requirement.budget?.bandMin ?? band.min;
  const bandMax = requirement.budget?.bandMax ?? band.max;
  const evaluation = evaluateCtcAgainstBand({
    proposedCtc: input.proposedCtc,
    bandMin,
    bandMax,
    tolerancePercent: settings.compensation.tolerancePercent,
  });
  const requiresApproval =
    evaluation.requiresApproval || (settings.compensation.requireApprovalForBelowBand && evaluation.severity === 'Below band');

  const proposalNumber = await allocateHrNumber(acting.organizationId, 'selection');
  const ref = await addDoc(collection(db, HR_COLLECTIONS.selectionProposals), {
    organizationId: acting.organizationId,
    proposalNumber,
    requirementId: requirement.id,
    requirementNumber: requirement.requirementNumber,
    applicationId: application.id,
    candidateId: application.candidateId,
    candidateName: application.candidateName,
    designation: requirement.designation,
    grade: requirement.grade,
    departmentId: requirement.departmentId,
    departmentName: requirement.departmentName,
    projectId: requirement.projectId || '',
    projectName: requirement.projectName || '',
    locationId: requirement.locationId || '',
    location: requirement.location || '',
    reportingToId: requirement.reportingToId || '',
    reportingToName: requirement.reportingToName || '',
    currentCtc: candidate?.currentCtc || 0,
    expectedCtc: candidate?.expectedCtc || 0,
    proposedCtc: roundMoney(input.proposedCtc),
    increasePercent: ctcIncreasePercent(candidate?.currentCtc, input.proposedCtc),
    budgetedCtc: requirement.budget?.expectedCtc || 0,
    bandMin,
    bandMax,
    ctcVariancePercent: evaluation.variancePercent,
    ctcAboveBand: !evaluation.withinBand && evaluation.varianceAmount > 0,
    proposedJoiningDate: input.proposedJoiningDate || '',
    noticePeriodDays: input.noticePeriodDays ?? candidate?.noticePeriodDays ?? 0,
    relocationRequired: Boolean(input.relocationRequired),
    relocationSupport: input.relocationSupport || '',
    specialConditions: input.specialConditions || '',
    interviewScore: application.latestInterviewScore || 0,
    panelRecommendation: application.panelRecommendation || '',
    status: requiresApproval ? 'PENDING_COMPENSATION_APPROVAL' : 'APPROVED',
    compensationApprovalStatus: requiresApproval ? 'PENDING' : 'NOT_REQUIRED',
    approvedCtc: requiresApproval ? 0 : roundMoney(input.proposedCtc),
    approvedAt: requiresApproval ? null : serverTimestamp(),
    ...withCreateAudit(acting),
  });

  await updateDoc(doc(db, HR_COLLECTIONS.applications, application.id), {
    selectionProposalId: ref.id,
    stage: (requiresApproval ? 'COMPENSATION_APPROVAL' : 'SELECTED') satisfies ApplicationStage,
    previousStage: application.stage,
    stagesReached: Array.from(
      new Set([...(application.stagesReached || [application.stage]), 'SELECTED', ...(requiresApproval ? ['COMPENSATION_APPROVAL'] : [])]),
    ),
    stageChangedAt: serverTimestamp(),
    stageChangedBy: acting.userId,
    ...withUpdateAudit(acting),
  });

  if (requiresApproval) {
    await raiseCompensationApproval(ref.id, acting);
  }

  await logHrActivity({
    actor: acting,
    entityType: 'selection',
    entityId: ref.id,
    requirementId: requirement.id,
    action: 'Candidate selected',
    summary: `${application.candidateName} selected at ${hrCurrency(input.proposedCtc)}${
      requiresApproval ? ' — compensation approval required' : ''
    }`,
    newValue: { proposedCtc: input.proposedCtc, variancePercent: evaluation.variancePercent },
  });

  await notifyHr({
    event: 'candidateSelected',
    settings,
    organizationId: acting.organizationId,
    recipients: { userIds: [requirement.primaryRecruiterId, requirement.requestingManagerId, requirement.departmentHodId] },
    title: `Candidate selected: ${application.candidateName}`,
    body: `Selected for ${requirement.designation} on ${requirement.requirementNumber}.${
      requiresApproval ? ' Compensation approval is required before an offer can be released.' : ''
    }`,
    link: '/hr/selection',
    itemId: ref.id,
    itemRef: proposalNumber,
  });

  await refreshRequirementCounters(requirement.id);
  return { id: ref.id, proposalNumber, requiresCompensationApproval: requiresApproval };
}

/** Opens the compensation approval chain for a proposal (spec section 28). */
export async function raiseCompensationApproval(
  selectionProposalId: string,
  actor: HrActor,
  context: StageApproverContext = {},
): Promise<string> {
  const acting = requireActor(actor);
  const snapshot = await getDoc(doc(db, HR_COLLECTIONS.selectionProposals, selectionProposalId));
  if (!snapshot.exists()) throw new HrControlError('Selection proposal not found.');
  const proposal = { id: snapshot.id, ...snapshot.data() } as SelectionProposal;
  const settings = await loadHrSettings(acting.organizationId);

  const stages = settings.compensation.approvalStages || [];
  if (stages.length === 0) throw new HrControlError('No compensation approval chain is configured.');

  const resolutionContext: StageApproverContext = {
    ...context,
    departmentId: proposal.departmentId,
    projectId: proposal.projectId,
  };
  const firstIndex = stages.findIndex(stage => resolveStageApprovers(stage, resolutionContext).length > 0);
  if (firstIndex < 0) {
    throw new HrControlError('No approver is configured for compensation approval. Ask HR to complete the settings.');
  }
  const stage = stages[firstIndex];

  const ref = await addDoc(collection(db, HR_COLLECTIONS.compensationApprovals), {
    organizationId: acting.organizationId,
    requirementId: proposal.requirementId,
    selectionProposalId: proposal.id,
    candidateId: proposal.candidateId,
    candidateName: proposal.candidateName,
    proposedCtc: proposal.proposedCtc,
    budgetedCtc: proposal.budgetedCtc || 0,
    bandMax: proposal.bandMax || 0,
    variancePercent: proposal.ctcVariancePercent || 0,
    stages,
    stageIndex: firstIndex,
    currentStageKey: stage.key,
    currentStageLabel: stageLabel(stage),
    pendingApproverIds: resolveStageApprovers(stage, resolutionContext),
    status: 'PENDING',
    ...withCreateAudit(acting),
  });

  await updateDoc(doc(db, HR_COLLECTIONS.selectionProposals, proposal.id), {
    compensationApprovalId: ref.id,
    compensationApprovalStatus: 'PENDING',
    status: 'PENDING_COMPENSATION_APPROVAL',
    ...withUpdateAudit(acting),
  });

  await logHrActivity({
    actor: acting,
    entityType: 'compensation',
    entityId: ref.id,
    requirementId: proposal.requirementId,
    action: 'Compensation approval raised',
    summary: `${proposal.candidateName} at ${hrCurrency(proposal.proposedCtc)} — ${proposal.ctcVariancePercent || 0}% above band`,
  });

  await notifyHr({
    event: 'compensationApprovalRequired',
    settings,
    organizationId: acting.organizationId,
    recipients: { userIds: resolveStageApprovers(stage, resolutionContext) },
    title: `Compensation approval: ${proposal.candidateName}`,
    body: `${proposal.designation} at ${hrCurrency(proposal.proposedCtc)}, ${
      proposal.ctcVariancePercent || 0
    }% above the approved band.`,
    link: '/hr/selection',
    itemId: ref.id,
    itemRef: proposal.proposalNumber,
    severity: 'WARNING',
  });

  return ref.id;
}

/** Records a decision on a compensation approval (spec section 28). */
export async function actOnCompensationApproval(
  approvalId: string,
  action: 'Approve' | 'Reject',
  actor: HrActor,
  options: { approvedCtc?: number; remarks?: string; context?: StageApproverContext } = {},
): Promise<{ status: CompensationApproval['status']; stageLabel: string }> {
  const acting = requireActor(actor);
  const snapshot = await getDoc(doc(db, HR_COLLECTIONS.compensationApprovals, approvalId));
  if (!snapshot.exists()) throw new HrControlError('Compensation approval not found.');
  const approval = { id: snapshot.id, ...snapshot.data() } as CompensationApproval;

  if (approval.status !== 'PENDING') throw new HrControlError('This compensation approval has already been decided.');
  if (!(approval.pendingApproverIds || []).includes(acting.userId)) {
    throw new HrControlError('This approval is not assigned to you.');
  }
  if (action === 'Reject' && !options.remarks?.trim()) throw new HrControlError('Enter a reason for rejecting.');

  if (action === 'Reject') {
    await updateDoc(doc(db, HR_COLLECTIONS.compensationApprovals, approvalId), {
      status: 'REJECTED',
      pendingApproverIds: [],
      decidedAt: serverTimestamp(),
      decisionRemarks: options.remarks || '',
      ...withUpdateAudit(acting),
    });
    await updateDoc(doc(db, HR_COLLECTIONS.selectionProposals, approval.selectionProposalId), {
      compensationApprovalStatus: 'REJECTED',
      status: 'REJECTED',
      rejectionReason: options.remarks || '',
      ...withUpdateAudit(acting),
    });
    await logHrActivity({
      actor: acting,
      entityType: 'compensation',
      entityId: approvalId,
      requirementId: approval.requirementId,
      action: 'Compensation rejected',
      summary: `Compensation for ${approval.candidateName} rejected at ${approval.currentStageLabel}`,
      remarks: options.remarks,
    });
    return { status: 'REJECTED', stageLabel: '' };
  }

  /*
   * An approver may approve a *lower* figure than proposed — that is a negotiation outcome, not an
   * override — but never a higher one. Letting a stage raise the number would hand whoever sits
   * earliest in the chain an unbounded authority the matrix never granted.
   */
  const approvedCtc = options.approvedCtc !== undefined ? roundMoney(options.approvedCtc) : approval.proposedCtc;
  if (approvedCtc > approval.proposedCtc) {
    throw new HrControlError('The approved CTC cannot exceed the proposed CTC. Ask HR to revise the proposal.');
  }

  const stages = approval.stages || [];
  const resolutionContext: StageApproverContext = { ...(options.context || {}) };
  let nextIndex = -1;
  for (let index = (approval.stageIndex ?? 0) + 1; index < stages.length; index += 1) {
    if (resolveStageApprovers(stages[index], resolutionContext).length > 0) {
      nextIndex = index;
      break;
    }
  }

  if (nextIndex >= 0) {
    const stage = stages[nextIndex];
    await updateDoc(doc(db, HR_COLLECTIONS.compensationApprovals, approvalId), {
      stageIndex: nextIndex,
      currentStageKey: stage.key,
      currentStageLabel: stageLabel(stage),
      pendingApproverIds: resolveStageApprovers(stage, resolutionContext),
      approvedCtc,
      ...withUpdateAudit(acting),
    });
    await logHrActivity({
      actor: acting,
      entityType: 'compensation',
      entityId: approvalId,
      requirementId: approval.requirementId,
      action: 'Compensation approved at stage',
      summary: `${approval.currentStageLabel} approved ${hrCurrency(approvedCtc)} for ${approval.candidateName}; now with ${stageLabel(stage)}`,
      remarks: options.remarks,
    });
    await notifyHr({
      event: 'compensationApprovalRequired',
      settings: await loadHrSettings(acting.organizationId),
      organizationId: acting.organizationId,
      recipients: { userIds: resolveStageApprovers(stage, resolutionContext) },
      title: `Compensation approval: ${approval.candidateName}`,
      body: `${approval.currentStageLabel} has cleared ${hrCurrency(approvedCtc)}; it now needs your decision.`,
      link: '/hr/selection',
      itemId: approvalId,
      severity: 'WARNING',
    });
    return { status: 'PENDING', stageLabel: stageLabel(stage) };
  }

  await updateDoc(doc(db, HR_COLLECTIONS.compensationApprovals, approvalId), {
    status: 'APPROVED',
    approvedCtc,
    pendingApproverIds: [],
    decidedAt: serverTimestamp(),
    decisionRemarks: options.remarks || '',
    ...withUpdateAudit(acting),
  });
  await updateDoc(doc(db, HR_COLLECTIONS.selectionProposals, approval.selectionProposalId), {
    compensationApprovalStatus: 'APPROVED',
    status: 'APPROVED',
    approvedCtc,
    approvedAt: serverTimestamp(),
    ...withUpdateAudit(acting),
  });

  await logHrActivity({
    actor: acting,
    entityType: 'compensation',
    entityId: approvalId,
    requirementId: approval.requirementId,
    action: 'Compensation approved',
    summary: `Compensation for ${approval.candidateName} approved at ${hrCurrency(approvedCtc)}`,
    remarks: options.remarks,
  });

  const requirement = await loadRequirement(approval.requirementId);
  await notifyHr({
    event: 'compensationApprovalRequired',
    settings: await loadHrSettings(acting.organizationId),
    organizationId: acting.organizationId,
    recipients: { userIds: [requirement?.primaryRecruiterId], roles: ['HR Manager'] },
    title: `Compensation approved: ${approval.candidateName}`,
    body: `Approved at ${hrCurrency(approvedCtc)}. The offer can now be created.`,
    link: '/hr/offers',
    itemId: approvalId,
  });

  return { status: 'APPROVED', stageLabel: '' };
}

/* ------------------------------------------------------------------------------------------------
 * Offers (spec sections 29, 30)
 * ---------------------------------------------------------------------------------------------- */

/** A URL-safe token for the candidate's offer link (spec section 30). */
function offerPortalToken(): string {
  const bytes = new Uint8Array(24);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Creates an offer for a selected candidate (control rule 63.5).
 *
 * The CTC gate is checked here as well as in the UI: an offer above the approved compensation is the
 * one mistake in this module that costs real money every month for years, and the screen that
 * disables the button is not the thing that can be relied on.
 */
export async function createOffer(
  input: {
    selectionProposalId: string;
    offeredCtc: number;
    joiningDate: string;
    validUntil?: string;
    probationMonths?: number;
    joiningBonus?: number;
    ctcBreakup?: HrOffer['ctcBreakup'];
    employmentConditions?: string;
    specialConditions?: string;
    templateId?: string;
    letterHtml?: string;
  },
  actor: HrActor,
): Promise<{ id: string; offerNumber: string; status: HrOffer['status'] }> {
  const acting = requireActor(actor);
  const snapshot = await getDoc(doc(db, HR_COLLECTIONS.selectionProposals, input.selectionProposalId));
  if (!snapshot.exists()) throw new HrControlError('Selection proposal not found.');
  const proposal = { id: snapshot.id, ...snapshot.data() } as SelectionProposal;

  const [requirement, candidateSnapshot, settings] = await Promise.all([
    loadRequirement(proposal.requirementId),
    getDoc(doc(db, HR_COLLECTIONS.candidates, proposal.candidateId)),
    loadHrSettings(acting.organizationId),
  ]);
  if (!requirement) throw new HrControlError('Requirement not found.');
  if (isTerminalRequirementStatus(requirement.status)) {
    throw new HrControlError('This requirement is closed; no further offers can be released.');
  }
  const candidate = candidateSnapshot.exists() ? (candidateSnapshot.data() as Candidate) : null;

  const gate = canReleaseOffer({
    proposedCtc: input.offeredCtc,
    approvedCtc: proposal.approvedCtc,
    bandMax: proposal.bandMax,
    compensationApprovalStatus: proposal.compensationApprovalStatus,
    tolerancePercent: settings.compensation.tolerancePercent,
  });
  if (!gate.allowed) throw new HrControlError(gate.reason);
  if (!input.joiningDate) throw new HrControlError('Enter the joining date.');

  const validUntil =
    input.validUntil ||
    (() => {
      const date = new Date();
      date.setDate(date.getDate() + (settings.offers.defaultValidityDays || 7));
      return date.toISOString().slice(0, 10);
    })();

  const financialYear = financialYearForHrDate();
  const requireApproval = settings.offers.requireOfferApproval;
  const approvalStages = requireApproval ? settings.offers.approvalStages || [] : [];
  const pendingApproverIds = requireApproval
    ? approvalStages.flatMap(stage => resolveStageApprovers(stage, { departmentId: requirement.departmentId, projectId: requirement.projectId }))
    : [];

  const created = await runTransaction(db, async transaction => {
    const offerNumber = await nextHrNumber(transaction, { organizationId: acting.organizationId, kind: 'offer', financialYear });
    const ref = doc(collection(db, HR_COLLECTIONS.offers));
    transaction.set(ref, {
      organizationId: acting.organizationId,
      offerNumber,
      requirementId: requirement.id,
      requirementNumber: requirement.requirementNumber,
      applicationId: proposal.applicationId,
      candidateId: proposal.candidateId,
      candidateName: proposal.candidateName,
      candidateEmail: candidate?.email || '',
      candidateMobile: candidate?.mobile || '',
      selectionProposalId: proposal.id,
      designation: proposal.designation,
      jobTitle: requirement.jobTitle,
      grade: proposal.grade,
      departmentId: proposal.departmentId || '',
      departmentName: proposal.departmentName || '',
      projectId: proposal.projectId || '',
      projectName: proposal.projectName || '',
      locationId: proposal.locationId || '',
      location: proposal.location || '',
      reportingToId: proposal.reportingToId || '',
      reportingToName: proposal.reportingToName || '',
      employmentType: requirement.employmentType,
      offeredCtc: roundMoney(input.offeredCtc),
      ctcBreakup: input.ctcBreakup || [],
      joiningBonus: roundMoney(input.joiningBonus || 0),
      probationMonths: input.probationMonths ?? 6,
      employmentConditions: input.employmentConditions || '',
      specialConditions: input.specialConditions || proposal.specialConditions || '',
      joiningDate: input.joiningDate,
      validUntil,
      templateId: input.templateId || '',
      letterHtml: input.letterHtml || '',
      status: (requireApproval ? 'PENDING_APPROVAL' : 'APPROVED') satisfies HrOffer['status'],
      approvalStages,
      approvalStageIndex: 0,
      pendingApproverIds,
      ...withCreateAudit(acting),
    });
    return { id: ref.id, offerNumber, status: (requireApproval ? 'PENDING_APPROVAL' : 'APPROVED') as HrOffer['status'] };
  });

  await updateDoc(doc(db, HR_COLLECTIONS.selectionProposals, proposal.id), {
    status: 'OFFERED',
    ...withUpdateAudit(acting),
  });
  await updateDoc(doc(db, HR_COLLECTIONS.applications, proposal.applicationId), {
    offerId: created.id,
    ...withUpdateAudit(acting),
  });

  await logHrActivity({
    actor: acting,
    entityType: 'offer',
    entityId: created.id,
    requirementId: requirement.id,
    action: 'Offer created',
    summary: `${created.offerNumber} for ${proposal.candidateName} at ${hrCurrency(input.offeredCtc)}, joining ${input.joiningDate}`,
  });

  return created;
}

export async function approveOffer(offerId: string, actor: HrActor, remarks?: string): Promise<void> {
  const acting = requireActor(actor);
  const snapshot = await getDoc(doc(db, HR_COLLECTIONS.offers, offerId));
  if (!snapshot.exists()) throw new HrControlError('Offer not found.');
  const offer = snapshot.data() as HrOffer;
  if (offer.status !== 'PENDING_APPROVAL') throw new HrControlError('This offer is not awaiting approval.');
  if ((offer.pendingApproverIds || []).length > 0 && !offer.pendingApproverIds!.includes(acting.userId)) {
    throw new HrControlError('This offer approval is not assigned to you.');
  }

  await updateDoc(doc(db, HR_COLLECTIONS.offers, offerId), {
    status: 'APPROVED' satisfies HrOffer['status'],
    approvedBy: acting.userId,
    approvedByName: acting.userName,
    approvedAt: serverTimestamp(),
    pendingApproverIds: [],
    ...withUpdateAudit(acting),
  });

  await logHrActivity({
    actor: acting,
    entityType: 'offer',
    entityId: offerId,
    requirementId: offer.requirementId,
    action: 'Offer approved',
    summary: `${offer.offerNumber} approved for ${offer.candidateName}`,
    remarks,
  });

  const requirement = await loadRequirement(offer.requirementId);
  await notifyHr({
    event: 'offerApproved',
    settings: await loadHrSettings(acting.organizationId),
    organizationId: acting.organizationId,
    recipients: { userIds: [requirement?.primaryRecruiterId], roles: ['HR Manager'] },
    title: `Offer approved: ${offer.candidateName}`,
    body: `${offer.offerNumber} for ${offer.designation} is approved and can be sent.`,
    link: '/hr/offers',
    itemId: offerId,
    itemRef: offer.offerNumber,
  });
}

/**
 * Releases the offer to the candidate and moves the pipeline to OFFERED.
 *
 * Mints the portal token here rather than at creation, so a draft offer that is revised or abandoned
 * never leaves a live acceptance link behind it (spec section 30).
 */
export async function sendOffer(
  offerId: string,
  actor: HrActor,
  options: { toEmail?: string; letterUrl?: string } = {},
): Promise<{ portalToken: string }> {
  const acting = requireActor(actor);
  const snapshot = await getDoc(doc(db, HR_COLLECTIONS.offers, offerId));
  if (!snapshot.exists()) throw new HrControlError('Offer not found.');
  const offer = { id: snapshot.id, ...snapshot.data() } as HrOffer;
  if (offer.status !== 'APPROVED') throw new HrControlError('Only an approved offer can be sent.');

  const settings = await loadHrSettings(acting.organizationId);
  const token = offerPortalToken();
  const expires = new Date();
  expires.setDate(expires.getDate() + (settings.offers.portalTokenValidityDays || 15));

  await updateDoc(doc(db, HR_COLLECTIONS.offers, offerId), {
    status: 'SENT' satisfies HrOffer['status'],
    sentAt: serverTimestamp(),
    sentToEmail: options.toEmail || offer.candidateEmail || '',
    letterUrl: options.letterUrl || offer.letterUrl || '',
    portalToken: token,
    portalTokenExpiresAt: expires,
    ...withUpdateAudit(acting),
  });

  await updateDoc(doc(db, HR_COLLECTIONS.applications, offer.applicationId), {
    stage: 'OFFERED' satisfies ApplicationStage,
    stageChangedAt: serverTimestamp(),
    stageChangedBy: acting.userId,
    ...withUpdateAudit(acting),
  });

  await logHrActivity({
    actor: acting,
    entityType: 'offer',
    entityId: offerId,
    requirementId: offer.requirementId,
    action: 'Offer sent',
    summary: `${offer.offerNumber} sent to ${offer.candidateName}`,
  });

  await refreshRequirementCounters(offer.requirementId);
  return { portalToken: token };
}

/**
 * Records the candidate's acceptance (spec sections 30, 31).
 *
 * Acceptance is what creates the pre-joining checklist and the joining record, in one call, because
 * an accepted offer with no checklist behind it is how a candidate arrives on their first day with
 * nothing collected. The joining record is the thing that will later create the employee (§35).
 */
export async function acceptOffer(
  offerId: string,
  input: { declaration?: string; signedOfferUrl?: string; acceptanceIp?: string; joiningDate?: string },
  actor: HrActor,
): Promise<{ joiningRecordId: string; documentsCreated: number }> {
  const acting = requireActor(actor);
  const snapshot = await getDoc(doc(db, HR_COLLECTIONS.offers, offerId));
  if (!snapshot.exists()) throw new HrControlError('Offer not found.');
  const offer = { id: snapshot.id, ...snapshot.data() } as HrOffer;

  if (!LIVE_OFFER_STATUSES.includes(offer.status)) {
    throw new HrControlError(`An offer in ${offer.status.toLowerCase().replace(/_/g, ' ')} cannot be accepted.`);
  }
  if (offer.status === 'ACCEPTED') throw new HrControlError('This offer has already been accepted.');

  const settings = await loadHrSettings(acting.organizationId);
  if (settings.offers.requireSignedCopy && !input.signedOfferUrl) {
    throw new HrControlError('A signed copy of the offer is required.');
  }

  const joiningDate = input.joiningDate || offer.joiningDate;
  const financialYear = financialYearForHrDate();

  const joiningRecordId = await runTransaction(db, async transaction => {
    const joiningNumber = await nextHrNumber(transaction, { organizationId: acting.organizationId, kind: 'joining', financialYear });
    const ref = doc(collection(db, HR_COLLECTIONS.joiningRecords));
    transaction.set(ref, {
      organizationId: acting.organizationId,
      joiningNumber,
      requirementId: offer.requirementId,
      requirementNumber: offer.requirementNumber || '',
      applicationId: offer.applicationId,
      candidateId: offer.candidateId,
      candidateName: offer.candidateName,
      offerId: offer.id,
      designation: offer.designation,
      grade: offer.grade,
      departmentId: offer.departmentId || '',
      departmentName: offer.departmentName || '',
      projectId: offer.projectId || '',
      projectName: offer.projectName || '',
      locationId: offer.locationId || '',
      location: offer.location || '',
      reportingToId: offer.reportingToId || '',
      reportingToName: offer.reportingToName || '',
      employmentType: offer.employmentType,
      ctc: offer.offeredCtc,
      plannedJoiningDate: joiningDate,
      status: 'DOCUMENTS_PENDING' satisfies JoiningRecord['status'],
      documentsReady: false,
      documentCompletionPercent: 0,
      remindersSent: [],
      onboarding: {},
      ...withCreateAudit(acting),
    });
    return ref.id;
  });

  await updateDoc(doc(db, HR_COLLECTIONS.offers, offerId), {
    status: 'ACCEPTED' satisfies HrOffer['status'],
    respondedAt: serverTimestamp(),
    acceptanceDeclaration: input.declaration || '',
    acceptanceIp: input.acceptanceIp || '',
    signedOfferUrl: input.signedOfferUrl || '',
    joiningDate,
    // The link has done its job; leaving it live is an open door to the offer record.
    portalToken: '',
    ...withUpdateAudit(acting),
  });

  await updateDoc(doc(db, HR_COLLECTIONS.applications, offer.applicationId), {
    stage: 'OFFER_ACCEPTED' satisfies ApplicationStage,
    stageChangedAt: serverTimestamp(),
    stageChangedBy: acting.userId,
    joiningRecordId,
    ...withUpdateAudit(acting),
  });

  const documentsCreated = await generatePreJoiningChecklist(
    { offerId: offer.id, joiningRecordId, employmentType: offer.employmentType },
    acting,
  );

  await logHrActivity({
    actor: acting,
    entityType: 'offer',
    entityId: offerId,
    requirementId: offer.requirementId,
    action: 'Offer accepted',
    summary: `${offer.candidateName} accepted ${offer.offerNumber}; joining ${joiningDate}`,
  });

  const requirement = await loadRequirement(offer.requirementId);
  await notifyHr({
    event: 'offerAccepted',
    settings,
    organizationId: acting.organizationId,
    recipients: {
      userIds: [requirement?.primaryRecruiterId, requirement?.requestingManagerId],
      roles: ['HR Manager'],
    },
    title: `Offer accepted: ${offer.candidateName}`,
    body: `Joining ${joiningDate} as ${offer.designation}. ${documentsCreated} pre-joining documents are now due.`,
    link: '/hr/pre-joining',
    itemId: offerId,
    itemRef: offer.offerNumber,
  });

  await refreshRequirementCounters(offer.requirementId);
  return { joiningRecordId, documentsCreated };
}

export async function rejectOffer(offerId: string, reason: string, actor: HrActor): Promise<void> {
  const acting = requireActor(actor);
  if (!reason?.trim()) throw new HrControlError('Enter the reason the offer was declined.');
  const snapshot = await getDoc(doc(db, HR_COLLECTIONS.offers, offerId));
  if (!snapshot.exists()) throw new HrControlError('Offer not found.');
  const offer = { id: snapshot.id, ...snapshot.data() } as HrOffer;

  await updateDoc(doc(db, HR_COLLECTIONS.offers, offerId), {
    status: 'REJECTED' satisfies HrOffer['status'],
    respondedAt: serverTimestamp(),
    rejectionReason: reason,
    portalToken: '',
    ...withUpdateAudit(acting),
  });

  await updateDoc(doc(db, HR_COLLECTIONS.applications, offer.applicationId), {
    stage: 'OFFER_REJECTED' satisfies ApplicationStage,
    stageChangedAt: serverTimestamp(),
    stageChangedBy: acting.userId,
    exitReason: 'Offer declined',
    exitRemarks: reason,
    exitedAt: serverTimestamp(),
    ...withUpdateAudit(acting),
  });

  await logHrActivity({
    actor: acting,
    entityType: 'offer',
    entityId: offerId,
    requirementId: offer.requirementId,
    action: 'Offer rejected',
    summary: `${offer.candidateName} declined ${offer.offerNumber}`,
    remarks: reason,
  });

  const requirement = await loadRequirement(offer.requirementId);
  await notifyHr({
    event: 'offerRejected',
    settings: await loadHrSettings(acting.organizationId),
    organizationId: acting.organizationId,
    recipients: {
      userIds: [requirement?.primaryRecruiterId, requirement?.requestingManagerId],
      roles: ['HR Manager', 'HR Head'],
    },
    title: `Offer declined: ${offer.candidateName}`,
    body: `${offer.offerNumber} for ${offer.designation} was declined. Reason: ${reason}`,
    link: `/hr/requirements/${offer.requirementId}`,
    itemId: offerId,
    itemRef: offer.offerNumber,
    severity: 'WARNING',
  });

  await refreshRequirementCounters(offer.requirementId);
}

export async function withdrawOffer(offerId: string, reason: string, actor: HrActor): Promise<void> {
  const acting = requireActor(actor);
  if (!reason?.trim()) throw new HrControlError('Enter the reason for withdrawing the offer.');
  const snapshot = await getDoc(doc(db, HR_COLLECTIONS.offers, offerId));
  if (!snapshot.exists()) throw new HrControlError('Offer not found.');
  const offer = { id: snapshot.id, ...snapshot.data() } as HrOffer;
  if (offer.status === 'ACCEPTED') {
    throw new HrControlError('An accepted offer cannot be withdrawn here. Cancel the joining instead.');
  }

  await updateDoc(doc(db, HR_COLLECTIONS.offers, offerId), {
    status: 'WITHDRAWN' satisfies HrOffer['status'],
    withdrawalReason: reason,
    portalToken: '',
    ...withUpdateAudit(acting),
  });

  await logHrActivity({
    actor: acting,
    entityType: 'offer',
    entityId: offerId,
    requirementId: offer.requirementId,
    action: 'Offer withdrawn',
    summary: `${offer.offerNumber} withdrawn`,
    remarks: reason,
  });

  await refreshRequirementCounters(offer.requirementId);
}

/* ------------------------------------------------------------------------------------------------
 * Pre-joining (spec sections 31–33)
 * ---------------------------------------------------------------------------------------------- */

/** Creates the checklist for an accepted offer (spec section 31). */
export async function generatePreJoiningChecklist(
  input: { offerId: string; joiningRecordId: string; employmentType?: HrOffer['employmentType'] },
  actor: HrActor,
): Promise<number> {
  const acting = requireActor(actor);
  const [offerSnapshot, settings] = await Promise.all([
    getDoc(doc(db, HR_COLLECTIONS.offers, input.offerId)),
    loadHrSettings(acting.organizationId),
  ]);
  if (!offerSnapshot.exists()) throw new HrControlError('Offer not found.');
  const offer = { id: offerSnapshot.id, ...offerSnapshot.data() } as HrOffer;

  const applicable = (settings.documents.checklist || []).filter(
    item => !item.appliesTo?.length || item.appliesTo.includes(input.employmentType || offer.employmentType),
  );
  if (applicable.length === 0) return 0;

  const batch = writeBatch(db);
  for (const item of applicable) {
    batch.set(doc(collection(db, HR_COLLECTIONS.preJoining)), {
      organizationId: acting.organizationId,
      requirementId: offer.requirementId,
      applicationId: offer.applicationId,
      candidateId: offer.candidateId,
      offerId: offer.id,
      joiningRecordId: input.joiningRecordId,
      documentType: item.documentType,
      mandatory: item.mandatory !== false,
      status: 'PENDING' satisfies DocumentVerificationStatus,
      ...withCreateAudit(acting),
    });
  }
  await batch.commit();
  return applicable.length;
}

export async function recordDocumentUpload(
  documentId: string,
  input: { fileUrl: string; fileName?: string },
  actor: HrActor,
): Promise<void> {
  const acting = requireActor(actor);
  if (!input.fileUrl) throw new HrControlError('Upload the document first.');
  const snapshot = await getDoc(doc(db, HR_COLLECTIONS.preJoining, documentId));
  if (!snapshot.exists()) throw new HrControlError('Checklist item not found.');
  const item = snapshot.data() as PreJoiningDocument;

  await updateDoc(doc(db, HR_COLLECTIONS.preJoining, documentId), {
    status: 'UPLOADED' satisfies DocumentVerificationStatus,
    fileUrl: input.fileUrl,
    fileName: input.fileName || '',
    uploadedAt: serverTimestamp(),
    uploadedBy: acting.userId,
    verificationRemarks: '',
    ...withUpdateAudit(acting),
  });

  if (item.joiningRecordId) await refreshJoiningDocumentState(item.joiningRecordId);
}

/** Verifies, rejects or waives a checklist item (spec section 32). */
export async function verifyDocument(
  documentId: string,
  input: { status: Extract<DocumentVerificationStatus, 'VERIFIED' | 'REJECTED' | 'REUPLOAD_REQUIRED' | 'WAIVED' | 'UNDER_VERIFICATION'>; remarks?: string },
  actor: HrActor,
): Promise<void> {
  const acting = requireActor(actor);
  const snapshot = await getDoc(doc(db, HR_COLLECTIONS.preJoining, documentId));
  if (!snapshot.exists()) throw new HrControlError('Checklist item not found.');
  const item = snapshot.data() as PreJoiningDocument;

  const needsRemarks: DocumentVerificationStatus[] = ['REJECTED', 'REUPLOAD_REQUIRED', 'WAIVED'];
  if (needsRemarks.includes(input.status) && !input.remarks?.trim()) {
    throw new HrControlError('Enter a remark explaining this decision.');
  }

  await updateDoc(doc(db, HR_COLLECTIONS.preJoining, documentId), {
    status: input.status,
    verifiedBy: acting.userId,
    verifiedByName: acting.userName,
    verifiedAt: serverTimestamp(),
    verificationRemarks: input.remarks || '',
    ...(input.status === 'WAIVED' ? { waiverReason: input.remarks || '' } : {}),
    ...withUpdateAudit(acting),
  });

  if (item.joiningRecordId) await refreshJoiningDocumentState(item.joiningRecordId);

  await logHrActivity({
    actor: acting,
    entityType: 'preJoining',
    entityId: documentId,
    requirementId: item.requirementId,
    action: `Document ${input.status.toLowerCase().replace(/_/g, ' ')}`,
    summary: `${item.documentType} — ${input.status.toLowerCase().replace(/_/g, ' ')}`,
    remarks: input.remarks,
  });
}

/** Recomputes a joining record's document readiness from its checklist. */
export async function refreshJoiningDocumentState(joiningRecordId: string): Promise<void> {
  const [joiningSnapshot, documentSnapshot] = await Promise.all([
    getDoc(doc(db, HR_COLLECTIONS.joiningRecords, joiningRecordId)),
    getDocs(query(collection(db, HR_COLLECTIONS.preJoining), where('joiningRecordId', '==', joiningRecordId))),
  ]);
  if (!joiningSnapshot.exists()) return;
  const joining = joiningSnapshot.data() as JoiningRecord;

  const summary = summarizeDocumentChecklist(
    documentSnapshot.docs.map(entry => {
      const data = entry.data() as PreJoiningDocument;
      return { status: data.status, mandatory: data.mandatory };
    }),
  );

  // Only the pre-joining statuses move on document progress; a joined or cancelled record stays put.
  const movableStatuses: JoiningRecord['status'][] = ['DOCUMENTS_PENDING', 'CONFIRMATION_PENDING', 'CONFIRMED'];
  const status: JoiningRecord['status'] = !movableStatuses.includes(joining.status)
    ? joining.status
    : summary.readyForJoining
      ? joining.status === 'CONFIRMED'
        ? 'CONFIRMED'
        : 'CONFIRMATION_PENDING'
      : 'DOCUMENTS_PENDING';

  await updateDoc(doc(db, HR_COLLECTIONS.joiningRecords, joiningRecordId), {
    documentsReady: summary.readyForJoining,
    documentCompletionPercent: summary.completionPercent,
    status,
  });
}

/* ------------------------------------------------------------------------------------------------
 * Joining and employee creation (spec sections 34–37)
 * ---------------------------------------------------------------------------------------------- */

/**
 * Confirms a joining and creates the employee record (spec sections 35, 36).
 *
 * This is the module's most consequential write, so it is the most conservative. In one transaction
 * it allocates the employee code, writes the employee, marks the joining JOINED and increments the
 * requirement's joined count — because a candidate who became an employee while the requirement kept
 * showing a vacancy, or an employee code allocated twice, are both corruptions no report can undo.
 *
 * Control rule 63.7: exactly one candidate becomes exactly one employee here, which is what keeps
 * headcount and the employee master from drifting apart.
 */
export async function confirmJoining(
  joiningRecordId: string,
  input: {
    actualJoiningDate: string;
    employeeCode?: string;
    /** Anything the candidate master could not supply — bank, PAN, UAN, address. */
    employeeExtras?: Record<string, unknown>;
  },
  actor: HrActor,
): Promise<{ employeeId: string; employeeCode: string }> {
  const acting = requireActor(actor);
  const [joiningSnapshot, settings] = await Promise.all([
    getDoc(doc(db, HR_COLLECTIONS.joiningRecords, joiningRecordId)),
    loadHrSettings(acting.organizationId),
  ]);
  if (!joiningSnapshot.exists()) throw new HrControlError('Joining record not found.');
  const joining = { id: joiningSnapshot.id, ...joiningSnapshot.data() } as JoiningRecord;

  if (joining.status === 'JOINED') throw new HrControlError('This candidate has already been marked joined.');
  if (['NOT_JOINED', 'OFFER_CANCELLED'].includes(joining.status)) {
    throw new HrControlError('This joining was cancelled and cannot be confirmed.');
  }
  if (!input.actualJoiningDate) throw new HrControlError('Enter the actual joining date.');

  if (settings.documents.blockJoiningOnPendingDocuments && !joining.documentsReady) {
    throw new HrControlError('Mandatory pre-joining documents are still outstanding.');
  }

  const [candidateSnapshot, requirement] = await Promise.all([
    getDoc(doc(db, HR_COLLECTIONS.candidates, joining.candidateId)),
    loadRequirement(joining.requirementId),
  ]);
  const candidate = candidateSnapshot.exists() ? (candidateSnapshot.data() as Candidate) : null;
  if (!requirement) throw new HrControlError('Requirement not found.');

  const result = await runTransaction(db, async transaction => {
    // Reads first: Firestore requires every read in a transaction to precede every write.
    const requirementRef = doc(db, HR_COLLECTIONS.requirements, joining.requirementId);
    const requirementDoc = await transaction.get(requirementRef);
    if (!requirementDoc.exists()) throw new HrControlError('Requirement not found.');

    const employeeCode =
      input.employeeCode?.trim() ||
      (await nextEmployeeCode(transaction, acting.organizationId, {
        prefix: settings.general.employeeCodePrefix,
        start: settings.general.employeeCodeStart,
        width: settings.general.employeeCodeWidth,
      }));

    const employeeRef = doc(collection(db, 'employees'));

    /*
     * Written additively over the existing employee master's shape (employeeNo, name, department,
     * designation, status, dateOfJoin…) so the Employee module's screens keep working unchanged,
     * with the recruitment-specific fields alongside. The extra fields are what Payroll and
     * Attendance will need in section 36; nothing existing is renamed or moved.
     */
    transaction.set(employeeRef, {
      employeeId: employeeCode,
      employeeNo: employeeCode,
      name: joining.candidateName,
      email: candidate?.email || '',
      phone: candidate?.mobile || '',
      department: joining.departmentName || '',
      departmentId: joining.departmentId || '',
      designation: joining.designation,
      grade: joining.grade || '',
      status: 'Active',
      dateOfJoin: input.actualJoiningDate,
      dateOfBirth: candidate?.dateOfBirth || '',
      gender: candidate?.gender || '',
      projectId: joining.projectId || '',
      projectName: joining.projectName || '',
      locationId: joining.locationId || '',
      location: joining.location || '',
      reportingToId: joining.reportingToId || '',
      reportingToName: joining.reportingToName || '',
      employmentType: joining.employmentType || '',
      ctc: joining.ctc || 0,
      pan: candidate?.pan || '',
      organizationId: acting.organizationId,
      // Provenance, so an employee record can always be traced back to how it was hired.
      sourceCandidateId: joining.candidateId,
      sourceRequirementId: joining.requirementId,
      sourceRequirementNumber: joining.requirementNumber || requirement.requirementNumber,
      sourceJoiningRecordId: joining.id,
      ...(input.employeeExtras || {}),
      ...withCreateAudit(acting),
    });

    transaction.update(doc(db, HR_COLLECTIONS.joiningRecords, joiningRecordId), {
      status: 'JOINED' satisfies JoiningRecord['status'],
      actualJoiningDate: input.actualJoiningDate,
      employeeId: employeeRef.id,
      employeeCode,
      employeeCreatedAt: serverTimestamp(),
      onboarding: { ...(joining.onboarding || {}), employeeMasterCreated: true },
      confirmedBy: acting.userId,
      confirmedByName: acting.userName,
      confirmedAt: serverTimestamp(),
      ...withUpdateAudit(acting),
    });

    const previousJoined = Number(requirementDoc.data()?.joinedCount) || 0;
    transaction.update(requirementRef, { joinedCount: previousJoined + 1 });

    return { employeeId: employeeRef.id, employeeCode };
  });

  await updateDoc(doc(db, HR_COLLECTIONS.applications, joining.applicationId), {
    stage: 'JOINED' satisfies ApplicationStage,
    stageChangedAt: serverTimestamp(),
    stageChangedBy: acting.userId,
    ...withUpdateAudit(acting),
  });

  if (candidate) {
    await updateDoc(doc(db, HR_COLLECTIONS.candidates, joining.candidateId), {
      employeeId: result.employeeId,
      inTalentPool: false,
      ...withUpdateAudit(acting),
    });
  }

  await logHrActivity({
    actor: acting,
    entityType: 'joining',
    entityId: joiningRecordId,
    requirementId: joining.requirementId,
    action: 'Candidate joined',
    summary: `${joining.candidateName} joined as ${joining.designation} (${result.employeeCode}) on ${input.actualJoiningDate}`,
    newValue: { employeeId: result.employeeId, employeeCode: result.employeeCode },
  });

  await notifyHr({
    event: 'candidateJoined',
    settings,
    organizationId: acting.organizationId,
    recipients: {
      userIds: [requirement.primaryRecruiterId, requirement.requestingManagerId, requirement.reportingToId],
      roles: ['HR Manager', 'HR Head'],
    },
    title: `${joining.candidateName} has joined`,
    body: `${joining.designation}${joining.projectName ? ` at ${joining.projectName}` : ''}, employee code ${
      result.employeeCode
    }. Payroll, attendance and induction are now due.`,
    link: '/hr/joining',
    itemId: joiningRecordId,
    itemRef: result.employeeCode,
  });

  // Section 49's "requirement fulfilled" event — the last seat filled is worth telling people about.
  const afterJoining = await refreshRequirementCounters(joining.requirementId);
  if (afterJoining) {
    const fill = summarizeRequirementFill({
      requestedQuantity: afterJoining.requestedQuantity,
      joinedCount: afterJoining.joinedCount,
      cancelledPositions: afterJoining.cancelledPositions,
    });
    if (fill.recommendClosure) {
      await notifyHr({
        event: 'requirementFulfilled',
        settings,
        organizationId: acting.organizationId,
        recipients: {
          userIds: [requirement.primaryRecruiterId, requirement.requestingManagerId, requirement.departmentHodId],
          roles: ['HR Head'],
        },
        title: `Requirement fulfilled: ${requirement.requirementNumber}`,
        body: `All ${fill.effectiveRequired} positions for ${requirement.designation} have joined. The requirement can be closed.`,
        link: `/hr/requirements/${joining.requirementId}`,
        itemId: joining.requirementId,
        itemRef: requirement.requirementNumber,
      });
    }
  }

  return result;
}

export async function postponeJoining(
  joiningRecordId: string,
  input: { revisedJoiningDate: string; reason: string },
  actor: HrActor,
): Promise<void> {
  const acting = requireActor(actor);
  if (!input.revisedJoiningDate) throw new HrControlError('Enter the revised joining date.');
  if (!input.reason?.trim()) throw new HrControlError('Enter the reason for postponing.');

  const snapshot = await getDoc(doc(db, HR_COLLECTIONS.joiningRecords, joiningRecordId));
  if (!snapshot.exists()) throw new HrControlError('Joining record not found.');
  const joining = snapshot.data() as JoiningRecord;
  if (joining.status === 'JOINED') throw new HrControlError('This candidate has already joined.');

  await updateDoc(doc(db, HR_COLLECTIONS.joiningRecords, joiningRecordId), {
    status: 'POSTPONED' satisfies JoiningRecord['status'],
    revisedJoiningDate: input.revisedJoiningDate,
    postponementReason: input.reason,
    // The reminder ladder has to run again against the new date (spec section 33).
    remindersSent: [],
    ...withUpdateAudit(acting),
  });

  await logHrActivity({
    actor: acting,
    entityType: 'joining',
    entityId: joiningRecordId,
    requirementId: joining.requirementId,
    action: 'Joining postponed',
    summary: `${joining.candidateName} postponed to ${input.revisedJoiningDate}`,
    remarks: input.reason,
  });
}

/** Records a no-show or a cancelled joining (spec section 34). */
export async function markNotJoined(
  joiningRecordId: string,
  input: { reason: string; outcome: 'NOT_JOINED' | 'OFFER_CANCELLED' },
  actor: HrActor,
): Promise<void> {
  const acting = requireActor(actor);
  if (!input.reason?.trim()) throw new HrControlError('Enter the reason.');
  const snapshot = await getDoc(doc(db, HR_COLLECTIONS.joiningRecords, joiningRecordId));
  if (!snapshot.exists()) throw new HrControlError('Joining record not found.');
  const joining = snapshot.data() as JoiningRecord;
  if (joining.status === 'JOINED') throw new HrControlError('This candidate has already joined.');

  await updateDoc(doc(db, HR_COLLECTIONS.joiningRecords, joiningRecordId), {
    status: input.outcome,
    notJoinedReason: input.reason,
    ...withUpdateAudit(acting),
  });

  await updateDoc(doc(db, HR_COLLECTIONS.applications, joining.applicationId), {
    stage: (input.outcome === 'NOT_JOINED' ? 'NO_SHOW' : 'WITHDRAWN') satisfies ApplicationStage,
    stageChangedAt: serverTimestamp(),
    stageChangedBy: acting.userId,
    exitReason: input.outcome === 'NOT_JOINED' ? 'Did not join' : 'Offer cancelled',
    exitRemarks: input.reason,
    exitedAt: serverTimestamp(),
    ...withUpdateAudit(acting),
  });

  if (joining.offerId) {
    await updateDoc(doc(db, HR_COLLECTIONS.offers, joining.offerId), {
      status: 'WITHDRAWN' satisfies HrOffer['status'],
      withdrawalReason: input.reason,
      ...withUpdateAudit(acting),
    });
  }

  await logHrActivity({
    actor: acting,
    entityType: 'joining',
    entityId: joiningRecordId,
    requirementId: joining.requirementId,
    action: input.outcome === 'NOT_JOINED' ? 'Candidate did not join' : 'Joining cancelled',
    summary: `${joining.candidateName} — ${input.outcome === 'NOT_JOINED' ? 'no show' : 'offer cancelled'}`,
    remarks: input.reason,
  });

  const requirement = await loadRequirement(joining.requirementId);
  await notifyHr({
    event: 'candidateNoShow',
    settings: await loadHrSettings(acting.organizationId),
    organizationId: acting.organizationId,
    recipients: {
      userIds: [requirement?.primaryRecruiterId, requirement?.requestingManagerId, requirement?.departmentHodId],
      roles: ['HR Manager', 'HR Head'],
    },
    title:
      input.outcome === 'NOT_JOINED'
        ? `Did not join: ${joining.candidateName}`
        : `Joining cancelled: ${joining.candidateName}`,
    body: `${joining.designation}${joining.projectName ? ` at ${joining.projectName}` : ''} — ${input.reason}. The position is open again.`,
    link: `/hr/requirements/${joining.requirementId}`,
    itemId: joiningRecordId,
    severity: 'WARNING',
  });

  await refreshRequirementCounters(joining.requirementId);
}

/** Ticks off one of section 36's post-joining triggers. */
export async function updateOnboardingStep(
  joiningRecordId: string,
  step: keyof NonNullable<JoiningRecord['onboarding']>,
  done: boolean,
  actor: HrActor,
): Promise<void> {
  const acting = requireActor(actor);
  const snapshot = await getDoc(doc(db, HR_COLLECTIONS.joiningRecords, joiningRecordId));
  if (!snapshot.exists()) throw new HrControlError('Joining record not found.');
  const joining = snapshot.data() as JoiningRecord;

  await updateDoc(doc(db, HR_COLLECTIONS.joiningRecords, joiningRecordId), {
    onboarding: { ...(joining.onboarding || {}), [step]: done },
    ...withUpdateAudit(acting),
  });
}

/* ------------------------------------------------------------------------------------------------
 * Referrals, agencies and costs (spec sections 46, 47, 52)
 * ---------------------------------------------------------------------------------------------- */

export async function submitReferral(
  input: {
    requirementId?: string;
    requirementNumber?: string;
    referredByEmployeeId: string;
    referredByEmployeeName: string;
    candidateName: string;
    candidateMobile: string;
    candidateEmail?: string;
    relationship?: string;
    resumeUrl?: string;
    remarks?: string;
  },
  actor: HrActor,
): Promise<{ id: string; referralNumber: string }> {
  const acting = requireActor(actor);
  const settings = await loadHrSettings(acting.organizationId);
  if (!settings.referrals.enabled) throw new HrControlError('Employee referrals are disabled for this organisation.');
  if (!input.candidateName?.trim()) throw new HrControlError("Enter the candidate's name.");
  if (!input.candidateMobile?.trim()) throw new HrControlError("Enter the candidate's mobile number.");

  const referralNumber = await allocateHrNumber(acting.organizationId, 'referral');
  const ref = await addDoc(collection(db, HR_COLLECTIONS.referrals), {
    ...input,
    organizationId: acting.organizationId,
    referralNumber,
    referredByUserId: acting.userId,
    status: 'SUBMITTED',
    ...withCreateAudit(acting),
  });

  await logHrActivity({
    actor: acting,
    entityType: 'referral',
    entityId: ref.id,
    requirementId: input.requirementId || null,
    action: 'Referral submitted',
    summary: `${input.referredByEmployeeName} referred ${input.candidateName}`,
  });

  return { id: ref.id, referralNumber };
}

export async function recordRecruitmentCost(
  input: {
    requirementId?: string;
    requirementNumber?: string;
    candidateId?: string;
    head: import('@/lib/hr-policy').RecruitmentCostHead;
    amount: number;
    incurredOn: string;
    agencyId?: string;
    invoiceRef?: string;
    remarks?: string;
  },
  actor: HrActor,
): Promise<string> {
  const acting = requireActor(actor);
  if (!input.amount || input.amount <= 0) throw new HrControlError('Enter the amount.');
  if (!input.head) throw new HrControlError('Select the cost head.');

  const ref = await addDoc(collection(db, HR_COLLECTIONS.costs), {
    ...input,
    amount: roundMoney(input.amount),
    organizationId: acting.organizationId,
    incurredOn: input.incurredOn || todayIso(),
    ...withCreateAudit(acting),
  });

  await logHrActivity({
    actor: acting,
    entityType: 'requirement',
    entityId: input.requirementId || ref.id,
    requirementId: input.requirementId || null,
    action: 'Recruitment cost recorded',
    summary: `${input.head} — ${hrCurrency(input.amount)}`,
  });

  return ref.id;
}

/**
 * Refreshes an agency's performance counters from the applications it submitted (spec section 47).
 *
 * Recomputed rather than incremented, because an application can move backwards and an agency's
 * "shortlisted" figure that only ever goes up is the kind of number that quietly stops matching the
 * pipeline it claims to summarise.
 */
export async function refreshAgencyPerformance(agencyId: string): Promise<void> {
  const snapshot = await getDocs(query(collection(db, HR_COLLECTIONS.applications), where('agencyId', '==', agencyId)));
  const applications = snapshot.docs.map(entry => entry.data() as CandidateApplication);

  const reached = (stage: ApplicationStage) =>
    applications.filter(app => {
      if ((app.stagesReached || []).includes(stage)) return true;
      const currentIndex = PIPELINE_STAGES.indexOf(app.stage as never);
      return currentIndex >= 0 && currentIndex >= PIPELINE_STAGES.indexOf(stage as never);
    }).length;

  await updateDoc(doc(db, HR_COLLECTIONS.agencies, agencyId), {
    submittedCount: applications.length,
    shortlistedCount: reached('SHORTLISTED'),
    interviewedCount: reached('INTERVIEW_1'),
    offeredCount: reached('OFFERED'),
    joinedCount: reached('JOINED'),
  });
}

/**
 * Expires offers past their validity date (spec section 29).
 *
 * Written for the daily cron. Only untouched offers expire — a viewed offer the candidate is still
 * considering expires too, but an accepted one never does.
 */
export async function expireStaleOffers(organizationId: string, actor: HrActor): Promise<number> {
  const acting = requireActor(actor);
  const snapshot = await getDocs(
    query(
      collection(db, HR_COLLECTIONS.offers),
      where('organizationId', '==', organizationId),
      where('status', 'in', ['SENT', 'VIEWED']),
    ),
  );

  const today = todayIso();
  const stale = snapshot.docs
    .map(entry => ({ id: entry.id, ...entry.data() }) as HrOffer)
    .filter(offer => offer.validUntil && offer.validUntil < today);
  if (stale.length === 0) return 0;

  const batch = writeBatch(db);
  for (const offer of stale) {
    batch.update(doc(db, HR_COLLECTIONS.offers, offer.id), {
      status: 'EXPIRED' satisfies HrOffer['status'],
      expiredAt: serverTimestamp(),
      portalToken: '',
    });
  }
  await batch.commit();

  for (const offer of stale) {
    await logHrActivity({
      actor: acting,
      entityType: 'offer',
      entityId: offer.id,
      requirementId: offer.requirementId,
      action: 'Offer expired',
      summary: `${offer.offerNumber} expired on ${offer.validUntil}`,
    });
    await refreshRequirementCounters(offer.requirementId);
  }

  return stale.length;
}

/* ------------------------------------------------------------------------------------------------
 * Manpower plan maintenance (spec section 4)
 * ---------------------------------------------------------------------------------------------- */

export async function upsertManpowerPlan(
  input: {
    id?: string;
    financialYear: string;
    departmentId?: string;
    departmentName?: string;
    projectId?: string;
    projectName?: string;
    designation: string;
    grade?: string;
    approvedStrength: number;
    existingStrength: number;
    plannedAdditional?: number;
    expectedExits?: number;
    remarks?: string;
    status?: 'Draft' | 'Approved' | 'Revised' | 'Closed';
  },
  actor: HrActor,
): Promise<string> {
  const acting = requireActor(actor);
  if (!input.designation?.trim()) throw new HrControlError('Select the designation.');
  if (!input.departmentId && !input.projectId) {
    throw new HrControlError('A plan line needs either a department or a project.');
  }
  if (Number(input.approvedStrength) < 0) throw new HrControlError('Approved strength cannot be negative.');

  const payload = {
    ...input,
    organizationId: acting.organizationId,
    approvedStrength: Math.max(0, Math.floor(Number(input.approvedStrength) || 0)),
    existingStrength: Math.max(0, Math.floor(Number(input.existingStrength) || 0)),
    plannedAdditional: Math.max(0, Math.floor(Number(input.plannedAdditional) || 0)),
    expectedExits: Math.max(0, Math.floor(Number(input.expectedExits) || 0)),
    status: input.status || 'Draft',
  };

  if (input.id) {
    await updateDoc(doc(db, HR_COLLECTIONS.manpowerPlans, input.id), { ...payload, ...withUpdateAudit(acting) });
    await logHrActivity({
      actor: acting,
      entityType: 'manpowerPlan',
      entityId: input.id,
      action: 'Manpower plan updated',
      summary: `${input.designation}: sanctioned ${payload.approvedStrength}, on roll ${payload.existingStrength}`,
    });
    return input.id;
  }

  const ref = await addDoc(collection(db, HR_COLLECTIONS.manpowerPlans), { ...payload, ...withCreateAudit(acting) });
  await logHrActivity({
    actor: acting,
    entityType: 'manpowerPlan',
    entityId: ref.id,
    action: 'Manpower plan line added',
    summary: `${input.designation}: sanctioned ${payload.approvedStrength}, on roll ${payload.existingStrength}`,
  });
  return ref.id;
}

/** The annual manpower cost of a requirement, for the approval screen (spec section 14). */
export const requirementAnnualCost = (requirement: Pick<HrRequirement, 'budget' | 'requestedQuantity'>) =>
  annualManpowerCost({ expectedCtc: requirement.budget?.expectedCtc, quantity: requirement.requestedQuantity });

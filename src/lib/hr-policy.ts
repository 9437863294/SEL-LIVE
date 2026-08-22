/**
 * Domain rules for HR Requirement Management (`docs/hr-requirement-management.md`).
 *
 * Dependency-free on purpose: this module runs in the browser, on the mobile client and inside
 * Admin-SDK routes (the SLA/escalation cron of spec section 41 has no user session), and every rule
 * in here is unit-tested from `tests/hr-domain.test.mjs` without a Firestore emulator. Anything that
 * touches Firestore belongs in `hr-requirement-service.ts`; anything that renders belongs in the
 * components. If a rule can be expressed as "inputs → decision", it goes here.
 *
 * `hr-requirement.ts` re-exports this file, so consumers import the module from one place — the same
 * arrangement `tour-travel.ts` has with `tour-travel-policy.ts`.
 */

export const roundMoney = (value: number) => Math.round((Number(value) || 0) * 100) / 100;

export const roundPercent = (value: number) => Math.round((Number(value) || 0) * 10) / 10;

/** Financial year (April–March) as `2026-27`. */
export function financialYearForHrDate(date: Date = new Date()): string {
  const year = date.getFullYear();
  const startYear = date.getMonth() >= 3 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/** Whole days from `from` to `to`, negative when `to` precedes `from`. */
export const dayDifference = (from: Date, to: Date) =>
  Math.floor((to.getTime() - from.getTime()) / 86_400_000);

/**
 * Parses the `YYYY-MM-DD` (or ISO) strings the forms produce into a Date at local midnight.
 * Returns null rather than an Invalid Date so callers can branch instead of propagating NaN.
 */
export function parseHrDate(value: string | Date | undefined | null): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/* ------------------------------------------------------------------------------------------------
 * Document numbering (spec section 5)
 * ---------------------------------------------------------------------------------------------- */

export const HR_DOC_PREFIX = {
  requirement: 'HR-REQ',
  manpowerPlan: 'HR-MPP',
  candidate: 'HR-CAN',
  application: 'HR-APP',
  interview: 'HR-INT',
  selection: 'HR-SEL',
  offer: 'HR-OFR',
  joining: 'HR-JON',
  agency: 'HR-AGY',
  referral: 'HR-REF',
} as const;

export type HrDocKind = keyof typeof HR_DOC_PREFIX;

/**
 * Formats a document number as `HR-REQ-2026-00128`, matching the identifier the spec shows the user
 * in section 5.
 *
 * The year segment is the financial year's *start* year rather than the calendar year, so a
 * requirement raised in February 2027 and one raised in May 2026 carry the same 2026 series and the
 * annual manpower budget reconciles against a single sequence. Five digits, because a year in which
 * an EPC organisation raises more than 99,999 requisitions is not the failure mode to design for —
 * but the width is applied with `padStart`, so overflowing simply produces a longer number instead
 * of a colliding one.
 */
export function hrDocumentNumber(input: { kind: HrDocKind; financialYear: string; sequence: number }): string {
  const startYear = (input.financialYear || '').split('-')[0] || String(new Date().getFullYear());
  const sequence = Math.max(1, Math.floor(Number(input.sequence) || 1));
  return `${HR_DOC_PREFIX[input.kind]}-${startYear}-${String(sequence).padStart(5, '0')}`;
}

/* ------------------------------------------------------------------------------------------------
 * Masters and enumerations (spec sections 6, 7, 18, 58)
 * ---------------------------------------------------------------------------------------------- */

export type RequirementType =
  | 'New Position'
  | 'Replacement'
  | 'Additional Manpower'
  | 'Project Requirement'
  | 'Temporary Requirement'
  | 'Contractual Requirement'
  | 'Expansion'
  | 'Internal Transfer Replacement'
  | 'Emergency Requirement'
  | 'Management Requirement';

export const REQUIREMENT_TYPES: RequirementType[] = [
  'New Position',
  'Replacement',
  'Additional Manpower',
  'Project Requirement',
  'Temporary Requirement',
  'Contractual Requirement',
  'Expansion',
  'Internal Transfer Replacement',
  'Emergency Requirement',
  'Management Requirement',
];

/**
 * Requirement types that must name the employee being replaced (control rule 63.11). Without the
 * outgoing employee, a resignation-driven vacancy loses its link to the exit that caused it and the
 * manpower history of the position breaks.
 */
export const REPLACEMENT_REQUIREMENT_TYPES: RequirementType[] = ['Replacement', 'Internal Transfer Replacement'];

/** Requirement types that create headcount the sanctioned strength did not previously carry. */
export const HEADCOUNT_ADDING_TYPES: RequirementType[] = [
  'New Position',
  'Additional Manpower',
  'Expansion',
  'Management Requirement',
];

export type RequirementReason =
  | 'Resignation'
  | 'Termination'
  | 'Retirement'
  | 'Transfer'
  | 'Promotion'
  | 'Death'
  | 'Absconding'
  | 'End of Contract'
  | 'New Project'
  | 'Project Expansion'
  | 'Client Requirement'
  | 'Workload Increase'
  | 'Restructuring'
  | 'Other';

export const REQUIREMENT_REASONS: RequirementReason[] = [
  'Resignation', 'Termination', 'Retirement', 'Transfer', 'Promotion', 'Death', 'Absconding',
  'End of Contract', 'New Project', 'Project Expansion', 'Client Requirement', 'Workload Increase',
  'Restructuring', 'Other',
];

export type EmploymentType =
  | 'Permanent'
  | 'Contract'
  | 'Fixed Term'
  | 'Trainee'
  | 'Apprentice'
  | 'Consultant'
  | 'Retainer'
  | 'Deputation'
  | 'Casual';

export const EMPLOYMENT_TYPES: EmploymentType[] = [
  'Permanent', 'Contract', 'Fixed Term', 'Trainee', 'Apprentice', 'Consultant', 'Retainer',
  'Deputation', 'Casual',
];

export type RequirementPriority = 'Critical' | 'High' | 'Normal' | 'Low';

export const REQUIREMENT_PRIORITIES: RequirementPriority[] = ['Critical', 'High', 'Normal', 'Low'];

export type RecruitmentSourceKind =
  | 'Career Portal'
  | 'Employee Referral'
  | 'Internal Job Posting'
  | 'LinkedIn'
  | 'Naukri'
  | 'Job Portal'
  | 'Recruitment Agency'
  | 'Consultant'
  | 'Campus Hiring'
  | 'Direct Application'
  | 'Talent Pool'
  | 'Walk-in'
  | 'Social Media'
  | 'Other';

export const RECRUITMENT_SOURCES: RecruitmentSourceKind[] = [
  'Career Portal', 'Employee Referral', 'Internal Job Posting', 'LinkedIn', 'Naukri', 'Job Portal',
  'Recruitment Agency', 'Consultant', 'Campus Hiring', 'Direct Application', 'Talent Pool',
  'Walk-in', 'Social Media', 'Other',
];

/** Interview rounds (spec section 24). */
export type InterviewRound =
  | 'HR Round'
  | 'Technical Round'
  | 'Project Head Round'
  | 'Functional Round'
  | 'Director Round'
  | 'Final Round';

export const INTERVIEW_ROUNDS: InterviewRound[] = [
  'HR Round', 'Technical Round', 'Project Head Round', 'Functional Round', 'Director Round', 'Final Round',
];

export type InterviewMode = 'In Person' | 'Video' | 'Telephonic' | 'Walk-in';

export const INTERVIEW_MODES: InterviewMode[] = ['In Person', 'Video', 'Telephonic', 'Walk-in'];

/** Hold reasons (spec section 42). */
export type RequirementHoldReason =
  | 'Budget Hold'
  | 'Project Delayed'
  | 'Client Approval Pending'
  | 'Management Instruction'
  | 'Role Redesign'
  | 'Internal Candidate Under Evaluation';

export const REQUIREMENT_HOLD_REASONS: RequirementHoldReason[] = [
  'Budget Hold', 'Project Delayed', 'Client Approval Pending', 'Management Instruction',
  'Role Redesign', 'Internal Candidate Under Evaluation',
];

/* ------------------------------------------------------------------------------------------------
 * Statuses (spec sections 22, 29, 32, 39)
 * ---------------------------------------------------------------------------------------------- */

/**
 * Statuses use SCREAMING_SNAKE tokens, as the travel module does and for the same reason: they are
 * written by the UI, by the SLA cron and by the candidate offer portal, and a machine token can't
 * drift the way "Partially Filled" / "Partially filled" does across three writers. `hrStatusLabel`
 * renders them; no screen prints a raw token.
 */
export type RequirementStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'PENDING_HOD_APPROVAL'
  | 'PENDING_HR_APPROVAL'
  | 'PENDING_BUDGET_APPROVAL'
  | 'PENDING_MANAGEMENT_APPROVAL'
  | 'APPROVED'
  | 'RECRUITER_ASSIGNMENT_PENDING'
  | 'OPEN'
  | 'SOURCING'
  | 'SCREENING'
  | 'INTERVIEWING'
  | 'SELECTION_IN_PROGRESS'
  | 'OFFER_IN_PROGRESS'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'ON_HOLD'
  | 'REJECTED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'CLOSED'
  | 'REOPENED';

export const REQUIREMENT_STATUSES: RequirementStatus[] = [
  'DRAFT', 'SUBMITTED', 'PENDING_HOD_APPROVAL', 'PENDING_HR_APPROVAL', 'PENDING_BUDGET_APPROVAL',
  'PENDING_MANAGEMENT_APPROVAL', 'APPROVED', 'RECRUITER_ASSIGNMENT_PENDING', 'OPEN', 'SOURCING',
  'SCREENING', 'INTERVIEWING', 'SELECTION_IN_PROGRESS', 'OFFER_IN_PROGRESS', 'PARTIALLY_FILLED',
  'FILLED', 'ON_HOLD', 'REJECTED', 'CANCELLED', 'EXPIRED', 'CLOSED', 'REOPENED',
];

/** Awaiting somebody's approval decision — used by the approval inbox and the pending-work counts. */
export const PENDING_APPROVAL_STATUSES: RequirementStatus[] = [
  'SUBMITTED', 'PENDING_HOD_APPROVAL', 'PENDING_HR_APPROVAL', 'PENDING_BUDGET_APPROVAL',
  'PENDING_MANAGEMENT_APPROVAL',
];

/**
 * Statuses in which recruitment may legitimately proceed (control rule 63.2). An application,
 * interview or offer may only attach to a requirement in one of these — which is what stops a
 * recruiter from working a requisition that Finance has not yet cleared.
 */
export const RECRUITING_REQUIREMENT_STATUSES: RequirementStatus[] = [
  'OPEN', 'SOURCING', 'SCREENING', 'INTERVIEWING', 'SELECTION_IN_PROGRESS', 'OFFER_IN_PROGRESS',
  'PARTIALLY_FILLED', 'REOPENED',
];

/**
 * Requirements that no longer move on their own: skipped by the SLA cron, and locked against new
 * applications, offers and joinings (control rule 63.9).
 */
export const TERMINAL_REQUIREMENT_STATUSES: RequirementStatus[] = [
  'FILLED', 'CLOSED', 'CANCELLED', 'REJECTED', 'EXPIRED',
];

export const isRecruitingStatus = (status: RequirementStatus | string) =>
  RECRUITING_REQUIREMENT_STATUSES.includes(status as RequirementStatus);

export const isTerminalRequirementStatus = (status: RequirementStatus | string) =>
  TERMINAL_REQUIREMENT_STATUSES.includes(status as RequirementStatus);

/** "Open" in the management sense of section 3's KPI cards: approved and not yet finished. */
export const isOpenRequirementStatus = (status: RequirementStatus | string) =>
  isRecruitingStatus(status) ||
  (['APPROVED', 'RECRUITER_ASSIGNMENT_PENDING', 'ON_HOLD'] as string[]).includes(status);

/** Pipeline stages, in order (spec section 22). */
export type PipelineStage =
  | 'NEW'
  | 'SCREENING'
  | 'SHORTLISTED'
  | 'INTERVIEW_1'
  | 'INTERVIEW_2'
  | 'FINAL_INTERVIEW'
  | 'SELECTED'
  | 'COMPENSATION_APPROVAL'
  | 'OFFERED'
  | 'OFFER_ACCEPTED'
  | 'PRE_JOINING'
  | 'JOINED';

export const PIPELINE_STAGES: PipelineStage[] = [
  'NEW', 'SCREENING', 'SHORTLISTED', 'INTERVIEW_1', 'INTERVIEW_2', 'FINAL_INTERVIEW', 'SELECTED',
  'COMPENSATION_APPROVAL', 'OFFERED', 'OFFER_ACCEPTED', 'PRE_JOINING', 'JOINED',
];

/** The side exits of section 22 — an application leaves the board without reaching JOINED. */
export type PipelineExit =
  | 'REJECTED'
  | 'WITHDRAWN'
  | 'NO_RESPONSE'
  | 'ON_HOLD'
  | 'OFFER_REJECTED'
  | 'NO_SHOW'
  | 'TALENT_POOL';

export const PIPELINE_EXITS: PipelineExit[] = [
  'REJECTED', 'WITHDRAWN', 'NO_RESPONSE', 'ON_HOLD', 'OFFER_REJECTED', 'NO_SHOW', 'TALENT_POOL',
];

export type ApplicationStage = PipelineStage | PipelineExit;

/** Exits a candidate can come back from — ON_HOLD and TALENT_POOL are pauses, not rejections. */
export const RESUMABLE_PIPELINE_EXITS: PipelineExit[] = ['ON_HOLD', 'TALENT_POOL', 'NO_RESPONSE'];

export const isPipelineExit = (stage: ApplicationStage | string) =>
  PIPELINE_EXITS.includes(stage as PipelineExit);

/** Interview stages, for the "candidate is in interviews" derivations. */
export const INTERVIEW_PIPELINE_STAGES: PipelineStage[] = ['INTERVIEW_1', 'INTERVIEW_2', 'FINAL_INTERVIEW'];

export type OfferStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'SENT'
  | 'VIEWED'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'WITHDRAWN';

export const OFFER_STATUSES: OfferStatus[] = [
  'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'VIEWED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'WITHDRAWN',
];

/** An offer in one of these is live against the requirement's headcount (spec section 37). */
export const LIVE_OFFER_STATUSES: OfferStatus[] = ['SENT', 'VIEWED', 'ACCEPTED'];

export type DocumentVerificationStatus =
  | 'PENDING'
  | 'UPLOADED'
  | 'UNDER_VERIFICATION'
  | 'VERIFIED'
  | 'REJECTED'
  | 'REUPLOAD_REQUIRED'
  | 'WAIVED';

export const DOCUMENT_VERIFICATION_STATUSES: DocumentVerificationStatus[] = [
  'PENDING', 'UPLOADED', 'UNDER_VERIFICATION', 'VERIFIED', 'REJECTED', 'REUPLOAD_REQUIRED', 'WAIVED',
];

/** A document in one of these needs no further action from the candidate (spec section 32). */
export const SETTLED_DOCUMENT_STATUSES: DocumentVerificationStatus[] = ['VERIFIED', 'WAIVED'];

export type JoiningStatus =
  | 'CONFIRMATION_PENDING'
  | 'DOCUMENTS_PENDING'
  | 'CONFIRMED'
  | 'JOINED'
  | 'POSTPONED'
  | 'NOT_JOINED'
  | 'OFFER_CANCELLED';

export const JOINING_STATUSES: JoiningStatus[] = [
  'CONFIRMATION_PENDING', 'DOCUMENTS_PENDING', 'CONFIRMED', 'JOINED', 'POSTPONED', 'NOT_JOINED', 'OFFER_CANCELLED',
];

export type CompensationApprovalStatus = 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'REJECTED';

/** Turns a status token into the sentence-case label the UI shows. */
export function hrStatusLabel(status: string): string {
  const overrides: Record<string, string> = {
    PENDING_HOD_APPROVAL: 'Pending HOD approval',
    PENDING_HR_APPROVAL: 'Pending HR approval',
    INTERVIEW_1: 'Interview round 1',
    INTERVIEW_2: 'Interview round 2',
    NO_SHOW: 'No show',
    PRE_JOINING: 'Pre-joining',
    TALENT_POOL: 'Talent pool',
    NOT_REQUIRED: 'Not required',
  };
  if (overrides[status]) return overrides[status];
  return (status || '')
    .split('_')
    .map((word, index) => (index === 0 ? word.charAt(0) + word.slice(1).toLowerCase() : word.toLowerCase()))
    .join(' ');
}

/**
 * Tailwind classes per status family, grouped by meaning rather than by entity so that a
 * requirement awaiting approval and an offer awaiting approval read alike wherever they appear.
 */
export function hrStatusTone(status: string): string {
  switch (status) {
    case 'DRAFT':
    case 'NEW':
    case 'NOT_REQUIRED':
      return 'bg-slate-100 text-slate-700 border-slate-200';

    case 'SUBMITTED':
    case 'PENDING_HOD_APPROVAL':
    case 'PENDING_HR_APPROVAL':
    case 'PENDING_BUDGET_APPROVAL':
    case 'PENDING_MANAGEMENT_APPROVAL':
    case 'PENDING_APPROVAL':
    case 'PENDING':
    case 'CONFIRMATION_PENDING':
    case 'UNDER_VERIFICATION':
    case 'COMPENSATION_APPROVAL':
      return 'bg-amber-100 text-amber-800 border-amber-200';

    case 'APPROVED':
    case 'VERIFIED':
    case 'CONFIRMED':
    case 'SELECTED':
    case 'OFFER_ACCEPTED':
    case 'ACCEPTED':
      return 'bg-emerald-100 text-emerald-800 border-emerald-200';

    case 'FILLED':
    case 'JOINED':
      return 'bg-green-100 text-green-800 border-green-200';

    case 'RECRUITER_ASSIGNMENT_PENDING':
    case 'OPEN':
    case 'REOPENED':
    case 'SOURCING':
      return 'bg-blue-100 text-blue-800 border-blue-200';

    case 'SCREENING':
    case 'SHORTLISTED':
    case 'INTERVIEWING':
    case 'INTERVIEW_1':
    case 'INTERVIEW_2':
    case 'FINAL_INTERVIEW':
    case 'SELECTION_IN_PROGRESS':
    case 'UPLOADED':
      return 'bg-indigo-100 text-indigo-800 border-indigo-200';

    case 'OFFER_IN_PROGRESS':
    case 'OFFERED':
    case 'SENT':
    case 'VIEWED':
    case 'PRE_JOINING':
      return 'bg-violet-100 text-violet-800 border-violet-200';

    case 'PARTIALLY_FILLED':
    case 'ON_HOLD':
    case 'POSTPONED':
    case 'REUPLOAD_REQUIRED':
    case 'DOCUMENTS_PENDING':
      return 'bg-orange-100 text-orange-800 border-orange-200';

    case 'REJECTED':
    case 'OFFER_REJECTED':
    case 'NO_SHOW':
    case 'NOT_JOINED':
    case 'OFFER_CANCELLED':
      return 'bg-rose-100 text-rose-800 border-rose-200';

    case 'CANCELLED':
    case 'EXPIRED':
    case 'WITHDRAWN':
    case 'NO_RESPONSE':
      return 'bg-zinc-100 text-zinc-700 border-zinc-200';

    case 'CLOSED':
    case 'WAIVED':
      return 'bg-teal-100 text-teal-800 border-teal-200';

    case 'TALENT_POOL':
      return 'bg-cyan-100 text-cyan-800 border-cyan-200';

    default:
      return 'bg-slate-100 text-slate-700 border-slate-200';
  }
}

/** Priority badge tone, kept beside the status tones so the two palettes stay distinguishable. */
export function priorityTone(priority: RequirementPriority | string): string {
  switch (priority) {
    case 'Critical':
      return 'bg-rose-100 text-rose-800 border-rose-200';
    case 'High':
      return 'bg-orange-100 text-orange-800 border-orange-200';
    case 'Normal':
      return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'Low':
      return 'bg-slate-100 text-slate-700 border-slate-200';
    default:
      return 'bg-slate-100 text-slate-700 border-slate-200';
  }
}

/** Indian-format currency, compact for KPI cards. Mirrors `travelCurrency`. */
export function hrCurrency(value: number | undefined | null): string {
  const amount = Number(value) || 0;
  if (Math.abs(amount) >= 10_000_000) return `₹${roundPercent(amount / 10_000_000)}Cr`;
  if (Math.abs(amount) >= 100_000) return `₹${roundPercent(amount / 100_000)}L`;
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
}

/* ------------------------------------------------------------------------------------------------
 * Requirement fill arithmetic (spec section 37)
 * ---------------------------------------------------------------------------------------------- */

export interface RequirementFillInput {
  requestedQuantity: number;
  /** Joinings actually confirmed. Derived from joining records, never typed (control rule 63.4). */
  joinedCount?: number;
  /** Offers accepted but the candidate has not joined yet. */
  offerAcceptedCount?: number;
  /** Offers released and still live (sent/viewed). */
  offeredCount?: number;
  /** Candidates active anywhere between NEW and SELECTED. */
  inPipelineCount?: number;
  /** Positions withdrawn without being filled (spec section 43). */
  cancelledPositions?: number;
}

export interface RequirementFill {
  requested: number;
  effectiveRequired: number;
  joined: number;
  offerAccepted: number;
  offered: number;
  inPipeline: number;
  cancelled: number;
  /** Positions with nobody joined and nobody offered — the true recruitment gap. */
  balance: number;
  /** Positions still to fill counting accepted offers as covered — what the recruiter chases. */
  uncoveredBalance: number;
  filledPercent: number;
  fillStatus: 'Not started' | 'In progress' | 'Partially filled' | 'Fully filled' | 'Over filled';
  /** True when joined ≥ required, which is when the workspace offers to close (spec section 37). */
  recommendClosure: boolean;
}

/**
 * The headcount arithmetic every screen in the module quotes.
 *
 * Two different "balance" figures exist because two different people ask the question. Management
 * wants positions not yet *filled* (`balance`, joined only) — an accepted offer is not a person on
 * site. A recruiter wants positions not yet *covered* (`uncoveredBalance`), because chasing a
 * position that already has an accepted offer is wasted sourcing. Collapsing the two into one number
 * is what makes a manpower report argue with the recruitment dashboard.
 */
export function summarizeRequirementFill(input: RequirementFillInput): RequirementFill {
  const requested = Math.max(0, Math.floor(Number(input.requestedQuantity) || 0));
  const cancelled = Math.max(0, Math.floor(Number(input.cancelledPositions) || 0));
  const effectiveRequired = Math.max(0, requested - cancelled);
  const joined = Math.max(0, Math.floor(Number(input.joinedCount) || 0));
  const offerAccepted = Math.max(0, Math.floor(Number(input.offerAcceptedCount) || 0));
  const offered = Math.max(0, Math.floor(Number(input.offeredCount) || 0));
  const inPipeline = Math.max(0, Math.floor(Number(input.inPipelineCount) || 0));

  const balance = Math.max(0, effectiveRequired - joined);
  const uncoveredBalance = Math.max(0, effectiveRequired - joined - offerAccepted);
  const filledPercent = effectiveRequired > 0 ? roundPercent((joined / effectiveRequired) * 100) : 0;

  const fillStatus: RequirementFill['fillStatus'] = (() => {
    if (effectiveRequired > 0 && joined > effectiveRequired) return 'Over filled';
    if (effectiveRequired > 0 && joined >= effectiveRequired) return 'Fully filled';
    if (joined > 0) return 'Partially filled';
    if (offerAccepted > 0 || offered > 0 || inPipeline > 0) return 'In progress';
    return 'Not started';
  })();

  return {
    requested,
    effectiveRequired,
    joined,
    offerAccepted,
    offered,
    inPipeline,
    cancelled,
    balance,
    uncoveredBalance,
    filledPercent,
    fillStatus,
    recommendClosure: effectiveRequired > 0 && joined >= effectiveRequired,
  };
}

/**
 * The recruiting sub-status a requirement should show, from what is actually happening on its
 * pipeline (spec section 39).
 *
 * Derived rather than stored, because a recruiter who moves the last candidate out of interviews
 * would otherwise leave the requirement reading INTERVIEWING forever. Reports the furthest stage any
 * live candidate has reached — a requirement with one candidate at offer and six at screening is in
 * OFFER_IN_PROGRESS, since that is the thing needing attention.
 */
export function deriveRecruitingStatus(counts: {
  offered?: number;
  selected?: number;
  interviewing?: number;
  screening?: number;
  sourced?: number;
  joined?: number;
  requested?: number;
}): RequirementStatus {
  const joined = Math.max(0, Number(counts.joined) || 0);
  const requested = Math.max(0, Number(counts.requested) || 0);
  if (requested > 0 && joined >= requested) return 'FILLED';
  if ((Number(counts.offered) || 0) > 0) return 'OFFER_IN_PROGRESS';
  if ((Number(counts.selected) || 0) > 0) return 'SELECTION_IN_PROGRESS';
  if ((Number(counts.interviewing) || 0) > 0) return 'INTERVIEWING';
  if ((Number(counts.screening) || 0) > 0) return 'SCREENING';
  if (joined > 0) return 'PARTIALLY_FILLED';
  if ((Number(counts.sourced) || 0) > 0) return 'SOURCING';
  return 'OPEN';
}

/* ------------------------------------------------------------------------------------------------
 * Manpower position (spec sections 4 and 61)
 * ---------------------------------------------------------------------------------------------- */

export interface ManpowerPositionInput {
  /** Sanctioned strength from the manpower plan. */
  approvedStrength: number;
  /** Employees on roll today. */
  existing: number;
  /** Positions with a live requirement being recruited. */
  underRecruitment?: number;
  offered?: number;
  joiningAwaited?: number;
  plannedAdditional?: number;
}

export interface ManpowerPosition {
  approvedStrength: number;
  existing: number;
  underRecruitment: number;
  offered: number;
  joiningAwaited: number;
  plannedAdditional: number;
  /** Sanctioned minus on-roll — the vacancy the plan authorises. */
  vacancy: number;
  shortage: number;
  /** Shortage with no recruitment running against it: the number management must act on. */
  criticalShortage: number;
  fulfilmentPercent: number;
  status: 'Fully staffed' | 'Covered by pipeline' | 'Short staffed' | 'Critically short' | 'Over strength';
}

/**
 * The project/department manpower picture of section 61.
 *
 * `criticalShortage` is the figure that makes this screen worth opening: a shortage of twelve with
 * eight already in recruitment is a very different management problem from a shortage of twelve with
 * nothing happening, and the spec's own example (48 approved, 36 existing, 8 under recruitment →
 * critical shortage 4) is the arithmetic pinned in the tests.
 */
export function summarizeManpowerPosition(input: ManpowerPositionInput): ManpowerPosition {
  const approvedStrength = Math.max(0, Math.floor(Number(input.approvedStrength) || 0));
  const existing = Math.max(0, Math.floor(Number(input.existing) || 0));
  const underRecruitment = Math.max(0, Math.floor(Number(input.underRecruitment) || 0));
  const offered = Math.max(0, Math.floor(Number(input.offered) || 0));
  const joiningAwaited = Math.max(0, Math.floor(Number(input.joiningAwaited) || 0));
  const plannedAdditional = Math.max(0, Math.floor(Number(input.plannedAdditional) || 0));

  const vacancy = approvedStrength - existing;
  const shortage = Math.max(0, vacancy);
  const criticalShortage = Math.max(0, shortage - underRecruitment);
  const fulfilmentPercent = approvedStrength > 0 ? roundPercent((existing / approvedStrength) * 100) : 100;

  const status: ManpowerPosition['status'] = (() => {
    if (vacancy < 0) return 'Over strength';
    if (shortage === 0) return 'Fully staffed';
    if (criticalShortage === 0) return 'Covered by pipeline';
    // A quarter of sanctioned strength missing with nothing in the pipeline is the threshold at
    // which a project's manpower stops being a recruitment backlog and becomes a delivery risk.
    if (approvedStrength > 0 && criticalShortage / approvedStrength >= 0.25) return 'Critically short';
    return 'Short staffed';
  })();

  return {
    approvedStrength,
    existing,
    underRecruitment,
    offered,
    joiningAwaited,
    plannedAdditional,
    vacancy,
    shortage,
    criticalShortage,
    fulfilmentPercent,
    status,
  };
}

/* ------------------------------------------------------------------------------------------------
 * Duplicate requirement detection (spec section 11)
 * ---------------------------------------------------------------------------------------------- */

export interface DuplicateRequirementCandidate {
  departmentId?: string;
  designation?: string;
  locationId?: string;
  location?: string;
  projectId?: string;
}

export interface DuplicateRequirementMatch<T> {
  requirement: T;
  matchedOn: Array<'department' | 'designation' | 'project' | 'location'>;
}

const normalizeText = (value: string | undefined | null) =>
  (value || '').toString().trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Finds open requirements for the same role in the same place (spec section 11).
 *
 * Deliberately advisory, never blocking: two genuinely separate requisitions for six site engineers
 * on the same project happen all the time in EPC work, and a hard block would only teach the
 * requester to vary the designation text until the check stopped firing. The screen shows the match
 * and offers View / Link / Continue.
 *
 * Department and designation must both match to be worth showing; project or location then has to
 * agree as well, so "Site Engineer at Rayagada" doesn't surface against "Site Engineer at Angul".
 */
export function findDuplicateRequirements<
  T extends DuplicateRequirementCandidate & { id?: string; status?: string },
>(input: DuplicateRequirementCandidate, existing: T[], options: { excludeId?: string } = {}): Array<DuplicateRequirementMatch<T>> {
  const wantDepartment = normalizeText(input.departmentId);
  const wantDesignation = normalizeText(input.designation);
  if (!wantDepartment || !wantDesignation) return [];

  const wantProject = normalizeText(input.projectId);
  const wantLocation = normalizeText(input.locationId) || normalizeText(input.location);

  const matches: Array<DuplicateRequirementMatch<T>> = [];
  for (const row of existing || []) {
    if (options.excludeId && row.id === options.excludeId) continue;
    if (row.status && !isOpenRequirementStatus(row.status)) continue;
    if (normalizeText(row.departmentId) !== wantDepartment) continue;
    if (normalizeText(row.designation) !== wantDesignation) continue;

    const matchedOn: DuplicateRequirementMatch<T>['matchedOn'] = ['department', 'designation'];
    const rowProject = normalizeText(row.projectId);
    const rowLocation = normalizeText(row.locationId) || normalizeText(row.location);

    if (wantProject && rowProject && wantProject === rowProject) matchedOn.push('project');
    if (wantLocation && rowLocation && wantLocation === rowLocation) matchedOn.push('location');

    // Where both sides name a project or a location, they have to agree; where neither does, the
    // department+designation match alone is enough to be worth a look.
    const placeStated = Boolean((wantProject && rowProject) || (wantLocation && rowLocation));
    const placeAgrees = matchedOn.includes('project') || matchedOn.includes('location');
    if (placeStated && !placeAgrees) continue;

    matches.push({ requirement: row, matchedOn });
  }
  return matches;
}

/* ------------------------------------------------------------------------------------------------
 * Duplicate candidate detection (spec sections 19, 20)
 * ---------------------------------------------------------------------------------------------- */

export interface CandidateIdentity {
  name?: string;
  mobile?: string;
  email?: string;
  pan?: string;
  dateOfBirth?: string;
}

/** Last ten digits of a phone number, so +91-98765 43210 and 9876543210 compare equal. */
export const normalizeMobile = (value: string | undefined | null) => {
  const digits = (value || '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
};

export const normalizeEmail = (value: string | undefined | null) => (value || '').trim().toLowerCase();

export const normalizePan = (value: string | undefined | null) => (value || '').trim().toUpperCase().replace(/\s/g, '');

/**
 * A stable identity key for a candidate, used to spot the same person arriving through a second
 * channel (spec section 20).
 *
 * Mobile first because it is the one identifier an Indian candidate reliably has and rarely changes
 * between applications; email second; PAN only when it has been collected, which is late in the
 * process. Returns an empty string when nothing identifying is present, and callers treat that as
 * "cannot match" rather than "matches everything".
 */
export function candidateFingerprint(identity: CandidateIdentity): string {
  const mobile = normalizeMobile(identity.mobile);
  if (mobile.length === 10) return `m:${mobile}`;
  const email = normalizeEmail(identity.email);
  if (email) return `e:${email}`;
  const pan = normalizePan(identity.pan);
  if (pan) return `p:${pan}`;
  return '';
}

export interface DuplicateCandidateMatch<T> {
  candidate: T;
  matchedOn: Array<'mobile' | 'email' | 'pan' | 'name+dob'>;
  /** 'exact' for a mobile/email/PAN hit; 'probable' for name+DOB alone, which HR must eyeball. */
  confidence: 'exact' | 'probable';
}

/**
 * Matches an incoming candidate against the candidate master.
 *
 * Name + DOB is reported as `probable` rather than `exact` and never on its own suppresses a new
 * profile: namesakes with the same birth year are common enough in a workforce of this size that
 * silently merging two people would be the more expensive error. Control rule 63.8 requires reuse of
 * the existing profile when the match is exact.
 */
export function findDuplicateCandidates<T extends CandidateIdentity & { id?: string }>(
  identity: CandidateIdentity,
  existing: T[],
  options: { excludeId?: string } = {},
): Array<DuplicateCandidateMatch<T>> {
  const mobile = normalizeMobile(identity.mobile);
  const email = normalizeEmail(identity.email);
  const pan = normalizePan(identity.pan);
  const name = normalizeText(identity.name);
  const dob = (identity.dateOfBirth || '').trim();

  const matches: Array<DuplicateCandidateMatch<T>> = [];
  for (const row of existing || []) {
    if (options.excludeId && row.id === options.excludeId) continue;
    const matchedOn: DuplicateCandidateMatch<T>['matchedOn'] = [];

    if (mobile.length === 10 && normalizeMobile(row.mobile) === mobile) matchedOn.push('mobile');
    if (email && normalizeEmail(row.email) === email) matchedOn.push('email');
    if (pan && normalizePan(row.pan) === pan) matchedOn.push('pan');
    if (name && dob && normalizeText(row.name) === name && (row.dateOfBirth || '').trim() === dob) {
      matchedOn.push('name+dob');
    }

    if (matchedOn.length === 0) continue;
    const exact = matchedOn.some(field => field !== 'name+dob');
    matches.push({ candidate: row, matchedOn, confidence: exact ? 'exact' : 'probable' });
  }

  // Exact matches first, so a UI that only shows the top hit shows the one worth acting on.
  return matches.sort((a, b) => (a.confidence === b.confidence ? 0 : a.confidence === 'exact' ? -1 : 1));
}

/* ------------------------------------------------------------------------------------------------
 * CTC band evaluation (spec sections 9, 28)
 * ---------------------------------------------------------------------------------------------- */

export interface CtcBandEvaluation {
  proposed: number;
  bandMin: number;
  bandMax: number;
  withinBand: boolean;
  /** Above the ceiling, or below the floor — signed, positive means above. */
  varianceAmount: number;
  variancePercent: number;
  /** True once the excess exceeds the configured tolerance and approval must be routed (§28). */
  requiresApproval: boolean;
  severity: 'Within band' | 'Below band' | 'Within tolerance' | 'Above band';
  message: string;
}

/**
 * Compares a proposed CTC with the grade's approved band (spec sections 9 and 28).
 *
 * The variance is measured against the ceiling that was breached rather than against the band's
 * midpoint, because "14% above the approved band" is the sentence an approver needs to see and the
 * one the spec puts on screen. A `tolerancePercent` of 0 — the default — means any rupee above the
 * ceiling routes for compensation approval; organisations that want recruiters to have a small
 * negotiating margin raise it in settings.
 *
 * Below the floor is reported but never blocks: underpaying against the band is a fairness question
 * for HR to see, not a control the system should enforce by refusing the offer.
 */
export function evaluateCtcAgainstBand(input: {
  proposedCtc: number;
  bandMin?: number;
  bandMax?: number;
  tolerancePercent?: number;
}): CtcBandEvaluation {
  const proposed = roundMoney(input.proposedCtc);
  const bandMin = roundMoney(input.bandMin || 0);
  const bandMax = roundMoney(input.bandMax || 0);
  const tolerancePercent = Math.max(0, Number(input.tolerancePercent) || 0);

  // With no band configured there is nothing to breach; treat it as within band rather than
  // routing every offer to Finance because a grade master row is missing.
  if (bandMax <= 0) {
    return {
      proposed,
      bandMin,
      bandMax,
      withinBand: true,
      varianceAmount: 0,
      variancePercent: 0,
      requiresApproval: false,
      severity: 'Within band',
      message: 'No approved salary band is configured for this grade.',
    };
  }

  if (proposed > bandMax) {
    const varianceAmount = roundMoney(proposed - bandMax);
    const variancePercent = roundPercent((varianceAmount / bandMax) * 100);
    const requiresApproval = variancePercent > tolerancePercent;
    return {
      proposed,
      bandMin,
      bandMax,
      withinBand: false,
      varianceAmount,
      variancePercent,
      requiresApproval,
      severity: requiresApproval ? 'Above band' : 'Within tolerance',
      message: requiresApproval
        ? `CTC exceeds approved salary band by ${variancePercent}%. Additional compensation approval required.`
        : `CTC exceeds approved salary band by ${variancePercent}%, within the ${tolerancePercent}% tolerance.`,
    };
  }

  if (bandMin > 0 && proposed < bandMin) {
    const varianceAmount = roundMoney(proposed - bandMin);
    const variancePercent = roundPercent((varianceAmount / bandMin) * 100);
    return {
      proposed,
      bandMin,
      bandMax,
      withinBand: false,
      varianceAmount,
      variancePercent,
      requiresApproval: false,
      severity: 'Below band',
      message: `CTC is ${Math.abs(variancePercent)}% below the approved band minimum.`,
    };
  }

  return {
    proposed,
    bandMin,
    bandMax,
    withinBand: true,
    varianceAmount: 0,
    variancePercent: 0,
    requiresApproval: false,
    severity: 'Within band',
    message: 'CTC is within the approved salary band.',
  };
}

/** Salary increase over the candidate's current CTC, for the selection proposal (spec section 27). */
export function ctcIncreasePercent(currentCtc: number | undefined, proposedCtc: number | undefined): number {
  const current = roundMoney(currentCtc || 0);
  const proposed = roundMoney(proposedCtc || 0);
  if (current <= 0) return 0;
  return roundPercent(((proposed - current) / current) * 100);
}

/** Annualised manpower cost of a requirement, shown to approvers (spec section 14). */
export function annualManpowerCost(input: { expectedCtc?: number; quantity?: number }): number {
  return roundMoney((Number(input.expectedCtc) || 0) * Math.max(0, Math.floor(Number(input.quantity) || 0)));
}

/* ------------------------------------------------------------------------------------------------
 * Approval matrix (spec sections 12, 13, 14)
 * ---------------------------------------------------------------------------------------------- */

export type HrApprovalStageKey =
  | 'REQUESTING_MANAGER'
  | 'DEPARTMENT_HOD'
  | 'PROJECT_HEAD'
  | 'HR_MANAGER'
  | 'HR_HEAD'
  | 'FINANCE'
  | 'PROJECT_COMMERCIAL'
  | 'DIRECTOR_HR'
  | 'DIRECTOR'
  | 'MD_ED';

export const HR_APPROVAL_STAGE_KEYS: HrApprovalStageKey[] = [
  'REQUESTING_MANAGER', 'DEPARTMENT_HOD', 'PROJECT_HEAD', 'HR_MANAGER', 'HR_HEAD', 'FINANCE',
  'PROJECT_COMMERCIAL', 'DIRECTOR_HR', 'DIRECTOR', 'MD_ED',
];

export const HR_APPROVAL_STAGE_LABELS: Record<HrApprovalStageKey, string> = {
  REQUESTING_MANAGER: 'Requesting manager',
  DEPARTMENT_HOD: 'Department HOD',
  PROJECT_HEAD: 'Project head',
  HR_MANAGER: 'HR manager',
  HR_HEAD: 'HR head',
  FINANCE: 'Finance / Budget',
  PROJECT_COMMERCIAL: 'Project / Commercial',
  DIRECTOR_HR: 'Director HR',
  DIRECTOR: 'Director',
  MD_ED: 'MD / ED',
};

/**
 * How a stage finds its approvers. Mirrors the assignment types of the app-wide workflow engine in
 * `workflow-utils.ts` so that HR approvals resolve the same way requisition workflows do, rather
 * than inventing a second vocabulary for the same idea.
 */
export type HrAssignmentType = 'User-based' | 'Role-based' | 'Department-based' | 'Project-based' | 'Reporting-based';

export interface HrApprovalStage {
  key: HrApprovalStageKey;
  label?: string;
  assignmentType: HrAssignmentType;
  /** User IDs for User-based; role names for Role-based. */
  userIds?: string[];
  roles?: string[];
  /** departmentId/projectId → approver, for the map-based assignment types. */
  assignmentMap?: Record<string, { primary: string; alternative?: string }>;
  /** Which relationship to walk for Reporting-based: the requester's manager, or the dept HOD. */
  reportingSource?: 'requesting-manager' | 'department-hod' | 'project-head';
  /** Turnaround in hours, fed to the app's business-hours deadline calculation. */
  tatHours?: number;
  /** A stage everyone in `userIds` must clear, rather than any one of them. */
  requireAll?: boolean;
  optional?: boolean;
}

export interface HrApprovalCondition {
  requirementTypes?: RequirementType[];
  employmentTypes?: EmploymentType[];
  priorities?: RequirementPriority[];
  grades?: string[];
  departmentIds?: string[];
  projectIds?: string[];
  /** Matches when the requirement is for a senior-management grade (spec section 13). */
  seniorManagement?: boolean;
  /** Matches a replacement whose proposed CTC is above the outgoing employee's (section 13). */
  salaryIncrease?: boolean;
  /** Matches when proposed CTC breaches the grade band (section 9). */
  ctcAboveBand?: boolean;
  /** Matches when the requirement stays inside the sanctioned manpower plan (section 4). */
  withinManpowerPlan?: boolean;
  /** Matches when it pushes headcount past sanctioned strength. */
  aboveSanctionedStrength?: boolean;
  minPositions?: number;
  minAnnualCost?: number;
}

export interface HrApprovalRule {
  id: string;
  organizationId?: string;
  name: string;
  active?: boolean;
  /** Tie-break when two rules match equally specifically; lower runs first. */
  order?: number;
  when: HrApprovalCondition;
  stages: HrApprovalStage[];
  /** Critical hiring's fast-track route (spec section 13). */
  fastTrack?: boolean;
}

export interface RequirementApprovalContext {
  requirementType: RequirementType;
  employmentType?: EmploymentType;
  priority?: RequirementPriority;
  grade?: string;
  departmentId?: string;
  projectId?: string;
  positions: number;
  expectedCtc?: number;
  /** The outgoing employee's CTC, for the replacement-with-increase condition. */
  replacedEmployeeCtc?: number;
  seniorManagement?: boolean;
  ctcAboveBand?: boolean;
  withinManpowerPlan?: boolean;
  aboveSanctionedStrength?: boolean;
}

export interface ResolvedApprovalChain {
  ruleId: string | null;
  ruleName: string;
  stages: HrApprovalStage[];
  fastTrack: boolean;
  /** Which conditions of the winning rule actually matched — shown in the approval trail. */
  matchedOn: string[];
}

/**
 * Scores one rule against a requirement.
 *
 * Returns null when any stated condition fails, and otherwise the number of conditions that had to
 * be satisfied. That count is the specificity: a rule naming "new position + above sanctioned
 * strength + ≥ ₹50L annual cost" beats a rule naming "new position" alone, without anyone having to
 * maintain a hand-ordered list as the matrix grows.
 */
function scoreApprovalRule(rule: HrApprovalRule, context: RequirementApprovalContext): { score: number; matchedOn: string[] } | null {
  const when = rule.when || {};
  const matchedOn: string[] = [];
  let score = 0;

  const listMatch = <V>(allowed: V[] | undefined, value: V | undefined, label: string): boolean => {
    if (!allowed || allowed.length === 0) return true;
    if (value === undefined || value === null || !allowed.includes(value)) return false;
    score += 1;
    matchedOn.push(label);
    return true;
  };

  const flagMatch = (expected: boolean | undefined, actual: boolean | undefined, label: string): boolean => {
    if (expected === undefined) return true;
    if (Boolean(actual) !== expected) return false;
    score += 1;
    matchedOn.push(label);
    return true;
  };

  if (!listMatch(when.requirementTypes, context.requirementType, 'requirement type')) return null;
  if (!listMatch(when.employmentTypes, context.employmentType, 'employment type')) return null;
  if (!listMatch(when.priorities, context.priority, 'priority')) return null;
  if (!listMatch(when.grades, context.grade, 'grade')) return null;
  if (!listMatch(when.departmentIds, context.departmentId, 'department')) return null;
  if (!listMatch(when.projectIds, context.projectId, 'project')) return null;

  if (!flagMatch(when.seniorManagement, context.seniorManagement, 'senior management')) return null;
  if (!flagMatch(when.ctcAboveBand, context.ctcAboveBand, 'CTC above band')) return null;
  if (!flagMatch(when.withinManpowerPlan, context.withinManpowerPlan, 'within manpower plan')) return null;
  if (!flagMatch(when.aboveSanctionedStrength, context.aboveSanctionedStrength, 'above sanctioned strength')) return null;

  if (when.salaryIncrease !== undefined) {
    const increase = (Number(context.expectedCtc) || 0) > (Number(context.replacedEmployeeCtc) || 0)
      && (Number(context.replacedEmployeeCtc) || 0) > 0;
    if (increase !== when.salaryIncrease) return null;
    score += 1;
    matchedOn.push('salary increase');
  }

  if (when.minPositions !== undefined) {
    if ((Number(context.positions) || 0) < when.minPositions) return null;
    score += 1;
    matchedOn.push(`${when.minPositions}+ positions`);
  }

  if (when.minAnnualCost !== undefined) {
    const cost = annualManpowerCost({ expectedCtc: context.expectedCtc, quantity: context.positions });
    if (cost < when.minAnnualCost) return null;
    score += 1;
    matchedOn.push('annual cost threshold');
  }

  return { score, matchedOn };
}

/**
 * Picks the approval chain for a requirement (spec sections 12 and 13).
 *
 * Most specific match wins; ties break on the rule's `order` and then on its position in the list,
 * so the configuration screen's drag order remains meaningful for genuinely ambiguous cases. When
 * nothing matches, the caller's `fallbackStages` apply — the module must never leave a submitted
 * requirement with an empty chain, because that is a requisition nobody can approve and nobody can
 * see is stuck.
 */
export function resolveRequirementApprovalChain(
  context: RequirementApprovalContext,
  rules: HrApprovalRule[],
  fallbackStages: HrApprovalStage[] = [],
): ResolvedApprovalChain {
  let best: { rule: HrApprovalRule; score: number; matchedOn: string[]; index: number } | null = null;

  (rules || []).forEach((rule, index) => {
    if (rule.active === false) return;
    if (!rule.stages || rule.stages.length === 0) return;
    const scored = scoreApprovalRule(rule, context);
    if (!scored) return;
    if (
      !best ||
      scored.score > best.score ||
      (scored.score === best.score && (rule.order ?? Number.MAX_SAFE_INTEGER) < (best.rule.order ?? Number.MAX_SAFE_INTEGER)) ||
      (scored.score === best.score && (rule.order ?? Number.MAX_SAFE_INTEGER) === (best.rule.order ?? Number.MAX_SAFE_INTEGER) && index < best.index)
    ) {
      best = { rule, score: scored.score, matchedOn: scored.matchedOn, index };
    }
  });

  if (!best) {
    return { ruleId: null, ruleName: 'Default approval chain', stages: fallbackStages, fastTrack: false, matchedOn: [] };
  }

  const winner = best as { rule: HrApprovalRule; score: number; matchedOn: string[]; index: number };
  return {
    ruleId: winner.rule.id,
    ruleName: winner.rule.name,
    stages: winner.rule.stages,
    fastTrack: Boolean(winner.rule.fastTrack),
    matchedOn: winner.matchedOn,
  };
}

export interface StageApproverContext {
  requestingManagerId?: string;
  departmentHodId?: string;
  projectHeadId?: string;
  departmentId?: string;
  projectId?: string;
  /** userId → role name, for Role-based stages. */
  roleByUserId?: Record<string, string>;
}

/**
 * Resolves the user IDs that may act on one approval stage.
 *
 * Alternatives are included alongside primaries rather than only on escalation: an approval waiting
 * on a single person is the most common way a requisition sits for a week, and section 41's
 * escalation ladder is about notifying *upwards*, not about finally letting a deputy act.
 */
export function resolveStageApprovers(stage: HrApprovalStage, context: StageApproverContext): string[] {
  const approvers: Array<string | undefined> = [];

  switch (stage.assignmentType) {
    case 'User-based':
      approvers.push(...(stage.userIds || []));
      break;

    case 'Role-based': {
      const wanted = new Set((stage.roles || []).map(role => normalizeText(role)));
      for (const [userId, role] of Object.entries(context.roleByUserId || {})) {
        if (wanted.has(normalizeText(role))) approvers.push(userId);
      }
      break;
    }

    case 'Department-based': {
      const assignment = context.departmentId ? stage.assignmentMap?.[context.departmentId] : undefined;
      if (assignment) approvers.push(assignment.primary, assignment.alternative);
      else approvers.push(context.departmentHodId);
      break;
    }

    case 'Project-based': {
      const assignment = context.projectId ? stage.assignmentMap?.[context.projectId] : undefined;
      if (assignment) approvers.push(assignment.primary, assignment.alternative);
      else approvers.push(context.projectHeadId);
      break;
    }

    case 'Reporting-based': {
      if (stage.reportingSource === 'department-hod') approvers.push(context.departmentHodId);
      else if (stage.reportingSource === 'project-head') approvers.push(context.projectHeadId);
      else approvers.push(context.requestingManagerId);
      break;
    }
  }

  return Array.from(new Set(approvers.filter((id): id is string => Boolean(id))));
}

/** The requirement status that corresponds to whichever stage is currently pending (section 39). */
export function requirementStatusForStage(stage: HrApprovalStageKey | undefined): RequirementStatus {
  switch (stage) {
    case 'DEPARTMENT_HOD':
    case 'PROJECT_HEAD':
      return 'PENDING_HOD_APPROVAL';
    case 'HR_MANAGER':
    case 'HR_HEAD':
      return 'PENDING_HR_APPROVAL';
    case 'FINANCE':
    case 'PROJECT_COMMERCIAL':
      return 'PENDING_BUDGET_APPROVAL';
    case 'DIRECTOR':
    case 'DIRECTOR_HR':
    case 'MD_ED':
      return 'PENDING_MANAGEMENT_APPROVAL';
    case 'REQUESTING_MANAGER':
      return 'SUBMITTED';
    default:
      return 'APPROVED';
  }
}

export type ApprovalAction =
  | 'Approve'
  | 'Reject'
  | 'Send Back'
  | 'Request Clarification'
  | 'Forward'
  | 'Delegate'
  | 'Approve With Condition';

export const APPROVAL_ACTIONS: ApprovalAction[] = [
  'Approve', 'Reject', 'Send Back', 'Request Clarification', 'Forward', 'Delegate', 'Approve With Condition',
];

/** Actions that need a written reason before the button does anything (spec section 14). */
export const APPROVAL_ACTIONS_REQUIRING_REMARKS: ApprovalAction[] = [
  'Reject', 'Send Back', 'Request Clarification', 'Approve With Condition',
];

/* ------------------------------------------------------------------------------------------------
 * SLA and escalation (spec sections 40, 41, 42)
 * ---------------------------------------------------------------------------------------------- */

export type SlaTargets = Record<RequirementPriority, number>;

/** Starting points, not policy — every organisation edits these in settings (spec section 40). */
export const DEFAULT_SLA_TARGETS: SlaTargets = {
  Critical: 15,
  High: 20,
  Normal: 30,
  Low: 45,
};

export interface SlaEvaluation {
  ageDays: number;
  /** Days the clock was paused while on hold, when settings pause it (spec section 42). */
  heldDays: number;
  /** Age net of held days — the figure the SLA is judged on. */
  effectiveAgeDays: number;
  targetDays: number;
  remainingDays: number;
  consumedPercent: number;
  overdueDays: number;
  state: 'Not started' | 'On track' | 'Due soon' | 'Overdue';
  message: string;
}

/**
 * Ages a requirement against its SLA target (spec section 40).
 *
 * The clock starts when recruitment can actually begin — approval, not creation — because holding a
 * recruiter to an SLA that ran while Finance sat on the requisition is how SLA reporting loses its
 * credibility. Time on hold is deducted when `pauseOnHold` is set, which is the configurable
 * behaviour section 42 asks for.
 *
 * 'Due soon' begins at 75% consumed, matching the point where section 41's ladder first widens the
 * notification beyond the recruiter, so the badge and the escalation agree with each other.
 */
export function evaluateRequirementSla(input: {
  /** Approval date, or whenever recruitment became possible. */
  startedAt?: Date | string | null;
  /** Now, or the closure date for a finished requirement. */
  asOf?: Date | string | null;
  targetDays: number;
  heldDays?: number;
  pauseOnHold?: boolean;
}): SlaEvaluation {
  const started = parseHrDate(input.startedAt || null);
  const asOf = parseHrDate(input.asOf || null) || new Date();
  const targetDays = Math.max(1, Math.floor(Number(input.targetDays) || 0) || 1);

  if (!started) {
    return {
      ageDays: 0,
      heldDays: 0,
      effectiveAgeDays: 0,
      targetDays,
      remainingDays: targetDays,
      consumedPercent: 0,
      overdueDays: 0,
      state: 'Not started',
      message: 'Recruitment has not started for this requirement.',
    };
  }

  const ageDays = Math.max(0, dayDifference(started, asOf));
  const heldDays = input.pauseOnHold ? Math.max(0, Math.floor(Number(input.heldDays) || 0)) : 0;
  const effectiveAgeDays = Math.max(0, ageDays - heldDays);
  const consumedPercent = roundPercent((effectiveAgeDays / targetDays) * 100);
  const remainingDays = targetDays - effectiveAgeDays;
  const overdueDays = Math.max(0, -remainingDays);

  const state: SlaEvaluation['state'] = overdueDays > 0 ? 'Overdue' : consumedPercent >= 75 ? 'Due soon' : 'On track';
  const message =
    state === 'Overdue'
      ? `Requirement age ${effectiveAgeDays} days against a ${targetDays}-day target — overdue by ${overdueDays} ${overdueDays === 1 ? 'day' : 'days'}.`
      : `Requirement age ${effectiveAgeDays} days of ${targetDays} — ${Math.max(0, remainingDays)} ${remainingDays === 1 ? 'day' : 'days'} remaining.`;

  return { ageDays, heldDays, effectiveAgeDays, targetDays, remainingDays, consumedPercent, overdueDays, state, message };
}

export type EscalationAudience =
  | 'RECRUITER'
  | 'HR_MANAGER'
  | 'HR_HEAD'
  | 'DEPARTMENT_HOD'
  | 'REQUESTING_MANAGER'
  | 'DIRECTOR';

export interface EscalationLevel {
  /** Percentage of SLA consumed at which this level fires. */
  atPercent: number;
  notify: EscalationAudience[];
  label?: string;
}

/** Section 41's ladder as shipped; entirely configurable. */
export const DEFAULT_ESCALATION_LADDER: EscalationLevel[] = [
  { atPercent: 50, notify: ['RECRUITER'], label: 'Half the SLA consumed' },
  { atPercent: 75, notify: ['RECRUITER', 'HR_MANAGER'], label: 'Three quarters consumed' },
  { atPercent: 100, notify: ['HR_HEAD'], label: 'SLA breached' },
  { atPercent: 120, notify: ['DEPARTMENT_HOD'], label: '20% overdue' },
  { atPercent: 150, notify: ['DIRECTOR'], label: '50% overdue' },
];

/**
 * Which escalation levels have come due and not yet been sent.
 *
 * Takes the levels already notified so the cron of section 41 is idempotent: it runs daily against
 * every open requirement, and a ladder that re-fired every run would train the HR head to filter
 * the module's mail. Returns every newly crossed level, not just the highest, so a requirement that
 * jumps from 40% to 130% between runs still records that it passed 50, 75, 100 and 120.
 */
export function resolveDueEscalations(
  consumedPercent: number,
  ladder: EscalationLevel[] = DEFAULT_ESCALATION_LADDER,
  alreadyNotifiedPercents: number[] = [],
): EscalationLevel[] {
  const sent = new Set((alreadyNotifiedPercents || []).map(value => Number(value)));
  return (ladder || [])
    .filter(level => Number(consumedPercent) >= Number(level.atPercent) && !sent.has(Number(level.atPercent)))
    .sort((a, b) => a.atPercent - b.atPercent);
}

/** Ageing buckets for the requirement-ageing report (spec section 53). */
export const REQUIREMENT_AGEING_BUCKETS = ['0-15', '16-30', '31-45', '46-60', '>60'] as const;
export type RequirementAgeingBucket = (typeof REQUIREMENT_AGEING_BUCKETS)[number];

export function requirementAgeingBucket(ageDays: number): RequirementAgeingBucket {
  const age = Math.max(0, Number(ageDays) || 0);
  if (age <= 15) return '0-15';
  if (age <= 30) return '16-30';
  if (age <= 45) return '31-45';
  if (age <= 60) return '46-60';
  return '>60';
}

export function summarizeRequirementAgeing(
  requirements: Array<{ ageDays?: number; balance?: number }>,
): Array<{ bucket: RequirementAgeingBucket; requirements: number; positions: number }> {
  const buckets = new Map<RequirementAgeingBucket, { requirements: number; positions: number }>();
  REQUIREMENT_AGEING_BUCKETS.forEach(bucket => buckets.set(bucket, { requirements: 0, positions: 0 }));
  for (const row of requirements || []) {
    const entry = buckets.get(requirementAgeingBucket(row.ageDays || 0))!;
    entry.requirements += 1;
    entry.positions += Math.max(0, Math.floor(Number(row.balance) || 0));
  }
  return REQUIREMENT_AGEING_BUCKETS.map(bucket => ({ bucket, ...buckets.get(bucket)! }));
}

/* ------------------------------------------------------------------------------------------------
 * Pipeline movement (spec section 22)
 * ---------------------------------------------------------------------------------------------- */

export interface StageMoveEvaluation {
  allowed: boolean;
  reason: string;
  /** True when the move needs a gate cleared first, so the UI can offer the gate instead. */
  requiresGate?: 'compensation-approval' | 'offer-acceptance' | 'document-verification';
}

/**
 * Whether an application may move from one pipeline stage to another (spec section 22).
 *
 * Free movement within the ordered stages — recruiters legitimately skip a second interview round,
 * and pull a candidate back a stage when a panel wants another look — with three gates that exist
 * because the money or the record of truth depends on them:
 *
 *   • OFFERED needs compensation approval cleared (control rule 63.5)
 *   • OFFER_ACCEPTED cannot be set by hand; the candidate accepts it (§30)
 *   • JOINED comes only from a confirmed joining record, which is what creates the employee (§35)
 *
 * Permission to make a move at all is the caller's business; this decides only whether the move is
 * coherent.
 */
export function evaluateStageMove(input: {
  from: ApplicationStage;
  to: ApplicationStage;
  compensationApproved?: boolean;
  offerAccepted?: boolean;
  documentsVerified?: boolean;
}): StageMoveEvaluation {
  const { from, to } = input;

  if (from === to) return { allowed: false, reason: 'The candidate is already at this stage.' };

  // Any live stage may exit the board; that is what the side exits are for.
  if (isPipelineExit(to)) {
    if (isPipelineExit(from) && !RESUMABLE_PIPELINE_EXITS.includes(from as PipelineExit)) {
      return { allowed: false, reason: `A ${hrStatusLabel(from).toLowerCase()} application cannot be moved to another exit.` };
    }
    return { allowed: true, reason: '' };
  }

  // Coming back from an exit: only the pauses can resume, and only to a stage at or before where
  // they left — a rejected candidate re-enters as a fresh application instead.
  if (isPipelineExit(from)) {
    if (!RESUMABLE_PIPELINE_EXITS.includes(from as PipelineExit)) {
      return {
        allowed: false,
        reason: `A ${hrStatusLabel(from).toLowerCase()} application cannot re-enter the pipeline. Add a new application for this candidate instead.`,
      };
    }
    return { allowed: true, reason: '' };
  }

  if (to === 'JOINED') {
    return {
      allowed: false,
      reason: 'Joining is recorded from the joining screen, which creates the employee record.',
      requiresGate: 'document-verification',
    };
  }

  if (to === 'OFFER_ACCEPTED' && !input.offerAccepted) {
    return {
      allowed: false,
      reason: 'The candidate has to accept the offer; this stage is set when the acceptance is recorded.',
      requiresGate: 'offer-acceptance',
    };
  }

  if (to === 'OFFERED' && !input.compensationApproved) {
    return {
      allowed: false,
      reason: 'Compensation approval must be cleared before an offer is released.',
      requiresGate: 'compensation-approval',
    };
  }

  const fromIndex = PIPELINE_STAGES.indexOf(from as PipelineStage);
  const toIndex = PIPELINE_STAGES.indexOf(to as PipelineStage);
  if (fromIndex < 0 || toIndex < 0) return { allowed: false, reason: 'Unknown pipeline stage.' };

  return { allowed: true, reason: '' };
}

/** Screening outcomes (spec section 23). */
export type ScreeningResult = 'Shortlist' | 'Reject' | 'Hold' | 'Talent Pool';

export const SCREENING_RESULTS: ScreeningResult[] = ['Shortlist', 'Reject', 'Hold', 'Talent Pool'];

/** The pipeline stage a screening decision moves the application to. */
export function stageForScreeningResult(result: ScreeningResult): ApplicationStage {
  switch (result) {
    case 'Shortlist':
      return 'SHORTLISTED';
    case 'Reject':
      return 'REJECTED';
    case 'Hold':
      return 'ON_HOLD';
    case 'Talent Pool':
      return 'TALENT_POOL';
  }
}

/* ------------------------------------------------------------------------------------------------
 * Interview evaluation (spec sections 25, 26)
 * ---------------------------------------------------------------------------------------------- */

export const INTERVIEW_RATING_CRITERIA = [
  'technicalKnowledge',
  'relevantExperience',
  'problemSolving',
  'communication',
  'leadership',
  'roleSuitability',
  'cultureBehaviour',
] as const;

export type InterviewRatingCriterion = (typeof INTERVIEW_RATING_CRITERIA)[number];

export const INTERVIEW_RATING_LABELS: Record<InterviewRatingCriterion, string> = {
  technicalKnowledge: 'Technical knowledge',
  relevantExperience: 'Relevant experience',
  problemSolving: 'Problem solving',
  communication: 'Communication',
  leadership: 'Leadership',
  roleSuitability: 'Role suitability',
  cultureBehaviour: 'Culture / behaviour',
};

export type InterviewRatings = Partial<Record<InterviewRatingCriterion, number>>;

export type InterviewRecommendation = 'Strong Hire' | 'Hire' | 'Hold' | 'Not Recommended';

export const INTERVIEW_RECOMMENDATIONS: InterviewRecommendation[] = ['Strong Hire', 'Hire', 'Hold', 'Not Recommended'];

/** Weights for aggregating a panel's recommendations. A veto is worth more than a yes. */
const RECOMMENDATION_WEIGHT: Record<InterviewRecommendation, number> = {
  'Strong Hire': 2,
  Hire: 1,
  Hold: 0,
  'Not Recommended': -2,
};

/** Mean of whichever criteria the interviewer actually rated, out of 5. */
export function interviewFeedbackScore(ratings: InterviewRatings | undefined | null): number {
  const values = INTERVIEW_RATING_CRITERIA
    .map(criterion => Number(ratings?.[criterion]))
    .filter(value => Number.isFinite(value) && value > 0);
  if (values.length === 0) return 0;
  return roundPercent(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export interface PanelSummary {
  feedbackCount: number;
  pendingCount: number;
  averageScore: number;
  perCriterion: Array<{ criterion: InterviewRatingCriterion; label: string; average: number }>;
  recommendationCounts: Record<InterviewRecommendation, number>;
  panelRecommendation: 'Recommended' | 'Hold' | 'Not Recommended' | 'Awaiting feedback';
  /** True when at least one interviewer said Not Recommended, whatever the aggregate says. */
  hasDissent: boolean;
}

/**
 * Aggregates a panel's feedback for the selection screen (spec section 27).
 *
 * `hasDissent` is surfaced separately from the aggregate on purpose. A panel of four where three say
 * Hire and one says Not Recommended aggregates to Recommended, and the person who objected is
 * exactly what the selection committee needs to read — averaging that objection away is how a
 * technical veto gets lost between the interview and the offer.
 */
export function summarizePanelFeedback(
  entries: Array<{ ratings?: InterviewRatings; recommendation?: InterviewRecommendation; submitted?: boolean }>,
  expectedCount?: number,
): PanelSummary {
  const submitted = (entries || []).filter(entry => entry.submitted !== false);
  const recommendationCounts: Record<InterviewRecommendation, number> = {
    'Strong Hire': 0,
    Hire: 0,
    Hold: 0,
    'Not Recommended': 0,
  };

  let weight = 0;
  for (const entry of submitted) {
    if (entry.recommendation && recommendationCounts[entry.recommendation] !== undefined) {
      recommendationCounts[entry.recommendation] += 1;
      weight += RECOMMENDATION_WEIGHT[entry.recommendation];
    }
  }

  const scores = submitted.map(entry => interviewFeedbackScore(entry.ratings)).filter(score => score > 0);
  const averageScore = scores.length ? roundPercent(scores.reduce((sum, score) => sum + score, 0) / scores.length) : 0;

  const perCriterion = INTERVIEW_RATING_CRITERIA.map(criterion => {
    const values = submitted
      .map(entry => Number(entry.ratings?.[criterion]))
      .filter(value => Number.isFinite(value) && value > 0);
    return {
      criterion,
      label: INTERVIEW_RATING_LABELS[criterion],
      average: values.length ? roundPercent(values.reduce((sum, value) => sum + value, 0) / values.length) : 0,
    };
  });

  const panelRecommendation: PanelSummary['panelRecommendation'] = (() => {
    if (submitted.length === 0) return 'Awaiting feedback';
    if (weight > 0) return 'Recommended';
    if (weight < 0) return 'Not Recommended';
    return 'Hold';
  })();

  return {
    feedbackCount: submitted.length,
    pendingCount: Math.max(0, (Number(expectedCount) || submitted.length) - submitted.length),
    averageScore,
    perCriterion,
    recommendationCounts,
    panelRecommendation,
    hasDissent: recommendationCounts['Not Recommended'] > 0,
  };
}

/**
 * Whether interviewer feedback may still be edited (spec section 26, control rule 63.6).
 *
 * Submitted feedback is append-only: a correction becomes a new revision with its own author and
 * timestamp. Only an explicitly authorised reviser gets to add one, and never the recruiter by
 * default — the point of the rule is that the panel's record cannot be quietly improved after a
 * selection decision goes the other way.
 */
export function canReviseFeedback(input: {
  submitted: boolean;
  isAuthor: boolean;
  hasRevisePermission: boolean;
  allowAuthorRevision?: boolean;
}): { allowed: boolean; reason: string } {
  if (!input.submitted) return { allowed: true, reason: '' };
  if (input.hasRevisePermission) return { allowed: true, reason: '' };
  if (input.isAuthor && input.allowAuthorRevision) return { allowed: true, reason: '' };
  return {
    allowed: false,
    reason: 'Submitted interview feedback cannot be changed. Ask HR to authorise a revision, which is recorded separately.',
  };
}

/* ------------------------------------------------------------------------------------------------
 * Recruitment analytics (spec sections 52, 53)
 * ---------------------------------------------------------------------------------------------- */

export interface FunnelStageCount {
  stage: string;
  label: string;
  count: number;
  /** Percentage of the widest stage above it, so a funnel chart can render straight from this. */
  conversionFromPrevious: number;
  conversionFromTop: number;
}

export interface HiringFunnel {
  total: number;
  stages: FunnelStageCount[];
  offerAcceptanceRate: number;
  joiningConversionRate: number;
  rejectionRate: number;
  noShowRate: number;
}

/**
 * The recruitment funnel of section 53.
 *
 * Counts an application at every stage it has *reached*, not the stage it currently sits at, which
 * is the only way a funnel means anything: measuring current stages would show one candidate at
 * JOINED and nothing above, implying a screening step that nobody passed through.
 * `stagesReached` therefore comes from the application's stage history.
 */
export function summarizeHiringFunnel(
  applications: Array<{ stage?: ApplicationStage; stagesReached?: ApplicationStage[] }>,
): HiringFunnel {
  const rows = applications || [];
  const total = rows.length;

  const reachedCount = (stage: PipelineStage) =>
    rows.filter(row => {
      const reached = row.stagesReached && row.stagesReached.length > 0 ? row.stagesReached : row.stage ? [row.stage] : [];
      if (reached.includes(stage)) return true;
      // An application whose current stage is further along has necessarily passed this one, even
      // when history is missing — the case for records migrated in from an older sheet.
      const currentIndex = PIPELINE_STAGES.indexOf(row.stage as PipelineStage);
      return currentIndex >= 0 && currentIndex >= PIPELINE_STAGES.indexOf(stage);
    }).length;

  const stageRows = PIPELINE_STAGES.map(stage => ({ stage, count: reachedCount(stage) }));

  const stages: FunnelStageCount[] = stageRows.map((row, index) => {
    const previous = index > 0 ? stageRows[index - 1].count : total;
    return {
      stage: row.stage,
      label: hrStatusLabel(row.stage),
      count: row.count,
      conversionFromPrevious: previous > 0 ? roundPercent((row.count / previous) * 100) : 0,
      conversionFromTop: total > 0 ? roundPercent((row.count / total) * 100) : 0,
    };
  });

  const countBy = (stage: ApplicationStage) => rows.filter(row => row.stage === stage).length;
  const offered = reachedCount('OFFERED');
  const accepted = reachedCount('OFFER_ACCEPTED');
  const joined = reachedCount('JOINED');

  return {
    total,
    stages,
    offerAcceptanceRate: offered > 0 ? roundPercent((accepted / offered) * 100) : 0,
    joiningConversionRate: accepted > 0 ? roundPercent((joined / accepted) * 100) : 0,
    rejectionRate: total > 0 ? roundPercent((countBy('REJECTED') / total) * 100) : 0,
    noShowRate: accepted > 0 ? roundPercent((countBy('NO_SHOW') / accepted) * 100) : 0,
  };
}

export interface SourceEffectivenessRow {
  source: string;
  applied: number;
  shortlisted: number;
  interviewed: number;
  offered: number;
  joined: number;
  /** Joined per hundred applied — the number that decides next year's portal spend. */
  yieldPercent: number;
  costPerJoin: number;
}

/** Source effectiveness (spec sections 18, 53). */
export function summarizeSourceEffectiveness(
  applications: Array<{ source?: string; stage?: ApplicationStage; stagesReached?: ApplicationStage[] }>,
  costBySource: Record<string, number> = {},
): SourceEffectivenessRow[] {
  const bySource = new Map<string, Array<{ stage?: ApplicationStage; stagesReached?: ApplicationStage[] }>>();
  for (const row of applications || []) {
    const source = row.source || 'Unspecified';
    if (!bySource.has(source)) bySource.set(source, []);
    bySource.get(source)!.push(row);
  }

  const rows: SourceEffectivenessRow[] = [];
  for (const [source, entries] of bySource) {
    const funnel = summarizeHiringFunnel(entries);
    const stageCount = (stage: PipelineStage) => funnel.stages.find(row => row.stage === stage)?.count || 0;
    const joined = stageCount('JOINED');
    const cost = roundMoney(costBySource[source] || 0);
    rows.push({
      source,
      applied: entries.length,
      shortlisted: stageCount('SHORTLISTED'),
      interviewed: stageCount('INTERVIEW_1'),
      offered: stageCount('OFFERED'),
      joined,
      yieldPercent: entries.length > 0 ? roundPercent((joined / entries.length) * 100) : 0,
      costPerJoin: joined > 0 ? roundMoney(cost / joined) : cost,
    });
  }

  return rows.sort((a, b) => b.joined - a.joined || b.yieldPercent - a.yieldPercent);
}

export type RecruitmentCostHead =
  | 'Job Portal'
  | 'Agency Fee'
  | 'Advertisement'
  | 'Travel Reimbursement'
  | 'Interview Expense'
  | 'Candidate Relocation'
  | 'Medical Test'
  | 'Background Verification'
  | 'Joining Bonus'
  | 'Other';

export const RECRUITMENT_COST_HEADS: RecruitmentCostHead[] = [
  'Job Portal', 'Agency Fee', 'Advertisement', 'Travel Reimbursement', 'Interview Expense',
  'Candidate Relocation', 'Medical Test', 'Background Verification', 'Joining Bonus', 'Other',
];

export interface RecruitmentCostSummary {
  byHead: Array<{ head: string; amount: number }>;
  total: number;
  joined: number;
  costPerHire: number;
}

/** Cost tracking and cost per hire (spec section 52). */
export function summarizeRecruitmentCost(
  costs: Array<{ head?: string; amount?: number }>,
  joinedCount: number,
): RecruitmentCostSummary {
  const totals = new Map<string, number>();
  for (const row of costs || []) {
    const head = row.head || 'Other';
    totals.set(head, roundMoney((totals.get(head) || 0) + (Number(row.amount) || 0)));
  }
  const byHead = Array.from(totals, ([head, amount]) => ({ head, amount })).sort((a, b) => b.amount - a.amount);
  const total = roundMoney(byHead.reduce((sum, row) => sum + row.amount, 0));
  const joined = Math.max(0, Math.floor(Number(joinedCount) || 0));
  return { byHead, total, joined, costPerHire: joined > 0 ? roundMoney(total / joined) : total };
}

/**
 * Time to hire, in days, from requirement approval to the candidate's joining (spec section 53).
 * Returns null when either end is missing rather than a misleading zero.
 */
export function timeToHireDays(input: { approvedAt?: Date | string | null; joinedAt?: Date | string | null }): number | null {
  const from = parseHrDate(input.approvedAt || null);
  const to = parseHrDate(input.joinedAt || null);
  if (!from || !to) return null;
  return Math.max(0, dayDifference(from, to));
}

/** Mean of the non-null time-to-hire values, for the dashboard's average-time-to-hire card. */
export function averageTimeToHire(rows: Array<{ approvedAt?: Date | string | null; joinedAt?: Date | string | null }>): number {
  const values = (rows || []).map(timeToHireDays).filter((value): value is number => value !== null);
  if (values.length === 0) return 0;
  return roundPercent(values.reduce((sum, value) => sum + value, 0) / values.length);
}

/* ------------------------------------------------------------------------------------------------
 * Pre-joining and document readiness (spec sections 31, 32, 33)
 * ---------------------------------------------------------------------------------------------- */

export interface DocumentChecklistSummary {
  total: number;
  verified: number;
  waived: number;
  pending: number;
  rejected: number;
  mandatoryPending: number;
  completionPercent: number;
  /** Every mandatory document verified or waived — the gate on confirming a joining (§34, §35). */
  readyForJoining: boolean;
}

export function summarizeDocumentChecklist(
  items: Array<{ status?: DocumentVerificationStatus; mandatory?: boolean }>,
): DocumentChecklistSummary {
  const rows = items || [];
  const settled = rows.filter(row => SETTLED_DOCUMENT_STATUSES.includes(row.status as DocumentVerificationStatus));
  const verified = rows.filter(row => row.status === 'VERIFIED').length;
  const waived = rows.filter(row => row.status === 'WAIVED').length;
  const rejected = rows.filter(row => row.status === 'REJECTED' || row.status === 'REUPLOAD_REQUIRED').length;
  const mandatoryPending = rows.filter(
    row => row.mandatory !== false && !SETTLED_DOCUMENT_STATUSES.includes(row.status as DocumentVerificationStatus),
  ).length;

  return {
    total: rows.length,
    verified,
    waived,
    pending: rows.length - settled.length,
    rejected,
    mandatoryPending,
    completionPercent: rows.length > 0 ? roundPercent((settled.length / rows.length) * 100) : 0,
    readyForJoining: rows.length > 0 && mandatoryPending === 0,
  };
}

/** The T-7 / T-3 / T-1 / joining-day reminder schedule of section 33. */
export const DEFAULT_PRE_JOINING_REMINDER_DAYS = [7, 3, 1, 0];

/**
 * Which pre-joining reminders are due for a joining date, excluding ones already sent.
 *
 * Returns the offsets rather than dates so the caller can log exactly which reminder it sent, which
 * is what keeps the daily cron from repeating T-3 every day between T-3 and T-1.
 */
export function dueJoiningReminders(input: {
  joiningDate?: Date | string | null;
  asOf?: Date | string | null;
  reminderDays?: number[];
  alreadySent?: number[];
}): number[] {
  const joining = parseHrDate(input.joiningDate || null);
  if (!joining) return [];
  const asOf = parseHrDate(input.asOf || null) || new Date();
  const sent = new Set((input.alreadySent || []).map(Number));
  const daysToJoining = dayDifference(asOf, joining);
  return (input.reminderDays || DEFAULT_PRE_JOINING_REMINDER_DAYS)
    .filter(offset => daysToJoining <= offset && !sent.has(offset))
    .sort((a, b) => b - a);
}

/* ------------------------------------------------------------------------------------------------
 * Closure readiness (spec section 38)
 * ---------------------------------------------------------------------------------------------- */

export interface ClosureReadiness {
  canCloseFullyFilled: boolean;
  canClosePartially: boolean;
  blockers: string[];
  warnings: string[];
  recommendation: 'Close fully filled' | 'Close partially filled' | 'Keep open' | 'Already closed';
}

/**
 * What the closure screen may offer (spec section 38).
 *
 * Live offers and confirmed joinings ahead are blockers rather than warnings: closing a requirement
 * out from under an accepted offer leaves a candidate arriving on Monday against a requisition that
 * no longer exists, and no amount of reporting recovers that cleanly. Candidates still in the
 * pipeline are only a warning — abandoning a shortlist is a normal, if regrettable, decision.
 */
export function evaluateRequirementClosure(state: {
  status: RequirementStatus | string;
  requestedQuantity: number;
  joinedCount: number;
  liveOfferCount?: number;
  upcomingJoiningCount?: number;
  activeCandidateCount?: number;
  agencySubmissionCount?: number;
}): ClosureReadiness {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (isTerminalRequirementStatus(state.status)) {
    return {
      canCloseFullyFilled: false,
      canClosePartially: false,
      blockers: [`This requirement is already ${hrStatusLabel(String(state.status)).toLowerCase()}.`],
      warnings: [],
      recommendation: 'Already closed',
    };
  }

  const fill = summarizeRequirementFill({
    requestedQuantity: state.requestedQuantity,
    joinedCount: state.joinedCount,
  });

  const liveOffers = Math.max(0, Number(state.liveOfferCount) || 0);
  const upcoming = Math.max(0, Number(state.upcomingJoiningCount) || 0);
  const active = Math.max(0, Number(state.activeCandidateCount) || 0);
  const agency = Math.max(0, Number(state.agencySubmissionCount) || 0);

  if (liveOffers > 0) {
    blockers.push(`${liveOffers} offer${liveOffers === 1 ? '' : 's'} still live. Withdraw or close them before closing the requirement.`);
  }
  if (upcoming > 0) {
    blockers.push(`${upcoming} candidate${upcoming === 1 ? ' is' : 's are'} confirmed to join. Record or cancel the joining first.`);
  }
  if (active > 0) {
    warnings.push(`${active} candidate${active === 1 ? '' : 's'} still in the pipeline will be released to the talent pool.`);
  }
  if (agency > 0) {
    warnings.push(`${agency} agency submission${agency === 1 ? '' : 's'} not taken forward.`);
  }

  const canClose = blockers.length === 0;
  return {
    canCloseFullyFilled: canClose && fill.recommendClosure,
    canClosePartially: canClose && !fill.recommendClosure,
    blockers,
    warnings,
    recommendation: !canClose
      ? 'Keep open'
      : fill.recommendClosure
        ? 'Close fully filled'
        : fill.joined > 0
          ? 'Close partially filled'
          : 'Keep open',
  };
}

/* ------------------------------------------------------------------------------------------------
 * Talent pool matching (spec section 48)
 * ---------------------------------------------------------------------------------------------- */

export interface TalentMatch<T> {
  candidate: T;
  score: number;
  matchedSkills: string[];
  reasons: string[];
}

/**
 * Suggests previously shortlisted candidates for a new requirement (spec section 48).
 *
 * Scored rather than filtered, because a hard filter on every stated criterion returns nothing for
 * most real requirements — an EPC requisition asks for eight skills, a 132KV background and a
 * specific location, and the candidate worth calling usually misses one. Skills carry the most
 * weight, then designation, then experience band, then location.
 */
export function matchTalentPool<
  T extends {
    designation?: string;
    skills?: string[];
    totalExperienceYears?: number;
    locationId?: string;
    location?: string;
  },
>(
  requirement: {
    designation?: string;
    mandatorySkills?: string[];
    preferredSkills?: string[];
    minExperienceYears?: number;
    maxExperienceYears?: number;
    locationId?: string;
    location?: string;
  },
  pool: T[],
  options: { minimumScore?: number; limit?: number } = {},
): Array<TalentMatch<T>> {
  const mandatory = (requirement.mandatorySkills || []).map(normalizeText).filter(Boolean);
  const preferred = (requirement.preferredSkills || []).map(normalizeText).filter(Boolean);
  const wantDesignation = normalizeText(requirement.designation);
  const wantLocation = normalizeText(requirement.locationId) || normalizeText(requirement.location);
  const minimumScore = options.minimumScore ?? 30;

  const matches: Array<TalentMatch<T>> = [];

  for (const candidate of pool || []) {
    const skills = (candidate.skills || []).map(normalizeText).filter(Boolean);
    const skillSet = new Set(skills);
    const matchedMandatory = mandatory.filter(skill => skillSet.has(skill));
    const matchedPreferred = preferred.filter(skill => skillSet.has(skill));

    let score = 0;
    const reasons: string[] = [];

    if (mandatory.length > 0) {
      const ratio = matchedMandatory.length / mandatory.length;
      score += ratio * 50;
      if (matchedMandatory.length > 0) {
        reasons.push(`${matchedMandatory.length} of ${mandatory.length} mandatory skills`);
      }
    }
    if (preferred.length > 0 && matchedPreferred.length > 0) {
      score += (matchedPreferred.length / preferred.length) * 15;
      reasons.push(`${matchedPreferred.length} preferred skills`);
    }
    if (wantDesignation && normalizeText(candidate.designation) === wantDesignation) {
      score += 20;
      reasons.push('same designation');
    }

    const experience = Number(candidate.totalExperienceYears);
    if (Number.isFinite(experience)) {
      const min = Number(requirement.minExperienceYears);
      const max = Number(requirement.maxExperienceYears);
      const aboveMin = !Number.isFinite(min) || experience >= min;
      const belowMax = !Number.isFinite(max) || max <= 0 || experience <= max;
      if (aboveMin && belowMax) {
        score += 10;
        reasons.push('experience in band');
      }
    }

    const candidateLocation = normalizeText(candidate.locationId) || normalizeText(candidate.location);
    if (wantLocation && candidateLocation && wantLocation === candidateLocation) {
      score += 5;
      reasons.push('same location');
    }

    const rounded = roundPercent(score);
    if (rounded >= minimumScore) {
      matches.push({ candidate, score: rounded, matchedSkills: [...matchedMandatory, ...matchedPreferred], reasons });
    }
  }

  matches.sort((a, b) => b.score - a.score);
  return options.limit ? matches.slice(0, options.limit) : matches;
}

/* ------------------------------------------------------------------------------------------------
 * Offer validity (spec sections 29, 30)
 * ---------------------------------------------------------------------------------------------- */

export interface OfferValidity {
  expired: boolean;
  daysRemaining: number | null;
  message: string;
}

/** Whether an offer is still open for the candidate to accept (spec section 30). */
export function evaluateOfferValidity(input: {
  status: OfferStatus | string;
  validUntil?: Date | string | null;
  asOf?: Date | string | null;
}): OfferValidity {
  const asOf = parseHrDate(input.asOf || null) || new Date();
  const validUntil = parseHrDate(input.validUntil || null);

  if (input.status === 'ACCEPTED') return { expired: false, daysRemaining: null, message: 'Offer accepted.' };
  if (input.status === 'REJECTED') return { expired: false, daysRemaining: null, message: 'Offer rejected by the candidate.' };
  if (input.status === 'WITHDRAWN') return { expired: false, daysRemaining: null, message: 'Offer withdrawn.' };
  if (input.status === 'EXPIRED') return { expired: true, daysRemaining: 0, message: 'Offer has expired.' };
  if (!validUntil) return { expired: false, daysRemaining: null, message: 'No validity date set on this offer.' };

  const daysRemaining = dayDifference(asOf, validUntil);
  if (daysRemaining < 0) {
    return { expired: true, daysRemaining: 0, message: `Offer expired ${Math.abs(daysRemaining)} days ago.` };
  }
  return {
    expired: false,
    daysRemaining,
    message: daysRemaining === 0 ? 'Offer expires today.' : `Offer valid for ${daysRemaining} more ${daysRemaining === 1 ? 'day' : 'days'}.`,
  };
}

/**
 * Whether an offer may be released at the proposed CTC (control rule 63.5).
 *
 * Checked here rather than only in the service so the offer screen can disable the button and say
 * why, instead of letting a recruiter fill in a letter that the save will reject.
 */
export function canReleaseOffer(input: {
  proposedCtc: number;
  approvedCtc?: number;
  bandMax?: number;
  compensationApprovalStatus?: CompensationApprovalStatus;
  tolerancePercent?: number;
}): { allowed: boolean; reason: string } {
  const proposed = roundMoney(input.proposedCtc);
  if (proposed <= 0) return { allowed: false, reason: 'Enter the offered CTC.' };

  if (input.compensationApprovalStatus === 'PENDING') {
    return { allowed: false, reason: 'Compensation approval is still pending.' };
  }
  if (input.compensationApprovalStatus === 'REJECTED') {
    return { allowed: false, reason: 'Compensation approval was rejected. Revise the proposal before offering.' };
  }

  // An approved figure supersedes the band: that is what the compensation approval decided.
  const approvedCtc = roundMoney(input.approvedCtc || 0);
  if (input.compensationApprovalStatus === 'APPROVED' && approvedCtc > 0) {
    if (proposed > approvedCtc) {
      return {
        allowed: false,
        reason: `The offered CTC exceeds the approved ${hrCurrency(approvedCtc)}. Raise a fresh compensation approval.`,
      };
    }
    return { allowed: true, reason: '' };
  }

  const band = evaluateCtcAgainstBand({
    proposedCtc: proposed,
    bandMax: input.bandMax,
    tolerancePercent: input.tolerancePercent,
  });
  if (band.requiresApproval) return { allowed: false, reason: band.message };
  return { allowed: true, reason: '' };
}

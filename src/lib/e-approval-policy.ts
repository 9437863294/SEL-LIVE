/**
 * Domain rules for the E-Approval / E-Notesheet engine (`docs/e-approval.md`).
 *
 * Dependency-free on purpose, exactly as `hr-policy.ts` is: this module runs in the browser, on the
 * mobile client and inside Admin-SDK routes (the reminder/escalation cron of spec section 22 has no
 * user session), and every rule in here is unit-tested from `tests/e-approval-domain.test.mjs`
 * without a Firestore emulator. Anything that touches Firestore belongs in `e-approval-service.ts`;
 * anything that renders belongs in the components. If a rule can be expressed as
 * "inputs → decision", it goes here.
 *
 * `e-approval.ts` re-exports this file, so consumers import the module from one place — the same
 * arrangement `hr-requirement.ts` has with `hr-policy.ts`.
 *
 * ── The one idea the whole module rests on ──────────────────────────────────────────────────────
 *
 * **Approval, verification and clarification are different task types, and only approval owns the
 * document.** A verification or clarification is a *child* step: it is created by an approver who is
 * still holding the file, and when it finishes control returns to the exact step that asked for it —
 * however deep the nesting went.
 *
 *   Director (APPROVAL, depth 0)          ← originStepId of the step below
 *     └─ Finance Manager (VERIFICATION, depth 1)
 *          └─ Accounts Executive (VERIFICATION, depth 2)
 *
 * Accounts completes → Finance resumes → Finance completes → Director resumes. There is no separate
 * stack structure to keep in sync: the stack *is* the `parentStepId` / `originStepId` chain on the
 * step records, so it survives a page reload, a different device and a cron run. `resumeParent` pops
 * it by activating `originStepId` once no open children remain.
 *
 * Forwarding and delegation are deliberately *not* child steps — they change who owns the current
 * step, which is why they reassign it in place rather than pushing a level.
 *
 * Four other decisions worth knowing before reading on:
 *
 *   1. **The step list is a record, not a template instance.** Steps are appended (verification,
 *      inserted approver, escalation) and re-opened (return-to-any-step) as the file moves, so the
 *      chain's order lives in a `sequence` number that accepts midpoints rather than an array index.
 *      An index would renumber history every time somebody inserted an approver.
 *
 *   2. **A paused clock is paused, not stopped.** An approver waiting on a verification, or a file on
 *      hold, accumulates `pausedMs`, and `dueAt` is recomputed from it. Otherwise every approver who
 *      asked a question would breach an SLA for the time the answer took.
 *
 *   3. **Approvals do not survive a material change** (spec section 6). `detectEApprovalMaterialChange`
 *      decides; `applyEApprovalAction` supersedes the old approvals and restarts the chain per the
 *      configured policy. This is the module's most important audit control — an amount edited from
 *      ₹5,00,000 to ₹9,00,000 under three existing approvals is exactly the failure it prevents.
 *
 *   4. **Being assigned a step is the authority to act on it.** `availableEApprovalActions` is
 *      derived from the step and its capabilities, never from the actor's role permissions: the
 *      person a Director sent a verification to is authorised by that assignment, and requiring them
 *      to *also* hold a matching role permission is what makes files stick. Role permissions gate
 *      *visibility* and administration (`canViewEApproval`), not the acting.
 */

/* ------------------------------------------------------------------------------------------------
 * Small shared helpers
 * ---------------------------------------------------------------------------------------------- */

const HOUR_MS = 3_600_000;

export const roundEApprovalMoney = (value: number) =>
  Math.round((Number(value) || 0) * 100) / 100;

/** Parses the ISO strings the engine passes around. Returns null rather than an Invalid Date. */
export function parseEApprovalDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const toIso = (value: string | Date | null | undefined): string | null => {
  const parsed = parseEApprovalDate(value);
  return parsed ? parsed.toISOString() : null;
};

const millis = (value: string | Date | null | undefined): number | null => {
  const parsed = parseEApprovalDate(value);
  return parsed ? parsed.getTime() : null;
};

/** "19h 25m", "3d 4h", "just now" — the SLA-remaining line of spec section 32. */
export function formatEApprovalDuration(ms: number): string {
  const total = Math.abs(Math.round(ms));
  if (total < 60_000) return 'just now';
  const minutes = Math.floor(total / 60_000) % 60;
  const hours = Math.floor(total / HOUR_MS) % 24;
  const days = Math.floor(total / 86_400_000);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** Financial year (April–March) as `2026-27`, matching `financialYearForHrDate`. */
export function financialYearForEApprovalDate(date: Date = new Date()): string {
  const year = date.getFullYear();
  const startYear = date.getMonth() >= 3 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------------------------------------
 * Statuses (spec section 10)
 * ---------------------------------------------------------------------------------------------- */

export const E_APPROVAL_STATUSES = [
  'Draft',
  'Submitted',
  'Pending Approval',
  'Pending Verification',
  'Pending Clarification',
  'Returned',
  'Resubmitted',
  'On Hold',
  'Partially Approved',
  'Approved',
  'Rejected',
  'Cancelled',
  'Superseded',
  'Closed',
] as const;

export type EApprovalStatus = (typeof E_APPROVAL_STATUSES)[number];

/**
 * Statuses no action can move a request out of.
 *
 * 'Superseded' is terminal for a *request document* only in the sense that a superseded version is
 * frozen — the live request carries the new version. Individual superseded *steps* use the step
 * status of the same name.
 */
export const TERMINAL_E_APPROVAL_STATUSES: readonly EApprovalStatus[] = [
  'Approved',
  'Rejected',
  'Cancelled',
  'Closed',
  'Superseded',
];

export function isTerminalEApprovalStatus(status: EApprovalStatus | string): boolean {
  return TERMINAL_E_APPROVAL_STATUSES.includes(status as EApprovalStatus);
}

/** Statuses that mean somebody owes the file an action. */
export function isOpenEApprovalStatus(status: EApprovalStatus | string): boolean {
  return !isTerminalEApprovalStatus(status) && String(status) !== 'Draft';
}

export const eApprovalStatusStyles: Record<EApprovalStatus, string> = {
  Draft: 'bg-slate-100 text-slate-700 border-slate-200',
  Submitted: 'bg-blue-100 text-blue-800 border-blue-200',
  'Pending Approval': 'bg-blue-100 text-blue-800 border-blue-200',
  'Pending Verification': 'bg-violet-100 text-violet-800 border-violet-200',
  'Pending Clarification': 'bg-amber-100 text-amber-800 border-amber-200',
  Returned: 'bg-orange-100 text-orange-800 border-orange-200',
  Resubmitted: 'bg-sky-100 text-sky-800 border-sky-200',
  'On Hold': 'bg-zinc-100 text-zinc-700 border-zinc-200',
  'Partially Approved': 'bg-teal-100 text-teal-800 border-teal-200',
  Approved: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  Rejected: 'bg-red-100 text-red-800 border-red-200',
  Cancelled: 'bg-muted text-muted-foreground',
  Superseded: 'bg-stone-100 text-stone-600 border-stone-200 line-through',
  Closed: 'bg-slate-100 text-slate-700 border-slate-200',
};

export const E_APPROVAL_PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'] as const;
export type EApprovalPriority = (typeof E_APPROVAL_PRIORITIES)[number];

/** Multiplier applied to a step's SLA so an urgent file is not given a routine deadline. */
export const E_APPROVAL_PRIORITY_SLA_FACTOR: Record<EApprovalPriority, number> = {
  Low: 1.5,
  Normal: 1,
  High: 0.5,
  Urgent: 0.25,
};

/* ------------------------------------------------------------------------------------------------
 * Steps
 * ---------------------------------------------------------------------------------------------- */

export const E_APPROVAL_STEP_TYPES = [
  'APPROVAL',
  'VERIFICATION',
  'CLARIFICATION',
  'REVIEW',
] as const;

export type EApprovalStepType = (typeof E_APPROVAL_STEP_TYPES)[number];

/** The step types raised as temporary children of an approval rather than as stages of their own. */
export const CHILD_E_APPROVAL_STEP_TYPES: readonly EApprovalStepType[] = [
  'VERIFICATION',
  'CLARIFICATION',
  'REVIEW',
];

export function isChildEApprovalStepType(type: EApprovalStepType | string): boolean {
  return CHILD_E_APPROVAL_STEP_TYPES.includes(type as EApprovalStepType);
}

/**
 * Whether a step pops to a parent when it completes, rather than advancing the chain.
 *
 * Deliberately decided by *position* (`depth`), not by type. A template may legitimately place a
 * verification stage in the primary chain — "Finance Verification" between Purchase and Director in
 * the seed template of spec section 12 — and such a step is a stage, not a child: it has no parent
 * to return to, and treating it as one would strand the file with nobody holding it.
 */
export function isChildEApprovalStep(step: EApprovalStepRecord): boolean {
  return step.depth > 0 && Boolean(step.originStepId || step.parentStepId);
}

export const E_APPROVAL_STEP_STATUSES = [
  'Pending',
  'Active',
  'Awaiting Verification',
  'Awaiting Clarification',
  'On Hold',
  'Completed',
  'Returned',
  'Skipped',
  'Cancelled',
  'Superseded',
] as const;

export type EApprovalStepStatus = (typeof E_APPROVAL_STEP_STATUSES)[number];

/** Step statuses that still belong to the live workflow rather than to its history. */
export const OPEN_E_APPROVAL_STEP_STATUSES: readonly EApprovalStepStatus[] = [
  'Pending',
  'Active',
  'Awaiting Verification',
  'Awaiting Clarification',
  'On Hold',
];

export function isOpenEApprovalStepStatus(status: EApprovalStepStatus | string): boolean {
  return OPEN_E_APPROVAL_STEP_STATUSES.includes(status as EApprovalStepStatus);
}

/** A step whose assignee is waiting on a child step it created. */
export function isAwaitingChildren(status: EApprovalStepStatus | string): boolean {
  return status === 'Awaiting Verification' || status === 'Awaiting Clarification';
}

export const E_APPROVAL_OUTCOMES = [
  'Approved',
  'Rejected',
  'Verified',
  'Verified With Observation',
  'Not Verified',
  'Clarified',
  'Returned',
  'Forwarded',
  'Delegated',
  'Escalated',
  'Skipped',
  'Cancelled',
  'Superseded',
] as const;

export type EApprovalOutcome = (typeof E_APPROVAL_OUTCOMES)[number];

/** The three verification results of spec section 18 that count as a completed verification. */
export const VERIFICATION_OUTCOMES: readonly EApprovalOutcome[] = [
  'Verified',
  'Verified With Observation',
  'Not Verified',
];

/**
 * Outcomes that mean the step said yes.
 *
 * 'Verified' is in here because a verification stage sitting in the primary chain has to be able to
 * satisfy its position — otherwise a chain containing one could never advance. 'Verified With
 * Observation' counts too: an observation is a note for the next approver, not a refusal.
 */
export const POSITIVE_E_APPROVAL_OUTCOMES: readonly EApprovalOutcome[] = [
  'Approved',
  'Verified',
  'Verified With Observation',
  'Clarified',
];

export function isPositiveEApprovalOutcome(outcome: EApprovalOutcome | null | undefined): boolean {
  return Boolean(outcome && POSITIVE_E_APPROVAL_OUTCOMES.includes(outcome));
}

export const eApprovalOutcomeStyles: Record<EApprovalOutcome, string> = {
  Approved: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  Rejected: 'bg-red-100 text-red-800 border-red-200',
  Verified: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  'Verified With Observation': 'bg-amber-100 text-amber-800 border-amber-200',
  'Not Verified': 'bg-red-100 text-red-800 border-red-200',
  Clarified: 'bg-sky-100 text-sky-800 border-sky-200',
  Returned: 'bg-orange-100 text-orange-800 border-orange-200',
  Forwarded: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  Delegated: 'bg-violet-100 text-violet-800 border-violet-200',
  Escalated: 'bg-rose-100 text-rose-800 border-rose-200',
  Skipped: 'bg-slate-100 text-slate-600 border-slate-200',
  Cancelled: 'bg-muted text-muted-foreground',
  Superseded: 'bg-stone-100 text-stone-600 border-stone-200',
};

/* ------------------------------------------------------------------------------------------------
 * Assignment (spec section 11 — a step is assigned to a person, a department or a role)
 * ---------------------------------------------------------------------------------------------- */

export type EApprovalAssigneeKind = 'User' | 'Department' | 'Role' | 'Requester';

/** How a department-assigned step is picked up. Modes A, B and C of spec section 11. */
export type EApprovalDepartmentMode = 'Anyone' | 'Head' | 'Queue';

export interface EApprovalAssignment {
  kind: EApprovalAssigneeKind;
  userId?: string;
  /** Denormalised at assignment time so every screen and notification can name the assignee
   * without a user lookup — and so history still reads correctly after somebody is deactivated. */
  userName?: string;
  designation?: string;
  departmentId?: string;
  departmentName?: string;
  role?: string;
  departmentMode?: EApprovalDepartmentMode;
}

/** "Sarika Palo (Finance Manager)", "Finance Department", "Role: Director", "Requester". */
export function describeEApprovalAssignment(
  assignment: EApprovalAssignment | null | undefined,
): string {
  if (!assignment) return 'Unassigned';
  switch (assignment.kind) {
    case 'User':
      return assignment.designation
        ? `${assignment.userName || 'User'} (${assignment.designation})`
        : assignment.userName || 'User';
    case 'Department': {
      const name = assignment.departmentName || 'Department';
      if (assignment.departmentMode === 'Head') return `${name} (HOD)`;
      if (assignment.departmentMode === 'Queue') return `${name} Queue`;
      return name;
    }
    case 'Role':
      return assignment.role ? `Role: ${assignment.role}` : 'Role';
    case 'Requester':
      return 'Requester';
    default:
      return 'Unassigned';
  }
}

/** How a parallel group of steps at the same position is satisfied (spec section 28). */
export type EApprovalGroupMode = 'Single' | 'All' | 'Any' | 'NofM';

/** Per-step switches from the workflow builder of spec section 27. */
export interface EApprovalStepCapabilities {
  canReturn?: boolean;
  canDelegate?: boolean;
  canForward?: boolean;
  canVerify?: boolean;
  canRequestClarification?: boolean;
  canAddApprover?: boolean;
  canReject?: boolean;
  canHold?: boolean;
  canEscalate?: boolean;
  /** Whether this approver may end the workflow early with Approve & Complete. */
  canFinalise?: boolean;
}

export const DEFAULT_E_APPROVAL_CAPABILITIES: Required<EApprovalStepCapabilities> = {
  canReturn: true,
  canDelegate: true,
  canForward: true,
  canVerify: true,
  canRequestClarification: true,
  canAddApprover: true,
  canReject: true,
  canHold: true,
  canEscalate: true,
  canFinalise: false,
};

export function eApprovalCapability(
  step: EApprovalStepRecord,
  capability: keyof EApprovalStepCapabilities,
): boolean {
  const configured = step.capabilities?.[capability];
  return configured ?? DEFAULT_E_APPROVAL_CAPABILITIES[capability];
}

/**
 * One node of the workflow as it actually happened.
 *
 * Stored one document per step in `eApprovalSteps` rather than as an array on the request, because
 * "everything pending with me" has to be a single indexed query across thousands of requests — the
 * inbox of spec section 14 is the module's most-hit screen.
 */
export interface EApprovalStepRecord {
  id: string;
  approvalId?: string;
  type: EApprovalStepType;
  name: string;
  /** Position in the primary chain. Fractional values are legitimate — an inserted approver takes
   * the midpoint between its neighbours so no existing step has to be renumbered. */
  sequence: number;
  /** 0 for the primary approval chain; 1 for a verification of it; 2 for a verification of that. */
  depth: number;
  /** The step that created this one. null on the primary chain. */
  parentStepId: string | null;
  /** The step control returns to when this one completes. Equal to `parentStepId` in practice, kept
   * separate because a re-parented step (a verification handed on) must still return to its origin. */
  originStepId: string | null;
  /** Members of a parallel group share this. Also the group key for satisfaction checks. */
  groupId?: string;
  groupMode?: EApprovalGroupMode;
  /** For 'NofM' — how many of the group's members must approve. */
  groupRequiredCount?: number;
  assignment: EApprovalAssignment;
  status: EApprovalStepStatus;
  outcome?: EApprovalOutcome | null;
  /** What the requesting approver asked this verifier/clarifier to do. */
  instruction?: string;
  /** What the assignee said when completing the step. */
  comment?: string;
  actedByUserId?: string;
  actedByName?: string;
  /** Set when a delegate or substitute acted in the assignee's place (spec sections 4.4 and 23). */
  onBehalfOfUserId?: string;
  onBehalfOfName?: string;
  /** Standing delegation target: this user may act on the step as well as the assignee. */
  delegatedToUserId?: string;
  delegatedToName?: string;
  /** Who claimed a department-queue step (mode C of spec section 11). */
  ownedByUserId?: string;
  ownedByName?: string;
  slaHours?: number;
  startedAt?: string | null;
  dueAt?: string | null;
  completedAt?: string | null;
  /** When the clock was paused — by a hold, or by waiting on a child step. */
  pausedAt?: string | null;
  /** Total paused time, added back into `dueAt` so a question does not cost the approver its SLA. */
  pausedMs?: number;
  mandatory?: boolean;
  capabilities?: EApprovalStepCapabilities;
  /** True once this step has been re-opened by a return, so the timeline can mark it. */
  reopened?: boolean;
  /** Which step sent it back, for the "Returned to Me" inbox and the reason line. */
  returnedFromStepId?: string | null;
  /** Ladder rule ids already fired, so a reminder is never sent twice (spec section 22). */
  escalationsSent?: string[];
  /** The request version this step belongs to. Superseded steps keep their old version. */
  version?: number;
  supersededInVersion?: number;
  /** Reassignment trail — forward, delegate and escalate all move ownership in place. */
  reassignments?: EApprovalReassignment[];
}

export interface EApprovalReassignment {
  at: string;
  kind: 'Forward' | 'Delegate' | 'Escalate' | 'Reassign';
  byUserId: string;
  byName?: string;
  from: EApprovalAssignment;
  to: EApprovalAssignment;
  reason?: string;
}

/* ------------------------------------------------------------------------------------------------
 * Request state
 * ---------------------------------------------------------------------------------------------- */

/**
 * The part of an approval request the engine reads and writes.
 *
 * Deliberately narrower than the Firestore document (`EApprovalRequest` in `e-approval.ts`): the
 * engine never needs the body text or the attachment list, so a caller can hand it a projection and
 * the reducer stays trivially testable. Dates are ISO strings — Firestore Timestamps do not belong
 * in a module that has to run under Node with no Firebase installed.
 */
export interface EApprovalRequestState {
  id: string;
  referenceNo?: string;
  status: EApprovalStatus;
  version: number;
  requesterId: string;
  requesterName?: string;
  departmentId?: string;
  departmentName?: string;
  projectId?: string;
  approvalTypeId?: string;
  priority: EApprovalPriority;
  amount?: number;
  confidential?: boolean;
  ccUserIds?: string[];
  ccDepartmentIds?: string[];
  /** Everyone who may see and comment on the file: CC users plus anyone added mid-flight. */
  participantUserIds?: string[];
  /** Denormalised pointers so "pending with me" is one query. Maintained by the engine. */
  currentStepIds?: string[];
  currentAssigneeIds?: string[];
  currentDepartmentIds?: string[];
  currentRoles?: string[];
  /** "Pending with Finance Manager" — the readable status of spec section 10. */
  pendingLabel?: string;
  /** Earliest `dueAt` among the active steps, so overdue lists are one indexed query. */
  currentDueAt?: string | null;
  requiredBy?: string | null;
  submittedAt?: string | null;
  completedAt?: string | null;
  /** Set while the file sits with the requester after a return, so Resubmit knows where to resume. */
  returnResumeStepId?: string | null;
  returnedByStepId?: string | null;
  returnReason?: string;
  /** Fingerprint of the material fields as last submitted — the input to change detection. */
  materialFingerprint?: string;
  /** Bumped every time a material change supersedes existing approvals. */
  supersededCount?: number;
  holdReason?: string;
  rejectionReason?: string;
  cancelReason?: string;
}

/* ------------------------------------------------------------------------------------------------
 * Settings (spec sections 6, 22, 27)
 * ---------------------------------------------------------------------------------------------- */

/** Where the chain restarts when a material change supersedes the approvals already given. */
export type EApprovalRestartPolicy = 'First Step' | 'Returning Step' | 'Superseded Steps Only';

export interface EApprovalNumberingSettings {
  prefix: string;
  /** `EA/FIN/2026-27/00125` when true, `EA/2026-27/000001` when false (spec section 24). */
  includeDepartmentCode: boolean;
  sequenceWidth: number;
  separator: string;
}

export interface EApprovalSettings {
  organizationId?: string;
  numbering: EApprovalNumberingSettings;
  /** Fields whose change invalidates existing approvals. */
  materialFields: string[];
  /** An amount change below this percentage is treated as a correction, not a material change. */
  amountTolerancePct: number;
  restartOnMaterialChange: EApprovalRestartPolicy;
  /** Default SLA for a step whose template does not set one. */
  defaultSlaHours: number;
  /** Whether an approver may end the workflow early. Also switchable per step. */
  allowApproveAndComplete: boolean;
  /** Whether a verifier may send for further verification (the nesting of spec section 3). */
  allowNestedVerification: boolean;
  /** Cap on nesting depth, so a verification loop cannot run away. */
  maxVerificationDepth: number;
  /** Whether an approver may return to any earlier step, or only to the requester. */
  allowReturnToAnyStep: boolean;
  escalationLadder: EApprovalEscalationRule[];
  /** Roles that may see confidential files without being a participant. */
  confidentialRoles: string[];
}

export const DEFAULT_E_APPROVAL_SETTINGS: EApprovalSettings = {
  numbering: { prefix: 'EA', includeDepartmentCode: true, sequenceWidth: 5, separator: '/' },
  // Subject and body are here alongside amount because a note-sheet's proposal *is* the thing
  // approved — an approver who signed "purchase 10 helmets" has not approved "purchase 10 vehicles".
  materialFields: ['subject', 'body', 'amount', 'departmentId', 'projectId', 'attachmentsFingerprint'],
  amountTolerancePct: 0,
  restartOnMaterialChange: 'First Step',
  defaultSlaHours: 24,
  allowApproveAndComplete: true,
  allowNestedVerification: true,
  maxVerificationDepth: 4,
  allowReturnToAnyStep: true,
  escalationLadder: [],
  confidentialRoles: [],
};

/* ------------------------------------------------------------------------------------------------
 * Reference numbering (spec section 24)
 * ---------------------------------------------------------------------------------------------- */

/**
 * Formats `EA/FIN/2026-27/00125`, or `EA/2026-27/00125` with no department code.
 *
 * The financial year rather than the calendar year, because that is the period an EPC organisation
 * reconciles its approvals against — a note-sheet raised in February 2027 belongs to the same 2026-27
 * series as one raised in May 2026. The sequence is allocated by the service inside a transaction;
 * this function only formats, so a number is never produced twice by two callers agreeing on a
 * format but not on a counter.
 */
export function eApprovalReference(
  sequence: number,
  options: {
    settings?: Partial<EApprovalNumberingSettings>;
    departmentCode?: string;
    date?: Date;
  } = {},
): string {
  const settings = { ...DEFAULT_E_APPROVAL_SETTINGS.numbering, ...(options.settings || {}) };
  const separator = settings.separator || '/';
  const year = financialYearForEApprovalDate(options.date ?? new Date());
  const code = settings.includeDepartmentCode ? (options.departmentCode || '').trim() : '';
  const parts = [settings.prefix, code, year, String(Math.max(1, Math.trunc(sequence))).padStart(settings.sequenceWidth, '0')];
  return parts.filter(Boolean).join(separator);
}

const DEPARTMENT_CODE_STOP_WORDS = ['of', 'and', 'the', 'for', '&'];

/**
 * `Finance & Accounts` → `FIN`, `HR` → `HR`, `Purchase` → `PUR`.
 *
 * The first significant word's opening letters rather than one initial per word, because that is
 * what the reference numbers in spec section 24 show (`EA/FIN/…`, `EA/PUR/…`) and because initials
 * collide constantly in an EPC organisation — Purchase and Projects would both be `P`. A department
 * can override this with an explicit `approvalCode`; this is only the fallback.
 */
export function eApprovalDepartmentCode(departmentName: string | null | undefined): string {
  const words = String(departmentName || '')
    .replace(/[^A-Za-z ]/g, ' ')
    .split(/\s+/)
    .filter((word) => word && !DEPARTMENT_CODE_STOP_WORDS.includes(word.toLowerCase()));
  if (!words.length) return '';
  return words[0].slice(0, 3).toUpperCase();
}

/* ------------------------------------------------------------------------------------------------
 * SLA and escalation (spec sections 22 and 32)
 * ---------------------------------------------------------------------------------------------- */

/** `startedAt + slaHours`, pushed out by however long the step has been paused. */
export function eApprovalDueAt(
  startedAt: string | Date | null | undefined,
  slaHours: number | null | undefined,
  pausedMs = 0,
): string | null {
  const start = millis(startedAt);
  if (start == null || !slaHours || slaHours <= 0) return null;
  return new Date(start + slaHours * HOUR_MS + Math.max(0, pausedMs)).toISOString();
}

/** SLA hours for a step, scaled by the file's priority. */
export function eApprovalStepSla(
  templateSlaHours: number | null | undefined,
  priority: EApprovalPriority = 'Normal',
  settings: Pick<EApprovalSettings, 'defaultSlaHours'> = DEFAULT_E_APPROVAL_SETTINGS,
): number {
  const base = templateSlaHours && templateSlaHours > 0 ? templateSlaHours : settings.defaultSlaHours;
  const factor = E_APPROVAL_PRIORITY_SLA_FACTOR[priority] ?? 1;
  return Math.max(1, Math.round(base * factor));
}

export interface EApprovalSlaState {
  dueAt: string | null;
  /** Negative once the step is overdue. */
  remainingMs: number | null;
  overdue: boolean;
  /** 0–100+, for the SLA bar. Null when the step has no clock. */
  elapsedPct: number | null;
  /** "19h 25m" remaining, or "4h 10m overdue". */
  label: string;
  paused: boolean;
}

export function eApprovalSlaState(
  step: EApprovalStepRecord,
  now: string | Date = new Date(),
): EApprovalSlaState {
  const paused = step.status === 'On Hold' || isAwaitingChildren(step.status);
  // A paused step's clock is read at the moment it paused, not at `now` — otherwise the bar keeps
  // filling while the approver is legitimately waiting on somebody else.
  const readAt = paused ? (millis(step.pausedAt) ?? millis(now) ?? Date.now()) : (millis(now) ?? Date.now());
  const dueAt = step.dueAt ?? eApprovalDueAt(step.startedAt, step.slaHours, step.pausedMs);
  const due = millis(dueAt);
  const started = millis(step.startedAt);
  if (due == null) {
    return { dueAt: null, remainingMs: null, overdue: false, elapsedPct: null, label: 'No SLA', paused };
  }
  const remainingMs = due - readAt;
  const total = started != null ? due - started : null;
  const elapsedPct =
    total && total > 0 ? Math.min(999, Math.max(0, Math.round(((total - remainingMs) / total) * 100))) : null;
  return {
    dueAt,
    remainingMs,
    overdue: remainingMs < 0,
    elapsedPct,
    label: remainingMs < 0
      ? `${formatEApprovalDuration(remainingMs)} overdue`
      : `${formatEApprovalDuration(remainingMs)} left`,
    paused,
  };
}

export type EApprovalEscalationKind = 'Reminder' | 'Escalation' | 'Notify Requester';

export interface EApprovalEscalationRule {
  id: string;
  /** Hours after the step became active. 0 fires the assignment notification. */
  afterHours: number;
  kind: EApprovalEscalationKind;
  /** Extra recipients — the HOD for an escalation, for example. */
  targets?: EApprovalAssignment[];
  label?: string;
  /** Restricts the rule to one approval type; unset applies to all. */
  approvalTypeId?: string;
}

/** The 0/24/48/72/96-hour ladder of spec section 22, as the shipped default. */
export const DEFAULT_E_APPROVAL_ESCALATION_LADDER: EApprovalEscalationRule[] = [
  { id: 'assign', afterHours: 0, kind: 'Reminder', label: 'Assignment notification' },
  { id: 'remind-24', afterHours: 24, kind: 'Reminder', label: 'Reminder' },
  { id: 'remind-48', afterHours: 48, kind: 'Reminder', label: 'Second reminder' },
  { id: 'escalate-72', afterHours: 72, kind: 'Escalation', label: 'Escalate to HOD' },
  { id: 'notify-96', afterHours: 96, kind: 'Notify Requester', label: 'Notify HOD and requester' },
];

export interface DueEApprovalEscalation {
  stepId: string;
  stepName: string;
  approvalId?: string;
  rule: EApprovalEscalationRule;
  /** Hours the step has been actively pending, excluding paused time. */
  pendingHours: number;
}

/**
 * Which ladder rules have come due on the steps currently waiting.
 *
 * Paused time is excluded, for the same reason it is excluded from `dueAt`: reminding an approver
 * every 24 hours while they wait for the verification they asked for trains people to ignore
 * reminders. `escalationsSent` makes the function idempotent, so the cron can run as often as it
 * likes without duplicating notifications.
 */
export function resolveDueEApprovalEscalations(
  steps: EApprovalStepRecord[],
  ladder: EApprovalEscalationRule[] = DEFAULT_E_APPROVAL_ESCALATION_LADDER,
  now: string | Date = new Date(),
  approvalTypeId?: string,
): DueEApprovalEscalation[] {
  const nowMs = millis(now) ?? Date.now();
  const due: DueEApprovalEscalation[] = [];
  for (const step of steps) {
    if (step.status !== 'Active') continue;
    const started = millis(step.startedAt);
    if (started == null) continue;
    const pendingMs = Math.max(0, nowMs - started - Math.max(0, step.pausedMs ?? 0));
    const pendingHours = pendingMs / HOUR_MS;
    const sent = new Set(step.escalationsSent ?? []);
    for (const rule of ladder) {
      if (rule.approvalTypeId && approvalTypeId && rule.approvalTypeId !== approvalTypeId) continue;
      if (sent.has(rule.id)) continue;
      if (pendingHours + 1e-9 < rule.afterHours) continue;
      due.push({
        stepId: step.id,
        stepName: step.name,
        approvalId: step.approvalId,
        rule,
        pendingHours: Math.round(pendingHours * 10) / 10,
      });
    }
  }
  return due;
}

/* ------------------------------------------------------------------------------------------------
 * Delegation and substitute approvers (spec sections 4.4 and 23)
 * ---------------------------------------------------------------------------------------------- */

export interface EApprovalDelegation {
  id: string;
  fromUserId: string;
  fromUserName?: string;
  toUserId: string;
  toUserName?: string;
  /** Inclusive ISO dates. An open-ended delegation leaves `toDate` unset. */
  fromDate: string;
  toDate?: string | null;
  reason?: string;
  /** Restricts the delegation to certain approval types; empty means all. */
  approvalTypeIds?: string[];
  active?: boolean;
  organizationId?: string;
}

/**
 * The delegation in force for `userId` right now, if any.
 *
 * Only one level is resolved on purpose: if A delegates to B and B delegates to C, a file for A goes
 * to B — not to C. Chained delegation is how an approval quietly ends up with somebody neither the
 * requester nor the original approver ever authorised.
 */
export function resolveEApprovalDelegate(
  delegations: EApprovalDelegation[] | null | undefined,
  userId: string,
  now: string | Date = new Date(),
  approvalTypeId?: string,
): EApprovalDelegation | null {
  const nowMs = millis(now) ?? Date.now();
  for (const delegation of delegations ?? []) {
    if (delegation.active === false) continue;
    if (delegation.fromUserId !== userId) continue;
    if (approvalTypeId && delegation.approvalTypeIds?.length && !delegation.approvalTypeIds.includes(approvalTypeId)) {
      continue;
    }
    const from = millis(delegation.fromDate);
    if (from != null && nowMs < from) continue;
    const to = millis(delegation.toDate);
    // The `toDate` is a whole day: a delegation "up to 30 Aug" covers all of 30 August.
    if (to != null && nowMs > to + 86_400_000 - 1) continue;
    return delegation;
  }
  return null;
}

/* ------------------------------------------------------------------------------------------------
 * Templates, routing rules and step construction (spec sections 12, 13, 27, 28)
 * ---------------------------------------------------------------------------------------------- */

export interface EApprovalTemplateStep {
  id: string;
  name: string;
  type?: EApprovalStepType;
  /** More than one assignment makes the step a parallel group. */
  assignments: EApprovalAssignment[];
  groupMode?: EApprovalGroupMode;
  groupRequiredCount?: number;
  slaHours?: number;
  mandatory?: boolean;
  capabilities?: EApprovalStepCapabilities;
  description?: string;
}

export interface EApprovalTemplate {
  id: string;
  name: string;
  approvalTypeId?: string;
  departmentId?: string;
  description?: string;
  steps: EApprovalTemplateStep[];
  active?: boolean;
  organizationId?: string;
}

/**
 * One row of the approval matrix (spec section 13).
 *
 * A rule matches on any combination of approval type, department, project and amount band; the most
 * specific match wins, so a blanket rule can be left in place as a fallback while a department adds
 * its own. It carries either a `templateId` or its own `steps`, because an amount band usually reuses
 * a template and occasionally needs a one-off chain.
 */
export interface EApprovalMatrixRule {
  id: string;
  name?: string;
  approvalTypeId?: string;
  departmentId?: string;
  projectId?: string;
  minAmount?: number | null;
  maxAmount?: number | null;
  templateId?: string;
  steps?: EApprovalTemplateStep[];
  /** Breaks a tie between equally specific rules; higher wins. */
  priority?: number;
  active?: boolean;
  organizationId?: string;
}

export interface EApprovalRoutingContext {
  approvalTypeId?: string;
  departmentId?: string;
  projectId?: string;
  amount?: number;
}

/** Whether a rule is applicable at all. Unset criteria match everything. */
function matchesRoutingRule(rule: EApprovalMatrixRule, context: EApprovalRoutingContext): boolean {
  if (rule.active === false) return false;
  if (rule.approvalTypeId && rule.approvalTypeId !== context.approvalTypeId) return false;
  if (rule.departmentId && rule.departmentId !== context.departmentId) return false;
  if (rule.projectId && rule.projectId !== context.projectId) return false;
  const amount = Number(context.amount ?? 0);
  if (rule.minAmount != null && amount < rule.minAmount) return false;
  // Bands are inclusive of their upper bound so `25,001–1,00,000` and `1,00,001–5,00,000` tile the
  // number line the way the spec writes them, with no value falling between two rules.
  if (rule.maxAmount != null && amount > rule.maxAmount) return false;
  return true;
}

/** How many criteria a rule pins down — the specificity score that decides between matches. */
function routingRuleSpecificity(rule: EApprovalMatrixRule): number {
  let score = 0;
  if (rule.approvalTypeId) score += 8;
  if (rule.departmentId) score += 4;
  if (rule.projectId) score += 2;
  if (rule.minAmount != null || rule.maxAmount != null) score += 1;
  return score;
}

/**
 * The routing rule that applies to a request, or null to fall back to an ad-hoc chain.
 *
 * Most specific wins, then explicit `priority`, then a narrower amount band — the last tie-break
 * matters because two rules for the same type and department differing only in band are the normal
 * shape of an approval matrix, and picking the wider one would route a ₹9,00,000 purchase through
 * the ₹25,000 chain.
 */
export function resolveEApprovalRouting(
  rules: EApprovalMatrixRule[] | null | undefined,
  context: EApprovalRoutingContext,
): EApprovalMatrixRule | null {
  const matches = (rules ?? []).filter((rule) => matchesRoutingRule(rule, context));
  if (!matches.length) return null;
  const bandWidth = (rule: EApprovalMatrixRule) =>
    (rule.maxAmount ?? Number.MAX_SAFE_INTEGER) - (rule.minAmount ?? 0);
  matches.sort((a, b) => {
    const specificity = routingRuleSpecificity(b) - routingRuleSpecificity(a);
    if (specificity !== 0) return specificity;
    const priority = (b.priority ?? 0) - (a.priority ?? 0);
    if (priority !== 0) return priority;
    return bandWidth(a) - bandWidth(b);
  });
  return matches[0];
}

export interface BuildEApprovalStepsOptions {
  priority?: EApprovalPriority;
  settings?: Pick<EApprovalSettings, 'defaultSlaHours'>;
  version?: number;
  /** Injected so ids are deterministic in tests and collision-free in the service. */
  nextId?: (seed: string) => string;
  requesterId?: string;
}

let stepIdCounter = 0;
const defaultNextId = (seed: string) => `${seed}-${(stepIdCounter += 1)}`;

/**
 * Expands template steps into the step records a new request starts life with.
 *
 * Every record starts 'Pending'; `Submit` activates the first group. A template step with more than
 * one assignment becomes one record per assignee sharing a `groupId` and a `sequence`, which is what
 * makes the parallel approval of spec section 28 fall out of the same advance logic as a serial one.
 */
export function buildEApprovalSteps(
  templateSteps: EApprovalTemplateStep[],
  options: BuildEApprovalStepsOptions = {},
): EApprovalStepRecord[] {
  const nextId = options.nextId ?? defaultNextId;
  const priority = options.priority ?? 'Normal';
  const settings = options.settings ?? DEFAULT_E_APPROVAL_SETTINGS;
  const records: EApprovalStepRecord[] = [];
  templateSteps.forEach((templateStep, index) => {
    const assignments = templateStep.assignments?.length
      ? templateStep.assignments
      : [{ kind: 'User' } as EApprovalAssignment];
    const groupId = nextId(`grp-${index + 1}`);
    const mode: EApprovalGroupMode =
      templateStep.groupMode ?? (assignments.length > 1 ? 'All' : 'Single');
    assignments.forEach((assignment) => {
      records.push({
        id: nextId(`step-${index + 1}`),
        type: templateStep.type ?? 'APPROVAL',
        name: templateStep.name,
        sequence: index + 1,
        depth: 0,
        parentStepId: null,
        originStepId: null,
        groupId,
        groupMode: mode,
        groupRequiredCount:
          mode === 'NofM'
            ? Math.max(1, Math.min(assignments.length, templateStep.groupRequiredCount ?? assignments.length))
            : undefined,
        assignment,
        status: 'Pending',
        outcome: null,
        instruction: templateStep.description,
        slaHours: eApprovalStepSla(templateStep.slaHours, priority, settings),
        mandatory: templateStep.mandatory ?? true,
        capabilities: templateStep.capabilities,
        version: options.version ?? 1,
        escalationsSent: [],
        pausedMs: 0,
      });
    });
  });
  return records;
}

/* ------------------------------------------------------------------------------------------------
 * Material change and versioning (spec section 6)
 * ---------------------------------------------------------------------------------------------- */

/** The subset of a request the change detector compares. */
export interface EApprovalMaterialSnapshot {
  subject?: string;
  body?: string;
  amount?: number;
  departmentId?: string;
  projectId?: string;
  approvalTypeId?: string;
  vendorId?: string;
  costCentre?: string;
  budgetHead?: string;
  requiredBy?: string | null;
  /** Names+sizes of the attachments, so swapping a quotation counts as a change. */
  attachmentsFingerprint?: string;
  [key: string]: unknown;
}

const normalizeMaterialValue = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'number') return String(roundEApprovalMoney(value));
  return String(value).replace(/\s+/g, ' ').trim().toLowerCase();
};

/**
 * A stable fingerprint of the fields that were approved.
 *
 * Stored on the request at submission and compared on resubmission. A fingerprint rather than a full
 * snapshot because the comparison has to work against a document written months earlier, without
 * having to keep the old field list in step with the new one.
 */
export function eApprovalMaterialFingerprint(
  snapshot: EApprovalMaterialSnapshot,
  fields: string[] = DEFAULT_E_APPROVAL_SETTINGS.materialFields,
): string {
  return fields
    .slice()
    .sort()
    .map((field) => `${field}=${normalizeMaterialValue(snapshot[field])}`)
    .join('|');
}

export interface EApprovalMaterialChange {
  changed: boolean;
  /** Field names that differ, for the "Approval content modified" banner. */
  fields: string[];
  fingerprint: string;
  /** Present when the amount is one of the changed fields. */
  amountChange?: { from: number; to: number; pct: number };
}

/**
 * Whether an edit invalidates the approvals already given.
 *
 * The tolerance exists for the case a Director actually asks for — "correct the paise, the figure is
 * ₹2,50,000.40" — without handing anyone a way to raise a ₹5,00,000 proposal to ₹9,00,000 under
 * existing signatures. It defaults to 0, so out of the box *any* amount change supersedes.
 */
export function detectEApprovalMaterialChange(
  before: EApprovalMaterialSnapshot | null | undefined,
  after: EApprovalMaterialSnapshot,
  settings: Pick<EApprovalSettings, 'materialFields' | 'amountTolerancePct'> = DEFAULT_E_APPROVAL_SETTINGS,
): EApprovalMaterialChange {
  const fields = settings.materialFields?.length
    ? settings.materialFields
    : DEFAULT_E_APPROVAL_SETTINGS.materialFields;
  const fingerprint = eApprovalMaterialFingerprint(after, fields);
  if (!before) return { changed: false, fields: [], fingerprint };

  const changed: string[] = [];
  let amountChange: EApprovalMaterialChange['amountChange'];
  for (const field of fields) {
    if (field === 'amount') {
      const from = roundEApprovalMoney(Number(before.amount ?? 0));
      const to = roundEApprovalMoney(Number(after.amount ?? 0));
      if (from === to) continue;
      const pct = from === 0 ? 100 : Math.abs(((to - from) / from) * 100);
      amountChange = { from, to, pct: Math.round(pct * 100) / 100 };
      if (pct > (settings.amountTolerancePct ?? 0)) changed.push('amount');
      continue;
    }
    if (normalizeMaterialValue(before[field]) !== normalizeMaterialValue(after[field])) {
      changed.push(field);
    }
  }
  return { changed: changed.length > 0, fields: changed, fingerprint, amountChange };
}

/** Human-readable field names for the supersede banner and the history line. */
export const E_APPROVAL_MATERIAL_FIELD_LABELS: Record<string, string> = {
  subject: 'Subject',
  body: 'Proposal',
  amount: 'Amount',
  departmentId: 'Department',
  projectId: 'Project / Site',
  approvalTypeId: 'Approval type',
  vendorId: 'Vendor',
  costCentre: 'Cost centre',
  budgetHead: 'Budget head',
  requiredBy: 'Required by',
  attachmentsFingerprint: 'Attachments',
};

export function describeEApprovalMaterialChange(change: EApprovalMaterialChange): string {
  if (!change.changed) return 'No material change';
  const names = change.fields.map((field) => E_APPROVAL_MATERIAL_FIELD_LABELS[field] || field);
  return `${names.join(', ')} changed after approval`;
}

/* ------------------------------------------------------------------------------------------------
 * Step queries
 * ---------------------------------------------------------------------------------------------- */

export function findEApprovalStep(
  steps: EApprovalStepRecord[],
  stepId: string | null | undefined,
): EApprovalStepRecord | null {
  if (!stepId) return null;
  return steps.find((step) => step.id === stepId) ?? null;
}

/** Steps somebody can act on right now. */
export function activeEApprovalSteps(steps: EApprovalStepRecord[]): EApprovalStepRecord[] {
  return steps.filter((step) => step.status === 'Active');
}

export function primaryEApprovalSteps(steps: EApprovalStepRecord[]): EApprovalStepRecord[] {
  return steps.filter((step) => step.depth === 0).sort((a, b) => a.sequence - b.sequence);
}

/** Children of `stepId` that have not finished — what keeps a parent waiting. */
export function openEApprovalChildren(
  steps: EApprovalStepRecord[],
  stepId: string,
): EApprovalStepRecord[] {
  return steps.filter((step) => step.parentStepId === stepId && isOpenEApprovalStepStatus(step.status));
}

export function eApprovalChildren(
  steps: EApprovalStepRecord[],
  stepId: string,
): EApprovalStepRecord[] {
  return steps.filter((step) => step.parentStepId === stepId);
}

/**
 * The verification stack from the primary approver down to `stepId`, root first.
 *
 * This is what the detail screen renders as `Director → Finance Manager → Accounts Executive`, and
 * what proves the pop order is right: the array read backwards is the order control returns in.
 */
export function eApprovalStepChain(
  steps: EApprovalStepRecord[],
  stepId: string,
): EApprovalStepRecord[] {
  const chain: EApprovalStepRecord[] = [];
  const seen = new Set<string>();
  let current = findEApprovalStep(steps, stepId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.unshift(current);
    current = findEApprovalStep(steps, current.parentStepId);
  }
  return chain;
}

/** Members of a step's parallel group, itself included. */
export function eApprovalGroupMembers(
  steps: EApprovalStepRecord[],
  step: EApprovalStepRecord,
): EApprovalStepRecord[] {
  const key = step.groupId ?? `seq-${step.sequence}`;
  return steps.filter(
    (candidate) =>
      candidate.depth === step.depth &&
      (candidate.groupId ?? `seq-${candidate.sequence}`) === key,
  );
}

export interface EApprovalGroupState {
  members: EApprovalStepRecord[];
  mode: EApprovalGroupMode;
  required: number;
  approved: number;
  rejected: number;
  open: number;
  satisfied: boolean;
}

/**
 * Whether a parallel group has collected the approvals it needs (spec section 28).
 *
 * 'Single' and 'All' both require every member; they are kept distinct so the UI can say "all three
 * must approve" only when the configuration actually says so, rather than for every ordinary
 * one-person step.
 */
export function eApprovalGroupState(
  steps: EApprovalStepRecord[],
  step: EApprovalStepRecord,
): EApprovalGroupState {
  const members = eApprovalGroupMembers(steps, step);
  const mode = step.groupMode ?? members[0]?.groupMode ?? 'Single';
  const approved = members.filter(
    (member) => member.status === 'Completed' && isPositiveEApprovalOutcome(member.outcome),
  ).length;
  const rejected = members.filter(
    (member) => member.outcome === 'Rejected' || member.outcome === 'Not Verified',
  ).length;
  const open = members.filter((member) => isOpenEApprovalStepStatus(member.status)).length;
  const required =
    mode === 'Any'
      ? 1
      : mode === 'NofM'
        ? Math.max(1, Math.min(members.length, step.groupRequiredCount ?? members.length))
        : members.length;
  return { members, mode, required, approved, rejected, open, satisfied: approved >= required };
}

/**
 * The readable status of spec section 10 — "Pending with Finance Manager".
 *
 * Names every active assignee rather than just the first, because on a parallel step "Pending with
 * Finance" when it is actually pending with Finance *and* Legal is the kind of half-truth that has
 * people chasing the wrong desk.
 */
export function eApprovalPendingLabel(
  request: Pick<EApprovalRequestState, 'status' | 'requesterName'>,
  steps: EApprovalStepRecord[],
): string {
  if (isTerminalEApprovalStatus(request.status)) return request.status;
  if (request.status === 'Draft') return 'Draft';
  const active = activeEApprovalSteps(steps);
  if (!active.length) {
    if (request.status === 'Returned') return `Pending with ${request.requesterName || 'requester'}`;
    return request.status;
  }
  const names = Array.from(new Set(active.map((step) => describeEApprovalAssignment(step.assignment))));
  const shown = names.slice(0, 2).join(' & ');
  const extra = names.length > 2 ? ` +${names.length - 2}` : '';
  const verb = active.every((step) => step.type === 'VERIFICATION')
    ? 'Verification pending with'
    : active.every((step) => step.type === 'CLARIFICATION')
      ? 'Clarification pending with'
      : 'Pending with';
  return `${verb} ${shown}${extra}`;
}

/**
 * The request status implied by the live steps.
 *
 * Derived rather than assigned, so the twelve transitions below cannot disagree about what
 * "Pending Verification" means. A step waiting on its own children does not count as an approval
 * pending — the file is genuinely with the verifier.
 */
export function deriveEApprovalStatus(steps: EApprovalStepRecord[]): EApprovalStatus | null {
  const active = activeEApprovalSteps(steps);
  if (!active.length) return null;
  if (active.some((step) => step.type === 'VERIFICATION' || step.type === 'REVIEW')) return 'Pending Verification';
  if (active.some((step) => step.type === 'CLARIFICATION')) return 'Pending Clarification';
  return 'Pending Approval';
}

/* ------------------------------------------------------------------------------------------------
 * Who may act (spec sections 4, 11, 23, 26)
 * ---------------------------------------------------------------------------------------------- */

export interface EApprovalActor {
  userId: string;
  userName?: string;
  designation?: string;
  departmentId?: string;
  /** All departments the user belongs to, when the organisation allows more than one. */
  departmentIds?: string[];
  role?: string;
  /** Whether the user heads the department they are acting for — mode B of spec section 11. */
  isDepartmentHead?: boolean;
  /** Delegations in force, so a substitute can act in the assignee's place. */
  delegations?: EApprovalDelegation[];
}

const actorDepartments = (actor: EApprovalActor): string[] =>
  Array.from(new Set([actor.departmentId, ...(actor.departmentIds ?? [])].filter(Boolean) as string[]));

/**
 * Whether `actor` may act on `step`.
 *
 * Four ways in, in order of directness: the step is assigned to them; they hold a standing delegation
 * recorded on the step; a substitute-approver window covers the assignee; or the step is assigned to
 * a department or role they belong to. A department 'Queue' step that somebody has already claimed is
 * theirs alone — otherwise two people act on the same file and one of the two actions is lost.
 */
export function isEApprovalStepAssignee(
  step: EApprovalStepRecord,
  actor: EApprovalActor | null | undefined,
  options: { requesterId?: string; now?: string | Date; approvalTypeId?: string } = {},
): boolean {
  if (!actor?.userId) return false;
  if (step.delegatedToUserId && step.delegatedToUserId === actor.userId) return true;

  switch (step.assignment.kind) {
    case 'User': {
      if (step.assignment.userId === actor.userId) return true;
      const delegate = resolveEApprovalDelegate(
        actor.delegations,
        step.assignment.userId || '',
        options.now ?? new Date(),
        options.approvalTypeId,
      );
      return Boolean(delegate && delegate.toUserId === actor.userId);
    }
    case 'Department': {
      const departments = actorDepartments(actor);
      if (!step.assignment.departmentId || !departments.includes(step.assignment.departmentId)) return false;
      const mode = step.assignment.departmentMode ?? 'Anyone';
      if (mode === 'Head') return Boolean(actor.isDepartmentHead);
      // Once somebody has claimed the step it is theirs, in every mode — two people acting on one
      // file means one of the two actions is silently lost.
      if (step.ownedByUserId) return step.ownedByUserId === actor.userId;
      if (mode === 'Queue') return Boolean(actor.isDepartmentHead);
      return true;
    }
    case 'Role':
      return Boolean(step.assignment.role && actor.role === step.assignment.role);
    case 'Requester':
      return Boolean(options.requesterId && options.requesterId === actor.userId);
    default:
      return false;
  }
}

export function canActOnEApprovalStep(
  step: EApprovalStepRecord,
  actor: EApprovalActor | null | undefined,
  options: { requesterId?: string; now?: string | Date; approvalTypeId?: string } = {},
): boolean {
  if (step.status !== 'Active') return false;
  return isEApprovalStepAssignee(step, actor, options);
}

/** An unclaimed department-queue step the actor may take ownership of (mode A and C). */
export function canTakeEApprovalOwnership(
  step: EApprovalStepRecord,
  actor: EApprovalActor | null | undefined,
): boolean {
  if (!actor?.userId || step.status !== 'Active') return false;
  if (step.assignment.kind !== 'Department') return false;
  if (step.ownedByUserId) return false;
  const mode = step.assignment.departmentMode ?? 'Anyone';
  if (mode === 'Head') return false;
  return Boolean(step.assignment.departmentId && actorDepartments(actor).includes(step.assignment.departmentId));
}

export const E_APPROVAL_ACTION_KINDS = [
  'Submit',
  'Approve',
  'Approve And Complete',
  'Send For Verification',
  'Verify',
  'Request Clarification',
  'Provide Clarification',
  'Return',
  'Forward',
  'Delegate',
  'Add Approver',
  'Escalate',
  'Reject',
  'Hold',
  'Resume',
  'Cancel',
  'Resubmit',
  'Take Ownership',
  'Add Participant',
] as const;

export type EApprovalActionKind = (typeof E_APPROVAL_ACTION_KINDS)[number];

/** Labels for the action panel of spec section 9. */
export const E_APPROVAL_ACTION_LABELS: Record<EApprovalActionKind, string> = {
  Submit: 'Submit',
  Approve: 'Approve',
  'Approve And Complete': 'Approve & Complete',
  'Send For Verification': 'Send for Verification',
  Verify: 'Verify',
  'Request Clarification': 'Request Clarification',
  'Provide Clarification': 'Provide Clarification',
  Return: 'Return',
  Forward: 'Forward for Approval',
  Delegate: 'Delegate',
  'Add Approver': 'Add Approver',
  Escalate: 'Escalate',
  Reject: 'Reject',
  Hold: 'Hold',
  Resume: 'Resume',
  Cancel: 'Cancel',
  Resubmit: 'Resubmit',
  'Take Ownership': 'Take Ownership',
  'Add Participant': 'Add Participant',
};

/**
 * The actions to offer the person holding a step.
 *
 * Derived from the step's type and its configured capabilities — *not* from the actor's role
 * permissions. Being assigned the step is the authority to act on it: a verifier the Director picked
 * is authorised by that assignment, and demanding they also hold an "E-Approval.Verify" permission is
 * how a file ends up parked with somebody who cannot move it. Role permissions gate who can see and
 * administer approvals, which is `canViewEApproval` and the settings screens.
 */
export function availableEApprovalActions(
  request: Pick<EApprovalRequestState, 'status' | 'priority'>,
  step: EApprovalStepRecord,
  options: {
    settings?: Pick<EApprovalSettings, 'allowApproveAndComplete' | 'allowNestedVerification' | 'maxVerificationDepth' | 'allowReturnToAnyStep'>;
    /** Whether any primary step still lies ahead — Approve & Complete is pointless otherwise. */
    hasRemainingSteps?: boolean;
  } = {},
): EApprovalActionKind[] {
  const settings = { ...DEFAULT_E_APPROVAL_SETTINGS, ...(options.settings || {}) };
  if (step.status === 'On Hold') return ['Resume'];
  if (step.status !== 'Active') return [];
  if (isTerminalEApprovalStatus(request.status)) return [];

  const actions: EApprovalActionKind[] = [];
  const canNest = settings.allowNestedVerification && step.depth < settings.maxVerificationDepth;

  if (step.type === 'APPROVAL') {
    actions.push('Approve');
    if (settings.allowApproveAndComplete && eApprovalCapability(step, 'canFinalise') && options.hasRemainingSteps) {
      actions.push('Approve And Complete');
    }
    if (eApprovalCapability(step, 'canVerify') && canNest) actions.push('Send For Verification');
    if (eApprovalCapability(step, 'canRequestClarification')) actions.push('Request Clarification');
    if (eApprovalCapability(step, 'canReturn')) actions.push('Return');
    if (eApprovalCapability(step, 'canForward')) actions.push('Forward');
    if (eApprovalCapability(step, 'canDelegate')) actions.push('Delegate');
    if (eApprovalCapability(step, 'canAddApprover')) actions.push('Add Approver');
    if (eApprovalCapability(step, 'canEscalate')) actions.push('Escalate');
    if (eApprovalCapability(step, 'canReject')) actions.push('Reject');
    if (eApprovalCapability(step, 'canHold')) actions.push('Hold');
  } else if (step.type === 'VERIFICATION' || step.type === 'REVIEW') {
    actions.push('Verify');
    if (eApprovalCapability(step, 'canVerify') && canNest) actions.push('Send For Verification');
    if (eApprovalCapability(step, 'canRequestClarification')) actions.push('Request Clarification');
    if (eApprovalCapability(step, 'canReturn')) actions.push('Return');
    if (eApprovalCapability(step, 'canDelegate')) actions.push('Delegate');
    if (eApprovalCapability(step, 'canHold')) actions.push('Hold');
  } else if (step.type === 'CLARIFICATION') {
    actions.push('Provide Clarification');
    if (eApprovalCapability(step, 'canReturn')) actions.push('Return');
    if (eApprovalCapability(step, 'canDelegate')) actions.push('Delegate');
  }

  actions.push('Add Participant');
  return actions;
}

/**
 * Which earlier steps an approver may send the file back to (spec section 5).
 *
 * Only completed steps behind the current one, plus the requester. Returning to a step that has not
 * acted yet would be a forward dressed up as a return, and returning into a sibling of a parallel
 * group would leave the group's satisfaction count referring to a step that is running again.
 */
export function eApprovalReturnTargets(
  steps: EApprovalStepRecord[],
  step: EApprovalStepRecord,
  options: { allowReturnToAnyStep?: boolean } = {},
): EApprovalStepRecord[] {
  const allowAny = options.allowReturnToAnyStep ?? true;
  // A child step's own chain comes first: its ancestors are the nearest, most natural targets, and
  // "Return to Sender" is the top one.
  const ancestors = eApprovalStepChain(steps, step.id).slice(0, -1).reverse();
  if (!allowAny) return ancestors;
  // `<` rather than `<=`, so a satisfied sibling in the same parallel group is not a target — its
  // group's approval count would then refer to a step that is running again.
  const anchorSequence = ancestors.length ? ancestors[ancestors.length - 1].sequence : step.sequence;
  const earlierPrimary = primaryEApprovalSteps(steps).filter(
    (candidate) =>
      candidate.id !== step.id && candidate.status === 'Completed' && candidate.sequence < anchorSequence,
  );
  const seen = new Set<string>();
  return [...ancestors, ...earlierPrimary.reverse()].filter((candidate) => {
    if (candidate.id === step.id || seen.has(candidate.id)) return false;
    seen.add(candidate.id);
    return true;
  });
}

/**
 * Whether `viewer` may open this request (spec section 26).
 *
 * Nobody sees every approval by default. The participant test comes first because it is the one that
 * must always hold — a person who acted on a file can always read the file they acted on, whatever
 * their role says today. Confidential files then require an explicit permission on top, so a salary
 * or disciplinary note-sheet is not readable by everyone holding "View Department Approval".
 */
export function canViewEApproval(
  request: Pick<EApprovalRequestState, 'requesterId' | 'departmentId' | 'ccUserIds' | 'participantUserIds' | 'confidential'>,
  steps: EApprovalStepRecord[],
  viewer: EApprovalActor | null | undefined,
  permissions: {
    viewAll?: boolean;
    viewDepartment?: boolean;
    viewConfidential?: boolean;
  } = {},
): boolean {
  if (!viewer?.userId) return false;

  const isParticipant =
    request.requesterId === viewer.userId ||
    (request.ccUserIds ?? []).includes(viewer.userId) ||
    (request.participantUserIds ?? []).includes(viewer.userId) ||
    steps.some(
      (step) =>
        step.assignment.userId === viewer.userId ||
        step.actedByUserId === viewer.userId ||
        step.delegatedToUserId === viewer.userId ||
        step.ownedByUserId === viewer.userId ||
        (step.assignment.kind === 'Department' &&
          step.assignment.departmentId &&
          actorDepartments(viewer).includes(step.assignment.departmentId)) ||
        (step.assignment.kind === 'Role' && step.assignment.role === viewer.role),
    );

  const byPermission =
    Boolean(permissions.viewAll) ||
    Boolean(
      permissions.viewDepartment &&
        request.departmentId &&
        actorDepartments(viewer).includes(request.departmentId),
    );

  if (!isParticipant && !byPermission) return false;
  if (request.confidential && !isParticipant && !permissions.viewConfidential) return false;
  return true;
}

/* ------------------------------------------------------------------------------------------------
 * Events and notification intents
 * ---------------------------------------------------------------------------------------------- */

export type EApprovalEventKind =
  | EApprovalActionKind
  | 'Created'
  | 'Auto Returned'
  | 'Superseded'
  | 'Escalation Fired'
  | 'Comment'
  | 'Attachment';

/**
 * One line of the history of spec section 20.
 *
 * Append-only: the service writes these to `eApprovalHistory` and nothing ever updates one. The
 * `summary` is rendered here rather than in the component so the same sentence appears in the
 * timeline, the final approval note and the export.
 */
export interface EApprovalEvent {
  at: string;
  actorId: string;
  actorName?: string;
  onBehalfOfUserId?: string;
  onBehalfOfName?: string;
  kind: EApprovalEventKind;
  stepId?: string;
  stepName?: string;
  stepType?: EApprovalStepType;
  targetStepId?: string;
  targetStepName?: string;
  outcome?: EApprovalOutcome | null;
  comment?: string;
  instruction?: string;
  reason?: string;
  version?: number;
  summary: string;
}

export type EApprovalNotificationKind =
  | 'Assigned'
  | 'Verification Assigned'
  | 'Clarification Requested'
  | 'Returned'
  | 'Forwarded'
  | 'Delegated'
  | 'Escalated'
  | 'On Hold'
  | 'Approved'
  | 'Rejected'
  | 'Cancelled'
  | 'Modified';

/** What the engine decided should be notified; the service resolves and delivers it. */
export interface EApprovalNotificationIntent {
  kind: EApprovalNotificationKind;
  userIds?: string[];
  departmentIds?: string[];
  roles?: string[];
  title: string;
  body: string;
  severity?: 'INFO' | 'WARNING' | 'CRITICAL';
}

export interface EApprovalTransition {
  request: EApprovalRequestState;
  steps: EApprovalStepRecord[];
  events: EApprovalEvent[];
  notifications: EApprovalNotificationIntent[];
}

/** Thrown for a rule violation the user can act on, so callers can show the message verbatim. */
export class EApprovalRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EApprovalRuleError';
  }
}

/* ------------------------------------------------------------------------------------------------
 * The reducer
 * ---------------------------------------------------------------------------------------------- */

export interface EApprovalActionInput {
  kind: EApprovalActionKind;
  actor: EApprovalActor;
  /** The step being acted on. Optional when the actor holds exactly one actionable step. */
  stepId?: string;
  now?: string | Date;
  comment?: string;
  /** What a verifier or clarifier is being asked to do. */
  instruction?: string;
  /** Send For Verification / Request Clarification / Forward / Delegate / Add Approver / Escalate. */
  targets?: EApprovalAssignment[];
  slaHours?: number;
  /** Return: an earlier step id, or 'REQUESTER'. */
  returnTo?: string | 'REQUESTER';
  /** Verify: which of the three verification results. Defaults to 'Verified'. */
  outcome?: EApprovalOutcome;
  reason?: string;
  /** Add Participant. */
  participantUserIds?: string[];
  /** Resubmit: computed by the caller with `detectEApprovalMaterialChange`. */
  materialChange?: EApprovalMaterialChange;
  settings?: Partial<EApprovalSettings>;
  /** Injected id factory, so the service can use Firestore ids and tests can use counters. */
  nextId?: (seed: string) => string;
}

const cloneStep = (step: EApprovalStepRecord): EApprovalStepRecord => ({
  ...step,
  assignment: { ...step.assignment },
  capabilities: step.capabilities ? { ...step.capabilities } : undefined,
  escalationsSent: [...(step.escalationsSent ?? [])],
  reassignments: step.reassignments ? step.reassignments.map((entry) => ({ ...entry })) : undefined,
});

/** Puts a step on the clock. Called on submit, on advance, and on every re-open. */
function activateStep(step: EApprovalStepRecord, now: string, slaHours?: number): void {
  step.status = 'Active';
  step.startedAt = now;
  step.pausedAt = null;
  step.pausedMs = 0;
  step.outcome = null;
  step.completedAt = null;
  step.escalationsSent = [];
  if (slaHours != null) step.slaHours = slaHours;
  step.dueAt = eApprovalDueAt(now, step.slaHours, 0);
}

/** Stops the clock without ending the step — a hold, or waiting on a child. */
function pauseStep(step: EApprovalStepRecord, status: EApprovalStepStatus, now: string): void {
  step.status = status;
  step.pausedAt = now;
}

/** Restarts a paused clock, crediting the step the time it spent waiting. */
function unpauseStep(step: EApprovalStepRecord, now: string): void {
  const pausedFrom = millis(step.pausedAt);
  const nowMs = millis(now) ?? Date.now();
  if (pausedFrom != null) {
    step.pausedMs = Math.max(0, (step.pausedMs ?? 0) + (nowMs - pausedFrom));
  }
  step.pausedAt = null;
  step.status = 'Active';
  step.dueAt = eApprovalDueAt(step.startedAt, step.slaHours, step.pausedMs);
}

function completeStep(
  step: EApprovalStepRecord,
  outcome: EApprovalOutcome,
  actor: EApprovalActor,
  now: string,
  comment?: string,
): void {
  step.status = outcome === 'Returned' ? 'Returned' : 'Completed';
  step.outcome = outcome;
  step.completedAt = now;
  step.actedByUserId = actor.userId;
  step.actedByName = actor.userName;
  if (comment) step.comment = comment;
  // A delegate acting for somebody else is recorded on the step, not just in history, so the
  // timeline can say "Approved by CFO on behalf of Director" without joining to the event log.
  if (step.assignment.kind === 'User' && step.assignment.userId && step.assignment.userId !== actor.userId) {
    step.onBehalfOfUserId = step.assignment.userId;
    step.onBehalfOfName = step.assignment.userName;
  }
}

/** Recomputes the denormalised "pending with" pointers after any change to the step list. */
function refreshPointers(request: EApprovalRequestState, steps: EApprovalStepRecord[]): void {
  const active = activeEApprovalSteps(steps);
  request.currentStepIds = active.map((step) => step.id);
  request.currentAssigneeIds = Array.from(
    new Set(
      active.flatMap((step) =>
        [
          step.assignment.kind === 'User' ? step.assignment.userId : undefined,
          step.delegatedToUserId,
          step.ownedByUserId,
          step.assignment.kind === 'Requester' ? request.requesterId : undefined,
        ].filter(Boolean) as string[],
      ),
    ),
  );
  request.currentDepartmentIds = Array.from(
    new Set(
      active
        .filter((step) => step.assignment.kind === 'Department')
        .map((step) => step.assignment.departmentId)
        .filter(Boolean) as string[],
    ),
  );
  request.currentRoles = Array.from(
    new Set(
      active
        .filter((step) => step.assignment.kind === 'Role')
        .map((step) => step.assignment.role)
        .filter(Boolean) as string[],
    ),
  );
  const dueDates = active
    .map((step) => millis(step.dueAt))
    .filter((value): value is number => value != null);
  request.currentDueAt = dueDates.length ? new Date(Math.min(...dueDates)).toISOString() : null;
  request.pendingLabel = eApprovalPendingLabel(request, steps);
}

const assignmentRecipients = (
  assignments: EApprovalAssignment[],
): Pick<EApprovalNotificationIntent, 'userIds' | 'departmentIds' | 'roles'> => ({
  userIds: assignments.map((assignment) => assignment.userId).filter(Boolean) as string[],
  departmentIds: assignments.map((assignment) => assignment.departmentId).filter(Boolean) as string[],
  roles: assignments.map((assignment) => assignment.role).filter(Boolean) as string[],
});

const stepRecipients = (step: EApprovalStepRecord, requesterId?: string) =>
  assignmentRecipients([
    step.assignment.kind === 'Requester' && requesterId
      ? { kind: 'User', userId: requesterId }
      : step.assignment,
  ]);

const actorLabel = (actor: EApprovalActor) => actor.userName || actor.userId;

/**
 * Activates the next primary group, or finishes the request when the chain is exhausted.
 *
 * The "next" group is the lowest sequence still pending — not `current + 1` — which is what lets a
 * return re-open three steps and have them run again in their original order without any special
 * case here.
 */
function advancePrimaryChain(
  request: EApprovalRequestState,
  steps: EApprovalStepRecord[],
  now: string,
  events: EApprovalEvent[],
  notifications: EApprovalNotificationIntent[],
  actor: EApprovalActor,
): void {
  const pending = primaryEApprovalSteps(steps).filter((step) => step.status === 'Pending');
  if (!pending.length) {
    request.status = 'Approved';
    request.completedAt = now;
    events.push({
      at: now,
      actorId: actor.userId,
      actorName: actor.userName,
      kind: 'Approve',
      summary: `${request.referenceNo || 'Request'} fully approved`,
    });
    notifications.push({
      kind: 'Approved',
      userIds: [request.requesterId],
      title: 'Approval completed',
      body: `${request.referenceNo || 'Your request'} has been approved.`,
    });
    return;
  }
  const nextSequence = Math.min(...pending.map((step) => step.sequence));
  const group = pending.filter((step) => step.sequence === nextSequence);
  group.forEach((step) => activateStep(step, now, step.slaHours));
  notifications.push({
    kind: 'Assigned',
    ...assignmentRecipients(group.map((step) => step.assignment)),
    title: 'Approval required',
    body: `${request.referenceNo || 'A request'} is pending your approval.`,
  });
}

/**
 * Ends a step and moves the file on — the one place that decides what "on" means.
 *
 * A child step pops to its origin; a primary step advances the chain once its parallel group is
 * satisfied. Both paths run through here so a verification of a verification cannot take a different
 * route back than a verification of an approval.
 */
function completeAndAdvance(
  request: EApprovalRequestState,
  steps: EApprovalStepRecord[],
  step: EApprovalStepRecord,
  outcome: EApprovalOutcome,
  actor: EApprovalActor,
  now: string,
  comment: string | undefined,
  events: EApprovalEvent[],
  notifications: EApprovalNotificationIntent[],
): void {
  completeStep(step, outcome, actor, now, comment);

  if (isChildEApprovalStep(step)) {
    const parent = findEApprovalStep(steps, step.originStepId ?? step.parentStepId);
    if (!parent) {
      // Orphaned child (its parent was superseded by a return) — nothing to pop to.
      request.status = deriveEApprovalStatus(steps) ?? request.status;
      return;
    }
    const stillOpen = openEApprovalChildren(steps, parent.id).filter((child) => child.id !== step.id);
    if (stillOpen.length) {
      // Sibling verifications outstanding: the parent keeps waiting (spec section 4.2 allows more
      // than one verifier per request).
      request.status = deriveEApprovalStatus(steps) ?? request.status;
      return;
    }
    unpauseStep(parent, now);
    events.push({
      at: now,
      actorId: actor.userId,
      actorName: actor.userName,
      kind: 'Auto Returned',
      stepId: parent.id,
      stepName: parent.name,
      stepType: parent.type,
      targetStepId: step.id,
      targetStepName: step.name,
      summary: `Automatically returned to ${describeEApprovalAssignment(parent.assignment)} after ${
        step.type === 'CLARIFICATION' ? 'clarification' : 'verification'
      } by ${describeEApprovalAssignment(step.assignment)}`,
    });
    notifications.push({
      kind: 'Assigned',
      ...stepRecipients(parent, request.requesterId),
      title: step.type === 'CLARIFICATION' ? 'Clarification received' : 'Verification complete',
      body: `${request.referenceNo || 'A request'} is back with you for action.`,
    });
    request.status = deriveEApprovalStatus(steps) ?? 'Pending Approval';
    return;
  }

  // Primary chain.
  const group = eApprovalGroupState(steps, step);
  if (!group.satisfied) {
    if (group.open > 0) {
      request.status = group.approved > 0 ? 'Partially Approved' : (deriveEApprovalStatus(steps) ?? request.status);
      return;
    }
    // Group can no longer be satisfied — every member acted and the threshold was not reached. The
    // mandatory approval it represents did not happen, so the request cannot simply move on, and
    // nothing further should stay in anybody's queue.
    steps.forEach((candidate) => {
      if (isOpenEApprovalStepStatus(candidate.status)) {
        candidate.status = 'Cancelled';
        candidate.outcome = 'Cancelled';
        candidate.completedAt = now;
      }
    });
    request.status = 'Rejected';
    request.completedAt = now;
    request.rejectionReason =
      request.rejectionReason ||
      `${group.approved} of ${group.required} required approvals at "${step.name}"`;
    events.push({
      at: now,
      actorId: actor.userId,
      actorName: actor.userName,
      kind: 'Reject',
      stepId: step.id,
      stepName: step.name,
      summary: `Rejected — "${step.name}" collected ${group.approved} of ${group.required} required approvals`,
    });
    notifications.push({
      kind: 'Rejected',
      userIds: [request.requesterId],
      title: 'Approval rejected',
      body: `${request.referenceNo || 'Your request'} did not obtain the required approvals at ${step.name}.`,
      severity: 'WARNING',
    });
    return;
  }

  // Satisfied: any member still waiting is no longer needed.
  group.members
    .filter((member) => member.id !== step.id && isOpenEApprovalStepStatus(member.status))
    .forEach((member) => {
      member.status = 'Skipped';
      member.outcome = 'Skipped';
      member.completedAt = now;
    });

  advancePrimaryChain(request, steps, now, events, notifications, actor);
  if (!isTerminalEApprovalStatus(request.status)) {
    request.status = deriveEApprovalStatus(steps) ?? request.status;
  }
}

/** Cancels a step and everything hanging off it — used by return, reject and cancel. */
function cancelSubtree(
  steps: EApprovalStepRecord[],
  rootId: string,
  now: string,
  outcome: EApprovalOutcome = 'Cancelled',
): void {
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift() as string;
    for (const step of steps) {
      if (step.parentStepId !== id) continue;
      if (isOpenEApprovalStepStatus(step.status)) {
        step.status = 'Cancelled';
        step.outcome = outcome;
        step.completedAt = now;
      }
      queue.push(step.id);
    }
  }
}

/** Puts a completed primary step back in the queue, keeping its history in the event log. */
function reopenStep(step: EApprovalStepRecord): void {
  step.status = 'Pending';
  step.reopened = true;
  step.outcome = null;
  step.completedAt = null;
  step.actedByUserId = undefined;
  step.actedByName = undefined;
  step.onBehalfOfUserId = undefined;
  step.onBehalfOfName = undefined;
  step.startedAt = null;
  step.dueAt = null;
  step.pausedAt = null;
  step.pausedMs = 0;
  step.escalationsSent = [];
}

/**
 * Applies one action to a request and returns the new state.
 *
 * Pure: no Firestore, no clock of its own, no ids of its own. `now` and `nextId` are injected, which
 * is what makes the twenty-odd transitions below testable as a table and lets the same function run
 * on the client, in a service call and inside the escalation cron.
 *
 * Throws `EApprovalRuleError` for anything the actor is not entitled to do, rather than silently
 * no-oping — a swallowed transition on an approval workflow is a file that nobody can explain.
 */
export function applyEApprovalAction(
  requestState: EApprovalRequestState,
  stepRecords: EApprovalStepRecord[],
  input: EApprovalActionInput,
): EApprovalTransition {
  const settings = { ...DEFAULT_E_APPROVAL_SETTINGS, ...(input.settings || {}) };
  const now = toIso(input.now ?? new Date()) as string;
  const nextId = input.nextId ?? defaultNextId;
  const actor = input.actor;
  if (!actor?.userId) throw new EApprovalRuleError('You must be signed in to act on an approval.');

  const request: EApprovalRequestState = { ...requestState };
  const steps = stepRecords.map(cloneStep);
  const events: EApprovalEvent[] = [];
  const notifications: EApprovalNotificationIntent[] = [];

  const pushEvent = (event: Omit<EApprovalEvent, 'at' | 'actorId' | 'actorName'>) => {
    events.push({ at: now, actorId: actor.userId, actorName: actor.userName, version: request.version, ...event });
  };

  /* ── actions that do not need an active step ───────────────────────────────────────────────── */

  if (input.kind === 'Submit') {
    if (request.status !== 'Draft') {
      throw new EApprovalRuleError('Only a draft can be submitted.');
    }
    if (request.requesterId !== actor.userId) {
      throw new EApprovalRuleError('Only the requester can submit this approval.');
    }
    request.submittedAt = now;
    request.status = 'Submitted';
    request.materialFingerprint = input.materialChange?.fingerprint ?? request.materialFingerprint;
    pushEvent({ kind: 'Submit', comment: input.comment, summary: `Submitted by ${actorLabel(actor)}` });
    advancePrimaryChain(request, steps, now, events, notifications, actor);
    if (!isTerminalEApprovalStatus(request.status)) {
      request.status = deriveEApprovalStatus(steps) ?? 'Pending Approval';
    }
    refreshPointers(request, steps);
    return { request, steps, events, notifications };
  }

  if (input.kind === 'Cancel') {
    if (isTerminalEApprovalStatus(request.status)) {
      throw new EApprovalRuleError(`A ${request.status.toLowerCase()} approval cannot be cancelled.`);
    }
    if (request.requesterId !== actor.userId) {
      throw new EApprovalRuleError('Only the requester can cancel this approval.');
    }
    steps.forEach((step) => {
      if (isOpenEApprovalStepStatus(step.status)) {
        step.status = 'Cancelled';
        step.outcome = 'Cancelled';
        step.completedAt = now;
      }
    });
    request.status = 'Cancelled';
    request.completedAt = now;
    request.cancelReason = input.reason;
    pushEvent({
      kind: 'Cancel',
      reason: input.reason,
      summary: `Cancelled by ${actorLabel(actor)}${input.reason ? ` — ${input.reason}` : ''}`,
    });
    refreshPointers(request, steps);
    return { request, steps, events, notifications };
  }

  if (input.kind === 'Resubmit') {
    if (request.status !== 'Returned') {
      throw new EApprovalRuleError('Only a returned approval can be resubmitted.');
    }
    if (request.requesterId !== actor.userId) {
      throw new EApprovalRuleError('Only the requester can resubmit this approval.');
    }
    const change = input.materialChange;
    if (change?.changed) {
      // Spec section 6: approvals already given do not survive a material change.
      const supersededVersion = request.version;
      steps.forEach((step) => {
        if (step.status === 'Completed' || step.status === 'Returned') {
          step.status = 'Superseded';
          step.supersededInVersion = supersededVersion;
        } else if (isOpenEApprovalStepStatus(step.status)) {
          step.status = 'Cancelled';
          step.outcome = 'Cancelled';
          step.completedAt = now;
        }
      });
      request.version = supersededVersion + 1;
      request.supersededCount = (request.supersededCount ?? 0) + 1;
      request.materialFingerprint = change.fingerprint;

      // Collected before the restart below, which clears `actedByUserId` off the steps it re-opens.
      // Only those who actually approved something: the approver who *returned* the file asked for
      // the change, and telling them their approval was superseded would be nonsense.
      const supersededActors = Array.from(
        new Set(
          steps
            .filter(
              (step) =>
                step.supersededInVersion === supersededVersion &&
                step.actedByUserId &&
                isPositiveEApprovalOutcome(step.outcome),
            )
            .map((step) => step.actedByUserId as string),
        ),
      );

      const policy = settings.restartOnMaterialChange;
      const primary = primaryEApprovalSteps(steps);
      const resumeStep = findEApprovalStep(steps, request.returnResumeStepId ?? null);
      const restartFrom =
        policy === 'First Step'
          ? primary[0]?.sequence ?? 1
          : policy === 'Returning Step'
            ? resumeStep?.sequence ?? primary[0]?.sequence ?? 1
            : primary.find((step) => step.supersededInVersion === supersededVersion)?.sequence ?? 1;
      primary
        .filter((step) => step.sequence >= restartFrom)
        .forEach((step) => {
          reopenStep(step);
          step.version = request.version;
          step.supersededInVersion = undefined;
        });
      pushEvent({
        kind: 'Superseded',
        reason: describeEApprovalMaterialChange(change),
        summary: `Version ${supersededVersion} superseded — ${describeEApprovalMaterialChange(change)}. Approvals restarted from ${
          policy === 'First Step' ? 'the first step' : 'the returning step'
        }.`,
      });
      notifications.push({
        kind: 'Modified',
        userIds: supersededActors,
        title: 'Approval content modified',
        body: `${request.referenceNo || 'A request'} you approved has been modified (${describeEApprovalMaterialChange(change)}). Your approval has been superseded.`,
        severity: 'WARNING',
      });
      request.status = 'Resubmitted';
      advancePrimaryChain(request, steps, now, events, notifications, actor);
    } else {
      // Nothing material changed: the file goes straight back to whoever returned it.
      const resume =
        findEApprovalStep(steps, request.returnResumeStepId ?? null) ??
        primaryEApprovalSteps(steps).find((step) => step.status === 'Pending') ??
        null;
      if (!resume) throw new EApprovalRuleError('This approval has no step to resume.');
      request.status = 'Resubmitted';
      activateStep(resume, now, resume.slaHours);
      notifications.push({
        kind: 'Assigned',
        ...stepRecipients(resume, request.requesterId),
        title: 'Approval resubmitted',
        body: `${request.referenceNo || 'A request'} has been resubmitted for your action.`,
      });
    }
    request.returnResumeStepId = null;
    request.returnedByStepId = null;
    pushEvent({ kind: 'Resubmit', comment: input.comment, summary: `Resubmitted by ${actorLabel(actor)}` });
    if (!isTerminalEApprovalStatus(request.status)) {
      request.status = deriveEApprovalStatus(steps) ?? request.status;
    }
    refreshPointers(request, steps);
    return { request, steps, events, notifications };
  }

  if (input.kind === 'Add Participant') {
    const added = (input.participantUserIds ?? []).filter(Boolean);
    if (!added.length) throw new EApprovalRuleError('Select at least one participant to add.');
    request.participantUserIds = Array.from(new Set([...(request.participantUserIds ?? []), ...added]));
    pushEvent({
      kind: 'Add Participant',
      summary: `${added.length} participant${added.length > 1 ? 's' : ''} added by ${actorLabel(actor)}`,
    });
    notifications.push({
      kind: 'Assigned',
      userIds: added,
      title: 'Added to an approval',
      body: `You have been added to ${request.referenceNo || 'an approval'} for visibility.`,
    });
    refreshPointers(request, steps);
    return { request, steps, events, notifications };
  }

  /* ── everything else acts on a step ────────────────────────────────────────────────────────── */

  if (isTerminalEApprovalStatus(request.status)) {
    throw new EApprovalRuleError(`This approval is ${request.status.toLowerCase()} and can no longer be acted on.`);
  }

  const assigneeOptions = {
    requesterId: request.requesterId,
    now,
    approvalTypeId: request.approvalTypeId,
  };
  // Resume is the one action whose step is not Active — it is the action that makes it active again.
  const actionable = steps.filter((step) =>
    input.kind === 'Resume'
      ? step.status === 'On Hold' && isEApprovalStepAssignee(step, actor, assigneeOptions)
      : canActOnEApprovalStep(step, actor, assigneeOptions),
  );

  const step = input.stepId
    ? steps.find((candidate) => candidate.id === input.stepId) ?? null
    : actionable.length === 1
      ? actionable[0]
      : null;

  if (!step) {
    throw new EApprovalRuleError(
      actionable.length > 1
        ? 'More than one step is pending with you — choose which one to act on.'
        : 'There is nothing pending with you on this approval.',
    );
  }

  if (input.kind === 'Take Ownership') {
    if (!canTakeEApprovalOwnership(step, actor)) {
      throw new EApprovalRuleError('This step is not available for you to take.');
    }
    step.ownedByUserId = actor.userId;
    step.ownedByName = actor.userName;
    pushEvent({
      kind: 'Take Ownership',
      stepId: step.id,
      stepName: step.name,
      stepType: step.type,
      summary: `${actorLabel(actor)} took ownership of "${step.name}" from the ${describeEApprovalAssignment(step.assignment)}`,
    });
    refreshPointers(request, steps);
    return { request, steps, events, notifications };
  }

  if (input.kind === 'Resume') {
    if (step.status !== 'On Hold') throw new EApprovalRuleError('This step is not on hold.');
    if (!isEApprovalStepAssignee(step, actor, assigneeOptions)) {
      throw new EApprovalRuleError('Only the approver who placed this hold can release it.');
    }
    unpauseStep(step, now);
    request.holdReason = undefined;
    request.status = deriveEApprovalStatus(steps) ?? 'Pending Approval';
    pushEvent({
      kind: 'Resume',
      stepId: step.id,
      stepName: step.name,
      stepType: step.type,
      summary: `Hold released by ${actorLabel(actor)}`,
    });
    refreshPointers(request, steps);
    return { request, steps, events, notifications };
  }

  if (
    !canActOnEApprovalStep(step, actor, {
      requesterId: request.requesterId,
      now,
      approvalTypeId: request.approvalTypeId,
    })
  ) {
    throw new EApprovalRuleError('This step is not pending with you.');
  }

  const remainingAhead = primaryEApprovalSteps(steps).some(
    (candidate) => candidate.status === 'Pending' && candidate.sequence > step.sequence,
  );
  const permitted = availableEApprovalActions(request, step, {
    settings,
    hasRemainingSteps: remainingAhead,
  });
  if (!permitted.includes(input.kind)) {
    throw new EApprovalRuleError(`"${E_APPROVAL_ACTION_LABELS[input.kind]}" is not available on this step.`);
  }

  const onBehalfOf =
    step.assignment.kind === 'User' && step.assignment.userId && step.assignment.userId !== actor.userId
      ? { onBehalfOfUserId: step.assignment.userId, onBehalfOfName: step.assignment.userName }
      : {};

  switch (input.kind) {
    case 'Approve':
    case 'Approve And Complete': {
      if (input.kind === 'Approve And Complete') {
        primaryEApprovalSteps(steps)
          .filter((candidate) => candidate.id !== step.id && isOpenEApprovalStepStatus(candidate.status))
          .forEach((candidate) => {
            cancelSubtree(steps, candidate.id, now);
            candidate.status = 'Skipped';
            candidate.outcome = 'Skipped';
            candidate.completedAt = now;
          });
      }
      pushEvent({
        ...onBehalfOf,
        kind: input.kind,
        stepId: step.id,
        stepName: step.name,
        stepType: step.type,
        outcome: 'Approved',
        comment: input.comment,
        summary: `Approved by ${actorLabel(actor)}${
          onBehalfOf.onBehalfOfName ? ` on behalf of ${onBehalfOf.onBehalfOfName}` : ''
        } at "${step.name}"${input.kind === 'Approve And Complete' ? ' — remaining steps skipped' : ''}`,
      });
      completeAndAdvance(request, steps, step, 'Approved', actor, now, input.comment, events, notifications);
      break;
    }

    case 'Verify':
    case 'Provide Clarification': {
      const outcome: EApprovalOutcome =
        input.kind === 'Provide Clarification' ? 'Clarified' : (input.outcome ?? 'Verified');
      if (input.kind === 'Verify' && !VERIFICATION_OUTCOMES.includes(outcome)) {
        throw new EApprovalRuleError('Choose a verification result.');
      }
      pushEvent({
        ...onBehalfOf,
        kind: input.kind,
        stepId: step.id,
        stepName: step.name,
        stepType: step.type,
        outcome,
        comment: input.comment,
        summary: `${outcome} by ${actorLabel(actor)} at "${step.name}"`,
      });
      completeAndAdvance(request, steps, step, outcome, actor, now, input.comment, events, notifications);
      break;
    }

    case 'Send For Verification':
    case 'Request Clarification': {
      const targets = (input.targets ?? []).filter(Boolean);
      if (!targets.length) {
        throw new EApprovalRuleError(
          input.kind === 'Send For Verification'
            ? 'Select at least one verifier.'
            : 'Select who the clarification is requested from.',
        );
      }
      if (step.depth + 1 > settings.maxVerificationDepth) {
        throw new EApprovalRuleError(
          `Verification cannot be nested more than ${settings.maxVerificationDepth} levels deep.`,
        );
      }
      const childType: EApprovalStepType =
        input.kind === 'Send For Verification' ? 'VERIFICATION' : 'CLARIFICATION';
      const groupId = nextId('grp-child');
      pauseStep(
        step,
        input.kind === 'Send For Verification' ? 'Awaiting Verification' : 'Awaiting Clarification',
        now,
      );
      targets.forEach((assignment) => {
        const child: EApprovalStepRecord = {
          id: nextId('step-child'),
          approvalId: step.approvalId,
          type: childType,
          name:
            input.kind === 'Send For Verification'
              ? `Verification — ${describeEApprovalAssignment(assignment)}`
              : `Clarification — ${describeEApprovalAssignment(assignment)}`,
          // Children share the parent's position in the chain: they are not a stage of their own,
          // which is what keeps the primary sequence meaningful however much verification happens.
          sequence: step.sequence,
          depth: step.depth + 1,
          parentStepId: step.id,
          originStepId: step.id,
          groupId,
          groupMode: targets.length > 1 ? 'All' : 'Single',
          assignment,
          status: 'Pending',
          outcome: null,
          instruction: input.instruction,
          slaHours: eApprovalStepSla(input.slaHours, request.priority, settings),
          mandatory: true,
          version: request.version,
          escalationsSent: [],
          pausedMs: 0,
        };
        activateStep(child, now, child.slaHours);
        steps.push(child);
      });
      pushEvent({
        ...onBehalfOf,
        kind: input.kind,
        stepId: step.id,
        stepName: step.name,
        stepType: step.type,
        instruction: input.instruction,
        comment: input.comment,
        summary: `${actorLabel(actor)} sent ${
          input.kind === 'Send For Verification' ? 'for verification' : 'a clarification request'
        } to ${targets.map(describeEApprovalAssignment).join(', ')}`,
      });
      notifications.push({
        kind: input.kind === 'Send For Verification' ? 'Verification Assigned' : 'Clarification Requested',
        ...assignmentRecipients(targets),
        title: input.kind === 'Send For Verification' ? 'Verification required' : 'Clarification required',
        body: input.instruction
          ? `${request.referenceNo || 'A request'}: ${input.instruction}`
          : `${request.referenceNo || 'A request'} needs your ${
              input.kind === 'Send For Verification' ? 'verification' : 'clarification'
            }.`,
      });
      request.status = deriveEApprovalStatus(steps) ?? request.status;
      break;
    }

    case 'Return': {
      if (!input.returnTo) throw new EApprovalRuleError('Choose where to return the approval to.');
      if (!input.reason && !input.comment) {
        throw new EApprovalRuleError('A reason is required to return an approval.');
      }
      // Any verification hanging off this step is moot once the file goes back.
      cancelSubtree(steps, step.id, now);
      completeStep(step, 'Returned', actor, now, input.comment);
      step.status = 'Returned';

      if (input.returnTo === 'REQUESTER') {
        // Everything ahead of the returning step waits; the returning step itself resumes once the
        // requester answers, so earlier approvals are not thrown away for a typo.
        primaryEApprovalSteps(steps)
          .filter((candidate) => isOpenEApprovalStepStatus(candidate.status))
          .forEach((candidate) => {
            candidate.status = 'Pending';
            candidate.startedAt = null;
            candidate.dueAt = null;
          });
        // The returning step keeps its 'Returned' status so the timeline still shows who sent it
        // back; `Resubmit` re-activates it, which clears the outcome then.
        const resumeAt = step.depth === 0 ? step : eApprovalStepChain(steps, step.id)[0];
        request.returnResumeStepId = resumeAt?.depth === 0 ? resumeAt.id : null;
        request.returnedByStepId = step.id;
        request.returnReason = input.reason ?? input.comment;
        request.status = 'Returned';
        pushEvent({
          ...onBehalfOf,
          kind: 'Return',
          stepId: step.id,
          stepName: step.name,
          stepType: step.type,
          outcome: 'Returned',
          reason: input.reason,
          comment: input.comment,
          summary: `Returned to the requester by ${actorLabel(actor)} — ${input.reason || input.comment}`,
        });
        notifications.push({
          kind: 'Returned',
          userIds: [request.requesterId],
          title: 'Approval returned',
          body: `${request.referenceNo || 'Your request'} was returned by ${actorLabel(actor)}: ${
            input.reason || input.comment || 'see comments'
          }`,
          severity: 'WARNING',
        });
        break;
      }

      const target = findEApprovalStep(steps, input.returnTo);
      if (!target) throw new EApprovalRuleError('The step to return to no longer exists.');
      const eligible = eApprovalReturnTargets(steps, step, {
        allowReturnToAnyStep: settings.allowReturnToAnyStep,
      });
      if (!eligible.some((candidate) => candidate.id === target.id)) {
        throw new EApprovalRuleError(`"${target.name}" is not a step this approval can be returned to.`);
      }

      // The target acts again now; everything between it and the returning step is re-opened so the
      // chain runs forward in its original order rather than jumping back to the returner.
      primaryEApprovalSteps(steps)
        .filter((candidate) => candidate.sequence > target.sequence && candidate.sequence <= step.sequence)
        .forEach((candidate) => {
          if (candidate.id === step.id) return;
          cancelSubtree(steps, candidate.id, now);
          reopenStep(candidate);
        });
      if (step.depth === 0) reopenStep(step);
      if (target.depth === 0) {
        reopenStep(target);
        activateStep(target, now, target.slaHours);
      } else {
        unpauseStep(target, now);
      }
      target.returnedFromStepId = step.id;
      target.reopened = true;
      request.status = 'Returned';
      request.returnedByStepId = step.id;
      request.returnReason = input.reason ?? input.comment;
      pushEvent({
        ...onBehalfOf,
        kind: 'Return',
        stepId: step.id,
        stepName: step.name,
        stepType: step.type,
        targetStepId: target.id,
        targetStepName: target.name,
        outcome: 'Returned',
        reason: input.reason,
        comment: input.comment,
        summary: `Returned to "${target.name}" (${describeEApprovalAssignment(target.assignment)}) by ${actorLabel(
          actor,
        )} — ${input.reason || input.comment}`,
      });
      notifications.push({
        kind: 'Returned',
        ...stepRecipients(target, request.requesterId),
        title: 'Approval returned to you',
        body: `${request.referenceNo || 'A request'} was returned to you by ${actorLabel(actor)}: ${
          input.reason || input.comment || 'see comments'
        }`,
        severity: 'WARNING',
      });
      break;
    }

    case 'Forward':
    case 'Delegate':
    case 'Escalate': {
      const target = (input.targets ?? [])[0];
      if (!target) throw new EApprovalRuleError('Choose who to send this to.');
      const from = { ...step.assignment };
      step.reassignments = [
        ...(step.reassignments ?? []),
        {
          at: now,
          kind: input.kind === 'Forward' ? 'Forward' : input.kind === 'Delegate' ? 'Delegate' : 'Escalate',
          byUserId: actor.userId,
          byName: actor.userName,
          from,
          to: target,
          reason: input.reason ?? input.comment,
        },
      ];

      if (input.kind === 'Delegate') {
        // Delegation adds an authorised actor; the step stays with its assignee, so a delegate who
        // never acts does not silently strip the original approver of the file.
        step.delegatedToUserId = target.userId;
        step.delegatedToName = target.userName;
      } else {
        // Forward and escalate transfer the step. Reassigning in place rather than pushing a child
        // is what keeps "who owns this approval" a single answer.
        step.assignment = target;
        step.ownedByUserId = undefined;
        step.ownedByName = undefined;
        step.delegatedToUserId = undefined;
        step.delegatedToName = undefined;
        activateStep(step, now, input.slaHours ? eApprovalStepSla(input.slaHours, request.priority, settings) : step.slaHours);
        if (input.kind === 'Escalate') step.name = `${step.name} (escalated)`;
      }

      pushEvent({
        ...onBehalfOf,
        kind: input.kind,
        stepId: step.id,
        stepName: step.name,
        stepType: step.type,
        reason: input.reason,
        comment: input.comment,
        summary:
          input.kind === 'Delegate'
            ? `Approval delegated by ${describeEApprovalAssignment(from)} to ${describeEApprovalAssignment(target)}`
            : input.kind === 'Forward'
              ? `Forwarded for approval from ${describeEApprovalAssignment(from)} to ${describeEApprovalAssignment(target)} by ${actorLabel(actor)}`
              : `Escalated to ${describeEApprovalAssignment(target)} by ${actorLabel(actor)}`,
      });
      notifications.push({
        kind: input.kind === 'Delegate' ? 'Delegated' : input.kind === 'Forward' ? 'Forwarded' : 'Escalated',
        ...assignmentRecipients([target]),
        title:
          input.kind === 'Delegate'
            ? 'Approval delegated to you'
            : input.kind === 'Forward'
              ? 'Approval forwarded to you'
              : 'Approval escalated to you',
        body: `${request.referenceNo || 'A request'} now needs your action.`,
        severity: input.kind === 'Escalate' ? 'WARNING' : 'INFO',
      });
      request.status = deriveEApprovalStatus(steps) ?? request.status;
      break;
    }

    case 'Add Approver': {
      const targets = (input.targets ?? []).filter(Boolean);
      if (!targets.length) throw new EApprovalRuleError('Choose the approver to add.');
      const primary = primaryEApprovalSteps(steps);
      const nextSequence = primary.find((candidate) => candidate.sequence > step.sequence)?.sequence;
      // A midpoint, so an inserted approver never renumbers a step that already has history.
      const sequence = nextSequence != null ? (step.sequence + nextSequence) / 2 : step.sequence + 1;
      const groupId = nextId('grp-added');
      targets.forEach((assignment) => {
        steps.push({
          id: nextId('step-added'),
          approvalId: step.approvalId,
          type: 'APPROVAL',
          name: `Approval — ${describeEApprovalAssignment(assignment)}`,
          sequence,
          depth: 0,
          parentStepId: null,
          originStepId: null,
          groupId,
          groupMode: targets.length > 1 ? 'All' : 'Single',
          assignment,
          status: 'Pending',
          outcome: null,
          instruction: input.instruction,
          slaHours: eApprovalStepSla(input.slaHours, request.priority, settings),
          mandatory: true,
          version: request.version,
          escalationsSent: [],
          pausedMs: 0,
        });
      });
      pushEvent({
        ...onBehalfOf,
        kind: 'Add Approver',
        stepId: step.id,
        stepName: step.name,
        stepType: step.type,
        summary: `${targets.map(describeEApprovalAssignment).join(', ')} added to the approval chain by ${actorLabel(actor)}`,
      });
      break;
    }

    case 'Reject': {
      if (!input.reason && !input.comment) {
        throw new EApprovalRuleError('A reason is required to reject an approval.');
      }
      completeStep(step, 'Rejected', actor, now, input.comment);
      steps.forEach((candidate) => {
        if (candidate.id !== step.id && isOpenEApprovalStepStatus(candidate.status)) {
          candidate.status = 'Cancelled';
          candidate.outcome = 'Cancelled';
          candidate.completedAt = now;
        }
      });
      request.status = 'Rejected';
      request.completedAt = now;
      request.rejectionReason = input.reason ?? input.comment;
      pushEvent({
        ...onBehalfOf,
        kind: 'Reject',
        stepId: step.id,
        stepName: step.name,
        stepType: step.type,
        outcome: 'Rejected',
        reason: input.reason,
        comment: input.comment,
        summary: `Rejected by ${actorLabel(actor)} at "${step.name}" — ${input.reason || input.comment}`,
      });
      notifications.push({
        kind: 'Rejected',
        userIds: [request.requesterId],
        title: 'Approval rejected',
        body: `${request.referenceNo || 'Your request'} was rejected by ${actorLabel(actor)}: ${
          input.reason || input.comment || 'see comments'
        }`,
        severity: 'WARNING',
      });
      break;
    }

    case 'Hold': {
      pauseStep(step, 'On Hold', now);
      request.status = 'On Hold';
      request.holdReason = input.reason ?? input.comment;
      pushEvent({
        ...onBehalfOf,
        kind: 'Hold',
        stepId: step.id,
        stepName: step.name,
        stepType: step.type,
        reason: input.reason,
        comment: input.comment,
        summary: `Put on hold by ${actorLabel(actor)}${input.reason ? ` — ${input.reason}` : ''}`,
      });
      notifications.push({
        kind: 'On Hold',
        userIds: [request.requesterId],
        title: 'Approval on hold',
        body: `${request.referenceNo || 'Your request'} was put on hold by ${actorLabel(actor)}.`,
        severity: 'WARNING',
      });
      break;
    }

    default:
      throw new EApprovalRuleError(`Unsupported action "${input.kind}".`);
  }

  refreshPointers(request, steps);
  return { request, steps, events, notifications };
}

/* ------------------------------------------------------------------------------------------------
 * Timeline, dashboard and inbox selectors (spec sections 14, 17)
 * ---------------------------------------------------------------------------------------------- */

export interface EApprovalTimelineNode {
  step: EApprovalStepRecord;
  /** Indentation level in the timeline — the verification stack, visually. */
  depth: number;
  children: EApprovalTimelineNode[];
  sla: EApprovalSlaState;
  label: string;
  assigneeLabel: string;
}

/**
 * The step list as the nested timeline of spec section 17.
 *
 * Primary steps in chain order, each carrying its verification children in the order they were
 * raised, so the returning arrows in the spec's diagram are just the tree read depth-first.
 */
export function eApprovalTimeline(
  steps: EApprovalStepRecord[],
  now: string | Date = new Date(),
): EApprovalTimelineNode[] {
  const build = (step: EApprovalStepRecord): EApprovalTimelineNode => ({
    step,
    depth: step.depth,
    sla: eApprovalSlaState(step, now),
    label: step.name,
    assigneeLabel: describeEApprovalAssignment(step.assignment),
    children: eApprovalChildren(steps, step.id)
      .sort((a, b) => (millis(a.startedAt) ?? 0) - (millis(b.startedAt) ?? 0))
      .map(build),
  });
  return primaryEApprovalSteps(steps).map(build);
}

/** The dashboard cards of spec section 14. */
export interface EApprovalDashboardCounts {
  pendingApprovals: number;
  verificationTasks: number;
  clarifications: number;
  returnedToMe: number;
  createdByMe: number;
  approvedThisMonth: number;
  overdue: number;
  drafts: number;
  onHold: number;
}

/** The minimum a row must carry to be counted — satisfied by the Firestore request document. */
export interface EApprovalInboxRow {
  id: string;
  status: EApprovalStatus | string;
  requesterId: string;
  currentAssigneeIds?: string[];
  currentDepartmentIds?: string[];
  currentRoles?: string[];
  currentDueAt?: string | null;
  completedAt?: string | null;
  /** Type of the step currently pending, so one query can fill three cards. */
  currentStepType?: EApprovalStepType | null;
  returnedByStepId?: string | null;
}

const rowIsWithActor = (row: EApprovalInboxRow, actor: EApprovalActor): boolean => {
  if ((row.currentAssigneeIds ?? []).includes(actor.userId)) return true;
  const departments = actorDepartments(actor);
  if ((row.currentDepartmentIds ?? []).some((id) => departments.includes(id))) return true;
  if (actor.role && (row.currentRoles ?? []).includes(actor.role)) return true;
  return false;
};

/**
 * Counts for the dashboard, computed from rows the caller has already fetched.
 *
 * Counted client-side from one "open requests I am involved in" query rather than as nine separate
 * `getCountFromServer` calls, because the nine would disagree with each other — a file that moves
 * between two of the queries is counted twice or not at all, and the dashboard that is supposed to
 * answer "what do I owe" stops being trusted.
 */
export function summarizeEApprovalDashboard(
  rows: EApprovalInboxRow[],
  actor: EApprovalActor,
  now: string | Date = new Date(),
): EApprovalDashboardCounts {
  const nowMs = millis(now) ?? Date.now();
  const monthStart = new Date(nowMs);
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const counts: EApprovalDashboardCounts = {
    pendingApprovals: 0,
    verificationTasks: 0,
    clarifications: 0,
    returnedToMe: 0,
    createdByMe: 0,
    approvedThisMonth: 0,
    overdue: 0,
    drafts: 0,
    onHold: 0,
  };

  for (const row of rows) {
    const mine = row.requesterId === actor.userId;
    if (mine) {
      counts.createdByMe += 1;
      if (row.status === 'Draft') counts.drafts += 1;
      if (row.status === 'Returned' && (row.currentAssigneeIds ?? []).includes(actor.userId)) {
        counts.returnedToMe += 1;
      }
    }
    if (row.status === 'Approved') {
      const completed = millis(row.completedAt);
      if (completed != null && completed >= monthStart.getTime()) counts.approvedThisMonth += 1;
    }
    if (!isOpenEApprovalStatus(row.status)) continue;
    if (!rowIsWithActor(row, actor)) continue;

    if (row.status === 'On Hold') counts.onHold += 1;
    if (row.currentStepType === 'VERIFICATION' || row.currentStepType === 'REVIEW') counts.verificationTasks += 1;
    else if (row.currentStepType === 'CLARIFICATION') counts.clarifications += 1;
    else if (row.status !== 'Returned') counts.pendingApprovals += 1;

    if (row.status === 'Returned' && !mine) counts.returnedToMe += 1;

    const due = millis(row.currentDueAt);
    if (due != null && due < nowMs) counts.overdue += 1;
  }

  return counts;
}

/** Ageing buckets for the register and the reports of spec section 33. */
export function eApprovalAgeingBucket(
  pendingSince: string | Date | null | undefined,
  now: string | Date = new Date(),
): '0-1 day' | '2-3 days' | '4-7 days' | '8-15 days' | '15+ days' | '—' {
  const start = millis(pendingSince);
  const nowMs = millis(now) ?? Date.now();
  if (start == null) return '—';
  const days = Math.floor((nowMs - start) / 86_400_000);
  if (days <= 1) return '0-1 day';
  if (days <= 3) return '2-3 days';
  if (days <= 7) return '4-7 days';
  if (days <= 15) return '8-15 days';
  return '15+ days';
}

/* ------------------------------------------------------------------------------------------------
 * Seed templates (spec section 12)
 * ---------------------------------------------------------------------------------------------- */

/**
 * The three example chains from the spec, shipped as seeds so a new organisation has something to
 * route against before anyone opens the workflow builder. Assignments are left as roles rather than
 * user ids — a seed that names people would be wrong in every organisation but the one it was
 * written in.
 */
export const SEED_E_APPROVAL_TEMPLATES: EApprovalTemplate[] = [
  {
    id: 'seed-purchase',
    name: 'Purchase Approval',
    description: 'Department HOD → Purchase → Finance verification → Director → ED',
    steps: [
      { id: 's1', name: 'Department HOD', assignments: [{ kind: 'Role', role: 'HOD' }], slaHours: 24 },
      { id: 's2', name: 'Purchase', assignments: [{ kind: 'Role', role: 'Purchase Head' }], slaHours: 24 },
      {
        id: 's3',
        name: 'Finance Verification',
        type: 'REVIEW',
        assignments: [{ kind: 'Role', role: 'Finance Manager' }],
        slaHours: 24,
      },
      { id: 's4', name: 'Director', assignments: [{ kind: 'Role', role: 'Director' }], slaHours: 48 },
      {
        id: 's5',
        name: 'ED',
        assignments: [{ kind: 'Role', role: 'ED' }],
        slaHours: 48,
        capabilities: { canFinalise: true },
      },
    ],
  },
  {
    id: 'seed-leave-exception',
    name: 'Leave Exception',
    description: 'Reporting Manager → HR → Director',
    steps: [
      { id: 's1', name: 'Reporting Manager', assignments: [{ kind: 'Role', role: 'Reporting Manager' }], slaHours: 24 },
      { id: 's2', name: 'HR', assignments: [{ kind: 'Role', role: 'HR Manager' }], slaHours: 24 },
      {
        id: 's3',
        name: 'Director',
        assignments: [{ kind: 'Role', role: 'Director' }],
        slaHours: 48,
        capabilities: { canFinalise: true },
      },
    ],
  },
  {
    id: 'seed-site-expense',
    name: 'Site Expense',
    description: 'Site In-Charge → Project Manager → Accounts → Finance',
    steps: [
      { id: 's1', name: 'Site In-Charge', assignments: [{ kind: 'Role', role: 'Site In-Charge' }], slaHours: 24 },
      { id: 's2', name: 'Project Manager', assignments: [{ kind: 'Role', role: 'Project Manager' }], slaHours: 24 },
      { id: 's3', name: 'Accounts', assignments: [{ kind: 'Role', role: 'Accounts Executive' }], slaHours: 24 },
      {
        id: 's4',
        name: 'Finance',
        assignments: [{ kind: 'Role', role: 'Finance Manager' }],
        slaHours: 24,
        capabilities: { canFinalise: true },
      },
    ],
  },
];

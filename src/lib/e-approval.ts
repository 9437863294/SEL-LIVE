import type { Timestamp } from 'firebase/firestore';
import {
  DEFAULT_E_APPROVAL_ESCALATION_LADDER,
  DEFAULT_E_APPROVAL_SETTINGS,
  type EApprovalAssignment,
  type EApprovalDepartmentMode,
  type EApprovalEvent,
  type EApprovalMaterialSnapshot,
  type EApprovalPriority,
  type EApprovalSettings,
  type EApprovalStatus,
  type EApprovalStepRecord,
  type EApprovalStepType,
  type EApprovalTemplateStep,
} from './e-approval-policy';

/**
 * Data model for the E-Approval / E-Notesheet module (`docs/e-approval.md`).
 *
 * The rules — the verification stack, return-to-any-step, supersede-on-material-change, the approval
 * matrix, SLA and escalation — live in `e-approval-policy.ts`, which is dependency-free so it runs in
 * the browser, on mobile and in Admin-SDK cron routes, and stays unit-testable. It is re-exported
 * from here so every consumer imports the module from one place, exactly as `hr-requirement.ts`
 * re-exports its policy module.
 *
 * Five structural decisions are worth knowing before reading the interfaces:
 *
 *   1. **Steps are their own collection, not an array on the request.** "Everything pending with me"
 *      has to be one indexed query across every open request — it is the module's most-hit screen —
 *      and an array field cannot be indexed that way. The request carries denormalised
 *      `currentAssigneeIds` / `currentDueAt` pointers so the inbox and the overdue list are single
 *      queries; the step documents remain the source of truth.
 *
 *   2. **Engine dates are ISO strings, audit stamps are Timestamps.** The engine has to run under
 *      Node with no Firebase installed, so anything it reads or writes (`startedAt`, `dueAt`,
 *      `pausedAt`) is a plain ISO string. The six shared `createdAt`/`updatedBy`-style stamps stay
 *      Timestamps, written by `withCreateAudit`, so this module's records sort and render like every
 *      other module's.
 *
 *   3. **History, comments and attachments are append-only.** Nothing in the workflow ever updates a
 *      history row, and a comment edit writes a new entry into `editHistory` rather than replacing
 *      the text (spec section 7). An approval whose trail can be rewritten is not an approval.
 *
 *   4. **A new version does not mean a new request.** A material change bumps `version`, snapshots
 *      the old content into `eApprovalVersions` and supersedes the approvals given against it — the
 *      reference number, the comment thread and the attachments all stay put (spec section 6).
 *
 *   5. **Three collections the spec lists are deliberately absent.** `approvalTasks` is the step
 *      collection — a task *is* a step, and keeping both would mean keeping them in step.
 *      `approvalNotifications` is the existing central `userNotifications` (see `@/lib/notifications`),
 *      so the bell in the header shows approvals alongside everything else. `approvalPermissions` is
 *      the existing role system in `@/lib/permissions`, which already resolves nested resources.
 */

export * from './e-approval-policy';

export const E_APPROVAL_COLLECTIONS = {
  requests: 'eApprovalRequests',
  steps: 'eApprovalSteps',
  comments: 'eApprovalComments',
  attachments: 'eApprovalAttachments',
  history: 'eApprovalHistory',
  versions: 'eApprovalVersions',

  types: 'eApprovalTypes',
  templates: 'eApprovalTemplates',
  rules: 'eApprovalRules',
  delegations: 'eApprovalDelegations',

  departmentRouting: 'eApprovalDepartmentRouting',
  settings: 'eApprovalSettings',
  counters: 'eApprovalCounters',
} as const;

export const E_APPROVAL_PERMISSION_RESOURCE = 'E-Approval';
export const E_APPROVAL_ACTIVITY_MODULE = 'E-Approval';
export const E_APPROVAL_BASE_PATH = '/e-approval';
export const E_APPROVAL_STORAGE_PREFIX = 'e-approval';

/** Every record in the module carries these, so the audit strip renders the same everywhere. */
export interface EApprovalAuditFields {
  createdAt?: Timestamp | null;
  createdBy?: string;
  createdByName?: string;
  updatedAt?: Timestamp | null;
  updatedBy?: string;
  updatedByName?: string;
}

/* ------------------------------------------------------------------------------------------------
 * Requests (spec sections 1, 15, 29)
 * ---------------------------------------------------------------------------------------------- */

export interface EApprovalRequest extends EApprovalAuditFields {
  id: string;
  organizationId?: string;
  referenceNo?: string;

  /* Basic information (spec section 15) */
  subject: string;
  body: string;
  approvalTypeId?: string;
  approvalTypeName?: string;
  departmentId?: string;
  departmentName?: string;
  projectId?: string;
  projectName?: string;
  /** The requester's own reference — a PO number, an indent number, a letter number. */
  externalRef?: string;
  priority: EApprovalPriority;
  requiredBy?: string | null;

  /* Financial information — optional, because most note-sheets are not money */
  amount?: number;
  currency?: string;
  vendorId?: string;
  vendorName?: string;
  costCentre?: string;
  budgetHead?: string;

  /* Requester */
  requesterId: string;
  requesterName?: string;
  requesterDesignation?: string;
  requesterDepartmentId?: string;

  /* Visibility (spec sections 15 and 26) */
  confidential?: boolean;
  ccUserIds?: string[];
  ccDepartmentIds?: string[];
  participantUserIds?: string[];

  /* Workflow state — maintained by the engine, denormalised for querying */
  status: EApprovalStatus;
  version: number;
  templateId?: string;
  ruleId?: string;
  /** Approvers named on the form. Persisted with the draft, because the chain is only built at
   * submission — and by then the form is gone. */
  adHocSteps?: EApprovalTemplateStep[];
  currentStepIds?: string[];
  currentAssigneeIds?: string[];
  currentDepartmentIds?: string[];
  currentRoles?: string[];
  /** Type of the step currently pending, so the three inbox cards are one query. */
  currentStepType?: EApprovalStepType | null;
  currentStepName?: string;
  currentDueAt?: string | null;
  pendingLabel?: string;
  submittedAt?: string | null;
  completedAt?: string | null;

  /* Change control (spec section 6) */
  materialFingerprint?: string;
  supersededCount?: number;

  /* Reasons, kept on the request so a register row can explain itself without a history read */
  returnResumeStepId?: string | null;
  returnedByStepId?: string | null;
  returnReason?: string;
  holdReason?: string;
  rejectionReason?: string;
  cancelReason?: string;

  attachmentCount?: number;
  commentCount?: number;
  isDeleted?: boolean;
}

/** The fields a create/edit form owns. Everything else is the engine's. */
export type EApprovalRequestDraft = Pick<
  EApprovalRequest,
  | 'subject'
  | 'body'
  | 'approvalTypeId'
  | 'approvalTypeName'
  | 'departmentId'
  | 'departmentName'
  | 'projectId'
  | 'projectName'
  | 'externalRef'
  | 'priority'
  | 'requiredBy'
  | 'amount'
  | 'currency'
  | 'vendorId'
  | 'vendorName'
  | 'costCentre'
  | 'budgetHead'
  | 'confidential'
  | 'ccUserIds'
  | 'ccDepartmentIds'
> & {
  /** Ad-hoc routing: chosen on the form when no template or matrix rule applies (spec section 12). */
  adHocSteps?: EApprovalTemplateStep[];
  templateId?: string;
};

/** A step document: the engine's record plus what Firestore needs to find it. */
export interface EApprovalStep extends EApprovalStepRecord, EApprovalAuditFields {
  approvalId: string;
  organizationId?: string;
  /** Denormalised from the request, so a step query can render an inbox row without a join. */
  referenceNo?: string;
  subject?: string;
  requesterId?: string;
  priority?: EApprovalPriority;
  amount?: number;
}

/* ------------------------------------------------------------------------------------------------
 * History, comments, attachments, versions (spec sections 7, 8, 20)
 * ---------------------------------------------------------------------------------------------- */

export interface EApprovalHistoryEntry extends EApprovalEvent {
  id: string;
  approvalId: string;
  organizationId?: string;
  /** Wall-clock stamp alongside the engine's ISO `at`, for ordering with other modules' logs. */
  recordedAt?: Timestamp | null;
  /**
   * Denormalised from the request at write time — not read from it — so "everything I have done"
   * (spec: My Activity) is one query across every approval rather than one read per approval an
   * entry belongs to. Absent on entries written before this field existed; screens fall back to the
   * reference-only link in that case rather than a blank title.
   */
  referenceNo?: string;
  subject?: string;
  requesterId?: string;
  requesterName?: string;
  departmentName?: string;
}

export interface EApprovalCommentEdit {
  at: string;
  byUserId: string;
  byName?: string;
  previousBody: string;
}

export interface EApprovalComment extends EApprovalAuditFields {
  id: string;
  approvalId: string;
  organizationId?: string;
  /** The step the comment was made against, so the timeline can show it in place. */
  stepId?: string | null;
  stepName?: string;
  /** Set on a reply (spec section 7). One level of threading, which is what a note-sheet needs. */
  parentCommentId?: string | null;
  body: string;
  /** User ids @-mentioned, resolved at write time so notification does not re-parse the text. */
  mentionUserIds?: string[];
  attachmentIds?: string[];
  authorId: string;
  authorName?: string;
  authorDesignation?: string;
  /** Version of the request the comment was made against. */
  version?: number;
  /** Appended to on every edit; the current `body` is the latest. Never deleted (spec section 7). */
  editHistory?: EApprovalCommentEdit[];
  /** A retracted comment is struck through, not removed — the trail has to stay complete. */
  retracted?: boolean;
  retractedReason?: string;
}

export interface EApprovalAttachment extends EApprovalAuditFields {
  id: string;
  approvalId: string;
  organizationId?: string;
  name: string;
  url: string;
  storagePath: string;
  contentType?: string;
  size?: number;
  /** Which step it was uploaded at — creation, verification, return, final approval (spec section 8). */
  stepId?: string | null;
  stepName?: string;
  /** Request version at upload time, so a superseded quotation stays tied to the figure it priced. */
  version?: number;
  description?: string;
  uploadedById: string;
  uploadedByName?: string;
  uploadedAt?: string;
  /** Points at the attachment this one replaces. The original is never overwritten (spec section 8). */
  supersedesAttachmentId?: string | null;
}

/** A frozen snapshot of the content a set of approvals was given against (spec section 6). */
export interface EApprovalVersionRecord extends EApprovalAuditFields {
  id: string;
  approvalId: string;
  organizationId?: string;
  version: number;
  snapshot: EApprovalMaterialSnapshot & { subject?: string; body?: string; amount?: number };
  fingerprint: string;
  supersededAt?: string;
  supersededReason?: string;
  /** Who had approved under this version when it was superseded, for the versions tab. */
  approvals?: Array<{ stepName: string; assignee: string; outcome: string; at?: string | null }>;
}

/* ------------------------------------------------------------------------------------------------
 * Configuration (spec sections 12, 13, 23, 27)
 * ---------------------------------------------------------------------------------------------- */

export interface EApprovalType extends EApprovalAuditFields {
  id: string;
  organizationId?: string;
  name: string;
  /** Used in the reference number when department codes are switched off. */
  code?: string;
  description?: string;
  /** Whether the amount field is shown and required. */
  requiresAmount?: boolean;
  /** Whether a file of this type is confidential unless explicitly opened up. */
  confidentialByDefault?: boolean;
  defaultTemplateId?: string;
  defaultSlaHours?: number;
  /** Restricts who may raise this type. Empty means everybody with Create. */
  allowedRoles?: string[];
  active?: boolean;
  sortOrder?: number;
}

export interface EApprovalTemplateRecord extends EApprovalAuditFields {
  id: string;
  organizationId?: string;
  name: string;
  approvalTypeId?: string;
  departmentId?: string;
  description?: string;
  steps: EApprovalTemplateStep[];
  active?: boolean;
}

export interface EApprovalRuleRecord extends EApprovalAuditFields {
  id: string;
  organizationId?: string;
  name?: string;
  approvalTypeId?: string;
  departmentId?: string;
  projectId?: string;
  minAmount?: number | null;
  maxAmount?: number | null;
  templateId?: string;
  steps?: EApprovalTemplateStep[];
  priority?: number;
  active?: boolean;
}

/**
 * Who a department-assigned step actually reaches (spec sections 11 and 33).
 *
 * Membership is configured here rather than read off the user record because this codebase has no
 * user→department field: department scope is expressed through permission scopes, and employees are
 * a separate collection keyed by name. An explicit routing document per department makes "who is in
 * Finance for approval purposes" a stated fact an administrator owns, which is also what makes
 * `mode: 'Anyone'` safe — an unbounded department is otherwise an unbounded approval authority.
 */
export interface EApprovalDepartmentRouting extends EApprovalAuditFields {
  /** The document id is the department id, so a lookup is a get rather than a query. */
  id: string;
  organizationId?: string;
  departmentId: string;
  departmentName?: string;
  /** Overrides the code derived from the name in reference numbers (spec section 24). */
  approvalCode?: string;
  mode: EApprovalDepartmentMode;
  headUserId?: string;
  headUserName?: string;
  memberUserIds?: string[];
  active?: boolean;
}

export interface EApprovalDelegationRecord extends EApprovalAuditFields {
  id: string;
  organizationId?: string;
  fromUserId: string;
  fromUserName?: string;
  toUserId: string;
  toUserName?: string;
  fromDate: string;
  toDate?: string | null;
  reason?: string;
  approvalTypeIds?: string[];
  active?: boolean;
}

export interface EApprovalSettingsRecord extends EApprovalSettings, EApprovalAuditFields {
  id?: string;
  organizationId?: string;
}

/**
 * Settings as a new organisation starts with them.
 *
 * The escalation ladder is filled in here rather than left empty in the policy default, so reminders
 * work out of the box — a module whose SLA does nothing until somebody configures it is a module
 * whose SLA does nothing.
 */
export const DEFAULT_E_APPROVAL_SETTINGS_RECORD: EApprovalSettingsRecord = {
  ...DEFAULT_E_APPROVAL_SETTINGS,
  escalationLadder: DEFAULT_E_APPROVAL_ESCALATION_LADDER,
};

/* ------------------------------------------------------------------------------------------------
 * View models shared by the screens
 * ---------------------------------------------------------------------------------------------- */

/** A request plus everything the detail screen renders (spec sections 16–17). */
export interface EApprovalDetail {
  request: EApprovalRequest;
  steps: EApprovalStep[];
  history: EApprovalHistoryEntry[];
  comments: EApprovalComment[];
  attachments: EApprovalAttachment[];
  versions: EApprovalVersionRecord[];
}

/** One row of the register and the inbox tables. */
export interface EApprovalRow {
  id: string;
  referenceNo?: string;
  subject: string;
  status: EApprovalStatus;
  priority: EApprovalPriority;
  requesterId: string;
  requesterName?: string;
  departmentName?: string;
  projectName?: string;
  amount?: number;
  pendingLabel?: string;
  currentDueAt?: string | null;
  currentStepType?: EApprovalStepType | null;
  currentStepName?: string;
  currentAssigneeIds?: string[];
  currentDepartmentIds?: string[];
  currentRoles?: string[];
  submittedAt?: string | null;
  completedAt?: string | null;
  confidential?: boolean;
  version?: number;
}

/** What the action dialogs hand back to the service. */
export interface EApprovalActionForm {
  comment?: string;
  instruction?: string;
  reason?: string;
  targets?: EApprovalAssignment[];
  returnTo?: string;
  outcome?: string;
  slaHours?: number;
  participantUserIds?: string[];
  /** Files chosen in the dialog, uploaded before the transition is applied. */
  files?: File[];
}

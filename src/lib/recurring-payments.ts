import type { Timestamp } from 'firebase/firestore';
import type { RecurrenceRuleInput, RecurringCycle } from './recurring-payments-schedule';

export { loadWorkingCalendar } from './working-hours-client';
// The schedule math lives in its own dependency-free module (see recurring-payments-schedule.ts)
// but stays reachable from here, so every consumer keeps importing the module from one place.
export {
  actionableRecurringCycle,
  BILL_DATE_RULES,
  buildRecurringCycle,
  buildRecurringCycleSchedule,
  describeRecurrence,
  DUE_DATE_RULES,
  normalizeDueDateRule,
  pendingRecurringCycles,
  recurrenceLeadDays,
  recurringDateOnly,
  type BillDateRule,
  type DueDateRule,
  type LegacyDueDateRule,
  type RecurrenceFrequency,
  type RecurrenceOptions,
  type RecurrenceRuleInput,
  type RecurringCycle,
} from './recurring-payments-schedule';
// Workflow assignment/activation also lives in its own dependency-free module (see
// recurring-payments-workflow.ts) so it can be unit-tested, but stays reachable from here.
export {
  isWorkflowActivationDue,
  RECURRING_DATA_ENTRY_ACTIONS,
  RECURRING_FORWARD_ACTIONS,
  recurringMirrorAction,
  recurringMirrorMode,
  resolveAssignees,
  resolveEntryAssignees,
  resolveWorkflowActivation,
  routeRecurringWorkflow,
  stepStatus,
  type ActivationTimingPayment,
  type AssigneeResolutionPayment,
  type RouteRecurringWorkflowInput,
  type RouteRecurringWorkflowResult,
  type RoutingPayment,
  type WorkflowActivation,
} from './recurring-payments-workflow';

export const RP_COLLECTIONS = {
  masters: 'recurringPaymentMasters',
  payments: 'paymentObligations',
  vendors: 'recurringPaymentVendors',
  categories: 'recurringPaymentCategories',
  approvalRules: 'recurringPaymentApprovalRules',
  notificationRules: 'recurringPaymentNotificationRules',
  notificationQueue: 'recurringPaymentNotificationQueue',
  settings: 'recurringPaymentSettings',
  transactions: 'transactions',
  auditLogs: 'auditLogs',
  comments: 'comments',
  documents: 'documents',
  approvals: 'approvals',
  automationLogs: 'recurringPaymentAutomationLogs',
} as const;

export type PaymentMode = 'NEFT' | 'RTGS' | 'IMPS' | 'UPI' | 'Cheque' | 'Cash' | 'Credit Card' | 'Auto-debit' | 'Bank Transfer' | 'Other';

export const PAYMENT_MODES: PaymentMode[] = ['NEFT', 'RTGS', 'IMPS', 'UPI', 'Cheque', 'Cash', 'Credit Card', 'Auto-debit', 'Bank Transfer', 'Other'];
/** Modes where a bank account/UTR is actually meaningful — a cash payment has neither. Shared by
 * the "Record Payment" workflow action and the transaction edit dialog so both agree on which
 * fields a given mode requires. */
export const BANK_ACCOUNT_REQUIRED_MODES: PaymentMode[] = ['NEFT', 'RTGS', 'IMPS', 'UPI', 'Auto-debit', 'Bank Transfer'];

export interface PaymentTransaction {
  id: string;
  organizationId: string;
  paymentId: string;
  paymentDate: string;
  amount: number;
  mode: PaymentMode;
  bankAccount: string;
  transactionReference: string;
  chequeNumber?: string;
  tdsAmount: number;
  gstAmount: number;
  deductionAmount: number;
  adjustmentAmount: number;
  remarks?: string;
  receiptUrl?: string;
  paidBy: string;
  paidByName: string;
  createdAt: Timestamp;
}

export interface RecurringPaymentAuditLog {
  id: string;
  organizationId: string;
  paymentId: string;
  action: string;
  summary: string;
  userId: string;
  userName: string;
  metadata?: Record<string, unknown>;
  createdAt: Timestamp;
}

export interface ApprovalRule {
  id: string;
  organizationId: string;
  name: string;
  minAmount: number;
  maxAmount: number | null;
  category: string;
  project: string;
  mode: 'Sequential' | 'Parallel';
  approvers: string[];
  finalAccountsVerification: boolean;
  active: boolean;
}

export interface RecurringAmountAssignee {
  id: string;
  minAmount: number;
  maxAmount: number | null;
  userId: string;
  alternativeUserId?: string;
}

export interface RecurringWorkflowStep {
  id: string;
  name: string;
  description: string;
  tat: number;
  assignmentType: 'Payment-owner' | 'User-based' | 'Amount-based';
  assignedTo: string[] | RecurringAmountAssignee[];
  actions: string[];
  uploadRequired: boolean;
}

export interface RecurringWorkflowHistoryEntry {
  action: string;
  comment: string;
  userId: string;
  userName: string;
  stepId: string;
  stepName: string;
  timestamp: Timestamp;
}

export const DEFAULT_RECURRING_WORKFLOW: RecurringWorkflowStep[] = [
  { id: '1', name: 'Bill Collection', description: 'Collect the bill, confirm the billing period and enter the final amount.', tat: 24, assignmentType: 'Payment-owner', assignedTo: [], actions: ['Submit Bill', 'Dispute', 'On Hold'], uploadRequired: true },
  { id: '2', name: 'Bill Verification', description: 'Verify vendor, account, amount, taxes and supporting bill details.', tat: 16, assignmentType: 'User-based', assignedTo: [], actions: ['Verify', 'Return for Correction', 'Reject'], uploadRequired: false },
  { id: '3', name: 'Payment Approval', description: 'Approve the verified bill under the applicable approval rule.', tat: 8, assignmentType: 'Amount-based', assignedTo: [], actions: ['Approve', 'Return for Correction', 'Reject', 'On Hold'], uploadRequired: false },
  { id: '4', name: 'Payment Processing', description: 'Process the payment and record the date, paid amount and transaction reference.', tat: 8, assignmentType: 'User-based', assignedTo: [], actions: ['Record Payment', 'Payment Failed', 'On Hold'], uploadRequired: false },
  { id: '5', name: 'Receipt & Closure', description: 'Verify payment proof and close the obligation.', tat: 8, assignmentType: 'User-based', assignedTo: [], actions: ['Close', 'Return for Correction'], uploadRequired: true },
];

export interface RecurringPaymentSettings {
  organizationId: string;
  organizationName: string;
  notifications: {
    inApp: boolean;
    email: boolean;
    push: boolean;
    sms: boolean;
    daysBefore: number[];
    daysAfter: number[];
    dailyOverdueEscalation: boolean;
    recipients: string[];
  };
  automation: {
    enabled: boolean;
    workflowActivationDays: number;
    timezone: string;
    retryFailedNotifications: boolean;
  };
  controls: {
    lockClosedPayments: boolean;
    requireBillBeforeApproval: boolean;
    requireTransactionReference: boolean;
    allowAuthorizedReopen: boolean;
    varianceWarningPercent: number;
  };
  eApproval: RecurringEApprovalSettings;
}

/**
 * Whether — and how — a payment's workflow is mirrored into the E-Approval module.
 *
 * Off by default, and every field below only matters once it is on: with `enabled: false` nothing in
 * this module reads or writes an approval request, and E-Approval never sees a payment. That is the
 * point. The two modules were built to stand alone and must keep standing alone, so the bridge is an
 * addition an organization opts into rather than a coupling it inherits.
 */
export interface RecurringEApprovalSettings {
  enabled: boolean;
  /**
   * Which steps raise a mirrored stage. 'All' mirrors the whole workflow, so a payment is one file in
   * E-Approval from bill collection to closure; 'Decision' mirrors only the steps that can actually
   * be decided there (see `recurringMirrorMode`), leaving data-entry steps out of the chain entirely.
   */
  scope: 'All' | 'Decision';
  /** Raise nothing below this figure — small recurring bills do not need a note-sheet. 0 mirrors everything. */
  minAmount: number;
  /** The E-Approval type mirrored requests are raised under. Blank raises them under no type. */
  approvalTypeId: string;
  approvalTypeName: string;
  /**
   * Mark mirrored requests confidential, so only their participants and users with confidential
   * access can open them — for organizations that treat vendor pricing that way.
   */
  confidential: boolean;
}

export const DEFAULT_RECURRING_E_APPROVAL_SETTINGS: RecurringEApprovalSettings = {
  enabled: false,
  scope: 'All',
  minAmount: 0,
  approvalTypeId: '',
  approvalTypeName: '',
  confidential: false,
};

export const DEFAULT_RECURRING_PAYMENT_SETTINGS: RecurringPaymentSettings = {
  organizationId: 'default',
  organizationName: 'Default Organization',
  notifications: {
    inApp: true, email: true, push: false, sms: false,
    daysBefore: [7, 3, 1, 0], daysAfter: [1], dailyOverdueEscalation: true,
    recipients: ['Assigned Employee', 'Accounts Team'],
  },
  automation: { enabled: true, workflowActivationDays: 7, timezone: 'Asia/Kolkata', retryFailedNotifications: true },
  controls: {
    lockClosedPayments: true, requireBillBeforeApproval: true,
    requireTransactionReference: true, allowAuthorizedReopen: false,
    varianceWarningPercent: 20,
  },
  eApproval: DEFAULT_RECURRING_E_APPROVAL_SETTINGS,
};

/**
 * A stored settings document merged over the defaults, field group by field group.
 *
 * Not a plain spread: a document saved before an option existed must resolve that option to its
 * default rather than to `undefined`, and a shallow merge would replace a whole nested group with
 * whatever partial version happens to be stored. Every screen that reads these settings goes through
 * here, so a new group cannot be added to the defaults and then silently missed by three of them.
 */
export function mergeRecurringPaymentSettings(
  data: Partial<RecurringPaymentSettings> | undefined,
  organizationId: string,
): RecurringPaymentSettings {
  return {
    ...DEFAULT_RECURRING_PAYMENT_SETTINGS,
    ...(data || {}),
    organizationId,
    notifications: { ...DEFAULT_RECURRING_PAYMENT_SETTINGS.notifications, ...data?.notifications },
    automation: { ...DEFAULT_RECURRING_PAYMENT_SETTINGS.automation, ...data?.automation },
    controls: { ...DEFAULT_RECURRING_PAYMENT_SETTINGS.controls, ...data?.controls },
    eApproval: { ...DEFAULT_RECURRING_E_APPROVAL_SETTINGS, ...data?.eApproval },
  };
}

export const DEFAULT_PAYMENT_CATEGORIES = [
  'Office / Site Rent', 'Electricity', 'Credit Card', 'Mobile / Telephone',
  'Internet / Broadband', 'Water', 'Insurance Premium', 'Vehicle EMI', 'Loan EMI',
  'Software Subscription', 'AMC & Maintenance', 'Security Services', 'Housekeeping',
  'Professional Fees', 'Statutory Payment',
];

export type PaymentStatus = 'Draft' | 'Scheduled' | 'Generated' | 'Awaiting Bill' | 'Bill Received' | 'Under Verification' |
  'Pending Approval' | 'Approved' | 'Payment Processing' | 'Partially Paid' | 'Paid' | 'Closed' |
  'Returned for Correction' | 'Rejected' | 'Disputed' | 'Payment Failed' | 'Paid Receipt Pending' | 'On Hold' | 'Waived' | 'Cancelled' | 'Overdue';

/**
 * Extends `RecurrenceRuleInput` so a master can be handed straight to the schedule functions in
 * `recurring-payments-schedule.ts` — the recurrence fields (`frequency`, `startDate`, `endDate`,
 * `billDateRule`, `dueDay`, `gracePeriodDays`, lead time, …) are declared there, once.
 */
export interface RecurringPaymentMaster extends RecurrenceRuleInput {
  id: string;
  organizationId: string;
  organizationName?: string;
  branchId?: string;
  projectId?: string;
  title: string;
  category: string;
  vendorName: string;
  description?: string;
  accountNumber?: string;
  branchName?: string;
  projectName?: string;
  departmentId?: string;
  department?: string;
  internalReference?: string;
  costCentre?: string;
  ledger?: string;
  budgetHead?: string;
  amountType: 'Fixed' | 'Variable' | 'Estimated';
  amount: number;
  maximumAmount?: number;
  taxAmount?: number;
  tdsApplicable?: boolean;
  gstApplicable?: boolean;
  securityDeposit?: number;
  /** @deprecated Free-text note superseded by `frequency` + `billDateRule`. Kept so saved docs still typecheck. */
  billingCycle?: string;
  /** @deprecated Free-text note superseded by `billDateRule` + `generateLeadDays`. */
  generationDateRule?: string;
  autoGenerationEnabled?: boolean;
  varianceTolerancePercent?: number;
  assignedTo?: string;
  assignedToName?: string;
  backupAssignedTo?: string;
  verifierId?: string;
  approverId?: string;
  accountsProcessorId?: string;
  escalationAuthorityId?: string;
  approvalConfiguration?: 'Default rule' | 'Custom rule' | 'No approval' | 'Bill amount based';
  customApprovalRuleId?: string;
  highVarianceAdditionalApproval?: boolean;
  notificationRuleId?: string;
  reminderRecipients?: string[];
  escalationRecipients?: string[];
  notificationChannels?: string[];
  categoryDetails?: Record<string, string | number | boolean>;
  masterDocuments?: Array<{ reference: string; fileName: string; fileType: string; fileSize: number; documentType: string; uploadedBy: string; uploadedAt: Timestamp; version: number }>;
  status: 'Draft' | 'Active' | 'Inactive' | 'Paused';
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  deleted?: boolean;
}

/**
 * The obligation's half of the mirror (E-Approval's half is `EApprovalRequest.source`).
 *
 * Everything here is denormalised from the approval request so the payment screens can show who the
 * file is with, and link to it, without reading a collection in another module on every row.
 * Refreshed on each sync, so a stale reference is a bug rather than an expected state.
 */
export interface PaymentEApprovalMirror {
  requestId: string;
  referenceNo?: string;
  /** The approval's own status — 'Pending Approval', 'Approved', 'Rejected', … */
  status?: string;
  /**
   * Name of the workflow step the mirror is currently sitting on — "Bill Verification".
   *
   * Kept alongside `status` because the two answer different questions and the payment screens want
   * the second one. E-Approval's status is a statement about the *approval* ('Pending Verification',
   * and 'Approved' the moment its last stage clears); a payment's own vocabulary is the step it is
   * at, and 'Completed' only when the workflow has actually finished. Rendering the approval's word
   * on a payment row reads as though a five-step obligation were done after its first step.
   */
  stageName?: string;
  /** Whether the current stage can be decided in E-Approval, or only viewed there. */
  mode?: 'Decision' | 'Visibility';
  /** Readable "pending with" line, mirrored so a payment row can show it without a join. */
  pendingLabel?: string;
  raisedBy?: string;
  raisedByName?: string;
  raisedAt?: Timestamp;
  syncedAt?: Timestamp;
  /** Set when the mirror was deliberately broken; the payment then runs on its own workflow again. */
  detachedAt?: Timestamp;
  detachedReason?: string;
  /** Last sync failure, kept so a silently-stuck mirror is visible on the payment rather than only in a console. */
  lastError?: string;
}

export interface PaymentObligation {
  id: string;
  organizationId: string;
  masterId: string;
  cycleKey: string;
  branchId?: string;
  branchName?: string;
  projectId?: string;
  projectName?: string;
  departmentId?: string;
  costCentre?: string;
  ledger?: string;
  amountType?: RecurringPaymentMaster['amountType'];
  department?: string;
  description?: string;
  priority?: 'Low' | 'Normal' | 'High' | 'Critical';
  sourceType?: 'Recurring' | 'Manual';
  accountNumber?: string;
  title: string;
  category: string;
  vendorName: string;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  /** When the vendor's bill is expected — distinct from `billDate`, which is the date on the bill actually received. */
  expectedBillDate?: string;
  dueDate: string;
  /** `dueDate` + the master's grace period; the date after which the obligation reads as Overdue. */
  overdueDate?: string;
  expectedAmount: number;
  maximumAmount?: number;
  billAmount?: number;
  paidAmount: number;
  settledAmount?: number;
  outstandingAmount?: number;
  status: PaymentStatus;
  assignedTo?: string;
  backupAssignedTo?: string;
  generatedAutomatically: boolean;
  transactionReference?: string;
  paymentDate?: string;
  expenseRequestNo?: string;
  billNumber?: string;
  billDate?: string;
  billReceivedDate?: string;
  taxAmount?: number;
  tdsAmount?: number;
  deductionAmount?: number;
  adjustmentAmount?: number;
  netPayableAmount?: number;
  approvedAmount?: number;
  verifierId?: string;
  approverId?: string;
  accountsProcessorId?: string;
  variancePercent?: number;
  varianceWarning?: boolean;
  varianceBaseline?: number;
  varianceComparisons?: { previous?: number; average3?: number; average6?: number; estimated?: number; maximum?: number };
  amountLimitExceeded?: boolean;
  approvalRuleId?: string | null;
  approvalMode?: 'Sequential' | 'Parallel' | null;
  approvalLevels?: string[];
  currentApprovalLevel?: number;
  approvalCompletedBy?: string[];
  finalAccountsVerification?: boolean;
  workflowStatus?: 'Scheduled' | 'In Progress' | 'Completed' | 'Rejected';
  stage?: string;
  currentStepId?: string | null;
  assignees?: string[];
  workflowDeadline?: Timestamp | null;
  workflowStartedAt?: Timestamp;
  stepEnteredAt?: Timestamp;
  documentReferences?: Array<{ stepId: string; action: string; reference: string; addedBy: string; addedAt: Timestamp; category?: string; fileType?: string; version?: number }>;
  workflowHistory?: RecurringWorkflowHistoryEntry[];
  /**
   * The E-Approval request mirroring this obligation's workflow, when the bridge is on. Absent on
   * every obligation generated with it off — which is what keeps the module working alone.
   */
  eApproval?: PaymentEApprovalMirror;
  /**
   * Soft-delete marker. An obligation carries financial history — transactions, approvals, an audit
   * trail — so "Delete" hides the record and leaves all of it intact and reportable, exactly as
   * masters already do. Every list and report must filter on this; `visibleObligations` is the one
   * place that decides what "visible" means.
   */
  deleted?: boolean;
  deletedAt?: Timestamp;
  deletedBy?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

/**
 * Drops soft-deleted obligations from a list. Firestore can't filter on a field that most existing
 * documents don't have at all, so this is applied client-side after the snapshot rather than as a
 * `where('deleted', '==', false)` — which would silently match nothing for every record written
 * before the flag existed.
 */
export function visibleObligations<T extends { deleted?: boolean }>(payments: T[]): T[] {
  return payments.filter((payment) => payment.deleted !== true);
}

/** Statuses at which an obligation's own fields may still be corrected in place. */
const EDITABLE_OBLIGATION_STATUSES: PaymentStatus[] = ['Draft', 'Scheduled', 'Generated', 'Awaiting Bill', 'Bill Received', 'Returned for Correction'];

/**
 * Whether an obligation is still open to direct field edits.
 *
 * Editing stops once the payment has been verified or approved: the amount, vendor and period are
 * what somebody signed off on, so changing them afterwards would leave an approval attached to
 * figures that no longer exist. Later corrections go through the workflow ("Return for Correction")
 * or through Cancel/Delete instead.
 *
 * Shared by the edit form's own lock and by every surface that offers an Edit action, so a user is
 * never handed an Edit button that leads to a form refusing to save — the two had already drifted
 * into separate status lists.
 */
export function isObligationEditable(payment: Pick<PaymentObligation, 'status' | 'deleted'>): boolean {
  return payment.deleted !== true && EDITABLE_OBLIGATION_STATUSES.includes(payment.status);
}

export const currency = (value: number) => new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', maximumFractionDigits: 0,
}).format(value || 0);

/**
 * Reads a payment as Overdue once its grace period has also elapsed. `overdueDate` is stamped onto
 * the obligation at generation from the master's grace period; obligations written before grace was
 * honored (and manual payments, which have no master) fall back to the due date itself.
 */
export function effectiveStatus(payment: PaymentObligation): PaymentStatus {
  if (!['Paid', 'Closed', 'Cancelled', 'Waived'].includes(payment.status)) {
    const lastAcceptable = new Date(`${payment.overdueDate || payment.dueDate}T00:00:00`);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (lastAcceptable < today) return 'Overdue';
  }
  return payment.status;
}

export function maskAccount(value?: string) {
  if (!value) return '';
  return value.length <= 4 ? value : `${'•'.repeat(Math.min(8, value.length - 4))}${value.slice(-4)}`;
}

/**
 * Matches a scope filter (a project/department/branch Select driven by a global scope list)
 * against a record that stores the scope both as an id and a denormalized name. Report filters
 * across this module inconsistently matched on name only in some views and id-or-name in others
 * — a scope entity renamed after a payment was generated would silently stop matching wherever
 * the name-only shortcut was used. Every report/filter should go through this instead of
 * re-deriving the comparison inline.
 */
export function matchesScopeFilter(
  filterValue: string,
  record: { id?: string; name?: string },
  entries: Array<{ id: string; name: string }>,
): boolean {
  if (!filterValue || filterValue === 'all') return true;
  if (record.id && record.id === filterValue) return true;
  const selected = entries.find(entry => entry.id === filterValue);
  return !!selected && !!record.name && record.name === selected.name;
}

/**
 * Builds and downloads a CSV file from a header row and data rows. Every recurring-payments
 * report/register reimplemented this same Blob-escaping-anchor sequence independently; centralizing
 * it means a fix (escaping, MIME type, etc.) only has to happen once.
 */
export function downloadCsv(filename: string, header: string[], rows: Array<Array<string | number>>) {
  const csv = [header, ...rows]
    .map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

/**
 * Finds the applicable approval rule for an amount/category/project combination.
 * Shared by manual "generate now" actions (master-form-page, master-detail-page),
 * the automated daily generation route, and manual payment creation so the same
 * payment amount always resolves to the same approval path regardless of where
 * the obligation was created from.
 */
export function matchApprovalRule(
  rules: ApprovalRule[],
  params: { amount: number; category?: string; projectId?: string; projectName?: string },
): ApprovalRule | undefined {
  return rules.find(rule =>
    rule.active &&
    params.amount >= Number(rule.minAmount || 0) &&
    params.amount <= (rule.maxAmount == null ? Number.POSITIVE_INFINITY : Number(rule.maxAmount)) &&
    (!rule.category || rule.category === params.category) &&
    (!rule.project || rule.project === params.projectId || rule.project === params.projectName));
}

export interface GeneratedObligationInput {
  organizationId: string;
  masterId: string;
  cycle: RecurringCycle;
  generatedAutomatically: boolean;
  title: string;
  category: string;
  vendorName: string;
  branchId?: string;
  branchName?: string;
  projectId?: string;
  projectName?: string;
  departmentId?: string;
  department?: string;
  costCentre?: string;
  ledger?: string;
  amountType?: RecurringPaymentMaster['amountType'];
  description?: string;
  accountNumber?: string;
  amount: number;
  maximumAmount?: number;
  assignedTo?: string;
  backupAssignedTo?: string;
  verifierId?: string;
  approverId?: string;
  accountsProcessorId?: string;
  approvalRule?: ApprovalRule;
}

/**
 * Builds the full set of `PaymentObligation` fields generated from a recurring master for a
 * given billing cycle. Used by the manual "generate now" actions and the automated daily
 * generation route so both paths always produce an obligation with the same shape — the
 * caller only needs to add `createdAt`/`updatedAt`, since the client SDK (`serverTimestamp()`)
 * and firebase-admin SDK (`FieldValue.serverTimestamp()`) use different timestamp helpers.
 */
export function buildPaymentObligationFields(input: GeneratedObligationInput) {
  const { cycle, approvalRule } = input;
  return {
    organizationId: input.organizationId,
    masterId: input.masterId,
    cycleKey: `${input.organizationId}_${input.masterId}_${cycle.key}`,
    sourceType: 'Recurring' as const,
    branchId: input.branchId || '',
    branchName: input.branchName || '',
    projectId: input.projectId || '',
    projectName: input.projectName || '',
    departmentId: input.departmentId || '',
    department: input.department || '',
    costCentre: input.costCentre || '',
    ledger: input.ledger || '',
    amountType: input.amountType,
    title: `${input.title} — ${cycle.label}`,
    category: input.category,
    vendorName: input.vendorName,
    description: input.description || '',
    accountNumber: input.accountNumber || '',
    billingPeriodStart: cycle.billingPeriodStart,
    billingPeriodEnd: cycle.billingPeriodEnd,
    expectedBillDate: cycle.expectedBillDate,
    dueDate: cycle.dueDate,
    overdueDate: cycle.overdueDate,
    expectedAmount: input.amount,
    maximumAmount: Number(input.maximumAmount || 0),
    paidAmount: 0,
    settledAmount: 0,
    outstandingAmount: input.amount,
    assignedTo: input.assignedTo || '',
    backupAssignedTo: input.backupAssignedTo || '',
    verifierId: input.verifierId || '',
    approverId: input.approverId || '',
    accountsProcessorId: input.accountsProcessorId || '',
    approvalRuleId: approvalRule?.id || null,
    approvalMode: approvalRule?.mode || null,
    approvalLevels: approvalRule?.approvers || [],
    currentApprovalLevel: approvalRule ? 1 : 0,
    approvalCompletedBy: [] as string[],
    finalAccountsVerification: approvalRule?.finalAccountsVerification !== false,
    status: 'Scheduled' as const,
    workflowStatus: 'Scheduled' as const,
    stage: 'Scheduled',
    currentStepId: null,
    assignees: [] as string[],
    workflowHistory: [] as RecurringWorkflowHistoryEntry[],
    generatedAutomatically: input.generatedAutomatically,
  };
}

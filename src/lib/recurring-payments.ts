import type { Timestamp } from 'firebase/firestore';

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
    generationDay: number;
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
}

export const DEFAULT_RECURRING_PAYMENT_SETTINGS: RecurringPaymentSettings = {
  organizationId: 'default',
  organizationName: 'Default Organization',
  notifications: {
    inApp: true, email: true, push: false, sms: false,
    daysBefore: [7, 3, 1, 0], daysAfter: [1], dailyOverdueEscalation: true,
    recipients: ['Assigned Employee', 'Accounts Team'],
  },
  automation: { enabled: true, generationDay: 1, workflowActivationDays: 7, timezone: 'Asia/Kolkata', retryFailedNotifications: true },
  controls: {
    lockClosedPayments: true, requireBillBeforeApproval: true,
    requireTransactionReference: true, allowAuthorizedReopen: false,
    varianceWarningPercent: 20,
  },
};

export const DEFAULT_PAYMENT_CATEGORIES = [
  'Office / Site Rent', 'Electricity', 'Credit Card', 'Mobile / Telephone',
  'Internet / Broadband', 'Water', 'Insurance Premium', 'Vehicle EMI', 'Loan EMI',
  'Software Subscription', 'AMC & Maintenance', 'Security Services', 'Housekeeping',
  'Professional Fees', 'Statutory Payment',
];

export type PaymentStatus = 'Draft' | 'Scheduled' | 'Generated' | 'Awaiting Bill' | 'Bill Received' | 'Under Verification' |
  'Pending Approval' | 'Approved' | 'Payment Processing' | 'Partially Paid' | 'Paid' | 'Closed' |
  'Returned for Correction' | 'Rejected' | 'Disputed' | 'Payment Failed' | 'Paid Receipt Pending' | 'On Hold' | 'Waived' | 'Cancelled' | 'Overdue';

export interface RecurringPaymentMaster {
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
  frequency: 'Weekly' | 'Monthly' | 'Bi-monthly' | 'Quarterly' | 'Half-yearly' | 'Yearly' | 'Renewable' | 'Custom';
  amountType: 'Fixed' | 'Variable' | 'Estimated';
  amount: number;
  maximumAmount?: number;
  taxAmount?: number;
  tdsApplicable?: boolean;
  gstApplicable?: boolean;
  securityDeposit?: number;
  dueDay: number;
  billingCycle?: string;
  generationDateRule?: string;
  dueDateRule?: 'Fixed day of month' | 'Days after bill date' | 'Days after generation date' | 'Last working day' | 'Custom date logic';
  gracePeriodDays?: number;
  autoGenerationEnabled?: boolean;
  generateBeforeDueDays?: number;
  varianceTolerancePercent?: number;
  startDate: string;
  endDate?: string;
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
  customIntervalDays?: number;
  categoryDetails?: Record<string, string | number | boolean>;
  masterDocuments?: Array<{ reference: string; fileName: string; fileType: string; fileSize: number; documentType: string; uploadedBy: string; uploadedAt: Timestamp; version: number }>;
  status: 'Draft' | 'Active' | 'Inactive' | 'Paused';
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  deleted?: boolean;
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
  dueDate: string;
  expectedAmount: number;
  maximumAmount?: number;
  billAmount?: number;
  paidAmount: number;
  settledAmount?: number;
  outstandingAmount?: number;
  status: PaymentStatus;
  assignedTo?: string;
  generatedAutomatically: boolean;
  transactionReference?: string;
  paymentDate?: string;
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
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface RecurringCycle {
  key: string;
  label: string;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  dueDate: string;
}

const padDatePart = (value: number) => String(value).padStart(2, '0');

export function recurringDateOnly(date: Date) {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

function localDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function isoWeek(date: Date) {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  utc.setUTCDate(utc.getUTCDate() + 4 - (utc.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  return { year: utc.getUTCFullYear(), week: Math.ceil((((utc.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7) };
}

/**
 * Returns the billing cycle containing `asOf`. The cycle key is stable, so both
 * browser and cron generation can safely use organization + master + cycle.
 */
export function buildRecurringCycle(master: Pick<RecurringPaymentMaster, 'frequency' | 'startDate' | 'endDate' | 'dueDay' | 'customIntervalDays'>, asOf = new Date()): RecurringCycle | null {
  const today = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
  const masterStart = localDate(master.startDate);
  const masterEnd = master.endDate ? localDate(master.endDate) : null;
  if (today < masterStart || (masterEnd && today > masterEnd)) return null;

  let nominalStart: Date;
  let nominalEnd: Date;
  let key: string;

  if (master.frequency === 'Weekly') {
    const weekday = today.getDay() || 7;
    nominalStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - weekday + 1);
    nominalEnd = new Date(nominalStart.getFullYear(), nominalStart.getMonth(), nominalStart.getDate() + 6);
    const week = isoWeek(nominalStart);
    key = `${week.year}-W${padDatePart(week.week)}`;
  } else if (master.frequency === 'Renewable') {
    const elapsedMonths = Math.max(0, (today.getFullYear() - masterStart.getFullYear()) * 12 + today.getMonth() - masterStart.getMonth());
    const cycleNumber = Math.floor(elapsedMonths / 12);
    nominalStart = new Date(masterStart.getFullYear() + cycleNumber, masterStart.getMonth(), masterStart.getDate());
    if (today < nominalStart) nominalStart = new Date(nominalStart.getFullYear() - 1, nominalStart.getMonth(), nominalStart.getDate());
    nominalEnd = new Date(nominalStart.getFullYear() + 1, nominalStart.getMonth(), nominalStart.getDate() - 1);
    key = `R${nominalStart.getFullYear()}-${padDatePart(nominalStart.getMonth() + 1)}-${padDatePart(nominalStart.getDate())}`;
  } else if (master.frequency === 'Custom') {
    const interval = Math.max(1, Number(master.customIntervalDays || 30));
    const elapsed = Math.max(0, Math.floor((today.getTime() - masterStart.getTime()) / 86_400_000));
    const cycleNumber = Math.floor(elapsed / interval);
    nominalStart = new Date(masterStart.getFullYear(), masterStart.getMonth(), masterStart.getDate() + cycleNumber * interval);
    nominalEnd = new Date(nominalStart.getFullYear(), nominalStart.getMonth(), nominalStart.getDate() + interval - 1);
    key = `C${String(cycleNumber + 1).padStart(4, '0')}-${recurringDateOnly(nominalStart)}`;
  } else {
    const months = master.frequency === 'Bi-monthly' ? 2 : master.frequency === 'Quarterly' ? 3 : master.frequency === 'Half-yearly' ? 6 : master.frequency === 'Yearly' ? 12 : 1;
    const monthIndex = today.getFullYear() * 12 + today.getMonth();
    const bucket = Math.floor(monthIndex / months) * months;
    nominalStart = new Date(Math.floor(bucket / 12), bucket % 12, 1);
    nominalEnd = new Date(nominalStart.getFullYear(), nominalStart.getMonth() + months, 0);
    const suffix = months === 1 ? '' : `-${months}M`;
    key = `${nominalStart.getFullYear()}-${padDatePart(nominalStart.getMonth() + 1)}${suffix}`;
  }

  const periodStart = nominalStart < masterStart ? masterStart : nominalStart;
  const periodEnd = masterEnd && nominalEnd > masterEnd ? masterEnd : nominalEnd;
  if (periodStart > periodEnd) return null;
  const spanDays = Math.max(1, Math.round((periodEnd.getTime() - periodStart.getTime()) / 86_400_000) + 1);
  const dueOffset = Math.min(spanDays - 1, Math.max(0, Number(master.dueDay || 1) - 1));
  const due = new Date(periodStart.getFullYear(), periodStart.getMonth(), periodStart.getDate() + dueOffset);

  return {
    key,
    label: master.frequency === 'Weekly'
      ? `Week ${isoWeek(nominalStart).week}, ${isoWeek(nominalStart).year}`
      : ['Custom', 'Renewable'].includes(master.frequency)
        ? `${recurringDateOnly(periodStart)} to ${recurringDateOnly(periodEnd)}`
        : nominalStart.toLocaleString('en-IN', { month: 'short', year: 'numeric' }),
    billingPeriodStart: recurringDateOnly(periodStart),
    billingPeriodEnd: recurringDateOnly(periodEnd),
    dueDate: recurringDateOnly(due),
  };
}

export const currency = (value: number) => new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', maximumFractionDigits: 0,
}).format(value || 0);

export function effectiveStatus(payment: PaymentObligation): PaymentStatus {
  if (!['Paid', 'Closed', 'Cancelled', 'Waived'].includes(payment.status)) {
    const due = new Date(`${payment.dueDate}T00:00:00`);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (due < today) return 'Overdue';
  }
  return payment.status;
}

export function maskAccount(value?: string) {
  if (!value) return '';
  return value.length <= 4 ? value : `${'•'.repeat(Math.min(8, value.length - 4))}${value.slice(-4)}`;
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
    dueDate: cycle.dueDate,
    expectedAmount: input.amount,
    maximumAmount: Number(input.maximumAmount || 0),
    paidAmount: 0,
    settledAmount: 0,
    outstandingAmount: input.amount,
    assignedTo: input.assignedTo || '',
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
  
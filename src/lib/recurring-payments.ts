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
} as const;

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

export type PaymentStatus = 'Scheduled' | 'Generated' | 'Awaiting Bill' | 'Bill Received' | 'Under Verification' |
  'Pending Approval' | 'Approved' | 'Payment Processing' | 'Partially Paid' | 'Paid' | 'Closed' |
  'Rejected' | 'Disputed' | 'Payment Failed' | 'On Hold' | 'Waived' | 'Cancelled' | 'Overdue';

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
  frequency: 'Weekly' | 'Monthly' | 'Bi-monthly' | 'Quarterly' | 'Half-yearly' | 'Yearly' | 'Custom';
  amountType: 'Fixed' | 'Variable' | 'Estimated';
  amount: number;
  maximumAmount?: number;
  dueDay: number;
  startDate: string;
  endDate?: string;
  assignedTo?: string;
  status: 'Active' | 'Inactive';
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  deleted?: boolean;
}

export interface PaymentObligation {
  id: string;
  organizationId: string;
  masterId: string;
  cycleKey: string;
  title: string;
  category: string;
  vendorName: string;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  dueDate: string;
  expectedAmount: number;
  billAmount?: number;
  paidAmount: number;
  status: PaymentStatus;
  assignedTo?: string;
  generatedAutomatically: boolean;
  transactionReference?: string;
  paymentDate?: string;
  workflowStatus?: 'Scheduled' | 'In Progress' | 'Completed' | 'Rejected';
  stage?: string;
  currentStepId?: string | null;
  assignees?: string[];
  workflowDeadline?: Timestamp | null;
  workflowStartedAt?: Timestamp;
  workflowHistory?: RecurringWorkflowHistoryEntry[];
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export const currency = (value: number) => new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', maximumFractionDigits: 0,
}).format(value || 0);

export function effectiveStatus(payment: PaymentObligation): PaymentStatus {
  if (!['Paid', 'Closed', 'Cancelled', 'Waived'].includes(payment.status) && new Date(payment.dueDate) < new Date(new Date().toDateString())) return 'Overdue';
  return payment.status;
}

export function maskAccount(value?: string) {
  if (!value) return '';
  return value.length <= 4 ? value : `${'•'.repeat(Math.min(8, value.length - 4))}${value.slice(-4)}`;
}

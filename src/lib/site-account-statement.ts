export const SAS_COLLECTIONS = {
  projects:        'siteAccountProjects',
  payments:        'siteAccountPayments',
  expenses:        'siteAccountExpenses',
  categories:      'siteAccountCategories',
  budgets:         'siteAccountBudgets',
  categoryBudgets: 'siteAccountCategoryBudgets',
  budgetApprovals: 'siteAccountBudgetApprovals',
  budgetAlertConfigs: 'siteAccountBudgetAlertConfigs',
  budgetAlertState:   'siteAccountBudgetAlertState',
  tenderBudgets:   'siteAccountTenderBudgets',
  settings:        'siteAccountSettings',
} as const;

// Doc id (inside SAS_COLLECTIONS.settings) that stores the Add Expense / Add Receipt
// mandatory-vs-optional field control configuration.
export const SAS_FIELD_CONTROL_DOC_ID = 'fieldControl';

export interface SASProject {
  id: string;
  centralProjectId: string;
  projectName: string;
  projectCode: string;
  enabledForSiteAccount: boolean;
  assignedPersonId: string;
  assignedPersonName: string;
  assignedPersonEmail: string;
  altUserId?: string;
  altUserName?: string;
  altUserEmail?: string;
  viewerId?: string;
  viewerName?: string;
  viewerEmail?: string;
  status: 'Active' | 'Inactive';
  createdAt: any;
  updatedAt: any;
}

export interface SASPayment {
  id: string;
  projectId: string;
  projectName: string;
  receiptDate: string;
  receivedAmount: number;
  paymentMode: string;
  referenceNo: string;
  receivedBy: string;
  remarks: string;
  attachments?: SASAttachment[];
  createdAt: any;
  createdBy?: string;
  createdByName?: string;
  updatedAt: any;
  updatedBy?: string;
  updatedByName?: string;
}

export interface SASAttachment {
  name: string;
  url: string;
  storagePath: string;
  size: number;
  type: string;
}

export interface SASExpense {
  id: string;
  projectId: string;
  projectName: string;
  expenseCategory: string;
  expenseSubCategory?: string;
  narration?: string;
  expensedBy: string;
  expenseDate: string;
  expenseAmount: number;
  paymentMode: string;
  vendorPartyName: string;
  billNo: string;
  /** Marked by the person recording the expense — the bill carries GST. */
  isGstBill?: boolean;
  remarks: string;
  attachments?: SASAttachment[];
  createdAt: any;
  createdBy?: string;
  createdByName?: string;
  updatedAt: any;
  updatedBy?: string;
  updatedByName?: string;
}

export interface SASBudget {
  id: string;
  projectId: string;
  projectName: string;
  budgetType: 'total' | 'monthly' | 'fy';
  period?: string;  // monthly → "2025-07"  |  fy → "2025-26"  |  total → undefined
  budgetAmount: number;
  notes?: string;
  createdAt: any;
  updatedAt: any;
}

export interface SASBudgetApproval {
  id: string;
  projectId: string;
  projectName: string;
  period: string;          // "YYYY-MM"
  fileName: string;
  fileUrl: string;
  storagePath: string;
  uploadedBy: string;
  uploadedByName: string;
  uploadedAt: any;
}

export interface SASBudgetAlertRecipient {
  name: string;
  email: string;
  userId?: string;
}

export interface SASBudgetAlertConfig {
  id: string;
  projectId: string;
  projectName: string;
  enabled: boolean;
  thresholds: number[];          // e.g. [80, 100]
  recipients: SASBudgetAlertRecipient[];
  updatedAt: any;
  updatedBy: string;
  updatedByName: string;
}

export interface SASCategoryBudget {
  id: string;
  projectId: string;
  projectName: string;
  period: string;         // "YYYY-MM"
  categoryId: string;
  categoryName: string;
  budgetAmount: number;
  notes?: string;
  createdAt: any;
  updatedAt: any;
}

export interface SASCategory {
  id: string;
  name: string;
  description: string;
  isActive: boolean;
  parentId?: string;
  parentName?: string;
  createdAt: any;
  updatedAt: any;
}

export interface SASTenderBudget {
  id: string;
  projectId: string;
  projectName: string;
  tenderAmount: number;
  startMonth: string;  // "YYYY-MM"
  endMonth: string;    // "YYYY-MM"
  notes?: string;
  createdAt: any;
  updatedAt: any;
}

export const DEFAULT_EXPENSE_CATEGORIES = [
  'Labour Payment',
  'Material Purchase',
  'Vehicle / Transportation',
  'Food / Refreshment',
  'Site Office Expense',
  'Electricity / Utility',
  'Accommodation',
  'Repair & Maintenance',
  'Tools & Equipment',
  'Miscellaneous',
];

export const PAYMENT_MODES = ['Cash', 'Bank', 'UPI', 'Other'] as const;

// ── Field control (mandatory / optional) for Add Expense & Add Receipt forms ─────
// Project, Date and Amount identify every record and always stay mandatory —
// everything below (including the document upload) is admin-configurable from
// Settings → Field Control.

export interface SASExpenseFieldControl {
  expenseCategory:    boolean;
  expenseSubCategory: boolean;
  expensedBy:         boolean;
  paymentMode:        boolean;
  vendorPartyName:    boolean;
  billNo:             boolean;
  narration:          boolean;
  remarks:            boolean;
  attachment:         boolean;
}

export interface SASPaymentFieldControl {
  paymentMode: boolean;
  referenceNo: boolean;
  receivedBy:  boolean;
  remarks:     boolean;
  attachment:  boolean;
}

export interface SASFieldControlSettings {
  expense: SASExpenseFieldControl;
  payment: SASPaymentFieldControl;
  updatedAt?: any;
  updatedBy?: string;
  updatedByName?: string;
}

// Mirrors current hardcoded behaviour, so nothing changes until an admin opts in.
export const DEFAULT_EXPENSE_FIELD_CONTROL: SASExpenseFieldControl = {
  expenseCategory:    true,
  expenseSubCategory: false,
  expensedBy:         true,
  paymentMode:        false,
  vendorPartyName:    false,
  billNo:             false,
  narration:          false,
  remarks:            false,
  attachment:         false,
};

export const DEFAULT_PAYMENT_FIELD_CONTROL: SASPaymentFieldControl = {
  paymentMode: false,
  referenceNo: false,
  receivedBy:  false,
  remarks:     false,
  attachment:  false,
};

export const EXPENSE_FIELD_CONTROL_LABELS: Record<keyof SASExpenseFieldControl, string> = {
  expenseCategory:    'Main Category',
  expenseSubCategory: 'Sub-Category',
  expensedBy:         'Expensed By',
  paymentMode:        'Payment Mode',
  vendorPartyName:    'Vendor / Party Name',
  billNo:             'Bill No.',
  narration:          'Narration',
  remarks:            'Remarks',
  attachment:         'Upload Document',
};

export const PAYMENT_FIELD_CONTROL_LABELS: Record<keyof SASPaymentFieldControl, string> = {
  paymentMode: 'Payment Mode',
  referenceNo: 'Reference No.',
  receivedBy:  'Received By',
  remarks:     'Remarks',
  attachment:  'Upload Document',
};

export function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

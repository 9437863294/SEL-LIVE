export const SAS_COLLECTIONS = {
  projects:        'siteAccountProjects',
  payments:        'siteAccountPayments',
  expenses:        'siteAccountExpenses',
  categories:      'siteAccountCategories',
  budgets:         'siteAccountBudgets',
  categoryBudgets: 'siteAccountCategoryBudgets',
  budgetApprovals: 'siteAccountBudgetApprovals',
} as const;

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
  updatedAt: any;
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
  remarks: string;
  attachments?: SASAttachment[];
  createdAt: any;
  updatedAt: any;
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

export function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

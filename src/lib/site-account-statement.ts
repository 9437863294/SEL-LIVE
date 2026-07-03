export const SAS_COLLECTIONS = {
  projects:   'siteAccountProjects',
  payments:   'siteAccountPayments',
  expenses:   'siteAccountExpenses',
  categories: 'siteAccountCategories',
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
  createdAt: any;
  updatedAt: any;
}

export interface SASExpense {
  id: string;
  projectId: string;
  projectName: string;
  expenseCategory: string;
  expensedBy: string;
  expenseDate: string;
  expenseAmount: number;
  paymentMode: string;
  vendorPartyName: string;
  billNo: string;
  remarks: string;
  createdAt: any;
  updatedAt: any;
}

export interface SASCategory {
  id: string;
  name: string;
  description: string;
  isActive: boolean;
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

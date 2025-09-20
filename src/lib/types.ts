

import { z } from 'zod';

export type Email = {
  id: string;
  sender: string;
  initials: string;
  subject: string;
  body: string;
  date: string;
  read: boolean;
};

export type EmailAuthorization = {
  id: string;
  email: string;
  status: 'Pending' | 'Authorized';
  createdAt: string;
  // In a real app, you would securely store accessToken and refreshToken here,
  // likely in a separate, more secure subcollection.
};


export type BoqItem = {
    id: string;
    [key: string]: any;
};

export type JmcItem = {
  boqSlNo: string;
  description: string;
  unit: string;
  rate: string;
  executedQty: string;
  totalAmount: string;
};

export type JmcEntry = {
    id: string;
    jmcNo: string;
    woNo: string;
    jmcDate: string;
    items: JmcItem[];
    createdAt: string;
};

export type BillItem = {
    jmcItemId: string; // A unique identifier for the JMC item, e.g., `${jmcEntry.id}-${itemIndex}`
    jmcEntryId: string;
    jmcNo: string;
    boqSlNo: string;
    description: string;
    unit: string;
    rate: string;
    executedQty: string; // The original executed quantity from JMC
    billedQty: string; // The quantity being billed in this specific bill
    totalAmount: string;
}

export type Bill = {
    id: string;
    billNo: string;
    billDate: string;
    woNo: string;
    items: (Omit<BillItem, 'billedQty'> & { billedQty: number })[]; // Store billedQty as a number
    createdAt: any; // Firestore Timestamp
    totalAmount?: number; // Optional total amount, can be calculated client-side
}


export type Module = {
  id: string;
  title: string;
  content: string;
  tags: string[];
  icon: string;
};

export const permissionModules = {
  'Site Fund Requisition': [
    'View Module', 'Create Requisition', 'Edit Requisition', 'Delete Requisition',
    'Approve Request', 'Reject Request', 'View Dashboard', 'View History',
    'Revise Request', 'View Settings', 'View Summary', 'View Planned vs Actual',
    'View All'
  ],
  'Daily Requisition': {
    'View Module': [],
    'Entry Sheet': ['View', 'Add', 'Edit', 'Delete', 'View Checklist'],
    'Receiving at Finance': ['View', 'Mark as Received', 'Return to Pending', 'Cancel'],
    'GST & TDS Verification': ['View', 'Verify', 'Re-verify', 'Return to Pending'],
    'Manage Documents': ['View', 'Upload', 'Mark as Missing', 'Not Required', 'Move to Pending'],
    'Settings': ['View', 'Edit Serial Nos', 'Edit User Rights'],
  },
  'Billing Recon': {
    'View Module': [],
    'BOQ': ['View', 'Import', 'Add Manual', 'Clear BOQ', 'Delete Items'],
    'JMC': ['View', 'Create Work Order', 'Create JMC Entry', 'View Log', 'Delete JMC'],
    'Billing': ['View', 'Create Bill', 'View Log'],
    'MVAC': ['View', 'Add Item'],
  },
  'Expenses': {
    'View Module': [],
    'Departments': ['View', 'Create', 'Edit'],
    'Expense Requests': ['View All'],
    'Reports': ['View'],
    'Settings': ['View', 'Edit Serial Nos', 'Manage Accounts'],
  },
  'Loan': {
    'View Module': [],
    'Dashboard': ['View'],
    'Add Loan': ['Create'],
    'Loan Details': ['View', 'Update EMI'],
    'Reports': ['View'],
  },
  'LC Module': {
    'View Module': [],
    'Dashboard': ['View', 'Create'],
    'LC Details': ['View', 'Edit', 'Track Payments'],
  },
   'Insurance': {
    'View Module': [],
  },
  'Settings': {
    'View Module': [],
    'Manage Department': ['View', 'Add', 'Edit', 'Delete'],
    'Manage Project': ['View', 'Add', 'Edit', 'Delete'],
    'Employee Management': ['View', 'Add', 'Edit', 'Delete', 'Sync from GreytHR'],
    'User Management': ['View', 'Add', 'Edit', 'Delete', 'Switch User'],
    'Role Management': ['View', 'Add', 'Edit', 'Delete'],
    'Working Hrs': ['View', 'Edit'],
    'Serial No. Config': ['View', 'Edit'],
    'Appearance': ['View', 'Edit'],
    'Email Authorization': ['View', 'Send Request', 'Revoke'],
    'Login Expiry': ['View', 'Edit'],
  },
  'Email Management': {
    'View Module': [],
  },
  'Bank Balance': {
    'View Module': [],
    'Accounts': ['View', 'Add', 'Edit', 'Delete'],
    'DP Management': ['View', 'Add', 'Delete'],
    'Opening Utilization': ['View', 'Edit'],
    'Daily Log': ['View'],
    'Interest Rate': ['View', 'Add', 'Delete'],
    'Monthly Interest': ['View', 'Edit'],
    'Expenses': ['View', 'Add', 'Delete'],
    'Receipts': ['View', 'Add', 'Delete'],
    'Internal Transaction': ['View', 'Add'],
    'Reports': ['View'],
  },
};


export type Department = {
  id:string;
  name: string;
  head: string;
  status: 'Active' | 'Inactive';
};

export type Project = {
  id: string;
  projectName: string;
  siteCode: string;
  projectSite: string;
  projectDivision: string;
  location: string;
  siteInCharge: string;
  status: 'Active' | 'Inactive';
  billingRequired?: boolean;
};

export type AccountHead = {
  id: string;
  name: string;
};

export type SubAccountHead = {
  id: string;
  name: string;
  headId: string;
};

export const CreateExpenseRequestInputSchema = z.object({
    departmentId: z.string(),
    projectId: z.string(),
    amount: z.number(),
    partyName: z.string(),
    description: z.string(),
    headOfAccount: z.string().optional(),
    subHeadOfAccount: z.string().optional(),
    remarks: z.string().optional(),
});
export type CreateExpenseRequestInput = z.infer<typeof CreateExpenseRequestInputSchema>;

export const CreateExpenseRequestOutputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  requestNo: z.string().optional(),
});
export type CreateExpenseRequestOutput = z.infer<typeof CreateExpenseRequestOutputSchema>;

export type ExpenseRequest = {
    id: string;
    requestNo: string;
    departmentId: string;
    generatedByDepartment: string;
    projectId: string;
    amount: number;
    headOfAccount: string;
    subHeadOfAccount: string;
    remarks: string;
    description: string;
    partyName: string;
    generatedByUser: string;
    generatedByUserId: string;
    createdAt: string;
    receptionNo?: string;
    receptionDate?: string;
};


export type Employee = {
    id: string;
    employeeId: string;
    name: string;
    email: string;
    phone: string;
    department: string;
    designation: string;
    status: 'Active' | 'Inactive';
};

export type UserTheme = {
  color: string;
  font: string;
  sessionDuration?: number;
};

export type ColumnPreference = {
  order: string[];
  visibility: Record<string, boolean>;
};

export type PivotConfig = {
  rows: string[];
  columns: string[];
  value: string;
};

export type UserSettings = {
  columnPreferences?: Record<string, ColumnPreference>;
  pivotPreferences?: Record<string, PivotConfig>;
};


export type User = {
    id: string;
    name: string;
    email: string;
    mobile: string;
    role: string; // Changed from 'Admin' | 'User' to string to support dynamic roles
    status: 'Active' | 'Inactive';
    photoURL?: string;
    theme?: UserTheme;
    settings?: UserSettings;
    isOnline?: boolean;
    lastSeen?: any; // Firestore Timestamp
};

export type SavedUser = {
  id: string;
  name: string;
  email: string;
  photoURL: string;
  pin: string;
  password?: string; // Encoded password - **NOT SECURE FOR PRODUCTION**
};

export type EventDetails = {
    eventName: string;
    description?: string;
    startDate: string;
    location?: string;
    isWhatsappCall?: boolean;
}

export type Chat = {
    id: string;
    type: 'one-to-one' | 'group';
    members: string[];
    memberDetails: { id: string; name: string; photoURL: string; isOnline?: boolean; lastSeen?: any; }[];
    lastMessage: {
        text: string;
        senderId: string;
        timestamp: any; // Firestore Timestamp
    };
    // Group-specific fields
    groupName?: string;
    groupPhotoURL?: string;
    groupAdmins?: string[];
    groupDescription?: string;
    createdBy?: string; // User ID of the creator
    createdAt?: any; // Firestore Timestamp
}

export type Message = {
    id: string;
    senderId: string;
    content: string;
    timestamp: any; // Firestore Timestamp
    type: 'text' | 'image' | 'video' | 'audio' | 'document' | 'event';
    mediaUrl?: string;
    fileName?: string;
    eventDetails?: EventDetails;
    readBy: string[];
    isDeleted?: boolean;
};

export type Role = {
  id: string;
  name: string;
  permissions: Record<string, string[]>;
};

export type WorkingHours = {
  [key: string]: {
    isWorkDay: boolean;
    startTime: string;
    endTime: string;
  }
};

export type Holiday = {
  id: string;
  name: string;
  date: string;
};

export type ActionLog = {
  action: string;
  comment: string;
  userId: string;
  userName: string;
  timestamp: any; // Firestore Server Timestamp
  stepName: string;
};

export type Attachment = {
  name: string;
  url: string;
};

export type Requisition = {
  id: string;
  requisitionId: string;
  projectId: string;
  departmentId: string;
  amount: number;
  description: string;
  raisedBy: string;
  raisedById: string;
  status: 'Pending' | 'In Progress' | 'Approved' | 'Rejected' | 'Completed';
  stage: string;
  date: string;
  createdAt: any; // Firestore Timestamp
  currentStepId?: string | null;
  assignedToId?: string | null;
  deadline?: any; // Firestore Timestamp
  history: ActionLog[];
  attachments?: Attachment[];
};

export type SerialNumberConfig = {
  prefix: string;
  format: string;
  suffix: string;
  startingIndex: number;
};

export type AmountBasedCondition = {
  id: string;
  type: 'Below' | 'Between' | 'Above';
  amount1: number;
  amount2?: number;
  userId: string;
};

export type WorkflowStep = {
  id: string;
  name: string;
  tat: number; // Turnaround time in hours
  assignmentType: 'User-based' | 'Project-based' | 'Department-based' | 'Amount-based';
  assignedTo: string[] | Record<string, string> | AmountBasedCondition[];
  actions: string[];
  upload: 'Required' | 'Not Required' | 'Optional';
};

export type PositionDetail = {
    id: number;
    category: string;
    value: number;
    effectiveFrom: string;
    effectiveTo: string | null;
};

export type EmployeePosition = {
    employeeId: number;
    categoryList: PositionDetail[];
};

export type DailyRequisitionEntry = {
  id: string;
  createdAt: any; // Keep as timestamp for sorting
  receptionNo: string;
  date: any; // Can be timestamp or string after formatting
  projectId: string;
  departmentId: string;
  description: string;
  partyName: string;
  grossAmount: number;
  netAmount: number;
  depNo: string;
  status: 'Pending' | 'Received' | 'Cancelled' | 'Verified' | 'Needs Review';
  receivedById?: string;
  documentStatus?: 'Pending' | 'Uploaded' | 'Missing' | 'Not Required';
  documentStatusUpdatedById?: string; // ID of user who marked as missing/not required
  documentStatusUpdatedAt?: any; // Timestamp
  userRoles?: Record<string, string>;
  igstAmount?: number;
  tdsAmount?: number;
  cgstAmount?: number;
  sgstAmount?: number;
  retentionAmount?: number;
  otherDeduction?: number;
  verificationNotes?: string;
  verifiedAt?: any; // Timestamp
  gstNo?: string;
  attachments?: Attachment[];
  receivedAt?: any;
};

export type DpLogEntry = {
  id: string;
  fromDate: string;
  toDate: string | null;
  amount: number;
};

export type InterestRateLogEntry = {
  id: string;
  fromDate: string;
  toDate: string | null;
  rate: number;
};

export type BankAccount = {
  id: string;
  bankName: string;
  shortName: string;
  accountNumber: string;
  accountType: 'Current Account' | 'Cash Credit';
  status: 'Active' | 'Inactive';
  branch: string;
  ifsc: string;
  currentBalance: number;
  drawingPower: DpLogEntry[];
  interestRateLog: InterestRateLogEntry[];
  openingUtilization: number;
  openingDate: string;
};

export type BankTransaction = {
  id: string;
  accountId: string;
  transactionDate: any; // Firestore Timestamp
  description: string;
  type: 'Debit' | 'Credit';
  amount: number;
  isContra: boolean;
  runningBalance: number;
};

export type BankExpense = {
    id: string;
    date: any; // Firestore Timestamp
    accountId: string;
    description: string;
    amount: number;
    type: 'Debit' | 'Credit';
    isContra: boolean;
    contraId?: string; // Unique ID to link debit and credit pair
    paymentRequestRefNo?: string;
    utrNumber?: string;
    paymentMethod?: string;
    paymentRefNo?: string;
    approvalCopyUrl?: string;
    bankTransferCopyUrl?: string;
    createdAt: any; // Firestore Timestamp
};

export type BankDailyLog = {
    id: string; // e.g., '2025-09-17-accountId'
    date: string;
    accountId: string;
    accountName: string;
    openingBalance: number;
    totalExpenses: number;
    totalReceipts: number;
    totalContra: number;
    closingBalance: number;
};

export type MonthlyInterestData = {
  [accountId: string]: {
    projected: number;
    actual: number;
  };
};

export type Loan = {
  id: string;
  accountNo: string;
  lenderName: string;
  loanAmount: number;
  tenure: number; // in months
  interestRate: number; // annual percentage
  emiAmount: number;
  startDate: string;
  endDate: string;
  linkedBank: string;
  loanType: 'Loan' | 'Investment';
  totalPaid: number;
  status: 'Active' | 'Closed' | 'Default';
  createdAt: any;
};

export type EMI = {
  id: string;
  loanId: string;
  emiNo: number;
  dueDate: any; // Firestore Timestamp
  emiAmount: number;
  principal: number;
  interest: number;
  paidAmount: number;
  closingPrincipal: number;
  status: 'Paid' | 'Pending' | 'Overdue';
  paidAt?: any; // Firestore Timestamp
  paidById?: string;
  expenseRequestNo?: string;
};

export type LcEntry = {
    id: string;
    vendor: string;
    projectId: string;
    bank: string;
    lcNo: string;
    lcAmount: number;
    selCalculation: number;
    bankCalculation: number;
    difference: number;
    fdMargin: number;
    status: 'Draft' | 'Opened' | 'In Payment' | 'Closed';
    createdAt: any;
    // Document URLs
    poUrl?: string;
    applicationUrl?: string;
    lcCopyUrl?: string;
};

export type LcPayment = {
    id: string;
    lcId: string;
    date: any; // Timestamp
    amount: number;
    commission: number;
    bank: string;
};

export type LcInvoice = {
    id: string;
    lcId: string;
    invoiceNo: string;
    invoiceDate: any; // Timestamp
    amount: number;
};

export type PolicyHolder = {
  id: string;
  name: string;
  date_of_birth: Date | null;
  contact: string;
  email: string;
  address: string;
};

export type InsuranceCompany = {
  id: string;
  name: string;
  status: 'Active' | 'Inactive';
};

export type InsurancePolicy = {
  id: string;
  insured_person: string;
  policy_no: string;
  insurance_company: string;
  policy_category: string;
  policy_name: string;
  premium: number;
  sum_insured: number;
  date_of_comm: any; // Firestore Timestamp
  policy_issue_date?: any; // Firestore Timestamp
  date_of_maturity: any; // Firestore Timestamp
  last_premium_date?: any; // Firestore Timestamp
  payment_type: 'Monthly' | 'Quarterly' | 'Yearly' | 'One-Time';
  auto_debit: boolean;
  attachments?: Attachment[];
  tenure: number; // in years
  due_date: any; // Firestore Timestamp or null
  last_renewed_at?: any;
  last_payment_type?: string;
};

export type PolicyRenewal = {
  id: string;
  policyId: string;
  renewalDate: any; // Timestamp of when the renewal was processed
  paymentDate: any; // Timestamp from the form
  receiptDate: any; // Timestamp from the form
  paymentType: string;
  remarks: string;
  renewalCopyUrl?: string;
  renewedBy: string; // User ID
};

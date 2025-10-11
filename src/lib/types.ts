
import { Timestamp } from 'firebase/firestore';
import { z } from 'zod';

export interface Module {
  id: string;
  title: string;
  content: string;
  tags: string[];
  icon: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  mobile: string;
  role: string;
  status: 'Active' | 'Inactive';
  photoURL?: string;
  isOnline?: boolean;
  lastSeen?: Timestamp;
  theme?: {
    color?: string;
    font?: string;
    sessionDuration?: number;
  };
}

export interface SavedUser {
  id: string;
  name: string;
  email: string;
  photoURL: string;
  pin?: string;
  password?: string;
}

export interface Department {
  id: string;
  name: string;
  head: string;
  status: 'Active' | 'Inactive';
}

export interface Project {
  id: string;
  projectName: string;
  siteCode: string;
  projectSite: string;
  projectDivision: string;
  location: string;
  siteInCharge: string;
  status: 'Active' | 'Inactive';
  billingRequired?: boolean;
  stockManagementRequired?: boolean;
}

export interface Site {
    id: string;
    name: string;
    location: string;
}

export interface Role {
  id: string;
  name: string;
  permissions: Record<string, string[]>;
}

export const permissionModules = {
    'Module Hub': ['View Module', 'Create', 'Edit', 'Delete'],
    'Site Fund Requisition': {
        'View Module': true,
        'Create Requisition': true,
        'View All': true,
        'Reports': ['View Summary', 'View Planned vs Actual'],
        'Settings': ['View Settings', 'Edit User Rights', 'Edit Workflow'],
    },
    'Daily Requisition': {
        'View Module': true,
        'Entry Sheet': ['View', 'Add', 'Edit', 'Delete', 'View Checklist'],
        'Receiving at Finance': ['View', 'Mark as Received', 'Return to Pending', 'Cancel'],
        'GST & TDS Verification': ['View', 'Verify', 'Re-verify', 'Return to Pending'],
        'Processed for Payment': ['View', 'Mark as Received for Payment'],
        'Manage Documents': ['View', 'Upload', 'Download', 'Mark as Missing', 'Mark as Not Required', 'Move to Pending'],
        'Settings': ['View', 'Edit Serial Nos'],
    },
    'Billing Recon': {
        'View Module': true,
        'BOQ': ['View', 'Import', 'Add Manual'],
        'MVAC': ['View', 'Add Item'],
        'JMC': ['View', 'Create JMC Entry', 'View Log', 'Create Work Order'],
        'Billing': ['View', 'Create Bill', 'View Log'],
    },
    'Email Management': ['View Module'],
    'Bank Balance': {
        'View Module': true,
        'Accounts': ['View', 'Add', 'Edit', 'Delete'],
        'DP Management': ['View', 'Add', 'Delete'],
        'Opening Utilization': ['View', 'Edit'],
        'Daily Log': ['View'],
        'Interest Rate': ['View', 'Add', 'Delete'],
        'Monthly Interest': ['View', 'Edit'],
        'Internal Transaction': ['View', 'Delete'],
        'Reports': ['View', 'View Cashflow', 'View Bank Position']
    },
    'Expenses': {
        'View Module': true,
        'Departments': ['View', 'Create', 'Edit'],
        'Expense Requests': ['View All'],
        'Reports': ['View'],
        'Settings': ['View', 'Edit Serial Nos', 'Manage Accounts'],
    },
    'Loan': {
      'View Module': true,
      'Dashboard': ['View', 'Add', 'Edit'],
      'Reports': ['View', 'View Month-wise Status'],
    },
    'Store & Stock Management': {
        'View Module': true,
        'Projects': ['View', 'Stock In', 'Stock Out', 'Edit', 'Delete'],
        'Dashboard': ['View'],
        'Inventory': ['View'],
        'Transactions': ['View'],
        'Conversions': ['View', 'Manage'],
        'BOM Management': ['View', 'Manage'],
        'BOQ': ['View', 'Import', 'Add'],
        'Reports': ['View', 'Ageing Report'],
        'AI Forecast': ['View'],
        'Settings': ['View', 'Manage Projects', 'Manage Units', 'Manage GRN Entry'],
    },
    'Insurance': {
      'View Module': true,
      'Personal Insurance': ['View', 'Add', 'Edit', 'Delete', 'View History'],
      'Premium Due': ['View', 'Renew'],
      'Maturity Due': ['View'],
      'Project Insurance': ['View', 'Add', 'Edit', 'Renew', 'Mark as Not Required', 'View History'],
      'My Tasks': ['View', 'Create', 'Approve', 'Reject', 'Upload Documents'],
      'Reports': ['View Reports', 'View Summary'],
      'Settings': ['View', 'Companies', 'Categories', 'Assets', 'Workflow'],
    },
    'Settings': {
      'View Module': true,
      'Manage Department': ['View', 'Add', 'Edit', 'Delete'],
      'Manage Project': ['View', 'Add', 'Edit', 'Delete'],
      'Employee Management': ['View', 'Add', 'Edit', 'Delete', 'Sync from GreytHR'],
      'User Management': ['View', 'Add', 'Edit', 'Switch User'],
      'Role Management': ['View', 'Add', 'Edit', 'Delete'],
      'Serial No. Config': ['View', 'Edit'],
      'Working Hrs': ['View', 'Edit'],
      'Appearance': ['View', 'Edit'],
      'Email Authorization': ['View', 'Send', 'Revoke'],
      'Login Expiry': ['View', 'Edit'],
    },
};


export interface Requisition {
    id: string;
    requisitionId: string;
    projectId: string;
    departmentId: string;
    amount: number;
    description: string;
    date: string; // Stored as ISO string
    raisedBy: string;
    raisedById: string;
    createdAt: Timestamp;
    status: 'Pending' | 'In Progress' | 'Completed' | 'Rejected' | 'Needs Review';
    stage: string; // e.g., 'Request Receiving', 'Verification'
    currentStepId: string | null;
    assignees: string[]; // User IDs
    deadline: Timestamp | null;
    history: ActionLog[];
    attachments?: Attachment[];
}

export interface Attachment {
  name: string;
  url: string;
}


export interface ActionLog {
    action: string;
    comment: string;
    userId: string;
    userName: string;
    timestamp: Timestamp;
    stepName: string;
    attachment?: { name: string; url: string };
}

export interface WorkflowStep {
  id: string;
  name: string;
  tat: number; // in hours
  assignmentType: 'User-based' | 'Role-based' | 'Project-based' | 'Department-based' | 'Amount-based';
  assignedTo: string[] | Record<string, AssignedTo> | AmountBasedCondition[];
  actions: string[];
  upload: 'Required' | 'Optional' | 'Not Required';
}

export interface AmountBasedCondition {
    id: string;
    type: 'Below' | 'Between' | 'Above';
    amount1: number;
    amount2?: number;
    userId: string;
    alternativeUserId?: string;
}

export interface AssignedTo {
    primary: string;
    alternative?: string;
}


export interface SerialNumberConfig {
  prefix: string;
  format: string; // e.g., YYYYMMDD
  suffix: string;
  startingIndex: number;
}

export interface ExpenseRequest {
  id: string;
  requestNo: string;
  departmentId: string;
  projectId: string;
  amount: number;
  description: string;
  headOfAccount: string;
  subHeadOfAccount: string;
  remarks: string;
  partyName: string;
  generatedByDepartment: string;
  generatedByUser: string;
  generatedByUserId: string;
  receptionNo: string;
  receptionDate: string;
  createdAt: string;
}

export interface AccountHead {
    id: string;
    name: string;
}

export interface SubAccountHead {
    id: string;
    name: string;
    headId: string;
}

export interface DailyRequisitionEntry {
    id: string;
    receptionNo: string;
    depNo: string;
    date: string | Timestamp;
    projectId: string;
    departmentId: string;
    description: string;
    partyName: string;
    grossAmount: number;
    netAmount: number;
    createdAt: Timestamp;
    // GST/TDS Fields
    status: 'Pending' | 'Received' | 'Verified' | 'Cancelled' | 'Needs Review' | 'Received for Payment' | 'Paid';
    receivedAt?: Timestamp;
    receivedById?: string;
    verifiedAt?: Timestamp;
    igstAmount?: number;
    tdsAmount?: number;
    cgstAmount?: number;
    sgstAmount?: number;
    retentionAmount?: number;
    otherDeduction?: number;
    verificationNotes?: string;
    gstNo?: string;
    // Document Status
    documentStatus: 'Pending' | 'Uploaded' | 'Missing' | 'Not Required';
    documentStatusUpdatedAt?: Timestamp;
    documentStatusUpdatedById?: string;
    attachments?: Attachment[];
    paidAt?: Timestamp;
}

export interface UserSettings {
  columnPreferences?: {
    [pageKey: string]: {
      order: string[];
      visibility: Record<string, boolean>;
    }
  },
  pivotPreferences?: {
    [pageKey: string]: PivotConfig
  }
}

export interface PivotConfig {
    rows: string[];
    columns: string[];
    value: string;
}

export interface BoqItem {
  id: string;
  [key: string]: any; // Allow any other BOQ-specific fields
  bom?: FabricationBomItem[];
  conversions?: Conversion[];
}

export interface JmcItem {
    boqSlNo: string;
    description: string;
    unit: string;
    rate: number;
    executedQty: any;
    totalAmount: number;
}

export interface JmcEntry {
    id: string;
    jmcNo: string;
    woNo: string;
    jmcDate: string;
    items: JmcItem[];
    createdAt: any;
}

export interface BillItem {
    jmcItemId: string; // Unique ID for the JMC item (e.g., `${jmcEntryId}-${jmcItemIndex}`)
    jmcEntryId: string;
    jmcNo: string;
    boqSlNo: string;
    description: string;
    unit: string;
    rate: string;
    executedQty: string;
    billedQty: string;
    totalAmount: string;
}

export interface Bill {
  id: string;
  billNo: string;
  billDate: string;
  woNo: string;
  items: BillItem[];
  createdAt: any;
  totalAmount?: number;
}

export interface PolicyHolder {
    id: string;
    name: string;
    date_of_birth: Date | null;
    contact?: string;
    email?: string;
    address?: string;
}

export interface InsuranceCompany {
    id: string;
    name: string;
    status: 'Active' | 'Inactive';
}

export interface PolicyCategory {
    id: string;
    name: string;
    status: 'Active' | 'Inactive';
}

export interface InsurancePolicy {
  id: string;
  insured_person: string;
  policy_no: string;
  insurance_company: string;
  policy_category: string;
  policy_name: string;
  premium: number;
  sum_insured: number;
  date_of_comm: Timestamp | null;
  date_of_maturity: Timestamp | null;
  last_premium_date: Timestamp | null;
  payment_type: 'Monthly' | 'Quarterly' | 'Yearly' | 'One-Time';
  auto_debit: boolean;
  due_date: Timestamp | null;
  last_renewed_at?: Timestamp;
  last_payment_type?: string;
  tenure: number;
  policy_issue_date?: Timestamp;
  attachments?: Attachment[];
}

export interface PolicyRenewal {
  id: string;
  policyId: string;
  renewalDate: Timestamp;
  paymentDate: Timestamp;
  receiptDate: Timestamp;
  paymentType: string;
  remarks: string;
  renewalCopyUrl?: string;
  renewedBy: string;
}

export interface Email {
    id: string;
    sender: string;
    initials: string;
    subject: string;
    body: string;
    date: string;
    read: boolean;
}

export interface EmailAuthorization {
    id: string;
    email: string;
    status: 'Pending' | 'Authorized';
    createdAt: string;
}

export interface BankAccount {
    id: string;
    bankName: string;
    shortName: string;
    accountNumber: string;
    accountType: 'Current Account' | 'Cash Credit';
    status: 'Active' | 'Inactive';
    branch: string;
    ifsc: string;
    openingBalance?: number;
    openingUtilization?: number;
    openingDate: string; // YYYY-MM-DD
    currentBalance: number;
    drawingPower: DpLogEntry[];
    interestRateLog: InterestRateLogEntry[];
}

export interface DpLogEntry {
    id: string;
    fromDate: string;
    toDate: string | null;
    amount: number;
}

export interface InterestRateLogEntry {
    id: string;
    fromDate: string;
    toDate: string | null;
    rate: number; // percentage
}

export interface BankExpense {
    id: string;
    date: Timestamp;
    accountId: string;
    description: string;
    amount: number;
    type: 'Debit' | 'Credit';
    isContra: boolean;
    contraId?: string; // To link two contra entries
    // Payment-specific fields
    paymentRequestRefNo?: string;
    utrNumber?: string;
    paymentMethod?: string;
    paymentRefNo?: string;
    approvalCopyUrl?: string;
    bankTransferCopyUrl?: string;
    createdAt: Timestamp;
}

export interface BankDailyLog {
  id: string;
  date: string;
  accountId: string;
  accountName: string;
  openingBalance: number;
  totalExpenses: number;
  totalReceipts: number;
  totalContra: number;
  closingBalance: number;
}

export interface MonthlyInterestData {
  [accountId: string]: {
    projected: number;
    actual: number;
  }
}

export interface Holiday {
    id: string;
    name: string;
    date: string; // YYYY-MM-DD
}

export interface WorkingHours {
  [day: string]: {
    isWorkDay: boolean;
    startTime: string; // HH:mm
    endTime: string; // HH:mm
  };
}

export interface LcEntry {
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
    status: 'Opened' | 'Closed' | 'Amended';
    createdAt: any;
    poUrl?: string;
    applicationUrl?: string;
    lcCopyUrl?: string;
}

export interface Employee {
    id: string;
    employeeId: string;
    name: string;
    email: string;
    phone: string;
    department: string;
    designation: string;
    status: 'Active' | 'Inactive';
}

export interface EmployeePosition {
  employeeId: number;
  categoryList: PositionDetail[];
}

export interface PositionDetail {
  id: number;
  category: string;
  value: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface CreateExpenseRequestInput {
  departmentId: string;
  projectId: string;
  amount: number;
  description: string;
  headOfAccount: string;
  subHeadOfAccount: string;
  remarks: string;
  partyName: string;
}

const CreateExpenseRequestInputSchema = z.object({
  departmentId: z.string(),
  projectId: z.string(),
  amount: z.number(),
  description: z.string(),
  headOfAccount: z.string(),
  subHeadOfAccount: z.string(),
  remarks: z.string().optional(),
  partyName: z.string(),
});

export interface CreateExpenseRequestOutput {
    success: boolean;
    message: string;
    requestNo?: string;
}

const CreateExpenseRequestOutputSchema = z.object({
    success: z.boolean(),
    message: z.string(),
    requestNo: z.string().optional(),
});

export { CreateExpenseRequestInputSchema, CreateExpenseRequestOutputSchema };

export interface Chat {
    id: string;
    type: 'one-to-one' | 'group';
    members: string[]; // array of user IDs
    memberDetails: { id: string; name: string; photoURL: string; }[];
    groupName?: string;
    groupDescription?: string;
    groupPhotoURL?: string;
    createdBy?: string;
    groupAdmins?: string[];
    lastMessage: {
        text: string;
        senderId: string;
        timestamp: any;
    };
    createdAt: any;
}

export interface Message {
    id: string;
    senderId: string;
    timestamp: Timestamp;
    readBy: string[];
    type: 'text' | 'image' | 'video' | 'audio' | 'document' | 'event';
    content?: string;
    mediaUrl?: string;
    fileName?: string;
    eventDetails?: EventDetails;
}

export interface EventDetails {
  eventName: string;
  description?: string;
  startDate: string;
  location?: string;
  isWhatsappCall?: boolean;
}


export interface InsuredAsset {
  id: string;
  name: string;
  type: 'Project' | 'Property';
  projectId?: string; // if type is 'Project'
  location: string;
  description: string;
  status: 'Active' | 'Inactive';
}

export interface ProjectInsurancePolicy {
  id: string;
  assetId: string;
  assetName: string;
  assetType: 'Project' | 'Property';
  policy_no: string;
  insurance_company: string;
  policy_category: string;
  premium: number;
  sum_insured: number;
  insurance_start_date: Timestamp | null;
  insured_until: Timestamp | null;
  tenure_years: number;
  tenure_months: number;
  status: 'Active' | 'Close' | 'Not Required' | 'Expired';
  attachments?: Attachment[];
}

export interface ProjectPolicyRenewal {
    id: string;
    policyNo: string;
    premium: number;
    sumInsured: number;
    startDate: Timestamp;
    endDate: Timestamp;
    renewalDate: Timestamp;
    renewedBy: string;
    renewalCopyUrl?: string;
}

export interface InsuranceTask {
    id: string;
    uniqueCheckId: string;
    policyId: string;
    policyNo: string;
    insuredPerson: string;
    dueDate: Timestamp;
    status: 'Pending' | 'In Progress' | 'Completed' | 'Rejected' | 'Needs Review';
    assignees: string[];
    createdAt: Timestamp;
    taskType: 'Premium Due' | 'Maturity Due';
    currentStepId: string | null;
    currentStage: string;
    deadline: Timestamp | null;
    projectId?: string;
    history: ActionLog[];
}


export interface EMI {
  id: string;
  loanId: string;
  emiNo: number;
  dueDate: Timestamp;
  emiAmount: number;
  principal: number;
  interest: number;
  paidAmount: number;
  closingPrincipal: number;
  status: 'Paid' | 'Pending' | 'Overdue';
  paidAt?: Timestamp;
  paidById?: string;
  expenseRequestNo?: string;
}

export interface Loan {
  id: string;
  accountNo: string;
  lenderName: string;
  loanAmount: number;
  tenure: number;
  interestRate: number;
  emiAmount: number;
  startDate: string;
  endDate: string;
  linkedBank: string;
  loanType: 'Loan' | 'Investment';
  totalPaid: number;
  status: 'Active' | 'Closed' | 'Pre-closure Pending';
  createdAt: Timestamp;
  finalInterestOnClosure?: number;
  otherChargesOnClosure?: number;
}


export interface FabricationBomItem {
    id: string;
    markNo: string;
    section: string;
    grade: string;
    length: number;
    width: number;
    unitWt: number;
    wtPerPc: number;
    totalWtPerSet: number;
    qtyPerSet: number;
    totalWtKg: number;
}

export interface Conversion {
    id: string;
    fromUnit: string;
    fromQty: number;
    toUnit: string;
    toQty: number;
}

export interface InventoryLog {
    id: string;
    date: Timestamp;
    itemId: string; // Corresponds to BOQItem id or a new item id
    itemName: string;
    itemType: 'Main' | 'Sub'; // From BOQ or a user-defined sub-item
    transactionType: 'Goods Receipt' | 'Goods Issue' | 'Return' | 'Transfer' | 'Adjustment' | 'Conversion';
    quantity: number;
    availableQuantity: number; // For FIFO tracking
    unit: string;
    cost?: number;
    projectId: string;
    projectSlug?: string;
    batch?: string; // Could be GRN number
    description?: string;
    details?: {
      grnNo?: string;
      boqSlNo?: string;
      supplier?: string;
      poNumber?: string;
      poDate?: string | null;
      invoiceNumber?: string;
      invoiceDate?: string | null;
      invoiceAmount?: number | null;
      invoiceFileUrls?: { name: string, url: string }[];
      transporterDocUrls?: { name: string, url: string }[];
      vehicleNo?: string;
      waybillNo?: string;
      lrNo?: string;
      lrDate?: string | null;
      notes?: string;
      // for issues/transfers
      issuedTo?: string;
      destinationProjectId?: string;
      sourceGrn?: string;
    };
}

export interface EnrichedLogItem extends InventoryLog {
  originalQuantity: number;
  issuedQuantity: number;
  balanceQuantity: number;
}

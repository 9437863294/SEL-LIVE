
import { Timestamp } from 'firebase/firestore';
import { z } from 'zod';

/** ---------- Shared small types used below ---------- **/

export type UploadRequirement = 'Required' | 'Optional' | 'Not Required';

export interface AssignedTo {
  primary: string;
  alternative?: string;
}

/** Allow richer per-step action config */
export type ActionConfig = {
  name: string;
  requiresComment?: boolean;
  requiresAttachment?: boolean;
  nextStatus?: string;
  departmentId?: string; // Specific for 'Create Expense Request'
};

/** ---------- Core app types ---------- **/

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
  pin?: string;        // 4-digit PIN for quick device sign-in
  password?: string;   // Base64-encoded password (not secure - consider alternatives)
}

export interface Department {
  id: string;
  name: string;
  head: string;
  status: 'Active' | 'Inactive';
}

export interface Signature {
  id: string;
  designation: string;
  name: string;
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
  woNo?: string;
  signatures?: Signature[];
  projectDescription?: string;
};

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
  'Site Fund Requisition': [
    'View Module', 'Create Requisition', 'Edit Requisition', 'Delete Requisition',
    'Approve Request', 'Reject Request', 'View Dashboard', 'View History',
    'Revise Request', 'View Settings', 'View Summary', 'View Planned vs Actual',
    'View All'
  ],
  'Site Fund Requisition 2': [
    'View Module', 'Create Requisition', 'Edit Requisition', 'Delete Requisition',
    'Approve Request', 'Reject Request', 'View Dashboard', 'View History',
    'Revise Request', 'View Settings', 'View Summary', 'View Planned vs Actual',
    'View All'
  ],
  'Daily Requisition': {
    'View Module': [],
    'Entry Sheet': ['View', 'Add', 'Edit', 'Delete', 'View Checklist'],
    'Receiving at Finance': ['View', 'Mark as Received', 'Return to Pending', 'Reject'],
    'GST & TDS Verification': ['View', 'Verify', 'Re-verify', 'Return to Pending'],
    'Processed for Payment': ['View', 'Mark as Received for Payment'],
    'Manage Documents': ['View', 'Upload', 'Download', 'Mark as Missing', 'Not Required', 'Move to Pending'],
    'Settings': ['View', 'Edit Serial Nos', 'Edit User Rights'],
  },
  'Billing Recon': {
    'View Module': [],
    'BOQ': ['View', 'Import', 'Add Manual', 'Clear BOQ', 'Delete Items'],
    'JMC': ['View', 'Create Work Order', 'Create JMC Entry', 'View Log', 'Delete JMC', 'View Certified JMC', 'View Settings', 'Edit Settings', 'Edit Serial Nos',"View Reports"],
    'MVAC': ['View', 'Create Work Order', 'Create MVAC Entry', 'View Log', 'Delete MVAC', 'View Certified MVAC', 'View Settings', 'Edit Settings', 'Edit Serial Nos',"View Reports"],
    'Billing': ['View', 'Create Bill', 'Proforma/Advance Bill', 'Edit Bill', 'Delete Bill', 'View Settings', 'Edit Settings'],
    'Combined Log': ['View'],
  },
  'Subcontractors Management': {
    'View Module': [],
    'Manage Subcontractors': ['View', 'Add', 'Edit', 'Delete'],
    'Work Order': ['View', 'Create', 'Edit', 'Delete'],
    'Billing': [
      'View',
      'Create Bill',
      'Proforma/Advance Bill',
      'View Log',
      'Edit Bill',
      'Delete Bill',
      'View Settings',
      'Edit Settings'
    ],
    'Reports': {
        'View': [],
        'Work Order Progress': ['View'],
        'Billing Summary': ['View'],
    },
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
    'Internal Transaction': ['View', 'Add', 'Delete'],
    'Reports': ['View'],
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
  'Insurance': {
    'View Module': [],
    'Personal Insurance': ['View', 'Add', 'Edit', 'Delete', 'Renew', 'View History'],
    'Project Insurance': ['View', 'Add', 'Edit', 'Delete', 'Renew', 'View History', 'Mark as Not Required'],
    'Premium Due': ['View'],
    'Maturity Due': ['View'],
    'My Tasks': ['View'],
    'Reports': ['View Reports'],
    'Settings': ['View'],
    'Settings.Holders': ['View', 'Add', 'Edit', 'Delete'],
    'Settings.Companies': ['View', 'Add', 'Edit', 'Delete'],
    'Settings.Categories': ['View', 'Add', 'Edit', 'Delete'],
    'Settings.Assets': ['View', 'Add', 'Edit', 'Delete'],
  },
   'Employee': {
    'View Module': [],
    'Manage': ['View', 'Add', 'Edit', 'Delete'],
    'Sync': ['Sync from GreytHR'],
    'Categories': ['View'],
    'Position Details': ['View'],
    'Salary': ['View', 'Sync'],
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
};

/** ---------- Requisition & workflow-related ---------- **/

export interface Requisition {
  id: string;
  requisitionId: string;
  projectId: string;
  departmentId: string;
  amount: number;
  partyName: string;
  description: string;
  date: string; // ISO
  raisedBy: string;
  raisedById: string;
  createdAt: Timestamp;
  status: 'Pending' | 'In Progress' | 'Completed' | 'Rejected' | 'Needs Review';
  stage: string;
  currentStepId: string | null;
  assignees: string[];
  deadline: Timestamp | null;
  history: ActionLog[];
  attachments?: Attachment[];
  expenseRequestNo?: string;
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

/**
 * WORKFLOW STEP (Discriminated Union)
 * - User-based => assignedTo: string[] ([primary, alternative?])
 * - Role/Project/Department-based => assignedTo: Record<id, AssignedTo>
 */
export type WorkflowAssignmentType =
  | 'User-based'
  | 'Role-based'
  | 'Project-based'
  | 'Department-based'
  | 'Amount-based';

export interface WorkflowStepBase {
  id: string;
  name: string;
  tat: number; // in hours
  actions: (string | ActionConfig)[];   // <-- widened
  upload: UploadRequirement;
}

export interface WorkflowStepUser extends WorkflowStepBase {
  assignmentType: 'User-based';
  assignedTo: string[]; // [primary, alternative?]
}

export interface WorkflowStepMapped extends WorkflowStepBase {
  assignmentType: 'Role-based' | 'Project-based' | 'Department-based';
  assignedTo: Record<string, AssignedTo>;
}

export interface AmountBasedCondition {
    id: string;
    type: 'Below' | 'Between' | 'Above';
    amount1: number;
    amount2?: number;
    userId: string;
    alternativeUserId?: string;
}


export type WorkflowStep = WorkflowStepUser | WorkflowStepMapped | (WorkflowStepBase & { assignmentType: 'Amount-based', assignedTo: AmountBasedCondition[] });

/** ---------- Serial number config ---------- **/

export interface SerialNumberConfig {
  prefix: string;
  format: string; // e.g., YYYYMMDD
  suffix: string;
  startingIndex: number;
}

/** ---------- Expenses ---------- **/

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

/** ---------- Daily Requisition ---------- **/

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

/** ---------- User settings ---------- **/

export interface ColumnPref {
  order: string[];
  visibility: Record<string, boolean>;
  names: Record<string, string>;
  sort: {
    key: string;
    direction: 'asc' | 'desc';
  };
}

export interface UserSettings {
  columnPreferences?: {
    [pageKey: string]: ColumnPref | undefined;
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

/** ---------- Billing / JMC / MVAC / Subcontractors ---------- **/

export interface ContactPerson {
  id: string;
  type: 'Project' | 'Billing' | 'Accounts' | 'Other';
  name: string;
  title: string;
  mobile: string;
  email: string;
}

export interface Subcontractor {
  id: string;
  status: 'Active' | 'Inactive';
  projectId: string;
  legalName: string;
  dbaName: string;
  registeredAddress: string;
  operatingAddress: string;
  gstNumber: string;
  panNumber: string;
  bankName: string;
  bankBranch: string;
  accountNumber: string;
  ifscCode: string;
  contacts: ContactPerson[];
}


export interface BoqItem {
  id: string;
  [key: string]: any;
  bom?: FabricationBomItem[];
  conversions?: Conversion[];
}

export interface MvacItem {
  boqSlNo: string;
  description: string;
  unit: string;
  rate: number;
  executedQty: number;
  certifiedQty?: number;
  totalAmount: number;
}

export interface MvacEntry {
  id: string;
  projectSlug: string;
  projectId?: string;
  mvacNo: string;
  woNo: string;
  mvacDate: string;
  items: MvacItem[];
  createdAt: Timestamp;
  status: 'Pending' | 'In Progress' | 'Completed' | 'Rejected' | 'Certified' | 'Cancelled';
  stage: string;
  currentStepId: string | null;
  assignees: string[];
  deadline: Timestamp | null;
  history: ActionLog[];
}

export interface JmcItem {
  boqSlNo: string;
  description: string;
  unit: string;
  rate: number;
  executedQty: number;
  certifiedQty?: number;
  totalAmount: number;
}

export interface JmcEntry {
  id: string;
  projectSlug: string;
  projectId?: string;
  jmcNo: string;
  woNo: string;
  jmcDate: string;
  items: JmcItem[];
  createdAt: Timestamp;
  status: 'Pending' | 'In Progress' | 'Completed' | 'Rejected' | 'Certified' | 'Cancelled';
  stage: string;
  currentStepId: string | null;
  assignees: string[];
  deadline: Timestamp | null;
  history: ActionLog[];
}

export interface SubItem {
  id: string;
  slNo: string;
  name: string;
  unit: string;
  quantity: number;
  rate: number;
  totalAmount: number;
}

export interface WorkOrderItem {
  id: string;
  boqItemId: string;
  description: string;
  unit: string;
  orderQty: number;
  rate: number;
  totalAmount: number;
  boqSlNo: string;
  subItems?: SubItem[];
}

export interface WorkOrder {
  id: string;
  workOrderNo: string;
  subcontractorId: string;
  projectId: string;
  subcontractorName: string;
  totalAmount: number;
  items: WorkOrderItem[];
  date: string;
  status: 'Active' | 'Completed' | 'Cancelled';
}

export interface BillItem {
  jmcItemId: string;
  jmcEntryId: string;
  jmcNo: string;
  boqItemId: string;
  boqSlNo: string;
  description: string;
  unit: string;
  rate: number;
  executedQty: number;
  billedQty: number;
  totalAmount: number;
  subItems?: SubItem[];
}


export interface Bill {
  id: string;
  projectId: string;
  projectName?: string;
  billNo: string;
  billDate: string;
  workOrderId: string;
  workOrderNo: string;
  subcontractorId: string;
  subcontractorName?: string;
  items: BillItem[];
  subtotal: number;
  gstType: 'percentage' | 'manual';
  gstPercentage: number | null;
  gstAmount: number;
  grossAmount: number;
  retentionType: 'percentage' | 'manual';
  retentionPercentage: number | null;
  retentionAmount: number;
  otherDeduction: number;
  advanceDeductions?: { id: string; reference: string; amount: number; deductionType: 'amount' | 'percentage'; deductionValue: number; }[];
  totalDeductions: number;
  netPayable: number;
  totalAmount: number;
  createdAt: any;
  status: 'Pending' | 'In Progress' | 'Completed' | 'Rejected';
  stage: string;
  currentStepId: string | null;
  assignees: string[];
  history: ActionLog[];
  deadline?: Timestamp | null;
  isRetentionBill?: boolean;
  claimedBillIds?: string[];
  retentionClaimed?: boolean;
}


export interface ProformaBill {
    id: string;
    proformaNo: string;
    date: string;
    workOrderId: string;
    workOrderNo: string;
    subcontractorId: string;
    subcontractorName: string;
    items: (Omit<BillItem, 'billedQty'> & { billedQty: number })[];
    subtotal: number;
    payablePercentage: number;
    payableAmount: number;
    createdAt: any;
    projectId: string;
    projectName?: string;
    approvalCopyUrl?: string;

    // Workflow fields
    status?: 'Pending' | 'In Progress' | 'Completed' | 'Rejected';
    stage?: string;
    currentStepId?: string | null;
    assignees?: string[];
    history?: ActionLog[];
    deadline?: Timestamp | null;
}

/** ---------- Insurance ---------- **/

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

/** ---------- Email Auth ---------- **/

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

/** ---------- Bank / Finance ---------- **/

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
  contraId?: string;
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

/** ---------- Calendar / Schedule ---------- **/

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

/** ---------- LC / Loans ---------- **/

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

export type SalaryDetail = {
  itemName: string;
  description: string;
  amount: number;
  type: 'INCOME' | 'DEDUCT' | 'Others';
};

export interface SalarySyncLog {
  lastSynced: Timestamp;
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
  grossSalary?: number;
  netSalary?: number;
  salaryDetails?: SalaryDetail[];
  dateOfJoin?: string | null;
  leavingDate?: string | null;
  dateOfBirth?: string | null;
  gender?: string;
  employeeNo?: string;
}

export interface EmployeePosition {
  employeeId: string; // Changed to string
  categoryList: PositionDetail[];
}

export interface PositionDetail {
  id: number;
  category: string;
  value: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

/** ---------- Expense request schema ---------- **/

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

/** ---------- Chat ---------- **/

export interface Chat {
  id: string;
  type: 'one-to-one' | 'group';
  members: string[];
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

/** ---------- Insurance project assets ---------- **/

export interface InsuredAsset {
  id: string;
  name: string;
  type: 'Project' | 'Property';
  projectId?: string;
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

/** ---------- Insurance tasks ---------- **/

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

/** ---------- Loans ---------- **/

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

/** ---------- Store & Stock ---------- **/

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
  itemId: string;
  itemName: string;
  itemType: 'Main' | 'Sub';
  transactionType: 'Goods Receipt' | 'Goods Issue' | 'Return' | 'Transfer' | 'Adjustment' | 'Conversion';
  quantity: number;
  availableQuantity: number;
  unit: string;
  cost?: number;
  projectId: string;
  projectSlug?: string;
  batch?: string;
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

    

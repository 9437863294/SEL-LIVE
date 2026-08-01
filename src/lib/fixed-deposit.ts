import type { Timestamp } from "firebase/firestore";

export const FD_COLLECTIONS = {
  deposits: "fixedDeposits",
  assignments: "fdAssignments",
  reservations: "fdReservations",
  renewals: "fdRenewals",
  closures: "fdClosures",
  releases: "fdReleaseRequests",
  replacements: "fdReplacementRequests",
  documents: "documents",
  interestTransactions: "interestTransactions",
  approvals: "approvals",
  audit: "auditLogs",
  notifications: "userNotifications",
  snapshots: "fdMonthlySnapshots",
  lc: "lettersOfCredit",
  bg: "bankGuarantees",
} as const;

export const FD_SETTINGS_PATH = ["settings", "fixedDeposit"] as const;

export const FD_STATUSES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "ACTIVE",
  "PARTIALLY_UTILIZED",
  "FULLY_UTILIZED",
  "MATURITY_APPROACHING",
  "MATURED",
  "RENEWAL_PENDING",
  "RENEWED",
  "CLOSURE_PENDING",
  "CLOSED",
  "PREMATURELY_CLOSED",
  "REPLACED",
  "CANCELLED",
  "ON_HOLD",
] as const;

export type FDStatus = (typeof FD_STATUSES)[number];

export const FD_ASSIGNMENT_STATUSES = [
  "RESERVED",
  "PENDING_APPROVAL",
  "ACTIVE",
  "PARTIALLY_RELEASED",
  "RELEASED",
  "REPLACED",
  "CANCELLED",
  "REJECTED",
] as const;

export type FDAssignmentStatus = (typeof FD_ASSIGNMENT_STATUSES)[number];

export const FD_TYPES = [
  ["REGULAR", "Regular FD"],
  ["TAX_SAVING", "Tax-saving FD"],
  ["CUMULATIVE", "Cumulative FD"],
  ["NON_CUMULATIVE", "Non-cumulative FD"],
  ["MARGIN", "Margin FD"],
  ["SECURITY", "Security FD"],
  ["SWEEP", "Sweep FD"],
  ["SHORT_TERM", "Short-term Deposit"],
  ["LONG_TERM", "Long-term Deposit"],
  ["OTHER", "Other"],
] as const;

export const FD_PURPOSES = [
  ["GENERAL_INVESTMENT", "General Investment"],
  ["BG_MARGIN", "BG Margin"],
  ["LC_MARGIN", "LC Margin"],
  ["BG_LC_MARGIN", "Combined BG and LC Margin"],
  ["SECURITY_DEPOSIT", "Security Deposit"],
  ["STATUTORY_DEPOSIT", "Statutory Deposit"],
  ["TENDER_DEPOSIT", "Tender Deposit"],
  ["CLIENT_REQUIREMENT", "Client Requirement"],
  ["OTHER", "Other"],
] as const;

export const INTEREST_METHODS = [
  "SIMPLE",
  "COMPOUND",
  "BANK_PROVIDED",
  "MANUAL",
] as const;

export const INTEREST_FREQUENCIES = [
  "Monthly",
  "Quarterly",
  "Half-yearly",
  "Annually",
  "On maturity",
] as const;

export const SOURCE_OF_FUNDS = [
  "Current Account",
  "Cash Credit Account",
  "Project Receipt",
  "General Fund",
  "Margin Transfer",
  "Other",
] as const;

export interface FixedDeposit {
  id: string;
  organizationId: string;
  organizationName?: string;
  referenceNumber: string;
  fdNumber: string;
  bankId: string;
  bankName: string;
  branchId?: string;
  branchName?: string;
  ifsc?: string;
  sourceAccountId?: string;
  sourceAccountNumber?: string;
  relationshipManager?: string;
  relationshipManagerPhone?: string;
  relationshipManagerEmail?: string;
  projectId?: string;
  projectName?: string;
  holderName: string;
  holderType?: string;
  jointHolderName?: string;
  nomineeName?: string;
  pan?: string;
  beneficialOwner?: string;
  fdType: string;
  depositCategory?: string;
  purpose: string;
  sourceOfFunds?: string;
  currency: string;
  principalAmount: number;
  interestRate: number;
  interestCalculationMethod: string;
  interestPaymentFrequency: string;
  tenureDays?: number;
  tenureMonths?: number;
  creationDate: Timestamp;
  valueDate: Timestamp;
  maturityDate: Timestamp;
  expectedInterest: number;
  maturityAmount: number;
  expectedTds: number;
  expectedNetProceeds: number;
  interestReceived?: number;
  prematureClosurePenalty?: number;
  eligibleMarginPercentage: number;
  eligibleValue: number;
  bgUtilizedAmount: number;
  lcUtilizedAmount: number;
  reservedAmount: number;
  totalUtilizedAmount: number;
  availableAmount: number;
  lienMarked: boolean;
  lienHolder?: string;
  lienDate?: Timestamp | null;
  lienAmount?: number;
  lienPurpose?: string;
  bankConfirmationReference?: string;
  autoRenewal: boolean;
  status: FDStatus;
  renewalStatus?: string;
  closureStatus?: string;
  documentComplete: boolean;
  approvalStatus: "DRAFT" | "PENDING" | "APPROVED" | "REJECTED" | "RETURNED";
  approvalComments?: string;
  approvalId?: string;
  remarks?: string;
  fdReceiptUrl?: string;
  bankAdviceUrl?: string;
  createdBy: string;
  createdByName: string;
  createdAt: Timestamp;
  updatedBy: string;
  updatedByName: string;
  updatedAt: Timestamp;
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: Timestamp;
  workflowStage?:
    | "DRAFT"
    | "FINANCE_VERIFICATION"
    | "AUTHORIZED_APPROVAL"
    | "BANK_CONFIRMATION"
    | "COMPLETED";
  currentAssigneeIds?: string[];
  holdReason?: string;
  reopenedAt?: Timestamp;
  isDeleted: boolean;
}

export interface FDAssignment {
  id: string;
  organizationId: string;
  fdId: string;
  fdNumber: string;
  instrumentType: "BG" | "LC";
  instrumentId: string;
  instrumentNumber: string;
  bankId: string;
  bankName: string;
  projectId?: string;
  projectName?: string;
  partyName?: string;
  assignmentAmount: number;
  releasedAmount: number;
  activeAmount: number;
  assignmentDate: Timestamp;
  obligationEndDate?: Timestamp | null;
  expectedReleaseDate?: Timestamp | null;
  actualReleaseDate?: Timestamp | null;
  marginPercentage?: number;
  purpose?: string;
  status: FDAssignmentStatus;
  approvalId?: string;
  reservationId?: string;
  previousFdId?: string;
  previousAssignmentId?: string;
  remarks?: string;
  createdBy: string;
  createdByName: string;
  createdAt: Timestamp;
  updatedBy: string;
  updatedByName?: string;
  updatedAt: Timestamp;
  releasedBy?: string;
  releasedByName?: string;
  releaseReference?: string;
  exceptionApproved?: boolean;
  exceptionReason?: string;
  reservationExpiryDate?: Timestamp | null;
}

export interface FDReservation {
  id: string;
  organizationId: string;
  fdId: string;
  fdNumber: string;
  assignmentId: string;
  instrumentType: "BG" | "LC";
  instrumentId: string;
  instrumentNumber: string;
  amount: number;
  reservedAt: Timestamp;
  expiryDate: Timestamp;
  status: "ACTIVE" | "CONVERTED" | "EXPIRED" | "CANCELLED";
  createdBy: string;
  createdByName: string;
  releasedAt?: Timestamp;
  releasedBy?: string;
  remarks?: string;
}

export interface FDRenewal {
  id: string;
  organizationId: string;
  oldFdId: string;
  oldFdNumber: string;
  newFdId?: string;
  newFdNumber?: string;
  oldPrincipalAmount: number;
  oldMaturityAmount: number;
  interestReceived: number;
  tdsAmount: number;
  renewalPrincipalAmount: number;
  additionalDepositAmount: number;
  withdrawalAmount: number;
  newInterestRate: number;
  newMaturityDate: Timestamp;
  newMaturityAmount: number;
  renewalRequestDate: Timestamp;
  bankSubmissionDate?: Timestamp | null;
  bankConfirmationDate?: Timestamp | null;
  renewalReason?: string;
  bankConfirmationReference?: string;
  approvalId?: string;
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: Timestamp;
  assignmentsTransferred: boolean;
  status:
    | "REQUESTED"
    | "PENDING_APPROVAL"
    | "SUBMITTED_TO_BANK"
    | "RENEWED"
    | "REJECTED"
    | "CANCELLED";
  remarks?: string;
  createdBy: string;
  createdByName: string;
  createdAt: Timestamp;
}

export interface FDClosure {
  id: string;
  organizationId: string;
  fdId: string;
  fdNumber: string;
  closureType: "NORMAL_MATURITY" | "PREMATURE" | "PARTIAL" | "AFTER_RENEWAL";
  requestDate: Timestamp;
  proposedClosureDate: Timestamp;
  actualClosureDate?: Timestamp | null;
  principalAmount: number;
  expectedInterest: number;
  actualInterest: number;
  tdsAmount: number;
  penaltyAmount: number;
  otherCharges: number;
  netProceeds: number;
  creditAccountId: string;
  bankReference?: string;
  activeAssignmentCount: number;
  blockingAssignmentAmount: number;
  status:
    | "REQUESTED"
    | "PENDING_APPROVAL"
    | "SUBMITTED_TO_BANK"
    | "BANK_CONFIRMED"
    | "AMOUNT_RECEIVED"
    | "COMPLETED"
    | "REJECTED"
    | "CANCELLED";
  approvalId?: string;
  approvalNote?: string;
  supportingDocumentUrl?: string;
  financialLoss?: number;
  remarks?: string;
  createdBy: string;
  createdByName: string;
  createdAt: Timestamp;
}

export interface FDReleaseRequest {
  id: string;
  organizationId: string;
  assignmentId: string;
  fdId: string;
  fdNumber: string;
  instrumentType: "BG" | "LC";
  instrumentNumber: string;
  releaseType: "PARTIAL" | "FULL";
  releaseAmount: number;
  requestDate: Timestamp;
  effectiveReleaseDate: Timestamp;
  reason: string;
  bankConfirmationReference?: string;
  supportingDocumentUrl?: string;
  authorizedOverride: boolean;
  status:
    | "REQUESTED"
    | "PENDING_APPROVAL"
    | "APPROVED"
    | "COMPLETED"
    | "REJECTED"
    | "CANCELLED";
  approvalId?: string;
  createdBy: string;
  createdByName: string;
  createdAt: Timestamp;
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: Timestamp;
  comments?: string;
}

export interface FDReplacementRequest {
  id: string;
  organizationId: string;
  oldFdId: string;
  oldFdNumber: string;
  oldAssignmentId: string;
  replacementFdId: string;
  replacementFdNumber: string;
  replacementAmount: number;
  reason: string;
  bankConfirmationReference?: string;
  status:
    | "REQUESTED"
    | "PENDING_APPROVAL"
    | "APPROVED"
    | "NEW_ASSIGNMENT_ACTIVE"
    | "BANK_CONFIRMED"
    | "COMPLETED"
    | "REJECTED"
    | "CANCELLED";
  approvalId?: string;
  newAssignmentId?: string;
  createdBy: string;
  createdByName: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  approvedBy?: string;
  approvedAt?: Timestamp;
}

export interface FDDocument {
  id: string;
  organizationId: string;
  fdId: string;
  documentType: string;
  fileName: string;
  fileUrl: string;
  storagePath: string;
  version: number;
  expiryDate?: Timestamp | null;
  remarks?: string;
  status: "ACTIVE" | "ARCHIVED";
  uploadedBy: string;
  uploadedByName: string;
  uploadedAt: Timestamp;
}

export interface FDInterestTransaction {
  id: string;
  organizationId: string;
  fdId: string;
  fdNumber: string;
  transactionDate: Timestamp;
  expectedAmount: number;
  receivedAmount: number;
  tdsAmount: number;
  bankReference?: string;
  remarks?: string;
  createdBy: string;
  createdAt: Timestamp;
}

export interface FDAuditEntry {
  id: string;
  organizationId: string;
  module: "Fixed Deposit Management";
  recordType:
    | "FD"
    | "ASSIGNMENT"
    | "RENEWAL"
    | "CLOSURE"
    | "RELEASE"
    | "REPLACEMENT"
    | "DOCUMENT"
    | "SETTINGS"
    | "IMPORT";
  recordId: string;
  fdId?: string;
  action: string;
  summary: string;
  previousValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  reason?: string;
  approvalReference?: string;
  userId: string;
  userName: string;
  userRole?: string;
  page?: string;
  createdAt: Timestamp;
}

export interface FDApprovalRecord {
  id: string;
  organizationId: string;
  module: "Fixed Deposit Management";
  recordType:
    "FD" | "ASSIGNMENT" | "RENEWAL" | "CLOSURE" | "RELEASE" | "REPLACEMENT";
  recordId: string;
  fdId?: string;
  amount: number;
  requestedBy: string;
  requestedByName: string;
  requestedAt: Timestamp;
  requiredRole: string;
  status:
    | "PENDING"
    | "APPROVED"
    | "REJECTED"
    | "RETURNED"
    | "ON_HOLD"
    | "DOCUMENTS_REQUESTED";
  decidedBy?: string;
  decidedByName?: string;
  decidedAt?: Timestamp;
  comments?: string;
}

export interface FDApprovalRule {
  id: string;
  minimumAmount: number;
  maximumAmount: number | null;
  approverUserId?: string;
  approverRole: string;
  approverName?: string;
}

export interface FixedDepositSettings {
  organizationId: string;
  referencePrefix: string;
  defaultCurrency: string;
  defaultEligibleMarginPercentage: number;
  maturityAlertDays: number[];
  reservationExpiryDays: number;
  tdsPercentage: number;
  requireFdReceipt: boolean;
  requireBankAdvice: boolean;
  requireDebitAdvice: boolean;
  requireApprovalNote: boolean;
  requireLienConfirmation: boolean;
  allowCrossBankAssignment: boolean;
  requireAssignmentApproval: boolean;
  allowMaturityException: boolean;
  minimumMaturityBufferDays: number;
  mandatoryDocumentTypes: string[];
  escalationRules: Array<{ days: number; roles: string[]; critical?: boolean }>;
  notificationChannels: { inApp: boolean; email: boolean; push: boolean };
  approvalRules: FDApprovalRule[];
  projectAccess: Record<string, string[]>;
  updatedAt?: Timestamp;
  updatedBy?: string;
}

export const DEFAULT_FD_SETTINGS: FixedDepositSettings = {
  organizationId: "default",
  referencePrefix: "FD",
  defaultCurrency: "INR",
  defaultEligibleMarginPercentage: 100,
  maturityAlertDays: [7, 30, 60, 90],
  reservationExpiryDays: 15,
  tdsPercentage: 10,
  requireFdReceipt: true,
  requireBankAdvice: false,
  requireDebitAdvice: true,
  requireApprovalNote: true,
  requireLienConfirmation: true,
  allowCrossBankAssignment: false,
  requireAssignmentApproval: true,
  allowMaturityException: false,
  minimumMaturityBufferDays: 0,
  mandatoryDocumentTypes: ["FD_RECEIPT", "BANK_DEBIT_ADVICE", "APPROVAL_NOTE"],
  escalationRules: [
    { days: 90, roles: ["Finance Executive"] },
    { days: 60, roles: ["Finance Executive", "Finance Manager"] },
    { days: 30, roles: ["Finance Manager"] },
    { days: 15, roles: ["Finance Manager", "Director Finance"] },
    { days: 7, roles: ["Director Finance"], critical: true },
    { days: 0, roles: ["Director Finance", "Management"], critical: true },
  ],
  notificationChannels: { inApp: true, email: false, push: false },
  approvalRules: [
    {
      id: "finance-manager",
      minimumAmount: 0,
      maximumAmount: 1_000_000,
      approverRole: "Finance Manager",
    },
    {
      id: "director-finance",
      minimumAmount: 1_000_000.01,
      maximumAmount: 5_000_000,
      approverRole: "Director Finance",
    },
    {
      id: "managing-director",
      minimumAmount: 5_000_000.01,
      maximumAmount: null,
      approverRole: "Managing Director",
    },
  ],
  projectAccess: {},
};

export interface FixedDepositDraft {
  referenceNumber: string;
  fdNumber: string;
  bankId: string;
  sourceAccountId: string;
  projectId: string;
  holderName: string;
  holderType: string;
  jointHolderName: string;
  nomineeName: string;
  pan: string;
  beneficialOwner: string;
  fdType: string;
  depositCategory: string;
  purpose: string;
  sourceOfFunds: string;
  currency: string;
  principalAmount: number;
  interestRate: number;
  interestCalculationMethod: string;
  interestPaymentFrequency: string;
  tenureDays: number;
  tenureMonths: number;
  creationDate: string;
  valueDate: string;
  maturityDate: string;
  expectedInterest: number;
  maturityAmount: number;
  expectedTds: number;
  expectedNetProceeds: number;
  prematureClosurePenalty: number;
  eligibleMarginPercentage: number;
  lienMarked: boolean;
  lienHolder: string;
  lienDate: string;
  lienAmount: number;
  lienPurpose: string;
  bankConfirmationReference: string;
  autoRenewal: boolean;
  documentComplete: boolean;
  remarks: string;
}

export const blankFixedDeposit = (
  settings = DEFAULT_FD_SETTINGS,
): FixedDepositDraft => ({
  referenceNumber: "",
  fdNumber: "",
  bankId: "",
  sourceAccountId: "",
  projectId: "",
  holderName: "",
  holderType: "Organization",
  jointHolderName: "",
  nomineeName: "",
  pan: "",
  beneficialOwner: "",
  fdType: "REGULAR",
  depositCategory: "",
  purpose: "GENERAL_INVESTMENT",
  sourceOfFunds: "Current Account",
  currency: settings.defaultCurrency,
  principalAmount: 0,
  interestRate: 0,
  interestCalculationMethod: "COMPOUND",
  interestPaymentFrequency: "On maturity",
  tenureDays: 0,
  tenureMonths: 12,
  creationDate: new Date().toISOString().slice(0, 10),
  valueDate: new Date().toISOString().slice(0, 10),
  maturityDate: "",
  expectedInterest: 0,
  maturityAmount: 0,
  expectedTds: 0,
  expectedNetProceeds: 0,
  prematureClosurePenalty: 0,
  eligibleMarginPercentage: settings.defaultEligibleMarginPercentage,
  lienMarked: false,
  lienHolder: "",
  lienDate: "",
  lienAmount: 0,
  lienPurpose: "",
  bankConfirmationReference: "",
  autoRenewal: false,
  documentComplete: false,
  remarks: "",
});

export const fdStatusLabel = (status?: string) =>
  (status || "DRAFT")
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

export const toDate = (value?: Timestamp | Date | string | null) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "object" && "toDate" in value) return value.toDate();
  return null;
};

export const toDateInput = (value?: Timestamp | Date | string | null) => {
  const parsed = toDate(value);
  return parsed ? parsed.toISOString().slice(0, 10) : "";
};

export const daysUntil = (value?: Timestamp | Date | string | null) => {
  const target = toDate(value);
  if (!target) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / 86_400_000);
};

export const calculateEligibleValue = (principal: number, percentage: number) =>
  Math.max(0, Number(((principal * percentage) / 100).toFixed(2)));

export const calculateAvailableAmount = (
  eligibleValue: number,
  bgUtilized: number,
  lcUtilized: number,
  reserved: number,
) =>
  Math.max(
    0,
    Number((eligibleValue - bgUtilized - lcUtilized - reserved).toFixed(2)),
  );

export const ACTIVE_FD_STATUSES: FDStatus[] = [
  "ACTIVE",
  "PARTIALLY_UTILIZED",
  "FULLY_UTILIZED",
  "MATURITY_APPROACHING",
];

export const CLOSED_FD_STATUSES: FDStatus[] = [
  "CLOSED",
  "PREMATURELY_CLOSED",
  "CANCELLED",
  "RENEWED",
  "REPLACED",
];

export const ACTIVE_ASSIGNMENT_STATUSES: FDAssignmentStatus[] = [
  "ACTIVE",
  "PARTIALLY_RELEASED",
];

export const RESERVED_ASSIGNMENT_STATUSES: FDAssignmentStatus[] = [
  "RESERVED",
  "PENDING_APPROVAL",
];

export const isActiveFd = (
  fd: Pick<FixedDeposit, "status" | "maturityDate">,
  asOn = new Date(),
) => {
  if (!ACTIVE_FD_STATUSES.includes(fd.status)) return false;
  const maturity = toDate(fd.maturityDate);
  if (!maturity) return true;
  maturity.setHours(0, 0, 0, 0);
  const startOfAsOn = new Date(asOn);
  startOfAsOn.setHours(0, 0, 0, 0);
  return maturity.getTime() >= startOfAsOn.getTime();
};

export const assignmentOutstanding = (
  assignment: Pick<
    FDAssignment,
    "assignmentAmount" | "releasedAmount" | "activeAmount"
  >,
) =>
  Math.max(
    0,
    Number(
      (
        Number(assignment.activeAmount) ||
        Number(assignment.assignmentAmount || 0) -
          Number(assignment.releasedAmount || 0)
      ).toFixed(2),
    ),
  );

export const financialYearForDate = (
  value?: Timestamp | Date | string | null,
) => {
  const date = toDate(value) || new Date();
  const startYear =
    date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
};

export const calculateMaturity = (input: {
  principal: number;
  annualRate: number;
  tenureDays?: number;
  tenureMonths?: number;
  method: string;
  frequency: string;
  manualMaturityAmount?: number;
  tdsPercentage?: number;
}) => {
  const years = input.tenureDays
    ? input.tenureDays / 365
    : (input.tenureMonths || 0) / 12;
  const principal = Math.max(0, input.principal || 0);
  const annualRate = Math.max(0, input.annualRate || 0) / 100;
  let maturityAmount = principal;
  if (input.method === "MANUAL" || input.method === "BANK_PROVIDED") {
    maturityAmount = Math.max(
      principal,
      input.manualMaturityAmount || principal,
    );
  } else if (input.method === "SIMPLE") {
    maturityAmount = principal * (1 + annualRate * years);
  } else {
    const compounds =
      input.frequency === "Monthly"
        ? 12
        : input.frequency === "Quarterly"
          ? 4
          : input.frequency === "Half-yearly"
            ? 2
            : 1;
    maturityAmount =
      principal * Math.pow(1 + annualRate / compounds, compounds * years);
  }
  maturityAmount = Number(maturityAmount.toFixed(2));
  const expectedInterest = Number(
    Math.max(0, maturityAmount - principal).toFixed(2),
  );
  const expectedTds = Number(
    (expectedInterest * ((input.tdsPercentage || 0) / 100)).toFixed(2),
  );
  return {
    expectedInterest,
    maturityAmount,
    expectedTds,
    expectedNetProceeds: Number((maturityAmount - expectedTds).toFixed(2)),
  };
};

export const deriveOperationalStatus = (fd: FixedDeposit): FDStatus => {
  if (
    [
      "ON_HOLD",
      "CANCELLED",
      "REPLACED",
      "PREMATURELY_CLOSED",
      "CLOSED",
      "RENEWED",
    ].includes(fd.status)
  )
    return fd.status;
  if (
    [
      "DRAFT",
      "PENDING_APPROVAL",
      "APPROVED",
      "RENEWAL_PENDING",
      "CLOSURE_PENDING",
    ].includes(fd.status)
  )
    return fd.status;
  const remaining = daysUntil(fd.maturityDate);
  if (remaining !== null && remaining < 0) return "MATURED";
  if (fd.availableAmount <= 0) return "FULLY_UTILIZED";
  if (fd.availableAmount < fd.eligibleValue) return "PARTIALLY_UTILIZED";
  if (remaining !== null && remaining <= 90) return "MATURITY_APPROACHING";
  return "ACTIVE";
};

export const formatFdCurrency = (value: number, currency = "INR") =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

export const escapeCsv = (value: unknown) => {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

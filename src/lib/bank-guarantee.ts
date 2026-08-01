import type { Timestamp } from "firebase/firestore";

export const BG_PERMISSION_MODULE = "Bank Guarantee Management";

export const BG_COLLECTIONS = {
  requests: "bgRequests",
  guarantees: "bankGuarantees",
  movements: "bgMovements",
  acknowledgements: "bgAcknowledgements",
  extensions: "bgExtensions",
  amendments: "bgAmendments",
  commissions: "bgCommissions",
  invocations: "bgInvocations",
  cancellations: "bgCancellations",
  documents: "bgDocuments",
  cashMargins: "bgCashMargins",
  marginReleases: "bgMarginReleases",
  replacements: "bgReplacements",
  lostOriginals: "bgLostOriginals",
  exceptions: "bgExceptions",
  automationRuns: "bgAutomationRuns",
  limitReservations: "bankLimitReservations",
  bankLimits: "bankLimits",
  beneficiaries: "beneficiaries",
  contracts: "contracts",
  approvals: "approvals",
  audit: "auditLogs",
  notifications: "userNotifications",
  settings: "bankGuaranteeSettings",
  counters: "bgCounters",
  uniqueKeys: "bgUniqueKeys",
} as const;

export const BG_SETTINGS_PATH = ["settings", "bankGuarantee"] as const;

export const BG_PURPOSES = [
  "EARNEST_MONEY_DEPOSIT",
  "BID_SECURITY",
  "PERFORMANCE_BANK_GUARANTEE",
  "CONTRACT_PERFORMANCE_GUARANTEE",
  "ADVANCE_BANK_GUARANTEE",
  "RETENTION_BANK_GUARANTEE",
  "SECURITY_DEPOSIT_GUARANTEE",
  "PAYMENT_GUARANTEE",
  "SUPPLY_GUARANTEE",
  "ERECTION_GUARANTEE",
  "MOBILISATION_ADVANCE_GUARANTEE",
  "WARRANTY_GUARANTEE",
  "CUSTOMS_GUARANTEE",
  "STATUTORY_GUARANTEE",
  "OTHER",
] as const;

export const BG_MARGIN_TYPES = [
  ["FD", "Fixed Deposit"],
  ["CASH", "Cash Margin"],
  ["PROPERTY", "Property Collateral"],
  ["COMBINED", "Combined FD and Cash"],
  ["SECURITY_POOL", "Existing Security Pool"],
  ["NONE", "No Margin"],
  ["OTHER", "Other"],
] as const;

export const BG_REQUEST_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "UNDER_VERIFICATION",
  "PENDING_PROJECT_APPROVAL",
  "PENDING_COMMERCIAL_APPROVAL",
  "PENDING_FINANCE_APPROVAL",
  "PENDING_DIRECTOR_APPROVAL",
  "APPROVED",
  "ISSUED",
  "RETURNED",
  "REJECTED",
  "CANCELLED",
] as const;

export const BG_OPERATIONAL_STATUSES = [
  "APPROVED_FOR_ISSUANCE",
  "SUBMITTED_TO_BANK",
  "BANK_QUERY",
  "ISSUED",
  "ACTIVE",
  "EXTENSION_DUE",
  "EXTENSION_PENDING",
  "AMENDMENT_PENDING",
  "EXPIRED",
  "CLAIM_PERIOD_ACTIVE",
  "INVOCATION_NOTICE_RECEIVED",
  "INVOKED",
  "CANCELLATION_REQUESTED",
  "BANK_CANCELLATION_PENDING",
  "MARGIN_RELEASE_PENDING",
  "CANCELLED",
  "CLOSED",
  "REPLACED",
  "ON_HOLD",
] as const;

export type BGRequestStatus = (typeof BG_REQUEST_STATUSES)[number];
export type BGOperationalStatus = (typeof BG_OPERATIONAL_STATUSES)[number];

export interface BGRequest {
  id: string;
  organizationId: string;
  organizationName?: string;
  referenceNumber: string;
  requestDate: Timestamp;
  requestedBy: string;
  requestedByName?: string;
  departmentId?: string;
  departmentName?: string;
  projectId: string;
  projectName: string;
  beneficiaryId: string;
  beneficiaryName: string;
  beneficiaryAddress?: string;
  beneficiaryEmail?: string;
  beneficiaryContactPerson?: string;
  beneficiaryDepartment?: string;
  beneficiaryClientCode?: string;
  beneficiaryBgFormat?: string;
  contractId?: string;
  contractReference?: string;
  tenderNumber?: string;
  contractNumber?: string;
  workOrderNumber?: string;
  contractDate?: Timestamp | null;
  contractCompletionDate?: Timestamp | null;
  defectLiabilityEndDate?: Timestamp | null;
  warrantyEndDate?: Timestamp | null;
  clientBgFormat?: string;
  contractValue: number;
  bgPercentage: number;
  requiredBgAmount: number;
  existingBgAmount: number;
  balanceBgRequirement: number;
  purpose: string;
  description?: string;
  currency: string;
  exchangeRate: number;
  requestedAmount: number;
  baseCurrencyAmount: number;
  requiredIssueDate: Timestamp;
  proposedStartDate: Timestamp;
  proposedExpiryDate: Timestamp;
  proposedClaimExpiryDate: Timestamp;
  claimPeriodDays: number;
  claimPeriodType?: "DAYS" | "MONTHS" | "FIXED_DATE" | "BENEFICIARY_FORMAT";
  claimDateOverrideReason?: string;
  autoExtensionClause: boolean;
  preferredBankId: string;
  preferredBankName: string;
  bankLimitId?: string;
  preferredBranchName?: string;
  marginType: string;
  marginPercentage: number;
  requiredMarginAmount: number;
  fdMarginAmount: number;
  cashMarginAmount: number;
  otherCollateralAmount: number;
  estimatedCommission: number;
  estimatedGst: number;
  estimatedOtherCharges: number;
  debitAccountId?: string;
  status: BGRequestStatus;
  approvalStatus: "DRAFT" | "PENDING" | "APPROVED" | "RETURNED" | "REJECTED";
  workflowStage: string;
  approvalId?: string;
  limitReservationId?: string;
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: Timestamp | null;
  remarks?: string;
  createdBy: string;
  createdByName?: string;
  createdAt: Timestamp;
  updatedBy: string;
  updatedByName?: string;
  updatedAt: Timestamp;
  isDeleted: boolean;
}

export interface BankGuarantee {
  id: string;
  organizationId: string;
  organizationName?: string;
  requestId: string;
  requestReference: string;
  internalReferenceNumber: string;
  bankBgNumber: string;
  bankId: string;
  bankName: string;
  branchId?: string;
  branchName?: string;
  bankLimitId?: string;
  beneficiaryId: string;
  beneficiaryName: string;
  projectId: string;
  projectName: string;
  contractId?: string;
  contractReference?: string;
  purpose: string;
  currency: string;
  exchangeRate: number;
  originalAmount: number;
  currentAmount: number;
  baseCurrencyAmount: number;
  issueDate: Timestamp;
  effectiveDate?: Timestamp | null;
  startDate: Timestamp;
  originalExpiryDate: Timestamp;
  currentExpiryDate: Timestamp;
  originalClaimExpiryDate: Timestamp;
  currentClaimExpiryDate: Timestamp;
  claimPeriodDays: number;
  autoExtensionClause: boolean;
  marginPercentage: number;
  requiredMarginAmount: number;
  fdMarginAmount: number;
  cashMarginAmount: number;
  otherCollateralAmount: number;
  openingCommission: number;
  extensionCommission: number;
  amendmentCommission: number;
  internalCommission: number;
  bankCommission: number;
  commissionDifference: number;
  gstAmount: number;
  otherCharges: number;
  totalCharges: number;
  originalReceived: boolean;
  originalReceivedDate?: Timestamp | null;
  numberOfOriginals: number;
  numberOfCopies: number;
  originalDispatched: boolean;
  beneficiaryAcknowledged: boolean;
  originalReturned: boolean;
  currentCustodian?: string;
  invocationAmount: number;
  marginReleasedAmount: number;
  status: BGOperationalStatus;
  extensionDecision?: string;
  bankCancellationConfirmed: boolean;
  closureDate?: Timestamp | null;
  documentComplete: boolean;
  debitAccountId?: string;
  remarks?: string;
  createdBy: string;
  createdByName?: string;
  createdAt: Timestamp;
  updatedBy: string;
  updatedByName?: string;
  updatedAt: Timestamp;
  isDeleted: boolean;
}

export interface BGExtension {
  id: string;
  organizationId: string;
  bgId: string;
  bgNumber: string;
  extensionReference: string;
  requestDate: Timestamp;
  previousExpiryDate: Timestamp;
  proposedExpiryDate: Timestamp;
  approvedExpiryDate?: Timestamp | null;
  previousClaimExpiryDate: Timestamp;
  proposedClaimExpiryDate: Timestamp;
  approvedClaimExpiryDate?: Timestamp | null;
  reason: string;
  clientRequestReference?: string;
  additionalMarginAmount: number;
  additionalCommission: number;
  gstAmount: number;
  otherCharges: number;
  bankSubmissionDate?: Timestamp | null;
  bankConfirmationDate?: Timestamp | null;
  effectiveDate?: Timestamp | null;
  beneficiaryAcknowledged: boolean;
  status: string;
  approvalId?: string;
  createdBy: string;
  createdByName?: string;
  createdAt: Timestamp;
}

export interface BGCommission {
  id: string;
  organizationId: string;
  bgId: string;
  bgNumber: string;
  bankId: string;
  bankName: string;
  commissionType: string;
  calculationFromDate: Timestamp;
  calculationToDate: Timestamp;
  calculationBasis: string;
  bgAmount: number;
  commissionRate: number;
  calculatedCommission: number;
  bankChargedCommission: number;
  gstAmount: number;
  otherCharges: number;
  differenceAmount: number;
  reconciliationStatus: string;
  bankAdviceReference?: string;
  transactionDate?: Timestamp | null;
  remarks?: string;
  createdAt?: Timestamp;
}

export interface BGInvocation {
  id: string;
  organizationId: string;
  bgId: string;
  bgNumber: string;
  beneficiaryName: string;
  noticeNumber: string;
  noticeDate: Timestamp;
  receivedDate: Timestamp;
  claimType: "PARTIAL" | "FULL";
  claimedAmount: number;
  claimReason: string;
  claimWithinValidity: boolean;
  legalReviewRequired: boolean;
  projectResponse?: string;
  commercialResponse?: string;
  legalOpinion?: string;
  financeResponse?: string;
  bankReference?: string;
  settlementAmount?: number;
  settlementDate?: Timestamp | null;
  status: string;
  createdBy: string;
  createdByName?: string;
  createdAt: Timestamp;
}

export interface BGCancellation {
  id: string;
  organizationId: string;
  bgId: string;
  bgNumber: string;
  requestDate: Timestamp;
  reason: string;
  projectCompletionConfirmed: boolean;
  clientReleaseReceived: boolean;
  originalBgReturned: boolean;
  noClaimConfirmationReceived: boolean;
  bankSubmissionDate?: Timestamp | null;
  bankReference?: string;
  bankConfirmationDate?: Timestamp | null;
  cancellationEffectiveDate?: Timestamp | null;
  fdReleaseAmount: number;
  cashMarginReleaseAmount: number;
  otherCollateralReleaseAmount: number;
  status: string;
  approvalId?: string;
  remarks?: string;
  createdBy: string;
  createdByName?: string;
  createdAt: Timestamp;
}

export interface BGSettings {
  organizationId: string;
  referencePrefix: string;
  baseCurrency: string;
  expiryAlertDays: number[];
  claimAlertDays: number[];
  defaultClaimPeriodDays: number;
  reservationExpiryDays: number;
  requireMarginBeforeIssuance: boolean;
  requireBankCancellationConfirmation: boolean;
  requireBeneficiaryRelease: boolean;
  requireOriginalReturn: boolean;
  allowCrossBankFdWithApproval: boolean;
  allowManualDateOverride: boolean;
  mandatoryRequestDocuments: string[];
  mandatoryIssuanceDocuments: string[];
  mandatoryCancellationDocuments: string[];
  mandatoryExtensionDocuments: string[];
  mandatoryInvocationDocuments: string[];
  mandatoryClosureDocuments: string[];
  approvalThresholds: Array<{ amount: number; role: string }>;
  escalationRules: Array<{
    condition: string;
    afterDays: number;
    recipientRole: string;
    escalationRole: string;
  }>;
  notificationChannels: string[];
  purposes: string[];
}

export const DEFAULT_BG_SETTINGS: BGSettings = {
  organizationId: "default",
  referencePrefix: "BG",
  baseCurrency: "INR",
  expiryAlertDays: [120, 90, 60, 30, 15, 7, 3, 1],
  claimAlertDays: [30, 15, 7, 1],
  defaultClaimPeriodDays: 90,
  reservationExpiryDays: 30,
  requireMarginBeforeIssuance: true,
  requireBankCancellationConfirmation: true,
  requireBeneficiaryRelease: true,
  requireOriginalReturn: true,
  allowCrossBankFdWithApproval: true,
  allowManualDateOverride: true,
  mandatoryRequestDocuments: [
    "Contract, tender or work order",
    "Beneficiary BG format",
    "BG requirement note",
  ],
  mandatoryIssuanceDocuments: [
    "Approved BG request",
    "Bank application",
    "Margin confirmation",
  ],
  mandatoryCancellationDocuments: [
    "Beneficiary release or original BG",
    "Bank cancellation confirmation",
  ],
  mandatoryExtensionDocuments: [
    "Client extension request or project confirmation",
    "Extension approval note",
  ],
  mandatoryInvocationDocuments: [
    "Invocation notice",
    "Legal review note",
  ],
  mandatoryClosureDocuments: [
    "Bank cancellation confirmation",
    "Margin release confirmation",
  ],
  approvalThresholds: [
    { amount: 1_000_000, role: "Finance Manager" },
    { amount: 5_000_000, role: "Director Finance" },
    { amount: 20_000_000, role: "Director" },
    { amount: 999_999_999_999, role: "Managing Director" },
  ],
  escalationRules: [
    {
      condition: "Approval pending",
      afterDays: 2,
      recipientRole: "Assigned Approver",
      escalationRole: "Finance Manager",
    },
    {
      condition: "Cancellation pending",
      afterDays: 15,
      recipientRole: "Finance Manager",
      escalationRole: "Director Finance",
    },
    {
      condition: "Margin release pending",
      afterDays: 15,
      recipientRole: "Finance Manager",
      escalationRole: "Director Finance",
    },
  ],
  notificationChannels: ["IN_APP", "DASHBOARD"],
  purposes: [...BG_PURPOSES],
};

export const roundBg = (value: number) => Number(Number(value || 0).toFixed(2));
export const calculateRequiredBgAmount = (
  contractValue: number,
  percentage: number,
) => roundBg((contractValue * percentage) / 100);
export const calculateBgMargin = (amount: number, percentage: number) =>
  roundBg((amount * percentage) / 100);
export const calculateBgAvailableLimit = (
  sanctioned: number,
  temporary: number,
  utilised: number,
  reserved: number,
) => Math.max(0, roundBg(sanctioned + temporary - utilised - reserved));
export const calculateCommission = (
  amount: number,
  annualRate: number,
  from: Date,
  to: Date,
  basis = "DAILY",
  minimum = 0,
) => {
  const days = Math.max(
    1,
    Math.ceil((to.getTime() - from.getTime()) / 86400000),
  );
  const chargedDays =
    basis === "QUARTERLY_OR_PART"
      ? Math.ceil(days / 90) * 90
      : basis === "MONTHLY"
        ? Math.ceil(days / 30) * 30
        : days;
  return Math.max(
    roundBg((((amount * annualRate) / 100) * chargedDays) / 365),
    minimum,
  );
};

export function toBgDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? null : value;
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate: () => Date }).toDate === "function"
  )
    return (value as { toDate: () => Date }).toDate();
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

export const toBgDateInput = (value: unknown) => {
  const date = toBgDate(value);
  return date ? date.toISOString().slice(0, 10) : "";
};
export const daysToBgDate = (value: unknown) => {
  const date = toBgDate(value);
  return date
    ? Math.ceil((date.getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000)
    : null;
};
export const addBgDays = (value: string | Date, days: number) => {
  const date =
    value instanceof Date ? new Date(value) : new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
};
export const financialYearForBgDate = (date: Date) =>
  date.getMonth() >= 3
    ? `${date.getFullYear()}-${String(date.getFullYear() + 1).slice(-2)}`
    : `${date.getFullYear() - 1}-${String(date.getFullYear()).slice(-2)}`;
export const formatBgCurrency = (value: number, currency = "INR") =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
export const bgLabel = (value: unknown) =>
  String(value || "")
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());
export const bgStatusTone = (value: unknown) => {
  const status = String(value || "").toUpperCase();
  if (
    ["CLOSED", "CANCELLED", "COMPLETED", "APPROVED", "ACTIVE", "MATCHED"].some(
      (token) => status.includes(token),
    )
  )
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (
    ["INVOKED", "EXPIRED", "REJECTED", "OVERCHARGED", "SHORTFALL"].some(
      (token) => status.includes(token),
    )
  )
    return "bg-rose-50 text-rose-700 border-rose-200";
  if (
    ["PENDING", "DUE", "AWAITED", "CLAIM", "UNDER_REVIEW"].some((token) =>
      status.includes(token),
    )
  )
    return "bg-amber-50 text-amber-800 border-amber-200";
  return "bg-sky-50 text-sky-700 border-sky-200";
};

export function deriveBgStatus(
  bg: Pick<
    BankGuarantee,
    "status" | "currentExpiryDate" | "currentClaimExpiryDate"
  >,
  alertDays = 90,
): BGOperationalStatus {
  if (
    ["ON_HOLD", "INVOKED", "REPLACED", "CANCELLED", "CLOSED"].includes(
      bg.status,
    )
  )
    return bg.status;
  const expiry = daysToBgDate(bg.currentExpiryDate);
  const claim = daysToBgDate(bg.currentClaimExpiryDate);
  if (claim !== null && claim < 0) return "EXPIRED";
  if (expiry !== null && expiry < 0 && (claim === null || claim >= 0))
    return "CLAIM_PERIOD_ACTIVE";
  if (expiry !== null && expiry <= alertDays) return "EXTENSION_DUE";
  return "ACTIVE";
}

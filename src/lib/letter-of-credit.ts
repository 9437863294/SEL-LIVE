import type { Timestamp } from "firebase/firestore";

export const LC_PERMISSION_MODULE = "Letter of Credit Management" as const;

export const LC_COLLECTIONS = {
  requests: "lcRequests",
  credits: "lettersOfCredit",
  bankLimits: "bankLimits",
  shipments: "lcShipments",
  documents: "lcDocuments",
  hundis: "lcHundis",
  discrepancies: "lcDiscrepancies",
  payments: "lcPayments",
  amendments: "lcAmendments",
  vendorSettlements: "lcVendorSettlements",
  recoveries: "lcRecoveries",
  commissions: "lcCommissions",
  closures: "lcClosures",
  approvals: "approvals",
  audit: "auditLogs",
  notifications: "userNotifications",
  counters: "lcCounters",
  uniqueKeys: "lcUniqueKeys",
  legacyMaster: "lcManagementMaster",
  legacyDocuments: "lcManagementDocuments",
  legacyPayments: "lcManagementPayments",
  legacyAmendments: "lcManagementAmendments",
} as const;

export const LC_SETTINGS_PATH = ["settings", "letterOfCredit"] as const;

export const LC_REQUEST_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "UNDER_VERIFICATION",
  "PENDING_COMMERCIAL_APPROVAL",
  "PENDING_PROJECT_APPROVAL",
  "PENDING_FINANCE_APPROVAL",
  "PENDING_DIRECTOR_APPROVAL",
  "APPROVED",
  "OPENED",
  "REJECTED",
  "RETURNED",
  "CANCELLED",
] as const;

export const LC_OPERATIONAL_STATUSES = [
  "APPROVED_FOR_OPENING",
  "SUBMITTED_TO_BANK",
  "BANK_QUERY",
  "OPENED",
  "ACTIVE",
  "PARTIALLY_UTILIZED",
  "FULLY_UTILIZED",
  "AMENDMENT_PENDING",
  "DOCUMENTS_AWAITED",
  "HUNDI_AWAITED",
  "HUNDI_RECEIVED",
  "DISCREPANCY",
  "ACCEPTED",
  "PAYMENT_DUE",
  "PARTIALLY_PAID",
  "PAID",
  "CLOSURE_PENDING",
  "CLOSED",
  "CANCELLED",
  "EXPIRED",
  "ON_HOLD",
] as const;

export const LC_TYPES = [
  ["INLAND", "Inland LC"],
  ["FOREIGN", "Foreign LC"],
  ["SIGHT", "Sight LC"],
  ["USANCE", "Usance LC"],
  ["REVOLVING", "Revolving LC"],
  ["TRANSFERABLE", "Transferable LC"],
  ["BACK_TO_BACK", "Back-to-Back LC"],
  ["STANDBY", "Standby LC"],
  ["CONFIRMED", "Confirmed LC"],
  ["IRREVOCABLE", "Irrevocable LC"],
  ["DEFERRED", "Deferred Payment LC"],
  ["OTHER", "Other"],
] as const;

export const LC_MARGIN_TYPES = [
  ["FD", "FD Margin"],
  ["CASH", "Cash Margin"],
  ["PROPERTY", "Property Collateral"],
  ["COMBINED", "Combined Margin"],
  ["NONE", "No Margin"],
  ["OTHER", "Other"],
] as const;

export const LC_DUE_DATE_BASES = [
  ["INVOICE_DATE", "Invoice date"],
  ["HUNDI_ACCEPTANCE_DATE", "Hundi acceptance date"],
  ["BILL_OF_LADING_DATE", "Bill of lading date"],
  ["SHIPMENT_DATE", "Shipment date"],
  ["GOODS_RECEIPT_DATE", "Goods receipt date"],
  ["MRR_DATE", "MRR date"],
  ["BANK_NEGOTIATION_DATE", "Bank negotiation date"],
  ["DOCUMENT_RECEIPT_DATE", "Document receipt date"],
  ["CUSTOM", "Custom base date"],
] as const;

export const LC_HUNDI_STATUSES = [
  "NOT_RECEIVED",
  "RECEIVED",
  "UNDER_VERIFICATION",
  "DISCREPANT",
  "RETURNED_TO_VENDOR",
  "ACCEPTED",
  "PARTIALLY_ACCEPTED",
  "REJECTED",
  "PAID",
  "CLOSED",
] as const;

export const LC_PAYMENT_STATUSES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "PAYMENT_INITIATED",
  "PARTIALLY_PAID",
  "PAID",
  "REJECTED",
  "CANCELLED",
] as const;

export const LC_AMENDMENT_TYPES = [
  ["AMOUNT_INCREASE", "Amount Increase"],
  ["AMOUNT_REDUCTION", "Amount Reduction"],
  ["VALIDITY_EXTENSION", "Validity Extension"],
  ["SHIPMENT_EXTENSION", "Shipment Date Extension"],
  ["USANCE_CHANGE", "Change in Usance Period"],
  ["VENDOR_CHANGE", "Change of Vendor"],
  ["BENEFICIARY_BANK_CHANGE", "Change of Beneficiary Bank"],
  ["MATERIAL_CHANGE", "Change of Material"],
  ["QUANTITY_CHANGE", "Change of Quantity"],
  ["PROJECT_CHANGE", "Change of Project"],
  ["PORT_CHANGE", "Change of Port"],
  ["INCOTERM_CHANGE", "Change of Incoterm"],
  ["MARGIN_CHANGE", "Change of Margin"],
  ["CANCELLATION", "Cancellation"],
  ["OTHER", "Other"],
] as const;

export const LC_DOCUMENT_TYPES = [
  "PURCHASE_ORDER",
  "PROFORMA_INVOICE",
  "LC_FORMAT_OR_TERMS",
  "APPROVED_LC_REQUEST",
  "BANK_APPLICATION",
  "MARGIN_CONFIRMATION",
  "FINAL_LC_COPY",
  "SWIFT_MESSAGE",
  "BANK_DEBIT_ADVICE",
  "FD_LIEN_CONFIRMATION",
  "VENDOR_ACKNOWLEDGEMENT",
  "INVOICE",
  "HUNDI",
  "TRANSPORT_DOCUMENT",
  "MRR_OR_RECEIPT",
  "PAYMENT_APPROVAL",
  "BANK_INSTRUCTION",
  "BANK_CLOSURE_CONFIRMATION",
  "MARGIN_RELEASE_CONFIRMATION",
  "OTHER",
] as const;

export type LCRequestStatus = (typeof LC_REQUEST_STATUSES)[number];
export type LCOperationalStatus = (typeof LC_OPERATIONAL_STATUSES)[number];
export type LCHundiStatus = (typeof LC_HUNDI_STATUSES)[number];
export type LCPaymentStatus = (typeof LC_PAYMENT_STATUSES)[number];
export type LCDate = Timestamp | Date | string | null | undefined;

export interface LCRequest {
  id: string;
  organizationId: string;
  organizationName?: string;
  referenceNumber: string;
  requestDate: LCDate;
  requestedBy: string;
  requestedByName: string;
  departmentId?: string;
  departmentName?: string;
  projectId: string;
  projectName: string;
  vendorId: string;
  vendorName: string;
  vendorCode?: string;
  purchaseOrderId: string;
  purchaseOrderNumber: string;
  purchaseOrderAmount: number;
  existingLcAmount: number;
  balancePoValue: number;
  contractReference?: string;
  purpose: string;
  materialDescription: string;
  lcType: string;
  currency: string;
  requestedAmount: number;
  requiredOpeningDate: LCDate;
  proposedExpiryDate: LCDate;
  latestShipmentDate?: LCDate;
  sightOrUsance: "SIGHT" | "USANCE";
  usancePeriodDays: number;
  dueDateBasis: string;
  partialShipmentAllowed: boolean;
  transshipmentAllowed: boolean;
  partialDrawingAllowed: boolean;
  tolerancePercentage: number;
  presentationPeriodDays: number;
  incoterm?: string;
  specialConditions?: string;
  preferredBankId: string;
  preferredBankName: string;
  marginType: string;
  marginPercentage: number;
  requiredMarginAmount: number;
  fdMarginAmount: number;
  cashMarginAmount: number;
  otherCollateralAmount: number;
  estimatedCommission: number;
  estimatedCharges: number;
  clientRecoverable: boolean;
  expectedRecoverableAmount: number;
  status: LCRequestStatus;
  approvalStatus: "DRAFT" | "PENDING" | "APPROVED" | "REJECTED" | "RETURNED";
  workflowStage: string;
  approvalId?: string;
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: LCDate;
  remarks?: string;
  createdBy: string;
  createdByName: string;
  createdAt: LCDate;
  updatedBy: string;
  updatedByName: string;
  updatedAt: LCDate;
  isDeleted: boolean;
}

export interface LetterOfCredit {
  id: string;
  organizationId: string;
  organizationName?: string;
  requestId: string;
  requestReference: string;
  internalReferenceNumber: string;
  bankLcNumber: string;
  bankId: string;
  bankName: string;
  bankLimitId?: string;
  branchId?: string;
  branchName?: string;
  vendorId: string;
  vendorName: string;
  projectId: string;
  projectName: string;
  purchaseOrderId: string;
  purchaseOrderNumber: string;
  lcType: string;
  currency: string;
  exchangeRate: number;
  openedAmount: number;
  baseCurrencyAmount: number;
  openingDate: LCDate;
  effectiveDate?: LCDate;
  expiryDate: LCDate;
  latestShipmentDate?: LCDate;
  presentationPeriodDays: number;
  usancePeriodDays: number;
  dueDateBasis: string;
  expectedDueDate?: LCDate;
  actualDueDate?: LCDate;
  totalClaimedAmount: number;
  totalAcceptedAmount: number;
  totalRejectedAmount: number;
  totalPaidAmount: number;
  outstandingAmount: number;
  unutilizedAmount: number;
  marginPercentage: number;
  requiredMarginAmount: number;
  fdMarginAmount: number;
  cashMarginAmount: number;
  otherCollateralAmount: number;
  openingCommission: number;
  amendmentCommission: number;
  otherBankCharges: number;
  gstAmount: number;
  totalCharges: number;
  internalCommission: number;
  bankCommission: number;
  commissionDifference: number;
  clientRecoverable: boolean;
  recoverableAmount: number;
  recoveredAmount: number;
  balanceRecoverable: number;
  status: LCOperationalStatus;
  paymentStatus: string;
  closureDate?: LCDate;
  bankClosureConfirmed: boolean;
  documentComplete: boolean;
  createdBy: string;
  createdByName: string;
  createdAt: LCDate;
  updatedBy: string;
  updatedByName: string;
  updatedAt: LCDate;
  isDeleted: boolean;
}

export interface LCHundi {
  id: string;
  organizationId: string;
  lcId: string;
  lcNumber: string;
  hundiNumber: string;
  receiptDate: LCDate;
  bankReceiptDate?: LCDate;
  invoiceNumber: string;
  invoiceDate: LCDate;
  invoiceAmount: number;
  currency: string;
  claimedAmount: number;
  acceptedAmount: number;
  rejectedAmount: number;
  paidAmount: number;
  billOfLadingNumber?: string;
  shipmentDate?: LCDate;
  mrrNumber?: string;
  mrrDate?: LCDate;
  usancePeriodDays: number;
  dueDateBasis: string;
  baseDate: LCDate;
  calculatedDueDate: LCDate;
  approvedDueDate?: LCDate;
  status: LCHundiStatus;
  discrepancyCount: number;
  remarks?: string;
  createdBy: string;
  createdByName: string;
  createdAt: LCDate;
  updatedAt: LCDate;
}

export interface LCPayment {
  id: string;
  organizationId: string;
  lcId: string;
  lcNumber: string;
  hundiId?: string;
  hundiNumber?: string;
  vendorName: string;
  projectName: string;
  dueDate: LCDate;
  dueAmount: number;
  approvedAmount: number;
  paidAmount: number;
  paymentType: string;
  debitAccountId: string;
  paymentDate?: LCDate;
  transactionReference?: string;
  utrNumber?: string;
  bankCommission: number;
  gstAmount: number;
  otherCharges: number;
  exchangeDifference: number;
  netDebitAmount: number;
  status: LCPaymentStatus;
  approvalId?: string;
  remarks?: string;
  createdBy: string;
  createdByName: string;
  createdAt: LCDate;
  updatedAt: LCDate;
}

export interface LCAuditEntry {
  id: string;
  organizationId: string;
  module: typeof LC_PERMISSION_MODULE;
  recordType: string;
  recordId: string;
  lcId?: string;
  requestId?: string;
  action: string;
  summary: string;
  previousValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  reason?: string;
  userId: string;
  userName: string;
  userRole?: string;
  page?: string;
  createdAt: LCDate;
}

export interface LCSettings {
  organizationId: string;
  referencePrefix: string;
  baseCurrency: string;
  approvalThresholds: Array<{
    minimumAmount: number;
    maximumAmount: number | null;
    approverRole: string;
  }>;
  paymentAlertDays: number[];
  requirePo: boolean;
  requireMarginBeforeOpening: boolean;
  requireBankClosureConfirmation: boolean;
  allowCrossBankFdWithApproval: boolean;
  allowManualDueDateOverride: boolean;
  mandatoryRequestDocuments: string[];
  mandatoryOpeningDocuments: string[];
  mandatoryPaymentDocuments: string[];
  mandatoryClosureDocuments: string[];
}

export const DEFAULT_LC_SETTINGS: LCSettings = {
  organizationId: "default",
  referencePrefix: "LC",
  baseCurrency: "INR",
  approvalThresholds: [
    {
      minimumAmount: 0,
      maximumAmount: 1_000_000,
      approverRole: "Finance Manager",
    },
    {
      minimumAmount: 1_000_000.01,
      maximumAmount: 5_000_000,
      approverRole: "Director Finance",
    },
    {
      minimumAmount: 5_000_000.01,
      maximumAmount: 20_000_000,
      approverRole: "Director",
    },
    {
      minimumAmount: 20_000_000.01,
      maximumAmount: null,
      approverRole: "Managing Director",
    },
  ],
  paymentAlertDays: [60, 30, 15, 7, 3, 1, 0],
  requirePo: true,
  requireMarginBeforeOpening: true,
  requireBankClosureConfirmation: true,
  allowCrossBankFdWithApproval: true,
  allowManualDueDateOverride: true,
  mandatoryRequestDocuments: [
    "PURCHASE_ORDER",
    "PROFORMA_INVOICE",
    "LC_FORMAT_OR_TERMS",
  ],
  mandatoryOpeningDocuments: [
    "APPROVED_LC_REQUEST",
    "BANK_APPLICATION",
    "MARGIN_CONFIRMATION",
  ],
  mandatoryPaymentDocuments: ["HUNDI", "PAYMENT_APPROVAL", "BANK_INSTRUCTION"],
  mandatoryClosureDocuments: [
    "BANK_CLOSURE_CONFIRMATION",
    "MARGIN_RELEASE_CONFIRMATION",
  ],
};

const round = (value: number) => Number(Number(value || 0).toFixed(2));

export const calculateRequiredMargin = (amount: number, percentage: number) =>
  round((Number(amount || 0) * Number(percentage || 0)) / 100);

export const calculateAvailableLimit = (
  sanctioned: number,
  temporary: number,
  utilized: number,
  reserved: number,
) =>
  round(
    Number(sanctioned || 0) +
      Number(temporary || 0) -
      Number(utilized || 0) -
      Number(reserved || 0),
  );

export const calculateOutstanding = (
  accepted: number,
  paid: number,
  reversals = 0,
) =>
  Math.max(
    0,
    round(Number(accepted || 0) - Number(paid || 0) - Number(reversals || 0)),
  );

export const calculateUnutilized = (opened: number, accepted: number) =>
  Math.max(0, round(Number(opened || 0) - Number(accepted || 0)));

export const toLcDate = (value: LCDate): Date | null => {
  if (!value) return null;
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string") {
    const parsed = new Date(value.length === 10 ? `${value}T12:00:00` : value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof (value as Timestamp).toDate === "function")
    return (value as Timestamp).toDate();
  return null;
};

export const toLcDateInput = (value: LCDate) => {
  const parsed = toLcDate(value);
  return parsed ? parsed.toISOString().slice(0, 10) : "";
};

export const calculateHundiDueDate = (
  baseDate: LCDate,
  usancePeriodDays: number,
) => {
  const parsed = toLcDate(baseDate);
  if (!parsed) return "";
  const next = new Date(parsed);
  next.setDate(next.getDate() + Number(usancePeriodDays || 0));
  return next.toISOString().slice(0, 10);
};

export const daysUntil = (value: LCDate) => {
  const target = toLcDate(value);
  if (!target) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / 86_400_000);
};

export const derivePaymentStatus = (dueDate: LCDate, outstanding: number) => {
  if (Number(outstanding || 0) <= 0) return "PAID";
  const days = daysUntil(dueDate);
  if (days === null) return "NOT_DUE";
  if (days < 0) return "OVERDUE";
  if (days === 0) return "DUE_TODAY";
  if (days <= 7) return "DUE_WITHIN_7_DAYS";
  if (days <= 15) return "DUE_WITHIN_15_DAYS";
  if (days <= 30) return "DUE_WITHIN_30_DAYS";
  return "NOT_DUE";
};

export const formatLcCurrency = (value: number, currency = "INR") => {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(Number(value || 0));
  } catch {
    return `${currency} ${Number(value || 0).toLocaleString("en-IN")}`;
  }
};

export const lcLabel = (value: string | null | undefined) =>
  String(value || "-")
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());

export const financialYearForLcDate = (date = new Date()) => {
  const start =
    date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
};

export const lcStatusTone = (status: string) => {
  const normalized = String(status || "").toUpperCase();
  if (
    [
      "CLOSED",
      "PAID",
      "APPROVED",
      "ACCEPTED",
      "FULLY_RECOVERED",
      "COMPLETED",
    ].some((token) => normalized.includes(token))
  )
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (
    ["REJECTED", "CANCELLED", "OVERDUE", "EXPIRED", "DISCREPANCY"].some(
      (token) => normalized.includes(token),
    )
  )
    return "bg-rose-50 text-rose-700 border-rose-200";
  if (
    ["PENDING", "DUE", "AWAITED", "PARTIALLY", "RETURNED"].some((token) =>
      normalized.includes(token),
    )
  )
    return "bg-amber-50 text-amber-800 border-amber-200";
  return "bg-sky-50 text-sky-700 border-sky-200";
};

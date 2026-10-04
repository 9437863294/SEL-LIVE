/**
 * Domain types for the Bill Tracking & Collection Management module.
 *
 * This module replaces the finance team's `BILL TRACKING-<FY>.xlsx` workbook. The workbook's
 * `Bill Tracking` sheet is one row per bill with every deduction, the amount received and a
 * hand-typed STATUS on the same row; here those become separate records so that a bill can carry
 * any number of receipts, each receipt can be split across bills, and the status is computed from
 * the money instead of typed next to it:
 *
 *   billTrackingBills        one document per bill, credit note, debit note or retention bill.
 *                            Deductions are embedded line items (see `BillDeduction`) because they
 *                            are always read and rewritten together with the bill's totals.
 *   billTrackingCollections  one document per bank receipt, allocated across one or more bills.
 *   billTrackingRetention    retention release ledger (held amounts derive from bill deductions).
 *   billTrackingFollowUps    collection follow-ups, each optionally carrying a payment commitment.
 *   billTrackingTargets      weekly collection targets.
 *   billTrackingImportJobs   one document per workbook import, with `rows` as a subcollection.
 *   billTrackingActivity     immutable audit trail.
 *   billTrackingConfig       singleton settings + masters (bill types, deduction types, stages…).
 *
 * Dates are stored as local `yyyy-MM-dd` keys, the same convention Recurring Payments uses: the
 * finance calendar (FY, month, ageing, target week) is date-based and a key sorts and compares as a
 * string in Firestore queries without timezone drift. Audit instants (`createdAt`, …) are ISO
 * timestamps.
 *
 * Money is stored in rupees rounded to the paisa. Every sum goes through `money.ts`, which adds in
 * integer paise so that 143 bills × 13 amounts never accumulate floating-point dust.
 *
 * Kept free of runtime imports so it can be shared by the browser, the Admin-SDK API routes and the
 * `node --test` suite alike.
 */

/* ── transaction & status vocabularies ───────────────────────────────────── */

export const TRANSACTION_TYPES = ['invoice', 'credit_note', 'debit_note', 'adjustment', 'advance', 'retention_bill'] as const;
export type BillTransactionType = (typeof TRANSACTION_TYPES)[number];

export const TRANSACTION_TYPE_LABELS: Record<BillTransactionType, string> = {
  invoice: 'Invoice',
  credit_note: 'Credit Note',
  debit_note: 'Debit Note',
  adjustment: 'Adjustment',
  advance: 'Advance / PI',
  retention_bill: 'Retention Bill',
};

export const PAYMENT_STATUSES = ['not_received', 'partially_received', 'received', 'over_received', 'adjusted', 'cancelled'] as const;
export type BillPaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_STATUS_LABELS: Record<BillPaymentStatus, string> = {
  not_received: 'Not Received',
  partially_received: 'Partially Received',
  received: 'Received',
  over_received: 'Over Received',
  adjusted: 'Adjusted',
  cancelled: 'Cancelled',
};

/**
 * The default bill workflow. `returned` is a side state: a returned bill remembers the stage it was
 * returned from (`returnedFrom`) and goes back to the step before it once corrected.
 */
export const WORKFLOW_STATUSES = [
  'draft',
  'submitted',
  'under_verification',
  'verified',
  'approved',
  'raised',
  'payment_followup',
  'reconciliation',
  'closed',
  'returned',
] as const;
export type BillWorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

export const WORKFLOW_STATUS_LABELS: Record<BillWorkflowStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  under_verification: 'Under Verification',
  verified: 'Verified',
  approved: 'Approved',
  raised: 'Bill Raised',
  payment_followup: 'Payment Follow-up',
  reconciliation: 'Reconciliation',
  closed: 'Closed',
  returned: 'Returned for Correction',
};

export const PAYMENT_MODES = ['NEFT', 'RTGS', 'IMPS', 'CHEQUE', 'BANK_TRANSFER', 'ADJUSTMENT', 'OTHER'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export const COLLECTION_STATUSES = ['draft', 'verified', 'cancelled'] as const;
export type CollectionStatus = (typeof COLLECTION_STATUSES)[number];

export const AGEING_BASES = ['billDate', 'submissionDate', 'dueDate', 'passedDate'] as const;
export type AgeingBasis = (typeof AGEING_BASES)[number];

export const AGEING_BASIS_LABELS: Record<AgeingBasis, string> = {
  billDate: 'Bill Date',
  submissionDate: 'Submission Date',
  dueDate: 'Due Date',
  passedDate: 'Bill Passed Date',
};

export const DOCUMENT_CATEGORIES = [
  'Invoice',
  'Submission',
  'Measurement',
  'Certification',
  'Payment Advice',
  'Bank Advice',
  'TDS Certificate',
  'Retention',
  'Client Letter',
  'Other',
] as const;
export type BillDocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const FOLLOW_UP_METHODS = ['Phone', 'Email', 'Meeting', 'Letter', 'Client Portal', 'Other'] as const;
export type FollowUpMethod = (typeof FOLLOW_UP_METHODS)[number];

export const COMMITMENT_STATUSES = ['pending', 'partially_fulfilled', 'fulfilled', 'missed', 'revised'] as const;
export type CommitmentStatus = (typeof COMMITMENT_STATUSES)[number];

export const COMMITMENT_STATUS_LABELS: Record<CommitmentStatus, string> = {
  pending: 'Pending',
  partially_fulfilled: 'Partially Fulfilled',
  fulfilled: 'Fulfilled',
  missed: 'Missed',
  revised: 'Revised',
};

export const RETENTION_STATUSES = ['held', 'partially_released', 'fully_released', 'disputed', 'overdue'] as const;
export type RetentionStatus = (typeof RETENTION_STATUSES)[number];

export const RETENTION_STATUS_LABELS: Record<RetentionStatus, string> = {
  held: 'Held',
  partially_released: 'Partially Released',
  fully_released: 'Fully Released',
  disputed: 'Disputed',
  overdue: 'Overdue',
};

/* ── masters (configuration) ─────────────────────────────────────────────── */

/**
 * Reporting category a bill type rolls up into. The legacy month-wise summary has one taxable column
 * per category (Supply / Erection / Civil / F&I), so every bill type names exactly one.
 */
export const BILL_CATEGORIES = ['supply', 'erection', 'civil', 'fi', 'compensation', 'other'] as const;
export type BillCategory = (typeof BILL_CATEGORIES)[number];

export const BILL_CATEGORY_LABELS: Record<BillCategory, string> = {
  supply: 'Supply',
  erection: 'Erection',
  civil: 'Civil',
  fi: 'F&I',
  compensation: 'Compensation',
  other: 'Other',
};

export interface BillTypeMaster {
  id: string;
  /** Exactly as finance writes it on the sheet, e.g. `SUPPLY-60%`, `CIVIL-PV`. */
  name: string;
  code: string;
  category: BillCategory;
  /**
   * A bill raised to recover retention (the legacy `SUPPLY-10%`, `CIVIL-10%`… rows). Its net feeds
   * "Retention Amount Raised" and its receipts feed "Retention Released by Client".
   */
  isRetentionBill: boolean;
  /** Price-variation bill (`*-PV`). */
  isPriceVariation: boolean;
  active: boolean;
}

/**
 * How a deduction type behaves in reports. `statutory` = Building Cess and the three TDS heads (the
 * legacy "STATUTORY DEDUCTION" column); the retention kinds feed the retention ledger.
 */
export const DEDUCTION_KINDS = [
  'statutory',
  'mobilization_advance',
  'mobilization_interest',
  'retention_cpbg',
  'retention_invoice',
  'retention_time_extension',
  'retention_other',
  'lc_commission',
  'other',
] as const;
export type DeductionKind = (typeof DEDUCTION_KINDS)[number];

export const RETENTION_DEDUCTION_KINDS: readonly DeductionKind[] = [
  'retention_cpbg',
  'retention_invoice',
  'retention_time_extension',
  'retention_other',
];

export interface DeductionTypeMaster {
  id: string;
  name: string;
  code: string;
  kind: DeductionKind;
  /** `percentage` types offer `defaultPercent` of the base when a row is added on the form. */
  calculation: 'fixed' | 'percentage';
  /** Base the percentage applies to. */
  percentBase: 'taxable' | 'gross';
  defaultPercent?: number;
  /** Column order on the register, the legacy export and the import mapping. */
  sequence: number;
  active: boolean;
}

export interface BillStageMaster {
  id: string;
  name: string;
  sequence: number;
  active: boolean;
}

export interface AgeingBucketConfig {
  /** Inclusive lower bound in days. */
  from: number;
  /** Inclusive upper bound in days; `null` = open-ended (365+). */
  to: number | null;
  label: string;
}

export interface BillNumberingConfig {
  enabled: boolean;
  /** Tokens: `{FY}`, `{SEQ}`. e.g. `SEL/BILL/{FY}/{SEQ}`. */
  pattern: string;
  padding: number;
}

export interface BillTrackingSettings {
  /** Amounts within this many rupees of each other are treated as equal. */
  tolerance: number;
  /** Round net receivable to the whole rupee, as the legacy sheet's ROUND(…, 0) does. */
  roundNetToRupee: boolean;
  defaultCreditDays: number;
  defaultAgeingBasis: AgeingBasis;
  ageingBuckets: AgeingBucketConfig[];
  /** Outstanding bill with no follow-up for this many days raises an exception. */
  noFollowUpDays: number;
  /** "Old outstanding" exception threshold in days. */
  oldOutstandingDays: number;
  /** Bills at or above this net receivable count as high value. */
  highValueThreshold: number;
  numbering: BillNumberingConfig;
  /** Month keys (`yyyy-MM`) closed for normal editing. */
  closedMonths: string[];
  /** Legacy `TAXABLE / ADVANCE` value that marks a proforma invoice row (the PI report filter). */
  piMarker: string;
  updatedAt?: string;
  updatedBy?: string;
}

/** Remembered Excel-name → project-master mapping, so the second import needs no confirmation. */
export interface ProjectNameMapping {
  /** Normalised Excel project name. */
  key: string;
  excelName: string;
  projectId: string;
  projectName: string;
  createdBy?: string;
  createdAt?: string;
}

/**
 * Bill Tracking's own attributes of a project. The global project master has no DGM office, and
 * its client link is optional and only used by Project Management, so the reporting dimensions this
 * module needs live here, keyed by the master's project id — never a second project list.
 */
export interface ProjectProfile {
  projectId: string;
  dgmOffice?: string;
  /** Overrides the project master's client when that is blank or wrong for billing purposes. */
  clientId?: string;
  clientName?: string;
  /** Overrides the client's payment terms for this project's due dates. */
  creditDays?: number;
}

export interface BillTrackingConfig {
  settings: BillTrackingSettings;
  billTypes: BillTypeMaster[];
  deductionTypes: DeductionTypeMaster[];
  stages: BillStageMaster[];
  projectMappings: ProjectNameMapping[];
  projectProfiles: ProjectProfile[];
}

/* ── records ─────────────────────────────────────────────────────────────── */

export interface BillDeduction {
  /** Stable within the bill. */
  id: string;
  deductionTypeId: string;
  deductionTypeName: string;
  kind: DeductionKind;
  /** Signed: a negative deduction adds to the net (legacy crop-compensation rows rely on this). */
  amount: number;
  percentage?: number;
  calculationBase?: number;
  remarks?: string;
  deductionDate?: string;
}

/** One line of a receipt's allocation, mirrored onto the bill so its totals stay derivable. */
export interface BillCollectionRef {
  collectionId: string;
  receiptDate: string;
  amount: number;
  status: CollectionStatus;
  utrNumber?: string;
  paymentMode?: PaymentMode;
}

export interface DueDateRevision {
  previousDueDate?: string;
  dueDate: string;
  reason: string;
  changedBy: string;
  changedByName?: string;
  changedAt: string;
}

export interface Bill {
  id: string;
  financialYear: string;
  /** Legacy `Sl. No.` — preserved verbatim, never renumbered. */
  serialNumber?: number;
  /** Legacy `Bill Sl No.` / generated bill number. */
  billSerialNumber?: string;
  transactionType: BillTransactionType;
  /** `undefined` for non-GST rows (the legacy sheet writes `NA`). */
  gstInvoiceNumber?: string;
  billDate: string;
  submissionDate?: string;
  passedDate?: string;
  /** Due date currently in force (revised if any revision exists). */
  dueDate?: string;
  originalDueDate?: string;
  dueDateRevisions?: DueDateRevision[];
  expectedPaymentDate?: string;

  projectId: string;
  projectNameSnapshot: string;
  clientId?: string;
  clientNameSnapshot?: string;
  dgmOffice?: string;

  description?: string;
  billTypeId?: string;
  billTypeName: string;
  billCategory: BillCategory;
  isRetentionBill: boolean;

  taxableAmount: number;
  gstAmount: number;
  gstPercent?: number;
  deductions: BillDeduction[];

  /* derived — written only by the server from the source values above */
  grossAmount: number;
  totalDeduction: number;
  statutoryDeduction: number;
  retentionDeducted: number;
  netReceivable: number;
  totalReceived: number;
  outstandingAmount: number;
  /** Net − received; positive = short-paid, negative = surplus. Same sign as the legacy sheet. */
  shortfallSurplus: number;
  lastReceiptDate?: string;
  paymentStatus: BillPaymentStatus;
  /** Set when a finance admin overrides the computed status (with a reason). */
  paymentStatusOverride?: { status: BillPaymentStatus; reason: string; by: string; at: string };

  collections: BillCollectionRef[];

  workflowStatus: BillWorkflowStatus;
  returnedFrom?: BillWorkflowStatus;
  currentStage?: string;

  targetWeek?: string;
  receivedWeek?: string;
  collectionOwnerId?: string;
  collectionOwnerName?: string;

  /* retention */
  retentionExpectedReleaseDate?: string;
  retentionDisputed?: boolean;

  /* follow-up rollups (maintained when follow-ups are written) */
  lastFollowUpDate?: string;
  nextFollowUpDate?: string;
  nextCommitmentDate?: string;
  nextCommitmentAmount?: number;

  remarks?: string;
  typeV2?: string;
  /** Legacy `TAXABLE / ADVANCE`: `BILL` or `PI`. */
  taxableOrAdvance?: string;

  /* legacy import trail */
  legacyStatus?: string;
  legacyTimestamp?: string;
  importedNetAmount?: number;
  importedTotalDeduction?: number;
  importedReceived?: number;
  /** Set when imported net ≠ calculated net beyond tolerance; cleared when finance resolves it. */
  netMismatch?: { imported: number; calculated: number; resolvedBy?: string; resolvedAt?: string; resolution?: string };
  importJobId?: string;
  importRowNumber?: number;
  importFingerprint?: string;
  source: 'manual' | 'excel_import' | 'api';

  /** Lower-cased tokens for the register's search box. */
  searchTokens: string[];
  /** Bumped on every write; the import rollback refuses a bill whose version moved past the import. */
  version: number;

  createdAt: string;
  createdBy: string;
  createdByName?: string;
  updatedAt: string;
  updatedBy: string;
  updatedByName?: string;
  isDeleted: boolean;
  deletedAt?: string;
  deletedBy?: string;
  deleteReason?: string;
}

export interface CollectionAllocation {
  billId: string;
  billSerialNumber?: string;
  gstInvoiceNumber?: string;
  projectId: string;
  projectNameSnapshot: string;
  amount: number;
}

export interface BillCollection {
  id: string;
  financialYear: string;
  receiptDate: string;
  amount: number;
  /** Sum of `allocations`; `amount − allocatedAmount` is held unallocated (needs permission). */
  allocatedAmount: number;
  unallocatedAmount: number;
  allocations: CollectionAllocation[];
  /** Denormalised for `array-contains` queries from a bill / project. */
  billIds: string[];
  projectIds: string[];
  clientId?: string;
  clientNameSnapshot?: string;
  paymentMode?: PaymentMode;
  bankReference?: string;
  utrNumber?: string;
  bankAccountId?: string;
  bankAccountName?: string;
  paymentAdviceDocumentId?: string;
  remarks?: string;
  status: CollectionStatus;
  source: 'manual' | 'excel_import' | 'api';
  importJobId?: string;
  createdBy: string;
  createdByName?: string;
  createdAt: string;
  verifiedBy?: string;
  verifiedByName?: string;
  verifiedAt?: string;
  cancelledBy?: string;
  cancelledAt?: string;
  cancelReason?: string;
  updatedAt: string;
}

export interface RetentionRelease {
  id: string;
  projectId: string;
  projectNameSnapshot: string;
  /** Bill whose retention is being released, when known. */
  againstBillId?: string;
  againstBillSerial?: string;
  /** Retention bill or collection that carried the release, when there is one. */
  retentionBillId?: string;
  collectionId?: string;
  kind: DeductionKind;
  releaseDate: string;
  amount: number;
  remarks?: string;
  status: 'active' | 'cancelled';
  createdBy: string;
  createdByName?: string;
  createdAt: string;
  cancelledBy?: string;
  cancelledAt?: string;
  cancelReason?: string;
}

export interface BillFollowUp {
  id: string;
  billId: string;
  projectId: string;
  followUpDate: string;
  method: FollowUpMethod;
  contactPerson?: string;
  discussion: string;
  nextFollowUpDate?: string;
  ownerId?: string;
  ownerName?: string;
  commitment?: {
    date: string;
    amount: number;
    confidence?: 'low' | 'medium' | 'high';
    status: CommitmentStatus;
    fulfilledAmount?: number;
    fulfilledDate?: string;
    revisedToFollowUpId?: string;
  };
  status: 'open' | 'closed';
  createdBy: string;
  createdByName?: string;
  createdAt: string;
}

export interface BillComment {
  id: string;
  billId: string;
  text: string;
  mentions: string[];
  createdBy: string;
  createdByName?: string;
  createdAt: string;
}

export interface BillDocument {
  id: string;
  billId: string;
  category: BillDocumentCategory;
  fileName: string;
  contentType?: string;
  size?: number;
  storagePath: string;
  downloadUrl?: string;
  uploadedBy: string;
  uploadedByName?: string;
  uploadedAt: string;
  isDeleted?: boolean;
}

export interface CollectionTarget {
  id: string;
  financialYear: string;
  /** ISO week key, e.g. `2026-W41`. */
  week: string;
  /** Optional narrowing; a target with neither is the company-wide target for the week. */
  projectId?: string;
  projectNameSnapshot?: string;
  billId?: string;
  amount: number;
  responsibleId?: string;
  responsibleName?: string;
  probability?: number;
  expectedDate?: string;
  remarks?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface BillActivity {
  id: string;
  /** `bill`, `collection`, `import`, `settings`, … */
  entityType: string;
  entityId: string;
  billId?: string;
  action: string;
  summary: string;
  previous?: Record<string, unknown>;
  next?: Record<string, unknown>;
  reason?: string;
  actorId: string;
  actorName?: string;
  at: string;
  userAgent?: string;
}

/* ── import ──────────────────────────────────────────────────────────────── */

export const IMPORT_JOB_STATUSES = ['previewed', 'importing', 'completed', 'partial', 'failed', 'rolled_back'] as const;
export type ImportJobStatus = (typeof IMPORT_JOB_STATUSES)[number];

export interface ImportReconciliationTotals {
  bills: number;
  taxable: number;
  gst: number;
  gross: number;
  deduction: number;
  net: number;
  received: number;
  outstanding: number;
  retention: number;
}

export interface BillImportJob {
  id: string;
  jobNumber: string;
  fileName: string;
  fileSize?: number;
  /** SHA-256 of the uploaded file, so a re-upload of the same workbook is recognisable. */
  checksum: string;
  sheetName: string;
  financialYear?: string;
  storagePath?: string;
  rowsDetected: number;
  rowsValid: number;
  rowsWarning: number;
  rowsFailed: number;
  rowsDuplicate: number;
  rowsImported: number;
  rowsUpdated: number;
  rowsSkipped: number;
  rowsPending: number;
  status: ImportJobStatus;
  /** Totals as the workbook states them (over the rows selected for import). */
  excelTotals?: ImportReconciliationTotals;
  uploadedBy: string;
  uploadedByName?: string;
  uploadedAt: string;
  completedAt?: string;
  rolledBackAt?: string;
  rolledBackBy?: string;
  rollbackReason?: string;
}

export type ImportRowAction = 'import' | 'skip' | 'update' | 'import_new';
export type ImportRowState = 'pending' | 'imported' | 'updated' | 'skipped' | 'failed' | 'rolled_back';

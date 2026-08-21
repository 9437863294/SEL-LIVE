import type { Timestamp } from 'firebase/firestore';
import {
  DEFAULT_DA_SLABS,
  DEFAULT_TRAVEL_GRADE,
  type CityClass,
  type DaSlab,
  type ExpenseCategory,
  type FlightClass,
  type OutstandingAdvanceAction,
  type OwnVehicleType,
  type TrainClass,
  type TravelApprovalStage,
  type TravelMode,
} from './tour-travel-policy';

/**
 * Data model for the Tour, Travel & Expense (TTE) module.
 *
 * The entitlement, allowance, settlement and approval-matrix math lives in
 * `tour-travel-policy.ts` — dependency-free so it can run in the browser, on mobile and in
 * Admin-SDK routes, and so it stays unit-testable. It's re-exported from here so every consumer
 * imports the module from one place, exactly as `recurring-payments.ts` re-exports its schedule
 * module.
 *
 * The lifecycle this model supports is:
 *
 *   Tour Request → Approval → Advance → Booking → Journey → Expense capture → Claim
 *     → Verification → Approval → Payment/Recovery → Accounting → Closure
 *
 * Two structural decisions are worth knowing before reading the interfaces:
 *
 *   1. **Claim lines are their own collection** (`travelClaimItems`), not an array on the claim.
 *      A tour can run to dozens of bills, each carrying its own verification decision, exception
 *      reason and audit history, which an embedded array makes unqueryable and eventually pushes
 *      past Firestore's 1 MB document ceiling.
 *
 *   2. **`claimedAmount` is immutable.** Verification writes `approvedAmount` and
 *      `disallowedAmount` beside it and never over it, so "what the employee submitted" and "what
 *      Finance allowed" remain separately answerable forever (control rule 51.8). Nothing in this
 *      module or its service layer may update `claimedAmount` after submission.
 */

export * from './tour-travel-policy';

export const TT_COLLECTIONS = {
  requests: 'travelRequests',
  itineraries: 'travelItineraries',
  accommodations: 'travelAccommodations',
  approvals: 'travelApprovals',
  advances: 'travelAdvances',
  advancePayments: 'travelAdvancePayments',
  bookings: 'travelBookings',
  expenses: 'travelExpenses',
  claims: 'travelClaims',
  claimItems: 'travelClaimItems',
  settlements: 'travelSettlements',
  recoveries: 'travelRecoveries',
  payments: 'travelPayments',
  policies: 'travelPolicies',
  entitlements: 'travelEntitlements',
  gradeMappings: 'travelGradeMappings',
  expenseCategories: 'travelExpenseCategories',
  cityClasses: 'travelCityClasses',
  approvalRules: 'travelApprovalRules',
  settings: 'travelSettings',
  counters: 'travelCounters',
  auditLogs: 'travelAuditLogs',
  notificationQueue: 'travelNotificationQueue',
} as const;

/* ------------------------------------------------------------------------------------------------
 * Statuses
 * ---------------------------------------------------------------------------------------------- */

/**
 * Statuses use SCREAMING_SNAKE per the module's status architecture (spec section 27), which is a
 * deliberate departure from the Title Case other modules use — travel statuses are read by the
 * mobile client and the accounting posting route as well as the UI, and an unambiguous machine
 * token avoids the "Payment Pending" vs "Payment pending" drift that Title Case invites across
 * three writers. `travelStatusLabel` renders them for display; no UI should print the raw token.
 */
export type TourStatus =
  | 'DRAFT' | 'SUBMITTED' | 'UNDER_APPROVAL' | 'APPROVED' | 'REJECTED'
  | 'TRAVEL_SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CLAIM_PENDING'
  | 'SETTLEMENT_PENDING' | 'CLOSED' | 'CANCELLED';

export const TOUR_STATUSES: TourStatus[] = [
  'DRAFT', 'SUBMITTED', 'UNDER_APPROVAL', 'APPROVED', 'REJECTED', 'TRAVEL_SCHEDULED',
  'IN_PROGRESS', 'COMPLETED', 'CLAIM_PENDING', 'SETTLEMENT_PENDING', 'CLOSED', 'CANCELLED',
];

/** Tours that no longer move on their own — used to skip reminders and lock edits. */
export const TERMINAL_TOUR_STATUSES: TourStatus[] = ['REJECTED', 'CLOSED', 'CANCELLED'];

export type ClaimStatus =
  | 'DRAFT' | 'SUBMITTED' | 'MANAGER_REVIEW' | 'FINANCE_REVIEW' | 'CORRECTION_REQUIRED'
  | 'APPROVED' | 'PAYMENT_PENDING' | 'PAID' | 'RECOVERY_PENDING' | 'SETTLED' | 'REJECTED';

export const CLAIM_STATUSES: ClaimStatus[] = [
  'DRAFT', 'SUBMITTED', 'MANAGER_REVIEW', 'FINANCE_REVIEW', 'CORRECTION_REQUIRED',
  'APPROVED', 'PAYMENT_PENDING', 'PAID', 'RECOVERY_PENDING', 'SETTLED', 'REJECTED',
];

/**
 * A claim at or past these statuses is financially locked (control rule 51.9 — a paid claim cannot
 * be edited). The service layer checks this before every mutation.
 */
export const LOCKED_CLAIM_STATUSES: ClaimStatus[] = ['PAID', 'SETTLED'];

export type AdvanceStatus =
  | 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'PAYMENT_PENDING' | 'PAID'
  | 'PARTIALLY_SETTLED' | 'SETTLED' | 'RECOVERY_PENDING' | 'CLOSED' | 'CANCELLED';

export const ADVANCE_STATUSES: AdvanceStatus[] = [
  'REQUESTED', 'APPROVED', 'REJECTED', 'PAYMENT_PENDING', 'PAID',
  'PARTIALLY_SETTLED', 'SETTLED', 'RECOVERY_PENDING', 'CLOSED', 'CANCELLED',
];

export type RecoveryStatus = 'PENDING' | 'PARTIALLY_RECOVERED' | 'RECOVERED' | 'WAIVED';

export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'CANCELLED';

/** Turns a status token into the sentence-case label the UI shows. */
export function travelStatusLabel(status: string): string {
  return (status || '')
    .split('_')
    .map((word, index) => (index === 0 ? word.charAt(0) + word.slice(1).toLowerCase() : word.toLowerCase()))
    .join(' ');
}

/**
 * Tailwind classes per status family, so a badge looks the same in every view. Grouped by meaning
 * rather than by entity: a claim under review and a tour under approval should read alike.
 */
export function travelStatusTone(status: string): string {
  switch (status) {
    case 'DRAFT':
      return 'bg-slate-100 text-slate-700 border-slate-200';
    case 'SUBMITTED':
    case 'UNDER_APPROVAL':
    case 'MANAGER_REVIEW':
    case 'FINANCE_REVIEW':
    case 'REQUESTED':
      return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'APPROVED':
    case 'TRAVEL_SCHEDULED':
      return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'IN_PROGRESS':
      return 'bg-indigo-50 text-indigo-700 border-indigo-200';
    case 'COMPLETED':
    case 'PAID':
    case 'SETTLED':
    case 'CLOSED':
    case 'RECOVERED':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'CLAIM_PENDING':
    case 'SETTLEMENT_PENDING':
    case 'PAYMENT_PENDING':
    case 'RECOVERY_PENDING':
    case 'PARTIALLY_SETTLED':
    case 'PARTIALLY_RECOVERED':
    case 'PENDING':
      return 'bg-orange-50 text-orange-700 border-orange-200';
    case 'CORRECTION_REQUIRED':
      return 'bg-yellow-50 text-yellow-800 border-yellow-300';
    case 'REJECTED':
    case 'CANCELLED':
    case 'FAILED':
      return 'bg-rose-50 text-rose-700 border-rose-200';
    default:
      return 'bg-slate-100 text-slate-700 border-slate-200';
  }
}

/* ------------------------------------------------------------------------------------------------
 * Tour request
 * ---------------------------------------------------------------------------------------------- */

export type TourType =
  | 'Project/Site Visit' | 'Client Meeting' | 'Vendor Visit' | 'Inspection'
  | 'Tender/Business Development' | 'Training' | 'Audit' | 'Bank/Financial Work'
  | 'Government/Statutory Work' | 'Recruitment' | 'Management Tour' | 'Emergency Tour' | 'Other';

export const TOUR_TYPES: TourType[] = [
  'Project/Site Visit', 'Client Meeting', 'Vendor Visit', 'Inspection',
  'Tender/Business Development', 'Training', 'Audit', 'Bank/Financial Work',
  'Government/Statutory Work', 'Recruitment', 'Management Tour', 'Emergency Tour', 'Other',
];

export type AccommodationArrangement =
  | 'Employee Booking' | 'Admin Booking' | 'Company Guest House'
  | 'Client Arrangement' | 'Project Site Arrangement' | 'No Accommodation Required';

export const ACCOMMODATION_ARRANGEMENTS: AccommodationArrangement[] = [
  'Employee Booking', 'Admin Booking', 'Company Guest House',
  'Client Arrangement', 'Project Site Arrangement', 'No Accommodation Required',
];

/** One leg of the journey. Stored on the request rather than as a subcollection — a leg has no
 * independent lifecycle, and an itinerary is always read whole. */
export interface TravelItineraryLeg {
  id: string;
  date: string;
  fromCity: string;
  toCity: string;
  mode: TravelMode;
  /** Cabin/coach actually planned, checked against entitlement by `exceedsClassEntitlement`. */
  travelClass?: FlightClass | TrainClass | string;
  departureTime?: string;
  arrivalTime?: string;
  estimatedCost?: number;
  remarks?: string;
}

export interface TravelAccommodationPlan {
  id: string;
  city: string;
  cityClass?: CityClass;
  checkIn: string;
  checkOut: string;
  nights: number;
  hotelRequired: boolean;
  arrangement: AccommodationArrangement;
  estimatedTariffPerNight?: number;
  remarks?: string;
}

/** A completed approval action, appended never overwritten (spec section 50). */
export interface TravelApprovalEntry {
  stageId: string;
  stageName: string;
  action: 'Approve' | 'Reject' | 'Send Back' | 'Request Clarification' | 'Approve with Modification' | 'Forward';
  userId: string;
  userName: string;
  remarks: string;
  /** Set when the approver used 'Approve with Modification'. */
  modifiedAmount?: number | null;
  timestamp: Timestamp;
}

export interface TravelRequest {
  id: string;
  organizationId: string;
  organizationName?: string;
  referenceNumber: string;
  financialYear: string;
  requestDate: string;

  /** The traveller. Distinct from `createdBy`, which may be an EA raising it on their behalf
   * (spec section 42) — both are audited. */
  employeeId: string;
  employeeUserId: string;
  employeeName: string;
  employeeCode?: string;
  designation?: string;
  grade: string;
  departmentId?: string;
  departmentName?: string;
  reportingManagerId?: string;
  hodId?: string;
  costCentre?: string;
  branchId?: string;
  branchName?: string;

  tourType: TourType;
  purpose: string;
  isInternational: boolean;
  /** Emergency tours travel first and are approved after the fact (spec section 43). */
  isEmergency: boolean;
  emergencyReason?: string;
  postFactoApprovalRequired?: boolean;

  projectId?: string;
  projectName?: string;
  projectCode?: string;
  projectSiteId?: string;
  projectSiteName?: string;
  clientId?: string;
  clientName?: string;
  projectManagerId?: string;
  workOrderNo?: string;

  /** Earliest departure and latest return across the itinerary, denormalized so the calendar and
   * the "currently travelling" dashboard card can query without reading every leg. */
  departureDate: string;
  returnDate: string;
  departureAt?: string;
  returnAt?: string;
  durationDays: number;

  itinerary: TravelItineraryLeg[];
  accommodation: TravelAccommodationPlan[];

  /** The approved travel budget, compared against actuals in the variance report. */
  estimate: {
    travel: number;
    hotel: number;
    dailyAllowance: number;
    localTransport: number;
    fuel: number;
    miscellaneous: number;
    total: number;
  };
  /** Set when an approver used 'Approve with Modification'; the estimate itself is never edited. */
  approvedAmount?: number | null;

  advanceRequired: boolean;
  advanceRequestedAmount?: number;

  /** Group tours attribute cost per employee but share one coordinator (spec section 41). */
  groupTourId?: string | null;
  isGroupCoordinator?: boolean;

  status: TourStatus;
  /** Ordered chain resolved at submission, frozen onto the request so editing a rule later can't
   * retroactively change who still has to approve an in-flight tour. */
  approvalStages: TravelApprovalStage[];
  currentStageIndex: number;
  currentApprovers: string[];
  approvalHistory: TravelApprovalEntry[];
  stageEnteredAt?: Timestamp | null;
  approvalDeadline?: Timestamp | null;

  /** Policy exceptions acknowledged at request time, e.g. a hotel above entitlement. */
  policyExceptions?: Array<{ category: string; claimed: number; entitled: number; excess: number; reason: string }>;

  travelCompletedAt?: Timestamp | null;
  claimId?: string | null;
  cancellation?: {
    reason: string;
    cancelledBy: string;
    cancelledByName: string;
    cancelledAt: Timestamp;
    ticketCancellationCharge: number;
    hotelCancellationCharge: number;
    refundExpected: number;
    refundReceived: number;
  } | null;

  /** Set when the itinerary was revised; the original is preserved (spec section 40). */
  revisionOf?: string | null;
  revisionNumber?: number;

  createdBy?: string;
  createdByName?: string;
  createdAt?: Timestamp;
  updatedBy?: string;
  updatedByName?: string;
  updatedAt?: Timestamp;
  deleted?: boolean;
}

/* ------------------------------------------------------------------------------------------------
 * Travel advance
 * ---------------------------------------------------------------------------------------------- */

export type AdvancePaymentMode = 'NEFT' | 'RTGS' | 'IMPS' | 'UPI' | 'Cheque' | 'Cash' | 'Bank Transfer';

export const ADVANCE_PAYMENT_MODES: AdvancePaymentMode[] = ['NEFT', 'RTGS', 'IMPS', 'UPI', 'Cheque', 'Cash', 'Bank Transfer'];

/** Modes where a bank reference is meaningful — cash has none. Mirrors the same idea in
 * recurring-payments.ts so both modules agree on when to demand a UTR. */
export const ADVANCE_REFERENCE_REQUIRED_MODES: AdvancePaymentMode[] = ['NEFT', 'RTGS', 'IMPS', 'UPI', 'Bank Transfer'];

export interface TravelAdvance {
  id: string;
  organizationId: string;
  referenceNumber: string;
  financialYear: string;
  travelRequestId: string;
  travelRequestNumber: string;

  employeeId: string;
  employeeUserId: string;
  employeeName: string;
  departmentId?: string;
  projectId?: string;
  projectName?: string;
  costCentre?: string;

  requestedAmount: number;
  approvedAmount: number;
  /** Sum of `TravelAdvancePayment.amount`. Kept denormalized because the ageing report and the
   * outstanding-advance control both read it per employee across many advances. */
  paidAmount: number;
  /** How much of `paidAmount` a claim settlement has absorbed. */
  settledAmount: number;

  requestReason?: string;
  status: AdvanceStatus;
  requestedAt?: Timestamp;
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: Timestamp | null;
  rejectionReason?: string;
  /** First payment date, used as the ageing anchor. */
  paidOn?: string | null;

  /** Recorded when Finance overrode an outstanding-advance block to allow this one. */
  outstandingOverride?: {
    action: OutstandingAdvanceAction;
    outstandingAmount: number;
    oldestAgeDays: number;
    reason: string;
    overriddenBy: string;
    overriddenByName: string;
    overriddenAt: Timestamp;
  } | null;

  createdBy?: string;
  createdByName?: string;
  createdAt?: Timestamp;
  updatedBy?: string;
  updatedByName?: string;
  updatedAt?: Timestamp;
}

/** One disbursement against an advance. Separate from the advance so a part-paid advance keeps a
 * full payment history rather than a single overwritten reference. */
export interface TravelAdvancePayment {
  id: string;
  organizationId: string;
  advanceId: string;
  travelRequestId: string;
  amount: number;
  paymentDate: string;
  mode: AdvancePaymentMode;
  bankAccount?: string;
  transactionReference?: string;
  chequeNumber?: string;
  voucherNumber?: string;
  accountingDate?: string;
  remarks?: string;
  paidBy: string;
  paidByName: string;
  createdAt?: Timestamp;
}

/* ------------------------------------------------------------------------------------------------
 * Booking
 * ---------------------------------------------------------------------------------------------- */

export type BookingType = 'Flight' | 'Train' | 'Bus' | 'Hotel' | 'Vehicle';

export interface TravelBooking {
  id: string;
  organizationId: string;
  travelRequestId: string;
  travelRequestNumber: string;
  bookingType: BookingType;
  /** Which itinerary leg this booking serves, when it maps to one. */
  itineraryLegId?: string | null;

  vendorName?: string;
  travelAgency?: string;
  bookingReference?: string;
  pnr?: string;
  carrier?: string;
  serviceNumber?: string;
  travelClass?: string;
  fromCity?: string;
  toCity?: string;
  checkIn?: string;
  checkOut?: string;
  driverName?: string;
  vehicleNumber?: string;

  baseAmount: number;
  taxAmount: number;
  totalAmount: number;
  gstin?: string;
  invoiceNumber?: string;
  invoiceDate?: string;

  /**
   * True when the company settled this directly with the agency/hotel. Such bookings flow into the
   * claim as `paidByCompany` lines so the tour's true cost is visible, and are deducted at
   * settlement — never reimbursed (control rule 51.12).
   */
  paidByCompany: boolean;

  cancellationPolicy?: string;
  cancelled?: boolean;
  cancellationCharge?: number;
  refundExpected?: number;
  refundReceived?: number;

  documents?: Array<{ reference: string; fileName: string; fileType: string; fileSize: number; uploadedBy: string; uploadedAt: Timestamp }>;
  bookedBy?: string;
  bookedByName?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

/* ------------------------------------------------------------------------------------------------
 * Expense capture
 * ---------------------------------------------------------------------------------------------- */

export type ExpensePaymentMode = 'Cash' | 'Personal Card' | 'Company Card' | 'UPI' | 'Net Banking' | 'Company Account';

export const EXPENSE_PAYMENT_MODES: ExpensePaymentMode[] = ['Cash', 'Personal Card', 'Company Card', 'UPI', 'Net Banking', 'Company Account'];

/**
 * An expense captured during the journey, before it becomes a claim line.
 *
 * Kept as its own collection rather than written straight onto a claim because capture happens on
 * the move — often offline, one bill at a time — and must not require a claim to exist yet
 * (spec sections 14–15). Claim creation snapshots these into `TravelClaimItem`.
 */
export interface TravelExpense {
  id: string;
  organizationId: string;
  travelRequestId: string;
  travelRequestNumber: string;
  employeeId: string;
  employeeUserId: string;

  expenseDate: string;
  category: ExpenseCategory;
  vendor?: string;
  description?: string;
  amount: number;
  gstAmount?: number;
  invoiceNumber?: string;
  invoiceDate?: string;
  gstin?: string;
  paymentMode: ExpensePaymentMode;
  city?: string;
  cityClass?: CityClass;
  /** Nights for Hotel, days for DA/Local Conveyance — drives the entitlement multiplier. */
  quantity?: number;

  billAvailable: boolean;
  billReference?: string;
  billFileName?: string;
  billFileType?: string;
  billFileSize?: number;
  /** Content hash of the uploaded bill, for duplicate detection across claims. */
  fileHash?: string;

  /** Set for a Mileage expense; the odometer pair stays on the record so the distance is checkable. */
  mileage?: {
    vehicleNumber: string;
    vehicleType: OwnVehicleType;
    startKm: number;
    endKm: number;
    distanceKm: number;
    ratePerKm: number;
  } | null;

  projectId?: string;
  projectName?: string;
  costCentre?: string;

  /** True once a claim has picked this expense up, so it can't be claimed twice. */
  claimed: boolean;
  claimId?: string | null;

  /** Flags raised at capture — duplicate suspicion, date outside the tour window. Advisory only;
   * the verifier decides. */
  flags?: string[];

  createdBy?: string;
  createdByName?: string;
  createdAt?: Timestamp;
  updatedBy?: string;
  updatedByName?: string;
  updatedAt?: Timestamp;
  /** Bills are soft-deleted and logged, never removed (control rule 51.15). */
  deleted?: boolean;
  deletedBy?: string;
  deletedReason?: string;
}

/* ------------------------------------------------------------------------------------------------
 * Claim & claim items
 * ---------------------------------------------------------------------------------------------- */

export type VerificationDecision = 'PENDING' | 'ACCEPTED' | 'REDUCED' | 'DISALLOWED' | 'BILL_REQUESTED';

/**
 * One line of an expense claim.
 *
 * `claimedAmount` is written once at claim creation and never again — every verification decision
 * lands in `approvedAmount`/`disallowedAmount`/`decision` alongside it. That is what makes the
 * Finance verification screen of spec section 22 possible (Claimed | Policy | Allowed | Disallowed
 * side by side) and what control rule 51.8 requires: Finance cannot silently modify an employee's
 * claim, because the original figure is still there.
 */
export interface TravelClaimItem {
  id: string;
  organizationId: string;
  claimId: string;
  travelRequestId: string;
  /** The captured expense this line came from, or null for a system-generated line (DA). */
  expenseId: string | null;

  expenseDate: string;
  category: ExpenseCategory;
  vendor?: string;
  description?: string;
  quantity?: number;

  /** IMMUTABLE after claim submission. */
  claimedAmount: number;
  gstAmount?: number;

  /** The policy ceiling that applied, snapshotted so a later entitlement edit can't change history. */
  policyLimit: number | null;
  /** What policy allowed on its own, before any human decision. */
  policyAllowedAmount: number;
  policyNote?: string;

  /** Finance's decision. Null until verified. */
  approvedAmount: number | null;
  disallowedAmount: number;
  decision: VerificationDecision;
  verifierRemarks?: string;
  verifiedBy?: string;
  verifiedByName?: string;
  verifiedAt?: Timestamp | null;

  /** Employee's justification when the line exceeds entitlement (spec section 23). */
  exceptionReason?: string;
  exceptionApprovedBy?: string;
  exceptionApprovedByName?: string;
  exceptionApprovedAt?: Timestamp | null;

  /** True for a line the company already settled directly; deducted at settlement, never paid. */
  paidByCompany: boolean;
  bookingId?: string | null;

  billReference?: string;
  fileHash?: string;
  flags?: string[];

  accountingHead?: string;
  projectId?: string;
  projectName?: string;
  costCentre?: string;

  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface TravelClaim {
  id: string;
  organizationId: string;
  referenceNumber: string;
  financialYear: string;
  travelRequestId: string;
  travelRequestNumber: string;

  employeeId: string;
  employeeUserId: string;
  employeeName: string;
  departmentId?: string;
  departmentName?: string;
  projectId?: string;
  projectName?: string;
  costCentre?: string;
  reportingManagerId?: string;

  claimDate: string;
  /** Denormalized totals, recomputed by `summarizeSettlement` on every item change. */
  totalClaimed: number;
  totalApproved: number;
  totalDisallowed: number;
  companyPaid: number;
  advancePaid: number;
  netPayable: number;
  netRecoverable: number;

  /** The tour's approved estimate, copied in for the variance report. */
  approvedEstimate: number;

  status: ClaimStatus;
  itemCount: number;

  submittedAt?: Timestamp | null;
  managerVerifiedBy?: string;
  managerVerifiedByName?: string;
  managerVerifiedAt?: Timestamp | null;
  financeVerifiedBy?: string;
  financeVerifiedByName?: string;
  financeVerifiedAt?: Timestamp | null;
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: Timestamp | null;
  correctionRemarks?: string;
  rejectionReason?: string;

  settlementId?: string | null;
  paymentId?: string | null;
  recoveryId?: string | null;
  /** Set once the accounting entry has been posted; a claim can't close before this. */
  financePosted?: boolean;
  financePostedAt?: Timestamp | null;

  history: TravelApprovalEntry[];

  createdBy?: string;
  createdByName?: string;
  createdAt?: Timestamp;
  updatedBy?: string;
  updatedByName?: string;
  updatedAt?: Timestamp;
}

/* ------------------------------------------------------------------------------------------------
 * Settlement, payment, recovery
 * ---------------------------------------------------------------------------------------------- */

export interface TravelSettlement {
  id: string;
  organizationId: string;
  referenceNumber: string;
  financialYear: string;
  claimId: string;
  claimNumber: string;
  travelRequestId: string;
  travelRequestNumber: string;
  employeeId: string;
  employeeUserId: string;
  employeeName: string;

  totalClaimed: number;
  totalApproved: number;
  totalDisallowed: number;
  companyPaid: number;
  advancePaid: number;
  net: number;
  payableToEmployee: number;
  recoverableFromEmployee: number;
  outcome: 'Payable to employee' | 'Nil settlement' | 'Recoverable from employee';

  settledBy: string;
  settledByName: string;
  settledAt?: Timestamp;
  createdAt?: Timestamp;
}

export interface TravelPayment {
  id: string;
  organizationId: string;
  referenceNumber: string;
  financialYear: string;
  settlementId: string;
  claimId: string;
  travelRequestId: string;
  employeeId: string;
  employeeUserId: string;
  employeeName: string;

  amount: number;
  status: PaymentStatus;
  bankAccount?: string;
  paymentDate?: string;
  mode?: AdvancePaymentMode;
  bankName?: string;
  transactionReference?: string;
  voucherNumber?: string;
  failureReason?: string;

  paidBy?: string;
  paidByName?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export type RecoveryMode = 'Employee Bank Deposit' | 'Cash Deposit' | 'Payroll Deduction' | 'Adjustment Against Claim';

export const RECOVERY_MODES: RecoveryMode[] = ['Employee Bank Deposit', 'Cash Deposit', 'Payroll Deduction', 'Adjustment Against Claim'];

export interface TravelRecovery {
  id: string;
  organizationId: string;
  referenceNumber: string;
  financialYear: string;
  settlementId: string;
  claimId: string;
  travelRequestId: string;
  employeeId: string;
  employeeUserId: string;
  employeeName: string;

  amount: number;
  recoveredAmount: number;
  status: RecoveryStatus;
  mode?: RecoveryMode;
  /** Set for 'Adjustment Against Claim' — the claim absorbing this recovery. */
  adjustedAgainstClaimId?: string | null;
  /** Set for 'Payroll Deduction' — the payroll period the deduction was pushed to. */
  payrollPeriod?: string;
  receivedOn?: string;
  transactionReference?: string;
  remarks?: string;
  waiverReason?: string;

  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

/* ------------------------------------------------------------------------------------------------
 * Audit
 * ---------------------------------------------------------------------------------------------- */

/**
 * One entry of the module's audit trail (spec section 50). Written for every state transition on
 * every entity; `oldValue`/`newValue` carry only the fields that changed, so an entry stays
 * readable and doesn't duplicate the whole document.
 */
export interface TravelAuditLog {
  id: string;
  organizationId: string;
  entityType: 'request' | 'advance' | 'booking' | 'expense' | 'claim' | 'claimItem' | 'settlement' | 'payment' | 'recovery' | 'settings';
  entityId: string;
  /** The tour everything ultimately hangs off, so one query returns a whole tour's history. */
  travelRequestId?: string;
  action: string;
  summary: string;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  userId: string;
  userName: string;
  remarks?: string;
  createdAt?: Timestamp;
}

/* ------------------------------------------------------------------------------------------------
 * Settings
 * ---------------------------------------------------------------------------------------------- */

export interface TravelSettings {
  organizationId: string;
  organizationName: string;
  /** Used in document numbers; falls back to the organization name's initials. */
  organizationCode?: string;

  general: {
    /** When false, an expense claim may exist without a prior approved tour (control rule 51.1). */
    requireApprovedTour: boolean;
    /** Days after tour completion before a claim is overdue. */
    claimSubmissionDeadlineDays: number;
    /** Days after advance payment before it's overdue — feeds `evaluateOutstandingAdvances`. */
    advanceSettlementDeadlineDays: number;
    /** What a new advance request does when an old one is overdue. */
    outstandingAdvancePolicy: OutstandingAdvanceAction;
    /** Tolerance either side of the tour window before an expense date is flagged. */
    expenseDateToleranceDays: number;
    /** When true, a tour with no matching approval rule is rejected rather than auto-approved. */
    requireApprovalRule: boolean;
    defaultGrade: string;
    /** City class used when a city isn't in the classification list. */
    defaultCityClass: CityClass;
    allowEmergencyTours: boolean;
    allowRequestOnBehalf: boolean;
  };

  allowances: {
    daSlabs: DaSlab[];
    /** When false, DA is entered manually instead of derived from the itinerary. */
    autoCalculateDa: boolean;
    /** Caps that override entitlement for specific categories; 0/absent means no cap. */
    categoryCaps: Partial<Record<ExpenseCategory, number>>;
  };

  controls: {
    /** Lock financial fields once a tour is CLOSED (spec section 26). */
    lockClosedTours: boolean;
    flagDuplicateBills: boolean;
    requireBillAbove: number;
    requireExceptionReason: boolean;
    /** Post approved travel expense to the project cost ledger (spec section 34). */
    postToProjectCost: boolean;
  };

  notifications: {
    inApp: boolean;
    email: boolean;
    push: boolean;
    /** Days before departure to remind the traveller. */
    daysBeforeTravel: number[];
    /** Days after tour completion to chase the claim. */
    claimReminderDays: number[];
    /** Day counts at which an unsettled advance escalates, in order. */
    advanceEscalationDays: number[];
    recipients: string[];
  };

  accounting: {
    /** Expense category → GL code (spec section 36). */
    categoryLedgers: Partial<Record<ExpenseCategory, string>>;
    advanceLedger: string;
    employeePayableLedger: string;
    bankLedger: string;
  };
}

export const DEFAULT_TRAVEL_SETTINGS: TravelSettings = {
  organizationId: 'default',
  organizationName: 'Default Organization',
  general: {
    requireApprovedTour: true,
    claimSubmissionDeadlineDays: 7,
    advanceSettlementDeadlineDays: 15,
    outstandingAdvancePolicy: 'Require Finance override',
    expenseDateToleranceDays: 1,
    requireApprovalRule: false,
    defaultGrade: DEFAULT_TRAVEL_GRADE,
    defaultCityClass: 'Tier 3',
    allowEmergencyTours: true,
    allowRequestOnBehalf: true,
  },
  allowances: {
    daSlabs: DEFAULT_DA_SLABS,
    autoCalculateDa: true,
    categoryCaps: {},
  },
  controls: {
    lockClosedTours: true,
    flagDuplicateBills: true,
    requireBillAbove: 500,
    requireExceptionReason: true,
    postToProjectCost: true,
  },
  notifications: {
    inApp: true,
    email: true,
    push: false,
    daysBeforeTravel: [1],
    claimReminderDays: [1, 3, 7],
    advanceEscalationDays: [15, 30],
    recipients: ['Traveller', 'Reporting Manager', 'Finance'],
  },
  accounting: {
    categoryLedgers: {
      Airfare: '510101',
      Train: '510101',
      Bus: '510101',
      Hotel: '510102',
      'Daily Allowance': '510103',
      'Local Conveyance': '510104',
      Taxi: '510104',
      Auto: '510104',
    },
    advanceLedger: 'Employee Advance',
    employeePayableLedger: 'Employee Payable',
    bankLedger: 'Bank',
  },
};

/**
 * The default approval chain, used when an organization hasn't configured any rule yet. Matches the
 * standard chain of spec section 9; thresholds are configured as `TravelApprovalRule` rows on top.
 */
export const DEFAULT_TRAVEL_APPROVAL_STAGES: TravelApprovalStage[] = [
  { id: '1', name: 'Reporting Manager', assignmentType: 'Reporting Manager', assignedTo: [], tat: 24 },
  { id: '2', name: 'HOD / Project Manager', assignmentType: 'HOD', assignedTo: [], tat: 24 },
  { id: '3', name: 'Finance Review', assignmentType: 'Role-based', assignedTo: ['Finance'], tat: 24 },
];

/* ------------------------------------------------------------------------------------------------
 * Shared display helpers
 * ---------------------------------------------------------------------------------------------- */

export const travelCurrency = (value: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value) || 0);

/** Full-precision variant for verification screens, where rounding away paise hides a mismatch. */
export const travelCurrencyExact = (value: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0);

/** Nights between two dates, floored at zero so a reversed pair can't produce a negative cap. */
export function nightsBetween(checkIn: string, checkOut: string): number {
  const from = new Date(`${(checkIn || '').slice(0, 10)}T00:00:00`);
  const to = new Date(`${(checkOut || '').slice(0, 10)}T00:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86_400_000));
}

/**
 * Reads a tour as CLAIM_PENDING once travel is over and the claim deadline has passed without a
 * submission, so the dashboard and reminders agree on what's overdue without a nightly job having
 * to rewrite documents. Mirrors `effectiveStatus` in recurring-payments.ts.
 */
export function effectiveTourStatus(
  request: Pick<TravelRequest, 'status' | 'returnDate' | 'claimId'>,
  claimDeadlineDays: number,
  asOf: Date = new Date(),
): TourStatus {
  if (request.status !== 'COMPLETED' || request.claimId) return request.status;
  const returned = new Date(`${(request.returnDate || '').slice(0, 10)}T00:00:00`);
  if (Number.isNaN(returned.getTime())) return request.status;
  const deadline = returned.getTime() + Math.max(0, claimDeadlineDays) * 86_400_000;
  return asOf.getTime() > deadline ? 'CLAIM_PENDING' : request.status;
}

/**
 * Matches a project/department/branch filter against a record storing the scope as both an id and a
 * denormalized name. Same contract as `matchesScopeFilter` in recurring-payments.ts — duplicated
 * rather than imported because that module pulls in the Firestore client, and re-deriving the
 * comparison inline is what let renamed scopes silently stop matching there.
 */
export function matchesTravelScope(
  filterValue: string,
  record: { id?: string; name?: string },
  entries: Array<{ id: string; name: string }>,
): boolean {
  if (!filterValue || filterValue === 'all') return true;
  if (record.id && record.id === filterValue) return true;
  const selected = entries.find(entry => entry.id === filterValue);
  return !!selected && !!record.name && record.name === selected.name;
}

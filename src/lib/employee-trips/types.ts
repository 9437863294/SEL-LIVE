/**
 * Employee trip claims (Driver Management › My Trips, Claims, Approvals, Payments).
 *
 * Every employee records the official trips they make — on their own vehicle or on a company
 * vehicle from Vehicle Master — and is reimbursed per kilometre at the rate the company set for
 * that kind of vehicle on the trip's date. The lifecycle:
 *
 *   Trip recorded (draft) → some or all drafts submitted together as a claim
 *     → approval stage(s): the named approver accepts, cuts the km of, rejects or sends back
 *       each trip → payment stage: the named payer records the payment → Paid
 *
 * Three decisions shape the model:
 *
 *   1. **A claim is a record of one submission, never reopened.** Sending a claim (or one of its
 *      trips) back releases those trips to the employee as drafts with the reason attached, and the
 *      employee submits them again on a new claim. The old claim keeps its history, so "what was
 *      asked for, and what each person decided" stays answerable without a resubmission state.
 *   2. **The claimed figures are frozen at submission.** Approvers write `decision` beside them;
 *      the trip's own distance and amount are never overwritten, so the register can show claimed
 *      against approved for every line.
 *   3. **The server prices every trip.** Rates come from the rate card in effect on the trip's date
 *      (`rates.ts`); a revised rate never re-prices a trip already submitted.
 *
 * All data goes through `/api/driver-management/*` on the Admin SDK — the browser has no Firestore
 * access to these collections (they are in `serverOnly` in firestore.rules) — so the rules below
 * hold whoever calls. Pure: the API, the screens and the tests share it.
 */

export const ET_COLLECTIONS = {
  trips: 'employeeTripRecords',
  claims: 'employeeTripClaims',
  settings: 'employeeTripSettings',
  counters: 'employeeTripCounters',
} as const;

export const ET_MODULE = 'Driver Management';

export type VehicleOwnership = 'own' | 'company';

export const OWNERSHIP_LABELS: Record<VehicleOwnership, string> = {
  own: 'Own vehicle',
  company: 'Company vehicle',
};

/**
 * - `draft`: recorded, editable, not yet claimed (also where a sent-back trip lands).
 * - `submitted`: on a claim that is still in approval.
 * - `approved`: passed every approval stage; waiting for payment.
 * - `rejected` / `paid`: final.
 */
export type TripStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'paid';

export const TRIP_STATUS_LABELS: Record<TripStatus, string> = {
  draft: 'Unclaimed',
  submitted: 'In approval',
  approved: 'Awaiting payment',
  rejected: 'Rejected',
  paid: 'Paid',
};

/**
 * - `pending`: at an approval stage.
 * - `approved`: through every approval stage, at the payment stage.
 * - `paid`, `rejected`, `returned` (sent back to the employee), `withdrawn` (pulled back by them): final.
 */
export type ClaimStatus = 'pending' | 'approved' | 'paid' | 'returned' | 'rejected' | 'withdrawn';

export const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  pending: 'In approval',
  approved: 'Awaiting payment',
  paid: 'Paid',
  returned: 'Sent back',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};

export const ACTIVE_CLAIM_STATUSES: readonly ClaimStatus[] = ['pending', 'approved'];

/* ── rate card ─────────────────────────────────────────────────────────── */

/** One vehicle type's rates. `null` = not reimbursed per km for that ownership. */
export interface RateRow {
  vehicleType: string;
  own: number | null;
  company: number | null;
}

/**
 * The whole rate card from a date on. A trip is priced by the revision in effect on its date, so a
 * new rate is a new revision rather than an edit: the trips already priced keep the rate they were
 * priced at, and the history of what was paid per km stays readable.
 */
export interface RateRevision {
  id: string;
  /** YYYY-MM-DD. */
  effectiveFrom: string;
  rates: RateRow[];
  note?: string;
  savedById?: string;
  savedByName?: string;
  savedAt?: string;
}

/* ── rules ─────────────────────────────────────────────────────────────── */

export interface TripRules {
  allowOwnVehicle: boolean;
  allowCompanyVehicle: boolean;
  /** Odometer start and end are required; otherwise the distance may be typed in. */
  requireOdometer: boolean;
  allowTollParking: boolean;
  requireProject: boolean;
  /**
   * A new trip may be typed in by hand. Off: every new trip is recorded by GPS (Fleet Trip › Own
   * vehicle), and the form only edits trips already recorded.
   */
  allowTypedTrips: boolean;
  /** A trip longer than this is flagged for the approver (not blocked). */
  maxKmPerTrip: number | null;
  /** A day whose trips add up to more than this is flagged. */
  maxKmPerDay: number | null;
  /** Trips older than this many days can no longer be recorded or submitted. */
  claimWindowDays: number | null;
}

/* ── workflow ──────────────────────────────────────────────────────────── */

/**
 * Who works a stage:
 * - `reporting`: the claimant's reporting authority — an exception set here for that employee, else
 *   the reporting manager on their login (Access Management), else their manager in greytHR's org
 *   tree; the stage's own people when none of those names anyone.
 * - `users`: the stage's named people, for every claim.
 * - `project` / `department`: named people per project or department of the claim, the stage's own
 *   people for one without a route.
 */
export type StageRouting = 'reporting' | 'users' | 'project' | 'department';

export const ROUTING_LABELS: Record<StageRouting, string> = {
  reporting: "Employee's reporting authority",
  users: 'Same people for every claim',
  project: 'By project',
  department: 'By department',
};

export interface StageRoute {
  /** The project or department id — or, for `reporting`, the employee whose authority this sets. */
  key: string;
  userIds: string[];
}

/** Where an employee's reporting authority came from (before any exception set on a stage). */
export type ReportingSource = 'access' | 'greythr';

export const REPORTING_SOURCE_LABELS: Record<ReportingSource, string> = {
  access: 'reporting manager in Access Management',
  greythr: 'manager in greytHR',
};

export type StageKind = 'approval' | 'payment';

export interface WorkflowStage {
  id: string;
  name: string;
  kind: StageKind;
  routing: StageRouting;
  /** The stage's people — for routed stages, the fallback. Any one of them can act. */
  userIds: string[];
  routes: StageRoute[];
  /** Approval stages only: the stage applies to claims of at least this amount. */
  minAmount: number | null;
  /** Hours before a claim waiting at this stage counts as overdue. */
  tatHours: number | null;
}

export interface TripClaimSettings {
  rateRevisions: RateRevision[];
  rules: TripRules;
  /** Approval stages in order, then exactly one payment stage. */
  stages: WorkflowStage[];
  updatedAt?: string;
  updatedById?: string;
  updatedByName?: string;
}

/* ── records ───────────────────────────────────────────────────────────── */

export type FlagCode = 'no_rate' | 'over_trip_limit' | 'over_day_limit' | 'odometer_overlap' | 'possible_duplicate';

export const FLAG_LABELS: Record<FlagCode, string> = {
  no_rate: 'No rate set',
  over_trip_limit: 'Long trip',
  over_day_limit: 'Day limit exceeded',
  odometer_overlap: 'Odometer overlap',
  possible_duplicate: 'Possible duplicate',
};

export const FLAG_HINTS: Record<FlagCode, string> = {
  no_rate: 'The rate card has no per-km rate for this vehicle type and ownership on the trip date, so only toll and parking are claimed.',
  over_trip_limit: 'Longer than the per-trip limit in Settings › Trip rules.',
  over_day_limit: "The employee's trips that day add up to more than the daily limit.",
  odometer_overlap: "The odometer range overlaps another trip logged on the same vehicle.",
  possible_duplicate: 'Another trip by the same employee has the same date, route and a similar distance.',
};

export type LineDecision = 'approve' | 'adjust' | 'reject' | 'return';

/** An approver's decision on one trip of a claim. The trip's claimed figures stay beside it. */
export interface TripDecision {
  decision: 'approve' | 'adjust' | 'reject';
  approvedKm: number;
  approvedAmount: number;
  remarks?: string;
  stageName: string;
  byId: string;
  byName: string;
  at: string;
}

/** Whether the distance was measured or entered. */
export type TripSource = 'manual' | 'gps';

/**
 * What a GPS-recorded trip measured.
 *
 * Stored beside the claimed distance rather than instead of it: the employee can still correct
 * the figure before submitting, and the approver can see both what was measured and what was
 * claimed. `fixes` against `droppedFixes` is how a short, sparse path explains itself — a trip
 * built from 12 of 300 readings deserves a second look.
 */
export interface TripGpsEvidence {
  measuredKm: number;
  startedAtIso: string;
  endedAtIso: string;
  movingMinutes: number;
  idleMinutes: number;
  stopCount: number;
  fixes: number;
  droppedFixes: number;
  /** A downsampled path, for drawing the route on the claim. Capped to keep the document small. */
  path: Array<{ lat: number; lng: number }>;
}

export interface TripRecord {
  id: string;
  organizationId: string;
  employeeId: string;
  employeeName: string;
  /** YYYY-MM-DD. */
  tripDate: string;
  ownership: VehicleOwnership;
  vehicleType: string;
  /** Upper case, no spaces. */
  vehicleNumber: string;
  /** Vehicle Master id, for a company vehicle. */
  vehicleId: string | null;
  fromPlace: string;
  toPlace: string;
  purpose: string;
  startOdometer: number | null;
  endOdometer: number | null;
  distanceKm: number;
  projectId: string | null;
  projectName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  tollAmount: number;
  parkingAmount: number;
  ratePerKm: number | null;
  rateRevisionId: string | null;
  distanceAmount: number;
  totalAmount: number;
  flags: FlagCode[];
  notes: string;
  status: TripStatus;
  claimId: string | null;
  claimNumber: string | null;
  decision: TripDecision | null;
  /** Why the trip was sent back, shown until it is claimed again. */
  returnNote: { remarks: string; byName: string; at: string; claimNumber: string } | null;
  /** Claims this trip was on before (sent back or withdrawn), oldest first. */
  previousClaims: string[];
  /**
   * How the distance got here.
   *
   * A claim line is money, and 'somebody typed 42' and 'a phone measured 41.6 over 212 fixes'
   * are not the same evidence. An approver cannot tell them apart without this.
   */
  source: TripSource;
  /** Present only on a GPS-recorded trip — what was measured, for the approver to weigh. */
  gps: TripGpsEvidence | null;
  createdAt: string;
  updatedAt: string;
}

/** A stage as frozen onto a claim, with its people resolved for that claim. */
export interface ClaimStage {
  id: string;
  name: string;
  kind: StageKind;
  assigneeIds: string[];
  assigneeNames: string[];
  tatHours: number | null;
}

export type ClaimAction = 'submitted' | 'approved' | 'paid' | 'returned' | 'rejected' | 'withdrawn' | 'rerouted';

export interface ClaimHistoryEntry {
  action: ClaimAction;
  stageName: string;
  byId: string;
  byName: string;
  at: string;
  remarks?: string;
  /** Approved amount after an approval, paid amount for a payment. */
  amount?: number;
  /** Acted for an absent assignee (Trip Claims · Override Workflow). */
  override?: boolean;
  /** Trips decided other than "approve" in this action: "3 rejected, 1 km cut". */
  lineSummary?: string;
}

export type PaymentMode = 'Bank Transfer' | 'NEFT' | 'IMPS' | 'UPI' | 'Cheque' | 'Cash' | 'Payroll';

export const PAYMENT_MODES: readonly PaymentMode[] = ['Bank Transfer', 'NEFT', 'IMPS', 'UPI', 'Cheque', 'Cash', 'Payroll'];

export interface ClaimPayment {
  paidOn: string;
  mode: PaymentMode;
  reference: string;
  remarks: string;
  amount: number;
  byId: string;
  byName: string;
  at: string;
}

export interface ClaimTotals {
  tripCount: number;
  distanceKm: number;
  claimedAmount: number;
  tollParking: number;
  /** Over the trips still on the claim and not rejected. */
  approvedKm: number;
  approvedAmount: number;
}

export interface TripClaim {
  id: string;
  organizationId: string;
  claimNumber: string;
  financialYear: string;
  employeeId: string;
  employeeName: string;
  /** Set when the workflow routes by project/department: every trip on the claim shares it. */
  projectId: string | null;
  projectName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  /** The claimant's reporting authority as resolved at submission — kept for re-routing. */
  reportingAuthorityIds: string[];
  tripIds: string[];
  periodFrom: string;
  periodTo: string;
  totals: ClaimTotals;
  status: ClaimStatus;
  stages: ClaimStage[];
  currentStageIndex: number;
  /** The people the claim waits for now (never the claimant). Empty once it is final. */
  currentAssigneeIds: string[];
  stageEnteredAt: string;
  /** Everyone who has acted on the claim, for "processed by me". */
  actedByIds: string[];
  history: ClaimHistoryEntry[];
  payment: ClaimPayment | null;
  remarks: string;
  submittedAt: string;
  updatedAt: string;
}

/* ── formatting ────────────────────────────────────────────────────────── */

export const formatKm = (km: number | null | undefined): string => {
  const value = Number(km ?? 0);
  return `${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 }).format(Number.isFinite(value) ? value : 0)} km`;
};

/** India's financial year for a date: 2026-10-23 → "2026-27". */
export function financialYearOf(date: string): string {
  const [yearText, monthText] = (date || '').split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  if (!year || !month) return '';
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** "Today" in India, whatever timezone the code runs in. */
export function indiaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Whole days from `from` to `to` (YYYY-MM-DD each); negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

export const isIsoDate = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

export const normaliseVehicleNumber = (value: unknown): string => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

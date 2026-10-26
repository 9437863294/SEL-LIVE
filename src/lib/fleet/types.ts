/**
 * SEL Fleet — company-vehicle trips, geofences, daily km limits, fuel and the monthly payment
 * report (docs/fleet/PLAN.md). The shapes every part of the fleet build shares.
 *
 * Pure TypeScript with no imports beyond this folder, so Node runs it in tests with type stripping.
 * Times are ISO strings in UTC; a `dateKey` is the Asia/Kolkata calendar date (`yyyy-MM-dd`) and a
 * `monthKey` its month (`yyyy-MM`).
 *
 * Personal-vehicle travel is not here: it is Driver Management's My Trips and claims
 * (src/lib/employee-trips), reimbursed per km to the employee.
 */

export const FLEET_COLLECTIONS = {
  /** Existing Vehicle Management collections, extended with the fleet fields below. */
  vehicles: 'vehicleManagementVehicles',
  drivers: 'vehicleManagementDriver',
  trips: 'vehicleManagementTrips',
  points: 'vehicleManagementTripLocations',
  fuel: 'vehicleManagementFuelLogs',
  /** New. */
  geofenceEvents: 'vehicleManagementTripGeofenceEvents',
  geofences: 'fleetGeofences',
  purposes: 'fleetPurposes',
  approvals: 'fleetApprovals',
  dailySummary: 'fleetDailySummary',
  reports: 'fleetPaymentReports',
  settings: 'fleetSettings',
  uploads: 'fleetUploads',
} as const;

/** Storage prefixes, closed to browsers in storage.rules; files go through /api/fleet. */
export const FLEET_STORAGE_PREFIX = 'fleet';

/* ── vehicles ──────────────────────────────────────────────────────────── */

export type FleetCategory = 'bike' | 'car' | 'pickup';
export const FLEET_CATEGORIES: FleetCategory[] = ['bike', 'car', 'pickup'];
export const FLEET_CATEGORY_LABELS: Record<FleetCategory, string> = { bike: 'Two-wheeler', car: 'Car', pickup: 'Pickup / goods' };

export type CostBasis = 'per_km' | 'fixed_plus_fuel';
export const COST_BASIS_LABELS: Record<CostBasis, string> = { per_km: 'Per km', fixed_plus_fuel: 'Fixed monthly + fuel' };

export interface OdometerBaseline {
  km: number;
  at: string;
  byId: string;
  byName: string;
  reason: string;
  photoPath: string | null;
  previousKm: number | null;
}

/**
 * A Vehicle Master record as the fleet sees it. The fleet fields are optional on the document;
 * `normaliseVehicle` fills each from the fleet settings' defaults for the vehicle's category.
 */
export interface FleetVehicle {
  id: string;
  vehicleNumber: string;
  vehicleType: string;
  fuelType: string;
  active: boolean;
  category: FleetCategory;
  /** Set on the record, or derived from `vehicleType`. */
  categorySet: boolean;
  tankCapacityL: number | null;
  stdMileageKmpl: number | null;
  mileageTolerancePct: number;
  dailyKmLimit: number;
  monthlyKmLimit: number;
  costBasis: CostBasis;
  ratePerKm: number;
  fixedMonthlyCost: number;
  homeGeofenceId: string | null;
  approverUid: string | null;
  backupApproverUid: string | null;
  serviceIntervalKm: number;
  lastServiceKm: number | null;
  lastServiceDate: string | null;
  siteInternalExemptFromLimit: boolean;
  /** The one-running-trip lock: the id of the trip driving it now. */
  currentTripId: string | null;
  currentOdometerKm: number | null;
  odometerBaselineHistory: OdometerBaseline[];
  assignedDriverId: string | null;
  assignedDriverName: string;
}

/** The Vehicle Master fields the fleet adds; everything else on the record is left alone. */
export const VEHICLE_FLEET_FIELDS = [
  'fleetCategory',
  'tankCapacityL',
  'stdMileageKmpl',
  'mileageTolerancePct',
  'dailyKmLimit',
  'monthlyKmLimit',
  'costBasis',
  'ratePerKm',
  'fixedMonthlyCost',
  'homeGeofenceId',
  'approverUid',
  'backupApproverUid',
  'serviceIntervalKm',
  'lastServiceKm',
  'lastServiceDate',
  'siteInternalExemptFromLimit',
] as const;

/* ── masters ───────────────────────────────────────────────────────────── */

export type GeofenceKind = 'office' | 'yard' | 'fuel_station' | 'project_site' | 'other';
export const GEOFENCE_KINDS: GeofenceKind[] = ['office', 'yard', 'fuel_station', 'project_site', 'other'];
export const GEOFENCE_KIND_LABELS: Record<GeofenceKind, string> = {
  office: 'Office',
  yard: 'Yard / parking',
  fuel_station: 'Fuel station',
  project_site: 'Project site',
  other: 'Other',
};

export interface Geofence {
  id: string;
  organizationId: string;
  name: string;
  kind: GeofenceKind;
  lat: number;
  lng: number;
  radiusM: number;
  /** For a project site: the project it belongs to. */
  projectId: string | null;
  address: string;
  active: boolean;
  createdAt: string;
  createdById: string;
  updatedAt: string;
  updatedById: string;
  deletedAt: string | null;
}

export const GEOFENCE_RADIUS_MIN_M = 30;
export const GEOFENCE_RADIUS_MAX_M = 5000;

export interface Purpose {
  id: string;
  organizationId: string;
  name: string;
  /** "Other" and the like: the driver must say what it was. */
  requiresReason: boolean;
  requiresProject: boolean;
  active: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export const SEED_PURPOSES: Array<Pick<Purpose, 'name' | 'requiresReason' | 'requiresProject'>> = [
  { name: 'Site visit', requiresReason: false, requiresProject: true },
  { name: 'Material delivery', requiresReason: false, requiresProject: true },
  { name: 'Client meeting', requiresReason: false, requiresProject: false },
  { name: 'Office transfer', requiresReason: false, requiresProject: false },
  { name: 'Fuel fill', requiresReason: false, requiresProject: false },
  { name: 'Service / repair', requiresReason: false, requiresProject: false },
  { name: 'Other', requiresReason: true, requiresProject: false },
];

export interface ProjectOption {
  id: string;
  name: string;
  /** `projects.siteCode` (ASSUMPTIONS.md D3). */
  code: string;
  clientName: string;
  active: boolean;
  siteGeofenceIds: string[];
}

/* ── settings ──────────────────────────────────────────────────────────── */

export interface FleetSettings {
  dailyKmLimitByCategory: Record<FleetCategory, number>;
  monthlyKmLimit: number;
  serviceIntervalKm: number;
  mileageTolerancePct: number;
  /** Billable = odometer when |GPS − odometer| ≤ max(abs km, pct of odometer). */
  mismatchAbsKm: number;
  mismatchPct: number;
  /** A trip's opening reading this far above the last closing one means running nobody logged. */
  unloggedKmTolerance: number;
  /** Over-limit requests: next level after this long, expired after `approvalExpiryMinutes`. */
  approvalEscalateMinutes: number;
  approvalExpiryMinutes: number;
  /** Who a request reaches at the last level (and admins of the fleet generally). */
  escalationUserIds: string[];
  emergencyMonthlyMax: number;
  /** No GPS fix for this long during a trip is a gap; the driver is reminded after `idleRemindMinutes`. */
  gpsGapMinutes: number;
  idleRemindMinutes: number;
  /** A trip silent this long, or running this long, is closed by the system for review. */
  idleAutoCloseMinutes: number;
  maxTripHours: number;
  /** Fuel: price per litre this far from the vehicle's recent fills is flagged. */
  fuelRateVariancePct: number;
  /** Google Cloud Vision reads odometer photos (decision D2). Off until the API is enabled. */
  ocrEnabled: boolean;
  /** Any active employee may drive a company vehicle (D1); off: Driver Master drivers only. */
  anyEmployeeMayDrive: boolean;
  /** Company-vehicle trips are fleet trips, and My Trips takes personal vehicles only (D1). */
  companyTripsInFleet: boolean;
  /** Payment report and digest recipients (emails), and who is told about exceptions. */
  reportEmails: string[];
  digestUserIds: string[];
  updatedAt?: string;
  updatedById?: string;
  updatedByName?: string;
}

/* ── trips ─────────────────────────────────────────────────────────────── */

export type FleetTripStatus = 'running' | 'paused' | 'completed' | 'pending_review' | 'cancelled';
export const OPEN_TRIP_STATUSES: FleetTripStatus[] = ['running', 'paused'];
export const FLEET_TRIP_STATUS_LABELS: Record<FleetTripStatus, string> = {
  running: 'Running',
  paused: 'Paused',
  completed: 'Completed',
  pending_review: 'Pending review',
  cancelled: 'Cancelled',
};

/** The status Vehicle Management › Trip Management and the GPS log already read (`tripStatus`). */
export function legacyTripStatus(status: FleetTripStatus): 'In Progress' | 'Completed' | 'Cancelled' {
  if (status === 'running' || status === 'paused') return 'In Progress';
  if (status === 'cancelled') return 'Cancelled';
  return 'Completed';
}

export type TripFlagCode =
  | 'gps_odo_mismatch'
  | 'gps_gap'
  | 'no_gps'
  | 'long_idle'
  | 'over_limit'
  | 'over_cap'
  | 'emergency'
  | 'unlogged_km'
  | 'ocr_mismatch'
  | 'auto_closed'
  | 'crossed_midnight'
  | 'odometer_baseline';

export const TRIP_FLAG_LABELS: Record<TripFlagCode, string> = {
  gps_odo_mismatch: 'GPS and odometer disagree',
  gps_gap: 'GPS gap',
  no_gps: 'No GPS track',
  long_idle: 'Long idle',
  over_limit: 'Over daily limit',
  over_cap: 'Beyond approved km',
  emergency: 'Emergency start',
  unlogged_km: 'Unlogged running before trip',
  ocr_mismatch: 'Reading differs from photo',
  auto_closed: 'Not ended by the driver',
  crossed_midnight: 'Crossed midnight',
  odometer_baseline: 'Odometer reset (baseline)',
};

export const TRIP_FLAG_HINTS: Record<TripFlagCode, string> = {
  gps_odo_mismatch: 'The odometer and GPS distances differ by more than the allowed margin; a manager picks the billable figure.',
  gps_gap: 'The phone sent no position for a long stretch — background tracking stopped or there was no signal.',
  no_gps: 'Too few GPS fixes to measure the trip; the odometer figure stands.',
  long_idle: 'The vehicle stood still for a long time during the trip.',
  over_limit: "The vehicle's km for the day went past its daily limit.",
  over_cap: 'The trip ran further than the km the manager approved.',
  emergency: 'Started past the daily limit without approval, as an emergency.',
  unlogged_km: "The opening reading is well above the vehicle's last closing reading: it ran without a trip.",
  ocr_mismatch: 'The reading typed differs from the reading read off the photo.',
  auto_closed: 'The driver never ended it; the system closed it, or a manager did without a closing reading.',
  crossed_midnight: 'Ran past midnight; its km are counted on each day it ran.',
  odometer_baseline: 'Started from an odometer baseline an admin set (meter replaced or reset).',
};

export interface OdometerReading {
  km: number;
  photoPath: string | null;
  /** What OCR read off the photo, when it ran. */
  ocrKm: number | null;
  ocrRaw: string | null;
  at: string;
}

export interface GeofenceVisit {
  geofenceId: string;
  name: string;
  kind: GeofenceKind;
  enterAt: string;
  exitAt: string | null;
  minutes: number;
}

export type BillableSource = 'odometer' | 'gps' | 'manager';

export interface TripCost {
  basis: CostBasis;
  ratePerKm: number;
  /** Per-km vehicles only; a fixed-plus-fuel vehicle's cost is the month's, shared by km. */
  amount: number;
}

export interface TripReview {
  status: 'pending' | 'resolved';
  reason: string;
  choice: BillableSource | null;
  km: number | null;
  note: string;
  byId: string | null;
  byName: string | null;
  at: string | null;
}

export interface FleetTrip {
  id: string;
  organizationId: string;
  status: FleetTripStatus;
  vehicleId: string;
  vehicleNumber: string;
  vehicleCategory: FleetCategory;
  /** The signed-in person driving, and their Driver Master record when they have one. */
  driverUserId: string;
  driverId: string | null;
  driverName: string;
  dateKey: string;
  monthKey: string;
  startedAt: string;
  endedAt: string | null;
  projectId: string | null;
  projectCode: string;
  projectName: string;
  purposeId: string;
  purposeName: string;
  purposeReason: string;
  expectedKm: number;
  startGeofenceId: string | null;
  startGeofenceName: string;
  /** Where the trip began and ended, as the GPS trip names them (reverse-geocoded on the phone, editable). */
  startPlace: string;
  endPlace: string;
  endGeofenceId: string | null;
  endGeofenceName: string;
  startLat: number | null;
  startLng: number | null;
  endLat: number | null;
  endLng: number | null;
  startOdometer: OdometerReading;
  endOdometer: OdometerReading | null;
  gpsDistanceKm: number;
  odoDistanceKm: number | null;
  billableDistanceKm: number | null;
  billableSource: BillableSource | null;
  /** Billable km by the IST date it was driven on (a trip over midnight counts on both days). */
  kmByDate: Record<string, number>;
  /** GPS km by date — the proportions a billable figure is split in. */
  gpsKmByDate: Record<string, number>;
  pointCount: number;
  lastPointAt: string | null;
  lastPointLat: number | null;
  lastPointLng: number | null;
  idleMinutes: number;
  movingMinutes: number;
  gapCount: number;
  visits: GeofenceVisit[];
  /** Arrivals and departures recomputed by the server from the synced track (the record). */
  geofenceEvents: GeofenceEvent[];
  flagCodes: TripFlagCode[];
  flagged: boolean;
  /** `open` while a flag or review waits for someone; the Exceptions screen lists these. */
  exceptionStatus: 'none' | 'open' | 'resolved';
  exceptionNote: string;
  approvalId: string | null;
  /** The day's km the approval allowed this vehicle (total, not this trip's). */
  approvedKmCap: number | null;
  isEmergency: boolean;
  emergencyReason: string;
  /** Exempt vehicle that stayed inside one project site: not counted toward the daily limit. */
  siteInternal: boolean;
  chainPrevTripId: string | null;
  /** Who manages this trip, frozen at the start: the vehicle's approver and backup, the driver's reporting authority. */
  managerIds: string[];
  costSnapshot: TripCost | null;
  review: TripReview | null;
  pausedAt: string | null;
  pauses: Array<{ from: string; to: string | null }>;
  endedBy: 'driver' | 'auto_idle' | 'auto_max' | 'force' | null;
  endRemark: string;
  cancelReason: string;
  clientStartId: string;
  clientEndId: string | null;
  /** The approved payment report that has counted this trip (`yyyy-MM`), so no report counts it twice. */
  reportedIn: string | null;
  createdAt: string;
  updatedAt: string;
  /** Recorded before SEL Fleet by the retired browser tracker: read-only history (Fleet Trips register). */
  legacy?: boolean;
}

/** A GPS fix as the phone sends it. */
export interface ClientPoint {
  clientPointId: string;
  lat: number;
  lng: number;
  accuracyM: number | null;
  speedKmph: number | null;
  headingDeg: number | null;
  recordedAt: string;
}

export interface GeofenceEvent {
  geofenceId: string;
  geofenceName: string;
  kind: GeofenceKind;
  type: 'enter' | 'exit';
  at: string;
  lat: number;
  lng: number;
}

/* ── approvals ─────────────────────────────────────────────────────────── */

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled' | 'used';
export type ApprovalDecision = 'approve' | 'approve_cap' | 'approve_raise' | 'reject';
export const APPROVAL_STATUS_LABELS: Record<ApprovalStatus, string> = {
  pending: 'Waiting',
  approved: 'Approved',
  rejected: 'Rejected',
  expired: 'Expired',
  cancelled: 'Withdrawn',
  used: 'Used',
};
export const APPROVAL_DECISION_LABELS: Record<ApprovalDecision, string> = {
  approve: 'Approve',
  approve_cap: 'Approve with a km cap',
  approve_raise: 'Approve and raise the limit',
  reject: 'Reject',
};

export interface ApprovalHistoryEntry {
  at: string;
  action: 'requested' | 'escalated' | ApprovalDecision | 'expired' | 'cancelled' | 'used';
  byId: string | null;
  byName: string;
  level: number;
  note: string;
}

export interface FleetApproval {
  id: string;
  organizationId: string;
  status: ApprovalStatus;
  vehicleId: string;
  vehicleNumber: string;
  driverUserId: string;
  driverName: string;
  dateKey: string;
  /** The vehicle's km so far today, its limit, and how far this trip is expected to go. */
  usedKm: number;
  limitKm: number;
  requestedKm: number;
  reason: string;
  projectId: string | null;
  projectName: string;
  purposeId: string;
  purposeName: string;
  /** 1 = the vehicle's approver / reporting authority, 2 = backup, 3 = fleet escalation list. */
  level: number;
  assigneeIds: string[];
  /** Everyone it has reached; any of them may still decide. */
  notifiedIds: string[];
  escalateAt: string | null;
  expiresAt: string;
  decision: ApprovalDecision | null;
  /** The day's total km allowed for the vehicle once approved. */
  allowedKm: number | null;
  newLimitKm: number | null;
  decidedById: string | null;
  decidedByName: string;
  decidedAt: string | null;
  decisionNote: string;
  tripId: string | null;
  history: ApprovalHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

/* ── fuel ──────────────────────────────────────────────────────────────── */

export type FuelPaidBy = 'company' | 'driver' | 'advance';
export const FUEL_PAID_BY_LABELS: Record<FuelPaidBy, string> = {
  company: 'Company (card / account)',
  driver: 'Driver paid — to reimburse',
  advance: 'From a cash advance',
};

export type FuelFlagCode = 'low_mileage' | 'over_tank' | 'rate_variance' | 'no_trip_between_fills' | 'odometer_regression' | 'unlogged_km';
export const FUEL_FLAG_LABELS: Record<FuelFlagCode, string> = {
  low_mileage: 'Low mileage',
  over_tank: 'More than the tank holds',
  rate_variance: 'Unusual price per litre',
  no_trip_between_fills: 'No trip since the last fill',
  odometer_regression: 'Reading below the last one',
  unlogged_km: 'Km with no trip',
};

/** The fields of a fuel log the fleet reads (legacy, admin and fleet entries alike). */
export interface FuelRow {
  id: string;
  vehicleId: string;
  fuelDate: string;
  odometerKm: number | null;
  litres: number;
  amount: number;
  ratePerL: number;
  fullTank: boolean;
  paidBy: FuelPaidBy;
  driverUserId: string | null;
  driverName: string;
  createdAt: string;
}

/* ── summaries and reports ─────────────────────────────────────────────── */

export interface DailySummary {
  id: string;
  organizationId: string;
  vehicleId: string;
  vehicleNumber: string;
  dateKey: string;
  tripCount: number;
  km: number;
  limitKm: number;
  overLimitKm: number;
  approvals: number;
  emergencies: number;
  flaggedTrips: number;
  fuelLitres: number;
  fuelAmount: number;
  updatedAt: string;
}

export type ReportStatus = 'draft' | 'approved';

export interface ReportARow {
  projectId: string | null;
  projectCode: string;
  projectName: string;
  trips: number;
  km: number;
  perKmCost: number;
  fixedShare: number;
  fuelShare: number;
  total: number;
  carriedTrips: number;
}

export interface ReportBRow {
  vehicleId: string;
  vehicleNumber: string;
  category: FleetCategory;
  costBasis: CostBasis;
  trips: number;
  km: number;
  fuelLitres: number;
  fuelAmount: number;
  expectedLitres: number | null;
  varianceLitres: number | null;
  mileageKmpl: number | null;
  stdMileageKmpl: number | null;
  cost: number;
}

export interface ReportCRow {
  tripId: string;
  dateKey: string;
  vehicleNumber: string;
  driverName: string;
  projectName: string;
  status: FleetTripStatus;
  held: boolean;
  gpsKm: number;
  odoKm: number | null;
  billableKm: number | null;
  amount: number;
  flags: TripFlagCode[];
}

export interface ReportDRow {
  driverUserId: string;
  driverName: string;
  entries: number;
  litres: number;
  driverPaid: number;
  fromAdvance: number;
  total: number;
}

export interface PaymentReportTotals {
  trips: number;
  km: number;
  heldTrips: number;
  heldKm: number;
  perKmCost: number;
  fixedCost: number;
  fuelCost: number;
  payable: number;
  reimbursements: number;
}

export interface PaymentReport {
  id: string;
  organizationId: string;
  /** `yyyy-MM` for a monthly run; null for a custom period (preview only, never approved). */
  monthKey: string | null;
  from: string;
  to: string;
  status: ReportStatus;
  reportA: ReportARow[];
  reportB: ReportBRow[];
  reportC: ReportCRow[];
  reportD: ReportDRow[];
  totals: PaymentReportTotals;
  /** The trips counted (not held), marked `reportedIn` when the report is approved. */
  tripIds: string[];
  files: { xlsx: string | null; pdf: string | null; json: string | null };
  generatedAt: string;
  generatedById: string | null;
  generatedByName: string;
  approvedAt: string | null;
  approvedById: string | null;
  approvedByName: string;
  emailedTo: string[];
  version: number;
}

/* ── small shared helpers ──────────────────────────────────────────────── */

export const round1 = (value: number) => Math.round(value * 10) / 10;
export const round2 = (value: number) => Math.round(value * 100) / 100;

export const formatKm = (km: number | null | undefined) =>
  km === null || km === undefined || !Number.isFinite(km) ? '—' : `${round1(km).toLocaleString('en-IN', { maximumFractionDigits: 1 })} km`;

export const formatINR = (amount: number | null | undefined) =>
  amount === null || amount === undefined || !Number.isFinite(amount)
    ? '—'
    : `₹${round2(amount).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/** Firestore (Admin) rejects `undefined` anywhere in a document: drop it, deeply. */
export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => stripUndefined(item)) as T;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item !== undefined) out[key] = stripUndefined(item);
    }
    return out as T;
  }
  return value;
}

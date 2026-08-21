/**
 * Entitlement, allowance and settlement math for the Tour, Travel & Expense module.
 *
 * Deliberately dependency-free — no Firestore SDK, no React — because the same arithmetic has to
 * run in four places that can't share a client: the browser tour-request form (live estimate of an
 * unsaved tour), the mobile expense capture screen (offline-capable, so it can't call a server),
 * the Finance verification screen (recomputing entitlement per claim line), and the Admin-SDK
 * routes that post settlements. Keeping it isolated also makes it directly unit-testable, since
 * `tour-travel.ts` re-exports client-SDK helpers that only resolve inside the bundler.
 *
 * Two invariants drive the design of everything here:
 *
 *   1. A claimed amount is never overwritten. Every policy decision produces a *separate*
 *      `allowedAmount`/`disallowedAmount` pair alongside the employee's original figure, so the
 *      difference between "what was claimed" and "what was approved" stays auditable forever
 *      (control rule 51.8). No function in this module mutates its input.
 *
 *   2. Entitlement is data, not code. Grades, city classes, hotel caps, DA slabs and mileage rates
 *      all arrive as configuration; nothing here hardcodes a rupee figure. The seed values in
 *      `DEFAULT_TRAVEL_ENTITLEMENTS` exist so a fresh organization is usable on day one, not
 *      because the numbers are correct for every organization.
 */

/** Money is rounded to paise at every boundary so repeated add/subtract can't drift. */
export const roundMoney = (value: number) => Math.round((Number(value) || 0) * 100) / 100;

/**
 * India's April–March financial year, matching `financialYearForBgDate` in bank-guarantee.ts and
 * `financialYearForLcDate` in letter-of-credit.ts. Duplicated rather than imported because those
 * modules pull in the Firestore client; the format ("2026-27") is identical on purpose so travel
 * document numbers sort alongside BG and LC references.
 */
export const financialYearForTravelDate = (date: Date = new Date()) =>
  date.getMonth() >= 3
    ? `${date.getFullYear()}-${String(date.getFullYear() + 1).slice(-2)}`
    : `${date.getFullYear() - 1}-${String(date.getFullYear()).slice(-2)}`;

/** Document prefixes. Kept together so the numbering scheme is readable in one glance. */
export const TRAVEL_DOC_PREFIX = {
  request: 'TR',
  advance: 'TA',
  claim: 'TC',
  settlement: 'TS',
  payment: 'TP',
  recovery: 'TRC',
} as const;

export type TravelDocKind = keyof typeof TRAVEL_DOC_PREFIX;

/**
 * Builds a document number of the form `TR/SEL/2026-27/000124`. Six digits rather than the five
 * used by BG/LC because travel generates an order of magnitude more documents per year than either
 * — every employee trip produces a request, usually an advance, and a claim.
 *
 * Callers must obtain `sequence` from a Firestore counter inside a transaction (see
 * `nextTravelSequence` in tour-travel-service.ts). Never let a user type one of these
 * (control: spec section 49).
 */
export function travelDocumentNumber(input: {
  kind: TravelDocKind;
  orgCode: string;
  financialYear: string;
  sequence: number;
}) {
  const org = (input.orgCode || 'SEL').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6) || 'SEL';
  return `${TRAVEL_DOC_PREFIX[input.kind]}/${org}/${input.financialYear}/${String(Math.max(1, Math.trunc(input.sequence))).padStart(6, '0')}`;
}

/* ------------------------------------------------------------------------------------------------
 * City classification & grades
 * ---------------------------------------------------------------------------------------------- */

/**
 * Hotel and DA caps move with the cost of the place, not just the grade — a night in Mumbai and a
 * night at a remote substation site are not the same expense. `Remote Project Site` sits below the
 * tier cities deliberately: site accommodation is usually a guest house or a lodge, and pricing it
 * like a Tier 2 hotel invites padding.
 */
export type CityClass = 'Metro' | 'Tier 1' | 'Tier 2' | 'Tier 3' | 'Remote Project Site' | 'International';

export const CITY_CLASSES: CityClass[] = ['Metro', 'Tier 1', 'Tier 2', 'Tier 3', 'Remote Project Site', 'International'];

/** A city → class mapping row, configured under Settings → City Classification. */
export interface TravelCityClass {
  id: string;
  organizationId: string;
  city: string;
  state?: string;
  cityClass: CityClass;
  /** Set for the handful of project sites that need a cap different from their tier. */
  overrideHotelLimit?: number | null;
  active: boolean;
}

/**
 * Resolves a free-text city name to its configured class.
 *
 * Matching is case- and whitespace-insensitive because the city arrives from an itinerary text
 * field, not a picker — "  rayagada" and "Rayagada" must reach the same entitlement. An unmapped
 * city falls back to `fallback` (Tier 3 by default, i.e. the *lowest* domestic cap) so a typo can
 * never silently grant a Metro-level hotel limit.
 */
export function resolveCityClass(
  cities: TravelCityClass[],
  city: string | undefined,
  fallback: CityClass = 'Tier 3',
): CityClass {
  const needle = (city || '').trim().toLowerCase();
  if (!needle) return fallback;
  const match = cities.find(entry => entry.active !== false && entry.city.trim().toLowerCase() === needle);
  return match?.cityClass || fallback;
}

/**
 * The employee's travel grade.
 *
 * The Employee master (`Employee` in types.ts) has no grade field, and back-filling one across a
 * live employee list is a migration this module has no business forcing. Instead grade is derived
 * from designation through a configurable map, so entitlement works on existing employee records
 * from day one and HR can correct an individual by adding one row.
 */
export interface TravelGradeMapping {
  id: string;
  organizationId: string;
  /** Matched case-insensitively against `Employee.designation`. */
  designation: string;
  grade: string;
  /** Overrides the designation match for one named employee. */
  employeeId?: string;
}

/**
 * Resolves an employee's travel grade, preferring an employee-specific override over the
 * designation map. Returns `fallbackGrade` when nothing matches — never undefined, because every
 * downstream entitlement lookup needs *some* grade, and the safe default is the lowest one.
 */
export function resolveEmployeeGrade(
  mappings: TravelGradeMapping[],
  employee: { employeeId?: string; designation?: string },
  fallbackGrade: string,
): string {
  const byEmployee = mappings.find(row => !!row.employeeId && !!employee.employeeId && row.employeeId === employee.employeeId);
  if (byEmployee) return byEmployee.grade;
  const designation = (employee.designation || '').trim().toLowerCase();
  if (!designation) return fallbackGrade;
  const byDesignation = mappings.find(row => !row.employeeId && row.designation.trim().toLowerCase() === designation);
  return byDesignation?.grade || fallbackGrade;
}

/* ------------------------------------------------------------------------------------------------
 * Entitlement
 * ---------------------------------------------------------------------------------------------- */

export type TravelMode =
  | 'Flight' | 'Train' | 'Bus' | 'Company Vehicle' | 'Hired Vehicle'
  | 'Employee Vehicle' | 'Taxi' | 'Auto' | 'Other';

export const TRAVEL_MODES: TravelMode[] = [
  'Flight', 'Train', 'Bus', 'Company Vehicle', 'Hired Vehicle', 'Employee Vehicle', 'Taxi', 'Auto', 'Other',
];

export type FlightClass = 'None' | 'Economy' | 'Premium Economy' | 'Business';
export type TrainClass = 'None' | 'SL' | '3A' | '2A' | '1A' | 'CC' | 'EC';

/** Per-kilometre rates for a personal vehicle, by vehicle type. */
export interface MileageRates {
  bike: number;
  car: number;
}

/**
 * What one grade may spend in one city class. `cityClass: 'Any'` is the grade's baseline row and
 * matches every city, so an organization that doesn't care about city tiers configures exactly one
 * row per grade and is done.
 */
export interface TravelEntitlement {
  id: string;
  organizationId: string;
  grade: string;
  cityClass: CityClass | 'Any';
  /** Highest cabin the grade may book. 'None' means the grade may not fly without an exception. */
  flightClass: FlightClass;
  trainClass: TrainClass;
  /** Cap per night, before taxes. Compared against the *per-night* claim, not the invoice total. */
  hotelLimitPerNight: number;
  daPerDay: number;
  mileage: MileageRates;
  /** Local conveyance cap per day; 0 means uncapped. */
  localConveyancePerDay: number;
  active: boolean;
}

/**
 * Seed entitlement grid, from the illustrative table in spec section 7. Present so a fresh
 * organization can raise a tour on day one; every figure is expected to be edited under
 * Settings → Entitlements before real use.
 */
export const DEFAULT_TRAVEL_ENTITLEMENTS: Array<Omit<TravelEntitlement, 'id' | 'organizationId'>> = [
  { grade: 'Director', cityClass: 'Any', flightClass: 'Business', trainClass: '1A', hotelLimitPerNight: 8000, daPerDay: 2000, mileage: { bike: 4, car: 10 }, localConveyancePerDay: 0, active: true },
  { grade: 'GM', cityClass: 'Any', flightClass: 'Economy', trainClass: '1A', hotelLimitPerNight: 5000, daPerDay: 1500, mileage: { bike: 4, car: 10 }, localConveyancePerDay: 0, active: true },
  { grade: 'Manager', cityClass: 'Any', flightClass: 'Economy', trainClass: '2A', hotelLimitPerNight: 3500, daPerDay: 1000, mileage: { bike: 4, car: 10 }, localConveyancePerDay: 600, active: true },
  { grade: 'Engineer', cityClass: 'Any', flightClass: 'None', trainClass: '2A', hotelLimitPerNight: 2500, daPerDay: 800, mileage: { bike: 4, car: 10 }, localConveyancePerDay: 500, active: true },
  { grade: 'Staff', cityClass: 'Any', flightClass: 'None', trainClass: '3A', hotelLimitPerNight: 1800, daPerDay: 600, mileage: { bike: 4, car: 10 }, localConveyancePerDay: 400, active: true },
];

export const DEFAULT_TRAVEL_GRADE = 'Staff';

/**
 * Finds the entitlement row governing a grade in a city class.
 *
 * Resolution order is exact city class → the grade's `Any` baseline → undefined. It deliberately
 * does *not* fall back to another grade: silently entitling an Engineer to a Manager's row because
 * the Engineer grid is incomplete is exactly the kind of quiet over-payment this module exists to
 * prevent. A caller that gets `undefined` should treat the expense as needing an exception, not as
 * unlimited.
 */
export function resolveEntitlement(
  entitlements: TravelEntitlement[],
  params: { grade: string; cityClass: CityClass },
): TravelEntitlement | undefined {
  const forGrade = entitlements.filter(row => row.active !== false && row.grade === params.grade);
  return forGrade.find(row => row.cityClass === params.cityClass) || forGrade.find(row => row.cityClass === 'Any');
}

/** Cabin/class ranking, used to tell whether a booked class exceeded entitlement. */
const FLIGHT_CLASS_RANK: Record<FlightClass, number> = { None: 0, Economy: 1, 'Premium Economy': 2, Business: 3 };
const TRAIN_CLASS_RANK: Record<TrainClass, number> = { None: 0, SL: 1, CC: 2, '3A': 3, EC: 4, '2A': 5, '1A': 6 };

/**
 * True when the travelled class sits above what the grade is entitled to. Used by the approval
 * screen to surface "Exception: booked 1A against a 2A entitlement" before anyone approves, rather
 * than leaving Finance to notice it at settlement.
 */
export function exceedsClassEntitlement(
  mode: TravelMode,
  travelledClass: string | undefined,
  entitlement: TravelEntitlement | undefined,
): boolean {
  if (!entitlement || !travelledClass) return false;
  if (mode === 'Flight') {
    const claimed = FLIGHT_CLASS_RANK[travelledClass as FlightClass];
    if (claimed == null) return false;
    return claimed > FLIGHT_CLASS_RANK[entitlement.flightClass];
  }
  if (mode === 'Train') {
    const claimed = TRAIN_CLASS_RANK[travelledClass as TrainClass];
    if (claimed == null) return false;
    return claimed > TRAIN_CLASS_RANK[entitlement.trainClass];
  }
  return false;
}

/* ------------------------------------------------------------------------------------------------
 * Daily allowance
 * ---------------------------------------------------------------------------------------------- */

/**
 * One duration band of the DA rule: a trailing part-day of at least `minHours` earns `percent` of
 * a full day's DA. Bands are matched highest-`minHours`-first, so order in the array doesn't
 * matter and a misordered configuration can't produce a wrong payout.
 */
export interface DaSlab {
  minHours: number;
  percent: number;
}

/** The bands from spec section 19. Configurable under Settings → Travel Policies. */
export const DEFAULT_DA_SLABS: DaSlab[] = [
  { minHours: 12, percent: 100 },
  { minHours: 6, percent: 50 },
];

/** Parses a 'YYYY-MM-DDTHH:mm' (or full ISO) local datetime. Returns null on anything unusable. */
export function parseTravelDateTime(value: string | undefined | null): Date | null {
  if (!value) return null;
  const normalized = value.length === 10 ? `${value}T00:00:00` : value;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export interface DaUnits {
  totalHours: number;
  fullDays: number;
  /** Hours left over after the whole days — always in [0, 24). */
  remainderHours: number;
  /** The slab percentage the remainder earned, as a fraction (1 = a full day). */
  remainderFactor: number;
  /** `fullDays + remainderFactor`, i.e. how many days of DA the journey earns. */
  totalUnits: number;
}

/**
 * Converts a journey's wall-clock span into DA units.
 *
 * Whole 24-hour blocks each earn a full day; only the trailing remainder is banded. That ordering
 * matters: banding the *total* instead would pay a 30-hour trip the same as a 13-hour one. Returns
 * zeroed units when the timestamps are missing or reversed, so a half-filled form shows ₹0 DA
 * rather than a negative allowance.
 */
export function daUnits(
  departureAt: string | Date | null | undefined,
  returnAt: string | Date | null | undefined,
  slabs: DaSlab[] = DEFAULT_DA_SLABS,
): DaUnits {
  const start = departureAt instanceof Date ? departureAt : parseTravelDateTime(departureAt);
  const end = returnAt instanceof Date ? returnAt : parseTravelDateTime(returnAt);
  const empty: DaUnits = { totalHours: 0, fullDays: 0, remainderHours: 0, remainderFactor: 0, totalUnits: 0 };
  if (!start || !end) return empty;
  const totalHours = (end.getTime() - start.getTime()) / 3_600_000;
  if (totalHours <= 0) return empty;

  const fullDays = Math.floor(totalHours / 24);
  const remainderHours = totalHours - fullDays * 24;
  const band = [...slabs]
    .sort((a, b) => b.minHours - a.minHours)
    .find(slab => remainderHours >= slab.minHours);
  const remainderFactor = (band?.percent || 0) / 100;
  return {
    totalHours: Math.round(totalHours * 100) / 100,
    fullDays,
    remainderHours: Math.round(remainderHours * 100) / 100,
    remainderFactor,
    totalUnits: fullDays + remainderFactor,
  };
}

export interface DailyAllowance extends DaUnits {
  ratePerDay: number;
  amount: number;
}

/**
 * Computes DA for a journey at a single rate. Employees must never be asked to work this out by
 * hand (spec section 19) — the claim form calls this and shows the derivation.
 */
export function calculateDailyAllowance(input: {
  departureAt: string | Date | null | undefined;
  returnAt: string | Date | null | undefined;
  ratePerDay: number;
  slabs?: DaSlab[];
}): DailyAllowance {
  const units = daUnits(input.departureAt, input.returnAt, input.slabs);
  const ratePerDay = Math.max(0, Number(input.ratePerDay) || 0);
  return { ...units, ratePerDay, amount: roundMoney(units.totalUnits * ratePerDay) };
}

/**
 * A tour that crosses city classes earns DA at each city's rate. Callers pass the nights actually
 * spent per class (derived from the accommodation plan); anything not covered by an explicit
 * segment is paid at `defaultRate`.
 *
 * Kept separate from `calculateDailyAllowance` because the single-rate case is by far the common
 * one and shouldn't pay the complexity cost of the multi-city one.
 */
export function calculateSegmentedDailyAllowance(input: {
  departureAt: string | Date | null | undefined;
  returnAt: string | Date | null | undefined;
  segments: Array<{ cityClass: CityClass; units: number; ratePerDay: number }>;
  defaultRate: number;
  slabs?: DaSlab[];
}): DailyAllowance & { segmentAmount: number; unallocatedUnits: number } {
  const units = daUnits(input.departureAt, input.returnAt, input.slabs);
  const allocated = input.segments.reduce((sum, segment) => sum + Math.max(0, Number(segment.units) || 0), 0);
  const segmentAmount = input.segments.reduce(
    (sum, segment) => sum + Math.max(0, Number(segment.units) || 0) * Math.max(0, Number(segment.ratePerDay) || 0),
    0,
  );
  // Never pay for more days than the journey actually lasted, however the segments were entered.
  const unallocatedUnits = Math.max(0, units.totalUnits - allocated);
  const defaultRate = Math.max(0, Number(input.defaultRate) || 0);
  return {
    ...units,
    ratePerDay: defaultRate,
    segmentAmount: roundMoney(segmentAmount),
    unallocatedUnits: Math.round(unallocatedUnits * 100) / 100,
    amount: roundMoney(segmentAmount + unallocatedUnits * defaultRate),
  };
}

/* ------------------------------------------------------------------------------------------------
 * Mileage
 * ---------------------------------------------------------------------------------------------- */

export type OwnVehicleType = 'bike' | 'car';

export interface MileageClaim {
  distanceKm: number;
  ratePerKm: number;
  amount: number;
}

/**
 * Distance × approved rate (spec section 18). Odometer readings are the input rather than a typed
 * distance so the reading pair stays on the record and a claim of "182 km" can be checked against
 * it later. A reversed or missing pair yields zero rather than a negative reimbursement.
 */
export function calculateMileage(input: {
  startKm: number;
  endKm: number;
  vehicleType: OwnVehicleType;
  rates: MileageRates;
  /** Overrides the grade's configured rate; used when a project negotiates a different rate. */
  overrideRatePerKm?: number | null;
}): MileageClaim {
  const distanceKm = Math.max(0, (Number(input.endKm) || 0) - (Number(input.startKm) || 0));
  const configured = input.vehicleType === 'car' ? input.rates?.car : input.rates?.bike;
  const ratePerKm = Math.max(0, Number(input.overrideRatePerKm ?? configured) || 0);
  return { distanceKm: Math.round(distanceKm * 100) / 100, ratePerKm, amount: roundMoney(distanceKm * ratePerKm) };
}

/* ------------------------------------------------------------------------------------------------
 * Expense categories & per-line policy evaluation
 * ---------------------------------------------------------------------------------------------- */

export type ExpenseCategory =
  | 'Airfare' | 'Train' | 'Bus' | 'Taxi' | 'Auto' | 'Hotel' | 'Food' | 'Daily Allowance'
  | 'Local Conveyance' | 'Mileage' | 'Fuel' | 'Toll' | 'Parking' | 'Laundry'
  | 'Telephone/Internet' | 'Client Entertainment' | 'Printing' | 'Site Expense' | 'Miscellaneous';

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  'Airfare', 'Train', 'Bus', 'Taxi', 'Auto', 'Hotel', 'Food', 'Daily Allowance',
  'Local Conveyance', 'Mileage', 'Fuel', 'Toll', 'Parking', 'Laundry',
  'Telephone/Internet', 'Client Entertainment', 'Printing', 'Site Expense', 'Miscellaneous',
];

/**
 * Which entitlement figure caps a category, and how it scales.
 *
 * `perNight`/`perDay` categories multiply their cap by the nights or days claimed; `none` means the
 * category has no automatic ceiling and is governed by approval alone. Declaring this as a table
 * rather than a switch keeps "what caps Hotel?" answerable without reading the evaluator.
 */
const CATEGORY_CAP_BASIS: Partial<Record<ExpenseCategory, { field: 'hotelLimitPerNight' | 'daPerDay' | 'localConveyancePerDay'; scale: 'perNight' | 'perDay' }>> = {
  Hotel: { field: 'hotelLimitPerNight', scale: 'perNight' },
  'Daily Allowance': { field: 'daPerDay', scale: 'perDay' },
  'Local Conveyance': { field: 'localConveyancePerDay', scale: 'perDay' },
};

export interface PolicyEvaluation {
  /** The applicable ceiling, or null when the category is uncapped. */
  limit: number | null;
  claimedAmount: number;
  /** What policy permits without an exception. Equals `claimedAmount` when within limit. */
  allowedAmount: number;
  /** `claimedAmount - allowedAmount`. Requires an exception approval to be paid. */
  disallowedAmount: number;
  exceedsLimit: boolean;
  /** Human-readable reason, for the verification screen's Policy column. */
  note: string;
}

/**
 * Compares one claim line against entitlement and reports the split — without deciding anything.
 *
 * This returns a *recommendation*: `allowedAmount` is what policy permits on its own, and Finance
 * (or an exception approver) still records the final figure. That separation is what lets the claim
 * keep the employee's original number intact while showing everyone why it was reduced.
 *
 * A missing entitlement row yields `limit: null` with an explanatory note, never an implicit
 * "unlimited" — see `resolveEntitlement` for why no cross-grade fallback happens.
 */
export function evaluateExpenseAgainstPolicy(input: {
  category: ExpenseCategory;
  claimedAmount: number;
  entitlement: TravelEntitlement | undefined;
  /** Nights for Hotel, days for DA/Local Conveyance. Defaults to 1. */
  quantity?: number;
  /** Set for a category whose cap is configured per-category rather than via entitlement. */
  categoryCap?: number | null;
}): PolicyEvaluation {
  const claimedAmount = roundMoney(input.claimedAmount);
  const quantity = Math.max(1, Number(input.quantity) || 1);
  const basis = CATEGORY_CAP_BASIS[input.category];

  let limit: number | null = null;
  let note = '';
  if (input.categoryCap != null && Number(input.categoryCap) > 0) {
    limit = roundMoney(Number(input.categoryCap) * quantity);
    note = `Category cap ${limit} for ${quantity} × ${Number(input.categoryCap)}`;
  } else if (basis) {
    if (!input.entitlement) {
      note = 'No entitlement configured for this grade — requires exception approval.';
    } else {
      const perUnit = Number(input.entitlement[basis.field]) || 0;
      // A configured 0 means "uncapped" for local conveyance (see TravelEntitlement), so only a
      // positive figure becomes a ceiling.
      if (perUnit > 0) {
        limit = roundMoney(perUnit * quantity);
        const unit = basis.scale === 'perNight' ? 'night' : 'day';
        note = quantity > 1 ? `${quantity} ${unit}s × ${perUnit} entitlement` : `${perUnit} per ${unit} entitlement`;
      } else {
        note = 'Uncapped for this grade.';
      }
    }
  } else {
    note = 'No automatic limit — governed by approval.';
  }

  if (limit == null) {
    return { limit: null, claimedAmount, allowedAmount: claimedAmount, disallowedAmount: 0, exceedsLimit: false, note };
  }
  const allowedAmount = Math.min(claimedAmount, limit);
  const disallowedAmount = roundMoney(claimedAmount - allowedAmount);
  return {
    limit,
    claimedAmount,
    allowedAmount: roundMoney(allowedAmount),
    disallowedAmount,
    exceedsLimit: disallowedAmount > 0,
    note: disallowedAmount > 0 ? `${note} — exceeded by ${disallowedAmount}` : note,
  };
}

/* ------------------------------------------------------------------------------------------------
 * Duplicate bill detection
 * ---------------------------------------------------------------------------------------------- */

/**
 * Normalized identity of a bill, used to spot the same invoice claimed twice (spec section 17).
 *
 * Vendor and invoice number are lower-cased and stripped of punctuation because the same invoice
 * re-keyed by hand rarely comes back character-identical ("INV-4471" vs "inv 4471"). The amount is
 * included so two genuinely different invoices that happen to share a sequence number don't
 * collide.
 */
export function billFingerprint(bill: {
  vendor?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  amount?: number;
}): string {
  const norm = (value: string | undefined) => (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return [norm(bill.vendor), norm(bill.invoiceNumber), (bill.invoiceDate || '').slice(0, 10), roundMoney(bill.amount || 0)].join('|');
}

export interface DuplicateBillMatch<T> {
  fingerprint: string;
  /** Every record sharing the fingerprint, in input order — the first is the original. */
  records: T[];
}

/**
 * Groups records that share a bill fingerprint, or a file hash when one is available.
 *
 * A file hash match is reported even when the typed invoice details differ, which catches the
 * common case of the same photographed bill uploaded twice under slightly different fields.
 * Records with neither a usable fingerprint nor a hash are skipped rather than lumped together —
 * a batch of bills with no invoice numbers yet are not duplicates of each other.
 */
export function findDuplicateBills<T extends { vendor?: string; invoiceNumber?: string; invoiceDate?: string; amount?: number; fileHash?: string }>(
  records: T[],
): Array<DuplicateBillMatch<T>> {
  const groups = new Map<string, T[]>();
  for (const record of records) {
    const hasIdentity = !!(record.invoiceNumber || '').trim() && !!(record.vendor || '').trim();
    const keys = [
      hasIdentity ? `bill:${billFingerprint(record)}` : '',
      record.fileHash ? `hash:${record.fileHash}` : '',
    ].filter(Boolean);
    for (const key of keys) {
      const bucket = groups.get(key) || [];
      bucket.push(record);
      groups.set(key, bucket);
    }
  }
  return [...groups.entries()]
    .filter(([, bucket]) => bucket.length > 1)
    .map(([fingerprint, bucket]) => ({ fingerprint, records: bucket }));
}

/* ------------------------------------------------------------------------------------------------
 * Settlement
 * ---------------------------------------------------------------------------------------------- */

export type SettlementOutcome = 'Payable to employee' | 'Nil settlement' | 'Recoverable from employee';

export interface SettlementSummary {
  /** Sum of what the employee claimed, untouched by verification. */
  totalClaimed: number;
  /** Sum of what verification actually approved. */
  totalApproved: number;
  totalDisallowed: number;
  /** Expenses the company already paid directly (tickets, hotel on company account). */
  companyPaid: number;
  advancePaid: number;
  /**
   * `totalApproved − companyPaid − advancePaid`. Positive means the company owes the employee,
   * negative means the employee owes the company.
   */
  net: number;
  payableToEmployee: number;
  recoverableFromEmployee: number;
  outcome: SettlementOutcome;
}

/**
 * Turns verified claim lines plus advances into the settlement statement of spec section 20, and
 * classifies it into one of the three scenarios of section 21.
 *
 * Company-paid expenses are included in the claim total (so the statement shows the true cost of
 * the tour) and then deducted, which is also what enforces control rule 51.12 — a directly-paid
 * ticket can appear on the claim for visibility but can never be reimbursed a second time.
 *
 * `net` is derived from `totalApproved`, never from `totalClaimed`: settling against what the
 * employee asked for rather than what was approved would pay out every disallowed rupee.
 */
export function summarizeSettlement(input: {
  items: Array<{ claimedAmount: number; approvedAmount?: number | null; paidByCompany?: boolean }>;
  advancePaid: number;
}): SettlementSummary {
  let totalClaimed = 0;
  let totalApproved = 0;
  let companyPaid = 0;
  for (const item of input.items) {
    const claimed = roundMoney(item.claimedAmount);
    // An unverified line still settles at its claimed value, so a draft statement shows the
    // employee a realistic figure instead of ₹0 until Finance opens it.
    const approved = roundMoney(item.approvedAmount ?? item.claimedAmount);
    totalClaimed += claimed;
    totalApproved += approved;
    if (item.paidByCompany) companyPaid += approved;
  }
  const advancePaid = roundMoney(input.advancePaid);
  const net = roundMoney(totalApproved - companyPaid - advancePaid);
  return {
    totalClaimed: roundMoney(totalClaimed),
    totalApproved: roundMoney(totalApproved),
    totalDisallowed: roundMoney(totalClaimed - totalApproved),
    companyPaid: roundMoney(companyPaid),
    advancePaid,
    net,
    payableToEmployee: net > 0 ? net : 0,
    recoverableFromEmployee: net < 0 ? roundMoney(-net) : 0,
    outcome: net > 0 ? 'Payable to employee' : net < 0 ? 'Recoverable from employee' : 'Nil settlement',
  };
}

/* ------------------------------------------------------------------------------------------------
 * Estimated tour cost
 * ---------------------------------------------------------------------------------------------- */

export interface TourCostEstimate {
  travel: number;
  hotel: number;
  dailyAllowance: number;
  localTransport: number;
  fuel: number;
  miscellaneous: number;
  total: number;
}

/**
 * The estimate shown on the tour request, which becomes the approved travel budget that actuals
 * are later compared against (spec section 6). Hotel is derived from nights × entitlement rather
 * than typed, so the estimate an approver sees is already policy-shaped.
 */
export function estimateTourCost(input: {
  travel: number;
  nights: number;
  hotelRatePerNight?: number | null;
  entitlement: TravelEntitlement | undefined;
  departureAt?: string | null;
  returnAt?: string | null;
  daSlabs?: DaSlab[];
  localTransport?: number;
  fuel?: number;
  miscellaneous?: number;
}): TourCostEstimate {
  const nights = Math.max(0, Number(input.nights) || 0);
  const hotelRate = Number(input.hotelRatePerNight ?? input.entitlement?.hotelLimitPerNight ?? 0) || 0;
  const da = calculateDailyAllowance({
    departureAt: input.departureAt,
    returnAt: input.returnAt,
    ratePerDay: input.entitlement?.daPerDay || 0,
    slabs: input.daSlabs,
  });
  const parts = {
    travel: roundMoney(input.travel),
    hotel: roundMoney(nights * hotelRate),
    dailyAllowance: da.amount,
    localTransport: roundMoney(input.localTransport || 0),
    fuel: roundMoney(input.fuel || 0),
    miscellaneous: roundMoney(input.miscellaneous || 0),
  };
  return { ...parts, total: roundMoney(Object.values(parts).reduce((sum, value) => sum + value, 0)) };
}

/* ------------------------------------------------------------------------------------------------
 * Approval matrix
 * ---------------------------------------------------------------------------------------------- */

/** One configurable stage of an approval chain. */
export interface TravelApprovalStage {
  /** Stable id, so a partially-completed chain survives a rule being edited. */
  id: string;
  name: string;
  /** How the approver is found at runtime. */
  assignmentType: 'Reporting Manager' | 'HOD' | 'Project Manager' | 'User-based' | 'Role-based';
  assignedTo: string[];
  /** Turnaround hours, for escalation. */
  tat: number;
}

/**
 * A threshold rule mapping a tour's size and shape to an approval chain (spec section 9).
 * Rules are evaluated most-specific-first; see `resolveApprovalChain`.
 */
export interface TravelApprovalRule {
  id: string;
  organizationId: string;
  name: string;
  minAmount: number;
  maxAmount: number | null;
  /** Empty means "any tour type". */
  tourTypes: string[];
  /** null = applies to both domestic and international; true/false narrows it. */
  international: boolean | null;
  /** Applies only to this project, when set. */
  projectId?: string;
  stages: TravelApprovalStage[];
  active: boolean;
}

/**
 * Picks the approval chain for a tour.
 *
 * Candidate rules are those whose amount band contains the estimate and whose tour-type, project
 * and domestic/international filters all match. Among candidates the *most specific* wins — scored
 * by how many optional filters the rule actually constrains — because an organization invariably
 * configures a broad band ("₹10,000–₹50,000") and then a narrow override ("international, any
 * amount"), and the override has to beat the band regardless of which was created first. Ties fall
 * to the narrower amount band, then to a stable name order so the choice never depends on Firestore
 * document ordering.
 *
 * Returns an empty array when nothing matches; the caller decides whether that means auto-approval
 * or a configuration error (`requireApprovalRule` in settings).
 */
export function resolveApprovalChain(
  rules: TravelApprovalRule[],
  tour: { amount: number; tourType?: string; isInternational?: boolean; projectId?: string },
): TravelApprovalStage[] {
  const amount = Number(tour.amount) || 0;
  const candidates = rules.filter(rule => {
    if (rule.active === false) return false;
    if (amount < Number(rule.minAmount || 0)) return false;
    if (rule.maxAmount != null && amount > Number(rule.maxAmount)) return false;
    if (rule.tourTypes?.length && (!tour.tourType || !rule.tourTypes.includes(tour.tourType))) return false;
    if (rule.international != null && rule.international !== !!tour.isInternational) return false;
    if (rule.projectId && rule.projectId !== tour.projectId) return false;
    return true;
  });
  if (!candidates.length) return [];

  const specificity = (rule: TravelApprovalRule) =>
    (rule.tourTypes?.length ? 1 : 0) + (rule.international != null ? 1 : 0) + (rule.projectId ? 1 : 0);
  const bandWidth = (rule: TravelApprovalRule) =>
    rule.maxAmount == null ? Number.POSITIVE_INFINITY : Number(rule.maxAmount) - Number(rule.minAmount || 0);

  const best = [...candidates].sort((a, b) => {
    const bySpecificity = specificity(b) - specificity(a);
    if (bySpecificity) return bySpecificity;
    const byBand = bandWidth(a) - bandWidth(b);
    if (byBand) return byBand;
    return a.name.localeCompare(b.name);
  })[0];
  return best.stages || [];
}

/**
 * Resolves who a stage's approval task belongs to.
 *
 * Mirrors `resolveAssignees` in recurring-payments.ts, including its fallback discipline: a stage
 * that resolves to nobody returns an empty array rather than a placeholder, so the caller can leave
 * the tour where it is and escalate instead of routing an approval into the void.
 *
 * Control rule 51.14 — an employee can't approve their own request — is enforced here by removing
 * the traveller from every resolved stage. When that empties the stage, the caller must escalate.
 */
export function resolveStageApprovers(
  stage: TravelApprovalStage,
  tour: { employeeUserId?: string; reportingManagerId?: string; hodId?: string; projectManagerId?: string },
  roleMembers: Record<string, string[]> = {},
): string[] {
  const resolved = (() => {
    switch (stage.assignmentType) {
      case 'Reporting Manager':
        return [tour.reportingManagerId];
      case 'HOD':
        return [tour.hodId];
      case 'Project Manager':
        return [tour.projectManagerId];
      case 'Role-based':
        return stage.assignedTo.flatMap(role => roleMembers[role] || []);
      case 'User-based':
      default:
        return stage.assignedTo;
    }
  })().filter(Boolean) as string[];

  const withoutTraveller = resolved.filter(userId => userId !== tour.employeeUserId);
  return [...new Set(withoutTraveller)];
}

/* ------------------------------------------------------------------------------------------------
 * Outstanding advance control
 * ---------------------------------------------------------------------------------------------- */

export type OutstandingAdvanceAction = 'Allow' | 'Warn' | 'Block' | 'Require Finance override' | 'Require Director approval';

export interface OutstandingAdvanceCheck {
  action: OutstandingAdvanceAction;
  /** Total unsettled across every open advance. */
  outstandingAmount: number;
  /** Age in days of the oldest unsettled advance. */
  oldestAgeDays: number;
  oldestReference: string;
  count: number;
  message: string;
}

export const dayDifference = (from: Date, to: Date) =>
  Math.floor((to.getTime() - from.getTime()) / 86_400_000);

/**
 * The control of spec section 12: decide what a new advance request should do when the employee
 * still owes settlement on an old one.
 *
 * Only advances actually *paid* and not yet settled count — an approved-but-unpaid advance isn't
 * money the employee is holding, and blocking on it would stall a legitimate second tour. The
 * escalation is driven entirely by `policy`, so an organization can start at 'Warn' and tighten to
 * 'Block' later without a code change.
 */
export function evaluateOutstandingAdvances(
  advances: Array<{ referenceNumber: string; paidAmount: number; settledAmount?: number; paidOn?: string | null; status: string }>,
  options: {
    asOf?: Date;
    /** Days after payment before an advance is treated as overdue. */
    overdueAfterDays: number;
    /** What to do once at least one advance is overdue. */
    policy: OutstandingAdvanceAction;
  },
): OutstandingAdvanceCheck {
  const asOf = options.asOf || new Date();
  const open = advances.filter(advance => {
    if (['Settled', 'Closed', 'Cancelled', 'Rejected'].includes(advance.status)) return false;
    return roundMoney(advance.paidAmount) - roundMoney(advance.settledAmount || 0) > 0;
  });

  const outstandingAmount = roundMoney(
    open.reduce((sum, advance) => sum + (roundMoney(advance.paidAmount) - roundMoney(advance.settledAmount || 0)), 0),
  );

  let oldestAgeDays = 0;
  let oldestReference = '';
  for (const advance of open) {
    const paidOn = parseTravelDateTime(advance.paidOn);
    if (!paidOn) continue;
    const age = dayDifference(paidOn, asOf);
    if (age > oldestAgeDays) {
      oldestAgeDays = age;
      oldestReference = advance.referenceNumber;
    }
  }

  if (!open.length) {
    return { action: 'Allow', outstandingAmount: 0, oldestAgeDays: 0, oldestReference: '', count: 0, message: 'No outstanding travel advance.' };
  }
  const overdue = oldestAgeDays > Math.max(0, options.overdueAfterDays);
  return {
    action: overdue ? options.policy : 'Warn',
    outstandingAmount,
    oldestAgeDays,
    oldestReference,
    count: open.length,
    message: overdue
      ? `Employee has ${outstandingAmount} outstanding from ${oldestReference} for ${oldestAgeDays} days.`
      : `Employee has ${outstandingAmount} outstanding across ${open.length} advance(s), none overdue yet.`,
  };
}

/** Ageing buckets from spec section 33, in report order. */
export const ADVANCE_AGEING_BUCKETS = ['0-7', '8-15', '16-30', '31-60', '>60'] as const;
export type AdvanceAgeingBucket = (typeof ADVANCE_AGEING_BUCKETS)[number];

export function advanceAgeingBucket(ageDays: number): AdvanceAgeingBucket {
  if (ageDays <= 7) return '0-7';
  if (ageDays <= 15) return '8-15';
  if (ageDays <= 30) return '16-30';
  if (ageDays <= 60) return '31-60';
  return '>60';
}

/**
 * Buckets outstanding advances by age for the Finance ageing report. Advances with no payment date
 * land in '0-7' rather than being dropped, so the report's total always reconciles with the
 * outstanding figure on the dashboard.
 */
export function summarizeAdvanceAgeing(
  advances: Array<{ paidAmount: number; settledAmount?: number; paidOn?: string | null }>,
  asOf: Date = new Date(),
): Record<AdvanceAgeingBucket, { count: number; amount: number }> {
  const summary = Object.fromEntries(
    ADVANCE_AGEING_BUCKETS.map(bucket => [bucket, { count: 0, amount: 0 }]),
  ) as Record<AdvanceAgeingBucket, { count: number; amount: number }>;

  for (const advance of advances) {
    const outstanding = roundMoney(advance.paidAmount) - roundMoney(advance.settledAmount || 0);
    if (outstanding <= 0) continue;
    const paidOn = parseTravelDateTime(advance.paidOn);
    const bucket = advanceAgeingBucket(paidOn ? dayDifference(paidOn, asOf) : 0);
    summary[bucket].count += 1;
    summary[bucket].amount = roundMoney(summary[bucket].amount + outstanding);
  }
  return summary;
}

/* ------------------------------------------------------------------------------------------------
 * Closure readiness
 * ---------------------------------------------------------------------------------------------- */

export interface ClosureReadiness {
  ready: boolean;
  /** Everything still standing between the tour and closure, in the order a user should fix it. */
  blockers: string[];
}

/**
 * The closure gate of spec section 26 — a tour is not closed merely because the travel ended.
 *
 * Every condition is reported rather than short-circuiting on the first failure, so the tour detail
 * page can show the user the full remaining checklist instead of revealing one blocker per attempt.
 */
export function evaluateTourClosure(state: {
  travelCompleted: boolean;
  claimSubmitted: boolean;
  claimApproved: boolean;
  advanceOutstanding: number;
  recoveryOutstanding: number;
  reimbursementOutstanding: number;
  financePosted: boolean;
}): ClosureReadiness {
  const blockers: string[] = [];
  if (!state.travelCompleted) blockers.push('Travel is not marked complete.');
  if (!state.claimSubmitted) blockers.push('Expense claim has not been submitted.');
  if (!state.claimApproved) blockers.push('Expense claim is not fully approved.');
  if (roundMoney(state.advanceOutstanding) > 0) blockers.push(`Travel advance of ${roundMoney(state.advanceOutstanding)} is unsettled.`);
  if (roundMoney(state.recoveryOutstanding) > 0) blockers.push(`Employee recovery of ${roundMoney(state.recoveryOutstanding)} is pending.`);
  if (roundMoney(state.reimbursementOutstanding) > 0) blockers.push(`Reimbursement of ${roundMoney(state.reimbursementOutstanding)} has not been paid.`);
  if (!state.financePosted) blockers.push('Finance posting is not complete.');
  return { ready: blockers.length === 0, blockers };
}

/* ------------------------------------------------------------------------------------------------
 * Expense date validation
 * ---------------------------------------------------------------------------------------------- */

/**
 * Control rule 51.5: an expense dated outside the approved travel window is flagged, not rejected.
 *
 * A tolerance either side is allowed because legitimate travel expenses genuinely fall just outside
 * the itinerary — an airport taxi taken the night before a 6 a.m. departure is not fraud. Anything
 * beyond the tolerance is surfaced for the verifier to judge.
 */
export function isExpenseWithinTourWindow(
  expenseDate: string,
  tour: { departureDate?: string | null; returnDate?: string | null },
  toleranceDays = 1,
): { withinWindow: boolean; reason: string } {
  const expense = parseTravelDateTime(expenseDate);
  const from = parseTravelDateTime(tour.departureDate);
  const to = parseTravelDateTime(tour.returnDate);
  if (!expense || !from || !to) return { withinWindow: true, reason: 'Tour dates unavailable — not checked.' };
  const tolerance = Math.max(0, toleranceDays) * 86_400_000;
  if (expense.getTime() < from.getTime() - tolerance) {
    return { withinWindow: false, reason: `Expense dated before the approved departure (${tour.departureDate}).` };
  }
  if (expense.getTime() > to.getTime() + tolerance) {
    return { withinWindow: false, reason: `Expense dated after the approved return (${tour.returnDate}).` };
  }
  return { withinWindow: true, reason: '' };
}

/**
 * Daily Progress — the planning engine, the progress board, and the checks the screens run.
 *
 * `project-management-dpr.ts` holds the records and the plain arithmetic. This module is the layer
 * the Daily Progress screens read from, and each of its rules is set per project in `DprSettings`
 * (Daily Progress › Settings):
 *
 *  - **A working calendar.** Weekly offs and holidays. Projections are spread over working days
 *    only, and "working days left" counts the same calendar.
 *  - **Precision by unit.** Countable units (Nos, Set…) stay whole: 50 Nos over a month spreads as
 *    1s and 2s, never 1.667 a day. Every other unit keeps three decimals. The running total is
 *    rounded rather than each day, so the days always add up to the projection exactly.
 *  - **A spread.** Even, front-loaded or back-loaded across the period's working days.
 *  - **One owner per day.** Where two projections for one BOQ line overlap, the shorter period owns
 *    the shared days — a catch-up week on top of a month replaces the month's share of that week
 *    instead of adding to it. An overlap is never counted twice.
 *  - **Units are never added together.** Achievement across lines is weighted by BOQ value when
 *    every line has a rate, and is otherwise the average of each line's own percentage.
 *
 * Pure — no Firebase, no React — so it is tested with `node --experimental-strip-types --test`.
 */

import {
  DPR_DISTRIBUTIONS,
  DPR_PROJECTION_PERIODS,
  DPR_SCOPES,
  addDays,
  bucketsInRange,
  daysInRange,
  dprNumber,
  eachDayInRange,
  endOfMonth,
  filterDprEntries,
  formatPeriodLabel,
  overlapDays,
  parseIsoDate,
  periodRangeFor,
  startOfMonth,
  startOfWeek,
  type DprBoqLike,
  type DprDateRange,
  type DprDistribution,
  type DprEntry,
  type DprPeriodType,
  type DprPlanReader,
  type DprProjectionPeriod,
  type DprScope,
  type DprTarget,
  type DprTargetFilter,
} from "./project-management-dpr.ts";

/* ── Settings ───────────────────────────────────────────────────────────────────────────────── */

/** `projects/{globalProjectId}/dprSettings/config` — one document per project. */
export const DPR_SETTINGS_COLLECTION = "dprSettings";
export const DPR_SETTINGS_DOC_ID = "config";

/** Monday first, the way site weeks run here. Values are `Date.getDay()` numbers. */
export const DPR_WEEKDAYS = [
  { day: 1, label: "Mon" },
  { day: 2, label: "Tue" },
  { day: 3, label: "Wed" },
  { day: 4, label: "Thu" },
  { day: 5, label: "Fri" },
  { day: 6, label: "Sat" },
  { day: 0, label: "Sun" },
] as const;

export interface DprHoliday {
  date: string;
  reason: string;
}

export interface DprSettings {
  /** Weekdays off, 0 = Sunday … 6 = Saturday. Empty: every day is a working day. */
  weeklyOff: number[];
  holidays: DprHoliday[];
  /** Blank uses the project record's own start date. */
  startDate: string;
  /** Blank uses the project record's own completion date. */
  endDate: string;
  /** How far cumulative work may run past the BOQ quantity, in percent. */
  tolerancePct: number;
  /** How many days back a sheet may be filed without a DPR approver. */
  backdateDays: number;
  /** The working shift in hours — the ceiling on a day's lost time. */
  shiftHours: number;
  /** An actual above this multiple of the day's plan asks the recorder to confirm it. */
  spikeMultiple: number;
  /** Units counted in whole numbers. Every other unit takes up to three decimals. */
  wholeNumberUnits: string[];
  /** The fixed list a sheet's weather is chosen from. */
  weatherOptions: string[];
  /** The trades a sheet's manpower is chosen from. Empty: the trade is typed instead. */
  trades: string[];
  /** The plant and equipment a sheet's machinery is chosen from. Empty: typed instead. */
  equipmentTypes: string[];
  /** Where on site a sheet's work lines are, chosen from this list. Empty: typed instead. */
  locations: string[];
  /** Who did a work line (own workforce, a subcontractor…). Empty: typed instead. */
  agencies: string[];
}

/**
 * Starting values. Every day working matches how projections were spread before the calendar
 * existed, so turning this on changes no figure until someone sets a weekly off or a holiday.
 */
export const defaultDprSettings = (): DprSettings => ({
  weeklyOff: [],
  holidays: [],
  startDate: "",
  endDate: "",
  tolerancePct: 0,
  backdateDays: 2,
  shiftHours: 8,
  spikeMultiple: 3,
  wholeNumberUnits: ["Nos", "No", "Each", "Set", "Pair", "Pcs"],
  weatherOptions: ["Clear", "Cloudy", "Rain", "Hot"],
  trades: [
    "Mason",
    "Helper",
    "Carpenter",
    "Bar bender",
    "Fitter",
    "Rigger",
    "Welder",
    "Electrician",
    "Painter",
    "Operator",
    "Supervisor",
  ],
  equipmentTypes: [
    "Excavator",
    "Backhoe loader (JCB)",
    "Crane",
    "Hydra",
    "Concrete mixer",
    "Transit mixer",
    "Needle vibrator",
    "Tipper",
    "Tractor",
    "DG set",
    "Welding machine",
  ],
  // Locations and agencies belong to one project (its towers and zones, its subcontractors), so
  // there is nothing sensible to start them with; Settings offers the values already typed.
  locations: [],
  agencies: [],
});

const readNumber = (
  value: unknown,
  { min, max, fallback, whole = false }: { min: number; max: number; fallback: number; whole?: boolean },
): number => {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value.trim())
        : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = whole ? Math.round(parsed) : parsed;
  return Math.min(max, Math.max(min, rounded));
};

const readList = (value: unknown, fallback: readonly string[]): string[] => {
  if (!Array.isArray(value)) return [...fallback];
  const seen = new Set<string>();
  const list: string[] = [];
  for (const raw of value) {
    const text = String(raw ?? "").trim().slice(0, 40);
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    list.push(text);
  }
  return list;
};

const readIsoDate = (value: unknown): string =>
  typeof value === "string" && parseIsoDate(value) ? value : "";

/** Whatever is stored (or nothing), as settings every screen can rely on. */
export function sanitizeDprSettings(raw: unknown): DprSettings {
  const defaults = defaultDprSettings();
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  let weeklyOff = Array.isArray(source.weeklyOff)
    ? [...new Set(source.weeklyOff.map(Number))]
        .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
        .sort((a, b) => a - b)
    : defaults.weeklyOff;
  // Every day off would leave nothing to plan on; read that as no weekly off at all.
  if (weeklyOff.length >= 7) weeklyOff = [];

  const holidays: DprHoliday[] = [];
  const seenDates = new Set<string>();
  for (const raw of Array.isArray(source.holidays) ? source.holidays : []) {
    const date = readIsoDate(typeof raw === "string" ? raw : (raw as { date?: unknown })?.date);
    if (!date || seenDates.has(date)) continue;
    seenDates.add(date);
    const reason =
      typeof raw === "object" && raw !== null
        ? String((raw as { reason?: unknown }).reason ?? "").trim().slice(0, 80)
        : "";
    holidays.push({ date, reason });
  }
  holidays.sort((a, b) => a.date.localeCompare(b.date));

  const weatherOptions = readList(source.weatherOptions, defaults.weatherOptions);

  return {
    weeklyOff,
    holidays,
    startDate: readIsoDate(source.startDate),
    endDate: readIsoDate(source.endDate),
    tolerancePct: readNumber(source.tolerancePct, { min: 0, max: 100, fallback: defaults.tolerancePct }),
    backdateDays: readNumber(source.backdateDays, {
      min: 0,
      max: 365,
      fallback: defaults.backdateDays,
      whole: true,
    }),
    shiftHours: readNumber(source.shiftHours, { min: 1, max: 24, fallback: defaults.shiftHours }),
    spikeMultiple: readNumber(source.spikeMultiple, { min: 1, max: 100, fallback: defaults.spikeMultiple }),
    wholeNumberUnits: readList(source.wholeNumberUnits, defaults.wholeNumberUnits),
    // The sheet requires a weather, so an emptied list falls back rather than blocking every submit.
    weatherOptions: weatherOptions.length > 0 ? weatherOptions : defaults.weatherOptions,
    // A project that has never saved these lists gets the starting ones; one that deliberately
    // emptied a list types the trade or equipment instead.
    trades: readList(source.trades, defaults.trades),
    equipmentTypes: readList(source.equipmentTypes, defaults.equipmentTypes),
    locations: readList(source.locations, defaults.locations),
    agencies: readList(source.agencies, defaults.agencies),
  };
}

/** The project's start and completion: this module's own setting, else the project record's. */
export function dprProjectDates(
  settings: Pick<DprSettings, "startDate" | "endDate">,
  project: { startDate?: unknown; endDate?: unknown },
): DprDateRange {
  return {
    startDate: settings.startDate || readIsoDate(project.startDate),
    endDate: settings.endDate || readIsoDate(project.endDate),
  };
}

/* ── Calendar ───────────────────────────────────────────────────────────────────────────────── */

export interface DprCalendar {
  isWorkingDay(isoDate: string): boolean;
  workingDays(startDate: string, endDate: string): string[];
}

export function dprCalendar(settings: Pick<DprSettings, "weeklyOff" | "holidays">): DprCalendar {
  const off = new Set(settings.weeklyOff);
  const holidays = new Set(settings.holidays.map((holiday) => holiday.date));
  const isWorkingDay = (isoDate: string): boolean => {
    const date = parseIsoDate(isoDate);
    if (!date) return false;
    return !off.has(date.getDay()) && !holidays.has(isoDate);
  };
  return {
    isWorkingDay,
    workingDays: (startDate, endDate) => eachDayInRange(startDate, endDate).filter(isWorkingDay),
  };
}

/* ── Units ──────────────────────────────────────────────────────────────────────────────────── */

export const DPR_FRACTION_DECIMALS = 3;

const unitKey = (unit: unknown): string =>
  String(unit ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/** 0 for a unit counted in whole numbers, otherwise three. */
export function dprUnitDecimals(
  unit: unknown,
  settings: Pick<DprSettings, "wholeNumberUnits">,
): number {
  const key = unitKey(unit);
  if (!key) return DPR_FRACTION_DECIMALS;
  return settings.wholeNumberUnits.some((candidate) => unitKey(candidate) === key)
    ? 0
    : DPR_FRACTION_DECIMALS;
}

export function fitsUnitPrecision(qty: number, decimals: number): boolean {
  const scaled = qty * 10 ** decimals;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
}

export function precisionMessage(unit: string, decimals: number): string {
  return decimals === 0
    ? `${unit || "This unit"} is counted in whole numbers.`
    : `Use at most ${decimals} decimals for ${unit || "this unit"}.`;
}

export const roundToDecimals = (qty: number, decimals: number): number => {
  const scale = 10 ** decimals;
  return Math.round(qty * scale) / scale;
};

/** Float sums of 0.667s drift; six places is far below any measured quantity. */
const tidy = (value: number): number => Math.round(value * 1e6) / 1e6;

/* ── Message formatting ─────────────────────────────────────────────────────────────────────── */

const QTY_FORMAT = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });
const fmtQty = (value: number): string => QTY_FORMAT.format(roundToDecimals(value, 3));
const fmtDate = (isoDate: string): string => formatPeriodLabel("Day", isoDate);
/** "05 Nov" — the day and month of `formatPeriodLabel`'s "05 Nov 2026". */
export const dprShortDate = (isoDate: string): string => fmtDate(isoDate).slice(0, 6);

export const DPR_PERIOD_LABELS: Record<DprProjectionPeriod, string> = {
  Day: "Day",
  Week: "Week",
  Month: "Month",
  Custom: "Custom",
};

export const DPR_DISTRIBUTION_LABELS: Record<DprDistribution, string> = {
  even: "Even",
  front: "Front-loaded",
  back: "Back-loaded",
};

/** The range a projection preset covers around an anchor date, or a custom range as given. */
export function projectionRange(
  periodType: DprProjectionPeriod,
  anchorDate: string,
  custom: DprDateRange,
): DprDateRange {
  return periodType === "Custom" ? custom : periodRangeFor(periodType, anchorDate);
}

export const isValidRange = (range: DprDateRange): boolean =>
  Boolean(parseIsoDate(range.startDate) && parseIsoDate(range.endDate)) &&
  daysInRange(range.startDate, range.endDate) > 0;

/* ── Spreading a projection ─────────────────────────────────────────────────────────────────── */

/**
 * One projection's quantity per working day of its period.
 *
 * Weights are 1 each for an even spread, n down to 1 for front-loaded, and 1 up to n for
 * back-loaded. The running total is rounded to the unit's precision and each day takes the step,
 * so the days always sum to the projection exactly and a whole-number unit stays whole.
 */
export function allocateProjection(
  target: Pick<DprTarget, "startDate" | "endDate" | "plannedQty" | "distribution">,
  calendar: DprCalendar,
  decimals: number,
): Map<string, number> {
  const allocation = new Map<string, number>();
  const allDays = eachDayInRange(target.startDate, target.endDate);
  if (allDays.length === 0) return allocation;
  const working = allDays.filter((day) => calendar.isWorkingDay(day));
  // A period left with no working day (the calendar changed after it was set) keeps its quantity
  // on every day rather than silently dropping out of the reports.
  const days = working.length > 0 ? working : allDays;
  const count = days.length;
  const spread: DprDistribution = DPR_DISTRIBUTIONS.includes(target.distribution as DprDistribution)
    ? (target.distribution as DprDistribution)
    : "even";
  const weightAt = (index: number) =>
    spread === "front" ? count - index : spread === "back" ? index + 1 : 1;
  const totalWeight = spread === "even" ? count : (count * (count + 1)) / 2;
  const scale = 10 ** decimals;
  const qty = dprNumber(target.plannedQty);

  let runningWeight = 0;
  let previous = 0;
  days.forEach((day, index) => {
    runningWeight += weightAt(index);
    const cumulative = Math.round((qty * scale * runningWeight) / totalWeight);
    allocation.set(day, (cumulative - previous) / scale);
    previous = cumulative;
  });
  return allocation;
}

/* ── The plan ───────────────────────────────────────────────────────────────────────────────── */

export interface DprPlan extends DprPlanReader {
  /** The effective planned quantity per day for one BOQ line, in date order. */
  daily(boqItemId: string): ReadonlyMap<string, number>;
  onDate(boqItemId: string, isoDate: string): number;
  qtyInRange(boqItemId: string, range: DprDateRange): number;
  /** The projection that owns a day for a BOQ line (the shorter period, where two overlap). */
  ownerOn(boqItemId: string, isoDate: string): DprPlanOwner | null;
}

export interface DprPlanOwner {
  targetId: string;
  startDate: string;
  endDate: string;
}

export interface DprPlanOptions {
  calendar: DprCalendar;
  /** Decimal places a projection is spread at — its BOQ line's unit precision. */
  decimalsFor: (target: DprTarget) => number;
}

/** Either end blank means unbounded, matching `isDateInRange`. ISO dates compare as strings. */
const inRange = (isoDate: string, range: DprDateRange): boolean =>
  (!range.startDate || isoDate >= range.startDate) && (!range.endDate || isoDate <= range.endDate);

interface DayOwner {
  span: number;
  startDate: string;
  endDate: string;
  id: string;
  qty: number;
}

/** Whether a projection takes a day from its current owner: the shorter period wins. */
const takesDay = (span: number, target: DprTarget, owner: DayOwner): boolean => {
  if (span !== owner.span) return span < owner.span;
  // Same length: the later-starting one, then the id, so the answer never depends on load order.
  if (target.startDate !== owner.startDate) return target.startDate > owner.startDate;
  return String(target.id) > owner.id;
};

export function buildDprPlan(targets: readonly DprTarget[], options: DprPlanOptions): DprPlan {
  const byItem = new Map<string, DprTarget[]>();
  const scopesByItem = new Map<string, Set<DprScope>>();
  for (const target of targets) {
    if (!target?.boqItemId) continue;
    if (daysInRange(target.startDate, target.endDate) === 0) continue;
    const list = byItem.get(target.boqItemId) ?? [];
    list.push(target);
    byItem.set(target.boqItemId, list);
    const scopes = scopesByItem.get(target.boqItemId) ?? new Set<DprScope>();
    scopes.add(target.scope);
    scopesByItem.set(target.boqItemId, scopes);
  }

  const cache = new Map<string, Map<string, number>>();
  const ownerCache = new Map<string, Map<string, DayOwner>>();
  const daily = (boqItemId: string): Map<string, number> => {
    const cached = cache.get(boqItemId);
    if (cached) return cached;
    const owners = new Map<string, DayOwner>();
    ownerCache.set(boqItemId, owners);
    for (const target of byItem.get(boqItemId) ?? []) {
      const allocation = allocateProjection(target, options.calendar, options.decimalsFor(target));
      const span = daysInRange(target.startDate, target.endDate);
      for (const day of eachDayInRange(target.startDate, target.endDate)) {
        const owner = owners.get(day);
        if (owner && !takesDay(span, target, owner)) continue;
        // A day the owner spreads nothing on (a non-working day) is still owned, at zero.
        owners.set(day, {
          span,
          startDate: target.startDate,
          endDate: target.endDate,
          id: String(target.id),
          qty: allocation.get(day) ?? 0,
        });
      }
    }
    const map = new Map<string, number>();
    for (const day of [...owners.keys()].sort()) map.set(day, owners.get(day)!.qty);
    cache.set(boqItemId, map);
    return map;
  };

  const qtyInRange = (boqItemId: string, range: DprDateRange): number => {
    let sum = 0;
    for (const [day, qty] of daily(boqItemId)) if (inRange(day, range)) sum += qty;
    return tidy(sum);
  };

  return {
    daily,
    onDate: (boqItemId, isoDate) => daily(boqItemId).get(isoDate) ?? 0,
    qtyInRange,
    ownerOn(boqItemId, isoDate) {
      daily(boqItemId);
      const owner = ownerCache.get(boqItemId)?.get(isoDate);
      return owner ? { targetId: owner.id, startDate: owner.startDate, endDate: owner.endDate } : null;
    },
    byItemInRange(range, filter: DprTargetFilter = {}) {
      const planned = new Map<string, number>();
      for (const boqItemId of byItem.keys()) {
        if (filter.boqItemId && boqItemId !== filter.boqItemId) continue;
        if (filter.scope && !scopesByItem.get(boqItemId)?.has(filter.scope)) continue;
        const qty = qtyInRange(boqItemId, range);
        if (qty !== 0) planned.set(boqItemId, qty);
      }
      return planned;
    },
  };
}

/* ── Actuals ────────────────────────────────────────────────────────────────────────────────── */

export interface DprActualIndex {
  /** Counted quantity for a BOQ line over a range (all time when no range is given). */
  total(boqItemId: string, range?: DprDateRange): number;
  onDate(boqItemId: string, isoDate: string): number;
  /** Whether a scope has a counted sheet for the date. */
  hasSheet(scope: DprScope, isoDate: string): boolean;
}

/**
 * Submitted quantity per BOQ line per day. Drafts are not counted, as everywhere in the register.
 * `excludeEntryId` leaves one sheet out — the one being edited, so "done before" excludes itself.
 */
export function indexDprActuals(
  entries: readonly DprEntry[],
  options: { excludeEntryId?: string; includeDrafts?: boolean } = {},
): DprActualIndex {
  const byItem = new Map<string, Map<string, number>>();
  const sheetDays = new Map<DprScope, Set<string>>();
  for (const entry of filterDprEntries(entries, { includeDrafts: options.includeDrafts })) {
    if (options.excludeEntryId && entry.id === options.excludeEntryId) continue;
    const days = sheetDays.get(entry.scope) ?? new Set<string>();
    days.add(entry.date);
    sheetDays.set(entry.scope, days);
    for (const line of entry.lines ?? []) {
      if (!line?.boqItemId) continue;
      const perDay = byItem.get(line.boqItemId) ?? new Map<string, number>();
      perDay.set(entry.date, (perDay.get(entry.date) ?? 0) + dprNumber(line.actualQty));
      byItem.set(line.boqItemId, perDay);
    }
  }
  return {
    total(boqItemId, range) {
      let sum = 0;
      for (const [day, qty] of byItem.get(boqItemId) ?? []) {
        if (!range || inRange(day, range)) sum += qty;
      }
      return tidy(sum);
    },
    onDate: (boqItemId, isoDate) => byItem.get(boqItemId)?.get(isoDate) ?? 0,
    hasSheet: (scope, isoDate) => sheetDays.get(scope)?.has(isoDate) ?? false,
  };
}

/**
 * Why a planned line needs no recording on a day: its work is already done before that day.
 *  - `boq`: everything counted so far reaches the BOQ quantity — more would pass the BOQ.
 *  - `period`: everything planned across the projection that owns the day (its whole period,
 *    shorter projections inside it included) was achieved within that period before the day —
 *    the projection finished early, and the days it still spreads quantity on are left over.
 */
export type DprCompletion =
  | { kind: "boq"; doneQty: number; boqQty: number }
  | { kind: "period"; doneQty: number; plannedQty: number; startDate: string; endDate: string };

export function dprCompletionOn(input: {
  item: Pick<DprBoqLike, "id" | "boqQty">;
  isoDate: string;
  plan: Pick<DprPlan, "ownerOn" | "qtyInRange">;
  /** Must leave out the sheet being recorded, as everywhere "done before" is read. */
  actuals: Pick<DprActualIndex, "total">;
}): DprCompletion | null {
  const { item, isoDate, plan, actuals } = input;
  const boqQty = dprNumber(item.boqQty);
  const doneQty = actuals.total(item.id);
  if (boqQty > 0 && doneQty + 1e-9 >= boqQty) return { kind: "boq", doneQty, boqQty };

  const owner = plan.ownerOn(item.id, isoDate);
  if (!owner || !owner.startDate || isoDate <= owner.startDate) return null;
  const period = { startDate: owner.startDate, endDate: owner.endDate };
  const plannedQty = plan.qtyInRange(item.id, period);
  if (!(plannedQty > 0)) return null;
  const doneInPeriod = actuals.total(item.id, { startDate: owner.startDate, endDate: addDays(isoDate, -1) });
  return doneInPeriod + 1e-9 >= plannedQty
    ? { kind: "period", doneQty: doneInPeriod, plannedQty, ...period }
    : null;
}

/** Still to come: days after today, plus today while today's sheet is not in. */
export function openPlanQty(
  daily: ReadonlyMap<string, number>,
  today: string,
  todaySheetIn: boolean,
): number {
  let sum = 0;
  for (const [day, qty] of daily) {
    if (day > today || (day === today && !todaySheetIn)) sum += qty;
  }
  return tidy(sum);
}

/** BOQ quantity plus tolerance. null when the BOQ line carries no quantity to check against. */
export function boqLimit(boqQty: number, settings: Pick<DprSettings, "tolerancePct">): number | null {
  return boqQty > 0 ? boqQty * (1 + settings.tolerancePct / 100) : null;
}

/* ── Checks ─────────────────────────────────────────────────────────────────────────────────── */

export interface DprCheckResult {
  /** Block the save. */
  errors: string[];
  /** Allowed, but the person has to see them and confirm. */
  warnings: string[];
}

/** "block" refuses an overlap on the same BOQ line; "finer" lets the shorter period own it. */
export type DprOverlapPolicy = "block" | "finer";

export interface DprProjectionCandidate {
  scope: DprScope;
  boqItemId: string;
  periodType: DprProjectionPeriod;
  startDate: string;
  endDate: string;
  plannedQty: number;
  distribution: DprDistribution;
}

const projectionText = (target: DprTarget, fallbackUnit: string): string =>
  `${DPR_PERIOD_LABELS[target.periodType] ?? "Custom"} ${dprShortDate(target.startDate)} – ${dprShortDate(
    target.endDate,
  )} (${fmtQty(dprNumber(target.plannedQty))} ${target.unit || fallbackUnit})`.trim();

/**
 * Rules P1–P6 for a new projection, and P1/P6 for a revision of an existing one.
 *
 * A revision keeps its period, so only its quantity, the balance and the "ended" lock apply.
 */
export function checkDprProjection(input: {
  candidate: DprProjectionCandidate;
  item: { unit: string; boqQty: number };
  targets: readonly DprTarget[];
  actuals: DprActualIndex;
  settings: DprSettings;
  projectDates: DprDateRange;
  today: string;
  overlapPolicy: DprOverlapPolicy;
  revising?: DprTarget;
}): DprCheckResult {
  const { candidate, item, targets, actuals, settings, projectDates, today, overlapPolicy, revising } =
    input;
  const errors: string[] = [];
  const warnings: string[] = [];
  const calendar = dprCalendar(settings);
  const decimals = dprUnitDecimals(item.unit, settings);
  const qty = dprNumber(candidate.plannedQty);

  if (!(qty > 0)) errors.push("Quantity must be greater than zero.");
  else if (!fitsUnitPrecision(qty, decimals)) errors.push(precisionMessage(item.unit, decimals));

  const range = { startDate: candidate.startDate, endDate: candidate.endDate };
  if (!isValidRange(range)) {
    errors.push("Pick a valid period first.");
    return { errors, warnings };
  }

  if (revising) {
    if (range.endDate < today) errors.push("This projection's period has ended. Past periods are locked.");
  } else {
    if (range.endDate < today) errors.push("This period has already ended. Past periods are locked.");
    else if (range.startDate < today) {
      warnings.push("Starts before today, so the elapsed days are planned after the fact.");
    }
    if (projectDates.startDate && range.startDate < projectDates.startDate) {
      errors.push(`Starts before the project start date (${fmtDate(projectDates.startDate)}).`);
    }
    if (projectDates.endDate && range.endDate > projectDates.endDate) {
      errors.push(`Runs past the project completion date (${fmtDate(projectDates.endDate)}).`);
    }
    if (calendar.workingDays(range.startDate, range.endDate).length === 0) {
      errors.push("No working days in this period.");
    }
    const clashes = targets
      .filter(
        (target) =>
          target.boqItemId === candidate.boqItemId && overlapDays(target, range) > 0,
      )
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
    if (clashes.length > 0) {
      const text = clashes.map((target) => projectionText(target, item.unit)).join(", ");
      if (overlapPolicy === "block") {
        errors.push(
          `Overlaps ${text}. Revise that projection, or set the overlap rule to “Shorter period takes those days”.`,
        );
      } else {
        warnings.push(`Overlaps ${text}. The shorter period takes the shared days.`);
      }
    }
  }

  const limit = boqLimit(item.boqQty, settings);
  if (errors.length === 0 && limit !== null) {
    const ownId = revising?.id ?? "__candidate__";
    const proposed: DprTarget = {
      id: ownId,
      boqSlNo: "",
      description: "",
      ...(revising ?? {}),
      ...candidate,
      unit: item.unit,
      plannedQty: qty,
    };
    const others = targets.filter(
      (target) => target.boqItemId === candidate.boqItemId && target.id !== ownId,
    );
    const plan = buildDprPlan([...others, proposed], { calendar, decimalsFor: () => decimals });
    const open = openPlanQty(
      plan.daily(candidate.boqItemId),
      today,
      actuals.hasSheet(candidate.scope, today),
    );
    const left = limit - actuals.total(candidate.boqItemId);
    if (open > left + 1e-9) {
      errors.push(
        `Exceeds the balance: open plan ${fmtQty(open)} against ${fmtQty(Math.max(left, 0))} ${item.unit} left${
          settings.tolerancePct ? ` (incl. ${settings.tolerancePct}% tolerance)` : ""
        }.`,
      );
    }
  }

  return { errors, warnings };
}

/** One row of a daily sheet as typed — text, so an empty Actual can be told apart from a 0. */
export interface DprSheetLine {
  boqItemId: string;
  actual: string;
  location?: string;
  remarks?: string;
}

export interface DprSheet {
  scope: DprScope;
  date: string;
  weather: string;
  lines: DprSheetLine[];
  manpower: Array<{ trade: string; count: string | number }>;
  equipment: Array<{
    name: string;
    deployed: string | number;
    runningHours?: string | number;
    idleHours?: string | number;
  }>;
  lostTimeHours: string | number;
  lostTimeReason: string;
  hindrances: string;
}

/** "" → null (not entered); otherwise the number, or NaN when it is not one. */
const readTyped = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : Number.NaN;
  const text = String(value).replace(/,/g, "").trim();
  return text === "" ? null : Number(text);
};

/** Whole days between two ISO dates (b − a). */
const daysBetween = (a: string, b: string): number =>
  b >= a ? daysInRange(a, b) - 1 : -(daysInRange(b, a) - 1);

/**
 * Rules D1–D10 for submitting a daily sheet. `actuals` must leave this sheet out, so the
 * cumulative check adds the sheet's own figures exactly once.
 */
export function checkDprSheet(input: {
  sheet: DprSheet;
  items: ReadonlyMap<string, DprBoqLike>;
  plan: DprPlan;
  actuals: DprActualIndex;
  settings: DprSettings;
  projectDates: DprDateRange;
  today: string;
  /** A DPR approver may record past the backdating limit. */
  canRecordAnyDate: boolean;
}): DprCheckResult {
  const { sheet, items, plan, actuals, settings, projectDates, today, canRecordAnyDate } = input;
  const errors: string[] = [];
  const warnings: string[] = [];
  const calendar = dprCalendar(settings);

  if (!parseIsoDate(sheet.date)) {
    errors.push("Pick the date this progress was recorded on.");
    return { errors, warnings };
  }
  if (sheet.date > today) errors.push("Future dates cannot be recorded.");
  else if (!canRecordAnyDate && daysBetween(sheet.date, today) > settings.backdateDays) {
    errors.push(
      `This date is more than ${settings.backdateDays} day${settings.backdateDays === 1 ? "" : "s"} back. Ask a DPR approver to record it.`,
    );
  }
  if (projectDates.startDate && sheet.date < projectDates.startDate) {
    errors.push(`This date is before the project start (${fmtDate(projectDates.startDate)}).`);
  }
  if (projectDates.endDate && sheet.date > projectDates.endDate) {
    warnings.push("This date is after the project completion date.");
  }
  if (!calendar.isWorkingDay(sheet.date)) warnings.push("This is a non-working day in the project calendar.");
  // Weather is optional (the user, 2026-11-14): it is chosen from the fixed list when recorded,
  // and never blocks a submit.
  if (sheet.lines.length === 0) errors.push("Add at least one BOQ line.");

  const hindrances = String(sheet.hindrances ?? "").trim();
  const seen = new Set<string>();
  const sheetTotals = new Map<string, number>();
  let anyWork = false;
  sheet.lines.forEach((line, index) => {
    const item = line.boqItemId ? items.get(line.boqItemId) : undefined;
    if (!item) {
      errors.push(`Row ${index + 1}: choose a BOQ line.`);
      return;
    }
    const label = item.boqSlNo || item.erpSlNo || `Row ${index + 1}`;
    const decimals = dprUnitDecimals(item.unit, settings);
    const planned = plan.onDate(item.id, sheet.date);
    const key = `${item.id}|${String(line.location ?? "").trim().toLowerCase()}`;
    if (seen.has(key)) {
      errors.push(`${label}: entered twice for the same location. Merge the rows or give each a location.`);
    }
    seen.add(key);

    const actual = readTyped(line.actual);
    if (actual === null) {
      errors.push(`${label}: enter the actual quantity (0 if no work was done).`);
      return;
    }
    if (Number.isNaN(actual) || actual < 0) {
      errors.push(`${label}: actual must be a number, zero or more.`);
      return;
    }
    if (!fitsUnitPrecision(actual, decimals)) errors.push(`${label}: ${precisionMessage(item.unit, decimals)}`);
    sheetTotals.set(item.id, (sheetTotals.get(item.id) ?? 0) + actual);
    if (actual > 0) anyWork = true;

    // A line whose planned work is already done (BOQ reached, or its projection met early) owes
    // no explanation for a zero: there was nothing left to do.
    if (
      actual === 0 &&
      planned > 0 &&
      !String(line.remarks ?? "").trim() &&
      !hindrances &&
      !dprCompletionOn({ item, isoDate: sheet.date, plan, actuals })
    ) {
      errors.push(
        `${label}: ${fmtQty(planned)} ${item.unit} was planned but nothing was done. Add a row remark or a hindrance.`,
      );
    }
    if (planned > 0 && actual > settings.spikeMultiple * planned) {
      warnings.push(
        `${label}: ${fmtQty(actual)} ${item.unit} is more than ${settings.spikeMultiple}× the day’s plan of ${fmtQty(planned)}. Check the figure.`,
      );
    }
    if (planned === 0 && actual > 0) warnings.push(`${label}: no quantity was planned for this day.`);
  });

  for (const [boqItemId, qty] of sheetTotals) {
    const item = items.get(boqItemId);
    const limit = item ? boqLimit(item.boqQty, settings) : null;
    if (!item || limit === null) continue;
    const cumulative = actuals.total(boqItemId) + qty;
    if (cumulative > limit + 1e-9) {
      errors.push(
        `${item.boqSlNo || item.erpSlNo || "A line"}: cumulative ${fmtQty(cumulative)} ${item.unit} would exceed the BOQ quantity of ${fmtQty(item.boqQty)}${
          settings.tolerancePct ? ` plus ${settings.tolerancePct}% tolerance` : ""
        }.`,
      );
    }
  }

  let headcount = 0;
  sheet.manpower.forEach((row, index) => {
    const trade = String(row.trade ?? "").trim();
    const count = readTyped(row.count);
    if (!trade && (count === null || count === 0)) return; // an untouched row
    if (!trade) errors.push(`Manpower row ${index + 1}: name the trade.`);
    if (count === null || Number.isNaN(count) || count <= 0 || !Number.isInteger(count)) {
      errors.push(`Manpower row ${index + 1}: headcount must be a whole number above zero.`);
    } else {
      headcount += count;
    }
  });
  if (anyWork && headcount === 0) errors.push("Work is recorded, so add the manpower that did it.");

  sheet.equipment.forEach((row, index) => {
    const name = String(row.name ?? "").trim();
    const deployed = readTyped(row.deployed);
    const running = readTyped(row.runningHours) ?? 0;
    const idle = readTyped(row.idleHours) ?? 0;
    if (!name && !deployed && !running && !idle) return; // an untouched row
    if (!name) errors.push(`Equipment row ${index + 1}: name the equipment.`);
    if (deployed !== null && (Number.isNaN(deployed) || deployed < 0 || !Number.isInteger(deployed))) {
      errors.push(`Equipment row ${index + 1}: the number deployed must be a whole number.`);
      return;
    }
    if (Number.isNaN(running) || Number.isNaN(idle) || running < 0 || idle < 0) {
      errors.push(`Equipment row ${index + 1}: hours cannot be negative.`);
      return;
    }
    const units = Math.max(1, deployed ?? 1);
    if (running + idle > 24 * units) {
      errors.push(
        `Equipment row ${index + 1}: running and idle hours cannot add up to more than 24 a day for each unit deployed.`,
      );
    }
  });

  const lost = readTyped(sheet.lostTimeHours);
  if (lost !== null) {
    if (Number.isNaN(lost) || lost < 0 || lost > settings.shiftHours) {
      errors.push(`Time lost must be between 0 and the ${settings.shiftHours}-hour shift.`);
    } else if (lost > 0 && !String(sheet.lostTimeReason ?? "").trim()) {
      errors.push("Give the reason for the time lost.");
    }
  }

  return { errors, warnings };
}

/* ── The progress board ─────────────────────────────────────────────────────────────────────── */

export interface DprBoardItem extends DprBoqLike {
  scope: DprScope;
}

/** "unplanned": worked in the period with nothing planned for it. */
export type DprLineStatus = "not-due" | "on-plan" | "behind" | "unplanned";

export interface DprBoardRow {
  item: DprBoardItem;
  /** Planned from the period start up to today (or the period end, if that is sooner). */
  planToDate: number;
  actual: number;
  /** actual ÷ plan to date, in percent. null while nothing is due yet. */
  achievementPct: number | null;
  fullPlan: number;
  /** What is left of the period plan. */
  balance: number;
  /** What each remaining working day must deliver. null when work is left but no day is. */
  neededPerDay: number | null;
  daysLeft: number;
  status: DprLineStatus;
}

export type DprAchievementBasis = "value" | "average";

export interface DprBoardStats {
  achievementToDatePct: number | null;
  achievementFullPct: number | null;
  basis: DprAchievementBasis;
  linesDue: number;
  linesBehind: number;
  linesWorked: number;
  linesInPeriod: number;
  daysReported: number;
  workingDaysElapsed: number;
  workingDaysInPeriod: number;
  manDays: number;
  lostTimeHours: number;
}

export interface DprCurvePoint {
  date: string;
  label: string;
  /** Cumulative plan as a share of the period plan, in percent. */
  plannedPct: number;
  /** Cumulative actual as a share of the period plan. null after today. */
  actualPct: number | null;
}

export interface DprBoard {
  range: DprDateRange;
  rows: DprBoardRow[];
  stats: DprBoardStats;
  curve: DprCurvePoint[];
}

const hasRate = (item: DprBoqLike): boolean => dprNumber(item.rate) > 0;

/**
 * A share across lines of different units: value-weighted when every line has a rate, otherwise
 * the mean of each line's own ratio. Returns a percentage, or null with nothing to measure.
 */
const shareAcross = (
  lines: Array<{ item: DprBoqLike; numerator: number; denominator: number }>,
  basis: DprAchievementBasis,
): number | null => {
  const measured = lines.filter((line) => line.denominator > 0);
  if (measured.length === 0) return null;
  if (basis === "value") {
    const done = measured.reduce((sum, line) => sum + dprNumber(line.item.rate) * line.numerator, 0);
    const due = measured.reduce((sum, line) => sum + dprNumber(line.item.rate) * line.denominator, 0);
    return due > 0 ? (done / due) * 100 : null;
  }
  return (measured.reduce((sum, line) => sum + line.numerator / line.denominator, 0) / measured.length) * 100;
};

const emptyStats = (): DprBoardStats => ({
  achievementToDatePct: null,
  achievementFullPct: null,
  basis: "average",
  linesDue: 0,
  linesBehind: 0,
  linesWorked: 0,
  linesInPeriod: 0,
  daysReported: 0,
  workingDaysElapsed: 0,
  workingDaysInPeriod: 0,
  manDays: 0,
  lostTimeHours: 0,
});

/** Planned against actual, line by line, for one period — the dashboard's whole reading. */
export function buildDprBoard(input: {
  items: readonly DprBoardItem[];
  entries: readonly DprEntry[];
  plan: DprPlan;
  settings: DprSettings;
  range: DprDateRange;
  scope?: DprScope;
  today: string;
}): DprBoard {
  const { items, entries, plan, settings, range, scope, today } = input;
  if (!isValidRange(range)) return { range, rows: [], stats: emptyStats(), curve: [] };

  const calendar = dprCalendar(settings);
  const actuals = indexDprActuals(entries);
  const started = range.startDate <= today;
  const cutOff = range.endDate < today ? range.endDate : today;
  const toDate: DprDateRange | null = started ? { startDate: range.startDate, endDate: cutOff } : null;
  const remainingFrom = range.startDate > today ? range.startDate : today;
  const remainingDays =
    range.endDate < today ? [] : calendar.workingDays(remainingFrom, range.endDate);

  const rows: DprBoardRow[] = [];
  for (const item of items) {
    if (scope && item.scope !== scope) continue;
    const fullPlan = plan.qtyInRange(item.id, range);
    const actual = actuals.total(item.id, range);
    if (fullPlan <= 0 && actual <= 0) continue;
    const planToDate = toDate ? plan.qtyInRange(item.id, toDate) : 0;
    const todayIn = actuals.hasSheet(item.scope, today);
    const daysLeft = remainingDays.filter((day) => day > today || !todayIn).length;
    const balance = Math.max(0, tidy(fullPlan - actual));
    rows.push({
      item,
      planToDate,
      actual,
      achievementPct: planToDate > 0 ? (actual / planToDate) * 100 : null,
      fullPlan,
      balance,
      neededPerDay: balance <= 0 ? 0 : daysLeft > 0 ? balance / daysLeft : null,
      daysLeft,
      status:
        fullPlan <= 0
          ? "unplanned"
          : planToDate <= 0
            ? "not-due"
            : actual >= planToDate - 1e-9
              ? "on-plan"
              : "behind",
    });
  }

  const planned = rows.filter((row) => row.fullPlan > 0);
  const due = rows.filter((row) => row.planToDate > 0);
  const basis: DprAchievementBasis =
    planned.length > 0 && planned.every((row) => hasRate(row.item)) ? "value" : "average";

  const sheets = filterDprEntries(entries, { scope, range });
  const stats: DprBoardStats = {
    achievementToDatePct: shareAcross(
      due.map((row) => ({ item: row.item, numerator: row.actual, denominator: row.planToDate })),
      basis,
    ),
    achievementFullPct: shareAcross(
      planned.map((row) => ({ item: row.item, numerator: row.actual, denominator: row.fullPlan })),
      basis,
    ),
    basis,
    linesDue: due.length,
    linesBehind: rows.filter((row) => row.status === "behind").length,
    linesWorked: rows.filter((row) => row.actual > 0).length,
    linesInPeriod: rows.length,
    daysReported: new Set(sheets.map((entry) => entry.date)).size,
    workingDaysElapsed: toDate ? calendar.workingDays(toDate.startDate, toDate.endDate).length : 0,
    workingDaysInPeriod: calendar.workingDays(range.startDate, range.endDate).length,
    manDays: tidy(
      sheets.reduce(
        (sum, entry) =>
          sum + (entry.manpower ?? []).reduce((count, line) => count + dprNumber(line?.count), 0),
        0,
      ),
    ),
    lostTimeHours: tidy(sheets.reduce((sum, entry) => sum + dprNumber(entry.lostTimeHours), 0)),
  };

  const curve: DprCurvePoint[] = [];
  if (planned.length > 0) {
    const planCum = planned.map(() => 0);
    const actCum = planned.map(() => 0);
    for (const day of eachDayInRange(range.startDate, range.endDate)) {
      planned.forEach((row, index) => {
        planCum[index] += plan.onDate(row.item.id, day);
        actCum[index] += actuals.onDate(row.item.id, day);
      });
      const plannedPct =
        shareAcross(
          planned.map((row, index) => ({ item: row.item, numerator: planCum[index]!, denominator: row.fullPlan })),
          basis,
        ) ?? 0;
      const actualPct =
        day <= today
          ? (shareAcross(
              planned.map((row, index) => ({ item: row.item, numerator: actCum[index]!, denominator: row.fullPlan })),
              basis,
            ) ?? 0)
          : null;
      curve.push({ date: day, label: dprShortDate(day), plannedPct, actualPct });
    }
  }

  return { range, rows, stats, curve };
}

/* ── Look-ahead ─────────────────────────────────────────────────────────────────────────────── */

export interface DprLookAheadWeek {
  startDate: string;
  endDate: string;
  label: string;
  isCurrent: boolean;
  /** The week has begun, so work done can be shown against it. */
  started: boolean;
  /** The week is over, so its plan is locked. */
  ended: boolean;
}

export interface DprLookAheadRow<T extends DprBoardItem = DprBoardItem> {
  item: T;
  cells: Array<{ planned: number; done: number | null }>;
}

/** Planned per week for six weeks from last week, with work done for weeks that have started. */
export function buildDprLookAhead<T extends DprBoardItem>(input: {
  items: readonly T[];
  entries: readonly DprEntry[];
  plan: DprPlan;
  today: string;
  scope?: DprScope;
  weeks?: number;
}): { weeks: DprLookAheadWeek[]; rows: DprLookAheadRow<T>[] } {
  const { items, entries, plan, today, scope } = input;
  const count = input.weeks ?? 6;
  const first = addDays(startOfWeek(today), -7);
  const weeks: DprLookAheadWeek[] = Array.from({ length: count }, (_, index) => {
    const startDate = addDays(first, index * 7);
    const endDate = addDays(startDate, 6);
    return {
      startDate,
      endDate,
      label: `Wk ${dprShortDate(startDate)}`,
      isCurrent: startDate <= today && today <= endDate,
      started: startDate <= today,
      ended: endDate < today,
    };
  });
  const actuals = indexDprActuals(entries);
  const rows: DprLookAheadRow<T>[] = [];
  for (const item of items) {
    if (scope && item.scope !== scope) continue;
    const cells = weeks.map((week) => ({
      planned: plan.qtyInRange(item.id, week),
      done: week.started ? actuals.total(item.id, week) : null,
    }));
    if (cells.some((cell) => cell.planned > 0 || (cell.done ?? 0) > 0)) rows.push({ item, cells });
  }
  return { weeks, rows };
}

/* ── Unit-safe trend, for the reports ───────────────────────────────────────────────────────── */

export interface DprShareBucket {
  bucketStart: string;
  label: string;
  /** This bucket's plan as a share of the whole range's plan, in percent. */
  plannedPct: number;
  actualPct: number;
  cumulativePlannedPct: number;
  cumulativeActualPct: number;
}

/**
 * Planned and actual per bucket as shares of the range's plan, so lines in Cum and Nos can be
 * read on one axis without their quantities ever being added.
 */
export function buildDprShareTrend(input: {
  items: readonly DprBoardItem[];
  entries: readonly DprEntry[];
  plan: DprPlan;
  range: DprDateRange;
  periodType: DprPeriodType;
  scope?: DprScope;
}): { basis: DprAchievementBasis; points: DprShareBucket[] } {
  const { items, entries, plan, range, periodType, scope } = input;
  if (!isValidRange(range)) return { basis: "average", points: [] };
  const actuals = indexDprActuals(entries);
  const lines = items
    .filter((item) => !scope || item.scope === scope)
    .map((item) => ({ item, full: plan.qtyInRange(item.id, range) }))
    .filter((line) => line.full > 0);
  const basis: DprAchievementBasis =
    lines.length > 0 && lines.every((line) => hasRate(line.item)) ? "value" : "average";

  const share = (numerators: number[]) =>
    shareAcross(
      lines.map((line, index) => ({ item: line.item, numerator: numerators[index]!, denominator: line.full })),
      basis,
    ) ?? 0;

  const cumPlan = lines.map(() => 0);
  const cumActual = lines.map(() => 0);
  const points = bucketsInRange(periodType, range.startDate, range.endDate).map((bucketStart) => {
    const full = periodRangeFor(periodType, bucketStart);
    const bucket: DprDateRange = {
      startDate: full.startDate < range.startDate ? range.startDate : full.startDate,
      endDate: full.endDate > range.endDate ? range.endDate : full.endDate,
    };
    const plannedNow = lines.map((line) => plan.qtyInRange(line.item.id, bucket));
    const actualNow = lines.map((line) => actuals.total(line.item.id, bucket));
    plannedNow.forEach((qty, index) => (cumPlan[index] += qty));
    actualNow.forEach((qty, index) => (cumActual[index] += qty));
    return {
      bucketStart,
      label: formatPeriodLabel(periodType, bucketStart),
      plannedPct: share(plannedNow),
      actualPct: share(actualNow),
      cumulativePlannedPct: share(cumPlan),
      cumulativeActualPct: share(cumActual),
    };
  });
  return { basis, points };
}

/* ── Planning helpers ───────────────────────────────────────────────────────────────────────── */

/** The period before this one: the previous month for a month, else the same length earlier. */
export function previousPeriodRange(
  periodType: DprProjectionPeriod,
  range: DprDateRange,
): DprDateRange {
  if (periodType === "Month") {
    const lastDay = addDays(range.startDate, -1);
    return { startDate: startOfMonth(lastDay), endDate: endOfMonth(lastDay) };
  }
  const length = daysInRange(range.startDate, range.endDate);
  return { startDate: addDays(range.startDate, -length), endDate: addDays(range.startDate, -1) };
}

/**
 * What of a BOQ line is not yet executed or planned: BOQ quantity plus tolerance, less everything
 * done, less everything still planned. null when the line has no BOQ quantity.
 */
export function unplannedBalance(input: {
  item: DprBoqLike & { scope: DprScope };
  plan: DprPlan;
  actuals: DprActualIndex;
  settings: DprSettings;
  today: string;
}): number | null {
  const { item, plan, actuals, settings, today } = input;
  const limit = boqLimit(item.boqQty, settings);
  if (limit === null) return null;
  const open = openPlanQty(plan.daily(item.id), today, actuals.hasSheet(item.scope, today));
  return tidy(limit - actuals.total(item.id) - open);
}

/**
 * Rows pasted from a spreadsheet: a BOQ number in the first column and a quantity in the last.
 * Tabs are what Excel copies; commas, double spaces and a single trailing number also work.
 * Rows whose last cell is not a number (a header row) are skipped.
 */
export function parsePastedQuantities(text: string): Array<{ key: string; qty: number }> {
  const rows: Array<{ key: string; qty: number }> = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let cells: string[];
    if (line.includes("\t")) cells = line.split("\t");
    else if (/\s{2,}/.test(line)) cells = line.split(/\s{2,}/);
    else if (line.includes(",")) cells = line.split(",");
    else cells = line.split(/\s+/);
    cells = cells.map((cell) => cell.trim()).filter(Boolean);
    if (cells.length < 2) continue;
    const qtyText = cells[cells.length - 1]!.replace(/,/g, "");
    const qty = Number(qtyText);
    if (!qtyText || !Number.isFinite(qty)) continue;
    rows.push({ key: cells[0]!, qty });
  }
  return rows;
}

/* ── Suggestions ────────────────────────────────────────────────────────────────────────────── */

export interface DprSuggestions {
  locations: string[];
  agencies: string[];
  trades: string[];
  equipment: string[];
}

/** Values already used on this project's sheets, most used first, for the entry screen's lists. */
export function dprSuggestions(entries: readonly DprEntry[]): DprSuggestions {
  const tally = () => new Map<string, { text: string; count: number }>();
  const add = (map: ReturnType<typeof tally>, value: unknown) => {
    const text = String(value ?? "").trim();
    if (!text) return;
    const key = text.toLowerCase();
    const current = map.get(key) ?? { text, count: 0 };
    current.count += 1;
    map.set(key, current);
  };
  const locations = tally();
  const agencies = tally();
  const trades = tally();
  const equipment = tally();
  for (const entry of entries) {
    for (const line of entry.lines ?? []) {
      add(locations, line?.location);
      add(agencies, line?.agency);
    }
    for (const line of entry.manpower ?? []) add(trades, line?.trade);
    for (const line of entry.equipment ?? []) add(equipment, line?.name);
  }
  const ranked = (map: ReturnType<typeof tally>) =>
    [...map.values()]
      .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text))
      .slice(0, 50)
      .map((entry) => entry.text);
  return {
    locations: ranked(locations),
    agencies: ranked(agencies),
    trades: ranked(trades),
    equipment: ranked(equipment),
  };
}

/** Re-exported so the screens import the period and spread lists from one place. */
export { DPR_DISTRIBUTIONS, DPR_PROJECTION_PERIODS, DPR_SCOPES };

/**
 * Supply chain analytics — the numbers a project manager acts on, computed from the registers the
 * supply module already maintains.
 *
 * The module can answer "what is the state of this document" on every screen. What it cannot
 * answer, and what a procurement head actually asks, is: *where is my money stuck, for how long,
 * and whose fault is it.* That needs the whole chain read at once and measured against value and
 * elapsed time rather than counts of rows.
 *
 * The chain measured here, in order:
 *   PO → Manufacturing Clearance → Inspection → MDCC → Dispatch Instruction → GRN → MVAC
 *
 * Three deliberate choices run through everything below:
 *
 *  1. VALUE, NOT COUNTS. Every figure is also expressed in rupees at the PO line rate. "Eleven
 *     items awaiting MDCC" is not a decision; "₹48 lakh awaiting MDCC, oldest 31 days" is.
 *
 *  2. UNITS ARE NEVER SUMMED ACROSS LINES. A project mixes Nos, MT, km and lots, so a total
 *     quantity across lines is meaningless. Quantities stay per line; only value aggregates.
 *
 *  3. ABSENT IS NOT ZERO. A stage with no document recorded has `undefined` elapsed time, not 0
 *     days, and is excluded from medians — otherwise every unstarted line would drag the cycle
 *     time toward zero and hide the real delay.
 *
 * Pure (no Firebase, no React) so every rule here is unit-testable with `node --test`.
 */

import type { SupplyLedgerStage } from "./project-management-supply-ledger.ts";

/* ── The chain ──────────────────────────────────────────────────────────────────────────────── */

/** Every gate a manufactured PO line passes, including the two that live outside the supply ledger. */
export const SUPPLY_CHAIN_GATES = [
  "ordered",
  "mc",
  "inspection",
  "mdcc",
  "di",
  "grn",
  "mvac",
] as const;
export type SupplyChainGate = (typeof SUPPLY_CHAIN_GATES)[number];

export const SUPPLY_GATE_LABELS: Record<SupplyChainGate, string> = {
  ordered: "Ordered",
  mc: "Cleared to manufacture",
  inspection: "Inspected",
  mdcc: "Client cleared (MDCC)",
  di: "Dispatched",
  grn: "Received at site",
  mvac: "Client accepted (MVAC)",
};

/** Which party a gate is waiting on — the single most useful grouping when chasing a stuck item. */
export const SUPPLY_GATE_OWNER: Record<SupplyChainGate, string> = {
  ordered: "SEL procurement",
  mc: "SEL engineering",
  inspection: "Inspector",
  mdcc: "Client",
  di: "Vendor",
  grn: "Site store",
  mvac: "Client",
};

/* ── Inputs ─────────────────────────────────────────────────────────────────────────────────── */

/**
 * One PO line, with what each gate has accepted against it.
 *
 * Deliberately a flat shape rather than the four workspace types: the caller already holds those
 * and knows how to read them, and keeping this module ignorant of them is what makes it testable
 * without Firebase. `buildSupplyChainLines` in the reports screen does the flattening.
 */
export interface SupplyChainLine {
  poId: string;
  poNumber: string;
  poLineId: string;
  boqItemId?: string;
  boqSlNo?: string;
  itemDescription: string;
  unit: string;
  vendorId?: string;
  vendorName?: string;
  /** PO line rate, for valuing every quantity below. */
  rate: number;
  orderedQty: number;
  /** Quantity cancelled against the line — never reaches any gate. */
  cancelledQty?: number;
  /** Σ accepted at each gate. Absent (not zero) where the gate has recorded nothing. */
  acceptedQtyByGate: Partial<Record<SupplyChainGate, number>>;
  /** Σ presented-but-undecided at each gate: work in progress sitting with someone. */
  inFlightQtyByGate?: Partial<Record<SupplyChainGate, number>>;
  /** Σ presented − accepted on decided documents: what came back for rework. */
  rejectedQtyByGate?: Partial<Record<SupplyChainGate, number>>;
  /** Earliest date each gate accepted anything, `yyyy-mm-dd`. Drives cycle time. */
  firstAcceptedDateByGate?: Partial<Record<SupplyChainGate, string>>;
  /** Oldest open (undecided) document date at each gate. Drives ageing. */
  oldestOpenDateByGate?: Partial<Record<SupplyChainGate, string>>;
  /** PO dates, for schedule risk. */
  poDate?: string;
  poEndDate?: string;
  /** Open Critical/Major observations anywhere on this line — these block release downstream. */
  blockingObservationCount?: number;
  /** GRN's discrepancy split, where recorded. */
  shortQty?: number;
  damagedQty?: number;
}

const round = (value: number, places = 3): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

const num = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Whole days between two `yyyy-mm-dd` dates. Null when either is missing or unparseable — the
 * caller must then exclude the line rather than substitute zero. */
export function daysBetween(from?: string, to?: string): number | null {
  if (!from || !to) return null;
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

export function daysSince(date: string | undefined, today: Date): number | null {
  if (!date) return null;
  const then = new Date(`${date}T00:00:00`);
  if (Number.isNaN(then.getTime())) return null;
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((start.getTime() - then.getTime()) / 86_400_000);
}

/**
 * The middle value, which is what a cycle time should be reported as.
 *
 * One certificate that sat with a client for eight months drags a mean far past anything a
 * planner would recognise; the median says what normally happens, and `p90` below says how bad
 * the tail gets. Reporting both is the honest pair.
 */
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? round((sorted[middle - 1] + sorted[middle]) / 2, 1)
    : round(sorted[middle], 1);
}

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return round(sorted[index], 1);
}

/* ── 1. Pipeline funnel ─────────────────────────────────────────────────────────────────────── */

export interface SupplyFunnelStage {
  gate: SupplyChainGate;
  label: string;
  owner: string;
  /** Lines that have any accepted quantity at this gate. */
  lineCount: number;
  /** Σ accepted qty × rate. */
  value: number;
  /** Value as a percentage of the ordered value — the cumulative conversion. */
  pctOfOrdered: number;
  /** Value that cleared the previous gate but not this one: the leak at this step. */
  leakedValue: number;
  /** Undecided value sitting at this gate right now. */
  inFlightValue: number;
  /** Value that was presented here and bounced back for rework. */
  rejectedValue: number;
}

/**
 * The chain as a funnel, by value.
 *
 * `leakedValue` is the number worth looking at: it is not loss, it is *work not yet done* at that
 * step, and the biggest one is where the project is actually blocked. Reading conversion
 * percentages alone hides this, because a gate late in the chain always looks worst simply by
 * being late.
 */
export function buildSupplyFunnel(lines: SupplyChainLine[]): SupplyFunnelStage[] {
  const orderedValue = lines.reduce(
    (sum, line) => sum + Math.max(0, num(line.orderedQty) - num(line.cancelledQty)) * num(line.rate),
    0,
  );

  let previousValue = orderedValue;
  return SUPPLY_CHAIN_GATES.map((gate) => {
    let value = 0;
    let inFlightValue = 0;
    let rejectedValue = 0;
    let lineCount = 0;

    for (const line of lines) {
      const rate = num(line.rate);
      const accepted =
        gate === "ordered"
          ? Math.max(0, num(line.orderedQty) - num(line.cancelledQty))
          : num(line.acceptedQtyByGate[gate]);
      if (accepted > 0) {
        value += accepted * rate;
        lineCount += 1;
      }
      inFlightValue += num(line.inFlightQtyByGate?.[gate]) * rate;
      rejectedValue += num(line.rejectedQtyByGate?.[gate]) * rate;
    }

    const stage: SupplyFunnelStage = {
      gate,
      label: SUPPLY_GATE_LABELS[gate],
      owner: SUPPLY_GATE_OWNER[gate],
      lineCount,
      value: round(value, 2),
      pctOfOrdered: orderedValue > 0 ? Math.round((value / orderedValue) * 100) : 0,
      leakedValue: round(Math.max(0, previousValue - value), 2),
      inFlightValue: round(inFlightValue, 2),
      rejectedValue: round(rejectedValue, 2),
    };
    previousValue = value;
    return stage;
  });
}

/* ── 2. Where value is stuck ────────────────────────────────────────────────────────────────── */

export interface SupplyBottleneck {
  gate: SupplyChainGate;
  label: string;
  owner: string;
  /** Lines whose value has cleared the gate above but not this one. */
  stuckLineCount: number;
  /** Value that has cleared the gate above and is waiting on this one. */
  stuckValue: number;
  /** Of that, the part already presented and sitting undecided with the owner. */
  inFlightValue: number;
  /** Days since the oldest open document at this gate. */
  oldestDays: number | null;
  /** Σ value × days waiting ÷ value — how long a rupee waits here on average. */
  valueWeightedAgeDays: number | null;
}

/**
 * Where the money is, and how long it has been there.
 *
 * `valueWeightedAgeDays` is the discriminator a plain oldest-days count misses: one trivial line
 * stuck for 90 days is a nuisance, while forty lakh stuck for 30 days is the project slipping.
 * Weighting age by value ranks those correctly.
 */
export function buildSupplyBottlenecks(
  lines: SupplyChainLine[],
  today: Date = new Date(),
): SupplyBottleneck[] {
  const gates = SUPPLY_CHAIN_GATES.filter((gate) => gate !== "ordered");

  return gates.map((gate, index) => {
    const upstream = SUPPLY_CHAIN_GATES[SUPPLY_CHAIN_GATES.indexOf(gate) - 1];
    let stuckValue = 0;
    let inFlightValue = 0;
    let stuckLineCount = 0;
    let oldestDays: number | null = null;
    let weightedAge = 0;
    let weightedBase = 0;

    for (const line of lines) {
      const rate = num(line.rate);
      const upstreamQty =
        upstream === "ordered"
          ? Math.max(0, num(line.orderedQty) - num(line.cancelledQty))
          : num(line.acceptedQtyByGate[upstream]);
      const acceptedHere = num(line.acceptedQtyByGate[gate]);
      const pending = Math.max(0, upstreamQty - acceptedHere);
      if (pending <= 0) continue;

      const pendingValue = pending * rate;
      stuckValue += pendingValue;
      stuckLineCount += 1;
      inFlightValue += num(line.inFlightQtyByGate?.[gate]) * rate;

      // Age from the oldest open document here, falling back to when the upstream gate passed the
      // work down — a line nobody has even raised a document for is still waiting, and from then.
      const since =
        daysSince(line.oldestOpenDateByGate?.[gate], today) ??
        daysSince(line.firstAcceptedDateByGate?.[upstream], today);
      if (since != null && since >= 0) {
        if (oldestDays == null || since > oldestDays) oldestDays = since;
        weightedAge += since * pendingValue;
        weightedBase += pendingValue;
      }
    }

    void index;
    return {
      gate,
      label: SUPPLY_GATE_LABELS[gate],
      owner: SUPPLY_GATE_OWNER[gate],
      stuckLineCount,
      stuckValue: round(stuckValue, 2),
      inFlightValue: round(inFlightValue, 2),
      oldestDays,
      valueWeightedAgeDays: weightedBase > 0 ? round(weightedAge / weightedBase, 1) : null,
    };
  });
}

/* ── 3. Cycle time ──────────────────────────────────────────────────────────────────────────── */

export interface SupplyCycleTime {
  from: SupplyChainGate;
  to: SupplyChainGate;
  label: string;
  owner: string;
  /** Lines that have cleared BOTH gates, so the step can actually be measured. */
  sampleSize: number;
  medianDays: number | null;
  p90Days: number | null;
  worstDays: number | null;
}

/**
 * How long each step takes, measured only on lines that have completed it.
 *
 * A step is measured from the date the upstream gate first accepted to the date this gate first
 * accepted. Lines that never reached the second gate are excluded rather than counted as zero or
 * as "still running" — an unfinished step has no duration yet, and pretending otherwise is how a
 * cycle-time chart ends up reassuring and wrong. What is still running shows in the bottleneck
 * report above instead, which is the honest split.
 */
export function buildSupplyCycleTimes(lines: SupplyChainLine[]): SupplyCycleTime[] {
  const steps: Array<[SupplyChainGate, SupplyChainGate]> = [];
  for (let index = 1; index < SUPPLY_CHAIN_GATES.length; index += 1) {
    steps.push([SUPPLY_CHAIN_GATES[index - 1], SUPPLY_CHAIN_GATES[index]]);
  }

  return steps.map(([from, to]) => {
    const durations: number[] = [];
    for (const line of lines) {
      const fromDate =
        from === "ordered" ? line.poDate : line.firstAcceptedDateByGate?.[from];
      const toDate = line.firstAcceptedDateByGate?.[to];
      const days = daysBetween(fromDate, toDate);
      // Negative spans mean back-dated paperwork, not negative time; drop them rather than let
      // them pull a median below zero.
      if (days != null && days >= 0) durations.push(days);
    }
    return {
      from,
      to,
      label: `${SUPPLY_GATE_LABELS[from]} → ${SUPPLY_GATE_LABELS[to]}`,
      owner: SUPPLY_GATE_OWNER[to],
      sampleSize: durations.length,
      medianDays: median(durations),
      p90Days: percentile(durations, 90),
      worstDays: durations.length ? Math.max(...durations) : null,
    };
  });
}

/** The step costing the most time, by median. Null until at least one step is measurable. */
export function slowestSupplyStep(cycleTimes: SupplyCycleTime[]): SupplyCycleTime | null {
  const measured = cycleTimes.filter((step) => step.medianDays != null && step.sampleSize > 0);
  if (!measured.length) return null;
  return measured.reduce((worst, step) => (step.medianDays! > worst.medianDays! ? step : worst));
}

/* ── 4. Vendor scorecard ────────────────────────────────────────────────────────────────────── */

export interface SupplyVendorScore {
  vendorId: string;
  vendorName: string;
  lineCount: number;
  orderedValue: number;
  /** Value the client has finally accepted — the only revenue-recognisable figure here. */
  deliveredValue: number;
  /** deliveredValue ÷ orderedValue, as a percentage. */
  deliveredPct: number;
  /** Value bounced at inspection or GRN, as a share of what the vendor presented. */
  rejectionPct: number;
  rejectedValue: number;
  /** Median days from PO to material received at site. */
  medianLeadDays: number | null;
  /** Lines past their PO completion date with nothing received. */
  overdueLineCount: number;
  shortQty: number;
  damagedQty: number;
  blockingObservationCount: number;
}

/**
 * Vendor performance on the three things that actually matter: did they deliver, was it right
 * first time, and how long did it take.
 *
 * Rejection is measured against what the vendor *presented*, not against what was ordered — a
 * vendor who has delivered a tenth of a PO cleanly is not a 90%-rejection vendor, and ranking
 * them as one would be both wrong and unfair.
 */
export function buildSupplyVendorScores(
  lines: SupplyChainLine[],
  today: Date = new Date(),
): SupplyVendorScore[] {
  const byVendor = new Map<string, SupplyChainLine[]>();
  for (const line of lines) {
    const key = line.vendorId || line.vendorName || "—";
    const list = byVendor.get(key) ?? [];
    list.push(line);
    byVendor.set(key, list);
  }

  const scores: SupplyVendorScore[] = [];
  for (const [key, vendorLines] of byVendor) {
    let orderedValue = 0;
    let deliveredValue = 0;
    let rejectedValue = 0;
    let presentedValue = 0;
    let overdueLineCount = 0;
    let shortQty = 0;
    let damagedQty = 0;
    let blockingObservationCount = 0;
    const leadTimes: number[] = [];

    for (const line of vendorLines) {
      const rate = num(line.rate);
      const ordered = Math.max(0, num(line.orderedQty) - num(line.cancelledQty));
      orderedValue += ordered * rate;
      deliveredValue += num(line.acceptedQtyByGate.mvac) * rate;

      for (const gate of ["inspection", "grn"] as const) {
        const rejected = num(line.rejectedQtyByGate?.[gate]) * rate;
        rejectedValue += rejected;
        presentedValue += num(line.acceptedQtyByGate[gate]) * rate + rejected;
      }

      shortQty += num(line.shortQty);
      damagedQty += num(line.damagedQty);
      blockingObservationCount += num(line.blockingObservationCount);

      const lead = daysBetween(line.poDate, line.firstAcceptedDateByGate?.grn);
      if (lead != null && lead >= 0) leadTimes.push(lead);

      const overdueBy = daysSince(line.poEndDate, today);
      if (overdueBy != null && overdueBy > 0 && num(line.acceptedQtyByGate.grn) <= 0) {
        overdueLineCount += 1;
      }
    }

    scores.push({
      vendorId: key,
      vendorName: vendorLines[0]?.vendorName || key,
      lineCount: vendorLines.length,
      orderedValue: round(orderedValue, 2),
      deliveredValue: round(deliveredValue, 2),
      deliveredPct: orderedValue > 0 ? Math.round((deliveredValue / orderedValue) * 100) : 0,
      rejectedValue: round(rejectedValue, 2),
      rejectionPct: presentedValue > 0 ? Math.round((rejectedValue / presentedValue) * 100) : 0,
      medianLeadDays: median(leadTimes),
      overdueLineCount,
      shortQty: round(shortQty),
      damagedQty: round(damagedQty),
      blockingObservationCount,
    });
  }

  // Biggest commitment first — that is the order a procurement head reviews vendors in.
  return scores.sort((a, b) => b.orderedValue - a.orderedValue);
}

/* ── 5. Exceptions ──────────────────────────────────────────────────────────────────────────── */

export type SupplyExceptionSeverity = "critical" | "warning";

export interface SupplyException {
  id: string;
  severity: SupplyExceptionSeverity;
  title: string;
  detail: string;
  lineCount: number;
  value: number;
  gate?: SupplyChainGate;
}

/**
 * The list to work through this morning.
 *
 * Ordered by severity then by value, because two exceptions of equal severity are not equally
 * urgent — the expensive one is. Every entry carries the money behind it for that reason.
 */
export function buildSupplyExceptions(
  lines: SupplyChainLine[],
  options: { today?: Date; stalledDays?: number } = {},
): SupplyException[] {
  const today = options.today ?? new Date();
  const stalledDays = Math.max(1, options.stalledDays ?? 21);
  const exceptions: SupplyException[] = [];

  const add = (exception: SupplyException) => {
    if (exception.lineCount > 0) exceptions.push(exception);
  };

  // Overdue: the PO's own completion date has passed with nothing at site.
  let overdueLines = 0;
  let overdueValue = 0;
  for (const line of lines) {
    const overdueBy = daysSince(line.poEndDate, today);
    if (overdueBy != null && overdueBy > 0 && num(line.acceptedQtyByGate.grn) <= 0) {
      overdueLines += 1;
      overdueValue +=
        Math.max(0, num(line.orderedQty) - num(line.cancelledQty)) * num(line.rate);
    }
  }
  add({
    id: "po-overdue",
    severity: "critical",
    title: "Purchase orders past their completion date",
    detail: "Nothing received at site against these lines, and the PO date has passed.",
    lineCount: overdueLines,
    value: round(overdueValue, 2),
  });

  // Blocking observations: Critical/Major punch items that stop the chain moving.
  const blocking = lines.filter((line) => num(line.blockingObservationCount) > 0);
  add({
    id: "blocking-observations",
    severity: "critical",
    title: "Open critical or major observations",
    detail: "These block clearance and acceptance downstream until they are closed.",
    lineCount: blocking.length,
    value: round(
      blocking.reduce(
        (sum, line) => sum + num(line.acceptedQtyByGate.inspection) * num(line.rate),
        0,
      ),
      2,
    ),
  });

  // Stalled work, per gate: presented and undecided for longer than the threshold.
  for (const gate of SUPPLY_CHAIN_GATES) {
    if (gate === "ordered") continue;
    let count = 0;
    let value = 0;
    let oldest = 0;
    for (const line of lines) {
      const age = daysSince(line.oldestOpenDateByGate?.[gate], today);
      if (age == null || age < stalledDays) continue;
      count += 1;
      value += num(line.inFlightQtyByGate?.[gate]) * num(line.rate);
      if (age > oldest) oldest = age;
    }
    add({
      id: `stalled-${gate}`,
      severity: oldest >= stalledDays * 2 ? "critical" : "warning",
      title: `${SUPPLY_GATE_LABELS[gate]} sitting undecided`,
      detail: `Waiting on ${SUPPLY_GATE_OWNER[gate]} for more than ${stalledDays} days — oldest ${oldest} days.`,
      lineCount: count,
      value: round(value, 2),
      gate,
    });
  }

  // Received with a discrepancy, which someone has to resolve with the vendor.
  const discrepant = lines.filter((line) => num(line.shortQty) > 0 || num(line.damagedQty) > 0);
  add({
    id: "grn-discrepancy",
    severity: "warning",
    title: "Receipts with a shortage or damage",
    detail: "Short or damaged quantity recorded at GRN, still to be settled with the vendor.",
    lineCount: discrepant.length,
    value: round(
      discrepant.reduce(
        (sum, line) => sum + (num(line.shortQty) + num(line.damagedQty)) * num(line.rate),
        0,
      ),
      2,
    ),
  });

  // Accepted by the client but never released for billing — money earned and not invoiced.
  let unbilledLines = 0;
  let unbilledValue = 0;
  for (const line of lines) {
    const accepted = num(line.acceptedQtyByGate.mvac);
    if (accepted > 0 && num(line.blockingObservationCount) === 0) {
      unbilledLines += 1;
      unbilledValue += accepted * num(line.rate);
    }
  }
  add({
    id: "mvac-accepted",
    severity: "warning",
    title: "Client-accepted and ready to bill",
    detail: "Material the client has signed for — confirm it has reached the billing hand-off.",
    lineCount: unbilledLines,
    value: round(unbilledValue, 2),
  });

  const order: Record<SupplyExceptionSeverity, number> = { critical: 0, warning: 1 };
  return exceptions.sort(
    (a, b) => order[a.severity] - order[b.severity] || b.value - a.value,
  );
}

/* ── 6. Headline ────────────────────────────────────────────────────────────────────────────── */

export interface SupplyHeadline {
  lineCount: number;
  vendorCount: number;
  orderedValue: number;
  /** Value the client has accepted — delivered, in the only sense that counts. */
  deliveredValue: number;
  deliveredPct: number;
  /** Ordered but not yet client-accepted: the whole open book. */
  openValue: number;
  /** Of the open book, what is presented and sitting with somebody right now. */
  inFlightValue: number;
  /** Value bounced back for rework anywhere in the chain. */
  reworkValue: number;
  /** Median PO → site days, across lines that got there. */
  medianLeadDays: number | null;
}

export function buildSupplyHeadline(lines: SupplyChainLine[]): SupplyHeadline {
  let orderedValue = 0;
  let deliveredValue = 0;
  let inFlightValue = 0;
  let reworkValue = 0;
  const vendors = new Set<string>();
  const leadTimes: number[] = [];

  for (const line of lines) {
    const rate = num(line.rate);
    orderedValue += Math.max(0, num(line.orderedQty) - num(line.cancelledQty)) * rate;
    deliveredValue += num(line.acceptedQtyByGate.mvac) * rate;
    vendors.add(line.vendorId || line.vendorName || "—");

    for (const gate of SUPPLY_CHAIN_GATES) {
      if (gate === "ordered") continue;
      inFlightValue += num(line.inFlightQtyByGate?.[gate]) * rate;
      reworkValue += num(line.rejectedQtyByGate?.[gate]) * rate;
    }

    const lead = daysBetween(line.poDate, line.firstAcceptedDateByGate?.grn);
    if (lead != null && lead >= 0) leadTimes.push(lead);
  }

  return {
    lineCount: lines.length,
    vendorCount: vendors.size,
    orderedValue: round(orderedValue, 2),
    deliveredValue: round(deliveredValue, 2),
    deliveredPct: orderedValue > 0 ? Math.round((deliveredValue / orderedValue) * 100) : 0,
    openValue: round(Math.max(0, orderedValue - deliveredValue), 2),
    inFlightValue: round(inFlightValue, 2),
    reworkValue: round(reworkValue, 2),
    medianLeadDays: median(leadTimes),
  };
}

/* ── CSV ────────────────────────────────────────────────────────────────────────────────────── */

/** Excel reads a leading =, +, - or @ as a formula, so those cells are prefixed with a quote. */
const csvCell = (value: unknown): string => {
  const text = String(value ?? "");
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export const toCsv = (headers: string[], rows: Array<Array<unknown>>): string =>
  [headers.map(csvCell).join(","), ...rows.map((row) => row.map(csvCell).join(","))].join("\n");

/** The line-level export: every PO line with what each gate has done to it. */
export function supplyLinesCsv(lines: SupplyChainLine[]): string {
  const headers = [
    "PO Number",
    "BOQ SL No",
    "Description",
    "Unit",
    "Vendor",
    "Rate",
    "Ordered Qty",
    "Ordered Value",
    ...SUPPLY_CHAIN_GATES.filter((gate) => gate !== "ordered").map(
      (gate) => `${SUPPLY_GATE_LABELS[gate]} Qty`,
    ),
    "Short Qty",
    "Damaged Qty",
    "Open Blocking Observations",
    "PO Date",
    "PO End Date",
  ];
  const rows = lines.map((line) => [
    line.poNumber,
    line.boqSlNo ?? "",
    line.itemDescription,
    line.unit,
    line.vendorName ?? "",
    num(line.rate),
    round(Math.max(0, num(line.orderedQty) - num(line.cancelledQty))),
    round(Math.max(0, num(line.orderedQty) - num(line.cancelledQty)) * num(line.rate), 2),
    ...SUPPLY_CHAIN_GATES.filter((gate) => gate !== "ordered").map((gate) =>
      round(num(line.acceptedQtyByGate[gate])),
    ),
    round(num(line.shortQty)),
    round(num(line.damagedQty)),
    num(line.blockingObservationCount),
    line.poDate ?? "",
    line.poEndDate ?? "",
  ]);
  return toCsv(headers, rows);
}

/** Maps a supply-ledger stage onto its chain gate, for callers flattening the workspaces. */
export const gateOfLedgerStage = (stage: SupplyLedgerStage): SupplyChainGate => stage;

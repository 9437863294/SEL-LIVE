/**
 * JMC — the dashboard's readings.
 *
 * Every figure here is derived from the same register the JMC log reads, with the same arithmetic:
 * a line's value is its stored `totalAmount` when it has one and `qty × rate` when it does not, and
 * certified value counts the certified quantity only. The log computed that inline; the dashboard
 * must not arrive at a different total for the same certificates, so it lives here once and both
 * read it.
 *
 * Where a certificate "is" comes from its own history, not from a status field: a step is done when
 * the history holds an approving action naming it, and the certificate sits at the first step that
 * has none. That is the rule the log's stage-date columns already use.
 *
 * Pure — no Firebase, no React — so it is tested with `node --experimental-strip-types --test`.
 */

import { approvedStepNames, workflowRunPosition } from "./workflow-run-position.ts";

/** The actions that complete a workflow step. Matches the JMC log's own list. */
export const JMC_APPROVE_ACTIONS: readonly string[] = ["Approve", "Complete", "Verified"];

export interface JmcValueItem {
  rate?: unknown;
  certifiedQty?: unknown;
  executedQty?: unknown;
  totalAmount?: unknown;
}

export interface JmcHistoryAction {
  stepName?: unknown;
  action?: unknown;
  timestamp?: unknown;
}

export interface JmcRegisterEntry {
  id: string;
  jmcNo?: unknown;
  jmcDate?: unknown;
  createdAt?: unknown;
  items?: readonly JmcValueItem[];
  history?: readonly JmcHistoryAction[];
}

export interface JmcWorkflowStepLike {
  id: string;
  name: string;
}

const num = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * A date out of Firestore, a form, or an export.
 *
 * The register holds all three shapes — a Timestamp-like `{seconds}`, an ISO string and a Date —
 * because entries have been written by different screens over time.
 */
export function jmcDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") {
    const fromNumber = new Date(value);
    return Number.isNaN(fromNumber.getTime()) ? null : fromNumber;
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const seconds = (value as { seconds?: unknown }).seconds;
  if (typeof seconds === "number") {
    const fromSeconds = new Date(seconds * 1000);
    return Number.isNaN(fromSeconds.getTime()) ? null : fromSeconds;
  }
  return null;
}

/** The date a certificate counts as raised on: its own JMC date, else when it was created. */
export const jmcRaisedOn = (entry: JmcRegisterEntry): Date | null =>
  jmcDate(entry.jmcDate) ?? jmcDate(entry.createdAt);

/**
 * A certificate's value, and the part of it that has been certified.
 *
 * `totalAmount` wins when the line carries one — it is what the entry screen stored and what the
 * printed certificate shows. Without it the line is valued at its certified quantity, falling back
 * to the executed quantity, times its rate. Certified value never falls back: an executed quantity
 * nobody has certified is worth nothing yet.
 */
export function jmcTotals(items: readonly JmcValueItem[] = []): {
  total: number;
  certified: number;
} {
  let total = 0;
  let certified = 0;
  for (const item of items) {
    const rate = num(item?.rate);
    const explicit = item?.totalAmount;
    const hasExplicit = explicit !== undefined && explicit !== null && explicit !== "";
    total += hasExplicit
      ? num(explicit)
      : num(item?.certifiedQty ?? item?.executedQty) * rate;
    certified += num(item?.certifiedQty) * rate;
  }
  return { total, certified };
}

/**
 * The step names a certificate's history has an approving action for.
 *
 * The rule itself now lives in `workflow-run-position.ts`, because MVAC's certificates travel a
 * configured run of the same shape and the two must not drift apart. These names stay so the JMC
 * screens and their tests keep reading it as they always have.
 */
export const jmcApprovedSteps = (history: readonly JmcHistoryAction[] = []): Set<string> =>
  approvedStepNames(history, JMC_APPROVE_ACTIONS);

/**
 * How far through the run a certificate is: the index of the first step it has not completed, or
 * `steps.length` once every step is done.
 *
 * Steps are checked in order rather than counted, so a certificate that skipped a step — possible
 * when the workflow was reconfigured after it was raised — reports the earliest gap rather than
 * claiming the progress of the latest action on it.
 */
export const jmcStageIndex = (
  entry: JmcRegisterEntry,
  steps: readonly JmcWorkflowStepLike[],
): number => workflowRunPosition(entry.history ?? [], steps, JMC_APPROVE_ACTIONS);

export interface JmcStageReading {
  id: string;
  name: string;
  /** Certificates sitting at this step, waiting for it to be actioned. */
  waiting: number;
  /** Certificates that have completed this step, whether or not they went further. */
  cleared: number;
  /** Σ value of the certificates waiting here. */
  waitingValue: number;
}

export interface JmcMonthReading {
  /** `YYYY-MM`, so the series sorts without parsing the label. */
  key: string;
  label: string;
  raised: number;
  certifiedValue: number;
}

export interface JmcDashboardReading {
  count: number;
  /** Certificates that have cleared every configured step. */
  completed: number;
  /** Raised but not yet through the run. */
  inProgress: number;
  totalValue: number;
  certifiedValue: number;
  stages: JmcStageReading[];
  months: JmcMonthReading[];
  /** Days the longest-waiting unfinished certificate has been open; null when none are. */
  oldestWaitingDays: number | null;
}

export interface JmcQuantityCheck {
  /** The BOQ quantity still uncertified before this certificate. */
  balance: number;
  /** How far past the balance this entry goes; 0 when it is within it. */
  excess: number;
  over: boolean;
  /** The BOQ line records no quantity, so there is nothing to measure against. */
  unchecked: boolean;
}

/**
 * Whether an executed quantity fits what is left of its BOQ line.
 *
 * A JMC measures work against a contract line, and the line can only ever be certified up to its
 * own quantity — what previous certificates already took is gone. The entry screen had no such
 * check, so a line could be over-measured and only caught downstream, after certification.
 *
 * A line with no recorded BOQ quantity is reported as `unchecked` rather than as over or within:
 * a provisional or lot line genuinely has nothing to measure against, and claiming otherwise in
 * either direction would be a guess.
 */
export function jmcQuantityCheck({
  executedQty,
  boqQty,
  totalCertifiedQty,
}: {
  executedQty: unknown;
  boqQty: unknown;
  totalCertifiedQty: unknown;
}): JmcQuantityCheck {
  const boq = num(boqQty);
  if (boq <= 0) return { balance: 0, excess: 0, over: false, unchecked: true };

  const balance = Math.max(0, boq - num(totalCertifiedQty));
  const excess = Math.max(0, num(executedQty) - balance);
  return { balance, excess, over: excess > 0, unchecked: false };
}

/**
 * "₹48,000", "₹18.40 L", "₹3.20 Cr" — lakh and crore, the way these amounts are spoken here.
 *
 * Written out rather than imported from `work-dashboard.ts`, which has the same formatter: that
 * module is large and unrelated, and importing it would pull all of it into the JMC bundle.
 */
export function formatJmcAmount(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  const sign = safe < 0 ? "-" : "";
  const abs = Math.abs(safe);
  if (abs >= 1_00_00_000) return `${sign}₹${(abs / 1_00_00_000).toFixed(2)} Cr`;
  if (abs >= 1_00_000) return `${sign}₹${(abs / 1_00_000).toFixed(2)} L`;
  return `${sign}₹${Math.round(abs).toLocaleString("en-IN")}`;
}

const monthKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Everything the dashboard shows, read off the register in one pass.
 *
 * `now` is a parameter rather than `new Date()` so the month series and the waiting ages are
 * reproducible in a test.
 */
export function summariseJmcRegister({
  entries,
  steps,
  now,
  months = 6,
}: {
  entries: readonly JmcRegisterEntry[];
  steps: readonly JmcWorkflowStepLike[];
  now: Date;
  months?: number;
}): JmcDashboardReading {
  const stages: JmcStageReading[] = steps.map((step) => ({
    id: String(step.id),
    name: step.name,
    waiting: 0,
    cleared: 0,
    waitingValue: 0,
  }));

  // The months to report, oldest first, built from `now` so a month with no certificates still
  // appears as a gap in the series rather than vanishing from it.
  const monthSlots: JmcMonthReading[] = [];
  for (let back = months - 1; back >= 0; back -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - back, 1);
    monthSlots.push({
      key: monthKey(date),
      label: MONTH_LABELS[date.getMonth()] ?? "",
      raised: 0,
      certifiedValue: 0,
    });
  }
  const monthsByKey = new Map(monthSlots.map((slot) => [slot.key, slot]));

  let completed = 0;
  let totalValue = 0;
  let certifiedValue = 0;
  let oldestWaitingDays: number | null = null;

  for (const entry of entries) {
    const { total, certified } = jmcTotals(entry.items ?? []);
    totalValue += total;
    certifiedValue += certified;

    const index = jmcStageIndex(entry, steps);
    const isComplete = steps.length > 0 && index >= steps.length;
    if (isComplete) completed += 1;

    for (let cleared = 0; cleared < index && cleared < stages.length; cleared += 1) {
      stages[cleared]!.cleared += 1;
    }
    if (!isComplete && index < stages.length) {
      stages[index]!.waiting += 1;
      stages[index]!.waitingValue += total;
    }

    const raised = jmcRaisedOn(entry);
    if (raised) {
      const slot = monthsByKey.get(monthKey(raised));
      if (slot) {
        slot.raised += 1;
        slot.certifiedValue += certified;
      }
      if (!isComplete) {
        const age = Math.floor((now.getTime() - raised.getTime()) / DAY_MS);
        if (age >= 0 && (oldestWaitingDays === null || age > oldestWaitingDays)) {
          oldestWaitingDays = age;
        }
      }
    }
  }

  return {
    count: entries.length,
    completed,
    inProgress: entries.length - completed,
    totalValue,
    certifiedValue,
    stages,
    months: monthSlots,
    oldestWaitingDays,
  };
}

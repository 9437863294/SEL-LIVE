/**
 * MVAC — the module's readings, and what may be put on a certificate.
 *
 * MVAC is the joint acceptance of material already received at site, so two rules decide what the
 * module shows:
 *
 *   1. **What can go on a certificate** is whatever a GRN has accepted and no MVAC has taken yet.
 *      The certificate is therefore built from *items* — one row per purchase-order line, pooling
 *      every GRN that delivered against it — and not from a vendor's order book. A joint walk-down
 *      looks at what is lying on site, which is rarely one vendor's material.
 *
 *   2. **Where a certificate is** comes from its workflow history, by the same rule JMC uses
 *      (`workflow-run-position.ts`): a step is done when the history holds an approving action
 *      naming it, and the certificate sits at the first step that has none.
 *
 * Quantity is the unit throughout. An MVAC says how much was jointly accepted, not what it is
 * worth — the value of that quantity belongs to billing, downstream of here.
 *
 * Pure — no Firebase, no React — so every rule is tested with `node --experimental-strip-types
 * --test`.
 */

import { supplyPoLineKey } from "./project-management-supply-ledger.ts";
import {
  workflowRunPosition,
  type WorkflowHistoryAction,
  type WorkflowStepLike,
} from "./workflow-run-position.ts";

/* ── Records, as loosely as they are actually stored ────────────────────────────────────────── */

export interface MvacDocLike {
  id: string;
  docNumber?: unknown;
  docDate?: unknown;
  decidedDate?: unknown;
  /** The supply-document status: Draft, Open, Partially Completed, Completed, Cancelled. */
  status?: unknown;
  vendorName?: unknown;
  createdAt?: unknown;
  /** The configured run, where one is in use. */
  history?: readonly WorkflowHistoryAction[];
  workflowStage?: unknown;
  workflowStepId?: unknown;
  /** The run's own verdict: In Progress, Completed, Rejected. */
  workflowStatus?: unknown;
  assignees?: readonly unknown[];
  deadline?: unknown;
}

export interface MvacItemLike {
  docId?: unknown;
  poId?: unknown;
  poLineId?: unknown;
  presentedQty?: unknown;
  acceptedQty?: unknown;
  status?: unknown;
}

/** A GRN line, as the picker reads it to say where material came from. */
export interface MvacGrnItemLike {
  docId?: unknown;
  poId?: unknown;
  poLineId?: unknown;
  acceptedQty?: unknown;
}

export interface MvacGrnDocLike {
  id: string;
  docNumber?: unknown;
  docDate?: unknown;
  decidedDate?: unknown;
  status?: unknown;
}

/** One GRN that delivered against a purchase-order line. */
export interface MvacGrnSource {
  grnNumber: string;
  /** When it was accepted at site, falling back to the GRN's own date. */
  date: string;
  qty: number;
}

/** A line the picker offers: one purchase-order item, with every GRN behind it. */
export interface MvacCandidateLine {
  key: string;
  poId: string;
  poLineId: string;
  poNumber: string;
  boqItemId?: string;
  itemDescription: string;
  unit: string;
  vendorName: string;
  /** Accepted at GRN — the ceiling this line can ever reach. */
  receivedQty: number;
  /** Already on MVAC certificates that are open or signed. */
  usedQty: number;
  /** What a new certificate may present. */
  availableQty: number;
  grns: MvacGrnSource[];
}

/* ── Small helpers ──────────────────────────────────────────────────────────────────────────── */

const num = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

const text = (value: unknown): string => String(value ?? "").trim();

/**
 * A date out of Firestore, a form, or an export: a Timestamp-like `{seconds}`, an ISO string, a
 * number of milliseconds, or a Date. The register holds all four, written by different screens
 * over the years.
 */
export function mvacDate(value: unknown): Date | null {
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

/** The date a certificate counts as raised on: its own document date, else when it was created. */
export const mvacRaisedOn = (doc: MvacDocLike): Date | null =>
  mvacDate(doc.docDate) ?? mvacDate(doc.createdAt);

/** A draft holds no quantity and has not entered the run; a cancelled one has left it. */
export const isMvacLive = (doc: MvacDocLike): boolean => {
  const status = text(doc.status);
  return status !== "Draft" && status !== "Cancelled";
};

/**
 * Where a certificate sits in the configured run.
 *
 * With no workflow configured every certificate reads as `0`, which the screens show as "not in a
 * run" rather than "waiting at step one" — an installation that has not configured MVAC steps is
 * not a backlog.
 */
export const mvacStagePosition = (
  doc: MvacDocLike,
  steps: readonly WorkflowStepLike[],
): number => workflowRunPosition(doc.history ?? [], steps);

/** What a certificate presented and what was accepted on it. */
export function mvacDocTotals(items: readonly MvacItemLike[] = []): {
  presented: number;
  accepted: number;
  rejected: number;
  lines: number;
} {
  let presented = 0;
  let accepted = 0;
  let lines = 0;
  for (const item of items) {
    presented += num(item?.presentedQty);
    accepted += num(item?.acceptedQty);
    lines += 1;
  }
  // What was presented and not accepted goes back to the pool; it is never negative, however the
  // two figures were recorded.
  return { presented, accepted, rejected: Math.max(0, presented - accepted), lines };
}

/* ── What the picker offers ─────────────────────────────────────────────────────────────────── */

/**
 * Every GRN that delivered against each purchase-order line, newest first.
 *
 * Cancelled GRNs are left out — material on a cancelled receipt was never accepted at site, so
 * quoting it beside an MVAC line would claim a delivery that did not happen.
 */
export function mvacGrnSourcesByLine(
  grnItems: readonly MvacGrnItemLike[] = [],
  grnDocs: readonly MvacGrnDocLike[] = [],
): Map<string, MvacGrnSource[]> {
  const docsById = new Map(grnDocs.map((entry) => [entry.id, entry]));
  const out = new Map<string, MvacGrnSource[]>();

  for (const item of grnItems) {
    const qty = num(item?.acceptedQty);
    if (qty <= 0) continue;
    const doc = docsById.get(text(item?.docId));
    if (!doc || text(doc.status) === "Cancelled") continue;

    const key = supplyPoLineKey(text(item?.poId), text(item?.poLineId));
    const source: MvacGrnSource = {
      grnNumber: text(doc.docNumber) || "—",
      date: text(doc.decidedDate) || text(doc.docDate),
      qty,
    };
    const list = out.get(key);
    if (list) list.push(source);
    else out.set(key, [source]);
  }

  for (const list of out.values()) {
    list.sort((a, b) => b.date.localeCompare(a.date) || a.grnNumber.localeCompare(b.grnNumber));
  }
  return out;
}

/** A purchase-order line as the ledger reports it, reduced to what the picker needs. */
export interface MvacLedgerLike {
  poId: string;
  poLineId: string;
  poNumber: string;
  itemDescription: string;
  unit: string;
  /** Accepted upstream — for MVAC, the GRN-accepted quantity. */
  upstreamQty: number;
  /** Presented on open certificates. */
  inFlightQty: number;
  acceptedQty: number;
  availableQty: number;
}

/**
 * The lines a new certificate may draw on — one per purchase-order item, across every vendor.
 *
 * This is the shape the module changed to: MVAC used to be raised against one vendor's order book,
 * which does not describe a joint walk-down of what is lying on site. A line appears here because
 * a GRN accepted some of it, whoever supplied it.
 *
 * Lines with nothing left are dropped rather than shown greyed out: the list is long, and a line
 * whose material is already covered by a certificate is not a choice the person is making.
 */
export function buildMvacCandidates({
  ledgers,
  grnSources,
  vendorByPoId,
  boqItemIdByLineKey,
  alwaysInclude,
}: {
  ledgers: readonly MvacLedgerLike[];
  grnSources: ReadonlyMap<string, readonly MvacGrnSource[]>;
  vendorByPoId: ReadonlyMap<string, { vendorName?: string }>;
  boqItemIdByLineKey?: ReadonlyMap<string, string | undefined>;
  /**
   * Line keys to offer whatever their balance — the lines a draft being edited already holds.
   *
   * Without this, a draft line whose balance was taken by another document between saving and
   * reopening would simply vanish from the form, and the person would have no way to see it, let
   * alone remove it. It is shown with its real (possibly nil) balance, so saving still refuses it.
   */
  alwaysInclude?: ReadonlySet<string>;
}): MvacCandidateLine[] {
  const out: MvacCandidateLine[] = [];

  for (const ledger of ledgers) {
    const key = supplyPoLineKey(ledger.poId, ledger.poLineId);
    const available = num(ledger.availableQty);
    const received = num(ledger.upstreamQty);
    const kept = alwaysInclude?.has(key) ?? false;
    if (!kept && (available <= 0 || received <= 0)) continue;

    out.push({
      key,
      poId: ledger.poId,
      poLineId: ledger.poLineId,
      poNumber: ledger.poNumber,
      boqItemId: boqItemIdByLineKey?.get(key),
      itemDescription: ledger.itemDescription,
      unit: ledger.unit,
      vendorName: vendorByPoId.get(ledger.poId)?.vendorName || "Unknown vendor",
      receivedQty: received,
      usedQty: num(ledger.inFlightQty) + num(ledger.acceptedQty),
      availableQty: available,
      grns: [...(grnSources.get(key) ?? [])],
    });
  }

  return out.sort(
    (a, b) =>
      a.itemDescription.localeCompare(b.itemDescription) || a.poNumber.localeCompare(b.poNumber),
  );
}

/**
 * Narrows the candidate list by free text.
 *
 * Searches the item, the purchase order, the vendor and the GRN numbers, because all four are ways
 * a person names the thing they are looking for — "the cable", "PO/24/118", "Havells", "GRN-0042".
 */
export function filterMvacCandidates(
  rows: readonly MvacCandidateLine[],
  query: string,
): MvacCandidateLine[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...rows];
  return rows.filter((row) =>
    `${row.itemDescription} ${row.poNumber} ${row.vendorName} ${row.grns
      .map((grn) => grn.grnNumber)
      .join(" ")}`
      .toLowerCase()
      .includes(needle),
  );
}

/* ── The dashboard's reading ────────────────────────────────────────────────────────────────── */

export interface MvacStageReading {
  id: string;
  name: string;
  /** Certificates sitting at this step, waiting for it to be actioned. */
  waiting: number;
  /** Certificates that have completed this step, whether or not they went further. */
  cleared: number;
  /** Σ presented quantity of the certificates waiting here. */
  waitingQty: number;
}

export interface MvacMonthReading {
  /** `YYYY-MM`, so the series sorts without parsing the label. */
  key: string;
  label: string;
  raised: number;
  acceptedQty: number;
}

export interface MvacDashboardReading {
  /** Certificates that hold quantity: everything but drafts and cancellations. */
  count: number;
  drafts: number;
  cancelled: number;
  /** Raised but not through the configured run. */
  inWorkflow: number;
  /** Through every configured step, or signed off where no run is configured. */
  completed: number;
  lines: number;
  presentedQty: number;
  acceptedQty: number;
  rejectedQty: number;
  /** Distinct vendors whose material is on a live certificate. */
  vendors: number;
  stages: MvacStageReading[];
  months: MvacMonthReading[];
  /** Days the longest-waiting unfinished certificate has been open; null when none are. */
  oldestWaitingDays: number | null;
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
export function summariseMvacRegister({
  docs,
  items,
  steps,
  now,
  months = 6,
}: {
  docs: readonly MvacDocLike[];
  items: readonly MvacItemLike[];
  steps: readonly WorkflowStepLike[];
  now: Date;
  months?: number;
}): MvacDashboardReading {
  const stages: MvacStageReading[] = steps.map((step) => ({
    id: String(step.id),
    name: step.name,
    waiting: 0,
    cleared: 0,
    waitingQty: 0,
  }));

  // The months to report, oldest first, built from `now` so a month with no certificates still
  // appears as a gap in the series rather than vanishing from it.
  const monthSlots: MvacMonthReading[] = [];
  const monthByKey = new Map<string, MvacMonthReading>();
  for (let back = months - 1; back >= 0; back -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const slot: MvacMonthReading = {
      key: monthKey(date),
      label: `${MONTH_LABELS[date.getMonth()]} ${String(date.getFullYear()).slice(2)}`,
      raised: 0,
      acceptedQty: 0,
    };
    monthSlots.push(slot);
    monthByKey.set(slot.key, slot);
  }

  const itemsByDoc = new Map<string, MvacItemLike[]>();
  for (const item of items) {
    const docId = text(item?.docId);
    if (!docId) continue;
    const list = itemsByDoc.get(docId);
    if (list) list.push(item);
    else itemsByDoc.set(docId, [item]);
  }

  const reading: MvacDashboardReading = {
    count: 0,
    drafts: 0,
    cancelled: 0,
    inWorkflow: 0,
    completed: 0,
    lines: 0,
    presentedQty: 0,
    acceptedQty: 0,
    rejectedQty: 0,
    vendors: 0,
    stages,
    months: monthSlots,
    oldestWaitingDays: null,
  };

  const vendors = new Set<string>();
  let oldestWaiting: number | null = null;

  for (const doc of docs) {
    const status = text(doc.status);
    if (status === "Draft") {
      reading.drafts += 1;
      continue;
    }
    if (status === "Cancelled") {
      reading.cancelled += 1;
      continue;
    }

    reading.count += 1;
    const totals = mvacDocTotals(itemsByDoc.get(doc.id) ?? []);
    reading.lines += totals.lines;
    reading.presentedQty += totals.presented;
    reading.acceptedQty += totals.accepted;
    reading.rejectedQty += totals.rejected;

    const vendor = text(doc.vendorName);
    if (vendor) vendors.add(vendor);

    const position = mvacStagePosition(doc, steps);
    for (let index = 0; index < position && index < stages.length; index += 1) {
      stages[index].cleared += 1;
    }

    const through = steps.length > 0 ? position >= steps.length : status === "Completed";
    if (through) {
      reading.completed += 1;
    } else {
      reading.inWorkflow += 1;
      if (steps.length > 0 && position < stages.length) {
        stages[position].waiting += 1;
        stages[position].waitingQty += totals.presented;
      }
      const raised = mvacRaisedOn(doc);
      if (raised) {
        const days = Math.max(0, Math.floor((now.getTime() - raised.getTime()) / DAY_MS));
        oldestWaiting = oldestWaiting === null ? days : Math.max(oldestWaiting, days);
      }
    }

    const raised = mvacRaisedOn(doc);
    if (raised) {
      const slot = monthByKey.get(monthKey(raised));
      if (slot) {
        slot.raised += 1;
        slot.acceptedQty += totals.accepted;
      }
    }
  }

  reading.vendors = vendors.size;
  reading.oldestWaitingDays = oldestWaiting;
  return reading;
}

/** "1,240", "1,240.5" — quantities as this module quotes them, never in lakh or crore. */
export function formatMvacQty(value: number, unit?: string): string {
  const safe = Number.isFinite(value) ? value : 0;
  const text = safe.toLocaleString("en-IN", { maximumFractionDigits: 3 });
  return unit ? `${text} ${unit}` : text;
}

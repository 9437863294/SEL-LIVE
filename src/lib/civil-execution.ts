/**
 * Civil execution join — brings the civil/erection side of Billing Recon and Subcontractors
 * Management into Project Management's civil lane.
 *
 * Those two modules already run the civil commercial chain end-to-end: subcontractor work orders
 * (`workOrders`), joint measurement entries (`jmcEntries` / `mvacEntries`), and subcontractor
 * bills (`bills`) — all project-scoped collections under `projects/{globalProjectId}/...`, written
 * by their own entry screens and workflow engines. Project Management READS these registers and
 * never writes them: the civil lane here is a control view over data those modules own, exactly
 * as the BOQ costing page already does for its "JMC/MVAC" columns.
 *
 * Two keying conventions coexist and must never be mixed (see the costing page):
 *   - Work order items and bill items carry a real `boqItemId` → join by document id.
 *   - JMC/MVAC measurement items carry no boqItemId; they are joined by the composite key
 *     (Scope 1, Scope 2, BOQ SL No) — scopes trimmed + lowercased, SL No trimmed only. Scope
 *     fields on measurement items are stored with inconsistent key spellings ("Scope 1",
 *     "scope1", "Scope.1"), so they are read with the same tolerant lookup the costing page uses.
 *
 * Unlike the costing page's original aggregation, Rejected and Cancelled entries are EXCLUDED
 * here — a rejected measurement or cancelled work order is not executed quantity, the same rule
 * the indent and PO aggregations already apply.
 *
 * Pure (no Firebase, no React) so it is unit-testable with `node --test`.
 */

export const WORK_ORDER_COLLECTION = "workOrders";
export const JMC_ENTRY_COLLECTION = "jmcEntries";
export const MVAC_ENTRY_COLLECTION = "mvacEntries";
export const SUBCONTRACTOR_BILL_COLLECTION = "bills";

/** Statuses under which a record does not represent real quantity. */
const VOID_STATUSES = new Set(["Rejected", "Cancelled"]);

/* ---------------------------------------------------------------------------------------------
 * Keying
 * ------------------------------------------------------------------------------------------- */

/**
 * The measurement join key, byte-for-byte the same construction as the BOQ costing page's
 * compositeKey(): scopes lowercased, SL No case preserved, double-underscore separator. Legacy
 * scope-less measurement items degrade to "____<slNo>" on both sides and still match.
 */
export const civilBoqKey = (scope1: unknown, scope2: unknown, slNo: unknown): string =>
  `${String(scope1 ?? "").trim().toLowerCase()}__${String(scope2 ?? "").trim().toLowerCase()}__${String(slNo ?? "").trim()}`;

/** Tolerant scope lookup: matches any key whose lowercase form with whitespace and dots stripped
 * equals "scope1"/"scope2" — measurement items store these with inconsistent spellings. */
export function readLooseScope(item: Record<string, unknown> | null | undefined, which: 1 | 2): string {
  if (!item) return "";
  const needle = `scope${which}`;
  const key = Object.keys(item).find(
    (candidate) => candidate.toLowerCase().replace(/\s+|\./g, "") === needle,
  );
  const value = key ? item[key] : undefined;
  return typeof value === "string" ? value.trim() : "";
}

/** BOQ SL No lookup. The exact spellings cover measurement items (camelCase `boqSlNo`) and the
 * common BOQ headers; the tolerant fallback covers imports whose Excel headers differed in case
 * or dots ("BOQ SL NO", "Sl.No") — reader keys are matched lowercased with whitespace/dots
 * stripped, the same normalization every Billing Recon reader applies. */
export function readBoqSlNo(item: Record<string, unknown> | null | undefined): string {
  if (!item) return "";
  const direct = item["BOQ SL No"] ?? item["SL. No."] ?? item.boqSlNo;
  if (direct != null && String(direct).trim()) return String(direct).trim();
  const key = Object.keys(item).find((candidate) => {
    const normalized = candidate.toLowerCase().replace(/\s+|\./g, "");
    return normalized === "boqslno" || normalized === "slno" || normalized === "sl";
  });
  return key ? String(item[key] ?? "").trim() : "";
}

/** The composite key for a BOQ item document (spreadsheet-header field names). */
export const civilBoqKeyOfBoqItem = (item: Record<string, unknown>): string =>
  civilBoqKey(readLooseScope(item, 1), readLooseScope(item, 2), readBoqSlNo(item));

/* ---------------------------------------------------------------------------------------------
 * Structural input shapes — declared here rather than imported from src/lib/types.ts so this
 * module stays free of Firebase types and node-testable. Only the fields the join reads.
 * ------------------------------------------------------------------------------------------- */

export interface MeasurementItemLike {
  boqSlNo?: unknown;
  executedQty?: unknown;
  certifiedQty?: unknown;
  rate?: unknown;
  [key: string]: unknown;
}

/** A JMC or MVAC entry — the two share one shape apart from the number/date field names. */
export interface MeasurementEntryLike {
  jmcNo?: unknown;
  mvacNo?: unknown;
  jmcDate?: unknown;
  mvacDate?: unknown;
  status?: unknown;
  items?: unknown;
}

export interface WorkOrderLike {
  workOrderNo?: unknown;
  subcontractorName?: unknown;
  date?: unknown;
  status?: unknown;
  items?: unknown;
}

export interface SubcontractorBillLike {
  billNo?: unknown;
  billDate?: unknown;
  status?: unknown;
  totalAmount?: unknown;
  isRetentionBill?: unknown;
  items?: unknown;
}

/* ---------------------------------------------------------------------------------------------
 * Aggregates
 * ------------------------------------------------------------------------------------------- */

const toNumber = (value: unknown): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

const toDateString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1];
};

const itemsOf = (parent: { items?: unknown }): Record<string, unknown>[] =>
  Array.isArray(parent.items) ? (parent.items as Record<string, unknown>[]) : [];

export interface CivilMeasurementAggregate {
  executedQty: number;
  certifiedQty: number;
  /** Σ rate × executedQty at the measurement's own recorded rate. */
  executedValue: number;
  /** Σ rate × certifiedQty at the measurement's own recorded rate. */
  certifiedValue: number;
  entryCount: number;
  latestNo?: string;
  latestDate?: string;
}

/**
 * Sums JMC/MVAC measurement quantities per BOQ composite key. Pass both registers' entries
 * together when the combined "JMC/MVAC" view is wanted (matching the costing page columns), or
 * one register alone. Rejected/Cancelled entries are excluded.
 */
export function aggregateMeasurementsByBoqKey(
  entries: MeasurementEntryLike[],
): Map<string, CivilMeasurementAggregate> {
  const aggregates = new Map<string, CivilMeasurementAggregate>();
  for (const entry of entries) {
    if (VOID_STATUSES.has(String(entry.status ?? ""))) continue;
    const reference = String(entry.jmcNo ?? entry.mvacNo ?? "").trim() || undefined;
    const date = toDateString(entry.jmcDate ?? entry.mvacDate);
    for (const item of itemsOf(entry)) {
      const key = civilBoqKey(readLooseScope(item, 1), readLooseScope(item, 2), readBoqSlNo(item));
      const executedQty = toNumber(item.executedQty);
      const certifiedQty = toNumber(item.certifiedQty);
      const rate = toNumber(item.rate);
      const aggregate =
        aggregates.get(key) ??
        ({
          executedQty: 0,
          certifiedQty: 0,
          executedValue: 0,
          certifiedValue: 0,
          entryCount: 0,
        } as CivilMeasurementAggregate);
      aggregate.executedQty += executedQty;
      aggregate.certifiedQty += certifiedQty;
      aggregate.executedValue += rate * executedQty;
      aggregate.certifiedValue += rate * certifiedQty;
      aggregate.entryCount += 1;
      // Entries are read in collection order; "latest" is simply the highest date seen so the
      // result is stable regardless of read order.
      if (date && (!aggregate.latestDate || date > aggregate.latestDate)) {
        aggregate.latestDate = date;
        aggregate.latestNo = reference;
      } else if (!aggregate.latestNo && reference) {
        aggregate.latestNo = reference;
      }
      aggregates.set(key, aggregate);
    }
  }
  return aggregates;
}

export interface CivilWorkOrderAggregate {
  orderedQty: number;
  amount: number;
  workOrderNos: string[];
  subcontractorNames: string[];
  latestDate?: string;
}

/** Sums non-cancelled work-order commitments per boqItemId. */
export function aggregateWorkOrdersByBoqItem(
  workOrders: WorkOrderLike[],
): Map<string, CivilWorkOrderAggregate> {
  const aggregates = new Map<string, CivilWorkOrderAggregate>();
  for (const workOrder of workOrders) {
    if (VOID_STATUSES.has(String(workOrder.status ?? ""))) continue;
    const workOrderNo = String(workOrder.workOrderNo ?? "").trim();
    const subcontractorName = String(workOrder.subcontractorName ?? "").trim();
    const date = toDateString(workOrder.date);
    for (const item of itemsOf(workOrder)) {
      const boqItemId = String(item.boqItemId ?? "").trim();
      if (!boqItemId) continue;
      const aggregate =
        aggregates.get(boqItemId) ??
        ({ orderedQty: 0, amount: 0, workOrderNos: [], subcontractorNames: [] } as CivilWorkOrderAggregate);
      aggregate.orderedQty += toNumber(item.orderQty);
      aggregate.amount += toNumber(item.totalAmount);
      if (workOrderNo && !aggregate.workOrderNos.includes(workOrderNo)) {
        aggregate.workOrderNos.push(workOrderNo);
      }
      if (subcontractorName && !aggregate.subcontractorNames.includes(subcontractorName)) {
        aggregate.subcontractorNames.push(subcontractorName);
      }
      if (date && (!aggregate.latestDate || date > aggregate.latestDate)) {
        aggregate.latestDate = date;
      }
      aggregates.set(boqItemId, aggregate);
    }
  }
  return aggregates;
}

export interface CivilBillAggregate {
  billedQty: number;
  billCount: number;
  latestNo?: string;
  latestDate?: string;
}

/**
 * Sums subcontractor billed quantities per boqItemId. Rejected bills are excluded; retention
 * bills are excluded too — they re-claim value already billed, so counting their line quantities
 * would double the billed quantity.
 */
export function aggregateSubcontractorBillsByBoqItem(
  bills: SubcontractorBillLike[],
): Map<string, CivilBillAggregate> {
  const aggregates = new Map<string, CivilBillAggregate>();
  for (const bill of bills) {
    if (VOID_STATUSES.has(String(bill.status ?? ""))) continue;
    if (bill.isRetentionBill === true) continue;
    const billNo = String(bill.billNo ?? "").trim() || undefined;
    const date = toDateString(bill.billDate);
    for (const item of itemsOf(bill)) {
      const boqItemId = String(item.boqItemId ?? "").trim();
      if (!boqItemId) continue;
      const aggregate =
        aggregates.get(boqItemId) ?? ({ billedQty: 0, billCount: 0 } as CivilBillAggregate);
      aggregate.billedQty += toNumber(item.billedQty);
      aggregate.billCount += 1;
      if (date && (!aggregate.latestDate || date > aggregate.latestDate)) {
        aggregate.latestDate = date;
        aggregate.latestNo = billNo;
      } else if (!aggregate.latestNo && billNo) {
        aggregate.latestNo = billNo;
      }
      aggregates.set(boqItemId, aggregate);
    }
  }
  return aggregates;
}

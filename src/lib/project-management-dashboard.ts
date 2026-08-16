import { reconcileBoqQuantities } from "./boq-quantity-control.ts";
import {
  aggregateMeasurementsByBoqKey,
  aggregateSubcontractorBillsByBoqItem,
  aggregateWorkOrdersByBoqItem,
  civilBoqKeyOfBoqItem,
  readLooseScope,
} from "./civil-execution.ts";
import { isBoqSectionHeader } from "./project-management-boq-columns.ts";

type UnknownRecord = Record<string, unknown>;

export type ProjectAttentionSeverity = "critical" | "warning" | "info";

export type ProjectAttentionTarget =
  | "boq"
  | "requirement-planner"
  | "mdl"
  | "purchase-orders"
  | "inspections"
  | "mdcc"
  | "dispatch-instructions"
  | "grn"
  | "mvac"
  | "projects"
  | "civil"
  | "jmc";

/**
 * How long a record may sit in a waiting state before it is reported as stalled. A gate that is
 * merely "open" is normal; one that has been open for a fortnight is somebody forgetting about it,
 * and until now nothing in the module measured the difference.
 */
export const DEFAULT_STALL_DAYS = 14;

/** A gate whose waiting records have aged past the stall threshold, and who they are sitting with. */
export interface ProjectStalledGate {
  key: string;
  label: string;
  /** Who has to act: Client, Vendor, Inspector, or SEL itself. */
  waitingOn: string;
  count: number;
  oldestDays: number;
  target: ProjectAttentionTarget;
}

export interface ProjectAttentionItem {
  id: string;
  severity: ProjectAttentionSeverity;
  title: string;
  detail: string;
  count: number;
  target: ProjectAttentionTarget;
}

export interface ProjectControlTowerInput {
  boqItems: UnknownRecord[];
  indents: UnknownRecord[];
  rfqs: UnknownRecord[];
  purchaseOrders: UnknownRecord[];
  mdlDrawings: UnknownRecord[];
  manufacturingClearances: UnknownRecord[];
  inspections: UnknownRecord[];
  mdccRecords: UnknownRecord[];
  dispatchInstructions: UnknownRecord[];
  grns: UnknownRecord[];
  mvacRecords: UnknownRecord[];
  /* --- civil registers owned by Billing Recon / Subcontractors Management (read-only join —
   * see src/lib/civil-execution.ts). Optional so existing callers keep working unchanged. --- */
  workOrders?: UnknownRecord[];
  jmcEntries?: UnknownRecord[];
  mvacEntries?: UnknownRecord[];
  subcontractorBills?: UnknownRecord[];
  leadTimeDays?: number;
  /** Same variation tolerance the Indent screen enforces; used by the quantity roll-up. */
  tolerancePct?: number;
  /** Days a waiting record may age before it is reported as stalled. */
  stallDays?: number;
  /** The PM project's planned completion date (yyyy-mm-dd), when one is recorded. */
  projectEndDate?: string;
  today?: Date;
}

export interface ProjectControlTowerSummary {
  boq: {
    itemCount: number;
    budgetValue: number;
    surveyedCount: number;
    surveyCoveragePct: number;
  };
  procurement: {
    openIndentCount: number;
    openRfqCount: number;
    livePoCount: number;
    committedValue: number;
    overduePoCount: number;
  };
  /**
   * Commitment vs budget — the cost-control view the tower previously lacked. `committedValue`
   * is everything the project has promised to spend — supply POs plus civil subcontract work
   * orders; `budgetValue` is what the BOQ says the work is worth. When commitment crosses budget
   * the project is spending money the contract never priced.
   */
  cost: {
    budgetValue: number;
    committedValue: number;
    poCommittedValue: number;
    workOrderCommittedValue: number;
    /** committed − budget; positive means over-committed. */
    varianceValue: number;
    /** Rounded percentage of budget committed (0 when there is no budget to compare against). */
    committedPct: number;
    overBudget: boolean;
  };
  /** Civil execution, joined from Billing Recon / Subcontractors Management registers. */
  civil: {
    workOrderCount: number;
    workOrderValue: number;
    /** Σ rate × executedQty across non-void JMC/MVAC measurement entries, at recorded rates. */
    executedValue: number;
    /** Σ rate × certifiedQty across the same entries. */
    certifiedValue: number;
    measurementEntryCount: number;
    /** Measurement entries whose certification workflow has not finished. */
    openMeasurementCount: number;
    /** Σ totalAmount of non-rejected, non-retention subcontractor bills. */
    subcontractorBilledValue: number;
  };
  engineering: {
    drawingCount: number;
    approvedDrawingCount: number;
    overdueDrawingCount: number;
  };
  supplyPipeline: Array<{
    key: "ordered" | "mc" | "inspection" | "mdcc" | "di" | "grn" | "mvac" | "billing";
    label: string;
    count: number;
  }>;
  /** Planned completion vs today — null fields when the mapping has no end date recorded. */
  schedule: {
    endDate: string | null;
    /** Negative once the date has passed. */
    daysRemaining: number | null;
    /** End date passed while procurement or the supply pipeline is still open. */
    overdueWithOpenWork: boolean;
  };
  /** Waiting-state records that have aged past the stall threshold, grouped by gate. */
  stalledGates: ProjectStalledGate[];
  /** BOQ lines whose per-stage quantities disagree (critical) or exceed approved scope (warning),
   * rolled up from reconcileBoqQuantities() across every line — the register-integrity check that
   * previously only ran when someone happened to open a single item's 360° page. */
  quantityIntegrity: {
    checkedCount: number;
    criticalCount: number;
    warningCount: number;
  };
  attention: ProjectAttentionItem[];
}

const OPEN_INDENT_STATUSES = new Set(["Draft", "Submitted", "Approved"]);
const OPEN_RFQ_STATUSES = new Set(["Draft", "Sent", "Partially Awarded"]);
const LIVE_PO_STATUSES = new Set(["Issued", "Received"]);
const APPROVED_MDL_STATUSES = new Set(["Approved", "Approved with Comments"]);

export function projectManagementNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function projectBoqValue(item: UnknownRecord): number {
  const storedTotal = projectManagementNumber(item["Total Amount"] ?? item.totalAmount);
  if (storedTotal > 0) return storedTotal;
  const quantity = projectManagementNumber(item.QTY ?? item.Quantity ?? item.quantity);
  const rate = projectManagementNumber(
    item["Budget Price"] ?? item["Unit Rate"] ?? item.Rate ?? item.rate,
  );
  return quantity * rate;
}

const isPastDate = (value: unknown, today: Date): boolean => {
  if (typeof value !== "string" || !value) return false;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return false;
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return date.getTime() < startOfToday.getTime();
};

const isRequirementLate = (
  requiredAtSiteDate: string,
  leadTimeDays: number,
  remainingQty: number,
  today: Date,
): boolean => {
  if (!requiredAtSiteDate || remainingQty <= 0) return false;
  const indentBy = new Date(`${requiredAtSiteDate}T00:00:00`);
  if (Number.isNaN(indentBy.getTime())) return false;
  indentBy.setDate(indentBy.getDate() - leadTimeDays);
  return indentBy.getTime() < new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
};

const recordId = (record: UnknownRecord): string =>
  String(record.id ?? record.boqItemId ?? "").trim();

const uniqueCount = (records: UnknownRecord[], predicate: (record: UnknownRecord) => boolean) =>
  new Set(records.filter(predicate).map(recordId).filter(Boolean)).size;

const sumIndentQtyByBoqItem = (indents: UnknownRecord[]): Map<string, number> => {
  const quantities = new Map<string, number>();
  for (const indent of indents) {
    if (["Rejected", "Cancelled"].includes(String(indent.status ?? ""))) continue;
    const items = Array.isArray(indent.items) ? (indent.items as UnknownRecord[]) : [];
    for (const item of items) {
      const boqItemId = String(item.boqItemId ?? "");
      if (!boqItemId) continue;
      quantities.set(
        boqItemId,
        (quantities.get(boqItemId) ?? 0) + projectManagementNumber(item.requestedQty ?? item.qty),
      );
    }
  }
  return quantities;
};

const attentionOrder: Record<ProjectAttentionSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

/** Whole days between a yyyy-mm-dd string and today; null when the date is absent or unparsable. */
const daysSince = (value: unknown, today: Date): number | null => {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.floor((startOfToday.getTime() - date.getTime()) / 86_400_000);
};

/**
 * The waiting states worth ageing, and who each one waits on. A record only counts once it has
 * genuinely left SEL's hands (or is sitting unactioned inside them) AND carries a date to age
 * from — a Requested record with no request date cannot be aged and is skipped rather than
 * guessed at.
 */
const WORKFLOW_WAITING_STATUSES = new Set(["Pending", "In Progress"]);

const STALL_RULES: Array<{
  key: string;
  label: string;
  waitingOn: string;
  source: keyof Pick<
    ProjectControlTowerInput,
    | "indents"
    | "rfqs"
    | "inspections"
    | "mdccRecords"
    | "dispatchInstructions"
    | "mvacRecords"
    | "jmcEntries"
    | "mvacEntries"
    | "subcontractorBills"
  >;
  target: ProjectAttentionTarget;
  matches: (record: UnknownRecord) => boolean;
  ageFrom: (record: UnknownRecord) => unknown;
}> = [
  {
    key: "indent-approval",
    label: "Indents awaiting approval",
    waitingOn: "SEL approval",
    source: "indents",
    target: "requirement-planner",
    matches: (record) => record.status === "Submitted",
    ageFrom: (record) => record.indentDate,
  },
  {
    key: "rfq-quotes",
    label: "RFQs awaiting quotes",
    waitingOn: "Vendors",
    source: "rfqs",
    target: "purchase-orders",
    matches: (record) => record.status === "Sent",
    ageFrom: (record) => record.rfqDate,
  },
  {
    key: "inspection-visit",
    label: "Inspections awaiting visit",
    waitingOn: "Inspector",
    source: "inspections",
    target: "inspections",
    matches: (record) => record.status === "Requested",
    ageFrom: (record) => record.requestedDate,
  },
  {
    key: "mdcc-issue",
    label: "MDCCs awaiting client issue",
    waitingOn: "Client",
    source: "mdccRecords",
    target: "mdcc",
    matches: (record) => record.status === "Requested",
    ageFrom: (record) => record.requestedDate,
  },
  {
    key: "di-dispatch",
    label: "DIs awaiting vendor dispatch",
    waitingOn: "Vendor",
    source: "dispatchInstructions",
    target: "dispatch-instructions",
    matches: (record) => record.status === "Issued" || record.status === "Acknowledged",
    ageFrom: (record) => record.issuedOn,
  },
  {
    key: "mvac-signature",
    label: "MVACs awaiting client signature",
    waitingOn: "Client",
    source: "mvacRecords",
    target: "mvac",
    matches: (record) => record.status === "Requested",
    ageFrom: (record) => record.requestedDate,
  },
  {
    key: "jmc-certification",
    label: "JMC entries awaiting certification",
    waitingOn: "Certification workflow",
    source: "jmcEntries",
    // Project Management hosts the JMC screens, so this one can land on the log itself. MVAC
    // entries and subcontractor bills still live only in Billing Recon / Subcontractors, so their
    // rules point at the Civil workspace instead.
    target: "jmc",
    matches: (record) => WORKFLOW_WAITING_STATUSES.has(String(record.status ?? "")),
    ageFrom: (record) => record.jmcDate,
  },
  {
    key: "mvac-entry-certification",
    label: "MVAC entries awaiting certification",
    waitingOn: "Certification workflow",
    source: "mvacEntries",
    target: "civil",
    matches: (record) => WORKFLOW_WAITING_STATUSES.has(String(record.status ?? "")),
    ageFrom: (record) => record.mvacDate,
  },
  {
    key: "subcontractor-bill-approval",
    label: "Subcontractor bills in approval",
    waitingOn: "Billing workflow",
    source: "subcontractorBills",
    target: "civil",
    matches: (record) => WORKFLOW_WAITING_STATUSES.has(String(record.status ?? "")),
    ageFrom: (record) => record.billDate,
  },
];

const sumItemQtyByBoqItem = (
  parents: UnknownRecord[],
  isCounted: (parent: UnknownRecord) => boolean,
  qtyOf: (item: UnknownRecord) => number,
): Map<string, number> => {
  const quantities = new Map<string, number>();
  for (const parent of parents) {
    if (!isCounted(parent)) continue;
    const items = Array.isArray(parent.items) ? (parent.items as UnknownRecord[]) : [];
    for (const item of items) {
      const boqItemId = String(item.boqItemId ?? "");
      if (!boqItemId) continue;
      quantities.set(boqItemId, (quantities.get(boqItemId) ?? 0) + qtyOf(item));
    }
  }
  return quantities;
};

/** One-doc-per-boqItemId gate registers → boqItemId → chosen numeric field (undefined when the
 * record hasn't stored one, which reconcileBoqQuantities treats as "not recorded", not zero). */
const gateQtyByBoqItem = (
  records: UnknownRecord[],
  field: string,
): Map<string, number> => {
  const quantities = new Map<string, number>();
  for (const record of records) {
    const boqItemId = String(record.boqItemId ?? record.id ?? "");
    if (!boqItemId) continue;
    const value = record[field];
    if (typeof value === "number" && Number.isFinite(value)) quantities.set(boqItemId, value);
  }
  return quantities;
};

/**
 * Builds the cross-register management summary used by the Project Management landing page.
 * The calculation is deliberately pure so the dashboard can be regression-tested without
 * Firebase and reused later by a scheduled aggregate job when data volumes require it.
 */
export function calculateProjectControlTower(
  input: ProjectControlTowerInput,
): ProjectControlTowerSummary {
  const today = input.today ?? new Date();
  const leadTimeDays = Math.max(0, input.leadTimeDays ?? 45);
  const budgetValue = input.boqItems.reduce((sum, item) => sum + projectBoqValue(item), 0);
  const surveyedCount = input.boqItems.filter((item) => typeof item.surveyedQty === "number").length;
  const committedPurchaseOrders = input.purchaseOrders.filter((po) =>
    LIVE_PO_STATUSES.has(String(po.status ?? "")),
  );
  const overduePurchaseOrders = input.purchaseOrders.filter(
    (po) =>
      !["Received", "Cancelled"].includes(String(po.status ?? "")) &&
      isPastDate(po.endDate, today),
  );
  const overdueDrawings = input.mdlDrawings.filter(
    (drawing) =>
      !APPROVED_MDL_STATUSES.has(String(drawing.status ?? "")) &&
      isPastDate(drawing.plannedEndDate, today),
  );
  const indentQtyByBoqItem = sumIndentQtyByBoqItem(input.indents);
  const lateRequirements = input.boqItems.filter((item) => {
    const requiredAtSiteDate = String(item.requiredAtSiteDate ?? "");
    if (!requiredAtSiteDate) return false;
    const boqQty = projectManagementNumber(item.surveyedQty ?? item.QTY ?? item.Quantity);
    const approvedVariationQty = projectManagementNumber(item.variationApprovedQty);
    const indentedQty = indentQtyByBoqItem.get(recordId(item)) ?? 0;
    const remainingQty = boqQty + approvedVariationQty - indentedQty;
    return isRequirementLate(requiredAtSiteDate, leadTimeDays, remainingQty, today);
  });
  const failedInspections = input.inspections.filter((record) => record.status === "Failed");
  const blockingPunchItems = input.inspections.filter((record) => {
    const punchItems = Array.isArray(record.punchItems) ? (record.punchItems as UnknownRecord[]) : [];
    return punchItems.some(
      (item) =>
        item.closed !== true && ["Critical", "Major"].includes(String(item.severity ?? "")),
    );
  });
  const mdccAwaitingIssue = input.mdccRecords.filter((record) => record.status === "Requested");
  const diAwaitingDispatch = input.dispatchInstructions.filter(
    (record) => record.status === "Issued" || record.status === "Acknowledged",
  );
  const grnDiscrepancies = input.grns.filter(
    (record) => record.status === "Received with Discrepancy",
  );
  const heldMvac = input.mvacRecords.filter((record) => record.status === "Held");
  const signedNotReleased = input.mvacRecords.filter(
    (record) => record.status === "Signed" && !record.billingReleasedOn,
  );

  /* ---- stalled gates: waiting-state records that have aged past the threshold ---- */
  const stallDays = Math.max(1, input.stallDays ?? DEFAULT_STALL_DAYS);
  const stalledGates: ProjectStalledGate[] = [];
  for (const rule of STALL_RULES) {
    const ages = (input[rule.source] ?? [])
      .filter(rule.matches)
      .map((record) => daysSince(rule.ageFrom(record), today))
      .filter((age): age is number => age != null && age >= stallDays);
    if (ages.length) {
      stalledGates.push({
        key: rule.key,
        label: rule.label,
        waitingOn: rule.waitingOn,
        count: ages.length,
        oldestDays: Math.max(...ages),
        target: rule.target,
      });
    }
  }
  stalledGates.sort((a, b) => b.oldestDays - a.oldestDays);

  /* ---- civil execution: the registers Billing Recon / Subcontractors Management own ---- */
  const workOrders = input.workOrders ?? [];
  const measurementEntries = [...(input.jmcEntries ?? []), ...(input.mvacEntries ?? [])];
  const subcontractorBills = input.subcontractorBills ?? [];
  const workOrderAggByBoqItem = aggregateWorkOrdersByBoqItem(workOrders);
  const measurementAggByBoqKey = aggregateMeasurementsByBoqKey(measurementEntries);
  const subBillAggByBoqItem = aggregateSubcontractorBillsByBoqItem(subcontractorBills);
  const liveWorkOrders = workOrders.filter(
    (workOrder) => !["Cancelled"].includes(String(workOrder.status ?? "")),
  );
  const workOrderValue = liveWorkOrders.reduce(
    (sum, workOrder) => sum + projectManagementNumber(workOrder.totalAmount),
    0,
  );
  const nonVoidMeasurements = measurementEntries.filter(
    (entry) => !["Rejected", "Cancelled"].includes(String(entry.status ?? "")),
  );
  let civilExecutedValue = 0;
  let civilCertifiedValue = 0;
  for (const aggregate of measurementAggByBoqKey.values()) {
    civilExecutedValue += aggregate.executedValue;
    civilCertifiedValue += aggregate.certifiedValue;
  }
  const subcontractorBilledValue = subcontractorBills
    .filter(
      (bill) =>
        !["Rejected", "Cancelled"].includes(String(bill.status ?? "")) &&
        bill.isRetentionBill !== true,
    )
    .reduce((sum, bill) => sum + projectManagementNumber(bill.totalAmount), 0);

  /* ---- quantity integrity: reconcile every BOQ line's ladder, roll up the exceptions ---- */
  const committedPoQtyByBoqItem = sumItemQtyByBoqItem(
    input.purchaseOrders,
    (po) => LIVE_PO_STATUSES.has(String(po.status ?? "")),
    (item) => projectManagementNumber(item.qty),
  );
  const inspectedQtyByBoqItem = gateQtyByBoqItem(input.inspections, "qtyAccepted");
  const dispatchedQtyByBoqItem = gateQtyByBoqItem(input.dispatchInstructions, "dispatchQty");
  const siteAcceptedQtyByBoqItem = gateQtyByBoqItem(input.grns, "acceptedQty");
  const clientAcceptedQtyByBoqItem = gateQtyByBoqItem(input.mvacRecords, "qtyAccepted");
  let quantityCheckedCount = 0;
  let quantityCriticalCount = 0;
  let quantityWarningCount = 0;
  for (const item of input.boqItems) {
    if (isBoqSectionHeader(item as { Unit?: unknown; QTY?: unknown })) continue;
    const boqItemId = recordId(item);
    if (!boqItemId) continue;
    quantityCheckedCount += 1;
    const scope2 = readLooseScope(item, 2).toLowerCase();
    const isCivilLane = scope2 === "civil" || scope2 === "erection";
    const indentedQty = indentQtyByBoqItem.get(boqItemId);
    const orderedQty = committedPoQtyByBoqItem.get(boqItemId);
    const workOrderAgg = isCivilLane ? workOrderAggByBoqItem.get(boqItemId) : undefined;
    const measurementAgg = isCivilLane
      ? measurementAggByBoqKey.get(civilBoqKeyOfBoqItem(item))
      : undefined;
    const subBillAgg = isCivilLane ? subBillAggByBoqItem.get(boqItemId) : undefined;
    const ledger = reconcileBoqQuantities({
      lane: isCivilLane ? "civil" : "supply",
      boqQty: projectManagementNumber(item.QTY ?? item.Quantity),
      surveyedQty: typeof item.surveyedQty === "number" ? item.surveyedQty : undefined,
      indentedQty: indentedQty || undefined,
      orderedQty: orderedQty || undefined,
      inspectedAcceptedQty: inspectedQtyByBoqItem.get(boqItemId),
      dispatchedQty: dispatchedQtyByBoqItem.get(boqItemId),
      siteAcceptedQty: siteAcceptedQtyByBoqItem.get(boqItemId),
      clientAcceptedQty: clientAcceptedQtyByBoqItem.get(boqItemId),
      woOrderedQty: workOrderAgg ? workOrderAgg.orderedQty : undefined,
      executedQty: measurementAgg ? measurementAgg.executedQty : undefined,
      jmcQty: measurementAgg ? measurementAgg.certifiedQty : undefined,
      subcontractorBilledQty: subBillAgg ? subBillAgg.billedQty : undefined,
      approvedVariationQty:
        typeof item.variationApprovedQty === "number" ? item.variationApprovedQty : 0,
      tolerancePct: input.tolerancePct,
    });
    if (ledger.worstSeverity === "critical") quantityCriticalCount += 1;
    else if (ledger.worstSeverity === "warning") quantityWarningCount += 1;
  }

  /* ---- cost: total commitment (supply POs + civil work orders) vs BOQ budget ---- */
  const poCommittedValue = committedPurchaseOrders.reduce(
    (sum, po) => sum + projectManagementNumber(po.totalAmount),
    0,
  );
  const committedValue = poCommittedValue + workOrderValue;
  const overBudget = budgetValue > 0 && committedValue > budgetValue;

  /* ---- schedule: planned completion vs the work still open ---- */
  const openIndentCount = input.indents.filter((indent) =>
    OPEN_INDENT_STATUSES.has(String(indent.status ?? "")),
  ).length;
  const openRfqCount = input.rfqs.filter((rfq) =>
    OPEN_RFQ_STATUSES.has(String(rfq.status ?? "")),
  ).length;
  const daysPastEnd = daysSince(input.projectEndDate, today);
  const hasOpenWork =
    openIndentCount + openRfqCount > 0 ||
    committedPurchaseOrders.some((po) => po.status === "Issued") ||
    signedNotReleased.length > 0 ||
    heldMvac.length > 0;
  const overdueWithOpenWork = daysPastEnd != null && daysPastEnd > 0 && hasOpenWork;

  const attention: ProjectAttentionItem[] = [];
  const addAttention = (
    count: number,
    item: Omit<ProjectAttentionItem, "count">,
  ) => {
    if (count > 0) attention.push({ ...item, count });
  };

  if (input.boqItems.length === 0) {
    addAttention(1, {
      id: "boq-empty",
      severity: "critical",
      title: "BOQ baseline is missing",
      detail: "Import or add the approved BOQ before commitments are raised.",
      target: "boq",
    });
  }
  addAttention(lateRequirements.length, {
    id: "late-requirements",
    severity: "critical",
    title: "Requirements are already late",
    detail: "Supply items still need indenting after their calculated indent-by date.",
    target: "requirement-planner",
  });
  addAttention(overduePurchaseOrders.length, {
    id: "overdue-purchase-orders",
    severity: "critical",
    title: "Purchase orders are overdue",
    detail: "Open purchase orders have passed their planned completion date.",
    target: "purchase-orders",
  });
  addAttention(failedInspections.length, {
    id: "failed-inspections",
    severity: "critical",
    title: "Inspections have failed",
    detail: "Failed inspections require corrective action before dispatch.",
    target: "inspections",
  });
  addAttention(heldMvac.length, {
    id: "held-mvac",
    severity: "critical",
    title: "Client acceptance is held",
    detail: "Critical MVAC observations are blocking acceptance and billing.",
    target: "mvac",
  });
  addAttention(overdueDrawings.length, {
    id: "overdue-drawings",
    severity: "warning",
    title: "Drawing approvals are overdue",
    detail: "Engineering deliverables have passed their planned end date.",
    target: "mdl",
  });
  addAttention(blockingPunchItems.length, {
    id: "blocking-punch-items",
    severity: "warning",
    title: "Inspection punch items are blocking dispatch",
    detail: "Open critical or major punch items must be closed before MDCC issue.",
    target: "inspections",
  });
  addAttention(mdccAwaitingIssue.length, {
    id: "mdcc-awaiting-issue",
    severity: "warning",
    title: "Dispatch clearances await issue",
    detail: "Requested MDCC records are immobilising inspected material.",
    target: "mdcc",
  });
  addAttention(diAwaitingDispatch.length, {
    id: "di-awaiting-dispatch",
    severity: "warning",
    title: "Dispatch instructions await dispatch",
    detail: "Issued DIs have not yet been marked dispatched.",
    target: "dispatch-instructions",
  });
  addAttention(grnDiscrepancies.length, {
    id: "grn-discrepancies",
    severity: "warning",
    title: "GRN discrepancies are open",
    detail: "Short, damaged, or rejected quantities need resolution.",
    target: "grn",
  });
  addAttention(signedNotReleased.length, {
    id: "signed-not-released",
    severity: "warning",
    title: "Signed MVACs are not released for billing",
    detail: "Accepted material is ready for the billing hand-off.",
    target: "mvac",
  });
  if (overBudget) {
    addAttention(1, {
      id: "over-committed",
      severity: "critical",
      title: "PO commitment exceeds the BOQ budget",
      detail: "Committed purchase value has crossed the approved BOQ baseline value.",
      target: "purchase-orders",
    });
  }
  if (overdueWithOpenWork) {
    addAttention(1, {
      id: "schedule-overrun",
      severity: "critical",
      title: "Project end date has passed with open work",
      detail: `Planned completion was ${daysPastEnd} day${daysPastEnd === 1 ? "" : "s"} ago and procurement or acceptance is still open.`,
      target: "projects",
    });
  }
  addAttention(quantityCriticalCount, {
    id: "quantity-mismatch",
    severity: "critical",
    title: "Stage quantities disagree",
    detail: "BOQ lines where a downstream register records more than its upstream stage.",
    target: "boq",
  });
  addAttention(quantityWarningCount, {
    id: "quantity-over-scope",
    severity: "warning",
    title: "Quantities exceed approved scope",
    detail: "Indented or ordered quantities need a variation order to cover the excess.",
    target: "boq",
  });
  const stalledRecordCount = stalledGates.reduce((sum, gate) => sum + gate.count, 0);
  addAttention(stalledRecordCount, {
    id: "stalled-gates",
    severity: "warning",
    title: `Records stalled beyond ${stallDays} days`,
    detail: "Waiting-state records that have aged past the stall threshold need chasing.",
    target: stalledGates[0]?.target ?? "boq",
  });

  attention.sort(
    (a, b) => attentionOrder[a.severity] - attentionOrder[b.severity] || b.count - a.count,
  );

  return {
    boq: {
      itemCount: input.boqItems.length,
      budgetValue,
      surveyedCount,
      surveyCoveragePct: input.boqItems.length
        ? Math.round((surveyedCount / input.boqItems.length) * 100)
        : 0,
    },
    procurement: {
      openIndentCount,
      openRfqCount,
      livePoCount: committedPurchaseOrders.length,
      committedValue: poCommittedValue,
      overduePoCount: overduePurchaseOrders.length,
    },
    cost: {
      budgetValue,
      committedValue,
      poCommittedValue,
      workOrderCommittedValue: workOrderValue,
      varianceValue: Math.round((committedValue - budgetValue) * 100) / 100,
      committedPct: budgetValue > 0 ? Math.round((committedValue / budgetValue) * 100) : 0,
      overBudget,
    },
    civil: {
      workOrderCount: liveWorkOrders.length,
      workOrderValue,
      executedValue: Math.round(civilExecutedValue * 100) / 100,
      certifiedValue: Math.round(civilCertifiedValue * 100) / 100,
      measurementEntryCount: nonVoidMeasurements.length,
      openMeasurementCount: nonVoidMeasurements.filter((entry) =>
        WORKFLOW_WAITING_STATUSES.has(String(entry.status ?? "")),
      ).length,
      subcontractorBilledValue,
    },
    engineering: {
      drawingCount: input.mdlDrawings.length,
      approvedDrawingCount: input.mdlDrawings.filter((drawing) =>
        APPROVED_MDL_STATUSES.has(String(drawing.status ?? "")),
      ).length,
      overdueDrawingCount: overdueDrawings.length,
    },
    supplyPipeline: [
      {
        key: "ordered",
        label: "Ordered",
        count: uniqueCount(
          committedPurchaseOrders.flatMap((po) =>
            Array.isArray(po.items) ? (po.items as UnknownRecord[]) : [],
          ),
          () => true,
        ),
      },
      { key: "mc", label: "MC Cleared", count: uniqueCount(input.manufacturingClearances, (r) => r.status === "Cleared") },
      { key: "inspection", label: "Inspected", count: uniqueCount(input.inspections, (r) => ["Passed", "Passed with Punch Items"].includes(String(r.status ?? ""))) },
      { key: "mdcc", label: "Clearance Issued", count: uniqueCount(input.mdccRecords, (r) => r.status === "Issued") },
      { key: "di", label: "Dispatched", count: uniqueCount(input.dispatchInstructions, (r) => r.status === "Dispatched") },
      { key: "grn", label: "At Site", count: uniqueCount(input.grns, (r) => ["Received Clean", "Received with Discrepancy"].includes(String(r.status ?? ""))) },
      { key: "mvac", label: "Client Accepted", count: uniqueCount(input.mvacRecords, (r) => r.status === "Signed") },
      { key: "billing", label: "Billing Released", count: uniqueCount(input.mvacRecords, (r) => Boolean(r.billingReleasedOn)) },
    ],
    schedule: {
      endDate: input.projectEndDate ?? null,
      daysRemaining: daysPastEnd != null ? -daysPastEnd : null,
      overdueWithOpenWork,
    },
    stalledGates,
    quantityIntegrity: {
      checkedCount: quantityCheckedCount,
      criticalCount: quantityCriticalCount,
      warningCount: quantityWarningCount,
    },
    attention,
  };
}

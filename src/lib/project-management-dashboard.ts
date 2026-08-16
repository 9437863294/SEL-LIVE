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
  | "mvac";

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
  leadTimeDays?: number;
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
      openIndentCount: input.indents.filter((indent) =>
        OPEN_INDENT_STATUSES.has(String(indent.status ?? "")),
      ).length,
      openRfqCount: input.rfqs.filter((rfq) => OPEN_RFQ_STATUSES.has(String(rfq.status ?? ""))).length,
      livePoCount: committedPurchaseOrders.length,
      committedValue: committedPurchaseOrders.reduce(
        (sum, po) => sum + projectManagementNumber(po.totalAmount),
        0,
      ),
      overduePoCount: overduePurchaseOrders.length,
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
    attention,
  };
}

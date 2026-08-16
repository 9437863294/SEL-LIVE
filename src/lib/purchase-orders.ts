export const PO_PERMISSION_RESOURCE = "Project Management.Purchase Orders";

export const PO_COLLECTION = "purchaseOrders";

export const PO_STATUSES = ["Draft", "Issued", "Received", "Cancelled"] as const;
export type POStatus = (typeof PO_STATUSES)[number];

export interface PurchaseOrderItem {
  description: string;
  unit: string;
  qty: number;
  rate: number;
  amount: number;
  rfqItemId?: string;
  sourceRfqId?: string;
  sourceRfqNumber?: string;
  sourceIndentId?: string;
  sourceIndentNumber?: string;
  boqItemId?: string;
  boqQty?: number;
  indentQty?: number;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  poDate: string;
  vendorId: string;
  vendorName: string;
  vendorCode?: string;
  projectMappingId?: string;
  projectManagementProjectName?: string;
  projectId?: string;
  projectName?: string;
  startDate?: string;
  endDate?: string;
  terms?: string;
  approvedDocumentUrl?: string;
  approvedDocumentName?: string;
  approvedDocumentPath?: string;
  items: PurchaseOrderItem[];
  totalAmount: number;
  status: POStatus;
  sourceRfqIds?: string[];
  sourceRfqNumbers?: string[];
  createdAt?: unknown;
  createdBy?: string;
  createdByName?: string;
  updatedAt?: unknown;
  cancelledReason?: string;
  // This PO's own flow-down terms, checked at issue against the project's client (see
  // computeFlowDownCheck below).
  warrantyMonths?: number;
  ldRatePct?: number;
  ldCapPct?: number;
  performanceSecurityPct?: number;
  // Recorded acceptance of a gap found at issue time — commitment-over-BOQ and/or flow-down —
  // rather than the gap being silently absorbed.
  commitmentOverrideReason?: string;
  flowDownOverrideReason?: string;
  issueOverrideBy?: string;
  issueOverrideByName?: string;
}

export const toNumber = (value: unknown): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

export const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);

export const formatQuantity = (value: number) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(value);

export const generatePoNumber = (poDate: string, docId: string) => {
  const dateCode = poDate.replace(/-/g, "");
  return `PO-${dateCode}-${docId.slice(0, 5).toUpperCase()}`;
};

export const poStatusStyles: Record<POStatus, string> = {
  Draft: "bg-muted text-muted-foreground",
  Issued: "bg-blue-100 text-blue-700",
  Received: "bg-emerald-100 text-emerald-700",
  Cancelled: "bg-red-100 text-red-700",
};

const PO_CLOSED_STATUSES: POStatus[] = ["Received", "Cancelled"];

// A PO is overdue once its planned end date has passed without being received (or cancelled).
export function isPoOverdue(po?: Pick<PurchaseOrder, "endDate" | "status">, today: Date = new Date()): boolean {
  if (!po?.endDate) return false;
  if (PO_CLOSED_STATUSES.includes(po.status)) return false;
  const end = new Date(`${po.endDate}T00:00:00`);
  if (Number.isNaN(end.getTime())) return false;
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return end.getTime() < startOfToday.getTime();
}

/**
 * The back-to-back flow-down check (blueprint §2): every obligation the client imposes on SEL
 * for supplied material must be mirrored in the PO to the vendor, or SEL carries the gap
 * uncovered. For each numeric term, the PO's own commitment to the vendor must be at least as
 * strong as what the client requires of SEL — a lower number (shorter warranty, smaller LD cap,
 * no security) is a real, costed exposure, not a rounding difference.
 */
export interface FlowDownObligation {
  key: string;
  label: string;
  clientValue: string;
  poValue: string;
  status: "ok" | "gap" | "informational";
}

type FlowDownClientTerms = {
  warrantyMonths?: number;
  ldRatePct?: number;
  ldCapPct?: number;
  performanceSecurityPct?: number;
  inspectionRegime?: string;
};

type FlowDownPoTerms = {
  warrantyMonths?: number;
  ldRatePct?: number;
  ldCapPct?: number;
  performanceSecurityPct?: number;
};

export function computeFlowDownCheck(
  client: FlowDownClientTerms | null | undefined,
  po: FlowDownPoTerms,
): FlowDownObligation[] {
  if (!client) return [];
  const obligations: FlowDownObligation[] = [];

  const compareAtLeast = (key: string, label: string, clientValue: number | undefined, poValue: number | undefined, unit: string) => {
    if (clientValue == null) return; // client hasn't configured this term — nothing to check
    obligations.push({
      key,
      label,
      clientValue: `${clientValue}${unit}`,
      poValue: poValue != null ? `${poValue}${unit}` : "Not set",
      status: poValue != null && poValue >= clientValue ? "ok" : "gap",
    });
  };

  compareAtLeast("warrantyMonths", "Warranty", client.warrantyMonths, po.warrantyMonths, " months");
  compareAtLeast("ldRatePct", "LD Rate", client.ldRatePct, po.ldRatePct, "%/week");
  compareAtLeast("ldCapPct", "LD Cap", client.ldCapPct, po.ldCapPct, "%");
  compareAtLeast("performanceSecurityPct", "Performance Security", client.performanceSecurityPct, po.performanceSecurityPct, "%");

  if (client.inspectionRegime) {
    obligations.push({
      key: "inspectionRegime",
      label: "Inspection Regime",
      clientValue: client.inspectionRegime,
      poValue: "Confirm PO terms include this",
      status: "informational",
    });
  }

  return obligations;
}

/** Whether committing `additionalValue` more against a BOQ line (on top of what's already
 * committed via other live POs) would push total commitment above the BOQ value beyond the
 * configured tolerance — the same guard as the indent/survey tolerance checks, applied at the
 * point money actually becomes binding. */
export function isCommitmentOverBoq(
  boqValue: number,
  alreadyCommittedValue: number,
  additionalValue: number,
  tolerancePct: number,
): boolean {
  const allowance = boqValue * (1 + tolerancePct / 100);
  return alreadyCommittedValue + additionalValue > allowance;
}

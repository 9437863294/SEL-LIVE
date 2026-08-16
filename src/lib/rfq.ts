import { type Firestore, doc, runTransaction, serverTimestamp } from "firebase/firestore";

export const RFQ_PERMISSION_RESOURCE = "Project Management.RFQ";

export const RFQ_COLLECTION = "rfqs";
export const RFQ_QUOTES_SUBCOLLECTION = "quotes";

export const RFQ_STATUSES = [
  "Draft",
  "Sent",
  "Partially Awarded",
  "Awarded",
  "Closed",
  "Cancelled",
] as const;
export type RfqStatus = (typeof RFQ_STATUSES)[number];

export interface RfqItem {
  rfqItemId: string;
  sourceIndentId: string;
  sourceIndentNumber: string;
  boqItemId: string;
  boqSlNo: string;
  description: string;
  unit: string;
  qty: number;
  awardedVendorId?: string;
  awardedVendorName?: string;
  awardedRate?: number;
  awardedAmount?: number;
  poId?: string;
}

export interface Rfq {
  id: string;
  rfqNumber: string;
  rfqDate: string;
  dueDate?: string;
  projectMappingId: string;
  projectManagementProjectName: string;
  globalProjectId: string;
  globalProjectName: string;
  items: RfqItem[];
  vendorIds: string[];
  vendorNames: string[];
  remarks?: string;
  status: RfqStatus;
  createdAt?: unknown;
  createdBy?: string;
  createdByName?: string;
  updatedAt?: unknown;
}

export interface RfqQuoteItem {
  rfqItemId: string;
  rate: number;
  amount: number;
}

export const RFQ_QUOTE_STATUSES = ["Pending", "Received"] as const;
export type RfqQuoteStatus = (typeof RFQ_QUOTE_STATUSES)[number];

export interface RfqQuote {
  id: string;
  vendorId: string;
  vendorName: string;
  status: RfqQuoteStatus;
  submittedDate?: string;
  paymentTerms?: string;
  deliveryTime?: string;
  validityDate?: string;
  remarks?: string;
  items: RfqQuoteItem[];
  totalAmount: number;
  // Landed-cost normalisation — captured at quote level (freight/P&F/insurance are typically
  // quoted as one lump sum for the whole RFQ, not per line). GST is tracked separately and
  // excluded from the comparable cost, since it's a creditable input tax, not a real cost
  // difference between vendors — see computeLandedCost/computeCashOutflow below.
  discountAmount?: number;
  packingForwardingAmount?: number;
  freightAmount?: number;
  insuranceAmount?: number;
  gstPct?: number;
  landedCost?: number;
  cashOutflowInclGst?: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

/** Basic quoted total, adjusted for discount and the lump-sum landed-cost components, giving one
 * comparable figure across vendors regardless of how each one broke down their pricing. */
export function computeLandedCost(quote: {
  totalAmount: number;
  discountAmount?: number;
  packingForwardingAmount?: number;
  freightAmount?: number;
  insuranceAmount?: number;
}): number {
  return Math.max(
    0,
    quote.totalAmount -
      (quote.discountAmount ?? 0) +
      (quote.packingForwardingAmount ?? 0) +
      (quote.freightAmount ?? 0) +
      (quote.insuranceAmount ?? 0),
  );
}

/** GST is excluded from the comparable landed cost (input credit is available) but shown
 * separately as the actual cash that will leave the business — comparing GST-inclusive prices
 * across vendors registered under different GST treatments is a common, expensive error. */
export function computeCashOutflow(landedCost: number, gstPct: number): number {
  return landedCost * (1 + gstPct / 100);
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

export const formatDate = (value?: string) => {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

export const generateRfqNumber = (rfqDate: string, docId: string) =>
  `RFQ-${rfqDate.replace(/-/g, "")}-${docId.slice(0, 5).toUpperCase()}`;

export const rfqStatusStyles: Record<RfqStatus, string> = {
  Draft: "bg-muted text-muted-foreground",
  Sent: "bg-blue-100 text-blue-700",
  "Partially Awarded": "bg-amber-100 text-amber-700",
  Awarded: "bg-emerald-100 text-emerald-700",
  Closed: "bg-slate-200 text-slate-700",
  Cancelled: "bg-red-100 text-red-700",
};

export interface RfqAwardEntry {
  rfqItemId: string;
  awardedVendorId: string;
  awardedVendorName: string;
  awardedRate: number;
  awardedAmount: number;
}

/**
 * Atomically marks RFQ items as awarded to a purchase order, re-reading the RFQ inside a
 * transaction and refusing to proceed if any target item was already awarded (`poId` already
 * set) — by anyone, including a moment ago. There are two independent places a PO can be
 * generated from an RFQ (this module's own "Confirm Awards", and the PO builder's "From RFQ
 * Quotes" tab); both call this one function so the same item can never end up double-awarded
 * into two purchase orders, which the two call sites' own initial (non-transactional) reads
 * can't fully rule out on their own.
 */
export async function markRfqItemsAwarded(
  db: Firestore,
  globalProjectId: string,
  rfqId: string,
  poId: string,
  awards: RfqAwardEntry[],
): Promise<RfqStatus> {
  const rfqRef = doc(db, "projects", globalProjectId, RFQ_COLLECTION, rfqId);
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(rfqRef);
    if (!snapshot.exists()) throw new Error("RFQ not found");
    const rfq = snapshot.data() as Rfq;

    const awardByItemId = new Map(awards.map((award) => [award.rfqItemId, award]));
    const alreadyAwarded = rfq.items.filter((item) => awardByItemId.has(item.rfqItemId) && item.poId);
    if (alreadyAwarded.length) {
      throw new Error(
        `${alreadyAwarded.length} of these item(s) were already awarded to another purchase order. Refresh and try again.`,
      );
    }

    const updatedItems = rfq.items.map((item) => {
      const award = awardByItemId.get(item.rfqItemId);
      if (!award) return item;
      return { ...item, ...award, poId };
    });
    const allAwarded = updatedItems.every((item) => item.awardedVendorId);
    const someAwarded = updatedItems.some((item) => item.awardedVendorId);
    const nextStatus: RfqStatus = allAwarded ? "Awarded" : someAwarded ? "Partially Awarded" : rfq.status;

    transaction.set(rfqRef, { items: updatedItems, status: nextStatus, updatedAt: serverTimestamp() }, { merge: true });
    return nextStatus;
  });
}

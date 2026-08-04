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
  createdAt?: unknown;
  updatedAt?: unknown;
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

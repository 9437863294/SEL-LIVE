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

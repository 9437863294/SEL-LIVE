export const VENDOR_MANAGEMENT_PERMISSION_MODULE = "Vendor Management";

export const VENDOR_COLLECTIONS = {
  vendors: "vendors",
} as const;

export const VENDOR_CATEGORIES = [
  "Material Supplier",
  "Service Provider",
  "Contractor",
  "Transporter",
  "Other",
] as const;
export type VendorCategory = (typeof VENDOR_CATEGORIES)[number];

export const VENDOR_STATUSES = ["Active", "Inactive"] as const;
export type VendorStatus = (typeof VENDOR_STATUSES)[number];

export interface Vendor {
  id: string;
  vendorCode: string;
  vendorName: string;
  category: VendorCategory;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  gstin?: string;
  pan?: string;
  bankName?: string;
  accountNumber?: string;
  ifsc?: string;
  status: VendorStatus;
  notes?: string;
  createdAt?: unknown;
  createdBy?: string;
  createdByName?: string;
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

export const generateVendorCode = (docId: string) => `VEN-${docId.slice(0, 6).toUpperCase()}`;

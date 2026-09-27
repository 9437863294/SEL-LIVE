"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Library,
  Loader2,
  Plus,
  Save,
  Search,
  ShieldAlert,
  ShoppingCart,
  Trash2,
} from "lucide-react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { cn } from "@/lib/utils";
import { MDL_COLLECTION, mdlOverallStatusStyles, type MdlDrawing } from "@/lib/mdl";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import { ControlledField } from "@/components/project-management/controlled-field";
import { useFieldControl, validateFieldControlRequirements } from "@/components/project-management/use-field-control";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PmDataList,
  PmEmptyState,
  PmFormActions,
  type PmListColumn,
} from "@/components/project-management/pm-shell";
import {
  PO_COLLECTION,
  PO_PERMISSION_RESOURCE,
  ensurePoLineIds,
  formatCurrency,
  formatQuantity,
  generatePoNumber,
  toNumber,
  type PurchaseOrder,
  type PurchaseOrderItem,
} from "@/lib/purchase-orders";
import {
  RFQ_COLLECTION,
  RFQ_QUOTES_SUBCOLLECTION,
  markRfqItemsAwarded,
  type RfqAwardEntry,
  type RfqItem,
  type RfqQuote,
  type RfqStatus,
} from "@/lib/rfq";
import { VENDOR_COLLECTIONS, type Vendor } from "@/lib/vendor-management";
import type { Client } from "@/lib/types";
import { indentReservesQuantity } from "@/lib/project-management-indent-workflow";

type ProjectMapping = {
  id: string;
  projectName: string;
  globalProjectId: string;
  globalProjectName: string;
};

type RfqWithItems = {
  id: string;
  rfqNumber: string;
  status: RfqStatus;
  items: RfqItem[];
};

type IndentLineItem = {
  boqItemId: string;
  boqSlNo: string;
  description: string;
  unit: string;
  requestedQty: number;
  budgetPrice?: number;
};

type IndentRecord = {
  id: string;
  indentNumber: string;
  status: string;
  items: IndentLineItem[];
};

type BoqItem = {
  id: string;
  "BOQ SL No"?: string | number;
  "ERP SL NO"?: string | number;
  Description?: string;
  Unit?: string;
  QTY?: string | number;
  "Budget Price"?: string | number;
  "Unit Rate"?: string | number;
  "Scope 2"?: string;
  [key: string]: unknown;
};

type ManualRow = {
  rowId: string;
  description: string;
  unit: string;
  qty: string;
  rate: string;
};

type Selection = { qty: string; rate: string };

/** A row of the RFQ or indent picker; `id` is the selection key. */
type RfqPickRow = { id: string; item: RfqItem };
type IndentPickRow = { id: string; item: IndentLineItem };

/**
 * A line of the order being raised, from whichever of the four sources it came. `id` is prefixed
 * with the source, since the keys of different sources are not guaranteed distinct.
 */
type LineRow =
  | { id: string; source: "rfq"; key: string; sel: Selection; rfqId: string; rfqNumber: string; item: RfqItem }
  | { id: string; source: "indent"; key: string; sel: Selection; indentId: string; indentNumber: string; item: IndentLineItem }
  | { id: string; source: "boq"; sel: Selection; item: BoqItem }
  | { id: string; source: "manual"; row: ManualRow };

/**
 * A Card on a desktop; on a phone just its heading and contents, so the item cards inside are not
 * boxed twice.
 */
const PHONE_BARE_CARD = "max-sm:border-0 max-sm:bg-transparent max-sm:shadow-none";
const PHONE_BARE_CARD_SECTION = "max-sm:px-0";
/** A list inside a Card or a bordered group, which already frames it on a desktop. */
const LIST_IN_FRAME = "sm:rounded-none sm:border-0 sm:shadow-none";

/**
 * An input in a line-item cell: full width on a phone card, the table's fixed width from `sm`.
 * A card's detail cell clips its overflow (it truncates text values), so on a phone the focus ring
 * is drawn inside the box rather than around it, where it would be cut off.
 */
const cellInput = (width: string) =>
  cn("w-full max-sm:focus-visible:ring-inset max-sm:focus-visible:ring-offset-0", width);

const emptyManualRow = (): ManualRow => ({
  rowId: Math.random().toString(36).slice(2),
  description: "",
  unit: "",
  qty: "",
  rate: "",
});

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const rfqItemKey = (rfqId: string, rfqItemId: string) => `${rfqId}__${rfqItemId}`;
const indentItemKey = (indentId: string, boqItemId: string) => `${indentId}__${boqItemId}`;

export default function NewProjectPurchaseOrderPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const canAdd = can("Add", PO_PERMISSION_RESOURCE);
  const { field: fieldControl } = useFieldControl("poNew");

  const [mapping, setMapping] = useState<ProjectMapping | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [rfqs, setRfqs] = useState<RfqWithItems[]>([]);
  const [quotesByRfq, setQuotesByRfq] = useState<Record<string, RfqQuote[]>>({});
  const [indents, setIndents] = useState<IndentRecord[]>([]);
  const [existingPurchaseOrders, setExistingPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [mdlRequiredBoqItemIds, setMdlRequiredBoqItemIds] = useState<Set<string>>(new Set());
  const [mdlDrawingsByBoqItemId, setMdlDrawingsByBoqItemId] = useState<Map<string, MdlDrawing>>(new Map());
  const [forceNewMdlReview, setForceNewMdlReview] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [expandedRfqs, setExpandedRfqs] = useState<Set<string>>(new Set());
  const [expandedIndents, setExpandedIndents] = useState<Set<string>>(new Set());
  const [boqSearch, setBoqSearch] = useState("");

  const [poDate, setPoDate] = useState(today());
  const [vendorId, setVendorId] = useState("");
  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState("");
  const [terms, setTerms] = useState("");
  const [client, setClient] = useState<Client | null>(null);
  const [warrantyMonths, setWarrantyMonths] = useState("");
  const [ldRatePct, setLdRatePct] = useState("");
  const [ldCapPct, setLdCapPct] = useState("");
  const [performanceSecurityPct, setPerformanceSecurityPct] = useState("");
  const [selectedRfqItems, setSelectedRfqItems] = useState<Record<string, Selection>>({});
  const [selectedIndentItems, setSelectedIndentItems] = useState<Record<string, Selection>>({});
  const [selectedBoqItems, setSelectedBoqItems] = useState<Record<string, Selection>>({});
  const [manualRows, setManualRows] = useState<ManualRow[]>([]);

  const boqQtyByItemId = useMemo(
    () => Object.fromEntries(boqItems.map((item) => [item.id, toNumber(item.QTY)])),
    [boqItems],
  );

  const indentQtyByBoqItemId = useMemo(() => {
    const map = new Map<string, number>();
    for (const indent of indents) {
      for (const item of indent.items ?? []) {
        if (!item.boqItemId) continue;
        map.set(item.boqItemId, (map.get(item.boqItemId) ?? 0) + toNumber(item.requestedQty));
      }
    }
    return map;
  }, [indents]);

  const poQtyByBoqItemId = useMemo(() => {
    const map = new Map<string, number>();
    for (const po of existingPurchaseOrders) {
      if (po.status === "Cancelled") continue;
      for (const item of po.items ?? []) {
        if (!item.boqItemId) continue;
        map.set(item.boqItemId, (map.get(item.boqItemId) ?? 0) + toNumber(item.qty));
      }
    }
    return map;
  }, [existingPurchaseOrders]);

  useEffect(() => {
    if (isAuthLoading || !canAdd || !mappingId) {
      setIsLoading(false);
      return;
    }

    const load = async () => {
      setIsLoading(true);
      try {
        const mappingSnapshot = await getDoc(doc(db, "projectManagementProjects", mappingId));
        if (!mappingSnapshot.exists()) throw new Error("Project mapping not found");
        const mappingData = { id: mappingSnapshot.id, ...mappingSnapshot.data() } as ProjectMapping;
        if (!mappingData.globalProjectId) throw new Error("Global project is not mapped");

        const [projectSnapshot, vendorSnapshot, rfqSnapshot, indentSnapshot, boqSnapshot, poSnapshot, mdlSnapshot] = await Promise.all([
          getDoc(doc(db, "projects", mappingData.globalProjectId)),
          getDocs(collection(db, VENDOR_COLLECTIONS.vendors)),
          getDocs(collection(db, "projects", mappingData.globalProjectId, RFQ_COLLECTION)),
          getDocs(collection(db, "projects", mappingData.globalProjectId, "indents")),
          getDocs(collection(db, "projects", mappingData.globalProjectId, "boqItems")),
          getDocs(collection(db, "projects", mappingData.globalProjectId, PO_COLLECTION)),
          getDocs(collection(db, "projects", mappingData.globalProjectId, MDL_COLLECTION)),
        ]);
        const globalProjectName =
          (projectSnapshot.data()?.projectName as string | undefined) ?? mappingData.globalProjectName;
        const clientId = projectSnapshot.data()?.clientId as string | undefined;
        if (clientId) {
          const clientSnapshot = await getDoc(doc(db, "clients", clientId));
          if (clientSnapshot.exists()) {
            const clientData = { id: clientSnapshot.id, ...clientSnapshot.data() } as Client;
            setClient(clientData);
            // Default the PO's own terms to what the client requires — the buyer should have to
            // consciously weaken a term, not forget to set it in the first place.
            setWarrantyMonths(clientData.warrantyMonths != null ? String(clientData.warrantyMonths) : "");
            setLdRatePct(clientData.ldRatePct != null ? String(clientData.ldRatePct) : "");
            setLdCapPct(clientData.ldCapPct != null ? String(clientData.ldCapPct) : "");
            setPerformanceSecurityPct(clientData.performanceSecurityPct != null ? String(clientData.performanceSecurityPct) : "");
          }
        }

        const rfqRows = rfqSnapshot.docs
          .map((d) => ({ id: d.id, ...d.data() }) as RfqWithItems)
          .filter((rfq) => !["Draft", "Cancelled", "Closed"].includes(rfq.status) && rfq.items?.some((item) => !item.poId));

        const quotesEntries = await Promise.all(
          rfqRows.map(async (rfq) => {
            const quoteSnapshot = await getDocs(
              collection(db, "projects", mappingData.globalProjectId, RFQ_COLLECTION, rfq.id, RFQ_QUOTES_SUBCOLLECTION),
            );
            return [rfq.id, quoteSnapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as RfqQuote)] as const;
          }),
        );

        const indentRows = indentSnapshot.docs
          .map((d) => ({ id: d.id, ...d.data() }) as IndentRecord)
          // Only approved indents may be drawn on for a PO; legacy ones are grandfathered.
          .filter((indent) => indentReservesQuantity(indent) && indent.items?.length);

        setMapping({ ...mappingData, globalProjectName });
        setVendors(
          vendorSnapshot.docs
            .map((d) => ({ id: d.id, ...d.data() }) as Vendor)
            .filter((vendor) => vendor.status === "Active")
            .sort((a, b) => a.vendorName.localeCompare(b.vendorName)),
        );
        setRfqs(rfqRows);
        setExpandedRfqs(new Set(rfqRows.map((r) => r.id)));
        setQuotesByRfq(Object.fromEntries(quotesEntries));
        setIndents(indentRows);
        setExpandedIndents(new Set(indentRows.map((i) => i.id)));
        setBoqItems(boqSnapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as BoqItem));
        setExistingPurchaseOrders(poSnapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as PurchaseOrder));
        setMdlRequiredBoqItemIds(
          new Set(
            boqSnapshot.docs
              .filter((d) => String((d.data() as Record<string, unknown>).MDL ?? "").trim().toLowerCase() === "yes")
              .map((d) => d.id),
          ),
        );
        setMdlDrawingsByBoqItemId(
          new Map(mdlSnapshot.docs.map((d) => [d.id, { id: d.id, ...d.data() } as MdlDrawing])),
        );
      } catch (error) {
        console.error("Failed to load data for new purchase order:", error);
        toast({
          title: "Unable to load project data",
          description: error instanceof Error ? error.message : "Please try again.",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, [canAdd, isAuthLoading, mappingId, toast]);

  // RFQ item selections are vendor-specific quotes, so reset them if the vendor changes.
  useEffect(() => {
    setSelectedRfqItems({});
  }, [vendorId]);

  const selectedVendor = useMemo(() => vendors.find((v) => v.id === vendorId) ?? null, [vendors, vendorId]);

  const availableRfqSections = useMemo(() => {
    if (!vendorId) return [];
    return rfqs
      .map((rfq) => {
        const quote = quotesByRfq[rfq.id]?.find((q) => q.vendorId === vendorId && q.status === "Received");
        if (!quote) return { rfq, items: [] as RfqItem[], quote: null as RfqQuote | null };
        const items = rfq.items.filter(
          (item) => !item.poId && quote.items.some((qi) => qi.rfqItemId === item.rfqItemId && qi.rate > 0),
        );
        return { rfq, items, quote };
      })
      .filter((entry) => entry.items.length > 0);
  }, [rfqs, quotesByRfq, vendorId]);

  // Purchase orders are raised for supply items only — the BOQ picker is scoped to Scope 2 = Supply.
  const supplyBoqItems = useMemo(
    () =>
      boqItems
        .filter((item) => String(item["Scope 2"] ?? "").trim().toLowerCase() === "supply")
        .sort((a, b) =>
          String(a["ERP SL NO"] ?? "").localeCompare(String(b["ERP SL NO"] ?? ""), undefined, { numeric: true }),
        ),
    [boqItems],
  );

  const filteredBoqItems = useMemo(() => {
    const q = boqSearch.trim().toLowerCase();
    if (!q) return supplyBoqItems;
    return supplyBoqItems.filter((item) =>
      String(item["ERP SL NO"] ?? "").toLowerCase().includes(q) ||
      String(item["BOQ SL No"] ?? "").toLowerCase().includes(q) ||
      String(item.Description ?? "").toLowerCase().includes(q),
    );
  }, [supplyBoqItems, boqSearch]);

  const toggleRfqExpanded = (rfqId: string) => {
    setExpandedRfqs((current) => {
      const next = new Set(current);
      next.has(rfqId) ? next.delete(rfqId) : next.add(rfqId);
      return next;
    });
  };

  const toggleIndentExpanded = (indentId: string) => {
    setExpandedIndents((current) => {
      const next = new Set(current);
      next.has(indentId) ? next.delete(indentId) : next.add(indentId);
      return next;
    });
  };

  const toggleRfqItem = (rfqId: string, item: RfqItem, quote: RfqQuote | null, checked: boolean) => {
    const key = rfqItemKey(rfqId, item.rfqItemId);
    setSelectedRfqItems((current) => {
      const next = { ...current };
      if (checked) {
        const rate = quote?.items.find((qi) => qi.rfqItemId === item.rfqItemId)?.rate ?? 0;
        next[key] = { qty: String(item.qty), rate: String(rate) };
      } else {
        delete next[key];
      }
      return next;
    });
  };

  const toggleIndentItem = (indentId: string, item: IndentLineItem, checked: boolean) => {
    const key = indentItemKey(indentId, item.boqItemId);
    setSelectedIndentItems((current) => {
      const next = { ...current };
      if (checked) {
        next[key] = { qty: String(item.requestedQty), rate: item.budgetPrice ? String(item.budgetPrice) : "" };
      } else {
        delete next[key];
      }
      return next;
    });
  };

  const toggleBoqItem = (item: BoqItem, checked: boolean) => {
    setSelectedBoqItems((current) => {
      const next = { ...current };
      if (checked) {
        const rate = toNumber(item["Budget Price"] ?? item["Unit Rate"]);
        next[item.id] = { qty: "", rate: rate ? String(rate) : "" };
      } else {
        delete next[item.id];
      }
      return next;
    });
  };

  const updateSelection = (
    setter: React.Dispatch<React.SetStateAction<Record<string, Selection>>>,
    key: string,
    changes: Partial<Selection>,
  ) => {
    setter((current) => ({ ...current, [key]: { ...current[key], ...changes } }));
  };

  const toggleForceNewMdlReview = (boqItemId: string, checked: boolean) => {
    setForceNewMdlReview((current) => {
      const next = new Set(current);
      if (checked) next.add(boqItemId);
      else next.delete(boqItemId);
      return next;
    });
  };

  // An already-approved MDL drawing doesn't need another review by default — placing a PO
  // for it leaves it alone. The checkbox is only an escape hatch for the rare case where this
  // particular order does need a fresh drawing look despite the earlier approval.
  const renderMdlCell = (boqItemId?: string) => {
    if (!boqItemId || !mdlRequiredBoqItemIds.has(boqItemId)) {
      return <span className="text-xs text-muted-foreground">—</span>;
    }
    const status = mdlDrawingsByBoqItemId.get(boqItemId)?.status ?? "Pending";
    const isApproved = status === "Approved" || status === "Approved with Comments";
    return (
      <div className="flex flex-col items-start gap-1">
        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", mdlOverallStatusStyles[status])}>
          {status}
        </span>
        {isApproved && (
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Checkbox
              className="h-3.5 w-3.5"
              checked={forceNewMdlReview.has(boqItemId)}
              onCheckedChange={(checked) => toggleForceNewMdlReview(boqItemId, checked === true)}
            />
            Request new review
          </label>
        )}
      </div>
    );
  };

  const findRfqItem = (rfqId: string, rfqItemId: string) => rfqs.find((r) => r.id === rfqId)?.items.find((i) => i.rfqItemId === rfqItemId) ?? null;
  const findIndentItem = (indentId: string, boqItemId: string) => indents.find((i) => i.id === indentId)?.items.find((i) => i.boqItemId === boqItemId) ?? null;
  const findBoqItem = (boqItemId: string) => boqItems.find((b) => b.id === boqItemId) ?? null;

  const lineAmount = (sel: Selection) => Math.round(toNumber(sel.qty) * toNumber(sel.rate) * 100) / 100;
  const manualLineAmount = (row: ManualRow) => Math.round(toNumber(row.qty) * toNumber(row.rate) * 100) / 100;

  const totalAmount = useMemo(() => {
    const rfqTotal = Object.values(selectedRfqItems).reduce((sum, sel) => sum + lineAmount(sel), 0);
    const indentTotal = Object.values(selectedIndentItems).reduce((sum, sel) => sum + lineAmount(sel), 0);
    const boqTotal = Object.values(selectedBoqItems).reduce((sum, sel) => sum + lineAmount(sel), 0);
    const manualTotal = manualRows.reduce((sum, row) => sum + manualLineAmount(row), 0);
    return rfqTotal + indentTotal + boqTotal + manualTotal;
  }, [selectedRfqItems, selectedIndentItems, selectedBoqItems, manualRows]);

  const addManualRow = () => setManualRows((current) => [...current, emptyManualRow()]);
  const removeManualRow = (rowId: string) => setManualRows((current) => current.filter((row) => row.rowId !== rowId));
  const updateManualRow = (rowId: string, changes: Partial<ManualRow>) => {
    setManualRows((current) => current.map((row) => (row.rowId === rowId ? { ...row, ...changes } : row)));
  };

  const hasAnyItems =
    Object.keys(selectedRfqItems).length > 0 ||
    Object.keys(selectedIndentItems).length > 0 ||
    Object.keys(selectedBoqItems).length > 0 ||
    manualRows.length > 0;

  const handleSave = async () => {
    if (!user || !mapping || !selectedVendor) {
      toast({ title: "Select a vendor", variant: "destructive" });
      return;
    }
    if (!poDate) {
      toast({ title: "Select the PO date", variant: "destructive" });
      return;
    }
    if (!startDate || !endDate) {
      toast({ title: "Start and end dates are required", variant: "destructive" });
      return;
    }
    const missingLabel = validateFieldControlRequirements(
      "poNew",
      { vendorId, poDate, startDate, endDate, terms },
      fieldControl,
    );
    if (missingLabel) {
      toast({ title: `${missingLabel} is required`, variant: "destructive" });
      return;
    }
    if (endDate < startDate) {
      toast({ title: "End date cannot be before the start date", variant: "destructive" });
      return;
    }

    const validManualRows = manualRows.filter((row) => row.description.trim() && toNumber(row.qty) > 0);
    const rfqKeys = Object.keys(selectedRfqItems);
    const indentKeys = Object.keys(selectedIndentItems);
    const boqKeys = Object.keys(selectedBoqItems);
    if (!rfqKeys.length && !indentKeys.length && !boqKeys.length && !validManualRows.length) {
      toast({ title: "Add at least one item", variant: "destructive" });
      return;
    }
    const missingQty = [...rfqKeys, ...indentKeys, ...boqKeys].some((key) => {
      const sel = selectedRfqItems[key] ?? selectedIndentItems[key] ?? selectedBoqItems[key];
      return toNumber(sel?.qty) <= 0;
    });
    if (missingQty) {
      toast({ title: "Enter a quantity for every selected item", variant: "destructive" });
      return;
    }

    setIsSaving(true);
    try {
      const rfqSourcedItems: PurchaseOrderItem[] = rfqKeys.map((key) => {
        const [rfqId, rfqItemId] = key.split("__");
        const rfq = rfqs.find((r) => r.id === rfqId)!;
        const item = findRfqItem(rfqId, rfqItemId)!;
        const sel = selectedRfqItems[key];
        const qty = toNumber(sel.qty);
        const rate = toNumber(sel.rate);
        return {
          description: item.description,
          unit: item.unit,
          qty,
          rate,
          amount: Math.round(qty * rate * 100) / 100,
          rfqItemId: item.rfqItemId,
          sourceRfqId: rfq.id,
          sourceRfqNumber: rfq.rfqNumber,
          sourceIndentId: item.sourceIndentId,
          sourceIndentNumber: item.sourceIndentNumber,
          boqItemId: item.boqItemId,
          boqQty: boqQtyByItemId[item.boqItemId],
          indentQty: item.qty,
        };
      });

      const indentSourcedItems: PurchaseOrderItem[] = indentKeys.map((key) => {
        const [indentId, boqItemId] = key.split("__");
        const indent = indents.find((i) => i.id === indentId)!;
        const item = findIndentItem(indentId, boqItemId)!;
        const sel = selectedIndentItems[key];
        const qty = toNumber(sel.qty);
        const rate = toNumber(sel.rate);
        return {
          description: item.description,
          unit: item.unit,
          qty,
          rate,
          amount: Math.round(qty * rate * 100) / 100,
          sourceIndentId: indent.id,
          sourceIndentNumber: indent.indentNumber,
          boqItemId: item.boqItemId,
          boqQty: boqQtyByItemId[item.boqItemId],
          indentQty: item.requestedQty,
        };
      });

      const boqSourcedItems: PurchaseOrderItem[] = boqKeys.map((boqItemId) => {
        const boqItem = findBoqItem(boqItemId)!;
        const sel = selectedBoqItems[boqItemId];
        const qty = toNumber(sel.qty);
        const rate = toNumber(sel.rate);
        return {
          description: String(boqItem.Description ?? ""),
          unit: String(boqItem.Unit ?? ""),
          qty,
          rate,
          amount: Math.round(qty * rate * 100) / 100,
          boqItemId: boqItem.id,
          boqQty: toNumber(boqItem.QTY),
        };
      });

      const manualItems: PurchaseOrderItem[] = validManualRows.map((row) => ({
        description: row.description.trim(),
        unit: row.unit.trim(),
        qty: toNumber(row.qty),
        rate: toNumber(row.rate),
        amount: manualLineAmount(row),
      }));

      // Stamped once over all four sources rather than in each mapper, so a new source cannot ship
      // without line ids. Manufacturing Clearance keys its quantity ledger on these.
      const items = ensurePoLineIds([
        ...rfqSourcedItems,
        ...indentSourcedItems,
        ...boqSourcedItems,
        ...manualItems,
      ]);
      const computedTotal = items.reduce((sum, item) => sum + item.amount, 0);
      const involvedRfqIds = Array.from(new Set(rfqSourcedItems.map((item) => item.sourceRfqId!)));
      const involvedRfqNumbers = Array.from(new Set(rfqSourcedItems.map((item) => item.sourceRfqNumber!)));

      const poRef = doc(collection(db, "projects", mapping.globalProjectId, PO_COLLECTION));
      const poNumber = generatePoNumber(poDate, poRef.id);
      await setDoc(poRef, {
        poNumber,
        poDate,
        vendorId: selectedVendor.id,
        vendorName: selectedVendor.vendorName,
        vendorCode: selectedVendor.vendorCode,
        projectMappingId: mapping.id,
        projectManagementProjectName: mapping.projectName,
        projectId: mapping.globalProjectId,
        projectName: mapping.globalProjectName,
        startDate,
        endDate,
        terms: terms.trim(),
        warrantyMonths: warrantyMonths ? toNumber(warrantyMonths) : null,
        ldRatePct: ldRatePct ? toNumber(ldRatePct) : null,
        ldCapPct: ldCapPct ? toNumber(ldCapPct) : null,
        performanceSecurityPct: performanceSecurityPct ? toNumber(performanceSecurityPct) : null,
        items,
        totalAmount: computedTotal,
        status: "Draft",
        // Marks this PO as workflow-aware, so issuing it goes through approval when a workflow is
        // configured. Its absence is what grandfathers POs raised before the issue workflow
        // existed — see poIssueRequiresApproval.
        workflowEnrolled: true,
        sourceRfqIds: involvedRfqIds,
        sourceRfqNumbers: involvedRfqNumbers,
        createdAt: serverTimestamp(),
        createdBy: user.id,
        createdByName: user.name ?? "",
        updatedAt: serverTimestamp(),
      });

      // Mark the selected items as awarded on each contributing RFQ. This goes through the same
      // transactional helper the RFQ detail page's own "Confirm Awards" uses (markRfqItemsAwarded)
      // — it re-verifies none of these items were awarded by someone else a moment ago (e.g. via
      // that other flow) before writing, instead of blindly overwriting whatever state it finds.
      await Promise.all(
        involvedRfqIds.map(async (rfqId) => {
          const rfq = rfqs.find((r) => r.id === rfqId)!;
          const awards: RfqAwardEntry[] = rfq.items
            .filter((item) => selectedRfqItems[rfqItemKey(rfqId, item.rfqItemId)])
            .map((item) => {
              const sel = selectedRfqItems[rfqItemKey(rfqId, item.rfqItemId)];
              return {
                rfqItemId: item.rfqItemId,
                awardedVendorId: selectedVendor.id,
                awardedVendorName: selectedVendor.vendorName,
                awardedRate: toNumber(sel.rate),
                awardedAmount: lineAmount(sel),
              };
            });
          await markRfqItemsAwarded(db, mapping.globalProjectId, rfqId, poRef.id, awards);
        }),
      );

      // MDL is already approved by default → no new review is forced. Only items explicitly
      // flagged (and still present on this PO) get their drawing status reopened for review.
      const boqItemIdsInThisPo = new Set(items.map((item) => item.boqItemId).filter(Boolean) as string[]);
      const forcedReviewIds = Array.from(forceNewMdlReview).filter((id) => boqItemIdsInThisPo.has(id));
      if (forcedReviewIds.length) {
        const note = `Re-review requested via PO ${poNumber} (${poDate}).`;
        await Promise.all(
          forcedReviewIds.map((boqItemId) => {
            const existingRemark = mdlDrawingsByBoqItemId.get(boqItemId)?.remark;
            return setDoc(
              doc(db, "projects", mapping.globalProjectId, MDL_COLLECTION, boqItemId),
              {
                status: "Pending",
                remark: existingRemark ? `${existingRemark}\n\n${note}` : note,
                updatedAt: serverTimestamp(),
              },
              { merge: true },
            );
          }),
        );
      }

      toast({ title: "Purchase order created" });
      router.push(`/project-management/purchase-orders/${poRef.id}?project=${encodeURIComponent(mappingId)}`);
    } catch (error) {
      console.error("Failed to create purchase order:", error);
      toast({
        title: "Unable to create purchase order",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (isAuthLoading || isLoading) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] space-y-5 p-4 sm:p-6">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </main>
    );
  }

  if (!canAdd) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <h1 className="mb-6 text-2xl font-bold sm:text-3xl">Create Purchase Order</h1>
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to create purchase orders.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center p-8">
            <ShieldAlert className="h-16 w-16 text-destructive" />
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!mappingId || !mapping) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle>Select a project first</CardTitle>
            <CardDescription>Return to Project Management and choose a project before creating a purchase order.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild><Link href="/project-management">Select Project</Link></Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  // The picker columns: the description leads a phone card and the checkbox sits top-right; the
  // whole card toggles the selection, as the whole row does on a desktop.
  const rfqPickColumns = (
    rfqId: string,
    quote: RfqQuote | null,
  ): PmListColumn<RfqPickRow>[] => [
    {
      header: "",
      className: "w-10",
      mobile: "aside",
      cell: ({ id, item }) => (
        <div onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={id in selectedRfqItems}
            onCheckedChange={(value) => toggleRfqItem(rfqId, item, quote, value === true)}
          />
        </div>
      ),
    },
    { header: "BOQ SL No", className: "whitespace-nowrap text-xs text-muted-foreground", cell: ({ item }) => item.boqSlNo || "—" },
    {
      header: "Description",
      className: "min-w-[200px] max-w-xs truncate",
      mobile: "title",
      cell: ({ item }) => <span title={item.description}>{item.description}</span>,
    },
    { header: "Unit", cell: ({ item }) => item.unit || "—" },
    {
      header: "BOQ Qty",
      className: "text-muted-foreground",
      cell: ({ item }) => {
        const boqQty = boqQtyByItemId[item.boqItemId];
        return typeof boqQty === "number" ? formatQuantity(boqQty) : "—";
      },
    },
    { header: "RFQ Qty", cell: ({ item }) => formatQuantity(item.qty) },
    {
      header: "Quoted Rate",
      className: "font-medium",
      cell: ({ item }) => formatCurrency(quote?.items.find((qi) => qi.rfqItemId === item.rfqItemId)?.rate ?? 0),
    },
  ];

  const indentPickColumns = (indentId: string): PmListColumn<IndentPickRow>[] => [
    {
      header: "",
      className: "w-10",
      mobile: "aside",
      cell: ({ id, item }) => (
        <div onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={id in selectedIndentItems}
            onCheckedChange={(value) => toggleIndentItem(indentId, item, value === true)}
          />
        </div>
      ),
    },
    { header: "BOQ SL No", className: "whitespace-nowrap text-xs text-muted-foreground", cell: ({ item }) => item.boqSlNo || "—" },
    {
      header: "Description",
      className: "min-w-[200px] max-w-xs truncate",
      mobile: "title",
      cell: ({ item }) => <span title={item.description}>{item.description}</span>,
    },
    { header: "Unit", cell: ({ item }) => item.unit || "—" },
    {
      header: "BOQ Qty",
      className: "text-muted-foreground",
      cell: ({ item }) => {
        const boqQty = boqQtyByItemId[item.boqItemId];
        return typeof boqQty === "number" ? formatQuantity(boqQty) : "—";
      },
    },
    { header: "Indent Qty", cell: ({ item }) => formatQuantity(item.requestedQty) },
  ];

  const boqPickColumns: PmListColumn<BoqItem>[] = [
    {
      header: "",
      className: "w-10",
      mobile: "aside",
      cell: (item) => (
        <div onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={item.id in selectedBoqItems}
            onCheckedChange={(checked) => toggleBoqItem(item, checked === true)}
          />
        </div>
      ),
    },
    { header: "ERP SL No", className: "whitespace-nowrap text-xs text-muted-foreground", cell: (item) => String(item["ERP SL NO"] ?? "—") },
    { header: "BOQ SL No", className: "whitespace-nowrap text-xs text-muted-foreground", cell: (item) => String(item["BOQ SL No"] ?? "—") },
    {
      header: "Description",
      className: "min-w-[200px] max-w-xs truncate",
      mobile: "title",
      cell: (item) => <span title={String(item.Description ?? "")}>{String(item.Description ?? "—")}</span>,
    },
    { header: "Units", cell: (item) => String(item.Unit ?? "—") },
    { header: "QTY", cell: (item) => formatQuantity(toNumber(item.QTY)) },
    { header: "Unit Rate", cell: (item) => formatCurrency(toNumber(item["Unit Rate"])) },
    { header: "Budget Price", className: "text-muted-foreground", cell: (item) => formatCurrency(toNumber(item["Budget Price"])) },
    // The two totals are QTY times a rate already on the card, so a phone leaves them out of a
    // picker that may list hundreds of items.
    {
      header: "Total Budget Price",
      className: "text-muted-foreground",
      mobile: "omit",
      cell: (item) => formatCurrency(toNumber(item.QTY) * toNumber(item["Budget Price"])),
    },
    {
      header: "Total Amount",
      className: "font-medium",
      mobile: "omit",
      cell: (item) => formatCurrency(toNumber(item["Total Amount"]) || toNumber(item.QTY) * toNumber(item["Unit Rate"])),
    },
    { header: "Indent Qty", className: "text-muted-foreground", cell: (item) => formatQuantity(indentQtyByBoqItemId.get(item.id) ?? 0) },
    { header: "PO Qty", className: "text-muted-foreground", cell: (item) => formatQuantity(poQtyByBoqItemId.get(item.id) ?? 0) },
  ];

  const lineRows: LineRow[] = [
    ...Object.entries(selectedRfqItems).flatMap(([key, sel]): LineRow[] => {
      const [rfqId, rfqItemId] = key.split("__");
      const rfq = rfqs.find((r) => r.id === rfqId);
      const item = findRfqItem(rfqId, rfqItemId);
      if (!rfq || !item) return [];
      return [{ id: `rfq:${key}`, source: "rfq", key, sel, rfqId, rfqNumber: rfq.rfqNumber, item }];
    }),
    ...Object.entries(selectedIndentItems).flatMap(([key, sel]): LineRow[] => {
      const [indentId, boqItemId] = key.split("__");
      const indent = indents.find((i) => i.id === indentId);
      const item = findIndentItem(indentId, boqItemId);
      if (!indent || !item) return [];
      return [{ id: `indent:${key}`, source: "indent", key, sel, indentId, indentNumber: indent.indentNumber, item }];
    }),
    ...Object.entries(selectedBoqItems).flatMap(([boqItemId, sel]): LineRow[] => {
      const item = findBoqItem(boqItemId);
      if (!item) return [];
      return [{ id: `boq:${boqItemId}`, source: "boq", sel, item }];
    }),
    ...manualRows.map((row): LineRow => ({ id: `manual:${row.rowId}`, source: "manual", row })),
  ];

  const qtyInput = (line: LineRow) => {
    const className = cellInput("sm:w-24");
    switch (line.source) {
      case "rfq":
        return <Input className={className} type="number" min="0" step="0.001" value={line.sel.qty} onChange={(e) => updateSelection(setSelectedRfqItems, line.key, { qty: e.target.value })} />;
      case "indent":
        return <Input className={className} type="number" min="0" step="0.001" value={line.sel.qty} onChange={(e) => updateSelection(setSelectedIndentItems, line.key, { qty: e.target.value })} />;
      case "boq":
        return <Input className={className} type="number" min="0" step="0.001" value={line.sel.qty} onChange={(e) => updateSelection(setSelectedBoqItems, line.item.id, { qty: e.target.value })} />;
      case "manual":
        return <Input className={className} type="number" min="0" step="0.001" value={line.row.qty} onChange={(e) => updateManualRow(line.row.rowId, { qty: e.target.value })} />;
    }
  };

  const rateInput = (line: LineRow) => {
    const className = cellInput("sm:w-28");
    switch (line.source) {
      case "rfq":
        return <Input className={className} type="number" min="0" step="0.01" value={line.sel.rate} onChange={(e) => updateSelection(setSelectedRfqItems, line.key, { rate: e.target.value })} />;
      case "indent":
        return <Input className={className} type="number" min="0" step="0.01" value={line.sel.rate} onChange={(e) => updateSelection(setSelectedIndentItems, line.key, { rate: e.target.value })} />;
      case "boq":
        return <Input className={className} type="number" min="0" step="0.01" value={line.sel.rate} onChange={(e) => updateSelection(setSelectedBoqItems, line.item.id, { rate: e.target.value })} />;
      case "manual":
        return <Input className={className} type="number" min="0" step="0.01" value={line.row.rate} onChange={(e) => updateManualRow(line.row.rowId, { rate: e.target.value })} />;
    }
  };

  const removeLine = (line: LineRow) => {
    switch (line.source) {
      case "rfq":
        return toggleRfqItem(line.rfqId, line.item, null, false);
      case "indent":
        return toggleIndentItem(line.indentId, line.item, false);
      case "boq":
        return toggleBoqItem(line.item, false);
      case "manual":
        return removeManualRow(line.row.rowId);
    }
  };

  const lineColumns: PmListColumn<LineRow>[] = [
    {
      header: "Description",
      className: "min-w-[200px] max-w-xs truncate",
      mobile: "title",
      cell: (line) => {
        if (line.source === "manual") {
          return (
            <Input
              // `w-screen` gives the input a width to ask for inside a phone card's headline, which
              // otherwise sizes to its content; `max-w-full` then holds it to the space left
              // beside the amount.
              className="max-w-full font-normal max-sm:w-screen"
              value={line.row.description}
              onChange={(e) => updateManualRow(line.row.rowId, { description: e.target.value })}
              placeholder="Item description"
            />
          );
        }
        const description = line.source === "boq" ? String(line.item.Description ?? "") : line.item.description;
        return <span title={description}>{description}</span>;
      },
    },
    {
      header: "Unit",
      cell: (line) =>
        line.source === "manual" ? (
          <Input
            className={cellInput("sm:w-20")}
            value={line.row.unit}
            onChange={(e) => updateManualRow(line.row.rowId, { unit: e.target.value })}
            placeholder="Unit"
          />
        ) : line.source === "boq" ? (
          String(line.item.Unit ?? "—")
        ) : (
          line.item.unit || "—"
        ),
    },
    {
      header: "BOQ Qty",
      className: "text-muted-foreground",
      cell: (line) => {
        if (line.source === "manual") return "—";
        if (line.source === "boq") return formatQuantity(toNumber(line.item.QTY));
        const boqQty = boqQtyByItemId[line.item.boqItemId];
        return typeof boqQty === "number" ? formatQuantity(boqQty) : "—";
      },
    },
    {
      header: "Indent Qty",
      className: "text-muted-foreground",
      cell: (line) =>
        line.source === "rfq"
          ? formatQuantity(line.item.qty)
          : line.source === "indent"
            ? formatQuantity(line.item.requestedQty)
            : "—",
    },
    { header: "PO Qty", cell: qtyInput },
    { header: "Rate", cell: rateInput },
    {
      header: "Amount",
      className: "whitespace-nowrap",
      mobile: "aside",
      cell: (line) => (
        <span className="font-medium">
          {formatCurrency(line.source === "manual" ? manualLineAmount(line.row) : lineAmount(line.sel))}
        </span>
      ),
    },
    {
      header: "Source",
      className: "text-xs text-muted-foreground",
      mobile: "title",
      cell: (line) =>
        line.source === "rfq"
          ? line.rfqNumber
          : line.source === "indent"
            ? line.indentNumber
            : line.source === "boq"
              ? "BOQ"
              : "Manual",
    },
    {
      header: "MDL",
      cell: (line) =>
        line.source === "manual" ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          renderMdlCell(line.source === "boq" ? line.item.id : line.item.boqItemId)
        ),
    },
    {
      header: "",
      className: "w-12",
      mobile: "footer",
      cell: (line) => (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => removeLine(line)}
          aria-label={line.source === "manual" ? "Remove row" : "Remove item"}
        >
          <Trash2 className="h-4 w-4 text-destructive" />
          <span className="ml-2 text-destructive sm:hidden">Remove</span>
        </Button>
      ),
    },
  ];

  const saveLabel = (
    <>
      {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
      Save Purchase Order
    </>
  );

  return (
    <main className="w-full space-y-4 px-4 py-4 max-sm:[--card-pad:1rem] sm:space-y-5 sm:px-6 sm:py-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          <Button variant="ghost" size="icon" className="shrink-0" asChild>
            <Link href={`/project-management/purchase-orders?project=${encodeURIComponent(mappingId)}`} aria-label="Back to Purchase Orders">
              <ArrowLeft className="h-6 w-6" />
            </Link>
          </Button>
          <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-sm sm:flex">
            <ShoppingCart className="h-4 w-4 text-white" />
          </div>
          <h1 className="truncate text-base font-bold sm:text-xl">Create Purchase Order</h1>
        </div>
        {/* Short on a phone, where the full label is repeated at the foot of the form. */}
        <Button onClick={() => void handleSave()} disabled={isSaving} className="ml-auto">
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          <span className="sm:hidden">Save</span>
          <span className="hidden sm:inline">Save Purchase Order</span>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Purchase Order Details</CardTitle>
          <CardDescription>For {mapping.projectName}. Select the vendor this purchase order is for.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:gap-6 lg:grid-cols-4">
            <ControlledField setting={fieldControl("vendorId")} className="space-y-2">
              <Select value={vendorId} onValueChange={setVendorId}>
                <SelectTrigger id="vendor"><SelectValue placeholder="Select a vendor" /></SelectTrigger>
                <SelectContent>
                  {vendors.map((vendor) => (
                    <SelectItem key={vendor.id} value={vendor.id}>{vendor.vendorName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!vendors.length && (
                <p className="text-xs text-muted-foreground">
                  No active vendors. <Link href="/vendor-management/vendors" className="text-primary underline-offset-4 hover:underline">Add one first</Link>.
                </p>
              )}
            </ControlledField>
            <ControlledField setting={fieldControl("poDate")} className="space-y-2">
              <Input id="po-date" type="date" value={poDate} onChange={(e) => setPoDate(e.target.value)} />
            </ControlledField>
            <ControlledField setting={fieldControl("startDate")} className="space-y-2">
              <Input id="start-date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </ControlledField>
            <ControlledField setting={fieldControl("endDate")} className="space-y-2">
              <Input id="end-date" type="date" value={endDate} min={startDate || undefined} onChange={(e) => setEndDate(e.target.value)} />
            </ControlledField>
          </div>
          <ControlledField setting={fieldControl("terms")} className="mt-4 space-y-2">
            <Textarea id="terms" placeholder="Optional delivery terms, payment terms, or notes" value={terms} onChange={(e) => setTerms(e.target.value)} />
          </ControlledField>

          <div className="mt-4 space-y-1">
            <p className="text-sm font-medium">Flow-Down Terms</p>
            <p className="text-xs text-muted-foreground">
              {client
                ? `Defaulted from ${client.name}'s contract terms — checked against these again before this PO can be issued.`
                : "Map this project to a client under Settings → Clients to auto-default these from the client's contract terms."}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:gap-6 lg:grid-cols-4">
            <ControlledField setting={fieldControl("warrantyMonths")} className="space-y-2">
              <Input id="warranty-months" type="number" min="0" value={warrantyMonths} onChange={(e) => setWarrantyMonths(e.target.value)} />
            </ControlledField>
            <ControlledField setting={fieldControl("ldRatePct")} className="space-y-2">
              <Input id="ld-rate-pct" type="number" min="0" step="0.1" value={ldRatePct} onChange={(e) => setLdRatePct(e.target.value)} />
            </ControlledField>
            <ControlledField setting={fieldControl("ldCapPct")} className="space-y-2">
              <Input id="ld-cap-pct" type="number" min="0" max="100" value={ldCapPct} onChange={(e) => setLdCapPct(e.target.value)} />
            </ControlledField>
            <ControlledField setting={fieldControl("performanceSecurityPct")} className="space-y-2">
              <Input id="performance-security-pct" type="number" min="0" max="100" value={performanceSecurityPct} onChange={(e) => setPerformanceSecurityPct(e.target.value)} />
            </ControlledField>
          </div>
        </CardContent>
      </Card>

      <Card className={PHONE_BARE_CARD}>
        <CardHeader className={PHONE_BARE_CARD_SECTION}>
          <CardTitle className="flex items-center gap-2">
            <Library className="h-4 w-4" /> Add Items
          </CardTitle>
          <CardDescription>Pull items directly from an RFQ quote, an indent, or the BOQ.</CardDescription>
        </CardHeader>
        <CardContent className={PHONE_BARE_CARD_SECTION}>
          <Tabs defaultValue="rfq">
            {/* Across the full width on a phone, where "From" is dropped so all three fit. */}
            <TabsList className="w-full sm:w-auto">
              <TabsTrigger value="rfq" className="flex-1 sm:flex-none"><span className="hidden sm:inline">From&nbsp;</span>RFQ Quotes</TabsTrigger>
              <TabsTrigger value="indent" className="flex-1 sm:flex-none"><span className="hidden sm:inline">From&nbsp;</span>Indent</TabsTrigger>
              <TabsTrigger value="boq" className="flex-1 sm:flex-none"><span className="hidden sm:inline">From&nbsp;</span>BOQ</TabsTrigger>
            </TabsList>

            <TabsContent value="rfq" className="space-y-3 pt-3">
              {!vendorId ? (
                <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  Select a vendor above to see the RFQ items they&apos;ve quoted.
                </div>
              ) : availableRfqSections.length ? (
                availableRfqSections.map(({ rfq, items, quote }) => {
                  const isExpanded = expandedRfqs.has(rfq.id);
                  return (
                    // A bordered group on a desktop; on a phone a tinted heading strip with the item
                    // cards beneath it.
                    <div key={rfq.id} className="sm:rounded-lg sm:border">
                      <div className="flex items-center gap-2 rounded-lg bg-muted/30 px-2 py-1.5 sm:rounded-none sm:border-b sm:px-3 sm:py-2">
                        <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 sm:h-6 sm:w-6" onClick={() => toggleRfqExpanded(rfq.id)}>
                          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </Button>
                        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                          <span className="break-all text-sm font-semibold">{rfq.rfqNumber}</span>
                          <span className="text-xs text-muted-foreground">({items.length} quoted item{items.length === 1 ? "" : "s"} available)</span>
                        </div>
                      </div>
                      {isExpanded && (
                        <PmDataList
                          rows={items.map((item): RfqPickRow => ({ id: rfqItemKey(rfq.id, item.rfqItemId), item }))}
                          columns={rfqPickColumns(rfq.id, quote)}
                          onRowClick={({ id, item }) => toggleRfqItem(rfq.id, item, quote, !(id in selectedRfqItems))}
                          className={cn("mt-2 sm:mt-0", LIST_IN_FRAME)}
                        />
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  No quoted RFQ items available for this vendor.
                </div>
              )}
            </TabsContent>

            <TabsContent value="indent" className="space-y-3 pt-3">
              {indents.length ? indents.map((indent) => {
                const isExpanded = expandedIndents.has(indent.id);
                return (
                  <div key={indent.id} className="sm:rounded-lg sm:border">
                    <div className="flex items-center gap-2 rounded-lg bg-muted/30 px-2 py-1.5 sm:rounded-none sm:border-b sm:px-3 sm:py-2">
                      <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 sm:h-6 sm:w-6" onClick={() => toggleIndentExpanded(indent.id)}>
                        {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </Button>
                      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                        <span className="break-all text-sm font-semibold">{indent.indentNumber}</span>
                        <span className="text-xs text-muted-foreground">({indent.items.length} item{indent.items.length === 1 ? "" : "s"})</span>
                      </div>
                    </div>
                    {isExpanded && (
                      <PmDataList
                        rows={indent.items.map((item): IndentPickRow => ({ id: indentItemKey(indent.id, item.boqItemId), item }))}
                        columns={indentPickColumns(indent.id)}
                        onRowClick={({ id, item }) => toggleIndentItem(indent.id, item, !(id in selectedIndentItems))}
                        className={cn("mt-2 sm:mt-0", LIST_IN_FRAME)}
                      />
                    )}
                  </div>
                );
              }) : (
                <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  No open indents with items were found for this project.
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Rate isn&apos;t known for direct indent items — enter it in the items table below. Selecting an item here doesn&apos;t yet mark it as consumed on the indent.
              </p>
            </TabsContent>

            <TabsContent value="boq" className="space-y-3 pt-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search ERP SL No, BOQ SL No or description..." className="pl-8" value={boqSearch} onChange={(e) => setBoqSearch(e.target.value)} />
              </div>
              <p className="text-xs text-muted-foreground">Showing Scope 2 = Supply items only.</p>
              {/* The picker scrolls inside its own box at every width, so a long BOQ does not push
                  the items table out of reach: this wrapper on a phone, the table's own wrapper
                  (with its header pinned) from `sm`. */}
              <div className="max-h-[60dvh] overflow-y-auto sm:max-h-none sm:overflow-visible">
                <PmDataList
                  rows={filteredBoqItems}
                  columns={boqPickColumns}
                  onRowClick={(item) => toggleBoqItem(item, !(item.id in selectedBoqItems))}
                  maxHeightClassName="sm:max-h-96"
                  empty={<PmEmptyState title="No Scope 2 = Supply BOQ items match your search." />}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Bypasses the indent step entirely. Enter the quantity to order in the items table below.
              </p>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card className={PHONE_BARE_CARD}>
        <CardHeader className={PHONE_BARE_CARD_SECTION}>
          <CardTitle>Items</CardTitle>
          <CardDescription>Review quantities and rates, then add any extra items manually if needed.</CardDescription>
        </CardHeader>
        <CardContent className={PHONE_BARE_CARD_SECTION}>
          <PmDataList
            rows={lineRows}
            columns={lineColumns}
            empty={<PmEmptyState title="No items added yet." />}
          />

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <Button variant="outline" onClick={addManualRow} className="w-full sm:w-auto">
              <Plus className="mr-2 h-4 w-4" /> Add Manual Item
            </Button>
            <span className="ml-auto text-sm text-muted-foreground">
              Total Amount: <span className="font-semibold text-foreground">{formatCurrency(totalAmount)}</span>
            </span>
          </div>
        </CardContent>
      </Card>

      {/* A phone has scrolled well past the header's Save by the time the items are in. */}
      <PmFormActions className="sm:hidden">
        <Button onClick={() => void handleSave()} disabled={isSaving}>
          {saveLabel}
        </Button>
      </PmFormActions>
    </main>
  );
}

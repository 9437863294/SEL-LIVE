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
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PO_COLLECTION,
  PO_PERMISSION_RESOURCE,
  formatCurrency,
  formatQuantity,
  generatePoNumber,
  toNumber,
  type PurchaseOrderItem,
} from "@/lib/purchase-orders";
import { RFQ_COLLECTION, RFQ_QUOTES_SUBCOLLECTION, type RfqItem, type RfqQuote, type RfqStatus } from "@/lib/rfq";
import { VENDOR_COLLECTIONS, type Vendor } from "@/lib/vendor-management";

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

  const [mapping, setMapping] = useState<ProjectMapping | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [rfqs, setRfqs] = useState<RfqWithItems[]>([]);
  const [quotesByRfq, setQuotesByRfq] = useState<Record<string, RfqQuote[]>>({});
  const [indents, setIndents] = useState<IndentRecord[]>([]);
  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [expandedRfqs, setExpandedRfqs] = useState<Set<string>>(new Set());
  const [expandedIndents, setExpandedIndents] = useState<Set<string>>(new Set());
  const [boqSearch, setBoqSearch] = useState("");

  const [poDate, setPoDate] = useState(today());
  const [vendorId, setVendorId] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [terms, setTerms] = useState("");
  const [selectedRfqItems, setSelectedRfqItems] = useState<Record<string, Selection>>({});
  const [selectedIndentItems, setSelectedIndentItems] = useState<Record<string, Selection>>({});
  const [selectedBoqItems, setSelectedBoqItems] = useState<Record<string, Selection>>({});
  const [manualRows, setManualRows] = useState<ManualRow[]>([]);

  const boqQtyByItemId = useMemo(
    () => Object.fromEntries(boqItems.map((item) => [item.id, toNumber(item.QTY)])),
    [boqItems],
  );

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

        const [projectSnapshot, vendorSnapshot, rfqSnapshot, indentSnapshot, boqSnapshot] = await Promise.all([
          getDoc(doc(db, "projects", mappingData.globalProjectId)),
          getDocs(collection(db, VENDOR_COLLECTIONS.vendors)),
          getDocs(collection(db, "projects", mappingData.globalProjectId, RFQ_COLLECTION)),
          getDocs(collection(db, "projects", mappingData.globalProjectId, "indents")),
          getDocs(collection(db, "projects", mappingData.globalProjectId, "boqItems")),
        ]);
        const globalProjectName =
          (projectSnapshot.data()?.projectName as string | undefined) ?? mappingData.globalProjectName;

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
          .filter((indent) => !["Rejected", "Cancelled"].includes(indent.status) && indent.items?.length);

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

  const filteredBoqItems = useMemo(() => {
    const q = boqSearch.trim().toLowerCase();
    if (!q) return boqItems;
    return boqItems.filter((item) =>
      String(item["BOQ SL No"] ?? "").toLowerCase().includes(q) ||
      String(item.Description ?? "").toLowerCase().includes(q),
    );
  }, [boqItems, boqSearch]);

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
    if (deliveryDate && deliveryDate < poDate) {
      toast({ title: "Delivery date cannot be before the PO date", variant: "destructive" });
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

      const items = [...rfqSourcedItems, ...indentSourcedItems, ...boqSourcedItems, ...manualItems];
      const computedTotal = items.reduce((sum, item) => sum + item.amount, 0);
      const involvedRfqIds = Array.from(new Set(rfqSourcedItems.map((item) => item.sourceRfqId!)));
      const involvedRfqNumbers = Array.from(new Set(rfqSourcedItems.map((item) => item.sourceRfqNumber!)));

      const poRef = doc(collection(db, "projects", mapping.globalProjectId, PO_COLLECTION));
      await setDoc(poRef, {
        poNumber: generatePoNumber(poDate, poRef.id),
        poDate,
        vendorId: selectedVendor.id,
        vendorName: selectedVendor.vendorName,
        vendorCode: selectedVendor.vendorCode,
        projectMappingId: mapping.id,
        projectManagementProjectName: mapping.projectName,
        projectId: mapping.globalProjectId,
        projectName: mapping.globalProjectName,
        deliveryDate,
        terms: terms.trim(),
        items,
        totalAmount: computedTotal,
        status: "Draft",
        sourceRfqIds: involvedRfqIds,
        sourceRfqNumbers: involvedRfqNumbers,
        createdAt: serverTimestamp(),
        createdBy: user.id,
        createdByName: user.name ?? "",
        updatedAt: serverTimestamp(),
      });

      // Mark the selected items as awarded on each contributing RFQ.
      await Promise.all(
        involvedRfqIds.map(async (rfqId) => {
          const rfq = rfqs.find((r) => r.id === rfqId)!;
          const updatedItems = rfq.items.map((item) => {
            const key = rfqItemKey(rfqId, item.rfqItemId);
            const sel = selectedRfqItems[key];
            if (!sel) return item;
            return {
              ...item,
              awardedVendorId: selectedVendor.id,
              awardedVendorName: selectedVendor.vendorName,
              awardedRate: toNumber(sel.rate),
              awardedAmount: lineAmount(sel),
              poId: poRef.id,
            };
          });
          const allAwarded = updatedItems.every((item) => item.awardedVendorId);
          const nextStatus: RfqStatus = allAwarded ? "Awarded" : "Partially Awarded";
          await setDoc(
            doc(db, "projects", mapping.globalProjectId, RFQ_COLLECTION, rfqId),
            { items: updatedItems, status: nextStatus, updatedAt: serverTimestamp() },
            { merge: true },
          );
        }),
      );

      toast({ title: "Purchase order created" });
      router.push(`/project-management/purchase-orders/${poRef.id}?project=${encodeURIComponent(mappingId)}`);
    } catch (error) {
      console.error("Failed to create purchase order:", error);
      toast({ title: "Unable to create purchase order", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  if (isAuthLoading || isLoading) {
    return (
      <main className="min-h-[calc(100vh-4rem)] space-y-5 p-4 sm:p-6">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </main>
    );
  }

  if (!canAdd) {
    return (
      <main className="min-h-[calc(100vh-4rem)] p-4 sm:p-6">
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
      <main className="min-h-[calc(100vh-4rem)] p-4 sm:p-6">
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

  return (
    <main className="w-full space-y-5 px-4 py-4 sm:px-6 sm:py-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/project-management/purchase-orders?project=${encodeURIComponent(mappingId)}`} aria-label="Back to Purchase Orders">
              <ArrowLeft className="h-6 w-6" />
            </Link>
          </Button>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-sm">
            <ShoppingCart className="h-4 w-4 text-white" />
          </div>
          <h1 className="text-xl font-bold">Create Purchase Order</h1>
        </div>
        <Button onClick={() => void handleSave()} disabled={isSaving}>
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save Purchase Order
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Purchase Order Details</CardTitle>
          <CardDescription>For {mapping.projectName}. Select the vendor this purchase order is for.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="vendor">Vendor *</Label>
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
            </div>
            <div className="space-y-2">
              <Label htmlFor="po-date">PO Date</Label>
              <Input id="po-date" type="date" value={poDate} onChange={(e) => setPoDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="delivery-date">Delivery Date</Label>
              <Input id="delivery-date" type="date" value={deliveryDate} min={poDate || undefined} onChange={(e) => setDeliveryDate(e.target.value)} />
            </div>
          </div>
          <div className="mt-4 space-y-2">
            <Label htmlFor="terms">Terms / Remarks</Label>
            <Textarea id="terms" placeholder="Optional delivery terms, payment terms, or notes" value={terms} onChange={(e) => setTerms(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Library className="h-4 w-4" /> Add Items
          </CardTitle>
          <CardDescription>Pull items directly from an RFQ quote, an indent, or the BOQ.</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="rfq">
            <TabsList>
              <TabsTrigger value="rfq">From RFQ Quotes</TabsTrigger>
              <TabsTrigger value="indent">From Indent</TabsTrigger>
              <TabsTrigger value="boq">From BOQ</TabsTrigger>
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
                    <div key={rfq.id} className="rounded-lg border">
                      <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2">
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => toggleRfqExpanded(rfq.id)}>
                          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </Button>
                        <span className="text-sm font-semibold">{rfq.rfqNumber}</span>
                        <span className="text-xs text-muted-foreground">({items.length} quoted item{items.length === 1 ? "" : "s"} available)</span>
                      </div>
                      {isExpanded && (
                        <div className="divide-y">
                          {items.map((item) => {
                            const key = rfqItemKey(rfq.id, item.rfqItemId);
                            const quotedRate = quote?.items.find((qi) => qi.rfqItemId === item.rfqItemId)?.rate ?? 0;
                            const boqQty = boqQtyByItemId[item.boqItemId];
                            return (
                              <label key={key} className="flex flex-wrap items-center gap-3 px-4 py-2 hover:bg-muted/30 cursor-pointer">
                                <Checkbox
                                  checked={key in selectedRfqItems}
                                  onCheckedChange={(checked) => toggleRfqItem(rfq.id, item, quote, checked === true)}
                                />
                                <span className="w-20 shrink-0 text-xs text-muted-foreground">{item.boqSlNo || "—"}</span>
                                <span className="min-w-[160px] flex-1 truncate text-sm">{item.description}</span>
                                <span className="shrink-0 text-xs text-muted-foreground">BOQ: {typeof boqQty === "number" ? formatQuantity(boqQty) : "—"}</span>
                                <span className="shrink-0 text-xs text-muted-foreground">Indent: {formatQuantity(item.qty)} {item.unit}</span>
                                <span className="shrink-0 text-xs font-medium text-foreground">{formatCurrency(quotedRate)}</span>
                              </label>
                            );
                          })}
                        </div>
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
                  <div key={indent.id} className="rounded-lg border">
                    <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2">
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => toggleIndentExpanded(indent.id)}>
                        {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </Button>
                      <span className="text-sm font-semibold">{indent.indentNumber}</span>
                      <span className="text-xs text-muted-foreground">({indent.items.length} item{indent.items.length === 1 ? "" : "s"})</span>
                    </div>
                    {isExpanded && (
                      <div className="divide-y">
                        {indent.items.map((item) => {
                          const key = indentItemKey(indent.id, item.boqItemId);
                          const boqQty = boqQtyByItemId[item.boqItemId];
                          return (
                            <label key={key} className="flex flex-wrap items-center gap-3 px-4 py-2 hover:bg-muted/30 cursor-pointer">
                              <Checkbox
                                checked={key in selectedIndentItems}
                                onCheckedChange={(checked) => toggleIndentItem(indent.id, item, checked === true)}
                              />
                              <span className="w-20 shrink-0 text-xs text-muted-foreground">{item.boqSlNo || "—"}</span>
                              <span className="min-w-[160px] flex-1 truncate text-sm">{item.description}</span>
                              <span className="shrink-0 text-xs text-muted-foreground">BOQ: {typeof boqQty === "number" ? formatQuantity(boqQty) : "—"}</span>
                              <span className="shrink-0 text-xs text-muted-foreground">Indent: {formatQuantity(item.requestedQty)} {item.unit}</span>
                            </label>
                          );
                        })}
                      </div>
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
                <Input placeholder="Search BOQ SL No or description..." className="pl-8" value={boqSearch} onChange={(e) => setBoqSearch(e.target.value)} />
              </div>
              <div className="max-h-80 overflow-y-auto rounded-lg border">
                <div className="divide-y">
                  {filteredBoqItems.length ? filteredBoqItems.map((item) => (
                    <label key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-2 hover:bg-muted/30 cursor-pointer">
                      <Checkbox
                        checked={item.id in selectedBoqItems}
                        onCheckedChange={(checked) => toggleBoqItem(item, checked === true)}
                      />
                      <span className="w-20 shrink-0 text-xs text-muted-foreground">{String(item["BOQ SL No"] ?? "—")}</span>
                      <span className="min-w-[160px] flex-1 truncate text-sm">{String(item.Description ?? "")}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">BOQ: {formatQuantity(toNumber(item.QTY))} {String(item.Unit ?? "")}</span>
                    </label>
                  )) : (
                    <div className="p-6 text-center text-sm text-muted-foreground">No BOQ items match your search.</div>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Bypasses the indent step entirely. Enter the quantity to order in the items table below.
              </p>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
          <CardDescription>Review quantities and rates, then add any extra items manually if needed.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[200px]">Description</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>BOQ Qty</TableHead>
                  <TableHead>Indent Qty</TableHead>
                  <TableHead>PO Qty</TableHead>
                  <TableHead>Rate</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(selectedRfqItems).map(([key, sel]) => {
                  const [rfqId, rfqItemId] = key.split("__");
                  const rfq = rfqs.find((r) => r.id === rfqId);
                  const item = findRfqItem(rfqId, rfqItemId);
                  if (!rfq || !item) return null;
                  const boqQty = boqQtyByItemId[item.boqItemId];
                  return (
                    <TableRow key={key}>
                      <TableCell className="max-w-xs truncate" title={item.description}>{item.description}</TableCell>
                      <TableCell>{item.unit || "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{typeof boqQty === "number" ? formatQuantity(boqQty) : "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{formatQuantity(item.qty)}</TableCell>
                      <TableCell>
                        <Input className="w-24" type="number" min="0" step="0.001" value={sel.qty} onChange={(e) => updateSelection(setSelectedRfqItems, key, { qty: e.target.value })} />
                      </TableCell>
                      <TableCell>
                        <Input className="w-28" type="number" min="0" step="0.01" value={sel.rate} onChange={(e) => updateSelection(setSelectedRfqItems, key, { rate: e.target.value })} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-medium">{formatCurrency(lineAmount(sel))}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{rfq.rfqNumber}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => toggleRfqItem(rfqId, item, null, false)} aria-label="Remove item">
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}

                {Object.entries(selectedIndentItems).map(([key, sel]) => {
                  const [indentId, boqItemId] = key.split("__");
                  const indent = indents.find((i) => i.id === indentId);
                  const item = findIndentItem(indentId, boqItemId);
                  if (!indent || !item) return null;
                  const boqQty = boqQtyByItemId[item.boqItemId];
                  return (
                    <TableRow key={key}>
                      <TableCell className="max-w-xs truncate" title={item.description}>{item.description}</TableCell>
                      <TableCell>{item.unit || "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{typeof boqQty === "number" ? formatQuantity(boqQty) : "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{formatQuantity(item.requestedQty)}</TableCell>
                      <TableCell>
                        <Input className="w-24" type="number" min="0" step="0.001" value={sel.qty} onChange={(e) => updateSelection(setSelectedIndentItems, key, { qty: e.target.value })} />
                      </TableCell>
                      <TableCell>
                        <Input className="w-28" type="number" min="0" step="0.01" value={sel.rate} onChange={(e) => updateSelection(setSelectedIndentItems, key, { rate: e.target.value })} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-medium">{formatCurrency(lineAmount(sel))}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{indent.indentNumber}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => toggleIndentItem(indentId, item, false)} aria-label="Remove item">
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}

                {Object.entries(selectedBoqItems).map(([boqItemId, sel]) => {
                  const item = findBoqItem(boqItemId);
                  if (!item) return null;
                  return (
                    <TableRow key={boqItemId}>
                      <TableCell className="max-w-xs truncate" title={String(item.Description ?? "")}>{String(item.Description ?? "")}</TableCell>
                      <TableCell>{String(item.Unit ?? "—")}</TableCell>
                      <TableCell className="text-muted-foreground">{formatQuantity(toNumber(item.QTY))}</TableCell>
                      <TableCell className="text-muted-foreground">—</TableCell>
                      <TableCell>
                        <Input className="w-24" type="number" min="0" step="0.001" value={sel.qty} onChange={(e) => updateSelection(setSelectedBoqItems, boqItemId, { qty: e.target.value })} />
                      </TableCell>
                      <TableCell>
                        <Input className="w-28" type="number" min="0" step="0.01" value={sel.rate} onChange={(e) => updateSelection(setSelectedBoqItems, boqItemId, { rate: e.target.value })} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-medium">{formatCurrency(lineAmount(sel))}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">BOQ</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => toggleBoqItem(item, false)} aria-label="Remove item">
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}

                {manualRows.map((row) => (
                  <TableRow key={row.rowId}>
                    <TableCell>
                      <Input value={row.description} onChange={(e) => updateManualRow(row.rowId, { description: e.target.value })} placeholder="Item description" />
                    </TableCell>
                    <TableCell>
                      <Input className="w-20" value={row.unit} onChange={(e) => updateManualRow(row.rowId, { unit: e.target.value })} placeholder="Unit" />
                    </TableCell>
                    <TableCell className="text-muted-foreground">—</TableCell>
                    <TableCell className="text-muted-foreground">—</TableCell>
                    <TableCell>
                      <Input className="w-24" type="number" min="0" step="0.001" value={row.qty} onChange={(e) => updateManualRow(row.rowId, { qty: e.target.value })} />
                    </TableCell>
                    <TableCell>
                      <Input className="w-28" type="number" min="0" step="0.01" value={row.rate} onChange={(e) => updateManualRow(row.rowId, { rate: e.target.value })} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-medium">{formatCurrency(manualLineAmount(row))}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">Manual</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => removeManualRow(row.rowId)} aria-label="Remove row">
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}

                {!hasAnyItems && (
                  <TableRow>
                    <TableCell colSpan={9} className="h-20 text-center text-sm text-muted-foreground">
                      No items added yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <Button variant="outline" onClick={addManualRow}>
              <Plus className="mr-2 h-4 w-4" /> Add Manual Item
            </Button>
            <span className="text-sm text-muted-foreground">
              Total Amount: <span className="font-semibold text-foreground">{formatCurrency(totalAmount)}</span>
            </span>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

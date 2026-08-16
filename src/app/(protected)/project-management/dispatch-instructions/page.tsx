"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, Loader2, ShieldAlert, Truck } from "lucide-react";
import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { BoqItem } from "@/lib/types";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import { logUserActivity } from "@/lib/activity-logger";
import { SupplyGateNav } from "@/components/project-management/supply-gate-nav";
import { PO_COLLECTION, formatQuantity, type PurchaseOrder } from "@/lib/purchase-orders";
import { computeSerialSubsetCheck, formatSerialList, parseSerialList } from "@/lib/serial-tracking";
import {
  DI_COLLECTION,
  DI_PERMISSION_RESOURCE,
  INSPECTION_COLLECTION,
  MDCC_COLLECTION,
  buildPoPlacedItems,
  canIssueDi,
  computeDiPath,
  diStatusStyles,
  emptySiteReadiness,
  formatGateDate,
  gateDaysSince,
  isInspectionRequired,
  isSiteReady,
  mdccStatusStyles,
  type DiRecord,
  type InspectionRecord,
  type MdccRecord,
  type PoPlacedItem,
  type SiteReadinessCheck,
} from "@/lib/supply-gates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";

type ProjectMapping = {
  id: string;
  projectName: string;
  globalProjectId: string;
  globalProjectName: string;
};

const getBoqSlNo = (item: BoqItem) => String(item["BOQ SL No"] ?? item["SL. No."] ?? "");

const toNumber = (value: unknown) => {
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

// A DI issued more than this many days ago with no dispatch recorded shows up in the aging
// banner — the spec's own DI Worklist example ("3 DIs issued more than 5 days ago...").
const DISPATCH_BY_AGING_THRESHOLD_DAYS = 5;

export default function DispatchInstructionsPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const canView = can("View", DI_PERMISSION_RESOURCE) || can("View", "Project Management.BOQ");
  const canIssue = can("Issue", DI_PERMISSION_RESOURCE);
  const canAcknowledge = can("Acknowledge", DI_PERMISSION_RESOURCE);
  const canDispatch = can("Dispatch", DI_PERMISSION_RESOURCE);

  const [mapping, setMapping] = useState<ProjectMapping | null>(null);
  const [placedItems, setPlacedItems] = useState<Map<string, PoPlacedItem>>(new Map());
  const [mdccRecords, setMdccRecords] = useState<Map<string, MdccRecord>>(new Map());
  const [inspections, setInspections] = useState<Map<string, InspectionRecord>>(new Map());
  const [diRecords, setDiRecords] = useState<Map<string, DiRecord>>(new Map());
  // The direct path: items whose BOQ line explicitly says "Inspection Required: No" can be
  // dispatched straight off the PO, bypassing MDCC entirely — see isInspectionRequired().
  const [inspectionRequiredByBoqItemId, setInspectionRequiredByBoqItemId] = useState<Map<string, boolean>>(new Map());
  const [budgetPriceByBoqItemId, setBudgetPriceByBoqItemId] = useState<Map<string, number>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [issueItem, setIssueItem] = useState<PoPlacedItem | null>(null);
  const [diNumber, setDiNumber] = useState("");
  const [dispatchQty, setDispatchQty] = useState("");
  const [consignee, setConsignee] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [siteContact, setSiteContact] = useState("");
  const [siteContactPhone, setSiteContactPhone] = useState("");
  const [dispatchByDate, setDispatchByDate] = useState(today());
  const [expectedArrival, setExpectedArrival] = useState("");
  const [transportArrangedBy, setTransportArrangedBy] = useState("");
  const [freightBasis, setFreightBasis] = useState("");
  const [documentsRequired, setDocumentsRequired] = useState("");
  const [remarks, setRemarks] = useState("");
  const [siteReadiness, setSiteReadiness] = useState<SiteReadinessCheck[]>(emptySiteReadiness());
  const [dispatchSerialsText, setDispatchSerialsText] = useState("");

  const loadData = useCallback(async () => {
    if (!mappingId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const mappingSnapshot = await getDoc(doc(db, "projectManagementProjects", mappingId));
      if (!mappingSnapshot.exists()) {
        setMapping(null);
        return;
      }
      const mappingData = { id: mappingSnapshot.id, ...mappingSnapshot.data() } as ProjectMapping;
      setMapping(mappingData);

      const [poSnapshot, boqSnapshot, mdccSnapshot, inspectionSnapshot, diSnapshot] = await Promise.all([
        getDocs(collection(db, "projects", mappingData.globalProjectId, PO_COLLECTION)),
        getDocs(collection(db, "projects", mappingData.globalProjectId, "boqItems")),
        getDocs(collection(db, "projects", mappingData.globalProjectId, MDCC_COLLECTION)),
        getDocs(collection(db, "projects", mappingData.globalProjectId, INSPECTION_COLLECTION)),
        getDocs(collection(db, "projects", mappingData.globalProjectId, DI_COLLECTION)),
      ]);

      const purchaseOrders = poSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as PurchaseOrder);
      const placed = buildPoPlacedItems(purchaseOrders);
      const boqSlNoByBoqItemId = new Map(
        boqSnapshot.docs.map((item) => [item.id, getBoqSlNo({ id: item.id, ...item.data() } as BoqItem)]),
      );
      placed.forEach((item, boqItemId) => {
        item.boqSlNo = boqSlNoByBoqItemId.get(boqItemId) ?? "";
      });
      setPlacedItems(placed);
      setBudgetPriceByBoqItemId(
        new Map(boqSnapshot.docs.map((item) => [item.id, toNumber((item.data() as Record<string, unknown>)["Budget Price"])])),
      );
      setInspectionRequiredByBoqItemId(
        new Map(
          boqSnapshot.docs.map((item) => [
            item.id,
            isInspectionRequired((item.data() as Record<string, unknown>)["Inspection Required"]),
          ]),
        ),
      );

      setMdccRecords(
        new Map(mdccSnapshot.docs.map((item) => [item.id, { id: item.id, ...item.data() } as MdccRecord])),
      );
      setInspections(
        new Map(inspectionSnapshot.docs.map((item) => [item.id, { id: item.id, ...item.data() } as InspectionRecord])),
      );
      setDiRecords(new Map(diSnapshot.docs.map((item) => [item.id, { id: item.id, ...item.data() } as DiRecord])));
    } catch (error) {
      console.error("Failed to load Dispatch Instruction data:", error);
      toast({ title: "Unable to load Dispatch Instruction data", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [mappingId, toast]);

  useEffect(() => {
    if (isAuthLoading || !canView) {
      setIsLoading(false);
      return;
    }
    void loadData();
  }, [canView, isAuthLoading, loadData]);

  // Candidates are items whose MDCC has actually been issued (the gated path), or whose BOQ line
  // is explicitly flagged as not requiring inspection/client clearance (the direct path).
  const rows = useMemo(
    () =>
      Array.from(placedItems.values())
        .filter((item) => {
          const inspectionRequired = inspectionRequiredByBoqItemId.get(item.boqItemId) ?? true;
          return canIssueDi(mdccRecords.get(item.boqItemId)?.status, inspectionRequired) || diRecords.has(item.boqItemId);
        })
        .sort((a, b) => a.boqSlNo.localeCompare(b.boqSlNo, undefined, { numeric: true })),
    [placedItems, mdccRecords, inspectionRequiredByBoqItemId, diRecords],
  );

  // The spec's own DI Worklist headline exception: DIs issued (or acknowledged) but sitting
  // undispatched past the threshold — SEL's own instruction going nowhere, not a client delay.
  const notYetDispatched = useMemo(() => {
    let value = 0;
    let oldestDays = 0;
    let count = 0;
    rows.forEach((item) => {
      const di = diRecords.get(item.boqItemId);
      if (!di || di.status === "Pending" || di.status === "Dispatched") return;
      const days = gateDaysSince(di.issuedOn) ?? 0;
      if (days < DISPATCH_BY_AGING_THRESHOLD_DAYS) return;
      count += 1;
      value += (di.dispatchQty ?? 0) * (budgetPriceByBoqItemId.get(item.boqItemId) ?? 0);
      if (days > oldestDays) oldestDays = days;
    });
    return { value, oldestDays, count };
  }, [rows, diRecords, budgetPriceByBoqItemId]);

  const openIssue = (item: PoPlacedItem) => {
    setIssueItem(item);
    const existing = diRecords.get(item.boqItemId);
    const inspection = inspections.get(item.boqItemId);
    const ceiling = inspection?.qtyAccepted ?? item.qty;
    setDiNumber(existing?.diNumber ?? "");
    setDispatchQty(existing?.dispatchQty != null ? String(existing.dispatchQty) : String(ceiling));
    setConsignee(existing?.consignee ?? "");
    setDeliveryAddress(existing?.deliveryAddress ?? "");
    setSiteContact(existing?.siteContact ?? "");
    setSiteContactPhone(existing?.siteContactPhone ?? "");
    setDispatchByDate(existing?.dispatchByDate || today());
    setExpectedArrival(existing?.expectedArrival ?? "");
    setTransportArrangedBy(existing?.transportArrangedBy ?? "");
    setFreightBasis(existing?.freightBasis ?? "");
    setDocumentsRequired(existing?.documentsRequired ?? "");
    setRemarks(existing?.remarks ?? "");
    setSiteReadiness(existing?.siteReadiness?.length ? existing.siteReadiness : emptySiteReadiness());
    setDispatchSerialsText(formatSerialList(existing?.dispatchSerials));
  };

  const toggleSiteReadiness = (key: string, confirmed: boolean) =>
    setSiteReadiness((current) => current.map((item) => (item.key === key ? { ...item, confirmed } : item)));

  const siteReady = isSiteReady(siteReadiness);
  const issueInspection = issueItem ? inspections.get(issueItem.boqItemId) : undefined;
  const issueCeiling = issueItem ? issueInspection?.qtyAccepted ?? issueItem.qty : 0;
  const issuePath = issueItem
    ? computeDiPath(inspectionRequiredByBoqItemId.get(issueItem.boqItemId) ?? true)
    : "mdcc_gated";
  const parsedDispatchSerials = useMemo(() => parseSerialList(dispatchSerialsText), [dispatchSerialsText]);
  const dispatchSerialCheck = useMemo(
    () => computeSerialSubsetCheck(parsedDispatchSerials, issueInspection?.serials ?? []),
    [parsedDispatchSerials, issueInspection],
  );

  const handleIssue = async () => {
    if (!mapping || !user || !issueItem) return;
    if (!diNumber.trim()) {
      toast({ title: "DI number is required", variant: "destructive" });
      return;
    }
    const qty = Number(dispatchQty);
    if (!Number.isFinite(qty) || qty <= 0 || qty > issueCeiling) {
      toast({
        title: "Enter a valid dispatch quantity",
        description: `Must be between 0 and ${formatQuantity(issueCeiling)} (inspection accepted).`,
        variant: "destructive",
      });
      return;
    }
    if (!consignee.trim()) {
      toast({ title: "Consignee is required", variant: "destructive" });
      return;
    }
    if (!siteReady) {
      toast({
        title: "Site readiness not confirmed",
        description: "All site readiness items must be confirmed before the DI can be issued.",
        variant: "destructive",
      });
      return;
    }
    if (!dispatchSerialCheck.valid) {
      toast({
        title: "Dispatch serials not covered by inspection",
        description: `Not inspected: ${dispatchSerialCheck.extra.join(", ")}`,
        variant: "destructive",
      });
      return;
    }
    setIsSaving(true);
    try {
      const existingStatus = diRecords.get(issueItem.boqItemId)?.status;
      await setDoc(
        doc(db, "projects", mapping.globalProjectId, DI_COLLECTION, issueItem.boqItemId),
        {
          boqItemId: issueItem.boqItemId,
          boqSlNo: issueItem.boqSlNo,
          description: issueItem.description,
          poId: issueItem.poId,
          poNumber: issueItem.poNumber,
          status: existingStatus && existingStatus !== "Pending" ? existingStatus : "Issued",
          path: issuePath,
          diNumber: diNumber.trim(),
          dispatchQty: qty,
          dispatchSerials: parsedDispatchSerials,
          consignee: consignee.trim(),
          deliveryAddress: deliveryAddress.trim(),
          siteContact: siteContact.trim(),
          siteContactPhone: siteContactPhone.trim(),
          dispatchByDate,
          expectedArrival: expectedArrival || null,
          transportArrangedBy: transportArrangedBy.trim(),
          freightBasis: freightBasis.trim(),
          documentsRequired: documentsRequired.trim(),
          remarks: remarks.trim(),
          siteReadiness,
          siteReadinessConfirmedBy: user.id,
          siteReadinessConfirmedByName: user.name,
          siteReadinessConfirmedOn: today(),
          issuedBy: user.id,
          issuedByName: user.name,
          issuedOn: today(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      void logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: "Project Management",
        action: "Issue Dispatch Instruction",
        details: { project: mapping.projectName, boqSlNo: issueItem.boqSlNo, poNumber: issueItem.poNumber, diNumber: diNumber.trim() },
      });
      toast({ title: "Dispatch Instruction issued" });
      setIssueItem(null);
      await loadData();
    } catch (error) {
      console.error("Failed to issue Dispatch Instruction:", error);
      toast({ title: "Unable to issue Dispatch Instruction", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const markStatus = async (item: PoPlacedItem, status: "Acknowledged" | "Dispatched") => {
    if (!mapping || !user) return;
    setIsSaving(true);
    try {
      await setDoc(
        doc(db, "projects", mapping.globalProjectId, DI_COLLECTION, item.boqItemId),
        {
          status,
          ...(status === "Acknowledged" ? { acknowledgedOn: today() } : { dispatchedOn: today() }),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      void logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: "Project Management",
        action: `Mark DI ${status}`,
        details: { project: mapping.projectName, boqSlNo: item.boqSlNo, poNumber: item.poNumber },
      });
      toast({ title: `DI marked ${status.toLowerCase()}` });
      await loadData();
    } catch (error) {
      console.error("Failed to update Dispatch Instruction:", error);
      toast({ title: "Unable to update Dispatch Instruction", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  if (isAuthLoading || (isLoading && canView)) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] space-y-5 p-4 sm:p-6">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-80 w-full" />
      </main>
    );
  }

  if (!canView) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to view this module.</CardDescription>
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
            <CardDescription>Return to Project Management and choose a project before opening Dispatch Instructions.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild><Link href="/project-management">Select Project</Link></Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100dvh-4rem)] space-y-5 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/project-management/supply?project=${encodeURIComponent(mappingId)}`} aria-label="Back to Supply">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 shadow-sm">
          <Truck className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Dispatch Instructions</h1>
          <p className="text-sm text-muted-foreground">
            SEL&apos;s numbered instruction authorising the vendor to move material, for {mapping.projectName}
          </p>
        </div>
      </div>

      <SupplyGateNav mappingId={mappingId} active="dispatch-instructions" />

      {notYetDispatched.count > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            <strong>{notYetDispatched.count}</strong> DI{notYetDispatched.count === 1 ? "" : "s"} issued more than{" "}
            {DISPATCH_BY_AGING_THRESHOLD_DAYS} days ago with no dispatch recorded —{" "}
            <strong>{formatCurrency(notYetDispatched.value)}</strong> (oldest {notYetDispatched.oldestDays} day
            {notYetDispatched.oldestDays === 1 ? "" : "s"}).
          </span>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>BOQ SL No</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>PO Number</TableHead>
                  <TableHead>MDCC</TableHead>
                  <TableHead>DI No.</TableHead>
                  <TableHead className="text-right">Dispatch Qty</TableHead>
                  <TableHead>Dispatch By</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-40 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length ? (
                  rows.map((item) => {
                    const mdcc = mdccRecords.get(item.boqItemId);
                    const di = diRecords.get(item.boqItemId);
                    const status = di?.status ?? "Pending";
                    const inspectionRequired = inspectionRequiredByBoqItemId.get(item.boqItemId) ?? true;
                    const eligible = canIssueDi(mdcc?.status, inspectionRequired);
                    const daysSinceIssue = status !== "Pending" && status !== "Dispatched" ? gateDaysSince(di?.issuedOn) : null;
                    return (
                      <TableRow key={item.boqItemId}>
                        <TableCell className="whitespace-nowrap">{item.boqSlNo || "—"}</TableCell>
                        <TableCell className="max-w-xs truncate" title={item.description}>{item.description}</TableCell>
                        <TableCell className="whitespace-nowrap">{item.poNumber}</TableCell>
                        <TableCell>
                          {inspectionRequired ? (
                            <Badge variant="outline" className={mdccStatusStyles[mdcc?.status ?? "Pending"]}>
                              {mdcc?.status ?? "Pending"}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">Not required (direct)</span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs">{di?.diNumber || "—"}</TableCell>
                        <TableCell className="text-right">
                          {di?.dispatchQty != null ? formatQuantity(di.dispatchQty) : "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs">{formatGateDate(di?.dispatchByDate)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={diStatusStyles[status]}>
                            {status}
                          </Badge>
                          {daysSinceIssue != null && (
                            <div className="mt-1 text-[10px] text-red-600">{daysSinceIssue}d since issue</div>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {(status === "Pending" || status === "Issued") && canIssue && eligible && (
                              <Button variant="outline" size="sm" onClick={() => openIssue(item)}>
                                {status === "Pending" ? "Issue DI" : "Edit"}
                              </Button>
                            )}
                            {status === "Issued" && canAcknowledge && (
                              <Button variant="ghost" size="sm" onClick={() => markStatus(item, "Acknowledged")} disabled={isSaving}>
                                Acknowledge
                              </Button>
                            )}
                            {(status === "Issued" || status === "Acknowledged") && canDispatch && (
                              <Button variant="ghost" size="sm" onClick={() => markStatus(item, "Dispatched")} disabled={isSaving}>
                                Mark Dispatched
                              </Button>
                            )}
                            {status === "Pending" && !eligible && (
                              <span className="text-xs text-muted-foreground">Awaiting MDCC</span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={9} className="h-32 text-center">
                      <Truck className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                      <p className="font-medium">Nothing to instruct yet</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Items appear here once their MDCC has been issued by the client, or immediately if their
                        BOQ line is flagged as not requiring inspection.
                      </p>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={Boolean(issueItem)} onOpenChange={(open) => !open && setIssueItem(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Issue Dispatch Instruction</DialogTitle>
            <DialogDescription>{issueItem ? `${issueItem.boqSlNo} — ${issueItem.description}` : ""}</DialogDescription>
          </DialogHeader>
          {issuePath === "direct" && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Direct path — this BOQ line is flagged as not requiring inspection/client clearance, so this DI is
              issued straight off the PO without an MDCC.
            </p>
          )}
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="di-number">DI Number</Label>
              <Input id="di-number" value={diNumber} onChange={(e) => setDiNumber(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dispatch-qty">
                Dispatch Quantity <span className="font-normal text-muted-foreground">(ceiling: {formatQuantity(issueCeiling)})</span>
              </Label>
              <Input id="dispatch-qty" type="number" min="0" step="0.001" value={dispatchQty} onChange={(e) => setDispatchQty(e.target.value)} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="consignee">Consignee</Label>
              <Input id="consignee" placeholder="Site / substation name, attn." value={consignee} onChange={(e) => setConsignee(e.target.value)} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="dispatch-serials">Dispatch Serials (optional, one per line or comma-separated)</Label>
              <Textarea
                id="dispatch-serials"
                placeholder="Leave blank if this item isn't serial-tracked"
                value={dispatchSerialsText}
                onChange={(e) => setDispatchSerialsText(e.target.value)}
                rows={3}
              />
              {!dispatchSerialCheck.valid && (
                <p className="text-xs text-red-600">
                  Not inspected, can&apos;t dispatch: {dispatchSerialCheck.extra.join(", ")}
                </p>
              )}
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="delivery-address">Delivery Address</Label>
              <Textarea id="delivery-address" value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="site-contact">Site Contact</Label>
              <Input id="site-contact" value={siteContact} onChange={(e) => setSiteContact(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="site-contact-phone">Site Contact Phone</Label>
              <Input id="site-contact-phone" value={siteContactPhone} onChange={(e) => setSiteContactPhone(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dispatch-by-date">Dispatch By</Label>
              <Input id="dispatch-by-date" type="date" value={dispatchByDate} onChange={(e) => setDispatchByDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="expected-arrival">Expected Arrival</Label>
              <Input id="expected-arrival" type="date" value={expectedArrival} onChange={(e) => setExpectedArrival(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="transport-arranged-by">Transport Arranged By</Label>
              <Input id="transport-arranged-by" placeholder="SEL-nominated / vendor's arrangement" value={transportArrangedBy} onChange={(e) => setTransportArrangedBy(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="freight-basis">Freight Basis</Label>
              <Input id="freight-basis" placeholder="FOR site, included" value={freightBasis} onChange={(e) => setFreightBasis(e.target.value)} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="documents-required">Documents to Accompany</Label>
              <Textarea
                id="documents-required"
                placeholder="Invoice, packing list, LR, e-way bill, MDCC copy, test certificates, guarantee certificate..."
                value={documentsRequired}
                onChange={(e) => setDocumentsRequired(e.target.value)}
              />
            </div>

            <div className="space-y-2 rounded-lg border p-3 sm:col-span-2">
              <p className="text-sm font-medium">Site Readiness</p>
              <p className="text-xs text-muted-foreground">
                All items must be confirmed before the DI can be issued — the gate that stops material being
                authorised to arrive somewhere that can&apos;t actually receive it.
              </p>
              <div className="space-y-2 pt-1">
                {siteReadiness.map((check) => (
                  <label key={check.key} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={check.confirmed}
                      onCheckedChange={(value) => toggleSiteReadiness(check.key, value === true)}
                    />
                    {check.label}
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="di-remarks">Remarks</Label>
              <Textarea id="di-remarks" placeholder="Optional notes..." value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button onClick={handleIssue} disabled={isSaving || !siteReady || !dispatchSerialCheck.valid}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Issue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

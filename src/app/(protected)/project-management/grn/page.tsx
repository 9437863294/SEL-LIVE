"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, Loader2, PackageCheck, ShieldAlert } from "lucide-react";
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
  GRN_COLLECTION,
  GRN_PERMISSION_RESOURCE,
  buildPoPlacedItems,
  canReceiveGrn,
  computeGrnStatus,
  diStatusStyles,
  formatGateDate,
  gateDaysSince,
  grnStatusStyles,
  type DiRecord,
  type GrnRecord,
  type PoPlacedItem,
} from "@/lib/supply-gates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

export default function GrnPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const canView = can("View", GRN_PERMISSION_RESOURCE) || can("View", "Project Management.BOQ");
  const canRecord = can("Record", GRN_PERMISSION_RESOURCE);

  const [mapping, setMapping] = useState<ProjectMapping | null>(null);
  const [placedItems, setPlacedItems] = useState<Map<string, PoPlacedItem>>(new Map());
  const [diRecords, setDiRecords] = useState<Map<string, DiRecord>>(new Map());
  const [grnRecords, setGrnRecords] = useState<Map<string, GrnRecord>>(new Map());
  const [budgetPriceByBoqItemId, setBudgetPriceByBoqItemId] = useState<Map<string, number>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [receiveItem, setReceiveItem] = useState<PoPlacedItem | null>(null);
  const [grnNumber, setGrnNumber] = useState("");
  const [receivedDate, setReceivedDate] = useState(today());
  const [receivedQty, setReceivedQty] = useState("");
  const [acceptedQty, setAcceptedQty] = useState("");
  const [rejectedQty, setRejectedQty] = useState("");
  const [shortQty, setShortQty] = useState("");
  const [damagedQty, setDamagedQty] = useState("");
  const [remarks, setRemarks] = useState("");
  const [receivedSerialsText, setReceivedSerialsText] = useState("");

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

      const [poSnapshot, boqSnapshot, diSnapshot, grnSnapshot] = await Promise.all([
        getDocs(collection(db, "projects", mappingData.globalProjectId, PO_COLLECTION)),
        getDocs(collection(db, "projects", mappingData.globalProjectId, "boqItems")),
        getDocs(collection(db, "projects", mappingData.globalProjectId, DI_COLLECTION)),
        getDocs(collection(db, "projects", mappingData.globalProjectId, GRN_COLLECTION)),
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

      setDiRecords(
        new Map(diSnapshot.docs.map((item) => [item.id, { id: item.id, ...item.data() } as DiRecord])),
      );
      setGrnRecords(
        new Map(grnSnapshot.docs.map((item) => [item.id, { id: item.id, ...item.data() } as GrnRecord])),
      );
    } catch (error) {
      console.error("Failed to load GRN data:", error);
      toast({ title: "Unable to load GRN data", variant: "destructive" });
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

  const rows = useMemo(
    () =>
      Array.from(placedItems.values())
        .filter((item) => diRecords.get(item.boqItemId)?.status === "Dispatched")
        .sort((a, b) => a.boqSlNo.localeCompare(b.boqSlNo, undefined, { numeric: true })),
    [placedItems, diRecords],
  );

  // Received and accepted, but with no MVAC/issue module yet to consume it — every accepted GRN
  // is, by definition, sitting unconsumed in stores. Tracked from GRN posting date as a
  // forward-compatible placeholder for when material issue/consumption is built next.
  const receivedUnconsumed = useMemo(() => {
    let value = 0;
    let oldestDays = 0;
    let count = 0;
    rows.forEach((item) => {
      const grn = grnRecords.get(item.boqItemId);
      if (!grn?.acceptedQty) return;
      count += 1;
      value += grn.acceptedQty * (budgetPriceByBoqItemId.get(item.boqItemId) ?? 0);
      const days = gateDaysSince(grn.receivedDate) ?? 0;
      if (days > oldestDays) oldestDays = days;
    });
    return { value, oldestDays, count };
  }, [rows, grnRecords, budgetPriceByBoqItemId]);

  const openReceive = (item: PoPlacedItem) => {
    setReceiveItem(item);
    const existing = grnRecords.get(item.boqItemId);
    const di = diRecords.get(item.boqItemId);
    setGrnNumber(existing?.grnNumber ?? "");
    setReceivedDate(existing?.receivedDate || today());
    const defaultQty = existing?.receivedQty ?? di?.dispatchQty ?? item.qty;
    setReceivedQty(defaultQty != null ? String(defaultQty) : "");
    setAcceptedQty(existing?.acceptedQty != null ? String(existing.acceptedQty) : defaultQty != null ? String(defaultQty) : "");
    setRejectedQty(existing?.rejectedQty != null ? String(existing.rejectedQty) : "0");
    setShortQty(existing?.shortQty != null ? String(existing.shortQty) : "0");
    setDamagedQty(existing?.damagedQty != null ? String(existing.damagedQty) : "0");
    setRemarks(existing?.remarks ?? "");
    setReceivedSerialsText(formatSerialList(existing?.receivedSerials));
  };

  const qtyBreakdown = useMemo(() => {
    const received = Number(receivedQty) || 0;
    const accepted = Number(acceptedQty) || 0;
    const rejected = Number(rejectedQty) || 0;
    const short = Number(shortQty) || 0;
    const damaged = Number(damagedQty) || 0;
    const sum = accepted + rejected + short + damaged;
    const dispatchedQty = receiveItem ? diRecords.get(receiveItem.boqItemId)?.dispatchQty : undefined;
    return {
      received,
      sum,
      balances: Math.abs(sum - received) < 0.001,
      overDispatched: dispatchedQty != null && received > dispatchedQty,
      dispatchedQty,
    };
  }, [receivedQty, acceptedQty, rejectedQty, shortQty, damagedQty, receiveItem, diRecords]);

  const parsedReceivedSerials = useMemo(() => parseSerialList(receivedSerialsText), [receivedSerialsText]);
  // Unauthorised-receipt check (E5 in the spec): a received serial the DI never dispatched is a
  // hard exception, not a remark.
  const receivedSerialCheck = useMemo(
    () => computeSerialSubsetCheck(parsedReceivedSerials, receiveItem ? diRecords.get(receiveItem.boqItemId)?.dispatchSerials ?? [] : []),
    [parsedReceivedSerials, receiveItem, diRecords],
  );

  const handleSaveReceipt = async () => {
    if (!mapping || !user || !receiveItem) return;
    if (!qtyBreakdown.received || qtyBreakdown.received <= 0) {
      toast({ title: "Enter a valid received quantity", variant: "destructive" });
      return;
    }
    if (!qtyBreakdown.balances) {
      toast({
        title: "Quantities don't reconcile",
        description: "Accepted + Rejected + Short + Damaged must equal Received Quantity.",
        variant: "destructive",
      });
      return;
    }
    if (qtyBreakdown.overDispatched) {
      toast({
        title: "Received quantity exceeds dispatch",
        description: `Cannot receive more than the ${formatQuantity(qtyBreakdown.dispatchedQty ?? 0)} on the Dispatch Instruction.`,
        variant: "destructive",
      });
      return;
    }
    if (!receivedSerialCheck.valid) {
      toast({
        title: "Unauthorised receipt — serials not on the Dispatch Instruction",
        description: `Not dispatched: ${receivedSerialCheck.extra.join(", ")}. Quarantine pending regularisation.`,
        variant: "destructive",
      });
      return;
    }
    setIsSaving(true);
    try {
      const received = Number(receivedQty) || 0;
      const accepted = Number(acceptedQty) || 0;
      const rejected = Number(rejectedQty) || 0;
      const short = Number(shortQty) || 0;
      const damaged = Number(damagedQty) || 0;
      await setDoc(
        doc(db, "projects", mapping.globalProjectId, GRN_COLLECTION, receiveItem.boqItemId),
        {
          boqItemId: receiveItem.boqItemId,
          boqSlNo: receiveItem.boqSlNo,
          description: receiveItem.description,
          poId: receiveItem.poId,
          poNumber: receiveItem.poNumber,
          status: computeGrnStatus(received, rejected, short, damaged),
          grnNumber: grnNumber.trim(),
          receivedDate,
          receivedQty: received,
          acceptedQty: accepted,
          rejectedQty: rejected,
          shortQty: short,
          damagedQty: damaged,
          receivedSerials: parsedReceivedSerials,
          remarks: remarks.trim(),
          receivedBy: user.id,
          receivedByName: user.name,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      void logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: "Project Management",
        action: "Record GRN",
        details: { project: mapping.projectName, boqSlNo: receiveItem.boqSlNo, poNumber: receiveItem.poNumber, grnNumber: grnNumber.trim() },
      });
      toast({ title: "Material receipt recorded" });
      setReceiveItem(null);
      await loadData();
    } catch (error) {
      console.error("Failed to record GRN:", error);
      toast({ title: "Unable to record material receipt", variant: "destructive" });
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
            <CardDescription>Return to Project Management and choose a project before opening GRN.</CardDescription>
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
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 to-amber-600 shadow-sm">
          <PackageCheck className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">GRN</h1>
          <p className="text-sm text-muted-foreground">Goods Receipt at site for {mapping.projectName}</p>
        </div>
      </div>

      <SupplyGateNav mappingId={mappingId} active="grn" />

      {receivedUnconsumed.count > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            <strong>{formatCurrency(receivedUnconsumed.value)}</strong> received and accepted at site, sitting
            unconsumed ({receivedUnconsumed.count} item{receivedUnconsumed.count === 1 ? "" : "s"}, oldest{" "}
            {receivedUnconsumed.oldestDays} day{receivedUnconsumed.oldestDays === 1 ? "" : "s"}).
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
                  <TableHead>DI</TableHead>
                  <TableHead className="text-right">Dispatch Qty</TableHead>
                  <TableHead className="text-right">Received / Accepted</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-32 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length ? (
                  rows.map((item) => {
                    const di = diRecords.get(item.boqItemId);
                    const grn = grnRecords.get(item.boqItemId);
                    const status = grn?.status ?? "Not Received";
                    const eligible = canReceiveGrn(di?.status);
                    const days = grn?.receivedDate ? gateDaysSince(grn.receivedDate) : null;
                    return (
                      <TableRow key={item.boqItemId}>
                        <TableCell className="whitespace-nowrap">{item.boqSlNo || "—"}</TableCell>
                        <TableCell className="max-w-xs truncate" title={item.description}>{item.description}</TableCell>
                        <TableCell className="whitespace-nowrap">{item.poNumber}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs">
                          <Badge variant="outline" className={diStatusStyles[di?.status ?? "Pending"]}>
                            {di?.diNumber || di?.status || "Pending"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {di?.dispatchQty != null ? formatQuantity(di.dispatchQty) : "—"}
                        </TableCell>
                        <TableCell className="text-right text-xs">
                          {grn?.receivedQty != null ? (
                            <>
                              {formatQuantity(grn.receivedQty)} / {formatQuantity(grn.acceptedQty ?? 0)}
                              {(grn.rejectedQty || grn.shortQty || grn.damagedQty) ? (
                                <div className="text-muted-foreground">
                                  {grn.rejectedQty ? `Rej ${formatQuantity(grn.rejectedQty)} ` : ""}
                                  {grn.shortQty ? `Short ${formatQuantity(grn.shortQty)} ` : ""}
                                  {grn.damagedQty ? `Dmg ${formatQuantity(grn.damagedQty)}` : ""}
                                </div>
                              ) : null}
                            </>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={grnStatusStyles[status]}>
                            {status}
                          </Badge>
                          {days != null && (
                            <div className="mt-1 text-[10px] text-muted-foreground">
                              {formatGateDate(grn?.receivedDate)} ({days}d ago)
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {canRecord && eligible ? (
                            <Button variant="outline" size="sm" onClick={() => openReceive(item)}>
                              {status === "Not Received" ? "Receive" : "Edit"}
                            </Button>
                          ) : status === "Not Received" ? (
                            <span className="text-xs text-muted-foreground">Awaiting dispatch</span>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={8} className="h-32 text-center">
                      <PackageCheck className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                      <p className="font-medium">Nothing to receive yet</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Items appear here once a Dispatch Instruction shows the material as dispatched.
                      </p>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={Boolean(receiveItem)} onOpenChange={(open) => !open && setReceiveItem(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Record Material Receipt</DialogTitle>
            <DialogDescription>{receiveItem ? `${receiveItem.boqSlNo} — ${receiveItem.description}` : ""}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="grn-number">GRN Number</Label>
              <Input id="grn-number" value={grnNumber} onChange={(e) => setGrnNumber(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="received-date">Received Date</Label>
              <Input id="received-date" type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="received-qty">
                Received Quantity
                {qtyBreakdown.dispatchedQty != null && (
                  <span className="ml-1 font-normal text-muted-foreground">
                    (dispatched: {formatQuantity(qtyBreakdown.dispatchedQty)})
                  </span>
                )}
              </Label>
              <Input
                id="received-qty"
                type="number"
                min="0"
                step="0.001"
                value={receivedQty}
                onChange={(e) => setReceivedQty(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="accepted-qty">Accepted Qty</Label>
              <Input id="accepted-qty" type="number" min="0" step="0.001" value={acceptedQty} onChange={(e) => setAcceptedQty(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rejected-qty">Rejected Qty</Label>
              <Input id="rejected-qty" type="number" min="0" step="0.001" value={rejectedQty} onChange={(e) => setRejectedQty(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="short-qty">Short Qty</Label>
              <Input id="short-qty" type="number" min="0" step="0.001" value={shortQty} onChange={(e) => setShortQty(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="damaged-qty">Damaged Qty</Label>
              <Input id="damaged-qty" type="number" min="0" step="0.001" value={damagedQty} onChange={(e) => setDamagedQty(e.target.value)} />
            </div>
            {!qtyBreakdown.balances && (
              <p className="text-xs text-red-600 sm:col-span-2">
                Accepted + Rejected + Short + Damaged ({qtyBreakdown.sum || 0}) must equal Received Quantity (
                {qtyBreakdown.received || 0}).
              </p>
            )}
            {qtyBreakdown.overDispatched && (
              <p className="text-xs text-red-600 sm:col-span-2">
                Received quantity cannot exceed the dispatched quantity ({formatQuantity(qtyBreakdown.dispatchedQty ?? 0)}).
              </p>
            )}
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="received-serials">Received Serials (optional, one per line or comma-separated)</Label>
              <Textarea
                id="received-serials"
                placeholder="Leave blank if this item isn't serial-tracked"
                value={receivedSerialsText}
                onChange={(e) => setReceivedSerialsText(e.target.value)}
                rows={3}
              />
              {!receivedSerialCheck.valid && (
                <p className="text-xs text-red-600">
                  Not on the Dispatch Instruction: {receivedSerialCheck.extra.join(", ")}
                </p>
              )}
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="grn-remarks">Remarks</Label>
              <Textarea
                id="grn-remarks"
                placeholder="Optional notes..."
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button
              onClick={handleSaveReceipt}
              disabled={isSaving || !qtyBreakdown.balances || qtyBreakdown.overDispatched || !receivedSerialCheck.valid}
            >
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

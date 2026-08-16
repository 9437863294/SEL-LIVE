"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, BadgeCheck, Loader2, ShieldAlert, Stamp } from "lucide-react";
import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { BoqItem } from "@/lib/types";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import { logUserActivity } from "@/lib/activity-logger";
import { SupplyGateNav } from "@/components/project-management/supply-gate-nav";
import { PO_COLLECTION, type PurchaseOrder } from "@/lib/purchase-orders";
import {
  DI_COLLECTION,
  INSPECTION_COLLECTION,
  MDCC_COLLECTION,
  MDCC_PERMISSION_RESOURCE,
  buildPoPlacedItems,
  canIssueMdcc,
  diStatusStyles,
  formatGateDate,
  gateDaysSince,
  gateDaysUntil,
  hasOpenBlockingPunch,
  inspectionStatusStyles,
  mdccStatusStyles,
  type DiRecord,
  type InspectionRecord,
  type MdccRecord,
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

export default function MdccPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const canView = can("View", MDCC_PERMISSION_RESOURCE) || can("View", "Project Management.BOQ");
  const canRequest = can("Request", MDCC_PERMISSION_RESOURCE);
  const canIssue = can("Issue", MDCC_PERMISSION_RESOURCE);

  const [mapping, setMapping] = useState<ProjectMapping | null>(null);
  const [placedItems, setPlacedItems] = useState<Map<string, PoPlacedItem>>(new Map());
  const [inspections, setInspections] = useState<Map<string, InspectionRecord>>(new Map());
  const [mdccRecords, setMdccRecords] = useState<Map<string, MdccRecord>>(new Map());
  // DIs are their own module now (see supply-gates.ts) — loaded here read-only, just to keep the
  // "expiring soon" balance and the DI cross-reference column accurate.
  const [diRecords, setDiRecords] = useState<Map<string, DiRecord>>(new Map());
  const [budgetPriceByBoqItemId, setBudgetPriceByBoqItemId] = useState<Map<string, number>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [requestItem, setRequestItem] = useState<PoPlacedItem | null>(null);
  const [requestedDate, setRequestedDate] = useState(today());

  const [issueItem, setIssueItem] = useState<PoPlacedItem | null>(null);
  const [mdccNumber, setMdccNumber] = useState("");
  const [mdccDate, setMdccDate] = useState(today());
  const [validUntil, setValidUntil] = useState("");
  const [remarks, setRemarks] = useState("");

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

      const [poSnapshot, boqSnapshot, inspectionSnapshot, mdccSnapshot, diSnapshot] = await Promise.all([
        getDocs(collection(db, "projects", mappingData.globalProjectId, PO_COLLECTION)),
        getDocs(collection(db, "projects", mappingData.globalProjectId, "boqItems")),
        getDocs(collection(db, "projects", mappingData.globalProjectId, INSPECTION_COLLECTION)),
        getDocs(collection(db, "projects", mappingData.globalProjectId, MDCC_COLLECTION)),
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

      setInspections(
        new Map(
          inspectionSnapshot.docs.map((item) => [item.id, { id: item.id, ...item.data() } as InspectionRecord]),
        ),
      );
      setMdccRecords(
        new Map(mdccSnapshot.docs.map((item) => [item.id, { id: item.id, ...item.data() } as MdccRecord])),
      );
      setDiRecords(new Map(diSnapshot.docs.map((item) => [item.id, { id: item.id, ...item.data() } as DiRecord])));
    } catch (error) {
      console.error("Failed to load MDCC data:", error);
      toast({ title: "Unable to load MDCC data", variant: "destructive" });
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
      Array.from(placedItems.values()).sort((a, b) => a.boqSlNo.localeCompare(b.boqSlNo, undefined, { numeric: true })),
    [placedItems],
  );

  // The cash question (§11 Q1): how much fully-inspected material is immobilised waiting on the
  // client's MDCC, and is anything about to expire with a balance still uninstructed.
  const pendingWithClient = useMemo(() => {
    let value = 0;
    let oldestDays = 0;
    let count = 0;
    rows.forEach((item) => {
      const mdcc = mdccRecords.get(item.boqItemId);
      if (mdcc?.status !== "Requested") return;
      count += 1;
      value += item.qty * (budgetPriceByBoqItemId.get(item.boqItemId) ?? 0);
      const days = gateDaysSince(mdcc.requestedDate) ?? 0;
      if (days > oldestDays) oldestDays = days;
    });
    return { value, oldestDays, count };
  }, [rows, mdccRecords, budgetPriceByBoqItemId]);

  const expiringSoon = useMemo(() => {
    let value = 0;
    let count = 0;
    rows.forEach((item) => {
      const mdcc = mdccRecords.get(item.boqItemId);
      if (mdcc?.status !== "Issued" || !mdcc.validUntil) return;
      const daysLeft = gateDaysUntil(mdcc.validUntil);
      const inspection = inspections.get(item.boqItemId);
      const ceiling = inspection?.qtyAccepted ?? item.qty;
      // Balance still not even instructed for dispatch — the DI's dispatchQty, not a field on the
      // MDCC itself now (see supply-gates.ts module note).
      const di = diRecords.get(item.boqItemId);
      const balance = ceiling - (di?.dispatchQty ?? 0);
      if (daysLeft != null && daysLeft <= 7 && balance > 0) {
        count += 1;
        value += balance * (budgetPriceByBoqItemId.get(item.boqItemId) ?? 0);
      }
    });
    return { value, count };
  }, [rows, mdccRecords, inspections, diRecords, budgetPriceByBoqItemId]);

  const openRequest = (item: PoPlacedItem) => {
    setRequestItem(item);
    setRequestedDate(today());
  };

  const handleRequest = async () => {
    if (!mapping || !user || !requestItem) return;
    setIsSaving(true);
    try {
      await setDoc(
        doc(db, "projects", mapping.globalProjectId, MDCC_COLLECTION, requestItem.boqItemId),
        {
          boqItemId: requestItem.boqItemId,
          boqSlNo: requestItem.boqSlNo,
          description: requestItem.description,
          poId: requestItem.poId,
          poNumber: requestItem.poNumber,
          status: "Requested",
          requestedDate,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      void logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: "Project Management",
        action: "Request MDCC",
        details: { project: mapping.projectName, boqSlNo: requestItem.boqSlNo, poNumber: requestItem.poNumber },
      });
      toast({ title: "MDCC requested" });
      setRequestItem(null);
      await loadData();
    } catch (error) {
      console.error("Failed to request MDCC:", error);
      toast({ title: "Unable to request MDCC", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const openIssue = (item: PoPlacedItem) => {
    setIssueItem(item);
    const existing = mdccRecords.get(item.boqItemId);
    setMdccNumber(existing?.mdccNumber ?? "");
    setMdccDate(existing?.mdccDate || today());
    setValidUntil(existing?.validUntil ?? "");
    setRemarks(existing?.remarks ?? "");
  };

  const handleIssue = async () => {
    if (!mapping || !user || !issueItem) return;
    if (!mdccNumber.trim()) {
      toast({ title: "MDCC number is required", variant: "destructive" });
      return;
    }
    setIsSaving(true);
    try {
      await setDoc(
        doc(db, "projects", mapping.globalProjectId, MDCC_COLLECTION, issueItem.boqItemId),
        {
          boqItemId: issueItem.boqItemId,
          boqSlNo: issueItem.boqSlNo,
          description: issueItem.description,
          poId: issueItem.poId,
          poNumber: issueItem.poNumber,
          status: "Issued",
          mdccNumber: mdccNumber.trim(),
          mdccDate,
          validUntil: validUntil || null,
          remarks: remarks.trim(),
          issuedBy: user.id,
          issuedByName: user.name,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      void logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: "Project Management",
        action: "Issue MDCC",
        details: { project: mapping.projectName, boqSlNo: issueItem.boqSlNo, poNumber: issueItem.poNumber, mdccNumber: mdccNumber.trim() },
      });
      toast({ title: "MDCC issued" });
      setIssueItem(null);
      await loadData();
    } catch (error) {
      console.error("Failed to issue MDCC:", error);
      toast({ title: "Unable to issue MDCC", variant: "destructive" });
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
            <CardDescription>Return to Project Management and choose a project before opening MDCC.</CardDescription>
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
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-fuchsia-500 to-purple-600 shadow-sm">
          <BadgeCheck className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">MDCC</h1>
          <p className="text-sm text-muted-foreground">
            Material Dispatch Clearance Certificate — the client&apos;s clearance to dispatch, for {mapping.projectName}
          </p>
        </div>
      </div>

      <SupplyGateNav mappingId={mappingId} active="mdcc" />

      {(pendingWithClient.count > 0 || expiringSoon.count > 0) && (
        <div className="space-y-2">
          {pendingWithClient.count > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                <strong>{formatCurrency(pendingWithClient.value)}</strong> of inspected material immobilised awaiting
                MDCC with the client ({pendingWithClient.count} item{pendingWithClient.count === 1 ? "" : "s"}, oldest{" "}
                {pendingWithClient.oldestDays} day{pendingWithClient.oldestDays === 1 ? "" : "s"}).
              </span>
            </div>
          )}
          {expiringSoon.count > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                <strong>{formatCurrency(expiringSoon.value)}</strong> expiring within 7 days with balance not yet
                instructed for dispatch ({expiringSoon.count} item{expiringSoon.count === 1 ? "" : "s"}).
              </span>
            </div>
          )}
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
                  <TableHead>Inspection</TableHead>
                  <TableHead>MDCC No. / Valid Until</TableHead>
                  <TableHead>DI</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-36 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length ? (
                  rows.map((item) => {
                    const inspection = inspections.get(item.boqItemId);
                    const inspectionStatus = inspection?.status ?? "Not Requested";
                    const mdcc = mdccRecords.get(item.boqItemId);
                    const status = mdcc?.status ?? "Pending";
                    const di = diRecords.get(item.boqItemId);
                    const eligible = canIssueMdcc(inspectionStatus, inspection?.punchItems);
                    const blockedByPunch =
                      inspectionStatus === "Passed with Punch Items" && hasOpenBlockingPunch(inspection?.punchItems);
                    const daysWithClient = status === "Requested" ? gateDaysSince(mdcc?.requestedDate) : null;
                    const daysToExpiry = status === "Issued" ? gateDaysUntil(mdcc?.validUntil) : null;
                    return (
                      <TableRow key={item.boqItemId}>
                        <TableCell className="whitespace-nowrap">{item.boqSlNo || "—"}</TableCell>
                        <TableCell className="max-w-xs truncate" title={item.description}>{item.description}</TableCell>
                        <TableCell className="whitespace-nowrap">{item.poNumber}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={inspectionStatusStyles[inspectionStatus]}>
                            {inspectionStatus}
                          </Badge>
                          {blockedByPunch && (
                            <div className="mt-1 text-[10px] text-amber-600">
                              {(inspection?.punchItems ?? []).filter((p) => !p.closed && p.severity !== "Minor").length} open critical/major item(s)
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs">
                          {mdcc?.mdccNumber ? (
                            <>
                              {mdcc.mdccNumber}
                              {mdcc.validUntil && (
                                <div className={daysToExpiry != null && daysToExpiry <= 7 ? "font-medium text-red-600" : "text-muted-foreground"}>
                                  Valid to {formatGateDate(mdcc.validUntil)}
                                  {daysToExpiry != null && ` (${daysToExpiry}d)`}
                                </div>
                              )}
                            </>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs">
                          {di ? (
                            <Badge variant="outline" className={diStatusStyles[di.status]}>
                              {di.diNumber || di.status}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={mdccStatusStyles[status]}>
                            {status}
                          </Badge>
                          {daysWithClient != null && (
                            <div className="mt-1 text-[10px] text-blue-600">{daysWithClient}d with client</div>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {status === "Pending" && canRequest && eligible ? (
                            <Button variant="outline" size="sm" onClick={() => openRequest(item)}>
                              Request
                            </Button>
                          ) : status !== "Pending" && canIssue && eligible ? (
                            <Button variant="outline" size="sm" onClick={() => openIssue(item)}>
                              <Stamp className="mr-1.5 h-3.5 w-3.5" />
                              {status === "Issued" ? "Edit" : "Record MDCC"}
                            </Button>
                          ) : status !== "Issued" ? (
                            <span className="text-xs text-muted-foreground">
                              {blockedByPunch ? "Open punch items" : !eligible ? "Awaiting inspection" : "—"}
                            </span>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={8} className="h-32 text-center">
                      <BadgeCheck className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                      <p className="font-medium">Nothing to clear yet</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Items appear here once a purchase order for them has been issued.
                      </p>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={Boolean(requestItem)} onOpenChange={(open) => !open && setRequestItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request MDCC</DialogTitle>
            <DialogDescription>{requestItem ? `${requestItem.boqSlNo} — ${requestItem.description}` : ""}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="mdcc-requested-date">Requested Date</Label>
            <Input
              id="mdcc-requested-date"
              type="date"
              value={requestedDate}
              onChange={(e) => setRequestedDate(e.target.value)}
            />
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button onClick={handleRequest} disabled={isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(issueItem)} onOpenChange={(open) => !open && setIssueItem(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Issue MDCC</DialogTitle>
            <DialogDescription>{issueItem ? `${issueItem.boqSlNo} — ${issueItem.description}` : ""}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="mdcc-number">MDCC Number</Label>
              <Input id="mdcc-number" value={mdccNumber} onChange={(e) => setMdccNumber(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mdcc-date">MDCC Date</Label>
              <Input id="mdcc-date" type="date" value={mdccDate} onChange={(e) => setMdccDate(e.target.value)} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="valid-until">Valid Until</Label>
              <Input id="valid-until" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="mdcc-remarks">Remarks</Label>
              <Textarea
                id="mdcc-remarks"
                placeholder="Optional notes..."
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Once issued, dispatch is authorised via a Dispatch Instruction against this MDCC — see the DI tab.
          </p>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button onClick={handleIssue} disabled={isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Issue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

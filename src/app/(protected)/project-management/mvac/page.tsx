"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, FileCheck2, Loader2, Plus, ShieldAlert, Trash2 } from "lucide-react";
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
  GRN_COLLECTION,
  INSPECTION_COLLECTION,
  MVAC_COLLECTION,
  MVAC_PERMISSION_RESOURCE,
  PUNCH_SEVERITIES,
  buildPoPlacedItems,
  canReleaseMvacBilling,
  canRequestMvac,
  canSignMvac,
  checkMvacReadiness,
  formatGateDate,
  gateDaysSince,
  grnStatusStyles,
  inspectionStatusStyles,
  mvacStatusStyles,
  type GrnRecord,
  type InspectionRecord,
  type MvacRecord,
  type PoPlacedItem,
  type PunchItem,
  type PunchSeverity,
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

const emptyObservationRow = (): PunchItem => ({
  punchId: Math.random().toString(36).slice(2),
  description: "",
  severity: "Minor",
  closed: false,
});

export default function MvacPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const canView = can("View", MVAC_PERMISSION_RESOURCE) || can("View", "Project Management.BOQ");
  const canRequest = can("Request", MVAC_PERMISSION_RESOURCE);
  // Anyone who can conduct the verification can open the capture dialog; only someone who can
  // actually sign for SEL can finalise it — the spec's own distinction between "conduct
  // verification" and "sign for SEL" as separate roles.
  const canVerify = can("Verify", MVAC_PERMISSION_RESOURCE);
  const canSign = can("Sign", MVAC_PERMISSION_RESOURCE);
  const canReleaseBilling = can("Release Billing", MVAC_PERMISSION_RESOURCE);

  const [mapping, setMapping] = useState<ProjectMapping | null>(null);
  const [placedItems, setPlacedItems] = useState<Map<string, PoPlacedItem>>(new Map());
  const [grnRecords, setGrnRecords] = useState<Map<string, GrnRecord>>(new Map());
  const [inspections, setInspections] = useState<Map<string, InspectionRecord>>(new Map());
  const [mvacRecords, setMvacRecords] = useState<Map<string, MvacRecord>>(new Map());
  const [budgetPriceByBoqItemId, setBudgetPriceByBoqItemId] = useState<Map<string, number>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [requestItem, setRequestItem] = useState<PoPlacedItem | null>(null);
  const [requestedDate, setRequestedDate] = useState(today());
  const [clientRepName, setClientRepName] = useState("");

  const [verifyItem, setVerifyItem] = useState<PoPlacedItem | null>(null);
  const [qtyAccepted, setQtyAccepted] = useState("");
  const [qtyHeld, setQtyHeld] = useState("");
  const [observationRows, setObservationRows] = useState<PunchItem[]>([]);
  const [remarks, setRemarks] = useState("");
  const [verifiedSerialsText, setVerifiedSerialsText] = useState("");
  const [nameplateVerified, setNameplateVerified] = useState(false);

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

      const [poSnapshot, boqSnapshot, grnSnapshot, inspectionSnapshot, mvacSnapshot] = await Promise.all([
        getDocs(collection(db, "projects", mappingData.globalProjectId, PO_COLLECTION)),
        getDocs(collection(db, "projects", mappingData.globalProjectId, "boqItems")),
        getDocs(collection(db, "projects", mappingData.globalProjectId, GRN_COLLECTION)),
        getDocs(collection(db, "projects", mappingData.globalProjectId, INSPECTION_COLLECTION)),
        getDocs(collection(db, "projects", mappingData.globalProjectId, MVAC_COLLECTION)),
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

      setGrnRecords(new Map(grnSnapshot.docs.map((item) => [item.id, { id: item.id, ...item.data() } as GrnRecord])));
      setInspections(
        new Map(inspectionSnapshot.docs.map((item) => [item.id, { id: item.id, ...item.data() } as InspectionRecord])),
      );
      setMvacRecords(new Map(mvacSnapshot.docs.map((item) => [item.id, { id: item.id, ...item.data() } as MvacRecord])));
    } catch (error) {
      console.error("Failed to load MVAC data:", error);
      toast({ title: "Unable to load MVAC data", variant: "destructive" });
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

  // Only items with something actually accepted at GRN are candidates — nothing to verify
  // otherwise.
  const rows = useMemo(
    () =>
      Array.from(placedItems.values())
        .filter((item) => (grnRecords.get(item.boqItemId)?.acceptedQty ?? 0) > 0)
        .sort((a, b) => a.boqSlNo.localeCompare(b.boqSlNo, undefined, { numeric: true })),
    [placedItems, grnRecords],
  );

  // The two numbers the spec's own §10 calls "what done looks like" for this module — the
  // largest single pool of recoverable working capital in the supply chain, on one screen.
  const eligibleNotRaised = useMemo(() => {
    let value = 0;
    let oldestDays = 0;
    let count = 0;
    rows.forEach((item) => {
      const grn = grnRecords.get(item.boqItemId);
      const inspection = inspections.get(item.boqItemId);
      const mvac = mvacRecords.get(item.boqItemId);
      if (mvac && mvac.status !== "Pending") return;
      if (!canRequestMvac(grn?.acceptedQty, inspection?.status, inspection?.punchItems)) return;
      count += 1;
      value += (grn?.acceptedQty ?? 0) * (budgetPriceByBoqItemId.get(item.boqItemId) ?? 0);
      const days = gateDaysSince(grn?.receivedDate) ?? 0;
      if (days > oldestDays) oldestDays = days;
    });
    return { value, oldestDays, count };
  }, [rows, grnRecords, inspections, mvacRecords, budgetPriceByBoqItemId]);

  const signedNotBilled = useMemo(() => {
    let value = 0;
    let oldestDays = 0;
    let count = 0;
    rows.forEach((item) => {
      const mvac = mvacRecords.get(item.boqItemId);
      if (mvac?.status !== "Signed" || mvac.billingReleasedOn) return;
      count += 1;
      const grn = grnRecords.get(item.boqItemId);
      value += (mvac.qtyAccepted ?? grn?.acceptedQty ?? 0) * (budgetPriceByBoqItemId.get(item.boqItemId) ?? 0);
      const days = gateDaysSince(mvac.signedOn) ?? 0;
      if (days > oldestDays) oldestDays = days;
    });
    return { value, oldestDays, count };
  }, [rows, mvacRecords, grnRecords, budgetPriceByBoqItemId]);

  const openRequest = (item: PoPlacedItem) => {
    setRequestItem(item);
    const existing = mvacRecords.get(item.boqItemId);
    setRequestedDate(existing?.requestedDate || today());
    setClientRepName(existing?.clientRepName ?? "");
  };

  const requestReadiness = useMemo(() => {
    if (!requestItem) return [];
    const grn = grnRecords.get(requestItem.boqItemId);
    const inspection = inspections.get(requestItem.boqItemId);
    return checkMvacReadiness({
      grnStatus: grn?.status,
      grnAcceptedQty: grn?.acceptedQty,
      inspectionStatus: inspection?.status,
      inspectionPunchItems: inspection?.punchItems,
    });
  }, [requestItem, grnRecords, inspections]);

  const requestHasHardGap = requestReadiness.some((check) => check.status === "gap" && check.key !== "discrepancy");

  const handleRequest = async () => {
    if (!mapping || !user || !requestItem) return;
    if (requestHasHardGap) {
      toast({
        title: "Not ready to request",
        description: "Resolve the readiness gaps below before requesting client verification.",
        variant: "destructive",
      });
      return;
    }
    setIsSaving(true);
    try {
      await setDoc(
        doc(db, "projects", mapping.globalProjectId, MVAC_COLLECTION, requestItem.boqItemId),
        {
          boqItemId: requestItem.boqItemId,
          boqSlNo: requestItem.boqSlNo,
          description: requestItem.description,
          poId: requestItem.poId,
          poNumber: requestItem.poNumber,
          status: "Requested",
          requestedDate,
          clientRepName: clientRepName.trim(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      void logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: "Project Management",
        action: "Request MVAC",
        details: { project: mapping.projectName, boqSlNo: requestItem.boqSlNo, poNumber: requestItem.poNumber },
      });
      toast({ title: "MVAC requested" });
      setRequestItem(null);
      await loadData();
    } catch (error) {
      console.error("Failed to request MVAC:", error);
      toast({ title: "Unable to request MVAC", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const openVerify = (item: PoPlacedItem) => {
    setVerifyItem(item);
    const existing = mvacRecords.get(item.boqItemId);
    const grn = grnRecords.get(item.boqItemId);
    const ceiling = grn?.acceptedQty ?? item.qty;
    setQtyAccepted(existing?.qtyAccepted != null ? String(existing.qtyAccepted) : String(ceiling));
    setQtyHeld(existing?.qtyHeld != null ? String(existing.qtyHeld) : "0");
    setObservationRows(existing?.observations?.length ? existing.observations : []);
    setRemarks(existing?.remarks ?? "");
    setVerifiedSerialsText(formatSerialList(existing?.verifiedSerials));
    setNameplateVerified(existing?.nameplateVerified ?? false);
  };

  const addObservationRow = () => setObservationRows((current) => [...current, emptyObservationRow()]);
  const removeObservationRow = (punchId: string) =>
    setObservationRows((current) => current.filter((row) => row.punchId !== punchId));
  const updateObservationRow = (punchId: string, patch: Partial<PunchItem>) =>
    setObservationRows((current) => current.map((row) => (row.punchId === punchId ? { ...row, ...patch } : row)));
  const toggleCloseObservationRow = (punchId: string, closed: boolean) =>
    updateObservationRow(punchId, {
      closed,
      closedDate: closed ? today() : undefined,
      closedBy: closed ? user?.id : undefined,
      closedByName: closed ? user?.name : undefined,
    });

  const verifyCeiling = verifyItem ? grnRecords.get(verifyItem.boqItemId)?.acceptedQty ?? verifyItem.qty : 0;
  const verifyCanSignNow = canSignMvac(observationRows);
  const parsedVerifiedSerials = useMemo(() => parseSerialList(verifiedSerialsText), [verifiedSerialsText]);
  // Chain-end check (E4 in the spec): a verified serial the GRN never received is a hard
  // exception — the affected units are held, not accepted on a remark.
  const verifiedSerialCheck = useMemo(
    () => computeSerialSubsetCheck(parsedVerifiedSerials, verifyItem ? grnRecords.get(verifyItem.boqItemId)?.receivedSerials ?? [] : []),
    [parsedVerifiedSerials, verifyItem, grnRecords],
  );

  const handleSaveVerification = async () => {
    if (!mapping || !user || !verifyItem) return;
    if (!canSign) {
      toast({
        title: "Sign permission required",
        description: "You can capture the verification, but only a user with Sign permission can finalise this certificate.",
        variant: "destructive",
      });
      return;
    }
    const accepted = Number(qtyAccepted) || 0;
    const held = Number(qtyHeld) || 0;
    if (Math.abs(accepted + held - verifyCeiling) > 0.001) {
      toast({
        title: "Accepted + held must equal the quantity accepted at GRN",
        description: `${accepted} + ${held} ≠ ${verifyCeiling}`,
        variant: "destructive",
      });
      return;
    }
    if (observationRows.some((row) => !row.description.trim())) {
      toast({ title: "Every observation needs a description", variant: "destructive" });
      return;
    }
    if (!verifiedSerialCheck.valid) {
      toast({
        title: "Serial mismatch at MVAC",
        description: `Not received per GRN: ${verifiedSerialCheck.extra.join(", ")}. Held pending a deviation decision.`,
        variant: "destructive",
      });
      return;
    }
    setIsSaving(true);
    try {
      const observations = observationRows.map((row) => ({ ...row, description: row.description.trim() }));
      const status = verifyCanSignNow ? "Signed" : "Held";
      const outcome = !verifyCanSignNow ? "Held" : observations.length ? "Accepted with Observations" : "Accepted";
      await setDoc(
        doc(db, "projects", mapping.globalProjectId, MVAC_COLLECTION, verifyItem.boqItemId),
        {
          boqItemId: verifyItem.boqItemId,
          boqSlNo: verifyItem.boqSlNo,
          description: verifyItem.description,
          poId: verifyItem.poId,
          poNumber: verifyItem.poNumber,
          status,
          outcome,
          qtyAccepted: accepted,
          qtyHeld: held,
          observations,
          verifiedSerials: parsedVerifiedSerials,
          nameplateVerified,
          remarks: remarks.trim(),
          ...(status === "Signed" ? { signedBy: user.id, signedByName: user.name, signedOn: today() } : {}),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      void logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: "Project Management",
        action: `Record MVAC: ${status}`,
        details: { project: mapping.projectName, boqSlNo: verifyItem.boqSlNo, poNumber: verifyItem.poNumber },
      });
      toast({ title: status === "Signed" ? "MVAC signed" : "MVAC held — critical observation open" });
      setVerifyItem(null);
      await loadData();
    } catch (error) {
      console.error("Failed to record MVAC verification:", error);
      toast({ title: "Unable to record MVAC verification", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleReleaseBilling = async (item: PoPlacedItem) => {
    if (!mapping || !user) return;
    setIsSaving(true);
    try {
      await setDoc(
        doc(db, "projects", mapping.globalProjectId, MVAC_COLLECTION, item.boqItemId),
        {
          billingReleasedOn: today(),
          billingReleasedBy: user.id,
          billingReleasedByName: user.name,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      void logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: "Project Management",
        action: "Release MVAC for Billing",
        details: { project: mapping.projectName, boqSlNo: item.boqSlNo, poNumber: item.poNumber },
      });
      toast({ title: "Released for billing" });
      await loadData();
    } catch (error) {
      console.error("Failed to release MVAC for billing:", error);
      toast({ title: "Unable to release for billing", variant: "destructive" });
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
            <CardDescription>Return to Project Management and choose a project before opening MVAC.</CardDescription>
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
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-cyan-600 shadow-sm">
          <FileCheck2 className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">MVAC</h1>
          <p className="text-sm text-muted-foreground">
            Material Verification &amp; Acceptance Certificate for {mapping.projectName}
          </p>
        </div>
      </div>

      <SupplyGateNav mappingId={mappingId} active="mvac" />

      {(eligibleNotRaised.count > 0 || signedNotBilled.count > 0) && (
        <div className="space-y-2">
          {eligibleNotRaised.count > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                <strong>{formatCurrency(eligibleNotRaised.value)}</strong> eligible for acceptance, not yet raised (
                {eligibleNotRaised.count} item{eligibleNotRaised.count === 1 ? "" : "s"}, oldest{" "}
                {eligibleNotRaised.oldestDays} day{eligibleNotRaised.oldestDays === 1 ? "" : "s"}). SEL&apos;s own
                delay — no external excuse.
              </span>
            </div>
          )}
          {signedNotBilled.count > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                <strong>{formatCurrency(signedNotBilled.value)}</strong> accepted and signed, bill not yet raised (
                {signedNotBilled.count} item{signedNotBilled.count === 1 ? "" : "s"}, oldest {signedNotBilled.oldestDays}{" "}
                day{signedNotBilled.oldestDays === 1 ? "" : "s"}). No defensible reason for this to be non-zero.
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
                  <TableHead>GRN</TableHead>
                  <TableHead>Inspection</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-44 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length ? (
                  rows.map((item) => {
                    const grn = grnRecords.get(item.boqItemId);
                    const inspection = inspections.get(item.boqItemId);
                    const inspectionStatus = inspection?.status ?? "Not Requested";
                    const mvac = mvacRecords.get(item.boqItemId);
                    const status = mvac?.status ?? "Pending";
                    const eligible = canRequestMvac(grn?.acceptedQty, inspection?.status, inspection?.punchItems);
                    const openObsCount = (mvac?.observations ?? []).filter((o) => !o.closed).length;
                    const canReleaseThis = canReleaseMvacBilling(status, mvac?.observations);
                    const days = status === "Signed" ? gateDaysSince(mvac?.signedOn) : null;
                    return (
                      <TableRow key={item.boqItemId}>
                        <TableCell className="whitespace-nowrap">{item.boqSlNo || "—"}</TableCell>
                        <TableCell className="max-w-xs truncate" title={item.description}>{item.description}</TableCell>
                        <TableCell className="whitespace-nowrap">{item.poNumber}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={grnStatusStyles[grn?.status ?? "Not Received"]}>
                            {grn?.status ?? "Not Received"}
                          </Badge>
                          <div className="mt-1 text-[10px] text-muted-foreground">
                            {formatQuantity(grn?.acceptedQty ?? 0)} accepted
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={inspectionStatusStyles[inspectionStatus]}>
                            {inspectionStatus}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={mvacStatusStyles[status]}>
                            {status}
                          </Badge>
                          {status === "Requested" && (
                            <div className="mt-1 text-[10px] text-muted-foreground">
                              Requested {formatGateDate(mvac?.requestedDate)}
                            </div>
                          )}
                          {status === "Signed" && mvac?.billingReleasedOn ? (
                            <div className="mt-1 text-[10px] text-emerald-600">
                              Released {formatGateDate(mvac.billingReleasedOn)}
                            </div>
                          ) : status === "Signed" && days != null ? (
                            <div className="mt-1 text-[10px] text-red-600">
                              Signed {formatGateDate(mvac?.signedOn)} ({days}d not billed)
                            </div>
                          ) : null}
                          {openObsCount > 0 && (
                            <div className="mt-1 text-[10px] text-amber-600">{openObsCount} open observation(s)</div>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex flex-wrap justify-end gap-1">
                            {status === "Pending" && canRequest && eligible && (
                              <Button variant="outline" size="sm" onClick={() => openRequest(item)}>
                                Request
                              </Button>
                            )}
                            {status !== "Pending" && (canVerify || canSign) && (
                              <Button variant="outline" size="sm" onClick={() => openVerify(item)}>
                                {status === "Requested" ? "Verify & Sign" : "Edit"}
                              </Button>
                            )}
                            {canReleaseThis && canReleaseBilling && (
                              <Button variant="outline" size="sm" onClick={() => handleReleaseBilling(item)} disabled={isSaving}>
                                Release Billing
                              </Button>
                            )}
                            {status === "Pending" && !eligible && (
                              <span className="text-xs text-muted-foreground">Not yet eligible</span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="h-32 text-center">
                      <FileCheck2 className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                      <p className="font-medium">Nothing to verify yet</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Items appear here once material has been accepted at GRN.
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
            <DialogTitle>Request MVAC</DialogTitle>
            <DialogDescription>{requestItem ? `${requestItem.boqSlNo} — ${requestItem.description}` : ""}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="mvac-requested-date">Requested Date</Label>
                <Input
                  id="mvac-requested-date"
                  type="date"
                  value={requestedDate}
                  onChange={(e) => setRequestedDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="client-rep-name">Client Rep (optional)</Label>
                <Input id="client-rep-name" value={clientRepName} onChange={(e) => setClientRepName(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5 rounded-lg border p-3">
              <p className="text-xs font-medium text-muted-foreground">Readiness Check</p>
              {requestReadiness.map((check) => (
                <div key={check.key} className="flex items-center justify-between text-xs">
                  <span>{check.label}</span>
                  <span
                    className={
                      check.status === "ok"
                        ? "rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700"
                        : "rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-700"
                    }
                  >
                    {check.detail}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button onClick={handleRequest} disabled={isSaving || requestHasHardGap}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(verifyItem)} onOpenChange={(open) => !open && setVerifyItem(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Verify &amp; Sign MVAC</DialogTitle>
            <DialogDescription>{verifyItem ? `${verifyItem.boqSlNo} — ${verifyItem.description}` : ""}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="mvac-qty-accepted">
                Quantity Accepted <span className="font-normal text-muted-foreground">(ceiling: {formatQuantity(verifyCeiling)})</span>
              </Label>
              <Input id="mvac-qty-accepted" type="number" min="0" step="0.001" value={qtyAccepted} onChange={(e) => setQtyAccepted(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mvac-qty-held">Quantity Held</Label>
              <Input id="mvac-qty-held" type="number" min="0" step="0.001" value={qtyHeld} onChange={(e) => setQtyHeld(e.target.value)} />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="mvac-serials">Verified Serials (optional, one per line or comma-separated)</Label>
              <Textarea
                id="mvac-serials"
                placeholder="Leave blank if this item isn't serial-tracked"
                value={verifiedSerialsText}
                onChange={(e) => setVerifiedSerialsText(e.target.value)}
                rows={3}
              />
              {!verifiedSerialCheck.valid && (
                <p className="text-xs text-red-600">
                  Not received per GRN: {verifiedSerialCheck.extra.join(", ")}
                </p>
              )}
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={nameplateVerified} onCheckedChange={(value) => setNameplateVerified(value === true)} />
                Nameplate verified against the approved drawing (rating, ratio, make, model, year)
              </label>
            </div>

            <div className="space-y-2 sm:col-span-2">
              <div className="flex items-center justify-between">
                <Label>Observations</Label>
                <Button type="button" variant="outline" size="sm" onClick={addObservationRow}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" /> Add
                </Button>
              </div>
              <div className="space-y-2">
                {observationRows.map((row) => (
                  <div key={row.punchId} className="grid grid-cols-1 gap-2 rounded-lg border p-2 sm:grid-cols-[2fr_1fr_auto_auto]">
                    <Input
                      placeholder="Description"
                      value={row.description}
                      onChange={(e) => updateObservationRow(row.punchId, { description: e.target.value })}
                    />
                    <Select
                      value={row.severity}
                      onValueChange={(value: PunchSeverity) => updateObservationRow(row.punchId, { severity: value })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PUNCH_SEVERITIES.map((severity) => (
                          <SelectItem key={severity} value={severity}>{severity}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <label className="flex items-center gap-1.5 whitespace-nowrap px-2 text-xs">
                      <Checkbox
                        checked={row.closed}
                        onCheckedChange={(value) => toggleCloseObservationRow(row.punchId, value === true)}
                      />
                      Closed
                    </label>
                    <Button variant="ghost" size="icon" onClick={() => removeObservationRow(row.punchId)} aria-label="Remove observation">
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                An open Critical observation holds the whole item — it can&apos;t be signed until closed or removed.
                Open Major observations still allow signing but block Release Billing until closed.
              </p>
              {!verifyCanSignNow && (
                <p className="text-xs font-medium text-red-600">
                  Open Critical observation — saving now will record this item as Held, not Signed.
                </p>
              )}
              {!canSign && (
                <p className="text-xs font-medium text-amber-600">
                  You can capture this verification, but only a user with Sign permission can save it.
                </p>
              )}
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="mvac-remarks">Remarks</Label>
              <Textarea id="mvac-remarks" placeholder="Optional notes..." value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button onClick={handleSaveVerification} disabled={isSaving || !canSign || !verifiedSerialCheck.valid}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {verifyCanSignNow ? "Sign" : "Save as Held"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

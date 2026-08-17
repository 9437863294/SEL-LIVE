"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  Factory,
  Loader2,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { BoqItem } from "@/lib/types";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import { logUserActivity } from "@/lib/activity-logger";
import { SupplyGateNav } from "@/components/project-management/supply-gate-nav";
import { PO_COLLECTION, type PurchaseOrder } from "@/lib/purchase-orders";
import { MDL_COLLECTION, isMdlApproved, mdlOverallStatusStyles, type MdlOverallStatus } from "@/lib/mdl";
import {
  MC_COLLECTION,
  MC_PERMISSION_RESOURCE,
  buildPoPlacedItems,
  formatGateDate,
  mcStatusStyles,
  type ManufacturingClearance,
  type McStatus,
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

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

export default function ManufacturingClearancePage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const canView = can("View", MC_PERMISSION_RESOURCE) || can("View", "Project Management.BOQ");
  const canClear = can("Clear", MC_PERMISSION_RESOURCE);
  const canReject = can("Reject", MC_PERMISSION_RESOURCE);
  const canAct = canClear || canReject;

  const [mapping, setMapping] = useState<ProjectMapping | null>(null);
  const [placedItems, setPlacedItems] = useState<Map<string, PoPlacedItem>>(new Map());
  const [clearances, setClearances] = useState<Map<string, ManufacturingClearance>>(new Map());
  const [mdlRequiredBoqItemIds, setMdlRequiredBoqItemIds] = useState<Set<string>>(new Set());
  const [mdlStatusByBoqItemId, setMdlStatusByBoqItemId] = useState<Map<string, MdlOverallStatus>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [activeItem, setActiveItem] = useState<PoPlacedItem | null>(null);
  const [decisionStatus, setDecisionStatus] = useState<McStatus>("Cleared");
  const [decisionDate, setDecisionDate] = useState(today());
  const [decisionRemarks, setDecisionRemarks] = useState("");

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

      const [poSnapshot, boqSnapshot, mcSnapshot, mdlSnapshot] = await Promise.all([
        getDocs(collection(db, "projects", mappingData.globalProjectId, PO_COLLECTION)),
        getDocs(collection(db, "projects", mappingData.globalProjectId, "boqItems")),
        getDocs(collection(db, "projects", mappingData.globalProjectId, MC_COLLECTION)),
        getDocs(collection(db, "projects", mappingData.globalProjectId, MDL_COLLECTION)),
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

      setClearances(
        new Map(
          mcSnapshot.docs.map((item) => [item.id, { id: item.id, ...item.data() } as ManufacturingClearance]),
        ),
      );

      // Manufacturing can only be cleared once the item's drawing (if MDL-tracked) has actually
      // been approved — see mdl.ts's isMdlApproved. Previously this status was purely display-only.
      setMdlRequiredBoqItemIds(
        new Set(
          boqSnapshot.docs
            .filter((item) => String((item.data() as Record<string, unknown>).MDL ?? "").trim().toLowerCase() === "yes")
            .map((item) => item.id),
        ),
      );
      setMdlStatusByBoqItemId(
        new Map(mdlSnapshot.docs.map((item) => [item.id, (item.data() as { status?: MdlOverallStatus }).status ?? "Pending"])),
      );
    } catch (error) {
      console.error("Failed to load manufacturing clearance data:", error);
      toast({ title: "Unable to load manufacturing clearance data", variant: "destructive" });
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

  const openDecision = (item: PoPlacedItem, status: McStatus) => {
    setActiveItem(item);
    setDecisionStatus(status);
    const existing = clearances.get(item.boqItemId);
    setDecisionDate(existing?.clearedDate || today());
    setDecisionRemarks(existing?.remarks ?? "");
  };

  const handleSaveDecision = async () => {
    if (!mapping || !user || !activeItem) return;
    if (decisionStatus === "Cleared") {
      const mdlRequired = mdlRequiredBoqItemIds.has(activeItem.boqItemId);
      const mdlStatus = mdlStatusByBoqItemId.get(activeItem.boqItemId) ?? "Pending";
      if (mdlRequired && !isMdlApproved(mdlStatus)) {
        toast({
          title: "Drawing not yet approved",
          description: "This item's MDL drawing must be Approved (or Approved with Comments) before manufacturing can be cleared.",
          variant: "destructive",
        });
        return;
      }
    }
    setIsSaving(true);
    try {
      await setDoc(
        doc(db, "projects", mapping.globalProjectId, MC_COLLECTION, activeItem.boqItemId),
        {
          boqItemId: activeItem.boqItemId,
          boqSlNo: activeItem.boqSlNo,
          description: activeItem.description,
          poId: activeItem.poId,
          poNumber: activeItem.poNumber,
          vendorName: activeItem.vendorName,
          status: decisionStatus,
          clearedDate: decisionDate,
          remarks: decisionRemarks.trim(),
          clearedBy: user.id,
          clearedByName: user.name,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      void logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: "Project Management",
        action: `Mark Manufacturing Clearance as ${decisionStatus}`,
        details: { project: mapping.projectName, boqSlNo: activeItem.boqSlNo, poNumber: activeItem.poNumber },
      });
      toast({ title: `Manufacturing clearance marked ${decisionStatus.toLowerCase()}` });
      setActiveItem(null);
      await loadData();
    } catch (error) {
      console.error("Failed to save manufacturing clearance:", error);
      toast({ title: "Unable to save manufacturing clearance", variant: "destructive" });
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
            <CardDescription>Return to Project Management and choose a project before opening Manufacturing Clearance.</CardDescription>
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
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-lime-500 to-green-600 shadow-sm">
          <Factory className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Manufacturing Clearance</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} item{rows.length === 1 ? "" : "s"} on issued purchase orders for {mapping.projectName}
          </p>
        </div>
      </div>

      <SupplyGateNav mappingId={mappingId} active="manufacturing-clearance" />

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>BOQ SL No</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>PO Number</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Drawing (MDL)</TableHead>
                  <TableHead>Cleared On</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-40 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length ? (
                  rows.map((item) => {
                    const clearance = clearances.get(item.boqItemId);
                    const status = clearance?.status ?? "Pending";
                    const mdlRequired = mdlRequiredBoqItemIds.has(item.boqItemId);
                    const mdlStatus = mdlStatusByBoqItemId.get(item.boqItemId) ?? "Pending";
                    const mdlBlocking = mdlRequired && !isMdlApproved(mdlStatus);
                    const canClearThis = canClear && !mdlBlocking;
                    return (
                      <TableRow key={item.boqItemId}>
                        <TableCell className="whitespace-nowrap">{item.boqSlNo || "—"}</TableCell>
                        <TableCell className="max-w-md">{item.description}</TableCell>
                        <TableCell className="whitespace-nowrap">{item.poNumber}</TableCell>
                        <TableCell className="whitespace-nowrap">{item.vendorName}</TableCell>
                        <TableCell>
                          {mdlRequired ? (
                            <Badge variant="outline" className={mdlOverallStatusStyles[mdlStatus]}>
                              {mdlStatus}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">Not required</span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{formatGateDate(clearance?.clearedDate)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={mcStatusStyles[status]}>
                            {status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {canAct ? (
                            <div className="flex flex-col items-end gap-1">
                              <div className="flex justify-end gap-1">
                                {canClear && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    title={mdlBlocking ? "Drawing not yet approved" : "Clear"}
                                    disabled={!canClearThis}
                                    onClick={() => openDecision(item, "Cleared")}
                                  >
                                    <CheckCircle2 className={mdlBlocking ? "h-4 w-4 text-muted-foreground" : "h-4 w-4 text-emerald-600"} />
                                  </Button>
                                )}
                                {canReject && (
                                  <Button variant="ghost" size="icon" title="Reject" onClick={() => openDecision(item, "Rejected")}>
                                    <XCircle className="h-4 w-4 text-destructive" />
                                  </Button>
                                )}
                              </div>
                              {mdlBlocking && (
                                <Link
                                  href={`/project-management/mdl?project=${encodeURIComponent(mappingId)}`}
                                  className="text-[10px] text-amber-600 underline-offset-2 hover:underline"
                                >
                                  Awaiting drawing approval
                                </Link>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">{clearance?.clearedByName || "—"}</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={8} className="h-32 text-center">
                      <Factory className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
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

      <Dialog open={Boolean(activeItem)} onOpenChange={(open) => !open && setActiveItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark as {decisionStatus}</DialogTitle>
            <DialogDescription>
              {activeItem ? `${activeItem.boqSlNo} — ${activeItem.description}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="mc-date">Date</Label>
              <Input id="mc-date" type="date" value={decisionDate} onChange={(e) => setDecisionDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mc-remarks">Remarks</Label>
              <Textarea
                id="mc-remarks"
                placeholder="Optional notes..."
                value={decisionRemarks}
                onChange={(e) => setDecisionRemarks(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button onClick={handleSaveDecision} disabled={isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

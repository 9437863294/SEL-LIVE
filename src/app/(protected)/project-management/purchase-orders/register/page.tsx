"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  FileBarChart2,
  GanttChart,
  PackageSearch,
  Plus,
  ShoppingCart,
  Table2,
} from "lucide-react";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
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
import { Tabs, TabsContent } from "@/components/ui/tabs";
import {
  PO_COLLECTION,
  PO_PERMISSION_RESOURCE,
  PO_STATUSES,
  formatCurrency,
  poStatusStyles,
  toNumber,
  type POStatus,
  type PurchaseOrder,
} from "@/lib/purchase-orders";
import PoWorkplanCalendar from "@/components/project-management/po-calendar";
import PoReports, { type PoBoqItemLite } from "@/components/project-management/po-reports";
import PoGanttChart from "@/components/project-management/po-gantt";
import PoBoqItemsTable from "@/components/project-management/po-boq-items";
import SidebarTabsList from "@/components/project-management/sidebar-tabs-list";
import { SupplyGateNav } from "@/components/project-management/supply-gate-nav";
import { indentReservesQuantity } from "@/lib/project-management-indent-workflow";
import {
  PO_ISSUE_APPROVAL_COLLECTION,
  isLegacyPo,
  openIssueRequestForPo,
  poIssueStatusStyles,
  type PoIssueApproval,
  type PoLike,
} from "@/lib/project-management-po-workflow";
import { useProjectManagementPoContext } from "@/components/po/use-po-host-context";
import { PoNav } from "@/components/po/po-nav";
import {
  PO_GRADIENT,
  PoAccessDenied,
  PoLoadingState,
  PoPageHeader,
  PoPageShell,
  PoProjectNotFound,
} from "@/components/po/po-page-shell";

type ProjectMapping = {
  id: string;
  projectName: string;
  globalProjectId: string;
  globalProjectName: string;
};

type IndentLineItem = {
  boqItemId: string;
  requestedQty: number | string;
};

type IndentRecord = {
  id: string;
  status: string;
  items: IndentLineItem[];
};

const formatDate = (value?: string) => {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

export default function PurchaseOrderRegisterPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { toast } = useToast();
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const { context, isResolving, notFound } = useProjectManagementPoContext(mappingId);

  const canView = can("View", PO_PERMISSION_RESOURCE) || can("View", "Project Management.RFQ");
  const canAdd = can("Add", PO_PERMISSION_RESOURCE);

  const [mapping, setMapping] = useState<ProjectMapping | null>(null);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [issueApprovals, setIssueApprovals] = useState<PoIssueApproval[]>([]);
  const [boqItemsById, setBoqItemsById] = useState<Map<string, PoBoqItemLite>>(new Map());
  const [indents, setIndents] = useState<IndentRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"all" | POStatus>("all");

  // The active view is kept in the URL (`?view=`) so refreshing, sharing a link, or navigating
  // back doesn't silently reset you to "List" — same pattern as MDL's tabs.
  const activeTab = searchParams?.get("view") || "list";
  const setActiveTab = (value: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (value === "list") params.delete("view");
    else params.set("view", value);
    router.replace(`/project-management/purchase-orders?${params.toString()}`);
  };

  const loadData = useCallback(async () => {
    if (!mappingId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const mappingSnapshot = await getDoc(doc(db, "projectManagementProjects", mappingId));
      if (!mappingSnapshot.exists()) throw new Error("Project mapping not found");
      const mappingData = { id: mappingSnapshot.id, ...mappingSnapshot.data() } as ProjectMapping;
      if (!mappingData.globalProjectId) throw new Error("Global project is not mapped");

      const [poSnapshot, boqSnapshot, indentSnapshot, approvalSnapshot] = await Promise.all([
        getDocs(collection(db, "projects", mappingData.globalProjectId, PO_COLLECTION)),
        getDocs(collection(db, "projects", mappingData.globalProjectId, "boqItems")),
        getDocs(collection(db, "projects", mappingData.globalProjectId, "indents")),
        getDocs(collection(db, "projects", mappingData.globalProjectId, PO_ISSUE_APPROVAL_COLLECTION)),
      ]);
      setIssueApprovals(
        approvalSnapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as PoIssueApproval),
      );
      const rows = poSnapshot.docs
        .map((d) => ({ id: d.id, ...d.data() }) as PurchaseOrder)
        .sort((a, b) => (b.poDate || "").localeCompare(a.poDate || ""));

      setMapping(mappingData);
      setPurchaseOrders(rows);
      setBoqItemsById(new Map(boqSnapshot.docs.map((d) => [d.id, { id: d.id, ...d.data() } as PoBoqItemLite])));
      setIndents(
        indentSnapshot.docs
          .map((d) => ({ id: d.id, ...d.data() }) as IndentRecord)
          // Only approved indents are orderable; legacy ones are grandfathered.
          .filter((indent) => indentReservesQuantity(indent)),
      );
    } catch (error) {
      console.error("Failed to load purchase orders:", error);
      toast({
        title: "Unable to load purchase orders",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [mappingId, toast]);

  useEffect(() => {
    if (isAuthLoading) return;
    if (!canView) {
      setIsLoading(false);
      return;
    }
    void loadData();
  }, [canView, isAuthLoading, loadData]);

  const filteredOrders = useMemo(
    () => (statusFilter === "all" ? purchaseOrders : purchaseOrders.filter((po) => po.status === statusFilter)),
    [purchaseOrders, statusFilter],
  );

  // Orders raised but not yet Received (or Cancelled) — the ones still needing follow-up.
  const openOrderCount = useMemo(
    () => purchaseOrders.filter((po) => !["Received", "Cancelled"].includes(po.status)).length,
    [purchaseOrders],
  );

  const supplyBoqItems = useMemo(
    () =>
      Array.from(boqItemsById.values())
        .filter((item) => String(item["Scope 2"] ?? "").trim().toLowerCase() === "supply")
        .sort((a, b) => String(a["BOQ SL No"] ?? "").localeCompare(String(b["BOQ SL No"] ?? ""), undefined, { numeric: true })),
    [boqItemsById],
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
    for (const po of purchaseOrders) {
      if (po.status === "Cancelled") continue;
      for (const item of po.items ?? []) {
        if (!item.boqItemId) continue;
        map.set(item.boqItemId, (map.get(item.boqItemId) ?? 0) + toNumber(item.qty));
      }
    }
    return map;
  }, [purchaseOrders]);

  const goToPo = (poId: string) => {
    router.push(`/project-management/purchase-orders/${poId}?project=${encodeURIComponent(mappingId)}`);
  };

  if (isAuthLoading || isResolving || isLoading) {
    return <PoLoadingState />;
  }

  if (!canView) {
    return <PoAccessDenied description="You do not have permission to view purchase orders." />;
  }

  if (notFound || !mappingId || !mapping) {
    return (
      <PoProjectNotFound
        description="Return to Project Management and choose a project before opening purchase orders."
        href="/project-management"
      />
    );
  }

  return (
    <PoPageShell className="space-y-4">
      <PoPageHeader
        title="PO Register"
        subtitle={`Purchase orders raised against vendors for ${mapping.projectName}.`}
        icon={ShoppingCart}
        backHref={context.poHref()}
        backLabel="Back to Purchase Orders"
        gradient={PO_GRADIENT}
        actions={
          <>
            <Select value={statusFilter} onValueChange={(value: "all" | POStatus) => setStatusFilter(value)}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {PO_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>{status}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {canAdd && (
              <Button asChild>
                <Link href={context.poHref("new")}>
                  <Plus className="mr-2 h-4 w-4" /> New Purchase Order
                </Link>
              </Button>
            )}
          </>
        }
      />

      <PoNav context={context} active="register" />

      <div className="mb-4">
        <SupplyGateNav mappingId={mappingId} active="purchase-orders" />
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
        <SidebarTabsList
          items={[
            { value: "list", label: "List", icon: Table2, color: "text-emerald-600", bg: "bg-emerald-100", count: openOrderCount },
            { value: "boq-items", label: "BOQ Items", icon: PackageSearch, color: "text-cyan-600", bg: "bg-cyan-100" },
            { value: "calendar", label: "Workplan Calendar", icon: CalendarDays, color: "text-violet-600", bg: "bg-violet-100" },
            { value: "gantt", label: "Gantt Chart", icon: GanttChart, color: "text-orange-600", bg: "bg-orange-100" },
            { value: "reports", label: "Reports", icon: FileBarChart2, color: "text-blue-600", bg: "bg-blue-100" },
          ]}
          activeValue={activeTab}
          onChange={setActiveTab}
          title="Purchase Order Views"
          description="List, BOQ items, calendar, Gantt & reports"
          icon={ShoppingCart}
          gradient="from-emerald-500 to-teal-600"
          tint="from-emerald-500/10 to-teal-500/5"
        />

        <div className="min-w-0 flex-1 space-y-4">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsContent value="list" className="mt-0">
          <Card className="overflow-hidden border-border/60">
            <div className="h-1 w-full bg-gradient-to-r from-emerald-500 to-teal-600" />
            <CardHeader>
              <CardTitle className="text-lg">All Purchase Orders</CardTitle>
              <CardDescription>{filteredOrders.length} order{filteredOrders.length === 1 ? "" : "s"} shown.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>PO Number</TableHead>
                      <TableHead>PO Date</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Source RFQ</TableHead>
                      <TableHead>Items</TableHead>
                      <TableHead>Total Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredOrders.length ? filteredOrders.map((po) => (
                      <TableRow key={po.id} className="cursor-pointer" onClick={() => goToPo(po.id)}>
                        <TableCell className="font-medium">{po.poNumber}</TableCell>
                        <TableCell className="whitespace-nowrap">{formatDate(po.poDate)}</TableCell>
                        <TableCell>{po.vendorName}</TableCell>
                        <TableCell>{po.sourceRfqNumbers?.length ? po.sourceRfqNumbers.join(", ") : "—"}</TableCell>
                        <TableCell>{po.items?.length ?? 0}</TableCell>
                        <TableCell className="whitespace-nowrap font-medium">{formatCurrency(po.totalAmount)}</TableCell>
                        <TableCell>
                          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${poStatusStyles[po.status]}`}>
                            {po.status}
                          </span>
                          {(() => {
                            const openRequest = openIssueRequestForPo(issueApprovals, po.id);
                            return (
                              <div className="mt-1 space-y-0.5">
                                {openRequest && (
                                  <p className="text-xs text-muted-foreground">
                                    <span
                                      className={`rounded px-1.5 py-0.5 ${poIssueStatusStyles[openRequest.status]}`}
                                    >
                                      {openRequest.status}
                                    </span>
                                    {openRequest.currentStepName ? ` · ${openRequest.currentStepName}` : ""}
                                  </p>
                                )}
                                {isLegacyPo(po as PoLike) && (
                                  <p
                                    className="text-xs text-muted-foreground"
                                    title="Raised before issue approval existed — this PO can be issued directly."
                                  >
                                    Legacy
                                  </p>
                                )}
                              </div>
                            );
                          })()}
                        </TableCell>
                        <TableCell>
                          <ArrowRight className="h-4 w-4 text-muted-foreground" />
                        </TableCell>
                      </TableRow>
                    )) : (
                      <TableRow>
                        <TableCell colSpan={8} className="h-32 text-center">
                          <p className="font-medium">No purchase orders found</p>
                          <p className="mt-1 text-sm text-muted-foreground">Create one directly, or award RFQ items to a vendor.</p>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="boq-items" className="mt-0">
          <PoBoqItemsTable
            items={supplyBoqItems}
            indentQtyByBoqItemId={indentQtyByBoqItemId}
            poQtyByBoqItemId={poQtyByBoqItemId}
          />
        </TabsContent>

        <TabsContent value="calendar" className="mt-0">
          {purchaseOrders.length ? (
            <PoWorkplanCalendar purchaseOrders={purchaseOrders} onSelectPo={goToPo} />
          ) : (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
                <CalendarDays className="h-10 w-10 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Create purchase orders with start/end dates to see them on the workplan calendar.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="gantt" className="mt-0">
          <Card className="border-border/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Purchase Order Gantt Chart</CardTitle>
              <CardDescription>Each row is a purchase order; the bar spans its start to end date.</CardDescription>
            </CardHeader>
            <CardContent>
              <PoGanttChart purchaseOrders={purchaseOrders} onSelectPo={goToPo} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reports" className="mt-0">
          <PoReports purchaseOrders={purchaseOrders} boqItemsById={boqItemsById} onSelectPo={goToPo} />
        </TabsContent>
        </Tabs>
        </div>
      </div>
    </PoPageShell>
  );
}

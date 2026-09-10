"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  CalendarDays,
  FileBarChart2,
  GanttChart,
  PackageSearch,
  Plus,
  Settings,
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
import {
  PM_TABLE_CLASS,
  PmContent,
  PmSectionHead,
  PmShell,
  PmSidebar,
  PmTableFoot,
  PmTopbar,
} from "@/components/project-management/pm-shell";
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
import {
  PoAccessDenied,
  PoLoadingState,
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
  //
  // The path comes from `context.poHref("register")`, the same helper every other link on this
  // screen uses, rather than being written out again. Written out, it pointed at the Purchase
  // Orders hub instead of the register, so switching view navigated off this page entirely and
  // dropped the view on the way.
  const activeTab = searchParams?.get("view") || "list";
  const setActiveTab = (value: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (value === "list") params.delete("view");
    else params.set("view", value);
    // poHref already carries `?project=`, so its own query is dropped in favour of `params`,
    // which was seeded from the current URL and therefore still holds it.
    const path = context.poHref("register").split("?")[0];
    const query = params.toString();
    router.replace(query ? `${path}?${query}` : path);
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

  // Every cell holds one line. The issue-approval request and the legacy marker used to sit
  // stacked under the status badge; both now have a column of their own.
  const PO_COLUMN_COUNT = 9;

  const registerTotal = filteredOrders.reduce((sum, po) => sum + (po.totalAmount ?? 0), 0);
  const awaitingReview = filteredOrders.filter((po) =>
    Boolean(openIssueRequestForPo(issueApprovals, po.id)),
  ).length;

  return (
    <PmShell
      sidebar={
        <PmSidebar
          title="PO Register"
          subtitle={mapping.projectName}
          icon={ShoppingCart}
          gradient="from-emerald-500 to-teal-600"
          activeValue={activeTab}
          onChange={setActiveTab}
          groups={[
            {
              label: "Views",
              views: [
                { value: "list", label: "List", icon: Table2, color: "text-emerald-600", bg: "bg-emerald-100", count: openOrderCount },
                { value: "boq-items", label: "BOQ items", icon: PackageSearch, color: "text-cyan-600", bg: "bg-cyan-100" },
                { value: "calendar", label: "Workplan calendar", icon: CalendarDays, color: "text-violet-600", bg: "bg-violet-100" },
                { value: "gantt", label: "Gantt chart", icon: GanttChart, color: "text-orange-600", bg: "bg-orange-100" },
                { value: "reports", label: "Reports", icon: FileBarChart2, color: "text-blue-600", bg: "bg-blue-100" },
              ],
            },
          ]}
          // Only Settings: the hub is already the back button and a breadcrumb, New PO is already
          // the topbar's primary action, and this screen does not need a link to itself.
          footerLinks={[
            { href: context.poHref("settings"), label: "Settings", icon: Settings, color: "text-slate-600", bg: "bg-slate-100" },
          ]}
        />
      }
    >
      <PmTopbar
        title="PO Register"
        breadcrumbs={[
          { label: mapping.projectName, href: `/project-management?project=${encodeURIComponent(mappingId)}` },
          { label: "Purchase Orders", href: context.poHref() },
        ]}
        backHref={context.poHref()}
        backLabel="Back to Purchase Orders"
        actions={
          canAdd ? (
            <Button size="sm" asChild>
              <Link href={context.poHref("new")}>
                <Plus className="mr-2 h-4 w-4" /> New purchase order
              </Link>
            </Button>
          ) : undefined
        }
      />

      <SupplyGateNav
        mappingId={mappingId}
        active="purchase-orders"
        // Only this gate's register is loaded on this page, so only its count is passed. The rest
        // render without a number rather than a misleading zero.
        counts={{ "purchase-orders": purchaseOrders.length }}
      />

      <PmContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsContent value="list" className="mt-0">
          {/* The heading carries the register's figures beside it, rather than a card header
              repeating a title the sidebar already shows. */}
          <PmSectionHead
            title="All purchase orders"
            stats={[
              { label: filteredOrders.length === 1 ? "order" : "orders", value: String(filteredOrders.length) },
              { label: "total value", value: formatCurrency(registerTotal) },
              ...(awaitingReview
                ? [{ label: "awaiting commercial review", value: String(awaitingReview), tone: "flag" as const }]
                : []),
            ]}
            actions={
              <Select value={statusFilter} onValueChange={(value: "all" | POStatus) => setStatusFilter(value)}>
                <SelectTrigger className="h-8 w-[150px] text-[13px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {PO_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>{status}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
          <Card className="overflow-hidden border-border/60">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table className={PM_TABLE_CLASS}>
                  <TableHeader>
                    <TableRow>
                      <TableHead>PO Number</TableHead>
                      <TableHead>PO Date</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Source RFQ</TableHead>
                      <TableHead className="text-right">Items</TableHead>
                      <TableHead className="text-right">Total Amount</TableHead>
                      <TableHead>Status</TableHead>
                      {/* Was stacked under Status: the open issue-approval request, and the
                          legacy marker for POs raised before that approval existed. */}
                      <TableHead>Issue Approval</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredOrders.length ? filteredOrders.map((po) => {
                      const openRequest = openIssueRequestForPo(issueApprovals, po.id);
                      const legacy = isLegacyPo(po as PoLike);
                      return (
                      <TableRow key={po.id} className="cursor-pointer" onClick={() => goToPo(po.id)}>
                        <TableCell className="whitespace-nowrap font-medium">{po.poNumber}</TableCell>
                        <TableCell className="whitespace-nowrap">{formatDate(po.poDate)}</TableCell>
                        <TableCell className="max-w-[180px] truncate" title={po.vendorName}>{po.vendorName}</TableCell>
                        <TableCell
                          className="max-w-[140px] truncate"
                          title={po.sourceRfqNumbers?.join(", ")}
                        >
                          {po.sourceRfqNumbers?.length ? po.sourceRfqNumbers.join(", ") : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{po.items?.length ?? 0}</TableCell>
                        <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">{formatCurrency(po.totalAmount)}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${poStatusStyles[po.status]}`}>
                            {po.status}
                          </span>
                        </TableCell>
                        <TableCell className="max-w-[200px] whitespace-nowrap">
                          {openRequest ? (
                            <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                              <span className={`shrink-0 rounded px-1.5 py-0.5 ${poIssueStatusStyles[openRequest.status]}`}>
                                {openRequest.status}
                              </span>
                              {openRequest.currentStepName && (
                                <span className="truncate">· {openRequest.currentStepName}</span>
                              )}
                            </span>
                          ) : legacy ? (
                            <span
                              className="text-xs text-muted-foreground"
                              title="Raised before issue approval existed — this PO can be issued directly."
                            >
                              Legacy
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <ArrowRight className="h-4 w-4 text-muted-foreground" />
                        </TableCell>
                      </TableRow>
                      );
                    }) : (
                      <TableRow>
                        <TableCell colSpan={PO_COLUMN_COUNT} className="h-32 text-center">
                          <p className="font-medium">No purchase orders found</p>
                          <p className="mt-1 text-sm text-muted-foreground">Create one directly, or award RFQ items to a vendor.</p>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              {filteredOrders.length > 0 && (
                <PmTableFoot
                  left={
                    <>
                      Showing <b className="font-semibold tabular-nums text-foreground">{filteredOrders.length}</b> of{" "}
                      <b className="font-semibold tabular-nums text-foreground">{purchaseOrders.length}</b> purchase orders
                    </>
                  }
                  right={
                    <>
                      Register total{" "}
                      <b className="font-semibold tabular-nums text-foreground">{formatCurrency(registerTotal)}</b>
                    </>
                  }
                />
              )}
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
          <Card className="overflow-hidden border-border/60">
            {/* The sidebar already names this view, so the bar keeps only the part that explains
                how to read the chart. */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/60 px-4 py-2.5">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <GanttChart className="h-3.5 w-3.5 shrink-0 text-orange-600" />
                <span className="font-medium text-foreground">Purchase order schedule</span>
                · each row is a purchase order; the bar spans its start to end date
              </p>
            </div>
            <CardContent className="pt-4">
              <PoGanttChart purchaseOrders={purchaseOrders} onSelectPo={goToPo} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reports" className="mt-0">
          <PoReports purchaseOrders={purchaseOrders} boqItemsById={boqItemsById} onSelectPo={goToPo} />
        </TabsContent>
        </Tabs>
      </PmContent>
    </PmShell>
  );
}

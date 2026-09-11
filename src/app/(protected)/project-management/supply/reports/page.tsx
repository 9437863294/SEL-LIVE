"use client";

/**
 * Supply reports — the whole PO → MVAC chain measured in one pass.
 *
 * Every other supply screen answers "what is the state of this document". This answers the
 * questions that only fall out of reading the chain end to end: where value is stuck and for how
 * long, which step is costing the most time, which vendor is actually performing, and what needs
 * chasing this morning.
 *
 * All arithmetic lives in `src/lib/project-management-supply-analytics.ts`, which is Firebase-free
 * and unit-tested; this file is the load and the layout. The load is one pass over the three
 * workspaces the module already has — `loadSupplyChain`, `loadMcWorkspace`,
 * `loadInspectionWorkspace` — so the reports never read a collection the working screens do not.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import {
  AlertTriangle,
  BarChart3,
  Building2,
  Clock,
  Download,
  Filter,
  Gauge,
  Layers,
  Loader2,
  RefreshCw,
  ShieldAlert,
  TrendingDown,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  PO_COLLECTION,
  PO_PERMISSION_RESOURCE,
  formatQuantity,
  resolvePoLineId,
  toNumber,
  type PurchaseOrder,
} from "@/lib/purchase-orders";
import { supplyPoLineKey } from "@/lib/project-management-supply-ledger";
import { loadSupplyChain } from "@/lib/project-management-supply-service";
import { loadMcWorkspace } from "@/lib/project-management-mc-service";
import { loadInspectionWorkspace } from "@/lib/project-management-inspection-service";
import {
  SUPPLY_CHAIN_GATES,
  SUPPLY_GATE_LABELS,
  buildSupplyBottlenecks,
  buildSupplyCycleTimes,
  buildSupplyExceptions,
  buildSupplyFunnel,
  buildSupplyHeadline,
  buildSupplyVendorScores,
  slowestSupplyStep,
  supplyLinesCsv,
  type SupplyChainGate,
  type SupplyChainLine,
} from "@/lib/project-management-supply-analytics";
import {
  PM_TABLE_CLASS,
  PmContent,
  PmSectionHead,
  PmShell,
  PmSidebar,
  PmTopbar,
  pmAccent,
} from "@/components/project-management/pm-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const VIEWS = [
  { key: "pipeline", label: "Pipeline", icon: Layers },
  { key: "stuck", label: "Where value is stuck", icon: TrendingDown },
  { key: "cycle", label: "Cycle time", icon: Clock },
  { key: "vendors", label: "Vendor scorecard", icon: Building2 },
  { key: "exceptions", label: "Exceptions", icon: AlertTriangle },
] as const;

type ViewKey = (typeof VIEWS)[number]["key"];

/** Compact INR, because a supply book runs to crores and the exact rupee is never the point. */
const money = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: value >= 10_000_000 ? 2 : 0,
    notation: value >= 100_000 ? "compact" : "standard",
  }).format(value || 0);

const days = (value: number | null) => (value == null ? "—" : `${value}d`);

export default function SupplyReportsPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const view = (searchParams?.get("view") ?? "pipeline") as ViewKey;
  const { toast } = useToast();
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const canView =
    can("View", PO_PERMISSION_RESOURCE) || can("View", "Project Management.BOQ");

  const [projectName, setProjectName] = useState("");
  const [lines, setLines] = useState<SupplyChainLine[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [activeView, setActiveView] = useState<ViewKey>(view);

  const loadData = useCallback(async () => {
    if (!mappingId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadError("");
    try {
      const mappingSnapshot = await getDoc(doc(db, "projectManagementProjects", mappingId));
      if (!mappingSnapshot.exists()) throw new Error("Project mapping not found");
      const mapping = mappingSnapshot.data() as {
        globalProjectId?: string;
        projectName?: string;
      };
      const globalProjectId = String(mapping.globalProjectId ?? "");
      if (!globalProjectId) throw new Error("Global project is not mapped");
      setProjectName(String(mapping.projectName ?? ""));

      const [poSnapshot, chain, mc, inspection] = await Promise.all([
        getDocs(collection(db, "projects", globalProjectId, PO_COLLECTION)),
        loadSupplyChain(globalProjectId),
        loadMcWorkspace(globalProjectId),
        loadInspectionWorkspace(globalProjectId),
      ]);

      const purchaseOrders = poSnapshot.docs.map(
        (entry) => ({ id: entry.id, ...entry.data() }) as PurchaseOrder,
      );

      /* ---- index the gate registers by PO line ---- */

      // MC and Inspection each keep their own ledger keyed the same way as the supply ledger.
      const mcLedgers = mc.ledgers;
      const inspectionLedgers = inspection.ledgers;

      // Earliest accepted date and oldest open date per line, per gate, read from the documents
      // themselves — the ledgers carry quantities but not when they happened.
      const firstAccepted = new Map<string, Partial<Record<SupplyChainGate, string>>>();
      const oldestOpen = new Map<string, Partial<Record<SupplyChainGate, string>>>();

      const noteAccepted = (key: string, gate: SupplyChainGate, date?: string) => {
        if (!date) return;
        const entry = firstAccepted.get(key) ?? {};
        if (!entry[gate] || date < entry[gate]!) entry[gate] = date;
        firstAccepted.set(key, entry);
      };
      const noteOpen = (key: string, gate: SupplyChainGate, date?: string) => {
        if (!date) return;
        const entry = oldestOpen.get(key) ?? {};
        if (!entry[gate] || date < entry[gate]!) entry[gate] = date;
        oldestOpen.set(key, entry);
      };

      // MC documents.
      const mcHeaderById = new Map(mc.headers.map((header) => [header.id, header]));
      for (const item of mc.items) {
        const header = mcHeaderById.get(item.mcId);
        if (!header || header.status === "Cancelled") continue;
        const key = supplyPoLineKey(item.poId, item.poLineId);
        if (item.status === "Approved") noteAccepted(key, "mc", header.mcDate);
        else if (header.status === "Submitted" || header.status === "Partially Approved") {
          noteOpen(key, "mc", header.mcDate);
        }
      }

      // Inspection calls.
      const callById = new Map(inspection.calls.map((call) => [call.id, call]));
      for (const item of inspection.items) {
        const call = callById.get(item.callId);
        if (!call || call.status === "Cancelled") continue;
        const key = supplyPoLineKey(item.poId, item.poLineId);
        if (item.status === "Passed" || item.status === "Passed with Punch Items") {
          noteAccepted(key, "inspection", call.inspectionDate ?? call.callDate);
        } else if (item.status === "Pending") {
          noteOpen(key, "inspection", call.callDate);
        }
      }

      // The four ledger stages.
      const blockingByLine = new Map<string, number>();
      const shortByLine = new Map<string, number>();
      const damagedByLine = new Map<string, number>();
      for (const stage of SUPPLY_CHAIN_GATES) {
        if (stage === "ordered" || stage === "mc" || stage === "inspection") continue;
        const state = chain.stages[stage];
        if (!state) continue;
        const docById = new Map(state.docs.map((entry) => [entry.id, entry]));
        for (const item of state.items) {
          const parent = docById.get(item.docId);
          if (!parent || parent.status === "Cancelled") continue;
          const key = supplyPoLineKey(item.poId, item.poLineId);
          if (item.status === "Accepted") {
            noteAccepted(key, stage, parent.decidedDate ?? parent.docDate);
          } else if (item.status === "Pending" && parent.status !== "Draft") {
            noteOpen(key, stage, parent.docDate);
          }
          if (stage === "grn") {
            shortByLine.set(key, (shortByLine.get(key) ?? 0) + toNumber(item.shortQty));
            damagedByLine.set(key, (damagedByLine.get(key) ?? 0) + toNumber(item.damagedQty));
          }
          const open = (item.observations ?? []).filter(
            (observation) =>
              !observation.closed &&
              (observation.severity === "Critical" || observation.severity === "Major"),
          ).length;
          if (open) blockingByLine.set(key, (blockingByLine.get(key) ?? 0) + open);
        }
      }

      /* ---- one row per PO line ---- */

      const built: SupplyChainLine[] = [];
      for (const po of purchaseOrders) {
        // Only committed POs represent real supply; drafts and cancellations are not a pipeline.
        if (!["Issued", "Received"].includes(String(po.status ?? ""))) continue;
        (po.items ?? []).forEach((item, index) => {
          const poLineId = resolvePoLineId(item, index);
          const key = supplyPoLineKey(po.id, poLineId);
          const mcLedger = mcLedgers.get(key);
          const inspectionLedger = inspectionLedgers.get(key);

          const acceptedQtyByGate: Partial<Record<SupplyChainGate, number>> = {};
          const inFlightQtyByGate: Partial<Record<SupplyChainGate, number>> = {};
          const rejectedQtyByGate: Partial<Record<SupplyChainGate, number>> = {};

          if (mcLedger) {
            acceptedQtyByGate.mc = mcLedger.approvedQty;
            inFlightQtyByGate.mc = mcLedger.reservedQty;
          }
          if (inspectionLedger) {
            acceptedQtyByGate.inspection = inspectionLedger.acceptedQty;
            inFlightQtyByGate.inspection = inspectionLedger.offeredPendingQty;
            rejectedQtyByGate.inspection = inspectionLedger.rejectedQty;
          }
          for (const stage of ["mdcc", "di", "grn", "mvac"] as const) {
            const ledger = chain.stages[stage]?.ledgers.get(key);
            if (!ledger) continue;
            acceptedQtyByGate[stage] = ledger.acceptedQty;
            inFlightQtyByGate[stage] = ledger.inFlightQty;
            rejectedQtyByGate[stage] = ledger.rejectedQty;
          }

          built.push({
            poId: po.id,
            poNumber: po.poNumber,
            poLineId,
            boqItemId: item.boqItemId,
            boqSlNo: item.boqItemId ? chain.boqSlNoByBoqItemId.get(item.boqItemId) : undefined,
            itemDescription: item.description,
            unit: item.unit,
            vendorId: po.vendorId,
            vendorName: po.vendorName,
            rate: toNumber(item.rate),
            orderedQty: toNumber(item.qty),
            cancelledQty: toNumber(item.cancelledQty),
            acceptedQtyByGate,
            inFlightQtyByGate,
            rejectedQtyByGate,
            firstAcceptedDateByGate: firstAccepted.get(key),
            oldestOpenDateByGate: oldestOpen.get(key),
            poDate: po.poDate,
            poEndDate: po.endDate,
            blockingObservationCount: blockingByLine.get(key) ?? 0,
            shortQty: shortByLine.get(key) ?? 0,
            damagedQty: damagedByLine.get(key) ?? 0,
          });
        });
      }

      setLines(built);
    } catch (error) {
      console.error("Failed to load supply reports:", error);
      setLoadError("The supply reports could not be loaded. Your registers are unchanged.");
      toast({ title: "Unable to load supply reports", variant: "destructive" });
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

  const headline = useMemo(() => buildSupplyHeadline(lines), [lines]);
  const funnel = useMemo(() => buildSupplyFunnel(lines), [lines]);
  const bottlenecks = useMemo(() => buildSupplyBottlenecks(lines), [lines]);
  const cycleTimes = useMemo(() => buildSupplyCycleTimes(lines), [lines]);
  const vendors = useMemo(() => buildSupplyVendorScores(lines), [lines]);
  const exceptions = useMemo(() => buildSupplyExceptions(lines), [lines]);
  const slowest = useMemo(() => slowestSupplyStep(cycleTimes), [cycleTimes]);
  const worstBottleneck = useMemo(
    () =>
      bottlenecks.reduce(
        (worst, entry) => (entry.stuckValue > (worst?.stuckValue ?? -1) ? entry : worst),
        bottlenecks[0],
      ),
    [bottlenecks],
  );

  const handleExport = () => {
    const csv = supplyLinesCsv(lines);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `supply-report-${projectName || mappingId}-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (isAuthLoading || (isLoading && canView && mappingId)) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] space-y-4 p-4 sm:p-6">
        <Skeleton className="h-9 w-72" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((index) => (
            <Skeleton key={index} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-96 w-full" />
      </main>
    );
  }

  if (!canView) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <Card>
          <CardContent className="py-10 text-center">
            <ShieldAlert className="mx-auto mb-3 h-10 w-10 text-destructive" />
            <p className="font-medium">Access Denied</p>
            <p className="mt-1 text-sm text-muted-foreground">
              You do not have permission to view supply reports.
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!mappingId) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <Card>
          <CardContent className="py-10 text-center">
            <p className="font-medium">Select a project first</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Open supply reports from a project in Project Management.
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  const supplyHref = `/project-management/supply?project=${encodeURIComponent(mappingId)}`;

  return (
    <PmShell
      sidebar={
        <PmSidebar
          title="Supply Reports"
          subtitle={projectName || undefined}
          icon={BarChart3}
          gradient="from-indigo-600 to-blue-600"
          activeValue={activeView}
          onChange={(value) => setActiveView(value as ViewKey)}
          groups={[
            {
              label: "Reports",
              views: VIEWS.map((entry, index) => ({
                value: entry.key,
                label: entry.label,
                icon: entry.icon,
                color: pmAccent(index).color,
                bg: pmAccent(index).bg,
                count:
                  entry.key === "exceptions"
                    ? exceptions.filter((item) => item.severity === "critical").length || undefined
                    : undefined,
              })),
            },
          ]}
        />
      }
    >
      <PmTopbar
        title="Supply reports"
        breadcrumbs={[{ label: projectName || "Project" }, { label: "Supply", href: supplyHref }]}
        backHref={supplyHref}
        backLabel="Back to Supply"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void loadData()}>
              {isLoading ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-1.5 h-4 w-4" />
              )}
              Refresh
            </Button>
            <Button size="sm" onClick={handleExport} disabled={!lines.length}>
              <Download className="mr-1.5 h-4 w-4" />
              Export lines
            </Button>
          </>
        }
      />

      <PmContent>
        {loadError && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {loadError}
          </div>
        )}

        {/* ── Headline: the whole book in four figures ─────────────────────────────────── */}
        <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              label: "Ordered",
              value: money(headline.orderedValue),
              detail: `${headline.lineCount} PO line${headline.lineCount === 1 ? "" : "s"} · ${headline.vendorCount} vendor${headline.vendorCount === 1 ? "" : "s"}`,
            },
            {
              label: "Client accepted",
              value: money(headline.deliveredValue),
              detail: `${headline.deliveredPct}% of ordered value`,
            },
            {
              label: "Open book",
              value: money(headline.openValue),
              detail: `${money(headline.inFlightValue)} presented and undecided`,
              tone: headline.openValue > 0 ? "warn" : undefined,
            },
            {
              label: "Median PO → site",
              value: days(headline.medianLeadDays),
              detail: headline.reworkValue
                ? `${money(headline.reworkValue)} returned for rework`
                : "No rework recorded",
              tone: headline.reworkValue > 0 ? "warn" : undefined,
            },
          ].map((tile) => (
            <Card key={tile.label} className="border-border/60">
              <CardContent className="p-4">
                <p className="text-xs font-medium text-muted-foreground">{tile.label}</p>
                <p
                  className={cn(
                    "mt-1 text-2xl font-bold tabular-nums",
                    tile.tone === "warn" && "text-amber-700",
                  )}
                >
                  {tile.value}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{tile.detail}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* One-line verdict, so the screen says something before anyone reads a table. */}
        {(worstBottleneck?.stuckValue ?? 0) > 0 && (
          <div className="mb-5 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <Gauge className="h-4 w-4 shrink-0" />
            <span>
              Most value is waiting at <strong>{worstBottleneck.label}</strong> —{" "}
              <strong>{money(worstBottleneck.stuckValue)}</strong> across{" "}
              {worstBottleneck.stuckLineCount} line
              {worstBottleneck.stuckLineCount === 1 ? "" : "s"}, with {worstBottleneck.owner}
              {worstBottleneck.valueWeightedAgeDays != null
                ? `, averaging ${worstBottleneck.valueWeightedAgeDays} days weighted by value`
                : ""}
              .
              {slowest
                ? ` The slowest step is ${slowest.label} at a median of ${slowest.medianDays} days.`
                : ""}
            </span>
          </div>
        )}

        {lines.length === 0 ? (
          <Card className="border-border/60">
            <CardContent className="py-12 text-center">
              <Filter className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
              <p className="font-medium">No committed purchase orders yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Reports appear once a purchase order is issued — drafts and cancelled orders are
                not a supply pipeline.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* ── Pipeline ─────────────────────────────────────────────────────────────── */}
            {activeView === "pipeline" && (
              <>
                <PmSectionHead
                  title="Pipeline by value"
                  stats={[
                    { label: "ordered", value: money(headline.orderedValue) },
                    { label: "accepted", value: money(headline.deliveredValue) },
                    {
                      label: "in flight",
                      value: money(headline.inFlightValue),
                      tone: "flag" as const,
                    },
                  ]}
                />
                <Card className="border-border/60">
                  <CardContent className="space-y-3 p-4">
                    {funnel.map((stage) => (
                      <div key={stage.gate}>
                        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
                          <span className="font-medium">
                            {stage.label}
                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                              {stage.owner}
                            </span>
                          </span>
                          <span className="tabular-nums">
                            <strong>{money(stage.value)}</strong>
                            <span className="ml-2 text-xs text-muted-foreground">
                              {stage.pctOfOrdered}% · {stage.lineCount} line
                              {stage.lineCount === 1 ? "" : "s"}
                            </span>
                          </span>
                        </div>
                        <Progress value={stage.pctOfOrdered} className="h-2" />
                        {(stage.leakedValue > 0 || stage.inFlightValue > 0) && (
                          <p className="mt-1 flex flex-wrap gap-x-4 text-xs text-muted-foreground">
                            {stage.leakedValue > 0 && (
                              <span>
                                <span className="text-amber-700">
                                  {money(stage.leakedValue)}
                                </span>{" "}
                                not yet through this gate
                              </span>
                            )}
                            {stage.inFlightValue > 0 && (
                              <span>{money(stage.inFlightValue)} presented, undecided</span>
                            )}
                            {stage.rejectedValue > 0 && (
                              <span className="text-red-700">
                                {money(stage.rejectedValue)} bounced back
                              </span>
                            )}
                          </p>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </>
            )}

            {/* ── Where value is stuck ─────────────────────────────────────────────────── */}
            {activeView === "stuck" && (
              <>
                <PmSectionHead
                  title="Where value is stuck"
                  stats={[
                    {
                      label: "gates with work waiting",
                      value: String(bottlenecks.filter((entry) => entry.stuckValue > 0).length),
                    },
                  ]}
                />
                <Card className="border-border/60">
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <Table className={PM_TABLE_CLASS}>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Gate</TableHead>
                            <TableHead>Waiting on</TableHead>
                            <TableHead className="text-right">Lines</TableHead>
                            <TableHead className="text-right">Value waiting</TableHead>
                            <TableHead className="text-right">Of that, undecided</TableHead>
                            <TableHead className="text-right">Oldest</TableHead>
                            <TableHead className="text-right">Avg age by value</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {[...bottlenecks]
                            .sort((a, b) => b.stuckValue - a.stuckValue)
                            .map((entry) => (
                              <TableRow key={entry.gate}>
                                <TableCell className="font-medium">{entry.label}</TableCell>
                                <TableCell className="text-xs text-muted-foreground">
                                  {entry.owner}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {entry.stuckLineCount || "—"}
                                </TableCell>
                                <TableCell
                                  className={cn(
                                    "text-right font-semibold tabular-nums",
                                    entry.stuckValue > 0 && "text-amber-700",
                                  )}
                                >
                                  {entry.stuckValue > 0 ? money(entry.stuckValue) : "—"}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {entry.inFlightValue > 0 ? money(entry.inFlightValue) : "—"}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {days(entry.oldestDays)}
                                </TableCell>
                                <TableCell
                                  className={cn(
                                    "text-right tabular-nums",
                                    (entry.valueWeightedAgeDays ?? 0) > 30 && "text-red-700",
                                  )}
                                >
                                  {days(entry.valueWeightedAgeDays)}
                                </TableCell>
                              </TableRow>
                            ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
                <p className="mt-2 text-xs text-muted-foreground">
                  Average age is weighted by value, so a large sum waiting a short time outranks a
                  trivial one waiting a long time — which is the order these should be chased in.
                </p>
              </>
            )}

            {/* ── Cycle time ───────────────────────────────────────────────────────────── */}
            {activeView === "cycle" && (
              <>
                <PmSectionHead
                  title="Cycle time per step"
                  stats={
                    slowest
                      ? [
                          {
                            label: "slowest step",
                            value: `${slowest.label} · ${slowest.medianDays}d`,
                            tone: "flag" as const,
                          },
                        ]
                      : []
                  }
                />
                <Card className="border-border/60">
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <Table className={PM_TABLE_CLASS}>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Step</TableHead>
                            <TableHead>Owner</TableHead>
                            <TableHead className="text-right">Lines measured</TableHead>
                            <TableHead className="text-right">Median</TableHead>
                            <TableHead className="text-right">90th percentile</TableHead>
                            <TableHead className="text-right">Worst</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {cycleTimes.map((step) => (
                            <TableRow key={`${step.from}-${step.to}`}>
                              <TableCell className="font-medium">{step.label}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {step.owner}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {step.sampleSize || "—"}
                              </TableCell>
                              <TableCell
                                className={cn(
                                  "text-right font-semibold tabular-nums",
                                  slowest && step.label === slowest.label && "text-amber-700",
                                )}
                              >
                                {days(step.medianDays)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {days(step.p90Days)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-muted-foreground">
                                {days(step.worstDays)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
                <p className="mt-2 text-xs text-muted-foreground">
                  Measured only on lines that have completed the step. Work still in progress is
                  counted as waiting time under “Where value is stuck”, never as a fast cycle here.
                </p>
              </>
            )}

            {/* ── Vendors ──────────────────────────────────────────────────────────────── */}
            {activeView === "vendors" && (
              <>
                <PmSectionHead
                  title="Vendor scorecard"
                  stats={[{ label: "vendors", value: String(vendors.length) }]}
                />
                <Card className="border-border/60">
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <Table className={PM_TABLE_CLASS}>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Vendor</TableHead>
                            <TableHead className="text-right">Lines</TableHead>
                            <TableHead className="text-right">Ordered</TableHead>
                            <TableHead className="text-right">Delivered</TableHead>
                            <TableHead className="text-right">Rejection</TableHead>
                            <TableHead className="text-right">Median lead</TableHead>
                            <TableHead className="text-right">Overdue</TableHead>
                            <TableHead className="text-right">Short / damaged</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {vendors.map((vendor) => (
                            <TableRow key={vendor.vendorId}>
                              <TableCell className="max-w-[14rem] truncate font-medium">
                                {vendor.vendorName}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {vendor.lineCount}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {money(vendor.orderedValue)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {money(vendor.deliveredValue)}
                                <span className="ml-1.5 text-xs text-muted-foreground">
                                  {vendor.deliveredPct}%
                                </span>
                              </TableCell>
                              <TableCell className="text-right">
                                {vendor.rejectionPct > 0 ? (
                                  <Badge
                                    variant="outline"
                                    className={
                                      vendor.rejectionPct >= 10
                                        ? "bg-red-100 text-red-700"
                                        : "bg-amber-100 text-amber-800"
                                    }
                                  >
                                    {vendor.rejectionPct}%
                                  </Badge>
                                ) : (
                                  <span className="text-xs text-muted-foreground">—</span>
                                )}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {days(vendor.medianLeadDays)}
                              </TableCell>
                              <TableCell
                                className={cn(
                                  "text-right tabular-nums",
                                  vendor.overdueLineCount > 0 && "font-semibold text-red-700",
                                )}
                              >
                                {vendor.overdueLineCount || "—"}
                              </TableCell>
                              <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                                {vendor.shortQty || vendor.damagedQty
                                  ? `${formatQuantity(vendor.shortQty)} / ${formatQuantity(vendor.damagedQty)}`
                                  : "—"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
                <p className="mt-2 text-xs text-muted-foreground">
                  Rejection is measured against what the vendor presented at inspection and GRN, not
                  against the whole order — a vendor part-way through a PO is not judged on what
                  they have not yet delivered.
                </p>
              </>
            )}

            {/* ── Exceptions ───────────────────────────────────────────────────────────── */}
            {activeView === "exceptions" && (
              <>
                <PmSectionHead
                  title="Exceptions"
                  stats={[
                    {
                      label: "critical",
                      value: String(
                        exceptions.filter((entry) => entry.severity === "critical").length,
                      ),
                      tone: "flag" as const,
                    },
                    {
                      label: "warnings",
                      value: String(
                        exceptions.filter((entry) => entry.severity === "warning").length,
                      ),
                    },
                  ]}
                />
                {exceptions.length === 0 ? (
                  <Card className="border-emerald-200 bg-emerald-50">
                    <CardContent className="py-8 text-center text-sm text-emerald-800">
                      Nothing is overdue, blocked, stalled or discrepant across the supply chain.
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid gap-2 lg:grid-cols-2">
                    {exceptions.map((entry) => (
                      <Card
                        key={entry.id}
                        className={cn(
                          "border-border/60",
                          entry.severity === "critical"
                            ? "border-red-200 bg-red-50/60"
                            : "border-amber-200 bg-amber-50/60",
                        )}
                      >
                        <CardContent className="flex items-start gap-3 p-3">
                          <span
                            className={cn(
                              "flex h-8 min-w-8 items-center justify-center rounded-full text-sm font-bold",
                              entry.severity === "critical"
                                ? "bg-red-100 text-red-700"
                                : "bg-amber-100 text-amber-800",
                            )}
                          >
                            {entry.lineCount}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold">{entry.title}</p>
                            <p className="text-xs text-muted-foreground">{entry.detail}</p>
                          </div>
                          {entry.value > 0 && (
                            <span className="shrink-0 text-sm font-semibold tabular-nums">
                              {money(entry.value)}
                            </span>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </PmContent>
    </PmShell>
  );
}

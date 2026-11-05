"use client";

/**
 * Supply hub.
 *
 * The scope read as the pipeline it is: what the BOQ says this project will buy, how much of that
 * value has reached each gate, and the four phases it passes through on the way. The screens are
 * the same ones this page always linked to — they now sit inside the phase they belong to, with
 * the figures that say whether that phase is moving.
 *
 * Every number is real. The funnel is measured against **BOQ value**, not ordered value: the hub's
 * question is "how much of what we promised to buy have we bought and received", which the
 * order-book conversion in the Reports funnel cannot answer because it starts at the PO. Gates
 * with nothing recorded show "—" rather than 0%.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  BarChart3,
  CalendarClock,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Compass,
  Factory,
  FileCheck2,
  FileSearch,
  ListChecks,
  Package,
  PackageCheck,
  PenTool,
  ShieldAlert,
  ShoppingCart,
  Truck,
} from "lucide-react";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  buildSupplyDemand,
  buildSupplyExceptions,
  buildSupplyFunnel,
  buildSupplyHeadline,
  buildSupplyPipeline,
  buildSupplyVendorScores,
  type SupplyChainLine,
  type SupplyPipelineStage,
} from "@/lib/project-management-supply-analytics";
import { loadSupplyChainLines } from "@/lib/project-management-supply-lines";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge, type StatusTone } from "@/components/shared/status-badge";
import { useAuthorization } from "@/hooks/useAuthorization";
import { cn } from "@/lib/utils";

const MODULE_NAME = "Project Management";
const PERMISSION_RESOURCE = `${MODULE_NAME}.Supply`;

type ProjectMapping = {
  id: string;
  projectName: string;
  globalProjectId: string;
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: value >= 10_000_000 ? 2 : 0,
    notation: value >= 10_000_000 ? "compact" : "standard",
  }).format(value);

const formatCount = (value: number) => new Intl.NumberFormat("en-IN").format(value);

const formatPct = (value: number | null) => (value === null ? "—" : `${Math.round(value)}%`);

/** Per-stage accent for the funnel, cooling from demand through to acceptance. */
const stageAccent: Record<SupplyPipelineStage["key"], string> = {
  boq: "from-blue-300 to-blue-600",
  indent: "from-indigo-300 to-indigo-600",
  ordered: "from-violet-300 to-violet-600",
  mc: "from-green-300 to-green-600",
  inspection: "from-teal-300 to-teal-600",
  mdcc: "from-sky-300 to-sky-600",
  di: "from-cyan-300 to-cyan-600",
  grn: "from-orange-300 to-orange-600",
  mvac: "from-pink-300 to-pink-600",
};

export default function SupplyPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const canViewBoq = can("View", `${MODULE_NAME}.BOQ`);
  const canView = can("View", PERMISSION_RESOURCE) || canViewBoq;
  const canViewIndent = can("View", `${MODULE_NAME}.Indent`) || canViewBoq;
  const canViewRfq = can("View", `${MODULE_NAME}.RFQ`) || canViewBoq;
  const canViewPurchaseOrders = can("View", `${MODULE_NAME}.Purchase Orders`) || canViewRfq;
  const canViewSurvey = can("View", `${MODULE_NAME}.Survey`) || canViewBoq;
  const canViewRequirementPlanner =
    can("View", `${MODULE_NAME}.Requirement Planner`) || canViewIndent;
  const canViewDrawing = can("View", `${MODULE_NAME}.Drawing`) || canViewBoq;
  const canViewManufacturingClearance =
    can("View", `${MODULE_NAME}.Manufacturing Clearance`) || canViewBoq;
  const canViewInspections = can("View", `${MODULE_NAME}.Inspections`) || canViewBoq;
  const canViewMdcc = can("View", `${MODULE_NAME}.MDCC`) || canViewBoq;
  const canViewDi = can("View", `${MODULE_NAME}.Dispatch Instructions`) || canViewBoq;
  const canViewGrn = can("View", `${MODULE_NAME}.GRN`) || canViewBoq;
  const canViewMvac = can("View", `${MODULE_NAME}.MVAC`) || canViewBoq;

  const [mapping, setMapping] = useState<ProjectMapping | null>(null);
  const [isResolving, setIsResolving] = useState(Boolean(mappingId));
  const [lines, setLines] = useState<SupplyChainLine[]>([]);
  const [boqItems, setBoqItems] = useState<Array<Record<string, unknown>>>([]);
  const [indents, setIndents] = useState<Array<Record<string, unknown>>>([]);
  const [isFetching, setIsFetching] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (!mappingId || isAuthLoading || !canView) return;
    let cancelled = false;
    void (async () => {
      try {
        const snapshot = await getDoc(doc(db, "projectManagementProjects", mappingId));
        if (cancelled) return;
        const data = snapshot.data() as { projectName?: string; globalProjectId?: string } | undefined;
        setMapping(
          data
            ? {
                id: mappingId,
                projectName: String(data.projectName ?? ""),
                globalProjectId: String(data.globalProjectId ?? ""),
              }
            : null,
        );
      } catch (error) {
        console.error("Failed to load project mapping:", error);
        if (!cancelled) setMapping(null);
      } finally {
        if (!cancelled) setIsResolving(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mappingId, isAuthLoading, canView]);

  const globalProjectId = mapping?.globalProjectId ?? "";

  const loadPipeline = useCallback(async () => {
    if (!globalProjectId) return;
    setIsFetching(true);
    setLoadError("");
    try {
      const [built, boqSnapshot, indentSnapshot] = await Promise.all([
        loadSupplyChainLines(globalProjectId),
        getDocs(collection(db, "projects", globalProjectId, "boqItems")),
        getDocs(collection(db, "projects", globalProjectId, "indents")),
      ]);
      setLines(built);
      setBoqItems(boqSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
      setIndents(indentSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    } catch (error) {
      console.error("Failed to load the supply pipeline:", error);
      setLoadError("The supply figures could not be loaded. Your registers are unchanged.");
    } finally {
      setIsFetching(false);
    }
  }, [globalProjectId]);

  useEffect(() => {
    if (!globalProjectId) return;
    // The fetch sets its own loading flag as it starts; that is what this effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadPipeline();
  }, [globalProjectId, loadPipeline]);

  const isLoading = isFetching && Boolean(globalProjectId);

  const demand = useMemo(() => buildSupplyDemand(boqItems, indents), [boqItems, indents]);
  const funnel = useMemo(() => buildSupplyFunnel(lines), [lines]);
  const pipeline = useMemo(() => buildSupplyPipeline({ demand, funnel }), [demand, funnel]);
  const headline = useMemo(() => buildSupplyHeadline(lines), [lines]);
  const exceptions = useMemo(() => buildSupplyExceptions(lines), [lines]);
  const vendors = useMemo(() => buildSupplyVendorScores(lines), [lines]);

  const stageByKey = useMemo(
    () => new Map(pipeline.map((stage) => [stage.key, stage])),
    [pipeline],
  );
  const stagePct = (key: SupplyPipelineStage["key"]) => stageByKey.get(key)?.pctOfBoq ?? null;
  const stageChips = (key: SupplyPipelineStage["key"]) => {
    const stage = stageByKey.get(key);
    if (!stage || stage.lineCount === 0) return [];
    return [`${formatCount(stage.lineCount)} lines`, formatCurrency(stage.value)];
  };

  const overdueLineCount = useMemo(
    () => vendors.reduce((sum, vendor) => sum + vendor.overdueLineCount, 0),
    [vendors],
  );

  const withProject = (path: string) => `${path}?project=${encodeURIComponent(mappingId)}`;

  const phases = [
    {
      key: "plan",
      title: "Plan & specify",
      description: "What to buy, how much, and when",
      gradient: "from-blue-300 to-blue-600",
      /** The phase ends when demand has been raised against the BOQ. */
      pct: stagePct("indent"),
      pctBasis: "of BOQ value indented",
      items: [
        {
          show: canViewBoq,
          href: `/project-management/boq/costing?project=${encodeURIComponent(mappingId)}&scope2=Supply`,
          title: "BOQ",
          description: "Scope 2 = Supply, with every gate quantity alongside.",
          icon: ClipboardList,
          gradient: "from-blue-400 to-sky-600",
          chips:
            demand.boqLineCount > 0
              ? [`${formatCount(demand.boqLineCount)} items`, formatCurrency(demand.boqValue)]
              : [],
        },
        {
          show: canViewSurvey,
          href: withProject("/project-management/survey"),
          title: "Survey",
          description: "Verify BOQ quantities at site before anything is ordered.",
          icon: Compass,
          gradient: "from-rose-400 to-rose-600",
          chips: [],
        },
        {
          show: canViewRequirementPlanner,
          href: withProject("/project-management/requirement-planner"),
          title: "Requirement Planner",
          description: "What must be indented today, and what is already late.",
          icon: CalendarClock,
          gradient: "from-amber-300 to-amber-600",
          chips: [],
        },
        {
          show: canViewDrawing,
          href: withProject("/project-management/drawing"),
          title: "Drawing",
          description: "Submissions, revisions and approvals before manufacture.",
          icon: PenTool,
          gradient: "from-slate-400 to-slate-700",
          chips: [],
        },
      ],
    },
    {
      key: "procure",
      title: "Procure",
      description: "From demand to a signed order",
      gradient: "from-violet-300 to-violet-600",
      pct: stagePct("ordered"),
      pctBasis: "of BOQ value ordered",
      items: [
        {
          show: canViewIndent,
          href: withProject("/project-management/indent"),
          title: "Indent",
          description: "Raise demand against BOQ items.",
          icon: ListChecks,
          gradient: "from-orange-300 to-orange-600",
          chips:
            demand.indentedLineCount > 0
              ? [
                  `${formatCount(demand.indentedLineCount)} lines`,
                  formatCurrency(demand.indentedValue),
                ]
              : [],
        },
        {
          show: canViewRfq,
          href: withProject("/project-management/rfq"),
          title: "RFQ",
          description: "Request and compare vendor quotations.",
          icon: FileSearch,
          gradient: "from-violet-400 to-purple-600",
          chips: [],
        },
        {
          show: canViewPurchaseOrders,
          href: withProject("/project-management/purchase-orders"),
          title: "Purchase Orders",
          description: "Commit quantity and rate to a vendor.",
          icon: ShoppingCart,
          gradient: "from-emerald-400 to-emerald-700",
          chips:
            headline.lineCount > 0
              ? [
                  `${formatCount(headline.vendorCount)} vendors`,
                  formatCurrency(headline.orderedValue),
                ]
              : [],
        },
      ],
    },
    {
      key: "make",
      title: "Manufacture & inspect",
      description: "Vendor production and quality",
      gradient: "from-green-300 to-green-600",
      pct: stagePct("inspection"),
      pctBasis: "of BOQ value inspected",
      items: [
        {
          show: canViewManufacturingClearance,
          href: withProject("/project-management/manufacturing-clearance"),
          title: "Manufacturing Clearance",
          description: "Clear a vendor to begin production.",
          icon: Factory,
          gradient: "from-green-400 to-green-700",
          chips: stageChips("mc"),
        },
        {
          show: canViewInspections,
          href: withProject("/project-management/inspections"),
          title: "Inspections",
          description: "Offer cleared quantity and record what passed.",
          icon: ClipboardCheck,
          gradient: "from-indigo-400 to-indigo-700",
          chips: stageChips("inspection"),
        },
      ],
    },
    {
      key: "deliver",
      title: "Dispatch & accept",
      description: "From factory gate to billing",
      gradient: "from-pink-300 to-pink-600",
      pct: stagePct("mvac"),
      pctBasis: "of BOQ value client-accepted",
      items: [
        {
          show: canViewMdcc,
          href: withProject("/project-management/mdcc/documents"),
          title: "MDCC",
          description: "The client's clearance to dispatch.",
          icon: BadgeCheck,
          gradient: "from-fuchsia-400 to-fuchsia-700",
          chips: stageChips("mdcc"),
        },
        {
          show: canViewDi,
          href: withProject("/project-management/dispatch-instructions/documents"),
          title: "Dispatch Instructions",
          description: "SEL's numbered instruction authorising vendor dispatch.",
          icon: Truck,
          gradient: "from-blue-400 to-blue-700",
          chips: stageChips("di"),
        },
        {
          show: canViewGrn,
          href: withProject("/project-management/grn/documents"),
          title: "GRN",
          description: "Record material receipt at site.",
          icon: PackageCheck,
          gradient: "from-orange-400 to-orange-700",
          chips: stageChips("grn"),
        },
        {
          show: canViewMvac,
          href: withProject("/project-management/mvac/documents"),
          title: "MVAC",
          description: "Joint acceptance with the client — the billing trigger.",
          icon: FileCheck2,
          gradient: "from-teal-400 to-teal-700",
          chips: stageChips("mvac"),
        },
      ],
    },
  ]
    .map((phase) => ({ ...phase, items: phase.items.filter((item) => item.show) }))
    .filter((phase) => phase.items.length > 0);

  if (isAuthLoading || isResolving) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] space-y-5 p-4 sm:p-6">
        <Skeleton className="h-64 w-full rounded-3xl" />
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 2xl:grid-cols-4">
          {[1, 2, 3, 4].map((index) => (
            <Skeleton key={index} className="h-72 rounded-2xl" />
          ))}
        </div>
      </main>
    );
  }

  if (!canView) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <PageHeader title="Supply" icon={Package} />
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to view Supply.</CardDescription>
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
            <CardDescription>
              Return to Project Management and choose a project before opening Supply.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/project-management">Select Project</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100dvh-4rem)] space-y-5 p-4 sm:p-6">
      {/* ── Hero ─────────────────────────────────────────────────────────────────────────── */}
      <section className="relative isolate overflow-hidden rounded-3xl border border-border/50 bg-card/60 shadow-sm">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
          <span className="absolute -left-[5%] -top-32 h-64 w-[32rem] rounded-full bg-sky-300/40 blur-3xl animate-blob-drift-a motion-reduce:animate-none" />
          <span className="absolute left-[40%] -top-36 h-64 w-[35rem] rounded-full bg-indigo-300/40 blur-3xl animate-blob-drift-b motion-reduce:animate-none" />
          <span className="absolute -right-[5%] -bottom-36 h-60 w-[30rem] rounded-full bg-teal-300/40 blur-3xl animate-blob-drift-c motion-reduce:animate-none" />
        </div>

        <div className="space-y-5 p-5 sm:p-6">
          <div className="grid grid-cols-1 items-center gap-5 xl:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0">
              <nav className="flex flex-wrap items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-wider text-muted-foreground">
                <Link href="/project-management" className="hover:text-foreground">
                  Projects
                </Link>
                <ChevronRight className="h-3 w-3" />
                <Link href={withProject("/project-management")} className="hover:text-foreground">
                  {mapping.projectName || "Project"}
                </Link>
                <ChevronRight className="h-3 w-3" />
                <span className="text-foreground/70">Scope 2</span>
              </nav>
              <div className="mt-2.5 flex items-center gap-3.5">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-400 to-sky-700 text-white shadow-md sm:h-14 sm:w-14">
                  <Package className="h-6 w-6" />
                </span>
                <div className="min-w-0">
                  <h1 className="bg-gradient-to-r from-sky-700 via-indigo-600 to-violet-600 bg-clip-text text-2xl font-extrabold leading-tight tracking-tight text-transparent sm:text-3xl">
                    Supply
                  </h1>
                  <p className="truncate text-sm text-muted-foreground">
                    {mapping.projectName} · from BOQ through to client acceptance
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
              {[
                {
                  label: "Supply value",
                  value: isLoading ? null : formatCurrency(demand.boqValue),
                  detail: `${formatCount(demand.boqLineCount)} BOQ items`,
                  hot: false,
                },
                {
                  label: "Accepted (MVAC)",
                  value: isLoading ? null : formatPct(stagePct("mvac")),
                  detail: `${formatCurrency(headline.deliveredValue)} billable`,
                  hot: false,
                },
                {
                  label: "POs placed",
                  value: isLoading ? null : formatCount(headline.lineCount),
                  detail: `${formatCount(headline.vendorCount)} vendors`,
                  hot: false,
                },
                {
                  label: "Late lines",
                  value: isLoading ? null : formatCount(overdueLineCount),
                  detail: "past PO completion date",
                  hot: overdueLineCount > 0,
                },
              ].map((kpi) => (
                <div
                  key={kpi.label}
                  className="min-w-[132px] rounded-2xl border border-border/50 bg-card/80 px-3.5 py-2.5 backdrop-blur-sm"
                >
                  <p className="text-[11.5px] font-bold text-muted-foreground">{kpi.label}</p>
                  {kpi.value === null ? (
                    <Skeleton className="my-1 h-6 w-20" />
                  ) : (
                    <p
                      className={cn(
                        "text-xl font-extrabold leading-tight tracking-tight",
                        kpi.hot && "text-destructive",
                      )}
                    >
                      {kpi.value}
                    </p>
                  )}
                  <p className="text-[11.5px] font-medium text-muted-foreground">{kpi.detail}</p>
                </div>
              ))}
            </div>
          </div>

          {/* ── Quantity flow ──────────────────────────────────────────────────────────── */}
          <div className="rounded-2xl border border-border/50 bg-card/80 p-3.5 backdrop-blur-sm sm:p-4">
            <div className="mb-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <p className="text-xs font-extrabold text-muted-foreground">Quantity flow</p>
              <p className="text-[11.5px] text-muted-foreground">
                · share of BOQ value that has passed each gate
              </p>
            </div>
            {isLoading ? (
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5 xl:grid-cols-9">
                {Array.from({ length: 9 }).map((_, index) => (
                  <Skeleton key={index} className="h-[70px] rounded-lg" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5 xl:grid-cols-9">
                {pipeline.map((stage) => (
                  <div key={stage.key} className="min-w-0">
                    <p
                      className="truncate text-[11px] font-bold text-muted-foreground"
                      title={stage.label}
                    >
                      {stage.label}
                    </p>
                    <div
                      className="relative mt-1 h-9 overflow-hidden rounded-lg bg-muted"
                      title={`${formatCurrency(stage.value)} · ${formatCount(stage.lineCount)} lines`}
                    >
                      <div
                        className={cn(
                          "absolute inset-x-0 bottom-0 rounded-lg bg-gradient-to-t",
                          stageAccent[stage.key],
                        )}
                        style={{ height: `${Math.min(Math.max(stage.pctOfBoq ?? 0, 0), 100)}%` }}
                      />
                      <span className="absolute inset-0 grid place-items-center text-[11px] font-extrabold text-foreground">
                        {formatPct(stage.pctOfBoq)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {loadError ? (
        <Card className="border-destructive/40">
          <CardContent className="p-4 text-sm text-destructive">{loadError}</CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* ── Phases ─────────────────────────────────────────────────────────────────────── */}
        <div className="grid min-w-0 grid-cols-1 gap-3.5 sm:grid-cols-2 2xl:grid-cols-4">
          {phases.map((phase, phaseIndex) => (
            <Card key={phase.key} className="flex flex-col border-border/60 p-3">
              <header className="mb-2.5 flex items-center gap-2.5 border-b border-dashed border-border px-1 pb-2.5">
                <span
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-[12.5px] font-extrabold text-white",
                    phase.gradient,
                  )}
                >
                  {phaseIndex + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold leading-tight">{phase.title}</p>
                  <p className="truncate text-[11.5px] text-muted-foreground">{phase.description}</p>
                </div>
                <span
                  className="shrink-0 text-base font-extrabold tabular-nums"
                  title={phase.pctBasis}
                >
                  {isLoading ? "—" : formatPct(phase.pct)}
                </span>
              </header>
              <div className="mx-1 mb-2.5 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full bg-gradient-to-r", phase.gradient)}
                  style={{ width: `${Math.min(Math.max(phase.pct ?? 0, 0), 100)}%` }}
                />
              </div>

              <div className="space-y-0.5">
                {phase.items.map((item) => (
                  <Link
                    key={item.title}
                    href={item.href}
                    className="group flex items-start gap-2.5 rounded-xl border border-transparent p-2.5 no-underline transition hover:border-border hover:bg-muted/40"
                  >
                    <span
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br text-white shadow-sm",
                        item.gradient,
                      )}
                    >
                      <item.icon className="h-[17px] w-[17px]" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-bold leading-tight">{item.title}</p>
                      <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
                        {item.description}
                      </p>
                      {item.chips.length > 0 ? (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {item.chips.map((chip) => (
                            <span
                              key={chip}
                              className="rounded-md bg-muted px-1.5 py-0.5 text-[11.5px] font-bold text-muted-foreground"
                            >
                              {chip}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <ChevronRight className="mt-1.5 h-4 w-4 shrink-0 text-muted-foreground/50 transition group-hover:translate-x-0.5 group-hover:text-foreground" />
                  </Link>
                ))}
              </div>
            </Card>
          ))}
        </div>

        {/* ── Rail ───────────────────────────────────────────────────────────────────────── */}
        <aside className="space-y-3.5 xl:sticky xl:top-20">
          <Card className="overflow-hidden border-border/60">
            <CardHeader className="flex-row items-center justify-between space-y-0 p-4 pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-bold">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Needs attention
                {!isLoading && exceptions.length > 0 ? (
                  <StatusBadge status="count" tone="danger" className="px-2">
                    {exceptions.length}
                  </StatusBadge>
                ) : null}
              </CardTitle>
              <Link
                href={withProject("/project-management/supply/reports")}
                className="text-xs font-bold text-primary no-underline"
              >
                All
              </Link>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {isLoading ? (
                <div className="space-y-2 py-1">
                  {[1, 2, 3].map((index) => (
                    <Skeleton key={index} className="h-10 rounded-lg" />
                  ))}
                </div>
              ) : exceptions.length === 0 ? (
                <p className="py-3 text-xs text-muted-foreground">
                  Nothing is flagged across the supply chain right now.
                </p>
              ) : (
                <ul className="divide-y divide-dashed divide-border">
                  {exceptions.slice(0, 6).map((exception) => (
                    <li key={exception.id} className="flex items-start gap-2.5 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-[12.5px] font-semibold leading-snug">
                          {exception.title}
                        </p>
                        <p
                          className="truncate text-[11.5px] text-muted-foreground"
                          title={exception.detail}
                        >
                          {exception.detail}
                        </p>
                      </div>
                      <StatusBadge
                        status={exception.severity}
                        tone={
                          (exception.severity === "critical" ? "danger" : "warning") as StatusTone
                        }
                        className="shrink-0"
                      >
                        {exception.value > 0
                          ? formatCurrency(exception.value)
                          : formatCount(exception.lineCount)}
                      </StatusBadge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card className="overflow-hidden border-border/60">
            <CardHeader className="flex-row items-center justify-between space-y-0 p-4 pb-2">
              <CardTitle className="text-sm font-bold">Vendor delivery</CardTitle>
              <Link
                href={`${withProject("/project-management/supply/reports")}&view=vendors`}
                className="text-xs font-bold text-primary no-underline"
              >
                Reports
              </Link>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {isLoading ? (
                <div className="space-y-2 py-1">
                  {[1, 2, 3].map((index) => (
                    <Skeleton key={index} className="h-10 rounded-lg" />
                  ))}
                </div>
              ) : vendors.length === 0 ? (
                <p className="py-3 text-xs text-muted-foreground">
                  No committed purchase orders on this project yet.
                </p>
              ) : (
                <ul className="space-y-2.5">
                  {vendors.slice(0, 5).map((vendor) => (
                    <li key={vendor.vendorId || vendor.vendorName}>
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate text-[12.5px] font-bold" title={vendor.vendorName}>
                          {vendor.vendorName || "Unnamed vendor"}
                        </p>
                        <span className="shrink-0 text-[12.5px] font-extrabold tabular-nums">
                          {Math.round(vendor.deliveredPct)}%
                        </span>
                      </div>
                      <p className="truncate text-[11.5px] text-muted-foreground">
                        {formatCount(vendor.lineCount)} lines ·{" "}
                        {formatCurrency(vendor.orderedValue)}
                        {vendor.overdueLineCount > 0
                          ? ` · ${formatCount(vendor.overdueLineCount)} late`
                          : ""}
                      </p>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn(
                            "h-full rounded-full bg-gradient-to-r",
                            vendor.deliveredPct < 70
                              ? "from-orange-300 to-orange-600"
                              : "from-green-300 to-green-600",
                          )}
                          style={{
                            width: `${Math.min(Math.max(vendor.deliveredPct, 0), 100)}%`,
                          }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Link
            href={withProject("/project-management/supply/reports")}
            className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card p-3.5 no-underline transition hover:bg-muted/40"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-400 to-indigo-700 text-white shadow-sm">
              <BarChart3 className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-bold">Reports</p>
              <p className="text-[11.5px] text-muted-foreground">
                Pipeline, bottlenecks, cycle time and vendor performance
              </p>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>
        </aside>
      </div>
    </main>
  );
}

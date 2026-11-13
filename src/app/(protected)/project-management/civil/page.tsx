"use client";

/**
 * Civil hub.
 *
 * The scope read as one picture: how far the work has actually got, where the plan said it would
 * be by now, and how much of it the client has agreed to. The three registers it runs on — Daily
 * Progress, JMC and the subcontractors' work orders — each answer a different one of those, and
 * the page puts them side by side rather than making you open three screens to compare them.
 *
 * **Value is the only common denominator.** A civil BOQ mixes Cum, Sqm, Rmt and lump sums, so no
 * headline figure sums quantities across lines; every percentage is a share of the civil BOQ's
 * value (see project-management-civil-progress.ts). Quantities stay per line, in the work items
 * table, where a unit means something.
 *
 * Nothing here is a placeholder. Where a register is empty the figure reads "—", not 0%.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Building2,
  ChevronRight,
  CloudSun,
  FileText,
  HardHat,
  Plus,
  Ruler,
  ShieldAlert,
  Truck,
  Users,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge, type StatusTone } from "@/components/shared/status-badge";
import { chartChrome } from "@/components/ui/chart";
import { PmEmptyState } from "@/components/project-management/pm-shell";
import { useAuthorization } from "@/hooks/useAuthorization";
import { cn } from "@/lib/utils";
import { PM_JMC_BASE_PATH } from "@/lib/jmc-module";
import { projectSlugCanonical } from "@/lib/project-slug";
import {
  DPR_BASE_PATH,
  DPR_ENTRY_COLLECTION,
  DPR_PERMISSION_RESOURCE,
  DPR_TARGET_COLLECTION,
  periodRangeFor,
  type DprEntry,
  type DprTarget,
} from "@/lib/project-management-dpr";
import {
  DPR_SETTINGS_COLLECTION,
  DPR_SETTINGS_DOC_ID,
  buildDprPlan,
  defaultDprSettings,
  dprCalendar,
  dprUnitDecimals,
  sanitizeDprSettings,
  type DprSettings,
} from "@/lib/project-management-dpr-plan";
import {
  DPR_SUB_ITEM_COLLECTION,
  buildDprBreakdown,
  type DprSubItem,
} from "@/lib/project-management-dpr-breakdown";
import {
  JMC_ENTRY_COLLECTION,
  SUBCONTRACTOR_BILL_COLLECTION,
  WORK_ORDER_COLLECTION,
  type MeasurementEntryLike,
  type SubcontractorBillLike,
  type WorkOrderLike,
} from "@/lib/civil-execution";
import {
  buildCivilAttention,
  buildCivilBoqLines,
  buildCivilCertifiedEvents,
  buildCivilHeadline,
  buildCivilProgressCurve,
  buildCivilSubcontractors,
  buildCivilToday,
  buildCivilWorkItems,
  civilSubItemLinks,
  type CivilStatusTone,
} from "@/lib/project-management-civil-progress";

const MODULE_NAME = "Project Management";
const PERMISSION_RESOURCE = `${MODULE_NAME}.Civil`;
const SUBCONTRACTORS_MODULE = "Subcontractors Management";

type ProjectMapping = {
  id: string;
  projectName: string;
  globalProjectId: string;
  globalProjectName?: string;
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: value >= 10_000_000 ? 2 : 0,
    notation: value >= 10_000_000 ? "compact" : "standard",
  }).format(value);

const formatQty = (value: number) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value);

const formatPct = (value: number | null) => (value === null ? "—" : `${Math.round(value)}%`);

const formatDisplayDate = (isoDate: string) => {
  if (!isoDate) return "—";
  const date = new Date(`${isoDate}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? isoDate
    : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
};

const todayIso = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

const toneBadge: Record<CivilStatusTone, StatusTone> = {
  ok: "success",
  warn: "warning",
  bad: "danger",
  idle: "neutral",
};

/** How far back the S-curve looks. "All" starts at the earliest record there is. */
const RANGES = [
  { key: "8w", label: "8 weeks", weeks: 8 },
  { key: "16w", label: "16 weeks", weeks: 16 },
  { key: "all", label: "All", weeks: 0 },
] as const;

type RangeKey = (typeof RANGES)[number]["key"];

/** A compact progress bar with a tick where the plan says this line should be today. */
function ProgressWithPlan({
  progressPct,
  planPct,
  gradient,
}: {
  progressPct: number | null;
  planPct: number | null;
  gradient: string;
}) {
  return (
    <div className="flex min-w-[140px] items-center gap-2">
      <div className="relative h-2 flex-1 rounded-full bg-muted">
        <div
          className={cn("absolute inset-y-0 left-0 rounded-full bg-gradient-to-r", gradient)}
          style={{ width: `${Math.min(Math.max(progressPct ?? 0, 0), 100)}%` }}
        />
        {planPct === null ? null : (
          <span
            aria-hidden
            title={`Plan for today: ${Math.round(planPct)}%`}
            className="absolute -top-0.5 bottom-[-2px] w-0.5 rounded-full bg-foreground/60"
            style={{ left: `${Math.min(Math.max(planPct, 0), 100)}%` }}
          />
        )}
      </div>
      <span className="w-10 shrink-0 text-right text-xs font-semibold tabular-nums">
        {formatPct(progressPct)}
      </span>
    </div>
  );
}

export default function CivilPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const canViewBoq = can("View", `${MODULE_NAME}.BOQ`);
  const canView = can("View", PERMISSION_RESOURCE) || canViewBoq;
  const canViewDpr = can("View", DPR_PERMISSION_RESOURCE) || can("View", `${MODULE_NAME}.Civil`);
  // JMC is hosted by both modules against the same registers, so either view right opens it.
  const canViewJmc = can("View", `${MODULE_NAME}.JMC`) || can("View", "Billing Recon.JMC");

  const [mapping, setMapping] = useState<ProjectMapping | null>(null);
  const [isResolving, setIsResolving] = useState(true);
  const [boqItems, setBoqItems] = useState<Array<Record<string, unknown>>>([]);
  const [entries, setEntries] = useState<DprEntry[]>([]);
  const [targets, setTargets] = useState<DprTarget[]>([]);
  const [dprSettings, setDprSettings] = useState<DprSettings>(() => defaultDprSettings());
  /** Daily Progress's work breakdown: sub-items whose progress belongs to their BOQ lines. */
  const [dprSubItems, setDprSubItems] = useState<DprSubItem[]>([]);
  const [jmcEntries, setJmcEntries] = useState<MeasurementEntryLike[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrderLike[]>([]);
  const [bills, setBills] = useState<SubcontractorBillLike[]>([]);
  const [isFetching, setIsFetching] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [rangeKey, setRangeKey] = useState<RangeKey>("16w");

  const globalProjectId = mapping?.globalProjectId ?? "";

  /**
   * Subcontractors Management rights are scoped per project, and the scope is the GLOBAL project id
   * — the same argument its own sidebar passes. Checking them unscoped here would show tiles the
   * destination then refuses, so the check is deferred until the mapping has resolved.
   */
  const canSub = (resource: string) =>
    Boolean(globalProjectId) && can("View", `${SUBCONTRACTORS_MODULE}.${resource}`, globalProjectId);

  /** Their own pickers build URLs with the canonical slug, so links are built with it too. */
  const subcontractorSlug = projectSlugCanonical(mapping?.globalProjectName);
  const subHref = (suffix: string) =>
    subcontractorSlug
      ? `/subcontractors-management/${subcontractorSlug}${suffix ? `/${suffix}` : ""}`
      : "#";

  useEffect(() => {
    if (isAuthLoading || !canView || !mappingId) return;
    let cancelled = false;
    void (async () => {
      try {
        const snapshot = await getDoc(doc(db, "projectManagementProjects", mappingId));
        if (cancelled) return;
        if (!snapshot.exists()) {
          setMapping(null);
          return;
        }
        const data = snapshot.data() as {
          projectName?: string;
          globalProjectId?: string;
          globalProjectName?: string;
        };
        // The Subcontractors links need the GLOBAL project's name to build their slug. The mapping
        // usually caches it; when it doesn't, read the project document rather than falling back to
        // the mapping's own alias, which would slug to something that resolves to nothing there.
        let globalProjectName = data.globalProjectName ?? "";
        if (!globalProjectName && data.globalProjectId) {
          const projectSnapshot = await getDoc(doc(db, "projects", data.globalProjectId));
          globalProjectName = String(projectSnapshot.data()?.projectName ?? "");
        }
        if (!cancelled) {
          setMapping({
            id: snapshot.id,
            projectName: String(data.projectName ?? ""),
            globalProjectId: String(data.globalProjectId ?? ""),
            globalProjectName,
          });
        }
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
  }, [isAuthLoading, canView, mappingId]);

  const loadRegisters = useCallback(async () => {
    if (!globalProjectId) return;
    setIsFetching(true);
    setLoadError("");
    try {
      const path = ["projects", globalProjectId] as const;
      const [boqSnap, entrySnap, targetSnap, jmcSnap, workOrderSnap, billSnap, dprSettingsSnap, subItemSnap] = await Promise.all([
        getDocs(collection(db, ...path, "boqItems")),
        getDocs(collection(db, ...path, DPR_ENTRY_COLLECTION)),
        getDocs(collection(db, ...path, DPR_TARGET_COLLECTION)),
        getDocs(collection(db, ...path, JMC_ENTRY_COLLECTION)),
        getDocs(collection(db, ...path, WORK_ORDER_COLLECTION)),
        getDocs(collection(db, ...path, SUBCONTRACTOR_BILL_COLLECTION)),
        // Daily Progress's calendar and unit precision, so planned figures here match its own.
        // A failed read falls back to the defaults rather than failing the hub.
        getDoc(doc(db, ...path, DPR_SETTINGS_COLLECTION, DPR_SETTINGS_DOC_ID)).catch((error: unknown) => {
          console.error("Failed to read the DPR settings; using the defaults:", error);
          return null;
        }),
        // Without the breakdown, sub-item progress would simply be missing here, not wrong.
        getDocs(collection(db, ...path, DPR_SUB_ITEM_COLLECTION)).catch((error: unknown) => {
          console.error("Failed to read the DPR work breakdown:", error);
          return null;
        }),
      ]);
      setDprSubItems(
        (subItemSnap?.docs ?? []).map((entry) => ({ id: entry.id, ...entry.data() }) as DprSubItem),
      );
      const records = <T,>(snapshot: typeof boqSnap) =>
        snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }) as T);

      setBoqItems(records<Record<string, unknown>>(boqSnap));
      setEntries(records<DprEntry>(entrySnap));
      setTargets(records<DprTarget>(targetSnap));
      setDprSettings(sanitizeDprSettings(dprSettingsSnap?.exists() ? dprSettingsSnap.data() : null));
      setJmcEntries(records<MeasurementEntryLike>(jmcSnap));
      setWorkOrders(records<WorkOrderLike>(workOrderSnap));
      setBills(records<SubcontractorBillLike>(billSnap));
    } catch (error) {
      console.error("Failed to load the civil registers:", error);
      setLoadError("The civil figures could not be loaded. Your registers are unchanged.");
    } finally {
      setIsFetching(false);
    }
  }, [globalProjectId]);

  useEffect(() => {
    if (!globalProjectId) return;
    // The fetch sets its own loading flag as it starts; that is what this effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRegisters();
  }, [globalProjectId, loadRegisters]);

  const isLoading = isFetching && Boolean(globalProjectId);
  const today = todayIso();

  const lines = useMemo(() => buildCivilBoqLines(boqItems), [boqItems]);
  const certifiedEvents = useMemo(() => buildCivilCertifiedEvents(jmcEntries), [jmcEntries]);

  /**
   * The same planning engine Daily Progress reads: working days only, the projection's spread, and
   * the shorter of two overlapping projections owning the shared days.
   */
  /**
   * Daily Progress's work breakdown over the civil lines. Sub-item progress is carried onto its
   * BOQ line, as the share of the line it stands for, so it counts here in the line's unit and value.
   */
  const breakdown = useMemo(
    () =>
      buildDprBreakdown(
        lines.map((line) => ({
          id: line.id,
          scope: "Civil" as const,
          boqSlNo: line.boqSlNo,
          erpSlNo: line.erpSlNo,
          description: line.description,
          unit: line.unit,
          boqQty: line.boqQty,
          rate: line.rate,
        })),
        dprSubItems,
      ),
    [lines, dprSubItems],
  );
  const subItemLinks = useMemo(() => civilSubItemLinks(breakdown), [breakdown]);

  const plan = useMemo(() => {
    // Projections on sub-items are spread at the sub-item's unit, those on lines at the line's.
    const unitById = new Map([...breakdown.nodes.values()].map((node) => [node.id, node.unit]));
    return buildDprPlan(targets, {
      calendar: dprCalendar(dprSettings),
      decimalsFor: (target) => dprUnitDecimals(unitById.get(target.boqItemId) || target.unit, dprSettings),
    });
  }, [targets, breakdown, dprSettings]);

  const headline = useMemo(
    () => buildCivilHeadline({ lines, entries, targets, jmcEntries, today, plan, subItemLinks }),
    [lines, entries, targets, jmcEntries, today, plan, subItemLinks],
  );

  const workItems = useMemo(
    () =>
      buildCivilWorkItems({ lines, entries, targets, jmcEntries, workOrders, today, plan, subItemLinks }),
    [lines, entries, targets, jmcEntries, workOrders, today, plan, subItemLinks],
  );

  const todaySnapshot = useMemo(() => buildCivilToday(entries, today), [entries, today]);

  const subcontractors = useMemo(
    () => buildCivilSubcontractors(workOrders, bills),
    [workOrders, bills],
  );

  const attention = useMemo(
    () => buildCivilAttention({ today: todaySnapshot, headline, workItems, todayDate: today }),
    [todaySnapshot, headline, workItems, today],
  );

  /** The curve's window. "All" runs from the earliest record on the project. */
  const curveRange = useMemo(() => {
    const weeks = RANGES.find((range) => range.key === rangeKey)?.weeks ?? 16;
    const thisWeek = periodRangeFor("Week", today);
    if (weeks > 0) {
      const start = new Date(`${thisWeek.startDate}T00:00:00`);
      start.setDate(start.getDate() - (weeks - 1) * 7);
      const month = String(start.getMonth() + 1).padStart(2, "0");
      const day = String(start.getDate()).padStart(2, "0");
      return { startDate: `${start.getFullYear()}-${month}-${day}`, endDate: thisWeek.endDate };
    }
    const dates = [
      ...entries.filter((entry) => entry.scope === "Civil").map((entry) => entry.date),
      ...targets.filter((target) => target.scope === "Civil").map((target) => target.startDate),
      ...certifiedEvents.map((event) => event.date),
    ]
      .filter(Boolean)
      .sort();
    return { startDate: dates[0] ?? thisWeek.startDate, endDate: thisWeek.endDate };
  }, [rangeKey, today, entries, targets, certifiedEvents]);

  const curve = useMemo(
    () =>
      buildCivilProgressCurve({
        lines,
        entries,
        targets,
        certifiedEvents,
        periodType: "Week",
        range: curveRange,
        plan,
        subItemLinks,
      }),
    [lines, entries, targets, certifiedEvents, curveRange, plan, subItemLinks],
  );

  const curveHasData = curve.some(
    (point) => point.actualValue > 0 || point.plannedValue > 0 || point.certifiedValue > 0,
  );

  const withProject = (path: string) => `${path}?project=${encodeURIComponent(mappingId)}`;

  const canSeeSubcontractors =
    canSub("Manage Subcontractors") ||
    canSub("Work Order") ||
    canSub("Billing") ||
    canSub("Reports");

  if (isAuthLoading || isResolving) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] space-y-5 p-4 sm:p-6">
        <Skeleton className="h-60 w-full rounded-3xl" />
        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-3">
          {[1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-48 rounded-2xl" />
          ))}
        </div>
      </main>
    );
  }

  if (!canView) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <PageHeader title="Civil" icon={Building2} />
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to view Civil.</CardDescription>
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
              Return to Project Management and choose a project before opening Civil.
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

  const moduleCards = [
    {
      show: canViewJmc,
      href: `${PM_JMC_BASE_PATH}?project=${encodeURIComponent(mappingId)}`,
      title: "JMC",
      description:
        "Joint measurement certificates: what was built, measured and agreed with the client.",
      icon: Ruler,
      gradient: "from-green-400 to-green-700",
      stats: [
        { label: "Entries", value: formatQty(headline.certifiedEntryCount) },
        {
          label: "Open",
          value: formatQty(headline.openMeasurementCount),
          hot: headline.openMeasurementCount > 0,
        },
        { label: "Certified", value: formatCurrency(headline.certifiedValue) },
      ],
      footer:
        headline.openMeasurementCount > 0
          ? `${headline.openMeasurementCount} measured but not yet certified`
          : "Everything measured has been certified",
    },
    {
      show: canSeeSubcontractors,
      href: subHref(""),
      title: "Subcontractors",
      description: "Work orders, billing and reports for this project's subcontractors.",
      icon: Users,
      gradient: "from-blue-400 to-blue-700",
      stats: [
        { label: "On site", value: formatQty(subcontractors.length) },
        {
          label: "Ordered",
          value: formatCurrency(subcontractors.reduce((sum, row) => sum + row.orderedValue, 0)),
        },
        {
          label: "Billed",
          value: formatCurrency(subcontractors.reduce((sum, row) => sum + row.billedValue, 0)),
        },
      ],
      footer: subcontractors.length
        ? `${subcontractors.length} subcontractor${subcontractors.length === 1 ? "" : "s"} with live work orders`
        : "No live work orders on this project",
    },
    {
      show: canViewDpr,
      href: `${DPR_BASE_PATH}?project=${encodeURIComponent(mappingId)}&scope=Civil`,
      title: "Daily Progress",
      description: "Projected against actual work, day by day, on this project's civil BOQ lines.",
      icon: Activity,
      gradient: "from-amber-400 to-orange-600",
      stats: [
        {
          label: "Today",
          value: todaySnapshot?.isToday ? "Logged" : "Not logged",
          hot: !todaySnapshot?.isToday,
        },
        { label: "Progress", value: formatPct(headline.actualPct) },
        {
          label: "Gap to plan",
          value:
            headline.gapPoints === null
              ? "—"
              : `${headline.gapPoints > 0 ? "+" : ""}${headline.gapPoints} pts`,
          hot: (headline.gapPoints ?? 0) < 0,
        },
      ],
      footer: todaySnapshot
        ? `Last entry ${formatDisplayDate(todaySnapshot.date)}`
        : "Nothing recorded yet",
    },
  ].filter((card) => card.show);

  return (
    <main className="min-h-[calc(100dvh-4rem)] space-y-5 p-4 sm:p-6">
      {/* ── Hero ─────────────────────────────────────────────────────────────────────────── */}
      <section className="relative isolate overflow-hidden rounded-3xl border border-border/50 bg-card/60 shadow-sm">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
          <span className="absolute -left-[5%] -top-32 h-64 w-[32rem] rounded-full bg-orange-200/50 blur-3xl animate-blob-drift-a motion-reduce:animate-none" />
          <span className="absolute left-[40%] -top-36 h-64 w-[35rem] rounded-full bg-stone-300/50 blur-3xl animate-blob-drift-b motion-reduce:animate-none" />
          <span className="absolute -right-[5%] -bottom-36 h-60 w-[30rem] rounded-full bg-green-200/50 blur-3xl animate-blob-drift-c motion-reduce:animate-none" />
        </div>

        <div className="grid grid-cols-1 items-center gap-5 p-5 sm:p-6 xl:grid-cols-[minmax(0,1fr)_auto]">
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
              <span className="text-foreground/70">Civil</span>
            </nav>

            <div className="mt-2.5 flex items-center gap-3.5">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-stone-400 to-stone-700 text-white shadow-md sm:h-14 sm:w-14">
                <Building2 className="h-6 w-6" />
              </span>
              <div className="min-w-0">
                <h1 className="bg-gradient-to-r from-stone-600 via-orange-600 to-green-600 bg-clip-text text-2xl font-extrabold leading-tight tracking-tight text-transparent sm:text-3xl">
                  Civil
                </h1>
                <p className="text-sm text-muted-foreground">
                  {mapping.projectName} · foundations, trenches and buildings, measured by joint
                  measurement
                </p>
              </div>
            </div>

            <div className="mt-3.5 flex flex-wrap gap-2">
              {canViewDpr ? (
                <Button asChild size="sm">
                  <Link
                    href={`${DPR_BASE_PATH}/entry?project=${encodeURIComponent(mappingId)}&scope=Civil&date=${today}`}
                  >
                    <Plus className="mr-1.5 h-4 w-4" /> Log today&apos;s progress
                  </Link>
                </Button>
              ) : null}
              {canViewJmc ? (
                <Button asChild size="sm" variant="outline">
                  <Link href={`${PM_JMC_BASE_PATH}/entry?project=${encodeURIComponent(mappingId)}`}>
                    <Ruler className="mr-1.5 h-4 w-4" /> New JMC
                  </Link>
                </Button>
              ) : null}
              {canSub("Work Order") ? (
                <Button asChild size="sm" variant="outline">
                  <Link href={subHref("work-order")}>
                    <FileText className="mr-1.5 h-4 w-4" /> Work orders
                  </Link>
                </Button>
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <div className="col-span-2 flex items-center gap-3 rounded-2xl border border-border/50 bg-card/80 p-3.5 backdrop-blur-sm lg:col-span-1">
              {isLoading ? (
                <Skeleton className="h-[68px] w-[68px] shrink-0 rounded-full" />
              ) : (
                <svg viewBox="0 0 64 64" className="h-[68px] w-[68px] shrink-0" role="img" aria-label={`Physical progress ${formatPct(headline.actualPct)}`}>
                  <circle cx="32" cy="32" r="26" fill="none" stroke="hsl(var(--muted))" strokeWidth="6" />
                  <circle
                    cx="32"
                    cy="32"
                    r="26"
                    fill="none"
                    stroke="url(#civil-ring)"
                    strokeWidth="6"
                    strokeLinecap="round"
                    strokeDasharray={`${(Math.min(Math.max(headline.actualPct ?? 0, 0), 100) / 100) * 2 * Math.PI * 26} ${2 * Math.PI * 26}`}
                    transform="rotate(-90 32 32)"
                  />
                  <defs>
                    <linearGradient id="civil-ring" x1="0" x2="1">
                      <stop offset="0" stopColor="#a8a29e" />
                      <stop offset="0.5" stopColor="#ea580c" />
                      <stop offset="1" stopColor="#16a34a" />
                    </linearGradient>
                  </defs>
                  <text x="32" y="36" textAnchor="middle" className="fill-foreground text-[14px] font-bold">
                    {formatPct(headline.actualPct)}
                  </text>
                </svg>
              )}
              <div className="min-w-0">
                <p className="text-sm font-bold leading-tight">Physical progress</p>
                <p className="text-[11.5px] leading-snug text-muted-foreground">
                  Plan for today: {formatPct(headline.plannedToDatePct)}
                </p>
                {headline.gapPoints === null ? null : (
                  <p
                    className={cn(
                      "text-[11.5px] font-bold",
                      headline.gapPoints < 0 ? "text-amber-600" : "text-emerald-600",
                    )}
                  >
                    {headline.gapPoints < 0
                      ? `${Math.abs(headline.gapPoints)} pts behind`
                      : `${headline.gapPoints} pts ahead`}
                  </p>
                )}
              </div>
            </div>

            {[
              {
                label: "Civil value",
                value: formatCurrency(headline.boqValue),
                detail: `${headline.boqLineCount} BOQ items`,
                hot: false,
              },
              {
                label: "Certified by JMC",
                value: formatCurrency(headline.certifiedValue),
                detail: `${formatPct(headline.certifiedPct)} · ${headline.certifiedEntryCount} JMCs`,
                hot: false,
              },
              {
                label: "JMC pending",
                value: formatQty(headline.openMeasurementCount),
                detail: "work done, not yet certified",
                hot: headline.openMeasurementCount > 0,
              },
            ].map((kpi) => (
              <div
                key={kpi.label}
                className="min-w-[130px] rounded-2xl border border-border/50 bg-card/80 px-3.5 py-2.5 backdrop-blur-sm"
              >
                <p className="text-[11.5px] font-bold text-muted-foreground">{kpi.label}</p>
                {isLoading ? (
                  <Skeleton className="my-1 h-6 w-20" />
                ) : (
                  <p
                    className={cn(
                      "text-xl font-extrabold leading-tight tracking-tight",
                      kpi.hot && "text-amber-600",
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
      </section>

      {loadError ? (
        <Card className="border-destructive/40">
          <CardContent className="p-4 text-sm text-destructive">{loadError}</CardContent>
        </Card>
      ) : null}

      {/* ── The three registers ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-3">
        {moduleCards.map((card) => (
          <Link
            key={card.title}
            href={card.href}
            className="group relative flex flex-col gap-3 overflow-hidden rounded-2xl border border-border/60 bg-card p-4 no-underline transition hover:-translate-y-0.5 hover:shadow-lg"
          >
            <span
              className={cn(
                "pointer-events-none absolute -right-12 -top-12 h-36 w-36 rounded-full bg-gradient-to-br opacity-10 blur-2xl",
                card.gradient,
              )}
            />
            <div className="flex items-start gap-3">
              <span
                className={cn(
                  "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm",
                  card.gradient,
                )}
              >
                <card.icon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="text-base font-bold leading-tight">{card.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {card.description}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              {card.stats.map((stat) => (
                <div key={stat.label} className="rounded-xl bg-muted/60 px-2.5 py-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                    {stat.label}
                  </p>
                  {isLoading ? (
                    <Skeleton className="mt-0.5 h-4 w-12" />
                  ) : (
                    <p
                      className={cn(
                        "truncate text-sm font-extrabold tabular-nums",
                        stat.hot && "text-amber-600",
                      )}
                      title={stat.value}
                    >
                      {stat.value}
                    </p>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-auto flex items-center justify-between gap-2 border-t border-dashed border-border pt-2.5 text-xs text-muted-foreground">
              <span className="truncate">{card.footer}</span>
              <ArrowRight className="h-4 w-4 shrink-0 transition group-hover:translate-x-0.5 group-hover:text-foreground" />
            </div>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          {/* ── Planned vs actual ────────────────────────────────────────────────────────── */}
          <Card className="border-border/60">
            <CardHeader className="flex-row flex-wrap items-center gap-3 space-y-0 border-b border-border/50 p-4">
              <div className="min-w-0 flex-1">
                <CardTitle className="text-[15px] font-bold">Planned vs actual</CardTitle>
                <CardDescription className="text-xs">
                  Cumulative civil progress by value, week by week
                </CardDescription>
              </div>
              <Tabs value={rangeKey} onValueChange={(next) => setRangeKey(next as RangeKey)}>
                <TabsList className="h-8">
                  {RANGES.map((range) => (
                    <TabsTrigger key={range.key} value={range.key} className="text-xs">
                      {range.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </CardHeader>
            <CardContent className="p-4">
              {isLoading ? (
                <Skeleton className="h-64 w-full rounded-lg" />
              ) : !curveHasData ? (
                <PmEmptyState
                  icon={Activity}
                  title="Nothing to plot yet"
                  description="Set a projection and record a day's progress, and the curve builds itself."
                />
              ) : (
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={curve} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                      <defs>
                        <linearGradient id="civilActual" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#ea580c" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#ea580c" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke={chartChrome.grid} strokeDasharray="3 3" />
                      <XAxis
                        dataKey="label"
                        stroke={chartChrome.axis}
                        tick={{ fontSize: 11 }}
                        interval="preserveStartEnd"
                        minTickGap={20}
                      />
                      <YAxis
                        stroke={chartChrome.axis}
                        tick={{ fontSize: 11 }}
                        width={44}
                        unit="%"
                      />
                      <Tooltip
                        cursor={chartChrome.cursor}
                        {...chartChrome.tooltip}
                        formatter={(value: number | string) => formatPct(Number(value))}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Line
                        type="monotone"
                        name="Planned"
                        dataKey="plannedPct"
                        stroke="#94a3b8"
                        strokeWidth={2}
                        strokeDasharray="5 5"
                        dot={false}
                      />
                      <Area
                        type="monotone"
                        name="Actual"
                        dataKey="actualPct"
                        stroke="#ea580c"
                        strokeWidth={2.5}
                        fill="url(#civilActual)"
                      />
                      <Line
                        type="monotone"
                        name="JMC certified"
                        dataKey="certifiedPct"
                        stroke="#16a34a"
                        strokeWidth={2}
                        dot={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Work items ───────────────────────────────────────────────────────────────── */}
          <Card className="border-border/60">
            <CardHeader className="flex-row flex-wrap items-center gap-3 space-y-0 border-b border-border/50 p-4">
              <div className="min-w-0 flex-1">
                <CardTitle className="text-[15px] font-bold">Work items</CardTitle>
                <CardDescription className="text-xs">
                  Progress by BOQ line; the dark tick is where the plan says it should be today
                </CardDescription>
              </div>
              {canViewBoq ? (
                <Link
                  href={`/project-management/boq/costing?project=${encodeURIComponent(mappingId)}&scope2=Civil`}
                  className="text-xs font-bold text-primary no-underline"
                >
                  Full BOQ →
                </Link>
              ) : null}
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="space-y-2 p-4">
                  {[1, 2, 3, 4].map((index) => (
                    <Skeleton key={index} className="h-11 rounded-lg" />
                  ))}
                </div>
              ) : workItems.length === 0 ? (
                <PmEmptyState
                  icon={HardHat}
                  title="No civil line is under way yet"
                  description="Lines appear here once they are projected, worked on, or certified."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[200px]">Activity</TableHead>
                      <TableHead>Subcontractor</TableHead>
                      <TableHead className="text-right">Done / Total</TableHead>
                      <TableHead className="min-w-[150px]">Progress</TableHead>
                      <TableHead className="text-right">Certified</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {workItems.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="min-w-[200px]">
                          <p className="truncate text-[13px] font-semibold" title={item.description}>
                            {item.description || "BOQ line"}
                          </p>
                          <p className="text-[11.5px] text-muted-foreground">{item.boqSlNo}</p>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {item.subcontractorName || "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right text-xs tabular-nums">
                          <b className="text-sm">{formatQty(item.doneQty)}</b>
                          <span className="text-muted-foreground">
                            {" "}
                            / {formatQty(item.boqQty)} {item.unit}
                          </span>
                        </TableCell>
                        <TableCell>
                          <ProgressWithPlan
                            progressPct={item.progressPct}
                            planPct={item.planPct}
                            gradient="from-stone-400 to-stone-600"
                          />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right text-xs tabular-nums text-muted-foreground">
                          {formatQty(item.certifiedQty)}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={item.statusLabel} tone={toneBadge[item.tone]} dot>
                            {item.statusLabel}
                          </StatusBadge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Rail ───────────────────────────────────────────────────────────────────────── */}
        <aside className="space-y-3.5 xl:sticky xl:top-20">
          <Card className="border-border/60">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-bold">
                <CloudSun className="h-4 w-4 text-sky-500" />
                Today on site
              </CardTitle>
              <CardDescription className="text-xs">
                {todaySnapshot
                  ? todaySnapshot.isToday
                    ? `Logged today, ${formatDisplayDate(todaySnapshot.date)}`
                    : `From the last log, ${formatDisplayDate(todaySnapshot.date)} — today is not in yet`
                  : "Nothing has been logged on this project yet"}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {isLoading ? (
                <Skeleton className="h-20 rounded-lg" />
              ) : !todaySnapshot ? (
                <p className="py-2 text-xs text-muted-foreground">
                  Record a day in Daily Progress and it appears here.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "Manpower", value: formatQty(todaySnapshot.manpower) },
                    { label: "Machinery", value: formatQty(todaySnapshot.equipmentCount) },
                    {
                      label: todaySnapshot.headlineDescription || "Biggest line",
                      value: todaySnapshot.headlineQty
                        ? `${formatQty(todaySnapshot.headlineQty)} ${todaySnapshot.headlineUnit}`
                        : "—",
                    },
                    { label: "Weather", value: todaySnapshot.weather || "—" },
                  ].map((cell) => (
                    <div key={cell.label} className="rounded-xl bg-muted/60 px-2.5 py-2">
                      <p
                        className="truncate text-[11px] font-bold text-muted-foreground"
                        title={cell.label}
                      >
                        {cell.label}
                      </p>
                      <p className="truncate text-sm font-extrabold" title={cell.value}>
                        {cell.value}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardHeader className="flex-row items-center justify-between space-y-0 p-4 pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-bold">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Needs attention
              </CardTitle>
              {!isLoading && attention.length > 0 ? (
                <StatusBadge status="count" tone="danger" className="px-2">
                  {attention.length}
                </StatusBadge>
              ) : null}
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {isLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((index) => (
                    <Skeleton key={index} className="h-10 rounded-lg" />
                  ))}
                </div>
              ) : attention.length === 0 ? (
                <p className="py-2 text-xs text-muted-foreground">
                  Nothing is flagged on civil right now.
                </p>
              ) : (
                <ul className="divide-y divide-dashed divide-border">
                  {attention.map((item) => (
                    <li key={item.id} className="flex items-start gap-2.5 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-[12.5px] font-semibold leading-snug">{item.title}</p>
                        <p className="truncate text-[11.5px] text-muted-foreground" title={item.detail}>
                          {item.detail}
                        </p>
                      </div>
                      <StatusBadge
                        status={item.tone}
                        tone={item.tone === "bad" ? "danger" : "warning"}
                        className="shrink-0"
                      >
                        {item.badge}
                      </StatusBadge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {canSeeSubcontractors ? (
            <Card className="border-border/60">
              <CardHeader className="flex-row items-center justify-between space-y-0 p-4 pb-2">
                <div className="min-w-0">
                  <CardTitle className="flex items-center gap-2 text-sm font-bold">
                    <Truck className="h-4 w-4 text-blue-500" />
                    Subcontractors
                  </CardTitle>
                  <CardDescription className="text-xs">Ordered · billed</CardDescription>
                </div>
                <Link href={subHref("")} className="text-xs font-bold text-primary no-underline">
                  All →
                </Link>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                {isLoading ? (
                  <div className="space-y-2">
                    {[1, 2].map((index) => (
                      <Skeleton key={index} className="h-10 rounded-lg" />
                    ))}
                  </div>
                ) : subcontractors.length === 0 ? (
                  <p className="py-2 text-xs text-muted-foreground">
                    No live work orders on this project.
                  </p>
                ) : (
                  <ul className="space-y-2.5">
                    {subcontractors.slice(0, 5).map((row) => (
                      <li key={row.name}>
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="truncate text-[12.5px] font-bold" title={row.name}>
                            {row.name}
                          </p>
                          <span className="shrink-0 text-[12.5px] font-extrabold tabular-nums">
                            {formatCurrency(row.orderedValue)}
                          </span>
                        </div>
                        <p className="truncate text-[11.5px] text-muted-foreground">
                          {row.workOrderCount} work order{row.workOrderCount === 1 ? "" : "s"} ·{" "}
                          {formatCurrency(row.billedValue)} billed
                        </p>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-blue-300 to-blue-600"
                            style={{
                              width: `${Math.min(Math.max(row.billedPct ?? 0, 0), 100)}%`,
                            }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ) : null}
        </aside>
      </div>
    </main>
  );
}

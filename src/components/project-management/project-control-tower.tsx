"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  CalendarClock,
  ClipboardCheck,
  FileStack,
  HardHat,
  Hourglass,
  IndianRupee,
  PackageCheck,
  RefreshCw,
  Route,
  Scale,
} from "lucide-react";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  calculateProjectControlTower,
  type ProjectAttentionTarget,
  type ProjectControlTowerSummary,
} from "@/lib/project-management-dashboard";
import {
  JMC_ENTRY_COLLECTION,
  MVAC_ENTRY_COLLECTION,
  SUBCONTRACTOR_BILL_COLLECTION,
  WORK_ORDER_COLLECTION,
} from "@/lib/civil-execution";
import { MDL_COLLECTION } from "@/lib/mdl";
import { PO_COLLECTION } from "@/lib/purchase-orders";
import { RFQ_COLLECTION } from "@/lib/rfq";
import {
  DI_COLLECTION,
  GRN_COLLECTION,
  INSPECTION_COLLECTION,
  MC_COLLECTION,
  MDCC_COLLECTION,
  MVAC_COLLECTION,
} from "@/lib/supply-gates";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type ProjectControlTowerProps = {
  mapping: {
    id: string;
    projectName: string;
    globalProjectId: string;
    endDate?: string;
  };
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
    notation: value >= 10_000_000 ? "compact" : "standard",
  }).format(value);

const targetPath: Record<ProjectAttentionTarget, string> = {
  boq: "boq/costing",
  "requirement-planner": "requirement-planner",
  mdl: "mdl",
  "purchase-orders": "purchase-orders",
  inspections: "inspections",
  mdcc: "mdcc",
  "dispatch-instructions": "dispatch-instructions",
  grn: "grn",
  mvac: "mvac",
  projects: "projects",
  civil: "civil",
  jmc: "jmc/log",
};

const attentionStyles = {
  critical: "border-red-200 bg-red-50 text-red-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  info: "border-blue-200 bg-blue-50 text-blue-900",
};

const metricCard =
  "overflow-hidden border-border/60 bg-card shadow-sm transition-shadow hover:shadow-md";

export default function ProjectControlTower({ mapping }: ProjectControlTowerProps) {
  const [summary, setSummary] = useState<ProjectControlTowerSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const loadSummary = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const projectPath = ["projects", mapping.globalProjectId] as const;
      const mappingEndDate = mapping.endDate;
      const [
        boqSnapshot,
        indentSnapshot,
        rfqSnapshot,
        poSnapshot,
        mdlSnapshot,
        mcSnapshot,
        inspectionSnapshot,
        mdccSnapshot,
        diSnapshot,
        grnSnapshot,
        mvacSnapshot,
        workOrderSnapshot,
        jmcEntrySnapshot,
        mvacEntrySnapshot,
        subBillSnapshot,
        settingsSnapshot,
      ] = await Promise.all([
        getDocs(collection(db, ...projectPath, "boqItems")),
        getDocs(collection(db, ...projectPath, "indents")),
        getDocs(collection(db, ...projectPath, RFQ_COLLECTION)),
        getDocs(collection(db, ...projectPath, PO_COLLECTION)),
        getDocs(collection(db, ...projectPath, MDL_COLLECTION)),
        getDocs(collection(db, ...projectPath, MC_COLLECTION)),
        getDocs(collection(db, ...projectPath, INSPECTION_COLLECTION)),
        getDocs(collection(db, ...projectPath, MDCC_COLLECTION)),
        getDocs(collection(db, ...projectPath, DI_COLLECTION)),
        getDocs(collection(db, ...projectPath, GRN_COLLECTION)),
        getDocs(collection(db, ...projectPath, MVAC_COLLECTION)),
        // Civil registers owned by Billing Recon / Subcontractors Management — read-only join.
        getDocs(collection(db, ...projectPath, WORK_ORDER_COLLECTION)),
        getDocs(collection(db, ...projectPath, JMC_ENTRY_COLLECTION)),
        getDocs(collection(db, ...projectPath, MVAC_ENTRY_COLLECTION)),
        getDocs(collection(db, ...projectPath, SUBCONTRACTOR_BILL_COLLECTION)),
        getDoc(doc(db, "projectManagementSettings", "general")),
      ]);

      const records = (snapshot: typeof boqSnapshot) =>
        snapshot.docs.map((record) => ({ id: record.id, ...record.data() }));

      setSummary(
        calculateProjectControlTower({
          boqItems: records(boqSnapshot),
          indents: records(indentSnapshot),
          rfqs: records(rfqSnapshot),
          purchaseOrders: records(poSnapshot),
          mdlDrawings: records(mdlSnapshot),
          manufacturingClearances: records(mcSnapshot),
          inspections: records(inspectionSnapshot),
          mdccRecords: records(mdccSnapshot),
          dispatchInstructions: records(diSnapshot),
          grns: records(grnSnapshot),
          mvacRecords: records(mvacSnapshot),
          workOrders: records(workOrderSnapshot),
          jmcEntries: records(jmcEntrySnapshot),
          mvacEntries: records(mvacEntrySnapshot),
          subcontractorBills: records(subBillSnapshot),
          leadTimeDays:
            typeof settingsSnapshot.data()?.leadTimeDays === "number"
              ? settingsSnapshot.data()?.leadTimeDays
              : undefined,
          tolerancePct:
            typeof settingsSnapshot.data()?.variationTolerancePct === "number"
              ? settingsSnapshot.data()?.variationTolerancePct
              : undefined,
          stallDays:
            typeof settingsSnapshot.data()?.stallDays === "number"
              ? settingsSnapshot.data()?.stallDays
              : undefined,
          projectEndDate: mappingEndDate,
        }),
      );
    } catch (loadError) {
      console.error("Failed to load the Project Management control tower:", loadError);
      setError("The live project summary could not be loaded. Your underlying registers are unchanged.");
      setSummary(null);
    } finally {
      setIsLoading(false);
    }
  }, [mapping.globalProjectId, mapping.endDate]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  if (isLoading) {
    return (
      <section aria-label="Loading project control tower" className="space-y-3">
        <Skeleton className="h-7 w-56" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((item) => (
            <Skeleton key={item} className="h-28 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-36 rounded-xl" />
      </section>
    );
  }

  if (error || !summary) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Project summary unavailable</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span>{error || "No summary is available."}</span>
          <Button size="sm" variant="outline" onClick={() => void loadSummary()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const engineeringProgress = summary.engineering.drawingCount
    ? Math.round((summary.engineering.approvedDrawingCount / summary.engineering.drawingCount) * 100)
    : 0;

  return (
    <section className="space-y-4" aria-labelledby="control-tower-title">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="control-tower-title" className="text-lg font-semibold">Project control tower</h2>
          <p className="text-sm text-muted-foreground">
            Live commercial, engineering, procurement, and site-control indicators for {mapping.projectName}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {summary.schedule.daysRemaining != null && (
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
                summary.schedule.daysRemaining < 0
                  ? "border-red-200 bg-red-50 text-red-700"
                  : "border-border bg-muted/40 text-muted-foreground",
              )}
            >
              <CalendarClock className="h-3.5 w-3.5" />
              {summary.schedule.daysRemaining < 0
                ? `${-summary.schedule.daysRemaining} day${summary.schedule.daysRemaining === -1 ? "" : "s"} past planned completion`
                : `${summary.schedule.daysRemaining} day${summary.schedule.daysRemaining === 1 ? "" : "s"} to planned completion`}
            </span>
          )}
          <Button size="sm" variant="outline" onClick={() => void loadSummary()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className={metricCard}>
          <CardContent className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">BOQ baseline</span>
              <ClipboardCheck className="h-4 w-4 text-emerald-600" />
            </div>
            <p className="text-2xl font-bold">{formatCurrency(summary.boq.budgetValue)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {summary.boq.itemCount} line{summary.boq.itemCount === 1 ? "" : "s"} · {summary.boq.surveyCoveragePct}% surveyed
            </p>
          </CardContent>
        </Card>

        <Card className={cn(metricCard, summary.cost.overBudget && "border-red-300")}>
          <CardContent className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">Committed vs budget</span>
              <IndianRupee className={cn("h-4 w-4", summary.cost.overBudget ? "text-red-600" : "text-blue-600")} />
            </div>
            <div className="flex items-end justify-between gap-3">
              <p className={cn("text-2xl font-bold", summary.cost.overBudget && "text-red-600")}>
                {formatCurrency(summary.cost.committedValue)}
              </p>
              {summary.cost.budgetValue > 0 && (
                <span className={cn("text-xs font-medium", summary.cost.overBudget ? "text-red-600" : "text-muted-foreground")}>
                  {summary.cost.committedPct}%
                </span>
              )}
            </div>
            {summary.cost.budgetValue > 0 && (
              <Progress
                value={Math.min(summary.cost.committedPct, 100)}
                className={cn("mt-2 h-2", summary.cost.overBudget && "[&>*]:bg-red-500")}
              />
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              {summary.cost.overBudget
                ? `${formatCurrency(summary.cost.varianceValue)} over the BOQ baseline`
                : summary.cost.workOrderCommittedValue > 0
                  ? `POs ${formatCurrency(summary.cost.poCommittedValue)} · WOs ${formatCurrency(summary.cost.workOrderCommittedValue)}`
                  : `${summary.procurement.livePoCount} live PO${summary.procurement.livePoCount === 1 ? "" : "s"} · ${summary.procurement.overduePoCount} overdue`}
            </p>
          </CardContent>
        </Card>

        <Card className={metricCard}>
          <CardContent className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">Engineering approval</span>
              <FileStack className="h-4 w-4 text-violet-600" />
            </div>
            <div className="flex items-end justify-between gap-3">
              <p className="text-2xl font-bold">{engineeringProgress}%</p>
              <span className="text-xs text-muted-foreground">
                {summary.engineering.approvedDrawingCount}/{summary.engineering.drawingCount}
              </span>
            </div>
            <Progress value={engineeringProgress} className="mt-2 h-2" />
          </CardContent>
        </Card>

        <Card className={metricCard}>
          <CardContent className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">Open procurement</span>
              <Route className="h-4 w-4 text-orange-600" />
            </div>
            <p className="text-2xl font-bold">
              {summary.procurement.openIndentCount + summary.procurement.openRfqCount}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {summary.procurement.openIndentCount} indents · {summary.procurement.openRfqCount} RFQs
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <PackageCheck className="h-4 w-4" />
            Supply pipeline
          </CardTitle>
          <CardDescription>Unique BOQ lines that have cleared each physical supply gate.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            {summary.supplyPipeline.map((stage, index) => (
              <div key={stage.key} className="relative rounded-lg border bg-muted/20 px-3 py-3">
                <p className="text-xl font-bold">{stage.count}</p>
                <p className="text-xs text-muted-foreground">{stage.label}</p>
                {index < summary.supplyPipeline.length - 1 && (
                  <ArrowRight className="absolute -right-3 top-1/2 z-10 hidden h-4 w-4 -translate-y-1/2 text-muted-foreground lg:block" />
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {(summary.civil.workOrderCount > 0 ||
        summary.civil.measurementEntryCount > 0 ||
        summary.civil.subcontractorBilledValue > 0) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <HardHat className="h-4 w-4" />
              Civil execution
            </CardTitle>
            <CardDescription>
              Subcontract commitment, joint measurement, and subcontractor billing — joined from the
              Billing Recon and Subcontractors registers.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              <div className="rounded-lg border bg-muted/20 px-3 py-3">
                <p className="text-xl font-bold">{summary.civil.workOrderCount}</p>
                <p className="text-xs text-muted-foreground">
                  Work order{summary.civil.workOrderCount === 1 ? "" : "s"} ·{" "}
                  {formatCurrency(summary.civil.workOrderValue)}
                </p>
              </div>
              <div className="rounded-lg border bg-muted/20 px-3 py-3">
                <p className="text-xl font-bold">{formatCurrency(summary.civil.executedValue)}</p>
                <p className="text-xs text-muted-foreground">Executed (JMC/MVAC)</p>
              </div>
              <div className="rounded-lg border bg-muted/20 px-3 py-3">
                <p className="text-xl font-bold">{formatCurrency(summary.civil.certifiedValue)}</p>
                <p className="text-xs text-muted-foreground">Certified</p>
              </div>
              <div
                className={cn(
                  "rounded-lg border px-3 py-3",
                  summary.civil.openMeasurementCount ? "border-amber-200 bg-amber-50" : "bg-muted/20",
                )}
              >
                <p
                  className={cn(
                    "text-xl font-bold",
                    summary.civil.openMeasurementCount && "text-amber-700",
                  )}
                >
                  {summary.civil.openMeasurementCount}
                </p>
                <p className="text-xs text-muted-foreground">
                  Of {summary.civil.measurementEntryCount} measurement
                  {summary.civil.measurementEntryCount === 1 ? "" : "s"} in workflow
                </p>
              </div>
              <div className="rounded-lg border bg-muted/20 px-3 py-3">
                <p className="text-xl font-bold">
                  {formatCurrency(summary.civil.subcontractorBilledValue)}
                </p>
                <p className="text-xs text-muted-foreground">Subcontractor billed</p>
              </div>
            </div>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="outline" asChild>
                <Link href={`/project-management/civil?project=${encodeURIComponent(mapping.id)}`}>
                  Civil workspace
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link href={`/project-management/erection?project=${encodeURIComponent(mapping.id)}`}>
                  Erection workspace
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Hourglass className="h-4 w-4" />
              Stalled gates
            </CardTitle>
            <CardDescription>
              Waiting-state records older than the stall threshold, and who they are sitting with.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {summary.stalledGates.length ? (
              <div className="space-y-2">
                {summary.stalledGates.map((gate) => (
                  <Link
                    key={gate.key}
                    href={`/project-management/${targetPath[gate.target]}?project=${encodeURIComponent(mapping.id)}`}
                    className="group flex items-center gap-3 rounded-lg border p-3 no-underline transition-shadow hover:shadow-sm"
                  >
                    <span className="flex h-7 min-w-7 items-center justify-center rounded-full bg-amber-100 text-sm font-bold text-amber-700">
                      {gate.count}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{gate.label}</span>
                      <span className="block text-xs text-muted-foreground">
                        Waiting on {gate.waitingOn} · oldest {gate.oldestDays} days
                      </span>
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </Link>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                Nothing has been waiting past the stall threshold.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Scale className="h-4 w-4" />
              Quantity integrity
            </CardTitle>
            <CardDescription>
              Every BOQ line&apos;s stage quantities reconciled against each other and against approved scope.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg border bg-muted/20 px-3 py-3">
                <p className="text-xl font-bold">{summary.quantityIntegrity.checkedCount}</p>
                <p className="text-xs text-muted-foreground">Lines checked</p>
              </div>
              <div className={cn("rounded-lg border px-3 py-3", summary.quantityIntegrity.criticalCount ? "border-red-200 bg-red-50" : "bg-muted/20")}>
                <p className={cn("text-xl font-bold", summary.quantityIntegrity.criticalCount && "text-red-700")}>
                  {summary.quantityIntegrity.criticalCount}
                </p>
                <p className="text-xs text-muted-foreground">Registers disagree</p>
              </div>
              <div className={cn("rounded-lg border px-3 py-3", summary.quantityIntegrity.warningCount ? "border-amber-200 bg-amber-50" : "bg-muted/20")}>
                <p className={cn("text-xl font-bold", summary.quantityIntegrity.warningCount && "text-amber-700")}>
                  {summary.quantityIntegrity.warningCount}
                </p>
                <p className="text-xs text-muted-foreground">Over scope</p>
              </div>
            </div>
            {summary.quantityIntegrity.criticalCount + summary.quantityIntegrity.warningCount > 0 ? (
              <Button size="sm" variant="outline" asChild>
                <Link href={`/project-management/boq/costing?project=${encodeURIComponent(mapping.id)}`}>
                  Review in BOQ costing
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">
                All recorded quantities reconcile cleanly.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Management attention</CardTitle>
              <CardDescription>Exceptions that can delay delivery, dispatch, acceptance, or billing.</CardDescription>
            </div>
            <Badge variant={summary.attention.length ? "destructive" : "secondary"}>
              {summary.attention.length} control{summary.attention.length === 1 ? "" : "s"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {summary.attention.length ? (
            <div className="grid gap-2 lg:grid-cols-2">
              {summary.attention.slice(0, 8).map((item) => (
                <Link
                  key={item.id}
                  href={`/project-management/${targetPath[item.target]}?project=${encodeURIComponent(mapping.id)}`}
                  className={cn(
                    "group flex items-start gap-3 rounded-lg border p-3 no-underline transition-shadow hover:shadow-sm",
                    attentionStyles[item.severity],
                  )}
                >
                  <span className="flex h-7 min-w-7 items-center justify-center rounded-full bg-white/70 text-sm font-bold">
                    {item.count}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{item.title}</span>
                    <span className="block text-xs opacity-80">{item.detail}</span>
                  </span>
                  <ArrowRight className="mt-1 h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
                </Link>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
              No automatically detected control exceptions. Continue routine project reviews and field verification.
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

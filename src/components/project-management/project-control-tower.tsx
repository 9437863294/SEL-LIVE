"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  ClipboardCheck,
  FileStack,
  IndianRupee,
  PackageCheck,
  RefreshCw,
  Route,
} from "lucide-react";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  calculateProjectControlTower,
  type ProjectAttentionTarget,
  type ProjectControlTowerSummary,
} from "@/lib/project-management-dashboard";
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
          leadTimeDays:
            typeof settingsSnapshot.data()?.leadTimeDays === "number"
              ? settingsSnapshot.data()?.leadTimeDays
              : undefined,
        }),
      );
    } catch (loadError) {
      console.error("Failed to load the Project Management control tower:", loadError);
      setError("The live project summary could not be loaded. Your underlying registers are unchanged.");
      setSummary(null);
    } finally {
      setIsLoading(false);
    }
  }, [mapping.globalProjectId]);

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
        <Button size="sm" variant="outline" onClick={() => void loadSummary()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
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

        <Card className={metricCard}>
          <CardContent className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">Committed value</span>
              <IndianRupee className="h-4 w-4 text-blue-600" />
            </div>
            <p className="text-2xl font-bold">{formatCurrency(summary.procurement.committedValue)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {summary.procurement.livePoCount} live PO{summary.procurement.livePoCount === 1 ? "" : "s"} · {summary.procurement.overduePoCount} overdue
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

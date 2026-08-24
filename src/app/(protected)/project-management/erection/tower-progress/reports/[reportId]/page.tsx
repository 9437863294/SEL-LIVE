"use client";

/**
 * The report engine.
 *
 * One route serves all twenty-two reports. The registry in project-management-tower-reports.ts says
 * what a report is and which renderer it uses; this page supplies the filter bar, the export and the
 * print link. That is why `/reports/tower-status`, `/reports/foundation` and `/reports/missing-evidence`
 * all read as their own URLs while sharing one implementation — adding a report is a registry entry
 * and a builder, not another page to keep in step with the other twenty-one.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { BarChart3, Download, FileSpreadsheet, Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { exportWorkbook } from "@/lib/report-excel";
import { towerProgressHref } from "@/lib/project-management-tower-progress";
import { filterTowers, towerReportById } from "@/lib/project-management-tower-reports";
import { useTowerProgress } from "@/components/project-management/tower-progress/tower-progress-provider";
import {
  ReportFilterBar,
  useReportFilters,
} from "@/components/project-management/tower-progress/report-filter-bar";
import {
  TowerReportBody,
  reportExcelSheets,
  type ReportContext,
} from "@/components/project-management/tower-progress/report-views";
import {
  TowerProgressGuard,
  TowerProgressHeader,
  TowerProgressNav,
  TowerProgressShell,
} from "@/components/project-management/tower-progress/tower-progress-ui";

export default function TowerReportPage() {
  const { permissions } = useTowerProgress();
  return (
    <TowerProgressGuard requires={permissions.viewReports} requiresLabel="Tower Progress reports">
      <ReportScreen />
    </TowerProgressGuard>
  );
}

function ReportScreen() {
  const params = useParams();
  const reportId = String(params?.reportId ?? "");
  const definition = towerReportById(reportId);
  const { mappingId, project, towers, updates, settings, permissions } = useTowerProgress();
  const filterState = useReportFilters();
  const { toast } = useToast();
  const [isExporting, setIsExporting] = useState(false);

  const filtered = useMemo(
    () =>
      definition
        ? filterTowers(towers, filterState.filters, definition.activity)
        : [],
    [towers, filterState.filters, definition],
  );

  const ctx: ReportContext | null = useMemo(
    () =>
      definition
        ? {
            definition,
            include: filterState.include,
            towers: filtered,
            allTowers: towers,
            updates,
            settings,
            filters: filterState.filters,
            dateKey: filterState.dateKey,
            weekStart: filterState.weekStart,
            monthKey: filterState.monthKey,
            mappingId,
            projectName: project?.projectName ?? "",
          }
        : null,
    [
      definition,
      filtered,
      towers,
      updates,
      settings,
      filterState.filters,
      filterState.include,
      filterState.dateKey,
      filterState.weekStart,
      filterState.monthKey,
      mappingId,
      project?.projectName,
    ],
  );

  if (!definition) {
    return (
      <TowerProgressShell>
        <Card>
          <CardHeader>
            <CardTitle>Report not found</CardTitle>
            <CardDescription>
              &ldquo;{reportId}&rdquo; is not one of this module&apos;s reports.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href={towerProgressHref(mappingId, "reports")}>Back to reports</Link>
            </Button>
          </CardContent>
        </Card>
      </TowerProgressShell>
    );
  }

  const handleExport = async () => {
    if (!ctx) return;
    setIsExporting(true);
    try {
      const sheets = reportExcelSheets(ctx);
      if (!sheets.some((sheet) => sheet.rows.length)) {
        toast({ title: "Nothing to export", description: "This report has no rows in scope." });
        return;
      }
      await exportWorkbook(
        `${definition.id}-${project?.projectName ?? "project"}.xlsx`
          .replace(/[^a-z0-9.-]+/gi, "-")
          .toLowerCase(),
        sheets,
      );
    } catch (error) {
      console.error("Failed to export the report:", error);
      toast({ title: "Could not build the workbook", variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  };

  const printHref = `${towerProgressHref(mappingId, `reports/${definition.id}/print`)}${
    filterState.queryString ? `&${filterState.queryString}` : ""
  }`;

  return (
    <TowerProgressShell>
      <TowerProgressHeader
        title={definition.title}
        subtitle={
          project
            ? `${filtered.length} of ${towers.length} towers · ${project.projectName}`
            : definition.description
        }
        icon={BarChart3}
        backHref={towerProgressHref(mappingId, "reports")}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href={printHref} target="_blank">
                <Printer className="mr-2 h-4 w-4" />
                Print / PDF
              </Link>
            </Button>
            {permissions.export ? (
              <Button variant="outline" onClick={() => void handleExport()} disabled={isExporting}>
                {isExporting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileSpreadsheet className="mr-2 h-4 w-4" />
                )}
                Excel
              </Button>
            ) : null}
          </>
        }
      />

      <TowerProgressNav />

      <p className="text-sm text-muted-foreground">{definition.description}</p>

      <ReportFilterBar definition={definition} towers={towers} state={filterState} />

      <Card>
        <CardContent className={definition.kind === "rows" || definition.kind === "matrix" || definition.kind === "photo-rows" ? "p-0" : "p-4 sm:p-6"}>
          {ctx ? <TowerReportBody ctx={ctx} /> : null}
        </CardContent>
      </Card>

      {definition.clientFacing && settings.clientReportsRequireApprovedPhotos ? (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Download className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          This project holds unverified photographs back from client-facing reports, so a tower whose
          evidence is still in the verification queue shows no photograph here. Print or export
          reproduces exactly what is on screen.
        </p>
      ) : null}
    </TowerProgressShell>
  );
}

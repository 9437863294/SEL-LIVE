"use client";

/**
 * The reports hub (§21).
 *
 * Grouped rather than one flat list of twenty-two links: Executive reports answer "where are we",
 * Activity reports answer "how is one trade doing", Photo reports are what goes to a client, and
 * Exception reports are what somebody has to act on today. A flat grid gives no clue which is which.
 */

import { useState } from "react";
import Link from "next/link";
import { BarChart3, FileOutput } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { towerProgressHref } from "@/lib/project-management-tower-progress";
import {
  TOWER_REPORTS,
  TOWER_REPORT_GROUPS,
  buildDelayedReport,
  buildMissingEvidenceReport,
  buildPendingReport,
  type TowerReportGroup,
} from "@/lib/project-management-tower-reports";
import { useTowerProgress } from "@/components/project-management/tower-progress/tower-progress-provider";
import { GenerateReportDialog } from "@/components/project-management/tower-progress/generate-report-dialog";
import {
  TowerProgressGuard,
  TowerProgressHeader,
  TowerProgressNav,
  TowerProgressShell,
} from "@/components/project-management/tower-progress/tower-progress-ui";

const groupBlurb: Record<TowerReportGroup, string> = {
  Executive: "Where the line stands, for management and the client.",
  Activity: "One trade at a time — dates, contractor and evidence per tower.",
  Photo: "Photographic reports, watermarked and ready to hand over.",
  Exception: "What is stuck, late, or claimed without proof.",
};

export default function ReportsHubPage() {
  const { permissions } = useTowerProgress();
  return (
    <TowerProgressGuard requires={permissions.viewReports} requiresLabel="Tower Progress reports">
      <ReportsHub />
    </TowerProgressGuard>
  );
}

function ReportsHub() {
  const { mappingId, project, towers, settings } = useTowerProgress();
  const [isGenerateOpen, setIsGenerateOpen] = useState(false);

  /** Live counts on the exception cards, so the hub says where the work is rather than just listing
   *  report names. A zero is worth showing too — it is the answer. */
  const exceptionCounts: Record<string, number> = {
    pending: buildPendingReport(towers, "All").length,
    delayed: buildDelayedReport(towers, settings).length,
    "missing-evidence": buildMissingEvidenceReport(towers, settings).length,
    "row-blocked": buildPendingReport(towers, "row").filter(
      (row) => row.status === "Blocked" || row.status === "Hold",
    ).length,
    "foundation-pending": buildPendingReport(towers, "foundation").length,
    "structure-pending": buildPendingReport(towers, "structure").length,
    "erection-pending": buildPendingReport(towers, "erection").length,
    "stringing-pending": buildPendingReport(towers, "stringing").length,
  };

  return (
    <TowerProgressShell>
      <TowerProgressHeader
        title="Project reports"
        subtitle={
          project
            ? `Live projections of ${towers.length} towers on ${project.projectName} — nothing here is prepared by hand.`
            : "Live projections of the tower register."
        }
        icon={BarChart3}
        backHref={towerProgressHref(mappingId)}
        actions={
          <Button onClick={() => setIsGenerateOpen(true)}>
            <FileOutput className="mr-2 h-4 w-4" />
            Generate report
          </Button>
        }
      />

      <TowerProgressNav />

      {TOWER_REPORT_GROUPS.map((group) => {
        const reports = TOWER_REPORTS.filter((report) => report.group === group);
        if (!reports.length) return null;
        return (
          <section key={group} className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold">{group} reports</h2>
              <p className="text-sm text-muted-foreground">{groupBlurb[group]}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {reports.map((report) => {
                const count = exceptionCounts[report.id];
                return (
                  <Link
                    key={report.id}
                    href={towerProgressHref(mappingId, `reports/${report.id}`)}
                    className="group"
                  >
                    <Card className="h-full transition hover:border-primary/50 hover:shadow-sm">
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between gap-2">
                          <CardTitle className="text-sm group-hover:underline">
                            {report.title}
                          </CardTitle>
                          {count !== undefined ? (
                            <Badge
                              className={cn(
                                "shrink-0 text-[10px]",
                                count === 0
                                  ? "bg-emerald-100 text-emerald-700"
                                  : "bg-red-100 text-red-700",
                              )}
                            >
                              {count}
                            </Badge>
                          ) : report.clientFacing ? (
                            <Badge variant="outline" className="shrink-0 text-[10px]">
                              client
                            </Badge>
                          ) : null}
                        </div>
                      </CardHeader>
                      <CardContent>
                        <CardDescription className="text-xs">{report.description}</CardDescription>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}

      <p className="text-xs text-muted-foreground">
        Every report can be filtered by section, tower type, contractor, status and tower range, then
        printed to PDF or exported as a real Excel workbook. Photographs carry the project watermark,
        and {settings.clientReportsRequireApprovedPhotos ? "only verified" : "all recorded"}{" "}
        photographs appear in client-facing reports.
      </p>

      <GenerateReportDialog open={isGenerateOpen} onOpenChange={setIsGenerateOpen} />
    </TowerProgressShell>
  );
}

"use client";

/**
 * The printable version of any report.
 *
 * A `/print` route renders without the application shell (see AppShell), so this is a real document
 * rather than a screenshot of the app with the sidebar cropped off. It reads the same filter
 * parameters the on-screen report was using, so "Print / PDF" reproduces exactly the rows that were
 * visible — and unlike the screen it is uncapped, because a client photo report is meant to be long.
 */

import { useEffect, useMemo, useRef } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTowerDate, toDateKey } from "@/lib/project-management-tower-progress";
import { filterTowers, towerReportById } from "@/lib/project-management-tower-reports";
import { useTowerProgress } from "@/components/project-management/tower-progress/tower-progress-provider";
import { readReportFilters } from "@/components/project-management/tower-progress/report-filter-bar";
import {
  TowerReportBody,
  reportPrefersLandscape,
  type ReportContext,
} from "@/components/project-management/tower-progress/report-views";

export default function PrintReportPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const reportId = String(params?.reportId ?? "");
  const definition = towerReportById(reportId);
  const { project, towers, updates, settings, isLoading, mappingId, permissions } =
    useTowerProgress();
  const hasPrinted = useRef(false);

  const filterState = useMemo(() => readReportFilters(searchParams), [searchParams]);

  const filtered = useMemo(
    () => (definition ? filterTowers(towers, filterState.filters, definition.activity) : []),
    [towers, filterState.filters, definition],
  );

  const landscape = definition ? reportPrefersLandscape(definition) : false;

  /**
   * The print dialog is opened once, after the data has landed. Photographs are the reason for the
   * delay: `window.print()` fired the instant React commits would capture half-loaded images, and
   * a client report with grey boxes where the evidence should be is worse than no report.
   */
  useEffect(() => {
    if (isLoading || !definition || hasPrinted.current || !permissions.viewReports) return;
    hasPrinted.current = true;
    const timer = setTimeout(() => {
      if (typeof window !== "undefined") window.print();
    }, 1500);
    return () => clearTimeout(timer);
  }, [isLoading, definition, permissions.viewReports]);

  if (!definition) {
    return <div className="p-8 text-sm">This report does not exist.</div>;
  }

  if (!permissions.viewReports) {
    return <div className="p-8 text-sm">You do not have permission to view this report.</div>;
  }

  if (isLoading) {
    return (
      <div className="p-8">
        <Skeleton className="h-[80vh]" />
      </div>
    );
  }

  const ctx: ReportContext = {
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
    print: true,
  };

  const activeFilters = [
    filterState.filters.section !== "All" ? `Section: ${filterState.filters.section}` : "",
    filterState.filters.towerType !== "All" ? `Type: ${filterState.filters.towerType}` : "",
    filterState.filters.contractor !== "All" ? `Contractor: ${filterState.filters.contractor}` : "",
    filterState.filters.status !== "All" ? `Status: ${filterState.filters.status}` : "",
    filterState.filters.fromTowerNo || filterState.filters.toTowerNo
      ? `Towers: ${filterState.filters.fromTowerNo || "start"} – ${filterState.filters.toTowerNo || "end"}`
      : "",
    filterState.filters.search ? `Search: ${filterState.filters.search}` : "",
  ].filter(Boolean);

  return (
    <>
      <PrintStyles landscape={landscape} />
      <div className="bg-white">
        <div className="flex justify-end gap-2 p-3 print:hidden">
          <Button size="sm" onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
        </div>

        <div id="printable-sheet" className="mx-auto max-w-[1400px] px-6 pb-10 print:px-0">
          <header className="mb-4 border-b-2 border-black pb-3">
            <p className="text-[10pt] font-bold uppercase tracking-wide">
              {settings.watermarkOrganisation}
            </p>
            <h1 className="mt-1 text-xl font-extrabold uppercase">{definition.title}</h1>
            <div className="mt-1 flex flex-wrap gap-x-6 gap-y-0.5 text-[9pt]">
              <span>
                <strong>Project:</strong> {project?.projectName || "—"}
              </span>
              <span>
                <strong>Towers in scope:</strong> {filtered.length} of {towers.length}
              </span>
              <span>
                <strong>Generated:</strong> {formatTowerDate(toDateKey(new Date()))}
              </span>
            </div>
            {activeFilters.length ? (
              <p className="mt-1 text-[8pt] text-neutral-600">
                <strong>Filters:</strong> {activeFilters.join(" · ")}
              </p>
            ) : null}
          </header>

          <TowerReportBody ctx={ctx} />

          <footer className="mt-8 flex justify-between border-t pt-3 text-[8pt] text-neutral-600 print:fixed print:bottom-4 print:left-0 print:right-0 print:px-[12mm]">
            <span>
              {settings.watermarkOrganisation} · {definition.title} · {project?.projectName}
            </span>
            <span>
              Generated from recorded site data — no figure on this sheet was entered by hand.
            </span>
          </footer>
        </div>
      </div>
    </>
  );
}

/**
 * Print rules for the document.
 *
 * `print-color-adjust: exact` is what keeps the status colours and the photograph captions from
 * printing as empty boxes, and the table rules are re-declared because the on-screen table borders
 * come from a colour-managed surface that browsers drop when printing.
 */
function PrintStyles({ landscape }: { landscape: boolean }) {
  return (
    <style>{`
      @media print {
        @page { size: A4 ${landscape ? "landscape" : "portrait"}; margin: 12mm 10mm 16mm; }
        html, body {
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
          margin: 0;
          padding: 0;
          background: #fff !important;
        }
        #printable-sheet { max-width: none !important; }
        table { width: 100%; border-collapse: collapse; page-break-inside: auto; }
        thead { display: table-header-group; }
        tr { page-break-inside: avoid; }
        th, td { border: 1px solid #94a3b8; padding: 2px 4px; vertical-align: top; }
        th { font-weight: 700; background: #f1f5f9 !important; }
        section, figure, .break-inside-avoid { break-inside: avoid; page-break-inside: avoid; }
        img { max-width: 100%; }
      }
    `}</style>
  );
}

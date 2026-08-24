"use client";

/**
 * The GENERATE REPORT dialog (§17).
 *
 * One place to say what you want and in what form: which report, which towers, which sections, and
 * whether it comes out as a screen, a PDF or a workbook. Everything it collects is expressed as the
 * same query parameters the report screen uses, so a report generated here is identical to the one
 * you would reach by opening it and adjusting the filter bar — and the resulting URL can be shared.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, FileText, Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { exportWorkbook } from "@/lib/report-excel";
import {
  toDateKey,
  towerProgressHref,
  weekStartKey,
} from "@/lib/project-management-tower-progress";
import {
  TOWER_REPORTS,
  TOWER_REPORT_GROUPS,
  filterTowers,
  towerReportById,
  type TowerReportFilters,
} from "@/lib/project-management-tower-reports";
import { useTowerProgress } from "./tower-progress-provider";
import {
  DEFAULT_REPORT_INCLUDE,
  REPORT_SECTIONS,
  REPORT_SECTION_LABELS,
  encodeExclusions,
  type ReportInclude,
} from "./report-filter-bar";
import { reportExcelSheets, type ReportContext } from "./report-views";

type TowerScope = "all" | "specific" | "range";
type OutputFormat = "screen" | "pdf" | "excel";

export function GenerateReportDialog({
  open,
  onOpenChange,
  initialReportId = "tower-status",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialReportId?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { mappingId, project, towers, updates, settings, permissions } = useTowerProgress();

  const [reportId, setReportId] = useState(initialReportId);
  const [scope, setScope] = useState<TowerScope>("all");
  const [specificTowerNo, setSpecificTowerNo] = useState("");
  const [fromTowerNo, setFromTowerNo] = useState("");
  const [toTowerNo, setToTowerNo] = useState("");
  const [dateKey, setDateKey] = useState(toDateKey(new Date()));
  const [weekStart, setWeekStart] = useState(weekStartKey(new Date()));
  const [monthKey, setMonthKey] = useState(toDateKey(new Date()));
  const [include, setInclude] = useState<ReportInclude>({ ...DEFAULT_REPORT_INCLUDE });
  const [format, setFormat] = useState<OutputFormat>("screen");
  const [isWorking, setIsWorking] = useState(false);

  const definition = towerReportById(reportId);

  const filters: TowerReportFilters = useMemo(() => {
    if (scope === "specific") {
      return { search: specificTowerNo.trim(), status: "All" };
    }
    if (scope === "range") {
      return { fromTowerNo: fromTowerNo.trim(), toTowerNo: toTowerNo.trim(), status: "All" };
    }
    return { status: "All" };
  }, [scope, specificTowerNo, fromTowerNo, toTowerNo]);

  const matched = useMemo(
    () => (definition ? filterTowers(towers, filters, definition.activity) : []),
    [towers, filters, definition],
  );

  const queryString = useMemo(() => {
    const query = new URLSearchParams();
    if (filters.search) query.set("q", filters.search);
    if (filters.fromTowerNo) query.set("from", filters.fromTowerNo);
    if (filters.toTowerNo) query.set("to", filters.toTowerNo);
    query.set("d", dateKey);
    query.set("w", weekStart);
    query.set("m", monthKey);
    query.set("ex", encodeExclusions(include));
    return query.toString();
  }, [filters, dateKey, weekStart, monthKey, include]);

  const needsDate = definition?.kind === "daily";
  const needsWeek = definition?.id === "weekly-progress";
  const needsMonth = definition?.id === "monthly-progress";

  const handleGenerate = async () => {
    if (!definition) return;
    const target = `${towerProgressHref(mappingId, `reports/${definition.id}`)}&${queryString}`;

    if (format === "screen") {
      onOpenChange(false);
      router.push(target);
      return;
    }

    if (format === "pdf") {
      onOpenChange(false);
      // The print route opens the browser's print dialog itself, from which "Save as PDF" is the
      // usual destination — no PDF library, and the output matches the on-screen report exactly.
      window.open(
        `${towerProgressHref(mappingId, `reports/${definition.id}/print`)}&${queryString}`,
        "_blank",
      );
      return;
    }

    setIsWorking(true);
    try {
      const ctx: ReportContext = {
        definition,
        include,
        towers: matched,
        allTowers: towers,
        updates,
        settings,
        filters,
        dateKey,
        weekStart,
        monthKey,
        mappingId,
        projectName: project?.projectName ?? "",
      };
      const sheets = reportExcelSheets(ctx);
      if (!sheets.some((entry) => entry.rows.length)) {
        toast({ title: "Nothing to export", description: "This report has no rows in scope." });
        return;
      }
      await exportWorkbook(
        `${definition.id}-${project?.projectName ?? "project"}.xlsx`
          .replace(/[^a-z0-9.-]+/gi, "-")
          .toLowerCase(),
        sheets,
      );
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to generate the workbook:", error);
      toast({ title: "Could not build the workbook", variant: "destructive" });
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (isWorking ? undefined : onOpenChange(next))}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Generate report</DialogTitle>
          <DialogDescription>
            {project ? `${project.projectName} · ${towers.length} towers` : "Choose what to produce."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Report type</Label>
            <Select value={reportId} onValueChange={setReportId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TOWER_REPORT_GROUPS.map((group) => (
                  <SelectGroup key={group}>
                    <SelectLabel>{group}</SelectLabel>
                    {TOWER_REPORTS.filter((report) => report.group === group).map((report) => (
                      <SelectItem key={report.id} value={report.id}>
                        {report.title}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
            {definition ? (
              <p className="text-xs text-muted-foreground">{definition.description}</p>
            ) : null}
          </div>

          {needsDate || needsWeek || needsMonth ? (
            <div className="space-y-2">
              <Label>{needsDate ? "Date" : needsWeek ? "Week starting (Monday)" : "Month"}</Label>
              {needsDate ? (
                <Input
                  type="date"
                  value={dateKey}
                  max={toDateKey(new Date())}
                  onChange={(event) => setDateKey(event.target.value)}
                  className="w-44"
                />
              ) : needsWeek ? (
                <Input
                  type="date"
                  value={weekStart}
                  onChange={(event) =>
                    setWeekStart(weekStartKey(new Date(`${event.target.value}T00:00:00`)))
                  }
                  className="w-44"
                />
              ) : (
                <Input
                  type="month"
                  value={monthKey.slice(0, 7)}
                  onChange={(event) => setMonthKey(`${event.target.value}-01`)}
                  className="w-44"
                />
              )}
            </div>
          ) : null}

          <div className="space-y-2">
            <Label>Select tower</Label>
            <RadioGroup
              value={scope}
              onValueChange={(value) => setScope(value as TowerScope)}
              className="gap-2"
            >
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <RadioGroupItem value="all" />
                All towers
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <RadioGroupItem value="specific" />
                Specific tower
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <RadioGroupItem value="range" />
                Tower range
              </label>
            </RadioGroup>

            {scope === "specific" ? (
              <Input
                value={specificTowerNo}
                onChange={(event) => setSpecificTowerNo(event.target.value)}
                placeholder="T-037"
                className="w-44"
              />
            ) : null}
            {scope === "range" ? (
              <div className="flex items-center gap-2">
                <Input
                  value={fromTowerNo}
                  onChange={(event) => setFromTowerNo(event.target.value)}
                  placeholder="From: T-001"
                  className="w-36"
                />
                <span className="text-muted-foreground">–</span>
                <Input
                  value={toTowerNo}
                  onChange={(event) => setToTowerNo(event.target.value)}
                  placeholder="To: T-050"
                  className="w-36"
                />
              </div>
            ) : null}
            <p
              className={cn(
                "text-xs",
                matched.length ? "text-muted-foreground" : "font-medium text-red-700",
              )}
            >
              {matched.length} tower{matched.length === 1 ? "" : "s"} in scope
              {matched.length ? "" : " — nothing would be produced"}
            </p>
          </div>

          <div className="space-y-2">
            <Label>Include</Label>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {REPORT_SECTIONS.map((section) => (
                <label key={section} className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    checked={include[section]}
                    onCheckedChange={(checked) =>
                      setInclude((current) => ({ ...current, [section]: checked === true }))
                    }
                  />
                  {REPORT_SECTION_LABELS[section]}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Format</Label>
            <RadioGroup
              value={format}
              onValueChange={(value) => setFormat(value as OutputFormat)}
              className="flex flex-wrap gap-4"
            >
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <RadioGroupItem value="screen" />
                <FileText className="h-4 w-4" />
                On screen
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <RadioGroupItem value="pdf" />
                <Printer className="h-4 w-4" />
                PDF / print
              </label>
              {permissions.export ? (
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <RadioGroupItem value="excel" />
                  <FileSpreadsheet className="h-4 w-4" />
                  Excel
                </label>
              ) : null}
            </RadioGroup>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isWorking}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleGenerate()}
            disabled={isWorking || !definition || !matched.length}
          >
            {isWorking && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Generate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

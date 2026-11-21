"use client";

/**
 * Progress records — every Daily Progress sheet filed on the project, one row per sheet (a scope on
 * a day), newest first, with the BOQ lines recorded on it at a glance. Open shows a record's lines;
 * Edit opens the sheet in the editor, which holds every rule about a sheet. A submitted sheet is
 * locked: a DPR approver (the `Reopen` action) turns it back into a draft first, and only then can
 * it be edited or deleted (`dprRecordEditAction`, `dprRecordDeleteAction`).
 *
 * Laid out like the Projections list: four figures over what is shown, then the records in a card
 * with the scope, status and search filters in its header. Quantities are never totalled across a
 * sheet's lines — they are in different units — so a sheet is summarised by counts
 * (`dprLogSheetStats`).
 *
 * Everything it needs comes in as props and every action goes out through a callback, so it renders
 * the same from fabricated data as from the register.
 */

import { useMemo, useState } from "react";
import {
  CalendarDays,
  ClipboardList,
  Eye,
  IndianRupee,
  Lock,
  Pencil,
  Plus,
  Search,
  Trash2,
  Unlock,
  Users,
} from "lucide-react";
import { DPR_STATUSES, type DprEntry, type DprScope, type DprStatus } from "@/lib/project-management-dpr";
import { dprLogSheetStats, summariseDprLog } from "@/lib/project-management-dpr-log";
import {
  dprProgressRecordState,
  dprRecordDeleteAction,
  dprRecordEditAction,
  dprRecordMatches,
  dprRecordSlNos,
  sortDprProgressRecords,
  type DprProgressRecordState,
  type DprRecordAccess,
} from "@/lib/project-management-dpr-progress-records";
import {
  buildDprRateLookup,
  dprSheetValue,
  dprSheetsValue,
  dprUnpricedText,
  formatDprValue,
  formatDprValueCompact,
} from "@/lib/project-management-dpr-values";
import type { DprDataState } from "@/components/project-management/dpr/use-dpr-data";
import {
  DprScopeTabs,
  formatDisplayDate,
  formatQty,
  formatRangeCompact,
  todayIso,
} from "@/components/project-management/dpr/dpr-shell";
import { ScopeBadge } from "@/components/project-management/dpr/projections-shared";
import {
  DprFigureRow,
  DprFigureTile,
  DprReportCard,
  DprReportPill,
  DprReportZero,
  DprSlNoPill,
} from "@/components/project-management/dpr/reports-parts";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { InfoTip } from "@/components/shared/info-tip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

const LIST_COLOURS = ["#c4b5fd", "#7c3aed"] as const;

/** How many SL Nos the BOQ lines column shows before "+N". */
const PREVIEW_COUNT = 3;

/** Rows drawn at first, and added by each "Show more". */
const PAGE_SIZE = 40;

const ACTION_BUTTON = "h-8 rounded-[10px] px-2.5 text-xs font-bold";

/** The filters in the card's header share the fields' height, so they line up on one line. */
const FIELD_HEIGHT = "h-[var(--control-h,2.5rem)]";

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

const weekdayOf = (isoDate: string): string => {
  const date = new Date(`${isoDate}T00:00:00`);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-IN", { weekday: "short" });
};

/** "Sat 21 Nov 2026" */
const dayLabel = (isoDate: string): string => {
  const weekday = weekdayOf(isoDate);
  return `${weekday ? `${weekday} ` : ""}${formatDisplayDate(isoDate)}`;
};

/** Whole days from one ISO date to another (negative when `to` is earlier). */
const daysBetween = (from: string, to: string): number => {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Number.isNaN(a) || Number.isNaN(b) ? Number.NaN : Math.round((b - a) / 86_400_000);
};

function StatePill({ state }: { state: DprProgressRecordState }) {
  if (state === "submitted") {
    return (
      <DprReportPill tone="success">
        <Lock className="mr-1 inline h-3 w-3 align-[-1px]" aria-hidden="true" />
        Submitted · locked
      </DprReportPill>
    );
  }
  return <DprReportPill tone="warning">{state === "reopened" ? "Reopened" : "Draft"}</DprReportPill>;
}

export interface ProgressRecordListProps {
  /** The register as `useDprData` gives it; only these parts are read (BOQ lines for their rates). */
  data: Pick<DprDataState, "entries" | "isLoading" | "boqItems">;
  /** What this user may do: edit (Add), reopen a submitted sheet (Reopen), delete (Delete). */
  access: DprRecordAccess;
  /** Opens a record's screen. */
  onOpen: (entry: DprEntry) => void;
  /** Edit pressed; the page handles reopening a submitted sheet first (it confirms). */
  onEdit: (entry: DprEntry) => void;
  /** Deletes the sheet; resolves true once deleted. The page owns the write, toast and reload. */
  onDelete: (entry: DprEntry) => Promise<boolean>;
  /** Goes to the sheet editor to record a day — the empty state's next step. */
  onRecordDay: () => void;
  /** Defaults to the real today; fixed for a test. */
  today?: string;
}

export function ProgressRecordList({
  data,
  access,
  onOpen,
  onEdit,
  onDelete,
  onRecordDay,
  today: todayProp,
}: ProgressRecordListProps) {
  const { entries, isLoading, boqItems } = data;
  const [today] = useState(() => todayProp ?? todayIso());
  /** Quantity × the BOQ line's rate; a line with no rate is counted, never priced. */
  const rates = useMemo(() => buildDprRateLookup(boqItems), [boqItems]);
  const [scope, setScope] = useState<DprScope | "All">("All");
  const [status, setStatus] = useState<DprStatus | "All">("All");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [deleting, setDeleting] = useState<DprEntry | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Every filter change starts the list from its top again.
  const changeScope = (next: DprScope | "All") => {
    setScope(next);
    setLimit(PAGE_SIZE);
  };
  const changeStatus = (next: DprStatus | "All") => {
    setStatus(next);
    setLimit(PAGE_SIZE);
  };
  const changeSearch = (next: string) => {
    setSearch(next);
    setLimit(PAGE_SIZE);
  };
  const clearFilters = () => {
    setScope("All");
    setStatus("All");
    setSearch("");
    setLimit(PAGE_SIZE);
  };
  const filtered = scope !== "All" || status !== "All" || search.trim() !== "";

  /** The records the filters keep, newest day first. */
  const records = useMemo(
    () =>
      sortDprProgressRecords(
        entries
          .filter((entry) => (scope === "All" ? true : entry.scope === scope))
          .filter((entry) => (status === "All" ? true : entry.status === status))
          .filter((entry) => dprRecordMatches(entry, search)),
      ),
    [entries, scope, status, search],
  );

  /** The four figures, over the records shown. */
  const figures = useMemo(() => {
    const summary = summariseDprLog(records);
    const dates = [...new Set(records.map((entry) => entry.date).filter(Boolean))].sort();
    return {
      summary,
      value: dprSheetsValue(records, rates),
      days: dates.length,
      period: dates.length > 0 ? formatRangeCompact(dates[0], dates[dates.length - 1]) : "—",
    };
  }, [records, rates]);

  const shown = records.slice(0, limit);
  const left = records.length - shown.length;

  const handleDelete = async () => {
    const entry = deleting;
    if (!entry) return;
    setIsDeleting(true);
    try {
      if (await onDelete(entry)) setDeleting(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const { summary } = figures;

  return (
    <div className="space-y-4">
      {!isLoading ? (
        <DprFigureRow>
          <DprFigureTile
            icon={ClipboardList}
            colours={LIST_COLOURS}
            label="Records"
            value={String(summary.sheets)}
            detail={
              summary.sheets === 0
                ? "none in this view"
                : summary.drafts === 0
                  ? "all submitted"
                  : `${plural(summary.drafts, "draft")} not submitted`
            }
          />
          <DprFigureTile
            icon={CalendarDays}
            colours={["#93c5fd", "#2563eb"]}
            label="Period"
            value={figures.period}
            valueClassName="text-xl"
            detail={figures.days > 0 ? `${plural(figures.days, "day")} with a sheet` : "No sheets"}
          />
          <DprFigureTile
            icon={IndianRupee}
            colours={["#6ee7b7", "#059669"]}
            label="Value done"
            value={
              figures.value.priced > 0 ? (
                <span
                  title={`${formatDprValue(figures.value.actual)} done of ${formatDprValue(figures.value.planned)} planned`}
                >
                  {formatDprValueCompact(figures.value.actual)}
                </span>
              ) : (
                "—"
              )
            }
            valueClassName="text-xl"
            detail={
              figures.value.unpriced > 0
                ? dprUnpricedText(figures.value.unpriced)
                : figures.value.priced > 0
                  ? `of ${formatDprValueCompact(figures.value.planned)} planned · ${summary.worked} lines worked`
                  : `${summary.worked} lines worked`
            }
          />
          <DprFigureTile
            icon={Users}
            colours={["#fcd34d", "#d97706"]}
            label="Manpower"
            value={formatQty(summary.manpower)}
            detail={summary.lostHours > 0 ? `man-days · ${formatQty(summary.lostHours)} h lost` : "man-days"}
          />
        </DprFigureRow>
      ) : null}

      <DprReportCard
        icon={ClipboardList}
        colours={LIST_COLOURS}
        title="Progress records"
        subtitle="Each day's sheet for a scope, with the BOQ lines recorded on it"
        aside={
          <>
            <InfoTip label="About progress records">
              One record per scope per day — the sheet filed on Record progress. Open it to see the
              BOQ lines recorded on it. Edit opens the sheet to change, add or take off lines. A
              submitted sheet is locked: a DPR approver reopens it as a draft first. Drafts count in
              progress only once they are submitted. Planned and actual value are each line&apos;s
              quantity × its BOQ rate; a line with no rate is left out and marked *.
            </InfoTip>
            <DprScopeTabs value={scope} onChange={changeScope} includeAll asField />
            <Select value={status} onValueChange={(next) => changeStatus(next as DprStatus | "All")}>
              <SelectTrigger aria-label="Status" className={`${FIELD_HEIGHT} w-[9.5rem] text-left`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All statuses</SelectItem>
                {DPR_STATUSES.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative w-full sm:w-[14rem]">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                aria-label="Search records"
                placeholder="Search date, SL No, line…"
                className={`${FIELD_HEIGHT} pl-8`}
                value={search}
                onChange={(event) => changeSearch(event.target.value)}
              />
            </div>
            {access.canRecord ? (
              <Button className={FIELD_HEIGHT} onClick={onRecordDay}>
                <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Record progress
              </Button>
            ) : null}
          </>
        }
      >
        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-12 animate-pulse rounded bg-muted/50" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <div>
            <DprReportZero
              icon={ClipboardList}
              colours={LIST_COLOURS}
              glow={["rgba(196, 181, 253, 0.6)", "rgba(147, 197, 253, 0.5)"]}
              title="No progress recorded yet"
              text="Each day's sheet for a scope shows here once it is saved — as a draft or submitted."
            />
            {access.canRecord ? (
              <div className="flex justify-center pb-8">
                <Button onClick={onRecordDay}>
                  <Plus className="mr-2 h-4 w-4" aria-hidden="true" /> Record progress
                </Button>
              </div>
            ) : null}
          </div>
        ) : records.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-4 py-10 text-center text-sm text-muted-foreground">
            <span>No records match these filters.</span>
            {filtered ? (
              <Button size="sm" variant="outline" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : null}
          </div>
        ) : (
          <>
            {/* One line per record, all of it inside the table: short values, so the columns size
                to their content; a bounded height under a pinned header, and a narrow screen
                scrolls it sideways. */}
            <Table stickyHeader containerClassName="max-h-[65vh]" className="min-w-full">
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">SL No</TableHead>
                  <TableHead className="whitespace-nowrap">Date</TableHead>
                  <TableHead className="whitespace-nowrap">Scope</TableHead>
                  <TableHead className="whitespace-nowrap">BOQ lines</TableHead>
                  <TableHead className="whitespace-nowrap" title="Lines with an actual above zero">
                    Worked
                  </TableHead>
                  <TableHead
                    className="whitespace-nowrap text-right"
                    title="Planned lines whose actual fell short of the plan written onto the sheet"
                  >
                    Behind plan
                  </TableHead>
                  <TableHead
                    className="whitespace-nowrap text-right"
                    title="The plan written onto the sheet × each line's BOQ rate"
                  >
                    Planned value
                  </TableHead>
                  <TableHead className="whitespace-nowrap text-right" title="Actual × each line's BOQ rate">
                    Actual value
                  </TableHead>
                  <TableHead className="whitespace-nowrap text-right" title="Headcount across every trade">
                    Manpower
                  </TableHead>
                  <TableHead className="whitespace-nowrap">Status</TableHead>
                  <TableHead className="whitespace-nowrap">Prepared by</TableHead>
                  <TableHead className="whitespace-nowrap text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((entry, index) => {
                  const stats = dprLogSheetStats(entry);
                  const value = dprSheetValue(entry.lines, rates);
                  const unpriced = dprUnpricedText(value.unpriced);
                  const state = dprProgressRecordState(entry);
                  const day = dayLabel(entry.date);
                  const ago = daysBetween(entry.date, today);
                  const hint = ago === 0 ? "today" : ago === 1 ? "yesterday" : null;
                  const slNos = dprRecordSlNos(entry);
                  const preview = `${slNos.slice(0, PREVIEW_COUNT).join(" · ")}${
                    slNos.length > PREVIEW_COUNT ? ` +${slNos.length - PREVIEW_COUNT}` : ""
                  }`;
                  const fullList = (entry.lines ?? [])
                    .map((line) =>
                      `${line.boqSlNo || line.erpSlNo || "—"} ${line.description ?? ""}`.trim(),
                    )
                    .join("\n");
                  const trades = (entry.manpower ?? [])
                    .filter((line) => line.trade)
                    .map((line) => `${line.trade} ${formatQty(line.count)}`)
                    .join(", ");
                  const preparedBy = entry.preparedByName || entry.createdByName || "";
                  const what = `the ${entry.scope} sheet of ${day}`;
                  const editAction = dprRecordEditAction(entry, access);
                  const deleteAction = dprRecordDeleteAction(entry, access);
                  const reopenAndEdit = editAction.reopenFirst && editAction.allowed;
                  const editTitle =
                    editAction.reason ??
                    (reopenAndEdit ? `Reopen ${what} as a draft and edit it` : `Edit ${what}`);
                  return (
                    <TableRow key={entry.id} className="cursor-pointer" onClick={() => onOpen(entry)}>
                      <TableCell className="whitespace-nowrap py-1.5">
                        <DprSlNoPill slNo={String(index + 1)} seed={entry.id || entry.date} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm tabular-nums" title={day}>
                        <span className="font-bold">{day}</span>
                        {hint ? <span className="ml-1.5 text-xs text-muted-foreground">{hint}</span> : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap py-1.5">
                        <ScopeBadge scope={entry.scope} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm" title={fullList || undefined}>
                        {stats.lines === 0 ? (
                          <span className="text-muted-foreground">No lines</span>
                        ) : (
                          <span className="flex min-w-0 items-baseline gap-2">
                            <span className="shrink-0 font-extrabold tabular-nums">{plural(stats.lines, "line")}</span>
                            <span className="block max-w-[220px] truncate text-xs tabular-nums text-muted-foreground">
                              {preview}
                            </span>
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm tabular-nums">
                        {stats.lines === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <>
                            <span className="font-bold">{stats.worked}</span>
                            <span className="text-muted-foreground"> of {stats.lines}</span>
                          </>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap py-1.5 text-right">
                        {stats.behind > 0 ? (
                          <DprReportPill tone="warning">{stats.behind}</DprReportPill>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell
                        className="whitespace-nowrap text-right text-sm tabular-nums text-muted-foreground"
                        title={unpriced ? `${unpriced} — left out of the value` : undefined}
                      >
                        {value.priced > 0 ? formatDprValue(value.planned) : "—"}
                      </TableCell>
                      <TableCell
                        className="whitespace-nowrap text-right text-sm font-bold tabular-nums"
                        title={unpriced ? `${unpriced} — left out of the value` : undefined}
                      >
                        {value.priced > 0 ? formatDprValue(value.actual) : <span className="text-muted-foreground">—</span>}
                        {unpriced ? (
                          <>
                            <span className="ml-1 text-xs font-semibold text-muted-foreground" aria-hidden="true">
                              *
                            </span>
                            <span className="sr-only"> ({unpriced})</span>
                          </>
                        ) : null}
                      </TableCell>
                      <TableCell
                        className="whitespace-nowrap text-right text-sm tabular-nums"
                        title={trades || undefined}
                      >
                        {stats.manpower > 0 ? (
                          <span className="font-bold">{formatQty(stats.manpower)}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap py-1.5">
                        <StatePill state={state} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm" title={preparedBy || undefined}>
                        <span className="block max-w-[160px] truncate">{preparedBy || "—"}</span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap py-1.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            className={ACTION_BUTTON}
                            aria-label={`Open ${what}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              onOpen(entry);
                            }}
                          >
                            <Eye className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                            Open
                          </Button>
                          {/* A disabled button takes no pointer events, so its reason sits on a wrapper. */}
                          <span className="inline-flex" title={editTitle}>
                            <Button
                              size="sm"
                              variant="outline"
                              className={ACTION_BUTTON}
                              aria-label={reopenAndEdit ? `Reopen and edit ${what}` : `Edit ${what}`}
                              disabled={!editAction.allowed}
                              onClick={(event) => {
                                event.stopPropagation();
                                onEdit(entry);
                              }}
                            >
                              {reopenAndEdit ? (
                                <Unlock className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                              ) : (
                                <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                              )}
                              {reopenAndEdit ? "Reopen & edit" : "Edit"}
                            </Button>
                          </span>
                          <span className="inline-flex" title={deleteAction.reason ?? `Delete ${what}`}>
                            <Button
                              size="icon"
                              variant="outline"
                              className="h-8 w-8 rounded-[10px] text-destructive hover:bg-destructive/10 hover:text-destructive"
                              aria-label={`Delete ${what}`}
                              disabled={!deleteAction.allowed}
                              onClick={(event) => {
                                event.stopPropagation();
                                setDeleting(entry);
                              }}
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                            </Button>
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {left > 0 ? (
              <div className="flex justify-center border-t border-border/60 px-4 py-3">
                <Button size="sm" variant="outline" onClick={() => setLimit((value) => value + PAGE_SIZE)}>
                  Show {Math.min(PAGE_SIZE, left)} more ({left} left)
                </Button>
              </div>
            ) : null}
          </>
        )}
      </DprReportCard>

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => (!open ? setDeleting(null) : undefined)}
        destructive
        loading={isDeleting}
        title="Delete this progress record?"
        description={
          deleting
            ? `${deleting.scope} · ${dayLabel(deleting.date)} · ${plural(
                (deleting.lines ?? []).length,
                "BOQ line",
              )}, its manpower, plant and diary. This cannot be undone.`
            : undefined
        }
        confirmLabel="Delete record"
        onConfirm={handleDelete}
      />
    </div>
  );
}

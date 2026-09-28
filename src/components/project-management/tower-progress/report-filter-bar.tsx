"use client";

/**
 * The shared report filter bar, and the URL encoding that lets a filtered report be printed or
 * shared.
 *
 * Filter state lives in the query string rather than in component state so that "print this exact
 * report" is a link rather than a re-entry of six dropdowns on a second screen — the print route
 * reads the same parameters and reproduces the same rows. It also means a filtered report can be
 * sent to somebody as a URL.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TOWER_ACTIVITY_STATUSES,
  toDateKey,
  weekStartKey,
  type ProjectTower,
  type TowerActivityStatus,
} from "@/lib/project-management-tower-progress";
import {
  distinctValues,
  type TowerReportDefinition,
  type TowerReportFilters,
} from "@/lib/project-management-tower-reports";
import { FilterBar } from "@/components/shared/filter-bar";

/** Query-parameter names, kept short because they end up in a shared link. */
const PARAM = {
  search: "q",
  section: "sec",
  towerType: "typ",
  contractor: "con",
  status: "st",
  fromTowerNo: "from",
  toTowerNo: "to",
  date: "d",
  week: "w",
  month: "m",
  exclude: "ex",
} as const;

/**
 * The optional sections of a report (§17's "Include" checkboxes).
 *
 * Encoded as *exclusions* rather than inclusions, so the common case — a full report — produces a
 * clean URL, and a report link that predates a new section still renders it.
 */
export const REPORT_SECTIONS = [
  "summary",
  "status",
  "photos",
  "gps",
  "remarks",
  "contractor",
  "dates",
  "map",
] as const;

export type ReportSection = (typeof REPORT_SECTIONS)[number];

export const REPORT_SECTION_LABELS: Record<ReportSection, string> = {
  summary: "Summary",
  status: "Status",
  photos: "Site photos",
  gps: "GPS",
  remarks: "Remarks",
  contractor: "Contractor",
  dates: "Completion dates",
  map: "Map",
};

export type ReportInclude = Record<ReportSection, boolean>;

export const ALL_SECTIONS_INCLUDED: ReportInclude = REPORT_SECTIONS.reduce(
  (map, section) => ({ ...map, [section]: true }),
  {} as ReportInclude,
);

/** The map is an addition rather than a default: most reports are not about geography. */
export const DEFAULT_REPORT_INCLUDE: ReportInclude = { ...ALL_SECTIONS_INCLUDED, map: false };

/**
 * An absent parameter has to mean "the defaults", which are not "everything" — the map is off by
 * default. So a selection that happens to exclude nothing writes a `-` sentinel rather than an empty
 * string, otherwise switching the map on while everything else is on would encode to nothing and be
 * silently dropped on the next read.
 */
export function encodeExclusions(include: ReportInclude): string {
  const excluded = REPORT_SECTIONS.filter((section) => !include[section]);
  return excluded.length ? excluded.join(",") : "-";
}

function decodeExclusions(raw: string): ReportInclude {
  if (!raw) return { ...DEFAULT_REPORT_INCLUDE };
  if (raw === "-") return { ...ALL_SECTIONS_INCLUDED };
  const excluded = new Set(raw.split(",").map((value) => value.trim()));
  return REPORT_SECTIONS.reduce(
    (map, section) => ({ ...map, [section]: !excluded.has(section) }),
    {} as ReportInclude,
  );
}

export interface ReportFilterState {
  filters: TowerReportFilters;
  dateKey: string;
  weekStart: string;
  monthKey: string;
  include: ReportInclude;
  /** Everything except `project`, ready to append to a print link. */
  queryString: string;
}

/** Reads filter state out of the URL, with today's date as the default period. */
export function readReportFilters(params: URLSearchParams | null): ReportFilterState {
  const get = (key: string) => params?.get(key) ?? "";
  const today = toDateKey(new Date());
  const filters: TowerReportFilters = {
    search: get(PARAM.search),
    section: get(PARAM.section) || "All",
    towerType: get(PARAM.towerType) || "All",
    contractor: get(PARAM.contractor) || "All",
    status: (get(PARAM.status) || "All") as TowerActivityStatus | "All",
    fromTowerNo: get(PARAM.fromTowerNo),
    toTowerNo: get(PARAM.toTowerNo),
  };
  const include = decodeExclusions(get(PARAM.exclude));
  const state: ReportFilterState = {
    filters,
    dateKey: get(PARAM.date) || today,
    weekStart: get(PARAM.week) || weekStartKey(new Date()),
    monthKey: get(PARAM.month) || today,
    include,
    queryString: "",
  };
  const query = new URLSearchParams();
  Object.entries({
    [PARAM.search]: filters.search,
    [PARAM.section]: filters.section === "All" ? "" : filters.section,
    [PARAM.towerType]: filters.towerType === "All" ? "" : filters.towerType,
    [PARAM.contractor]: filters.contractor === "All" ? "" : filters.contractor,
    [PARAM.status]: filters.status === "All" ? "" : filters.status,
    [PARAM.fromTowerNo]: filters.fromTowerNo,
    [PARAM.toTowerNo]: filters.toTowerNo,
    [PARAM.date]: state.dateKey,
    [PARAM.week]: state.weekStart,
    [PARAM.month]: state.monthKey,
    [PARAM.exclude]: encodeExclusions(include),
  }).forEach(([key, value]) => {
    if (value) query.set(key, String(value));
  });
  state.queryString = query.toString();
  return state;
}

export function useReportFilters(): ReportFilterState & {
  update: (key: keyof typeof PARAM, value: string) => void;
  reset: () => void;
} {
  const router = useRouter();
  const searchParams = useSearchParams();
  const state = useMemo(() => readReportFilters(searchParams), [searchParams]);

  const update = useCallback(
    (key: keyof typeof PARAM, value: string) => {
      const next = new URLSearchParams(searchParams?.toString() ?? "");
      if (!value || value === "All") next.delete(PARAM[key]);
      else next.set(PARAM[key], value);
      // `replace` rather than `push`: adjusting a filter should not fill the back button with every
      // intermediate combination the user tried.
      router.replace(`?${next.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const reset = useCallback(() => {
    const next = new URLSearchParams();
    const project = searchParams?.get("project");
    if (project) next.set("project", project);
    router.replace(`?${next.toString()}`, { scroll: false });
  }, [router, searchParams]);

  return { ...state, update, reset };
}

export function ReportFilterBar({
  definition,
  towers,
  state,
}: {
  definition: TowerReportDefinition;
  towers: readonly ProjectTower[];
  state: ReturnType<typeof useReportFilters>;
}) {
  const sections = useMemo(() => distinctValues(towers, "section"), [towers]);
  const towerTypes = useMemo(() => distinctValues(towers, "towerType"), [towers]);
  const contractors = useMemo(() => distinctValues(towers, "contractor"), [towers]);
  const isMonthly = definition.id === "monthly-progress";
  const isWeekly = definition.id === "weekly-progress";
  const isDaily = definition.kind === "daily";
  const [search, setSearch] = useDebouncedSearch(state.filters.search ?? "", (value) =>
    state.update("search", value),
  );
  const isSet = (value: string | undefined) => Boolean(value) && value !== "All";
  const activeCount =
    [
      state.filters.section,
      state.filters.towerType,
      state.filters.contractor,
      String(state.filters.status ?? "All"),
    ].filter(isSet).length + (state.filters.fromTowerNo || state.filters.toTowerNo ? 1 : 0);

  // The period is the report's own parameter rather than a filter, so it stays in view on a phone
  // with the search while the filters fold behind the bar's toggle.
  const period = isDaily ? (
    <PeriodField label="Date">
      <Input
        type="date"
        aria-label="Date"
        value={state.dateKey}
        max={toDateKey(new Date())}
        onChange={(event) => state.update("date", event.target.value)}
      />
    </PeriodField>
  ) : isWeekly ? (
    <PeriodField label="Week starting (Monday)">
      <Input
        type="date"
        aria-label="Week starting (Monday)"
        value={state.weekStart}
        onChange={(event) =>
          state.update("week", weekStartKey(new Date(`${event.target.value}T00:00:00`)))
        }
      />
    </PeriodField>
  ) : isMonthly ? (
    <PeriodField label="Month">
      <Input
        type="month"
        aria-label="Month"
        value={state.monthKey.slice(0, 7)}
        onChange={(event) => state.update("month", `${event.target.value}-01`)}
      />
    </PeriodField>
  ) : null;

  return (
    <div className="space-y-3 print:hidden">
      {period}

      <FilterBar
        search={{ value: search, onChange: setSearch, placeholder: "Tower, location, contractor" }}
        activeCount={activeCount}
        onClear={state.reset}
      >
        {sections.length ? (
          <FilterSelect
            label="Section"
            value={state.filters.section ?? "All"}
            onChange={(value) => state.update("section", value)}
            options={sections}
            allLabel="All sections"
          />
        ) : null}

        {towerTypes.length ? (
          <FilterSelect
            label="Tower type"
            value={state.filters.towerType ?? "All"}
            onChange={(value) => state.update("towerType", value)}
            options={towerTypes}
            allLabel="All types"
          />
        ) : null}

        {contractors.length ? (
          <FilterSelect
            label="Contractor"
            value={state.filters.contractor ?? "All"}
            onChange={(value) => state.update("contractor", value)}
            options={contractors}
            allLabel="All contractors"
          />
        ) : null}

        <FilterSelect
          label="Status"
          value={String(state.filters.status ?? "All")}
          onChange={(value) => state.update("status", value)}
          options={[...TOWER_ACTIVITY_STATUSES]}
          allLabel="Any status"
        />

        <div className="flex items-center gap-1.5">
          <span className="shrink-0 text-sm text-muted-foreground">Towers</span>
          <Input
            aria-label="From tower"
            value={state.filters.fromTowerNo ?? ""}
            onChange={(event) => state.update("fromTowerNo", event.target.value)}
            placeholder="T-001"
            className="min-w-0 flex-1 sm:w-24 sm:flex-none"
          />
          <span className="text-muted-foreground">–</span>
          <Input
            aria-label="To tower"
            value={state.filters.toTowerNo ?? ""}
            onChange={(event) => state.update("toTowerNo", event.target.value)}
            placeholder="T-050"
            className="min-w-0 flex-1 sm:w-24 sm:flex-none"
          />
        </div>

        {/* Phones fold the section choices with the filters; from `sm` they get a row of their own
            under the bar (below), so both are rendered and each hides at the other's width. */}
        <IncludeSections state={state} className="border-t pt-2 sm:hidden" />
      </FilterBar>

      <IncludeSections state={state} className="hidden border-t pt-3 sm:block" />
    </div>
  );
}

/** §17's "Include" checkboxes — which optional sections the report renders. */
function IncludeSections({
  state,
  className,
}: {
  state: ReturnType<typeof useReportFilters>;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="mb-1 text-[11px] text-muted-foreground">Include in this report</p>
      <div className="grid grid-cols-2 gap-x-4 sm:flex sm:flex-wrap sm:gap-y-1.5">
        {REPORT_SECTIONS.map((section) => (
          <label
            key={section}
            className="flex min-h-9 cursor-pointer items-center gap-1.5 text-sm sm:min-h-0 sm:text-xs"
          >
            <Checkbox
              checked={state.include[section]}
              onCheckedChange={(checked) =>
                state.update(
                  "exclude",
                  encodeExclusions({ ...state.include, [section]: checked === true }),
                )
              }
            />
            {REPORT_SECTION_LABELS[section]}
          </label>
        ))}
      </div>
    </div>
  );
}

/**
 * Search is held locally and pushed to the URL after a pause.
 *
 * Every filter change rewrites the query string, which re-renders the report — and a report can be a
 * 186-tower matrix or a page of photographs per tower. Committing on each keystroke made typing in
 * this box visibly stutter; a short debounce keeps the URL as the source of truth without re-deriving
 * the whole report six times for one word.
 */
function useDebouncedSearch(
  value: string,
  onCommit: (value: string) => void,
): [string, (value: string) => void] {
  const [draft, setDraft] = useState(value);
  const [lastExternal, setLastExternal] = useState(value);
  // Held in a ref so a re-rendered parent handing over a fresh closure does not restart the timer
  // mid-word.
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  // Follow the URL when it changes from elsewhere — "Clear", or a shared link — without fighting
  // the user's own typing.
  if (value !== lastExternal) {
    setLastExternal(value);
    setDraft(value);
  }

  useEffect(() => {
    if (draft === value) return;
    const timer = setTimeout(() => commitRef.current(draft), 350);
    return () => clearTimeout(timer);
  }, [draft, value]);

  return [draft, setDraft];
}

function PeriodField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="sm:w-auto">{children}</div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  allLabel: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="All">{allLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

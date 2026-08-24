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
import { Search } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border p-3 print:hidden">
      {isDaily ? (
        <Field label="Date">
          <Input
            type="date"
            value={state.dateKey}
            max={toDateKey(new Date())}
            onChange={(event) => state.update("date", event.target.value)}
            className="h-9 w-40"
          />
        </Field>
      ) : null}

      {isWeekly ? (
        <Field label="Week starting (Monday)">
          <Input
            type="date"
            value={state.weekStart}
            onChange={(event) =>
              state.update("week", weekStartKey(new Date(`${event.target.value}T00:00:00`)))
            }
            className="h-9 w-40"
          />
        </Field>
      ) : null}

      {isMonthly ? (
        <Field label="Month">
          <Input
            type="month"
            value={state.monthKey.slice(0, 7)}
            onChange={(event) => state.update("month", `${event.target.value}-01`)}
            className="h-9 w-40"
          />
        </Field>
      ) : null}

      <Field label="Search">
        <SearchField
          value={state.filters.search ?? ""}
          onCommit={(value) => state.update("search", value)}
        />
      </Field>

      {sections.length ? (
        <Field label="Section">
          <FilterSelect
            value={state.filters.section ?? "All"}
            onChange={(value) => state.update("section", value)}
            options={sections}
            allLabel="All sections"
          />
        </Field>
      ) : null}

      {towerTypes.length ? (
        <Field label="Tower type">
          <FilterSelect
            value={state.filters.towerType ?? "All"}
            onChange={(value) => state.update("towerType", value)}
            options={towerTypes}
            allLabel="All types"
          />
        </Field>
      ) : null}

      {contractors.length ? (
        <Field label="Contractor">
          <FilterSelect
            value={state.filters.contractor ?? "All"}
            onChange={(value) => state.update("contractor", value)}
            options={contractors}
            allLabel="All contractors"
          />
        </Field>
      ) : null}

      <Field label="Status">
        <FilterSelect
          value={String(state.filters.status ?? "All")}
          onChange={(value) => state.update("status", value)}
          options={[...TOWER_ACTIVITY_STATUSES]}
          allLabel="Any status"
        />
      </Field>

      <Field label="Tower range">
        <div className="flex items-center gap-1">
          <Input
            value={state.filters.fromTowerNo ?? ""}
            onChange={(event) => state.update("fromTowerNo", event.target.value)}
            placeholder="T-001"
            className="h-9 w-24"
          />
          <span className="text-muted-foreground">–</span>
          <Input
            value={state.filters.toTowerNo ?? ""}
            onChange={(event) => state.update("toTowerNo", event.target.value)}
            placeholder="T-050"
            className="h-9 w-24"
          />
        </div>
      </Field>

      <button
        type="button"
        onClick={state.reset}
        className="h-9 rounded-md px-3 text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        Clear filters
      </button>

      <div className="w-full border-t pt-2">
        <p className="mb-1 text-[11px] text-muted-foreground">Include in this report</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {REPORT_SECTIONS.map((section) => (
            <label key={section} className="flex cursor-pointer items-center gap-1.5 text-xs">
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
function SearchField({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [lastExternal, setLastExternal] = useState(value);
  // Held in a ref so a re-rendered parent handing over a fresh closure does not restart the timer
  // mid-word.
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  // Follow the URL when it changes from elsewhere — "Clear filters", or a shared link — without
  // fighting the user's own typing.
  if (value !== lastExternal) {
    setLastExternal(value);
    setDraft(value);
  }

  useEffect(() => {
    if (draft === value) return;
    const timer = setTimeout(() => commitRef.current(draft), 350);
    return () => clearTimeout(timer);
  }, [draft, value]);

  return (
    <div className="relative w-52">
      <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
      <Input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Tower, location, contractor"
        className="h-9 pl-9"
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
  allLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  allLabel: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 w-40">
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

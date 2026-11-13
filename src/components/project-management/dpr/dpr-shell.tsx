"use client";

/**
 * Page furniture for the Daily Progress screens.
 *
 * The shell parts are Project Management's own (see jmc-page-shell.tsx, where they were first
 * factored out), re-exported here under DPR names so these screens compose from the same
 * furniture instead of a hand-copy that drifts.
 */

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Activity,
  CalendarRange,
  Check,
  ChevronsUpDown,
  ClipboardList,
  FileBarChart2,
  History,
  Settings2,
  ShieldAlert,
  Target,
  type LucideIcon,
} from "lucide-react";
import {
  DPR_BASE_PATH,
  DPR_PERIOD_TYPES,
  DPR_SCOPES,
  daysInRange,
  formatPeriodLabel,
  periodRangeFor,
  type DprDateRange,
  type DprPeriodType,
  type DprScope,
} from "@/lib/project-management-dpr";
import { dprCalendar, isValidRange, type DprSettings } from "@/lib/project-management-dpr-plan";
import type { DprBoqItem } from "@/components/project-management/dpr/use-dpr-data";
import { PageHeader } from "@/components/shared/page-header";
import type { ModuleNavTone } from "@/components/shared/module-shell";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

/*
 * The Daily Progress screens sit inside the module's `ModuleShell` (dpr/layout.tsx), whose content
 * column is the page's <main> and already pads it. So these wrappers add rhythm only — no <main>,
 * no padding, no full-height minimum — unlike the JMC parts they replaced.
 */
export const DPR_MAIN_CLASS = "min-w-0 space-y-4";

export function DprPageShell({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn(DPR_MAIN_CLASS, className)}>{children}</div>;
}

export function DprLoadingState({ blocks = 1 }: { blocks?: number }) {
  return (
    <div className={DPR_MAIN_CLASS} aria-busy="true">
      <Skeleton className="h-9 w-64" />
      {Array.from({ length: blocks }).map((_, index) => (
        <Skeleton key={index} className="h-80 w-full" />
      ))}
    </div>
  );
}

export function DprAccessDenied({
  description = "You do not have permission to view daily progress.",
}: {
  description?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Access Denied</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center p-8">
        <ShieldAlert className="h-16 w-16 text-destructive" />
      </CardContent>
    </Card>
  );
}

/** Shown when `?project=` is missing or names a mapping that no longer resolves. */
export function DprProjectNotFound({
  description = "Return to Project Management and choose a project first.",
  href = "/project-management",
  label = "Select Project",
}: {
  description?: string;
  href?: string;
  label?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Select a project first</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild>
          <Link href={href}>{label}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

/** DPR's accent — the amber the progress tiles carry across the module. */
export const DPR_GRADIENT = "from-amber-500 to-orange-600";

/** Quantities, not money: enough decimals to hold a measured figure, grouped Indian style. */
export const formatQty = (value: number): string =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(
    Math.round(value * 1000) / 1000,
  );

export const formatPct = (value: number | null): string =>
  value === null ? "—" : `${Math.round(value * 10) / 10}%`;

export const formatDisplayDate = (isoDate: string): string => {
  if (!isoDate) return "—";
  const date = new Date(`${isoDate}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? isoDate
    : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

/** Today in the local ISO form the register stores dates in. */
export const todayIso = (): string => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
};

/** "Custom" is a picker state, not a stored period type, so it lives only in the UI. */
export type DprPeriodChoice = DprPeriodType | "Custom";

export interface DprPeriodSelection {
  choice: DprPeriodChoice;
  anchorDate: string;
  customStart: string;
  customEnd: string;
}

export const defaultPeriodSelection = (choice: DprPeriodChoice = "Week"): DprPeriodSelection => {
  const today = todayIso();
  const range = periodRangeFor(choice === "Custom" ? "Week" : choice, today);
  return { choice, anchorDate: today, customStart: range.startDate, customEnd: range.endDate };
};

/** The inclusive range a selection resolves to. */
export const resolvePeriodRange = (selection: DprPeriodSelection): DprDateRange =>
  selection.choice === "Custom"
    ? { startDate: selection.customStart, endDate: selection.customEnd }
    : periodRangeFor(selection.choice, selection.anchorDate);

/**
 * The granularity to bucket a trend at. A custom range is read by day when it is short enough to
 * stay legible, and by week beyond that — a 90-day range as 90 bars is unreadable.
 */
export const resolveTrendGranularity = (
  selection: DprPeriodSelection,
  range: DprDateRange,
): DprPeriodType => {
  if (selection.choice === "Day") return "Day";
  if (selection.choice === "Week") return "Day";
  if (selection.choice === "Month") return "Day";
  const days =
    (new Date(`${range.endDate}T00:00:00`).getTime() -
      new Date(`${range.startDate}T00:00:00`).getTime()) /
      86_400_000 +
    1;
  if (!Number.isFinite(days) || days <= 31) return "Day";
  return days <= 180 ? "Week" : "Month";
};

/**
 * A date range at its shortest readable form: "09–15 Nov 2026", "28 Nov – 04 Dec 2026", or both
 * dates in full across a year end.
 */
export const formatRangeCompact = (startDate: string, endDate: string): string => {
  if (startDate === endDate) return formatPeriodLabel("Day", startDate);
  const start = formatPeriodLabel("Day", startDate);
  const end = formatPeriodLabel("Day", endDate);
  if (startDate.slice(0, 7) === endDate.slice(0, 7)) return `${start.slice(0, 2)}–${end}`;
  if (startDate.slice(0, 4) === endDate.slice(0, 4)) return `${start.slice(0, 6)} – ${end}`;
  return `${start} – ${end}`;
};

export function DprPeriodPicker({
  value,
  onChange,
  className,
  settings,
  inline = false,
}: {
  value: DprPeriodSelection;
  onChange: (next: DprPeriodSelection) => void;
  className?: string;
  /** With the project's settings, the readout also counts the period's working days. */
  settings?: DprSettings;
  /**
   * Render the fields bare, for a caller's own flex row (`flex flex-wrap items-end gap-3`): they
   * sit on one line beside the caller's fields at their own height, and wrap only when narrow.
   */
  inline?: boolean;
}) {
  const range = useMemo(() => resolvePeriodRange(value), [value]);
  const label = useMemo(() => {
    if (!isValidRange(range)) return "Pick a valid from and to date";
    const span = formatRangeCompact(range.startDate, range.endDate);
    if (!settings) {
      return value.choice === "Custom" ? span : formatPeriodLabel(value.choice, range.startDate);
    }
    const days = daysInRange(range.startDate, range.endDate);
    const working = dprCalendar(settings).workingDays(range.startDate, range.endDate).length;
    return `${span} (${days}d, ${working} working)`;
  }, [range, settings, value.choice]);

  // In a row, each field takes its share of the line; the readout gets the widest, so its dates
  // never clip. In the default grid, the readout spans two columns for the same reason.
  const field = inline ? "min-w-[8rem] flex-1 space-y-1.5" : "space-y-1.5";
  const coversField = inline
    ? "min-w-[12.5rem] flex-[2.2] space-y-1.5"
    : cn("min-w-0 space-y-1.5", value.choice !== "Custom" && "sm:col-span-2");

  const fields = (
    <>
        <div className={field}>
          <Label htmlFor="dpr-period-type">Period</Label>
          <Select
            value={value.choice}
            onValueChange={(next) => onChange({ ...value, choice: next as DprPeriodChoice })}
          >
            <SelectTrigger id="dpr-period-type" className="text-left">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DPR_PERIOD_TYPES.map((periodType) => (
                <SelectItem key={periodType} value={periodType}>
                  {periodType === "Day" ? "Daily" : periodType === "Week" ? "Weekly" : "Monthly"}
                </SelectItem>
              ))}
              <SelectItem value="Custom">Custom range</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {value.choice === "Custom" ? (
          <>
            <div className={field}>
              <Label htmlFor="dpr-period-from">From</Label>
              <Input
                id="dpr-period-from"
                type="date"
                value={value.customStart}
                onChange={(event) => onChange({ ...value, customStart: event.target.value })}
              />
            </div>
            <div className={field}>
              <Label htmlFor="dpr-period-to">To</Label>
              <Input
                id="dpr-period-to"
                type="date"
                value={value.customEnd}
                onChange={(event) => onChange({ ...value, customEnd: event.target.value })}
              />
            </div>
          </>
        ) : (
          <div className={field}>
            <Label htmlFor="dpr-period-anchor">
              {value.choice === "Day"
                ? "Date"
                : inline
                  ? `Date in ${value.choice.toLowerCase()}`
                  : `Any date in the ${value.choice.toLowerCase()}`}
            </Label>
            <Input
              id="dpr-period-anchor"
              type="date"
              value={value.anchorDate}
              onChange={(event) => onChange({ ...value, anchorDate: event.target.value })}
            />
          </div>
        )}

        <div className={coversField}>
          <Label>Covers</Label>
          <div
            className="flex h-10 items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-3 text-sm font-medium tabular-nums"
            title={label}
          >
            <CalendarRange className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{label}</span>
          </div>
        </div>
    </>
  );

  if (inline) return fields;
  return (
    <div className={className}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">{fields}</div>
    </div>
  );
}

/** Civil / Erection, with an "All" option where a screen reports across both. */
export function DprScopeTabs({
  value,
  onChange,
  includeAll = false,
  className,
}: {
  value: DprScope | "All";
  onChange: (next: DprScope | "All") => void;
  includeAll?: boolean;
  className?: string;
}) {
  return (
    <Tabs value={value} onValueChange={(next) => onChange(next as DprScope | "All")} className={className}>
      <TabsList>
        {includeAll && <TabsTrigger value="All">All scopes</TabsTrigger>}
        {DPR_SCOPES.map((scope) => (
          <TabsTrigger key={scope} value={scope}>
            {scope}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

/* ── Module navigation ──────────────────────────────────────────────────────────────────────── */

export type DprTabKey = "dashboard" | "projections" | "record" | "log" | "reports" | "settings";

export const DPR_TABS: ReadonlyArray<{
  key: DprTabKey;
  label: string;
  path: string;
  icon: LucideIcon;
  /** The page header's subtitle for this screen. */
  description: string;
  /** The sidebar's name for it, where that differs from the page title. */
  navLabel?: string;
  tone: ModuleNavTone;
}> = [
  {
    key: "dashboard",
    tone: "violet",
    navLabel: "Dashboard",
    label: "Daily progress",
    path: DPR_BASE_PATH,
    icon: Activity,
    description: "Planned against actual, line by line. Units are never added together.",
  },
  {
    key: "projections",
    tone: "indigo",
    label: "Projections",
    path: `${DPR_BASE_PATH}/targets`,
    icon: Target,
    description: "What each BOQ line is planned to achieve, over any period.",
  },
  {
    key: "record",
    tone: "emerald",
    label: "Record progress",
    path: `${DPR_BASE_PATH}/entry`,
    icon: ClipboardList,
    description:
      "One sheet per scope per day: what was planned, what was done, and the site diary behind it.",
  },
  {
    key: "log",
    tone: "sky",
    label: "Log",
    path: `${DPR_BASE_PATH}/log`,
    icon: History,
    description: "Every sheet filed on this project, newest first.",
  },
  {
    key: "reports",
    tone: "amber",
    label: "Reports",
    path: `${DPR_BASE_PATH}/reports`,
    icon: FileBarChart2,
    description:
      "Planned against actual, manpower, plant and delays, for the period and scope you choose.",
  },
  {
    key: "settings",
    tone: "slate",
    label: "Settings",
    path: `${DPR_BASE_PATH}/settings`,
    icon: Settings2,
    description: "Working calendar, limits and lists used by the checks.",
  },
];

/** A DPR path with the project carried along, plus any extra query parameters. */
export const dprHref = (
  path: string,
  mappingId: string,
  query: Record<string, string> = {},
): string => {
  const params = new URLSearchParams({ project: mappingId, ...query });
  return `${path}?${params.toString()}`;
};

/**
 * The page header of every Daily Progress screen. The screens themselves are listed in the
 * module's sidebar (dpr/layout.tsx), so the header carries only the title and the way back.
 */
export function DprHeader({
  active,
  mappingId,
  projectName,
  title,
  description,
  actions,
}: {
  active: DprTabKey;
  mappingId: string;
  projectName: string;
  /** Defaults to the screen's title. */
  title?: string;
  description?: string;
  actions?: ReactNode;
}) {
  const tab = DPR_TABS.find((candidate) => candidate.key === active)!;
  return (
    <PageHeader
      title={title ?? tab.label}
      description={description ?? tab.description}
      icon={tab.icon}
      breadcrumbs={[
        { label: "Project Management", href: "/project-management" },
        { label: "Daily Progress", href: dprHref(DPR_BASE_PATH, mappingId) },
        { label: projectName || "Project" },
      ]}
      backHref={dprHref("/project-management", mappingId)}
      backLabel="Project Management"
      actions={actions}
    />
  );
}

/* ── Figures ────────────────────────────────────────────────────────────────────────────────── */

/** A quantity at its unit's precision: whole for Nos, up to three decimals otherwise. */
export const formatQtyAt = (value: number, decimals: number): string =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: decimals }).format(
    Math.round(value * 10 ** decimals) / 10 ** decimals,
  );

/** One headline figure with its label and, optionally, a line on how it was worked out. */
export function DprStatTile({
  value,
  label,
  detail,
  icon: Icon,
  tone,
}: {
  value: ReactNode;
  label: string;
  detail?: ReactNode;
  icon: LucideIcon;
  /** Chip colours, e.g. "bg-sky-500/10 text-sky-600". */
  tone: string;
}) {
  return (
    <Card className="border-border/60">
      <CardContent className="flex items-start gap-2.5 p-3 sm:gap-3 sm:p-4">
        <div
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg sm:h-10 sm:w-10",
            tone,
          )}
        >
          <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
        </div>
        <div className="min-w-0">
          <div className="break-words text-lg font-bold leading-tight tabular-nums sm:text-2xl">
            {value}
          </div>
          <div className="text-xs text-muted-foreground">{label}</div>
          {detail ? <div className="mt-0.5 text-[11px] text-muted-foreground">{detail}</div> : null}
        </div>
      </CardContent>
    </Card>
  );
}

/** A BOQ line in a cell: number in bold, description clamped to two lines, full text on hover. */
export function DprBoqText({
  boqSlNo,
  description,
  className,
}: {
  boqSlNo?: string;
  description?: string;
  className?: string;
}) {
  return (
    <div
      className={cn("line-clamp-2 min-w-[200px] max-w-[420px] text-sm", className)}
      title={description}
    >
      {boqSlNo ? <span className="font-semibold">{boqSlNo}</span> : null}
      {boqSlNo && description ? " · " : null}
      {description || (boqSlNo ? "" : "BOQ line")}
    </div>
  );
}

/** Errors that block, then warnings that need a second look. Always visible, never behind a tip. */
export function DprMessages({
  errors,
  warnings,
  errorTitle = "Fix these before saving",
  warningTitle,
  className,
}: {
  errors: readonly string[];
  warnings: readonly string[];
  errorTitle?: string;
  /** Defaults to "Also check" beside errors, else "Check these". */
  warningTitle?: string;
  className?: string;
}) {
  if (errors.length === 0 && warnings.length === 0) return null;
  return (
    <div className={cn("space-y-2", className)}>
      {errors.length > 0 ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          <p className="font-medium">{errorTitle}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {warnings.length > 0 ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          <p className="font-medium">
            {warningTitle ?? (errors.length > 0 ? "Also check" : "Check these")}
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {warnings.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Compact per-row messages under an input in a table. */
export function DprRowMessages({
  errors,
  warnings,
}: {
  errors: readonly string[];
  warnings: readonly string[];
}) {
  if (errors.length === 0 && warnings.length === 0) return null;
  return (
    <div className="mt-1 space-y-0.5 text-left text-xs">
      {errors.map((message) => (
        <p key={`e-${message}`} className="text-destructive">
          {message}
        </p>
      ))}
      {warnings.map((message) => (
        <p key={`w-${message}`} className="text-amber-700 dark:text-amber-300">
          {message}
        </p>
      ))}
    </div>
  );
}

/**
 * A searchable BOQ line picker. A plain Select is unusable over a BOQ of hundreds of lines; this
 * filters on the BOQ number, ERP number and description as you type.
 */
export function DprBoqPicker({
  items,
  value,
  onChange,
  disabled,
  placeholder = "Choose a BOQ line",
  className,
  ariaLabel,
  compact = false,
  showSlNo = true,
}: {
  items: readonly DprBoqItem[];
  value: string;
  onChange: (boqItemId: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  /** One line at a table row's height, the description cut short (full text on hover). */
  compact?: boolean;
  /**
   * Show the BOQ SL No in the closed picker. Off where the row already has an SL No column of its
   * own, so the number is never shown twice.
   */
  showSlNo?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = items.find((item) => item.id === value);
  const searchText = useMemo(
    () =>
      new Map(
        items.map((item) => [
          item.id,
          `${item.boqSlNo} ${item.erpSlNo ?? ""} ${item.description} ${item.unit}`.toLowerCase(),
        ]),
      ),
    [items],
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={disabled}
          title={
            selected
              ? `${selected.boqSlNo ? `${selected.boqSlNo} · ` : ""}${selected.description}`
              : undefined
          }
          className={cn(
            compact
              ? "h-8 w-full min-w-0 justify-between gap-2 px-2.5 py-0 text-left font-normal"
              : "h-auto min-h-10 w-full justify-between gap-2 py-1.5 text-left font-normal",
            className,
          )}
        >
          {selected && compact ? (
            <span className="flex min-w-0 flex-1 items-center gap-2 text-sm">
              {showSlNo ? (
                <span className="w-14 shrink-0 truncate font-semibold tabular-nums">
                  {selected.boqSlNo || "—"}
                </span>
              ) : null}
              <span className="min-w-0 flex-1 truncate">{selected.description || "BOQ line"}</span>
            </span>
          ) : selected ? (
            <DprBoqText
              boqSlNo={selected.boqSlNo}
              description={selected.description}
              className="min-w-0 max-w-none whitespace-normal"
            />
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(32rem,calc(100vw-2rem))] p-0">
        <Command
          filter={(itemId, search) =>
            (searchText.get(itemId) ?? "").includes(search.trim().toLowerCase()) ? 1 : 0
          }
        >
          <CommandInput placeholder="Search by BOQ number or description…" />
          {/* SL No, description and unit as three aligned columns, under their own headings. */}
          <div className="flex items-center gap-2 border-b px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <span className="w-4 shrink-0" aria-hidden="true" />
            <span className="w-16 shrink-0">SL No</span>
            <span className="min-w-0 flex-1">Description</span>
            <span className="w-16 shrink-0 text-right">Unit</span>
          </div>
          <CommandList>
            <CommandEmpty>No BOQ line matches.</CommandEmpty>
            <CommandGroup>
              {items.map((item) => (
                <CommandItem
                  key={item.id}
                  value={item.id}
                  onSelect={() => {
                    onChange(item.id);
                    setOpen(false);
                  }}
                  className="items-start gap-2"
                >
                  <Check
                    className={cn(
                      "mt-0.5 h-4 w-4 shrink-0",
                      item.id === value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="w-16 shrink-0 truncate font-semibold tabular-nums" title={item.boqSlNo}>
                    {item.boqSlNo || "—"}
                  </span>
                  <span className="line-clamp-2 min-w-0 flex-1" title={item.description}>
                    {item.description || "BOQ line"}
                  </span>
                  <span className="w-16 shrink-0 truncate text-right text-xs text-muted-foreground" title={item.unit}>
                    {item.unit}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

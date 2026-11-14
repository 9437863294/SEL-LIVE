"use client";

/**
 * Record progress — one sheet per scope per day — after the user's mock-up (`sel-dpr-edit-sheet`):
 * the headline band with the sheet's lock, four tiles (scope, date, weather, status), the work done
 * with each line's standing against its BOQ quantity, manpower and plant side by side, the site
 * diary, what is worth a second look, and a bar pinned to the bottom with the sheet's actions.
 *
 * Opening a date that already has a sheet loads it, because a site files one DPR per scope per day
 * and a second would double-count. New sheets are keyed `{scope}-{date}` (by the page) for the same
 * reason.
 *
 * **Actual is the only thing the work table asks for.** Planned is read-only: it is whatever the
 * planning engine says for the date (working days, spread, the shorter overlapping period owning
 * the day). A BOQ line with nothing planned still takes an actual — most site days are worked
 * without a figure having been set, and refusing the record would lose the only hard fact of the
 * day. `plannedQty` is still written onto each saved line as a snapshot, so the log can show plan
 * against actual without re-deriving it.
 *
 * The sheet is held as typed text, so an Actual left empty is told apart from a 0 — the checks
 * (`checkDprSheet`, rules D1–D10) require every row to say which it is. Submitting locks the
 * sheet; only a DPR approver (`Reopen`) can turn it back into a draft. "Worth checking" is a
 * separate set of hints (`buildDprSheetChecks`) that never blocks anything.
 *
 * Everything it needs comes in as props and every write goes out through a callback, so it renders
 * the same from fabricated data as from the register: `entry/page.tsx` only resolves the project,
 * the permissions and the loading states, and does the Firestore writes.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  Anchor,
  BrickWall,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock,
  Cloud,
  CloudRain,
  CloudSun,
  Construction,
  Flame,
  Hammer,
  HardHat,
  Layers,
  Loader2,
  Lock,
  LockOpen,
  MessageSquare,
  Minus,
  PaintRoller,
  Plus,
  RotateCcw,
  Send,
  Sun,
  ThermometerSun,
  Tractor,
  Trash2,
  Truck,
  Unlock,
  User,
  Users,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { nanoid } from "nanoid";
import {
  DPR_BASE_PATH,
  DPR_PERMISSION_RESOURCE,
  DPR_SCOPES,
  dprNumber,
  parseIsoDate,
  validateDprEntry,
  type DprBoqLike,
  type DprEntry,
  type DprEntryDraft,
  type DprEquipmentLine,
  type DprLine,
  type DprManpowerLine,
  type DprScope,
  type DprStatus,
} from "@/lib/project-management-dpr";
import {
  checkDprSheet,
  dprCompletionOn,
  dprSuggestions,
  indexDprActuals,
  roundToDecimals,
  type DprActualIndex,
  type DprCompletion,
  type DprSheet,
} from "@/lib/project-management-dpr-plan";
import { dprTradeOrder } from "@/lib/project-management-dpr-reports";
import {
  buildDprSheetChecks,
  dprSheetBoqState,
  dprSheetLineQty,
} from "@/lib/project-management-dpr-sheet-checks";
import type { DprDataState } from "@/components/project-management/dpr/use-dpr-data";
import { DprCompletedLines } from "@/components/project-management/dpr/entry-completed-lines";
import {
  DPR_TABS,
  DprBoqPicker,
  DprFieldLabel,
  DprMessages,
  DprPageShell,
  dprHref,
  formatQty,
  formatQtyAt,
  todayIso,
} from "@/components/project-management/dpr/dpr-shell";
import { DprBranchMark, breakdownTitle } from "@/components/project-management/dpr/dpr-indent";
import { DprReportsHero } from "@/components/project-management/dpr/reports-hero";
import {
  DprGradientChip,
  DprReportCallout,
  DprReportPill,
  DprReportZero,
  DprSlNoPill,
  type DprGradient,
} from "@/components/project-management/dpr/reports-parts";
import { PmEmptyState } from "@/components/project-management/pm-shell";
import { InfoTip } from "@/components/shared/info-tip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

/* ── Sheet state: everything as typed ───────────────────────────────────────────────────────── */

interface RowState {
  id: string;
  boqItemId: string;
  /** "" means not entered yet, which is not the same as 0. */
  actual: string;
  location: string;
  agency: string;
  remarks: string;
}

interface ManpowerState {
  id: string;
  trade: string;
  count: string;
}

interface EquipmentState {
  id: string;
  name: string;
  deployed: string;
  runningHours: string;
  idleHours: string;
}

interface SheetState {
  weather: string;
  rows: RowState[];
  manpower: ManpowerState[];
  equipment: EquipmentState[];
  lostTimeHours: string;
  lostTimeReason: string;
  hindrances: string;
  remarks: string;
}

/**
 * A draft can be saved with an Actual still empty. The stored line then carries `actualQty: 0`
 * and `actualEntered: false`, so reopening the draft shows the box empty rather than a 0 nobody
 * typed. Sheets saved before this flag existed read as entered.
 */
type StoredLine = DprLine & { actualEntered?: boolean };

const blankRow = (boqItemId = ""): RowState => ({
  id: nanoid(),
  boqItemId,
  actual: "",
  location: "",
  agency: "",
  remarks: "",
});

/** A row nobody has typed on yet: no actual, location, agency or remark. */
const isUntouchedRow = (row: RowState): boolean =>
  !row.actual.trim() && !row.location.trim() && !row.agency.trim() && !row.remarks.trim();

/**
 * A draft row that records no work: the actual blank or 0, and no remark. On a line that was
 * finished before the day, such a row says nothing (where a 0 was worked is moot), so a draft
 * opened later leaves it off instead of showing a finished line as still to do.
 */
const recordsNoWork = (row: RowState): boolean =>
  (!row.actual.trim() || dprNumber(row.actual) === 0) && !row.remarks.trim();

const numberText = (value: unknown): string =>
  value === null || value === undefined || value === "" ? "" : String(dprNumber(value));

const sheetFromEntry = (entry: DprEntry): SheetState => ({
  weather: entry.weather ?? "",
  rows: (entry.lines ?? []).map((line) => {
    const stored = line as StoredLine;
    return {
      id: stored.id || nanoid(),
      boqItemId: stored.boqItemId ?? "",
      actual: stored.actualEntered === false ? "" : String(dprNumber(stored.actualQty)),
      location: stored.location ?? "",
      agency: stored.agency ?? "",
      remarks: stored.remarks ?? "",
    };
  }),
  manpower: (entry.manpower ?? []).map((line) => ({
    id: line.id || nanoid(),
    trade: line.trade ?? "",
    count: numberText(line.count),
  })),
  equipment: (entry.equipment ?? []).map((line) => ({
    id: line.id || nanoid(),
    name: line.name ?? "",
    deployed: numberText(line.deployed),
    runningHours: numberText(line.runningHours),
    idleHours: numberText(line.idleHours),
  })),
  lostTimeHours: entry.lostTimeHours ? String(entry.lostTimeHours) : "",
  lostTimeReason: entry.lostTimeReason ?? "",
  hindrances: entry.hindrances ?? "",
  remarks: entry.remarks ?? "",
});

const emptySheet = (rows: RowState[]): SheetState => ({
  weather: "",
  rows,
  manpower: [],
  equipment: [],
  lostTimeHours: "",
  lostTimeReason: "",
  hindrances: "",
  remarks: "",
});

interface Messages {
  errors: string[];
  warnings: string[];
}

/* ── Colour ─────────────────────────────────────────────────────────────────────────────────── */

interface TradeColour {
  /** The palette slot: the share bar and legend. */
  light: string;
  /** Darker steps of the same hue for the avatar chip, so its white icon stays readable. */
  card: DprGradient;
}

/**
 * The Reports screen's trade palette (the dataviz reference categorical order), so a trade wears
 * the same colour here as in the manpower report. Slots follow `dprTradeOrder`.
 */
const TRADE_SLOTS: readonly TradeColour[] = [
  { light: "#2a78d6", card: ["#2a78d6", "#1c5cab"] },
  { light: "#eb6834", card: ["#d9572a", "#a8401b"] },
  { light: "#1baf7a", card: ["#15936a", "#0d6b4c"] },
  { light: "#eda100", card: ["#b97d00", "#8a5c00"] },
  { light: "#e87ba4", card: ["#c95a85", "#9c3a62"] },
  { light: "#008300", card: ["#0a8a0a", "#006100"] },
  { light: "#6250d6", card: ["#6250d6", "#4535a8"] },
  { light: "#e34948", card: ["#d63c3b", "#a82a29"] },
];
const TRADE_OTHER: TradeColour = { light: "#94a3b8", card: ["#64748b", "#475569"] };

/** A trade's icon, by what it is called (as the manpower report draws it). */
const TRADE_ICONS: Array<[RegExp, LucideIcon]> = [
  [/mason|brick/i, BrickWall],
  [/helper|labou?r|khalasi/i, User],
  [/carpent|shutter/i, Hammer],
  [/bar ?bend|steel|rebar/i, Construction],
  [/fitter|plumb|mechanic/i, Wrench],
  [/rigger/i, Anchor],
  [/weld/i, Flame],
  [/electric/i, Zap],
  [/paint/i, PaintRoller],
  [/operator|driver/i, Tractor],
  [/supervis|foreman|engineer/i, HardHat],
];
const tradeIcon = (trade: string): LucideIcon =>
  TRADE_ICONS.find(([pattern]) => pattern.test(trade))?.[1] ?? Users;

/** Plant takes the amber end of the same palette, offset so it never matches the trade beside it. */
const PLANT_COLOURS: readonly DprGradient[] = [
  ["#fcd34d", "#d97706"],
  ["#fdba74", "#ea580c"],
  ["#67e8f9", "#0891b2"],
  ["#c4b5fd", "#7c3aed"],
];

/** A weather option's icon and colours, by what it is called; a generic cloud otherwise. */
const weatherLook = (option: string): { icon: LucideIcon; colours: DprGradient } => {
  if (/clear|sun|fair|bright/i.test(option)) return { icon: Sun, colours: ["#fcd34d", "#d97706"] };
  if (/rain|drizzle|shower|storm|thunder/i.test(option)) return { icon: CloudRain, colours: ["#93c5fd", "#2563eb"] };
  if (/hot|heat/i.test(option)) return { icon: ThermometerSun, colours: ["#fdba74", "#ea580c"] };
  if (/cloud|overcast/i.test(option)) return { icon: Cloud, colours: ["#cbd5e1", "#64748b"] };
  return { icon: Cloud, colours: ["#7dd3fc", "#0284c7"] };
};

/** dd-mm-yyyy, as the lock pill shows the sheet's day. */
const displayDate = (isoDate: string): string =>
  parseIsoDate(isoDate) ? isoDate.split("-").reverse().join("-") : "";

/* ── Small parts ────────────────────────────────────────────────────────────────────────────── */

/**
 * A dropdown over one of the project's configured lists (Daily Progress › Settings › Lists).
 *
 * A value already on a filed sheet stays selectable even after it leaves the list, so an old
 * sheet still reads as it was filed. A project that emptied the list types the value instead.
 */
function ConfiguredListPick({
  value,
  options,
  onChange,
  disabled,
  placeholder,
  ariaLabel,
  fallbackListId,
  className = "h-8",
}: {
  value: string;
  options: readonly string[];
  onChange: (next: string) => void;
  disabled: boolean;
  placeholder: string;
  ariaLabel: string;
  /** A <datalist> of earlier values, suggested while the configured list is still empty. */
  fallbackListId?: string;
  /** The box's height (and anything else) — a table row's h-8 unless a card row wants more. */
  className?: string;
}) {
  const choices = value && !options.includes(value) ? [value, ...options] : [...options];
  if (options.length === 0) {
    return (
      <Input
        className={cn("w-full min-w-0", className)}
        list={fallbackListId}
        placeholder={placeholder}
        aria-label={ariaLabel}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  return (
    // "" keeps the Select controlled and shows the placeholder (Radix 2.x).
    <Select value={value} disabled={disabled} onValueChange={onChange}>
      <SelectTrigger className={cn("w-full min-w-0 text-left", className)} aria-label={ariaLabel}>
        <span className="min-w-0 flex-1 truncate">
          <SelectValue placeholder={placeholder} />
        </span>
      </SelectTrigger>
      <SelectContent>
        {choices.map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** One of the four tiles over the sheet: a gradient edge, a labelled icon chip, then its control. */
function SheetTile({
  icon,
  colours,
  label,
  labelId,
  htmlFor,
  info,
  children,
}: {
  icon: LucideIcon;
  colours: DprGradient;
  label: ReactNode;
  labelId?: string;
  htmlFor?: string;
  info?: ReactNode;
  children: ReactNode;
}) {
  const labelClass = "min-w-0 truncate text-[11.5px] font-extrabold text-muted-foreground";
  return (
    <div className="relative min-w-0 overflow-hidden rounded-[18px] border border-border/60 bg-card py-3 pl-4 pr-3.5 shadow-sm">
      <span
        className="pointer-events-none absolute inset-y-0 left-0 w-1"
        style={{ backgroundImage: `linear-gradient(${colours[0]}, ${colours[1]})` }}
        aria-hidden="true"
      />
      <div className="mb-[7px] flex h-6 min-w-0 items-center gap-[7px]">
        <DprGradientChip icon={icon} colours={colours} className="h-[22px] w-[22px] rounded-[7px]" iconClassName="h-3 w-3" />
        {htmlFor ? (
          <Label htmlFor={htmlFor} id={labelId} className={labelClass}>
            {label}
          </Label>
        ) : (
          <span id={labelId} className={labelClass}>
            {label}
          </span>
        )}
        {info}
      </div>
      {children}
    </div>
  );
}

const CARD_TINTS = {
  emerald: "from-emerald-50",
  blue: "from-blue-50",
  amber: "from-amber-50",
  rose: "from-rose-50",
} as const;

/**
 * A card of the sheet: the reports' card, its header tinted in the card's own colour (the mock-up's
 * emerald work, blue manpower, amber plant, rose diary), with an optional InfoTip beside the title.
 */
function SheetCard({
  tint,
  icon,
  colours,
  title,
  subtitle,
  info,
  aside,
  children,
}: {
  tint: keyof typeof CARD_TINTS;
  icon: LucideIcon;
  colours: DprGradient;
  title: string;
  subtitle?: string;
  info?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
      <div
        className={cn(
          "flex flex-wrap items-center gap-2.5 border-b border-border/60 bg-gradient-to-r to-transparent px-4 py-3 sm:px-[18px]",
          CARD_TINTS[tint],
        )}
      >
        <DprGradientChip icon={icon} colours={colours} className="h-8 w-8 rounded-[10px]" iconClassName="h-4 w-4" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <b className="truncate text-[14.5px] leading-tight">{title}</b>
            {info}
          </div>
          {subtitle ? (
            <small className="block truncate text-[11.5px] font-semibold text-muted-foreground" title={subtitle}>
              {subtitle}
            </small>
          ) : null}
        </div>
        {aside ? <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 sm:shrink-0">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

const ADD_TONES = {
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  blue: "border-blue-200 bg-blue-50 text-blue-700",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
} as const;

/** The dashed "Add …" button at the foot of a card. */
function AddButton({
  tone,
  onClick,
  children,
}: {
  tone: keyof typeof ADD_TONES;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-[38px] items-center gap-1.5 rounded-[11px] border border-dashed px-3.5 text-sm font-extrabold transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        ADD_TONES[tone],
      )}
    >
      <Plus className="h-4 w-4" aria-hidden="true" />
      {children}
    </button>
  );
}

/** A number with − and + either side. Typed as text, so the checks still see exactly what was typed. */
function Stepper({
  value,
  onChange,
  ariaLabel,
  colour,
  step = 1,
  placeholder = "0",
  inputMode = "numeric",
}: {
  value: string;
  onChange: (next: string) => void;
  ariaLabel: string;
  /** The − and + glyphs' colour: the row's trade or plant colour. */
  colour: string;
  step?: number;
  placeholder?: string;
  inputMode?: "numeric" | "decimal";
}) {
  const bump = (delta: number) => {
    const next = Math.max(0, Math.round((dprNumber(value) + delta) * 100) / 100);
    onChange(String(next));
  };
  const side =
    "flex h-full w-8 shrink-0 items-center justify-center bg-muted/60 transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";
  return (
    <div className="flex h-9 min-w-0 items-center overflow-hidden rounded-xl border border-border/60 bg-background">
      <button type="button" className={side} style={{ color: colour }} aria-label={`Less — ${ariaLabel}`} onClick={() => bump(-step)}>
        <Minus className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <input
        type="text"
        inputMode={inputMode}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="h-full w-full min-w-0 border-0 bg-transparent px-1 text-center text-[15px] font-extrabold tabular-nums outline-none placeholder:font-semibold placeholder:text-muted-foreground focus-visible:bg-muted/30 disabled:cursor-not-allowed disabled:opacity-70"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <button type="button" className={side} style={{ color: colour }} aria-label={`More — ${ariaLabel}`} onClick={() => bump(step)}>
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={label} title={label} onClick={onClick}>
      <Trash2 className="h-4 w-4 text-destructive" />
    </Button>
  );
}

const STATUS_LOOK = {
  new: { label: "Not filed yet", chip: "bg-muted text-muted-foreground" },
  draft: { label: "Draft", chip: "bg-amber-100 text-amber-800" },
  reopened: { label: "Reopened — editing", chip: "bg-amber-100 text-amber-800" },
  locked: { label: "Submitted, locked", chip: "bg-emerald-100 text-emerald-700" },
} as const;

const WORK_DONE_HELP =
  "Planned today comes from Projections and cannot be typed here. Done / BOQ is everything submitted on the line before this sheet, of its BOQ quantity, with the bar adding today. Enter an actual on every row, 0 if no work was done. A planned line already finished before this day — its BOQ quantity reached, or its projection met early — is left off and listed, collapsed, under Already complete; add it back if more was done.";

/* ── The view ───────────────────────────────────────────────────────────────────────────────── */

export interface DprEntrySaveRequest {
  /** The sheet as it will be written (lines, manpower, equipment, diary, `preparedByName`). */
  draft: DprEntryDraft;
  status: "Draft" | "Submitted";
  /** The sheet already filed for this scope and date, or null for a new one. */
  existing: DprEntry | null;
}

export interface DprEntryViewProps {
  /** The register as `useDprData` gives it; only these parts are read. */
  data: Pick<
    DprDataState,
    "boqItems" | "entries" | "settings" | "projectDates" | "plan" | "decimalsFor" | "isLoading" | "projectName"
  >;
  mappingId: string;
  /** The sheet open: its scope and day. The page keeps them in the URL. */
  scope: DprScope;
  date: string;
  /** A new scope or date was picked. */
  onSheetChange: (next: { scope?: DprScope; date?: string }) => void;
  /** May record progress (the Add action). */
  canRecord: boolean;
  /** May reopen a submitted sheet and record past the backdating limit (the Reopen action). */
  canReopen: boolean;
  /** Written onto the sheet as who prepared it. */
  preparedByName: string;
  /** Write the sheet; resolve true once written (the page reloads the register), false if not. */
  onSave: (request: DprEntrySaveRequest) => Promise<boolean>;
  /** Turn a submitted sheet back into a draft; resolve true once done. */
  onReopen: (existing: DprEntry) => Promise<boolean>;
  /** Defaults to the real today; fixed for a test. */
  today?: string;
}

export function DprEntryView({
  data,
  mappingId,
  scope,
  date,
  onSheetChange,
  canRecord,
  canReopen,
  preparedByName,
  onSave,
  onReopen,
  today: todayProp,
}: DprEntryViewProps) {
  const { boqItems, entries, settings, projectDates, plan, decimalsFor, isLoading, projectName } = data;
  const today = todayProp ?? todayIso();

  const [sheet, setSheet] = useState<SheetState>(() => emptySheet([]));
  /** The sheet as last loaded, so an edit shows "Discard changes" and discarding returns to it. */
  const [baseline, setBaseline] = useState<SheetState>(() => emptySheet([]));
  /** The sheet already filed for this scope and date, if there is one. */
  const [existing, setExisting] = useState<DprEntry | null>(null);
  const [messages, setMessages] = useState<Messages | null>(null);
  /** Set once warnings have been shown: the next Submit goes through ("Submit anyway"). */
  const [confirming, setConfirming] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);

  const scopeItems = useMemo(() => boqItems.filter((item) => item.scope === scope), [boqItems, scope]);
  const itemById = useMemo(() => {
    const map = new Map<string, (typeof boqItems)[number]>();
    for (const item of boqItems) map.set(item.id, item);
    return map;
  }, [boqItems]);

  /** BOQ lines the plan puts work on for this date — what a fresh sheet opens with. */
  const plannedItems = useMemo(
    () => scopeItems.filter((item) => plan.onDate(item.id, date) > 0),
    [scopeItems, plan, date],
  );

  /** Everything counted except this sheet, so "done before" and the BOQ check exclude it. */
  const actualsBefore = useMemo(
    () => indexDprActuals(entries, { excludeEntryId: existing?.id }),
    [entries, existing?.id],
  );

  /**
   * Planned lines whose work was already done before this day — the BOQ quantity reached, or the
   * projection owning the day met early. The plan still spreads quantity on their remaining days,
   * but there is nothing left to record, so a sheet leaves them off.
   */
  const completionFor = useCallback(
    (actuals: DprActualIndex) => {
      const map = new Map<string, DprCompletion>();
      for (const item of plannedItems) {
        const completion = dprCompletionOn({ item, isoDate: date, plan, actuals });
        if (completion) map.set(item.id, completion);
      }
      return map;
    },
    [plannedItems, date, plan],
  );
  const completed = useMemo(() => completionFor(actualsBefore), [completionFor, actualsBefore]);

  const suggestions = useMemo(() => dprSuggestions(entries), [entries]);

  const loadForDate = useCallback(() => {
    const filed = entries.find((entry) => entry.date === date && entry.scope === scope) ?? null;
    setExisting(filed);
    setMessages(null);
    setConfirming(false);
    setShowCompleted(false);
    const done = completionFor(indexDprActuals(entries, { excludeEntryId: filed?.id }));
    let loaded: SheetState;
    if (filed) {
      loaded = sheetFromEntry(filed);
      // A draft opened after one of its lines was finished: a row on it that records no work is
      // left off (it is listed under Already complete instead). Work typed on it, or a remark,
      // keeps the row. A submitted sheet is a record and is shown exactly as filed.
      if (filed.status !== "Submitted") {
        const kept = loaded.rows.filter((row) => !(done.has(row.boqItemId) && recordsNoWork(row)));
        // Every row gone: one blank row, as a fresh sheet with nothing left planned opens with.
        loaded.rows = kept.length > 0 || loaded.rows.length === 0 ? kept : [blankRow()];
      }
    } else {
      // Nothing (left) planned for the day: one blank row rather than an empty table, so the
      // recorder can pick the BOQ line worked and type the actual straight away.
      const open = plannedItems.filter((item) => !done.has(item.id));
      loaded = emptySheet(open.length > 0 ? open.map((item) => blankRow(item.id)) : [blankRow()]);
    }
    setSheet(loaded);
    setBaseline(loaded);
  }, [entries, date, scope, plannedItems, completionFor]);

  // Loading a filed sheet into an editable form is the "sync state from an external system" case
  // effects are for: the register is the source, and a new date or scope must re-seed every field.
  useEffect(() => {
    if (isLoading) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadForDate();
  }, [isLoading, loadForDate]);

  const locked = existing?.status === "Submitted";
  const editable = canRecord && !locked;
  const reopened = !locked && Boolean(existing && (existing.reopenedBy || existing.reopenedAt));
  const statusKey: keyof typeof STATUS_LOOK = locked ? "locked" : reopened ? "reopened" : existing ? "draft" : "new";
  const dirty = useMemo(() => JSON.stringify(sheet) !== JSON.stringify(baseline), [sheet, baseline]);

  /** Every edit drops a pending "Submit anyway": the warnings were about the sheet as it was. */
  const edit = (change: (previous: SheetState) => SheetState) => {
    setConfirming(false);
    setSheet(change);
  };
  const editRow = (id: string, patch: Partial<RowState>) =>
    edit((previous) => ({
      ...previous,
      rows: previous.rows.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    }));
  const editManpower = (id: string, patch: Partial<ManpowerState>) =>
    edit((previous) => ({
      ...previous,
      manpower: previous.manpower.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    }));
  const editEquipment = (id: string, patch: Partial<EquipmentState>) =>
    edit((previous) => ({
      ...previous,
      equipment: previous.equipment.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    }));

  const weatherOptions = useMemo(() => {
    const options = [...settings.weatherOptions];
    // A sheet filed before the list changed keeps its own value selectable.
    if (sheet.weather && !options.some((option) => option.toLowerCase() === sheet.weather.toLowerCase())) {
      options.push(sheet.weather);
    }
    return options;
  }, [settings.weatherOptions, sheet.weather]);

  const enteredCount = sheet.rows.filter((row) => row.actual.trim() !== "").length;
  /** Planned for the day, already finished, and not on the sheet: listed, collapsed, under it. */
  const completedOffSheet = plannedItems.filter(
    (item) => completed.has(item.id) && !sheet.rows.some((row) => row.boqItemId === item.id),
  );
  const openPlannedCount = plannedItems.filter((item) => !completed.has(item.id)).length;
  const headcount = sheet.manpower.reduce((sum, row) => sum + dprNumber(row.count), 0);
  const lostHours = dprNumber(sheet.lostTimeHours);

  /** Today's work per BOQ line across its rows, for the Done / BOQ bar and the BOQ limit. */
  const lineQty = useMemo(() => dprSheetLineQty(sheet.rows), [sheet.rows]);

  /* ── Trade colours ─────────────────────────────────────────────────────────────────────── */

  /**
   * The register's trade order (`dprTradeOrder`, as Reports colours them), then any trade new on
   * this sheet, so a trade keeps its colour while the sheet is typed.
   */
  const tradeOrder = useMemo(() => {
    const order = dprTradeOrder(entries, settings.trades);
    const known = new Set(order.map((trade) => trade.toLowerCase()));
    for (const row of sheet.manpower) {
      const trade = row.trade.trim();
      if (trade && !known.has(trade.toLowerCase())) {
        known.add(trade.toLowerCase());
        order.push(trade);
      }
    }
    return order;
  }, [entries, settings.trades, sheet.manpower]);
  const colourOf = useMemo(() => {
    const slot = new Map(tradeOrder.map((trade, index) => [trade.toLowerCase(), index]));
    return (trade: string): TradeColour => {
      const index = slot.get(trade.trim().toLowerCase());
      return index === undefined ? TRADE_OTHER : (TRADE_SLOTS[index] ?? TRADE_OTHER);
    };
  }, [tradeOrder]);

  /** Headcount by trade for the share bar: named trades with someone on site, in colour order. */
  const share = useMemo(() => {
    const byTrade = new Map<string, { trade: string; count: number }>();
    for (const row of sheet.manpower) {
      const trade = row.trade.trim();
      const count = dprNumber(row.count);
      if (!trade || count <= 0) continue;
      const key = trade.toLowerCase();
      const current = byTrade.get(key);
      if (current) current.count += count;
      else byTrade.set(key, { trade, count });
    }
    const position = new Map(tradeOrder.map((trade, index) => [trade.toLowerCase(), index]));
    return [...byTrade.values()].sort(
      (a, b) => (position.get(a.trade.toLowerCase()) ?? 0) - (position.get(b.trade.toLowerCase()) ?? 0),
    );
  }, [sheet.manpower, tradeOrder]);
  const shareTotal = share.reduce((sum, part) => sum + part.count, 0);

  /* ── Worth checking ────────────────────────────────────────────────────────────────────── */

  const findings = useMemo(
    () =>
      buildDprSheetChecks({
        rows: sheet.rows.map((row) => {
          const item = itemById.get(row.boqItemId);
          return {
            boqItemId: item ? row.boqItemId : "",
            slNo: item?.boqSlNo || item?.erpSlNo || "",
            unit: item?.unit ?? "",
            decimals: decimalsFor(item?.unit ?? ""),
            boqQty: item?.boqQty ?? 0,
            planned: item ? plan.onDate(item.id, date) : 0,
            doneBefore: item ? actualsBefore.total(item.id) : 0,
            actual: row.actual,
            location: row.location,
            agency: row.agency,
          };
        }),
        weather: sheet.weather,
        lostTimeHours: sheet.lostTimeHours,
        lostTimeReason: sheet.lostTimeReason,
        tolerancePct: settings.tolerancePct,
      }),
    [sheet, itemById, decimalsFor, plan, date, actualsBefore, settings.tolerancePct],
  );

  /* ── Saving ────────────────────────────────────────────────────────────────────────────── */

  /** Messages sit just above the bottom bar; bring them into view, wherever Submit was pressed. */
  const showMessages = (next: Messages) => {
    setMessages(next);
    requestAnimationFrame(() => messagesRef.current?.scrollIntoView({ block: "center" }));
  };

  const sheetForCheck = (): DprSheet => ({
    scope,
    date,
    weather: sheet.weather,
    lines: sheet.rows.map((row) => ({
      boqItemId: row.boqItemId,
      actual: row.actual,
      location: row.location,
      remarks: row.remarks,
    })),
    manpower: sheet.manpower.map((row) => ({ trade: row.trade, count: row.count })),
    equipment: sheet.equipment.map((row) => ({
      name: row.name,
      deployed: row.deployed,
      runningHours: row.runningHours,
      idleHours: row.idleHours,
    })),
    lostTimeHours: sheet.lostTimeHours,
    lostTimeReason: sheet.lostTimeReason,
    hindrances: sheet.hindrances,
  });

  const buildDraft = (status: DprStatus): DprEntryDraft => {
    const lines: StoredLine[] = sheet.rows
      .filter((row) => row.boqItemId)
      .map((row) => {
        const item = itemById.get(row.boqItemId);
        const decimals = decimalsFor(item?.unit ?? "");
        return {
          id: row.id,
          boqItemId: row.boqItemId,
          boqSlNo: item?.boqSlNo ?? "",
          erpSlNo: item?.erpSlNo ?? "",
          description: item?.description ?? "",
          unit: item?.unit ?? "",
          // A snapshot of the plan as it stands, so the log can show plan against actual.
          plannedQty: roundToDecimals(plan.onDate(row.boqItemId, date), decimals),
          actualQty: dprNumber(row.actual),
          actualEntered: row.actual.trim() !== "",
          location: row.location.trim(),
          agency: row.agency.trim(),
          remarks: row.remarks.trim(),
        };
      });
    const manpower: DprManpowerLine[] = sheet.manpower
      .filter((row) => row.trade.trim())
      .map((row) => ({ id: row.id, trade: row.trade.trim(), count: dprNumber(row.count) }));
    const equipment: DprEquipmentLine[] = sheet.equipment
      .filter((row) => row.name.trim())
      .map((row) => ({
        id: row.id,
        name: row.name.trim(),
        // Blank means the one unit the row describes.
        deployed: row.deployed.trim() === "" ? 1 : dprNumber(row.deployed),
        runningHours: dprNumber(row.runningHours),
        idleHours: dprNumber(row.idleHours),
      }));
    return {
      scope,
      date,
      status,
      lines,
      manpower,
      equipment,
      weather: sheet.weather.trim(),
      lostTimeHours: dprNumber(sheet.lostTimeHours),
      lostTimeReason: sheet.lostTimeReason.trim(),
      hindrances: sheet.hindrances.trim(),
      remarks: sheet.remarks.trim(),
      preparedByName,
    };
  };

  const handleSave = async (status: "Draft" | "Submitted") => {
    if (!editable || isSaving) return;

    if (!parseIsoDate(date)) {
      showMessages({ errors: ["Pick the date this progress was recorded on."], warnings: [] });
      return;
    }
    if (date > today) {
      showMessages({ errors: ["Future dates cannot be recorded."], warnings: [] });
      return;
    }

    const draft = buildDraft(status);
    if (status === "Submitted") {
      const check = checkDprSheet({
        sheet: sheetForCheck(),
        items: itemById as ReadonlyMap<string, DprBoqLike>,
        plan,
        actuals: actualsBefore,
        settings,
        projectDates,
        today,
        canRecordAnyDate: canReopen,
      });
      // The structural guard catches anything the sheet checks do not word themselves.
      const errors =
        check.errors.length > 0 ? check.errors : validateDprEntry(draft).map((error) => error.message);
      if (errors.length > 0 || (check.warnings.length > 0 && !confirming)) {
        showMessages({ errors, warnings: check.warnings });
        setConfirming(errors.length === 0);
        return;
      }
    }

    setIsSaving(true);
    try {
      const saved = await onSave({ draft, status, existing });
      if (saved) {
        setMessages(null);
        setConfirming(false);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleReopen = async () => {
    if (!existing || !canReopen || isSaving) return;
    setIsSaving(true);
    try {
      await onReopen(existing);
    } finally {
      setIsSaving(false);
    }
  };

  /* ── Render ────────────────────────────────────────────────────────────────────────────── */

  const recordTab = DPR_TABS.find((tab) => tab.key === "record")!;
  const lockedBy = locked
    ? existing?.submittedByName || existing?.updatedByName || existing?.createdByName || ""
    : "";
  const status = STATUS_LOOK[statusKey];
  const sheetDay = displayDate(date);
  const noLocations = settings.locations.length === 0;
  const noAgencies = settings.agencies.length === 0;

  const barText = locked
    ? `This sheet is submitted and locked${lockedBy ? ` (by ${lockedBy})` : ""}. Only a DPR approver can reopen it.`
    : !canRecord
      ? "Read only — you can see this sheet but not record against it."
      : statusKey === "reopened"
        ? "Reopened for editing — resubmit when done."
        : statusKey === "draft"
          ? "A draft — it counts in progress only once it is submitted."
          : "Not filed yet — save a draft, or submit when the day is complete.";

  return (
    <DprPageShell>
      <DprReportsHero
        mappingId={mappingId}
        projectName={projectName}
        title={existing ? "Edit daily progress" : "Record progress"}
        description="One sheet per scope per day: what was planned, what was done, and the site diary behind it."
        icon={recordTab.icon}
        band="violet"
        actions={
          <span
            className="inline-flex max-w-full items-center gap-2 rounded-xl border border-white/30 bg-white/10 px-3.5 py-2 text-sm font-extrabold backdrop-blur"
            title={locked ? "Submitted and locked" : existing ? "A draft, open for editing" : "Not filed yet"}
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={
                locked
                  ? { backgroundColor: "#34d399", boxShadow: "0 0 0 4px rgba(52, 211, 153, 0.25)" }
                  : { backgroundColor: "#fbbf24", boxShadow: "0 0 0 4px rgba(251, 191, 36, 0.25)" }
              }
              aria-hidden="true"
            />
            <span className="truncate tabular-nums">
              {scope}
              {sheetDay ? ` · ${sheetDay}` : ""}
            </span>
          </span>
        }
      />

      {!canRecord ? (
        <DprReportCallout tone="warning" title="Read only">
          You can read this register but not record against it. Ask for the Add action on{" "}
          {DPR_PERMISSION_RESOURCE}.
        </DprReportCallout>
      ) : null}

      {/* ── The four tiles ───────────────────────────────────────────────────────────────── */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,.8fr)_minmax(0,.9fr)_minmax(0,1.3fr)_minmax(0,1.3fr)]">
        <SheetTile icon={Layers} colours={["#c4b5fd", "#7c3aed"]} label="Scope" htmlFor="dpr-scope">
          <Select value={scope} onValueChange={(next) => onSheetChange({ scope: next as DprScope })}>
            <SelectTrigger id="dpr-scope" className="rounded-xl text-left font-bold">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DPR_SCOPES.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SheetTile>

        <SheetTile icon={CalendarDays} colours={["#93c5fd", "#2563eb"]} label="Date" htmlFor="dpr-date">
          <Input
            id="dpr-date"
            type="date"
            className="rounded-xl font-bold"
            value={date}
            max={today}
            onChange={(event) => onSheetChange({ date: event.target.value })}
          />
        </SheetTile>

        <SheetTile
          icon={CloudSun}
          colours={["#7dd3fc", "#0284c7"]}
          labelId="dpr-weather-label"
          label={
            <>
              Weather <span className="font-semibold text-muted-foreground/80">(optional)</span>
            </>
          }
          info={
            <InfoTip label="About “Weather”">
              Optional. Chosen from a fixed list, set under Daily Progress › Settings. Worth recording
              on a day with time lost: it backs a delay or hindrance later. Press the chosen one again
              to clear it.
            </InfoTip>
          }
        >
          {weatherOptions.length === 0 ? (
            <p className="flex h-[var(--control-h,2.5rem)] items-center text-xs text-muted-foreground">
              No weather options are set up in Daily Progress › Settings.
            </p>
          ) : (
            // Four across; a longer list wraps onto further rows of four.
            <div
              role="group"
              aria-labelledby="dpr-weather-label"
              className="grid gap-[5px]"
              style={{ gridTemplateColumns: `repeat(${Math.min(4, weatherOptions.length)}, minmax(0, 1fr))` }}
            >
              {weatherOptions.map((option) => {
                const look = weatherLook(option);
                const on = sheet.weather.toLowerCase() === option.toLowerCase();
                return (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={on}
                    disabled={!editable}
                    title={on && editable ? `${option} — press again to clear` : option}
                    onClick={() => edit((previous) => ({ ...previous, weather: on ? "" : option }))}
                    className={cn(
                      "flex h-[var(--control-h,2.5rem)] min-w-0 items-center justify-center gap-[5px] rounded-[11px] border px-1 text-xs font-extrabold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed",
                      on
                        ? "keep-light border-transparent text-white shadow-sm"
                        : "border-border/60 bg-background text-muted-foreground hover:text-foreground disabled:opacity-60",
                    )}
                    style={
                      on ? { backgroundImage: `linear-gradient(135deg, ${look.colours[0]}, ${look.colours[1]})` } : undefined
                    }
                  >
                    <look.icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{option}</span>
                  </button>
                );
              })}
            </div>
          )}
        </SheetTile>

        <SheetTile icon={CheckCircle2} colours={["#6ee7b7", "#059669"]} label="Status">
          <div
            className="flex h-[var(--control-h,2.5rem)] min-w-0 items-center gap-2.5"
            title={lockedBy ? `Submitted by ${lockedBy}` : undefined}
          >
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-xs font-extrabold",
                status.chip,
              )}
            >
              <span className="h-[7px] w-[7px] rounded-full bg-current" aria-hidden="true" />
              {status.label}
            </span>
            {locked ? (
              <small className="flex min-w-0 items-center gap-1 text-[11px] font-semibold text-muted-foreground">
                <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="truncate" title="Only a DPR approver can reopen this sheet.">
                  Only a DPR approver can reopen this sheet.
                </span>
              </small>
            ) : null}
          </div>
        </SheetTile>
      </section>

      {/* ── Work done ──────────────────────────────────────────────────────────────────────── */}
      <SheetCard
        tint="emerald"
        icon={ClipboardList}
        colours={["#6ee7b7", "#059669"]}
        title="Work done"
        subtitle={`${sheet.rows.length} line${sheet.rows.length === 1 ? "" : "s"}, ${enteredCount} with a quantity entered`}
        info={<InfoTip label="About “Work done”">{WORK_DONE_HELP}</InfoTip>}
        aside={
          <DprReportPill tone="success">
            {enteredCount} / {sheet.rows.length} filled
          </DprReportPill>
        }
      >
        {scopeItems.length === 0 ? (
          <PmEmptyState
            icon={ClipboardList}
            title={`No ${scope} BOQ lines on this project`}
            description={`BOQ items are read as ${scope} when their Scope 2 column says so. Import or tag them first.`}
          />
        ) : (
          <fieldset disabled={!editable} className="min-w-0">
            {plannedItems.length === 0 && !existing ? (
              <p className="border-b border-border/60 bg-muted/30 px-4 py-2 text-xs text-muted-foreground sm:px-[18px]">
                Nothing is planned for {scope} on this date. Record what was actually done — a
                projection is a reference, not a precondition. Plans are set in{" "}
                <Link
                  href={dprHref(`${DPR_BASE_PATH}/targets`, mappingId)}
                  className="underline underline-offset-2"
                >
                  Projections
                </Link>
                .
              </p>
            ) : null}
            {plannedItems.length > 0 && openPlannedCount === 0 && !locked ? (
              <p className="border-b border-border/60 bg-muted/30 px-4 py-2 text-xs text-muted-foreground sm:px-[18px]">
                Everything planned for {scope} on this date was already finished before it — see
                Already complete below. Record anything else that was done.
              </p>
            ) : null}
            {/* One line per BOQ line, all of it inside the table: fixed columns (the same first
                five as Already complete below), a bounded height under a pinned header, and a
                narrow screen scrolls it sideways. */}
            <Table stickyHeader containerClassName="max-h-[65vh]" className="min-w-[1252px] table-fixed">
              <colgroup>
                <col className="w-[72px]" />
                <col />
                <col className="w-[76px]" />
                <col className="w-[100px]" />
                <col className="w-[150px]" />
                <col className="w-[120px]" />
                <col className="w-[150px]" />
                <col className="w-[150px]" />
                <col className="w-[150px]" />
                <col className="w-[48px]" />
              </colgroup>
              <TableHeader>
                <TableRow>
                  <TableHead className="truncate">SL No</TableHead>
                  <TableHead className="truncate">BOQ line</TableHead>
                  <TableHead className="truncate">Unit</TableHead>
                  <TableHead className="truncate text-right" title="Planned for this day, from Projections">
                    Planned
                  </TableHead>
                  <TableHead
                    className="truncate text-right"
                    title="Submitted before this sheet, of the BOQ quantity; the bar adds today"
                  >
                    Done / BOQ
                  </TableHead>
                  <TableHead className="truncate text-right">Actual</TableHead>
                  <TableHead className="truncate">Location</TableHead>
                  <TableHead className="truncate">Agency</TableHead>
                  <TableHead className="truncate">Remarks</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">Remove</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sheet.rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="py-8 text-center text-sm text-muted-foreground">
                      No lines yet. Add the BOQ lines worked on this day.
                    </TableCell>
                  </TableRow>
                ) : (
                  sheet.rows.map((row, index) => {
                    const item = itemById.get(row.boqItemId);
                    const decimals = decimalsFor(item?.unit ?? "");
                    const planned = row.boqItemId ? plan.onDate(row.boqItemId, date) : 0;
                    const doneBefore = row.boqItemId ? actualsBefore.total(row.boqItemId) : 0;
                    const label = item?.boqSlNo || `row ${index + 1}`;
                    const standing = item
                      ? dprSheetBoqState({
                          boqQty: item.boqQty,
                          doneBefore,
                          sheetQty: lineQty.get(item.id) ?? 0,
                          tolerancePct: settings.tolerancePct,
                        })
                      : null;
                    const typed = row.actual.replace(/,/g, "").trim();
                    const typedValue = typed === "" ? null : Number(typed);
                    const notAQuantity =
                      typedValue !== null && (!Number.isFinite(typedValue) || typedValue < 0);
                    // Rose only on a row that adds to the line, when the line would pass its limit.
                    const pastLimit = Boolean(standing?.overLimit) && (typedValue ?? 0) > 0;
                    const actualNote = pastLimit
                      ? `Above BOQ — tolerance ${settings.tolerancePct}%`
                      : notAQuantity
                        ? "Not a quantity: a number, zero or more"
                        : undefined;
                    const withToday = standing
                      ? standing.withTodayPct >= 100 - 1e-9
                        ? Math.round(standing.withTodayPct)
                        : Math.min(99, Math.round(standing.withTodayPct))
                      : 0;
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="truncate py-1.5">
                          {item ? (
                            <DprSlNoPill slNo={item.boqSlNo} seed={item.id} />
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="py-1.5">
                          {/* A sub-item sits indented by its depth, its parents in the tooltip. */}
                          <div
                            className="flex min-w-0 items-center gap-1"
                            style={(item?.depth ?? 0) > 0 ? { paddingLeft: (item?.depth ?? 0) * 16 } : undefined}
                            title={item?.path ? breakdownTitle(item) : undefined}
                          >
                            {(item?.depth ?? 0) > 0 ? <DprBranchMark /> : null}
                            <div className="min-w-0 flex-1">
                              <DprBoqPicker
                                compact
                                showSlNo={false}
                                items={scopeItems}
                                value={row.boqItemId}
                                disabled={!editable}
                                ariaLabel={`BOQ line for ${label}`}
                                onChange={(boqItemId) => editRow(row.id, { boqItemId })}
                              />
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="truncate text-sm" title={item?.unit}>
                          {item?.unit || "—"}
                        </TableCell>
                        <TableCell className="truncate text-right text-sm tabular-nums">
                          {planned > 0 ? (
                            formatQtyAt(planned, decimals)
                          ) : (
                            <span className="font-extrabold text-muted-foreground/50">—</span>
                          )}
                        </TableCell>
                        <TableCell
                          className="py-1.5 text-right"
                          title={
                            item && item.boqQty > 0
                              ? `${formatQtyAt(doneBefore, decimals)} of ${formatQtyAt(item.boqQty, decimals)} ${item.unit} before this sheet${
                                  standing ? `; ${formatQtyAt(standing.total, decimals)} with today` : ""
                                }`
                              : undefined
                          }
                        >
                          {item ? (
                            // Figure, bar and share stacked inside the height of the row's inputs,
                            // so the row stays one line tall.
                            <div className="flex min-w-0 flex-col items-end gap-px">
                              <span className="max-w-full truncate text-[12.5px] font-bold leading-[14px] tabular-nums">
                                {formatQtyAt(doneBefore, decimals)}
                                {item.boqQty > 0 ? (
                                  <span className="text-muted-foreground"> / {formatQtyAt(item.boqQty, decimals)}</span>
                                ) : null}
                              </span>
                              {standing ? (
                                <>
                                  <span className="relative h-1 w-20 max-w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
                                    <i
                                      className="absolute inset-y-0 left-0 rounded-full"
                                      style={{ width: `${standing.beforePct}%`, backgroundColor: "#94a3b8" }}
                                    />
                                    <i
                                      className="absolute inset-y-0 rounded-full"
                                      style={{
                                        left: `${standing.beforePct}%`,
                                        width: `${Math.max(0, Math.min(100, standing.withTodayPct) - standing.beforePct)}%`,
                                        backgroundImage: "linear-gradient(90deg, #34d399, #059669)",
                                      }}
                                    />
                                  </span>
                                  <span
                                    className={cn(
                                      "max-w-full truncate text-[10px] font-extrabold leading-[11px]",
                                      standing.overBoq ? "text-rose-600" : "text-emerald-700",
                                    )}
                                  >
                                    {standing.overBoq ? "Over BOQ" : `→ ${withToday}% with today`}
                                  </span>
                                </>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-sm text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="py-1.5">
                          <Input
                            type="number"
                            min={0}
                            step={decimals === 0 ? "1" : "0.001"}
                            inputMode={decimals === 0 ? "numeric" : "decimal"}
                            placeholder="0"
                            aria-label={`Actual quantity for ${label}`}
                            aria-invalid={pastLimit || notAQuantity || undefined}
                            title={actualNote}
                            className={cn(
                              "h-8 w-full min-w-0 rounded-[10px] border-[1.5px] text-right text-sm font-extrabold tabular-nums",
                              pastLimit || notAQuantity
                                ? "border-rose-200 bg-rose-50 text-rose-700 disabled:opacity-100"
                                : typedValue !== null
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700 disabled:opacity-100"
                                  : "",
                            )}
                            value={row.actual}
                            onChange={(event) => editRow(row.id, { actual: event.target.value })}
                          />
                          {actualNote ? <span className="sr-only">{actualNote}</span> : null}
                        </TableCell>
                        <TableCell className="py-1.5">
                          <ConfiguredListPick
                            value={row.location}
                            options={settings.locations}
                            disabled={!editable}
                            placeholder="Choose a location"
                            ariaLabel={`Location for ${label}`}
                            fallbackListId="dpr-locations"
                            onChange={(location) => editRow(row.id, { location })}
                          />
                        </TableCell>
                        <TableCell className="py-1.5">
                          <ConfiguredListPick
                            value={row.agency}
                            options={settings.agencies}
                            disabled={!editable}
                            placeholder="Choose an agency"
                            ariaLabel={`Agency for ${label}`}
                            fallbackListId="dpr-agencies"
                            onChange={(agency) => editRow(row.id, { agency })}
                          />
                        </TableCell>
                        <TableCell className="py-1.5">
                          <Input
                            className="h-8 w-full min-w-0"
                            placeholder="Note"
                            aria-label={`Remarks for ${label}`}
                            value={row.remarks}
                            onChange={(event) => editRow(row.id, { remarks: event.target.value })}
                          />
                        </TableCell>
                        <TableCell className="py-1.5 text-right">
                          {editable ? (
                            <RemoveButton
                              label={`Remove ${label}`}
                              onClick={() =>
                                edit((previous) => ({
                                  ...previous,
                                  rows: previous.rows.filter((candidate) => candidate.id !== row.id),
                                }))
                              }
                            />
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
            {editable && (noLocations || noAgencies) ? (
              <p className="border-t border-border/60 px-4 py-2 text-[11.5px] font-semibold text-muted-foreground sm:px-[18px]">
                {noLocations && noAgencies
                  ? "No locations or agencies are"
                  : noLocations
                    ? "No locations are"
                    : "No agencies are"}{" "}
                set up in{" "}
                <Link
                  href={dprHref(`${DPR_BASE_PATH}/settings`, mappingId)}
                  className="underline underline-offset-2"
                >
                  Daily Progress › Settings
                </Link>{" "}
                yet, so {noLocations && noAgencies ? "both are" : "it is"} typed here, with the values
                used on earlier sheets suggested.
              </p>
            ) : null}
            {editable && completedOffSheet.length > 0 ? (
              <DprCompletedLines
                items={completedOffSheet}
                completed={completed}
                open={showCompleted}
                onToggle={() => setShowCompleted((value) => !value)}
                planned={(id) => plan.onDate(id, date)}
                doneBefore={(id) => actualsBefore.total(id)}
                decimalsFor={decimalsFor}
                onAdd={(boqItemId) =>
                  edit((previous) => ({
                    ...previous,
                    // The blank row a fresh sheet opens with makes way for the line added back.
                    rows: [
                      ...previous.rows.filter((row) => row.boqItemId || !isUntouchedRow(row)),
                      blankRow(boqItemId),
                    ],
                  }))
                }
              />
            ) : null}
            {editable ? (
              <div className="border-t border-border/60 bg-muted/20 px-4 py-3 sm:px-[18px]">
                <AddButton
                  tone="emerald"
                  onClick={() => edit((previous) => ({ ...previous, rows: [...previous.rows, blankRow()] }))}
                >
                  Add BOQ line
                </AddButton>
              </div>
            ) : null}
          </fieldset>
        )}
      </SheetCard>

      {/* ── Manpower and plant ─────────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <SheetCard
          tint="blue"
          icon={Users}
          colours={["#93c5fd", "#2563eb"]}
          title="Manpower"
          subtitle="Headcount by trade"
          info={
            <InfoTip label="About “Manpower”">
              Headcount by trade. Required when any work is recorded; each headcount is a whole number
              above zero. A trade keeps the colour it has on the Reports screen.
            </InfoTip>
          }
          aside={
            <span className="whitespace-nowrap rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-extrabold tabular-nums text-blue-700">
              {formatQty(headcount)} on site
            </span>
          }
        >
          {shareTotal > 0 ? (
            <div className="px-4 pt-3.5 sm:px-[18px]">
              <div
                className="flex h-3 overflow-hidden rounded-full bg-muted"
                role="img"
                aria-label={`Headcount by trade: ${share
                  .map((part) => `${part.trade} ${formatQty(part.count)}`)
                  .join(", ")}`}
              >
                {share.map((part) => (
                  <i
                    key={part.trade}
                    className="block h-full"
                    style={{ width: `${(part.count / shareTotal) * 100}%`, backgroundColor: colourOf(part.trade).light }}
                    title={`${part.trade}: ${formatQty(part.count)}`}
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-3.5 gap-y-1 pb-3 pt-1.5 text-xs font-bold text-muted-foreground">
                {share.map((part) => (
                  <span key={part.trade} className="flex min-w-0 items-center gap-1.5">
                    <i
                      className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                      style={{ backgroundColor: colourOf(part.trade).light }}
                      aria-hidden="true"
                    />
                    <span className="truncate">
                      {part.trade} {formatQty(part.count)} · {Math.round((part.count / shareTotal) * 100)}%
                    </span>
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          <fieldset disabled={!editable} className="min-w-0">
            {sheet.manpower.length === 0 ? (
              <DprReportZero
                icon={Users}
                colours={["#93c5fd", "#2563eb"]}
                glow={["rgba(147, 197, 253, 0.55)", "rgba(196, 181, 253, 0.45)"]}
                title="No manpower recorded"
                text={editable ? "Add the trades on site today." : "None was recorded on this sheet."}
              />
            ) : (
              <div className={cn("max-h-[40vh] overflow-y-auto", shareTotal > 0 && "border-t border-border/40")}>
                {sheet.manpower.map((row, index) => {
                  const colour = colourOf(row.trade);
                  const TradeIcon = tradeIcon(row.trade);
                  return (
                    <div
                      key={row.id}
                      className="grid grid-cols-[minmax(0,1fr)_7.5rem_2rem] items-center gap-2.5 border-b border-border/40 px-4 py-2.5 last:border-b-0 sm:px-[18px]"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span
                          className="keep-light flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] text-white"
                          style={{ backgroundImage: `linear-gradient(135deg, ${colour.card[0]}, ${colour.card[1]})` }}
                          aria-hidden="true"
                        >
                          <TradeIcon className="h-[17px] w-[17px]" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <ConfiguredListPick
                            className="h-9 font-semibold"
                            value={row.trade}
                            options={settings.trades}
                            disabled={!editable}
                            placeholder="Choose a trade"
                            ariaLabel={`Trade, row ${index + 1}`}
                            onChange={(trade) => editManpower(row.id, { trade })}
                          />
                        </div>
                      </div>
                      <Stepper
                        value={row.count}
                        colour={colour.light}
                        ariaLabel={`Headcount, row ${index + 1}`}
                        onChange={(count) => editManpower(row.id, { count })}
                      />
                      {editable ? (
                        <RemoveButton
                          label={`Remove trade, row ${index + 1}`}
                          onClick={() =>
                            edit((previous) => ({
                              ...previous,
                              manpower: previous.manpower.filter((candidate) => candidate.id !== row.id),
                            }))
                          }
                        />
                      ) : (
                        <span aria-hidden="true" />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {editable ? (
              <div className="border-t border-border/60 bg-muted/20 px-4 py-3 sm:px-[18px]">
                <AddButton
                  tone="blue"
                  onClick={() =>
                    edit((previous) => ({
                      ...previous,
                      manpower: [...previous.manpower, { id: nanoid(), trade: "", count: "" }],
                    }))
                  }
                >
                  Add trade
                </AddButton>
              </div>
            ) : null}
          </fieldset>
        </SheetCard>

        <SheetCard
          tint="amber"
          icon={Truck}
          colours={["#fcd34d", "#d97706"]}
          title="Plant and equipment"
          subtitle="Machines on site and the hours they worked"
          info={
            <InfoTip label="About “Plant and equipment”">
              What was on site and how long it worked. Running and idle hours together cannot exceed
              24 a day for each unit deployed. A blank number deployed counts as one.
            </InfoTip>
          }
          aside={<DprReportPill tone="warning">{sheet.equipment.length} recorded</DprReportPill>}
        >
          <fieldset disabled={!editable} className="min-w-0">
            {sheet.equipment.length === 0 ? (
              <DprReportZero
                icon={Truck}
                colours={["#fcd34d", "#d97706"]}
                glow={["rgba(253, 230, 138, 0.6)", "rgba(254, 215, 170, 0.5)"]}
                title="No plant recorded"
                text={editable ? "Equipment used today appears here." : "None was recorded on this sheet."}
              />
            ) : (
              <>
                {/* Column names from sm up; a phone labels each figure under the equipment instead. */}
                <div className="hidden grid-cols-[minmax(0,1fr)_6.5rem_4.75rem_4.75rem_2rem] gap-2 border-b border-border/40 bg-muted/30 px-4 py-2 text-[10.5px] font-extrabold uppercase tracking-wide text-muted-foreground sm:grid sm:px-[18px]">
                  <span className="truncate">Equipment</span>
                  <span className="truncate text-center">Nos</span>
                  <span className="truncate text-right">Running hrs</span>
                  <span className="truncate text-right">Idle hrs</span>
                  <span />
                </div>
                <div className="max-h-[40vh] overflow-y-auto">
                  {sheet.equipment.map((row, index) => {
                    const colours = PLANT_COLOURS[index % PLANT_COLOURS.length];
                    return (
                      <div
                        key={row.id}
                        className="grid grid-cols-[minmax(0,1fr)_2rem] items-center gap-2 border-b border-border/40 px-4 py-2.5 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_6.5rem_4.75rem_4.75rem_2rem] sm:px-[18px]"
                      >
                        <div className="order-1 flex min-w-0 items-center gap-2.5 sm:order-none">
                          <span
                            className="keep-light flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] text-white"
                            style={{ backgroundImage: `linear-gradient(135deg, ${colours[0]}, ${colours[1]})` }}
                            aria-hidden="true"
                          >
                            <Truck className="h-[17px] w-[17px]" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <ConfiguredListPick
                              className="h-9 font-semibold"
                              value={row.name}
                              options={settings.equipmentTypes}
                              disabled={!editable}
                              placeholder="Choose equipment"
                              ariaLabel={`Equipment, row ${index + 1}`}
                              onChange={(name) => editEquipment(row.id, { name })}
                            />
                          </div>
                        </div>
                        <div className="order-3 col-span-2 grid grid-cols-[6.5rem_minmax(0,1fr)_minmax(0,1fr)] gap-2 sm:contents">
                          <div className="min-w-0">
                            <span className="mb-1 block text-[10.5px] font-bold text-muted-foreground sm:hidden">Nos</span>
                            <Stepper
                              value={row.deployed}
                              colour={colours[1]}
                              placeholder="1"
                              ariaLabel={`Number deployed, row ${index + 1}`}
                              onChange={(deployed) => editEquipment(row.id, { deployed })}
                            />
                          </div>
                          <div className="min-w-0">
                            <span className="mb-1 block text-[10.5px] font-bold text-muted-foreground sm:hidden">Running hrs</span>
                            <Input
                              type="number"
                              min={0}
                              step="0.5"
                              inputMode="decimal"
                              placeholder="0"
                              aria-label={`Running hours, row ${index + 1}`}
                              className="h-9 w-full min-w-0 rounded-xl text-right font-bold tabular-nums"
                              value={row.runningHours}
                              onChange={(event) => editEquipment(row.id, { runningHours: event.target.value })}
                            />
                          </div>
                          <div className="min-w-0">
                            <span className="mb-1 block text-[10.5px] font-bold text-muted-foreground sm:hidden">Idle hrs</span>
                            <Input
                              type="number"
                              min={0}
                              step="0.5"
                              inputMode="decimal"
                              placeholder="0"
                              aria-label={`Idle hours, row ${index + 1}`}
                              className="h-9 w-full min-w-0 rounded-xl text-right font-bold tabular-nums"
                              value={row.idleHours}
                              onChange={(event) => editEquipment(row.id, { idleHours: event.target.value })}
                            />
                          </div>
                        </div>
                        <div className="order-2 sm:order-none">
                          {editable ? (
                            <RemoveButton
                              label={`Remove equipment, row ${index + 1}`}
                              onClick={() =>
                                edit((previous) => ({
                                  ...previous,
                                  equipment: previous.equipment.filter((candidate) => candidate.id !== row.id),
                                }))
                              }
                            />
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
            {editable ? (
              <div className="border-t border-border/60 bg-muted/20 px-4 py-3 sm:px-[18px]">
                <AddButton
                  tone="amber"
                  onClick={() =>
                    edit((previous) => ({
                      ...previous,
                      equipment: [
                        ...previous.equipment,
                        { id: nanoid(), name: "", deployed: "1", runningHours: "", idleHours: "" },
                      ],
                    }))
                  }
                >
                  Add equipment
                </AddButton>
              </div>
            ) : null}
          </fieldset>
        </SheetCard>
      </div>

      {/* ── Lost time, hindrances and remarks ──────────────────────────────────────────────── */}
      <SheetCard
        tint="rose"
        icon={Clock}
        colours={["#fda4af", "#e11d48"]}
        title="Lost time, hindrances and remarks"
        subtitle="The site diary for the day"
        info={
          <InfoTip label="About “Lost time, hindrances and remarks”">
            The basis for any delay the day caused. Time lost above zero needs a reason; a planned line
            left at zero needs a row remark or a hindrance.
          </InfoTip>
        }
        aside={<DprReportPill tone="danger">{formatQty(lostHours)} hrs lost</DprReportPill>}
      >
        <fieldset disabled={!editable} className="min-w-0">
          {/* Time lost and its reason, then hindrances and remarks: one row on a wide screen. */}
          <div className="grid grid-cols-1 gap-3.5 p-4 sm:px-[18px] md:grid-cols-2 xl:grid-cols-[12.5rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <div className="min-w-0 space-y-1.5">
              <DprFieldLabel htmlFor="dpr-lost-hours" accent={{ colour: "#e11d48", icon: Clock }}>
                Time lost <span className="font-semibold text-muted-foreground/80">(hrs, max {settings.shiftHours})</span>
              </DprFieldLabel>
              <Input
                id="dpr-lost-hours"
                type="number"
                min={0}
                max={settings.shiftHours}
                step="0.5"
                inputMode="decimal"
                placeholder="0"
                className="rounded-xl font-bold"
                value={sheet.lostTimeHours}
                onChange={(event) => edit((previous) => ({ ...previous, lostTimeHours: event.target.value }))}
              />
              {/* One segment per shift hour, filled up to the time lost. */}
              <div className="flex gap-1 pt-0.5" aria-hidden="true">
                {Array.from({ length: Math.min(24, Math.max(1, Math.ceil(settings.shiftHours))) }, (_, hour) => (
                  <i
                    key={hour}
                    className={cn("h-2 flex-1 rounded-[3px]", hour < lostHours ? "" : "bg-muted")}
                    style={hour < lostHours ? { backgroundImage: "linear-gradient(90deg, #fb7185, #e11d48)" } : undefined}
                  />
                ))}
              </div>
            </div>
            <div className="min-w-0 space-y-1.5">
              <DprFieldLabel htmlFor="dpr-lost-reason" accent={{ colour: "#d97706", icon: AlertCircle }}>
                Reason
              </DprFieldLabel>
              <Input
                id="dpr-lost-reason"
                placeholder="Rain, power failure, material shortage…"
                className="rounded-xl font-semibold"
                value={sheet.lostTimeReason}
                onChange={(event) => edit((previous) => ({ ...previous, lostTimeReason: event.target.value }))}
              />
            </div>
            <div className="min-w-0 space-y-1.5">
              <DprFieldLabel htmlFor="dpr-hindrances" accent={{ colour: "#ea580c", icon: AlertTriangle }}>
                Hindrances
              </DprFieldLabel>
              <Textarea
                id="dpr-hindrances"
                rows={3}
                placeholder="Blockers raised today and who they sit with."
                className="rounded-xl font-semibold"
                value={sheet.hindrances}
                onChange={(event) => edit((previous) => ({ ...previous, hindrances: event.target.value }))}
              />
              <p className="text-right text-[11px] font-bold tabular-nums text-muted-foreground">
                {sheet.hindrances.length} char{sheet.hindrances.length === 1 ? "" : "s"}
              </p>
            </div>
            <div className="min-w-0 space-y-1.5">
              <DprFieldLabel htmlFor="dpr-remarks" accent={{ colour: "#7c3aed", icon: MessageSquare }}>
                Remarks
              </DprFieldLabel>
              <Textarea
                id="dpr-remarks"
                rows={3}
                placeholder="Anything else the day should be remembered by."
                className="rounded-xl font-semibold"
                value={sheet.remarks}
                onChange={(event) => edit((previous) => ({ ...previous, remarks: event.target.value }))}
              />
              <p className="text-right text-[11px] font-bold tabular-nums text-muted-foreground">
                {sheet.remarks.length} char{sheet.remarks.length === 1 ? "" : "s"}
              </p>
            </div>
          </div>
        </fieldset>
      </SheetCard>

      {/* ── Worth checking ─────────────────────────────────────────────────────────────────── */}
      <SheetCard
        tint="amber"
        icon={AlertTriangle}
        colours={["#fcd34d", "#d97706"]}
        title="Worth checking on this sheet"
        subtitle="From the entries above. Hints only: what stops a submit is listed when you submit."
      >
        <div className="grid grid-cols-1 gap-3 p-4 sm:px-[18px] md:grid-cols-3">
          {findings.map((finding) => (
            <DprReportCallout key={finding.key} tone={finding.tone} title={finding.title} mark={finding.mark}>
              {finding.detail}
            </DprReportCallout>
          ))}
        </div>
      </SheetCard>

      {/* What blocks a submit, then what needs a second look — just above the bar that submits. */}
      <div ref={messagesRef}>
        {messages ? (
          <DprMessages
            errors={messages.errors}
            warnings={messages.warnings}
            errorTitle="Fix these before submitting"
            warningTitle={
              messages.errors.length > 0 ? "Also check" : "Check these, then press “Submit anyway”"
            }
          />
        ) : null}
      </div>

      {/* ── The sheet's actions, pinned to the bottom ─────────────────────────────────────── */}
      {/* The tint sits on an opaque card: in dark mode the tint is translucent, and the page
          scrolls underneath the bar. The phone tab bar steps aside for a page's own bottom bar. */}
      <div data-floating-nav="hide" className="sticky bottom-3 z-10 rounded-2xl bg-card shadow-lg">
        <div
          className={cn(
            "flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 font-bold",
            locked ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900",
          )}
        >
          <DprGradientChip
            icon={locked ? Lock : LockOpen}
            colours={locked ? ["#34d399", "#059669"] : ["#fbbf24", "#d97706"]}
            className="h-[34px] w-[34px] rounded-[11px]"
            iconClassName="h-4 w-4"
          />
          <span className="min-w-0 flex-1 basis-[14rem] text-sm">
            {barText}
            {editable && dirty ? <span className="ml-1.5 font-extrabold">Unsaved changes.</span> : null}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {locked ? (
              canReopen ? (
                <Button
                  className="keep-light rounded-[11px] font-extrabold text-white shadow-md hover:brightness-105"
                  style={{ backgroundImage: "linear-gradient(135deg, #fbbf24, #d97706)" }}
                  disabled={isSaving}
                  onClick={() => void handleReopen()}
                >
                  {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Unlock className="mr-2 h-4 w-4" />}
                  Reopen (approver)
                </Button>
              ) : null
            ) : (
              <>
                {editable && dirty ? (
                  <Button
                    variant="outline"
                    className="rounded-[11px] font-extrabold"
                    disabled={isSaving}
                    onClick={() => loadForDate()}
                  >
                    <RotateCcw className="mr-2 h-4 w-4" /> Discard changes
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  className="rounded-[11px] font-extrabold"
                  disabled={!canRecord || isSaving || isLoading}
                  onClick={() => void handleSave("Draft")}
                >
                  Save draft
                </Button>
                <Button
                  className="keep-light rounded-[11px] font-extrabold text-white shadow-md hover:brightness-105"
                  style={{ backgroundImage: "linear-gradient(135deg, #34d399, #059669)" }}
                  disabled={!canRecord || isSaving || isLoading}
                  onClick={() => void handleSave("Submitted")}
                >
                  {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                  {confirming ? "Submit anyway" : "Submit"}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Values already used on this project's sheets, offered as the recorder types. */}
      <datalist id="dpr-locations">
        {suggestions.locations.map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>
      <datalist id="dpr-agencies">
        {suggestions.agencies.map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>
    </DprPageShell>
  );
}

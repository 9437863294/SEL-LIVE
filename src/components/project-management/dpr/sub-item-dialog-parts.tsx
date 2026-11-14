"use client";

/**
 * The parts both sub-item dialogs share: the header with its icon, the card naming the line the
 * sub-items go under, the share-of-parent bar, and an input with its unit written inside it.
 *
 * The bar shows what the engine (`effectiveWeights`) will actually use, so a blank share reads as
 * the part it really gets: by quantity when every part is in the parent's unit, equally otherwise.
 */

import type { ComponentProps, ReactNode } from "react";
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatPct } from "@/components/project-management/dpr/dpr-shell";
import { cn } from "@/lib/utils";

/** One colour per new sub-item, in order. Explicit hex: the chart tokens are dark-only. */
export const SUB_ITEM_COLOURS = [
  "#7c3aed",
  "#2563eb",
  "#059669",
  "#d97706",
  "#db2777",
  "#0891b2",
  "#65a30d",
  "#9333ea",
] as const;
/** Sub-items already saved under the parent, so the new ones stand out beside them. */
const EXISTING_COLOURS = ["#94a3b8", "#64748b"] as const;

export const subItemColour = (index: number) => SUB_ITEM_COLOURS[index % SUB_ITEM_COLOURS.length];

/** "" → null (blank); otherwise the number, NaN when it is not one. */
export const readNumberText = (text: string): number | null => {
  const trimmed = text.replace(/,/g, "").trim();
  return trimmed === "" ? null : Number(trimmed);
};

/** Ctrl + Enter (⌘ + Enter on a Mac) submits, from any field. */
export const isSubmitChord = (event: { key: string; ctrlKey: boolean; metaKey: boolean }) =>
  event.key === "Enter" && (event.ctrlKey || event.metaKey);

/** Flush sections: the header, body and footer draw their own padding and dividers. */
export const SUB_ITEM_DIALOG_CLASS = "gap-0 p-0";
/** The frame reserves a scrollbar gutter on both edges by default, which would show beside the flush footer. */
export const SUB_ITEM_DIALOG_STYLE = { scrollbarGutter: "auto" } as const;

export function SubItemDialogHeader({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: ReactNode;
  description: ReactNode;
}) {
  return (
    // Own padding beats the frame's blanket 4rem for the window buttons: only the title's line
    // reaches up beside the × (and, from sm up, maximise / minimise), so only the title clears them.
    <DialogHeader className="shrink-0 border-b border-border/60 px-5 pb-3.5 pt-5 text-left sm:px-6">
      <div className="flex items-start gap-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700"
          aria-hidden="true"
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <DialogTitle className="pr-6 sm:pr-20">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </div>
      </div>
    </DialogHeader>
  );
}

const MINI_LABEL = "block text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground";

/** The line (or sub-item) the new sub-items go under: SL No · description · unit, one line each. */
export function SubItemParentCard({
  slNo,
  description,
  unit,
  kind,
  path,
}: {
  slNo: string;
  description: string;
  unit: string;
  kind: "boq" | "sub";
  /** Ancestors, top first, for the description's tooltip. */
  path?: ReadonlyArray<{ slNo: string; description: string }>;
}) {
  const trail = [...(path ?? []), { slNo, description }]
    .map((step) => [step.slNo, step.description].filter(Boolean).join(" "))
    .join(" › ");
  return (
    // A phone puts SL No and unit side by side with the description below them, on two lines.
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 rounded-lg border border-violet-200 border-l-[3px] border-l-violet-600 bg-violet-50/60 px-3.5 py-2.5 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <span className={MINI_LABEL}>Under</span>
        <span className="block truncate text-sm font-bold tabular-nums" title={slNo}>
          {slNo || "—"}
        </span>
      </div>
      <div className="order-last col-span-2 min-w-0 sm:order-none sm:col-span-1">
        <span className={MINI_LABEL}>{kind === "boq" ? "BOQ line" : "Sub-item"}</span>
        <span
          className="line-clamp-2 cursor-help break-words text-sm font-medium sm:line-clamp-1"
          title={trail || description}
        >
          {description || "—"}
        </span>
      </div>
      <div className="min-w-0 text-right">
        <span className={MINI_LABEL}>Unit</span>
        <span className="block truncate text-sm font-semibold text-muted-foreground" title={unit}>
          {unit || "—"}
        </span>
      </div>
    </div>
  );
}

export interface ShareSegment {
  id: string;
  /** The share of the parent actually used, 0–1. */
  share: number;
  /** Already saved under the parent (grey), or one being added (coloured). */
  existing: boolean;
  /** Blank share — it takes what the set ones leave, drawn lighter. */
  auto: boolean;
  /** Index among the new rows, for its colour. */
  colourIndex: number;
  label: string;
}

/**
 * The share-of-parent bar. `setTotalPct` is the sum of the shares typed in (blanks excluded): over
 * 100 is an error whatever the blanks do.
 */
export function ShareAllocation({
  parentLabel,
  segments,
  setTotalPct,
  newLabel,
}: {
  parentLabel: string;
  segments: readonly ShareSegment[];
  setTotalPct: number;
  /** What the coloured part is called in the legend: "This sub-item", "New rows". */
  newLabel: string;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.share, 0) * 100;
  const over = setTotalPct > 100 + 1e-9;
  const existing = segments.filter((segment) => segment.existing);
  const fresh = segments.filter((segment) => !segment.existing);
  const existingPct = existing.reduce((sum, segment) => sum + segment.share, 0) * 100;
  const freshPct = fresh.reduce((sum, segment) => sum + segment.share, 0) * 100;
  const shown = over ? setTotalPct : total;

  let message: ReactNode;
  if (segments.length === 0) {
    message = (
      <span className="text-muted-foreground">
        No sub-items yet — they will share 100% of {parentLabel}.
      </span>
    );
  } else if (over) {
    message = (
      <span className="text-destructive">
        Shares add up to {formatPct(setTotalPct)} — more than 100% of {parentLabel}. Reduce one of
        them.
      </span>
    );
  } else if (total < 100 - 1e-6) {
    message = (
      <span className="text-amber-700">
        {formatPct(100 - total)} of {parentLabel} is not yet covered by a sub-item.
      </span>
    );
  } else {
    message = <span className="text-emerald-700">✓ Covers 100% of {parentLabel}.</span>;
  }

  return (
    <div className="rounded-lg border border-border/70 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3 text-xs font-semibold text-muted-foreground">
        <span className="truncate">Share of {parentLabel}</span>
        <b
          className={cn("shrink-0 font-bold tabular-nums", over ? "text-destructive" : "text-foreground")}
        >
          {formatPct(Math.min(shown, 999))}
        </b>
      </div>
      <div
        className="mt-2 flex h-2 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`Sub-items cover ${formatPct(Math.min(total, 100))} of ${parentLabel}`}
      >
        {segments.map((segment, index) => (
          <i
            key={segment.id}
            className="block h-full shrink-0 border-r-[1.5px] border-background last:border-r-0"
            title={`${segment.label} · ${formatPct(segment.share * 100)}`}
            style={{
              width: `${Math.min(100, Math.max(0, segment.share * 100))}%`,
              backgroundColor: segment.existing
                ? EXISTING_COLOURS[index % EXISTING_COLOURS.length]
                : subItemColour(segment.colourIndex),
              opacity: segment.auto ? 0.6 : 1,
            }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs">
        <span className="min-w-0">{message}</span>
        {existing.length > 0 && fresh.length > 0 ? (
          <span className="flex shrink-0 items-center gap-3 tabular-nums text-muted-foreground">
            <span className="flex items-center gap-1">
              <i className="h-2 w-2 rounded-full" style={{ backgroundColor: EXISTING_COLOURS[0] }} />
              Existing ({existing.length}) {formatPct(existingPct)}
            </span>
            <span className="flex items-center gap-1">
              <i className="h-2 w-2 rounded-full" style={{ backgroundColor: SUB_ITEM_COLOURS[0] }} />
              {newLabel} {formatPct(freshPct)}
            </span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** An input with its unit (or %) written inside its right edge, as on a printed form. */
export function SuffixInput({
  suffix,
  className,
  ...props
}: ComponentProps<typeof Input> & { suffix: string }) {
  return (
    <div className="relative">
      <Input className={cn("pr-[4.75rem] text-right tabular-nums", className)} {...props} />
      {suffix ? (
        <span
          className="pointer-events-none absolute right-3 top-1/2 max-w-[3.5rem] -translate-y-1/2 truncate text-xs font-semibold text-muted-foreground"
          title={suffix}
        >
          {suffix}
        </span>
      ) : null}
    </div>
  );
}

/** "Ctrl + Enter to add": the keyboard hint at the left of a footer, from sm up. */
export function SubmitChordHint({ action }: { action: string }) {
  return (
    <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:mr-auto sm:flex">
      <kbd className="rounded border border-b-2 border-border bg-background px-1 text-[10.5px] font-semibold">
        Ctrl
      </kbd>
      +
      <kbd className="rounded border border-b-2 border-border bg-background px-1 text-[10.5px] font-semibold">
        Enter
      </kbd>
      to {action}
    </span>
  );
}

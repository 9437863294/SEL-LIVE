"use client";

/**
 * The parts a "raise a certificate" form is built from, from the user's `sel-jmc-create` mock-up.
 *
 * Written for Create JMC and then wanted whole by Create MVAC, so they live here and both screens
 * render them. The three ideas the mock-up added, which a plain form did not have:
 *
 *   - the run of workflow stages across the top, so the person filling the form can see that
 *     saving hands the certificate to the next desk rather than finishing it;
 *   - a colour per field, carried by the label's icon tile and the input's left edge, so a wide
 *     four-column row reads as four fields rather than one stripe of boxes;
 *   - a numbered chip at the head of every line-item row, so a long register keeps its place.
 *
 * Presentation only — no data, no rules.
 *
 * Colours are plain hex and theme tokens, never `color-mix()`: Chrome 109 on the Windows 7 PCs
 * drops it silently and the field accents would simply vanish.
 */

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** A workflow step, as the stepper needs it. */
export interface EntryStepLike {
  id: string;
  name: string;
}

/** The field accents, in the mock-up's order. */
export const ENTRY_FIELD_COLOURS = ["#059669", "#7c3aed", "#0891b2", "#d97706"] as const;

/** The row-number chips, cycling so a long list keeps its stripes. */
const ROW_COLOURS: ReadonlyArray<readonly [string, string]> = [
  ["#6ee7b7", "#059669"],
  ["#93c5fd", "#2563eb"],
  ["#c4b5fd", "#7c3aed"],
  ["#fdba74", "#ea580c"],
  ["#f9a8d4", "#db2777"],
  ["#67e8f9", "#0891b2"],
];

/** How the stepper tints itself to the band it is sitting on. */
const STEPPER_TONES = {
  emerald: {
    arrow: "text-emerald-200",
    current: "border-white bg-white text-emerald-900",
    ahead: "border-white/30 bg-white/10 text-emerald-100",
    currentChip: "bg-emerald-600 text-white",
  },
  rose: {
    arrow: "text-rose-200",
    current: "border-white bg-white text-rose-900",
    ahead: "border-white/30 bg-white/10 text-rose-100",
    currentChip: "bg-rose-600 text-white",
  },
} as const;

export type EntryStepperTone = keyof typeof STEPPER_TONES;

/**
 * The stage run, with the step being raised marked as current.
 *
 * Built from the configured workflow, so an installation with more or differently named stages
 * sees its own. The first node is prepended because raising the certificate is not itself a
 * workflow step — the run describes what happens to it afterwards.
 */
export function EntryStageStepper({
  steps,
  createLabel = "Create",
  tone = "emerald",
  className,
}: {
  steps: readonly EntryStepLike[];
  createLabel?: string;
  tone?: EntryStepperTone;
  className?: string;
}) {
  if (steps.length === 0) return null;
  const palette = STEPPER_TONES[tone];
  const labels = [createLabel, ...steps.map((step) => step.name)];

  return (
    <ol className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {labels.map((label, index) => (
        <li key={`${label}-${index}`} className="flex items-center gap-1.5">
          {index > 0 ? (
            <span className={cn("text-xs font-extrabold", palette.arrow)} aria-hidden="true">
              →
            </span>
          ) : null}
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border py-1 pl-1.5 pr-3 text-xs font-extrabold",
              index === 0 ? palette.current : palette.ahead,
            )}
            aria-current={index === 0 ? "step" : undefined}
          >
            <span
              className={cn(
                "grid h-5 w-5 place-items-center rounded-full text-[11px]",
                index === 0 ? palette.currentChip : "bg-white/20",
              )}
              aria-hidden="true"
            >
              {index + 1}
            </span>
            <span className="max-w-[10rem] truncate">{label}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** A field's label: its colour tile, its name, and the required marker when it is one. */
export function EntryFieldLabel({
  htmlFor,
  icon: Icon,
  colour,
  children,
  required,
  hint,
}: {
  htmlFor: string;
  icon: LucideIcon;
  colour: string;
  children: ReactNode;
  required?: boolean;
  hint?: string;
}) {
  return (
    <Label htmlFor={htmlFor} className="mb-1.5 flex items-center gap-2 text-xs font-extrabold">
      <span
        className="grid h-5 w-5 shrink-0 place-items-center rounded-[7px] text-white"
        style={{ backgroundColor: colour }}
        aria-hidden="true"
      >
        <Icon className="h-3 w-3" />
      </span>
      <span className="text-muted-foreground">{children}</span>
      {required ? (
        <span className="text-rose-600" aria-hidden="true">
          *
        </span>
      ) : null}
      {hint ? <span className="font-semibold text-muted-foreground/70">{hint}</span> : null}
    </Label>
  );
}

/** The class an accented field takes; the colour itself rides in an inline style. */
export const ENTRY_FIELD_INPUT = "h-[42px] rounded-xl border-l-[3px] font-bold";

/** The numbered chip at the head of a line-item row. */
export function EntryRowNumber({ index }: { index: number }) {
  const [light, strong] = ROW_COLOURS[index % ROW_COLOURS.length]!;
  return (
    <span
      className="grid h-6 w-6 place-items-center rounded-lg text-[11px] font-extrabold text-white"
      style={{ backgroundImage: `linear-gradient(135deg, ${light}, ${strong})` }}
    >
      {index + 1}
    </span>
  );
}

/** The register's footer: what has been added, and what it comes to. */
export function EntryItemsFooter({
  itemCount,
  withQtyCount,
  totalLabel = "Total amount",
  total,
  action,
  note,
}: {
  itemCount: number;
  withQtyCount: number;
  /** What the big figure is called — "Total amount", "Total quantity". */
  totalLabel?: string;
  total: string;
  action?: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div className="border-t">
      <div className="flex flex-wrap items-center gap-4 bg-muted/40 px-4 py-3.5 sm:px-5">
        {action}
        <div className="ml-auto flex flex-wrap items-center gap-5">
          <Figure label="Items" value={String(itemCount)} />
          <Figure label="With qty" value={String(withQtyCount)} />
          <Figure label={totalLabel} value={total} big />
        </div>
      </div>
      {note ? (
        <p className="bg-muted/40 px-4 pb-3 text-[11.5px] text-muted-foreground sm:px-5">{note}</p>
      ) : null}
    </div>
  );
}

function Figure({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div>
      <span className="block text-[10.5px] font-extrabold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "block font-extrabold tabular-nums",
          big ? "text-xl text-emerald-700 dark:text-emerald-400" : "text-base",
        )}
      >
        {value}
      </span>
    </div>
  );
}

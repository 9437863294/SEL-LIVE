"use client";

/**
 * The Create JMC screen's furniture, from the user's `sel-jmc-create` mock-up.
 *
 * Three ideas from the mock-up that the form did not have:
 *   - the run of workflow stages across the top, so the person filling the form can see that saving
 *     hands the certificate to the next desk rather than finishing it;
 *   - a colour per field, carried by the label's icon tile and the input's left edge, so a wide
 *     four-column row reads as four fields rather than one stripe of boxes;
 *   - an executed quantity that says what is left on the BOQ line, and says so loudly when the
 *     entry goes past it.
 *
 * Presentation only — the quantity rule itself is `jmcQuantityCheck`, which is tested.
 *
 * Colours are plain hex and theme tokens, never `color-mix()`: Chrome 109 on the Windows 7 PCs
 * drops it silently and the field accents would simply vanish.
 */

import type { ReactNode } from "react";
import { AlertTriangle, type LucideIcon } from "lucide-react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  jmcQuantityCheck,
  type JmcWorkflowStepLike,
} from "@/lib/project-management-jmc-dashboard";

/** The field accents, in the mock-up's order: project, number, order, date. */
export const JMC_FIELD_COLOURS = ["#059669", "#7c3aed", "#0891b2", "#d97706"] as const;

/** The row-number chips, cycling so a long list keeps its stripes. */
const ROW_COLOURS: ReadonlyArray<readonly [string, string]> = [
  ["#6ee7b7", "#059669"],
  ["#93c5fd", "#2563eb"],
  ["#c4b5fd", "#7c3aed"],
  ["#fdba74", "#ea580c"],
  ["#f9a8d4", "#db2777"],
  ["#67e8f9", "#0891b2"],
];

/**
 * The stage run, with the step being raised marked as current.
 *
 * Built from the configured workflow, so an installation with more or differently named stages
 * sees its own. "Create" is prepended because raising the certificate is not itself a workflow
 * step — the run describes what happens to it afterwards.
 */
export function JmcStageStepper({
  steps,
  className,
}: {
  steps: readonly JmcWorkflowStepLike[];
  className?: string;
}) {
  if (steps.length === 0) return null;
  const labels = ["Create", ...steps.map((step) => step.name)];

  return (
    <ol className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {labels.map((label, index) => (
        <li key={`${label}-${index}`} className="flex items-center gap-1.5">
          {index > 0 ? (
            <span className="text-xs font-extrabold text-emerald-200" aria-hidden="true">
              →
            </span>
          ) : null}
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border py-1 pl-1.5 pr-3 text-xs font-extrabold",
              index === 0
                ? "border-white bg-white text-emerald-900"
                : "border-white/30 bg-white/10 text-emerald-100",
            )}
            aria-current={index === 0 ? "step" : undefined}
          >
            <span
              className={cn(
                "grid h-5 w-5 place-items-center rounded-full text-[11px]",
                index === 0 ? "bg-emerald-600 text-white" : "bg-white/20",
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
export function JmcFieldLabel({
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
export const JMC_FIELD_INPUT = "h-[42px] rounded-xl border-l-[3px] font-bold";

/** The numbered chip at the head of a line-item row. */
export function JmcRowNumber({ index }: { index: number }) {
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

/**
 * What is left on a BOQ line, beside the executed-quantity box.
 *
 * It sits on the same line as the input rather than under it: this register is scanned down a
 * column of quantities, and a second line under every box would add about 16px to every row and
 * push the table past a screen. The wording is short for the same reason — "Bal 40 Cum",
 * "+10 over" — with the full sentence in the title attribute for anyone who stops on it.
 *
 * A line with no BOQ quantity says so instead of showing a balance of zero, which would read as
 * "nothing left" when the truth is "nothing to measure against".
 */
export function JmcQtyNote({
  executedQty,
  boqQty,
  totalCertifiedQty,
  unit,
}: {
  executedQty: unknown;
  boqQty: unknown;
  totalCertifiedQty: unknown;
  unit?: string;
}) {
  const check = jmcQuantityCheck({ executedQty, boqQty, totalCertifiedQty });
  const amount = (value: number) =>
    `${value.toLocaleString("en-IN", { maximumFractionDigits: 3 })}${unit ? ` ${unit}` : ""}`;

  if (check.unchecked) {
    return (
      <span
        className="whitespace-nowrap text-[11px] font-semibold text-muted-foreground"
        title="This BOQ line records no quantity, so there is nothing to measure against."
      >
        no BOQ qty
      </span>
    );
  }

  if (check.over) {
    return (
      <span
        className="flex items-center gap-1 whitespace-nowrap text-[11px] font-extrabold text-rose-600"
        title={`${amount(check.excess)} more than this BOQ line has left to certify.`}
      >
        <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
        +{amount(check.excess)} over
      </span>
    );
  }

  return (
    <span
      className="whitespace-nowrap text-[11px] font-semibold text-muted-foreground"
      title={`${amount(check.balance)} of this BOQ line is still uncertified.`}
    >
      Bal {amount(check.balance)}
    </span>
  );
}

/** The register's footer: what has been added, and what it comes to. */
export function JmcItemsFooter({
  itemCount,
  withQtyCount,
  totalAmount,
  action,
  note,
}: {
  itemCount: number;
  withQtyCount: number;
  totalAmount: string;
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
          <Figure label="Total amount" value={totalAmount} big />
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

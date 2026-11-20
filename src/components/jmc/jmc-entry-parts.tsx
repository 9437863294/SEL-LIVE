"use client";

/**
 * The Create JMC screen's furniture, from the user's `sel-jmc-create` mock-up.
 *
 * The stage run, the field accents, the row-number chips and the register footer are shared now —
 * Create MVAC is the same form with quantities instead of money — so they live in
 * `entry-form-kit.tsx` and this file keeps JMC's own names and JMC's one rule that is not generic:
 * what is left on a BOQ line.
 *
 * Colours are plain hex and theme tokens, never `color-mix()`: Chrome 109 on the Windows 7 PCs
 * drops it silently and the field accents would simply vanish.
 */

import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import {
  ENTRY_FIELD_COLOURS,
  ENTRY_FIELD_INPUT,
  EntryFieldLabel,
  EntryItemsFooter,
  EntryRowNumber,
  EntryStageStepper,
} from "@/components/project-management/entry-form-kit";
import {
  jmcQuantityCheck,
  type JmcWorkflowStepLike,
} from "@/lib/project-management-jmc-dashboard";

/** The field accents, in the mock-up's order: project, number, order, date. */
export const JMC_FIELD_COLOURS = ENTRY_FIELD_COLOURS;

/** The class an accented field takes; the colour itself rides in an inline style. */
export const JMC_FIELD_INPUT = ENTRY_FIELD_INPUT;

/** The stage run, with "Create JMC" as the step being raised. */
export function JmcStageStepper({
  steps,
  className,
}: {
  steps: readonly JmcWorkflowStepLike[];
  className?: string;
}) {
  return <EntryStageStepper steps={steps} createLabel="Create" tone="emerald" className={className} />;
}

export const JmcFieldLabel = EntryFieldLabel;
export const JmcRowNumber = EntryRowNumber;

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
    <EntryItemsFooter
      itemCount={itemCount}
      withQtyCount={withQtyCount}
      totalLabel="Total amount"
      total={totalAmount}
      action={action}
      note={note}
    />
  );
}

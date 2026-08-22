"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * The width boundary a table sits inside.
 *
 * A `<table>` sizes itself to its content, so a wide register (a dozen columns, most of them
 * `whitespace-nowrap`) stretches whatever contains it. `min-w-0` is the part that matters: a
 * grid/flex child defaults to `min-width: auto` and refuses to shrink below its content, which
 * silently defeats the overflow rule on anything nested inside it.
 *
 * Scrolling itself is not set here. The `.recurring-payments-content div:has(> table)` rule in
 * globals.css turns the container the shared `Table` component already renders into the single
 * scrollport — bounded height, both axes, sticky header. Adding another `overflow` here would nest
 * a second scroll container inside that one for no benefit.
 */
export function TableScrollArea({ children }: { children: React.ReactNode }) {
  return <div className="w-full min-w-0 max-w-full">{children}</div>;
}

/**
 * A titled table surface: card header, record count, optional actions, and a body that scrolls
 * horizontally rather than stretching the page.
 *
 * Exists so every table in the module reads the same way — a stated subject and a row count, not a
 * bare grid of headers whose meaning depends on which page you happened to open — and so the
 * scroll boundary above can't be forgotten on the next table someone adds.
 */
export default function ModuleTableCard({
  title,
  description,
  count,
  countNoun = "record",
  actions,
  children,
  footer,
}: {
  title: string;
  description?: string;
  /** Row count rendered as "N record(s)"; combined with `description` when both are given. */
  count?: number;
  countNoun?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const countLabel =
    count === undefined
      ? undefined
      : `${count.toLocaleString("en-IN")} ${countNoun}${count === 1 ? "" : "s"}`;
  const subtitle = [countLabel, description].filter(Boolean).join(" · ");
  return (
    <Card className="min-w-0">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0 py-4">
        <div className="min-w-0">
          <CardTitle className="text-base">{title}</CardTitle>
          {subtitle && <CardDescription className="mt-1">{subtitle}</CardDescription>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2 print:hidden">{actions}</div>}
      </CardHeader>
      <CardContent className="p-0">
        <TableScrollArea>{children}</TableScrollArea>
        {footer}
      </CardContent>
    </Card>
  );
}

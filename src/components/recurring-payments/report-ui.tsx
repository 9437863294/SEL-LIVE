"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableScrollArea } from "./module-table-card";

/**
 * Shared chrome for the Recurring Payments "Reports" section. Every report hand-rolled its own
 * hero banner (six different gradients across seven screens, none reliably matching the module's
 * actual emerald/teal brand), metric tile, loading/permission-denied block, and name/count/amount
 * summary table. Centralizing them here means the whole section now looks and behaves like one
 * product, a palette change only has to happen once, and print styling (dark hero → print-safe)
 * is baked in everywhere instead of only on the overview dashboard.
 */

export const REPORT_HERO_GRADIENT = "from-emerald-700 to-teal-700";

export function ReportHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <Card className={`border-0 bg-gradient-to-r ${REPORT_HERO_GRADIENT} text-white print:border print:bg-white print:text-black`}>
      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="text-sm text-emerald-50 print:text-slate-600">{description}</p>
        </div>
        {actions && <div className="flex gap-2 print:hidden">{actions}</div>}
      </CardContent>
    </Card>
  );
}

export function ReportLoading() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Loader2 className="h-7 w-7 animate-spin text-emerald-600" />
    </div>
  );
}

export function ReportAccessDenied() {
  return (
    <Card>
      <CardContent className="py-16 text-center">
        <AlertTriangle className="mx-auto mb-3 h-9 w-9 text-amber-500" />
        <p className="font-semibold text-muted-foreground">
          You don&apos;t have permission to view this report.
        </p>
      </CardContent>
    </Card>
  );
}

/** Every report's Firestore listener used to swallow errors into an indistinguishable empty
 * "no records" table. Render this alongside (not instead of) the table when a listener errors, so
 * a permission-denied/offline error reads as an error, not as "there's just no data." */
export function ReportErrorBanner({
  message = "Couldn't load live data for this report. Check your connection, or that you still have access, and try refreshing the page.",
}: {
  message?: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <p>{message}</p>
    </div>
  );
}

const METRIC_TONES = {
  neutral: { chip: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300", value: "" },
  good: { chip: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400", value: "" },
  warning: { chip: "bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400", value: "text-amber-600 dark:text-amber-400" },
  critical: { chip: "bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400", value: "text-rose-600 dark:text-rose-400" },
} as const;

export function ReportMetricTile({
  label,
  value,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: string;
  icon?: React.ElementType;
  tone?: keyof typeof METRIC_TONES;
}) {
  const palette = METRIC_TONES[tone];
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className={`mt-1 text-xl font-bold ${palette.value}`}>{value}</p>
        </div>
        {Icon && (
          <div className={`rounded-lg p-2 ${palette.chip}`}>
            <Icon className="h-4 w-4" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ReportSummaryTable({
  title,
  description,
  icon: Icon,
  rows,
  nameHeader = "Name",
  countHeader = "Records",
  emptyLabel = "No data yet.",
}: {
  title: string;
  description?: string;
  icon?: React.ElementType;
  rows: Array<{ name: string; count: number; amount: number }>;
  nameHeader?: string;
  countHeader?: string;
  emptyLabel?: string;
}) {
  return (
    <Card className="min-w-0">
      <CardHeader className="py-4">
        <CardTitle className="flex items-center gap-2 text-base">
          {Icon && <Icon className="h-5 w-5 text-emerald-600" />}
          {title}
        </CardTitle>
        <CardDescription>
          {[`${rows.length.toLocaleString("en-IN")} row${rows.length === 1 ? "" : "s"}`, description]
            .filter(Boolean)
            .join(" · ")}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <TableScrollArea>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{nameHeader}</TableHead>
              <TableHead className="text-right">{countHeader}</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.name}>
                <TableCell>{row.name}</TableCell>
                <TableCell className="text-right">{row.count}</TableCell>
                <TableCell className="text-right font-semibold">
                  {new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(row.amount || 0)}
                </TableCell>
              </TableRow>
            ))}
            {!rows.length && (
              <TableRow>
                <TableCell colSpan={3} className="h-20 text-center text-muted-foreground">
                  {emptyLabel}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        </TableScrollArea>
      </CardContent>
    </Card>
  );
}

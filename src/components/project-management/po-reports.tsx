"use client";

import { useMemo } from "react";
import { AlertTriangle, CalendarClock, IndianRupee, ShoppingCart, TrendingDown, TrendingUp } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { chartChrome } from "@/components/ui/chart";
import StatCard from "@/components/project-management/stat-card";
import { PmDataList, type PmListColumn } from "@/components/project-management/pm-shell";
import { cn } from "@/lib/utils";
import {
  PO_STATUSES,
  formatCurrency,
  isPoOverdue,
  poStatusStyles,
  toNumber,
  type POStatus,
  type PurchaseOrder,
} from "@/lib/purchase-orders";

export type PoBoqItemLite = {
  id: string;
  "ERP SL NO"?: string | number;
  "BOQ SL No"?: string | number;
  Description?: string;
  Unit?: string;
  QTY?: string | number;
  "Unit Rate"?: string | number;
  "Total Amount"?: string | number;
  "Scope 1"?: string;
  "Scope 2"?: string;
  "Budget Price"?: string | number;
};

const STATUS_COLORS: Record<POStatus, string> = {
  Draft: "#94a3b8",
  Issued: "#3b82f6",
  Received: "#10b981",
  Cancelled: "#ef4444",
};

const formatDate = (value?: string) => {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

/**
 * A report Card whose body is a list: framed on a desktop, only its heading on a phone — the list
 * brings its own cards there, and a card inside a card is just a thicker border.
 */
const LIST_CARD_CLASS = "max-sm:border-0 max-sm:bg-transparent max-sm:shadow-none";
const LIST_CARD_HEADER_CLASS = "pb-2 max-sm:px-0";
/** The Card frames the list on a desktop, so the list drops its own. */
const LIST_IN_CARD_CLASS = "sm:rounded-none sm:border-0 sm:shadow-none";

type VarianceLine = {
  id: string;
  po: PurchaseOrder;
  description: string;
  variance: number;
};

export default function PoReports({
  purchaseOrders,
  boqItemsById,
  onSelectPo,
}: {
  purchaseOrders: PurchaseOrder[];
  boqItemsById: Map<string, PoBoqItemLite>;
  onSelectPo: (poId: string) => void;
}) {
  const activeOrders = useMemo(() => purchaseOrders.filter((po) => po.status !== "Cancelled"), [purchaseOrders]);

  // Flatten every PO item that has a matching BOQ budget price, for item-level variance analysis.
  const matchedLines = useMemo(() => {
    const lines: {
      po: PurchaseOrder;
      description: string;
      scope: string;
      qty: number;
      budgetAmount: number;
      purchaseAmount: number;
      variance: number;
    }[] = [];
    for (const po of activeOrders) {
      for (const item of po.items ?? []) {
        if (!item.boqItemId) continue;
        const boqItem = boqItemsById.get(item.boqItemId);
        if (!boqItem) continue;
        const budgetUnitPrice = toNumber(boqItem["Budget Price"]);
        if (!budgetUnitPrice) continue;
        const qty = toNumber(item.qty);
        const budgetAmount = budgetUnitPrice * qty;
        const purchaseAmount = toNumber(item.amount);
        lines.push({
          po,
          description: item.description || boqItem.Description || "—",
          scope: String(boqItem["Scope 1"] ?? "").trim() || "Ungrouped",
          qty,
          budgetAmount,
          purchaseAmount,
          variance: budgetAmount - purchaseAmount,
        });
      }
    }
    return lines;
  }, [activeOrders, boqItemsById]);

  const totalPurchaseValue = useMemo(() => activeOrders.reduce((sum, po) => sum + toNumber(po.totalAmount), 0), [activeOrders]);
  const totalBudgetValue = useMemo(() => matchedLines.reduce((sum, line) => sum + line.budgetAmount, 0), [matchedLines]);
  const matchedPurchaseValue = useMemo(() => matchedLines.reduce((sum, line) => sum + line.purchaseAmount, 0), [matchedLines]);
  const totalVariance = totalBudgetValue - matchedPurchaseValue;
  const variancePercent = totalBudgetValue ? Math.round((totalVariance / totalBudgetValue) * 1000) / 10 : 0;

  const overdueOrders = useMemo(
    () => activeOrders.filter((po) => isPoOverdue(po)).sort((a, b) => (a.endDate ?? "").localeCompare(b.endDate ?? "")),
    [activeOrders],
  );

  const statusData = useMemo(
    () =>
      PO_STATUSES.map((status) => ({
        name: status,
        value: purchaseOrders.filter((po) => po.status === status).reduce((sum, po) => sum + toNumber(po.totalAmount), 0),
      })).filter((entry) => entry.value > 0),
    [purchaseOrders],
  );

  const monthlyTrend = useMemo(() => {
    const map = new Map<string, number>();
    for (const po of activeOrders) {
      if (!po.poDate) continue;
      const key = po.poDate.slice(0, 7);
      map.set(key, (map.get(key) ?? 0) + toNumber(po.totalAmount));
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, amount]) => {
        const date = new Date(`${key}-01T00:00:00`);
        return { name: Number.isNaN(date.getTime()) ? key : date.toLocaleDateString("en-IN", { month: "short", year: "2-digit" }), amount };
      });
  }, [activeOrders]);

  const vendorComparison = useMemo(() => {
    const map = new Map<string, { budget: number; purchase: number }>();
    for (const line of matchedLines) {
      const entry = map.get(line.po.vendorName) ?? { budget: 0, purchase: 0 };
      entry.budget += line.budgetAmount;
      entry.purchase += line.purchaseAmount;
      map.set(line.po.vendorName, entry);
    }
    return Array.from(map.entries())
      .map(([vendor, { budget, purchase }]) => ({ vendor, budget, purchase }))
      .sort((a, b) => b.purchase - a.purchase)
      .slice(0, 8);
  }, [matchedLines]);

  const scopeComparison = useMemo(() => {
    const map = new Map<string, { budget: number; purchase: number }>();
    for (const line of matchedLines) {
      const entry = map.get(line.scope) ?? { budget: 0, purchase: 0 };
      entry.budget += line.budgetAmount;
      entry.purchase += line.purchaseAmount;
      map.set(line.scope, entry);
    }
    return Array.from(map.entries()).map(([scope, { budget, purchase }]) => ({
      scope,
      budget,
      purchase,
      percentUsed: budget ? Math.round((purchase / budget) * 100) : 0,
    }));
  }, [matchedLines]);

  const topSavings = useMemo(
    () => [...matchedLines].filter((l) => l.variance > 0).sort((a, b) => b.variance - a.variance).slice(0, 5),
    [matchedLines],
  );
  const topOverruns = useMemo(
    () => [...matchedLines].filter((l) => l.variance < 0).sort((a, b) => a.variance - b.variance).slice(0, 5),
    [matchedLines],
  );

  const toVarianceRows = (lines: typeof matchedLines): VarianceLine[] =>
    lines.map((line, index) => ({ id: String(index), po: line.po, description: line.description, variance: line.variance }));

  // Savings and overruns are the same list with a different last column. The amount carries its
  // own colour because a phone card's aside does not get the column's classes.
  const varianceColumns = (kind: "savings" | "overrun"): PmListColumn<VarianceLine>[] => [
    { header: "Item", className: "max-w-[180px] truncate", mobile: "title", cell: (line) => line.description },
    { header: "PO", className: "whitespace-nowrap text-xs text-muted-foreground", cell: (line) => line.po.poNumber },
    kind === "savings"
      ? {
          header: "Savings",
          className: "whitespace-nowrap",
          mobile: "aside",
          cell: (line) => <span className="font-medium text-emerald-600">{formatCurrency(line.variance)}</span>,
        }
      : {
          header: "Overrun",
          className: "whitespace-nowrap",
          mobile: "aside",
          cell: (line) => <span className="font-medium text-red-600">{formatCurrency(Math.abs(line.variance))}</span>,
        },
  ];

  const overdueColumns: PmListColumn<PurchaseOrder>[] = [
    { header: "PO Number", className: "font-medium", mobile: "title", cell: (po) => po.poNumber },
    { header: "Vendor", mobile: "title", cell: (po) => po.vendorName },
    {
      header: "End Date",
      className: "whitespace-nowrap",
      cell: (po) => <span className="text-red-600">{formatDate(po.endDate)}</span>,
    },
    {
      header: "Status",
      mobile: "aside",
      cell: (po) => (
        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", poStatusStyles[po.status])}>{po.status}</span>
      ),
    },
  ];

  return (
    <div className="space-y-5 max-sm:[--card-pad:1rem]">
      {/* Five tiles: two a row on a phone, three on a tablet or a narrow desktop, all five from
          `xl` — five a row at `sm` squeezed each rupee figure out of its tile. On a phone
          StatCard is compacted from here (tighter padding, no icon chip, a smaller figure) so an
          amount fits half a row. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5 [&>*]:min-w-0 max-sm:[&_.h-10]:hidden max-sm:[&_.p-4]:p-3 max-sm:[&_.text-2xl]:text-lg">
        <StatCard label="Total PO Value" value={formatCurrency(totalPurchaseValue)} icon={ShoppingCart} tone="bg-slate-100 text-slate-700" />
        <StatCard label="Budget Value (matched)" value={formatCurrency(totalBudgetValue)} icon={IndianRupee} tone="bg-blue-100 text-blue-700" />
        <StatCard
          label={totalVariance >= 0 ? "Net Savings" : "Net Overrun"}
          value={`${formatCurrency(Math.abs(totalVariance))} (${Math.abs(variancePercent)}%)`}
          icon={totalVariance >= 0 ? TrendingDown : TrendingUp}
          tone={totalVariance >= 0 ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}
        />
        <StatCard label="Total Purchase Orders" value={purchaseOrders.length} icon={ShoppingCart} tone="bg-indigo-100 text-indigo-700" />
        <StatCard label="Overdue" value={overdueOrders.length} icon={CalendarClock} tone="bg-orange-100 text-orange-700" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">PO value by status</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            {statusData.length ? (
              <ResponsiveContainer>
                <PieChart>
                  <Pie stroke={chartChrome.surface} data={statusData} dataKey="value" nameKey="name" outerRadius={85} label>
                    {statusData.map((entry) => (
                      <Cell key={entry.name} fill={STATUS_COLORS[entry.name as POStatus] ?? "#94a3b8"} />
                    ))}
                  </Pie>
                  <Tooltip {...chartChrome.tooltip} formatter={(value) => formatCurrency(Number(value))} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="flex h-full items-center justify-center text-sm text-muted-foreground">No data yet</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Monthly spend trend</CardTitle>
            <CardDescription>Total PO value raised per month</CardDescription>
          </CardHeader>
          <CardContent className="h-56 sm:h-64">
            {monthlyTrend.length ? (
              <ResponsiveContainer>
                <BarChart data={monthlyTrend}>
                  <CartesianGrid stroke={chartChrome.grid} strokeDasharray="3 3" />
                  <XAxis stroke={chartChrome.axis} dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis stroke={chartChrome.axis} tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} tick={{ fontSize: 11 }} />
                  <Tooltip {...chartChrome.tooltip} formatter={(value) => formatCurrency(Number(value))} />
                  <Bar dataKey="amount" fill="#6366f1" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="flex h-full items-center justify-center text-sm text-muted-foreground">No data yet</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Budget vs Purchase price by vendor</CardTitle>
          <CardDescription>Top vendors by purchase value, limited to items matched against a BOQ budget price</CardDescription>
        </CardHeader>
        <CardContent className="h-60 sm:h-72">
          {vendorComparison.length ? (
            <ResponsiveContainer>
              <BarChart data={vendorComparison}>
                <CartesianGrid stroke={chartChrome.grid} strokeDasharray="3 3" />
                <XAxis stroke={chartChrome.axis} dataKey="vendor" tick={{ fontSize: 11 }} />
                <YAxis stroke={chartChrome.axis} tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} tick={{ fontSize: 11 }} />
                <Tooltip {...chartChrome.tooltip} formatter={(value) => formatCurrency(Number(value))} />
                <Legend />
                <Bar dataKey="budget" name="Budget Price" fill="#94a3b8" radius={[6, 6, 0, 0]} />
                <Bar dataKey="purchase" name="Purchase Price" fill="#6366f1" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="flex h-full items-center justify-center text-sm text-muted-foreground">No matched budget data yet</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Scope-wise budget utilisation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {scopeComparison.length ? (
            scopeComparison.map(({ scope, budget, purchase, percentUsed }) => (
              <div key={scope}>
                {/* Wraps on a phone: the figures drop under the scope name rather than crushing it. */}
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
                  <span className="min-w-0 break-words font-medium">{scope}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {formatCurrency(purchase)} / {formatCurrency(budget)} · {percentUsed}%
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn("h-full rounded-full", percentUsed > 100 ? "bg-red-500" : "bg-emerald-500")}
                    style={{ width: `${Math.min(percentUsed, 100)}%` }}
                  />
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No matched budget data yet.</p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className={topSavings.length ? LIST_CARD_CLASS : undefined}>
          <CardHeader className={topSavings.length ? LIST_CARD_HEADER_CLASS : "pb-2"}>
            <CardTitle className="text-base text-emerald-700">Top savings</CardTitle>
            <CardDescription>Line items purchased below their BOQ budget price</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {topSavings.length ? (
              <PmDataList
                rows={toVarianceRows(topSavings)}
                columns={varianceColumns("savings")}
                onRowClick={(line) => onSelectPo(line.po.id)}
                className={LIST_IN_CARD_CLASS}
              />
            ) : (
              <p className="p-4 text-sm text-muted-foreground">No savings recorded yet.</p>
            )}
          </CardContent>
        </Card>

        <Card className={topOverruns.length ? LIST_CARD_CLASS : undefined}>
          <CardHeader className={topOverruns.length ? LIST_CARD_HEADER_CLASS : "pb-2"}>
            <CardTitle className="text-base text-red-700">Top overruns</CardTitle>
            <CardDescription>Line items purchased above their BOQ budget price</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {topOverruns.length ? (
              <PmDataList
                rows={toVarianceRows(topOverruns)}
                columns={varianceColumns("overrun")}
                onRowClick={(line) => onSelectPo(line.po.id)}
                className={LIST_IN_CARD_CLASS}
              />
            ) : (
              <p className="p-4 text-sm text-muted-foreground">No overruns recorded yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className={overdueOrders.length ? LIST_CARD_CLASS : undefined}>
        <CardHeader className={overdueOrders.length ? LIST_CARD_HEADER_CLASS : "pb-2"}>
          <CardTitle className="text-base">Overdue purchase orders ({overdueOrders.length})</CardTitle>
          <CardDescription>Planned end date has passed without being received</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {overdueOrders.length ? (
            <PmDataList
              rows={overdueOrders}
              columns={overdueColumns}
              onRowClick={(po) => onSelectPo(po.id)}
              className={LIST_IN_CARD_CLASS}
            />
          ) : (
            <p className="p-4 text-sm text-muted-foreground flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-muted-foreground" /> Nothing overdue.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

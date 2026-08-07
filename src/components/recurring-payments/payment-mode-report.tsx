"use client";

import { useEffect, useMemo, useState } from "react";
import { collectionGroup, onSnapshot, query, where } from "firebase/firestore";
import { AlertTriangle, Download, Loader2, Printer } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import {
  downloadCsv,
  maskAccount,
  RP_COLLECTIONS,
  currency,
  type PaymentMode,
  type PaymentTransaction,
} from "@/lib/recurring-payments";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import CollapsibleFilterCard from "./collapsible-filter-card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * How money actually moved: aggregates every recorded payment transaction (across all payment
 * obligations, via a collection-group query on each obligation's `transactions` sub-collection)
 * by mode and by bank account. None of the other reports in this module read transactions at
 * all — they only ever look at the obligation's own `status`/`paidAmount`, so questions like
 * "how much did we pay by cheque this month" or "what moved through account X" had no report to
 * answer them from.
 */
const DEFAULT_FILTERS = {
  from: "",
  to: "",
  mode: "all",
  bankAccount: "all",
  paidBy: "all",
};

export default function PaymentModeReport() {
  const { user } = useAuth();
  const { can } = useAuthorization();
  const organizationId = user?.organizationId || "default";
  const [transactions, setTransactions] = useState<PaymentTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);

  useEffect(
    () =>
      onSnapshot(
        query(
          collectionGroup(db, RP_COLLECTIONS.transactions),
          where("organizationId", "==", organizationId),
        ),
        (snapshot) => {
          setTransactions(
            snapshot.docs.map(
              (item) => ({ id: item.id, ...item.data() }) as PaymentTransaction,
            ),
          );
          setLoading(false);
        },
        () => setLoading(false),
      ),
    [organizationId],
  );

  const values = (key: keyof PaymentTransaction) =>
    [
      ...new Set(
        transactions.map((item) => String(item[key] || "")).filter(Boolean),
      ),
    ].sort();

  const rows = useMemo(
    () =>
      transactions
        .filter((item) => {
          if (filters.from && item.paymentDate < filters.from) return false;
          if (filters.to && item.paymentDate > filters.to) return false;
          if (filters.mode !== "all" && item.mode !== filters.mode) return false;
          if (
            filters.bankAccount !== "all" &&
            item.bankAccount !== filters.bankAccount
          )
            return false;
          if (filters.paidBy !== "all" && item.paidByName !== filters.paidBy)
            return false;
          return true;
        })
        .sort((a, b) => b.paymentDate.localeCompare(a.paymentDate)),
    [transactions, filters],
  );

  const activeFilterCount = (Object.keys(DEFAULT_FILTERS) as Array<keyof typeof DEFAULT_FILTERS>)
    .filter((key) => filters[key] !== DEFAULT_FILTERS[key]).length;

  const total = rows.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const totalTds = rows.reduce((sum, item) => sum + Number(item.tdsAmount || 0), 0);
  const totalGst = rows.reduce((sum, item) => sum + Number(item.gstAmount || 0), 0);
  const totalDeductions = rows.reduce(
    (sum, item) => sum + Number(item.deductionAmount || 0) + Number(item.adjustmentAmount || 0),
    0,
  );

  const byMode = useMemo(() => groupBy(rows, (item) => item.mode || "Other"), [rows]);
  const byBank = useMemo(
    () => groupBy(rows, (item) => (item.bankAccount ? maskAccount(item.bankAccount) : "Cash / no account")),
    [rows],
  );

  function exportCsv() {
    downloadCsv(
      `recurring-payment-modes-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        "Payment ID",
        "Payment Date",
        "Mode",
        "Bank Account",
        "Reference / Cheque",
        "Paid By",
        "Amount",
        "TDS",
        "GST",
        "Deduction",
        "Adjustment",
      ],
      rows.map((item) => [
        item.paymentId,
        item.paymentDate,
        item.mode,
        maskAccount(item.bankAccount) || "",
        item.chequeNumber || item.transactionReference || "",
        item.paidByName || "",
        item.amount,
        item.tdsAmount || 0,
        item.gstAmount || 0,
        item.deductionAmount || 0,
        item.adjustmentAmount || 0,
      ]),
    );
  }

  if (loading)
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin" />
      </div>
    );
  if (!can("View", "Recurring Payments.Reports"))
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

  return (
    <div className="space-y-5">
      <Card className="border-0 bg-gradient-to-r from-emerald-800 to-teal-800 text-white">
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Payment Mode & Bank Reconciliation</h1>
            <p className="text-sm text-emerald-100">
              How recorded payments actually moved — by mode, bank account and who recorded them
            </p>
          </div>
          <div className="flex gap-2 print:hidden">
            {can("Export", "Recurring Payments.Reports") && (
              <Button variant="secondary" onClick={exportCsv}>
                <Download className="mr-2 h-4 w-4" />
                Export CSV
              </Button>
            )}
            <Button variant="secondary" onClick={() => window.print()}>
              <Printer className="mr-2 h-4 w-4" />
              Print / PDF
            </Button>
          </div>
        </CardContent>
      </Card>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Total recorded" value={currency(total)} />
        <Metric label="TDS withheld" value={currency(totalTds)} />
        <Metric label="GST" value={currency(totalGst)} />
        <Metric label="Other deductions / adjustments" value={currency(totalDeductions)} />
      </div>
      <CollapsibleFilterCard activeCount={activeFilterCount} onClear={() => setFilters(DEFAULT_FILTERS)}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Input
            type="date"
            value={filters.from}
            onChange={(event) =>
              setFilters((current) => ({ ...current, from: event.target.value }))
            }
          />
          <Input
            type="date"
            value={filters.to}
            onChange={(event) =>
              setFilters((current) => ({ ...current, to: event.target.value }))
            }
          />
          <Select
            value={filters.mode}
            onValueChange={(mode) => setFilters((current) => ({ ...current, mode }))}
          >
            <SelectTrigger>
              <SelectValue placeholder="All modes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All modes</SelectItem>
              {(values("mode") as PaymentMode[]).map((mode) => (
                <SelectItem value={mode} key={mode}>
                  {mode}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.bankAccount}
            onValueChange={(bankAccount) =>
              setFilters((current) => ({ ...current, bankAccount }))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="All bank accounts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All bank accounts</SelectItem>
              {values("bankAccount").map((account) => (
                <SelectItem value={account} key={account}>
                  {maskAccount(account)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.paidBy}
            onValueChange={(paidBy) => setFilters((current) => ({ ...current, paidBy }))}
          >
            <SelectTrigger>
              <SelectValue placeholder="All recorded by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All recorded by</SelectItem>
              {values("paidByName").map((name) => (
                <SelectItem value={name} key={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CollapsibleFilterCard>
      <div className="grid gap-4 lg:grid-cols-2">
        <SummaryTable title="By payment mode" rows={byMode} />
        <SummaryTable title="By bank account" rows={byBank} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{rows.length} transaction(s)</CardTitle>
          <CardDescription>
            Organization: {user?.organizationName || organizationId}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Payment date</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Bank account</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Recorded by</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.paymentDate}</TableCell>
                    <TableCell>{item.mode}</TableCell>
                    <TableCell>{maskAccount(item.bankAccount) || "—"}</TableCell>
                    <TableCell>
                      {item.chequeNumber || item.transactionReference || "—"}
                    </TableCell>
                    <TableCell>{item.paidByName || "—"}</TableCell>
                    <TableCell className="text-right font-semibold">
                      {currency(item.amount)}
                    </TableCell>
                  </TableRow>
                ))}
                {!rows.length && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="h-28 text-center text-muted-foreground"
                    >
                      No transactions match the report filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function groupBy(rows: PaymentTransaction[], key: (item: PaymentTransaction) => string) {
  return Object.entries(
    rows.reduce<Record<string, { count: number; amount: number }>>((acc, item) => {
      const name = key(item) || "Unspecified";
      acc[name] ??= { count: 0, amount: 0 };
      acc[name].count++;
      acc[name].amount += Number(item.amount || 0);
      return acc;
    }, {}),
  )
    .map(([name, value]) => ({ name, ...value }))
    .sort((a, b) => b.amount - a.amount);
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}

function SummaryTable({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ name: string; count: number; amount: number }>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="text-right">Transactions</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.name}>
                <TableCell>{row.name}</TableCell>
                <TableCell className="text-right">{row.count}</TableCell>
                <TableCell className="text-right font-semibold">
                  {currency(row.amount)}
                </TableCell>
              </TableRow>
            ))}
            {!rows.length && (
              <TableRow>
                <TableCell colSpan={3} className="h-20 text-center text-muted-foreground">
                  No data.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { collectionGroup, onSnapshot, query, where } from "firebase/firestore";
import { Download, Loader2, Printer } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import {
  maskAccount,
  RP_COLLECTIONS,
  currency,
  recurringDateOnly,
  type PaymentMode,
  type PaymentTransaction,
} from "@/lib/recurring-payments";
import { exportWorkbook } from "@/lib/report-excel";
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
import {
  ReportAccessDenied,
  ReportErrorBanner,
  ReportHeader,
  ReportLoading,
  ReportMetricTile,
  ReportSummaryTable,
} from "./report-ui";

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
  const [loadError, setLoadError] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
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
        () => {
          setLoading(false);
          setLoadError(true);
        },
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

  async function exportReport() {
    setIsExporting(true);
    try {
      await exportWorkbook(`recurring-payment-modes-${recurringDateOnly(new Date())}.xlsx`, [
        {
          name: "Transactions",
          columns: [
            { header: "Payment ID", key: "paymentId", width: 20 },
            { header: "Payment Date", key: "paymentDate", width: 14 },
            { header: "Mode", key: "mode", width: 16 },
            { header: "Bank Account", key: "bankAccount", width: 20 },
            { header: "Reference / Cheque", key: "reference", width: 22 },
            { header: "Paid By", key: "paidBy", width: 20 },
            { header: "Amount", key: "amount", width: 14 },
            { header: "TDS", key: "tds", width: 12 },
            { header: "GST", key: "gst", width: 12 },
            { header: "Deduction", key: "deduction", width: 12 },
            { header: "Adjustment", key: "adjustment", width: 12 },
          ],
          rows: rows.map((item) => ({
            paymentId: item.paymentId,
            paymentDate: item.paymentDate,
            mode: item.mode,
            bankAccount: maskAccount(item.bankAccount) || "",
            reference: item.chequeNumber || item.transactionReference || "",
            paidBy: item.paidByName || "",
            amount: item.amount,
            tds: item.tdsAmount || 0,
            gst: item.gstAmount || 0,
            deduction: item.deductionAmount || 0,
            adjustment: item.adjustmentAmount || 0,
          })),
        },
        {
          name: "By mode",
          columns: [
            { header: "Mode", key: "name", width: 20 },
            { header: "Transactions", key: "count", width: 14 },
            { header: "Amount", key: "amount", width: 16 },
          ],
          rows: byMode,
        },
        {
          name: "By bank account",
          columns: [
            { header: "Bank account", key: "name", width: 20 },
            { header: "Transactions", key: "count", width: 14 },
            { header: "Amount", key: "amount", width: 16 },
          ],
          rows: byBank,
        },
      ]);
    } finally {
      setIsExporting(false);
    }
  }

  if (loading) return <ReportLoading />;
  if (!can("View", "Recurring Payments.Reports")) return <ReportAccessDenied />;

  return (
    <div className="space-y-5">
      <ReportHeader
        title="Payment Mode & Bank Reconciliation"
        description="How recorded payments actually moved — by mode, bank account and who recorded them"
        actions={
          <>
            {can("Export", "Recurring Payments.Reports") && (
              <Button variant="secondary" onClick={exportReport} disabled={isExporting}>
                {isExporting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                Export Excel
              </Button>
            )}
            <Button variant="secondary" onClick={() => window.print()}>
              <Printer className="mr-2 h-4 w-4" />
              Print / PDF
            </Button>
          </>
        }
      />
      {loadError && <ReportErrorBanner />}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <ReportMetricTile label="Total recorded" value={currency(total)} />
        <ReportMetricTile label="TDS withheld" value={currency(totalTds)} />
        <ReportMetricTile label="GST" value={currency(totalGst)} />
        <ReportMetricTile label="Other deductions / adjustments" value={currency(totalDeductions)} />
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
        <ReportSummaryTable title="By payment mode" rows={byMode} countHeader="Transactions" />
        <ReportSummaryTable title="By bank account" rows={byBank} countHeader="Transactions" />
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

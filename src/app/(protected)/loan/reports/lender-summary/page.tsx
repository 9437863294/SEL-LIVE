'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Download, Landmark } from 'lucide-react';
import ExcelJS from 'exceljs';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Loan } from '@/lib/types';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';

// ─── helpers ────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n || 0);

const fmtPct = (n: number) => `${n.toFixed(2)}%`;

// ─── types ──────────────────────────────────────────────────────────────────

interface LenderRow {
  lenderName: string;
  loanCount: number;
  activeLoanCount: number;
  totalPrincipal: number;
  totalPaid: number;
  totalOutstanding: number;
  totalEMI: number;
  avgRate: number;
}

// ─── component ──────────────────────────────────────────────────────────────

export default function LenderSummaryPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canView = can('View', 'Loan.Reports');

  const [loans, setLoans] = useState<Loan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  // ── fetch ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (isAuthLoading) return;
    if (!canView) {
      setIsLoading(false);
      return;
    }
    const load = async () => {
      setIsLoading(true);
      try {
        const snap = await getDocs(collection(db, 'loans'));
        setLoans(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Loan)));
      } catch (err) {
        console.error('Failed to load loans for lender summary', err);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [isAuthLoading, canView]);

  // ── group by lender ────────────────────────────────────────────────────────

  const lenderRows = useMemo((): LenderRow[] => {
    const map = new Map<string, Loan[]>();
    loans.forEach((l) => {
      const key = l.lenderName || 'Unknown';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(l);
    });

    const rows: LenderRow[] = [];
    map.forEach((group, lenderName) => {
      const loanCount = group.length;
      const activeLoanCount = group.filter(
        (l) => l.status === 'Active' || l.status === 'Pre-closure Pending'
      ).length;
      const totalPrincipal = group.reduce((s, l) => s + (l.loanAmount || 0), 0);
      const totalPaid = group.reduce((s, l) => s + (l.totalPaid || 0), 0);
      const totalOutstanding = group.reduce(
        (s, l) => s + Math.max(0, (l.loanAmount || 0) - (l.totalPaid || 0)),
        0
      );
      const totalEMI = group.reduce((s, l) => s + (l.emiAmount || 0), 0);
      const avgRate =
        loanCount > 0
          ? group.reduce((s, l) => s + (l.interestRate || 0), 0) / loanCount
          : 0;

      rows.push({
        lenderName,
        loanCount,
        activeLoanCount,
        totalPrincipal,
        totalPaid,
        totalOutstanding,
        totalEMI,
        avgRate,
      });
    });

    // sort by total principal descending
    return rows.sort((a, b) => b.totalPrincipal - a.totalPrincipal);
  }, [loans]);

  // ── portfolio stats ────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const uniqueLenders = lenderRows.length;
    const totalPortfolio = lenderRows.reduce(
      (s, r) => s + r.totalPrincipal,
      0
    );
    const largest = lenderRows[0]?.lenderName ?? '—';
    const mostActive =
      [...lenderRows].sort((a, b) => b.activeLoanCount - a.activeLoanCount)[0]
        ?.lenderName ?? '—';
    return { uniqueLenders, totalPortfolio, largest, mostActive };
  }, [lenderRows]);

  // ── export ─────────────────────────────────────────────────────────────────

  const exportExcel = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Lender Summary');
      ws.columns = [
        { header: 'Lender', key: 'lenderName', width: 30 },
        { header: 'Total Loans', key: 'loanCount', width: 14 },
        { header: 'Active Loans', key: 'activeLoanCount', width: 14 },
        { header: 'Total Principal (INR)', key: 'totalPrincipal', width: 22 },
        { header: 'Total Paid (INR)', key: 'totalPaid', width: 18 },
        { header: 'Outstanding (INR)', key: 'totalOutstanding', width: 20 },
        { header: 'Avg Interest Rate (%)', key: 'avgRate', width: 22 },
        { header: 'Monthly EMI (INR)', key: 'totalEMI', width: 20 },
      ];
      lenderRows.forEach((r) =>
        ws.addRow({
          lenderName: r.lenderName,
          loanCount: r.loanCount,
          activeLoanCount: r.activeLoanCount,
          totalPrincipal: r.totalPrincipal,
          totalPaid: r.totalPaid,
          totalOutstanding: r.totalOutstanding,
          avgRate: parseFloat(r.avgRate.toFixed(2)),
          totalEMI: r.totalEMI,
        })
      );
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lender-summary-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
    } finally {
      setIsExporting(false);
    }
  };

  // ── loading skeleton ───────────────────────────────────────────────────────

  if (isAuthLoading || (isLoading && canView)) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-full rounded-xl" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  // ── access denied ──────────────────────────────────────────────────────────

  if (!canView) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Access Denied</CardTitle>
          <CardDescription>
            You do not have permission to view loan reports.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* ── Header card ── */}
      <Card className="overflow-hidden border-border/60">
        <div className="h-1 w-full bg-gradient-to-r from-amber-500 via-orange-500 to-yellow-500" />
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Link href="/loan/reports">
              <Button variant="ghost" size="sm" className="gap-1.5 text-xs">
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 ring-1 ring-amber-100">
                <Landmark className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <CardTitle className="tracking-tight text-base">
                  Lender Summary
                </CardTitle>
                <CardDescription>
                  Portfolio exposure grouped by lending institution
                </CardDescription>
              </div>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={exportExcel}
            disabled={isExporting || lenderRows.length === 0}
            className="shrink-0"
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            {isExporting ? 'Exporting…' : 'Export Excel'}
          </Button>
        </CardHeader>
      </Card>

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          {
            label: 'Unique Lenders',
            value: stats.uniqueLenders,
            sub: 'distinct institutions',
          },
          {
            label: 'Total Portfolio',
            value: fmt(stats.totalPortfolio),
            sub: 'sum of all loan principals',
          },
          {
            label: 'Largest Lender',
            value: stats.largest,
            sub: 'by total principal',
          },
          {
            label: 'Most Active',
            value: stats.mostActive,
            sub: 'by active loan count',
          },
        ].map((s) => (
          <Card key={s.label} className="border-border/60">
            <CardContent className="flex flex-col justify-between p-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {s.label}
              </p>
              <p className="mt-2 truncate text-xl font-bold leading-tight text-slate-800 sm:text-2xl">
                {s.value}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{s.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Table / empty state ── */}
      <Card className="overflow-hidden border-border/60">
        <div className="h-1 w-full bg-gradient-to-r from-amber-400 via-orange-400 to-yellow-400 opacity-70" />
        <CardHeader className="pb-2">
          <CardTitle className="text-base">By Lender</CardTitle>
          <CardDescription>
            Sorted by total principal — descending. Outstanding bar shows proportion repaid.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {lenderRows.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-muted-foreground">
              No loan data available.
            </div>
          ) : (
            <>
              {/* ── Mobile cards (sm:hidden) ── */}
              <div className="divide-y sm:hidden">
                {lenderRows.map((r) => {
                  const pctRepaid =
                    r.totalPrincipal > 0
                      ? Math.min(
                          100,
                          Math.round((r.totalPaid / r.totalPrincipal) * 100)
                        )
                      : 0;
                  return (
                    <div key={r.lenderName} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-800">
                            {r.lenderName}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {r.loanCount} loan{r.loanCount !== 1 ? 's' : ''} •{' '}
                            {r.activeLoanCount} active
                          </p>
                        </div>
                        <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                          {fmtPct(r.avgRate)} avg
                        </span>
                      </div>

                      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <div>
                          <span className="block font-medium text-slate-700">
                            {fmt(r.totalPrincipal)}
                          </span>
                          <span>Total Principal</span>
                        </div>
                        <div>
                          <span className="block font-medium text-slate-700">
                            {fmt(r.totalPaid)}
                          </span>
                          <span>Total Paid</span>
                        </div>
                        <div>
                          <span className="block font-medium text-rose-600">
                            {fmt(r.totalOutstanding)}
                          </span>
                          <span>Outstanding</span>
                        </div>
                        <div>
                          <span className="block font-medium text-slate-700">
                            {fmt(r.totalEMI)}
                          </span>
                          <span>Monthly EMI</span>
                        </div>
                      </div>

                      {/* progress bar */}
                      <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-400"
                          style={{ width: `${pctRepaid}%` }}
                        />
                      </div>
                      <p className="mt-0.5 text-right text-[10px] text-muted-foreground">
                        {pctRepaid}% repaid
                      </p>
                    </div>
                  );
                })}
              </div>

              {/* ── Desktop table (hidden sm:block) ── */}
              <div className="hidden sm:block">
                <div className="h-[calc(100vh-380px)] overflow-auto [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-200">
                  <table className="w-full caption-bottom text-sm">
                    <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-slate-50 [&_th]:shadow-sm">
                      <TableRow>
                        <TableHead className="pl-4 min-w-[180px]">Lender</TableHead>
                        <TableHead className="min-w-[70px] text-center">Loans</TableHead>
                        <TableHead className="min-w-[70px] text-center">Active</TableHead>
                        <TableHead className="min-w-[160px] text-right">
                          Total Principal
                        </TableHead>
                        <TableHead className="min-w-[140px] text-right">
                          Total Paid
                        </TableHead>
                        <TableHead className="min-w-[200px] text-right">
                          Outstanding
                        </TableHead>
                        <TableHead className="min-w-[100px] text-center">
                          Avg Rate
                        </TableHead>
                        <TableHead className="min-w-[140px] pr-4 text-right">
                          Monthly EMI
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lenderRows.map((r) => {
                        const pctOutstanding =
                          r.totalPrincipal > 0
                            ? Math.min(
                                100,
                                Math.round(
                                  (r.totalOutstanding / r.totalPrincipal) * 100
                                )
                              )
                            : 0;
                        return (
                          <TableRow
                            key={r.lenderName}
                            className="hover:bg-slate-50/60 transition-colors"
                          >
                            <TableCell className="pl-4 font-medium">
                              {r.lenderName}
                            </TableCell>
                            <TableCell className="text-center tabular-nums">
                              {r.loanCount}
                            </TableCell>
                            <TableCell className="text-center">
                              <span className="inline-flex items-center justify-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                                {r.activeLoanCount}
                              </span>
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-medium">
                              {fmt(r.totalPrincipal)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-emerald-700">
                              {fmt(r.totalPaid)}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex flex-col items-end gap-1">
                                <span className="tabular-nums font-medium text-rose-600">
                                  {fmt(r.totalOutstanding)}
                                </span>
                                {r.totalPrincipal > 0 && (
                                  <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
                                    <div
                                      className="h-full rounded-full bg-gradient-to-r from-rose-400 to-orange-400"
                                      style={{ width: `${pctOutstanding}%` }}
                                    />
                                  </div>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-center">
                              <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                                {fmtPct(r.avgRate)}
                              </span>
                            </TableCell>
                            <TableCell className="pr-4 text-right tabular-nums font-medium">
                              {fmt(r.totalEMI)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </table>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

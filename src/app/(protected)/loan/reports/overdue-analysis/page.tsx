'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
} from 'lucide-react';
import ExcelJS from 'exceljs';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Loan, EMI } from '@/lib/types';
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

const fmtDate = (d: Date) =>
  d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

const daysOverdue = (d: Date) =>
  Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));

type OverdueTier = 'low' | 'medium' | 'high';

function getTier(days: number): OverdueTier {
  if (days <= 7) return 'low';
  if (days <= 30) return 'medium';
  return 'high';
}

const TIER_STYLES: Record<
  OverdueTier,
  { badge: string; border: string; days: string }
> = {
  low: {
    badge: 'bg-amber-100 text-amber-800',
    border: 'border-l-amber-400',
    days: 'text-amber-700 bg-amber-50',
  },
  medium: {
    badge: 'bg-orange-100 text-orange-800',
    border: 'border-l-orange-400',
    days: 'text-orange-700 bg-orange-50',
  },
  high: {
    badge: 'bg-rose-100 text-rose-800',
    border: 'border-l-rose-500',
    days: 'text-rose-700 bg-rose-50',
  },
};

// ─── types ──────────────────────────────────────────────────────────────────

interface OverdueRow {
  loan: Loan;
  emi: EMI;
  dueDate: Date;
  days: number;
  tier: OverdueTier;
}

// ─── component ──────────────────────────────────────────────────────────────

export default function OverdueAnalysisPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canView = can('View', 'Loan.Reports');

  const [rows, setRows] = useState<OverdueRow[]>([]);
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
        const loansSnap = await getDocs(collection(db, 'loans'));
        const loans = loansSnap.docs.map(
          (d) => ({ id: d.id, ...d.data() } as Loan)
        );

        const now = new Date();
        const collected: OverdueRow[] = [];

        await Promise.all(
          loans.map(async (loan) => {
            const emisSnap = await getDocs(
              collection(db, 'loans', loan.id, 'emis')
            );
            emisSnap.docs.forEach((d) => {
              const emi = { id: d.id, ...d.data() } as EMI;
              const dueDate = emi.dueDate.toDate();
              const isOverdue =
                emi.status === 'Overdue' ||
                (emi.status !== 'Paid' && dueDate < now);
              if (!isOverdue) return;
              const days = daysOverdue(dueDate);
              collected.push({ loan, emi, dueDate, days, tier: getTier(days) });
            });
          })
        );

        // sort most-overdue first
        collected.sort((a, b) => b.days - a.days);
        setRows(collected);
      } catch (err) {
        console.error('Failed to load overdue EMIs', err);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [isAuthLoading, canView]);

  // ── stats ──────────────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const totalEMIs = rows.length;
    const totalAmount = rows.reduce((s, r) => s + (r.emi.emiAmount || 0), 0);
    const uniqueLoans = new Set(rows.map((r) => r.loan.id)).size;
    const mostOverdue = rows[0]?.days ?? 0;
    return { totalEMIs, totalAmount, uniqueLoans, mostOverdue };
  }, [rows]);

  // ── export ─────────────────────────────────────────────────────────────────

  const exportExcel = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Overdue Analysis');
      ws.columns = [
        { header: 'Loan (Account No)', key: 'accountNo', width: 22 },
        { header: 'Lender', key: 'lenderName', width: 26 },
        { header: 'EMI No', key: 'emiNo', width: 10 },
        { header: 'Due Date', key: 'dueDate', width: 16 },
        { header: 'EMI Amount (INR)', key: 'emiAmount', width: 18 },
        { header: 'Days Overdue', key: 'days', width: 14 },
        { header: 'Status', key: 'status', width: 14 },
      ];
      rows.forEach((r) =>
        ws.addRow({
          accountNo: r.loan.accountNo || r.loan.id,
          lenderName: r.loan.lenderName,
          emiNo: r.emi.emiNo,
          dueDate: fmtDate(r.dueDate),
          emiAmount: r.emi.emiAmount || 0,
          days: r.days,
          status: r.emi.status,
        })
      );
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `overdue-analysis-${new Date().toISOString().slice(0, 10)}.xlsx`;
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
        <div className="h-1 w-full bg-gradient-to-r from-rose-500 via-red-500 to-orange-500" />
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Link href="/loan/reports">
              <Button variant="ghost" size="sm" className="gap-1.5 text-xs">
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-50 ring-1 ring-rose-100">
                <AlertTriangle className="h-5 w-5 text-rose-600" />
              </div>
              <div>
                <CardTitle className="tracking-tight text-base">
                  Overdue Analysis
                </CardTitle>
                <CardDescription>
                  All overdue EMIs sorted by days past due — live snapshot
                </CardDescription>
              </div>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={exportExcel}
            disabled={isExporting || rows.length === 0}
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
            label: 'Total Overdue EMIs',
            value: stats.totalEMIs,
            sub: 'across all loans',
          },
          {
            label: 'Total Overdue Amount',
            value: fmt(stats.totalAmount),
            sub: 'sum of EMI amounts',
          },
          {
            label: 'Loans Affected',
            value: stats.uniqueLoans,
            sub: 'unique loans with overdue',
          },
          {
            label: 'Most Overdue',
            value: `${stats.mostOverdue} days`,
            sub: 'oldest unpaid EMI',
          },
        ].map((s) => (
          <Card key={s.label} className="border-border/60">
            <CardContent className="flex flex-col justify-between p-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {s.label}
              </p>
              <p className="mt-2 text-xl font-bold leading-tight text-slate-800 sm:text-2xl">
                {s.value}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{s.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Table / empty state ── */}
      <Card className="overflow-hidden border-border/60">
        <div className="h-1 w-full bg-gradient-to-r from-rose-400 via-orange-400 to-amber-400 opacity-70" />
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Overdue EMIs</CardTitle>
          <CardDescription>
            Color-coded by days overdue — amber ≤7, orange 8–30, rose 30+
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            /* ── empty state ── */
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 ring-1 ring-emerald-200">
                <CheckCircle2 className="h-7 w-7 text-emerald-500" />
              </div>
              <p className="text-sm font-medium text-slate-700">
                No overdue EMIs — all payments are current.
              </p>
              <p className="text-xs text-muted-foreground">
                Great job! Every EMI is either paid or not yet due.
              </p>
            </div>
          ) : (
            <>
              {/* ── Mobile cards (sm:hidden) ── */}
              <div className="divide-y sm:hidden">
                {rows.map((r) => {
                  const s = TIER_STYLES[r.tier];
                  return (
                    <div
                      key={`${r.loan.id}-${r.emi.id}`}
                      className={`border-l-4 px-4 py-3 ${s.border}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-800">
                            {r.loan.lenderName}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {r.loan.accountNo || r.loan.id}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${s.badge}`}
                        >
                          {r.emi.status}
                        </span>
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-1 text-xs text-muted-foreground">
                        <div>
                          <span className="block font-medium text-slate-700">
                            EMI #{r.emi.emiNo}
                          </span>
                          <span>EMI No</span>
                        </div>
                        <div>
                          <span className="block font-medium text-slate-700">
                            {fmtDate(r.dueDate)}
                          </span>
                          <span>Due Date</span>
                        </div>
                        <div>
                          <span
                            className={`block rounded px-1.5 py-0.5 font-bold tabular-nums ${s.days}`}
                          >
                            {r.days}d
                          </span>
                          <span>Days Past</span>
                        </div>
                      </div>
                      <p className="mt-1.5 text-right text-sm font-semibold text-slate-700">
                        {fmt(r.emi.emiAmount)}
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
                        <TableHead className="pl-4 min-w-[160px]">Loan</TableHead>
                        <TableHead className="min-w-[160px]">Lender</TableHead>
                        <TableHead className="min-w-[80px] text-center">EMI No</TableHead>
                        <TableHead className="min-w-[130px]">Due Date</TableHead>
                        <TableHead className="min-w-[140px] text-right">EMI Amount</TableHead>
                        <TableHead className="min-w-[120px] text-center">Days Overdue</TableHead>
                        <TableHead className="min-w-[100px] pr-4 text-center">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r) => {
                        const s = TIER_STYLES[r.tier];
                        return (
                          <TableRow
                            key={`${r.loan.id}-${r.emi.id}`}
                            className={`border-l-4 hover:bg-slate-50/60 transition-colors ${s.border}`}
                          >
                            <TableCell className="pl-4 font-mono text-xs text-slate-600">
                              {r.loan.accountNo || r.loan.id}
                            </TableCell>
                            <TableCell className="font-medium">
                              {r.loan.lenderName}
                            </TableCell>
                            <TableCell className="text-center tabular-nums">
                              {r.emi.emiNo}
                            </TableCell>
                            <TableCell className="text-slate-600">
                              {fmtDate(r.dueDate)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-medium">
                              {fmt(r.emi.emiAmount)}
                            </TableCell>
                            <TableCell className="text-center">
                              <span
                                className={`inline-flex items-center justify-center rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums ${s.days}`}
                              >
                                {r.days}
                              </span>
                            </TableCell>
                            <TableCell className="pr-4 text-center">
                              <span
                                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${s.badge}`}
                              >
                                {r.emi.status}
                              </span>
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

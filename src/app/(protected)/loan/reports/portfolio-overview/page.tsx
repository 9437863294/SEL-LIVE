
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, BarChart3, Download, Landmark, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import type { Loan } from '@/lib/types';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n || 0);

const statusStyle: Record<Loan['status'], string> = {
  Active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Closed: 'bg-slate-50 text-slate-500 border-slate-200',
  'Pre-closure Pending': 'bg-amber-50 text-amber-700 border-amber-200',
};

export default function PortfolioOverviewPage() {
  const { can, isLoading: authLoading } = useAuthorization();
  const { toast } = useToast();

  const [loans, setLoans] = useState<Loan[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // ── Fetch loans ───────────────────────────────────────────────────────────
  useEffect(() => {
    const fetchLoans = async () => {
      setIsLoading(true);
      try {
        const snap = await getDocs(collection(db, 'loans'));
        setLoans(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Loan)));
      } catch {
        toast({
          title: 'Error',
          description: 'Failed to fetch loan portfolio data.',
          variant: 'destructive',
        });
      } finally {
        setIsLoading(false);
      }
    };
    fetchLoans();
  }, [toast]);

  // ── Portfolio stats ───────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const totalPortfolio = loans.reduce((s, l) => s + l.loanAmount, 0);
    const totalPaid = loans.reduce((s, l) => s + (l.totalPaid ?? 0), 0);
    const totalOutstanding = loans.reduce(
      (s, l) => s + Math.max(0, l.loanAmount - (l.totalPaid ?? 0)),
      0,
    );
    const activeCount = loans.filter((l) => l.status === 'Active').length;
    return { totalPortfolio, totalPaid, totalOutstanding, activeCount };
  }, [loans]);

  // ── By loan type ──────────────────────────────────────────────────────────
  const byType = useMemo(() => {
    const types: ('Loan' | 'Investment')[] = ['Loan', 'Investment'];
    return types.map((type) => {
      const subset = loans.filter((l) => l.loanType === type);
      return {
        type,
        count: subset.length,
        totalPrincipal: subset.reduce((s, l) => s + l.loanAmount, 0),
        totalPaid: subset.reduce((s, l) => s + (l.totalPaid ?? 0), 0),
        totalOutstanding: subset.reduce(
          (s, l) => s + Math.max(0, l.loanAmount - (l.totalPaid ?? 0)),
          0,
        ),
      };
    });
  }, [loans]);

  // ── Excel export ──────────────────────────────────────────────────────────
  const handleExport = async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();

    // Summary sheet
    const ws1 = wb.addWorksheet('Portfolio Summary');
    ws1.addRow(['Metric', 'Value']);
    ws1.getRow(1).font = { bold: true };
    ws1.addRow(['Total Portfolio Value', stats.totalPortfolio]);
    ws1.addRow(['Total Outstanding', stats.totalOutstanding]);
    ws1.addRow(['Total Paid', stats.totalPaid]);
    ws1.addRow(['Active Loans', stats.activeCount]);
    ws1.getColumn(1).width = 28;
    ws1.getColumn(2).width = 20;

    // By type sheet
    const ws2 = wb.addWorksheet('By Loan Type');
    ws2.columns = [
      { header: 'Type', key: 'type', width: 16 },
      { header: 'Count', key: 'count', width: 10 },
      { header: 'Total Principal', key: 'principal', width: 20 },
      { header: 'Total Paid', key: 'paid', width: 20 },
      { header: 'Outstanding', key: 'outstanding', width: 20 },
    ];
    ws2.getRow(1).font = { bold: true };
    byType.forEach((r) =>
      ws2.addRow({
        type: r.type,
        count: r.count,
        principal: r.totalPrincipal,
        paid: r.totalPaid,
        outstanding: r.totalOutstanding,
      }),
    );

    // All loans sheet
    const ws3 = wb.addWorksheet('All Loans');
    ws3.columns = [
      { header: 'Account No', key: 'accountNo', width: 20 },
      { header: 'Lender', key: 'lender', width: 24 },
      { header: 'Type', key: 'type', width: 14 },
      { header: 'Principal', key: 'principal', width: 18 },
      { header: 'EMI Amount', key: 'emi', width: 16 },
      { header: 'Rate (%)', key: 'rate', width: 12 },
      { header: 'Tenure (mo)', key: 'tenure', width: 14 },
      { header: 'Total Paid', key: 'paid', width: 18 },
      { header: 'Outstanding', key: 'outstanding', width: 18 },
      { header: 'Progress (%)', key: 'progress', width: 14 },
      { header: 'Status', key: 'status', width: 22 },
    ];
    ws3.getRow(1).font = { bold: true };
    loans.forEach((l) => {
      const outstanding = Math.max(0, l.loanAmount - (l.totalPaid ?? 0));
      const progress =
        l.loanAmount > 0 ? Math.round(((l.totalPaid ?? 0) / l.loanAmount) * 100) : 0;
      ws3.addRow({
        accountNo: l.accountNo,
        lender: l.lenderName,
        type: l.loanType,
        principal: l.loanAmount,
        emi: l.emiAmount,
        rate: l.interestRate,
        tenure: l.tenure,
        paid: l.totalPaid ?? 0,
        outstanding,
        progress,
        status: l.status,
      });
    });

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'loan-portfolio-overview.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Auth guard ────────────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-xl" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!can('View', 'Loan.Reports')) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Access Denied</CardTitle>
          <CardDescription>You do not have permission to view loan reports.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Header card ─────────────────────────────────────────────────── */}
      <Card className="overflow-hidden border-border/60">
        <div className="h-1 w-full bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500" />
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Link href="/loan/reports">
              <Button variant="ghost" size="sm" className="gap-1.5 text-xs">
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 ring-1 ring-emerald-100">
                <BarChart3 className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <CardTitle className="text-base tracking-tight">Portfolio Overview</CardTitle>
                <CardDescription>
                  All loans at a glance — outstanding, paid, and type breakdown
                </CardDescription>
              </div>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 text-xs"
            onClick={handleExport}
            disabled={isLoading || loans.length === 0}
          >
            <Download className="h-3.5 w-3.5" /> Export
          </Button>
        </CardHeader>
      </Card>

      {/* ── Stat cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          {
            label: 'Total Portfolio Value',
            value: isLoading ? null : fmt(stats.totalPortfolio),
            color: 'text-slate-700',
            icon: Landmark,
            iconBg: 'bg-slate-100',
            iconColor: 'text-slate-600',
          },
          {
            label: 'Total Outstanding',
            value: isLoading ? null : fmt(stats.totalOutstanding),
            color: 'text-amber-600',
            icon: TrendingUp,
            iconBg: 'bg-amber-50',
            iconColor: 'text-amber-600',
          },
          {
            label: 'Total Paid',
            value: isLoading ? null : fmt(stats.totalPaid),
            color: 'text-emerald-600',
            icon: BarChart3,
            iconBg: 'bg-emerald-50',
            iconColor: 'text-emerald-600',
          },
          {
            label: 'Active Loans',
            value: isLoading ? null : stats.activeCount.toString(),
            color: 'text-blue-600',
            icon: BarChart3,
            iconBg: 'bg-blue-50',
            iconColor: 'text-blue-600',
          },
        ].map((s) => (
          <Card key={s.label} className="border-border/60">
            <CardContent className="pt-4 pb-4">
              {isLoading ? (
                <Skeleton className="h-12 w-full" />
              ) : (
                <div className="flex flex-col">
                  <span className={`text-lg font-bold leading-tight ${s.color}`}>{s.value}</span>
                  <span className="text-[11px] text-muted-foreground mt-0.5">{s.label}</span>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── By Loan Type ─────────────────────────────────────────────────── */}
      <Card className="overflow-hidden border-border/60">
        <CardHeader className="py-3 px-4 border-b">
          <CardTitle className="text-sm font-semibold">Breakdown by Loan Type</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <table className="w-full caption-bottom text-sm">
              <thead>
                <tr className="border-b bg-slate-50">
                  <th className="py-2 px-4 text-left text-xs font-semibold text-muted-foreground">Type</th>
                  <th className="py-2 px-4 text-center text-xs font-semibold text-muted-foreground">Count</th>
                  <th className="py-2 px-4 text-right text-xs font-semibold text-muted-foreground">Total Principal</th>
                  <th className="py-2 px-4 text-right text-xs font-semibold text-muted-foreground">Total Paid</th>
                  <th className="py-2 px-4 text-right text-xs font-semibold text-muted-foreground">Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {byType.map((r) => (
                  <tr key={r.type} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="py-2.5 px-4 text-xs font-medium">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                          r.type === 'Loan'
                            ? 'bg-blue-50 text-blue-700 border-blue-200'
                            : 'bg-violet-50 text-violet-700 border-violet-200'
                        }`}
                      >
                        {r.type}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-center text-xs text-muted-foreground">{r.count}</td>
                    <td className="py-2.5 px-4 text-right text-xs text-slate-700">{fmt(r.totalPrincipal)}</td>
                    <td className="py-2.5 px-4 text-right text-xs text-emerald-700">{fmt(r.totalPaid)}</td>
                    <td className="py-2.5 px-4 text-right text-xs text-amber-700">{fmt(r.totalOutstanding)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* ── All Loans table (desktop) ─────────────────────────────────────── */}
      <Card className="hidden overflow-hidden border-border/60 sm:block">
        <CardHeader className="py-3 px-4 border-b">
          <CardTitle className="text-sm font-semibold">All Loans</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : loans.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              No loans found.
            </div>
          ) : (
            <div className="overflow-auto h-[calc(100vh-560px)] min-h-[240px]">
              <table className="w-full caption-bottom text-sm [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-slate-50">
                <thead>
                  <tr className="border-b">
                    {[
                      { label: 'Loan / Lender', align: 'text-left' },
                      { label: 'Principal', align: 'text-right' },
                      { label: 'EMI', align: 'text-right' },
                      { label: 'Rate', align: 'text-right' },
                      { label: 'Tenor', align: 'text-right' },
                      { label: 'Paid', align: 'text-right' },
                      { label: 'Outstanding', align: 'text-right' },
                      { label: 'Progress', align: 'text-left' },
                      { label: 'Status', align: 'text-center' },
                    ].map((h) => (
                      <th
                        key={h.label}
                        className={`py-2 px-3 ${h.align} text-xs font-semibold text-muted-foreground whitespace-nowrap border-b`}
                      >
                        {h.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loans.map((loan) => {
                    const outstanding = Math.max(0, loan.loanAmount - (loan.totalPaid ?? 0));
                    const progress =
                      loan.loanAmount > 0
                        ? Math.min(100, Math.round(((loan.totalPaid ?? 0) / loan.loanAmount) * 100))
                        : 0;
                    return (
                      <tr
                        key={loan.id}
                        className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                      >
                        <td className="py-2.5 px-3">
                          <div className="text-xs font-medium text-slate-800">{loan.accountNo}</div>
                          <div className="text-[11px] text-muted-foreground">{loan.lenderName}</div>
                        </td>
                        <td className="py-2.5 px-3 text-right text-xs text-slate-700">
                          {fmt(loan.loanAmount)}
                        </td>
                        <td className="py-2.5 px-3 text-right text-xs text-slate-600">
                          {fmt(loan.emiAmount)}
                        </td>
                        <td className="py-2.5 px-3 text-right text-xs text-slate-600">
                          {loan.interestRate}%
                        </td>
                        <td className="py-2.5 px-3 text-right text-xs text-slate-600">
                          {loan.tenure} mo
                        </td>
                        <td className="py-2.5 px-3 text-right text-xs text-emerald-700">
                          {fmt(loan.totalPaid ?? 0)}
                        </td>
                        <td className="py-2.5 px-3 text-right text-xs text-amber-700">
                          {fmt(outstanding)}
                        </td>
                        <td className="py-2.5 px-3 min-w-[120px]">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-500 transition-all"
                                style={{ width: `${progress}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-muted-foreground w-8 text-right shrink-0">
                              {progress}%
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium whitespace-nowrap ${statusStyle[loan.status]}`}
                          >
                            {loan.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Mobile card list ──────────────────────────────────────────────── */}
      <div className="space-y-3 sm:hidden">
        {isLoading ? (
          [...Array(3)].map((_, i) => <Skeleton key={i} className="h-36 w-full rounded-xl" />)
        ) : loans.length === 0 ? (
          <div className="flex h-32 items-center justify-center rounded-xl border text-sm text-muted-foreground">
            No loans found.
          </div>
        ) : (
          loans.map((loan) => {
            const outstanding = Math.max(0, loan.loanAmount - (loan.totalPaid ?? 0));
            const progress =
              loan.loanAmount > 0
                ? Math.min(100, Math.round(((loan.totalPaid ?? 0) / loan.loanAmount) * 100))
                : 0;
            return (
              <Card key={loan.id} className="overflow-hidden border-border/60">
                <CardContent className="p-4 space-y-3">
                  {/* Title row */}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-slate-800">{loan.accountNo}</div>
                      <div className="text-xs text-muted-foreground">{loan.lenderName}</div>
                    </div>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium whitespace-nowrap ${statusStyle[loan.status]}`}
                    >
                      {loan.status}
                    </span>
                  </div>

                  {/* Key fields */}
                  <div className="grid grid-cols-2 gap-y-1.5 gap-x-4 text-xs">
                    <div>
                      <span className="text-muted-foreground">Principal</span>
                      <div className="font-medium text-slate-700">{fmt(loan.loanAmount)}</div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">EMI</span>
                      <div className="font-medium text-slate-700">{fmt(loan.emiAmount)}</div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Paid</span>
                      <div className="font-medium text-emerald-700">{fmt(loan.totalPaid ?? 0)}</div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Outstanding</span>
                      <div className="font-medium text-amber-700">{fmt(outstanding)}</div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Rate</span>
                      <div className="font-medium">{loan.interestRate}%</div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Tenor</span>
                      <div className="font-medium">{loan.tenure} months</div>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div>
                    <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                      <span>Repayment progress</span>
                      <span>{progress}%</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-500 transition-all"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}

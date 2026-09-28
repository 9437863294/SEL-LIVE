
'use client';

import { useState, useEffect, useMemo } from 'react';
import { BarChart3, Download, Landmark, TrendingUp } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableCard } from '@/components/shared/table-card';
import { StatusBadge } from '@/components/shared/status-badge';
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
      <PageHeader
        icon={BarChart3}
        title="Portfolio Overview"
        description="All loans at a glance — outstanding, paid, and type breakdown"
        backHref="/loan/reports"
        backLabel="Back to loan reports"
        actions={
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 text-xs"
            onClick={handleExport}
            disabled={isLoading || loans.length === 0}
          >
            <Download className="h-3.5 w-3.5" /> Export
          </Button>
        }
      />

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
      <TableCard title="Breakdown by Loan Type" scroll="natural">
          {isLoading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-center">Count</TableHead>
                  <TableHead className="text-right">Total Principal</TableHead>
                  <TableHead className="text-right">Total Paid</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byType.map((r) => (
                  <TableRow key={r.type}>
                    <TableCell className="font-medium">
                      <Badge variant="outline">{r.type}</Badge>
                    </TableCell>
                    <TableCell className="text-center tabular-nums">{r.count}</TableCell>
                    <TableCell className="text-right whitespace-nowrap tabular-nums">{fmt(r.totalPrincipal)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap tabular-nums">{fmt(r.totalPaid)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap tabular-nums">{fmt(r.totalOutstanding)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
      </TableCard>

      {/* ── All Loans (desktop table + mobile cards) ──────────────────────── */}
      <TableCard
        title="All Loans"
        count={isLoading ? undefined : loans.length}
        noun="loan"
      >
          {isLoading ? (
            <div className="space-y-2 p-4">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : loans.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              No loans found.
            </div>
          ) : (
            <>
              <Table containerClassName="hidden sm:block">
                <TableHeader>
                  <TableRow>
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
                      <TableHead key={h.label} className={`${h.align} whitespace-nowrap`}>
                        {h.label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loans.map((loan) => {
                    const outstanding = Math.max(0, loan.loanAmount - (loan.totalPaid ?? 0));
                    const progress =
                      loan.loanAmount > 0
                        ? Math.min(100, Math.round(((loan.totalPaid ?? 0) / loan.loanAmount) * 100))
                        : 0;
                    return (
                      <TableRow key={loan.id}>
                        <TableCell>
                          <div className="font-medium">{loan.accountNo}</div>
                          <div className="text-xs text-muted-foreground">{loan.lenderName}</div>
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap tabular-nums">
                          {fmt(loan.loanAmount)}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap tabular-nums">
                          {fmt(loan.emiAmount)}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap tabular-nums">
                          {loan.interestRate}%
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap tabular-nums">
                          {loan.tenure} mo
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap tabular-nums">
                          {fmt(loan.totalPaid ?? 0)}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap tabular-nums">
                          {fmt(outstanding)}
                        </TableCell>
                        <TableCell className="min-w-[120px]">
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
                        </TableCell>
                        <TableCell className="text-center">
                          <StatusBadge status={loan.status} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

      {/* ── Mobile card list ──────────────────────────────────────────────── */}
      <div className="space-y-3 p-3 sm:hidden">
        {loans.map((loan) => {
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
                    <StatusBadge status={loan.status} className="shrink-0" />
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
          })}
      </div>
            </>
          )}
      </TableCard>
    </div>
  );
}

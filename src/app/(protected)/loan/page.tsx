
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  BadgeIndianRupee,
  Briefcase,
  CalendarClock,
  CheckCircle2,
  CreditCard,
  Plus,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { addDays, format, isPast, isWithinInterval, startOfDay } from 'date-fns';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import type { EMI, Loan } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

// ─── helpers ─────────────────────────────────────────────────────────────────

const fmtCur = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);

const emiStatus = (emi: EMI): 'paid' | 'overdue' | 'pending' => {
  if (emi.status === 'Paid') return 'paid';
  const due = emi.dueDate?.toDate?.();
  if (due && isPast(startOfDay(due))) return 'overdue';
  return 'pending';
};

const LOAN_STATUS_CFG: Record<string, { cls: string }> = {
  Active:                { cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  Closed:                { cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  'Pre-closure Pending': { cls: 'bg-amber-100 text-amber-700 border-amber-200' },
};

// ─── page ─────────────────────────────────────────────────────────────────────

export default function LoanDashboardPage() {
  const { toast } = useToast();
  const { can } = useAuthorization();
  const canCreate = can('Create', 'Loan');

  const [loans, setLoans] = useState<Loan[]>([]);
  const [allEmis, setAllEmis] = useState<(EMI & { loanId: string })[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const loansSnap = await getDocs(collection(db, 'loans'));
      const loansData = loansSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Loan));
      setLoans(loansData);

      const emisArrays = await Promise.all(
        loansData.map((loan) =>
          getDocs(collection(db, 'loans', loan.id, 'emis')).then((snap) =>
            snap.docs.map((d) => ({ ...(d.data() as EMI), id: d.id, loanId: loan.id }))
          )
        )
      );
      setAllEmis(emisArrays.flat());
    } catch {
      toast({ title: 'Error', description: 'Failed to fetch loan data.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []); // eslint-disable-line

  // ─── derived ────────────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const activeLoans = loans.filter((l) => l.status === 'Active');
    const totalPrincipal = loans.reduce((s, l) => s + (l.loanAmount || 0), 0);
    const totalInterest   = allEmis.reduce((s, e) => s + (e.interest || 0), 0);
    const totalPaid       = loans.reduce((s, l) => s + (l.totalPaid || 0), 0);
    const totalPayable    = totalPrincipal + totalInterest;
    const outstanding     = totalPayable - totalPaid;
    const monthlyEmi      = activeLoans.reduce((s, l) => s + (l.emiAmount || 0), 0);
    const overdueCount    = allEmis.filter((e) => emiStatus(e) === 'overdue').length;
    return { totalPrincipal, totalInterest, totalPayable, totalPaid, outstanding, monthlyEmi, active: activeLoans.length, closed: loans.filter((l) => l.status === 'Closed').length, overdueCount };
  }, [loans, allEmis]);

  const overdueEmis = useMemo(() =>
    allEmis
      .filter((e) => emiStatus(e) === 'overdue')
      .map((e) => ({ ...e, loan: loans.find((l) => l.id === e.loanId) }))
      .sort((a, b) => (a.dueDate?.toDate?.()?.getTime() ?? 0) - (b.dueDate?.toDate?.()?.getTime() ?? 0))
      .slice(0, 5),
  [allEmis, loans]);

  const upcomingEmis = useMemo(() => {
    const today = new Date();
    const cutoff = addDays(today, 30);
    return allEmis
      .filter((e) => {
        const d = e.dueDate?.toDate?.();
        return d && e.status !== 'Paid' && isWithinInterval(d, { start: today, end: cutoff });
      })
      .map((e) => ({ ...e, loan: loans.find((l) => l.id === e.loanId) }))
      .sort((a, b) => (a.dueDate?.toDate?.()?.getTime() ?? 0) - (b.dueDate?.toDate?.()?.getTime() ?? 0))
      .slice(0, 6);
  }, [allEmis, loans]);

  const loansWithProgress = useMemo(() =>
    loans.map((loan) => {
      const loanEmis = allEmis.filter((e) => e.loanId === loan.id);
      loanEmis.sort((a, b) => a.emiNo - b.emiNo);
      const totalInterest = loanEmis.reduce((s, e) => s + (e.interest || 0), 0);
      const paidCount     = loanEmis.filter((e) => e.status === 'Paid').length;
      const overdueCount  = loanEmis.filter((e) => emiStatus(e) === 'overdue').length;
      const dueDay        = loanEmis[0] ? format(loanEmis[0].dueDate.toDate(), 'd') : '—';
      const pctPaid       = loan.tenure > 0 ? Math.round((paidCount / loan.tenure) * 100) : 0;
      const balance       = (loan.loanAmount + totalInterest) - (loan.totalPaid || 0);
      return { ...loan, totalInterest, paidCount, overdueCount, dueDay, pctPaid, balance, remainingMonths: loan.tenure - paidCount };
    }),
  [loans, allEmis]);

  // ─── loading ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-28 w-full rounded-xl" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[1,2,3,4].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
        <Skeleton className="h-56 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <Card className="relative overflow-hidden border-0 bg-gradient-to-r from-emerald-600 via-teal-500 to-cyan-600 text-white shadow-lg">
        <div className="absolute inset-0 opacity-10 bg-[radial-gradient(ellipse_at_top_right,_white_0%,_transparent_60%)]" />
        <CardContent className="relative flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm">
              <CreditCard className="h-7 w-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Loan Dashboard</h1>
              <p className="mt-0.5 text-sm text-emerald-100">Track loans, EMI schedules, and repayment progress</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {stats.overdueCount > 0 && (
              <Badge className="gap-1.5 bg-red-500/90 text-white shadow-sm text-xs">
                <AlertTriangle className="h-3 w-3" />
                {stats.overdueCount} EMI{stats.overdueCount !== 1 ? 's' : ''} Overdue
              </Badge>
            )}
            <Button size="sm" variant="secondary" onClick={fetchData} className="gap-1.5 bg-white/20 text-white hover:bg-white/30 border-0">
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
            {canCreate && (
              <Link href="/loan/new">
                <Button size="sm" className="gap-1.5 bg-white text-emerald-700 hover:bg-emerald-50 border-0">
                  <Plus className="h-3.5 w-3.5" /> New Loan
                </Button>
              </Link>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── KPI row ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Total Principal',   value: fmtCur(stats.totalPrincipal), icon: BadgeIndianRupee, gradient: 'from-blue-500 to-indigo-600',   sub: `${loans.length} loans total` },
          { label: 'Monthly EMI',       value: fmtCur(stats.monthlyEmi),      icon: CalendarClock,   gradient: 'from-violet-500 to-purple-600',  sub: `${stats.active} active loan${stats.active !== 1 ? 's' : ''}` },
          { label: 'Total Outstanding', value: fmtCur(stats.outstanding),     icon: TrendingDown,    gradient: 'from-amber-400 to-orange-500',   sub: `Paid: ${fmtCur(stats.totalPaid)}` },
          { label: 'Active / Closed',   value: `${stats.active} / ${stats.closed}`, icon: Briefcase, gradient: 'from-emerald-500 to-teal-600',  sub: `${loans.filter(l => l.status === 'Pre-closure Pending').length} pre-closure` },
        ].map((s) => (
          <Card key={s.label} className="overflow-hidden border-border/60">
            <div className={cn('h-0.5 w-full bg-gradient-to-r', s.gradient)} />
            <CardContent className="flex items-center gap-3 p-4">
              <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br shadow-sm', s.gradient)}>
                <s.icon className="h-5 w-5 text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] text-muted-foreground truncate">{s.label}</p>
                <p className="text-xl font-bold leading-tight truncate">{s.value}</p>
                <p className="text-[11px] text-muted-foreground truncate">{s.sub}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Overdue + Upcoming row ────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">

        {/* Overdue EMIs */}
        <Card className="overflow-hidden border-border/60">
          <div className="h-1 w-full bg-gradient-to-r from-red-500 to-rose-600" />
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-red-500" /> Overdue EMIs
            </CardTitle>
            <CardDescription>Past due date and still unpaid</CardDescription>
          </CardHeader>
          <CardContent>
            {overdueEmis.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <CheckCircle2 className="h-10 w-10 text-emerald-400" />
                <p className="text-sm font-medium text-slate-600">No overdue EMIs</p>
                <p className="text-xs text-muted-foreground">All payments are on track.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {overdueEmis.map((emi) => {
                  const daysOverdue = emi.dueDate?.toDate?.()
                    ? Math.floor((Date.now() - emi.dueDate.toDate().getTime()) / 86400000)
                    : 0;
                  return (
                    <Link key={emi.id} href={`/loan/${emi.loanId}`}>
                      <div className="flex items-center justify-between gap-3 rounded-lg border border-red-100 bg-red-50/60 px-3 py-2.5 cursor-pointer hover:bg-red-50 transition-colors">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-800 truncate">{emi.loan?.lenderName || '—'}</p>
                          <p className="text-[11px] text-muted-foreground">EMI #{emi.emiNo} · {emi.loan?.accountNo}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-xs font-semibold text-red-600">{fmtCur(emi.emiAmount)}</p>
                          <p className="text-[11px] text-muted-foreground">{daysOverdue}d ago</p>
                        </div>
                      </div>
                    </Link>
                  );
                })}
                {stats.overdueCount > 5 && (
                  <Link href="/loan/emi-summary">
                    <Button variant="ghost" size="sm" className="w-full text-xs text-red-600 hover:bg-red-50">
                      View all {stats.overdueCount} overdue EMIs <ArrowRight className="h-3 w-3 ml-1" />
                    </Button>
                  </Link>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Upcoming EMIs */}
        <Card className="overflow-hidden border-border/60">
          <div className="h-1 w-full bg-gradient-to-r from-amber-400 to-orange-500" />
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="h-4 w-4 text-amber-500" /> Upcoming EMIs
            </CardTitle>
            <CardDescription>Due in the next 30 days</CardDescription>
          </CardHeader>
          <CardContent>
            {upcomingEmis.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <CheckCircle2 className="h-10 w-10 text-emerald-400" />
                <p className="text-sm font-medium text-slate-600">No upcoming EMIs</p>
                <p className="text-xs text-muted-foreground">No payments due in the next 30 days.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {upcomingEmis.map((emi) => {
                  const due = emi.dueDate?.toDate?.();
                  const daysLeft = due ? Math.ceil((due.getTime() - Date.now()) / 86400000) : null;
                  const urgent = daysLeft !== null && daysLeft <= 5;
                  return (
                    <Link key={emi.id} href={`/loan/${emi.loanId}`}>
                      <div className={cn('flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors', urgent ? 'border-amber-200 bg-amber-50/60 hover:bg-amber-50' : 'border-border/60 bg-muted/30 hover:bg-muted/50')}>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-800 truncate">{emi.loan?.lenderName || '—'}</p>
                          <p className="text-[11px] text-muted-foreground">EMI #{emi.emiNo} · {due ? format(due, 'dd MMM') : '—'}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-xs font-semibold text-slate-700">{fmtCur(emi.emiAmount)}</p>
                          {daysLeft !== null && (
                            <p className={cn('text-[11px]', urgent ? 'text-amber-600 font-medium' : 'text-muted-foreground')}>
                              {daysLeft === 0 ? 'Today' : `${daysLeft}d left`}
                            </p>
                          )}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Loans Table ──────────────────────────────────────────────────── */}
      <Card className="overflow-hidden border-border/60">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base">All Loans</CardTitle>
            <CardDescription>Click a row to view full EMI schedule</CardDescription>
          </div>
          {canCreate && (
            <Link href="/loan/manage">
              <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                <Briefcase className="h-3.5 w-3.5" /> Manage
              </Button>
            </Link>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {/* Desktop table */}
          <div className="hidden overflow-x-auto sm:block">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead>Lender</TableHead>
                  <TableHead>A/C No</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Principal</TableHead>
                  <TableHead className="text-right">EMI/mo</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loansWithProgress.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="h-32 text-center">
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <CreditCard className="h-8 w-8 opacity-30" />
                        <span className="text-sm">No loans found.</span>
                        {canCreate && <Link href="/loan/new"><Button size="sm" variant="outline" className="mt-1 gap-1"><Plus className="h-3 w-3" />Add Loan</Button></Link>}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : loansWithProgress.map((loan) => {
                  const statusCfg = LOAN_STATUS_CFG[loan.status] ?? { cls: 'bg-slate-100 text-slate-600' };
                  const hasOverdue = loan.overdueCount > 0;
                  return (
                    <TableRow
                      key={loan.id}
                      className={cn('cursor-pointer transition-colors', hasOverdue ? 'hover:bg-red-50/30' : 'hover:bg-muted/20')}
                      onClick={() => window.location.href = `/loan/${loan.id}`}
                    >
                      <TableCell className="font-medium">{loan.lenderName}</TableCell>
                      <TableCell className="font-mono text-xs">{loan.accountNo}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">{loan.loanType || 'Loan'}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-semibold">{fmtCur(loan.loanAmount)}</TableCell>
                      <TableCell className="text-right">{fmtCur(loan.emiAmount)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{format(new Date(loan.startDate), 'dd MMM yyyy')}</TableCell>
                      <TableCell className="min-w-[120px]">
                        <div className="space-y-1">
                          <div className="flex justify-between text-[11px] text-muted-foreground">
                            <span>{loan.paidCount}/{loan.tenure} paid</span>
                            <span className={hasOverdue ? 'text-red-500 font-medium' : ''}>{hasOverdue ? `${loan.overdueCount} overdue` : `${loan.remainingMonths} left`}</span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                            <div
                              className={cn('h-full rounded-full transition-all', hasOverdue ? 'bg-gradient-to-r from-red-400 to-rose-500' : 'bg-gradient-to-r from-emerald-400 to-teal-500')}
                              style={{ width: `${loan.pctPaid}%` }}
                            />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-semibold">{fmtCur(loan.balance)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn('text-[10px]', statusCfg.cls)}>{loan.status}</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-2 p-3 sm:hidden">
            {loansWithProgress.map((loan) => {
              const statusCfg = LOAN_STATUS_CFG[loan.status] ?? { cls: 'bg-slate-100 text-slate-600' };
              return (
                <div key={loan.id} className="rounded-xl border border-border/60 p-3 cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => window.location.href = `/loan/${loan.id}`}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <p className="font-semibold text-sm">{loan.lenderName}</p>
                      <p className="text-xs text-muted-foreground font-mono">{loan.accountNo}</p>
                    </div>
                    <Badge variant="outline" className={cn('text-[10px] shrink-0', statusCfg.cls)}>{loan.status}</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-1 text-xs mb-2">
                    <div><span className="text-muted-foreground">Principal: </span><span className="font-medium">{fmtCur(loan.loanAmount)}</span></div>
                    <div><span className="text-muted-foreground">EMI: </span><span className="font-medium">{fmtCur(loan.emiAmount)}</span></div>
                    <div><span className="text-muted-foreground">Outstanding: </span><span className="font-medium">{fmtCur(loan.balance)}</span></div>
                    <div><span className="text-muted-foreground">Remaining: </span><span className="font-medium">{loan.remainingMonths}m</span></div>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-500" style={{ width: `${loan.pctPaid}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

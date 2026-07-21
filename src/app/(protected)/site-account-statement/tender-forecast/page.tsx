'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  formatINR, SAS_COLLECTIONS,
  type SASBudget, type SASExpense, type SASProject, type SASTenderBudget,
} from '@/lib/site-account-statement';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertTriangle, BarChart3, CalendarDays, ChevronDown, ChevronUp,
  ShieldAlert, TrendingDown, TrendingUp, Wallet,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const MODULE   = 'Site Account Statement';
const RESOURCE = 'Tender Forecast';

/* ─── helpers ─── */
function shiftMonth(m: string, delta: number): string {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function monthLabel(m: string, short = false): string {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('en-IN', {
    month: short ? 'short' : 'long', year: 'numeric',
  });
}
function getAllMonths(start: string, end: string): string[] {
  const months: string[] = [];
  let cur = start;
  while (cur <= end) { months.push(cur); cur = shiftMonth(cur, 1); }
  return months;
}
function currentMonthStr(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
function formatPct(n: number) { return `${Math.round(n)}%`; }

/* ─── sub-component: per-project report ─── */
interface ProjectForecastProps {
  project: SASProject;
  tb: SASTenderBudget;
  expenses: SASExpense[];
  budgets: SASBudget[];
}

function ProjectForecast({ project, tb, expenses, budgets }: ProjectForecastProps) {
  const months     = useMemo(() => getAllMonths(tb.startMonth, tb.endMonth), [tb.startMonth, tb.endMonth]);
  const totalMonths = months.length;
  const perMonth   = totalMonths > 0 ? tb.tenderAmount / totalMonths : 0;
  const now        = currentMonthStr();

  const rows = useMemo(() => {
    let cumBalance = tb.tenderAmount;

    return months.map((m, idx) => {
      const isFuture  = m > now;
      const isCurrent = m === now;
      const actual    = expenses
        .filter(e => e.projectId === project.id && e.expenseDate.startsWith(m))
        .reduce((s, e) => s + e.expenseAmount, 0);

      const setBudget = budgets.find(
        b => b.projectId === project.id && b.budgetType === 'monthly' && b.period === m
      )?.budgetAmount ?? null;

      const budgetForVariance = setBudget ?? perMonth;
      const planVariance = isFuture ? null : budgetForVariance - actual;

      // Only deduct actual spend for past/current months; future balance stays as-is
      if (!isFuture) cumBalance -= actual;
      const cumBalanceDisplay = isFuture ? null : cumBalance;

      // Running revised monthly: current cumBalance ÷ months still ahead after this row.
      // For past/current rows: balance shrinks as actual spend is deducted → true running figure.
      // For future rows: balance is frozen at last-actual value but remainingAfter keeps
      // decreasing → value rises each row, showing "required rate if you start spending now".
      const remainingAfter = totalMonths - idx - 1;
      const revisedMonthly = remainingAfter > 0 ? cumBalance / remainingAfter : null;

      return { m, perMonth, setBudget, actual, planVariance, cumBalance: cumBalanceDisplay, revisedMonthly, isFuture, isCurrent };
    });
  }, [months, totalMonths, perMonth, tb.tenderAmount, expenses, budgets, project.id, now]);

  const totalSpent = expenses
    .filter(e => e.projectId === project.id && e.expenseDate >= tb.startMonth.slice(0, 7) + '-01')
    .reduce((s, e) => s + e.expenseAmount, 0);

  const balance        = tb.tenderAmount - totalSpent;
  const spentPct       = tb.tenderAmount > 0 ? (totalSpent / tb.tenderAmount) * 100 : 0;
  const completedMonths = rows.filter(r => !r.isFuture).length;
  const remainingMonths = totalMonths - completedMonths;
  const avgActualMonthly = completedMonths > 0 ? totalSpent / completedMonths : 0;
  const runwayMonths   = avgActualMonthly > 0 ? balance / avgActualMonthly : null;
  const recommendedMonthly = remainingMonths > 0 ? balance / remainingMonths : 0;

  const progressColor = spentPct >= 100 ? 'bg-red-500' : spentPct >= 80 ? 'bg-amber-500' : 'bg-emerald-500';
  const isOver = spentPct > 100;

  const isActive = now >= tb.startMonth && now <= tb.endMonth;
  const isEnded  = now > tb.endMonth;

  return (
    <div className="space-y-4">
      {/* 4-cell summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Tender Budget',  value: formatINR(tb.tenderAmount), icon: Wallet,      color: 'text-blue-700',    bg: 'bg-blue-50'    },
          { label: `Per Month (${totalMonths}mo)`, value: formatINR(Math.round(perMonth)), icon: CalendarDays, color: 'text-violet-700', bg: 'bg-violet-50' },
          { label: 'Total Spent',    value: formatINR(totalSpent),       icon: TrendingDown, color: isOver ? 'text-red-700' : 'text-rose-700', bg: isOver ? 'bg-red-50' : 'bg-rose-50' },
          { label: 'Balance',        value: formatINR(balance),          icon: TrendingUp,   color: balance < 0 ? 'text-red-700' : 'text-emerald-700', bg: balance < 0 ? 'bg-red-50' : 'bg-emerald-50' },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className={cn('rounded-xl border px-3 py-2.5', bg)}>
            <div className="flex items-center gap-1.5 mb-1">
              <Icon className={cn('h-3.5 w-3.5 shrink-0', color)} />
              <span className="text-[11px] text-muted-foreground font-medium">{label}</span>
            </div>
            <p className={cn('text-sm sm:text-base font-bold tracking-tight', color)}>{value}</p>
          </div>
        ))}
      </div>

      {/* Progress */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{formatPct(Math.min(spentPct, 100))} of budget consumed</span>
          <span className={isOver ? 'text-red-600 font-semibold' : ''}>{isOver ? `Over by ${formatINR(Math.abs(balance))}` : `${formatINR(balance)} remaining`}</span>
        </div>
        <div className="relative h-2 rounded-full bg-muted overflow-hidden">
          <div className={cn('absolute inset-y-0 left-0 rounded-full transition-all', progressColor)} style={{ width: `${Math.min(spentPct, 100)}%` }} />
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>{completedMonths} of {totalMonths} months elapsed</span>
          {isActive && <span className="text-emerald-600 font-medium">Active · Month {completedMonths + 1}/{totalMonths}</span>}
          {isEnded  && <span className="text-slate-500 font-medium">Ended</span>}
        </div>
      </div>

      {/* Forecast row */}
      {remainingMonths > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Months Remaining', value: `${remainingMonths}`, sub: 'months' },
            { label: 'Recommended Monthly', value: formatINR(Math.round(recommendedMonthly)), sub: 'to stay on track', highlight: true },
            { label: 'Runway at Avg Burn', value: runwayMonths != null ? `${runwayMonths.toFixed(1)} mo` : '—', sub: avgActualMonthly > 0 ? `₹${Math.round(avgActualMonthly).toLocaleString('en-IN')}/mo avg` : 'no data yet' },
          ].map(({ label, value, sub, highlight }) => (
            <div key={label} className={cn('rounded-lg border px-3 py-2 text-center', highlight ? 'bg-blue-50 border-blue-100' : 'bg-muted/30')}>
              <p className="text-[10px] text-muted-foreground mb-0.5">{label}</p>
              <p className={cn('text-sm font-bold', highlight ? 'text-blue-700' : 'text-slate-800')}>{value}</p>
              {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Monthly breakdown table */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-xs min-w-[640px]">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="px-3 py-2 text-left font-semibold text-slate-600">Month</th>
              <th className="px-3 py-2 text-right font-semibold text-slate-600">Planned (₹)</th>
              <th className="px-3 py-2 text-right font-semibold text-slate-600">Set Budget (₹)</th>
              <th className="px-3 py-2 text-right font-semibold text-slate-600">Actual Spent (₹)</th>
              <th className="px-3 py-2 text-right font-semibold text-slate-600">Plan Variance (₹)</th>
              <th className="px-3 py-2 text-right font-semibold text-slate-600">Cum. Balance (₹)</th>
              <th className="px-3 py-2 text-right font-semibold text-blue-700">Revised Budget/Mo (₹)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const isLast = idx === rows.length - 1;
              return (
                <tr
                  key={row.m}
                  className={cn(
                    'border-b last:border-0 transition-colors',
                    row.isCurrent ? 'bg-blue-50/60' : row.isFuture ? 'bg-slate-50/40' : 'hover:bg-muted/20',
                  )}
                >
                  <td className="px-3 py-2 font-medium text-slate-700">
                    <span>{monthLabel(row.m, true)}</span>
                    {row.isCurrent && <Badge className="ml-1.5 text-[9px] px-1 py-0 bg-blue-100 text-blue-700 hover:bg-blue-100">Current</Badge>}
                    {row.isFuture && <span className="ml-1 text-[10px] text-slate-400">forecast</span>}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-600">{formatINR(Math.round(row.perMonth))}</td>
                  <td className="px-3 py-2 text-right">
                    {row.setBudget != null
                      ? <span className="text-violet-700 font-medium">{formatINR(row.setBudget)}</span>
                      : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {row.isFuture
                      ? <span className="text-slate-400">—</span>
                      : <span className={cn('font-medium', row.actual > 0 ? 'text-rose-700' : 'text-slate-500')}>{formatINR(row.actual)}</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {row.planVariance == null
                      ? <span className="text-slate-400">—</span>
                      : <span className={cn('font-medium', row.planVariance < 0 ? 'text-red-600' : 'text-emerald-700')}>
                          {row.planVariance < 0 ? `−${formatINR(Math.abs(row.planVariance))}` : formatINR(row.planVariance)}
                        </span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {row.cumBalance == null
                      ? <span className="text-slate-400">—</span>
                      : <span className={cn('font-semibold', row.cumBalance < 0 ? 'text-red-600' : 'text-emerald-700')}>
                          {row.cumBalance < 0 ? `−${formatINR(Math.abs(row.cumBalance))}` : formatINR(row.cumBalance)}
                        </span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {row.revisedMonthly == null
                      ? <span className="text-slate-400 text-[10px]">{isLast ? 'End' : '—'}</span>
                      : <span className={cn('font-semibold', row.isFuture ? 'text-slate-400' : 'text-blue-700')}>
                          {formatINR(Math.round(row.revisedMonthly))}
                        </span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t bg-slate-50 font-semibold">
              <td className="px-3 py-2 text-slate-700">Total</td>
              <td className="px-3 py-2 text-right text-slate-700">{formatINR(tb.tenderAmount)}</td>
              <td className="px-3 py-2 text-right text-slate-500">—</td>
              <td className="px-3 py-2 text-right text-rose-700">{formatINR(totalSpent)}</td>
              <td className="px-3 py-2 text-right">
                <span className={cn('font-bold', (tb.tenderAmount - totalSpent) < 0 ? 'text-red-600' : 'text-emerald-700')}>
                  {(tb.tenderAmount - totalSpent) < 0
                    ? `−${formatINR(Math.abs(tb.tenderAmount - totalSpent))}`
                    : formatINR(tb.tenderAmount - totalSpent)}
                </span>
              </td>
              <td className="px-3 py-2 text-right text-slate-500">—</td>
              <td className="px-3 py-2 text-right text-slate-500">—</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/* ─── main page ─── */
export default function TenderForecastPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { user } = useAuth();

  const canViewAll = can('View', `${MODULE}.All Projects`);
  const canView    = canViewAll || can('View', `${MODULE}.${RESOURCE}`) || can('Add', `${MODULE}.${RESOURCE}`) || can('Edit', `${MODULE}.${RESOURCE}`);

  const [projects,      setProjects]      = useState<SASProject[]>([]);
  const [tenderBudgets, setTenderBudgets] = useState<SASTenderBudget[]>([]);
  const [expenses,      setExpenses]      = useState<SASExpense[]>([]);
  const [budgets,       setBudgets]       = useState<SASBudget[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [expanded,      setExpanded]      = useState<Set<string>>(new Set());
  const [filterStatus,  setFilterStatus]  = useState<'all' | 'active' | 'ended'>('active');

  useEffect(() => { if (!isAuthLoading) void loadAll(); }, [isAuthLoading]);

  async function loadAll() {
    setLoading(true);
    try {
      const [pSnap, tbSnap, eSnap, bSnap] = await Promise.all([
        getDocs(query(collection(db, SAS_COLLECTIONS.projects), orderBy('projectName'))),
        getDocs(collection(db, SAS_COLLECTIONS.tenderBudgets)),
        getDocs(collection(db, SAS_COLLECTIONS.expenses)),
        getDocs(collection(db, SAS_COLLECTIONS.budgets)),
      ]);
      setProjects(pSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASProject)).filter(p => p.enabledForSiteAccount && p.status === 'Active'));
      setTenderBudgets(tbSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASTenderBudget)));
      setExpenses(eSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASExpense)));
      setBudgets(bSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASBudget)));
    } finally {
      setLoading(false);
    }
  }

  const visibleProjects = useMemo(
    () => canViewAll ? projects : projects.filter(p =>
      p.assignedPersonId === user?.id || p.altUserId === user?.id || p.viewerId === user?.id),
    [projects, user?.id, canViewAll],
  );

  const now = currentMonthStr();
  const configuredProjects = visibleProjects
    .map(p => ({ project: p, tb: tenderBudgets.find(t => t.projectId === p.id) }))
    .filter((x): x is { project: SASProject; tb: SASTenderBudget } => !!x.tb)
    .filter(({ tb }) => {
      if (filterStatus === 'active') return now >= tb.startMonth && now <= tb.endMonth;
      if (filterStatus === 'ended')  return now > tb.endMonth;
      return true;
    });

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function expandAll()   { setExpanded(new Set(configuredProjects.map(x => x.project.id))); }
  function collapseAll() { setExpanded(new Set()); }

  if (loading || isAuthLoading) {
    return <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>;
  }

  if (!canView) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border bg-card py-20 gap-3 text-center">
        <ShieldAlert className="h-11 w-11 text-destructive" />
        <p className="font-semibold text-slate-800">Access Denied</p>
        <p className="text-sm text-muted-foreground">You don&apos;t have permission to access Tender Forecast.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-base sm:text-lg font-bold text-slate-800 flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-teal-600" /> Tender Budget Forecast
          </h1>
          <p className="text-sm text-muted-foreground">Monthly actual vs planned with revised budget projections</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={filterStatus} onValueChange={v => setFilterStatus(v as typeof filterStatus)}>
            <SelectTrigger className="w-[130px] h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active Projects</SelectItem>
              <SelectItem value="ended">Ended Projects</SelectItem>
              <SelectItem value="all">All Projects</SelectItem>
            </SelectContent>
          </Select>
          {configuredProjects.length > 0 && (
            <>
              <button className="text-xs text-teal-600 hover:underline" onClick={expandAll}>Expand All</button>
              <button className="text-xs text-slate-500 hover:underline" onClick={collapseAll}>Collapse All</button>
            </>
          )}
        </div>
      </div>

      {configuredProjects.length === 0 && (
        <Card>
          <CardContent className="py-16 text-center">
            <AlertTriangle className="h-10 w-10 text-amber-400 mx-auto mb-3" />
            <p className="text-muted-foreground text-sm">No{filterStatus !== 'all' ? ` ${filterStatus}` : ''} projects with tender budget setup.</p>
            <p className="text-xs text-muted-foreground mt-1">Go to Tender Setup to configure a project.</p>
          </CardContent>
        </Card>
      )}

      {/* Per-project cards */}
      {configuredProjects.map(({ project, tb }) => {
        const isOpen = expanded.has(project.id);
        const isActive = now >= tb.startMonth && now <= tb.endMonth;
        const isEnded  = now > tb.endMonth;
        const totalMonths = getAllMonths(tb.startMonth, tb.endMonth).length;

        const totalSpent = expenses
          .filter(e => e.projectId === project.id)
          .reduce((s, e) => s + e.expenseAmount, 0);
        const balance  = tb.tenderAmount - totalSpent;
        const spentPct = tb.tenderAmount > 0 ? Math.min((totalSpent / tb.tenderAmount) * 100, 100) : 0;
        const progressColor = spentPct >= 100 ? 'bg-red-500' : spentPct >= 80 ? 'bg-amber-500' : 'bg-emerald-500';

        return (
          <Card key={project.id} className="overflow-hidden">
            <button
              onClick={() => toggleExpand(project.id)}
              className="w-full text-left"
            >
              <div className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-muted/20 transition-colors">
                <div className="min-w-0 flex items-center gap-3 flex-1">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-800 text-sm truncate">{project.projectName}</span>
                      {project.projectCode && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-slate-200 text-slate-500">{project.projectCode}</Badge>
                      )}
                      {isActive && <Badge className="text-[9px] px-1.5 py-0 bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Active</Badge>}
                      {isEnded  && <Badge className="text-[9px] px-1.5 py-0 bg-slate-100 text-slate-500 hover:bg-slate-100">Ended</Badge>}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground flex-wrap">
                      <span>{formatINR(tb.tenderAmount)}</span>
                      <span>·</span>
                      <span>{monthLabel(tb.startMonth, true)} – {monthLabel(tb.endMonth, true)}</span>
                      <span>·</span>
                      <span>{totalMonths} months</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="hidden sm:block w-24">
                    <div className="flex justify-between text-[10px] text-muted-foreground mb-0.5">
                      <span>{formatPct(spentPct)}</span>
                      <span className={balance < 0 ? 'text-red-600' : 'text-emerald-600'}>{balance < 0 ? `−${formatINR(Math.abs(balance))}` : formatINR(balance)}</span>
                    </div>
                    <div className="relative h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className={cn('absolute inset-y-0 left-0 rounded-full', progressColor)} style={{ width: `${spentPct}%` }} />
                    </div>
                  </div>
                  {isOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                </div>
              </div>
            </button>

            {isOpen && (
              <div className="px-4 pb-4 pt-0 border-t">
                <div className="pt-4">
                  <ProjectForecast
                    project={project}
                    tb={tb}
                    expenses={expenses}
                    budgets={budgets}
                  />
                </div>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { SAS_COLLECTIONS, formatINR, type SASExpense, type SASPayment, type SASProject } from '@/lib/site-account-statement';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Building2,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const MODULE = 'Site Account Statement';

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  colorClass,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
  colorClass: string;
}) {
  return (
    <div className={cn('flex items-center gap-4 rounded-xl border bg-white/80 p-4 shadow-sm backdrop-blur-sm', colorClass)}>
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-current/10">
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-bold leading-tight truncate">{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

interface ProjectStat {
  projectId: string;
  projectName: string;
  totalReceived: number;
  totalExpenses: number;
  balance: number;
}

export default function SiteAccountDashboardPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canView = can('View', `${MODULE}.Dashboard`) || can('View Module', MODULE);

  const [projects, setProjects] = useState<SASProject[]>([]);
  const [payments, setPayments] = useState<SASPayment[]>([]);
  const [expenses, setExpenses] = useState<SASExpense[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isAuthLoading || !canView) return;
    void loadAll();
  }, [isAuthLoading, canView]);

  async function loadAll() {
    setLoading(true);
    try {
      const [pSnap, paySnap, expSnap] = await Promise.all([
        getDocs(query(collection(db, SAS_COLLECTIONS.projects))),
        getDocs(query(collection(db, SAS_COLLECTIONS.payments), orderBy('receiptDate', 'desc'))),
        getDocs(query(collection(db, SAS_COLLECTIONS.expenses), orderBy('expenseDate', 'desc'))),
      ]);
      setProjects(pSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASProject)));
      setPayments(paySnap.docs.map(d => ({ id: d.id, ...d.data() } as SASPayment)));
      setExpenses(expSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASExpense)));
    } finally {
      setLoading(false);
    }
  }

  const enabledProjects = useMemo(
    () => projects.filter(p => p.enabledForSiteAccount && p.status === 'Active'),
    [projects]
  );

  const totalReceived = useMemo(() => payments.reduce((s, p) => s + (p.receivedAmount || 0), 0), [payments]);
  const totalExpenses = useMemo(() => expenses.reduce((s, e) => s + (e.expenseAmount || 0), 0), [expenses]);
  const totalBalance  = totalReceived - totalExpenses;

  const projectStats = useMemo<ProjectStat[]>(() => {
    return enabledProjects.map(proj => {
      const received = payments
        .filter(p => p.projectId === proj.id)
        .reduce((s, p) => s + (p.receivedAmount || 0), 0);
      const spent = expenses
        .filter(e => e.projectId === proj.id)
        .reduce((s, e) => s + (e.expenseAmount || 0), 0);
      return {
        projectId: proj.id,
        projectName: proj.projectName,
        totalReceived: received,
        totalExpenses: spent,
        balance: received - spent,
      };
    }).sort((a, b) => b.balance - a.balance);
  }, [enabledProjects, payments, expenses]);

  const highestExpenseProject = useMemo(
    () => [...projectStats].sort((a, b) => b.totalExpenses - a.totalExpenses)[0],
    [projectStats]
  );

  const lowBalanceProjects = useMemo(
    () => projectStats.filter(p => p.balance < 10000),
    [projectStats]
  );

  // Recent 5 transactions across payments + expenses
  const recentTransactions = useMemo(() => {
    type Tx = { date: string; label: string; amount: number; type: 'receipt' | 'expense'; project: string };
    const txs: Tx[] = [
      ...payments.slice(0, 20).map(p => ({
        date: p.receiptDate,
        label: `Payment from HO`,
        amount: p.receivedAmount,
        type: 'receipt' as const,
        project: p.projectName,
      })),
      ...expenses.slice(0, 20).map(e => ({
        date: e.expenseDate,
        label: e.expenseCategory,
        amount: e.expenseAmount,
        type: 'expense' as const,
        project: e.projectName,
      })),
    ];
    return txs.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
  }, [payments, expenses]);

  if (isAuthLoading || loading) {
    return (
      <div className="space-y-4 p-1">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (!canView) {
    return (
      <Card>
        <CardHeader><CardTitle>Access Denied</CardTitle></CardHeader>
        <CardContent><p className="text-muted-foreground">You do not have permission to view the dashboard.</p></CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-slate-800">Site Account Statement</h1>
        <p className="text-sm text-muted-foreground">Project-wise fund movement overview</p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Building2}     label="Enabled Projects"       value={String(enabledProjects.length)} colorClass="text-emerald-600" />
        <StatCard icon={TrendingUp}    label="Total Received from HO"  value={formatINR(totalReceived)}       colorClass="text-blue-600" />
        <StatCard icon={TrendingDown}  label="Total Site Expenses"     value={formatINR(totalExpenses)}       colorClass="text-rose-600" />
        <StatCard
          icon={Wallet}
          label="Total Balance"
          value={formatINR(totalBalance)}
          colorClass={totalBalance >= 0 ? 'text-teal-600' : 'text-destructive'}
        />
      </div>

      {/* Alert cards */}
      {(highestExpenseProject || lowBalanceProjects.length > 0) && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {highestExpenseProject && (
            <div className="flex items-start gap-3 rounded-xl border bg-orange-50 p-4 text-orange-700">
              <BarChart3 className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="text-xs font-medium uppercase tracking-wide">Highest Expense Project</p>
                <p className="font-semibold truncate">{highestExpenseProject.projectName}</p>
                <p className="text-sm">{formatINR(highestExpenseProject.totalExpenses)}</p>
              </div>
            </div>
          )}
          {lowBalanceProjects.length > 0 && (
            <div className="flex items-start gap-3 rounded-xl border bg-rose-50 p-4 text-rose-700">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="text-xs font-medium uppercase tracking-wide">Low Balance Projects</p>
                <p className="font-semibold">{lowBalanceProjects.length} project{lowBalanceProjects.length > 1 ? 's' : ''} below ₹10,000</p>
                <p className="text-sm truncate">{lowBalanceProjects.map(p => p.projectName).join(', ')}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Project-wise summary */}
      <Card className="bg-white/80 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Project-Wise Summary</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {projectStats.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              No enabled projects yet. Configure projects in Project Settings.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="px-4 py-2 text-left font-medium">Project</th>
                    <th className="px-4 py-2 text-right font-medium">Received</th>
                    <th className="px-4 py-2 text-right font-medium">Expenses</th>
                    <th className="px-4 py-2 text-right font-medium">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {projectStats.map(stat => (
                    <tr key={stat.projectId} className="border-b hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2.5 font-medium">{stat.projectName}</td>
                      <td className="px-4 py-2.5 text-right text-blue-600">{formatINR(stat.totalReceived)}</td>
                      <td className="px-4 py-2.5 text-right text-rose-600">{formatINR(stat.totalExpenses)}</td>
                      <td className={cn('px-4 py-2.5 text-right font-semibold', stat.balance >= 0 ? 'text-emerald-600' : 'text-destructive')}>
                        {formatINR(stat.balance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/30 font-semibold">
                    <td className="px-4 py-2.5">Total</td>
                    <td className="px-4 py-2.5 text-right text-blue-700">{formatINR(totalReceived)}</td>
                    <td className="px-4 py-2.5 text-right text-rose-700">{formatINR(totalExpenses)}</td>
                    <td className={cn('px-4 py-2.5 text-right', totalBalance >= 0 ? 'text-emerald-700' : 'text-destructive')}>
                      {formatINR(totalBalance)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Transactions */}
      <Card className="bg-white/80 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent Transactions</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {recentTransactions.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">No transactions yet.</p>
          ) : (
            <div className="divide-y">
              {recentTransactions.map((tx, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <div className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                    tx.type === 'receipt' ? 'bg-blue-100 text-blue-600' : 'bg-rose-100 text-rose-600'
                  )}>
                    {tx.type === 'receipt'
                      ? <ArrowUpRight className="h-4 w-4" />
                      : <ArrowDownRight className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{tx.label}</p>
                    <p className="text-xs text-muted-foreground">{tx.project} · {tx.date}</p>
                  </div>
                  <div className={cn('text-sm font-semibold shrink-0', tx.type === 'receipt' ? 'text-blue-600' : 'text-rose-600')}>
                    {tx.type === 'receipt' ? '+' : '-'}{formatINR(tx.amount)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

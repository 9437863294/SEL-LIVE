'use client';

import { useAuthorization } from '@/hooks/useAuthorization';
import { useAuth } from '@/components/auth/AuthProvider';
import Link from 'next/link';
import { BarChart3, Activity, CalendarDays, FileText, PieChart, Users, Wallet, ClipboardList, ShieldCheck } from 'lucide-react';

const MODULE = 'Site Account Statement';

const REPORTS = [
  {
    href: '/site-account-statement/reports/receipts',
    icon: BarChart3,
    title: 'Payment Receipts',
    description: 'List all incoming payments with date, amount, mode and reference details.',
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
  },
  {
    href: '/site-account-statement/reports/expenses',
    icon: ClipboardList,
    title: 'Expense Register',
    description: 'Full expense ledger with category, vendor, payment mode and bill tracking.',
    color: 'text-rose-600',
    bg: 'bg-rose-50',
    border: 'border-rose-200',
  },
  {
    href: '/site-account-statement/reports/statement',
    icon: FileText,
    title: 'Account Statement',
    description: 'Chronological debit/credit ledger for a project with running balance.',
    color: 'text-violet-600',
    bg: 'bg-violet-50',
    border: 'border-violet-200',
  },
  {
    href: '/site-account-statement/reports/summary',
    icon: Wallet,
    title: 'Project-wise Summary',
    description: 'High-level totals — received, expenses, and balance for each project.',
    color: 'text-emerald-600',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
  },
  {
    href: '/site-account-statement/reports/category',
    icon: PieChart,
    title: 'Category Analysis',
    description: 'Which expense categories are consuming the most budget, ranked by amount.',
    color: 'text-amber-600',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
  },
  {
    href: '/site-account-statement/reports/cashflow',
    icon: Activity,
    title: 'Month-wise Cash Flow',
    description: 'Monthly receipts vs expenses with running balance and flow visualisation.',
    color: 'text-sky-600',
    bg: 'bg-sky-50',
    border: 'border-sky-200',
  },
  {
    href: '/site-account-statement/reports/person',
    icon: Users,
    title: 'Person-wise Expenses',
    description: 'Who spent what — grouped by person with per-category breakdown and share.',
    color: 'text-indigo-600',
    bg: 'bg-indigo-50',
    border: 'border-indigo-200',
  },
  {
    href: '/site-account-statement/reports/balance',
    icon: ShieldCheck,
    title: 'Balance Status',
    description: 'Health snapshot — projects colour-coded as Healthy, Warning, or Critical.',
    color: 'text-teal-600',
    bg: 'bg-teal-50',
    border: 'border-teal-200',
  },
  {
    href: '/site-account-statement/reports/daywise',
    icon: CalendarDays,
    title: 'Day-wise Statement',
    description: 'Every receipt and expense grouped by date with day totals and running balance.',
    color: 'text-cyan-600',
    bg: 'bg-cyan-50',
    border: 'border-cyan-200',
  },
] as const;

export default function ReportsIndexPage() {
  const { can } = useAuthorization();
  const { user: _user } = useAuth();
  const canViewAll = can('View', `${MODULE}.All Projects`);
  const canView    = can('View', `${MODULE}.Reports`) || canViewAll;

  if (!canView) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
        <BarChart3 className="h-12 w-12 opacity-30" />
        <p className="text-sm">You don&apos;t have access to reports.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold text-slate-800">Reports</h1>
        <p className="text-sm text-muted-foreground">{REPORTS.length} reports available — click any card to open</p>

      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {REPORTS.map(r => {
          const Icon = r.icon;
          return (
            <Link
              key={r.href}
              href={r.href}
              className={`group flex flex-col gap-3 rounded-xl border p-4 transition-all hover:shadow-md hover:-translate-y-0.5 ${r.bg} ${r.border}`}
            >
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center bg-white/70 ${r.border} border`}>
                <Icon className={`h-4 w-4 ${r.color}`} />
              </div>
              <div className="flex-1 space-y-1">
                <p className={`text-sm font-semibold ${r.color}`}>{r.title}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{r.description}</p>
              </div>
              <div className={`text-xs font-medium ${r.color} opacity-0 group-hover:opacity-100 transition-opacity`}>
                Open report →
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

'use client';

import {
  AlertTriangle,
  BarChart3,
  Building2,
  Calendar,
  FolderOpen,
  Layers,
  ScrollText,
  TrendingUp,
  UserCheck,
} from 'lucide-react';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import Link from 'next/link';

const reportCards = [
  {
    icon: TrendingUp,
    title: 'Summary',
    description: 'Overview of all fund requests by status, amount, project, and department.',
    href: '/site-fund-request/reports/summary',
    color: 'text-indigo-600',
    bg: 'bg-indigo-50',
    gradient: 'from-indigo-400 via-violet-400 to-blue-400',
  },
  {
    icon: FolderOpen,
    title: 'Project-wise',
    description: 'Requests and amounts grouped by project with status breakdown.',
    href: '/site-fund-request/reports/project-wise',
    color: 'text-sky-600',
    bg: 'bg-sky-50',
    gradient: 'from-sky-400 via-blue-400 to-indigo-400',
  },
  {
    icon: Building2,
    title: 'Department-wise',
    description: 'Requests and amounts grouped by department.',
    href: '/site-fund-request/reports/department-wise',
    color: 'text-teal-600',
    bg: 'bg-teal-50',
    gradient: 'from-teal-400 via-emerald-400 to-cyan-400',
  },
  {
    icon: Calendar,
    title: 'Monthly Comparison',
    description: 'Month-over-month request volumes and amounts for a financial year.',
    href: '/site-fund-request/reports/monthly',
    color: 'text-emerald-600',
    bg: 'bg-emerald-50',
    gradient: 'from-emerald-400 via-teal-400 to-green-400',
  },
  {
    icon: Layers,
    title: 'Stage-wise Analysis',
    description: 'Workflow step breakdown with TAT compliance and user-level performance.',
    href: '/site-fund-request/reports/stage-wise',
    color: 'text-fuchsia-600',
    bg: 'bg-fuchsia-50',
    gradient: 'from-fuchsia-400 via-violet-400 to-purple-400',
  },
  {
    icon: AlertTriangle,
    title: 'Overdue Requests',
    description: 'All active requests that have exceeded their deadline.',
    href: '/site-fund-request/reports/overdue',
    color: 'text-rose-600',
    bg: 'bg-rose-50',
    gradient: 'from-rose-400 via-red-400 to-orange-400',
  },
  {
    icon: UserCheck,
    title: 'Party-wise',
    description: 'Total amounts requested per party with request count and status.',
    href: '/site-fund-request/reports/party-wise',
    color: 'text-amber-600',
    bg: 'bg-amber-50',
    gradient: 'from-amber-400 via-orange-400 to-yellow-400',
  },
  {
    icon: ScrollText,
    title: 'Approval History',
    description: 'Full log of all approval actions — who did what and when.',
    href: '/site-fund-request/reports/approval-history',
    color: 'text-slate-600',
    bg: 'bg-slate-100',
    gradient: 'from-slate-400 via-gray-400 to-zinc-400',
  },
];

export default function SiteFundRequestReportsPage() {
  return (
    <div className="w-full space-y-6 p-4 sm:p-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Site Fund Request</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">Reports</h1>
        <p className="mt-1 text-sm text-slate-600">Analytics, summaries, and exports for fund requests.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {reportCards.map(card => {
          const Icon = card.icon;
          return (
            <Link key={card.title} href={card.href}>
              <Card className="group flex flex-col h-full overflow-hidden rounded-2xl border border-white/70 bg-white/65 shadow-[0_18px_60px_-45px_rgba(2,6,23,0.35)] backdrop-blur transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_28px_80px_-55px_rgba(2,6,23,0.55)] cursor-pointer">
                <div className={`h-1.5 w-full bg-gradient-to-r ${card.gradient} opacity-70`} />
                <CardHeader className="flex-row items-center gap-4 space-y-0 p-5">
                  <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${card.bg} transition-colors group-hover:opacity-80`}>
                    <Icon className={`h-5 w-5 ${card.color}`} />
                  </div>
                  <div>
                    <CardTitle className="text-base font-semibold text-slate-900">{card.title}</CardTitle>
                    <CardDescription className="mt-1 text-xs">{card.description}</CardDescription>
                  </div>
                </CardHeader>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

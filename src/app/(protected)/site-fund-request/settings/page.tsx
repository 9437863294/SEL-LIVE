'use client';

import { GitMerge, Users2 } from 'lucide-react';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import Link from 'next/link';

const cards = [
  {
    href: '/site-fund-request/settings/workflow-configuration',
    icon: GitMerge,
    title: 'Workflow Configuration',
    description: 'Define approval stages, assignees, and actions.',
    bg: 'bg-indigo-50 group-hover:bg-indigo-100',
    iconColor: 'text-indigo-600',
    gradient: 'from-indigo-400 via-violet-400 to-blue-400',
  },
  {
    href: '/site-fund-request/settings/project-access',
    icon: Users2,
    title: 'Project Access',
    description: 'Assign primary user, alternative user, and viewer per project.',
    bg: 'bg-teal-50 group-hover:bg-teal-100',
    iconColor: 'text-teal-600',
    gradient: 'from-teal-400 via-emerald-400 to-cyan-400',
  },
];

export default function SiteFundRequestSettingsPage() {
  return (
    <div className="w-full space-y-6 p-4 sm:p-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Site Fund Request</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">Settings</h1>
        <p className="mt-1 text-sm text-slate-600">Configure the fund request module.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 max-w-xl">
        {cards.map(card => {
          const Icon = card.icon;
          return (
            <Link key={card.href} href={card.href}>
              <Card className={`group cursor-pointer overflow-hidden rounded-2xl border border-white/70 bg-white/65 shadow-[0_18px_60px_-45px_rgba(2,6,23,0.35)] backdrop-blur transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_28px_80px_-55px_rgba(2,6,23,0.55)]`}>
                <div className={`h-1.5 w-full bg-gradient-to-r ${card.gradient} opacity-70`} />
                <CardHeader className="flex-row items-center gap-4 space-y-0 p-5">
                  <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${card.bg} transition-colors`}>
                    <Icon className={`h-5 w-5 ${card.iconColor}`} />
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

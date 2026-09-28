'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';

import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { StatusTone } from '@/components/shared/status-badge';
import { cn } from '@/lib/utils';

/**
 * Tone overrides for `StatusBadge` on requisition statuses. The workflow's intermediate stages
 * (Received, Verified, Received for Payment) read as stages in flight, not as done — only Paid is.
 * Every other status takes the shared vocabulary's tone.
 */
export const DAILY_STATUS_TONE: Partial<Record<string, StatusTone>> = {
  Received: 'info',
  Verified: 'info',
  'Received for Payment': 'progress',
};

export const dailyPageContainerClass = 'w-full px-3 py-4 sm:px-4 lg:px-6 xl:px-8';
export const dailySurfaceCardClass =
  'overflow-hidden rounded-2xl border border-white/70 bg-white/70 shadow-[0_20px_70px_-55px_rgba(2,6,23,0.55)] backdrop-blur';
export const dailyTabsListClass =
  'grid w-full rounded-2xl border border-white/70 bg-white/70 p-1 backdrop-blur';

interface DailyWorkflowCardProps {
  item: {
    icon: LucideIcon;
    title: string;
    description: string;
    href: string;
    disabled?: boolean;
    accentClassName?: string;
    badge?: string;
  };
}

export function DailyWorkflowCard({ item }: DailyWorkflowCardProps) {
  const cardContent = (
    <Card
      className={cn(
        'group flex h-full flex-col overflow-hidden rounded-2xl border border-white/70 bg-white/65 shadow-[0_18px_60px_-45px_rgba(2,6,23,0.35)] backdrop-blur transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_28px_80px_-55px_rgba(2,6,23,0.55)]',
        item.href === '#' || item.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
      )}
    >
      <div
        className={cn(
          'h-1.5 w-full bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-amber-300 opacity-70',
          item.accentClassName
        )}
      />
      <CardHeader className="flex-row items-center gap-4 space-y-0 p-5">
        <div className="rounded-2xl border border-white/70 bg-white/70 p-3 shadow-sm transition-colors group-hover:bg-white">
          <item.icon className="h-6 w-6 text-slate-900/80" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base font-semibold text-slate-900">{item.title}</CardTitle>
            {item.badge ? (
              <span className="shrink-0 rounded-full border border-white/70 bg-white/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                {item.badge}
              </span>
            ) : null}
          </div>
          <CardDescription className="mt-1 text-xs text-slate-600">{item.description}</CardDescription>
        </div>
      </CardHeader>
    </Card>
  );

  if (item.href === '#' || item.disabled) {
    return <div className="h-full">{cardContent}</div>;
  }

  return (
    <Link href={item.href} className="h-full no-underline">
      {cardContent}
    </Link>
  );
}

export function DailyMetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/70 bg-white/70 px-4 py-3 shadow-sm backdrop-blur">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

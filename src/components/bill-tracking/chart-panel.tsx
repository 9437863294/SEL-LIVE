'use client';

/**
 * The card a dashboard chart sits in. Kept apart from `dashboard-charts.tsx` so the dashboard can lay
 * out its panels without loading the chart library, which arrives in its own chunk.
 */

import { InfoTip } from '@/components/shared/info-tip';

export function ChartPanel({ title, description, children, footer }: { title: string; description?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="border-b border-slate-100 px-4 py-3">
        {/* The page title is the one h1, so panels are h2. */}
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
          {title}
          {description ? <InfoTip label={`About “${title}”`}>{description}</InfoTip> : null}
        </h2>
      </header>
      <div className="flex-1 p-4">{children}</div>
      {footer ? <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-2 text-xs text-slate-500">{footer}</div> : null}
    </section>
  );
}

/** Where a chart will be while its chunk loads: the chart's own height, so nothing below moves. */
export function ChartSkeleton({ className = 'h-64' }: { className?: string }) {
  return <div className={`${className} animate-pulse rounded-lg bg-slate-100`} aria-hidden="true" />;
}

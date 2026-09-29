import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { DailyRequisitionBottomNav } from '@/components/daily-requisition/bottom-nav';
import DailyRequisitionLayoutShell from '@/components/daily-requisition/module-layout-shell';

export const metadata: Metadata = {
  title: 'Daily Requisition | SEL Live',
  description: 'Record daily requisitions and follow them from receiving at finance through verification to payment.',
};

export default function DailyRequisitionLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    // `overflow-x-clip`, not `overflow-hidden`: a hidden box is a scroll container, and the
    // sidebar's `position: sticky` would stick to it (a box that never scrolls) instead of the page.
    // Clip trims the same sideways overflow without that; the glows are trimmed by their own layer.
    <div className="relative w-full overflow-x-clip">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-white to-slate-50" />
        <div className="absolute inset-0 aurora-noise opacity-70" />
        <div className="absolute inset-0 bg-aurora-grid opacity-40" />

        <div className="absolute -left-28 top-[-5rem] h-80 w-80 rounded-full bg-cyan-400/25 blur-[110px] animate-float" />
        <div
          className="absolute right-[-8rem] top-12 h-96 w-96 rounded-full bg-fuchsia-400/20 blur-[140px] animate-pulse-glow"
          style={{ animationDelay: '-1.2s' }}
        />
        <div
          className="absolute bottom-[-9rem] left-1/3 h-[28rem] w-[28rem] rounded-full bg-amber-300/25 blur-[160px] animate-pulse-glow"
          style={{ animationDelay: '-2.6s' }}
        />
        <div
          className="absolute bottom-[-10rem] right-[-8rem] h-[26rem] w-[26rem] rounded-full bg-emerald-400/15 blur-[170px] animate-float"
          style={{ animationDelay: '-1.8s' }}
        />
      </div>

      {/* The desktop sidebar beside the page. Print routes get the page alone. */}
      <div className="relative">
        <DailyRequisitionLayoutShell>{children}</DailyRequisitionLayoutShell>
      </div>

      {/* The phone's bottom bar. It builds its own tabs: a server layout cannot pass icons to a client component. */}
      <DailyRequisitionBottomNav />
    </div>
  );
}

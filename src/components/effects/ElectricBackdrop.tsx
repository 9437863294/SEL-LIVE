'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

const ELECTRIC_ARCS = [
  { top: '12%', left: '8%', delay: '-0.3s' },
  { top: '22%', left: '74%', delay: '-1.2s' },
  { top: '31%', left: '48%', delay: '-2.1s' },
  { top: '46%', left: '15%', delay: '-0.9s' },
  { top: '57%', left: '68%', delay: '-1.7s' },
  { top: '70%', left: '36%', delay: '-2.8s' },
  { top: '78%', left: '83%', delay: '-0.5s' },
];

const SCAN_LINES = [
  { top: '10%', delay: '-0.2s' },
  { top: '22%', delay: '-2.2s' },
  { top: '34%', delay: '-1.4s' },
  { top: '46%', delay: '-2.8s' },
  { top: '58%', delay: '-0.9s' },
  { top: '70%', delay: '-2.4s' },
  { top: '82%', delay: '-1.1s' },
];

export function ElectricBackdrop({ className }: { className?: string }) {
  return (
    <div className={cn('pointer-events-none absolute inset-0 z-0', className)}>
      <div className="absolute inset-0 bg-electric-grid opacity-25" />
      <div className="absolute inset-0 electric-noise opacity-30" />
      <div className="absolute -left-24 top-0 h-80 w-80 rounded-full bg-cyan-400/15 blur-[110px] animate-pulse-glow" />
      <div
        className="absolute right-[-7rem] top-20 h-96 w-96 rounded-full bg-blue-500/20 blur-[130px] animate-pulse-glow"
        style={{ animationDelay: '-1.8s' }}
      />
      <div
        className="absolute bottom-[-9rem] left-1/3 h-[26rem] w-[26rem] rounded-full bg-indigo-500/20 blur-[160px] animate-pulse-glow"
        style={{ animationDelay: '-3.1s' }}
      />

      {SCAN_LINES.map((line) => (
        <div
          key={line.top}
          className="electric-scan-line"
          style={{ top: line.top, animationDelay: line.delay }}
        />
      ))}

      {ELECTRIC_ARCS.map((arc) => (
        <span
          key={`${arc.top}-${arc.left}`}
          className="electric-arc"
          style={{ top: arc.top, left: arc.left, animationDelay: arc.delay }}
        />
      ))}

      <div className="absolute inset-0 bg-gradient-to-r from-[#020617] via-[#020617]/45 to-[#020617]" />
      <div className="absolute inset-0 bg-gradient-to-t from-[#020617] via-transparent to-[#020617]/85" />
    </div>
  );
}


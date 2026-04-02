'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

type AuroraBackdropProps = {
  className?: string;
};

export function AuroraBackdrop({ className }: AuroraBackdropProps) {
  return (
    <div className={cn('pointer-events-none absolute inset-0 -z-10 overflow-hidden', className)}>
      <div className="absolute inset-0 bg-aurora-grid opacity-60" />
      <div className="absolute inset-0 aurora-noise opacity-80" />

      <div className="absolute -left-24 -top-24 h-96 w-96 rounded-full bg-cyan-300/35 blur-[130px] animate-pulse-glow" />
      <div
        className="absolute right-[-8rem] top-20 h-[30rem] w-[30rem] rounded-full bg-fuchsia-300/30 blur-[150px] animate-pulse-glow"
        style={{ animationDelay: '-1.8s' }}
      />
      <div
        className="absolute bottom-[-10rem] left-1/3 h-[34rem] w-[34rem] rounded-full bg-amber-200/35 blur-[170px] animate-pulse-glow"
        style={{ animationDelay: '-3.1s' }}
      />

      <div className="absolute inset-0 bg-gradient-to-b from-white via-white/75 to-white" />
    </div>
  );
}


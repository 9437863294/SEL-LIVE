'use client';

/**
 * A small (i) that opens a note on click or tap — for an explanation that would otherwise sit open
 * under a label, a card's figure or a section's title. A popover rather than a tooltip, so it works
 * on a phone too. A button, so never place it inside another link or button: put it beside one.
 */

import { Info } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export function InfoTip({ children, label = 'More information', className }: { children: React.ReactNode; label?: string; className?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-slate-400 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500',
            className,
          )}
        >
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3 text-xs leading-relaxed text-slate-700">
        {children}
      </PopoverContent>
    </Popover>
  );
}

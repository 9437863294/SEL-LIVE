'use client';

/**
 * A row of actions that shows as many as the width allows and folds the rest into a "More" menu.
 *
 * The buttons are chosen by `priority` (lower first), so the actions that matter most — the next
 * workflow step, recording a receipt — are the last to fold away, whatever the screen size. What
 * does not fit goes into the menu in the order the actions were given, along with the actions that
 * belong in a menu at every width (`menuOnly`: delete, rarely used tools).
 *
 * The fit is measured, not guessed: an invisible copy of every button is laid out once, each
 * button's width is read from it, and the row is recomputed whenever its own width changes
 * (`ResizeObserver`) — a sidebar collapsing, a phone turning, a window narrowing.
 */

import Link from 'next/link';
import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MoreHorizontal, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export interface OverflowAction {
  key: string;
  label: string;
  icon?: LucideIcon;
  /** A link, or `onSelect` for anything else. */
  href?: string;
  onSelect?: () => void;
  /** `primary` is a solid button; `danger` an outlined red one. */
  variant?: 'primary' | 'secondary' | 'danger';
  /** Lower stays on the row longest. Ties keep the given order. */
  priority?: number;
  /** In the menu at every width. */
  menuOnly?: boolean;
  /** Starts a new group in the menu. */
  separatorBefore?: boolean;
  disabled?: boolean;
}

const DANGER = 'border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800';

function ActionButton({ action, tabIndex }: { action: OverflowAction; tabIndex?: number }) {
  const Icon = action.icon;
  const content = (
    <>
      {Icon ? <Icon className="h-4 w-4" aria-hidden="true" /> : null}
      {action.label}
    </>
  );
  const props = {
    variant: action.variant === 'primary' ? ('default' as const) : ('outline' as const),
    className: cn('shrink-0 gap-2', action.variant === 'danger' && DANGER),
    disabled: action.disabled,
    tabIndex,
  };
  if (action.href && !action.disabled) {
    return (
      <Button asChild {...props}>
        <Link href={action.href} tabIndex={tabIndex}>
          {content}
        </Link>
      </Button>
    );
  }
  return (
    <Button type="button" {...props} onClick={action.onSelect}>
      {content}
    </Button>
  );
}

export function OverflowActions({ actions, moreLabel = 'More', className }: { actions: OverflowAction[]; moreLabel?: string; className?: string }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  /** How many of `ranked` fit on the row; `null` until measured (everything shows meanwhile). */
  const [fit, setFit] = useState<number | null>(null);

  const ranked = useMemo(
    () =>
      actions
        .map((action, index) => ({ action, index }))
        .filter(({ action }) => !action.menuOnly)
        .sort((a, b) => (a.action.priority ?? 0) - (b.action.priority ?? 0) || a.index - b.index)
        .map(({ action }) => action),
    [actions],
  );
  const hasMenuOnly = actions.some((action) => action.menuOnly);
  // What is measured: the buttons and the menu trigger, in that order.
  const signature = ranked.map((action) => `${action.key}:${action.label}:${action.variant ?? ''}`).join('|');

  useLayoutEffect(() => {
    const row = rowRef.current;
    const measure = measureRef.current;
    if (!row || !measure) return;
    const compute = () => {
      const children = Array.from(measure.children) as HTMLElement[];
      const widths = children.slice(0, ranked.length).map((child) => child.offsetWidth);
      const moreWidth = children[ranked.length]?.offsetWidth ?? 0;
      const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
      const available = row.clientWidth;
      const span = (count: number) => widths.slice(0, count).reduce((sum, width) => sum + width, 0) + gap * Math.max(0, count - 1);
      // Everything on the row, with no menu needed.
      if (!hasMenuOnly && span(ranked.length) <= available) {
        setFit(ranked.length);
        return;
      }
      let count = 0;
      while (count < ranked.length && span(count + 1) + gap + moreWidth <= available) count += 1;
      setFit(count);
    };
    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(row);
    return () => observer.disconnect();
    // `signature` stands for `ranked`'s content, which is a new array on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, hasMenuOnly]);

  const shown = fit === null ? ranked : ranked.slice(0, fit);
  const shownKeys = new Set(shown.map((action) => action.key));
  // The menu keeps the given order: whatever did not fit, then the menu-only actions where they fall.
  const folded = actions.filter((action) => action.menuOnly || !shownKeys.has(action.key));

  return (
    // Full width, always: the space measured must be the space there is. Sized to its content it
    // would shrink as actions fold away, and fold more on the next measure.
    <div className={cn('relative w-full min-w-0', className)}>
      <div ref={rowRef} className="flex min-w-0 flex-nowrap items-center gap-2.5 overflow-hidden">
        {shown.map((action) => (
          <ActionButton key={action.key} action={action} />
        ))}
        {folded.length ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="shrink-0 gap-2" aria-label={`${moreLabel} actions`}>
                <MoreHorizontal className="h-4 w-4" aria-hidden="true" /> {moreLabel}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              {folded.map((action, index) => {
                const Icon = action.icon;
                const body = (
                  <>
                    {Icon ? <Icon className="mr-2 h-4 w-4" aria-hidden="true" /> : null}
                    {action.label}
                  </>
                );
                return (
                  <Fragment key={action.key}>
                    {action.separatorBefore && index > 0 ? <DropdownMenuSeparator /> : null}
                    {action.href && !action.disabled ? (
                      <DropdownMenuItem asChild className={action.variant === 'danger' ? 'text-rose-700' : undefined}>
                        <Link href={action.href}>{body}</Link>
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem
                        disabled={action.disabled}
                        className={action.variant === 'danger' ? 'text-rose-700' : undefined}
                        onSelect={() => action.onSelect?.()}
                      >
                        {body}
                      </DropdownMenuItem>
                    )}
                  </Fragment>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      {/* The measuring copy: every button at its natural width, never seen or reached. */}
      <div ref={measureRef} aria-hidden="true" className="pointer-events-none invisible absolute left-0 top-0 flex w-max items-center gap-2.5">
        {ranked.map((action) => (
          <ActionButton key={action.key} action={action} tabIndex={-1} />
        ))}
        <Button variant="outline" className="shrink-0 gap-2" tabIndex={-1}>
          <MoreHorizontal className="h-4 w-4" /> {moreLabel}
        </Button>
      </div>
    </div>
  );
}

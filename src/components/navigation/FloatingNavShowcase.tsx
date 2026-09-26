'use client';

import { useState } from 'react';
import { Bell, Check, Home, MessageCircle, Plus, Search, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FloatingBottomNav } from './FloatingBottomNav';
import type { FloatingNavItem } from './NavItem';
import { FLOATING_NAV_THEMES, floatingNavThemeMeta, type FloatingNavTheme } from './themes';

const DEMO_ITEMS: FloatingNavItem[] = [
  { key: 'home', label: 'Home', icon: Home },
  { key: 'search', label: 'Search', icon: Search },
  { key: 'create', label: 'Create', icon: Plus, emphasized: true },
  { key: 'inbox', label: 'Inbox', icon: MessageCircle },
  { key: 'profile', label: 'Profile', icon: User },
];

/**
 * A phone-sized, fully interactive preview of one theme: the bar is the real component, pinned to
 * the bottom of the frame instead of the viewport, so tapping its tabs animates exactly as it will
 * inside a module.
 */
export function FloatingNavPhonePreview({ theme, className }: { theme: FloatingNavTheme; className?: string }) {
  const [active, setActive] = useState('home');
  const dark = theme === 'neon';
  const tile = dark ? 'bg-white/[0.06]' : 'bg-white shadow-sm ring-1 ring-slate-200/70';
  const line = dark ? 'bg-white/15' : 'bg-slate-200';
  const current = DEMO_ITEMS.find((item) => item.key === active);

  return (
    <div
      className={cn(
        'relative mx-auto h-[440px] w-full max-w-[360px] overflow-hidden rounded-[2.25rem] border-[7px] shadow-2xl',
        dark ? 'border-neutral-800 bg-neutral-950' : 'border-slate-900 bg-slate-100',
        className,
      )}
    >
      <div className="space-y-3 px-4 pt-5" aria-hidden="true">
        <div className="flex items-center justify-between">
          <div className="space-y-1.5">
            <div className={cn('h-2 w-16 rounded-full', line)} />
            <p className={cn('text-lg font-bold tracking-tight', dark ? 'text-white' : 'text-slate-900')}>{current?.label}</p>
          </div>
          <span className={cn('flex h-9 w-9 items-center justify-center rounded-full', tile)}>
            <Bell className={cn('h-4 w-4', dark ? 'text-white/70' : 'text-slate-500')} />
          </span>
        </div>
        <div
          className={cn(
            'h-24 rounded-2xl bg-gradient-to-br p-3',
            floatingNavThemeMeta[theme].swatch,
            'shadow-lg',
          )}
        >
          <div className="h-2 w-20 rounded-full bg-white/50" />
          <div className="mt-3 h-5 w-28 rounded-full bg-white/80" />
          <div className="mt-2 h-2 w-14 rounded-full bg-white/40" />
        </div>
        {[0, 1, 2].map((row) => (
          <div key={row} className={cn('flex items-center gap-3 rounded-2xl p-3', tile)}>
            <div className={cn('h-9 w-9 shrink-0 rounded-xl', line)} />
            <div className="flex-1 space-y-1.5">
              <div className={cn('h-2 rounded-full', line, row === 1 ? 'w-2/3' : 'w-4/5')} />
              <div className={cn('h-2 w-1/3 rounded-full', line)} />
            </div>
          </div>
        ))}
      </div>
      <FloatingBottomNav
        items={DEMO_ITEMS}
        activeItem={active}
        onChange={setActive}
        theme={theme}
        position="absolute"
        hideAbove={null}
        autoHide={false}
        spacer={false}
        notificationCount={3}
        ariaLabel={`${floatingNavThemeMeta[theme].label} preview`}
      />
    </div>
  );
}

/** Theme picker with a live preview beside it — the Appearance page's "Mobile navigation" card. */
export function FloatingNavShowcase({
  value,
  onChange,
}: {
  value: FloatingNavTheme;
  onChange: (theme: FloatingNavTheme) => void;
}) {
  return (
    <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_360px] md:items-center">
      <div className="space-y-2.5">
        {FLOATING_NAV_THEMES.map((theme) => {
          const meta = floatingNavThemeMeta[theme];
          const selected = theme === value;
          return (
            <button
              key={theme}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(theme)}
              className={cn(
                'flex w-full items-center gap-3 rounded-2xl border-2 p-3 text-left transition-all duration-200',
                selected ? 'border-primary bg-primary/5 shadow-sm' : 'border-border/60 hover:border-primary/40 hover:bg-muted/30',
              )}
            >
              <span
                className={cn(
                  'relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl',
                  theme === 'neon' ? 'bg-neutral-900' : 'bg-white ring-1 ring-slate-200',
                )}
              >
                <span className={cn('h-6 w-6 rounded-full bg-gradient-to-br shadow-md', meta.swatch)} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{meta.label}</span>
                <span className="block text-xs text-muted-foreground">{meta.description}</span>
              </span>
              <span
                className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-opacity',
                  selected ? 'bg-primary opacity-100' : 'opacity-0',
                )}
              >
                <Check className="h-3 w-3 text-primary-foreground" />
              </span>
            </button>
          );
        })}
        <p className="px-1 pt-1 text-xs text-muted-foreground">
          Used for every tab strip, and for the bottom bar in each module on phones and tablets. Tap the tabs in the preview to try it.
        </p>
      </div>
      <FloatingNavPhonePreview theme={value} />
    </div>
  );
}

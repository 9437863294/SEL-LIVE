'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, ArrowLeft, ArrowRight, CalendarClock, CalendarDays, Check, Clock, Landmark, Lock, Minus, Palette, Percent,
  Repeat, Search, Settings2, SlidersHorizontal, TrendingUp, type LucideIcon,
} from 'lucide-react';
import heroStyles from '@/components/bank-balance/dashboard-designs/aurora.module.css';
import { Button } from '@/components/ui/button';
import { useAuthorization } from '@/hooks/useAuthorization';
import type { CardStatus, CardSummary, SettingsCardKey, SettingsOverview } from '@/lib/bank-balance-settings-overview';
import { cn } from '@/lib/utils';

interface HubItem {
  key: SettingsCardKey;
  icon: LucideIcon;
  title: string;
  href: string;
  description: string;
  /** The icon tile's gradient. */
  from: string;
  to: string;
  allowed: boolean;
  /** More words the search should find it by. */
  keywords?: string;
}

interface HubSection {
  title: string;
  description: string;
  icon: LucideIcon;
  from: string;
  to: string;
  items: HubItem[];
}

/** A gradient icon tile; the colours are inline, from the card. */
function Tile({ from, to, size = 46, children }: { from: string; to: string; size?: number; children: ReactNode }) {
  return (
    <span aria-hidden className={heroStyles.appIcon} style={{ '--a': from, '--b': to, width: size, height: size, borderRadius: size * 0.3 } as CSSProperties}>
      {children}
    </span>
  );
}

const STATUS: Record<CardStatus, { className: string; icon: LucideIcon }> = {
  ok: { className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300', icon: Check },
  warn: { className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300', icon: AlertTriangle },
  due: { className: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200', icon: Clock },
  neutral: { className: 'bg-muted text-muted-foreground', icon: Minus },
};

function StatusChip({ summary }: { summary: CardSummary }) {
  const style = STATUS[summary.status];
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-bold', style.className)}>
      <style.icon aria-hidden className="h-3 w-3" />
      {summary.statusLabel}
    </span>
  );
}

function HubCard({ item, summary }: { item: HubItem; summary: CardSummary | null }) {
  const body = (
    <div
      className={cn(
        'group relative flex h-full flex-col gap-3 overflow-hidden rounded-2xl border bg-card p-4 shadow-sm transition sm:p-[18px]',
        item.allowed ? 'hover:-translate-y-0.5 hover:shadow-md' : 'opacity-60',
      )}
    >
      <span aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-[0.18] blur-2xl" style={{ background: item.from }} />
      <div className="relative flex items-start gap-3.5">
        <Tile from={item.from} to={item.to}>
          <item.icon className="h-[21px] w-[21px]" />
        </Tile>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold leading-tight text-foreground">{item.title}</p>
          <p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">{item.description}</p>
        </div>
      </div>
      <div className="flex min-h-[26px] flex-wrap gap-1.5">
        {summary
          ? summary.stats.map((stat) => (
              <span key={stat.label} className="rounded-lg bg-muted px-2 py-1 text-xs font-semibold text-muted-foreground">
                <b className="text-foreground">{stat.value}</b> {stat.label}
              </span>
            ))
          : [0, 1].map((i) => <span key={i} className="h-[26px] w-20 animate-pulse rounded-lg bg-muted" />)}
      </div>
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-dashed pt-2.5 text-xs text-muted-foreground">
        {!item.allowed ? (
          <span className="inline-flex items-center gap-1 font-medium">
            <Lock aria-hidden className="h-3 w-3" /> No access — ask an administrator
          </span>
        ) : summary ? (
          <>
            <StatusChip summary={summary} />
            <span className="flex min-w-0 items-center gap-2 text-right">
              <span className="line-clamp-2">{summary.note}</span>
              <ArrowRight aria-hidden className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5" style={{ color: item.to }} />
            </span>
          </>
        ) : (
          <span className="h-4 w-full animate-pulse rounded bg-muted" />
        )}
      </div>
    </div>
  );
  return item.allowed ? (
    <Link href={item.href} className="block h-full no-underline">
      {body}
    </Link>
  ) : (
    <div className="h-full" aria-disabled>
      {body}
    </div>
  );
}

function SectionHead({ title, description, icon: Icon, from, to }: Omit<HubSection, 'items'>) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <Tile from={from} to={to} size={30}>
        <Icon className="h-[15px] w-[15px]" />
      </Tile>
      <div className="min-w-0">
        <h2 className="text-base font-extrabold text-foreground">{title}</h2>
        <p className="text-[12.5px] text-muted-foreground">{description}</p>
      </div>
      <span aria-hidden className="hidden h-px flex-1 bg-border sm:block" />
    </div>
  );
}

/** The setup-health ring: how many judged cards are fine. */
function HealthRing({ ok, total }: { ok: number; total: number }) {
  const share = total > 0 ? ok / total : 1;
  const circumference = 2 * Math.PI * 15;
  return (
    <svg width="58" height="58" viewBox="0 0 36 36" aria-hidden className="shrink-0">
      <circle cx="18" cy="18" r="15" fill="none" stroke="#ffffff33" strokeWidth="4" />
      <circle
        cx="18" cy="18" r="15" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round"
        strokeDasharray={`${share * circumference} ${circumference}`} transform="rotate(-90 18 18)"
      />
      <text x="18" y="21.5" textAnchor="middle" fontSize="9" fontWeight="800" fill="#fff">{ok}/{total}</text>
    </svg>
  );
}

/**
 * Bank Balance › Settings, drawn from the figures the page has read (`overview`, null while loading).
 *
 * A colour banner with the setup-health score and a search over every setting; what needs fixing,
 * in one line; then the settings in sections, each card saying what it holds and whether anything
 * is missing before it is opened; and last, the dashboard's appearance. Every figure on a card is
 * read from the stored data (`settingsOverview`).
 */
export function BankSettingsHub({ overview }: { overview: SettingsOverview | null }) {
  const { can } = useAuthorization();
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  // "/" jumps to the search, as the shortcut hint says; Escape clears it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (event.key === '/' && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const settingsRight = can('Edit', 'Bank Balance.Payment Entry Settings');
  const anyView = can('View Module', 'Bank Balance');
  const sections = useMemo<HubSection[]>(
    () => [
      {
        title: 'Setup',
        description: 'What the balances, limits and interest are calculated from.',
        icon: Settings2,
        from: '#60a5fa',
        to: '#2563eb',
        items: [
          {
            key: 'accounts', icon: Landmark, title: 'Bank Accounts', href: '/bank-balance/accounts', from: '#818cf8', to: '#3730a3',
            description: 'Add and edit accounts, their type and status, and the opening balance or utilisation.',
            allowed: can('View', 'Bank Balance.Accounts'),
          },
          {
            key: 'dp', icon: TrendingUp, title: 'DP Management', href: '/bank-balance/dp-management', from: '#f9a8d4', to: '#be185d',
            description: 'Dated drawing power (DP) and temporary overdraft (TOD) limits for Cash Credit accounts.',
            allowed: can('View', 'Bank Balance.DP Management'),
          },
          {
            key: 'rates', icon: Percent, title: 'Interest Rates', href: '/bank-balance/interest-rate', from: '#c4b5fd', to: '#6d28d9',
            description: 'Dated interest rate history for each Cash Credit account.',
            allowed: can('View', 'Bank Balance.Interest Rate'),
          },
        ],
      },
      {
        title: 'Entry controls',
        description: 'What the entry forms ask for, which dates they accept, and which months are closed.',
        icon: SlidersHorizontal,
        from: '#fdba74',
        to: '#ea580c',
        items: [
          {
            key: 'fieldControl', icon: SlidersHorizontal, title: 'Field Control', href: '/bank-balance/settings/field-control', from: '#fdba74', to: '#ea580c',
            description: 'Which fields each form shows and requires, what they are called, list order, and payment methods.',
            // Payment options (formerly Payment Entry Settings) keep that page's rights, so they open it too.
            allowed: anyView || settingsRight || can('View', 'Bank Balance.Field Control')
              || can('View', 'Bank Balance.Payment Entry Settings') || can('Add', 'Bank Balance.Expenses'),
          },
          {
            key: 'dateControl', icon: CalendarClock, title: 'Date Control', href: '/bank-balance/settings/date-control', from: '#6ee7b7', to: '#047857',
            description: 'How far back and forward a payment, receipt or transfer may be dated, for all accounts or one.',
            allowed: anyView || settingsRight || can('View', 'Bank Balance.Date Control'),
          },
          {
            key: 'monthClosure', icon: Lock, title: 'Month Closure', href: '/bank-balance/settings/month-closure', from: '#94a3b8', to: '#334155',
            description: 'Freeze a month once it has been reported on. Nothing dated in it can be added, changed or deleted.',
            allowed: anyView || settingsRight || can('View', 'Bank Balance.Month Closure'),
          },
        ],
      },
      {
        title: 'Monthly',
        description: 'Entries made once a month.',
        icon: Repeat,
        from: '#5eead4',
        to: '#0d9488',
        items: [
          {
            key: 'monthlyInterest', icon: CalendarDays, title: 'Monthly Interest', href: '/bank-balance/monthly-interest', from: '#5eead4', to: '#0d9488',
            description: 'Record the interest each bank actually charged, against the projected figure.',
            allowed: can('View', 'Bank Balance.Monthly Interest'),
          },
        ],
      },
      {
        title: 'Appearance',
        description: 'How the Bank Balance dashboard looks for everyone.',
        icon: Palette,
        from: '#f472b6',
        to: '#7c3aed',
        items: [
          {
            key: 'appearance', icon: Palette, title: 'Dashboard design', href: '/bank-balance/settings/appearance', from: '#f472b6', to: '#7c3aed',
            description: 'Which layout the dashboard opens in. Every design shows the same figures from the ledger.',
            keywords: 'appearance layout look theme classic overview account workspace position table aurora',
            allowed: anyView,
          },
        ],
      },
    ],
    [can, anyView, settingsRight],
  );

  const needle = query.trim().toLowerCase();
  const matches = (item: HubItem) => !needle || `${item.title} ${item.description} ${item.keywords ?? ''}`.toLowerCase().includes(needle);
  const shownSections = sections.map((section) => ({ ...section, items: section.items.filter(matches) })).filter((section) => section.items.length > 0);
  const itemByKey = new Map(sections.flatMap((section) => section.items).map((item) => [item.key, item]));

  const issues = overview?.issues ?? [];
  const firstFix = issues.map((issue) => itemByKey.get(issue.card)).find((item) => item?.allowed);
  const health = overview?.health;
  const sentence = issues.length
    ? `${issues.map((issue) => issue.text).join(', ').replace(/^./, (c) => c.toUpperCase())}.`
    : '';

  return (
    <div className="relative w-full space-y-6 px-4 py-4 pb-28 sm:px-6 lg:px-8">
      {/* Where this is, and the way back. */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[12.5px] font-semibold text-muted-foreground">
        <Link href="/bank-balance" aria-label="Back to the dashboard" className="mr-1 flex h-[30px] w-[30px] items-center justify-center rounded-lg border bg-card hover:bg-muted">
          <ArrowLeft className="h-[15px] w-[15px]" />
        </Link>
        <Link href="/" className="hover:text-foreground">Home</Link>
        <span aria-hidden>›</span>
        <Link href="/bank-balance" className="hover:text-foreground">Bank Balance</Link>
        <span aria-hidden>›</span>
        <span className="text-foreground">Settings</span>
      </nav>

      {/* ── The banner: what this is, how complete it is, and a search over everything below ── */}
      <section className={cn(heroStyles.hero, 'keep-light grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-5 gap-y-4 p-5 sm:p-7 xl:grid-cols-[auto_minmax(0,1fr)_auto]')} data-tint="aurora">
        <span aria-hidden className={cn(heroStyles.glass, 'flex h-14 w-14 items-center justify-center rounded-[18px] sm:h-16 sm:w-16')}>
          <Landmark className="h-7 w-7 text-white" />
        </span>
        <div className="min-w-0">
          <p className={cn(heroStyles.muted, 'text-xs font-semibold uppercase tracking-[0.08em]')}>Bank Balance · Settings</p>
          <h1 className="my-0.5 text-2xl font-extrabold tracking-tight sm:text-[28px]">Bank Settings</h1>
          <p className={heroStyles.muted}>Configure accounts, limits, rates, the entry forms and how the dashboard looks.</p>
        </div>
        <div className={cn(heroStyles.glass, 'col-span-2 flex items-center gap-3.5 rounded-[18px] py-3 pl-3 pr-5 xl:col-span-1')}>
          {health ? <HealthRing ok={health.ok} total={health.total} /> : <span className="h-[58px] w-[58px] animate-pulse rounded-full bg-white/20" />}
          <div>
            <p className="text-[15px] font-bold">
              {health ? (health.total ? `Setup ${Math.round((health.ok / health.total) * 100)}% complete` : 'Nothing to check yet') : 'Checking setup…'}
            </p>
            <p className={cn(heroStyles.muted, 'text-xs')}>
              {health ? (issues.length ? `${issues.length} item${issues.length === 1 ? '' : 's'} need${issues.length === 1 ? 's' : ''} attention` : 'Nothing needs attention') : ' '}
            </p>
          </div>
        </div>
        <label className="col-span-full flex max-w-[520px] items-center gap-2.5 rounded-[14px] bg-white px-3.5 py-2.5 text-slate-400 shadow-[0_10px_30px_rgba(0,0,0,0.2)]">
          <Search aria-hidden className="h-[18px] w-[18px] shrink-0" />
          <span className="sr-only">Search settings</span>
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setQuery('');
            }}
            placeholder="Search settings, e.g. DP, interest, month closure…"
            className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
          />
          <kbd className="hidden rounded-md border border-slate-200 px-1.5 py-0.5 text-[11px] font-semibold text-slate-500 sm:inline">/</kbd>
        </label>
      </section>

      {/* ── What needs fixing, in one line ── */}
      {issues.length > 0 && (
        <div className="flex flex-wrap items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 sm:items-center text-amber-950 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-100">
          <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-200 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4" />
          </span>
          <p className="min-w-0 flex-1 basis-[14rem] text-sm">
            <b>{sentence}</b> The dashboard and reports use these figures.
          </p>
          {firstFix && (
            <Button asChild variant="outline" size="sm" className="ml-auto border-amber-300 bg-white/70 hover:bg-white dark:border-amber-700 dark:bg-transparent">
              <Link href={firstFix.href}>Fix in {firstFix.title} →</Link>
            </Button>
          )}
        </div>
      )}

      {/* ── The settings, by section ── */}
      {shownSections.map((section) => (
        <section key={section.title} className="min-w-0">
          <SectionHead {...section} />
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
            {section.items.map((item) => (
              <HubCard key={item.key} item={item} summary={overview?.cards[item.key] ?? null} />
            ))}
          </div>
        </section>
      ))}

      {shownSections.length === 0 && (
        <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          No setting matches “{query}”. <button type="button" className="font-semibold text-foreground underline" onClick={() => setQuery('')}>Clear the search</button>
        </p>
      )}

      <footer className="flex flex-wrap justify-between gap-2 border-t pt-3.5 text-xs text-muted-foreground">
        <span>Bank Balance · Settings</span>
        <span>Changes made from these pages are recorded in the activity log</span>
      </footer>
    </div>
  );
}

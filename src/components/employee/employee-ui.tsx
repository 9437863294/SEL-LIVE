'use client';

/**
 * The Employee Management module's chrome: the page shell, the header, the sub-navigation, the KPI
 * card and the handful of small pieces its ten screens share.
 *
 * ── Why this file exists ────────────────────────────────────────────────────────────────────────
 *
 * Every screen in the module had built its own chrome by copy-paste: the same
 * `relative min-h-[calc(100dvh-4rem)] overflow-hidden px-4 py-3 sm:px-5` wrapper, the same
 * `<AuroraBackdrop />`, then a row containing nothing but an unlabelled round back arrow, then
 * `HrPageHeader`. Ten copies, already drifting — two spelt the arrow `h-5 w-5` and the rest `h-4
 * w-4`, one put a badge on the arrow's row and the others did not, and Current Employees had grown
 * a nicer bespoke header card that none of its siblings shared. This is that header, made the one
 * the module uses.
 *
 * The other half of the problem was navigational, not visual. Each sub-page was a dead end: the
 * only way from the leave register to the attendance register was back to the hub and in again.
 * `EmployeeSubNav` puts the module's own pages one tap away from any of them, which is what turns
 * ten separate screens into one module.
 *
 * Follows the idiom `@/components/access-management/access-ui` established for that module — a
 * shell, a card class, a spotlight KPI card with a count-up value — because the two modules sit
 * next to each other under Settings and a reader moving between them should not feel a seam. The
 * pieces are kept here rather than pushed into `hr-ui` for the reason stated there: the shared kit
 * owns generic values, and a module's chrome belongs to the module.
 */

import * as React from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Briefcase,
  CalendarClock,
  ChevronRight,
  Clock,
  Columns3,
  DownloadCloud,
  FileText,
  Fingerprint,
  IndianRupee,
  LayoutGrid,
  Link2,
  SlidersHorizontal,
  Sparkles,
  Tags,
  UserCheck,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { AuroraBackdrop } from '@/components/effects/AuroraBackdrop';
import { CountUp } from '@/components/effects/CountUp';
import { SpotlightCard } from '@/components/effects/SpotlightCard';
import { useAuthorization } from '@/hooks/useAuthorization';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

/* ------------------------------------------------------------------------------------------------
 * Tokens
 * ---------------------------------------------------------------------------------------------- */

export type EmpTone =
  | 'indigo'
  | 'violet'
  | 'emerald'
  | 'blue'
  | 'cyan'
  | 'teal'
  | 'amber'
  | 'rose'
  | 'slate';

/**
 * The module's card surface. `bg-white/85` rather than the `/80` most employee screens used: the
 * aurora backdrop shows through both, and at 80 the lighter text on a card sitting over one of the
 * blurred colour blobs loses contrast. 85 is also what access management settled on, and the two
 * modules' cards are seen side by side in the settings hub.
 */
export const EMP_CARD_CLASS = 'border-white/60 bg-white/85 shadow-sm backdrop-blur-sm';

/**
 * One palette entry per tone, with every surface a tone is asked for in this module:
 *
 *  `bg`/`text`/`ring` — the tinted icon chip (matches the shared `HrKpiCard`, so a page mixing the
 *                       two does not show two different indigos)
 *  `solid`            — a gradient for a *filled* icon tile, used by the headers and the hub's
 *                       feature cards, where a pale chip is too quiet to anchor a heading
 *  `bar`              — the 2px accent across the top of a card
 *  `glow`             — the hover spotlight, as an rgba string (`SpotlightCard` takes a colour, not
 *                       a class)
 *  `chip`             — a bordered status pill
 */
export const EMP_TONES: Record<
  EmpTone,
  { bg: string; text: string; ring: string; solid: string; bar: string; glow: string; chip: string }
> = {
  indigo: {
    bg: 'bg-indigo-50',
    text: 'text-indigo-600',
    ring: 'ring-indigo-100',
    solid: 'from-indigo-500 to-violet-500',
    bar: 'from-indigo-400 to-violet-500',
    glow: 'rgba(99, 102, 241, 0.18)',
    chip: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  },
  violet: {
    bg: 'bg-violet-50',
    text: 'text-violet-600',
    ring: 'ring-violet-100',
    solid: 'from-violet-500 to-fuchsia-500',
    bar: 'from-violet-400 to-fuchsia-500',
    glow: 'rgba(139, 92, 246, 0.18)',
    chip: 'border-violet-200 bg-violet-50 text-violet-700',
  },
  emerald: {
    bg: 'bg-emerald-50',
    text: 'text-emerald-600',
    ring: 'ring-emerald-100',
    solid: 'from-emerald-500 to-teal-500',
    bar: 'from-emerald-400 to-teal-500',
    glow: 'rgba(16, 185, 129, 0.18)',
    chip: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  },
  blue: {
    bg: 'bg-blue-50',
    text: 'text-blue-600',
    ring: 'ring-blue-100',
    solid: 'from-blue-500 to-cyan-500',
    bar: 'from-blue-400 to-cyan-500',
    glow: 'rgba(59, 130, 246, 0.18)',
    chip: 'border-blue-200 bg-blue-50 text-blue-700',
  },
  cyan: {
    bg: 'bg-cyan-50',
    text: 'text-cyan-600',
    ring: 'ring-cyan-100',
    solid: 'from-cyan-500 to-sky-500',
    bar: 'from-cyan-400 to-sky-500',
    glow: 'rgba(6, 182, 212, 0.18)',
    chip: 'border-cyan-200 bg-cyan-50 text-cyan-700',
  },
  teal: {
    bg: 'bg-teal-50',
    text: 'text-teal-600',
    ring: 'ring-teal-100',
    solid: 'from-teal-500 to-emerald-500',
    bar: 'from-teal-400 to-emerald-500',
    glow: 'rgba(20, 184, 166, 0.18)',
    chip: 'border-teal-200 bg-teal-50 text-teal-700',
  },
  amber: {
    bg: 'bg-amber-50',
    text: 'text-amber-600',
    ring: 'ring-amber-100',
    solid: 'from-amber-500 to-orange-500',
    bar: 'from-amber-400 to-orange-500',
    glow: 'rgba(245, 158, 11, 0.18)',
    chip: 'border-amber-200 bg-amber-50 text-amber-800',
  },
  rose: {
    bg: 'bg-rose-50',
    text: 'text-rose-600',
    ring: 'ring-rose-100',
    solid: 'from-rose-500 to-pink-500',
    bar: 'from-rose-400 to-pink-500',
    glow: 'rgba(244, 63, 94, 0.18)',
    chip: 'border-rose-200 bg-rose-50 text-rose-700',
  },
  slate: {
    bg: 'bg-slate-100',
    text: 'text-slate-600',
    ring: 'ring-slate-100',
    solid: 'from-slate-500 to-slate-700',
    bar: 'from-slate-300 to-slate-400',
    glow: 'rgba(100, 116, 139, 0.16)',
    chip: 'border-slate-200 bg-slate-50 text-slate-600',
  },
};

const toneOf = (tone: EmpTone | undefined) => EMP_TONES[tone ?? 'indigo'] ?? EMP_TONES.indigo;

/* ------------------------------------------------------------------------------------------------
 * The module map
 *
 * One list, used by both the hub's cards and the sub-navigation, so a screen cannot appear in one
 * and be missing from the other — which is how the old hub ended up offering tiles for pages whose
 * own back button was the only way anybody ever reached their siblings.
 * ---------------------------------------------------------------------------------------------- */

/** Which permission a destination needs. Resolved by `useEmployeeAccess`, not here. */
type EmployeeNeed = 'view' | 'sync' | 'link';

/**
 * How the hub groups its destinations.
 *
 * Not the four groups the old hub used (Directory / Time & leave / Sync & setup / Payroll). Those
 * described where the *data* comes from, which is a fact about the integration rather than about
 * what anybody is trying to do — and they produced groups of three, two, four and two, so the grid
 * ended every second section with a gap.
 *
 * These three describe the reader's intent instead: the screens opened daily, the registers that
 * are read, and the definitions and plumbing behind them. It also falls out at three, four and four
 * — a spotlight row and two even pairs of rows, with no ragged tail.
 */
export type EmployeeGroupKey = 'primary' | 'register' | 'setup';

export const EMPLOYEE_GROUPS: Array<{ key: EmployeeGroupKey; title: string; icon: LucideIcon; blurb: string }> = [
  { key: 'primary', title: 'Start here', icon: Sparkles, blurb: 'The three screens this module is opened for.' },
  { key: 'register', title: 'Registers & reports', icon: BarChart3, blurb: 'Read-only views of what greytHR already holds.' },
  { key: 'setup', title: 'Masters & setup', icon: SlidersHorizontal, blurb: 'The definitions and links the screens above rely on.' },
];

export type EmployeeNavKey =
  | 'overview'
  | 'manage'
  | 'current'
  | 'reports'
  | 'leave'
  | 'attendance'
  | 'swipes'
  | 'sync'
  | 'category'
  | 'position'
  | 'linking'
  | 'salary'
  | 'payslip';

export interface EmployeeNavItem {
  key: EmployeeNavKey;
  /** The full name, as the hub shows it. */
  label: string;
  /** The abbreviated name for the sub-nav pill, where ten of these share one row. */
  short: string;
  /** One line. The hub used to print two or three, which is what made it read as a wall of prose. */
  description: string;
  href: string;
  icon: LucideIcon;
  tone: EmpTone;
  group: EmployeeGroupKey;
  need: EmployeeNeed;
  /** Not built yet: shown, labelled, and deliberately not a link. */
  comingSoon?: boolean;
  /** The long version — why it is not built, for the hub's tooltip. */
  note?: string;
  /** Left out of the sub-nav. For destinations that leave the module. */
  navHidden?: boolean;
}

export const EMPLOYEE_NAV: EmployeeNavItem[] = [
  {
    key: 'manage',
    label: 'Manage Employee',
    short: 'Roster',
    description: 'The full roster, current and departed, corrected against greytHR.',
    href: '/employee/manage',
    icon: Users,
    tone: 'indigo',
    group: 'primary',
    need: 'view',
  },
  {
    key: 'current',
    label: 'Current Employees',
    short: 'Live',
    description: 'Who greytHR says is employed right now — fetched fresh, not from the mirror.',
    href: '/employee/current',
    icon: UserCheck,
    tone: 'emerald',
    group: 'primary',
    need: 'view',
  },
  {
    key: 'reports',
    label: 'Reports',
    short: 'Reports',
    description: 'Headcount, joiners and exits, and category breakdowns.',
    href: '/employee/reports',
    icon: BarChart3,
    tone: 'violet',
    group: 'register',
    need: 'view',
  },
  {
    key: 'leave',
    label: 'Leave register',
    short: 'Leave',
    description: 'Every employee’s leave balance by type, organisation-wide.',
    href: '/employee/leave',
    icon: CalendarClock,
    tone: 'cyan',
    group: 'register',
    need: 'view',
  },
  {
    key: 'attendance',
    label: 'Attendance register',
    short: 'Attendance',
    description: 'The synced monthly attendance summary, everyone in one table.',
    href: '/employee/attendance',
    icon: Clock,
    tone: 'blue',
    group: 'register',
    need: 'view',
  },
  {
    key: 'swipes',
    label: 'Daily swipes',
    short: 'Swipes',
    description: 'Day-by-day first in, last out and hours worked, per month.',
    href: '/employee/swipes',
    icon: Fingerprint,
    tone: 'violet',
    group: 'register',
    need: 'view',
  },
  {
    key: 'sync',
    label: 'Sync with GreytHR',
    short: 'Sync',
    description: 'Schedule, run and review the sync that keeps the mirror current.',
    href: '/employee/sync',
    icon: DownloadCloud,
    tone: 'blue',
    group: 'primary',
    need: 'sync',
  },
  {
    key: 'category',
    label: 'Manage Category',
    short: 'Categories',
    description: 'The department, designation, grade and project masters, as mirrored.',
    href: '/employee/category',
    icon: Tags,
    tone: 'teal',
    group: 'setup',
    need: 'view',
  },
  {
    key: 'position',
    label: 'Position Details',
    short: 'Positions',
    description: 'Effective-dated category history, per employee.',
    href: '/employee/position-details',
    icon: Briefcase,
    tone: 'violet',
    group: 'setup',
    need: 'view',
  },
  {
    key: 'linking',
    label: 'greytHR Linking',
    short: 'Linking',
    description: 'Reconcile platform logins with greytHR employees — who is linked, who is not.',
    href: '/settings/access-management/greythr-linking',
    icon: Link2,
    tone: 'amber',
    group: 'setup',
    need: 'link',
    // Lives in access management. Offered here because this is where somebody looking for it goes,
    // but kept out of the sub-nav: a pill that leaves the module cannot show as current.
    navHidden: true,
  },
  {
    key: 'salary',
    label: 'Employee Salary',
    short: 'Salary',
    description: 'Gross, deductions and net pay by month, as last synced.',
    href: '/employee/salary',
    icon: IndianRupee,
    tone: 'emerald',
    group: 'register',
    need: 'view',
  },
  {
    key: 'payslip',
    label: 'Pay Slip Config',
    short: 'Pay slips',
    description: 'Blocked on the salary-row migration.',
    href: '#',
    icon: FileText,
    tone: 'slate',
    group: 'setup',
    need: 'view',
    comingSoon: true,
    note:
      'greytHR’s monthly salary sync still writes into the employee mirror rather than its own collection. See docs/greythr-integration.md §11a.',
    navHidden: true,
  },
];

export interface EmployeeAccess {
  isLoading: boolean;
  canView: boolean;
  canSync: boolean;
  canLink: boolean;
  /** Whether a destination's permission is held. */
  permits: (item: EmployeeNavItem) => boolean;
}

/**
 * The module's three permissions, resolved once.
 *
 * Gating is per destination rather than per page, and that distinction is deliberate: somebody who
 * may read the roster but not run a sync should not see Sync with GreytHR, which is a different
 * statement from "you cannot open Employee Management". Destinations they cannot use are removed
 * rather than disabled — a greyed-out tile still advertises a capability and invites a support
 * ticket nobody can action.
 */
export function useEmployeeAccess(): EmployeeAccess {
  const { can, isLoading } = useAuthorization();

  const canView = can('View', 'Settings.Employee Management');
  const canSync = can('Sync from GreytHR', 'Settings.Employee Management');
  const canLink = can('View', 'Settings.User Management');

  return React.useMemo(
    () => ({
      isLoading,
      canView,
      canSync,
      canLink,
      permits: (item: EmployeeNavItem) =>
        item.need === 'sync' ? canSync : item.need === 'link' ? canLink : canView,
    }),
    [isLoading, canView, canSync, canLink],
  );
}

/* ------------------------------------------------------------------------------------------------
 * Page shell
 * ---------------------------------------------------------------------------------------------- */

/**
 * Backdrop, page padding and an optional width ceiling — once, for all ten screens.
 *
 * `overflow-x-clip`, not the `overflow-hidden` every one of these pages had. `overflow: hidden`
 * makes the element a scroll container, and a scroll container that never scrolls silently disables
 * `position: sticky` in everything inside it — which is why a sticky table header in one of these
 * registers would have quietly refused to stick. `clip` contains stray horizontal overflow without
 * establishing one; the aurora clips itself.
 *
 * `hr-module-root` (the kit's 44px-tap-target phone ruleset) is not applied here: the module's
 * `layout.tsx` already puts it on the route, so every screen has it whether or not it uses this
 * shell.
 */
export function EmployeePageShell({
  children,
  width = 'full',
  className,
}: {
  children: React.ReactNode;
  /** `wide` caps the content on a large monitor; the registers want the full width. */
  width?: 'full' | 'wide';
  className?: string;
}) {
  return (
    <div className="relative min-h-[calc(100dvh-4rem)] overflow-x-clip px-4 py-3 sm:px-5">
      <AuroraBackdrop />
      <div className={cn('relative', width === 'wide' && 'mx-auto max-w-7xl', className)}>{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Header
 * ---------------------------------------------------------------------------------------------- */

/**
 * A bordered status pill — "Live from greytHR", "synced 4 hours ago", "credentials not configured".
 *
 * `pulse` adds the two-layer ping dot Current Employees introduced for its live badge. It means one
 * specific thing: the data on screen was fetched on this page load. Anything else that pulses is
 * decoration, and decoration that mimics a liveness indicator is a lie.
 */
export function EmployeeStatusPill({
  tone = 'slate',
  icon: Icon,
  pulse = false,
  title,
  className,
  children,
}: {
  tone?: EmpTone;
  icon?: LucideIcon;
  pulse?: boolean;
  title?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const palette = toneOf(tone);
  return (
    <span
      title={title}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        palette.chip,
        className,
      )}
    >
      {pulse && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
        </span>
      )}
      {Icon && !pulse && <Icon className="h-3 w-3" />}
      {children}
    </span>
  );
}

/**
 * The header every screen in the module wears.
 *
 * Three things it does that the ten hand-rolled headers did not:
 *
 *  - the back control sits *in* the header, beside the icon, instead of alone on a row above it.
 *    That row cost 40 vertical pixels on every screen to render one unlabelled arrow;
 *  - the title gets a filled, tone-coloured icon tile, so a screen is recognisable before its
 *    heading is read — and the tone is the same one the hub's card for that screen carries, which
 *    is what makes arriving somewhere feel like arriving *there*;
 *  - status pills sit on the title's own line rather than being smuggled into `actions` next to the
 *    buttons, which is where three of these pages had put them.
 *
 * The description is `hidden sm:block` by default. A sentence of orientation is worth the space on
 * a desktop; on a 600px-tall phone it is two lines between the reader and the register they opened
 * the page for.
 */
export function EmployeeHeader({
  icon: Icon,
  tone = 'indigo',
  eyebrow,
  title,
  description,
  showDescriptionOnMobile = false,
  backHref,
  backLabel,
  status,
  meta,
  actions,
  className,
}: {
  icon: LucideIcon;
  tone?: EmpTone;
  /** A small line above the title — the module name on a sub-page, so the hub's own title is not lost. */
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  showDescriptionOnMobile?: boolean;
  /** Omitted on the hub, which is reached from Settings by its own breadcrumb. */
  backHref?: string;
  backLabel?: string;
  /** Pills on the title's line. */
  status?: React.ReactNode;
  /** A line under the description — freshness stamps, period ranges, row counts. */
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  const palette = toneOf(tone);

  return (
    <Card
      className={cn(
        'animate-emp-card-in mb-3 flex flex-col gap-3 rounded-2xl p-3 sm:p-4 lg:flex-row lg:items-center lg:justify-between lg:gap-5',
        EMP_CARD_CLASS,
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-2.5 sm:gap-3">
        {backHref && (
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="mt-0.5 h-9 w-9 shrink-0 rounded-full bg-white/70 shadow-sm backdrop-blur max-sm:h-11 max-sm:w-11"
          >
            <Link href={backHref} aria-label={backLabel ?? 'Back'}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
        )}

        <span
          className={cn(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br shadow-sm max-sm:hidden sm:h-12 sm:w-12',
            palette.solid,
          )}
        >
          <Icon className="h-5 w-5 text-white sm:h-[1.35rem] sm:w-[1.35rem]" />
        </span>

        <div className="min-w-0">
          {eyebrow && (
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{eyebrow}</p>
          )}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h1 className="text-lg font-semibold tracking-tight text-slate-800 sm:text-xl">{title}</h1>
            {status}
          </div>
          {description && (
            <p
              className={cn(
                'mt-0.5 max-w-2xl text-sm text-muted-foreground',
                !showDescriptionOnMobile && 'hidden sm:block',
              )}
            >
              {description}
            </p>
          )}
          {meta && <p className="mt-1 text-xs text-muted-foreground">{meta}</p>}
        </div>
      </div>

      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 max-sm:[&>*]:flex-1 lg:justify-end">{actions}</div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Sub-navigation
 * ---------------------------------------------------------------------------------------------- */

/**
 * The module's own pages, one tap from any of them.
 *
 * The single largest usability gap in Employee Management was that it had no navigation at all:
 * ten screens, each reachable only from the hub, each offering one arrow back to it. Going from the
 * leave register to the attendance register — the two screens most often read together — took three
 * taps and two full page loads.
 *
 * A pill strip rather than a tab bar because these are routes, not tabs: they are `<Link>`s, they
 * pre-fetch, and the current one is marked with `aria-current="page"`. It scrolls horizontally on a
 * phone with the scrollbar hidden, which is the same behaviour the kit already gives tab strips
 * there.
 */
export function EmployeeSubNav({ current, className }: { current: EmployeeNavKey; className?: string }) {
  const access = useEmployeeAccess();

  // Nothing is known until the permission snapshot lands, and a strip that appears one item at a
  // time as it resolves reads as broken. Held back entirely for the one frame it takes.
  if (access.isLoading) return null;

  const items = EMPLOYEE_NAV.filter(item => !item.navHidden && !item.comingSoon && access.permits(item));
  if (items.length === 0) return null;

  const pill = (isCurrent: boolean) =>
    cn(
      'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-medium transition-colors max-sm:h-9 sm:h-8',
      isCurrent
        ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
        : 'border-white/70 bg-white/70 text-slate-600 shadow-sm backdrop-blur-sm hover:border-slate-300 hover:bg-white hover:text-slate-900',
    );

  return (
    <nav
      aria-label="Employee Management"
      className={cn(
        'mb-3 flex items-center gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      <Link href="/employee" className={pill(current === 'overview')} aria-current={current === 'overview' ? 'page' : undefined}>
        <LayoutGrid className="h-3.5 w-3.5" />
        Overview
      </Link>
      {items.map(item => {
        const isCurrent = item.key === current;
        return (
          <Link
            key={item.key}
            href={item.href}
            className={pill(isCurrent)}
            aria-current={isCurrent ? 'page' : undefined}
          >
            <item.icon className="h-3.5 w-3.5" />
            {item.short}
          </Link>
        );
      })}
    </nav>
  );
}

/* ------------------------------------------------------------------------------------------------
 * KPI card
 * ---------------------------------------------------------------------------------------------- */

/**
 * The module's KPI card: the shared `HrKpiCard`'s content with the three touches that make a
 * register's headline row read as a dashboard rather than as four printed boxes — a tone-coloured
 * accent bar drawn across the top, a value that rolls up instead of appearing, and a border that
 * glows toward the cursor.
 *
 * `value` is a node, not a string, so a card can carry a `<SensitiveMoney>` figure without the
 * caller stringifying it — but it renders inside a `<p>`, so it must not be a `<div>`. A
 * `<Skeleton>` here is exactly the hydration error this module has already fixed twice; use an
 * em dash or an ellipsis while loading. Pass a `number` to get the count-up.
 */
export function EmployeeKpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'slate',
  href,
  index = 0,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon?: LucideIcon;
  tone?: EmpTone;
  href?: string;
  /** Position in the row — staggers the entrance so four cards do not land at once. */
  index?: number;
  className?: string;
}) {
  const palette = toneOf(tone);
  const delay = `${index * 60}ms`;

  const body = (
    <SpotlightCard
      spotlightColor={palette.glow}
      style={{ animationDelay: delay }}
      className={cn(
        'animate-emp-card-in group h-full rounded-xl border transition-all duration-300',
        EMP_CARD_CLASS,
        href && 'hover:-translate-y-0.5 hover:shadow-md',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn('animate-emp-accent block h-[3px] w-full bg-gradient-to-r', palette.bar)}
        style={{ animationDelay: `calc(${delay} + 170ms)` }}
      />
      {/*
        The icon appears only from `lg`, and nothing here truncates.

        Four of these share the row, so between a phone and a laptop each card is 180–260px wide.
        With the icon present from `sm` and `truncate` on the value, a tablet rendered "Last synced
        18 days a…" and "Checked against …" — the card's whole payload, cut. A decorative chip is
        not worth 48px of a 185px card, and a KPI whose *value* is elided is worse than a KPI with
        no icon. Long values and hints wrap to two lines instead; the grid stretches the row to
        match, so the cards stay level.
      */}
      <div className="flex items-start gap-3 p-3 sm:p-4">
        {Icon && (
          <span
            className={cn(
              'hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-4 transition-transform duration-300 group-hover:scale-110 lg:flex',
              palette.bg,
              palette.ring,
            )}
          >
            <Icon className={cn('h-4 w-4', palette.text)} />
          </span>
        )}
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase leading-tight tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className="mt-0.5 text-lg font-semibold leading-tight text-slate-800">
            {typeof value === 'number' ? <CountUp value={value} /> : value}
          </p>
          {hint && <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">{hint}</p>}
        </div>
      </div>
    </SpotlightCard>
  );

  return href ? (
    <Link href={href} className="block h-full">
      {body}
    </Link>
  ) : (
    body
  );
}

/* ------------------------------------------------------------------------------------------------
 * Hub vocabulary
 * ---------------------------------------------------------------------------------------------- */

/** A section heading with a hairline rule, so a group of rows reads as a group. */
export function EmployeeSectionLabel({
  icon: Icon,
  title,
  hint,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cn('mb-2 flex items-center gap-2.5', className)}>
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
      <h2 className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{title}</h2>
      <span aria-hidden className="h-px min-w-4 flex-1 bg-gradient-to-r from-slate-200 to-transparent" />
      {hint && <span className="shrink-0 text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

/**
 * The hub's headline destination: a tall card with a filled icon tile, a one-line description and a
 * footer that carries a live figure.
 *
 * Reserved for the three screens people actually open — the roster, the live roster and the sync.
 * The old hub gave all eleven destinations an identical card, which is the flat-grid failure mode:
 * "Manage Employee", opened daily, looked exactly like "Pay Slip Config", which does not exist yet.
 */
export function EmployeeSpotlightCard({
  item,
  footer,
  index = 0,
  className,
}: {
  item: EmployeeNavItem;
  /** A live figure — record counts, a freshness pill. Nodes, because most are pills. */
  footer?: React.ReactNode;
  index?: number;
  /** Grid placement from the caller — the odd card out spans the row on a two-column layout. */
  className?: string;
}) {
  const palette = toneOf(item.tone);

  return (
    <Link href={item.href} className={cn('group block h-full no-underline', className)}>
      <SpotlightCard
        spotlightColor={palette.glow}
        style={{ animationDelay: `${index * 70}ms` }}
        className={cn(
          'animate-emp-card-in flex h-full flex-col rounded-2xl border transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg',
          EMP_CARD_CLASS,
        )}
      >
        <span
          aria-hidden
          className={cn('animate-emp-accent block h-[3px] w-full bg-gradient-to-r', palette.bar)}
          style={{ animationDelay: `calc(${index * 70}ms + 170ms)` }}
        />
        <div className="flex flex-1 flex-col p-4">
          {/* `flex-1` on the content row, not just on the column: it makes this row absorb the
              card's spare height so the footer sits on the bottom edge. Without it a card whose
              description runs to one line puts its footer a line higher than its neighbours', and
              three cards in a row show three different divider heights. */}
          <div className="flex flex-1 items-start gap-3">
            <span
              className={cn(
                'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br shadow-sm transition-transform duration-300 group-hover:scale-105',
                palette.solid,
              )}
            >
              <item.icon className="h-5 w-5 text-white" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[0.95rem] font-semibold leading-snug text-slate-800">{item.label}</p>
              <p className="mt-1 text-sm leading-snug text-muted-foreground">{item.description}</p>
            </div>
            <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-slate-300 transition-all duration-300 group-hover:translate-x-0.5 group-hover:text-slate-500" />
          </div>
          {footer && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-xs text-muted-foreground">
              {footer}
            </div>
          )}
        </div>
      </SpotlightCard>
    </Link>
  );
}

/**
 * Everything else on the hub: a compact row — tinted icon, name, one line, chevron.
 *
 * Rows rather than more cards. Eleven equal cards at ~100px each is 1,100px of near-identical
 * surface to scan and a ragged last row wherever a group has two members; the same eleven as rows
 * is under half that, and a group reads as a list you can run your eye down.
 */
export function EmployeeToolRow({ item, index = 0 }: { item: EmployeeNavItem; index?: number }) {
  const palette = toneOf(item.tone);

  const inner = (
    <>
      <span
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-4 transition-transform duration-300',
          palette.bg,
          palette.ring,
          !item.comingSoon && 'group-hover:scale-110',
        )}
      >
        <item.icon className={cn('h-4 w-4', item.comingSoon ? 'text-slate-400' : palette.text)} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className={cn('text-sm font-semibold', item.comingSoon ? 'text-slate-500' : 'text-slate-800')}>
            {item.label}
          </span>
          {item.comingSoon && (
            <Badge variant="outline" className="border-slate-200 bg-slate-50 text-[10px] font-medium text-slate-500">
              Coming soon
            </Badge>
          )}
        </span>
        <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{item.description}</span>
      </span>
      {!item.comingSoon && (
        <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition-all duration-300 group-hover:translate-x-0.5 group-hover:text-slate-500" />
      )}
    </>
  );

  const shell = 'group flex items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors';

  // Not a link and not focusable: nothing here responds to a click, so it should neither look nor
  // behave as though it might. The `title` carries the long explanation the old card printed in
  // full — three lines of migration detail in a grid of one-line descriptions.
  if (item.comingSoon) {
    return (
      <div className={cn(shell, 'cursor-default opacity-75')} aria-disabled="true" title={item.note}>
        {inner}
      </div>
    );
  }

  return (
    <Link
      href={item.href}
      style={{ animationDelay: `${index * 40}ms` }}
      className={cn(shell, 'animate-emp-card-in no-underline hover:bg-slate-50/80')}
    >
      {inner}
    </Link>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Register furniture
 * ---------------------------------------------------------------------------------------------- */

/**
 * The height a register's desktop table scrolls within, passed to `DataList`'s
 * `maxHeightClassName` — which also pins the header row to the top of it.
 *
 * These registers are 1,300 rows of near-identical shape, and reading one on a desktop meant
 * scrolling the whole page until the column headers were gone and every row was an unlabelled line
 * of numbers. Giving the table its own scroll frame keeps the headers, the filters and the KPI row
 * on screen while the rows move under them.
 *
 * The `min-h` is not redundant: on a 700px laptop the subtraction would otherwise leave a frame a
 * few rows tall, and when a min exceeds a max CSS keeps the min — so the table is never shorter
 * than about eight rows, even if that reintroduces a little page scrolling.
 */
export const EMP_REGISTER_HEIGHT = 'sm:max-h-[calc(100dvh-23rem)] sm:min-h-[20rem]';

/**
 * The "showing 300 of 1,284 · show 300 more" footer under a windowed register.
 *
 * Four screens in the module page their rows this way and had written this block four times, with
 * four different sentences. The count is the important part: a register that silently renders the
 * first 300 of 1,300 rows is indistinguishable from one that is missing a thousand people.
 */
export function EmployeeListFooter({
  shown,
  total,
  noun = 'row',
  pageSize,
  onMore,
}: {
  shown: number;
  total: number;
  /** Singular; pluralised with a trailing "s". */
  noun?: string;
  pageSize: number;
  onMore: () => void;
}) {
  if (total === 0) return null;
  const remaining = total - shown;

  return (
    <div className="flex flex-col items-center gap-2 pb-2 text-center">
      <p className="text-xs text-muted-foreground">
        Showing <span className="font-medium text-slate-700">{shown.toLocaleString()}</span> of{' '}
        {total.toLocaleString()} {noun}
        {total === 1 ? '' : 's'}
      </p>
      {remaining > 0 && (
        <Button variant="outline" size="sm" onClick={onMore} className="bg-white/80">
          Show {Math.min(pageSize, remaining).toLocaleString()} more
        </Button>
      )}
    </div>
  );
}

/**
 * A show/hide menu for a register's columns.
 *
 * Built because Position Details' column-wise view has one column per category — eleven at this
 * tenant, plus the employee — and a twelve-column table is only useful if a reader can put away the
 * eight they are not looking at. Kept here rather than in that page because every register in this
 * module is a candidate for it.
 *
 * The caller owns the hidden set and locks whichever column identifies the row: a table whose first
 * column can be hidden becomes a grid of values belonging to nobody. `locked` columns are listed
 * with a ticked, disabled box rather than omitted, so the menu still describes the whole table.
 */
export function EmployeeColumnPicker({
  columns,
  hidden,
  onChange,
  locked = [],
  label = 'Columns',
}: {
  /** Column keys, in table order. `HrListColumn.header` is the natural key. */
  columns: string[];
  /** The keys currently hidden. */
  hidden: Set<string>;
  onChange: (hidden: Set<string>) => void;
  locked?: string[];
  label?: string;
}) {
  const lockedSet = new Set(locked);
  const shown = columns.filter(column => !hidden.has(column)).length;

  const toggle = (column: string) => {
    if (lockedSet.has(column)) return;
    const next = new Set(hidden);
    if (next.has(column)) next.delete(column);
    else next.add(column);
    onChange(next);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="bg-white/80">
          <Columns3 className="mr-1.5 h-4 w-4" />
          {label}
          {/* The count, so a reader who has hidden eight columns is reminded why the table looks
              short — a filter with no visible state is a filter people forget they set. */}
          <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 text-[10px] font-semibold tabular-nums text-slate-600">
            {shown}/{columns.length}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[60vh] w-56 overflow-y-auto">
        <DropdownMenuLabel className="text-xs">Show columns</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {columns.map(column => (
          <DropdownMenuCheckboxItem
            key={column}
            checked={!hidden.has(column)}
            disabled={lockedSet.has(column)}
            // Radix closes the menu on select by default, which makes turning three columns off
            // three trips through the trigger.
            onSelect={event => event.preventDefault()}
            onCheckedChange={() => toggle(column)}
            className="text-xs"
          >
            {column}
          </DropdownMenuCheckboxItem>
        ))}
        {hidden.size > 0 && (
          <>
            <DropdownMenuSeparator />
            <button
              type="button"
              onClick={() => onChange(new Set())}
              className="w-full px-2 py-1.5 text-left text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              Show all {columns.length}
            </button>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A failed load, stated where the data would have been rather than in a toast that disappears. */
export function EmployeeErrorBanner({
  children,
  onRetry,
  className,
}: {
  children: React.ReactNode;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive',
        className,
      )}
    >
      <span className="min-w-0">{children}</span>
      {onRetry && (
        <Button variant="outline" size="sm" className="shrink-0 bg-white/80" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

'use client';

/**
 * The KPI card and page header the application's screens share.
 *
 * These lived in `@/components/hr/hr-ui` and were used well beyond HR — fifty files across HR,
 * Employee and elsewhere import them, and the `Hr` prefix had stopped describing anything. They are
 * moved here, unchanged, for one concrete reason: `hr-ui.tsx` imports `@/lib/hr-requirement` for its
 * status and currency helpers, which pulls in `hr-policy.ts` — about thirty-six hundred lines of HR
 * business rules. Fine on an HR screen. Not fine on the home page, which now shows four of these
 * cards and would otherwise carry the entire HR rulebook to render them.
 *
 * `hr-ui.tsx` re-exports both under their old names, so none of the existing call sites changed.
 * New code should import from here.
 *
 * Styling note: the palette is deliberately light-only (`bg-white/80`, `text-slate-800`). That is
 * what every screen already using these renders as, and a card that quietly restyled itself in dark
 * mode would look broken beside the fifty that do not.
 */

import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export type Tone =
  | 'slate'
  | 'emerald'
  | 'amber'
  | 'rose'
  | 'blue'
  | 'indigo'
  | 'orange'
  | 'violet'
  | 'teal'
  | 'cyan';

export const TONES: Record<Tone, { bg: string; text: string; ring: string }> = {
  slate: { bg: 'bg-slate-50', text: 'text-slate-600', ring: 'ring-slate-100' },
  emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600', ring: 'ring-emerald-100' },
  amber: { bg: 'bg-amber-50', text: 'text-amber-600', ring: 'ring-amber-100' },
  rose: { bg: 'bg-rose-50', text: 'text-rose-600', ring: 'ring-rose-100' },
  blue: { bg: 'bg-blue-50', text: 'text-blue-600', ring: 'ring-blue-100' },
  indigo: { bg: 'bg-indigo-50', text: 'text-indigo-600', ring: 'ring-indigo-100' },
  orange: { bg: 'bg-orange-50', text: 'text-orange-600', ring: 'ring-orange-100' },
  violet: { bg: 'bg-violet-50', text: 'text-violet-600', ring: 'ring-violet-100' },
  teal: { bg: 'bg-teal-50', text: 'text-teal-600', ring: 'ring-teal-100' },
  cyan: { bg: 'bg-cyan-50', text: 'text-cyan-600', ring: 'ring-cyan-100' },
};

/** Tailwind gradient classes per tone, for the optional accent bar. */
const ACCENT: Record<Tone, string> = {
  slate: 'from-slate-300 to-slate-400',
  emerald: 'from-emerald-400 to-emerald-500',
  amber: 'from-amber-400 to-amber-500',
  rose: 'from-rose-400 to-rose-500',
  blue: 'from-blue-400 to-blue-500',
  indigo: 'from-indigo-400 to-indigo-500',
  orange: 'from-orange-400 to-orange-500',
  violet: 'from-violet-400 to-violet-500',
  teal: 'from-teal-400 to-teal-500',
  cyan: 'from-cyan-400 to-cyan-500',
};

export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'slate',
  href,
  className,
  style,
  accent = false,
  accentClassName,
}: {
  label: string;
  /** A node so a card can show a `<Money>` figure without the caller stringifying it. */
  value: React.ReactNode;
  hint?: string;
  icon?: React.ElementType;
  tone?: Tone;
  href?: string;
  /** Extra classes on the card — entrance animation, hover lift, a stagger delay. */
  className?: string;
  /** Inline style on the card — the home dashboard uses it to set its `--wd-delay` stagger. */
  style?: React.CSSProperties;
  /**
   * Draws a thin gradient bar across the top of the card in the tone's colour.
   *
   * Off by default, so the fifty screens already using this card look exactly as they did. On, it
   * gives a row of cards a colour identity without tinting the whole surface — which on a
   * `bg-white/80 backdrop-blur-sm` card muddies the text rather than decorating it.
   */
  accent?: boolean;
  /** Classes for the accent bar itself, e.g. an animation. */
  accentClassName?: string;
}) {
  const palette = TONES[tone] || TONES.slate;

  const body = (
    <Card
      className={cn(
        'relative h-full overflow-hidden border-white/60 bg-white/80 shadow-sm backdrop-blur-sm transition-shadow',
        href && 'hover:shadow-md',
        className,
      )}
      style={style}
    >
      {accent && (
        <span
          aria-hidden
          className={cn(
            'absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r',
            ACCENT[tone] || ACCENT.slate,
            accentClassName,
          )}
        />
      )}
      <CardContent className="flex items-start gap-3 p-4">
        {Icon && (
          <span
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-4',
              palette.bg,
              palette.ring,
            )}
          >
            <Icon className={cn('h-4 w-4', palette.text)} />
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-0.5 truncate text-lg font-semibold leading-tight text-slate-800">{value}</p>
          {hint && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{hint}</p>}
        </div>
      </CardContent>
    </Card>
  );

  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    // Stacked on a phone with full-width actions, side by side from `sm` up.
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight text-slate-800 sm:text-xl">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">{actions}</div>}
    </div>
  );
}

'use client';

/**
 * The band at the top of Settings › Overview: who is signed in, and how complete the company's
 * set-up is. The ring is the share of checks passing (only checks this person may see are made);
 * its button scrolls to the list of what needs attention, so the number is one press from its rows.
 *
 * It wears the work board's band (`.wd-hero` in globals.css): dark in both themes, tinted by the
 * accent, `keep-light` so the dark-mode compatibility layer leaves its white text alone.
 */

import type { LucideIcon } from 'lucide-react';
import { ArrowDown, CheckCircle2 } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { longDate } from '@/components/home/home-data';
import { useCountUp } from '@/components/work-dashboard/use-count-up';
import type { CheckSummary } from '@/lib/settings-overview';
import { cn } from '@/lib/utils';

export interface HeroFact {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';
}

// Status colours on a dark band; each always sits beside words that say the same thing.
const ringTone = (score: number) => (score >= 90 ? 'text-emerald-300' : score >= 60 ? 'text-amber-300' : 'text-rose-300');

function HealthRing({ score }: { score: number }) {
  const shown = useCountUp(score);
  const radius = 40;
  const length = 2 * Math.PI * radius;
  return (
    <div className="relative h-24 w-24 shrink-0" aria-hidden="true">
      <svg viewBox="0 0 96 96" className="h-full w-full -rotate-90">
        <circle cx="48" cy="48" r={radius} fill="none" strokeWidth="8" className="stroke-white/15" />
        <circle
          cx="48"
          cy="48"
          r={radius}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          stroke="currentColor"
          strokeDasharray={length}
          strokeDashoffset={length * (1 - shown / 100)}
          className={cn('transition-[stroke-dashoffset] duration-700 ease-out motion-reduce:transition-none', ringTone(score))}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-2xl font-bold tabular-nums tracking-tight text-white">
        {shown}
        <span className="ml-0.5 text-xs font-semibold text-white/70">%</span>
      </span>
    </div>
  );
}

export function OverviewHero({
  name,
  email,
  photoURL,
  roles,
  company,
  facts,
  health,
  attentionId,
}: {
  name: string;
  email?: string;
  photoURL?: string;
  roles: string[];
  /** The company's short name, beside the email. */
  company: string;
  facts: HeroFact[];
  /** `null` when this person may see none of the checked settings. */
  health: CheckSummary | null;
  attentionId: string;
}) {
  const issues = health?.issues.length ?? 0;
  const scrollToAttention = () => document.getElementById(attentionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <section aria-label="Your account and set-up" className="wd-hero keep-light relative overflow-hidden rounded-2xl p-4 text-white shadow-lg sm:p-6">
      <div className="wd-hero-dots pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="relative grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-8">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/70">{longDate()}</p>
          <div className="mt-3 flex min-w-0 items-center gap-3.5">
            <Avatar className="h-14 w-14 shrink-0 ring-2 ring-white/25">
              {photoURL && <AvatarImage src={photoURL} alt="" />}
              <AvatarFallback className="bg-white/15 text-lg font-semibold text-white">{initials(name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <h2 className="truncate text-xl font-bold leading-tight tracking-tight sm:text-2xl">{name || 'Signed in'}</h2>
              <p className="truncate text-sm text-white/75">
                {[email, company].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>
          {roles.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Your roles">
              {roles.slice(0, 5).map((role) => (
                <li key={role} className="max-w-[16rem] truncate rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium ring-1 ring-white/20">
                  {role}
                </li>
              ))}
              {roles.length > 5 && <li className="rounded-full px-2 py-0.5 text-xs text-white/75">+{roles.length - 5} more</li>}
            </ul>
          )}
          {facts.length > 0 && (
            <dl className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {facts.map(({ icon: Icon, label, value, hint }) => (
                <div key={label} className="flex min-w-0 items-start gap-2.5 rounded-xl bg-white/10 px-3 py-2.5 ring-1 ring-white/15">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-white/70" aria-hidden="true" />
                  <div className="min-w-0">
                    <dt className="text-[11px] font-medium uppercase tracking-wide text-white/65">{label}</dt>
                    <dd className="break-words text-sm font-semibold leading-snug">{value}</dd>
                    {hint && <dd className="break-words text-[11px] leading-snug text-white/65">{hint}</dd>}
                  </div>
                </div>
              ))}
            </dl>
          )}
        </div>

        {health && health.total > 0 && (
          <div className="flex min-w-0 items-center gap-4 rounded-2xl bg-white/10 p-4 ring-1 ring-white/15 lg:w-[19rem]">
            <HealthRing score={health.score} />
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-white/70">Set-up health</p>
              <p className="mt-0.5 text-sm font-semibold leading-snug">
                {health.passing} of {health.total} checks pass
              </p>
              {issues ? (
                <Button
                  type="button"
                  size="sm"
                  action={false}
                  onClick={scrollToAttention}
                  className="mt-2 h-8 gap-1.5 bg-white px-3 text-slate-900 shadow-sm hover:bg-white/90"
                >
                  Review {issues === 1 ? '1 item' : `${issues} items`}
                  <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              ) : (
                <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-emerald-200">
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Nothing needs attention
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

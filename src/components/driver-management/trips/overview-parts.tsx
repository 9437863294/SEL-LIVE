'use client';

/**
 * The Overview's own pieces: the hero (this month, and the two things a person comes here to do)
 * and the claim journey (where their money is, stage by stage).
 *
 * The hero is a coloured surface in both themes — its own `dark:` steps, white text, translucent
 * white chips — so the dark-compat layer has nothing to remap; the one white button carries
 * `keep-light` to stay white. The journey uses the pastel chip colours the compat layer already maps.
 */

import Link from 'next/link';
import { ArrowRight, Banknote, ChevronRight, CircleCheck, Hourglass, Navigation, ReceiptText, Wallet, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatKm } from '@/lib/employee-trips/types';
import { cn } from '@/lib/utils';
import type { DashboardData } from './trip-api';
import { Money } from './trip-ui';

type Personal = DashboardData['personal'];

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

const greeting = () => {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
};

/** A dashed route between two stops, drawn faintly behind the hero's figures. */
function RouteArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 320 160" fill="none" aria-hidden className={className}>
      <path d="M18 132 C 70 132, 72 70, 128 70 S 190 18, 246 30 S 300 70, 300 70" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="2 10" />
      <circle cx="18" cy="132" r="7" stroke="currentColor" strokeWidth="3" />
      <path d="M300 44c-10 0-17 7.4-17 16.4C283 72 300 88 300 88s17-16 17-27.6C317 51.4 310 44 300 44Z" fill="currentColor" />
      <circle cx="300" cy="60" r="5" className="fill-sky-600 dark:fill-sky-900" />
    </svg>
  );
}

function HeroFact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-white/20 bg-white/10 px-3 py-2">
      <dt className="truncate text-[11px] font-medium text-white/75">{label}</dt>
      <dd className="truncate text-sm font-semibold tabular-nums text-white">{children}</dd>
    </div>
  );
}

export function OverviewHero({
  today,
  financialYear,
  personal,
  openTrip,
  onStart,
  onClaim,
}: {
  today: string;
  financialYear: string;
  personal: Personal;
  /** A fleet trip that is running now, from the fleet bootstrap. */
  openTrip: { vehicleNumber: string } | null;
  onStart: () => void;
  onClaim: () => void;
}) {
  const month = new Date(`${today}T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const unclaimed = personal.unclaimed.trips;

  return (
    <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-sky-600 via-cyan-600 to-teal-600 p-4 text-white shadow-[0_18px_40px_-24px_rgba(8,145,178,0.9)] sm:p-6 dark:from-sky-900 dark:via-cyan-900 dark:to-teal-900">
      <RouteArt className="pointer-events-none absolute -right-6 -top-6 h-24 w-48 text-white/15 sm:-right-4 sm:top-2 sm:h-44 sm:w-[22rem] sm:text-white/20" />

      <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 lg:max-w-xl">
          <p className="text-xs font-medium text-white/80">
            {greeting()} · {month}
          </p>
          <p className="mt-3 text-sm text-white/85">Reimbursement from this month&apos;s trips</p>
          <p className="mt-0.5 text-3xl font-semibold tracking-tight sm:text-4xl">
            <Money value={personal.thisMonth.amount} />
          </p>
          <dl className="mt-4 grid grid-cols-3 gap-2 sm:max-w-md">
            <HeroFact label="Trips">{personal.thisMonth.trips}</HeroFact>
            <HeroFact label="Distance">{formatKm(personal.thisMonth.km)}</HeroFact>
            <HeroFact label="Paid this FY">
              <Money value={personal.paidThisYear.amount} compact />
            </HeroFact>
          </dl>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row lg:w-64 lg:flex-col">
          {openTrip ? (
            <Button asChild className="keep-light h-11 flex-1 bg-white font-semibold text-emerald-700 shadow-sm hover:bg-emerald-50 lg:flex-none">
              <Link href="/driver-management/fleet">
                <span className="relative mr-2 flex h-2.5 w-2.5" aria-hidden>
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75 motion-reduce:hidden" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                </span>
                <span className="truncate">On a trip · {openTrip.vehicleNumber}</span>
                <ArrowRight className="ml-auto h-4 w-4 shrink-0 pl-0.5" aria-hidden />
              </Link>
            </Button>
          ) : (
            <Button type="button" onClick={onStart} className="keep-light h-11 flex-1 bg-white font-semibold text-sky-700 shadow-sm hover:bg-sky-50 lg:flex-none">
              <Navigation className="mr-2 h-4 w-4" aria-hidden />
              Start a trip
            </Button>
          )}
          {unclaimed > 0 && (
            <Button type="button" onClick={onClaim} className="h-11 flex-1 border border-white/30 bg-white/15 font-semibold text-white shadow-none hover:bg-white/25 lg:flex-none">
              <ReceiptText className="mr-2 h-4 w-4" aria-hidden />
              Claim {plural(unclaimed, 'trip')} · <Money value={personal.unclaimed.amount} compact className="ml-1" />
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

type Step = { label: string; icon: LucideIcon; chip: string; amount: number; hint: string };

/** Unclaimed → in approval → awaiting payment → paid: one card, the stages in the order money moves. */
export function ClaimJourney({ personal, financialYear }: { personal: Personal; financialYear: string }) {
  const steps: Step[] = [
    {
      label: 'Not yet claimed',
      icon: Wallet,
      chip: 'bg-sky-100 text-sky-700',
      amount: personal.unclaimed.amount,
      hint: `${plural(personal.unclaimed.trips, 'trip')} · ${formatKm(personal.unclaimed.km)}`,
    },
    { label: 'In approval', icon: Hourglass, chip: 'bg-amber-100 text-amber-700', amount: personal.inApproval.amount, hint: plural(personal.inApproval.claims, 'claim') },
    { label: 'Awaiting payment', icon: CircleCheck, chip: 'bg-violet-100 text-violet-700', amount: personal.awaitingPayment.amount, hint: `${plural(personal.awaitingPayment.claims, 'claim')} approved` },
    { label: `Paid · FY ${financialYear}`, icon: Banknote, chip: 'bg-emerald-100 text-emerald-700', amount: personal.paidThisYear.amount, hint: plural(personal.paidThisYear.claims, 'claim') },
  ];

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4" aria-labelledby="claim-journey">
      <h2 id="claim-journey" className="mb-3 px-1 text-sm font-semibold text-slate-800">
        Where my money is
      </h2>
      <ol className="grid grid-cols-2 gap-2 lg:grid-cols-4 lg:gap-0">
        {steps.map((step, index) => {
          const Icon = step.icon;
          return (
            <li key={step.label} className={cn('relative min-w-0 rounded-xl bg-slate-50 p-3 lg:rounded-none lg:bg-transparent lg:px-5 lg:py-1', index > 0 && 'lg:border-l lg:border-slate-100')}>
              <div className="flex min-w-0 items-center gap-2">
                <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full', step.chip)} aria-hidden>
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 text-xs font-medium leading-tight text-slate-600">{step.label}</span>
              </div>
              <p className={cn('mt-2.5 truncate text-lg font-semibold leading-tight sm:text-xl', step.amount ? 'text-slate-900' : 'text-slate-400')}>
                <Money value={step.amount} />
              </p>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{step.hint}</p>
              {index < steps.length - 1 && (
                <span className="absolute -right-3 top-1/2 z-10 hidden h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 lg:flex" aria-hidden>
                  <ChevronRight className="h-3.5 w-3.5" />
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** A share of a whole, as one bar in parts; each part's figure is in the legend beside it. */
export function PipelineBar({ parts }: { parts: { label: string; amount: number; claims: number; color: string }[] }) {
  const total = parts.reduce((sum, part) => sum + part.amount, 0);
  return (
    <div className="space-y-3">
      <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={parts.map((part) => `${part.label} ${part.claims} claims`).join(', ')}>
        {total > 0 && parts.filter((part) => part.amount > 0).map((part) => <span key={part.label} className={cn('h-full first:rounded-l-full last:rounded-r-full', part.color)} style={{ width: `${(part.amount / total) * 100}%` }} title={part.label} />)}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        {parts.map((part) => (
          <div key={part.label} className="flex min-w-0 items-start gap-2">
            <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', part.color)} aria-hidden />
            <div className="min-w-0">
              <dt className="truncate text-xs text-muted-foreground">{part.label}</dt>
              <dd className="truncate text-sm font-semibold text-slate-800">
                <Money value={part.amount} compact /> <span className="text-xs font-normal text-muted-foreground">· {plural(part.claims, 'claim')}</span>
              </dd>
            </div>
          </div>
        ))}
      </dl>
    </div>
  );
}

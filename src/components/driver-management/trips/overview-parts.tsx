'use client';

/**
 * The Overview's own pieces, after the "SEL – My Trips" mock-up:
 *
 * - the hero: this month's reimbursement over a drifting teal gradient with a road and a car on it,
 *   and the round Start trip button — red, with a live panel, while a trip is running;
 * - the money pipeline: unclaimed → in approval → awaiting payment → paid, on one rail;
 * - recent trips, each with its GPS route drawn as a thumbnail;
 * - what waits for an approver or payer; the vehicle and the km driven; the rate card.
 *
 * The hero is a coloured surface in both themes and carries `keep-light`, so the dark-compat layer
 * leaves its white glass alone. The cards use the light utilities that layer already maps.
 */

import Link from 'next/link';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import {
  ArrowRight,
  Banknote,
  CarFront,
  CircleCheck,
  Hourglass,
  Inbox,
  IndianRupee,
  Navigation,
  Route,
  Square,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { shortPlace } from '@/lib/fleet/places';
import { formatKm, TRIP_STATUS_LABELS, type TripStatus } from '@/lib/employee-trips/types';
import { cn } from '@/lib/utils';
import type { ClaimRow, DashboardData, InboxCounts, RecentTrip, TrendPoint } from './trip-api';
import { Money } from './trip-ui';
import styles from './overview.module.css';

type Personal = DashboardData['personal'];

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

const greeting = () => {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
};

/** "2 Nov" for a YYYY-MM-DD date. */
const dayMonth = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

/** "own car", "company two-wheeler". */
const vehicleWords = (ownership: RecentTrip['ownership'], vehicleType: string) =>
  `${ownership === 'own' ? 'own' : 'company'} ${vehicleType.trim().toLowerCase() || 'vehicle'}`;

/* ── Shared ───────────────────────────────────────────────────────────────────────────────── */

/**
 * A white glyph on a gradient tile with a soft shadow in its own colour, as the mock-up's app icons.
 * `gradient` is full Tailwind class names (so they are kept); `accent` its end colour as hex.
 */
function AppIcon({ icon: Icon, gradient, accent, className }: { icon: LucideIcon; gradient: string; accent: string; className?: string }) {
  return (
    <span
      aria-hidden
      style={{ boxShadow: `0 6px 14px -5px ${accent}99, inset 0 1px 0 #ffffff45` } as CSSProperties}
      className={cn('grid shrink-0 place-items-center bg-gradient-to-br text-white', gradient, className ?? 'h-[34px] w-[34px] rounded-[10px]')}
    >
      <Icon className="h-[46%] w-[46%]" />
    </span>
  );
}

/** A card with the mock-up's header: icon, title over a one-line description, and an optional right side. */
function OverviewCard({
  id,
  icon,
  gradient,
  accent,
  title,
  description,
  side,
  children,
}: {
  id: string;
  icon: LucideIcon;
  gradient: string;
  accent: string;
  title: string;
  description: string;
  side?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white sm:rounded-[20px]">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-100 px-3.5 py-3 sm:px-[18px] sm:py-3.5">
        <AppIcon icon={icon} gradient={gradient} accent={accent} className="h-[30px] w-[30px] rounded-[9px] sm:h-[34px] sm:w-[34px] sm:rounded-[10px]" />
        <div className="min-w-0 flex-1">
          <h2 id={id} className="text-sm font-bold leading-tight text-slate-900 sm:text-[15px]">
            {title}
          </h2>
          <p className="truncate text-xs text-slate-400">{description}</p>
        </div>
        {side}
      </header>
      {children}
    </section>
  );
}

/** "42:10" or "1:42:10" since the start, ticking each second; its own component so only it re-renders. */
function Elapsed({ since }: { since: string }) {
  const start = Date.parse(since);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  if (!Number.isFinite(start)) return <>—</>;
  const seconds = Math.max(0, Math.floor((now - start) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return <>{h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`}</>;
}

/* ── Hero ─────────────────────────────────────────────────────────────────────────────────── */

/** A trip running now: a company vehicle's fleet trip, or an own vehicle this phone is recording. */
export interface LiveTrip {
  kind: 'own' | 'company';
  /** "OD02CN2501 · own car". */
  vehicle: string;
  startedAt: string;
  /** As of the phone's last sync (company trips); unknown here for an own trip. */
  distanceKm: number | null;
  /** The purpose, or where it began. */
  detail: string;
  /** The own vehicle's rate today, for the estimate. */
  ratePerKm: number | null;
}

/** Kept in step with `.car`'s offset-path in overview.module.css. */
const ROAD_D = 'M560 150 C 700 60, 820 170, 960 90 S 1180 40, 1300 110';

function Road() {
  return (
    <svg className={styles.road} viewBox="520 0 880 220" preserveAspectRatio="xMaxYMid slice" aria-hidden focusable="false">
      <path className={styles.roadDash} d={ROAD_D} fill="none" stroke="#ffffff66" strokeWidth="3" strokeLinecap="round" />
      <circle cx="560" cy="150" r="7" fill="none" stroke="#fff" strokeWidth="2.5" />
      <path d="M1300 92a14 14 0 00-14 14c0 10 14 22 14 22s14-12 14-22a14 14 0 00-14-14z" fill="#ffffff55" />
      <g className={styles.car}>
        <circle r="12" fill="#ffffff33" />
        <circle r="7" fill="#fff" />
      </g>
    </svg>
  );
}

function HeroStat({ label, value, note }: { label: string; value: ReactNode; note: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-white/20 bg-white/10 px-2.5 py-2 backdrop-blur-[8px] sm:rounded-2xl sm:px-3.5 sm:py-2.5">
      <dt className="truncate text-[10.5px] font-semibold text-teal-100 sm:text-[11.5px]">{label}</dt>
      <dd className="truncate text-base font-extrabold tabular-nums sm:text-xl">{value}</dd>
      <dd className="truncate text-[10.5px] text-emerald-200 sm:text-[11px]">{note}</dd>
    </div>
  );
}

function LiveFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold text-teal-100">{label}</p>
      <p className="truncate text-base font-extrabold tabular-nums sm:text-lg">{children}</p>
    </div>
  );
}

export function OverviewHero({
  today,
  personal,
  liveTrip,
  onStart,
}: {
  today: string;
  personal: Personal;
  liveTrip: LiveTrip | null;
  onStart: () => void;
}) {
  const month = new Date(`${today}T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const { trips, km, amount } = personal.thisMonth;
  const paid = personal.paidThisYear;
  const estimate = liveTrip?.distanceKm != null && liveTrip.ratePerKm != null ? liveTrip.distanceKm * liveTrip.ratePerKm : null;
  // 76px on a phone, where it sits beside the amount; the mock-up's 118px from `lg`.
  const goClass = cn(
    styles.go,
    'grid h-[76px] w-[76px] shrink-0 place-items-center rounded-full text-center shadow-[0_14px_30px_-12px_#022c22] transition duration-200 hover:scale-[1.04]',
    'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/60 sm:h-[96px] sm:w-[96px] lg:h-[118px] lg:w-[118px] lg:shadow-[0_18px_40px_-14px_#022c22]',
  );
  const goLabel = 'text-xs font-extrabold leading-tight sm:text-sm';
  const goIcon = 'mx-auto mb-0.5 h-5 w-5 sm:mb-1 sm:h-6 sm:w-6 lg:h-7 lg:w-7';

  return (
    // Phone: the greeting and amount beside the button, the figures under both. From `lg`: the
    // greeting and figures on the left, the button (with its hint) in a column on the right.
    <section
      aria-label="This month"
      className="keep-light relative isolate grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 overflow-hidden rounded-2xl px-4 py-4 text-white sm:gap-y-4 sm:rounded-3xl sm:px-6 sm:py-5 lg:gap-x-6 lg:px-7 lg:py-6"
    >
      <span aria-hidden className={styles.drift} />
      <span aria-hidden className={styles.dots} />
      {/* The road would crowd the figures below this width (the mock-up drops it at 1150px). */}
      <span aria-hidden className="pointer-events-none absolute inset-0 -z-[1] hidden xl:block">
        <Road />
      </span>
      {/* Dark mode: the same picture, a step deeper. */}
      <span aria-hidden className="pointer-events-none absolute inset-0 -z-[1] hidden bg-slate-950/25 dark:block" />

      <div className="col-start-1 row-start-1 min-w-0 max-w-[560px]">
        <p className="text-[11px] font-bold text-teal-100 sm:text-xs">
          {greeting()} · {month}
        </p>
        <p className="mt-1 text-xs font-semibold text-sky-100 sm:mt-2 sm:text-[13px]">Reimbursement from this month&apos;s trips</p>
        <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-[28px] font-extrabold leading-tight tracking-[-0.03em] sm:text-4xl lg:text-[46px]">
          <Money value={amount} />
          <small className="text-xs font-semibold tracking-normal text-teal-100 sm:text-sm">{trips ? `from ${plural(trips, 'trip')}` : 'no trips yet this month'}</small>
        </p>
      </div>

      <dl className="col-span-2 row-start-2 grid max-w-[560px] grid-cols-3 gap-2 sm:gap-2.5 lg:col-span-1 lg:-mt-1">
        <HeroStat label="Trips" value={trips} note={trips ? 'this month' : 'start one →'} />
        <HeroStat label="Distance" value={formatKm(km)} note={km ? 'this month' : '—'} />
        <HeroStat label="Paid this FY" value={<Money value={paid.amount} compact />} note={paid.claims ? plural(paid.claims, 'claim') : '—'} />
      </dl>

      <div className="col-start-2 row-start-1 flex flex-col items-center gap-2 lg:row-span-2 lg:min-w-[190px]">
        {liveTrip ? (
          <Link href="/driver-management/fleet" className={cn(goClass, 'bg-red-500 text-white')}>
            <span className={goLabel}>
              <Square className={goIcon} aria-hidden />
              Stop trip
            </span>
          </Link>
        ) : (
          <button type="button" onClick={onStart} className={cn(goClass, 'bg-white text-teal-700')}>
            <span className={goLabel}>
              <Navigation className={goIcon} aria-hidden />
              Start trip
            </span>
          </button>
        )}
        {/* Room for the hint only beside the figures' column; a phone has the button's own label. */}
        <p className="hidden max-w-[190px] text-center text-[11.5px] font-semibold text-teal-100 lg:block">
          {liveTrip ? (
            'Recording your route… tap to stop and review it.'
          ) : (
            <>
              GPS records the route.
              <br />
              Claim it when you stop.
            </>
          )}
        </p>
      </div>

      {liveTrip && (
        <div className="col-span-2 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-white/20 bg-black/15 px-3 py-2.5 sm:rounded-2xl sm:px-4 sm:py-3">
          <span className={cn(styles.blink, 'h-[9px] w-[9px] shrink-0 rounded-full bg-red-400')} aria-hidden />
          <LiveFact label="Trip running">
            <Elapsed since={liveTrip.startedAt} />
          </LiveFact>
          {liveTrip.distanceKm != null && <LiveFact label="Distance · last sync">{formatKm(liveTrip.distanceKm)}</LiveFact>}
          {estimate != null && (
            <LiveFact label="Est. claim">
              <Money value={estimate} />
            </LiveFact>
          )}
          <LiveFact label="Vehicle">
            {liveTrip.vehicle}
            {liveTrip.ratePerKm != null ? ` · ₹${liveTrip.ratePerKm}/km` : ''}
          </LiveFact>
          {liveTrip.detail && <LiveFact label={liveTrip.kind === 'own' ? 'Started' : 'Purpose'}>{liveTrip.detail}</LiveFact>}
        </div>
      )}
    </section>
  );
}

/* ── Where my money is ────────────────────────────────────────────────────────────────────── */

type Stage = { label: string; icon: LucideIcon; gradient: string; accent: string; amount: number; hint: string; href: string; cta?: string };

/** Unclaimed → in approval → awaiting payment → paid, on a rail filled up to the last stage holding money. */
export function MoneyPipeline({ personal, financialYear }: { personal: Personal; financialYear: string }) {
  const unclaimed = personal.unclaimed;
  const stages: Stage[] = [
    {
      label: 'Not yet claimed',
      icon: Wallet,
      gradient: 'from-slate-300 to-slate-500',
      accent: '#64748b',
      amount: unclaimed.amount,
      hint: `${plural(unclaimed.trips, 'trip')} · ${formatKm(unclaimed.km)}`,
      href: unclaimed.trips ? '/driver-management/my-trips?claim=1' : '/driver-management/my-trips',
      cta: unclaimed.trips ? 'Claim now →' : undefined,
    },
    { label: 'In approval', icon: Hourglass, gradient: 'from-amber-300 to-amber-600', accent: '#d97706', amount: personal.inApproval.amount, hint: plural(personal.inApproval.claims, 'claim'), href: '/driver-management/my-claims' },
    {
      label: 'Awaiting payment',
      icon: CircleCheck,
      gradient: 'from-violet-300 to-violet-600',
      accent: '#7c3aed',
      amount: personal.awaitingPayment.amount,
      hint: `${personal.awaitingPayment.claims} approved`,
      href: '/driver-management/my-claims',
    },
    { label: `Paid · FY ${financialYear}`, icon: Banknote, gradient: 'from-green-300 to-green-600', accent: '#16a34a', amount: personal.paidThisYear.amount, hint: plural(personal.paidThisYear.claims, 'claim'), href: '/driver-management/my-claims' },
  ];
  const reached = stages.reduce((last, stage, index) => (stage.amount > 0 ? index : last), -1);

  return (
    <OverviewCard
      id="money-pipeline"
      icon={Wallet}
      gradient="from-teal-300 to-teal-700"
      accent="#0f766e"
      title="Where my money is"
      description="Every rupee from your trips, from driving to your bank account"
    >
      <ol className="relative grid grid-cols-2 gap-x-2 gap-y-1 p-2.5 sm:grid-cols-4 sm:gap-3 sm:p-[18px]">
        {/* The rail runs between the first and last icons' centres (each column's middle). */}
        <li aria-hidden className="absolute left-[calc(18px+12.5%)] right-[calc(18px+12.5%)] top-[45px] hidden h-1 rounded-sm bg-slate-100 sm:block">
          <span
            className="block h-full rounded-sm transition-[width] duration-700"
            style={{ width: `${reached <= 0 ? 0 : (reached / 3) * 100}%`, background: 'linear-gradient(90deg,#94a3b8,#f59e0b,#8b5cf6,#16a34a)' }}
          />
        </li>
        {stages.map((stage) => (
          <li key={stage.label} className="min-w-0">
            <Link
              href={stage.href}
              className="block rounded-xl px-1 py-1.5 text-center transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:rounded-2xl sm:px-1.5 sm:pb-2.5 sm:pt-0"
            >
              {/* The white pad is the ring that lifts the icon off the rail (the rail is `sm` and up). */}
              <span className="relative z-[1] mx-auto mb-1 block w-fit rounded-[18px] bg-white sm:mb-2 sm:p-1.5">
                <AppIcon icon={stage.icon} gradient={stage.gradient} accent={stage.accent} className="h-9 w-9 rounded-xl sm:h-[46px] sm:w-[46px] sm:rounded-[14px]" />
              </span>
              <span className="block truncate text-[11px] font-bold text-slate-600 sm:text-xs">{stage.label}</span>
              <span className={cn('block truncate text-lg font-extrabold tabular-nums tracking-[-0.02em] sm:my-0.5 sm:text-[22px]', stage.amount ? 'text-slate-900' : 'text-slate-300')}>
                <Money value={stage.amount} />
              </span>
              <span className="block truncate text-[11px] font-semibold text-slate-400 sm:text-[11.5px]">{stage.hint}</span>
              {stage.cta && <span className="mt-1 inline-block rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-extrabold text-teal-700 sm:mt-2 sm:px-2.5 sm:text-[11.5px]">{stage.cta}</span>}
            </Link>
          </li>
        ))}
      </ol>
    </OverviewCard>
  );
}

/* ── My recent trips ──────────────────────────────────────────────────────────────────────── */

const STATUS_CHIP: Record<TripStatus, string> = {
  draft: 'bg-slate-100 text-slate-600',
  submitted: 'bg-violet-100 text-violet-700',
  approved: 'bg-sky-100 text-sky-700',
  paid: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-rose-100 text-rose-700',
};

/** A small, stable number from a string, for the decorative streets behind a route. */
const hashOf = (text: string) => [...text].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7);

const THUMB = { w: 140, h: 70, pad: 10 };

/** The route fitted into the thumbnail, north up, without stretching (longitude scaled by latitude). */
function fitRoute(path: RecentTrip['path']): Array<[number, number]> | null {
  if (path.length < 2) return null;
  const midLat = path.reduce((total, point) => total + point.lat, 0) / path.length;
  const kx = Math.cos((midLat * Math.PI) / 180);
  const xs = path.map((point) => point.lng * kx);
  const ys = path.map((point) => -point.lat);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  if (spanX < 1e-7 && spanY < 1e-7) return null;
  const scale = Math.min((THUMB.w - 2 * THUMB.pad) / Math.max(spanX, 1e-7), (THUMB.h - 2 * THUMB.pad) / Math.max(spanY, 1e-7));
  const offsetX = (THUMB.w - spanX * scale) / 2;
  const offsetY = (THUMB.h - spanY * scale) / 2;
  return xs.map((x, index) => [offsetX + (x - minX) * scale, offsetY + (ys[index] - minY) * scale]);
}

function RouteThumb({ trip }: { trip: RecentTrip }) {
  const points = fitRoute(trip.path);
  const seed = hashOf(trip.id);
  const streets = [0, 1, 2].map((index) => {
    const a = ((seed >> (index * 5)) % 120) + 10;
    const b = ((seed >> (index * 5 + 3)) % 120) + 10;
    return `M${a} 0 L${b} 70`;
  });
  const start = points?.[0];
  const end = points?.[points.length - 1];
  return (
    <span className="relative block h-[70px] overflow-hidden rounded-xl border border-slate-100 bg-gradient-to-br from-emerald-50 to-blue-50 dark:from-emerald-950/40 dark:to-blue-950/40">
      <svg viewBox={`0 0 ${THUMB.w} ${THUMB.h}`} className="absolute inset-0 h-full w-full" aria-hidden focusable="false">
        {streets.map((d) => (
          <path key={d} d={d} className="stroke-white dark:stroke-white/10" strokeWidth="4" />
        ))}
        {points && start && end ? (
          <>
            <polyline points={points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')} fill="none" stroke="#4f46e5" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx={start[0]} cy={start[1]} r="4" fill="#fff" stroke="#16a34a" strokeWidth="2.5" />
            <circle cx={end[0]} cy={end[1]} r="4" fill="#4f46e5" />
          </>
        ) : (
          // Typed in by hand: no route was measured, so only the idea of one.
          <>
            <path d="M18 52 C 50 52, 60 20, 92 26 S 118 22, 122 18" fill="none" stroke="#94a3b8" strokeWidth="2" strokeDasharray="3 5" strokeLinecap="round" />
            <circle cx="18" cy="52" r="4" fill="#fff" stroke="#16a34a" strokeWidth="2.5" />
            <circle cx="122" cy="18" r="4" fill="#4f46e5" />
          </>
        )}
      </svg>
    </span>
  );
}

function TripsEmpty() {
  const steps = ['Tap Start trip', 'Drive — GPS records it', 'Stop & claim in one tap'];
  return (
    <div className="px-3.5 py-5 text-center text-slate-400 sm:px-4 sm:py-8">
      <AppIcon icon={Navigation} gradient="from-sky-300 to-sky-700" accent="#0369a1" className="mx-auto mb-2 h-11 w-11 rounded-[14px] sm:mb-3 sm:h-[60px] sm:w-[60px] sm:rounded-[20px]" />
      <p className="text-sm font-bold text-slate-900 sm:text-[15px]">No trips yet</p>
      <p className="mb-2.5 mt-0.5 text-xs sm:mb-3 sm:mt-1 sm:text-sm">Your trips appear here with their route, distance and claim status.</p>
      <ol className="flex flex-wrap justify-center gap-1.5 sm:gap-2.5">
        {steps.map((step, index) => (
          <li key={step} className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 sm:gap-2 sm:rounded-xl sm:px-3 sm:py-2 sm:text-xs">
            <span className="grid h-5 w-5 place-items-center rounded-full bg-teal-700 text-[11px] font-extrabold text-white">{index + 1}</span>
            {step}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function RecentTrips({ trips }: { trips: RecentTrip[] }) {
  return (
    <OverviewCard
      id="recent-trips"
      icon={Route}
      gradient="from-sky-300 to-sky-700"
      accent="#0369a1"
      title="My recent trips"
      description="Tap a trip to see the route or claim it"
      side={
        <Link href="/driver-management/my-trips" className="shrink-0 text-[12.5px] font-bold text-teal-700 hover:underline">
          All trips →
        </Link>
      }
    >
      {trips.length === 0 ? (
        <TripsEmpty />
      ) : (
        <ul className="divide-y divide-slate-100">
          {trips.map((trip) => {
            const from = shortPlace(trip.fromPlace) || 'Start';
            const to = shortPlace(trip.toPlace) || 'End';
            return (
              <li key={trip.id}>
                <Link
                  href={`/driver-management/trips/${trip.id}?from=overview`}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3.5 px-4 py-3 transition-colors hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none sm:grid-cols-[140px_minmax(0,1fr)_auto] sm:px-[18px]"
                >
                  <span className="hidden sm:block">
                    <RouteThumb trip={trip} />
                  </span>
                  <span className="min-w-0">
                    {/* One above the other on a phone; on one line, each end truncating, from `sm`. */}
                    <span className="flex min-w-0 flex-col gap-y-0.5 text-sm font-bold text-slate-900 sm:flex-row sm:items-center sm:gap-x-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="h-2 w-2 shrink-0 rounded-full border-[2.5px] border-green-600" aria-hidden />
                        <span className="min-w-0 truncate">{from}</span>
                      </span>
                      <span className="hidden w-[22px] shrink-0 border-t-2 border-dashed border-slate-300 sm:block" aria-hidden />
                      <span className="sr-only">to</span>
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="h-2 w-2 shrink-0 rounded-full bg-indigo-600" aria-hidden />
                        <span className="min-w-0 truncate">{to}</span>
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-slate-400">
                      {dayMonth(trip.tripDate)} · {formatKm(trip.distanceKm)} · {vehicleWords(trip.ownership, trip.vehicleType)}
                    </span>
                  </span>
                  <span className="text-right">
                    <Money value={trip.amount} className="block text-base font-extrabold text-slate-900" />
                    <span className={cn('mt-0.5 inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-bold', STATUS_CHIP[trip.status])}>
                      {TRIP_STATUS_LABELS[trip.status]}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </OverviewCard>
  );
}

/* ── Waiting for you ──────────────────────────────────────────────────────────────────────── */

const AVATAR_COLOURS = ['#0d9488', '#ea580c', '#4f46e5', '#db2777', '#0284c7', '#16a34a'];

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '?';

/** "today", "1 day", "4 days" since an ISO time. */
function waitedFor(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const days = Math.max(0, Math.floor((Date.now() - ms) / 86_400_000));
  return days === 0 ? 'today' : plural(days, 'day');
}

function WaitCount({ label, value, hot }: { label: string; value: number; hot?: boolean }) {
  return (
    <div className={cn('min-w-[76px] rounded-xl px-3 py-1.5 text-center', hot ? 'bg-rose-100' : 'bg-slate-100')}>
      <p className="text-[10.5px] font-bold uppercase tracking-[0.04em] text-slate-400">{label}</p>
      <p className={cn('text-base font-extrabold tabular-nums', hot ? 'text-rose-700' : 'text-slate-900')}>{value}</p>
    </div>
  );
}

/**
 * Claims at a stage the person is named on, oldest first. Review opens the claim: approving and
 * paying stay on its page, where the trips, the amounts and the remarks are.
 */
export function WaitingCard({ workflow }: { workflow: InboxCounts & { oldest: ClaimRow[] } }) {
  return (
    <OverviewCard
      id="waiting-for-you"
      icon={Inbox}
      gradient="from-amber-300 to-amber-600"
      accent="#d97706"
      title="Waiting for you"
      description="Claims at a stage you are named on, oldest first"
      side={
        <div className="flex w-full gap-2 sm:ml-auto sm:w-auto">
          <WaitCount label="To approve" value={workflow.approvals} />
          <WaitCount label="To pay" value={workflow.payments} />
          <WaitCount label="Overdue" value={workflow.overdue} hot={workflow.overdue > 0} />
        </div>
      }
    >
      {workflow.oldest.length === 0 ? (
        <div className="px-4 py-6 text-center text-slate-400">
          <AppIcon icon={CircleCheck} gradient="from-green-300 to-green-600" accent="#16a34a" className="mx-auto mb-2.5 h-[46px] w-[46px] rounded-[15px]" />
          <p className="text-[15px] font-bold text-slate-900">Nothing is waiting for you</p>
          <p className="mt-0.5 text-sm">Claims you need to approve or pay will show here.</p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {workflow.oldest.map((row) => {
            const amount = row.status === 'pending' ? row.totals.claimedAmount : row.totals.approvedAmount;
            return (
              <li key={row.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-[18px]">
                <span
                  aria-hidden
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-extrabold text-white"
                  style={{ background: AVATAR_COLOURS[hashOf(row.employeeName) % AVATAR_COLOURS.length] }}
                >
                  {initialsOf(row.employeeName)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-bold text-slate-900">
                    {row.employeeName} <span className="font-normal text-slate-400">· {row.claimNumber}</span>
                  </p>
                  <p className={cn('truncate text-xs', row.overdue ? 'text-rose-700' : 'text-slate-400')}>
                    {plural(row.totals.tripCount, 'trip')} · {row.stageName} · waiting {waitedFor(row.submittedAt)}
                    {row.overdue ? ' · overdue' : ''}
                  </p>
                </div>
                <Money value={amount} className="hidden shrink-0 text-sm font-extrabold text-slate-900 sm:block" />
                <Link
                  href={`/driver-management/claims/${row.id}`}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-[11px] bg-gradient-to-r from-teal-700 to-green-600 px-3 py-1.5 text-[13px] font-semibold text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {row.status === 'pending' ? 'Review' : 'Pay'}
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </OverviewCard>
  );
}

/* ── My vehicle & driving ─────────────────────────────────────────────────────────────────── */

/** A vehicle number as a plate: the blue IND band, then the registration in a fixed-width face. */
function NumberPlate({ number }: { number: string }) {
  return (
    <span className="keep-light inline-flex max-w-full items-stretch overflow-hidden rounded-lg border-2 border-slate-900 bg-white shadow-[0_6px_14px_-8px_#0f172a66]">
      <span className="flex shrink-0 flex-col justify-end bg-blue-700 px-1 pb-0.5 text-[8px] font-extrabold text-white" aria-hidden>
        IND
      </span>
      <span className="truncate px-2.5 py-1 font-mono text-[17px] font-bold uppercase tracking-[0.12em] text-slate-900">{number}</span>
    </span>
  );
}

export interface VehicleStat {
  label: string;
  value: string;
  href?: string;
  /** A green dot before the value — a trip running. */
  live?: boolean;
}

function StatTile({ stat }: { stat: VehicleStat }) {
  const body = (
    <>
      <span className="block truncate text-[11px] font-bold text-slate-400">{stat.label}</span>
      <span className={cn('flex items-center gap-1.5 truncate text-[15px] font-extrabold tabular-nums', stat.live ? 'text-emerald-700' : 'text-slate-900')}>
        {stat.live && <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden />}
        {stat.value}
      </span>
    </>
  );
  return stat.href ? (
    <Link href={stat.href} className="min-w-0 rounded-xl bg-slate-100 px-3 py-2 transition-colors hover:bg-slate-200/70">
      {body}
    </Link>
  ) : (
    <div className="min-w-0 rounded-xl bg-slate-100 px-3 py-2">{body}</div>
  );
}

/** Six months of km as bars, the current month in indigo. */
function KmBars({ trend }: { trend: TrendPoint[] }) {
  const max = Math.max(1, ...trend.map((point) => point.km));
  const monthName = (key: string) => new Date(`${key}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short' });
  return (
    <figure className="mt-3.5">
      <figcaption className="text-xs font-bold text-slate-600">Km driven · last {trend.length} months</figcaption>
      <div className="mt-1 flex h-[64px] items-end gap-[5px] pt-1.5 sm:h-[90px]" role="img" aria-label={trend.map((point) => `${monthName(point.month)} ${formatKm(point.km)}`).join(', ')}>
        {trend.map((point, index) => (
          <span
            key={point.month}
            title={`${monthName(point.month)} · ${formatKm(point.km)}`}
            className={cn('min-h-[3px] flex-1 rounded-t-[5px] bg-gradient-to-b', index === trend.length - 1 ? 'from-indigo-300 to-indigo-600' : 'from-teal-300 to-teal-700')}
            style={{ height: `${(point.km / max) * 100}%` }}
          />
        ))}
      </div>
      <div className="mt-1 flex gap-[5px]" aria-hidden>
        {trend.map((point) => (
          <span key={point.month} className="flex-1 text-center text-[10px] font-bold text-slate-400">
            {monthName(point.month)}
          </span>
        ))}
      </div>
    </figure>
  );
}

export function VehicleCard({
  subtitle,
  vehicle,
  emptyNote,
  stats,
  trend,
  note,
  children,
}: {
  subtitle: string;
  vehicle: { number: string; caption: string } | null;
  /** Said where the plate would be, when there is no vehicle. */
  emptyNote: string;
  stats: VehicleStat[];
  trend: TrendPoint[];
  /** A problem loading part of it. */
  note?: string;
  children?: ReactNode;
}) {
  return (
    <OverviewCard id="my-vehicle" icon={CarFront} gradient="from-blue-300 to-blue-700" accent="#1d4ed8" title="My vehicle & driving" description={subtitle}>
      <div className="px-3.5 py-3.5 sm:px-[18px] sm:py-4">
        <div className="mb-3 flex items-center gap-3 sm:mb-3.5 sm:gap-3.5">
          <span className="grid h-11 w-[68px] shrink-0 place-items-center rounded-xl bg-gradient-to-br from-sky-100 to-teal-100 text-sky-700 sm:h-[54px] sm:w-[84px] sm:rounded-[14px] dark:from-sky-950/60 dark:to-teal-950/60 dark:text-sky-300" aria-hidden>
            <CarFront className="h-8 w-8 sm:h-11 sm:w-11" strokeWidth={1.4} />
          </span>
          {vehicle ? (
            <div className="min-w-0">
              <NumberPlate number={vehicle.number} />
              <p className="mt-1.5 truncate text-xs text-slate-400">{vehicle.caption}</p>
            </div>
          ) : (
            <p className="text-xs text-slate-400">{emptyNote}</p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {stats.map((stat) => (
            <StatTile key={stat.label} stat={stat} />
          ))}
        </div>
        {/* Six empty bars say nothing; the chart appears with the first km. */}
        {trend.some((point) => point.km > 0) && <KmBars trend={trend} />}
        {note && <p className="mt-3 text-xs text-amber-700">{note}</p>}
        {children && <div className="mt-3">{children}</div>}
      </div>
    </OverviewCard>
  );
}

/* ── My rates ─────────────────────────────────────────────────────────────────────────────── */

export function RatesCard({ rows, footnote }: { rows: Array<{ label: string; value: string }>; footnote?: string }) {
  return (
    <OverviewCard id="my-rates" icon={IndianRupee} gradient="from-violet-300 to-violet-700" accent="#6d28d9" title="My rates" description="What each km pays you">
      <dl className="px-4 pb-3 pt-2 sm:px-[18px]">
        {rows.map((row) => (
          <div key={row.label} className="flex justify-between gap-3 border-b border-dashed border-slate-200 py-[7px] text-[12.5px] last:border-b-0">
            <dt className="min-w-0 text-slate-600">{row.label}</dt>
            <dd className="min-w-0 text-right font-bold text-slate-900">{row.value}</dd>
          </div>
        ))}
        {footnote && <p className="pt-2 text-[11px] text-slate-400">{footnote}</p>}
      </dl>
    </OverviewCard>
  );
}

/* ── Organisation ─────────────────────────────────────────────────────────────────────────── */

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
          // One <dt>/<dd> pair per <div>, the dot inside the <dt> — the only shape a <dl> allows.
          <div key={part.label} className="min-w-0">
            <dt className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              <span className={cn('h-2 w-2 shrink-0 rounded-full', part.color)} aria-hidden />
              <span className="truncate">{part.label}</span>
            </dt>
            <dd className="truncate pl-4 text-sm font-semibold text-slate-800">
              <Money value={part.amount} compact /> <span className="text-xs font-normal text-muted-foreground">· {plural(part.claims, 'claim')}</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

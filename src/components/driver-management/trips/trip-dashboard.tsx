'use client';

/**
 * Driver Management's landing page, after the "SEL – My Trips" mock-up: figures and the next thing
 * to do, not a page of links (the sidebar navigates).
 *
 * - Everyone: a hero with this month's reimbursement and the round Start trip button (red, with a
 *   live panel, while a fleet trip or a recorded own-vehicle trip is running); where their money is,
 *   stage by stage; their latest trips with the route drawn; their vehicle and six months of km;
 *   the rate card in effect today.
 * - Drivers linked to a Vehicle Management driver record: the vehicle card is theirs — the assigned
 *   vehicle, fleet trips and fuel (`DriverPanel`, which replaced the separate Driver Mobile hub page).
 * - People named on the workflow (or holding Override): what waits for them, oldest first.
 * - Trip Claims · View All: the organisation's pipeline, trend, projects and top claimants.
 *
 * `TripDashboardView` draws it from the dashboard payload alone, so it renders without the API.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, CalendarClock, Clock, Gauge, Undo2, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { KpiCard, KpiGrid } from '@/components/shared/kpi-card';
import { SectionHeader } from '@/components/shared/page-header';
import { useCurrentDriverProfile } from '@/components/vehicle-management/hooks';
import { useFleet } from '@/components/fleet/fleet-provider';
import { DriverPanel } from '@/components/driver-management/driver-app/driver-panel';
import { shortPlace } from '@/lib/fleet/places';
import { FLEET_CATEGORY_LABELS } from '@/lib/fleet/types';
import { formatINR, formatINRCompact, rateFor, revisionOn } from '@/lib/employee-trips/rates';
import { formatKm } from '@/lib/employee-trips/types';
import type { Bootstrap, DashboardData } from './trip-api';
import { useTripClaims } from './trip-claims-provider';
import { useTripQuery } from './use-trip-query';
import { ChartCard, MonthlyAmountChart, OwnershipSplit, RankedAmounts } from './trip-charts';
import { MoneyPipeline, OverviewHero, PipelineBar, RatesCard, RecentTrips, VehicleCard, WaitingCard, type LiveTrip } from './overview-parts';
import { ownTripInFlight } from './own-trip-in-flight';
import { ErrorBlock } from './trip-ui';

function Notice({ icon: Icon, children, action, onAction }: { icon: React.ElementType; children: React.ReactNode; action: string; onAction: () => void }) {
  return (
    <div className="flex flex-1 items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1">{children}</p>
      <Button type="button" variant="ghost" size="sm" onClick={onAction} className="h-8 shrink-0 px-2 text-amber-900 hover:bg-amber-100">
        {action}
        <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden />
      </Button>
    </div>
  );
}

/** The two columns: the money and the trips on the left, the vehicle and the rates beside them. */
const COLUMNS = 'grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]';

function DashboardSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-80 w-full rounded-3xl sm:h-64 lg:h-52" />
      <div className={COLUMNS}>
        <div className="space-y-4">
          <Skeleton className="h-56 w-full rounded-[20px]" />
          <Skeleton className="h-80 w-full rounded-[20px]" />
        </div>
        <div className="space-y-4">
          <Skeleton className="h-96 w-full rounded-[20px]" />
          <Skeleton className="h-44 w-full rounded-[20px]" />
        </div>
      </div>
    </div>
  );
}

export interface RateSummary {
  rows: Array<{ label: string; value: string }>;
  footnote?: string;
}

/** The rate card in effect today, the claim window and who claims go to first — from the trip-claims bootstrap. */
function rateSummary(bootstrap: Bootstrap): RateSummary {
  const revision = revisionOn(bootstrap.settings.rateRevisions, bootstrap.today);
  const rows: RateSummary['rows'] = (revision?.rates ?? [])
    .filter((row) => typeof row.own === 'number')
    .map((row) => ({ label: `Own ${row.vehicleType.trim().toLowerCase()}`, value: `${formatINR(row.own)} / km` }));
  if (!rows.length) rows.push({ label: 'Own vehicle', value: 'No rate set yet' });
  const window = bootstrap.settings.rules.claimWindowDays;
  if (window) rows.push({ label: 'Claim within', value: `${window} days of the trip` });
  const first = bootstrap.firstApproval;
  if (first.dependsOnTrips) rows.push({ label: 'Claims go first to', value: `${first.stageName} · by project` });
  else if (first.names.length) rows.push({ label: 'Claims go first to', value: first.names.join(', ') });
  const from = revision ? new Date(`${revision.effectiveFrom}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null;
  return { rows, footnote: from ? `Rates in effect from ${from}. A trip is paid at the rate on its date.` : undefined };
}

export function TripDashboardView({
  data,
  error,
  onRetry,
  liveTrip,
  driverPanel,
  rates,
}: {
  data: DashboardData | null;
  error: string | null;
  onRetry?: () => void;
  /** A trip running now, if any. */
  liveTrip: LiveTrip | null;
  /** A Driver Master driver's own vehicle card; everyone else gets theirs from `data`. */
  driverPanel?: React.ReactNode;
  rates?: RateSummary | null;
}) {
  const router = useRouter();
  if (error && !data) return <ErrorBlock message={error} onRetry={onRetry} />;
  if (!data) return <DashboardSkeleton />;

  const { personal, workflow, organisation } = data;
  const toMyTrips = () => router.push('/driver-management/my-trips');
  const own = personal.lastOwnVehicle ?? null;

  return (
    <div className="space-y-4">
      <OverviewHero today={data.today} personal={personal} liveTrip={liveTrip} onStart={() => router.push('/driver-management/fleet?kind=choose')} />

      {(personal.unclaimed.expiringSoon > 0 || personal.unclaimed.sentBack > 0) && (
        <div className="flex flex-col gap-2 sm:flex-row">
          {personal.unclaimed.sentBack > 0 && (
            <Notice icon={Undo2} action="Correct" onAction={toMyTrips}>
              {personal.unclaimed.sentBack} trip{personal.unclaimed.sentBack === 1 ? ' was' : 's were'} sent back for correction.
            </Notice>
          )}
          {personal.unclaimed.expiringSoon > 0 && (
            <Notice icon={CalendarClock} action="Claim" onAction={() => router.push('/driver-management/my-trips?claim=1')}>
              {personal.unclaimed.expiringSoon} unclaimed trip{personal.unclaimed.expiringSoon === 1 ? '' : 's'} must be submitted within a week.
            </Notice>
          )}
        </div>
      )}

      <div className={COLUMNS}>
        <div className="min-w-0 space-y-4">
          <MoneyPipeline personal={personal} financialYear={data.financialYear} />
          <RecentTrips trips={personal.recentTrips ?? []} />
          {workflow && <WaitingCard workflow={workflow} />}
        </div>
        <aside className="min-w-0 space-y-4" aria-label="My vehicle and rates">
          {driverPanel ?? (
            <VehicleCard
              subtitle="The vehicle you claim for, and the km you drove"
              vehicle={
                own
                  ? {
                      number: own.vehicleNumber,
                      caption: `Own ${own.vehicleType.trim().toLowerCase() || 'vehicle'} · last used ${new Date(`${own.tripDate}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`,
                    }
                  : null
              }
              emptyNote="Your vehicle appears here after your first own-vehicle trip."
              stats={[
                { label: 'Trip now', value: liveTrip ? 'Running' : 'Not running', href: '/driver-management/fleet', live: Boolean(liveTrip) },
                { label: 'Trips this month', value: String(personal.thisMonth.trips), href: '/driver-management/my-trips' },
                { label: 'Km this month', value: formatKm(personal.thisMonth.km) },
                { label: 'Not yet claimed', value: formatINRCompact(personal.unclaimed.amount), href: '/driver-management/my-trips' },
              ]}
              trend={personal.trend}
            />
          )}
          {rates && <RatesCard rows={rates.rows} footnote={rates.footnote} />}
        </aside>
      </div>

      {organisation && (
        <section className="space-y-4 border-t border-slate-200 pt-5">
          <SectionHeader title={`Organisation · FY ${organisation.financialYear}`} icon={Gauge} description="Every employee's claims this financial year." />
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <PipelineBar
              parts={[
                { label: 'In approval', amount: organisation.inApproval.amount, claims: organisation.inApproval.claims, color: 'bg-amber-400' },
                { label: 'Awaiting payment', amount: organisation.awaitingPayment.amount, claims: organisation.awaitingPayment.claims, color: 'bg-violet-500' },
                { label: 'Paid', amount: organisation.paid.amount, claims: organisation.paid.claims, color: 'bg-emerald-500' },
                { label: 'Rejected', amount: organisation.rejected.amount, claims: organisation.rejected.claims, color: 'bg-rose-400' },
              ]}
            />
          </div>
          <KpiGrid>
            <KpiCard label="Overdue" value={organisation.overdue} hint="Past their stage's time" icon={Clock} tone={organisation.overdue ? 'rose' : 'slate'} accent />
            <KpiCard label="Not yet claimed" value={formatINRCompact(organisation.unclaimed.amount)} hint={`${organisation.unclaimed.trips} trips, last 6 months`} icon={Wallet} tone="cyan" accent />
          </KpiGrid>
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
            <div className="min-w-0 lg:col-span-2">
              <ChartCard title="Claimed trips by month" description="Last six months, by trip date, every employee.">
                <MonthlyAmountChart points={organisation.trend} label="Organisation reimbursement by month" />
              </ChartCard>
            </div>
            <ChartCard title="Own vs company vehicle" description="Kilometres claimed, last six months.">
              <OwnershipSplit own={organisation.ownership.own} company={organisation.ownership.company} />
            </ChartCard>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard title="By project" description="Claimed trips, last six months.">
              <RankedAmounts rows={organisation.byProject} empty="No claimed trips yet." />
            </ChartCard>
            <ChartCard title="Top claimants" description="Claimed trips, last six months.">
              <RankedAmounts rows={organisation.byEmployee} empty="No claimed trips yet." />
            </ChartCard>
          </div>
        </section>
      )}
    </div>
  );
}

export default function TripDashboard() {
  const { driver } = useCurrentDriverProfile();
  const fleet = useFleet();
  const { data: bootstrap } = useTripClaims();
  const { data, error, reload } = useTripQuery<DashboardData>('dashboard');
  // Read once: the page shows a skeleton until the dashboard loads, so the server render (no
  // storage) and the first client render agree. Stopping the trip happens on Fleet Trip.
  const [ownTrip] = useState(() => (typeof window === 'undefined' ? null : ownTripInFlight()));

  const openTrip = fleet.data?.openTrip ?? null;
  const today = bootstrap?.today ?? data?.today ?? null;
  const liveTrip = useMemo<LiveTrip | null>(() => {
    if (openTrip) {
      return {
        kind: 'company',
        vehicle: `${openTrip.vehicleNumber} · company ${(FLEET_CATEGORY_LABELS[openTrip.vehicleCategory] ?? 'vehicle').toLowerCase()}`,
        startedAt: openTrip.startedAt,
        distanceKm: openTrip.gpsDistanceKm,
        detail: openTrip.purposeName || openTrip.projectName,
        ratePerKm: null,
      };
    }
    if (ownTrip) {
      const rate = bootstrap && today ? rateFor(bootstrap.settings.rateRevisions, today, ownTrip.vehicleType, 'own').ratePerKm : null;
      return {
        kind: 'own',
        vehicle: [ownTrip.vehicleNumber, `own ${ownTrip.vehicleType.trim().toLowerCase() || 'vehicle'}`].filter(Boolean).join(' · '),
        startedAt: ownTrip.startedAtIso,
        distanceKm: null,
        detail: shortPlace(ownTrip.fromPlace) || ownTrip.purpose,
        ratePerKm: rate,
      };
    }
    return null;
  }, [bootstrap, openTrip, ownTrip, today]);
  const rates = useMemo(() => (bootstrap ? rateSummary(bootstrap) : null), [bootstrap]);

  return (
    <TripDashboardView
      data={data}
      error={error}
      onRetry={reload}
      liveTrip={liveTrip}
      driverPanel={driver?.id && data ? <DriverPanel driver={driver} trend={data.personal.trend} kmThisMonth={data.personal.thisMonth.km} /> : null}
      rates={rates}
    />
  );
}

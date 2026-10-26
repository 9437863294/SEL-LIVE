'use client';

/**
 * Fleet Control: what the company vehicles are doing now and this month, for the fleet office and
 * for managers (who see only the vehicles they approve — the API decides the scope).
 *
 * Figures, a live map and the things waiting for someone; no link cards (the sidebar navigates).
 * The KPI cards that count work waiting — approvals, reviews, exceptions — open that work.
 *
 * Refreshes itself every minute while the tab is visible, so a screen left open in the fleet office
 * keeps showing where the vehicles are. A refresh keeps the current figures on screen until the new
 * ones arrive.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  CircleAlert,
  Clock,
  Fuel,
  Gauge,
  Hourglass,
  IndianRupee,
  Inbox,
  Loader2,
  Radar,
  ReceiptText,
  RefreshCw,
  Route,
  Siren,
  TriangleAlert,
  Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { KpiCard } from '@/components/shared/kpi-card';
import { PageHeader, SectionHeader } from '@/components/shared/page-header';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useFleetQuery } from '@/components/fleet/use-fleet-query';
import { FleetRestricted, FuelFlagChips, TripStatusBadge } from '@/components/fleet/fleet-ui';
import { LiveFleetMap } from '@/components/fleet/fleet-maps';
import { durationLabel, istTimeLabel, monthLabel, shortDateLabel, toMs } from '@/lib/fleet/dates';
import { formatINR, formatKm, type FleetTrip } from '@/lib/fleet/types';
import type { FleetDashboard } from '@/lib/fleet/server/overview';
import { cn } from '@/lib/utils';
import { FleetLoadError, FleetPanel, KmByDayChart, RankedKm } from './fleet-charts';

const REFRESH_MS = 60_000;

/** No fix for this long on a running trip is worth pointing out (the server's own gap default). */
const STALE_FIX_MINUTES = 15;

function RunningTrips({ trips, now }: { trips: FleetTrip[]; now: number }) {
  if (!trips.length) return <p className="py-8 text-center text-sm text-muted-foreground">No company vehicle is on a trip right now.</p>;
  return (
    <ul className="divide-y divide-slate-100">
      {trips.map((trip) => {
        const lastFix = trip.lastPointAt ? Math.max(0, (now - toMs(trip.lastPointAt)) / 60_000) : null;
        const stale = lastFix === null || lastFix > STALE_FIX_MINUTES;
        return (
          <li key={trip.id}>
            <Link href={`/driver-management/fleet/trips/${trip.id}`} className="flex items-start justify-between gap-3 px-1 py-2.5 no-underline transition-colors hover:bg-slate-50">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-semibold text-slate-800">{trip.vehicleNumber}</span>
                  <TripStatusBadge status={trip.status} />
                  {trip.isEmergency && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-700">
                      <Siren className="h-3 w-3" aria-hidden />
                      Emergency
                    </span>
                  )}
                </div>
                <span className="block truncate text-xs text-muted-foreground">
                  {trip.driverName} · since {istTimeLabel(trip.startedAt)} ({durationLabel((now - toMs(trip.startedAt)) / 60_000)})
                  {trip.projectName ? ` · ${trip.projectName}` : ''}
                </span>
                <span className={cn('block text-xs', stale ? 'text-amber-700' : 'text-muted-foreground')}>
                  {lastFix === null ? 'No GPS fix received yet' : stale ? `No GPS fix for ${durationLabel(lastFix)}` : `Last fix ${durationLabel(lastFix)} ago`}
                </span>
              </div>
              <span className="shrink-0 text-right">
                <span className="block text-sm font-semibold tabular-nums text-slate-800">{formatKm(trip.gpsDistanceKm)}</span>
                <span className="block text-[11px] text-muted-foreground">expected {formatKm(trip.expectedKm)}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function ServiceDue({ rows }: { rows: FleetDashboard['serviceDue'] }) {
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted-foreground">No vehicle is within 300 km of its service.</p>;
  return (
    <ul className="divide-y divide-slate-100">
      {rows.map((row) => (
        <li key={row.vehicleId} className="flex items-center justify-between gap-3 py-2">
          <span className="min-w-0 truncate text-sm font-medium text-slate-800">{row.vehicleNumber}</span>
          <span className={cn('shrink-0 text-xs font-semibold tabular-nums', row.dueInKm < 0 ? 'text-rose-700' : 'text-amber-700')}>
            {row.dueInKm < 0 ? `Overdue by ${formatKm(-row.dueInKm)}` : `Due in ${formatKm(row.dueInKm)}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

function LowMileage({ rows, today }: { rows: FleetDashboard['lowMileage']; today: string }) {
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted-foreground">No open low-mileage fill-ups.</p>;
  return (
    <ul className="divide-y divide-slate-100">
      {rows.map((row) => (
        <li key={row.id} className="py-2">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-sm font-medium text-slate-800">{row.vehicleNumber}</span>
            <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-800">{row.mileageKmpl !== null ? `${row.mileageKmpl} km/L` : '—'}</span>
          </div>
          <span className="block truncate text-xs text-muted-foreground">
            {shortDateLabel(row.fuelDate, today)} · {row.litres} L · {formatINR(row.amount)} · {row.driverName || 'Unknown driver'}
          </span>
          <FuelFlagChips flags={row.flagCodes} />
        </li>
      ))}
    </ul>
  );
}

function LoadingState() {
  return (
    <div className="flex min-h-[30vh] items-center justify-center">
      <Loader2 className="h-7 w-7 animate-spin text-slate-400" aria-label="Loading" />
    </div>
  );
}

export default function FleetDashboardPage() {
  const { can } = useAuthorization();
  const { data, error, loading, reload } = useFleetQuery<FleetDashboard>('dashboard');
  const [refreshing, setRefreshing] = useState(false);
  // "Now" for the ages on screen, moved on by the refresh timer rather than read during render.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
      if (document.visibilityState === 'visible') void reload();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [reload]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await reload();
      setNow(Date.now());
    } finally {
      setRefreshing(false);
    }
  };

  // Managers see their own vehicles without the grant, so a failure is only called "restricted"
  // for someone who holds neither; anyone else gets the error and a retry.
  const canFleet = can('View', 'Vehicle Management.Fleet Trips') || can('Review', 'Vehicle Management.Fleet Trips');
  const canReports = can('View', 'Vehicle Management.Fleet Reports') || can('Generate', 'Vehicle Management.Fleet Reports') || can('Approve for Payment', 'Vehicle Management.Fleet Reports');

  const ranked = useMemo(
    () => ({
      vehicles: (data?.topVehicles ?? []).map((row) => ({ key: row.vehicleId, label: row.vehicleNumber, km: row.km, trips: row.trips })),
      projects: (data?.byProject ?? []).map((row) => ({ key: row.projectId ?? 'none', label: row.projectName, km: row.km, trips: row.trips })),
    }),
    [data],
  );

  const header = (
    <PageHeader
      title="Fleet Control"
      icon={Radar}
      description="Company vehicles on the road, today's running against the limits, and what waits for a decision."
      meta={
        data
          ? [
              { label: 'Today', value: shortDateLabel(data.today, data.today) },
              { label: 'Showing', value: data.scope === 'all' ? 'The whole fleet' : 'Vehicles you approve' },
              { label: 'Month', value: monthLabel(data.month.monthKey) },
            ]
          : undefined
      }
      actions={
        <>
          <Button type="button" variant="outline" onClick={() => void refresh()} disabled={refreshing || loading}>
            <RefreshCw className={cn('mr-2 h-4 w-4', refreshing && 'animate-spin')} aria-hidden />
            Refresh
          </Button>
          {canReports && (
            <Button type="button" variant="outline" asChild>
              <Link href="/vehicle-management/fleet/reports">
                <ReceiptText className="mr-2 h-4 w-4" aria-hidden />
                Payment reports
              </Link>
            </Button>
          )}
        </>
      }
    />
  );

  if (!data) {
    if (error) {
      return (
        <div className="space-y-4">
          {header}
          {canFleet ? <FleetLoadError message={error} onRetry={() => void refresh()} /> : <FleetRestricted message={error} />}
        </div>
      );
    }
    return (
      <div className="space-y-4">
        {header}
        <LoadingState />
      </div>
    );
  }

  const exceptions = data.pending.tripExceptions + data.pending.fuelExceptions;
  const paused = data.running.filter((trip) => trip.status === 'paused').length;

  return (
    <div className="space-y-6">
      {header}

      {data.scope === 'managed' && (
        <p className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">Showing the vehicles you approve, and trips that come to you as the driver&apos;s reporting authority.</p>
      )}
      {error && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Could not refresh: {error}. The figures below are from the last successful load.</p>}

      <section className="space-y-3">
        <SectionHeader title="Today" icon={Gauge} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <KpiCard label="On the road now" value={data.running.length} hint={paused ? `${paused} paused` : 'Running trips'} icon={Activity} tone={data.running.length ? 'emerald' : 'slate'} accent />
          <KpiCard label="Km today" value={formatKm(data.todayFigures.km)} hint={`${data.todayFigures.trips} trip${data.todayFigures.trips === 1 ? '' : 's'}`} icon={Route} tone="blue" accent />
          <KpiCard
            label="Over the daily limit"
            value={data.todayFigures.vehiclesOverLimit}
            hint={data.todayFigures.emergencies ? `${data.todayFigures.emergencies} emergency start${data.todayFigures.emergencies === 1 ? '' : 's'}` : 'Vehicles past their km limit'}
            icon={TriangleAlert}
            tone={data.todayFigures.vehiclesOverLimit ? 'rose' : 'slate'}
            accent
          />
          <KpiCard label="Waiting for approval" value={data.pending.approvals} hint="Over-limit requests" icon={Inbox} tone={data.pending.approvals ? 'amber' : 'slate'} href="/driver-management/approvals?tab=fleet" accent />
          <KpiCard label="Waiting for review" value={data.pending.reviews} hint="GPS and odometer disagree, or closed by the system" icon={Hourglass} tone={data.pending.reviews ? 'amber' : 'slate'} href="/driver-management/approvals?tab=reviews" accent />
          <KpiCard label="Open exceptions" value={exceptions} hint={`${data.pending.tripExceptions} trips · ${data.pending.fuelExceptions} fuel`} icon={CircleAlert} tone={exceptions ? 'orange' : 'slate'} href="/vehicle-management/fleet/exceptions" accent />
        </div>
      </section>

      <section className="space-y-3">
        <SectionHeader title="On the road" icon={Radar} description="Last known position of every running trip. Open a trip for its route." />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div className="min-w-0 lg:col-span-3">
            <LiveFleetMap trips={data.running} heightClassName="h-[280px] sm:h-[360px]" />
          </div>
          <FleetPanel title={`Running trips (${data.running.length})`} className="lg:col-span-2">
            <div className="max-h-[360px] overflow-y-auto">
              <RunningTrips trips={data.running} now={now} />
            </div>
          </FleetPanel>
        </div>
      </section>

      <section className="space-y-3">
        <SectionHeader title={monthLabel(data.month.monthKey)} icon={Clock} description="Billable km by the day they were driven; fuel by fill-up date." />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KpiCard label="Km this month" value={formatKm(data.month.km)} hint={`${data.month.trips} trip${data.month.trips === 1 ? '' : 's'}`} icon={Route} tone="indigo" accent />
          <KpiCard label="Fuel this month" value={formatINR(data.month.fuelAmount)} hint={`${data.month.fuelLitres.toLocaleString('en-IN')} litres`} icon={Fuel} tone="cyan" accent />
          <KpiCard label="Per-km cost" value={formatINR(data.month.perKmCost)} hint="Trips on per-km vehicles, at their rate" icon={IndianRupee} tone="emerald" accent />
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <FleetPanel title="Km by day" description="Last 14 days." className="lg:col-span-2">
            <KmByDayChart points={data.byDay} today={data.today} />
          </FleetPanel>
          <FleetPanel title="By project" description="This month's km.">
            <RankedKm rows={ranked.projects} empty="No trips this month." />
          </FleetPanel>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <FleetPanel title="Most running" description="Vehicles by km this month.">
            <RankedKm rows={ranked.vehicles} empty="No trips this month." />
          </FleetPanel>
          <FleetPanel title="Service due" description="Within 300 km of the service interval, or past it.">
            <div className="flex items-start gap-2">
              <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
              <div className="min-w-0 flex-1">
                <ServiceDue rows={data.serviceDue} />
              </div>
            </div>
          </FleetPanel>
          <FleetPanel title="Low mileage" description="Full-tank fills below the vehicle's standard, not yet resolved.">
            <LowMileage rows={data.lowMileage} today={data.today} />
          </FleetPanel>
        </div>
      </section>
    </div>
  );
}

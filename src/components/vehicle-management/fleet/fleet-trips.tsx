'use client';

/**
 * Fleet Trips: every company-vehicle trip in a period, one register.
 *
 * This replaces Vehicle Management's Trip Management page. That page read the trip collection
 * straight from the browser, and "corrected" distances as it went. Fleet trips are measured,
 * reviewed and billed on the server, so this register reads the fleet API instead, and changes
 * nothing. The trips recorded before SEL Fleet (the retired browser tracker) are listed too, tagged
 * "Before SEL Fleet", so the history Trip Management showed is still here.
 *
 * A row opens the trip's own page (route, figures, photos, flags, and the review and close actions
 * for those allowed). Export gives the filtered rows as Excel.
 */

import { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Download, Flag, Hourglass, Loader2, LocateFixed, Route, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DataList, type ListColumn } from '@/components/shared/data-list';
import { FilterBar } from '@/components/shared/filter-bar';
import { KpiCard } from '@/components/shared/kpi-card';
import { PageHeader } from '@/components/shared/page-header';
import { StatusBadge } from '@/components/shared/status-badge';
import { SearchSelect } from '@/components/driver-management/trips/trip-ui';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useFleetQuery } from '@/components/fleet/use-fleet-query';
import { FleetEmpty, FleetRestricted, TripFlagChips, TripStatusBadge } from '@/components/fleet/fleet-ui';
import { istDateKey, istTimeLabel, shortDateLabel } from '@/lib/fleet/dates';
import { exportWorkbook } from '@/lib/report-excel';
import { FLEET_TRIP_STATUS_LABELS, TRIP_FLAG_LABELS, formatINR, formatKm, round1, round2, type FleetTrip, type FleetTripStatus } from '@/lib/fleet/types';
import { FleetLoadError } from './fleet-charts';

const STATUSES: FleetTripStatus[] = ['running', 'paused', 'completed', 'pending_review', 'cancelled'];

const fromOf = (trip: FleetTrip) => trip.startPlace || trip.startGeofenceName || '—';
const toOf = (trip: FleetTrip) => trip.endPlace || trip.endGeofenceName || (trip.endedAt ? '—' : 'On the way');

const tripHref = (trip: FleetTrip) => `/driver-management/fleet/trips/${encodeURIComponent(trip.id)}`;

function LegacyTag() {
  return (
    <StatusBadge tone="neutral" title="Recorded by the old browser tracker, before SEL Fleet: no odometer, no billable figure.">
      Before SEL Fleet
    </StatusBadge>
  );
}

export default function FleetTripsRegister() {
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useToast();
  const { can } = useAuthorization();
  const canView = can('View', 'Vehicle Management.Fleet Trips') || can('Review', 'Vehicle Management.Fleet Trips') || can('View', 'Vehicle Management.Trip Management');
  const canExport = can('Export', 'Vehicle Management.Fleet Trips') || can('Export', 'Vehicle Management.Trip Management');

  // This month by default; the IST calendar, as every fleet figure.
  const [today] = useState(() => istDateKey());
  const [from, setFrom] = useState(() => `${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [status, setStatus] = useState<'all' | FleetTripStatus>('all');
  const [vehicleId, setVehicleId] = useState<string | null>(() => params.get('vehicleId') || null);
  const [search, setSearch] = useState('');
  const [exporting, setExporting] = useState(false);

  const range = from && to && from <= to ? { from, to } : null;
  const { data, error, loading, reload } = useFleetQuery<{ trips: FleetTrip[]; from: string; to: string }>(
    range ? `trips?scope=all&includeLegacy=1&from=${range.from}&to=${range.to}` : null,
  );
  const all = useMemo(() => data?.trips ?? [], [data]);

  // Vehicles seen in the period (and the one the link asked for, even with no trips yet).
  const vehicleOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const trip of all) if (trip.vehicleId && !byId.has(trip.vehicleId)) byId.set(trip.vehicleId, trip.vehicleNumber || trip.vehicleId);
    return [...byId.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [all]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return all.filter((trip) => {
      if (status !== 'all' && trip.status !== status) return false;
      if (vehicleId && trip.vehicleId !== vehicleId) return false;
      if (!needle) return true;
      return [trip.vehicleNumber, trip.driverName, trip.projectName, trip.projectCode, trip.purposeName, fromOf(trip), toOf(trip)].some((value) => value.toLowerCase().includes(needle));
    });
  }, [all, search, status, vehicleId]);

  const live = rows.filter((trip) => trip.status !== 'cancelled');
  const figures = {
    trips: live.length,
    billableKm: round1(live.reduce((sum, trip) => sum + (trip.billableDistanceKm ?? 0), 0)),
    pending: rows.filter((trip) => trip.status === 'pending_review').length,
    flagged: rows.filter((trip) => trip.flagCodes.length > 0).length,
    cost: round2(live.reduce((sum, trip) => sum + (trip.costSnapshot?.amount ?? 0), 0)),
  };
  const activeFilters = (status !== 'all' ? 1 : 0) + (vehicleId ? 1 : 0);

  async function exportRows() {
    setExporting(true);
    try {
      await exportWorkbook(`fleet-trips-${range?.from ?? from}-to-${range?.to ?? to}.xlsx`, [
        {
          name: 'Fleet trips',
          columns: [
            { header: 'Date', key: 'date', width: 12 },
            { header: 'Start (IST)', key: 'start', width: 10 },
            { header: 'End (IST)', key: 'end', width: 10 },
            { header: 'Vehicle', key: 'vehicle', width: 16 },
            { header: 'Driver', key: 'driver', width: 22 },
            { header: 'From', key: 'from', width: 32 },
            { header: 'To', key: 'to', width: 32 },
            { header: 'Project code', key: 'projectCode', width: 14 },
            { header: 'Project', key: 'project', width: 28 },
            { header: 'Purpose', key: 'purpose', width: 22 },
            { header: 'Status', key: 'status', width: 16 },
            { header: 'GPS km', key: 'gpsKm', width: 10, numFmt: '#,##0.0' },
            { header: 'Odometer km', key: 'odoKm', width: 12, numFmt: '#,##0.0' },
            { header: 'Billable km', key: 'billableKm', width: 12, numFmt: '#,##0.0' },
            { header: 'Billed from', key: 'source', width: 12 },
            { header: 'Cost (₹)', key: 'cost', width: 12, numFmt: '#,##0.00' },
            { header: 'Flags', key: 'flags', width: 40 },
            { header: 'Before SEL Fleet', key: 'legacy', width: 16 },
            { header: 'Trip id', key: 'id', width: 24 },
          ],
          rows: rows.map((trip) => ({
            date: trip.dateKey,
            start: istTimeLabel(trip.startedAt),
            end: trip.endedAt ? istTimeLabel(trip.endedAt) : '',
            vehicle: trip.vehicleNumber,
            driver: trip.driverName,
            from: fromOf(trip),
            to: toOf(trip),
            projectCode: trip.projectCode,
            project: trip.projectName,
            purpose: trip.purposeName,
            status: FLEET_TRIP_STATUS_LABELS[trip.status],
            gpsKm: trip.gpsDistanceKm,
            odoKm: trip.odoDistanceKm,
            billableKm: trip.billableDistanceKm,
            source: trip.billableSource ?? '',
            cost: trip.costSnapshot?.amount ?? null,
            flags: trip.flagCodes.map((flag) => TRIP_FLAG_LABELS[flag]).join(', '),
            legacy: trip.legacy ? 'Yes' : '',
            id: trip.id,
          })),
        },
      ]);
    } catch (caught) {
      toast({ variant: 'destructive', title: 'Export failed', description: caught instanceof Error ? caught.message : 'The workbook could not be built.' });
    } finally {
      setExporting(false);
    }
  }

  const columns: Array<ListColumn<FleetTrip>> = [
    {
      header: 'Vehicle',
      mobile: 'title',
      cell: (trip) => (
        <span className="block min-w-0">
          <span className="block font-medium text-slate-800">{trip.vehicleNumber || '—'}</span>
          <span className="block truncate text-xs text-muted-foreground">{trip.driverName || 'Unknown driver'}</span>
        </span>
      ),
    },
    {
      header: 'Status',
      mobile: 'aside',
      cell: (trip) => (
        <span className="flex flex-wrap items-center gap-1">
          <TripStatusBadge status={trip.status} />
          {trip.legacy && <LegacyTag />}
        </span>
      ),
    },
    {
      header: 'When',
      mobile: 'detail',
      cell: (trip) => (
        <span className="whitespace-nowrap tabular-nums text-slate-700">
          {trip.dateKey ? shortDateLabel(trip.dateKey, today) : '—'} · {istTimeLabel(trip.startedAt)}
          {trip.endedAt ? `–${istTimeLabel(trip.endedAt)}` : ''}
        </span>
      ),
    },
    {
      header: 'Route',
      mobile: 'detail',
      cell: (trip) => (
        <span className="block min-w-0 max-w-[22rem] truncate text-slate-700" title={`${fromOf(trip)} → ${toOf(trip)}`}>
          {fromOf(trip)} → {toOf(trip)}
        </span>
      ),
    },
    {
      header: 'Project',
      mobile: 'detail',
      cell: (trip) => (
        <span className="block min-w-0 max-w-[16rem] truncate text-slate-700">
          {trip.projectName ? `${trip.projectCode ? `${trip.projectCode} · ` : ''}${trip.projectName}` : trip.legacy ? '—' : 'No project'}
        </span>
      ),
    },
    { header: 'Purpose', mobile: 'omit', cell: (trip) => <span className="text-slate-700">{trip.purposeName || '—'}</span> },
    { header: 'GPS', align: 'right', mobile: 'omit', cell: (trip) => <span className="tabular-nums">{formatKm(trip.gpsDistanceKm)}</span> },
    { header: 'Odometer', align: 'right', mobile: 'omit', cell: (trip) => <span className="tabular-nums">{formatKm(trip.odoDistanceKm)}</span> },
    {
      header: 'Billable',
      align: 'right',
      mobile: 'footer',
      cell: (trip) => (
        <span className={trip.billableDistanceKm === null ? 'tabular-nums text-muted-foreground' : 'font-semibold tabular-nums text-slate-800'}>
          {trip.billableDistanceKm === null ? (trip.status === 'pending_review' ? 'Waiting for review' : '—') : formatKm(trip.billableDistanceKm)}
        </span>
      ),
    },
    { header: 'Flags', mobile: 'footer', cell: (trip) => (trip.flagCodes.length ? <TripFlagChips flags={trip.flagCodes} /> : <span className="text-muted-foreground">—</span>) },
  ];

  const header = (
    <PageHeader
      title="Fleet Trips"
      icon={LocateFixed}
      description="Every company-vehicle trip: where it went, for which project, GPS against odometer, and what was billed. Open a trip for its route and photos."
      actions={
        canExport && rows.length ? (
          <Button type="button" variant="outline" onClick={() => void exportRows()} disabled={exporting}>
            {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Download className="mr-2 h-4 w-4" aria-hidden />}
            Export
          </Button>
        ) : undefined
      }
    />
  );

  return (
    <div className="space-y-5">
      {header}

      <FilterBar
        search={{ value: search, onChange: setSearch, placeholder: 'Vehicle, driver, project, place…' }}
        activeCount={activeFilters}
        onClear={() => {
          setStatus('all');
          setVehicleId(null);
          setSearch('');
        }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <Input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} className="min-w-0 bg-white" aria-label="From date" />
          <span className="shrink-0 text-xs text-muted-foreground">to</span>
          <Input type="date" value={to} min={from || undefined} max={today} onChange={(event) => setTo(event.target.value)} className="min-w-0 bg-white" aria-label="To date" />
        </div>
        <Select value={status} onValueChange={(value) => setStatus(value as 'all' | FleetTripStatus)}>
          <SelectTrigger className="bg-white text-left" aria-label="Status">
            <SelectValue className="truncate" placeholder="Every status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Every status</SelectItem>
            {STATUSES.map((entry) => (
              <SelectItem key={entry} value={entry}>
                {FLEET_TRIP_STATUS_LABELS[entry]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="min-w-0 sm:w-56">
          <SearchSelect options={vehicleOptions} value={vehicleId} onChange={setVehicleId} placeholder="Every vehicle" emptyText="No vehicle with trips in this period." allowClear />
        </div>
      </FilterBar>

      {!range && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Choose a from date on or before the to date.</p>}
      {data && range && data.from > range.from && (
        <p className="text-xs text-muted-foreground">One request lists at most a year: showing from {shortDateLabel(data.from, today)}.</p>
      )}

      {!data && error ? (
        canView ? <FleetLoadError message={error} onRetry={() => void reload()} /> : <FleetRestricted message={error} />
      ) : !data ? (
        range ? (
          <div className="flex min-h-[30vh] items-center justify-center">
            <Loader2 className="h-7 w-7 animate-spin text-slate-400" aria-label="Loading" />
          </div>
        ) : null
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <KpiCard label="Trips" value={figures.trips} hint={loading ? 'Refreshing…' : `${shortDateLabel(data.from, today)} – ${shortDateLabel(data.to, today)}`} icon={Route} tone="blue" accent />
            <KpiCard label="Billable km" value={formatKm(figures.billableKm)} hint="Settled trips" icon={LocateFixed} tone="cyan" accent />
            <KpiCard label="Waiting for review" value={figures.pending} hint="Not billed until settled" icon={Hourglass} tone={figures.pending ? 'amber' : 'slate'} href={figures.pending ? '/vehicle-management/fleet/exceptions' : undefined} accent />
            <KpiCard label="Flagged" value={figures.flagged} hint="Something to look at" icon={Flag} tone={figures.flagged ? 'orange' : 'slate'} accent />
            <KpiCard label="Per-km cost" value={formatINR(figures.cost)} hint="Fixed-plus-fuel vehicles are costed in the payment report" icon={Wallet} tone="emerald" accent />
          </div>

          <DataList
            rows={rows}
            columns={columns}
            cardHref={tripHref}
            onRowClick={(trip) => router.push(tripHref(trip))}
            rowClassName={(trip) => (trip.legacy ? 'opacity-80' : undefined)}
            empty={
              <FleetEmpty
                title={all.length ? 'No trip matches these filters' : 'No trips in this period'}
                description={all.length ? 'Clear a filter or widen the dates.' : 'Company-vehicle trips appear here as soon as a driver starts one in Fleet & Travel › Fleet Trip.'}
              />
            }
          />
        </>
      )}
    </div>
  );
}

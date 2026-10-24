'use client';

/**
 * Every employee's trips — the organisation-wide register.
 *
 * ── Why this is not just "All Claims" ───────────────────────────────────────────────────────────
 *
 * All Claims answers "what has been submitted". It cannot answer the questions a fleet or a
 * finance team actually asks between submissions: who has been driving and how far, which trips
 * are sitting unclaimed, which were measured rather than typed, how much is accruing this month.
 * An unclaimed trip appears on no claim at all, so until now it was visible to exactly one person
 * — the employee who recorded it.
 *
 * Read-only, deliberately. Editing somebody else's trip belongs to the approval flow, where it is
 * recorded against a decision with a reason attached; silently correcting a line here would leave
 * no trace of who changed what.
 *
 * Gated on Trip Claims · View All, the same permission as the claims register — seeing where a
 * colleague drove is the same disclosure whether it is read off a claim or off the trips behind it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Download, LocateFixed, Route, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DataList, type ListColumn } from '@/components/shared/data-list';
import { FilterBar } from '@/components/shared/filter-bar';
import { PageHeader } from '@/components/shared/page-header';
import { sumMoney } from '@/lib/employee-trips/rates';
import { formatKm, TRIP_STATUS_LABELS, type TripRecord, type TripStatus } from '@/lib/employee-trips/types';
import { errorMessage, tripFetch } from './trip-api';
import {
  EmptyBlock,
  ErrorBlock,
  Km,
  LoadingBlock,
  Money,
  TripStatusBadge,
  VehicleLabel,
  downloadCsv,
  shortDate,
} from './trip-ui';

/** Same reason as the other registers: a few thousand rows in the DOM at once is a frozen page. */
const PAGE_SIZE = 200;

const STATUS_FILTERS: Array<{ value: TripStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'draft', label: TRIP_STATUS_LABELS.draft },
  { value: 'submitted', label: TRIP_STATUS_LABELS.submitted },
  { value: 'approved', label: TRIP_STATUS_LABELS.approved },
  { value: 'paid', label: TRIP_STATUS_LABELS.paid },
  { value: 'rejected', label: TRIP_STATUS_LABELS.rejected },
];

export default function AllTrips() {
  const [trips, setTrips] = useState<TripRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [employee, setEmployee] = useState('all');
  const [status, setStatus] = useState<TripStatus | 'all'>('all');
  const [month, setMonth] = useState('all');
  const [limit, setLimit] = useState(PAGE_SIZE);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await tripFetch<{ trips: TripRecord[] }>('trips/all');
      setTrips(result.trips);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const all = trips ?? [];

  const employees = useMemo(() => {
    const names = new Map<string, string>();
    for (const trip of all) names.set(trip.employeeId, trip.employeeName || trip.employeeId);
    return [...names.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [all]);

  const months = useMemo(
    () => [...new Set(all.map((trip) => trip.tripDate.slice(0, 7)).filter(Boolean))].sort().reverse(),
    [all],
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return all.filter((trip) => {
      if (employee !== 'all' && trip.employeeId !== employee) return false;
      if (status !== 'all' && trip.status !== status) return false;
      if (month !== 'all' && !trip.tripDate.startsWith(month)) return false;
      if (!needle) return true;
      return [
        trip.employeeName,
        trip.fromPlace,
        trip.toPlace,
        trip.purpose,
        trip.vehicleNumber,
        trip.claimNumber,
        trip.projectName,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(needle);
    });
  }, [all, employee, status, month, search]);

  /** Totals over the filtered set, not everything — the figures must match what is on screen. */
  const totals = useMemo(
    () => ({
      distanceKm: filtered.reduce((sum, trip) => sum + (trip.distanceKm || 0), 0),
      amount: sumMoney(filtered.map((trip) => trip.totalAmount || 0)),
      unclaimed: filtered.filter((trip) => trip.status === 'draft').length,
      measured: filtered.filter((trip) => trip.source === 'gps').length,
    }),
    [filtered],
  );

  const columns: ListColumn<TripRecord>[] = [
    {
      header: 'Employee',
      mobile: 'title',
      cell: (trip) => <span className="font-medium text-slate-800">{trip.employeeName || trip.employeeId}</span>,
    },
    {
      header: 'Trip',
      cell: (trip) => (
        <span className="flex min-w-0 max-w-[24rem] items-center gap-1.5 sm:whitespace-nowrap" title={`${trip.fromPlace} → ${trip.toPlace} · ${trip.purpose}`}>
          <span className="truncate text-slate-700">
            {trip.fromPlace} → {trip.toPlace}
          </span>
          {trip.purpose && <span className="truncate text-xs text-muted-foreground">· {trip.purpose}</span>}
        </span>
      ),
    },
    { header: 'Date', cell: (trip) => <span className="whitespace-nowrap">{shortDate(trip.tripDate)}</span> },
    {
      header: 'Vehicle',
      cell: (trip) => <VehicleLabel inline ownership={trip.ownership} vehicleNumber={trip.vehicleNumber} vehicleType={trip.vehicleType} />,
    },
    {
      header: 'Distance',
      align: 'right',
      cell: (trip) => (
        <span className="inline-flex items-center justify-end gap-1.5 whitespace-nowrap">
          <Km value={trip.distanceKm} />
          {trip.source === 'gps' && (
            <Badge
              variant="outline"
              className="gap-1 border-sky-200 bg-sky-50 text-[10px] text-sky-700"
              title={trip.gps ? `Measured by GPS: ${trip.gps.measuredKm} km over ${trip.gps.fixes} fixes.` : 'Measured by GPS.'}
            >
              <LocateFixed className="h-3 w-3" aria-hidden />
              GPS
            </Badge>
          )}
        </span>
      ),
    },
    { header: 'Amount', align: 'right', cell: (trip) => <Money value={trip.totalAmount} /> },
    { header: 'Project', cell: (trip) => <span className="text-xs text-muted-foreground">{trip.projectName || '—'}</span> },
    { header: 'Status', cell: (trip) => <TripStatusBadge status={trip.status} /> },
    {
      header: 'Claim',
      cell: (trip) => <span className="whitespace-nowrap text-xs text-muted-foreground">{trip.claimNumber || '—'}</span>,
    },
  ];

  const exportCsv = () => {
    downloadCsv(
      'all-trips',
      ['Employee', 'Date', 'From', 'To', 'Purpose', 'Vehicle', 'Ownership', 'Distance (km)', 'Amount', 'Project', 'Status', 'Claim', 'Recorded'],
      filtered.map((trip) => [
        trip.employeeName,
        trip.tripDate,
        trip.fromPlace,
        trip.toPlace,
        trip.purpose,
        trip.vehicleNumber,
        trip.ownership,
        trip.distanceKm,
        trip.totalAmount,
        trip.projectName ?? '',
        TRIP_STATUS_LABELS[trip.status],
        trip.claimNumber ?? '',
        trip.source === 'gps' ? 'GPS' : 'Typed',
      ]),
    );
  };

  if (loading) return <LoadingBlock />;
  if (error) return <ErrorBlock message={error} onRetry={() => void load()} />;

  return (
    <div className="space-y-4">
      <PageHeader
        title="All Trips"
        icon={Users}
        description="Every employee's recorded trips, claimed or not. Read-only — changes belong to the approval flow, where they are recorded with a reason."
        actions={
          <Button type="button" variant="outline" onClick={exportCsv} disabled={filtered.length === 0}>
            <Download className="mr-2 h-4 w-4" aria-hidden />
            Export
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {[
          { label: 'Trips', value: String(filtered.length) },
          { label: 'Distance', value: formatKm(totals.distanceKm) },
          { label: 'Value', value: `₹${totals.amount.toLocaleString('en-IN')}` },
          { label: 'Unclaimed', value: String(totals.unclaimed), hint: `${totals.measured} measured by GPS` },
        ].map((tile) => (
          <div key={tile.label} className="rounded-xl border border-white/70 bg-white/80 p-2.5">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{tile.label}</p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-800">{tile.value}</p>
            {tile.hint && <p className="text-[11px] text-muted-foreground">{tile.hint}</p>}
          </div>
        ))}
      </div>

      <FilterBar
        search={{ value: search, onChange: setSearch, placeholder: 'Search employee, place, purpose, vehicle, claim…', label: 'Search trips' }}
        activeCount={(employee !== 'all' ? 1 : 0) + (status !== 'all' ? 1 : 0) + (month !== 'all' ? 1 : 0)}
        onClear={() => {
          setEmployee('all');
          setStatus('all');
          setMonth('all');
          setSearch('');
        }}
      >
        <Select value={employee} onValueChange={setEmployee}>
          <SelectTrigger className="h-9 w-[13rem] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value="all">Everyone</SelectItem>
            {employees.map(([id, name]) => (
              <SelectItem key={id} value={id}>{name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={status} onValueChange={(value) => setStatus(value as TripStatus | 'all')}>
          <SelectTrigger className="h-9 w-[11rem] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={month} onValueChange={setMonth}>
          <SelectTrigger className="h-9 w-[10rem] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value="all">All months</SelectItem>
            {months.map((value) => (
              <SelectItem key={value} value={value}>{value}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterBar>

      {filtered.length === 0 ? (
        <EmptyBlock icon={Route} title={all.length ? 'No trips match' : 'No trips recorded yet'}>
          {all.length ? 'Try another filter or clear the search.' : 'Trips appear here as employees record them.'}
        </EmptyBlock>
      ) : (
        <>
          <DataList rows={filtered.slice(0, limit)} columns={columns} dense />
          {filtered.length > limit && (
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <span>
                Showing {limit} of {filtered.length}
              </span>
              <Button type="button" variant="outline" size="sm" onClick={() => setLimit((value) => value + PAGE_SIZE)}>
                <CalendarClock className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                Show more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

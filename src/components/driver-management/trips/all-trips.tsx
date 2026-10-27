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
import { useRouter } from 'next/navigation';
import { Banknote, CalendarClock, Download, Gauge, Route, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DataList } from '@/components/shared/data-list';
import { FilterBar } from '@/components/shared/filter-bar';
import { KpiCard, KpiGrid } from '@/components/shared/kpi-card';
import { sumMoney } from '@/lib/employee-trips/rates';
import { formatKm, TRIP_STATUS_LABELS, type TripRecord, type TripStatus } from '@/lib/employee-trips/types';
import { allTripColumns } from './all-trips-columns';
import { errorMessage, tripFetch } from './trip-api';
import { EmptyBlock, ErrorBlock, LoadingBlock, Money, downloadCsv } from './trip-ui';

/** Same reason as the other registers: a few thousand rows in the DOM at once is a frozen page. */
const PAGE_SIZE = 100;

/** A row opens the trip's page; its back button returns here. */
const detailHref = (trip: TripRecord) => `/driver-management/trips/${trip.id}?from=all`;

const STATUS_FILTERS: Array<{ value: TripStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'draft', label: TRIP_STATUS_LABELS.draft },
  { value: 'submitted', label: TRIP_STATUS_LABELS.submitted },
  { value: 'approved', label: TRIP_STATUS_LABELS.approved },
  { value: 'paid', label: TRIP_STATUS_LABELS.paid },
  { value: 'rejected', label: TRIP_STATUS_LABELS.rejected },
];

export default function AllTrips() {
  const router = useRouter();
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

  const columns = allTripColumns();

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
      {/*
        No page title or description — the module header names the module and the sidebar the page
        (as on the Overview and My Trips). The figures cover what is filtered, so they match the list.
      */}
      <KpiGrid>
        <KpiCard label="Trips" value={String(filtered.length)} icon={Route} tone="blue" accent />
        <KpiCard label="Distance" value={formatKm(totals.distanceKm)} icon={Gauge} tone="teal" accent />
        <KpiCard label="Value" value={<Money value={totals.amount} />} icon={Banknote} tone="emerald" accent />
        <KpiCard label="Unclaimed" value={String(totals.unclaimed)} hint={`${totals.measured} by GPS`} icon={Wallet} tone="amber" accent />
      </KpiGrid>

      {/* Search, filters and Export on one line, a phone included (as My Trips' search and claim). */}
      <div className="flex min-w-0 items-start gap-2">
      <FilterBar
        className="min-w-0 flex-1"
        search={{ value: search, onChange: setSearch, placeholder: 'Search trips…', label: 'Search trips by employee, place, purpose, vehicle or claim' }}
        activeCount={(employee !== 'all' ? 1 : 0) + (status !== 'all' ? 1 : 0) + (month !== 'all' ? 1 : 0)}
        onClear={() => {
          setEmployee('all');
          setStatus('all');
          setMonth('all');
          setSearch('');
        }}
      >
        <Select value={employee} onValueChange={setEmployee}>
          <SelectTrigger className="w-full bg-white text-left sm:w-52" aria-label="Employee"><SelectValue /></SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value="all">Everyone</SelectItem>
            {employees.map(([id, name]) => (
              <SelectItem key={id} value={id}>{name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={status} onValueChange={(value) => setStatus(value as TripStatus | 'all')}>
          <SelectTrigger className="w-full bg-white text-left sm:w-44" aria-label="Status"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={month} onValueChange={setMonth}>
          <SelectTrigger className="w-full bg-white text-left sm:w-40" aria-label="Month"><SelectValue /></SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value="all">All months</SelectItem>
            {months.map((value) => (
              <SelectItem key={value} value={value}>{value}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterBar>
        <Button type="button" variant="outline" className="shrink-0 px-3 sm:px-4" onClick={exportCsv} disabled={filtered.length === 0} aria-label="Export the trips shown as CSV" title="Export the trips shown as CSV">
          <Download className="h-4 w-4 sm:mr-2" aria-hidden />
          <span className="hidden sm:inline">Export</span>
        </Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyBlock icon={Route} title={all.length ? 'No trips match' : 'No trips recorded yet'}>
          {all.length ? 'Try another filter or clear the search.' : 'Trips appear here as employees record them.'}
        </EmptyBlock>
      ) : (
        <>
          <DataList rows={filtered.slice(0, limit)} columns={columns} dense cardHref={detailHref} onRowClick={(trip) => router.push(detailHref(trip))} />
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

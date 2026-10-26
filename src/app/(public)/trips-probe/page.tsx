'use client';

// TEMPORARY visual probe — delete before ending the turn (memory: no-screenshot-path-for-protected-pages).
import { useState } from 'react';
import Link from 'next/link';
import { Navigation, ReceiptText, Route } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DataList } from '@/components/shared/data-list';
import { PageHeader } from '@/components/shared/page-header';
import { FilterBar } from '@/components/shared/filter-bar';
import { VM_PRIMARY_BUTTON } from '@/components/vehicle-management/vm-ui';
import { myTripColumns } from '@/components/driver-management/trips/my-trips-columns';
import { Money, SegmentTabs } from '@/components/driver-management/trips/trip-ui';
import { DEFAULT_RULES } from '@/lib/employee-trips/workflow';
import type { TripRecord } from '@/lib/employee-trips/types';

const trip = (over: Record<string, unknown>) =>
  ({
    id: String(over.id),
    tripDate: '2026-10-23',
    fromPlace: 'Fcxd',
    toPlace: 'Fssx',
    purpose: 'Fgcd',
    projectName: null,
    vehicleNumber: 'FFFF',
    vehicleType: 'Two Wheeler',
    ownership: 'own',
    distanceKm: 329,
    totalAmount: 987,
    ratePerKm: 3,
    decision: null,
    status: 'submitted',
    claimId: 'c1',
    claimNumber: 'TC-2026-27-0003',
    flags: ['over_trip_limit'],
    returnNote: null,
    source: 'manual',
    gps: null,
    createdAt: '2026-10-23T05:00:00.000Z',
    ...over,
  }) as unknown as TripRecord;

const TRIPS = [
  trip({ id: 't1' }),
  trip({ id: 't2', status: 'draft', claimId: null, claimNumber: null, flags: [], fromPlace: '7RM5+R46, Gopabandhu Nagar, Bhubaneswar, Odisha 751003, India', toPlace: '1015/433, Nilakantha Nagar, Nayapalli, Bhubaneswar, Odisha 751012, India', purpose: 'Bank work', projectName: 'Head Office', distanceKm: 12.4, totalAmount: 37.2, source: 'gps', returnNote: { claimNumber: 'TC-2026-27-0001', byName: 'Manager', remarks: 'Add the toll receipt' } }),
  trip({ id: 't3', status: 'paid', tripDate: '2026-10-12', fromPlace: 'Office', toPlace: 'Infocity Tower site', purpose: 'Site inspection', projectName: 'Infocity Tower', distanceKm: 18, totalAmount: 54, flags: [], claimNumber: 'TC-2026-27-0002' }),
];

export default function TripsProbe() {
  const [view, setView] = useState<'process' | 'all'>('all');
  const [selected] = useState<Set<string>>(new Set());
  const columns = myTripColumns({ rules: DEFAULT_RULES, today: '2026-10-26', claimable: (entry) => entry.status === 'draft', selected, toggle: () => undefined, openClaim: () => undefined, onEdit: () => undefined, onDelete: () => undefined });
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <PageHeader
        title="My Trips"
        icon={Route}
        description="Your own-vehicle trips. Put one, several or all of the unclaimed ones on a claim."
        meta={[
          { label: 'Unclaimed', value: <><Money value={37.2} /> · 12.4 km</> },
          { label: 'In process', value: <Money value={987} /> },
        ]}
        actions={
          <>
            <Button type="button" className={VM_PRIMARY_BUTTON} asChild>
              <Link href="#">
                <Navigation className="mr-2 h-4 w-4" aria-hidden />
                Record a trip
              </Link>
            </Button>
            <Button type="button" variant="outline">
              <ReceiptText className="mr-2 h-4 w-4" aria-hidden />
              Create claim
            </Button>
          </>
        }
      />
      <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
        Record trips on <span className="font-medium underline underline-offset-2">Fleet Trip</span> › Own vehicle — they land here when you stop.
        <span className="hidden sm:inline"> A company vehicle is a fleet trip there, billed to the project and not claimable.</span>
      </p>
      <FilterBar search={{ value: '', onChange: () => undefined, placeholder: 'Search place, purpose, vehicle, claim…', label: 'Search trips' }} activeCount={0} onClear={() => undefined} />
      <SegmentTabs
        label="Trip status"
        value={view}
        onChange={setView}
        options={[
          { value: 'process', label: 'In process', count: 1 },
          { value: 'all', label: 'All', count: 3 },
        ]}
      />
      <DataList rows={TRIPS} columns={columns} dense />
    </div>
  );
}

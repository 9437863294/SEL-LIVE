'use client';

/**
 * Settings › Fleet › Vehicles: every Vehicle Master vehicle with the figures the fleet runs it by —
 * category, daily limit, cost, approvers, odometer and service — and the two things done to one:
 * edit its fleet fields, or reset its odometer.
 *
 * The gaps that change what happens on the road are counted at the top: a per-km vehicle with no
 * rate costs nothing in the payment report, and a vehicle with no approver sends its requests to
 * each driver's reporting authority, which may not be who the fleet office expects.
 */

import { useMemo, useState } from 'react';
import { CarFront, Gauge, Pencil, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { DataList, type ListColumn } from '@/components/shared/data-list';
import { StatusBadge } from '@/components/shared/status-badge';
import { EmptyBlock } from '@/components/driver-management/trips/trip-ui';
import { serviceDueInKm } from '@/lib/fleet/settings';
import { FLEET_CATEGORY_LABELS, formatINR, type FleetSettings, type FleetVehicle, type Geofence } from '@/lib/fleet/types';
import { nameOf, type FleetDirectoryUser } from './fleet-masters';
import { BaselineDialog } from './baseline-dialog';
import { VehicleFleetDialog } from './vehicle-fleet-dialog';

function ServiceDue({ vehicle }: { vehicle: FleetVehicle }) {
  const due = serviceDueInKm(vehicle);
  if (due === null) return <span className="text-muted-foreground">No last service</span>;
  if (due < 0) return <StatusBadge tone="danger">Overdue {Math.round(-due).toLocaleString('en-IN')} km</StatusBadge>;
  if (due <= 300) return <StatusBadge tone="warning">Due in {Math.round(due).toLocaleString('en-IN')} km</StatusBadge>;
  return <span className="tabular-nums text-slate-600">in {Math.round(due).toLocaleString('en-IN')} km</span>;
}

export default function VehicleFleetSettings({
  vehicles,
  settings,
  users,
  geofences,
  canEdit,
  onChanged,
}: {
  vehicles: FleetVehicle[];
  settings: FleetSettings;
  users: FleetDirectoryUser[];
  geofences: Geofence[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [search, setSearch] = useState('');
  const [showRetired, setShowRetired] = useState(false);
  const [editing, setEditing] = useState<FleetVehicle | null>(null);
  const [resetting, setResetting] = useState<FleetVehicle | null>(null);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase().replace(/\s+/g, '');
    return vehicles
      .filter((vehicle) => showRetired || vehicle.active)
      .filter((vehicle) => !needle || `${vehicle.vehicleNumber}${vehicle.vehicleType}${vehicle.assignedDriverName}`.toLowerCase().replace(/\s+/g, '').includes(needle))
      .sort((a, b) => Number(b.active) - Number(a.active) || a.vehicleNumber.localeCompare(b.vehicleNumber));
  }, [search, showRetired, vehicles]);

  const active = vehicles.filter((vehicle) => vehicle.active);
  const noRate = active.filter((vehicle) => vehicle.costBasis === 'per_km' && !vehicle.ratePerKm).length;
  const noApprover = active.filter((vehicle) => !vehicle.approverUid).length;
  const noMileage = active.filter((vehicle) => !vehicle.stdMileageKmpl).length;

  const columns: Array<ListColumn<FleetVehicle>> = [
    {
      header: 'Vehicle',
      mobile: 'title',
      cell: (vehicle) => (
        <span className="block min-w-0">
          <span className="block font-medium text-slate-800">{vehicle.vehicleNumber}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {vehicle.vehicleType}
            {vehicle.assignedDriverName ? ` · ${vehicle.assignedDriverName}` : ''}
          </span>
        </span>
      ),
    },
    {
      header: 'Status',
      mobile: 'aside',
      cell: (vehicle) =>
        !vehicle.active ? (
          <StatusBadge tone="neutral">Left the fleet</StatusBadge>
        ) : vehicle.currentTripId ? (
          <StatusBadge tone="progress" dot>
            On a trip
          </StatusBadge>
        ) : (
          <StatusBadge tone="success">Available</StatusBadge>
        ),
    },
    {
      header: 'Category',
      mobile: 'detail',
      cell: (vehicle) => (
        <span className="whitespace-nowrap">
          {FLEET_CATEGORY_LABELS[vehicle.category]}
          {!vehicle.categorySet && <span className="ml-1 text-[11px] text-muted-foreground">(from type)</span>}
        </span>
      ),
    },
    { header: 'Daily limit', align: 'right', mobile: 'detail', cell: (vehicle) => <span className="tabular-nums">{vehicle.dailyKmLimit.toLocaleString('en-IN')} km</span> },
    {
      header: 'Cost',
      mobile: 'detail',
      cell: (vehicle) =>
        vehicle.costBasis === 'per_km' ? (
          vehicle.ratePerKm ? (
            <span className="whitespace-nowrap tabular-nums">{formatINR(vehicle.ratePerKm)}/km</span>
          ) : (
            <span className="whitespace-nowrap text-amber-700">No rate</span>
          )
        ) : (
          <span className="whitespace-nowrap tabular-nums">{formatINR(vehicle.fixedMonthlyCost)}/month + fuel</span>
        ),
    },
    {
      header: 'Approver',
      mobile: 'detail',
      cell: (vehicle) => (
        <span className="block min-w-0">
          {vehicle.approverUid ? <span className="block truncate">{nameOf(users, vehicle.approverUid)}</span> : <span className="block truncate text-muted-foreground">Reporting authority</span>}
          {vehicle.backupApproverUid && <span className="block truncate text-[11px] text-muted-foreground">Backup: {nameOf(users, vehicle.backupApproverUid)}</span>}
        </span>
      ),
    },
    { header: 'Odometer', align: 'right', mobile: 'detail', cell: (vehicle) => <span className="tabular-nums">{vehicle.currentOdometerKm === null ? '—' : `${Math.round(vehicle.currentOdometerKm).toLocaleString('en-IN')} km`}</span> },
    { header: 'Service', mobile: 'detail', cell: (vehicle) => <ServiceDue vehicle={vehicle} /> },
    ...(canEdit
      ? [
          {
            header: '',
            align: 'right' as const,
            mobile: 'footer' as const,
            cell: (vehicle: FleetVehicle) => (
              <span className="flex justify-end gap-1">
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(vehicle)} aria-label={`Edit ${vehicle.vehicleNumber}`}>
                  <Pencil className="h-4 w-4" aria-hidden />
                  <span className="ml-1.5">Edit</span>
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setResetting(vehicle)} aria-label={`Reset the odometer of ${vehicle.vehicleNumber}`}>
                  <Gauge className="h-4 w-4" aria-hidden />
                  <span className="ml-1.5">Odometer</span>
                </Button>
              </span>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      {(noRate > 0 || noApprover > 0 || noMileage > 0) && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {noRate > 0 && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <span className="font-semibold">{noRate}</span> per-km vehicle{noRate === 1 ? ' has' : 's have'} no rate: their trips cost nothing in the payment report.
            </p>
          )}
          {noApprover > 0 && (
            <p className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
              <span className="font-semibold">{noApprover}</span> vehicle{noApprover === 1 ? ' has' : 's have'} no approver: requests go to each driver&apos;s reporting authority.
            </p>
          )}
          {noMileage > 0 && (
            <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
              <span className="font-semibold">{noMileage}</span> vehicle{noMileage === 1 ? ' has' : 's have'} no standard mileage: low mileage is not checked for {noMileage === 1 ? 'it' : 'them'}.
            </p>
          )}
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative min-w-0 sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search number, type or driver" className="bg-white pl-8" aria-label="Search vehicles" />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
          <Switch checked={showRetired} onCheckedChange={setShowRetired} aria-label="Show vehicles that left the fleet" />
          Show vehicles that left the fleet
        </label>
      </div>

      <DataList rows={rows} columns={columns} rowClassName={(vehicle) => (vehicle.active ? undefined : 'opacity-60')} empty={<EmptyBlock icon={CarFront} title={vehicles.length ? 'No vehicle matches' : 'No vehicles in Vehicle Master'} />} />

      <VehicleFleetDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        vehicle={editing}
        settings={settings}
        users={users}
        geofences={geofences}
        onSaved={() => {
          setEditing(null);
          onChanged();
        }}
      />
      <BaselineDialog
        open={resetting !== null}
        onOpenChange={(open) => !open && setResetting(null)}
        vehicle={resetting}
        onSaved={() => {
          setResetting(null);
          onChanged();
        }}
      />
    </div>
  );
}

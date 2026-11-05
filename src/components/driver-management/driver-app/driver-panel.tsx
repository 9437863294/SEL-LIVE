'use client';

/**
 * The driver's own figures on the Driver Management dashboard — what the separate "Driver Mobile"
 * hub page used to show, minus its cards of links (the sidebar and the phone bar navigate): the
 * assigned vehicle, whether a fleet trip is running, this month's fleet trips and fuel entries, and
 * — on the Android app — this phone's diagnostics, which support asks for when tracking misbehaves.
 * (Daily Status was retired on 2026-10-24; its old logs stay in the database.)
 *
 * Shown only to a login linked to a Vehicle Management driver record, as the Overview's "My vehicle
 * & driving" card (`VehicleCard`, which everyone else gets with their own vehicle instead). The trip
 * and fuel figures come from the fleet API — the Fleet Trip bootstrap already loaded by the shell,
 * and the driver's fuel entries — so nothing here reads the trip or fuel collections with the client
 * SDK any more.
 */

import { useCallback, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Device } from '@capacitor/device';
import { Network } from '@capacitor/network';
import { RefreshCw, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useFleet } from '@/components/fleet/fleet-provider';
import { useFleetQuery } from '@/components/fleet/use-fleet-query';
import { VehicleCard } from '@/components/driver-management/trips/overview-parts';
import type { TrendPoint } from '@/components/driver-management/trips/trip-api';
import { formatKm } from '@/lib/employee-trips/types';
import type { FuelEntryView } from '@/lib/fleet/server/fuel';

type DeviceInfo = Record<'Device' | 'Model' | 'Manufacturer' | 'OS' | 'Battery' | 'Charging' | 'Network' | 'Connected', string>;

async function readDevice(): Promise<DeviceInfo> {
  const [info, battery, network] = await Promise.all([Device.getInfo(), Device.getBatteryInfo(), Network.getStatus()]);
  return {
    Device: String(info.name || info.model || '—'),
    Model: String(info.model || '—'),
    Manufacturer: String(info.manufacturer || '—'),
    OS: `${info.operatingSystem || '—'} ${info.osVersion || ''}`.trim(),
    Battery: typeof battery.batteryLevel === 'number' ? `${Math.round(Math.max(0, Math.min(1, battery.batteryLevel)) * 100)}%` : 'Unknown',
    Charging: battery.isCharging ? 'Yes' : 'No',
    Network: String(network.connectionType || 'unknown'),
    Connected: network.connected ? 'Yes' : 'No',
  };
}

export function DriverPanel({
  driver,
  trend,
  kmThisMonth,
}: {
  driver: Record<string, unknown>;
  /** The driver's own trips (My Trips) by month, for the km bars. */
  trend: TrendPoint[];
  kmThisMonth: number;
}) {
  const fleet = useFleet();
  const fuel = useFleetQuery<{ entries: FuelEntryView[] }>('fuel');
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [deviceBusy, setDeviceBusy] = useState(false);
  const native = Capacitor.isNativePlatform();

  const refreshDevice = useCallback(() => {
    if (!native) return;
    setDeviceBusy(true);
    readDevice()
      .then(setDevice)
      .catch((error) => console.error('Failed to read device diagnostics', error))
      .finally(() => setDeviceBusy(false));
  }, [native]);

  useEffect(() => {
    if (!native) return;
    let cancelled = false;
    readDevice()
      .then((info) => !cancelled && setDevice(info))
      .catch((error) => console.error('Failed to read device diagnostics', error));
    return () => {
      cancelled = true;
    };
  }, [native]);

  const bootstrap = fleet.data;
  const month = (bootstrap?.today ?? new Date().toISOString().slice(0, 10)).slice(0, 7);
  const openTrip = bootstrap?.openTrip ?? null;
  // The bootstrap carries the last ten ended trips; a full ten this month reads "10+".
  const recentThisMonth = (bootstrap?.recentTrips ?? []).filter((trip) => trip.monthKey === month && trip.status !== 'cancelled');
  const tripsThisMonth = recentThisMonth.length + (openTrip && openTrip.monthKey === month ? 1 : 0);
  const tripsLabel = bootstrap && recentThisMonth.length >= 10 ? `${tripsThisMonth}+` : String(tripsThisMonth);
  const fuelThisMonth = (fuel.data?.entries ?? []).filter((entry) => entry.fuelDate.startsWith(month)).length;
  const tripsLoading = fleet.loading && !bootstrap;
  const fuelLoading = fuel.loading && !fuel.data;
  const failed = Boolean((!bootstrap && fleet.error) || (!fuel.data && fuel.error));
  const name = String(driver.driverName || driver.name || 'Driver');
  const mobile = String(driver.mobileNumber || '');
  const vehicleNumber = String(driver.assignedVehicleNumber || '');

  return (
    <VehicleCard
      subtitle={`${name} · ${mobile || 'no mobile on record'}`}
      vehicle={vehicleNumber ? { number: vehicleNumber, caption: 'Company vehicle · assigned to you' } : null}
      emptyNote="No vehicle is assigned to you yet."
      stats={[
        { label: 'Fleet trip', value: tripsLoading ? '…' : openTrip ? 'Running' : 'Not running', href: '/driver-management/fleet', live: Boolean(openTrip) },
        { label: 'Fleet trips this month', value: tripsLoading ? '…' : tripsLabel, href: '/driver-management/fleet' },
        { label: 'Fuel entries this month', value: fuelLoading ? '…' : String(fuelThisMonth), href: '/driver-management/fuel' },
        { label: 'Km on My Trips', value: formatKm(kmThisMonth), href: '/driver-management/my-trips' },
      ]}
      trend={trend}
      note={failed ? 'Your driving records could not be loaded just now.' : undefined}
    >
      {native && (
        <details className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
          <summary className="flex cursor-pointer list-none items-center gap-2 font-medium text-slate-700">
            <Smartphone className="h-4 w-4 text-slate-500" aria-hidden />
            This phone
            <span className="text-xs font-normal text-muted-foreground">— for support, if tracking misbehaves</span>
          </summary>
          <div className="mt-3 flex items-start justify-between gap-3">
            <dl className="grid flex-1 grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
              {device ? (
                (Object.keys(device) as (keyof DeviceInfo)[]).map((key) => (
                  <div key={key} className="flex justify-between gap-2 border-b border-slate-100 pb-1">
                    <dt className="text-xs text-muted-foreground">{key}</dt>
                    <dd className="truncate text-xs font-medium text-slate-800">{device[key]}</dd>
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">Reading the device…</p>
              )}
            </dl>
            <Button type="button" variant="outline" size="sm" onClick={refreshDevice} disabled={deviceBusy} aria-label="Refresh device diagnostics">
              <RefreshCw className={deviceBusy ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} aria-hidden />
            </Button>
          </div>
        </details>
      )}
    </VehicleCard>
  );
}

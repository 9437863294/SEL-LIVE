'use client';

/**
 * The driver's own figures on the Driver Management dashboard — what the separate "Driver Mobile"
 * hub page used to show, minus its cards of links (the sidebar and the phone bar navigate): the
 * assigned vehicle, whether a fleet trip is running, this month's fleet trips and fuel entries, and
 * — on the Android app — this phone's diagnostics, which support asks for when tracking misbehaves.
 * (Daily Status was retired on 2026-10-24; its old logs stay in the database.)
 *
 * Shown only to a login linked to a Vehicle Management driver record. The trip and fuel figures
 * come from the fleet API — the Fleet Trip bootstrap already loaded by the shell, and the driver's
 * fuel entries — so nothing here reads the trip or fuel collections with the client SDK any more.
 */

import { useCallback, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Device } from '@capacitor/device';
import { Network } from '@capacitor/network';
import Link from 'next/link';
import { CarFront, RefreshCw, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useFleet } from '@/components/fleet/fleet-provider';
import { useFleetQuery } from '@/components/fleet/use-fleet-query';
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

export function DriverPanel({ driver }: { driver: Record<string, unknown> }) {
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

  return (
    <DriverPanelView
      name={String(driver.driverName || driver.name || 'Driver')}
      mobile={String(driver.mobileNumber || '')}
      vehicleNumber={String(driver.assignedVehicleNumber || '')}
      tripRunning={tripsLoading ? null : openTrip ? openTrip.vehicleNumber : false}
      tripsLabel={tripsLoading ? '…' : `${tripsLabel}`}
      fuelLabel={fuelLoading ? '…' : String(fuelThisMonth)}
      failed={failed}
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
    </DriverPanelView>
  );
}

/** A vehicle number as a plate: the blue IND band, then the registration in a fixed-width face. */
function NumberPlate({ number }: { number: string }) {
  return (
    <span className="keep-light inline-flex max-w-full items-stretch self-start sm:self-auto overflow-hidden rounded-md border-2 border-slate-800 bg-white shadow-sm">
      <span className="flex w-5 shrink-0 items-end justify-center bg-blue-700 pb-0.5 text-[7px] font-bold text-white" aria-hidden>
        IND
      </span>
      <span className="truncate px-2.5 py-1 font-mono text-base font-bold uppercase tracking-[0.12em] text-slate-900">{number}</span>
    </span>
  );
}

function DriverStat({ label, value, href, tone }: { label: string; value: string; href: string; tone?: 'live' }) {
  return (
    <Link href={href} className="min-w-0 rounded-xl bg-slate-50 px-3 py-2.5 transition-colors hover:bg-slate-100">
      <span className="block truncate text-[11px] font-medium text-muted-foreground">{label}</span>
      <span className={cn('mt-0.5 flex items-center gap-1.5 truncate text-sm font-semibold', tone === 'live' ? 'text-emerald-700' : 'text-slate-800')}>
        {tone === 'live' && <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden />}
        {value}
      </span>
    </Link>
  );
}

/** The panel itself, from plain figures (`tripRunning`: null while loading, false, or the vehicle number). */
export function DriverPanelView({
  name,
  mobile,
  vehicleNumber,
  tripRunning,
  tripsLabel,
  fuelLabel,
  failed,
  children,
}: {
  name: string;
  mobile: string;
  vehicleNumber: string;
  tripRunning: string | false | null;
  tripsLabel: string;
  fuelLabel: string;
  failed: boolean;
  children?: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby="driver-panel">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-700" aria-hidden>
            <CarFront className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 id="driver-panel" className="truncate text-sm font-semibold text-slate-800">
              My vehicle &amp; driving
            </h2>
            <p className="truncate text-xs text-muted-foreground">
              {name} · {mobile || 'no mobile on record'}
            </p>
          </div>
        </div>
        {vehicleNumber ? <NumberPlate number={vehicleNumber} /> : <span className="text-xs font-medium text-muted-foreground">No vehicle assigned</span>}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <DriverStat label="Fleet trip" value={tripRunning === null ? '…' : tripRunning ? 'Running' : 'Not running'} href="/driver-management/fleet" tone={tripRunning ? 'live' : undefined} />
        <DriverStat label="Trips this month" value={tripsLabel} href="/driver-management/fleet" />
        <DriverStat label="Fuel this month" value={fuelLabel} href="/driver-management/fuel" />
      </div>
      {failed && <p className="text-xs text-amber-700">Your driving records could not be loaded just now.</p>}
      {children}
    </section>
  );
}

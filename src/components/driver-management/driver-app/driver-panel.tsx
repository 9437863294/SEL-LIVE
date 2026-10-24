'use client';

/**
 * The driver's own figures on the Driver Management dashboard — what the separate "Driver Mobile"
 * hub page used to show, minus its cards of links (the sidebar and the phone bar navigate): the
 * assigned vehicle, whether a GPS trip is running, this month's GPS trips and fuel entries, and —
 * on the Android app — this phone's diagnostics, which support asks for when tracking misbehaves.
 * (Daily Status was retired on 2026-10-24; its old logs stay in the database.)
 *
 * Shown only to a login linked to a Vehicle Management driver record. Reads the driver's own
 * records with the client SDK, as the hub did (the rules let a driver read their own).
 */

import { useCallback, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Device } from '@capacitor/device';
import { Network } from '@capacitor/network';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { CarFront, Fuel, LocateFixed, RefreshCw, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { KpiCard } from '@/components/shared/kpi-card';
import { SectionHeader } from '@/components/shared/page-header';
import { db } from '@/lib/firebase';
import { VEHICLE_COLLECTIONS } from '@/lib/vehicle-management';

interface DriverSummary {
  tripsThisMonth: number;
  fuelThisMonth: number;
  tripInProgress: boolean;
  failed: boolean;
}

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

async function loadSummary(driverId: string): Promise<DriverSummary> {
  const [fuel, trips] = await Promise.all([
    getDocs(query(collection(db, VEHICLE_COLLECTIONS.fuel), where('driverId', '==', driverId))),
    getDocs(query(collection(db, VEHICLE_COLLECTIONS.trips), where('driverId', '==', driverId))),
  ]);
  const month = new Date().toISOString().slice(0, 7);
  return {
    tripsThisMonth: trips.docs.filter((doc) => String(doc.data().startDate || '').startsWith(month)).length,
    fuelThisMonth: fuel.docs.filter((doc) => String(doc.data().fuelDate || '').startsWith(month)).length,
    tripInProgress: trips.docs.some((doc) => doc.data().tripStatus === 'In Progress'),
    failed: false,
  };
}

const EMPTY: DriverSummary = { tripsThisMonth: 0, fuelThisMonth: 0, tripInProgress: false, failed: true };

export function DriverPanel({ driver }: { driver: Record<string, unknown> }) {
  const driverId = String(driver.id ?? '');
  const [summary, setSummary] = useState<{ driverId: string; value: DriverSummary } | null>(null);
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [deviceBusy, setDeviceBusy] = useState(false);
  const native = Capacitor.isNativePlatform();

  useEffect(() => {
    if (!driverId) return;
    let cancelled = false;
    loadSummary(driverId)
      .then((value) => !cancelled && setSummary({ driverId, value }))
      .catch((error) => {
        console.error('Failed to load the driver summary', error);
        if (!cancelled) setSummary({ driverId, value: EMPTY });
      });
    return () => {
      cancelled = true;
    };
  }, [driverId]);

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

  const value = summary?.driverId === driverId ? summary.value : null;
  const loading = value === null;
  const figure = (count: number | undefined) => (loading ? '…' : String(count ?? 0));

  return (
    <section className="space-y-3">
      <SectionHeader title="My vehicle & driving" icon={CarFront} description={`${String(driver.driverName || driver.name || 'Driver')} · ${String(driver.mobileNumber || 'no mobile on record')}`} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard label="Assigned vehicle" value={String(driver.assignedVehicleNumber || 'Not assigned')} icon={CarFront} tone="blue" accent />
        <KpiCard label="GPS trip" value={loading ? '…' : value.tripInProgress ? 'In progress' : 'Not running'} hint={`${figure(value?.tripsThisMonth)} trips this month`} icon={LocateFixed} tone={value?.tripInProgress ? 'emerald' : 'slate'} accent />
        <KpiCard label="Fuel entries" value={figure(value?.fuelThisMonth)} hint="This month" icon={Fuel} tone="amber" accent />
      </div>
      {value?.failed && <p className="text-xs text-amber-700">Your driving records could not be loaded just now.</p>}
      {native && (
        <details className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
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
    </section>
  );
}

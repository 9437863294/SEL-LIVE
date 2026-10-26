'use client';

/**
 * What the Fleet Trip screens share about starting and ending a trip: the values a start carries
 * between its dialogs (start → over-limit → approval → start again), the location step, the photo
 * upload that must happen once only, and reading the server's refusals.
 *
 * The photo is uploaded once and its id kept with the values: an upload can be attached to one
 * record only, and a start the server refused (over the limit) attached nothing, so the same photo
 * goes with the retry — the driver does not photograph the odometer again because the manager said
 * yes ten minutes later.
 */

import { useEffect, useState } from 'react';
import {
  ensureAndroidBackgroundTrackingSetup,
  ensureDriverConnectivity,
  ensureDriverGeolocation,
  getCurrentDriverPosition,
} from '@/lib/driver-mobile-geolocation';
import type { StartLimitCheck } from '@/lib/fleet/limits';
import type { FleetTrip } from '@/lib/fleet/types';
import type { FleetBootstrap } from '@/lib/fleet/server/overview';
import { FleetApiError, fleetFetch } from '@/components/fleet/fleet-api';
import { uploadFleetPhoto } from '@/components/fleet/photo';
import { reverseGeocode } from '@/components/driver-management/trips/trip-api';

export interface UploadedPhoto {
  blob: Blob;
  uploadId: string;
  ocrKm: number | null;
}

export interface StartValues {
  vehicleId: string;
  purposeId: string;
  purposeReason: string;
  projectId: string | null;
  expectedKm: string;
  /** Where the trip starts, as a GPS trip's From: filled from the phone's position, editable. */
  startPlace: string;
  startOdometerKm: string;
  photo: Blob | null;
  uploaded: UploadedPhoto | null;
}

export interface TripPosition {
  lat: number;
  lng: number;
  accuracyM: number | null;
}

/** A start the server refused for the daily limit, carried into the over-limit dialog. */
export interface OverLimitState {
  values: StartValues;
  limit: StartLimitCheck;
  pendingApprovalId: string | null;
  vehicleNumber: string;
}

export const emptyStartValues = (vehicleId = ''): StartValues => ({
  vehicleId,
  purposeId: '',
  purposeReason: '',
  projectId: null,
  expectedKm: '',
  startPlace: '',
  startOdometerKm: '',
  photo: null,
  uploaded: null,
});

export const toNumber = (value: string): number | null => {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Permissions and a fix before the wheels turn. Background setup is best effort — on a desktop
 * browser, or a phone whose settings screen will not open, the trip still records while the page
 * is open — so its failure is a warning, not a refusal.
 */
export async function prepareLocation(options: { background: boolean }): Promise<{ position: TripPosition | null; warning: string | null }> {
  await ensureDriverConnectivity();
  await ensureDriverGeolocation();
  let warning: string | null = null;
  if (options.background) {
    try {
      await ensureAndroidBackgroundTrackingSetup();
    } catch (error) {
      warning = error instanceof Error ? error.message : 'Background tracking could not be set up.';
    }
  }
  try {
    const fix = await getCurrentDriverPosition({ enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 });
    return { position: { lat: fix.coords.latitude, lng: fix.coords.longitude, accuracyM: Number.isFinite(fix.coords.accuracy) ? fix.coords.accuracy : null }, warning };
  } catch {
    return { position: null, warning: warning ?? 'Your location could not be read just now; the route starts from the first GPS fix.' };
  }
}

/** A quick fix for the end of a trip; none is fine (the last synced point stands in). */
export async function quickPosition(): Promise<TripPosition | null> {
  try {
    const fix = await getCurrentDriverPosition({ enableHighAccuracy: true, timeout: 8_000, maximumAge: 60_000 });
    return { lat: fix.coords.latitude, lng: fix.coords.longitude, accuracyM: Number.isFinite(fix.coords.accuracy) ? fix.coords.accuracy : null };
  } catch {
    return null;
  }
}

/**
 * The name of where the phone is, as the GPS trip names its From and To — reverse-geocoded from the
 * given point, or from a fresh fix. Empty when there is no fix or no answer; the driver can type it.
 */
export async function placeName(point?: { lat: number; lng: number } | null): Promise<string> {
  try {
    const at = point ?? (await quickPosition());
    return at ? await reverseGeocode(at.lat, at.lng) : '';
  } catch {
    return '';
  }
}

/** A trip's route in words, "from → to", falling back to the geofences it started and ended in. */
export function tripRouteLabel(trip: Pick<FleetTrip, 'startPlace' | 'endPlace' | 'startGeofenceName' | 'endGeofenceName' | 'status'>): string {
  const from = trip.startPlace || trip.startGeofenceName;
  const to = trip.endPlace || trip.endGeofenceName || (trip.status === 'running' || trip.status === 'paused' ? 'on the way' : '');
  if (!from && !to) return '';
  return `${from || 'Start'} → ${to || '—'}`;
}

/** Upload the photo unless this very photo is already up. */
export async function ensureUploaded(photo: Blob, current: UploadedPhoto | null, vehicleId: string): Promise<UploadedPhoto> {
  if (current && current.blob === photo) return current;
  const result = await uploadFleetPhoto(photo, 'odometer', vehicleId);
  return { blob: photo, uploadId: result.uploadId, ocrKm: result.ocrKm };
}

/** OCR and the typed reading differ by at least a digit's slip. */
export const ocrDiffers = (typedKm: number | null, ocrKm: number | null | undefined) => typedKm !== null && ocrKm !== null && ocrKm !== undefined && Math.abs(typedKm - ocrKm) >= 1;

export function startBody(values: StartValues, clientStartId: string, position: TripPosition | null, uploaded: UploadedPhoto, emergency?: { reason: string } | null) {
  return {
    clientStartId,
    vehicleId: values.vehicleId,
    projectId: values.projectId,
    purposeId: values.purposeId,
    purposeReason: values.purposeReason.trim(),
    expectedKm: toNumber(values.expectedKm) ?? 0,
    startPlace: values.startPlace.trim(),
    startOdometer: { km: toNumber(values.startOdometerKm) ?? 0, uploadId: uploaded.uploadId, ocrKm: uploaded.ocrKm },
    position,
    emergency: emergency ?? null,
    chainPrevTripId: null,
  };
}

export const postStart = (body: ReturnType<typeof startBody>) => fleetFetch<{ trip: FleetTrip }>('trips/start', { method: 'POST', body });

/** The machine-readable reason a 409 carries (`details.code`), whichever field the client put it in. */
export function refusalCode(error: unknown): string | null {
  if (!(error instanceof FleetApiError)) return null;
  const details = (error.details ?? null) as { code?: unknown } | null;
  return (typeof error.code === 'string' && error.code) || (typeof details?.code === 'string' ? details.code : null);
}

export function overLimitFrom(error: unknown): { limit: StartLimitCheck; pendingApprovalId: string | null } | null {
  if (refusalCode(error) !== 'over_limit') return null;
  const details = ((error as FleetApiError).details ?? {}) as { limit?: StartLimitCheck; pendingApprovalId?: string | null };
  if (!details.limit) return null;
  return { limit: details.limit, pendingApprovalId: details.pendingApprovalId ?? null };
}

/** The request never reached the server (no signal, server unreachable) — as opposed to a refusal. */
export const isNetworkFailure = (error: unknown) => !(error instanceof FleetApiError) || error.status === 0;

export const fieldErrors = (error: unknown): Record<string, string> => (error instanceof FleetApiError && error.fields ? (error.fields as Record<string, string>) : {});

export const vehicleOf = (bootstrap: FleetBootstrap, vehicleId: string | null | undefined) => bootstrap.vehicles.find((vehicle) => vehicle.id === vehicleId) ?? null;

/** A clock for "12 min ago" labels, ticking every `ms`. */
export function useNowMs(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(timer);
  }, [ms]);
  return now;
}

export function sinceLabel(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return '—';
  const minutes = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 60_000));
  if (!Number.isFinite(minutes)) return '—';
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min ago`;
}

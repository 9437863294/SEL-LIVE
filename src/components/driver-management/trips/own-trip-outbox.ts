'use client';

/**
 * Own-vehicle trips saved without a connection — the counterpart of the fleet outbox
 * (src/components/fleet/offline-queue.ts) for a trip recorded on the employee's own vehicle.
 *
 * Stop & review prices the trip on the phone; Save then needs the server. With no signal the save
 * goes here instead: kept in localStorage (a handful of small trips — the route is downsampled to
 * 500 points — survives the app being killed), and sent by itself when the connection is back —
 * on `online`, Capacitor's `networkStatusChange`, the app returning to the foreground, and a retry
 * that backs off from 5 s to 5 min. Each trip carries its `clientTripId` (the recording's id), which
 * the server uses as the trip's id, so a save sent twice is one trip.
 *
 * A refusal that will not change on a retry (the claim window closed meanwhile, a project removed)
 * is kept, marked, with the server's reason — never dropped silently — so the employee can see it,
 * retry it or remove it.
 */

import { useSyncExternalStore } from 'react';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Network } from '@capacitor/network';
import type { TripRecord } from '@/lib/employee-trips/types';
import { viewingAsUserId } from '@/lib/view-as';
import { TripApiError, tripFetch } from './trip-api';

const STORAGE_KEY = 'sel-own-trip-outbox:v1';
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 5 * 60_000;

export interface OwnTripQueued {
  clientTripId: string;
  /** The POST /trips body, `clientTripId` included. */
  body: Record<string, unknown>;
  /** For the list: what the trip is. */
  summary: { tripDate: string; fromPlace: string; toPlace: string; distanceKm: number; amount: number; vehicleNumber: string };
  queuedAt: string;
  attempts: number;
  /** Refused by the server for a reason a retry will not fix; kept until retried or removed. */
  refused: string | null;
}

export interface OwnTripOutboxState {
  items: OwnTripQueued[];
  sending: boolean;
}

/* ── storage ── */

function read(): OwnTripQueued[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as OwnTripQueued[]) : [];
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.clientTripId === 'string') : [];
  } catch {
    return [];
  }
}

function write(items: OwnTripQueued[]) {
  try {
    if (items.length) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Full storage: the in-memory list still sends this session.
  }
}

/* ── status store ── */

const EMPTY: OwnTripOutboxState = { items: [], sending: false };
let state: OwnTripOutboxState = EMPTY;
const listeners = new Set<() => void>();
const savedListeners = new Set<(trip: TripRecord) => void>();

function setState(next: OwnTripOutboxState) {
  state = next;
  listeners.forEach((listener) => listener());
  scheduleRetry();
}

let retryTimer: ReturnType<typeof setTimeout> | null = null;
let failures = 0;
function scheduleRetry() {
  if (typeof window === 'undefined') return;
  const waiting = state.items.some((item) => !item.refused);
  if (!waiting) {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    failures = 0;
    return;
  }
  if (retryTimer || state.sending) return;
  const delay = Math.min(RETRY_BASE_MS * 2 ** Math.max(0, failures - 1), RETRY_MAX_MS);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void flushOwnTrips();
  }, delay);
}

let started = false;
function start() {
  if (started || typeof window === 'undefined') return;
  started = true;
  state = { items: read(), sending: false };
  const backOnline = () => {
    failures = 0;
    void flushOwnTrips();
  };
  window.addEventListener('online', backOnline);
  if (Capacitor.isNativePlatform()) {
    void Network.addListener('networkStatusChange', (change) => change.connected && backOnline()).catch(() => undefined);
    void App.addListener('appStateChange', ({ isActive }) => isActive && backOnline()).catch(() => undefined);
  }
  if (state.items.length) void flushOwnTrips();
}

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useOwnTripOutbox(): OwnTripOutboxState {
  return useSyncExternalStore(subscribe, () => state, () => EMPTY);
}

/** Told about each queued trip the server has now saved (to refresh My Trips). */
export function onOwnTripSaved(listener: (trip: TripRecord) => void): () => void {
  start();
  savedListeners.add(listener);
  return () => {
    savedListeners.delete(listener);
  };
}

/* ── queue and send ── */

/** May the same request succeed later? No connection, server trouble, throttling, a lapsed sign-in. */
const retryable = (error: unknown) => !(error instanceof TripApiError) || error.status >= 500 || error.status === 408 || error.status === 429 || error.status === 401;

export function enqueueOwnTrip(entry: Omit<OwnTripQueued, 'queuedAt' | 'attempts' | 'refused'>) {
  start();
  const items = read().filter((item) => item.clientTripId !== entry.clientTripId);
  const next = [...items, { ...entry, queuedAt: new Date().toISOString(), attempts: 0, refused: null }];
  write(next);
  setState({ ...state, items: next });
}

export function removeOwnTrip(clientTripId: string) {
  const next = read().filter((item) => item.clientTripId !== clientTripId);
  write(next);
  setState({ ...state, items: next });
}

/** A refused trip, tried again (after the reason was dealt with elsewhere). */
export function retryOwnTrip(clientTripId: string) {
  const next = read().map((item) => (item.clientTripId === clientTripId ? { ...item, refused: null, attempts: 0 } : item));
  write(next);
  setState({ ...state, items: next });
  void flushOwnTrips();
}

let flushing: Promise<void> | null = null;

/** Sends every waiting trip, oldest first; one flush at a time. */
export function flushOwnTrips(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  // These are the signed-in person's own trips: they wait while viewing as someone else (Switch User),
  // rather than be refused and marked as not accepted.
  if (viewingAsUserId()) return Promise.resolve();
  if (flushing) return flushing;
  flushing = (async () => {
    setState({ ...state, sending: true });
    let blocked = false;
    try {
      for (const item of read()) {
        if (item.refused) continue;
        try {
          const { trip } = await tripFetch<{ trip: TripRecord }>('trips', { method: 'POST', body: item.body });
          write(read().filter((entry) => entry.clientTripId !== item.clientTripId));
          savedListeners.forEach((listener) => listener(trip));
        } catch (error) {
          const attempts = item.attempts + 1;
          if (retryable(error)) {
            blocked = true;
            write(read().map((entry) => (entry.clientTripId === item.clientTripId ? { ...entry, attempts } : entry)));
            // Offline: the rest would fail the same way.
            break;
          }
          const reason = error instanceof Error && error.message ? error.message : 'The server refused this trip.';
          write(read().map((entry) => (entry.clientTripId === item.clientTripId ? { ...entry, attempts, refused: reason } : entry)));
        }
      }
      failures = blocked ? failures + 1 : 0;
    } finally {
      flushing = null;
      setState({ items: read(), sending: false });
    }
  })();
  return flushing;
}

/** A failure that means "no connection" rather than "the server said no" (for the Save button). */
export const isOfflineFailure = (error: unknown) => retryable(error) && !(error instanceof TripApiError && error.status === 401);

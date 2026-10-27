'use client';

/**
 * The phone's outbox for a running trip (spec §9; PLAN.md §9).
 *
 * Starting a trip needs a connection — the vehicle lock, the daily limit and the approval are the
 * server's decisions. Everything after that must survive a dead zone, a tunnel or a phone that
 * spends the day in a site office with no signal: GPS points, geofence arrivals, and the end of the
 * trip itself (with its odometer photo). They are written here first, in IndexedDB so a killed
 * WebView loses nothing, and sent in order when the network is back.
 *
 * Order matters per trip: points before the end, so the end measures the whole track (the server
 * still re-measures if late points arrive). Each trip's items go strictly first-in-first-out, and a
 * failure that may pass (offline, a 5xx, 408/429, signed out) stops that trip's queue to retry
 * later. A refusal that will not pass (another 4xx — the trip is closed, the reading is invalid)
 * drops the item and records why, so one bad item cannot block everything behind it forever.
 *
 * The server is idempotent on `clientPointId`, `clientEventId` and `clientEndId`, so sending
 * something twice (a response lost on the way back) is harmless.
 *
 * Without IndexedDB (private mode, an old WebView) the queue lives in memory for the session.
 */

import { useSyncExternalStore } from 'react';
import { Capacitor } from '@capacitor/core';
import { Network } from '@capacitor/network';
import type { ClientPoint } from '@/lib/fleet/types';
import { viewingAsUserId } from '@/lib/view-as';
import { FleetApiError, fleetFetch } from './fleet-api';
import { uploadFleetPhoto } from './photo';

const DB_NAME = 'sel-fleet-outbox';
const STORE = 'items';
const POINT_BATCH = 200;
const EVENT_BATCH = 100;
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 5 * 60_000;

export interface QueuedGeofenceEvent {
  clientEventId: string;
  geofenceId: string;
  type: 'enter' | 'exit';
  at: string;
  lat: number;
  lng: number;
}

export interface QueuedEnd {
  clientEndId: string;
  endOdometerKm: number;
  photo: Blob;
  ocrKm: number | null;
  position: { lat: number; lng: number; accuracyM: number | null } | null;
  endedAt: string;
  remark: string;
  /** Where the trip ended, as the driver confirmed it (reverse-geocoded, editable). */
  endPlace?: string;
  /** The photo, when it was uploaded already (an end queued behind its points): not uploaded again. */
  uploadId?: string | null;
  uploadOcrKm?: number | null;
}

/** How an end is stored: the photo as bytes (Blobs in IndexedDB fail on some WebViews). */
interface StoredEnd extends Omit<QueuedEnd, 'photo'> {
  photo: { bytes: ArrayBuffer; type: string } | null;
  /** Set once the photo is uploaded, so a retry does not upload it again. */
  uploadId: string | null;
  uploadOcrKm: number | null;
}

/** A stretch the phone's native recorder was not running, sent with the next points (`gaps`). */
export interface QueuedGap {
  fromAt: string;
  toAt: string;
}

type Item =
  | { seq?: number; tripId: string; kind: 'points'; points: ClientPoint[]; gaps?: QueuedGap[]; createdAt: string; attempts: number }
  | { seq?: number; tripId: string; kind: 'events'; events: QueuedGeofenceEvent[]; createdAt: string; attempts: number }
  | { seq?: number; tripId: string; kind: 'end'; end: StoredEnd; createdAt: string; attempts: number };

/* ── storage: IndexedDB, or memory ── */

let dbPromise: Promise<IDBDatabase | null> | null = null;
const memory: Item[] = [];
let memorySeq = 0;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'seq', autoIncrement: true });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function addItem(item: Item): Promise<void> {
  const db = await openDb();
  if (db) {
    try {
      await done(db.transaction(STORE, 'readwrite').objectStore(STORE).add(item));
      return;
    } catch {
      // Quota or a broken store: keep it in memory rather than lose it.
    }
  }
  memory.push({ ...item, seq: --memorySeq });
}

async function allItems(): Promise<Item[]> {
  const db = await openDb();
  let stored: Item[] = [];
  if (db) {
    try {
      stored = (await done(db.transaction(STORE, 'readonly').objectStore(STORE).getAll())) as Item[];
    } catch {
      stored = [];
    }
  }
  // Memory items (negative seq) were queued when IndexedDB failed; send them after stored ones of
  // the same trip by creation time.
  return [...stored, ...memory].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || (a.seq ?? 0) - (b.seq ?? 0));
}

async function removeItem(item: Item): Promise<void> {
  if ((item.seq ?? 0) < 0) {
    const index = memory.findIndex((entry) => entry.seq === item.seq);
    if (index >= 0) memory.splice(index, 1);
    return;
  }
  const db = await openDb();
  if (db && item.seq !== undefined) await done(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(item.seq)).catch(() => undefined);
}

async function putItem(item: Item): Promise<void> {
  if ((item.seq ?? 0) < 0) {
    const index = memory.findIndex((entry) => entry.seq === item.seq);
    if (index >= 0) memory[index] = item;
    return;
  }
  const db = await openDb();
  if (db) await done(db.transaction(STORE, 'readwrite').objectStore(STORE).put(item)).catch(() => undefined);
}

// A points item carrying only gap records still counts, so the retry keeps running for it.
const weight = (item: Item) => (item.kind === 'points' ? item.points.length || 1 : item.kind === 'events' ? item.events.length : 1);

/* ── status store (useSyncExternalStore) ── */

export interface QueueStatus {
  /** Points, arrivals and trip ends waiting to be sent. */
  pending: number;
  online: boolean;
  flushing: boolean;
  lastError: string | null;
}

let status: QueueStatus = { pending: 0, online: typeof navigator === 'undefined' ? true : navigator.onLine !== false, flushing: false, lastError: null };
const listeners = new Set<() => void>();
const SERVER_STATUS: QueueStatus = { pending: 0, online: true, flushing: false, lastError: null };

function setStatus(patch: Partial<QueueStatus>) {
  const next = { ...status, ...patch };
  if (next.pending === status.pending && next.online === status.online && next.flushing === status.flushing && next.lastError === status.lastError) return;
  status = next;
  listeners.forEach((listener) => listener());
  scheduleRetry();
}

async function refreshPending() {
  const items = await allItems();
  setStatus({ pending: items.reduce((sum, item) => sum + weight(item), 0) });
}

/**
 * The next try after a failed flush: 5 s, then doubling to at most 5 min, back to the start once
 * a flush gets through (or the network comes back). A web timer, which only runs while the app is
 * open — the recording itself is native and does not depend on it.
 */
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let failures = 0;
const retryDelay = () => Math.min(RETRY_BASE_MS * 2 ** Math.max(0, failures - 1), RETRY_MAX_MS);
function scheduleRetry() {
  if (typeof window === 'undefined') return;
  if (status.pending === 0) {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    failures = 0;
    return;
  }
  if (retryTimer || status.flushing) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void flushQueue();
  }, retryDelay());
}

function backOnline() {
  failures = 0;
  setStatus({ online: true });
  void flushQueue();
}

let started = false;
function start() {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('online', backOnline);
  window.addEventListener('offline', () => setStatus({ online: false }));
  // In the app the WebView's online/offline events can lag the radio; Capacitor's own does not.
  if (Capacitor.isNativePlatform()) {
    void Network.addListener('networkStatusChange', (change) => (change.connected ? backOnline() : setStatus({ online: false }))).catch(() => undefined);
  }
  void refreshPending().then(() => {
    if (status.pending) void flushQueue();
  });
}

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useQueueStatus(): QueueStatus {
  return useSyncExternalStore(subscribe, () => status, () => SERVER_STATUS);
}

/* ── enqueue ── */

/** Gap records, if any, ride on the first batch (or on an empty one when there are no points). */
export async function enqueuePoints(tripId: string, points: ClientPoint[], gaps: QueuedGap[] = []): Promise<void> {
  if (!points.length && gaps.length) {
    await addItem({ tripId, kind: 'points', points: [], gaps, createdAt: new Date().toISOString(), attempts: 0 });
  }
  for (let index = 0; index < points.length; index += POINT_BATCH) {
    await addItem({ tripId, kind: 'points', points: points.slice(index, index + POINT_BATCH), ...(index === 0 && gaps.length ? { gaps } : {}), createdAt: new Date().toISOString(), attempts: 0 });
  }
  await refreshPending();
}

export async function enqueueGeofenceEvents(tripId: string, events: QueuedGeofenceEvent[]): Promise<void> {
  for (let index = 0; index < events.length; index += EVENT_BATCH) {
    await addItem({ tripId, kind: 'events', events: events.slice(index, index + EVENT_BATCH), createdAt: new Date().toISOString(), attempts: 0 });
  }
  await refreshPending();
}

export async function enqueueEnd(tripId: string, end: QueuedEnd): Promise<void> {
  let photo: StoredEnd['photo'] = null;
  try {
    photo = { bytes: await end.photo.arrayBuffer(), type: end.photo.type || 'image/jpeg' };
  } catch {
    photo = null;
  }
  const { photo: _blob, ...rest } = end;
  void _blob;
  await addItem({ tripId, kind: 'end', end: { ...rest, photo, uploadId: end.uploadId ?? null, uploadOcrKm: end.uploadOcrKm ?? null }, createdAt: new Date().toISOString(), attempts: 0 });
  await refreshPending();
}

export async function pendingCount(): Promise<number> {
  const items = await allItems();
  return items.reduce((sum, item) => sum + weight(item), 0);
}

/** Points (and gap records) of one trip still on the phone — the end must not overtake them. */
export async function pendingPointsFor(tripId: string): Promise<number> {
  const items = await allItems();
  return items.filter((item) => item.tripId === tripId && item.kind === 'points').reduce((sum, item) => sum + weight(item), 0);
}

/* ── flush ── */

/** May the same request succeed later? Offline, server trouble, throttling, a lapsed sign-in. */
function retryable(error: unknown): boolean {
  if (!(error instanceof FleetApiError)) return true;
  return error.status >= 500 || error.status === 408 || error.status === 429 || error.status === 401;
}

async function send(item: Item): Promise<void> {
  if (item.kind === 'points') {
    await fleetFetch(`trips/${encodeURIComponent(item.tripId)}/points`, { body: { points: item.points, ...(item.gaps?.length ? { gaps: item.gaps } : {}) } });
    return;
  }
  if (item.kind === 'events') {
    await fleetFetch(`trips/${encodeURIComponent(item.tripId)}/geofence-events`, { body: { events: item.events } });
    return;
  }
  const end = item.end;
  if (!end.uploadId) {
    if (!end.photo) throw new FleetApiError('The odometer photo was lost — end the trip again.', 400);
    const uploaded = await uploadFleetPhoto(new Blob([end.photo.bytes], { type: end.photo.type }), 'odometer');
    end.uploadId = uploaded.uploadId;
    end.uploadOcrKm = uploaded.ocrKm;
    // Remember the upload before the end request, so a lost answer does not upload it twice.
    await putItem(item);
  }
  await fleetFetch(`trips/${encodeURIComponent(item.tripId)}/end`, {
    body: {
      clientEndId: end.clientEndId,
      endOdometer: { km: end.endOdometerKm, uploadId: end.uploadId, ocrKm: end.ocrKm ?? end.uploadOcrKm },
      position: end.position,
      endedAt: end.endedAt,
      remark: end.remark,
      endPlace: end.endPlace ?? '',
    },
  });
}

let flushing: Promise<{ sent: number; remaining: number }> | null = null;

export function flushQueue(): Promise<{ sent: number; remaining: number }> {
  if (flushing) return flushing;
  // The queue is the signed-in person's own trips: it waits while they view as someone else (Switch
  // User), whose session the server would refuse to write under.
  if (viewingAsUserId()) return Promise.resolve({ sent: 0, remaining: status.pending });
  flushing = (async () => {
    setStatus({ flushing: true });
    let sent = 0;
    try {
      const items = await allItems();
      const blocked = new Set<string>();
      for (const item of items) {
        if (blocked.has(item.tripId)) continue;
        try {
          await send(item);
          await removeItem(item);
          sent += weight(item);
          setStatus({ online: true, lastError: null });
        } catch (error) {
          if (retryable(error)) {
            // Keep it, and everything behind it for this trip, for the next try.
            blocked.add(item.tripId);
            await putItem({ ...item, attempts: item.attempts + 1 });
            if (!(error instanceof FleetApiError)) setStatus({ online: typeof navigator === 'undefined' ? false : navigator.onLine !== false });
            else if (error.status === 401) setStatus({ lastError: error.message });
          } else {
            // A refusal that will not change (the trip is closed, already ended): drop it.
            await removeItem(item);
            const alreadyDone = error instanceof FleetApiError && (error.code === 'already_ended' || error.code === 'trip_closed');
            if (!alreadyDone) setStatus({ lastError: error instanceof Error ? error.message : 'Could not send.' });
          }
        }
      }
      // Back off while something keeps failing; a clean pass starts the delays again.
      failures = blocked.size ? failures + 1 : 0;
    } finally {
      await refreshPending();
      setStatus({ flushing: false });
      flushing = null;
    }
    return { sent, remaining: status.pending };
  })();
  return flushing;
}

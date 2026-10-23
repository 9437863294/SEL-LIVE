'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { auth } from '@/lib/firebase';
import { tripFetch } from './trip-api';

/** True once Firebase Auth has restored the session — the ID token the API needs exists only then. */
function useAuthReady(): boolean {
  const [ready, setReady] = useState(() => Boolean(auth.currentUser));
  useEffect(() => auth.onAuthStateChanged((user) => setReady(Boolean(user))), []);
  return ready;
}

export interface TripQuery<T> {
  data: T | null;
  /** The path `data` came from — a screen whose path changed can tell a stale answer from a reload. */
  dataPath: string | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  /** Replace the data in place after a change the screen already knows the outcome of. */
  setData: (update: (current: T | null) => T | null) => void;
}

/**
 * GET from the trip-claims API, as Bill Tracking's `useBtQuery` does it: no state is set when a
 * request starts — loading is "the request wanted is not the one on screen" — and a slower, older
 * answer never replaces a newer one. A null path is a query not wanted yet.
 */
export function useTripQuery<T>(path: string | null): TripQuery<T> {
  const ready = useAuthReady();
  const [data, setDataState] = useState<T | null>(null);
  const [dataPath, setDataPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const sequence = useRef(0);
  const key = path && ready ? `${tick}|${path}` : null;

  useEffect(() => {
    if (!path || !key) return;
    const id = ++sequence.current;
    tripFetch<T>(path)
      .then((result) => {
        if (id !== sequence.current) return;
        setDataState(result);
        setDataPath(path);
        setError(null);
        setSettledKey(key);
      })
      .catch((caught: unknown) => {
        if (id !== sequence.current) return;
        setError(caught instanceof Error ? caught.message : 'Could not load.');
        setSettledKey(key);
      });
  }, [path, key]);

  const reload = useCallback(() => setTick((value) => value + 1), []);
  const setData = useCallback((update: (current: T | null) => T | null) => setDataState(update), []);
  return { data, dataPath, loading: key === null ? !ready && Boolean(path) : key !== settledKey, error, reload, setData };
}

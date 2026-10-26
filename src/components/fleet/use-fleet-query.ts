'use client';

/**
 * GET from the fleet API, the way `useTripQuery` does it: no state is set when a request starts —
 * loading is "the request wanted is not the one on screen" — and a slower, older answer never
 * replaces a newer one. A null path is a query not wanted yet.
 *
 * `reload()` refetches in the background (what is on screen stays until the answer arrives) and
 * resolves once it has, so an action can `await reload()` before closing its dialog.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { auth } from '@/lib/firebase';
import { fleetErrorMessage, fleetFetch } from './fleet-api';

/** True once Firebase Auth has restored the session — the ID token the API needs exists only then. */
function useAuthReady(): boolean {
  const [ready, setReady] = useState(() => Boolean(auth.currentUser));
  useEffect(() => auth.onAuthStateChanged((user) => setReady(Boolean(user))), []);
  return ready;
}

export interface FleetQuery<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
  /** Replace the data in place after a change the screen already knows the outcome of. */
  setData: (updater: T | null | ((current: T | null) => T | null)) => void;
}

export function useFleetQuery<T>(path: string | null, deps: unknown[] = []): FleetQuery<T> {
  const ready = useAuthReady();
  const [data, setDataState] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const sequence = useRef(0);
  const pathRef = useRef(path);
  const keyRef = useRef<string | null>(null);
  const depsKey = JSON.stringify(deps);
  const key = path && ready ? `${depsKey}|${path}` : null;

  useEffect(() => {
    pathRef.current = path;
    keyRef.current = key;
  }, [path, key]);

  useEffect(() => {
    if (!path || !key) return;
    const id = ++sequence.current;
    fleetFetch<T>(path)
      .then((result) => {
        if (id !== sequence.current) return;
        setDataState(result);
        setError(null);
        setSettledKey(key);
      })
      .catch((caught: unknown) => {
        if (id !== sequence.current) return;
        setError(fleetErrorMessage(caught, 'Could not load.'));
        setSettledKey(key);
      });
  }, [path, key]);

  const reload = useCallback(async () => {
    const current = pathRef.current;
    if (!current || !auth.currentUser) return;
    const id = ++sequence.current;
    try {
      const result = await fleetFetch<T>(current);
      if (id !== sequence.current) return;
      setDataState(result);
      setError(null);
      // A reload overtakes a first load still in flight; it settles the query in its place.
      setSettledKey(keyRef.current);
    } catch (caught) {
      if (id !== sequence.current) return;
      setError(fleetErrorMessage(caught, 'Could not load.'));
      setSettledKey(keyRef.current);
    }
  }, []);

  const setData = useCallback((updater: T | null | ((current: T | null) => T | null)) => {
    setDataState((current) => (typeof updater === 'function' ? (updater as (value: T | null) => T | null)(current) : updater));
  }, []);

  return { data, error, loading: key === null ? !ready && Boolean(path) : key !== settledKey, reload, setData };
}

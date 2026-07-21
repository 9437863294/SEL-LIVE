/**
 * useCurrentLocation — React hook that exposes the LocationManager singleton.
 *
 * const { location, isTracking, error, start, stop, refresh } = useCurrentLocation();
 *
 * - location   : latest GPS snapshot (null until first fix)
 * - isTracking : true while the background watcher is running
 * - error      : string if start() failed
 * - start()    : start the background watcher
 * - stop()     : stop it
 * - refresh()  : force a fresh one-shot GPS fix right now
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { LocationManager, type LocationSnapshot } from '@/lib/location-manager';
import { getCurrentDriverPosition } from '@/lib/driver-mobile-geolocation';

export type UseCurrentLocationResult = {
  location: LocationSnapshot | null;
  isTracking: boolean;
  error: string | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  refresh: () => Promise<void>;
};

export function useCurrentLocation(autoStart = false): UseCurrentLocationResult {
  const [location, setLocation] = useState<LocationSnapshot | null>(null);
  const [isTracking, setIsTracking] = useState(LocationManager.isRunning());
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    // Subscribe to live updates
    const unsub = LocationManager.subscribe((snap) => {
      if (mountedRef.current) setLocation(snap);
    });

    // Seed with whatever is already stored
    LocationManager.getLatest().then((snap) => {
      if (mountedRef.current && snap) setLocation(snap);
    });

    if (autoStart && !LocationManager.isRunning()) {
      start();
    }

    return () => {
      mountedRef.current = false;
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = useCallback(async () => {
    try {
      setError(null);
      await LocationManager.start();
      if (mountedRef.current) setIsTracking(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to start location tracking';
      if (mountedRef.current) setError(msg);
    }
  }, []);

  const stop = useCallback(async () => {
    await LocationManager.stop();
    if (mountedRef.current) {
      setIsTracking(false);
      setLocation(null);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const pos = await getCurrentDriverPosition({ enableHighAccuracy: true, timeout: 10_000 });
      if (mountedRef.current) {
        setLocation({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          heading: pos.coords.heading,
          speed: pos.coords.speed,
          timestamp: pos.timestamp,
        });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to fetch location';
      if (mountedRef.current) setError(msg);
    }
  }, []);

  return { location, isTracking, error, start, stop, refresh };
}

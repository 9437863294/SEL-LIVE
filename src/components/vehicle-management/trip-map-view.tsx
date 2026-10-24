'use client';

/**
 * The trip map.
 *
 * ── What was wrong with drawing it the obvious way ──────────────────────────────────────────────
 *
 * The previous version rebuilt the polyline and both markers and called `fitBounds` inside an
 * effect keyed on the points array — so every GPS fix, by default every ten seconds, tore down the
 * overlays and re-zoomed the map. A driver who pinched in to read a junction had the map zoom back
 * out from under them a few seconds later, and the route visibly flickered as it was redrawn.
 *
 * So the map, the path and the marker are created once and *mutated* afterwards. `fitBounds` runs
 * only on the first points that arrive; after that the map follows the vehicle, and it stops
 * following the moment the user drags — which is the behaviour a delivery app has and the reason
 * its map feels calm while this one did not.
 *
 * ── What it draws ───────────────────────────────────────────────────────────────────────────────
 *
 * The cleaned path rather than the raw fixes. `computeTripDistanceDeltaKm` already discards poor
 * accuracy, jitter and impossible jumps when counting kilometres; drawing the raw points meant the
 * line disagreed with the distance the same trip reported. `cleanTripPath` applies those same
 * rules, so the picture and the number describe one journey.
 *
 * Coloured by speed, because a flat line cannot answer "where did it crawl", and marked with the
 * stops, because a vehicle parked for ninety minutes is otherwise a dot like any other.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { loadGoogleMapsApi } from '@/components/vehicle-management/google-maps-loader';
import {
  cleanTripPath,
  detectTripStops,
  tripSpeedSegments,
  type CleanedTripPath,
  type TripLocationPoint,
  type TripSpeedBand,
} from '@/lib/vehicle-management';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

type TripMapViewProps = {
  points: TripLocationPoint[];
  title?: string;
  heightClassName?: string;
  fallbackCenter?: { lat: number; lng: number };
  /** A trip in progress: shows the heading arrow, the accuracy circle and the follow control. */
  live?: boolean;
  /** Draw the raw fixes instead of the cleaned path. For diagnosing a path that looks wrong. */
  showRaw?: boolean;
};

const defaultCenter = { lat: 22.9734, lng: 78.6569 };

/** Green through amber to red, so a glance at the line reads as pace. */
const BAND_COLOUR: Record<TripSpeedBand, string> = {
  stopped: '#94A3B8',
  slow: '#F59E0B',
  normal: '#0EA5E9',
  fast: '#10B981',
};

const BAND_LABEL: Record<TripSpeedBand, string> = {
  stopped: 'Stopped',
  slow: 'Under 20',
  normal: '20–60',
  fast: 'Over 60',
};

export default function TripMapView({
  points,
  title = 'Trip Route',
  heightClassName = 'h-[340px]',
  fallbackCenter = defaultCenter,
  live = false,
  showRaw = false,
}: TripMapViewProps) {
  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const segmentsRef = useRef<any[]>([]);
  const stopMarkersRef = useRef<any[]>([]);
  const startMarkerRef = useRef<any>(null);
  const vehicleMarkerRef = useRef<any>(null);
  const accuracyCircleRef = useRef<any>(null);
  const hasFittedRef = useRef(false);

  const [mapError, setMapError] = useState('');
  const [ready, setReady] = useState(false);
  /** Follow is on until the user takes the map somewhere themselves. */
  const [following, setFollowing] = useState(true);
  const followingRef = useRef(true);
  followingRef.current = following;

  // The raw branch reports nothing dropped and the same count, so both branches have one shape
  // and the badge below does not have to reason about which it got.
  const cleaned = useMemo(
    () =>
      showRaw
        ? { points, dropped: null as CleanedTripPath['dropped'] | null, rawCount: points.length }
        : cleanTripPath(points),
    [points, showRaw],
  );
  const path = cleaned.points;
  const segments = useMemo(() => tripSpeedSegments(path), [path]);
  const stops = useMemo(() => (live ? [] : detectTripStops(path)), [path, live]);

  const droppedTotal = useMemo(() => {
    if (!cleaned.dropped) return 0;
    return Object.values(cleaned.dropped).reduce((sum, value) => sum + value, 0);
  }, [cleaned]);

  /* ── Create the map once ── */
  useEffect(() => {
    let cancelled = false;

    const mount = async () => {
      try {
        await loadGoogleMapsApi();
      } catch (error: any) {
        if (!cancelled) setMapError(error?.message || 'Failed to load map.');
        return;
      }
      if (cancelled || !mapNodeRef.current || !window.google?.maps || mapRef.current) return;

      mapRef.current = new window.google.maps.Map(mapNodeRef.current, {
        center: fallbackCenter,
        zoom: 12,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        gestureHandling: 'greedy',
      });

      // A drag is the user saying where they want to look; following would undo that on the next
      // fix. `dragstart` rather than `center_changed`, which our own panning also fires.
      mapRef.current.addListener('dragstart', () => setFollowing(false));
      setReady(true);
    };

    void mount();
    return () => {
      cancelled = true;
    };
    // Mounted once: `fallbackCenter` is only the opening view, and re-running would recreate the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Redraw the path when it changes ── */
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !window.google?.maps) return;

    for (const line of segmentsRef.current) line.setMap(null);
    segmentsRef.current = [];

    if (path.length === 0) return;

    /*
      One polyline per run of same-coloured segments rather than per segment.

      A fix every ten seconds over an hour is 360 segments; 360 Polyline objects is enough to make
      panning stutter on a phone. Consecutive segments in the same band share one line, which on a
      real drive collapses it to a handful.
    */
    let runStart = 0;
    for (let index = 1; index <= segments.length; index += 1) {
      const endOfRun = index === segments.length || segments[index].band !== segments[runStart].band;
      if (!endOfRun) continue;

      const run = segments.slice(runStart, index);
      segmentsRef.current.push(
        new window.google.maps.Polyline({
          map,
          path: [run[0].from, ...run.map((segment) => segment.to)].map((point) => ({
            lat: point.lat,
            lng: point.lng,
          })),
          geodesic: true,
          strokeColor: BAND_COLOUR[run[0].band],
          strokeOpacity: 0.95,
          strokeWeight: 5,
        }),
      );
      runStart = index;
    }

    if (!startMarkerRef.current) {
      startMarkerRef.current = new window.google.maps.Marker({
        map,
        title: 'Trip start',
        label: 'S',
      });
    }
    startMarkerRef.current.setPosition({ lat: path[0].lat, lng: path[0].lng });

    // Only the first time: after that the map follows, or stays where the user put it.
    if (!hasFittedRef.current) {
      const bounds = new window.google.maps.LatLngBounds();
      for (const point of path) bounds.extend({ lat: point.lat, lng: point.lng });
      map.fitBounds(bounds);
      if (path.length === 1) map.setZoom(16);
      hasFittedRef.current = true;
    }
  }, [path, segments, ready]);

  /* ── Move the vehicle, rather than replacing it ── */
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !window.google?.maps || path.length === 0) return;

    const last = path[path.length - 1];
    const position = { lat: last.lat, lng: last.lng };

    if (!vehicleMarkerRef.current) {
      vehicleMarkerRef.current = new window.google.maps.Marker({
        map,
        title: live ? 'Current position' : 'Trip end',
        zIndex: 10,
      });
    }

    vehicleMarkerRef.current.setPosition(position);
    vehicleMarkerRef.current.setIcon(
      live
        ? {
            // An arrow pointing where the vehicle is going. A heading of 0 from a stationary
            // device means "unknown" as often as "due north", so a still vehicle gets a dot.
            path:
              Number.isFinite(last.headingDeg) && Number(last.speedKmph || 0) > 2
                ? window.google.maps.SymbolPath.FORWARD_CLOSED_ARROW
                : window.google.maps.SymbolPath.CIRCLE,
            scale: 6,
            rotation: Number(last.headingDeg || 0),
            fillColor: '#0F172A',
            fillOpacity: 1,
            strokeColor: '#FFFFFF',
            strokeWeight: 2,
          }
        : { path: window.google.maps.SymbolPath.CIRCLE, scale: 6, fillColor: '#DC2626', fillOpacity: 1, strokeColor: '#FFFFFF', strokeWeight: 2 },
    );

    // How much to trust the dot. A 300 m circle explains a path that looks like it cuts corners.
    if (live && Number(last.accuracyMeters || 0) > 0) {
      if (!accuracyCircleRef.current) {
        accuracyCircleRef.current = new window.google.maps.Circle({
          map,
          strokeColor: '#0EA5E9',
          strokeOpacity: 0.35,
          strokeWeight: 1,
          fillColor: '#0EA5E9',
          fillOpacity: 0.1,
        });
      }
      accuracyCircleRef.current.setCenter(position);
      accuracyCircleRef.current.setRadius(Number(last.accuracyMeters));
    }

    if (followingRef.current) map.panTo(position);
  }, [path, live, ready]);

  /* ── Stops, on a finished trip ── */
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !window.google?.maps) return;

    for (const marker of stopMarkersRef.current) marker.setMap(null);
    stopMarkersRef.current = stops.map(
      (stop) =>
        new window.google.maps.Marker({
          map,
          position: { lat: stop.lat, lng: stop.lng },
          title: `Stopped ${stop.minutes} min`,
          icon: {
            path: window.google.maps.SymbolPath.CIRCLE,
            scale: 7,
            fillColor: '#F59E0B',
            fillOpacity: 0.95,
            strokeColor: '#FFFFFF',
            strokeWeight: 2,
          },
          zIndex: 5,
        }),
    );
  }, [stops, ready]);

  return (
    <Card className="vm-panel overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle>{title}</CardTitle>
        <div className="flex items-center gap-1.5">
          {!live && stops.length > 0 && (
            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-[10px] text-amber-800">
              {stops.length} stop{stops.length === 1 ? '' : 's'}
            </Badge>
          )}
          {droppedTotal > 0 && (
            // Said out loud: a path drawn from 40 of 300 fixes should not look like a complete
            // record of the drive without explanation.
            <Badge
              variant="outline"
              className="text-[10px]"
              title="Fixes discarded as inaccurate, stationary jitter, or impossible jumps — the same rules the distance uses."
            >
              {path.length}/{cleaned.rawCount} fixes
            </Badge>
          )}
          {live && !following && (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setFollowing(true)}>
              Recentre
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {mapError ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {mapError}
          </div>
        ) : (
          <>
            <div
              ref={mapNodeRef}
              className={`w-full rounded-xl border border-white/70 bg-slate-100 ${heightClassName}`}
            />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              {(Object.keys(BAND_COLOUR) as TripSpeedBand[]).map((band) => (
                <span key={band} className="inline-flex items-center gap-1">
                  <span
                    className="inline-block h-1.5 w-4 rounded-full"
                    style={{ backgroundColor: BAND_COLOUR[band] }}
                  />
                  {BAND_LABEL[band]}
                </span>
              ))}
              <span className="ml-auto">km/h</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

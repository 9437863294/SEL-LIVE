'use client';

/**
 * Maps for geofences: the picker in the add/edit dialog, and the overview of every fence.
 *
 * The picker is a pin and a circle. Tapping the map or dragging the pin moves the centre; the radius
 * comes from the dialog's slider and draws as the circle, so the admin sees exactly the ground a
 * vehicle must be on to count as "at" the place. Other fences are drawn faintly behind it, because
 * the usual mistake is a new circle that swallows an existing one (a pump inside a yard is fine —
 * the smaller fence wins — but two overlapping yards are not).
 *
 * Like the trip map, the map and its overlays are created once and moved afterwards: rebuilding them
 * on every keystroke in the latitude box would flicker and reset the zoom under the admin's fingers.
 */

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Crosshair } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { loadGoogleMapsApi } from '@/components/vehicle-management/google-maps-loader';
import type { GeofenceKind } from '@/lib/fleet/types';
import { cn } from '@/lib/utils';

/** India, zoomed out, until there is a point to show. */
const INDIA = { lat: 22.9734, lng: 78.6569 };

/** One colour per kind, on the map and in the legend. */
export const GEOFENCE_KIND_COLOURS: Record<GeofenceKind, string> = {
  office: '#2563EB',
  yard: '#7C3AED',
  fuel_station: '#F59E0B',
  project_site: '#10B981',
  other: '#64748B',
};

export interface MapFence {
  id: string;
  name: string;
  kind: GeofenceKind;
  lat: number;
  lng: number;
  radiusM: number;
}

type LatLng = { lat: number; lng: number };

const isPoint = (lat: number | null, lng: number | null): boolean => lat !== null && lng !== null && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

function MapFrame({ nodeRef, error, heightClassName, children }: { nodeRef: RefObject<HTMLDivElement | null>; error: string | null; heightClassName: string; children?: ReactNode }) {
  return (
    <div className={cn('relative w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100', heightClassName)}>
      <div ref={nodeRef} className="absolute inset-0" />
      {error && (
        <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-slate-600">
          The map could not load ({error}). The latitude, longitude and radius fields still work.
        </div>
      )}
      {children}
    </div>
  );
}

export function GeofenceMapPicker({
  lat,
  lng,
  radiusM,
  kind,
  onMove,
  others = [],
  disabled = false,
  heightClassName = 'h-[280px] sm:h-[340px]',
}: {
  lat: number | null;
  lng: number | null;
  radiusM: number;
  kind: GeofenceKind;
  onMove: (point: LatLng) => void;
  /** The other fences, drawn faintly for reference. */
  others?: MapFence[];
  disabled?: boolean;
  heightClassName?: string;
}) {
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const circleRef = useRef<any>(null);
  const otherCirclesRef = useRef<any[]>([]);
  const onMoveRef = useRef(onMove);
  const fittedRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The latest handler, without re-binding the map's listeners on every render.
  useEffect(() => {
    onMoveRef.current = onMove;
  }, [onMove]);

  /* ── Create the map, the pin and the circle once ── */
  useEffect(() => {
    let cancelled = false;
    const mount = async () => {
      try {
        await loadGoogleMapsApi();
      } catch (failure) {
        if (!cancelled) setError(failure instanceof Error ? failure.message : 'unavailable');
        return;
      }
      const maps = window.google?.maps;
      if (cancelled || !nodeRef.current || !maps || mapRef.current) return;
      mapRef.current = new maps.Map(nodeRef.current, {
        center: INDIA,
        zoom: 5,
        mapTypeControl: true,
        mapTypeControlOptions: { position: maps.ControlPosition.TOP_RIGHT },
        streetViewControl: false,
        fullscreenControl: true,
        gestureHandling: 'greedy',
        clickableIcons: false,
      });
      markerRef.current = new maps.Marker({ map: null, draggable: true });
      circleRef.current = new maps.Circle({ map: null, clickable: false, strokeWeight: 2, fillOpacity: 0.18 });
      markerRef.current.addListener('dragend', (event: any) => {
        const point = event?.latLng;
        if (point) onMoveRef.current({ lat: point.lat(), lng: point.lng() });
      });
      mapRef.current.addListener('click', (event: any) => {
        const point = event?.latLng;
        if (point && markerRef.current?.getDraggable()) onMoveRef.current({ lat: point.lat(), lng: point.lng() });
      });
      setReady(true);
    };
    void mount();
    return () => {
      cancelled = true;
      markerRef.current?.setMap(null);
      circleRef.current?.setMap(null);
      otherCirclesRef.current.forEach((circle) => circle.setMap(null));
    };
  }, []);

  /* ── Move the pin and the circle ── */
  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const colour = GEOFENCE_KIND_COLOURS[kind];
    markerRef.current.setDraggable(!disabled);
    circleRef.current.setOptions({ strokeColor: colour, fillColor: colour });
    if (!isPoint(lat, lng)) {
      markerRef.current.setMap(null);
      circleRef.current.setMap(null);
      return;
    }
    const center = { lat: lat as number, lng: lng as number };
    markerRef.current.setPosition(center);
    markerRef.current.setMap(mapRef.current);
    circleRef.current.setCenter(center);
    circleRef.current.setRadius(Math.max(1, radiusM));
    circleRef.current.setMap(mapRef.current);
    // Frame the fence the first time there is one; after that the admin's own zoom stands, and the
    // map only pans when the pin leaves the view (a typed coordinate somewhere else).
    if (!fittedRef.current) {
      fittedRef.current = true;
      mapRef.current.fitBounds(circleRef.current.getBounds());
    } else if (!mapRef.current.getBounds()?.contains(center)) {
      mapRef.current.panTo(center);
    }
  }, [ready, lat, lng, radiusM, kind, disabled]);

  /* ── The other fences, faintly ── */
  useEffect(() => {
    const maps = window.google?.maps;
    if (!ready || !mapRef.current || !maps) return;
    otherCirclesRef.current.forEach((circle) => circle.setMap(null));
    otherCirclesRef.current = others.map(
      (fence) =>
        new maps.Circle({
          map: mapRef.current,
          center: { lat: fence.lat, lng: fence.lng },
          radius: fence.radiusM,
          clickable: false,
          strokeColor: GEOFENCE_KIND_COLOURS[fence.kind],
          strokeOpacity: 0.5,
          strokeWeight: 1,
          fillColor: GEOFENCE_KIND_COLOURS[fence.kind],
          fillOpacity: 0.06,
        }),
    );
  }, [ready, others]);

  const frame = () => {
    if (mapRef.current && circleRef.current && isPoint(lat, lng)) mapRef.current.fitBounds(circleRef.current.getBounds());
  };

  return (
    <MapFrame nodeRef={nodeRef} error={error} heightClassName={heightClassName}>
      {ready && isPoint(lat, lng) && (
        <Button type="button" size="sm" variant="outline" onClick={frame} className="absolute bottom-3 left-3 h-8 bg-white/95 text-xs shadow-sm">
          <Crosshair className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          Frame the fence
        </Button>
      )}
      {ready && !isPoint(lat, lng) && !disabled && (
        <p className="pointer-events-none absolute inset-x-3 top-3 rounded-lg bg-white/95 px-3 py-2 text-center text-xs text-slate-700 shadow-sm">
          Tap the map where the place is, or use your location.
        </p>
      )}
    </MapFrame>
  );
}

/** Every fence on one map; tapping a circle selects it. */
export function GeofenceOverviewMap({
  fences,
  onSelect,
  heightClassName = 'h-[320px] sm:h-[420px]',
}: {
  fences: MapFence[];
  onSelect?: (id: string) => void;
  heightClassName?: string;
}) {
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const overlaysRef = useRef<any[]>([]);
  const onSelectRef = useRef(onSelect);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    let cancelled = false;
    const mount = async () => {
      try {
        await loadGoogleMapsApi();
      } catch (failure) {
        if (!cancelled) setError(failure instanceof Error ? failure.message : 'unavailable');
        return;
      }
      const maps = window.google?.maps;
      if (cancelled || !nodeRef.current || !maps || mapRef.current) return;
      mapRef.current = new maps.Map(nodeRef.current, { center: INDIA, zoom: 5, mapTypeControl: false, streetViewControl: false, fullscreenControl: true, gestureHandling: 'cooperative', clickableIcons: false });
      setReady(true);
    };
    void mount();
    return () => {
      cancelled = true;
      overlaysRef.current.forEach((overlay) => overlay.setMap(null));
    };
  }, []);

  useEffect(() => {
    const maps = window.google?.maps;
    if (!ready || !mapRef.current || !maps) return;
    overlaysRef.current.forEach((overlay) => overlay.setMap(null));
    overlaysRef.current = [];
    if (!fences.length) return;
    const bounds = new maps.LatLngBounds();
    for (const fence of fences) {
      const colour = GEOFENCE_KIND_COLOURS[fence.kind];
      const circle = new maps.Circle({ map: mapRef.current, center: { lat: fence.lat, lng: fence.lng }, radius: fence.radiusM, strokeColor: colour, strokeWeight: 2, fillColor: colour, fillOpacity: 0.16 });
      const marker = new maps.Marker({ map: mapRef.current, position: { lat: fence.lat, lng: fence.lng }, title: fence.name, icon: { path: maps.SymbolPath.CIRCLE, scale: 4, fillColor: colour, fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 1.5 } });
      const select = () => onSelectRef.current?.(fence.id);
      circle.addListener('click', select);
      marker.addListener('click', select);
      overlaysRef.current.push(circle, marker);
      bounds.union(circle.getBounds());
    }
    mapRef.current.fitBounds(bounds);
  }, [ready, fences]);

  return <MapFrame nodeRef={nodeRef} error={error} heightClassName={heightClassName} />;
}

'use client';

/**
 * Fleet maps.
 *
 * - `FleetTripMap` — one trip's route, drawn by Vehicle Management's `TripMapView` (cleaned path,
 *   speed colours, stops, calm live following), so a fleet trip looks like every other trip.
 * - `LiveFleetMap` — every running trip at its last synced position. The map and markers are created
 *   once and moved afterwards (the reason `TripMapView` is calm); the view fits the vehicles on the
 *   first load and when the set of vehicles changes, never on a mere position update. If Google
 *   Maps cannot load (no key, offline, blocked), the same trips are listed with a link each.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import TripMapView from '@/components/vehicle-management/trip-map-view';
import { loadGoogleMapsApi } from '@/components/vehicle-management/google-maps-loader';
import { istTimeLabel } from '@/lib/fleet/dates';
import { formatKm, type FleetTrip } from '@/lib/fleet/types';
import type { TripLocationPoint } from '@/lib/vehicle-management';
import { cn } from '@/lib/utils';

export function FleetTripMap({
  points,
  live = false,
  heightClassName,
  title = 'Route',
}: {
  points: Array<{ lat: number; lng: number; at?: string }>;
  live?: boolean;
  heightClassName?: string;
  title?: string;
}) {
  const track = useMemo<TripLocationPoint[]>(() => points.map((point) => ({ lat: point.lat, lng: point.lng, recordedAtIso: point.at })), [points]);
  return <TripMapView points={track} live={live} title={title} heightClassName={heightClassName ?? 'h-[300px] sm:h-[360px]'} />;
}

const INDIA = { lat: 22.9734, lng: 78.6569 };

const located = (trip: FleetTrip) => trip.lastPointLat !== null && trip.lastPointLng !== null && Number.isFinite(trip.lastPointLat) && Number.isFinite(trip.lastPointLng);

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string);

function infoHtml(trip: FleetTrip) {
  const lines = [
    `<strong>${escapeHtml(trip.vehicleNumber)}</strong>`,
    escapeHtml(trip.driverName),
    escapeHtml([trip.purposeName, trip.projectName].filter(Boolean).join(' · ')),
    `${escapeHtml(formatKm(trip.gpsDistanceKm))} so far${trip.lastPointAt ? ` · last fix ${escapeHtml(istTimeLabel(trip.lastPointAt))}` : ''}`,
    trip.status === 'paused' ? '<em>Paused</em>' : '',
  ].filter(Boolean);
  return `<div style="font-size:12px;line-height:1.4;color:#0f172a">${lines.join('<br/>')}</div>`;
}

export function LiveFleetMap({ trips, heightClassName = 'h-[320px] sm:h-[420px]' }: { trips: FleetTrip[]; heightClassName?: string }) {
  const nodeRef = useRef<HTMLDivElement | null>(null);
  // The Maps API is untyped here, as in trip-map-view.tsx.
  const mapRef = useRef<any>(null);
  const infoRef = useRef<any>(null);
  const markersRef = useRef(new Map<string, any>());
  const fittedFor = useRef<string>('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');

  const placed = useMemo(() => trips.filter(located), [trips]);

  // The map, once.
  useEffect(() => {
    let cancelled = false;
    loadGoogleMapsApi()
      .then(() => {
        if (cancelled || !nodeRef.current || !window.google?.maps) {
          if (!cancelled) setStatus('failed');
          return;
        }
        const google = window.google;
        mapRef.current = new google.maps.Map(nodeRef.current, { center: INDIA, zoom: 5, mapTypeControl: false, streetViewControl: false, fullscreenControl: true, clickableIcons: false });
        infoRef.current = new google.maps.InfoWindow();
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('failed');
      });
    const markers = markersRef.current;
    return () => {
      cancelled = true;
      markers.forEach((marker) => marker.setMap(null));
      markers.clear();
      mapRef.current = null;
    };
  }, []);

  // Markers follow the trips: moved when they exist, added and removed as trips start and end.
  useEffect(() => {
    if (status !== 'ready' || !mapRef.current || !window.google?.maps) return;
    const google = window.google;
    const map = mapRef.current;
    const markers = markersRef.current;
    const seen = new Set<string>();
    for (const trip of placed) {
      seen.add(trip.id);
      const position = { lat: trip.lastPointLat as number, lng: trip.lastPointLng as number };
      const label = { text: trip.vehicleNumber.slice(-4), fontSize: '10px', fontWeight: '700', color: '#ffffff' };
      let marker = markers.get(trip.id);
      if (!marker) {
        marker = new google.maps.Marker({
          map,
          position,
          title: `${trip.vehicleNumber} · ${trip.driverName}`,
          label,
          icon: { path: google.maps.SymbolPath.CIRCLE, scale: 14, fillColor: trip.status === 'paused' ? '#F59E0B' : '#0EA5E9', fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 2 },
        });
        marker.addListener('click', () => {
          const current = markersRef.current.get(trip.id);
          if (!current || !infoRef.current) return;
          infoRef.current.setContent(current.__fleetInfo ?? '');
          infoRef.current.open({ map, anchor: current });
        });
        markers.set(trip.id, marker);
      } else {
        marker.setPosition(position);
        marker.setLabel(label);
        marker.setIcon({ path: google.maps.SymbolPath.CIRCLE, scale: 14, fillColor: trip.status === 'paused' ? '#F59E0B' : '#0EA5E9', fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 2 });
      }
      marker.__fleetInfo = infoHtml(trip);
    }
    for (const [id, marker] of markers) {
      if (!seen.has(id)) {
        marker.setMap(null);
        markers.delete(id);
      }
    }
    // Fit only when the set of vehicles changed, so a user's zoom survives position updates.
    const signature = placed.map((trip) => trip.id).sort().join(',');
    if (signature !== fittedFor.current) {
      fittedFor.current = signature;
      if (placed.length === 1) {
        map.setCenter({ lat: placed[0].lastPointLat, lng: placed[0].lastPointLng });
        map.setZoom(14);
      } else if (placed.length > 1) {
        const bounds = new google.maps.LatLngBounds();
        placed.forEach((trip) => bounds.extend({ lat: trip.lastPointLat as number, lng: trip.lastPointLng as number }));
        map.fitBounds(bounds, 48);
      }
    }
  }, [placed, status]);

  if (status === 'failed') {
    return (
      <div className="rounded-xl border border-slate-200 bg-white">
        <p className="border-b border-slate-100 px-3 py-2 text-xs text-muted-foreground">The map could not load. Last known positions:</p>
        {trips.length ? (
          <ul className="divide-y divide-slate-100">
            {trips.map((trip) => (
              <li key={trip.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="font-medium text-slate-800">{trip.vehicleNumber}</span>
                  <span className="text-muted-foreground"> · {trip.driverName}</span>
                  <span className="block text-xs text-muted-foreground">
                    {formatKm(trip.gpsDistanceKm)} so far{trip.lastPointAt ? ` · last fix ${istTimeLabel(trip.lastPointAt)}` : ' · no fix yet'}
                  </span>
                </span>
                {located(trip) && (
                  <a href={`https://www.google.com/maps?q=${trip.lastPointLat},${trip.lastPointLng}`} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary">
                    <MapPin className="h-3.5 w-3.5" aria-hidden />
                    Open map
                  </a>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">No trips running.</p>
        )}
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200">
      <div ref={nodeRef} className={cn('keep-light w-full bg-slate-100', heightClassName)} aria-label="Running trips on the map" />
      {status === 'loading' && <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">Loading map…</div>}
      {status === 'ready' && !placed.length && (
        <div className="pointer-events-none absolute inset-x-0 top-3 mx-auto w-fit rounded-full bg-white/90 px-3 py-1 text-xs text-slate-600 shadow-sm">
          {trips.length ? 'No position received yet from the running trips.' : 'No trips running.'}
        </div>
      )}
    </div>
  );
}

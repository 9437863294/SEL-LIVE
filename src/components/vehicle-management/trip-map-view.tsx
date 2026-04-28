'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { loadGoogleMapsApi } from '@/components/vehicle-management/google-maps-loader';
import type { TripLocationPoint } from '@/lib/vehicle-management';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type TripMapViewProps = {
  points: TripLocationPoint[];
  title?: string;
  heightClassName?: string;
  fallbackCenter?: { lat: number; lng: number };
};

const defaultCenter = { lat: 22.9734, lng: 78.6569 };

export default function TripMapView({
  points,
  title = 'Trip Route',
  heightClassName = 'h-[340px]',
  fallbackCenter = defaultCenter,
}: TripMapViewProps) {
  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const pathRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const [mapError, setMapError] = useState<string>('');

  const center = useMemo(() => {
    if (points.length > 0) {
      const last = points[points.length - 1];
      return { lat: last.lat, lng: last.lng };
    }
    return fallbackCenter;
  }, [fallbackCenter, points]);

  useEffect(() => {
    const mount = async () => {
      try {
        await loadGoogleMapsApi();
      } catch (error: any) {
        setMapError(error?.message || 'Failed to load map.');
        return;
      }

      if (!mapNodeRef.current || !window.google?.maps) return;

      if (!mapRef.current) {
        mapRef.current = new window.google.maps.Map(mapNodeRef.current, {
          center,
          zoom: 12,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        });
      } else {
        mapRef.current.setCenter(center);
      }

      if (pathRef.current) {
        pathRef.current.setMap(null);
      }
      markersRef.current.forEach((marker) => marker.setMap(null));
      markersRef.current = [];

      if (points.length === 0) return;

      pathRef.current = new window.google.maps.Polyline({
        map: mapRef.current,
        path: points.map((point) => ({ lat: point.lat, lng: point.lng })),
        geodesic: true,
        strokeColor: '#0EA5E9',
        strokeOpacity: 0.95,
        strokeWeight: 4,
      });

      const startMarker = new window.google.maps.Marker({
        map: mapRef.current,
        position: { lat: points[0].lat, lng: points[0].lng },
        title: 'Trip Start',
        label: 'S',
      });

      const endPoint = points[points.length - 1];
      const endMarker = new window.google.maps.Marker({
        map: mapRef.current,
        position: { lat: endPoint.lat, lng: endPoint.lng },
        title: 'Latest Position',
        label: 'L',
      });

      markersRef.current = [startMarker, endMarker];

      const bounds = new window.google.maps.LatLngBounds();
      points.forEach((point) => bounds.extend({ lat: point.lat, lng: point.lng }));
      mapRef.current.fitBounds(bounds);
      if (points.length === 1) {
        mapRef.current.setZoom(15);
      }
    };

    mount();
  }, [center, points]);

  return (
    <Card className="vm-panel overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {mapError ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {mapError}
          </div>
        ) : (
          <div ref={mapNodeRef} className={`w-full rounded-xl border border-white/70 bg-slate-100 ${heightClassName}`} />
        )}
      </CardContent>
    </Card>
  );
}

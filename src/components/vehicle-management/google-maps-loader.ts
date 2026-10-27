'use client';

declare global {
  interface Window {
    google?: any;
    __vehicleGoogleMapsPromise?: Promise<void>;
    __vehicleGoogleMapsReady?: () => void;
  }
}

/** How long a script that is already on the page gets to finish loading. */
const EXISTING_SCRIPT_WAIT_MS = 30_000;

/**
 * Loads the Maps JavaScript API once for the whole app.
 *
 * `loading=async` with a `callback` — Google's recommended direct load (without it the console
 * warns on every map). With `loading=async` the script's own `load` event can fire before
 * `google.maps.Map` exists, so readiness is Google's callback, not `onload`; at that point Map,
 * Marker, InfoWindow, Polyline, Circle, LatLngBounds and SymbolPath are all defined (checked
 * against the live API, 2026-10-27).
 */
export const loadGoogleMapsApi = async () => {
  if (typeof window === 'undefined') return;
  if (window.google?.maps?.Map) return;

  if (!window.__vehicleGoogleMapsPromise) {
    window.__vehicleGoogleMapsPromise = new Promise<void>((resolve, reject) => {
      const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
      if (!apiKey) {
        reject(new Error('Missing NEXT_PUBLIC_GOOGLE_MAPS_API_KEY'));
        return;
      }

      const existingScript = document.querySelector<HTMLScriptElement>(
        'script[data-vehicle-google-maps="true"]'
      );

      if (existingScript) {
        // On the page from before this promise existed: wait for the API itself, since its `load`
        // event may already have fired, or fire before the API is ready.
        const startedAt = Date.now();
        const timer = window.setInterval(() => {
          if (window.google?.maps?.Map) {
            window.clearInterval(timer);
            resolve();
          } else if (Date.now() - startedAt > EXISTING_SCRIPT_WAIT_MS) {
            window.clearInterval(timer);
            reject(new Error('Google Maps script failed to load'));
          }
        }, 100);
        return;
      }

      window.__vehicleGoogleMapsReady = () => resolve();
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&loading=async&callback=__vehicleGoogleMapsReady`;
      script.async = true;
      script.dataset.vehicleGoogleMaps = 'true';
      script.onerror = () => reject(new Error('Google Maps script failed to load'));
      document.head.appendChild(script);
    });
  }

  await window.__vehicleGoogleMapsPromise;
};

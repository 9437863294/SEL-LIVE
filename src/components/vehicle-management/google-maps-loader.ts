'use client';

declare global {
  interface Window {
    google?: any;
    __vehicleGoogleMapsPromise?: Promise<void>;
  }
}

export const loadGoogleMapsApi = async () => {
  if (typeof window === 'undefined') return;
  if (window.google?.maps) return;

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
        existingScript.addEventListener('load', () => resolve());
        existingScript.addEventListener('error', () =>
          reject(new Error('Google Maps script failed to load'))
        );
        return;
      }

      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}`;
      script.async = true;
      script.defer = true;
      script.dataset.vehicleGoogleMaps = 'true';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Google Maps script failed to load'));
      document.head.appendChild(script);
    });
  }

  await window.__vehicleGoogleMapsPromise;
};

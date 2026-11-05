/**
 * Where the GPS recorder (gps-trip-recorder.tsx) keeps an own-vehicle trip while it is driven, and a
 * read-only look at it for the Overview's hero.
 *
 * Its own module so the Overview can ask "is a trip running?" without bundling the recorder, its
 * map and its native plugins. The recorder owns the record — writing it, and stopping the trip.
 */

export const OWN_TRIP_STORAGE_KEY = 'driver-management.gps-trip.v1';

export interface OwnTripInFlight {
  startedAtIso: string;
  vehicleType: string;
  vehicleNumber: string;
  fromPlace: string;
  purpose: string;
}

/** The own-vehicle trip this phone is recording, or null (none, no storage, or an unreadable record). */
export function ownTripInFlight(): OwnTripInFlight | null {
  try {
    const saved = window.localStorage.getItem(OWN_TRIP_STORAGE_KEY);
    if (!saved) return null;
    const record = JSON.parse(saved) as {
      startedAtIso?: unknown;
      fromPlace?: unknown;
      details?: { vehicleType?: unknown; vehicleNumber?: unknown; purpose?: unknown };
    };
    if (typeof record.startedAtIso !== 'string' || !record.details) return null;
    return {
      startedAtIso: record.startedAtIso,
      vehicleType: String(record.details.vehicleType ?? ''),
      vehicleNumber: String(record.details.vehicleNumber ?? ''),
      fromPlace: String(record.fromPlace ?? ''),
      purpose: String(record.details.purpose ?? ''),
    };
  } catch {
    return null;
  }
}

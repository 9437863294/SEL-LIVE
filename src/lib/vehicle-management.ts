export const VEHICLE_COLLECTIONS = {
  vehicleMaster: 'vehicleManagementVehicles',
  insurance: 'vehicleManagementInsurance',
  puc: 'vehicleManagementPuc',
  fitness: 'vehicleManagementFitness',
  roadTax: 'vehicleManagementRoadTax',
  permit: 'vehicleManagementPermit',
  maintenance: 'vehicleManagementMaintenanceLogs',
  fuel: 'vehicleManagementFuelLogs',
  trips: 'vehicleManagementTrips',
  employeeTrips: 'vehicleManagementEmployeeTrips',
  tripLocations: 'vehicleManagementTripLocations',
  settings: 'vehicleManagementSettings',
  driverDailyStatus: 'vehicleManagementDriverDailyStatus',
  driver: 'vehicleManagementDriver',
  driverAssignments: 'vehicleManagementDriverAssignments',
  documents: 'vehicleManagementDocuments',
  insuranceWorkflowCases: 'vehicleManagementInsuranceWorkflowCases',
  insuranceWorkflowActivities: 'vehicleManagementInsuranceWorkflowActivities',
} as const;

export const VEHICLE_SETTINGS_DOC_ID = 'trackingConfig';
export const VEHICLE_TYPES_DOC_ID = 'vehicleTypes';
export const DEFAULT_VEHICLE_TYPES = ['Truck', 'Car', 'Bus', 'Van', 'Pickup', 'Tanker', 'Trailer', 'Two Wheeler', 'Other'];

export const DEFAULT_TRACKING_SETTINGS = {
  driverLocationUpdateIntervalSec: 10,
  enableSnapToRoadHint: false,
  allowBackgroundTrackingHint: true,
};

export const toVehicleCode = (seed: number) => `VEH-${String(seed).padStart(6, '0')}`;

export const normalizeVehicleRegistration = (value: unknown): string =>
  String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export const getVehicleTimestampMillis = (value: any): number => {
  if (!value) return 0;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 0 : value.getTime();
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  const millis = new Date(value).getTime();
  return Number.isNaN(millis) ? 0 : millis;
};

export const compareCreatedAtDesc = (a: Record<string, any>, b: Record<string, any>): number =>
  getVehicleTimestampMillis(b.createdAt) - getVehicleTimestampMillis(a.createdAt);

export const formatVehicleTimestamp = (value: any): string => {
  if (!value) return '-';
  const date = value instanceof Date
    ? value
    : typeof value?.toDate === 'function'
      ? value.toDate()
      : typeof value?.seconds === 'number'
        ? new Date(value.seconds * 1000)
        : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('en-IN', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

export const getVehicleDateRangeError = (
  startDate: unknown,
  endDate: unknown,
  startLabel = 'Start date',
  endLabel = 'End date'
): string | null => {
  if (!startDate || !endDate) return null;
  const start = new Date(`${String(startDate).slice(0, 10)}T00:00:00`);
  const end = new Date(`${String(endDate).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return end < start ? `${endLabel} cannot be earlier than ${startLabel.toLowerCase()}.` : null;
};

export const ALERT_STAGE_LABELS: Record<string, string> = {
  Missing: 'Missing',
  Expired: 'Expired',
  'Due Today': 'Due Today',
  '7d': '7 Days',
  '15d': '15 Days',
  '30d': '30 Days',
  'Not Due': 'Not Due',
  'Not Applicable': 'Not Applicable',
};

export const computeRenewalMeta = (expiryDate?: string) => {
  if (!expiryDate) {
    return {
      alertStage: 'Missing',
      complianceStatus: 'Missing',
    };
  }

  const today = new Date();
  const target = new Date(expiryDate);
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);

  const days = Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (days < 0) {
    return {
      alertStage: 'Expired',
      complianceStatus: 'Expired',
    };
  }

  if (days === 0) {
    return {
      alertStage: 'Due Today',
      complianceStatus: 'Due Soon',
    };
  }

  if (days <= 7) {
    return {
      alertStage: '7d',
      complianceStatus: 'Due Soon',
    };
  }

  if (days <= 15) {
    return {
      alertStage: '15d',
      complianceStatus: 'Due Soon',
    };
  }

  if (days <= 30) {
    return {
      alertStage: '30d',
      complianceStatus: 'Due Soon',
    };
  }

  return {
    alertStage: 'Not Due',
    complianceStatus: 'Valid',
  };
};

export const getAlertPriority = (alertStage?: string) => {
  switch (alertStage) {
    case 'Expired':
      return 1;
    case 'Due Today':
      return 2;
    case '7d':
      return 3;
    case '15d':
      return 4;
    case '30d':
      return 5;
    case 'Missing':
      return 6;
    default:
      return 99;
  }
};

export type VehicleComplianceRequirements = {
  insurance: boolean;
  puc: boolean;
  fitness: boolean;
  roadTax: boolean;
  permit: boolean;
};

const parseRequirementValue = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value;
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return undefined;
  if (['yes', 'y', 'true', '1', 'required', 'mandatory'].includes(normalized)) return true;
  if (['no', 'n', 'false', '0', 'not required', 'optional'].includes(normalized)) return false;
  return undefined;
};

const isTransportOrCommercialVehicle = (vehicle: Record<string, any>) => {
  const type = String(vehicle.vehicleType || '').toLowerCase();
  const category = String(vehicle.vehicleCategory || '').toLowerCase();
  const typeHits = ['truck', 'bus', 'van', 'pickup', 'tanker', 'trailer', 'carrier', 'tempo'];
  return typeHits.some((token) => type.includes(token)) || category.includes('commercial');
};

const isTwoWheeler = (vehicle: Record<string, any>) => {
  const type = String(vehicle.vehicleType || '').toLowerCase();
  const category = String(vehicle.vehicleCategory || '').toLowerCase();
  return type.includes('two') || type.includes('bike') || type.includes('scooter') || category.includes('two');
};

export const getVehicleComplianceRequirements = (
  vehicle: Record<string, any>
): VehicleComplianceRequirements => {
  const status = String(vehicle.vehicleStatus || '').toLowerCase();
  if (status === 'sold' || status === 'scrapped') {
    return {
      insurance: false,
      puc: false,
      fitness: false,
      roadTax: false,
      permit: false,
    };
  }

  const fuelType = String(vehicle.fuelType || '').toLowerCase();
  const twoWheeler = isTwoWheeler(vehicle);
  const transportOrCommercial = isTransportOrCommercialVehicle(vehicle);

  const autoDefaults: VehicleComplianceRequirements = {
    insurance: true,
    puc: !fuelType.includes('electric'),
    fitness: !twoWheeler && transportOrCommercial,
    roadTax: true,
    permit: !twoWheeler && transportOrCommercial,
  };

  const manualValues: VehicleComplianceRequirements = {
    insurance: parseRequirementValue(vehicle.requireInsurance) ?? autoDefaults.insurance,
    puc: parseRequirementValue(vehicle.requirePuc) ?? autoDefaults.puc,
    fitness: parseRequirementValue(vehicle.requireFitness) ?? autoDefaults.fitness,
    roadTax: parseRequirementValue(vehicle.requireRoadTax) ?? autoDefaults.roadTax,
    permit: parseRequirementValue(vehicle.requirePermit) ?? autoDefaults.permit,
  };

  const mode = String(vehicle.complianceRuleMode || '').trim().toLowerCase();
  if (mode === 'manual') {
    return manualValues;
  }
  if (mode === 'auto') {
    return autoDefaults;
  }

  // Backward compatibility for older records: if any manual flag exists, honor it.
  const hasAnyManualFlag =
    parseRequirementValue(vehicle.requireInsurance) !== undefined ||
    parseRequirementValue(vehicle.requirePuc) !== undefined ||
    parseRequirementValue(vehicle.requireFitness) !== undefined ||
    parseRequirementValue(vehicle.requireRoadTax) !== undefined ||
    parseRequirementValue(vehicle.requirePermit) !== undefined;

  return hasAnyManualFlag ? manualValues : autoDefaults;
};

export type DriverTripStatus = 'In Progress' | 'Completed' | 'Cancelled';

export type TripLocationPoint = {
  lat: number;
  lng: number;
  accuracyMeters?: number;
  speedKmph?: number;
  headingDeg?: number;
  recordedAtIso?: string;
};

export const toKmph = (speedMetersPerSec?: number | null) => {
  if (!speedMetersPerSec || !Number.isFinite(speedMetersPerSec)) return 0;
  return Number((speedMetersPerSec * 3.6).toFixed(2));
};

const toRadians = (value: number) => (value * Math.PI) / 180;

export const haversineDistanceKm = (
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
) => {
  const earthRadiusKm = 6371;
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(from.lat)) *
      Math.cos(toRadians(to.lat)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((earthRadiusKm * c).toFixed(4));
};

type TripDistancePoint = {
  lat: number;
  lng: number;
  accuracyMeters?: number;
  recordedAtIso?: string;
};

type TripDistanceOptions = {
  minMovementMeters?: number;
  maxAcceptedAccuracyMeters?: number;
  maxPlausibleSpeedKmph?: number;
  speedOutlierBufferKm?: number;
};

const toEpochMs = (iso?: string) => {
  const parsed = Date.parse(String(iso || ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

const isValidCoordinate = (lat: number, lng: number) =>
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  Math.abs(lat) <= 90 &&
  Math.abs(lng) <= 180;

export const computeTripDistanceDeltaKm = (
  previous: TripDistancePoint,
  current: TripDistancePoint,
  options: TripDistanceOptions = {}
) => {
  const minMovementMeters = Math.max(0, Number(options.minMovementMeters ?? 15));
  const maxAcceptedAccuracyMeters = Math.max(1, Number(options.maxAcceptedAccuracyMeters ?? 120));
  const maxPlausibleSpeedKmph = Math.max(1, Number(options.maxPlausibleSpeedKmph ?? 180));
  const speedOutlierBufferKm = Math.max(0, Number(options.speedOutlierBufferKm ?? 0.1));

  if (!isValidCoordinate(previous.lat, previous.lng)) return 0;
  if (!isValidCoordinate(current.lat, current.lng)) return 0;

  const previousAccuracy = Math.max(0, Number(previous.accuracyMeters || 0));
  const currentAccuracy = Math.max(0, Number(current.accuracyMeters || 0));
  if (previousAccuracy > maxAcceptedAccuracyMeters || currentAccuracy > maxAcceptedAccuracyMeters) {
    return 0;
  }

  const rawDeltaKm = haversineDistanceKm(previous, current);
  if (!Number.isFinite(rawDeltaKm) || rawDeltaKm <= 0) return 0;

  // Ignore movement that is within GPS jitter/uncertainty radius.
  const jitterThresholdKm = Math.max(
    minMovementMeters / 1000,
    (previousAccuracy + currentAccuracy) / 2000
  );
  if (rawDeltaKm < jitterThresholdKm) return 0;

  // Reject impossible jumps using elapsed time and a realistic max speed.
  const previousMs = toEpochMs(previous.recordedAtIso);
  const currentMs = toEpochMs(current.recordedAtIso);
  if (previousMs > 0 && currentMs > previousMs) {
    const elapsedHours = (currentMs - previousMs) / (1000 * 60 * 60);
    const maxAllowedKm = elapsedHours * maxPlausibleSpeedKmph + speedOutlierBufferKm;
    if (rawDeltaKm > maxAllowedKm) return 0;
  }

  return Number(rawDeltaKm.toFixed(4));
};

export const computeTripDistanceKmFromPoints = (
  points: TripDistancePoint[],
  options: TripDistanceOptions = {}
) => {
  if (!Array.isArray(points) || points.length < 2) return 0;
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += computeTripDistanceDeltaKm(points[index - 1], points[index], options);
  }
  return Number(total.toFixed(4));
};
/* ------------------------------------------------------------------------------------------------
 * Reading a trip's path
 * ---------------------------------------------------------------------------------------------- */

/**
 * Turning raw GPS points into something worth showing.
 *
 * ── Why the map and the odometer disagreed ──────────────────────────────────────────────────────
 *
 * `computeTripDistanceDeltaKm` above already rejects the three ways a GPS fix lies: a poor accuracy
 * reading, movement inside the jitter radius, and a jump no vehicle could have made. The map drew
 * the *raw* points, so it rendered every one of those as a real zigzag — a path visibly unlike the
 * distance the same trip reported, and unlike the clean line a delivery app shows for the same
 * drive. These functions apply the same rules the distance already trusts, so the two agree.
 *
 * ── Why stops are worth detecting ───────────────────────────────────────────────────────────────
 *
 * A fleet's question about a trip is rarely "what route" — it is "where did two hours go". That is
 * invisible in a polyline: a vehicle parked for ninety minutes draws a dot indistinguishable from a
 * vehicle passing through. Stops have to be derived from the timestamps, and once they are, the
 * split between moving and idle time follows.
 *
 * All of it is pure, so it can be tested against fixtures rather than against a drive.
 */

/** A point kept or dropped, with the reason — the reason is what makes a sparse path explainable. */
export type TripPointRejection = 'accuracy' | 'jitter' | 'implausible-jump' | 'invalid';

export interface CleanedTripPath {
  /** The points worth drawing, in order. Always includes the first valid fix. */
  points: TripLocationPoint[];
  /** How many raw points were dropped, by reason. */
  dropped: Record<TripPointRejection, number>;
  rawCount: number;
}

/**
 * Drop the fixes the distance calculation already ignores.
 *
 * Deliberately the same thresholds and the same order of checks as `computeTripDistanceDeltaKm`,
 * because the whole point is that the drawn path and the reported distance describe one journey. A
 * dropped point is compared against the last *kept* one, not the last raw one: comparing against a
 * rejected fix would let one bad reading drag the next good one out with it.
 */
export const cleanTripPath = (
  points: TripLocationPoint[],
  options: TripDistanceOptions = {}
): CleanedTripPath => {
  const dropped: Record<TripPointRejection, number> = {
    accuracy: 0,
    jitter: 0,
    'implausible-jump': 0,
    invalid: 0,
  };
  const kept: TripLocationPoint[] = [];
  if (!Array.isArray(points) || points.length === 0) {
    return { points: kept, dropped, rawCount: 0 };
  }

  const maxAcceptedAccuracyMeters = Math.max(1, Number(options.maxAcceptedAccuracyMeters ?? 120));
  const minMovementMeters = Math.max(0, Number(options.minMovementMeters ?? 15));
  const maxPlausibleSpeedKmph = Math.max(1, Number(options.maxPlausibleSpeedKmph ?? 180));
  const speedOutlierBufferKm = Math.max(0, Number(options.speedOutlierBufferKm ?? 0.1));

  for (const point of points) {
    if (!isValidCoordinate(point.lat, point.lng)) {
      dropped.invalid += 1;
      continue;
    }
    if (Math.max(0, Number(point.accuracyMeters || 0)) > maxAcceptedAccuracyMeters) {
      dropped.accuracy += 1;
      continue;
    }

    const previous = kept[kept.length - 1];
    if (!previous) {
      kept.push(point);
      continue;
    }

    const deltaKm = haversineDistanceKm(previous, point);
    const jitterThresholdKm = Math.max(
      minMovementMeters / 1000,
      (Math.max(0, Number(previous.accuracyMeters || 0)) +
        Math.max(0, Number(point.accuracyMeters || 0))) /
        2000
    );
    if (deltaKm < jitterThresholdKm) {
      dropped.jitter += 1;
      continue;
    }

    const previousMs = toEpochMs(previous.recordedAtIso);
    const currentMs = toEpochMs(point.recordedAtIso);
    if (previousMs > 0 && currentMs > previousMs) {
      const elapsedHours = (currentMs - previousMs) / (1000 * 60 * 60);
      if (deltaKm > elapsedHours * maxPlausibleSpeedKmph + speedOutlierBufferKm) {
        dropped['implausible-jump'] += 1;
        continue;
      }
    }

    kept.push(point);
  }

  return { points: kept, dropped, rawCount: points.length };
};

export interface TripStop {
  lat: number;
  lng: number;
  startedAtIso: string;
  endedAtIso: string;
  minutes: number;
  /** How many fixes were recorded while stationary — a long stop with one fix is less certain. */
  samples: number;
}

export interface TripStopOptions {
  /** Stationary means every fix stayed within this radius of where the stop began. */
  radiusMeters?: number;
  /** Shorter pauses are traffic, not stops. */
  minMinutes?: number;
}

/**
 * Where the vehicle stayed put, and for how long.
 *
 * Anchored on the point where the stop began rather than on a rolling centre: a rolling centre lets
 * a vehicle creep — each fix within the radius of the last — and report a "stop" that drifted down
 * the road. Anchoring means a stop is genuinely a place.
 *
 * Needs timestamps; a point without one cannot be part of a measured duration and ends any stop in
 * progress rather than silently extending it.
 */
export const detectTripStops = (
  points: TripLocationPoint[],
  options: TripStopOptions = {}
): TripStop[] => {
  const radiusKm = Math.max(1, Number(options.radiusMeters ?? 60)) / 1000;
  const minMinutes = Math.max(0, Number(options.minMinutes ?? 3));
  const stops: TripStop[] = [];
  if (!Array.isArray(points) || points.length < 2) return stops;

  let anchor: TripLocationPoint | null = null;
  let anchorMs = 0;
  let lastMs = 0;
  let samples = 0;

  /**
   * End the candidate stop, recording it if it lasted long enough.
   *
   * The reset runs whatever the outcome. Returning early when a candidate was too short left
   * `anchor` in place, so the next qualifying fix continued a stop that had already been ended —
   * an untimed reading in the middle of a trip silently merged the pauses either side of it into
   * one long one.
   */
  const close = () => {
    if (anchor && anchorMs > 0 && lastMs > anchorMs) {
      const minutes = (lastMs - anchorMs) / 60000;
      if (minutes >= minMinutes) {
        stops.push({
          lat: anchor.lat,
          lng: anchor.lng,
          startedAtIso: new Date(anchorMs).toISOString(),
          endedAtIso: new Date(lastMs).toISOString(),
          minutes: Number(minutes.toFixed(1)),
          samples,
        });
      }
    }
    anchor = null;
    anchorMs = 0;
    lastMs = 0;
    samples = 0;
  };

  for (const point of points) {
    const ms = toEpochMs(point.recordedAtIso);
    if (!isValidCoordinate(point.lat, point.lng) || ms <= 0) {
      close();
      continue;
    }

    if (!anchor) {
      anchor = point;
      anchorMs = ms;
      lastMs = ms;
      samples = 1;
      continue;
    }

    if (haversineDistanceKm(anchor, point) <= radiusKm) {
      lastMs = ms;
      samples += 1;
      continue;
    }

    // Moved away: close whatever was running and start a fresh candidate here.
    close();
    anchor = point;
    anchorMs = ms;
    lastMs = ms;
    samples = 1;
  }

  close();
  return stops;
};

export interface TripSummary {
  distanceKm: number;
  /** Wall-clock minutes from the first fix to the last. */
  elapsedMinutes: number;
  idleMinutes: number;
  movingMinutes: number;
  /** Over moving time only — including idle time is how a delivery van averages 8 km/h. */
  averageMovingKmph: number;
  topKmph: number;
  stops: TripStop[];
}

/**
 * The figures a trip is actually judged on.
 *
 * `averageMovingKmph` excludes idle time deliberately. An average over elapsed time answers "how
 * long did this take", which the elapsed figure already says; the useful question is how the
 * vehicle moved when it was moving.
 *
 * `topKmph` prefers the speed the device reported and falls back to speed derived between fixes,
 * because a device that reports no speed is common and a trip with a blank top speed is useless.
 */
export const summariseTrip = (
  points: TripLocationPoint[],
  options: TripDistanceOptions & TripStopOptions = {}
): TripSummary => {
  const stops = detectTripStops(points, options);
  const idleMinutes = stops.reduce((total, stop) => total + stop.minutes, 0);

  const timed = points.filter((point) => toEpochMs(point.recordedAtIso) > 0);
  const firstMs = timed.length ? toEpochMs(timed[0].recordedAtIso) : 0;
  const lastMs = timed.length ? toEpochMs(timed[timed.length - 1].recordedAtIso) : 0;
  const elapsedMinutes = lastMs > firstMs ? (lastMs - firstMs) / 60000 : 0;
  const movingMinutes = Math.max(0, elapsedMinutes - idleMinutes);

  const distanceKm = computeTripDistanceKmFromPoints(points, options);

  let topKmph = 0;
  for (const point of points) {
    const reported = Number(point.speedKmph || 0);
    if (Number.isFinite(reported)) topKmph = Math.max(topKmph, reported);
  }
  if (topKmph === 0) {
    for (let index = 1; index < points.length; index += 1) {
      const previousMs = toEpochMs(points[index - 1].recordedAtIso);
      const currentMs = toEpochMs(points[index].recordedAtIso);
      if (previousMs <= 0 || currentMs <= previousMs) continue;
      const deltaKm = computeTripDistanceDeltaKm(points[index - 1], points[index], options);
      const hours = (currentMs - previousMs) / 3600000;
      if (hours > 0) topKmph = Math.max(topKmph, deltaKm / hours);
    }
  }

  return {
    distanceKm,
    elapsedMinutes: Number(elapsedMinutes.toFixed(1)),
    idleMinutes: Number(idleMinutes.toFixed(1)),
    movingMinutes: Number(movingMinutes.toFixed(1)),
    averageMovingKmph:
      movingMinutes > 0 ? Number((distanceKm / (movingMinutes / 60)).toFixed(1)) : 0,
    topKmph: Number(topKmph.toFixed(1)),
    stops,
  };
};

/** Speed bands, for colouring a path the way a traffic layer does. */
export type TripSpeedBand = 'stopped' | 'slow' | 'normal' | 'fast';

export interface TripSpeedSegment {
  from: TripLocationPoint;
  to: TripLocationPoint;
  kmph: number;
  band: TripSpeedBand;
}

export const tripSpeedBand = (kmph: number): TripSpeedBand => {
  if (!Number.isFinite(kmph) || kmph < 2) return 'stopped';
  if (kmph < 20) return 'slow';
  if (kmph < 60) return 'normal';
  return 'fast';
};

/**
 * The path split into segments with a speed, so it can be drawn in bands.
 *
 * Speed is derived from the two fixes rather than read from the device: the device figure is
 * instantaneous and often missing, while the question a coloured path answers — how fast was this
 * stretch covered — is about the stretch.
 */
export const tripSpeedSegments = (
  points: TripLocationPoint[],
  options: TripDistanceOptions = {}
): TripSpeedSegment[] => {
  const segments: TripSpeedSegment[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const previousMs = toEpochMs(from.recordedAtIso);
    const currentMs = toEpochMs(to.recordedAtIso);
    const deltaKm = computeTripDistanceDeltaKm(from, to, options);
    const hours = currentMs > previousMs && previousMs > 0 ? (currentMs - previousMs) / 3600000 : 0;
    const kmph = hours > 0 ? deltaKm / hours : 0;
    segments.push({ from, to, kmph: Number(kmph.toFixed(1)), band: tripSpeedBand(kmph) });
  }
  return segments;
};

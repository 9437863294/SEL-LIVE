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
  documents: 'vehicleManagementDocuments',
} as const;

export const VEHICLE_SETTINGS_DOC_ID = 'trackingConfig';

export const DEFAULT_TRACKING_SETTINGS = {
  driverLocationUpdateIntervalSec: 10,
  enableSnapToRoadHint: false,
  allowBackgroundTrackingHint: true,
};

export const toVehicleCode = (seed: number) => `VEH-${String(seed).padStart(6, '0')}`;

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

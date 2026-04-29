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

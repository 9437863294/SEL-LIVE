/**
 * Fleet settings and the fleet view of a Vehicle Master record: defaults, and reading stored
 * documents defensively (a field left blank on a vehicle takes the category default).
 */

import {
  FLEET_CATEGORIES,
  type CostBasis,
  type FleetCategory,
  type FleetSettings,
  type FleetVehicle,
  type OdometerBaseline,
} from './types.ts';

export const DEFAULT_FLEET_SETTINGS: FleetSettings = {
  dailyKmLimitByCategory: { bike: 80, car: 120, pickup: 120 },
  monthlyKmLimit: 2500,
  serviceIntervalKm: 5000,
  mileageTolerancePct: 10,
  mismatchAbsKm: 3,
  mismatchPct: 5,
  unloggedKmTolerance: 5,
  approvalEscalateMinutes: 30,
  approvalExpiryMinutes: 120,
  escalationUserIds: [],
  emergencyMonthlyMax: 2,
  gpsGapMinutes: 15,
  idleRemindMinutes: 45,
  idleAutoCloseMinutes: 180,
  maxTripHours: 12,
  fuelRateVariancePct: 8,
  ocrEnabled: false,
  anyEmployeeMayDrive: true,
  employeeProjectsOnly: false,
  companyTripsInFleet: true,
  reportEmails: [],
  digestUserIds: [],
};

const num = (value: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  const parsed = typeof value === 'string' && value.trim() === '' ? Number.NaN : Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
};
const optionalNum = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
};
const ids = (value: unknown) => (Array.isArray(value) ? [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))] : []);
const emails = (value: unknown) => ids(value).filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item));
const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

export function normaliseFleetSettings(stored: Partial<FleetSettings> | null | undefined): FleetSettings {
  const base = DEFAULT_FLEET_SETTINGS;
  const s = stored ?? {};
  const byCategory = (s.dailyKmLimitByCategory ?? {}) as Partial<Record<FleetCategory, unknown>>;
  return {
    dailyKmLimitByCategory: {
      bike: num(byCategory.bike, base.dailyKmLimitByCategory.bike, 1, 2000),
      car: num(byCategory.car, base.dailyKmLimitByCategory.car, 1, 2000),
      pickup: num(byCategory.pickup, base.dailyKmLimitByCategory.pickup, 1, 2000),
    },
    monthlyKmLimit: num(s.monthlyKmLimit, base.monthlyKmLimit, 1, 50000),
    serviceIntervalKm: num(s.serviceIntervalKm, base.serviceIntervalKm, 100, 100000),
    mileageTolerancePct: num(s.mileageTolerancePct, base.mileageTolerancePct, 0, 100),
    mismatchAbsKm: num(s.mismatchAbsKm, base.mismatchAbsKm, 0, 500),
    mismatchPct: num(s.mismatchPct, base.mismatchPct, 0, 100),
    unloggedKmTolerance: num(s.unloggedKmTolerance, base.unloggedKmTolerance, 0, 1000),
    approvalEscalateMinutes: num(s.approvalEscalateMinutes, base.approvalEscalateMinutes, 5, 24 * 60),
    approvalExpiryMinutes: num(s.approvalExpiryMinutes, base.approvalExpiryMinutes, 10, 24 * 60),
    escalationUserIds: ids(s.escalationUserIds),
    emergencyMonthlyMax: num(s.emergencyMonthlyMax, base.emergencyMonthlyMax, 0, 100),
    gpsGapMinutes: num(s.gpsGapMinutes, base.gpsGapMinutes, 1, 24 * 60),
    idleRemindMinutes: num(s.idleRemindMinutes, base.idleRemindMinutes, 5, 24 * 60),
    idleAutoCloseMinutes: num(s.idleAutoCloseMinutes, base.idleAutoCloseMinutes, 15, 7 * 24 * 60),
    maxTripHours: num(s.maxTripHours, base.maxTripHours, 1, 72),
    fuelRateVariancePct: num(s.fuelRateVariancePct, base.fuelRateVariancePct, 0, 100),
    ocrEnabled: bool(s.ocrEnabled, base.ocrEnabled),
    anyEmployeeMayDrive: bool(s.anyEmployeeMayDrive, base.anyEmployeeMayDrive),
    employeeProjectsOnly: bool(s.employeeProjectsOnly, base.employeeProjectsOnly),
    companyTripsInFleet: bool(s.companyTripsInFleet, base.companyTripsInFleet),
    reportEmails: emails(s.reportEmails),
    digestUserIds: ids(s.digestUserIds),
    updatedAt: s.updatedAt,
    updatedById: s.updatedById,
    updatedByName: s.updatedByName,
  };
}

/** Vehicles that have left the fleet (as Vehicle Master and the trip claims read it). */
export const RETIRED_VEHICLE_STATUS = /sold|scrap|dispos|inactive|retired|written/i;

/** Vehicle Master's free-text type, read as a fleet category. */
export function categoryFromType(vehicleType: string): FleetCategory {
  const type = vehicleType.toLowerCase();
  if (/two|bike|scooter|motor ?cycle|scooty|2w/.test(type)) return 'bike';
  if (/pick|truck|tanker|trailer|goods|tempo|lorry|van|bus/.test(type)) return 'pickup';
  return 'car';
}

const COST_BASES: CostBasis[] = ['per_km', 'fixed_plus_fuel'];

function baselines(value: unknown): OdometerBaseline[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
    .map((entry) => ({
      km: num(entry.km, 0),
      at: text(entry.at),
      byId: text(entry.byId),
      byName: text(entry.byName),
      reason: text(entry.reason),
      photoPath: text(entry.photoPath) || null,
      previousKm: optionalNum(entry.previousKm),
    }));
}

/** A Vehicle Master document as the fleet reads it. */
export function normaliseVehicle(id: string, data: Record<string, unknown>, settings: FleetSettings): FleetVehicle {
  const vehicleType = text(data.vehicleType) || 'Other';
  const stored = text(data.fleetCategory) as FleetCategory;
  const categorySet = FLEET_CATEGORIES.includes(stored);
  const category = categorySet ? stored : categoryFromType(vehicleType);
  const status = text(data.vehicleStatus) || text(data.currentStatus);
  const costBasis = COST_BASES.includes(data.costBasis as CostBasis) ? (data.costBasis as CostBasis) : 'per_km';
  const odometer = optionalNum(data.currentOdometerKm);
  return {
    id,
    vehicleNumber: text(data.vehicleNumber) || text(data.registrationNo) || id,
    vehicleType,
    fuelType: text(data.fuelType),
    active: !RETIRED_VEHICLE_STATUS.test(status),
    category,
    categorySet,
    tankCapacityL: optionalNum(data.tankCapacityL, 0.5, 2000),
    stdMileageKmpl: optionalNum(data.stdMileageKmpl, 0.5, 200),
    mileageTolerancePct: num(data.mileageTolerancePct, settings.mileageTolerancePct, 0, 100),
    dailyKmLimit: num(data.dailyKmLimit, settings.dailyKmLimitByCategory[category], 1, 5000),
    monthlyKmLimit: num(data.monthlyKmLimit, settings.monthlyKmLimit, 1, 100000),
    costBasis,
    ratePerKm: num(data.ratePerKm, 0, 0, 1000),
    fixedMonthlyCost: num(data.fixedMonthlyCost, 0, 0, 10_000_000),
    homeGeofenceId: text(data.homeGeofenceId) || null,
    approverUid: text(data.approverUid) || null,
    backupApproverUid: text(data.backupApproverUid) || null,
    serviceIntervalKm: num(data.serviceIntervalKm, settings.serviceIntervalKm, 100, 100000),
    lastServiceKm: optionalNum(data.lastServiceKm),
    lastServiceDate: text(data.lastServiceDate) || null,
    siteInternalExemptFromLimit: data.siteInternalExemptFromLimit === true,
    currentTripId: text(data.currentTripId) || null,
    currentOdometerKm: odometer !== null && odometer > 0 ? odometer : null,
    odometerBaselineHistory: baselines(data.odometerBaselineHistory),
    assignedDriverId: text(data.assignedDriverId) || null,
    assignedDriverName: text(data.assignedDriverName),
  };
}

/** Km left before the next service; negative once overdue. Null without a last-service reading. */
export function serviceDueInKm(vehicle: Pick<FleetVehicle, 'currentOdometerKm' | 'lastServiceKm' | 'serviceIntervalKm'>): number | null {
  if (vehicle.currentOdometerKm === null || vehicle.lastServiceKm === null) return null;
  return vehicle.lastServiceKm + vehicle.serviceIntervalKm - vehicle.currentOdometerKm;
}

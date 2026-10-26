/**
 * Request payload schemas for /api/fleet. Shapes only: what a value means — the odometer never
 * going backwards, the daily limit, who may decide — is checked by the rules in this folder, inside
 * the server's transactions. Derived figures (distances, billable km, cost, flags, mileage) are
 * absent on purpose: the server computes them.
 */

import { z } from 'zod';

import { FLEET_CATEGORIES, GEOFENCE_KINDS, GEOFENCE_RADIUS_MAX_M, GEOFENCE_RADIUS_MIN_M } from './types.ts';

const id = z.string().trim().min(1).max(128);
const optionalId = z.string().trim().max(128).nullish().transform((value) => value || null);
const clientId = z.string().trim().min(8).max(80).regex(/^[A-Za-z0-9_-]+$/, 'Use letters, digits, - and _.');
const iso = z.string().min(10).max(40).refine((value) => Number.isFinite(Date.parse(value)), 'Not a valid time.');
const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);
const km = z.coerce.number().min(0).max(9_999_999);
const note = (max = 500) => z.string().max(max).optional().transform((value) => value?.trim() ?? '');
const optionalNumber = (min: number, max: number) =>
  z.union([z.number(), z.string(), z.null()]).optional().transform((value, context) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `Enter a number from ${min} to ${max}.` });
      return z.NEVER;
    }
    return parsed;
  });

const odometerSchema = z.object({
  km,
  uploadId: optionalId,
  /** What OCR read, when the phone showed a suggestion; the server re-reads the photo anyway. */
  ocrKm: optionalNumber(0, 9_999_999),
});

const position = z.object({ lat, lng, accuracyM: z.number().min(0).max(100000).nullish().transform((value) => value ?? null) }).nullish().transform((value) => value ?? null);

export const startTripSchema = z.object({
  clientStartId: clientId,
  vehicleId: id,
  projectId: optionalId,
  purposeId: id,
  purposeReason: note(300),
  /** The starting place, reverse-geocoded on the phone and editable (as a GPS trip's From). */
  startPlace: note(200),
  expectedKm: z.coerce.number().min(0).max(2000),
  startOdometer: odometerSchema,
  position,
  /** Started past the limit without approval. */
  emergency: z.object({ reason: z.string().trim().min(5, 'Say what the emergency is.').max(300) }).nullish().transform((value) => value ?? null),
  /** Continuing straight on from the driver's previous trip on the same vehicle. */
  chainPrevTripId: optionalId,
});

export const pointsSchema = z.object({
  points: z
    .array(
      z.object({
        clientPointId: clientId,
        lat,
        lng,
        accuracyM: z.number().min(0).max(100000).nullish().transform((value) => value ?? null),
        speedKmph: z.number().min(0).max(1000).nullish().transform((value) => value ?? null),
        headingDeg: z.number().min(0).max(360).nullish().transform((value) => value ?? null),
        recordedAt: iso,
      }),
    )
    .min(1)
    .max(200, 'Send at most 200 points at a time.'),
});

export const geofenceEventsSchema = z.object({
  events: z
    .array(
      z.object({
        clientEventId: clientId,
        geofenceId: id,
        type: z.enum(['enter', 'exit']),
        at: iso,
        lat,
        lng,
      }),
    )
    .min(1)
    .max(100),
});

export const endTripSchema = z.object({
  clientEndId: clientId,
  endOdometer: odometerSchema,
  position,
  /** When the driver ended it, which may be well before the request arrives (offline). */
  endedAt: iso.optional(),
  remark: note(500),
  /** Where it ended (as a GPS trip's To). */
  endPlace: note(200),
});

export const pauseSchema = z.object({ action: z.enum(['pause', 'resume', 'cancel']), reason: note(300), at: iso.optional() });

export const reviewSchema = z.object({
  choice: z.enum(['odometer', 'gps', 'manager']),
  km: optionalNumber(0, 2000),
  note: note(500),
});

export const forceCloseSchema = z.object({
  endOdometerKm: optionalNumber(0, 9_999_999),
  reason: z.string().trim().min(5, 'Say why the trip is being closed.').max(500),
});

export const resolveExceptionSchema = z.object({
  kind: z.enum(['trip', 'fuel']),
  id,
  note: z.string().trim().min(3, 'Add a note on what was found.').max(500),
});

export const approvalRequestSchema = z.object({
  vehicleId: id,
  requestedKm: z.coerce.number().min(1, 'Say how far the trip will go.').max(2000),
  reason: z.string().trim().min(5, 'Say why the extra running is needed.').max(500),
  projectId: optionalId,
  purposeId: id,
});

export const approvalDecisionSchema = z.object({
  action: z.enum(['approve', 'approve_cap', 'approve_raise', 'reject', 'cancel']),
  capKm: optionalNumber(1, 2000),
  newLimitKm: optionalNumber(1, 2000),
  note: note(500),
});

export const fuelEntrySchema = z.object({
  clientEntryId: clientId,
  vehicleId: id,
  fuelDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a yyyy-MM-dd date.'),
  odometerKm: km,
  litres: z.coerce.number().positive('Enter the litres.').max(2000),
  amount: z.coerce.number().positive('Enter the bill amount.').max(1_000_000),
  fullTank: z.boolean(),
  paidBy: z.enum(['company', 'driver', 'advance']),
  paymentMode: z.string().trim().max(40).optional().default(''),
  stationName: z.string().trim().min(2, 'Enter the fuel station.').max(120),
  billNumber: z.string().trim().max(60).optional().default(''),
  billUploadId: id,
  odometerUploadId: id,
  ocrKm: optionalNumber(0, 9_999_999),
  tripId: optionalId,
  position,
  remarks: note(500),
});

export const geofenceSchema = z.object({
  name: z.string().trim().min(2, 'Name the place.').max(120),
  kind: z.enum(GEOFENCE_KINDS as [string, ...string[]]),
  lat,
  lng,
  radiusM: z.coerce.number().int().min(GEOFENCE_RADIUS_MIN_M, `At least ${GEOFENCE_RADIUS_MIN_M} m.`).max(GEOFENCE_RADIUS_MAX_M, `At most ${GEOFENCE_RADIUS_MAX_M} m.`),
  projectId: optionalId,
  address: z.string().trim().max(300).optional().default(''),
  active: z.boolean().optional().default(true),
});

export const purposeSchema = z.object({
  name: z.string().trim().min(2).max(80),
  requiresReason: z.boolean().optional().default(false),
  requiresProject: z.boolean().optional().default(false),
  active: z.boolean().optional().default(true),
  sortOrder: z.coerce.number().int().min(0).max(1000).optional().default(100),
});

export const vehicleFleetSchema = z.object({
  fleetCategory: z.enum(FLEET_CATEGORIES as [string, ...string[]]).nullish().transform((value) => value ?? null),
  tankCapacityL: optionalNumber(0.5, 2000),
  stdMileageKmpl: optionalNumber(0.5, 200),
  mileageTolerancePct: optionalNumber(0, 100),
  dailyKmLimit: optionalNumber(1, 5000),
  monthlyKmLimit: optionalNumber(1, 100000),
  costBasis: z.enum(['per_km', 'fixed_plus_fuel']).nullish().transform((value) => value ?? null),
  ratePerKm: optionalNumber(0, 1000),
  fixedMonthlyCost: optionalNumber(0, 10_000_000),
  homeGeofenceId: optionalId,
  approverUid: optionalId,
  backupApproverUid: optionalId,
  serviceIntervalKm: optionalNumber(100, 100000),
  lastServiceKm: optionalNumber(0, 9_999_999),
  lastServiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().transform((value) => value ?? null),
  siteInternalExemptFromLimit: z.boolean().optional().default(false),
});

export const baselineSchema = z.object({
  km,
  reason: z.string().trim().min(5, 'Say why the reading is being reset (meter replaced, cluster repaired…).').max(500),
  uploadId: optionalId,
});

export const projectGeofencesSchema = z.object({
  projectId: id,
  geofenceIds: z.array(id).max(50),
});

const idList = z.array(id).max(50).optional().default([]);

export const fleetSettingsSchema = z.object({
  dailyKmLimitByCategory: z.object({ bike: z.coerce.number().min(1).max(2000), car: z.coerce.number().min(1).max(2000), pickup: z.coerce.number().min(1).max(2000) }),
  monthlyKmLimit: z.coerce.number().min(1).max(50000),
  serviceIntervalKm: z.coerce.number().min(100).max(100000),
  mileageTolerancePct: z.coerce.number().min(0).max(100),
  mismatchAbsKm: z.coerce.number().min(0).max(500),
  mismatchPct: z.coerce.number().min(0).max(100),
  unloggedKmTolerance: z.coerce.number().min(0).max(1000),
  approvalEscalateMinutes: z.coerce.number().int().min(5).max(1440),
  approvalExpiryMinutes: z.coerce.number().int().min(10).max(1440),
  escalationUserIds: idList,
  emergencyMonthlyMax: z.coerce.number().int().min(0).max(100),
  gpsGapMinutes: z.coerce.number().int().min(1).max(1440),
  idleRemindMinutes: z.coerce.number().int().min(5).max(1440),
  idleAutoCloseMinutes: z.coerce.number().int().min(15).max(10080),
  maxTripHours: z.coerce.number().min(1).max(72),
  fuelRateVariancePct: z.coerce.number().min(0).max(100),
  ocrEnabled: z.boolean(),
  anyEmployeeMayDrive: z.boolean(),
  companyTripsInFleet: z.boolean(),
  reportEmails: z.array(z.string().trim().email('Enter valid email addresses.')).max(30).optional().default([]),
  digestUserIds: idList,
});

export const generateReportSchema = z
  .object({
    monthKey: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    email: z.boolean().optional().default(false),
  })
  .refine((value) => Boolean(value.monthKey) || (Boolean(value.from) && Boolean(value.to) && (value.from as string) <= (value.to as string)), 'Choose a month, or a from and to date.');

export const uploadKinds = ['odometer', 'fuel_bill', 'baseline'] as const;
export type UploadKind = (typeof uploadKinds)[number];

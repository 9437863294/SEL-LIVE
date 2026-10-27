/**
 * Request payload schemas for the trip-claims API.
 *
 * Shapes only: the meaning (dates, odometers, the claim window, who may act) is checked by
 * `validateTrip` and the workflow rules, which the form also runs. Derived figures — distance from
 * the odometer, rate, amounts, flags, totals — are absent on purpose: the server computes them, and
 * a client that sends them has them ignored.
 */

import { z } from 'zod';

import { PAYMENT_MODES } from './types.ts';

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a yyyy-MM-dd date.');
const id = z.string().trim().min(1).max(128);
const optionalId = z.string().trim().max(128).nullish().transform((value) => value || null);
const reading = z.union([z.number(), z.string(), z.null()]).optional().transform((value) => (value === '' || value === undefined || value === null ? null : Number(value)));
const money = z.union([z.number(), z.string()]).optional().transform((value) => (value === '' || value === undefined ? 0 : Number(value)));
const remarks = z.string().max(500).optional().transform((value) => value?.trim() ?? '');

export const tripInputSchema = z.object({
  tripDate: dateKey,
  ownership: z.enum(['own', 'company']),
  vehicleType: z.string().max(60).optional().default(''),
  vehicleNumber: z.string().max(30).optional().default(''),
  vehicleId: optionalId,
  fromPlace: z.string().max(200),
  toPlace: z.string().max(200),
  purpose: z.string().max(400),
  startOdometer: reading,
  endOdometer: reading,
  distanceKm: reading,
  projectId: optionalId,
  departmentId: optionalId,
  tollAmount: money,
  parkingAmount: money,
  notes: z.string().max(1000).optional().default(''),
  /**
   * Evidence from a GPS recording, when the trip was measured rather than typed.
   *
   * Optional so every existing caller and every manually entered trip is unaffected. The path is
   * capped at 500 points: a Firestore document is limited to 1 MB, and a ten-second fix over a
   * four-hour drive is 1,440 points before downsampling.
   */
  gps: z
    .object({
      measuredKm: z.number().nonnegative().max(10000),
      startedAtIso: z.string().min(1).max(40),
      endedAtIso: z.string().min(1).max(40),
      movingMinutes: z.number().nonnegative().max(100000),
      idleMinutes: z.number().nonnegative().max(100000),
      stopCount: z.number().int().nonnegative().max(1000),
      fixes: z.number().int().nonnegative().max(100000),
      droppedFixes: z.number().int().nonnegative().max(100000),
      path: z
        .array(z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }))
        .max(500)
        .default([]),
    })
    .optional(),
  /**
   * Optional idempotency key for a new trip: it becomes the trip's id, so a save the phone sends
   * again (queued offline, or a reply lost on the way back) returns the trip already saved instead
   * of a second copy. Older apps never send it.
   */
  clientTripId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{8,64}$/, 'Use letters, digits, - and _.')
    .optional(),
});

export const submitClaimSchema = z.object({
  tripIds: z.array(id).min(1, 'Choose at least one trip.').max(200, 'Submit at most 200 trips at a time.'),
  remarks,
  declaration: z.literal(true, { errorMap: () => ({ message: 'Confirm that these trips were official travel.' }) }),
});

const lineDecisionSchema = z.object({
  tripId: id,
  decision: z.enum(['approve', 'adjust', 'reject', 'return']),
  approvedKm: z.number().nullish(),
  remarks: z.string().max(300).optional(),
});

export const paymentSchema = z.object({
  paidOn: dateKey,
  mode: z.enum(PAYMENT_MODES as unknown as [string, ...string[]]),
  reference: z.string().max(80).optional().transform((value) => value?.trim() ?? ''),
  remarks,
});

export const claimActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve'), decisions: z.array(lineDecisionSchema).max(200).default([]), remarks }),
  z.object({ action: z.literal('return'), remarks: z.string().trim().min(3, 'Say what the employee should correct.').max(500) }),
  z.object({ action: z.literal('reject'), remarks: z.string().trim().min(3, 'Say why the claim is rejected.').max(500) }),
  z.object({ action: z.literal('withdraw'), remarks }),
  z.object({ action: z.literal('pay'), payment: paymentSchema }),
]);

export const bulkPaySchema = z.object({
  claimIds: z.array(id).min(1).max(100),
  payment: paymentSchema,
});

const rateRowSchema = z.object({
  vehicleType: z.string().max(60),
  own: z.union([z.number(), z.null()]),
  company: z.union([z.number(), z.null()]),
});

export const rateRevisionSchema = z.object({
  id: z.string().max(64).optional(),
  effectiveFrom: dateKey,
  rates: z.array(rateRowSchema).max(40),
  note: z.string().max(300).optional(),
});

const stageSchema = z.object({
  id: z.string().max(64),
  name: z.string().max(60),
  kind: z.enum(['approval', 'payment']),
  routing: z.enum(['reporting', 'users', 'project', 'department']),
  userIds: z.array(id).max(50),
  routes: z.array(z.object({ key: id, userIds: z.array(id).max(50) })).max(500),
  minAmount: z.number().nullable(),
  tatHours: z.number().nullable(),
});

export const rulesSchema = z.object({
  allowOwnVehicle: z.boolean(),
  allowCompanyVehicle: z.boolean(),
  requireOdometer: z.boolean(),
  allowTollParking: z.boolean(),
  requireProject: z.boolean(),
  allowTypedTrips: z.boolean().optional().default(false),
  maxKmPerTrip: z.number().nullable(),
  maxKmPerDay: z.number().nullable(),
  claimWindowDays: z.number().nullable(),
});

/** One part of the settings at a time, so two administrators editing different parts don't collide. */
export const settingsUpdateSchema = z.discriminatedUnion('part', [
  z.object({ part: z.literal('rules'), rules: rulesSchema }),
  z.object({ part: z.literal('stages'), stages: z.array(stageSchema).min(2).max(8) }),
  z.object({ part: z.literal('rate-revision'), revision: rateRevisionSchema }),
  z.object({ part: z.literal('delete-rate-revision'), revisionId: id }),
]);

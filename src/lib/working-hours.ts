import type { Holiday, WorkingHours } from './types';

/**
 * Shared, Firestore-SDK-agnostic business-hours engine for `/settings/working-hours`
 * (weekly schedule + company holidays, stored at `settings/workingHours` and the `holidays`
 * collection). `workflow-utils.ts`'s `calculateDeadline` already implements this correctly for
 * ~20 modules (Site Fund Request/Requisition, Billing Recon, Subcontractors, Insurance) — but as
 * a `'use server'` file it can only export async Server Actions, so its date-stepping algorithm
 * couldn't be reused directly from a plain sync context or from the Admin SDK. This extracts that
 * algorithm into a pure function so both `workflow-utils.ts` (client SDK, via Server Action) and
 * the Recurring Payments module (client SDK actions *and* the Admin-SDK cron route) can compute
 * the exact same working-hours-aware deadline without duplicating the math per SDK.
 */

function normalizeDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function startOfNextDay(date: Date): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  next.setHours(0, 0, 0, 0);
  return next;
}

/** Handles both the current `{ schedule: {...} } ` doc shape and the older flat structure some
 * orgs may still have, mirroring the same fallback `working-hours/page.tsx` and
 * `workflow-utils.ts` already apply. Returns null if working hours simply aren't configured yet. */
export function normalizeWorkingHoursDoc(data: unknown): WorkingHours | null {
  if (!data || typeof data !== 'object') return null;
  const schedule = (data as { schedule?: unknown }).schedule ?? data;
  if (schedule && typeof schedule === 'object' && 'Monday' in schedule) {
    return schedule as WorkingHours;
  }
  return null;
}

/**
 * Builds a day-granularity working-day predicate from the same configuration `addBusinessHours`
 * uses. Needed by schedule rules that only care whether a calendar date is a working day at all
 * (e.g. Recurring Payments' "last working day of month" due rule), with no TAT to consume.
 * Falls back to Mon–Fri when working hours aren't configured, matching `addBusinessHours`'
 * behavior of degrading rather than failing.
 */
export function makeIsWorkingDay(
  workingHours: WorkingHours | null | undefined,
  holidays: Holiday[] = [],
): (date: Date) => boolean {
  const holidayKeys = new Set(holidays.map((item) => item.date));
  return (date: Date) => {
    if (holidayKeys.has(normalizeDateKey(date))) return false;
    if (!workingHours) return date.getDay() !== 0 && date.getDay() !== 6;
    return workingHours[date.toLocaleDateString('en-US', { weekday: 'long' })]?.isWorkDay === true;
  };
}

/**
 * Advances `startDate` by `tatHours` of actual working time — skipping non-working days (per the
 * weekly schedule) and configured holidays, and clamping time-of-day to within each working day's
 * start/end window. If `workingHours` is null/undefined (not yet configured, or couldn't be
 * loaded), falls back to naive calendar-hour math — the previous behavior everywhere this is
 * newly applied — rather than failing outright.
 */
export function addBusinessHours(
  startDate: Date,
  tatHours: number,
  workingHours: WorkingHours | null | undefined,
  holidays: Holiday[] = [],
): Date {
  if (!workingHours) return new Date(startDate.getTime() + Math.max(0, tatHours) * 3_600_000);

  const holidayKeys = new Set(holidays.map((item) => item.date));
  let remainingHours = Math.max(0, tatHours);
  let current = new Date(startDate);

  // Safety cap: a misconfigured schedule with every day marked non-working would otherwise spin
  // forever. ~10 years of daily iterations is far beyond any real TAT, so bail out with whatever
  // date was reached rather than hang.
  let guard = 0;
  while (remainingHours > 1e-6) {
    if (++guard > 3650) return current;
    const dayName = current.toLocaleDateString('en-US', { weekday: 'long' });
    const dayConfig = workingHours[dayName];
    const isHoliday = holidayKeys.has(normalizeDateKey(current));

    if (dayConfig?.isWorkDay && !isHoliday) {
      const [startHour, startMinute] = dayConfig.startTime.split(':').map(Number);
      const [endHour, endMinute] = dayConfig.endTime.split(':').map(Number);
      const dayStart = new Date(current);
      dayStart.setHours(startHour, startMinute, 0, 0);
      const dayEnd = new Date(current);
      dayEnd.setHours(endHour, endMinute, 0, 0);

      if (current < dayStart) current = dayStart;
      if (current >= dayEnd) {
        current = startOfNextDay(current);
        continue;
      }

      const availableHoursToday = (dayEnd.getTime() - current.getTime()) / 3_600_000;
      if (remainingHours <= availableHoursToday) {
        current = new Date(current.getTime() + remainingHours * 3_600_000);
        remainingHours = 0;
      } else {
        remainingHours -= availableHoursToday;
        current = startOfNextDay(current);
      }
    } else {
      current = startOfNextDay(current);
    }
  }
  return current;
}

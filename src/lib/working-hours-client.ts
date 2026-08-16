import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import type { Holiday, WorkingHours } from './types';
import { normalizeWorkingHoursDoc } from './working-hours';

/**
 * Fetches the org-wide working-hours schedule + holiday list configured at
 * `/settings/working-hours`, for use with `addBusinessHours` (see `./working-hours`). Shared by
 * every client-side action across the app that sets a workflow TAT deadline, so each one doesn't
 * reimplement the same fetch. Returns `workingHours: null` (rather than throwing) if it's not yet
 * configured or the read fails — callers pass that straight to `addBusinessHours`, which falls
 * back to naive calendar-hour math in that case instead of blocking the action.
 */
export async function loadWorkingCalendar(): Promise<{ workingHours: WorkingHours | null; holidays: Holiday[] }> {
  try {
    const [scheduleSnap, holidaysSnap] = await Promise.all([
      getDoc(doc(db, 'settings', 'workingHours')),
      getDocs(collection(db, 'holidays')),
    ]);
    return {
      workingHours: normalizeWorkingHoursDoc(scheduleSnap.data()),
      holidays: holidaysSnap.docs.map((item) => ({ id: item.id, ...item.data() }) as Holiday),
    };
  } catch {
    return { workingHours: null, holidays: [] };
  }
}

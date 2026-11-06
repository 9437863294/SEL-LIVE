'use client';

/**
 * When a requisition's time at a workflow step runs out: the step's turnaround (`tat`, in working
 * hours) from when it got there, counted on the company's working hours and holidays (Settings ›
 * Working hours, src/lib/working-hours.ts). Shared by the Hand over dialog and the requisition's
 * details. The calendar is read once a session.
 */

import { useEffect, useState } from 'react';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { format } from 'date-fns';

import { db } from '@/lib/firebase';
import { addBusinessHours, normalizeWorkingHoursDoc } from '@/lib/working-hours';
import type { Holiday, WorkingHours } from '@/lib/types';

let calendar: Promise<{ hours: WorkingHours | null; holidays: Holiday[] }> | null = null;

function loadCalendar() {
  calendar ??= Promise.all([getDoc(doc(db, 'settings', 'workingHours')), getDocs(collection(db, 'holidays'))])
    .then(([hoursSnap, holidaySnap]) => ({
      hours: normalizeWorkingHoursDoc(hoursSnap.exists() ? hoursSnap.data() : null),
      holidays: holidaySnap.docs.map((d) => d.data() as Holiday),
    }))
    .catch((error) => {
      // Tried again next time rather than remembered as failed.
      calendar = null;
      throw error;
    });
  return calendar;
}

/**
 * The deadline, or null: before it is worked out, without a start or a turnaround, or when the
 * working hours cannot be read (there is then no honest deadline to show).
 */
export function useStepDeadline(since: Date | null, tatHours: number): Date | null {
  const [result, setResult] = useState<{ key: string; deadline: Date } | null>(null);
  const sinceMs = since ? since.getTime() : null;
  const key = `${sinceMs}:${tatHours}`;
  useEffect(() => {
    if (sinceMs === null || !(tatHours > 0)) return;
    let active = true;
    loadCalendar()
      .then(({ hours, holidays }) => {
        if (active) setResult({ key: `${sinceMs}:${tatHours}`, deadline: addBusinessHours(new Date(sinceMs), tatHours, hours, holidays) });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [sinceMs, tatHours]);
  return result && result.key === key ? result.deadline : null;
}

/** How long until a deadline, or how far past it: "Due in 5 h", "Due Mon 6 Nov, 4:30 pm", "Overdue by 2 h". */
export function dueText(deadline: Date, now: Date): { text: string; late: boolean; soon: boolean } {
  const hours = (deadline.getTime() - now.getTime()) / 3_600_000;
  if (hours < 0) {
    const over = Math.abs(hours);
    return { text: `Overdue by ${over < 24 ? `${Math.max(1, Math.round(over))} h` : `${Math.round(over / 24)} d`}`, late: true, soon: false };
  }
  if (hours < 24) return { text: `Due in ${Math.max(1, Math.round(hours))} h`, late: false, soon: hours < 8 };
  return { text: `Due ${format(deadline, 'EEE d MMM, h:mm a')}`, late: false, soon: false };
}

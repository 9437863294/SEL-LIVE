'use client';

/**
 * Daily Requisition's requisitions for the Expenses registers, kept current by a listener.
 *
 * A request's stage lives in Daily Requisition (src/lib/requisition-progress.ts). Read once when the
 * register loaded, a request received, moved on or paid afterwards — in another tab, or by someone
 * else — still read "Not received" there until the page was reloaded, while Daily Requisition
 * already showed it in its workflow. The listener brings each change in as it is saved, so the
 * register, its Stage filter and the details dialog show where the request stands now.
 *
 * Each requisition held at a Workflow Configuration approval step carries that step's name
 * (`heldStepName`), so it reads "At Verification" as Daily Requisition shows it, not "At finance".
 */

import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { heldStep, placeSteps } from '@/lib/daily-requisition-flow';
import { readDailyRequisitionWorkflowSteps } from '@/components/daily-requisition/nav';
import type { DailyRequisitionEntry, WorkflowStep } from '@/lib/types';

export type LiveRequisition = DailyRequisitionEntry & { heldStepName?: string };

interface Snapshot {
  rows: DailyRequisitionEntry[];
  /** Daily Requisition could not be read — progress is unknown, which must not read as "Not received". */
  unavailable: boolean;
  /** The first answer (or refusal) has come in; until then no request's stage is known either way. */
  loaded: boolean;
}

export function useLiveRequisitions(enabled: boolean): { requisitions: LiveRequisition[]; unavailable: boolean; loaded: boolean } {
  const [snapshot, setSnapshot] = useState<Snapshot>({ rows: [], unavailable: false, loaded: false });
  const [steps, setSteps] = useState<WorkflowStep[]>([]);

  useEffect(() => {
    if (!enabled) return;
    return onSnapshot(
      collection(db, 'dailyRequisitions'),
      (snap) =>
        setSnapshot({
          rows: snap.docs.map((d) => ({ ...(d.data() as DailyRequisitionEntry), id: d.id })),
          unavailable: false,
          loaded: true,
        }),
      (error) => {
        // Someone who cannot read Daily Requisition still gets the register; only its progress goes blank.
        console.error('Could not read Daily Requisition:', error);
        setSnapshot({ rows: [], unavailable: true, loaded: true });
      },
    );
  }, [enabled]);

  // The step names. Unreadable, a held requisition reads by its status, as before.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    readDailyRequisitionWorkflowSteps()
      .then((read) => {
        if (!cancelled) setSteps(read);
      })
      .catch((error) => console.warn('Could not read the Daily Requisition workflow; held steps go unnamed:', error));
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const requisitions = useMemo<LiveRequisition[]>(() => {
    const placed = placeSteps(steps);
    if (!placed.length) return snapshot.rows;
    return snapshot.rows.map((row) => {
      const held = heldStep(placed, row);
      return held ? { ...row, heldStepName: held.step.name } : row;
    });
  }, [snapshot.rows, steps]);

  return { requisitions, unavailable: snapshot.unavailable, loaded: snapshot.loaded };
}

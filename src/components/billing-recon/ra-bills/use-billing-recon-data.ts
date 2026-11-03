'use client';

/**
 * Loads one Billing Recon project and the registers a page asks for — always through
 * `billingReconRegister(project)`, so a separated project reads its own `billingRecon*`
 * collections and an unseparated one the shared register, exactly as every other Billing Recon
 * screen does. RA bills are always `projects/{id}/billingReconBills`; Subcontractors' `bills`
 * are never read here.
 *
 * Used by the RA bill register, the New RA bill page, the reconciliation and the RA bill print.
 */

import { useCallback, useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { JmcEntry, MvacEntry, Project } from '@/lib/types';
import type { RaBill } from '@/lib/billing-recon/types';
import { billingReconRegister, type BillingReconRegister } from '@/lib/billing-recon/register';
import { resolveProjectBySlug } from '@/lib/project-slug';

/** A BOQ row as stored: its columns vary with the imported sheet. */
export type BoqDoc = { id: string } & Record<string, unknown>;

/** The project a `[project]` URL segment names, or null. */
export async function findProjectBySlug(slug: string): Promise<Project | null> {
  const snap = await getDocs(collection(db, 'projects'));
  return resolveProjectBySlug(
    snap.docs.map((d) => ({ ...(d.data() as object), id: d.id }) as Project),
    slug,
  );
}

/** Every document of `projects/{projectId}/{name}`, with its id. */
export async function readProjectCollection<T>(projectId: string, name: string): Promise<T[]> {
  const snap = await getDocs(collection(db, 'projects', projectId, name));
  return snap.docs.map((d) => ({ ...(d.data() as object), id: d.id }) as T);
}

export interface BillingReconData {
  project: Project | null;
  register: BillingReconRegister;
  boqItems: BoqDoc[];
  jmcEntries: JmcEntry[];
  mvacEntries: MvacEntry[];
  bills: RaBill[];
}

export interface BillingReconDataRequest {
  boq?: boolean;
  /** JMC and MVAC entries. */
  entries?: boolean;
  bills?: boolean;
}

export type BillingReconLoadError = 'not-found' | 'failed' | null;

const EMPTY: BillingReconData = {
  project: null,
  register: billingReconRegister(null),
  boqItems: [],
  jmcEntries: [],
  mvacEntries: [],
  bills: [],
};

/** Re-reads the registers asked for, for a project already found (used again just before a save). */
export async function readBillingReconRegisters(
  project: Project,
  request: BillingReconDataRequest,
): Promise<BillingReconData> {
  const register = billingReconRegister(project);
  const [boqItems, jmcEntries, mvacEntries, bills] = await Promise.all([
    request.boq ? readProjectCollection<BoqDoc>(project.id, register.boqItems) : Promise.resolve([] as BoqDoc[]),
    request.entries ? readProjectCollection<JmcEntry>(project.id, register.jmcEntries) : Promise.resolve([] as JmcEntry[]),
    request.entries ? readProjectCollection<MvacEntry>(project.id, register.mvacEntries) : Promise.resolve([] as MvacEntry[]),
    request.bills ? readProjectCollection<RaBill>(project.id, register.raBills) : Promise.resolve([] as RaBill[]),
  ]);
  return { project, register, boqItems, jmcEntries, mvacEntries, bills };
}

interface LoadState {
  /** The request this state answers; a different key means a load is under way. */
  key: string;
  data: BillingReconData;
  error: BillingReconLoadError;
}

/**
 * The project in the URL and the registers asked for. Nothing loads until `enabled` (pass the
 * page's permission check, so a user without access reads nothing). `loading` is true from the
 * moment a load is due until its answer arrives.
 */
export function useBillingReconData(slug: string, request: BillingReconDataRequest, enabled = true) {
  const { boq = false, entries = false, bills: wantBills = false } = request;
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<LoadState>({ key: '', data: EMPTY, error: null });

  const key = `${slug}|${boq}|${entries}|${wantBills}|${version}`;
  const loading = enabled && state.key !== key;

  useEffect(() => {
    if (!enabled || !slug) return;
    let cancelled = false;
    const load = async () => {
      try {
        const project = await findProjectBySlug(slug);
        if (cancelled) return;
        if (!project) {
          setState({ key, data: EMPTY, error: 'not-found' });
          return;
        }
        const next = await readBillingReconRegisters(project, { boq, entries, bills: wantBills });
        if (!cancelled) setState({ key, data: next, error: null });
      } catch (err) {
        console.error('Billing Recon: could not load the project registers', err);
        if (!cancelled) setState((prev) => ({ key, data: prev.data, error: 'failed' }));
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [enabled, slug, boq, entries, wantBills, key]);

  /** Read everything again (after an error, say). */
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  /** Patch the loaded bills after a write, without reading them all again. */
  const setBills = useCallback((update: (bills: RaBill[]) => RaBill[]) => {
    setState((prev) => ({ ...prev, data: { ...prev.data, bills: update(prev.data.bills) } }));
  }, []);

  /** Show registers read elsewhere (`readBillingReconRegisters` just before a save). */
  const replaceData = useCallback((next: BillingReconData) => {
    setState((prev) => ({ key: prev.key, data: next, error: null }));
  }, []);

  return { ...state.data, loading, error: loading ? null : state.error, reload, setBills, replaceData };
}

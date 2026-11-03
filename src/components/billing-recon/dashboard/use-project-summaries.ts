'use client';

import { useCallback, useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Project } from '@/lib/types';
import { billingReconRegister } from '@/lib/billing-recon/register';
import { summarizeProject, type DashboardEntry, type ProjectSummary } from '@/lib/billing-recon/dashboard';
import type { RaBill } from '@/lib/billing-recon/types';

export type BoqDoc = { id: string } & Record<string, unknown>;

export interface LoadedProject {
  project: Project;
  summary: ProjectSummary;
  jmcEntries: DashboardEntry[];
  mvacEntries: DashboardEntry[];
  bills: RaBill[];
  /** The project's BOQ in its register — only when asked for (`withBoq`), else null. */
  boqItems: BoqDoc[] | null;
  /** Set when this project's records could not be read; its figures are then zero. */
  error?: string;
}

async function loadOne(project: Project, now: number, withBoq: boolean): Promise<LoadedProject> {
  const reg = billingReconRegister(project);
  const read = async <T,>(name: string): Promise<T[]> => {
    const snap = await getDocs(collection(db, 'projects', project.id, name));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T);
  };
  try {
    const [jmcEntries, mvacEntries, bills, boqItems] = await Promise.all([
      read<DashboardEntry>(reg.jmcEntries),
      read<DashboardEntry>(reg.mvacEntries),
      read<RaBill>(reg.raBills),
      withBoq ? read<BoqDoc>(reg.boqItems) : Promise.resolve(null),
    ]);
    return { project, jmcEntries, mvacEntries, bills, boqItems, summary: summarizeProject({ jmcEntries, mvacEntries, bills }, now) };
  } catch (error) {
    console.error(`Billing Recon dashboard: could not read ${project.projectName}`, error);
    return {
      project,
      jmcEntries: [],
      mvacEntries: [],
      bills: [],
      boqItems: withBoq ? [] : null,
      summary: summarizeProject({ jmcEntries: [], mvacEntries: [], bills: [] }, now),
      error: error instanceof Error ? error.message : 'Could not read this project.',
    };
  }
}

/** Reads every project, four at a time, keeping the given order. */
async function loadAll(projects: Project[], withBoq: boolean): Promise<{ rows: LoadedProject[]; at: number }> {
  const at = Date.now();
  const out: LoadedProject[] = [];
  const queue = [...projects];
  const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length) {
      const next = queue.shift();
      if (next) out.push(await loadOne(next, at, withBoq));
    }
  });
  await Promise.all(workers);
  const order = new Map(projects.map((p, i) => [p.id, i]));
  out.sort((a, b) => (order.get(a.project.id) ?? 0) - (order.get(b.project.id) ?? 0));
  return { rows: out, at };
}

/**
 * Reads the JMC entries, MVAC entries and RA bills of each project — from each project's own
 * register, so a separated project never shows Project Management's JMCs — and summarises them.
 * Three reads per project. `projects` must be a stable (memoised) array.
 *
 * `loading` is derived — true until the stored result belongs to the current request (the set of
 * projects, their separation stamps and the refresh count) — so no state is set synchronously in
 * the effect.
 */
export function useProjectSummaries(projects: Project[], enabled = true, options: { withBoq?: boolean } = {}) {
  const withBoq = Boolean(options.withBoq);
  const [refreshCount, setRefreshCount] = useState(0);
  const [result, setResult] = useState<{ key: string; rows: LoadedProject[]; now: number } | null>(null);

  const key = `${projects.map((p) => `${p.id}:${p.billingReconSeparation?.separatedAt ?? ''}`).join('|')}#${refreshCount}#${withBoq ? 'boq' : ''}`;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void loadAll(projects, withBoq).then(({ rows, at }) => {
      if (!cancelled) setResult({ key, rows, now: at });
    });
    return () => {
      cancelled = true;
    };
  }, [projects, enabled, key, withBoq]);

  const reload = useCallback(() => setRefreshCount((n) => n + 1), []);

  return {
    rows: result?.rows ?? [],
    loading: !result || result.key !== key,
    now: result?.now ?? 0,
    reload,
  };
}

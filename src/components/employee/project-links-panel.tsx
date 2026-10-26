'use client';

/**
 * Employee › Category: link each value of the greytHR category employees' projects come from —
 * "Project Name" by default, "Project Division" or any other, chosen at the top of this panel — to
 * the app's own project(s) in Settings › Projects (src/lib/employee-projects).
 *
 * greytHR says which project an employee is on; the app's trips, claims and fleet bill to its own
 * project master. A link joins the two once per greytHR value, so a trip screen can start from the
 * employee's own project instead of a list of every project in the company. One greytHR project may
 * cover several app projects (a site and its sub-divisions), so a value takes more than one.
 *
 * The greytHR values themselves stay read-only here — greytHR owns them. Each row saves on its own,
 * the moment a project is added or removed. The count of people on each value says which links
 * matter most; an unlinked value with staff on it is called out.
 *
 * Switching the source category moves the panel to that category's values; links made for the
 * previous one are kept (and used again if it is chosen back).
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Link2, Loader2, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/shared/filter-bar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchSelect } from '@/components/driver-management/trips/trip-ui';
import { useToast } from '@/hooks/use-toast';
import { auth } from '@/lib/firebase';
import { cn } from '@/lib/utils';

interface LinkRow {
  id: string;
  valueId: string;
  name: string;
  employees: number;
  projectIds: string[];
  updatedAt: string | null;
  updatedByName: string | null;
}

interface ProjectOption {
  id: string;
  name: string;
  code: string;
  active: boolean;
}

interface Overview {
  category: string;
  sourceCategory: string;
  rows: LinkRow[];
  projects: ProjectOption[];
  canEdit: boolean;
}

async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in again to continue.');
  const response = await fetch(`/api/employee/${path}`, {
    method: init?.method ?? 'GET',
    headers: { Authorization: `Bearer ${await user.getIdToken()}`, ...(init?.body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

export function ProjectLinksPanel({
  category,
  types,
  search,
  onSourceChanged,
}: {
  /** The category whose values are shown — the source category. */
  category: string;
  /** Every greytHR category type mirrored, for the source picker. */
  types: string[];
  search: string;
  onSourceChanged: (category: string) => void;
}) {
  const { toast } = useToast();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Bumped by Try again: the load runs again. */
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState<string | null>(null);
  const [onlyUnlinked, setOnlyUnlinked] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [filter, setFilter] = useState('');

  // State is set only when the answer arrives, never synchronously in the effect.
  useEffect(() => {
    let alive = true;
    call<Overview>(`project-links?category=${encodeURIComponent(category)}`)
      .then((overview) => alive && setData(overview))
      .catch((failure: Error) => alive && setError(failure.message));
    return () => {
      alive = false;
    };
  }, [attempt, category]);

  async function switchSource(next: string) {
    if (next === category) return;
    setSwitching(true);
    try {
      await call<{ sourceCategory: string }>('project-links/source', { method: 'PUT', body: { sourceCategory: next } });
      toast({ title: `Projects now come from ${next}`, description: 'Links made for the previous category are kept.' });
      setData(null);
      onSourceChanged(next);
    } catch (failure) {
      toast({ variant: 'destructive', title: 'Not changed', description: failure instanceof Error ? failure.message : 'Try again.' });
    } finally {
      setSwitching(false);
    }
  }

  const projectsById = useMemo(() => new Map((data?.projects ?? []).map((project) => [project.id, project])), [data?.projects]);
  const term = (filter || search).trim().toLowerCase();
  const rows = useMemo(
    () =>
      (data?.rows ?? []).filter(
        (row) =>
          (!onlyUnlinked || row.projectIds.length === 0) &&
          (!term || row.name.toLowerCase().includes(term) || row.projectIds.some((id) => (projectsById.get(id)?.name ?? '').toLowerCase().includes(term))),
      ),
    [data?.rows, onlyUnlinked, projectsById, term],
  );
  const unlinkedWithStaff = (data?.rows ?? []).filter((row) => row.projectIds.length === 0 && row.employees > 0).length;
  const linked = (data?.rows ?? []).filter((row) => row.projectIds.length > 0).length;

  async function save(row: LinkRow, projectIds: string[]) {
    setSaving(row.id);
    try {
      const result = await call<{ row: Pick<LinkRow, 'id' | 'projectIds' | 'updatedAt' | 'updatedByName'> }>(`project-links/${encodeURIComponent(row.id)}`, { method: 'PUT', body: { projectIds } });
      setData((current) => (current ? { ...current, rows: current.rows.map((entry) => (entry.id === row.id ? { ...entry, ...result.row } : entry)) } : current));
      toast({ title: projectIds.length ? 'Project linked' : 'Link removed', description: row.name });
    } catch (failure) {
      toast({ variant: 'destructive', title: 'Not saved', description: failure instanceof Error ? failure.message : 'Try again.' });
    } finally {
      setSaving(null);
    }
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
        <p className="text-sm text-rose-700">{error}</p>
        <Button size="sm" variant="outline" onClick={() => { setError(null); setAttempt((current) => current + 1); }}>
          Try again
        </Button>
      </div>
    );
  }
  if (!data || data.category !== category) {
    return (
      <p className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Loading project links…
      </p>
    );
  }

  const option = (project: ProjectOption) => ({ value: project.id, label: project.code ? `${project.code} · ${project.name}` : project.name, hint: project.active ? undefined : 'Inactive' });

  return (
    <div className="space-y-3 p-3">
      {/* Which greytHR category says an employee's project — a setting, since tenants use them differently. */}
      <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800">Employees&apos; projects come from</p>
          <p className="text-xs text-muted-foreground">The greytHR category whose values are linked to projects below.</p>
        </div>
        {data.canEdit ? (
          <Select value={category} onValueChange={(next) => void switchSource(next)} disabled={switching}>
            <SelectTrigger className="w-full bg-white text-left sm:w-60" aria-label="greytHR category for employees' projects">
              <span className="min-w-0 truncate">
                <SelectValue />
              </span>
            </SelectTrigger>
            <SelectContent>
              {types.map((type) => (
                <SelectItem key={type} value={type}>
                  {type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="rounded-md bg-slate-100 px-2.5 py-1 text-sm font-medium text-slate-700">{category}</span>
        )}
      </div>

      <div className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-teal-100 bg-teal-50/60 p-3 text-xs text-teal-900">
        <p className="min-w-0 flex-1">
          Link each {category} value to the project it means in{' '}
          <Link href="/settings/project" className="font-medium underline underline-offset-2">
            Settings › Projects
          </Link>
          . An employee&apos;s trips then start from their own project. {linked} of {data.rows.length} linked.
        </p>
        {unlinkedWithStaff > 0 && (
          <button type="button" onClick={() => setOnlyUnlinked((current) => !current)} className={cn('inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium', onlyUnlinked ? 'bg-amber-600 text-white' : 'bg-amber-100 text-amber-800 hover:bg-amber-200')}>
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            {unlinkedWithStaff} with staff not linked{onlyUnlinked ? ' — showing' : ''}
          </button>
        )}
      </div>

      {!search && <SearchInput value={filter} onChange={setFilter} placeholder={`Search ${category} or app project…`} className="sm:max-w-sm" />}

      {rows.length === 0 ? (
        <p className="px-2 py-8 text-center text-sm text-muted-foreground">{onlyUnlinked ? `Every ${category} value with staff is linked.` : data.rows.length ? 'Nothing matches.' : `greytHR has no ${category} values mirrored.`}</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {rows.map((row) => {
            const chosen = row.projectIds.map((id) => projectsById.get(id)).filter((project): project is ProjectOption => Boolean(project));
            const available = data.projects.filter((project) => !row.projectIds.includes(project.id)).map(option);
            const busy = saving === row.id;
            return (
              <li key={row.id} className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:items-center sm:gap-4">
                <div className="min-w-0">
                  <p className="break-words text-sm font-medium text-slate-800">{row.name}</p>
                  <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3 w-3" aria-hidden />
                      {row.employees} {row.employees === 1 ? 'employee' : 'employees'}
                    </span>
                    <span className="tabular-nums">#{row.valueId}</span>
                  </p>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  {chosen.map((project) => (
                    <span key={project.id} className="inline-flex max-w-full items-center gap-1 rounded-full border border-teal-200 bg-teal-50 py-0.5 pl-2.5 pr-1 text-xs font-medium text-teal-800">
                      <Link2 className="h-3 w-3 shrink-0" aria-hidden />
                      <span className="truncate">{project.code ? `${project.code} · ${project.name}` : project.name}</span>
                      {data.canEdit && (
                        <button type="button" onClick={() => void save(row, row.projectIds.filter((id) => id !== project.id))} disabled={busy} className="rounded-full p-0.5 hover:bg-teal-100 disabled:opacity-50" aria-label={`Unlink ${project.name}`}>
                          <X className="h-3 w-3" aria-hidden />
                        </button>
                      )}
                    </span>
                  ))}
                  {!chosen.length && !data.canEdit && <span className="text-xs text-muted-foreground">Not linked</span>}
                  {data.canEdit && (
                    <div className="w-full min-w-0 sm:w-64">
                      <SearchSelect options={available} value={null} onChange={(projectId) => projectId && void save(row, [...row.projectIds, projectId])} placeholder={chosen.length ? 'Add another project' : 'Link a project…'} disabled={busy || !available.length} emptyText="No project matches." />
                    </div>
                  )}
                  {busy && <Loader2 className="h-4 w-4 animate-spin text-slate-400" aria-hidden />}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {!data.canEdit && <p className="text-[11px] text-muted-foreground">Linking needs Settings · Employee Management · Edit or Manage Project · Edit.</p>}
    </div>
  );
}

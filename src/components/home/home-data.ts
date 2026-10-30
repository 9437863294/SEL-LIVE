'use client';

/**
 * What the Command and Launchpad home designs draw from — one place, so the two can only differ in
 * how they look.
 *
 * Nothing here fetches on its own. The work data is the home page's single `useWorkDashboard` run
 * (the one that already feeds the Classic design's tab count), and the modules are the launcher's
 * own permitted list, so every design shows exactly what the person may open.
 */

import { useCallback, useMemo } from 'react';
import type { ComponentType } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAppearance } from '@/components/theme/ThemeProvider';
import type { WorkDashboardState } from '@/components/work-dashboard/hooks';
import {
  moduleHref,
  useModuleGroups,
  usePermittedModules,
  usePermittedModulesLoading,
  type LauncherGroup,
} from '@/components/module-hub/module-catalog';
import { getModuleIconEntry } from '@/components/module-hub/module-icon-registry';
import type { ModuleIconProps } from '@/components/module-hub/module-icons';
import { canonicalModuleName } from '@/lib/activity-modules';
import { moduleDisplayName } from '@/lib/module-display-names';
import {
  compareWorkItems,
  dueLabel,
  toWorkDate,
  workUrgency,
  type WorkItem,
  type WorkUrgency,
} from '@/lib/work-dashboard';

export interface HomeModule {
  /** The permission catalogue's name — the key for favourites and categories. */
  name: string;
  /** What the person sees (`moduleDisplayName`). */
  label: string;
  description: string;
  href: string;
  /** The company's group for this module, or "Other". */
  group: LauncherGroup;
  Icon: ComponentType<ModuleIconProps>;
  /** `bg-gradient-to-br` stops for the icon tile. */
  gradient: string;
  /** The gradient's end colour as hex, for coloured glows and shadows (see `gradientAccent`). */
  accent: string;
  /** Items in the "needs you" lane that belong to this module. */
  pending: number;
  favourite: boolean;
}

/** A module with work waiting, for the summary tiles. */
export interface HomeWorkTile {
  module: HomeModule;
  count: number;
  /** The most pressing item's deadline, in words, and how pressing it is. */
  note: string;
  urgency: WorkUrgency;
}

export interface HomeMeeting {
  id: string;
  time: string;
  title: string;
  detail: string | null;
  href: string;
}

/**
 * The work sources name modules by their activity-log names, which differ from the launcher's for
 * two modules; everything else lines up through `canonicalModuleName`.
 */
const LAUNCHER_TO_WORK: Record<string, string> = {
  'Bank Guarantee Management': 'Bank Guarantee',
  'Letter of Credit Management': 'Letter of Credit',
};
const workModuleOf = (name: string) => LAUNCHER_TO_WORK[name] ?? canonicalModuleName(name);

/**
 * Hex for the `to-*` stop of each gradient in module-icon-registry.tsx (Tailwind's own palette), so a
 * card can cast a shadow in its icon's colour. A class built at runtime would not exist in the CSS,
 * hence a table. A gradient added to the registry later falls back to slate until listed here.
 */
const TAILWIND_STOPS: Record<string, string> = {
  'amber-600': '#d97706', 'amber-700': '#b45309', 'blue-600': '#2563eb', 'blue-700': '#1d4ed8',
  'cyan-600': '#0891b2', 'emerald-700': '#047857', 'fuchsia-600': '#c026d3', 'gray-600': '#4b5563',
  'green-600': '#16a34a', 'indigo-600': '#4f46e5', 'indigo-700': '#4338ca', 'orange-600': '#ea580c',
  'pink-600': '#db2777', 'purple-700': '#7e22ce', 'red-600': '#dc2626', 'rose-600': '#e11d48',
  'sky-600': '#0284c7', 'sky-700': '#0369a1', 'slate-700': '#334155', 'stone-700': '#44403c',
  'teal-600': '#0d9488', 'teal-700': '#0f766e', 'violet-600': '#7c3aed',
};

export function gradientAccent(gradient: string): string {
  const stop = /\bto-([a-z]+-\d{3})\b/.exec(gradient)?.[1];
  return (stop && TAILWIND_STOPS[stop]) || '#475569';
}

/** "Good morning" until noon, "Good afternoon" until five, then "Good evening". */
export function greeting(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** "Friday, 30 October 2026", in the viewer's own calendar. */
export function longDate(now: Date = new Date()): string {
  return now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function useHomeData(work: WorkDashboardState) {
  const { user } = useAuth();
  const { effective, updatePreferences } = useAppearance();
  const permitted = usePermittedModules();
  const modulesLoading = usePermittedModulesLoading();
  const { groups: launcherGroups, groupOf } = useModuleGroups();
  const favouriteNames = effective.layout.favouriteModules;
  const { lanes, summary, today, isLoading: workLoading } = work;

  const pendingByModule = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of lanes.action) {
      const key = canonicalModuleName(item.module);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [lanes.action]);

  const modules = useMemo<HomeModule[]>(
    () =>
      permitted.map((module) => {
        const { Icon, gradient } = getModuleIconEntry(module.icon);
        return {
          name: module.title,
          label: moduleDisplayName(module.title),
          description: module.content,
          href: moduleHref(module.title),
          group: groupOf(module.title),
          Icon,
          gradient,
          accent: gradientAccent(gradient),
          pending: pendingByModule.get(workModuleOf(module.title)) ?? 0,
          favourite: favouriteNames.includes(module.title),
        };
      }),
    [permitted, pendingByModule, favouriteNames, groupOf],
  );

  // In the order they were starred; a favourite the person can no longer open is simply not shown.
  const favourites = useMemo(
    () => favouriteNames.flatMap((name) => modules.find((m) => m.name === name) ?? []),
    [favouriteNames, modules],
  );

  // The company's groups in their order, each with this person's modules in it; empty groups dropped.
  const categories = useMemo(
    () =>
      launcherGroups
        .map((group) => ({ group, modules: modules.filter((m) => m.group.id === group.id) }))
        .filter((entry) => entry.modules.length > 0),
    [launcherGroups, modules],
  );

  // Modules with work waiting, busiest first, each with its most pressing item's deadline.
  const workTiles = useMemo<HomeWorkTile[]>(() => {
    const byModule = new Map<string, WorkItem[]>();
    for (const item of lanes.action) {
      const key = canonicalModuleName(item.module);
      byModule.set(key, [...(byModule.get(key) ?? []), item]);
    }
    return modules
      .flatMap((module) => {
        const items = byModule.get(workModuleOf(module.name));
        if (!items?.length) return [];
        const first = [...items].sort((left, right) => compareWorkItems(left, right, today))[0];
        const urgency = workUrgency(first, today);
        return [{ module, count: items.length, urgency, note: urgency === 'undated' ? 'No deadline set' : `Next: ${dueLabel(first, today).toLowerCase()}` }];
      })
      .sort((left, right) => right.count - left.count || left.module.label.localeCompare(right.module.label));
  }, [lanes.action, modules, today]);

  const meetingsToday = useMemo<HomeMeeting[]>(
    () =>
      lanes.meeting
        .filter((item) => toWorkDate(item.dueAt) === today)
        .sort((left, right) => (left.startTime ?? '').localeCompare(right.startTime ?? ''))
        .map((item) => ({
          id: item.id,
          time: item.startTime ?? 'All day',
          title: item.title,
          detail: item.stage ?? item.reference ?? null,
          href: item.href,
        })),
    [lanes.meeting, today],
  );

  const toggleFavourite = useCallback(
    (name: string) =>
      // `updatePreferences` replaces top-level fields, so `layout` is merged here, never replaced.
      updatePreferences((current) => {
        const list = current.layout?.favouriteModules ?? [];
        const next = list.includes(name) ? list.filter((n) => n !== name) : [...list, name];
        return { ...current, layout: { ...current.layout, favouriteModules: next } };
      }),
    [updatePreferences],
  );

  /** "4 items are waiting for you across 3 modules. 1 is overdue." */
  const summaryLine = workLoading
    ? 'Gathering what is waiting for you…'
    : summary.action === 0
      ? 'Nothing is waiting for you right now.'
      : `${plural(summary.action, 'item is', 'items are')} waiting for you across ${plural(summary.modules, 'module', 'modules')}.` +
        (summary.overdue > 0 ? ` ${plural(summary.overdue, 'is', 'are')} past the deadline.` : '');

  return {
    firstName: (user?.name ?? '').trim().split(/\s+/)[0] || 'there',
    loading: modulesLoading,
    workLoading,
    summary,
    summaryLine,
    modules,
    favourites,
    categories,
    workTiles,
    meetingsToday,
    toggleFavourite,
  };
}

export type HomeData = ReturnType<typeof useHomeData>;

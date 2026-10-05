'use client';

import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import {
  Banknote,
  BarChart3,
  Clock,
  FileBarChart,
  FilePlus,
  Files,
  FolderOpen,
  Landmark,
  Layers,
  LayoutDashboard,
  Receipt,
  Settings,
  TrendingUp,
  Users,
  Wallet,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { db } from '@/lib/firebase';
import { DR_STATIC_SEGMENTS, dailyStepNameProblem, dailyStepSlug } from '@/lib/daily-requisition-settings';
import type { WorkflowStep } from '@/lib/types';

export const DAILY_REQUISITION_BASE = '/daily-requisition';

/**
 * The slug a workflow stage is linked by, and why a name has no page of its own: one definition in
 * `src/lib/daily-requisition-settings.ts` (pure, so it is unit-tested), shared with `[step]/page.tsx`
 * and Workflow Configuration. Re-exported here because the menus are where it is reached for.
 */
export { dailyStepNameProblem, dailyStepSlug };

/** Each stage's icon and chip colours, by position. The dashboard's stage cards use the same icons. */
const STAGE_LOOKS: ReadonlyArray<{ icon: LucideIcon; color: string; bg: string }> = [
  { icon: Landmark, color: 'text-emerald-700', bg: 'bg-emerald-50' },
  { icon: Receipt, color: 'text-violet-700', bg: 'bg-violet-50' },
  { icon: Banknote, color: 'text-amber-700', bg: 'bg-amber-50' },
];
const LATER_STAGE_LOOK = { icon: Workflow, color: 'text-slate-700', bg: 'bg-slate-100' };

export function dailyStageIcon(index: number): LucideIcon {
  return (STAGE_LOOKS[index] ?? LATER_STAGE_LOOK).icon;
}

/** The module's reports, in the order the Reports page lists them. */
export const DAILY_REQUISITION_REPORTS: ReadonlyArray<{ href: string; label: string; icon: LucideIcon; color: string; bg: string }> = [
  { href: `${DAILY_REQUISITION_BASE}/reports/status-overview`, label: 'Status Overview', icon: BarChart3, color: 'text-cyan-700', bg: 'bg-cyan-50' },
  { href: `${DAILY_REQUISITION_BASE}/reports/monthly-trend`, label: 'Monthly Trend', icon: TrendingUp, color: 'text-violet-700', bg: 'bg-violet-50' },
  { href: `${DAILY_REQUISITION_BASE}/reports/department-analysis`, label: 'Department Analysis', icon: Layers, color: 'text-emerald-700', bg: 'bg-emerald-50' },
  { href: `${DAILY_REQUISITION_BASE}/reports/project-analysis`, label: 'Project Analysis', icon: FolderOpen, color: 'text-amber-700', bg: 'bg-amber-50' },
  { href: `${DAILY_REQUISITION_BASE}/reports/party-analysis`, label: 'Party Analysis', icon: Users, color: 'text-rose-700', bg: 'bg-rose-50' },
  { href: `${DAILY_REQUISITION_BASE}/reports/financial-breakdown`, label: 'Financial Breakdown', icon: Wallet, color: 'text-indigo-700', bg: 'bg-indigo-50' },
  { href: `${DAILY_REQUISITION_BASE}/reports/ageing`, label: 'Ageing Report', icon: Clock, color: 'text-red-700', bg: 'bg-red-50' },
  { href: `${DAILY_REQUISITION_BASE}/reports/gst-by-registration`, label: 'GST & TDS by Registration', icon: Landmark, color: 'text-teal-700', bg: 'bg-teal-50' },
];

type Can = (action: string, resource: string) => boolean;

/**
 * Who may open each page, exactly as the page itself decides, so a menu never offers a page that
 * answers "Access Denied" nor hides one that would open.
 */
export function dailyRequisitionAccess(can: Can) {
  const view = (page: string) => can('View', `Daily Requisition.${page}`);
  const reports = view('Reports') || view('Entry Sheet');
  const settings = view('Settings');
  // Field and Data Control open read-only for anyone who can see Settings; editing needs Edit on the section.
  const fieldControl = view('Field Control') || settings;
  const dataControl = view('Data Control') || settings;
  const auditLog = view('Audit Log');
  return {
    entrySheet: view('Entry Sheet'),
    manageDocuments: view('Manage Documents'),
    /** A workflow stage, by its configured name (`[step]/page.tsx`). */
    stage: view,
    /** Each report page. */
    reports,
    /** The Reports card grid also opens for Settings. */
    reportsHub: reports || settings,
    /** The Settings card grid also opens for anyone who can open one of its controls. */
    settings: settings || fieldControl || dataControl || auditLog,
    fieldControl,
    dataControl,
    auditLog,
    /** Printing Setup: the Settings page's card and the page itself. */
    printing: settings,
    workflowConfiguration: can('View Workflow', 'Daily Requisition.Settings'),
  };
}

/**
 * The configured workflow stages, live. A subscription rather than a read so a stage renamed in
 * Workflow Configuration reaches the menus without a reload; the sidebar, the phone bar and the
 * dashboard all listen to the same document, which the Firestore SDK serves from one watch.
 */
export function useDailyRequisitionWorkflowSteps(): { steps: WorkflowStep[]; isLoading: boolean } {
  const [state, setState] = useState<{ steps: WorkflowStep[]; isLoading: boolean }>({ steps: [], isLoading: true });

  useEffect(
    () =>
      onSnapshot(
        doc(db, 'workflows', 'daily-requisition-workflow'),
        (snap) => {
          const raw = snap.exists() ? snap.data().steps : undefined;
          const steps = Array.isArray(raw)
            ? (raw as WorkflowStep[]).filter((step) => typeof step?.name === 'string' && step.name.trim() !== '')
            : [];
          setState({ steps, isLoading: false });
        },
        (error) => {
          console.error('Could not read the Daily Requisition workflow:', error);
          setState((previous) => ({ ...previous, isLoading: false }));
        },
      ),
    [],
  );

  return state;
}

export type DailyRequisitionNavGroup = 'Overview' | 'Workflow' | 'Reports' | 'Settings';

export interface DailyRequisitionNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  group: DailyRequisitionNavGroup;
  /** Icon chip colours in the desktop sidebar. */
  color: string;
  bg: string;
  /** Lit only on this exact path: the dashboard, which every other page sits under. */
  exact?: boolean;
  /** Other pages (and their sub-pages) that light this entry — ones reached from its page rather than the menu. */
  alsoActiveOn?: string[];
}

/**
 * The Daily Requisition menu, in order, each entry gated as its page gates itself. One list for
 * both menus (the desktop sidebar and the phone's "More" sheet), so a page added to one cannot go
 * missing from the other.
 */
export function useDailyRequisitionNav(): { items: DailyRequisitionNavItem[]; isLoading: boolean } {
  const { can, isLoading } = useAuthorization();
  const { steps } = useDailyRequisitionWorkflowSteps();

  const items = useMemo(() => {
    if (isLoading) return [];
    const access = dailyRequisitionAccess(can);
    const base = DAILY_REQUISITION_BASE;

    const stages: Array<DailyRequisitionNavItem & { allowed: boolean }> = steps.map((step, index) => {
      const slug = dailyStepSlug(step.name);
      return {
        href: `${base}/${slug}`,
        label: step.name,
        group: 'Workflow',
        ...(STAGE_LOOKS[index] ?? LATER_STAGE_LOOK),
        allowed: slug !== '' && !DR_STATIC_SEGMENTS.includes(slug) && access.stage(step.name),
      };
    });

    const all: Array<DailyRequisitionNavItem & { allowed: boolean }> = [
      { href: base, label: 'Dashboard', icon: LayoutDashboard, group: 'Overview', color: 'text-cyan-700', bg: 'bg-cyan-50', exact: true, allowed: true },

      { href: `${base}/entry-sheet`, label: 'Entry Sheet', icon: FilePlus, group: 'Workflow', color: 'text-sky-700', bg: 'bg-sky-50', allowed: access.entrySheet },
      ...stages,
      { href: `${base}/manage-documents`, label: 'Manage Documents', icon: Files, group: 'Workflow', color: 'text-teal-700', bg: 'bg-teal-50', allowed: access.manageDocuments },

      { href: `${base}/reports`, label: 'All Reports', icon: FileBarChart, group: 'Reports', color: 'text-indigo-700', bg: 'bg-indigo-50', allowed: access.reportsHub },
      ...DAILY_REQUISITION_REPORTS.map((report) => ({ ...report, group: 'Reports' as const, allowed: access.reports })),

      // Printing, Workflow, Field & Data Control and the Audit Log are cards on the Settings page,
      // so the menu carries the one entry; it stays lit on each of them (see `alsoActiveOn`).
      {
        href: `${base}/settings`,
        label: 'All Settings',
        icon: Settings,
        group: 'Settings',
        color: 'text-slate-700',
        bg: 'bg-slate-100',
        alsoActiveOn: [`${base}/audit-log`],
        allowed: access.settings,
      },
    ];

    return visibleOnce(all);
  }, [can, isLoading, steps]);

  return { items, isLoading };
}

/** The allowed entries, each page once (two stages whose names slug alike are one page). */
function visibleOnce(all: Array<DailyRequisitionNavItem & { allowed: boolean }>): DailyRequisitionNavItem[] {
  const seen = new Set<string>();
  const out: DailyRequisitionNavItem[] = [];
  for (const { allowed, ...item } of all) {
    if (!allowed || seen.has(item.href)) continue;
    seen.add(item.href);
    out.push(item);
  }
  return out;
}

/** The menu split into its groups, in order. */
export function groupDailyRequisitionNav(items: DailyRequisitionNavItem[]): Array<{ name: DailyRequisitionNavGroup; items: DailyRequisitionNavItem[] }> {
  const groups: Array<{ name: DailyRequisitionNavGroup; items: DailyRequisitionNavItem[] }> = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.name === item.group) last.items.push(item);
    else groups.push({ name: item.group, items: [item] });
  }
  return groups;
}

/**
 * The menu entry a path belongs to: the longest matching href, so /daily-requisition/reports/ageing
 * lights "Ageing Report" rather than "All Reports". The dashboard matches only itself.
 */
export function activeDailyRequisitionHref(
  pathname: string,
  items: Array<Pick<DailyRequisitionNavItem, 'href' | 'alsoActiveOn'>>,
): string | undefined {
  let best: string | undefined;
  let bestLength = 0;
  const under = (path: string) => pathname === path || (path !== DAILY_REQUISITION_BASE && pathname.startsWith(`${path}/`));
  for (const { href, alsoActiveOn } of items) {
    for (const path of [href, ...(alsoActiveOn ?? [])]) {
      if (under(path) && path.length > bestLength) {
        best = href;
        bestLength = path.length;
      }
    }
  }
  return best;
}

/**
 * A print route is a document, not a screen: `print` as a whole path segment
 * (/entry-sheet/print, /entry-sheet/<id>/print), never /settings/printing.
 */
export function isDailyRequisitionPrintRoute(pathname: string): boolean {
  return /\/print(\/|$)/.test(pathname);
}

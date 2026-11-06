'use client';

import { useEffect, useMemo, useState } from 'react';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import {
  Banknote,
  BarChart3,
  FileBarChart,
  FilePlus,
  Files,
  Landmark,
  LayoutDashboard,
  Receipt,
  Settings,
  ShieldCheck,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useAuth } from '@/components/auth/AuthProvider';
import { db } from '@/lib/firebase';
import { DR_STATIC_SEGMENTS, dailyStepNameProblem, dailyStepSlug, PAYMENT_PAGE_SLUG } from '@/lib/daily-requisition-settings';
import { PAYMENT_PAGE_NAME, placeSteps, ROLE_PERMISSION_PAGE, stepNamesUser, type StageRole } from '@/lib/daily-requisition-flow';
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
/** A Verification step (src/lib/daily-requisition-flow.ts), wherever it sits. */
const VERIFICATION_STEP_LOOK = { icon: ShieldCheck, color: 'text-sky-700', bg: 'bg-sky-50' };

export function dailyStageIcon(index: number): LucideIcon {
  return (STAGE_LOOKS[index] ?? LATER_STAGE_LOOK).icon;
}

/**
 * The reports the menu names under "All Reports". The rest (Monthly Trend, the Department, Project
 * and Party analyses, Financial Breakdown, Ageing) open from the All Reports page, and light its entry.
 */
export const DAILY_REQUISITION_REPORTS: ReadonlyArray<{ href: string; label: string; icon: LucideIcon; color: string; bg: string }> = [
  { href: `${DAILY_REQUISITION_BASE}/reports/status-overview`, label: 'Status Overview', icon: BarChart3, color: 'text-cyan-700', bg: 'bg-cyan-50' },
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
    /**
     * A workflow stage, by its permission page (`stagePermissionPage`): a built-in stage's by its
     * position, whatever Workflow Configuration names it (`[step]/page.tsx` does the same).
     */
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

/**
 * The workflow's steps as saved right now, for a write that places a requisition: a new one starts
 * at the first Verification step before Finance (holdForCreate). Read at the moment of saving, and
 * a failed read fails the save, so a requisition never skips the steps before Finance.
 */
export async function readDailyRequisitionWorkflowSteps(): Promise<WorkflowStep[]> {
  const snap = await getDoc(doc(db, 'workflows', 'daily-requisition-workflow'));
  const raw = snap.exists() ? snap.data().steps : undefined;
  return Array.isArray(raw) ? (raw as WorkflowStep[]).filter((step) => typeof step?.name === 'string' && step.name.trim() !== '') : [];
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
  const { user } = useAuth();
  const userId = user?.id ?? '';
  const { steps } = useDailyRequisitionWorkflowSteps();

  const items = useMemo(() => {
    if (isLoading) return [];
    const access = dailyRequisitionAccess(can);
    const base = DAILY_REQUISITION_BASE;
    const placed = placeSteps(steps);
    /**
     * A stage's permissions are those of the works its buttons give it (each work's own page,
     * whatever the stage is named): any of them opens it.
     */
    const mayWorkStage = (roles: readonly StageRole[]) => roles.some((role) => access.stage(ROLE_PERMISSION_PAGE[role]));
    // A Verification step has no permission of its own: it opens for the people it assigns, and for
    // anyone who works the module's stages or its workflow (who see what waits there).
    const paysHere = access.stage(ROLE_PERMISSION_PAGE.payment);
    const worksStages = access.workflowConfiguration || paysHere || placed.some((p) => mayWorkStage(p.roles));

    const stages: Array<DailyRequisitionNavItem & { allowed: boolean }> = placed.map(({ step, role, roles, builtinIndex }) => {
      const slug = dailyStepSlug(step.name);
      const isVerification = role === 'verification';
      return {
        href: `${base}/${slug}`,
        label: step.name,
        group: 'Workflow',
        ...(isVerification ? VERIFICATION_STEP_LOOK : (STAGE_LOOKS[builtinIndex ?? -1] ?? LATER_STAGE_LOOK)),
        allowed:
          slug !== '' &&
          !DR_STATIC_SEGMENTS.includes(slug) &&
          slug !== PAYMENT_PAGE_SLUG &&
          // A step's own people always see it (being assigned is the authority to work it); a
          // Verification step also opens for anyone who works the stages, to see what waits there.
          (isVerification
            ? access.stage(step.name) || stepNamesUser(step, userId) || worksStages
            : roles.length > 0 && (mayWorkStage(roles) || stepNamesUser(step, userId))),
      };
    });

    const all: Array<DailyRequisitionNavItem & { allowed: boolean }> = [
      { href: base, label: 'Dashboard', icon: LayoutDashboard, group: 'Overview', color: 'text-cyan-700', bg: 'bg-cyan-50', exact: true, allowed: true },

      { href: `${base}/entry-sheet`, label: 'Entry Sheet', icon: FilePlus, group: 'Workflow', color: 'text-sky-700', bg: 'bg-sky-50', allowed: access.entrySheet },
      ...stages,
      // Payment: no workflow step, but always the page after the last one.
      {
        href: `${base}/${PAYMENT_PAGE_SLUG}`,
        label: PAYMENT_PAGE_NAME,
        group: 'Workflow',
        ...STAGE_LOOKS[2],
        allowed: paysHere,
      },
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
  }, [can, isLoading, steps, userId]);

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
 * The menu entry a path belongs to: the longest matching href, so /daily-requisition/reports/status-overview
 * lights "Status Overview" rather than "All Reports". The dashboard matches only itself.
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

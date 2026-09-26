'use client';

import { useEffect, useMemo, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import {
  Banknote,
  BarChart3,
  FilePlus,
  Files,
  Landmark,
  LayoutDashboard,
  Receipt,
  Settings,
  Workflow,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { ModuleBottomNav, type ModuleMoreLink, type ModuleNavTab } from '@/components/navigation/ModuleBottomNav';
import { useAuthorization } from '@/hooks/useAuthorization';
import { db } from '@/lib/firebase';
import type { WorkflowStep } from '@/lib/types';

const BASE = '/daily-requisition';

/** The slug the dashboard links a stage with and `[step]` resolves it by. */
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** The dashboard's icon for each workflow stage, by position. */
const stageIcons: LucideIcon[] = [Landmark, Receipt, Banknote];

/**
 * The phone's bottom bar for Daily Requisition.
 *
 * The module has no sidebar or menu of its own (the dashboard's cards are its navigation), so
 * "More" opens the bar's own sheet, grouped the way the dashboard is. Every destination is gated the
 * way the dashboard gates its card: `View` on `Daily Requisition.<card title>`. Entries are added
 * from a dialog on the entry sheet, so there is no create tab; the workflow stages are configured
 * and their names run long, so they live in "More" rather than on the bar.
 */
export function DailyRequisitionBottomNav() {
  const { can } = useAuthorization();
  const [steps, setSteps] = useState<WorkflowStep[]>([]);

  // Read once for the module, the way the dashboard does: the layout stays mounted across its pages.
  useEffect(() => {
    let cancelled = false;
    getDoc(doc(db, 'workflows', 'daily-requisition-workflow'))
      .then((snap) => {
        if (!cancelled && snap.exists()) setSteps(snap.data().steps || []);
      })
      .catch((err) => console.error('Error loading workflow config for the bottom bar:', err));
    return () => {
      cancelled = true;
    };
  }, []);

  const { tabs, moreLinks } = useMemo(() => {
    const canOpen = (title: string) => can('View', `Daily Requisition.${title}`);

    const tabs: ModuleNavTab[] = [
      { href: BASE, label: 'Home', icon: LayoutDashboard, exact: true },
      ...(canOpen('Entry Sheet')
        ? [{ href: `${BASE}/entry-sheet`, label: 'Entries', icon: FilePlus, ariaLabel: 'Entry sheet' }]
        : []),
      ...(canOpen('Manage Documents')
        ? [{ href: `${BASE}/manage-documents`, label: 'Documents', icon: Files, ariaLabel: 'Manage documents' }]
        : []),
      ...(canOpen('Reports') ? [{ href: `${BASE}/reports`, label: 'Reports', icon: BarChart3 }] : []),
    ];

    const moreLinks: ModuleMoreLink[] = [
      { href: BASE, label: 'Dashboard', icon: LayoutDashboard, group: 'Entry point', exact: true },
      ...(canOpen('Entry Sheet')
        ? [{ href: `${BASE}/entry-sheet`, label: 'Entry Sheet', icon: FilePlus, group: 'Entry point' }]
        : []),
      ...steps.flatMap((step, i) =>
        canOpen(step.name)
          ? [{ href: `${BASE}/${toSlug(step.name)}`, label: step.name, icon: stageIcons[i] ?? Workflow, group: 'Workflow stages' }]
          : [],
      ),
      ...(canOpen('Manage Documents')
        ? [{ href: `${BASE}/manage-documents`, label: 'Manage Documents', icon: Files, group: 'Support & admin' }]
        : []),
      ...(canOpen('Reports') ? [{ href: `${BASE}/reports`, label: 'Reports', icon: BarChart3, group: 'Support & admin' }] : []),
      ...(canOpen('Settings') ? [{ href: `${BASE}/settings`, label: 'Settings', icon: Settings, group: 'Support & admin' }] : []),
    ];

    return { tabs, moreLinks };
  }, [can, steps]);

  return <ModuleBottomNav tabs={tabs} moreLinks={moreLinks} moduleName="Daily Requisition" />;
}

export default DailyRequisitionBottomNav;

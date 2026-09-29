'use client';

import { useMemo } from 'react';
import { FileBarChart, FilePlus, Files, LayoutDashboard } from 'lucide-react';

import { ModuleBottomNav, type ModuleMoreLink, type ModuleNavTab } from '@/components/navigation/ModuleBottomNav';
import { DAILY_REQUISITION_BASE as BASE, useDailyRequisitionNav } from './nav';

/**
 * The phone's bottom bar for Daily Requisition. The desktop sidebar is hidden below `lg`, so this
 * is the phone's way round the module: Home, the entry sheet, documents and the reports page are
 * tabs, and "More" opens a sheet of every page — the same list the sidebar draws (`nav.ts`), each
 * workflow stage, report and settings page included. Entries are added from a dialog on the entry
 * sheet, so there is no create tab; the stages' configured names run long, so they live in "More".
 */
export function DailyRequisitionBottomNav() {
  const { items, isLoading } = useDailyRequisitionNav();

  const { tabs, moreLinks } = useMemo(() => {
    if (isLoading) return { tabs: [] as ModuleNavTab[], moreLinks: [] as ModuleMoreLink[] };
    const has = (href: string) => items.some((item) => item.href === href);

    const tabs: ModuleNavTab[] = [
      { href: BASE, label: 'Home', icon: LayoutDashboard, exact: true },
      ...(has(`${BASE}/entry-sheet`)
        ? [{ href: `${BASE}/entry-sheet`, label: 'Entries', icon: FilePlus, ariaLabel: 'Entry sheet' }]
        : []),
      ...(has(`${BASE}/manage-documents`)
        ? [{ href: `${BASE}/manage-documents`, label: 'Documents', icon: Files, ariaLabel: 'Manage documents' }]
        : []),
      ...(has(`${BASE}/reports`) ? [{ href: `${BASE}/reports`, label: 'Reports', icon: FileBarChart }] : []),
    ];

    const moreLinks: ModuleMoreLink[] = items.map((item) => ({
      href: item.href,
      label: item.label,
      icon: item.icon,
      group: item.group,
      exact: item.exact,
    }));

    return { tabs, moreLinks };
  }, [items, isLoading]);

  return <ModuleBottomNav tabs={tabs} moreLinks={moreLinks} moduleName="Daily Requisition" />;
}

export default DailyRequisitionBottomNav;

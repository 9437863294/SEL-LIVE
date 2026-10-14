'use client';

import { usePathname } from 'next/navigation';
import { useMemo, type ReactNode } from 'react';
import { ClipboardCheck, FileBarChart, FilePlus, Files, LayoutDashboard } from 'lucide-react';
import { ModuleShell, type ModuleNavGroup, type ModuleNavTab, type ModuleNavTone } from '@/components/shared/module-shell';
import {
  DAILY_REQUISITION_BASE as BASE,
  groupDailyRequisitionNav,
  isDailyRequisitionPrintRoute,
  useDailyRequisitionNav,
  type DailyRequisitionNavItem,
} from './nav';

/** The entry's chip colour (`text-emerald-700`) as the shared shell's tone. */
const toneOf = (color: string) => (/text-([a-z]+)-\d+/.exec(color)?.[1] ?? 'slate') as ModuleNavTone;

/** An entry lit by `alsoActiveOn` pages as well as its own path and the pages under it. */
const matchOf = (item: DailyRequisitionNavItem) => {
  if (item.exact) return 'exact' as const;
  if (!item.alsoActiveOn?.length) return undefined;
  const paths = [item.href, ...item.alsoActiveOn];
  return (pathname: string) => paths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
};

/**
 * Daily Requisition on the shared `ModuleShell`: the dashboard, the entry sheet, every configured
 * workflow stage, documents, each report and the one Settings entry, grouped — the same list
 * (`nav.ts`) the phone's bottom bar and its "More" pop-up read.
 *
 * There is no module-wide gate: each page gates itself, and the menu offers only the pages that
 * would open. The shell is rendered while permissions load too, so the page never remounts when
 * they resolve. Print routes (`print` as a whole segment, never /settings/printing) get the page alone.
 */
export default function DailyRequisitionLayoutShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() || '';
  const { items, isLoading } = useDailyRequisitionNav();

  const groups = useMemo<ModuleNavGroup[]>(
    () =>
      groupDailyRequisitionNav(items).map((group) => ({
        id: group.name,
        label: group.name,
        items: group.items.map((item) => ({
          id: item.href,
          href: item.href,
          label: item.label,
          icon: item.icon,
          tone: toneOf(item.color),
          match: matchOf(item),
        })),
      })),
    [items],
  );

  // The phone's bottom bar: Home, the entry sheet, documents and the reports page are tabs, and
  // "More" opens every page. Entries are added from a dialog on the entry sheet, so there is no
  // create tab; the stages' configured names run long, so they live in "More".
  const mobileTabs = useMemo<ModuleNavTab[]>(() => {
    if (isLoading) return [];
    const has = (href: string) => items.some((item) => item.href === href);
    return [
      { href: BASE, label: 'Home', icon: LayoutDashboard, exact: true },
      ...(has(`${BASE}/entry-sheet`)
        ? [{ href: `${BASE}/entry-sheet`, label: 'Entries', icon: FilePlus, ariaLabel: 'Entry sheet' }]
        : []),
      ...(has(`${BASE}/manage-documents`)
        ? [{ href: `${BASE}/manage-documents`, label: 'Documents', icon: Files, ariaLabel: 'Manage documents' }]
        : []),
      ...(has(`${BASE}/reports`) ? [{ href: `${BASE}/reports`, label: 'Reports', icon: FileBarChart }] : []),
    ];
  }, [items, isLoading]);

  return (
    <ModuleShell
      title="Daily Requisition"
      subtitle="Receiving to payment"
      icon={ClipboardCheck}
      groups={groups}
      mobileTabs={mobileTabs}
      bare={isDailyRequisitionPrintRoute(pathname)}
    >
      {children}
    </ModuleShell>
  );
}

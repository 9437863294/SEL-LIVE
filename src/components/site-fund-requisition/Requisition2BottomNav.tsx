'use client';

import { BarChart3, FileText, LayoutDashboard, Settings } from 'lucide-react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { ModuleBottomNav, type ModuleNavTab } from '@/components/navigation/ModuleBottomNav';

const MODULE = 'Site Fund Requisition 2';
const BASE = '/site-fund-requisition-2';

/**
 * The phone's bottom bar for Site Fund Requisition 2, which has no module shell — its layout is a
 * server component that only paints the backdrop, and the dashboard's cards were the only way
 * between its pages. The module has four fixed destinations, so they are all tabs and there is no
 * "More"; the workflow stage queues stay on the dashboard, where they are loaded from the workflow.
 * Each tab is gated exactly as the dashboard gates its card.
 */
export default function Requisition2BottomNav() {
  const { can, isLoading } = useAuthorization();

  if (isLoading || !can('View Module', MODULE)) return null;

  const tabs: ModuleNavTab[] = [
    { href: BASE, label: 'Home', icon: LayoutDashboard, exact: true },
    ...(can('View', `${MODULE}.Requests`) ? [{ href: `${BASE}/requests`, label: 'Requests', icon: FileText }] : []),
    ...(can('View', `${MODULE}.Reports`) ? [{ href: `${BASE}/reports`, label: 'Reports', icon: BarChart3 }] : []),
    ...(can('View', `${MODULE}.Settings`) ? [{ href: `${BASE}/settings`, label: 'Settings', icon: Settings }] : []),
  ];

  return <ModuleBottomNav tabs={tabs} moduleName={MODULE} />;
}

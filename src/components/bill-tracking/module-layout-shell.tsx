'use client';

/**
 * Bill Tracking's module frame, on the shared module shell: sidebar on desktop, header and bottom
 * bar on a phone, like every other finance module.
 *
 * Access is decided by the server: the shell loads `/api/bill-tracking/lookups`, which refuses a user
 * without the module, and returns the user's permissions with project scope already applied. Each
 * page is listed only if that permission is held, and a page reached by URL without it is refused
 * here as well as by its API.
 */

import { usePathname } from 'next/navigation';
import { useMemo } from 'react';
import {
  BarChart3,
  Clock,
  FileSpreadsheet,
  Hourglass,
  LayoutDashboard,
  PiggyBank,
  Plus,
  ReceiptIndianRupee,
  Scissors,
  Settings,
  ShieldAlert,
  Target,
  Upload,
  UserCheck,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

import { ModuleShell, type ModuleNavGroup, type ModuleNavTab, type ModuleNavTone } from '@/components/shared/module-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { TooltipProvider } from '@/components/ui/tooltip';

import { BillTrackingProvider, useBt } from './bt-client';

type NavItem = { href: string; label: string; resource: string; action?: string; icon: LucideIcon; tone: ModuleNavTone; group: string };

const NAV: NavItem[] = [
  { href: '/bill-tracking/dashboard', label: 'Dashboard', resource: 'Dashboard', icon: LayoutDashboard, tone: 'emerald', group: 'overview' },
  { href: '/bill-tracking/bills', label: 'Bill Register', resource: 'Bills', icon: ReceiptIndianRupee, tone: 'blue', group: 'bills' },
  { href: '/bill-tracking/outstanding', label: 'Outstanding', resource: 'Bills', icon: Clock, tone: 'rose', group: 'bills' },
  { href: '/bill-tracking/collections', label: 'Collections', resource: 'Collections', icon: Wallet, tone: 'teal', group: 'bills' },
  { href: '/bill-tracking/ageing', label: 'Ageing', resource: 'Reports', icon: Hourglass, tone: 'amber', group: 'control' },
  { href: '/bill-tracking/retention', label: 'Retention', resource: 'Retention', icon: PiggyBank, tone: 'violet', group: 'control' },
  { href: '/bill-tracking/deductions', label: 'Deductions', resource: 'Reports', icon: Scissors, tone: 'orange', group: 'control' },
  { href: '/bill-tracking/targets', label: 'Targets & Forecast', resource: 'Targets', icon: Target, tone: 'sky', group: 'control' },
  { href: '/bill-tracking/reports', label: 'Reports', resource: 'Reports', icon: BarChart3, tone: 'fuchsia', group: 'insights' },
  { href: '/bill-tracking/import', label: 'Excel Import', resource: 'Import', icon: Upload, tone: 'indigo', group: 'data' },
  { href: '/bill-tracking/settings', label: 'Settings', resource: 'Settings', icon: Settings, tone: 'slate', group: 'data' },
];

const GROUP_LABELS: Record<string, string> = { overview: 'Overview', bills: 'Bills & Collections', control: 'Control', insights: 'Insights', data: 'Data & Settings' };

// Named on a Settings → Workflow stage: their queue, whatever their role permissions.
const WAITING_ITEM: NavItem = { href: '/bill-tracking/bills?mine=1', label: 'Waiting for me', resource: 'Bills', icon: UserCheck, tone: 'emerald', group: 'overview' };

const matchesPath = (pathname: string, href: string) =>
  href === '/bill-tracking/dashboard' ? pathname === '/bill-tracking' || pathname.startsWith(href) : pathname === href || pathname.startsWith(`${href}/`);

/**
 * Where `/bill-tracking` lands: the Dashboard for whoever may see it; else, for someone named on a
 * workflow step, their queue; else the first page they may open. Null when there is none.
 */
export function landingPage(can: (resource: string, action: string) => boolean, workflowAssigned: boolean): string | null {
  const allowed = NAV.filter((item) => can(item.resource, item.action ?? 'View'));
  if (allowed[0]?.href === '/bill-tracking/dashboard') return allowed[0].href;
  if (workflowAssigned) return WAITING_ITEM.href;
  return allowed[0]?.href ?? null;
}

function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '';
  const { lookups, loading, error, reload, can } = useBt();

  const navItems = useMemo(
    () => {
      if (!lookups) return [];
      const allowed = NAV.filter((item) => can(item.resource, item.action ?? 'View'));
      if (!lookups.workflowAssigned) return allowed;
      // The queue sits right after the dashboard, which stays the module's first entry.
      const afterDashboard = allowed[0]?.href === '/bill-tracking/dashboard' ? 1 : 0;
      return [...allowed.slice(0, afterDashboard), WAITING_ITEM, ...allowed.slice(afterDashboard)];
    },
    [can, lookups],
  );
  const groups = useMemo<ModuleNavGroup[]>(() => {
    const list: ModuleNavGroup[] = [];
    for (const item of navItems) {
      let group = list.find((entry) => entry.id === item.group);
      if (!group) {
        group = { id: item.group, label: GROUP_LABELS[item.group], items: [] };
        list.push(group);
      }
      group.items.push({
        id: item.href,
        label: item.label,
        href: item.href,
        icon: item.icon,
        tone: item.tone,
        // The queue is the register with a filter: it never claims the register's highlight.
        match: item === WAITING_ITEM ? () => false : (path: string) => matchesPath(path, item.href),
      });
    }
    return list;
  }, [navItems]);

  if (!lookups && !loading) {
    return (
      <div className="w-full p-6">
        <Card>
          <CardContent className="space-y-3 py-14 text-center">
            <ShieldAlert className="mx-auto h-12 w-12 text-destructive" />
            <p className="font-semibold text-slate-800">Bill Tracking is not available</p>
            <p className="text-sm text-muted-foreground">{error ?? 'You do not have access to Bill Tracking.'}</p>
            <Button variant="outline" size="sm" onClick={() => void reload()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // The module's own address only forwards to the first page allowed (`landingPage`), so it is never refused.
  const pageAllowed = pathname === '/bill-tracking' || navItems.some((item) => matchesPath(pathname, item.href.split('?')[0]));
  const isVisible = (href: string) => navItems.some((item) => item.href === href);
  const bottomTabs: ModuleNavTab[] = [
    ...(isVisible('/bill-tracking/dashboard') ? [{ href: '/bill-tracking/dashboard', label: 'Home', icon: LayoutDashboard, match: (path: string) => matchesPath(path, '/bill-tracking/dashboard') }] : []),
    ...(isVisible('/bill-tracking/bills') ? [{ href: '/bill-tracking/bills', label: 'Bills', icon: ReceiptIndianRupee, exact: true }] : []),
    ...(can('Collections', 'Add') ? [{ href: '/bill-tracking/collections/new', label: 'Receive', icon: Plus, emphasized: true, ariaLabel: 'Record a receipt' }] : []),
    ...(isVisible('/bill-tracking/outstanding') ? [{ href: '/bill-tracking/outstanding', label: 'Outstanding', icon: Clock }] : []),
    ...(isVisible('/bill-tracking/import') ? [{ href: '/bill-tracking/import', label: 'Import', icon: FileSpreadsheet }] : []),
  ];
  const subtitle = !lookups
    ? 'Billing & Collections'
    : lookups.allProjects
      ? 'All projects'
      : `${lookups.projects.length} assigned project${lookups.projects.length === 1 ? '' : 's'}`;

  return (
    <ModuleShell
      title="Bill Tracking"
      subtitle={subtitle}
      icon={ReceiptIndianRupee}
      groups={groups}
      mobileTabs={bottomTabs}
      gate={{
        loading: loading && !lookups,
        allowed: true,
        pageAllowed,
        pageDeniedMessage: 'You do not have permission to view this Bill Tracking page.',
      }}
    >
      <TooltipProvider delayDuration={200}>
        <div className="space-y-4">{children}</div>
      </TooltipProvider>
    </ModuleShell>
  );
}

export default function BillTrackingLayoutShell({ children }: { children: React.ReactNode }) {
  return (
    <BillTrackingProvider>
      <Shell>{children}</Shell>
    </BillTrackingProvider>
  );
}

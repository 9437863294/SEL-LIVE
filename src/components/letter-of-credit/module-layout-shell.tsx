'use client';

import { useMemo, type ReactNode } from 'react';
import {
  BarChart3,
  BookOpenCheck,
  CalendarClock,
  ClipboardCheck,
  FileArchive,
  FileDown,
  FilePlus2,
  FileText,
  Landmark,
  LayoutDashboard,
  LayoutList,
  Link2,
  PencilRuler,
  Plus,
  ReceiptIndianRupee,
  Settings2,
  Ship,
  Undo2,
  UsersRound,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { LC_PERMISSION_MODULE } from '@/lib/letter-of-credit';
import { ModuleShell, type ModuleNavGroup, type ModuleNavTab, type ModuleNavTone } from '@/components/shared/module-shell';

type Section = { href: string; label: string; resource: string; icon: LucideIcon; tone: ModuleNavTone };

const sections: Section[] = [
  { href: '/letter-of-credit', label: 'LC Dashboard', resource: 'Dashboard', icon: BarChart3, tone: 'cyan' },
  { href: '/letter-of-credit/new', label: 'New LC Request', resource: 'LC Requests', icon: FilePlus2, tone: 'emerald' },
  { href: '/letter-of-credit/register', label: 'LC Register', resource: 'LC Register', icon: LayoutList, tone: 'blue' },
  { href: '/letter-of-credit/approvals', label: 'Pending Approvals', resource: 'Pending Approvals', icon: ClipboardCheck, tone: 'violet' },
  { href: '/letter-of-credit/opening', label: 'LC Opening', resource: 'LC Opening', icon: Landmark, tone: 'indigo' },
  { href: '/letter-of-credit/hundis', label: 'Hundis & Bills', resource: 'Hundis & Bills', icon: ReceiptIndianRupee, tone: 'amber' },
  { href: '/letter-of-credit/documents', label: 'Shipments & Documents', resource: 'Shipment & Documents', icon: Ship, tone: 'sky' },
  { href: '/letter-of-credit/due-calendar', label: 'Payment Due Calendar', resource: 'Payment Due Calendar', icon: CalendarClock, tone: 'orange' },
  { href: '/letter-of-credit/payments', label: 'Payment Processing', resource: 'Payment Processing', icon: WalletCards, tone: 'rose' },
  { href: '/letter-of-credit/amendments', label: 'LC Amendments', resource: 'LC Amendments', icon: PencilRuler, tone: 'fuchsia' },
  { href: '/letter-of-credit/vendor-settlement', label: 'Vendor Settlement', resource: 'Vendor Settlement', icon: UsersRound, tone: 'teal' },
  { href: '/letter-of-credit/client-recovery', label: 'Client Recovery', resource: 'Client Recovery', icon: Undo2, tone: 'lime' },
  { href: '/letter-of-credit/margins', label: 'Margin & FD Linkage', resource: 'Margin & FD Linkage', icon: Link2, tone: 'cyan' },
  { href: '/letter-of-credit/closures', label: 'LC Closure', resource: 'LC Closure', icon: FileArchive, tone: 'slate' },
  { href: '/letter-of-credit/reports', label: 'Reports', resource: 'Reports', icon: FileText, tone: 'blue' },
  { href: '/letter-of-credit/import', label: 'Import & Reconcile', resource: 'Import & Reconciliation', icon: FileDown, tone: 'emerald' },
  { href: '/letter-of-credit/settings', label: 'Settings', resource: 'Settings', icon: Settings2, tone: 'slate' },
];

type Can = ReturnType<typeof useAuthorization>['can'];

/** The menu entry's permission: the dashboard for anyone in the module, the rest by View, Add or Request on their resource. */
const canSee = (can: Can, section: Section) => section.resource === 'Dashboard' || can('View', `${LC_PERMISSION_MODULE}.${section.resource}`) || can('Add', `${LC_PERMISSION_MODULE}.${section.resource}`) || can('Request', `${LC_PERMISSION_MODULE}.${section.resource}`);
const isDashboard = (path: string) => path === '/letter-of-credit' || path === '/letter-of-credit/dashboard';

export default function LetterOfCreditLayoutShell({ children }: { children: ReactNode }) {
  const { can, isLoading } = useAuthorization();
  const canViewModule = can('View Module', LC_PERMISSION_MODULE) || sections.some((section) => can('View', `${LC_PERMISSION_MODULE}.${section.resource}`));

  const groups = useMemo<ModuleNavGroup[]>(() => [{
    id: 'main',
    items: sections.map((section) => ({
      id: section.href,
      href: section.href,
      label: section.label,
      icon: section.icon,
      tone: section.tone,
      visible: canSee(can, section),
      match: section.href === '/letter-of-credit' ? isDashboard : undefined,
    })),
  }], [can]);

  // The phone's bottom bar: the dashboard, the register, raising an LC request in the middle,
  // approvals, and "More" opening the pop-up of every page. Each tab only if its menu entry is visible too.
  const isVisible = (href: string) => sections.some((section) => section.href === href && canSee(can, section));
  const bottomTabs: ModuleNavTab[] = [
    { href: '/letter-of-credit', label: 'Home', icon: LayoutDashboard, match: isDashboard },
    ...(isVisible('/letter-of-credit/register') ? [{ href: '/letter-of-credit/register', label: 'Register', icon: LayoutList }] : []),
    ...(can('Add', `${LC_PERMISSION_MODULE}.LC Requests`)
      ? [{ href: '/letter-of-credit/new', label: 'New', icon: Plus, emphasized: true, ariaLabel: 'New letter of credit request' }]
      : []),
    ...(isVisible('/letter-of-credit/approvals') ? [{ href: '/letter-of-credit/approvals', label: 'Approvals', icon: ClipboardCheck }] : []),
  ];

  return (
    <ModuleShell
      title="Letter of Credit"
      subtitle="Trade Finance Control"
      icon={BookOpenCheck}
      groups={groups}
      mobileTabs={bottomTabs}
      gate={{ loading: isLoading, allowed: canViewModule, deniedMessage: 'You do not have permission to access Letter of Credit Management.' }}
    >
      {children}
    </ModuleShell>
  );
}

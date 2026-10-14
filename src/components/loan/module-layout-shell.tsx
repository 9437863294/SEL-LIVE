'use client';

import * as React from 'react';
import { BarChart3, Briefcase, CalendarCheck, CreditCard, LayoutDashboard, Plus } from 'lucide-react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useCompanyProfile } from '@/hooks/use-company-profile';
import { ModuleShell, type ModuleNavGroup, type ModuleNavTab } from '@/components/shared/module-shell';

export default function LoanLayoutShell({ children }: { children: React.ReactNode }) {
  const { can } = useAuthorization();
  const { profile } = useCompanyProfile();
  const canCreate = can('Create', 'Loan');

  const groups = React.useMemo<ModuleNavGroup[]>(() => [
    {
      id: 'main',
      items: [
        { id: 'dashboard', href: '/loan', icon: LayoutDashboard, label: 'Dashboard', visible: can('View', 'Loan.Dashboard'), tone: 'emerald', match: 'exact' },
        { id: 'manage', href: '/loan/manage', icon: Briefcase, label: 'Manage Loans', visible: can('View', 'Loan.Dashboard'), tone: 'blue' },
        { id: 'emi-summary', href: '/loan/emi-summary', icon: CalendarCheck, label: 'EMI Tracker', visible: can('View', 'Loan.Dashboard'), tone: 'violet' },
        { id: 'reports', href: '/loan/reports', icon: BarChart3, label: 'Reports', visible: can('View', 'Loan.Reports'), tone: 'indigo' },
      ],
    },
    { id: 'create', items: [{ id: 'new', href: '/loan/new', icon: Plus, label: 'New Loan', visible: can('Create', 'Loan'), tone: 'emerald' }] },
  ], [can]);

  // On a phone the menu gives way to the bottom bar. The module is small enough for every menu
  // destination to be a tab — creating a loan in the middle.
  const isVisible = (href: string) => groups.some(group => group.items.some(item => item.href === href && item.visible !== false));
  const bottomTabs: ModuleNavTab[] = [
    ...(isVisible('/loan') ? [{ href: '/loan', label: 'Home', icon: LayoutDashboard, exact: true }] : []),
    ...(isVisible('/loan/manage') ? [{ href: '/loan/manage', label: 'Loans', icon: Briefcase, ariaLabel: 'Manage loans' }] : []),
    ...(canCreate ? [{ href: '/loan/new', label: 'New', icon: Plus, emphasized: true, ariaLabel: 'New loan' }] : []),
    ...(isVisible('/loan/emi-summary') ? [{ href: '/loan/emi-summary', label: 'EMIs', icon: CalendarCheck, ariaLabel: 'EMI tracker' }] : []),
    ...(isVisible('/loan/reports') ? [{ href: '/loan/reports', label: 'Reports', icon: BarChart3 }] : []),
  ];

  return (
    <ModuleShell title="Loans" icon={CreditCard} groups={groups} mobileTabs={bottomTabs}>
      {children}
      <footer className="mt-6 flex items-center border-t border-border/40 py-3 text-xs text-muted-foreground print:hidden">
        <span>Copyright © {new Date().getFullYear()} {profile.shortName || profile.legalName}. All Rights Reserved.</span>
      </footer>
    </ModuleShell>
  );
}

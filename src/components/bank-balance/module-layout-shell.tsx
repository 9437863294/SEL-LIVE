'use client';

import Link from 'next/link';
import { useMemo, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Landmark, LayoutDashboard, Plus } from 'lucide-react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { ModuleShell, type ModuleNavGroup, type ModuleNavTab, type ModuleNavTone } from '@/components/shared/module-shell';
import { activeBankBalanceHref, useBankBalanceNav } from './nav';

/** The icon tile colour of each menu entry (formerly its `color`/`bg` chip classes). */
const TONES: Record<string, ModuleNavTone> = {
  '/bank-balance': 'violet',
  '/bank-balance/expenses': 'red',
  '/bank-balance/receipts': 'green',
  '/bank-balance/internal-transaction': 'blue',
  '/bank-balance/cheques': 'indigo',
  '/bank-balance/daily-log': 'blue',
  '/bank-balance/reports/bank-position': 'blue',
  '/bank-balance/reports/account-statement': 'amber',
  '/bank-balance/reports/dp-utilization': 'rose',
  '/bank-balance/reports/interest-accrual': 'violet',
  '/bank-balance/reports/transaction-summary': 'sky',
  '/bank-balance/settings': 'slate',
};

/**
 * Bank Balance on the shared module shell: every page of the module, grouped, including each
 * report and the module settings. The menu itself is `useBankBalanceNav` (also read by the
 * reports hub), and an entry stays lit for the pages it owns (`activeBankBalanceHref`).
 *
 * Access is still each page's call. Without module access, or while it is being resolved, no
 * chrome is drawn and the page shows its own skeleton or Access Denied card.
 */
export default function BankBalanceLayoutShell({ children }: { children: ReactNode }) {
  const { can } = useAuthorization();
  const { items, isLoading, canViewModule } = useBankBalanceNav();

  const groups = useMemo<ModuleNavGroup[]>(() => {
    const list: ModuleNavGroup[] = [];
    for (const item of items) {
      let group = list.find((entry) => entry.id === item.group);
      if (!group) {
        group = { id: item.group, label: item.group, items: [] };
        list.push(group);
      }
      group.items.push({
        id: item.href,
        label: item.label,
        href: item.href,
        icon: item.icon,
        tone: TONES[item.href],
        match: (path: string) => activeBankBalanceHref(path, items) === item.href,
      });
    }
    return list;
  }, [items]);

  // The phone's bar: Payments and Receipts either side of the first daily entry the user may
  // record; "More" lists every other page, then the remaining daily entries.
  const entries = [
    { href: '/bank-balance/expenses/new', label: 'New Payment', allowed: can('Add', 'Bank Balance.Expenses') },
    { href: '/bank-balance/receipts/new', label: 'New Receipt', allowed: can('Add', 'Bank Balance.Receipts') },
    { href: '/bank-balance/internal-transaction/new', label: 'New Transfer', allowed: can('Add', 'Bank Balance.Internal Transaction') },
  ].filter((entry) => entry.allowed);
  const [newEntry, ...otherEntries] = entries;
  const mobileTabs: ModuleNavTab[] = [
    { href: '/bank-balance', label: 'Home', icon: LayoutDashboard, exact: true },
    ...(can('View', 'Bank Balance.Expenses') ? [{ href: '/bank-balance/expenses', label: 'Payments', icon: ArrowDown }] : []),
    ...(newEntry ? [{ href: newEntry.href, label: 'New', icon: Plus, emphasized: true, ariaLabel: newEntry.label }] : []),
    ...(can('View', 'Bank Balance.Receipts') ? [{ href: '/bank-balance/receipts', label: 'Receipts', icon: ArrowUp }] : []),
  ];
  const mobileMoreContent = otherEntries.length ? (
    <div className="grid grid-cols-2 gap-2">
      {otherEntries.map((entry) => (
        <Link
          key={entry.href}
          href={entry.href}
          className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted"
        >
          <Plus className="h-4 w-4 shrink-0" aria-hidden />
          <span className="truncate">{entry.label}</span>
        </Link>
      ))}
    </div>
  ) : undefined;

  if (isLoading || !canViewModule || items.length === 0) return <>{children}</>;

  return (
    <ModuleShell
      title="Bank Balance"
      subtitle="Treasury & Cash Credit"
      icon={Landmark}
      groups={groups}
      mobileTabs={mobileTabs}
      mobileMoreContent={mobileMoreContent}
    >
      {children}
    </ModuleShell>
  );
}

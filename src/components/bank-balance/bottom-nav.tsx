'use client';

import { ArrowDown, ArrowUp, LayoutDashboard, Plus } from 'lucide-react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { ModuleBottomNav, type ModuleMoreLink, type ModuleNavTab } from '@/components/navigation/ModuleBottomNav';
import { useBankBalanceNav } from './nav';

/**
 * The phone's bottom bar for Bank Balance. Its desktop sidebar is hidden below `lg`, so this is
 * the phone's way round the module: Payments and Receipts are tabs, the first daily entry the user
 * may record sits in the middle, and "More" opens a sheet of every other page — the same list the
 * sidebar draws, reports included. Nothing shows without module access.
 */
export default function BankBalanceBottomNav() {
  const { can, isLoading } = useAuthorization();
  const { items } = useBankBalanceNav();
  if (isLoading || !can('View Module', 'Bank Balance')) return null;

  // The dashboard's "Daily Entry" choices, in its order. The first one allowed becomes the New tab.
  const entries = [
    { href: '/bank-balance/expenses/new', label: 'New Payment', allowed: can('Add', 'Bank Balance.Expenses') },
    { href: '/bank-balance/receipts/new', label: 'New Receipt', allowed: can('Add', 'Bank Balance.Receipts') },
    { href: '/bank-balance/internal-transaction/new', label: 'New Transfer', allowed: can('Add', 'Bank Balance.Internal Transaction') },
  ].filter(entry => entry.allowed);
  const [newEntry, ...otherEntries] = entries;

  const tabs: ModuleNavTab[] = [
    { href: '/bank-balance', label: 'Home', icon: LayoutDashboard, exact: true },
    ...(can('View', 'Bank Balance.Expenses') ? [{ href: '/bank-balance/expenses', label: 'Payments', icon: ArrowDown }] : []),
    ...(newEntry ? [{ href: newEntry.href, label: 'New', icon: Plus, emphasized: true, ariaLabel: newEntry.label }] : []),
    ...(can('View', 'Bank Balance.Receipts') ? [{ href: '/bank-balance/receipts', label: 'Receipts', icon: ArrowUp }] : []),
  ];
  const onTabs = new Set(tabs.map(tab => tab.href));

  const moreLinks: ModuleMoreLink[] = items
    .filter(item => !onTabs.has(item.href))
    .map(item => ({ href: item.href, label: item.label, icon: item.icon, group: item.group }));
  // The remaining daily entries close the Entries group, as they always have.
  const entriesEnd = moreLinks.reduce((last, link, index) => (link.group === 'Entries' ? index + 1 : last), 0);
  moreLinks.splice(entriesEnd, 0, ...otherEntries.map(entry => ({ href: entry.href, label: entry.label, icon: Plus, group: 'Entries' })));

  return <ModuleBottomNav tabs={tabs} moreLinks={moreLinks} moduleName="Bank Balance" />;
}

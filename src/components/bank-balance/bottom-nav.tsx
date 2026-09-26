'use client';

import {
  ArrowDown, ArrowRightLeft, ArrowUp, BarChart3, CalendarDays, FilePen, Landmark,
  LayoutDashboard, List, Percent, Plus, Settings, Target, TrendingUp,
} from 'lucide-react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { ModuleBottomNav, type ModuleMoreLink, type ModuleNavTab } from '@/components/navigation/ModuleBottomNav';

/**
 * The phone's bottom bar for Bank Balance, which has no sidebar of its own: its pages are reached
 * from the dashboard. Payments and Receipts are tabs, the first daily entry the user may record
 * sits in the middle, and "More" opens a sheet of the rest. Every link is gated exactly as its
 * page gates itself, and nothing shows without module access — the dashboard would refuse anyway.
 */
export default function BankBalanceBottomNav() {
  const { can, isLoading } = useAuthorization();
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

  const links: Array<ModuleMoreLink & { allowed: boolean }> = [
    { href: '/bank-balance/internal-transaction', label: 'Transfers', icon: ArrowRightLeft, group: 'Entries', allowed: can('View', 'Bank Balance.Internal Transaction') },
    { href: '/bank-balance/daily-log', label: 'Daily Log', icon: List, group: 'Entries', allowed: can('View', 'Bank Balance.Daily Log') },
    ...otherEntries.map(entry => ({ href: entry.href, label: entry.label, icon: Plus, group: 'Entries', allowed: true })),
    { href: '/bank-balance/interest-rate', label: 'Interest Rate', icon: Percent, group: 'Interest & DP', allowed: can('View', 'Bank Balance.Interest Rate') },
    { href: '/bank-balance/monthly-interest', label: 'Monthly Interest', icon: CalendarDays, group: 'Interest & DP', allowed: can('View', 'Bank Balance.Monthly Interest') },
    { href: '/bank-balance/dp-management', label: 'DP Management', icon: TrendingUp, group: 'Interest & DP', allowed: can('View', 'Bank Balance.DP Management') },
    { href: '/bank-balance/opening-utilization', label: 'Opening Utilization', icon: Target, group: 'Interest & DP', allowed: can('View', 'Bank Balance.Opening Utilization') },
    { href: '/bank-balance/reports', label: 'Reports', icon: BarChart3, group: 'Reports & Setup', allowed: can('View', 'Bank Balance.Reports') },
    { href: '/bank-balance/accounts', label: 'Bank Accounts', icon: Landmark, group: 'Reports & Setup', allowed: can('View', 'Bank Balance.Accounts') },
    {
      href: '/bank-balance/settings/payment-entry', label: 'Payment Entry Settings', icon: FilePen, group: 'Reports & Setup',
      allowed: can('View', 'Bank Balance.Payment Entry Settings') || can('Add', 'Bank Balance.Expenses'),
    },
    { href: '/bank-balance/settings', label: 'Settings', icon: Settings, group: 'Reports & Setup', allowed: true },
  ];
  const moreLinks: ModuleMoreLink[] = links.filter(link => link.allowed);

  return <ModuleBottomNav tabs={tabs} moreLinks={moreLinks} moduleName="Bank Balance" />;
}

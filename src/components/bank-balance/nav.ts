'use client';

import {
  ArrowDown,
  ArrowRightLeft,
  ArrowUp,
  Banknote,
  BookOpenCheck,
  CalendarDays,
  FileText,
  Gauge,
  LayoutDashboard,
  LayoutGrid,
  Settings,
  Sigma,
  type LucideIcon,
} from 'lucide-react';
import { useAuthorization } from '@/hooks/useAuthorization';

export type BankBalanceNavGroup = 'Overview' | 'Entries' | 'Reports' | 'Setup';

export interface BankBalanceNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  group: BankBalanceNavGroup;
  /** Icon chip colours in the desktop sidebar. */
  color: string;
  bg: string;
  /** Other pages that belong to this entry, so it stays highlighted while one of them is open. */
  also?: string[];
}

/**
 * The pages opened from the cards on /bank-balance/settings. They are deliberately not menu
 * entries of their own: the Settings page is how they are reached, and "Settings" stays lit while
 * one is open.
 */
const SETTINGS_PAGES = [
  '/bank-balance/accounts',
  '/bank-balance/dp-management',
  '/bank-balance/interest-rate',
  '/bank-balance/monthly-interest',
];

/**
 * The Bank Balance menu, in order, each entry gated exactly as its page gates itself.
 *
 * One list for both menus — the desktop sidebar and the phone's "More" sheet — so a page added to
 * one cannot go missing from the other. The reports used to be reachable only through the card
 * grid at /bank-balance/reports; they are listed here individually instead. The setup pages are
 * not: they stay on the Settings page (see `SETTINGS_PAGES`).
 */
export function useBankBalanceNav(): { items: BankBalanceNavItem[]; isLoading: boolean; canViewModule: boolean } {
  const { can, isLoading } = useAuthorization();
  const canViewModule = !isLoading && can('View Module', 'Bank Balance');
  const canViewReports = can('View', 'Bank Balance.Reports');

  const all: Array<BankBalanceNavItem & { allowed: boolean }> = [
    { href: '/bank-balance', label: 'Dashboard', icon: LayoutDashboard, group: 'Overview', color: 'text-violet-700', bg: 'bg-violet-50', allowed: true },

    { href: '/bank-balance/expenses', label: 'Payments', icon: ArrowDown, group: 'Entries', color: 'text-red-700', bg: 'bg-red-50', allowed: can('View', 'Bank Balance.Expenses') },
    { href: '/bank-balance/receipts', label: 'Receipts', icon: ArrowUp, group: 'Entries', color: 'text-green-700', bg: 'bg-green-50', allowed: can('View', 'Bank Balance.Receipts') },
    { href: '/bank-balance/internal-transaction', label: 'Transfers', icon: ArrowRightLeft, group: 'Entries', color: 'text-blue-700', bg: 'bg-blue-50', allowed: can('View', 'Bank Balance.Internal Transaction') || canViewReports },
    { href: '/bank-balance/cheques', label: 'Cheque Register', icon: BookOpenCheck, group: 'Entries', color: 'text-indigo-700', bg: 'bg-indigo-50', allowed: can('View', 'Bank Balance.Expenses') },

    { href: '/bank-balance/daily-log', label: 'Daily Log', icon: CalendarDays, group: 'Reports', color: 'text-blue-700', bg: 'bg-blue-50', allowed: can('View', 'Bank Balance.Daily Log') },
    { href: '/bank-balance/reports/bank-position', label: 'Bank Position', icon: Banknote, group: 'Reports', color: 'text-blue-700', bg: 'bg-blue-50', allowed: canViewReports },
    { href: '/bank-balance/reports/account-statement', label: 'Account Statement', icon: FileText, group: 'Reports', color: 'text-amber-700', bg: 'bg-amber-50', allowed: canViewReports },
    { href: '/bank-balance/reports/dp-utilization', label: 'DP Utilization', icon: Gauge, group: 'Reports', color: 'text-rose-700', bg: 'bg-rose-50', allowed: canViewReports },
    { href: '/bank-balance/reports/interest-accrual', label: 'Interest Report', icon: Sigma, group: 'Reports', color: 'text-violet-700', bg: 'bg-violet-50', allowed: canViewReports },
    { href: '/bank-balance/reports/transaction-summary', label: 'Transaction Summary', icon: LayoutGrid, group: 'Reports', color: 'text-sky-700', bg: 'bg-sky-50', allowed: canViewReports },

    {
      href: '/bank-balance/settings', label: 'Settings', icon: Settings, group: 'Setup', color: 'text-slate-700', bg: 'bg-slate-100', allowed: true,
      also: SETTINGS_PAGES,
    },
  ];

  const items = canViewModule ? all.filter((item) => item.allowed).map(({ allowed: _allowed, ...item }) => item) : [];
  return { items, isLoading, canViewModule };
}

/**
 * The menu entry a path belongs to: the longest matching href or `also` path, so
 * /bank-balance/expenses/new lights up "Payments" and /bank-balance/dp-management (and
 * /bank-balance/settings/payment-entry) light up "Settings".
 */
export function activeBankBalanceHref(pathname: string, items: BankBalanceNavItem[]): string | undefined {
  const matches = (base: string) => pathname === base || (base !== '/bank-balance' && pathname.startsWith(`${base}/`));
  let best: { href: string; length: number } | undefined;
  for (const item of items) {
    for (const base of [item.href, ...(item.also ?? [])]) {
      if (matches(base) && (!best || base.length > best.length)) best = { href: item.href, length: base.length };
    }
  }
  return best?.href;
}

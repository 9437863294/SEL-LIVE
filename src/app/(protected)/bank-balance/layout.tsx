import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import BankBalanceBottomNav from '@/components/bank-balance/bottom-nav';

export const metadata: Metadata = {
  title: 'Bank Balance | SEL Live',
  description: 'Monitor bank account balances, daily logs, internal transfers, receipts, and cash-flow statements in real time.',
};

export default function BankBalanceLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <BankBalanceBottomNav />
    </>
  );
}

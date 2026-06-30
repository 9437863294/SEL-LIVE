import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Store & Stock Management | SEL Live',
  description: 'Track inventory, manage stock-in and stock-out transactions, BOQ, assemblies, and generate stock reports by project.',
};

export default function StoreStockManagementLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SettingsModuleShell } from '@/components/store-stock-management/SettingsModuleShell';

export const metadata: Metadata = {
  title: 'Stock Management Settings | SEL Live',
  description: 'Configure inventory scope, projects, sites, units, locations, items, and GRN entry controls.',
};

export default function StockManagementSettingsLayout({ children }: { children: ReactNode }) {
  return <SettingsModuleShell>{children}</SettingsModuleShell>;
}

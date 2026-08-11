import { InventoryModuleShell } from '@/components/store-stock-management/InventoryModuleShell';

export default function InventoryLayout({ children }: { children: React.ReactNode }) {
  return <InventoryModuleShell>{children}</InventoryModuleShell>;
}


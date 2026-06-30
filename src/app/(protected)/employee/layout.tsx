import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Employee Management | SEL Live',
  description: 'Manage employee records, categories, salary details, position assignments, and synchronisation across the organisation.',
};

export default function EmployeeLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

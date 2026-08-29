import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Employee Management | SEL Live',
  description: 'Manage employee records, categories, salary details, position assignments, and synchronisation across the organisation.',
};

export default function EmployeeLayout({ children }: { children: ReactNode }) {
  return (
    // `hr-module-root` is the shared kit's phone ruleset (globals.css): 44px tap targets on buttons,
    // inputs and selects below 640px, horizontally scrolling tab strips, compacted card padding and
    // safe-area padding at the bottom. Applied once here so every employee screen inherits it —
    // these routes do not go through the HR module shell that would otherwise supply it.
    <div className="hr-module-root">{children}</div>
  );
}

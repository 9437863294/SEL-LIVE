'use client';

import ProjectManagementFieldControlSettings from '@/components/project-management/field-control-settings';

export default function FieldControlSettingsPage() {
  // Project Management's layout adds no padding of its own — every sibling settings screen brings
  // its own `main` — so this one does too, rather than running flush to the window edge.
  return (
    <main className="min-h-[calc(100dvh-4rem)] p-4 max-sm:[--card-pad:1rem] sm:p-6">
      <ProjectManagementFieldControlSettings />
    </main>
  );
}

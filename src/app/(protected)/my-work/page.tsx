'use client';

/**
 * `/my-work` — the central dashboard on its own route.
 *
 * The same board the home page opens with, addressable so it can be linked to: from the header,
 * from a notification, or from the Windows agent's morning screen, which already computes a subset
 * of these numbers and until now had nowhere in the web app to send somebody who wanted the detail
 * behind them.
 */

import AppShell from '@/components/app/AppShell';
import WorkDashboard from '@/components/work-dashboard/work-dashboard';

export default function MyWorkPage() {
  return (
    <AppShell>
      {/* Full width with the same minimal gutters as the home tab. */}
      <main className="w-full px-2 py-4 sm:px-3 md:px-4">
        <WorkDashboard />
      </main>
    </AppShell>
  );
}

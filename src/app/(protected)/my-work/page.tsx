'use client';

/**
 * `/my-work` — the central dashboard on its own route.
 *
 * The same board the home page opens with, addressable so it can be linked to: from the header,
 * from a notification, or from the Windows agent's morning screen, which already computes a subset
 * of these numbers and until now had nowhere in the web app to send somebody who wanted the detail
 * behind them.
 */

import WorkDashboard from '@/components/work-dashboard/work-dashboard';

export default function MyWorkPage() {
  return (
    // No AppShell here: the (protected) layout already provides it, and a second one drew a
    // second header (and breadcrumb bar) on this page.
    <main className="w-full px-2 py-4 sm:px-3 md:px-4">
      <WorkDashboard />
    </main>
  );
}

/**
 * `/employee/sync` — the greytHR sync console.
 *
 * Was a single "Sync All Employees" button calling a Genkit flow directly from the browser. That
 * button is still here (as "Sync now"), but it now goes through `/api/greythr/sync`, which
 * authorises server-side, reconciles rather than inserting, and records what it did.
 */

import { GreytHRSyncWorkspace } from '@/components/employee/greythr-sync-workspace';

export default function SyncEmployeePage() {
  return <GreytHRSyncWorkspace />;
}

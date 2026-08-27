import 'server-only';

/**
 * The CURRENT roster, live from greytHR, as complete `SyncedEmployee` records.
 *
 * A separate module rather than living in `greythr-client.ts` or `greythr-sync-service.ts`: the
 * client's own header says its whole job is "turn a request into typed rows, and nothing that
 * decides anything" — composing four endpoints into a built `SyncedEmployee` is a decision. The sync
 * service is Admin-SDK orchestration that only exists to write Firestore, which this deliberately
 * does not do. This sits between them: it calls the client, calls `buildSyncedEmployee`, and touches
 * no database.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────────────────────
 *
 * Two callers need exactly the same thing — "who does greytHR say currently works here, in full" —
 * and until this existed only one of them had it:
 *
 *   - `/employee/current`, the escape hatch for when the Firestore mirror is the thing under
 *     suspicion (stale, incomplete, or built before a derivation fix).
 *   - The Add User picker, which used to answer a narrower question first: it read the *mirror* for
 *     the list and only consulted the live roster to reclassify rows already there. An employee
 *     current in greytHR but never written into the mirror was invisible to it — the picker would
 *     say "128 active employees are in greytHR but not yet in the local mirror. Run Full resync to
 *     add them," which is a correct diagnosis and a bad answer: creating one login should not require
 *     rebuilding the mirror for everybody else first.
 *
 * Sharing this module means both now source from the same live call, so "does this person show up"
 * cannot depend on which of the two screens is asked.
 *
 * `currentInRoster: true` is passed for every row without qualification: these rows *are* greytHR's
 * CURRENT roster, so there is nothing to weigh against a leaving date or a separation record. That is
 * what keeps this immune to the placeholder-date failure mode elsewhere in this integration — it
 * never treats `leavingDate` as evidence of anything.
 */

import {
  buildSyncedEmployee,
  employmentTypeLabels,
  todayIso,
  type SyncedEmployee,
} from './greythr';
import {
  fetchEmployeeCategories,
  fetchEmployeeWork,
  fetchEmployees,
  fetchReferenceData,
} from './greythr-client';

export interface CurrentRosterResult {
  employees: SyncedEmployee[];
  fetchedAt: string;
}

/**
 * Four endpoints, three of them non-critical.
 *
 * Categories, work details and reference labels enrich the roster but a hiccup in any one of them
 * must not lose the roster itself — an administrator trying to find someone to hire is better served
 * by a plainer record than by an error page. Only the roster call itself (`state: 'CURRENT'`) is
 * allowed to fail the whole request, because without it there is nothing to return.
 */
export async function fetchCurrentEmployeeRoster(): Promise<CurrentRosterResult> {
  const [currentRoster, categoryResult, workResult, reference] = await Promise.all([
    fetchEmployees({ state: 'CURRENT' }),
    fetchEmployeeCategories().catch(() => ({ rows: [] })),
    fetchEmployeeWork().catch(() => ({ rows: [] })),
    fetchReferenceData().catch(() => null),
  ]);

  const categoriesById = new Map(categoryResult.rows.map((row) => [String(row.employeeId), row]));
  const workById = new Map(workResult.rows.map((row) => [String(row.employeeId), row]));
  const typeLabels = employmentTypeLabels(reference);
  const today = todayIso();

  const employees = currentRoster.rows.map((employee) => {
    const id = String(employee.employeeId);
    return buildSyncedEmployee({
      employee,
      currentInRoster: true,
      categories: categoriesById.get(id)?.categoryList ?? null,
      work: workById.get(id) ?? null,
      employmentTypeLabels: typeLabels,
      onDate: today,
    });
  });

  employees.sort((a, b) => a.name.localeCompare(b.name));
  return { employees, fetchedAt: new Date().toISOString() };
}

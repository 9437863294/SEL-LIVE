import { NextResponse } from 'next/server';
import { accessErrorResponse, authenticateAccess, requireAccess } from '@/lib/access-control-server';
import {
  buildSyncedEmployee,
  employmentTypeLabels,
  todayIso,
  type SyncedEmployee,
} from '@/lib/greythr';
import {
  fetchEmployeeCategories,
  fetchEmployeeWork,
  fetchEmployees,
  fetchReferenceData,
  isGreytHRConfigured,
} from '@/lib/greythr-client';

/**
 * The CURRENT roster, live from greytHR — no Firestore mirror in the middle.
 *
 * `GET /api/greythr/employees` (the Add User picker) answers "who can I make an account for", which
 * merges greytHR's live CURRENT membership onto the *mirror's* richer fields and excludes anyone
 * already linked. This route answers a plainer question — "who does greytHR say is currently
 * employed, right now" — for the times the mirror itself is the thing under suspicion (a stale sync,
 * a placeholder-date bug, a run that silently didn't touch what it should have). Everyone CURRENT is
 * returned, linked or not, and every field is derived fresh from this call rather than read back from
 * a document that might be the very thing being second-guessed.
 *
 * `currentInRoster: true` is passed to `buildSyncedEmployee` for every row without qualification —
 * these rows *are* greytHR's CURRENT roster, so there is nothing to weigh against a leaving date or a
 * separation record. That is what keeps this route immune to the placeholder-date failure mode: it
 * never looks at `leavingDate` as evidence of anything.
 */

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const context = await authenticateAccess(request);
    requireAccess(context, 'Settings.Employee Management', 'View');

    if (!isGreytHRConfigured()) {
      return NextResponse.json(
        { ok: false, error: 'greytHR credentials are not configured on the server.' },
        { status: 400 },
      );
    }

    const [currentRoster, categoryResult, workResult, reference] = await Promise.all([
      fetchEmployees({ state: 'CURRENT' }),
      fetchEmployeeCategories(),
      fetchEmployeeWork(),
      // Employment-type labels are a nicety. A failure here still leaves a usable roster with
      // greytHR's numeric fallback labels rather than losing the whole page.
      fetchReferenceData().catch(() => null),
    ]);

    const categoriesById = new Map(categoryResult.rows.map((row) => [String(row.employeeId), row]));
    const workById = new Map(workResult.rows.map((row) => [String(row.employeeId), row]));
    const typeLabels = employmentTypeLabels(reference);
    const today = todayIso();

    const employees: SyncedEmployee[] = currentRoster.rows.map((employee) => {
      const id = String(employee.employeeId);
      return buildSyncedEmployee({
        employee,
        // The defining fact of this route: membership in this response *is* current membership.
        currentInRoster: true,
        categories: categoriesById.get(id)?.categoryList ?? null,
        work: workById.get(id) ?? null,
        employmentTypeLabels: typeLabels,
        onDate: today,
      });
    });

    employees.sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({
      ok: true,
      employees,
      totalCurrent: employees.length,
      fetchedAt: new Date().toISOString(),
      source: 'greythr-live',
    });
  } catch (error) {
    const { message, status } = accessErrorResponse(error);
    return NextResponse.json({ error: message }, { status });
  }
}

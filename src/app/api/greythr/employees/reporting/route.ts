import { NextResponse } from 'next/server';
import { getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import { accessErrorResponse, authenticateAccess, requireAccess } from '@/lib/access-control-server';
import {
  isEmployeeMasterRecord,
  isWorkingState,
  type EmployeeOperationalDetail,
  type EmploymentState,
  type SyncedEmployee,
} from '@/lib/greythr';
import type { ReportingPerson } from '@/lib/reporting-structure';

/**
 * The reporting structure.
 *
 * `GET /api/greythr/employees/reporting`
 *
 * ── What it returns, and what it deliberately does not ──────────────────────────────────────────
 *
 * One row per employee, each carrying the manager greytHR recorded — and nothing else. The tree,
 * the depths, the cycle detection and the counts are all derived by `buildReportingStructure`,
 * which the *screen* calls.
 *
 * That split is not arbitrary. The screen filters, and a filter must not change the shape of the
 * organisation: hide everyone who has left and their reportees would become roots, inventing a
 * hierarchy that does not exist. So the structure is always derived over the whole roster and the
 * filter decides only which rows are drawn. Deriving it here would mean either re-requesting on
 * every filter change or shipping a tree the screen cannot honestly narrow.
 *
 * ── Where the data comes from ───────────────────────────────────────────────────────────────────
 *
 * `reportingManagerEmployeeId` is written by the sync's "Reporting structure" detail group, from
 * greytHR's org tree. With that group switched off the field is simply absent, and this returns
 * rows with no manager rather than an error — `groupEnabled` tells the screen which of the two
 * "nobody has a manager" situations it is looking at.
 *
 * Read-only. greytHR owns the org tree; changing who reports to whom happens there.
 */

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const context = await authenticateAccess(request);
    requireAccess(context, 'Settings.Employee Management', 'View');

    const db = getFirebaseAdminFirestore();
    const [employeeSnapshot, settingsDoc] = await Promise.all([
      db.collection('employees').get(),
      db.collection('settings').doc('greythrSync').get(),
    ]);

    const people: ReportingPerson[] = [];
    for (const doc of employeeSnapshot.docs) {
      const data = doc.data();
      // The salary flow writes one document per employee per month into this same collection; they
      // are not people and would otherwise appear as a crowd of managerless rows.
      if (!isEmployeeMasterRecord(data)) continue;
      // The reporting fields live on the detail half of the document, which the sync merges onto
      // the same record — `SyncedEmployee` alone does not declare them.
      const record = data as Partial<SyncedEmployee & EmployeeOperationalDetail>;
      const state = (record.employmentState ?? 'Unknown') as EmploymentState;

      people.push({
        employeeId: doc.id,
        employeeNo: String(record.employeeNo ?? ''),
        name: String(record.name ?? ''),
        department: String(record.department ?? ''),
        designation: String(record.designation ?? ''),
        employmentState: state,
        // Decided here, so the rule stays in `greythr.ts` and the derivation module keeps no
        // value imports — see `ReportingPerson.working`.
        working: isWorkingState(state),
        managerEmployeeId: String(record.reportingManagerEmployeeId ?? '').trim() || null,
        managerName: String(record.reportingManagerName ?? '').trim() || null,
      });
    }

    people.sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({
      ok: true,
      people,
      /**
       * Whether the sync is fetching the org tree at all.
       *
       * Without this the screen cannot tell "this organisation records no managers" from "nobody
       * ever switched the group on", and those want completely different advice.
       */
      groupEnabled: settingsDoc.data()?.detailGroups?.reporting === true,
      syncedAt: (settingsDoc.data()?.lastSuccessfulRunAt as string | undefined) ?? null,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    const { message, status } = accessErrorResponse(error);
    return NextResponse.json({ error: message }, { status });
  }
}

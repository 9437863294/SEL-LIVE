import { NextResponse } from 'next/server';
import { getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import { accessErrorResponse, authenticateAccess, requireAccess } from '@/lib/access-control-server';
import {
  currentAttendancePeriod,
  isEmployeeMasterRecord,
  type EmployeeAttendanceSummary,
  type SyncedEmployee,
} from '@/lib/greythr';

/**
 * The organisation-wide attendance register — the monthly summary greytHR's `insights` endpoint
 * returns, for everyone at once.
 *
 * `GET /api/greythr/employees/attendance`
 *
 * ── What this is not ────────────────────────────────────────────────────────────────────────────
 *
 * Not a muster roll. greytHR's day-level swipe data is a different, much larger endpoint this
 * integration has never fetched — see docs/greythr-integration.md's deferred list — and pulling it for
 * ~1,300 employees across a month is a materially bigger job than this route, which reads one already-
 * synced summary document per employee. If a day-by-day muster is wanted, that is its own decision
 * about retention and volume, not an extension of this route.
 *
 * This is exactly what the employee profile's "Attendance summary" tab already shows for one person,
 * turned into a register so a pattern — three people averaging two hours of daily lateness — is
 * visible without opening 1,300 profiles.
 */

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const context = await authenticateAccess(request);
    requireAccess(context, 'Settings.Employee Management', 'View');

    const db = getFirebaseAdminFirestore();
    const [employeeSnapshot, attendanceSnapshot] = await Promise.all([
      db.collection('employees').get(),
      db.collection('employeeAttendance').get(),
    ]);

    const employees = new Map<string, Partial<SyncedEmployee>>();
    for (const doc of employeeSnapshot.docs) {
      const data = doc.data();
      if (!isEmployeeMasterRecord(data)) continue;
      employees.set(doc.id, data as Partial<SyncedEmployee>);
    }

    const rows: Array<{
      employeeId: string;
      name: string;
      employeeNo: string;
      department: string;
      designation: string;
      employmentState: string;
      summary: EmployeeAttendanceSummary;
    }> = [];

    const averageTypes: string[] = [];
    const dayTypes: string[] = [];
    const seenAverages = new Set<string>();
    const seenDays = new Set<string>();
    const attendanceIds = new Set(attendanceSnapshot.docs.map((doc) => doc.id));

    for (const doc of attendanceSnapshot.docs) {
      const summary = doc.data() as EmployeeAttendanceSummary;
      const employee = employees.get(doc.id);
      rows.push({
        employeeId: doc.id,
        name: String(employee?.name ?? doc.id),
        employeeNo: String(employee?.employeeNo ?? ''),
        department: String(employee?.department ?? ''),
        designation: String(employee?.designation ?? ''),
        employmentState: String(employee?.employmentState ?? 'Unknown'),
        summary,
      });
      for (const type of Object.keys(summary.averages ?? {})) {
        if (!seenAverages.has(type)) {
          seenAverages.add(type);
          averageTypes.push(type);
        }
      }
      for (const type of Object.keys(summary.days ?? {})) {
        if (!seenDays.has(type)) {
          seenDays.add(type);
          dayTypes.push(type);
        }
      }
    }

    rows.sort((a, b) => a.name.localeCompare(b.name));

    const period = rows[0]?.summary
      ? { start: rows[0].summary.periodStart, end: rows[0].summary.periodEnd }
      : currentAttendancePeriod();

    return NextResponse.json({
      ok: true,
      rows,
      averageTypes,
      dayTypes,
      period,
      count: rows.length,
      missing: [...employees.keys()].filter((id) => !attendanceIds.has(id)).length,
    });
  } catch (error) {
    const { message, status } = accessErrorResponse(error);
    return NextResponse.json({ error: message }, { status });
  }
}

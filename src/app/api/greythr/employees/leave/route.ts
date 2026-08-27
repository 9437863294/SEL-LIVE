import { NextResponse } from 'next/server';
import { getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import { accessErrorResponse, authenticateAccess, requireAccess } from '@/lib/access-control-server';
import { currentLeaveYear, isEmployeeMasterRecord, type EmployeeLeaveBalance, type SyncedEmployee } from '@/lib/greythr';

/**
 * The organisation-wide leave register.
 *
 * `GET /api/greythr/employees/leave`
 *
 * ── Why this did not exist until now ────────────────────────────────────────────────────────────
 *
 * The sync has written one `employeeLeaveBalance` document per employee for as long as the "Leave
 * balances" detail group has been enabled — but nothing ever read the collection back except the
 * profile page, one employee at a time. Whoever wanted "who is sitting on the most unused leave" or
 * "how much earned leave does the organisation owe in total" had no page to ask, only 1,300 profile
 * visits.
 *
 * This joins that collection against the employee mirror for name/department/designation — the leave
 * documents key only on `employeeId` and carry no other identifying field, by design (see
 * `buildLeaveBalance`) — and returns one row per employee plus the aggregate the mirror alone cannot
 * answer: total leave liability by type, across everyone.
 *
 * Read-only, deliberately. Applying, approving or rejecting a leave request writes back to greytHR,
 * and nothing in this integration does that yet — see docs/greythr-integration.md §12. This is a
 * register of what greytHR has already decided, not a workflow for deciding it.
 */

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const context = await authenticateAccess(request);
    requireAccess(context, 'Settings.Employee Management', 'View');

    const db = getFirebaseAdminFirestore();
    const [employeeSnapshot, leaveSnapshot] = await Promise.all([
      db.collection('employees').get(),
      db.collection('employeeLeaveBalance').get(),
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
      balance: EmployeeLeaveBalance;
    }> = [];

    // Every leave type any employee holds, so the table can offer one column per type rather than a
    // JSON blob — the whole point of a register over a per-employee page.
    const leaveTypeOrder: string[] = [];
    const seenTypes = new Set<string>();
    const leaveIds = new Set(leaveSnapshot.docs.map((doc) => doc.id));

    for (const doc of leaveSnapshot.docs) {
      const balance = doc.data() as EmployeeLeaveBalance;
      const employee = employees.get(doc.id);
      // A leave record for somebody no longer in the mirror (left, or the record predates them) is
      // still shown — the balance is a fact about a person, not about whether they still work here.
      rows.push({
        employeeId: doc.id,
        name: String(employee?.name ?? balance.employeeId ?? doc.id),
        employeeNo: String(employee?.employeeNo ?? ''),
        department: String(employee?.department ?? ''),
        designation: String(employee?.designation ?? ''),
        employmentState: String(employee?.employmentState ?? 'Unknown'),
        balance,
      });
      for (const line of balance.lines ?? []) {
        if (!seenTypes.has(line.leaveType)) {
          seenTypes.add(line.leaveType);
          leaveTypeOrder.push(line.leaveType);
        }
      }
    }

    rows.sort((a, b) => a.name.localeCompare(b.name));

    /** Total balance per leave type, across everyone — the number a register can answer that no
     * single profile page can. */
    const totalsByType: Record<string, number> = {};
    for (const row of rows) {
      for (const line of row.balance.lines ?? []) {
        totalsByType[line.leaveType] = (totalsByType[line.leaveType] ?? 0) + (line.balance ?? 0);
      }
    }

    return NextResponse.json({
      ok: true,
      rows,
      leaveTypes: leaveTypeOrder,
      totalsByType,
      totalBalance: rows.reduce((sum, row) => sum + (row.balance.totalBalance ?? 0), 0),
      year: rows[0]?.balance.year ?? currentLeaveYear(),
      count: rows.length,
      /**
       * How many mirror employees have no leave record at all — counted rather than subtracted,
       * because a leave document can outlive the employee's mirror record and a subtraction would go
       * negative and mean nothing.
       */
      missing: [...employees.keys()].filter((id) => !leaveIds.has(id)).length,
    });
  } catch (error) {
    const { message, status } = accessErrorResponse(error);
    return NextResponse.json({ error: message }, { status });
  }
}

import { NextResponse } from 'next/server';
import { accessErrorResponse, authenticateAccess, requireAccess } from '@/lib/access-control-server';
import { isGreytHRConfigured } from '@/lib/greythr-client';
import { fetchCurrentEmployeeRoster } from '@/lib/greythr-live-roster';

/**
 * The CURRENT roster, live from greytHR — no Firestore mirror in the middle.
 *
 * `GET /api/greythr/employees` (the Add User picker) also sources from `fetchCurrentEmployeeRoster`
 * now, merged with the mirror for anyone already synced. This route stays the plainer, mirror-free
 * question — "who does greytHR say is currently employed, right now" — for the times the mirror
 * itself is the thing under suspicion (a stale sync, a placeholder-date bug, a run that silently
 * didn't touch what it should have).
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

    const { employees, fetchedAt } = await fetchCurrentEmployeeRoster();

    return NextResponse.json({
      ok: true,
      employees,
      totalCurrent: employees.length,
      fetchedAt,
      source: 'greythr-live',
    });
  } catch (error) {
    const { message, status } = accessErrorResponse(error);
    return NextResponse.json({ error: message }, { status });
  }
}

import { NextResponse } from 'next/server';
import { getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import { accessErrorResponse, authenticateAccess, requireAccess } from '@/lib/access-control-server';
import { isGreytHRConfigured } from '@/lib/greythr-client';
import { fetchMuster } from '@/lib/greythr-client';
import {
  buildSwipeMonth,
  hasSwipeData,
  isEmployeeMasterRecord,
  summarizeSwipeDays,
  swipeDocId,
  swipeMonthKey,
  swipeMonthRange,
  type EmployeeSwipeMonth,
  type SyncedEmployee,
} from '@/lib/greythr';

/**
 * The daily swipe register.
 *
 * `GET  /api/greythr/employees/swipes?month=YYYY-MM` — the stored month, joined to the mirror.
 * `POST /api/greythr/employees/swipes` with `{ month }` — fetch that month from greytHR and store it.
 *
 * ── Why a POST at all ───────────────────────────────────────────────────────────────────────────
 *
 * The `swipes` detail group is off by default and the sync only ever writes the *current* month, so
 * without this the screen could show nothing for last month and offer no way to change that short of
 * editing settings and waiting for a run. The POST is the "fetch this month now" button: same
 * normalisation, same documents, same collection as the sync writes, gated on the sync permission
 * because it calls greytHR and writes.
 *
 * It is a POST rather than a `?refresh=1` GET precisely because it writes — unlike
 * `/employees/current`, where the write is an incidental cache-warm on a read.
 *
 * ── What the join adds, and what it cannot ──────────────────────────────────────────────────────
 *
 * Names, departments and designations come from the `employees` mirror, and a swipe document whose
 * employee is not mirrored is still returned with `inMirror: false` rather than being hidden or
 * labelled with its own id — the same rule the leave and attendance registers follow. greytHR has
 * muster rows for people the employee endpoint does not return, so this is the normal case rather
 * than an edge one.
 */

export const runtime = 'nodejs';
/** A month of muster for the whole organisation is the heaviest fetch in the integration. */
export const maxDuration = 300;

const SWIPES = 'employeeSwipes';

interface SwipeRow {
  employeeId: string;
  name: string;
  employeeNo: string;
  department: string;
  designation: string;
  employmentState: string;
  inMirror: boolean;
  month: EmployeeSwipeMonth;
}

/** Read the stored month and join it to the mirror. Shared by both verbs. */
async function readStoredMonth(month: string) {
  const db = getFirebaseAdminFirestore();
  const [employeeSnapshot, swipeSnapshot] = await Promise.all([
    db.collection('employees').get(),
    // Every document for this month. Keyed `{employeeId}_{month}`, so a prefix range is enough and
    // no composite index is needed.
    db
      .collection(SWIPES)
      .where('month', '==', month)
      .get(),
  ]);

  const employees = new Map<string, Partial<SyncedEmployee>>();
  for (const doc of employeeSnapshot.docs) {
    const data = doc.data();
    if (!isEmployeeMasterRecord(data)) continue;
    employees.set(doc.id, data as Partial<SyncedEmployee>);
  }

  const rows: SwipeRow[] = [];
  for (const doc of swipeSnapshot.docs) {
    const stored = doc.data() as EmployeeSwipeMonth;
    const employee = employees.get(String(stored.employeeId));
    rows.push({
      employeeId: String(stored.employeeId),
      name: String(employee?.name ?? ''),
      employeeNo: String(employee?.employeeNo ?? ''),
      department: String(employee?.department ?? ''),
      designation: String(employee?.designation ?? ''),
      employmentState: String(employee?.employmentState ?? 'Unknown'),
      inMirror: Boolean(employee),
      month: {
        ...stored,
        // Recomputed rather than trusted: a document written by an older build may predate a change
        // to the totals, and the register's headline figures should never disagree with its own rows.
        totals: summarizeSwipeDays(stored.days ?? []),
      },
    });
  }

  rows.sort((a, b) => {
    if (Boolean(a.name) !== Boolean(b.name)) return a.name ? -1 : 1;
    if (a.name) return a.name.localeCompare(b.name);
    return Number(a.employeeId) - Number(b.employeeId);
  });

  /** Organisation-wide totals, which no single employee's document can answer. */
  const org = rows.reduce(
    (sum, row) => ({
      swiped: sum.swiped + row.month.totals.swiped,
      present: sum.present + row.month.totals.present,
      absent: sum.absent + row.month.totals.absent,
      lateIn: sum.lateIn + row.month.totals.lateIn,
      earlyOut: sum.earlyOut + row.month.totals.earlyOut,
      workMinutes: sum.workMinutes + row.month.totals.workMinutes,
      daysRecorded: sum.daysRecorded + row.month.totals.daysRecorded,
    }),
    { swiped: 0, present: 0, absent: 0, lateIn: 0, earlyOut: 0, workMinutes: 0, daysRecorded: 0 },
  );

  const range = swipeMonthRange(month);
  return {
    rows,
    month,
    period: { start: rows[0]?.month.periodStart ?? range.start, end: rows[0]?.month.periodEnd ?? range.end },
    count: rows.length,
    unidentified: rows.filter((row) => !row.inMirror).length,
    /** Mirror employees with no swipe document this month. */
    missing: [...employees.keys()].filter((id) => !rows.some((row) => row.employeeId === id)).length,
    totals: org,
    syncedAt: rows[0]?.month.syncedAt ?? null,
  };
}

export async function GET(request: Request) {
  try {
    const context = await authenticateAccess(request);
    requireAccess(context, 'Settings.Employee Management', 'View');

    const month = new URL(request.url).searchParams.get('month') || swipeMonthKey();
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: `"${month}" is not a YYYY-MM month.` }, { status: 400 });
    }

    return NextResponse.json({ ok: true, ...(await readStoredMonth(month)) });
  } catch (error) {
    const { message, status } = accessErrorResponse(error);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: Request) {
  try {
    const context = await authenticateAccess(request);
    // Fetching writes to greytHR's rate limit and to Firestore, so it needs the sync permission
    // rather than the view one — the same boundary the sync console draws.
    requireAccess(context, 'Settings.Employee Management', 'Sync from GreytHR');

    if (!isGreytHRConfigured()) {
      return NextResponse.json(
        { error: 'greytHR credentials are not configured on the server.' },
        { status: 400 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as { month?: string };
    const month = body.month || swipeMonthKey();
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: `"${month}" is not a YYYY-MM month.` }, { status: 400 });
    }

    const range = swipeMonthRange(month);
    const { rows, complete } = await fetchMuster(range.start, range.end);

    const db = getFirebaseAdminFirestore();
    const syncedAt = new Date().toISOString();
    let written = 0;
    let skipped = 0;

    /*
      Committed in chunks: Firestore caps a batch at 500 writes and a month of muster for the whole
      organisation is more than that at any real headcount.
    */
    const CHUNK = 400;
    const documents = rows
      .map((row) => buildSwipeMonth(row, { month, periodStart: range.start, periodEnd: range.end, syncedAt }))
      .filter((stored) => {
        if (hasSwipeData(stored)) return true;
        skipped += 1;
        return false;
      });

    for (let index = 0; index < documents.length; index += CHUNK) {
      const batch = db.batch();
      for (const stored of documents.slice(index, index + CHUNK)) {
        // `set` without merge, for the reason the sync gives: merging leaves a corrected-away day in
        // the stored array forever.
        batch.set(db.collection(SWIPES).doc(swipeDocId(stored.employeeId, month)), stored as unknown as Record<string, unknown>);
        written += 1;
      }
      await batch.commit();
    }

    // The freshly stored month, then this run's own outcome — spread first so the report below it
    // cannot be silently overwritten by it.
    return NextResponse.json({
      ok: true,
      ...(await readStoredMonth(month)),
      period: range,
      fetched: rows.length,
      written,
      /** Employees greytHR returned with nothing recorded all month — not an error. */
      skipped,
      complete,
    });
  } catch (error) {
    const { message, status } = accessErrorResponse(error);
    return NextResponse.json({ error: message }, { status });
  }
}

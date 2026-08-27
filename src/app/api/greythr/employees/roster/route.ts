import { NextResponse } from 'next/server';
import type { Firestore } from 'firebase-admin/firestore';
import { getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import { accessErrorResponse, authenticateAccess, requireAccess } from '@/lib/access-control-server';
import {
  isEmployeeMasterRecord,
  overlayLiveRosterState,
  shouldForceFullResync,
  type EmploymentState,
  type SyncedEmployee,
} from '@/lib/greythr';
import { isGreytHRConfigured } from '@/lib/greythr-client';
import { fetchCurrentEmployeeRoster } from '@/lib/greythr-live-roster';
import { readSyncSettings } from '@/lib/greythr-sync-service';

/**
 * The full employee roster — the stored mirror, corrected against greytHR's live CURRENT roster.
 *
 * `GET /api/greythr/employees/roster`
 *
 * ── Why this exists rather than the screen reading Firestore itself ─────────────────────────────
 *
 * Manage Employee used to read the `employees` collection straight from the browser and render
 * whatever it found. That is why it showed a workforce of 182 people with one still employed: the
 * mirror is only ever as correct as the last sync that wrote it, and with no scheduler actually
 * running, "the last sync" could be months ago or predate a derivation fix. The screen had no way to
 * know it was reporting a stale conclusion as fact.
 *
 * Two other screens had already solved this — `/employee/current` bypasses the mirror entirely, and
 * the Add User picker overlays live membership — but each did it inline, so the three disagreed
 * about who works here depending on which you opened. The correction now lives in one pure function
 * (`overlayLiveRosterState`) and this route applies it for the roster view.
 *
 * ── What it guarantees ─────────────────────────────────────────────────────────────────────────
 *
 *   - Anyone on greytHR's live CURRENT roster is shown as working, whatever the mirror stored.
 *   - Anyone the live roster does not mention keeps their stored state, re-judged for the
 *     placeholder exit dates greytHR emits for employees who never left.
 *   - Anyone current in greytHR but missing from the mirror entirely is still listed, flagged as
 *     awaiting a sync — better than being invisible until someone rebuilds the mirror.
 *   - If greytHR is unreachable the mirror is served as-is and `liveRoster: false` says so, so the
 *     screen can be honest instead of quietly presenting stale data as current.
 *
 * Unlike the mirror, this cannot silently rot. Unlike `/employee/current`, it still includes people
 * who have genuinely left — which is the whole point of a roster screen.
 */

export const runtime = 'nodejs';

/** Categories this screen offers as filter columns, in the order they should appear. */
const FILTER_CATEGORIES = [
  'Project Name',
  'Project Division',
  'Department',
  'Location',
  'Cost Center',
  'Designation',
  'EMPLOYEE TYPE',
  'Grade',
  'Shift',
  'COST CENTER CODE',
] as const;

export interface RosterEmployee extends Partial<SyncedEmployee> {
  employeeId: string;
  employmentState: EmploymentState;
  employmentStateReason: string;
  /** True when the live roster or the placeholder rule overruled the stored state. */
  employmentStateCorrected: boolean;
  /** True when greytHR has this person but no sync has written them to the mirror yet. */
  awaitingSync: boolean;
  /** Category name → value, for the dynamic filter columns. */
  categories: Record<string, string>;
}

/**
 * The category map for one record.
 *
 * Prefers `categories`, which the sync resolves as at the run date and which the live roster always
 * carries. Falls back to the flat fields for mirror documents written before that map existed —
 * otherwise every filter column would read blank for those rows and look like missing data rather
 * than an old record.
 */
function categoriesFor(record: Partial<SyncedEmployee>): Record<string, string> {
  const stored = record.categories;
  if (stored && Object.keys(stored).length) return stored;

  const fallback: Record<string, string> = {};
  const put = (key: string, value: string | undefined) => {
    if (value) fallback[key] = value;
  };
  put('Department', record.department);
  put('Designation', record.designation);
  put('Location', record.location);
  put('Grade', record.grade);
  put('Project Name', record.projectName);
  put('Project Division', record.projectDivision);
  put('Cost Center', record.costCenter);
  put('EMPLOYEE TYPE', record.employeeType);
  return fallback;
}

async function loadMirror(db: Firestore): Promise<{
  employees: Map<string, Partial<SyncedEmployee>>;
  salaryRows: number;
  syncedAt: string | null;
}> {
  const snapshot = await db.collection('employees').get();
  const employees = new Map<string, Partial<SyncedEmployee>>();
  let salaryRows = 0;
  let syncedAt: string | null = null;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    /**
     * The salary sync writes one document per employee per month into this same collection, carrying
     * `salaryMonth` and a blank department/designation/email. Without this filter they are listed as
     * members of staff, which is how a headcount ends up a multiple of the months synced.
     */
    if (!isEmployeeMasterRecord(data)) {
      salaryRows += 1;
      continue;
    }
    const record = data as Partial<SyncedEmployee>;
    employees.set(doc.id, { ...record, employeeId: String(record.employeeId ?? doc.id) });
    if (typeof record.syncedAt === 'string' && (!syncedAt || record.syncedAt > syncedAt)) {
      syncedAt = record.syncedAt;
    }
  }

  return { employees, salaryRows, syncedAt };
}

export async function GET(request: Request) {
  try {
    const context = await authenticateAccess(request);
    requireAccess(context, 'Settings.Employee Management', 'View');

    const db = getFirebaseAdminFirestore();

    /**
     * The live roster is an enrichment, never a precondition.
     *
     * A greytHR outage, an expired credential or a network blip must degrade this screen to "the
     * mirror, labelled as unverified" rather than break it. The roster page is often exactly where
     * somebody goes to work out *why* the integration looks wrong.
     */
    const liveRosterPromise = isGreytHRConfigured()
      ? fetchCurrentEmployeeRoster().catch((error) => {
          console.warn('[greythr/roster] Live CURRENT roster unavailable; serving the mirror as-is.', error);
          return null;
        })
      : Promise.resolve(null);

    const [{ employees: mirror, salaryRows, syncedAt }, settings, liveRoster] = await Promise.all([
      loadMirror(db),
      readSyncSettings(db),
      liveRosterPromise,
    ]);

    const liveById = new Map(
      (liveRoster?.employees ?? []).map((employee) => [String(employee.employeeId), employee]),
    );
    // An empty live response is treated as "no answer", not "nobody works here". A tenant with zero
    // current employees is not a real state, whereas a paging or permission fault that returns an
    // empty list very much is — and acting on it would mark the whole company departed.
    const haveLiveRoster = liveById.size > 0;

    const rows: RosterEmployee[] = [];

    for (const [id, stored] of mirror) {
      const overlaid = overlayLiveRosterState(stored, haveLiveRoster && liveById.has(id));
      rows.push({
        ...overlaid,
        employeeId: id,
        awaitingSync: false,
        categories: categoriesFor(overlaid),
      });
    }

    /**
     * Current in greytHR, absent from the mirror.
     *
     * Listed rather than dropped. These are usually new joiners between syncs, and the previous
     * behaviour — omit them and print "N employees are in greytHR but not in the local mirror; run a
     * full resync" — made finding a new colleague conditional on an unrelated maintenance job.
     */
    for (const [id, live] of liveById) {
      if (mirror.has(id)) continue;
      rows.push({
        ...live,
        employeeId: id,
        employmentStateCorrected: false,
        awaitingSync: true,
        categories: categoriesFor(live),
      });
    }

    rows.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));

    // Only the categories somebody actually has, so the screen does not render ten empty filters on
    // a tenant that configured three.
    const filterOptions: Record<string, string[]> = {};
    for (const category of FILTER_CATEGORIES) {
      const values = new Set<string>();
      for (const row of rows) {
        const value = row.categories[category];
        if (value) values.add(value);
      }
      if (values.size) filterOptions[category] = [...values].sort((a, b) => a.localeCompare(b));
    }

    const working = rows.filter((row) => row.status === 'Active').length;

    return NextResponse.json({
      ok: true,
      employees: rows,
      filterOptions,
      counts: {
        total: rows.length,
        working,
        departed: rows.length - working,
        awaitingSync: rows.filter((row) => row.awaitingSync).length,
        corrected: rows.filter((row) => row.employmentStateCorrected).length,
        salaryRows,
      },
      /** Whether the states above were verified against greytHR just now, or are mirror-only. */
      liveRoster: haveLiveRoster,
      mirrorSyncedAt: syncedAt,
      baselineCompletedAt: settings.baselineCompletedAt ?? null,
      mirrorRefresh: shouldForceFullResync(settings),
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    const { message, status } = accessErrorResponse(error);
    return NextResponse.json({ error: message }, { status });
  }
}

import { NextResponse } from 'next/server';
import type { Firestore } from 'firebase-admin/firestore';
import { getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import {
  AccessDeniedError,
  accessErrorResponse,
  authenticateAccess,
} from '@/lib/access-control-server';
import { canUseEmployeePicker, checkerFor } from '@/lib/access-control';
import {
  buildCategoryIdMaps,
  buildSyncedEmployee,
  employmentTypeLabels,
  indexUsersByEmail,
  indexUsersByEmployeeId,
  isEmployeeMasterRecord,
  isWorkingState,
  normalizeCategories,
  resolveAllCategoriesAt,
  shouldForceFullResync,
  toLinkableEmployee,
  todayIso,
  type LinkableEmployee,
  type SyncedEmployee,
} from '@/lib/greythr';
import { fetchSingleEmployee, isGreytHRConfigured } from '@/lib/greythr-client';
import { fetchCurrentEmployeeRoster } from '@/lib/greythr-live-roster';
import { readSyncSettings } from '@/lib/greythr-sync-service';

/**
 * The employee directory behind the "create a user for this person" picker.
 *
 *   `GET  /api/greythr/employees`            — current employees without a login
 *   `GET  /api/greythr/employees?id=<id>`    — one employee, refreshed live from greytHR
 *
 * ── Why membership is live but list details come from Firestore ─────────────────────────────────
 *
 * greytHR's `state=CURRENT` roster is the authority for who still works here. The mirror supplies the
 * richer department/designation/project fields and is the fallback when greytHR is unavailable. The
 * detail for the employee an administrator picks is fetched live again before prefilling the form.
 *
 * Both paths compute "already has a login" the same way the sync does, so an employee cannot appear
 * offerable here and linked there.
 */

export const runtime = 'nodejs';

interface UserRow {
  id: string;
  email: string | null;
  employeeId: string | null;
  name: string;
}

async function loadUsers(db: Firestore): Promise<UserRow[]> {
  const snapshot = await db.collection('users').get();
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    email: (doc.data().email as string | undefined) ?? null,
    employeeId: (doc.data().employeeId as string | undefined) ?? null,
    name: (doc.data().name as string | undefined) ?? '',
  }));
}

/**
 * How an employee is linked to an existing account, if at all.
 *
 * Takes the fields loosely rather than a `SyncedEmployee`, because the mirror holds documents
 * written before this integration existed and their `email` may genuinely be absent.
 */
function resolveLink(
  employee: { employeeId: string; email?: string | null },
  byEmployeeId: Map<string, string>,
  byEmail: Map<string, string>,
): { userId: string | null; via: 'employeeId' | 'email' | null } {
  const explicit = byEmployeeId.get(String(employee.employeeId));
  if (explicit) return { userId: explicit, via: 'employeeId' };
  const email = (employee.email || '').trim().toLowerCase();
  const byMail = email ? byEmail.get(email) : undefined;
  if (byMail) return { userId: byMail, via: 'email' };
  return { userId: null, via: null };
}

export async function GET(request: Request) {
  try {
    const context = await authenticateAccess(request);
    // This directory is used in two legitimate places: Employee Management and Add User. Requiring
    // only the former made the picker look empty for administrators who could add users but had no
    // HR-module permission.
    if (!canUseEmployeePicker(checkerFor(context.access))) {
      throw new AccessDeniedError(
        'Viewing Employee Management or adding users is required to open the employee picker.',
      );
    }

    const db = getFirebaseAdminFirestore();
    const url = new URL(request.url);
    const singleId = url.searchParams.get('id');

    /* ── One employee, live ── */

    if (singleId) {
      if (!isGreytHRConfigured()) {
        return NextResponse.json(
          { ok: false, error: 'greytHR credentials are not configured on the server.' },
          { status: 400 },
        );
      }

      const snapshot = await fetchSingleEmployee(singleId);
      if (!snapshot.employee) {
        return NextResponse.json(
          { ok: false, error: `greytHR returned no employee with id ${singleId}.` },
          { status: 404 },
        );
      }

      // The single-employee categories endpoint sends numeric ids only, so descriptions are resolved
      // against the reference lists the client fetched alongside when needed.
      const maps = buildCategoryIdMaps(snapshot.reference);
      const normalized = normalizeCategories(snapshot.categories, {
        categoryNamesById: maps.categoryNameById,
        valueNamesByCategory: maps.valueNamesByCategory,
      });

      const record = buildSyncedEmployee({
        employee: snapshot.employee,
        separation: snapshot.separation,
        // Already normalised above, so passed through in the shape `buildSyncedEmployee` expects.
        categories: normalized.map((entry) => ({
          categoryDesc: entry.category,
          valueDesc: entry.value,
          effectiveFrom: entry.effectiveFrom,
          effectiveTo: entry.effectiveTo,
        })),
        work: snapshot.work,
        employmentTypeLabels: employmentTypeLabels(snapshot.reference),
        onDate: todayIso(),
      });

      const users = await loadUsers(db);
      const { index: byEmail } = indexUsersByEmail(users);
      const { index: byEmployeeId } = indexUsersByEmployeeId(users);
      const link = resolveLink(record, byEmployeeId, byEmail);

      return NextResponse.json({
        ok: true,
        employee: toLinkableEmployee(record, link),
        /** Every category greytHR holds for them, including any this app does not name explicitly. */
        allCategories: resolveAllCategoriesAt(normalized, todayIso()),
        linkedUserName: link.userId ? (users.find((user) => user.id === link.userId)?.name ?? null) : null,
        source: 'greythr',
      });
    }

    /* ── The list: the mirror, topped up with anyone greytHR has that the mirror does not ── */

    const liveRosterPromise = isGreytHRConfigured()
      ? fetchCurrentEmployeeRoster().catch((error) => {
          console.warn('[greythr/employees] Could not fetch the live CURRENT roster; using mirror state.', error);
          return null;
        })
      : Promise.resolve(null);

    const [employeeSnapshot, users, settings, liveRoster] = await Promise.all([
      db.collection('employees').get(),
      loadUsers(db),
      readSyncSettings(db),
      liveRosterPromise,
    ]);

    const { index: byEmail } = indexUsersByEmail(users);
    const { index: byEmployeeId } = indexUsersByEmployeeId(users);
    const userNames = new Map(users.map((user) => [user.id, user.name]));
    const mirrorRefresh = shouldForceFullResync(settings);
    const currentEmployeeIds = liveRoster && liveRoster.employees.length > 0
      ? new Set(liveRoster.employees.map((employee) => String(employee.employeeId)))
      : null;

    /**
     * Real employee records only.
     *
     * The salary sync writes one document per employee per month into this same collection, with
     * `status: 'Active'` and no email. Without this filter the picker offers them as people to
     * create logins for — which is how an administrator ends up making an account for
     * "CON-005 · March 2026".
     */
    const all: LinkableEmployee[] = employeeSnapshot.docs
      .filter((doc) => isEmployeeMasterRecord(doc.data()))
      .map((doc) => {
        const data = doc.data() as Partial<SyncedEmployee>;
        const employeeId = String(data.employeeId ?? doc.id);
        const isCurrent = currentEmployeeIds?.has(employeeId) === true;
        const record = {
          ...data,
          employeeId,
          // A live CURRENT-roster response is authoritative. Preserve Notice Period because that is
          // also a working state, but never let a historical separation row hide a current person.
          ...(isCurrent
            ? {
                status: 'Active' as const,
                employmentState:
                  data.employmentState === 'Notice Period' ? ('Notice Period' as const) : ('Active' as const),
                greytHRCurrent: true,
                ...(data.employmentState === 'Notice Period'
                  ? {}
                  : {
                      employmentStateReason: 'Included in greytHR\'s current employee roster.',
                      exitDate: null,
                      leavingDate: null,
                    }),
              }
            : {}),
        };
        return toLinkableEmployee(record, resolveLink(record, byEmployeeId, byEmail));
      });
    const mirroredEmployeeIds = new Set(all.map((employee) => employee.employeeId));

    /**
     * Anyone greytHR reports as CURRENT who is not in the mirror at all.
     *
     * This is the actual fix for "add a new user I want, and it should pull the list from
     * greytHR's current-employee roster". `all`, above, can only ever contain what
     * `employeeSnapshot.docs` already holds — so an employee greytHR has always known about but no
     * sync has ever stored (because they joined after the last successful run, or a run partially
     * failed) was invisible here no matter how current they were. The picker said so — "128 active
     * employees are in greytHR but not yet in the local mirror. Run Full resync to add them." — but
     * that is a diagnosis, not a fix, and creating one login should not require rebuilding the
     * mirror for everybody else first.
     *
     * Built straight from the live roster's own `SyncedEmployee` records — the same ones
     * `/employee/current` shows — rather than from anything mirror-shaped, so nothing here depends
     * on the mirror being right.
     */
    const liveOnly: LinkableEmployee[] = (liveRoster?.employees ?? [])
      .filter((employee) => !mirroredEmployeeIds.has(String(employee.employeeId)))
      .map((employee) => {
        const record = { ...employee, employeeId: String(employee.employeeId) };
        return toLinkableEmployee(record, resolveLink(record, byEmployeeId, byEmail));
      });

    const combined = [...all, ...liveOnly];

    /**
     * Working = on greytHR's live CURRENT roster, OR the (placeholder-corrected) mirror state says so.
     *
     * Was an either/or on the *source* — live roster when available, mirror state only as a fallback
     * for when greytHR is unreachable. That discarded the placeholder-date correction the moment the
     * live call succeeded: an employee with a corrected `employmentState: 'Active'` who, for any
     * reason, is not in `currentEmployeeIds` — a pagination gap, a scope difference between this API
     * user and the one used elsewhere, a sync timing difference — was filtered straight back out. The
     * live roster is still authoritative when it says somebody *is* current; it just no longer gets
     * the last word when it stays silent about somebody the corrected state says is fine.
     */
    const working = combined.filter(
      (employee) =>
        currentEmployeeIds?.has(employee.employeeId) === true || isWorkingState(employee.employmentState),
    );
    const offerable = working.filter((employee) => !employee.linkedUserId);

    const withUserName = (employee: LinkableEmployee) => ({
      ...employee,
      linkedUserName: employee.linkedUserId ? (userNames.get(employee.linkedUserId) ?? null) : null,
    });

    const byName = (a: LinkableEmployee, b: LinkableEmployee) =>
      (a.name || '').localeCompare(b.name || '');

    return NextResponse.json({
      ok: true,
      /** The employees who can be turned into a user without an override. */
      employees: offerable.slice().sort(byName).map(withUserName),
      /** Current employees only. Departed employees are deliberately not sent to Add User. */
      totalEmployees: working.length,
      /**
       * Counted rather than listed, so the picker can explain "showing 412 of 1,306" without
       * shipping the other 894 records to a screen that will not show them.
       */
      excluded: working.reduce<Record<string, number>>((counts, employee) => {
        if (employee.linkedUserId) {
          const reason = 'Already has a platform login';
          counts[reason] = (counts[reason] ?? 0) + 1;
        }
        return counts;
      }, {}),
      activeRosterSource: currentEmployeeIds ? 'greythr-current' : 'mirror',
      /**
       * How many offerable employees came straight from greytHR rather than the Firestore mirror.
       *
       * No longer a count of people the picker *cannot* show — `liveOnly` already put them in
       * `offerable` above. It is informational: the local mirror will not have these people until a
       * sync runs, so anything that reads the mirror directly (Employee Management, reports) will
       * lag this list until then, even though the login can be created right now.
       */
      employeesFromLiveRosterOnly: liveOnly.filter((employee) => !employee.linkedUserId).length,
      /**
       * The mirror is only as current as the last sync. Surfaced so the picker can say so rather
       * than presenting stale data as fact.
       */
      mirrorSyncedAt:
        employeeSnapshot.docs
          .map((doc) => (doc.data() as Partial<SyncedEmployee>).syncedAt)
          .filter((value): value is string => typeof value === 'string')
          .sort()
          .pop() ?? null,
      /**
       * Whether a full run has ever completed.
       *
       * `mirrorSyncedAt` answers "how fresh is this?", which is a different and less important
       * question than "is this everybody?". A mirror maintained only by incremental runs is recent
       * *and* incomplete, and reporting only freshness makes it look fine.
       */
      baselineCompletedAt: settings.baselineCompletedAt ?? null,
      mirrorVersion: settings.mirrorVersion ?? 0,
      mirrorRefreshRequired: mirrorRefresh.force,
      mirrorRefreshReason: mirrorRefresh.reason,
      source: 'mirror',
    });
  } catch (error) {
    const { message, status } = accessErrorResponse(error);
    return NextResponse.json({ error: message }, { status });
  }
}

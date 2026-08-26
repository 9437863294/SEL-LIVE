import { NextResponse } from 'next/server';
import type { Firestore } from 'firebase-admin/firestore';
import { getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import { accessErrorResponse, authenticateAccess, requireAccess } from '@/lib/access-control-server';
import {
  buildCategoryIdMaps,
  buildSyncedEmployee,
  employmentTypeLabels,
  indexUsersByEmail,
  indexUsersByEmployeeId,
  isEmployeeMasterRecord,
  isOfferableForNewUser,
  normalizeCategories,
  offerExclusionReason,
  resolveAllCategoriesAt,
  toLinkableEmployee,
  todayIso,
  type LinkableEmployee,
  type SyncedEmployee,
} from '@/lib/greythr';
import { fetchSingleEmployee, isGreytHRConfigured } from '@/lib/greythr-client';
import { readSyncSettings } from '@/lib/greythr-sync-service';

/**
 * The employee directory behind the "create a user for this person" picker.
 *
 *   `GET  /api/greythr/employees`            — active employees without a login, from the local mirror
 *   `GET  /api/greythr/employees?id=<id>`    — one employee, refreshed live from greytHR
 *
 * ── Why the list comes from Firestore and the detail comes from greytHR ─────────────────────────
 *
 * The list is the synced mirror: it answers instantly, works when greytHR is down, and paging ~1,300
 * employees out of the HR system every time somebody opens the Add User drawer would be both slow
 * and rude. The *detail* for the one employee an administrator actually picks is fetched live, so the
 * designation and project that get prefilled are what greytHR says now rather than whatever the last
 * nightly run captured — which matters precisely for a new joiner, whose record was probably created
 * in greytHR this morning.
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
    // Reading the employee directory is the same permission the Employee Management screens need.
    requireAccess(context, 'Settings.Employee Management', 'View');

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

    /* ── The list, from the mirror ── */

    const [employeeSnapshot, users, settings] = await Promise.all([
      db.collection('employees').get(),
      loadUsers(db),
      readSyncSettings(db),
    ]);

    const { index: byEmail } = indexUsersByEmail(users);
    const { index: byEmployeeId } = indexUsersByEmployeeId(users);
    const userNames = new Map(users.map((user) => [user.id, user.name]));

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
        const record = { ...data, employeeId: String(data.employeeId ?? doc.id) };
        return toLinkableEmployee(record, resolveLink(record, byEmployeeId, byEmail));
      });

    const offerable = all.filter(isOfferableForNewUser);

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
      /**
       * Employees with no login whom the rules would not offer, because greytHR says they have left.
       *
       * Sent rather than merely counted so the picker can let an administrator override the
       * classification. Employment state is derived from greytHR's own separation fields, and those
       * are not always right — a placeholder leaving date reads as a departure. When the derivation is
       * wrong, an administrator who cannot see the person has no route forward and no way to tell why;
       * one who can see them marked "Relieved" can judge for themselves. Already-linked employees are
       * *not* included: for them the answer is to edit the existing account, not make a second.
       */
      otherEmployees: all
        .filter((employee) => !employee.linkedUserId && !isOfferableForNewUser(employee))
        .sort(byName)
        .map(withUserName),
      totalEmployees: all.length,
      /**
       * Counted rather than listed, so the picker can explain "showing 412 of 1,306" without
       * shipping the other 894 records to a screen that will not show them.
       */
      excluded: all.reduce<Record<string, number>>((counts, employee) => {
        const reason = offerExclusionReason(employee);
        if (reason) counts[reason] = (counts[reason] ?? 0) + 1;
        return counts;
      }, {}),
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
      source: 'mirror',
    });
  } catch (error) {
    const { message, status } = accessErrorResponse(error);
    return NextResponse.json({ error: message }, { status });
  }
}

import { NextResponse } from 'next/server';
import type { Firestore } from 'firebase-admin/firestore';
import { getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import {
  AccessDeniedError,
  accessErrorResponse,
  authenticateAccess,
} from '@/lib/access-control-server';
import { canViewEmployeeProfile, checkerFor, hasPermission } from '@/lib/access-control';
import {
  buildCategoryIdMaps,
  buildOperationalDetail,
  buildSensitiveDetail,
  buildSyncedEmployee,
  detailLabels,
  employmentTypeLabels,
  isEmployeeMasterRecord,
  normalizeCategories,
  pruneEmpty,
  todayIso,
  type EmployeeAttendanceSummary,
  type EmployeeLeaveBalance,
  type EmployeeOperationalDetail,
  type EmployeeSensitiveDetail,
  type SyncedEmployee,
} from '@/lib/greythr';
import {
  fetchReferenceData,
  fetchSingleEmployee,
  fetchSingleEmployeeDetail,
  isGreytHRConfigured,
} from '@/lib/greythr-client';

/**
 * Everything this system holds about one employee.
 *
 * `GET /api/greythr/employees/{employeeId}`
 *
 * ── Why this exists rather than the screen reading Firestore itself ─────────────────────────────
 *
 * The profile screen used to do one thing: `getDoc(doc(db, 'employees', employeeId))`. That is a
 * lookup **by Firestore document id**, and the only screen that links to it — Manage Employee — sends
 * **greytHR's employee id**. The roster route those links come from says so in as many words: the
 * mirror is keyed "by greytHR's employee id, *not* by the Firestore document id. They are usually the
 * same … but not always."
 *
 * So the profile was blank in exactly the cases that matter most:
 *
 *   1. **Employees greytHR has that the mirror does not.** Manage Employee lists them deliberately
 *      (flagged "awaiting sync") rather than hiding new joiners until somebody runs a sync. There is
 *      no document to read, so every one of those names led to "Employee not found".
 *   2. **Records written by the older flows or the Add Employee dialog**, which use `addDoc` and get a
 *      generated document id. The roster joins them on their `employeeId` *field*, so the link
 *      carries a value that is not the document's id and the lookup missed.
 *   3. **A stale mirror.** Even on a hit, the screen could only show whatever the last sync wrote —
 *      and with no scheduler running, that could predate everything interesting about the person.
 *
 * This route fixes all three by separating "which employee" from "where the data lives":
 *
 *   - The mirror is searched by document id, then by the `employeeId` field, then by `employeeNo`, so
 *     any identifier a screen might plausibly hold resolves to the right record.
 *   - The detail is then refreshed from greytHR's **single-employee** endpoints — `/profile`,
 *     `/personal`, `/org-tree`, `/qualifications`, `/assets` and, behind their own permission, the
 *     restricted ones. One employee, a handful of small requests, no paging the workforce.
 *   - When greytHR answers, an employee absent from the mirror entirely still gets a full profile.
 *     When it does not, the mirror is served as-is and `live.ok: false` says so, so the screen can be
 *     honest rather than looking broken.
 *
 * Restricted data is fetched only when the caller holds `Employee.Personal Data · View`. That check
 * happens here, server-side, rather than being left to the screen: a client-side gate decides what to
 * *render*, and the point is not to send it at all.
 */

export const runtime = 'nodejs';

type FullEmployee = Partial<SyncedEmployee> & EmployeeOperationalDetail & { employeeId: string };

/** How the record was found, which the screen reports so a mismatch is diagnosable from the UI. */
type ResolvedVia = 'documentId' | 'employeeIdField' | 'employeeNo' | 'greythr';

interface MirrorMatch {
  /** The Firestore document id, which is not necessarily greytHR's employee id. */
  documentId: string;
  data: Partial<SyncedEmployee> & EmployeeOperationalDetail;
  via: ResolvedVia;
}

/**
 * Find the mirror document for an identifier, whatever kind of identifier it is.
 *
 * Three keys, tried in order of how much they prove. The document id is the sync's own key and so the
 * common case; the `employeeId` field is what the roster actually emits and the only thing a
 * pre-integration document has in common with greytHR; `employeeNo` (`E1383`) is the identifier a
 * human recognises and the one the legacy flows keyed on.
 *
 * Salary rows are excluded at every step. `sync-salary-flow.ts` writes one document per employee per
 * month into this same collection, and one of those matching on `employeeNo` would render as a person
 * whose department and email are blank — which looks exactly like the bug this route fixes.
 */
async function findInMirror(db: Firestore, requested: string): Promise<MirrorMatch | null> {
  const collection = db.collection('employees');

  const direct = await collection.doc(requested).get();
  if (direct.exists && isEmployeeMasterRecord(direct.data())) {
    return {
      documentId: direct.id,
      data: direct.data() as MirrorMatch['data'],
      via: 'documentId',
    };
  }

  /**
   * Both the string and the number.
   *
   * The sync stores `employeeId` as a string (`String(employee.employeeId)`), but documents written
   * before it did — and anything hand-edited in the console — may hold the numeric 208. Firestore
   * equality is typed, so `where('employeeId', '==', '208')` does not match `208`, and querying only
   * one of them would leave exactly the legacy records this route exists to reach unfindable.
   */
  const candidates: Array<string | number> = /^\d+$/.test(requested)
    ? [requested, Number(requested)]
    : [requested];

  for (const field of ['employeeId', 'employeeNo'] as const) {
    for (const value of candidates) {
      const snapshot = await collection.where(field, '==', value).limit(5).get();
      const match = snapshot.docs.find((doc) => isEmployeeMasterRecord(doc.data()));
      if (match) {
        return {
          documentId: match.id,
          data: match.data() as MirrorMatch['data'],
          via: field === 'employeeId' ? 'employeeIdField' : 'employeeNo',
        };
      }
    }
  }

  return null;
}

/**
 * One employee, built from greytHR right now.
 *
 * Assembled with the same functions the sync uses, so a live profile and a synced one cannot disagree
 * about how a record is derived. Returns `null` only when greytHR has no such employee — every
 * *partial* failure is tolerated inside, because a missing visa record should not cost somebody their
 * whole profile.
 */
async function fetchLiveEmployee(
  greytHRId: string,
  options: { includeSensitive: boolean },
): Promise<{
  record: SyncedEmployee;
  operational: EmployeeOperationalDetail;
  sensitive: EmployeeSensitiveDetail | null;
  unavailable: string[];
} | null> {
  const [snapshot, detail] = await Promise.all([
    fetchSingleEmployee(greytHRId),
    fetchSingleEmployeeDetail(greytHRId, { includeSensitive: options.includeSensitive }),
  ]);

  if (!snapshot.employee) return null;

  /**
   * The reference lists, for the code→label maps.
   *
   * `fetchSingleEmployee` already fetches them when the single-employee categories endpoint arrives
   * without descriptions — which is the normal case — so this second call almost never happens. It is
   * here for the tenant where categories *do* carry descriptions, because the personal and statutory
   * endpoints still answer in codes (`maritalStatus: 1`) and would otherwise render as digits.
   */
  const reference = snapshot.reference ?? (await fetchReferenceData().catch(() => null));

  const maps = buildCategoryIdMaps(reference);
  const normalized = normalizeCategories(snapshot.categories, {
    categoryNamesById: maps.categoryNameById,
    valueNamesByCategory: maps.valueNamesByCategory,
  });

  const record = buildSyncedEmployee({
    employee: snapshot.employee,
    separation: snapshot.separation,
    // Already resolved to names above, so handed on in the shape `buildSyncedEmployee` expects.
    categories: normalized.map((entry) => ({
      categoryDesc: entry.category,
      valueDesc: entry.value,
      effectiveFrom: entry.effectiveFrom,
      effectiveTo: entry.effectiveTo,
    })),
    work: snapshot.work,
    employmentTypeLabels: employmentTypeLabels(reference),
    onDate: todayIso(),
  });

  const labels = detailLabels(reference);

  const operational = buildOperationalDetail({
    profile: detail.profile,
    personal: detail.personal,
    orgTree: detail.orgTree,
    qualifications: detail.qualifications,
    assets: detail.assets,
    addresses: detail.addresses,
    labels,
  });

  const sensitive = options.includeSensitive
    ? buildSensitiveDetail({
        employeeId: record.employeeId,
        employeeNo: record.employeeNo,
        name: record.name,
        addresses: detail.addresses,
        statutory: detail.statutory,
        identities: detail.identities,
        bank: detail.bank,
        pf: detail.pf,
        passport: detail.passport,
        visa: detail.visa,
        labels,
        syncedAt: new Date().toISOString(),
      })
    : null;

  return { record, operational, sensitive, unavailable: detail.unavailable };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ employeeId: string }> },
) {
  try {
    const context = await authenticateAccess(request);
    const can = checkerFor(context.access);
    if (!canViewEmployeeProfile(can)) {
      throw new AccessDeniedError(
        'Viewing Employee Management or the Employee module is required to open an employee profile.',
      );
    }

    // Checked here, not trusted from the client: the restricted groups are not fetched at all for a
    // caller who may not see them, so they never reach a browser that would only have hidden them.
    const canViewPersonal = hasPermission(context.access, 'Employee.Personal Data', 'View');

    const requested = String((await params).employeeId ?? '').trim();
    if (!requested) {
      return NextResponse.json({ error: 'An employee id is required.' }, { status: 400 });
    }

    const db = getFirebaseAdminFirestore();
    const mirror = await findInMirror(db, requested);

    /**
     * Which id to ask greytHR about.
     *
     * The mirror's `employeeId` field when we found a record — it is the authority on which greytHR
     * employee this document represents, and it is not always the document id. Otherwise the
     * requested value, but only if it looks like a greytHR id: sending a generated Firestore document
     * id to greytHR earns a 404 and a pointless round trip.
     */
    const mirrorGreytHRId = String(mirror?.data.employeeId ?? '').trim();
    const greytHRId =
      mirrorGreytHRId || (/^\d+$/.test(requested) ? requested : '');

    let live: Awaited<ReturnType<typeof fetchLiveEmployee>> = null;
    let liveError: string | null = null;

    if (greytHRId && isGreytHRConfigured()) {
      try {
        live = await fetchLiveEmployee(greytHRId, { includeSensitive: canViewPersonal });
        if (!live) liveError = `greytHR has no employee with id ${greytHRId}.`;
      } catch (error) {
        /**
         * Never fatal.
         *
         * A greytHR outage, an expired credential or a network blip must degrade this to "the mirror,
         * labelled as unverified" rather than break it — the same rule the roster route follows, and
         * for the same reason: this screen is often where somebody goes to work out why the
         * integration looks wrong.
         */
        liveError = error instanceof Error ? error.message : 'greytHR could not be reached.';
        console.warn(`[greythr/employee] Live detail unavailable for ${greytHRId}.`, error);
      }
    } else if (!greytHRId) {
      liveError = 'This record has no greytHR employee id, so it cannot be refreshed from greytHR.';
    } else {
      liveError = 'greytHR credentials are not configured on the server.';
    }

    if (!mirror && !live) {
      return NextResponse.json(
        {
          error: liveError
            ? `No employee matched "${requested}" in the local mirror. ${liveError}`
            : `No employee matched "${requested}".`,
        },
        { status: 404 },
      );
    }

    /**
     * The mirror underneath, live on top.
     *
     * Live wins for every field it defines — including its nulls, because `buildSyncedEmployee`
     * computes `exitDate` from a live separation record and a stale mirror value must not survive that.
     * A detail group that could not be read defines nothing at all (`buildOperationalDetail` prunes
     * absent values), so the mirror's copy shows through instead of being blanked. That ordering is
     * what makes a stale mirror degrade the *completeness* of this screen and never its correctness.
     */
    const employee: FullEmployee = {
      ...(mirror?.data ?? {}),
      ...(live ? { ...live.record, ...live.operational } : {}),
      // Whatever was asked for, so the screen's id matches the URL the user is looking at.
      employeeId: live?.record.employeeId ?? (mirrorGreytHRId || requested),
    };

    /**
     * Leave, attendance and the stored restricted block, keyed by the *resolved* id.
     *
     * The same class of bug this route fixes lives here too: these collections are written by the sync
     * under greytHR's employee id, so looking them up with whatever the URL happened to carry would
     * miss for exactly the records that needed the lookup. Read in parallel and individually tolerant
     * — an absent document means that group is not being synced, which is not an error.
     */
    const detailId = mirrorGreytHRId || live?.record.employeeId || mirror?.documentId || requested;

    const [leaveSnap, attendanceSnap, storedSensitiveSnap] = await Promise.all([
      db.collection('employeeLeaveBalance').doc(detailId).get().catch(() => null),
      db.collection('employeeAttendance').doc(detailId).get().catch(() => null),
      canViewPersonal
        ? db.collection('employeeSensitive').doc(detailId).get().catch(() => null)
        : Promise.resolve(null),
    ]);

    const leave = leaveSnap?.exists ? (leaveSnap.data() as EmployeeLeaveBalance) : null;
    const attendance = attendanceSnap?.exists
      ? (attendanceSnap.data() as EmployeeAttendanceSummary)
      : null;
    const storedSensitive = storedSensitiveSnap?.exists
      ? (storedSensitiveSnap.data() as EmployeeSensitiveDetail)
      : null;

    /**
     * Restricted data: live over stored, group by group.
     *
     * Merged rather than replaced because the two halves can legitimately differ in coverage — the
     * sync writes only the groups an administrator enabled, while the live fetch reads every one it
     * can. `pruneEmpty` drops the groups greytHR had nothing for, so an enabled-and-synced group is
     * never blanked by a live endpoint that happened to 404.
     */
    const sensitive: EmployeeSensitiveDetail | null = canViewPersonal
      ? live?.sensitive || storedSensitive
        ? {
            ...(storedSensitive ?? {}),
            ...((pruneEmpty(live?.sensitive ?? undefined) as EmployeeSensitiveDetail | undefined) ?? {}),
            employeeId: detailId,
            syncedAt: live?.sensitive?.syncedAt ?? storedSensitive?.syncedAt ?? '',
          }
        : null
      : null;

    return NextResponse.json({
      ok: true,
      employee,
      sensitive,
      leave,
      attendance,
      /** How this record was found, and under which ids the rest of its data was looked up. */
      resolution: {
        via: (live && !mirror ? 'greythr' : mirror?.via) ?? null,
        documentId: mirror?.documentId ?? null,
        greytHRId: greytHRId || null,
        /** True when greytHR has this person but no sync has written them here yet. */
        awaitingSync: !mirror && !!live,
      },
      live: {
        ok: !!live,
        error: liveError,
        /** Detail endpoints that could not be read, so the screen says "not available", not "none". */
        unavailable: live?.unavailable ?? [],
        fetchedAt: live ? new Date().toISOString() : null,
      },
      /** Whether the restricted block above was fetched at all. */
      personalDataIncluded: canViewPersonal,
      mirrorSyncedAt: mirror?.data.syncedAt ?? null,
    });
  } catch (error) {
    const { message, status } = accessErrorResponse(error);
    return NextResponse.json({ error: message }, { status });
  }
}

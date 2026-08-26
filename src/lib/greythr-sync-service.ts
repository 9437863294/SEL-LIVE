import 'server-only';

/**
 * The greytHR sync run: fetch, reconcile, write, report.
 *
 * Rules are in `greythr.ts` and HTTP is in `greythr-client.ts`; this module is the orchestration
 * between them and the only place that writes Firestore. Admin SDK throughout, because the cron runs
 * at 02:00 with nobody signed in.
 *
 * ── What a run does, and what it refuses to do ──────────────────────────────────────────────────
 *
 * It maintains `employees` (the HR mirror), optionally the linked user's department/designation
 * membership in `accessGrants`, and optionally `users.status` when the exit policy says so. It
 * writes a run record either way, so an administrator can see what the sync would have done before
 * they let it do anything.
 *
 * It will not:
 *
 *   - **Delete an employee.** An employee missing from a `modifiedSince` page is unchanged, not
 *     gone; and one missing from a full fetch may be a greytHR permissions change rather than a
 *     departure. Missing records are flagged, never actioned.
 *   - **Grant a role.** Membership feeds the Department and Designation rules an administrator
 *     configured in Access Management; the sync never decides what a designation is worth.
 *   - **Deactivate the last administrator.** Checked against the same resolver the access screens
 *     use, so a run cannot lock the organisation out of its own permissions.
 *   - **Reverse a human decision.** Only accounts this sync deactivated are ever reactivated,
 *     tracked by a marker on the user document.
 */

import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { getFirebaseAdminFirestore } from './firebase-admin';
import {
  DEFAULT_SYNC_SETTINGS,
  GREYTHR_MIRROR_VERSION,
  buildAttendanceSummary,
  buildCategoryIdMaps,
  buildLeaveBalance,
  currentAttendancePeriod,
  currentLeaveYear,
  hasAttendanceData,
  leaveTypeNamesFrom,
  buildOperationalDetail,
  buildSensitiveDetail,
  buildSyncedEmployee,
  detailGroupSpec,
  hasSensitiveDetail,
  isSensitiveGroup,
  deriveEmploymentState,
  diffSyncedEmployee,
  employmentSignals,
  employmentTypeLabels,
  indexUsersByEmail,
  isEmployeeMasterRecord,
  isWorkingState,
  indexUsersByEmployeeId,
  matchUserForEmployee,
  modifiedSinceFor,
  normalizeSyncSettings,
  resolveAccessDecision,
  shouldForceFullResync,
  shouldDeactivateOnResignation,
  summarizeRun,
  todayIso,
  type EmployeeDetailGroup,
  type EmploymentState,
  type EmployeeOperationalDetail,
  type EmployeeSensitiveDetail,
  type GreytHRAddressRow,
  type GreytHRAddressType,
  type GreytHRAssetRow,
  type GreytHRBankRow,
  type GreytHRIdentityCode,
  type GreytHRIdentityRow,
  type GreytHRLovResponse,
  type GreytHROrgTreeRow,
  type GreytHRPersonalRow,
  type GreytHRPfRow,
  type GreytHRProfileRow,
  type GreytHRQualificationRow,
  type GreytHRStatutoryRow,
  type GreytHRSyncRun,
  type GreytHRSyncSettings,
  type GreytHRTravelDocRow,
  type SyncEmployeeOutcome,
  type SyncedEmployee,
} from './greythr';
import { assertNoProtectedFields, pickGreytHRFields } from './greythr-linking';
import {
  fetchAttendanceInsights,
  fetchLeaveBalances,
  fetchLeaveTypeDictionary,
  fetchEmployeeAddresses,
  fetchEmployeeAssets,
  fetchEmployeeBank,
  fetchEmployeeCategories,
  fetchEmployeeIdentities,
  fetchEmployeeOrgTree,
  fetchEmployeePersonal,
  fetchEmployeePf,
  fetchEmployeePassports,
  fetchEmployeeProfiles,
  fetchEmployeeQualifications,
  fetchEmployeeStatutory,
  fetchEmployeeVisas,
  fetchEmployeeWork,
  fetchEmployees,
  fetchReferenceData,
  fetchSeparations,
  greytHRConfig,
} from './greythr-client';
import {
  normalizeUserAccessGrant,
  resolveEffectiveAccess,
  wouldStrandAdministration,
  type RoleLike,
  type ScopeGrantConfig,
} from './access-control';

/* ------------------------------------------------------------------------------------------------
 * Collections
 * ---------------------------------------------------------------------------------------------- */

export const GREYTHR_COLLECTIONS = {
  /** The existing employee mirror. Same collection, same document ids, richer documents. */
  employees: 'employees',
  /** The existing per-employee category history, kept for the Position Details screen. */
  employeePositions: 'employeePositions',
  /**
   * Restricted personal data — Aadhaar, PAN, bank accounts, religion, disability, addresses.
   *
   * A separate collection specifically so it can carry a separate security rule. The `employees`
   * mirror is readable by every signed-in user (the HR module, the access screens and several
   * pickers all read it); special-category personal data must not be.
   */
  employeeSensitive: 'employeeSensitive',
  /** `settings/greythrSync` — schedule, policy, last-run pointers. */
  settings: 'settings',
  settingsDoc: 'greythrSync',
  /** The category master lists (Department, Designation, Location, Project Name…) behind
   * `/employee/category`. Previously maintained only by its own manual button. */
  categories: 'categories',
  /**
   * Leave and attendance, one document per employee.
   *
   * Separate collections rather than fields on `employees`, because both are *periodic*: a leave
   * balance belongs to a year and an attendance summary to a month. Merging them onto the employee
   * record would silently overwrite last month's figures with this month's and leave no way to tell
   * which period a number came from — so each document records its own period.
   */
  leaveBalance: 'employeeLeaveBalance',
  attendance: 'employeeAttendance',
  /** One document per run. */
  runs: 'greythrSyncRuns',
  users: 'users',
  roles: 'roles',
  grants: 'accessGrants',
  scopeGrants: 'accessScopeGrants',
} as const;

/** Marker written onto a user document so the sync only ever reverses its own deactivations. */
const SYNC_ACTOR = 'greythr-sync';

/**
 * Remove `undefined` at every depth, keeping `null`.
 *
 * Firestore rejects `undefined` anywhere in a document — including inside array elements — and the
 * error names a single field out of a whole batch, so a nested one is expensive to find. This used to
 * filter only the top level, and a `qualifications[0].level` two levels down failed a 182-employee
 * run at commit with nothing written.
 *
 * `null` is deliberately kept, which is the difference between this and `pruneEmpty`. A synced
 * employee record uses `null` to mean "greytHR has no value here" — `dateOfJoin: null`,
 * `exitDate: null` — and `diffSyncedEmployee` compares against those. Stripping them would make a
 * field that was cleared in greytHR look unchanged, so a departure date removed upstream would never
 * be removed here. The detail blocks are the opposite case and are pruned before they arrive.
 */
function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)).filter((item) => item !== undefined) as T;
  }

  // Plain objects only. `FieldValue.delete()` sentinels, Timestamps and Dates travel through here on
  // the way to a write and must not be taken apart.
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item === undefined) continue;
      out[key] = stripUndefined(item);
    }
    return out as T;
  }

  return value;
}

/* ------------------------------------------------------------------------------------------------
 * Settings
 * ---------------------------------------------------------------------------------------------- */

export async function readSyncSettings(db: Firestore = getFirebaseAdminFirestore()): Promise<GreytHRSyncSettings> {
  const snapshot = await db
    .collection(GREYTHR_COLLECTIONS.settings)
    .doc(GREYTHR_COLLECTIONS.settingsDoc)
    .get();
  return normalizeSyncSettings(snapshot.exists ? (snapshot.data() as Partial<GreytHRSyncSettings>) : null);
}

export async function writeSyncSettings(
  settings: Partial<GreytHRSyncSettings>,
  actor: { userId: string; userName: string },
  db: Firestore = getFirebaseAdminFirestore(),
): Promise<GreytHRSyncSettings> {
  const current = await readSyncSettings(db);
  const merged = normalizeSyncSettings({ ...current, ...settings });
  await db
    .collection(GREYTHR_COLLECTIONS.settings)
    .doc(GREYTHR_COLLECTIONS.settingsDoc)
    .set(
      stripUndefined({
        ...merged,
        updatedAt: new Date().toISOString(),
        updatedBy: actor.userId,
        updatedByName: actor.userName,
      }),
      { merge: true },
    );
  return merged;
}

/* ------------------------------------------------------------------------------------------------
 * The run
 * ---------------------------------------------------------------------------------------------- */

export interface RunSyncOptions {
  trigger: 'cron' | 'manual';
  triggeredBy?: string | null;
  triggeredByName?: string | null;
  /** Ignore `modifiedSince` and refetch everything. */
  fullResync?: boolean;
  /**
   * Compute and report without writing anything at all. What the settings screen's "Preview" uses,
   * so an administrator can see the first run's findings before trusting them.
   */
  dryRun?: boolean;
  db?: Firestore;
}

/**
 * Fetch from greytHR, reconcile against Firestore, and report.
 *
 * The four source calls run in parallel — they are independent reads and doing them in sequence adds
 * a minute to every run for no benefit. Only the employee roster is filtered by `modifiedSince`;
 * separation, categories and work have no such parameter, so they are fetched whole and indexed by
 * employee id. That is the right trade even on an incremental run: three full reads of small
 * payloads beat one-per-employee lookups.
 */
export async function runGreytHRSync(options: RunSyncOptions): Promise<GreytHRSyncRun> {
  const db = options.db ?? getFirebaseAdminFirestore();
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const runId = `${startedAt.replace(/[:.]/g, '-')}-${options.trigger}`;
  const warnings: string[] = [];
  const today = todayIso();

  const settings = await readSyncSettings(db);

  /**
   * A watermark is only trustworthy once a full run has established a baseline.
   *
   * Without this the sync had no way back from a partial mirror: any successful run advanced
   * `lastSuccessfulRunAt`, every later run was therefore incremental, and an incremental run returns
   * only what greytHR says changed. What changes is leavers and people on notice — so the mirror
   * silently converged on exactly the wrong population and the active majority never arrived.
   */
  const baseline = shouldForceFullResync(settings);
  if (baseline.reason) warnings.push(baseline.reason);

  const modifiedSince = modifiedSinceFor(settings.lastSuccessfulRunAt, {
    fullResync: options.fullResync || baseline.force,
  });

  const run: GreytHRSyncRun = {
    id: runId,
    startedAt,
    finishedAt: null,
    trigger: options.trigger,
    triggeredBy: options.triggeredBy ?? null,
    triggeredByName: options.triggeredByName ?? null,
    fullResync: Boolean(options.fullResync) || modifiedSince === null,
    modifiedSince,
    ok: false,
    employeesFetched: 0,
    employeesCreated: 0,
    employeesUpdated: 0,
    employeesUnchanged: 0,
    usersDeactivated: 0,
    usersReactivated: 0,
    flaggedForReview: 0,
    membershipUpdated: 0,
    tookMs: 0,
    outcomes: [],
    warnings,
  };

  try {
    greytHRConfig(); // Fail fast and clearly if credentials are missing.

    const [employeeResult, separationResult, categoryResult, workResult, reference] = await Promise.all([
      fetchEmployees({ state: 'ALL', modifiedSince }),
      fetchSeparations(),
      fetchEmployeeCategories(),
      fetchEmployeeWork(),
      // Reference data is a nicety — employment-type *labels*. A failure degrades to greytHR's
      // shipped defaults rather than failing the run.
      fetchReferenceData().catch((error) => {
        warnings.push(`Could not load reference lists: ${error instanceof Error ? error.message : 'unknown error'}`);
        return null;
      }),
    ]);

    /**
     * The optional detail groups.
     *
     * Fetched only when enabled, and each one tolerant of its own failure: a tenant that has never
     * populated `passport` should not lose a whole run over a 404, and a group that errors is
     * reported as a warning rather than aborting the employees everybody else depends on.
     */
    const detail = await fetchEnabledDetailGroups(settings.detailGroups, warnings);

    run.employeesFetched = employeeResult.rows.length;
    const typeLabels = employmentTypeLabels(reference);

    const separationById = new Map(separationResult.rows.map((row) => [String(row.employeeId), row]));
    const categoriesById = new Map(categoryResult.rows.map((row) => [String(row.employeeId), row]));
    const workById = new Map(workResult.rows.map((row) => [String(row.employeeId), row]));

    /* ── Existing state ── */

    const [employeeSnapshot, userSnapshot] = await Promise.all([
      db.collection(GREYTHR_COLLECTIONS.employees).get(),
      db.collection(GREYTHR_COLLECTIONS.users).get(),
    ]);

    /**
     * Only the real employee records.
     *
     * `sync-salary-flow.ts` also writes into this collection — one document per employee per month,
     * carrying `salaryMonth`. Without this filter a full resync reports every one of them as
     * "exists here but greytHR did not return it", which at a few months of history is thousands of
     * false warnings burying the ones that matter.
     */
    const salaryRowCount = employeeSnapshot.docs.filter((doc) => !isEmployeeMasterRecord(doc.data())).length;
    const storedEmployees = new Map<string, Partial<SyncedEmployee>>(
      employeeSnapshot.docs
        .filter((doc) => isEmployeeMasterRecord(doc.data()))
        .map((doc) => [doc.id, doc.data() as Partial<SyncedEmployee>]),
    );
    if (salaryRowCount > 0) {
      warnings.push(
        `${salaryRowCount} document(s) in the employees collection are salary rows written by the ` +
          'salary sync, not employee records. They were ignored here, but they also appear in ' +
          'Employee Management and inflate headcounts — worth moving to their own collection.',
      );
    }

    const users = userSnapshot.docs.map((doc) => ({
      id: doc.id,
      email: (doc.data().email as string | undefined) ?? null,
      status: (doc.data().status as 'Active' | 'Inactive' | undefined) ?? 'Active',
      role: (doc.data().role as string | undefined) ?? '',
      name: (doc.data().name as string | undefined) ?? '',
      deactivatedBy: (doc.data().deactivatedBy as string | undefined) ?? null,
      /** Set when the account was created by picking a greytHR employee. */
      employeeId: (doc.data().employeeId as string | undefined) ?? null,
    }));

    const { index: usersByEmail, duplicates } = indexUsersByEmail(users);
    if (duplicates.length) {
      warnings.push(
        `${duplicates.length} email address(es) are shared by more than one user account, so those ` +
          `employees were not linked: ${duplicates.slice(0, 5).join(', ')}${duplicates.length > 5 ? '…' : ''}.`,
      );
    }

    const { index: usersByEmployeeId, duplicates: idDuplicates } = indexUsersByEmployeeId(users);
    if (idDuplicates.length) {
      warnings.push(
        `${idDuplicates.length} greytHR employee(s) are claimed by more than one user account, so ` +
          `they were not linked: ${idDuplicates.slice(0, 5).join(', ')}${idDuplicates.length > 5 ? '…' : ''}.`,
      );
    }
    const usersById = new Map(users.map((user) => [user.id, user]));

    /* ── Administration safety net ── */

    const administrators = await loadAdministrators(db, users);

    /* ── Reconcile ── */

    const labels = detailLabels(reference);
    const created = new Set<string>();
    const outcomes: SyncEmployeeOutcome[] = [];
    const employeeWrites: Array<{ id: string; record: SyncedEmployee & EmployeeOperationalDetail }> = [];
    const sensitiveWrites: Array<{ id: string; record: EmployeeSensitiveDetail }> = [];
    const positionWrites: Array<{ id: string; data: Record<string, unknown> }> = [];
    const userWrites: Array<{ id: string; data: Record<string, unknown> }> = [];
    const grantWrites: Array<{ id: string; data: Record<string, unknown> }> = [];

    for (const employee of employeeResult.rows) {
      const id = String(employee.employeeId);
      const separation = separationById.get(id) ?? null;
      const categoryRow = categoriesById.get(id) ?? null;

      const record = buildSyncedEmployee({
        employee,
        separation,
        categories: categoryRow?.categoryList ?? null,
        work: workById.get(id) ?? null,
        employmentTypeLabels: typeLabels,
        onDate: today,
        syncedAt: startedAt,
      });

      /* ── Detail groups ── */

      const addresses = detail.addresses.get(id);
      const operational = buildOperationalDetail({
        profile: detail.profile.get(id),
        personal: detail.personal.get(id),
        orgTree: detail.orgTree.get(id),
        qualifications: detail.qualifications.get(id),
        assets: detail.assets.get(id),
        addresses,
        labels,
      });

      const stored = storedEmployees.get(id);
      const changes = diffSyncedEmployee(stored, record);
      if (!stored) created.add(id);
      // Detail is merged onto the same document, so a change in either half triggers the write.
      // `diffSyncedEmployee` only tracks the core fields, so detail-only changes are caught by
      // comparing the assembled block rather than being silently skipped.
      const detailChanged =
        Object.keys(operational).length > 0 &&
        JSON.stringify(operational) !== JSON.stringify(pickOperational(stored));
      if (!stored || changes.length || detailChanged) {
        employeeWrites.push({ id, record: { ...record, ...operational } });
      }

      if (detail.sensitiveFetched) {
        const sensitive = buildSensitiveDetail({
          employeeId: id,
          employeeNo: record.employeeNo,
          name: record.name,
          addresses,
          statutory: detail.statutory.get(id),
          identities: detail.identities.get(id),
          bank: detail.bank.get(id),
          pf: detail.pf.get(id),
          passport: detail.passport.get(id),
          visa: detail.visa.get(id),
          labels,
          syncedAt: startedAt,
        });
        // Only written when there is something to write — an employee with no restricted data on
        // file should not get an empty document in the restricted collection.
        if (hasSensitiveDetail(sensitive)) sensitiveWrites.push({ id, record: sensitive });
      }

      /* Position history — keyed by employeeNo, as the existing Position Details screen expects. */
      if (categoryRow?.categoryList?.length && record.employeeNo) {
        positionWrites.push({
          id: record.employeeNo,
          data: {
            employeeId: record.employeeNo,
            greytHREmployeeId: id,
            categoryList: categoryRow.categoryList.map((entry) => ({
              id: entry.id ?? null,
              category: entry.categoryDesc ?? String(entry.category ?? ''),
              value: entry.valueDesc ?? String(entry.value ?? ''),
              effectiveFrom: entry.effectiveFrom ?? null,
              effectiveTo: entry.effectiveTo ?? null,
            })),
            syncedAt: startedAt,
          },
        });
      }

      /* ── The linked platform user ── */

      const userId = matchUserForEmployee(record, usersByEmail, usersByEmployeeId);
      const user = userId ? usersById.get(userId) : undefined;

      // Notice Period counts as working everywhere except under the strictest policy, which is
      // handled here rather than inside the shared derivation.
      const stateForAccess =
        shouldDeactivateOnResignation(record.employmentState, settings.exitPolicy)
          ? 'Relieved'
          : record.employmentState;

      const decision = resolveAccessDecision({
        state: stateForAccess,
        policy: settings.exitPolicy,
        currentUserStatus: user ? user.status : null,
        deactivatedBySync: user?.deactivatedBy === SYNC_ACTOR,
        wouldStrandAdministration: userId
          ? wouldStrandAdministration(administrators, [userId])
          : false,
      });

      if (userId && decision.action === 'deactivate') {
        userWrites.push({
          id: userId,
          data: {
            status: 'Inactive',
            deactivatedBy: SYNC_ACTOR,
            deactivatedAt: startedAt,
            deactivationReason: decision.reason,
          },
        });
      } else if (userId && decision.action === 'reactivate') {
        userWrites.push({
          id: userId,
          data: {
            status: 'Active',
            deactivatedBy: FieldValue.delete(),
            deactivatedAt: FieldValue.delete(),
            deactivationReason: FieldValue.delete(),
            reactivatedBy: SYNC_ACTOR,
            reactivatedAt: startedAt,
          },
        });
      }

      /* ── Membership, feeding the access layer's scope rules ── */

      if (userId && settings.mapping.syncAccessMembership) {
        const membership = membershipUpdateFor(record);
        if (membership) grantWrites.push({ id: userId, data: { ...membership, syncedAt: startedAt } });
      }

      const flagged = decision.flagForReview;
      if (changes.length || flagged || decision.action !== 'none') {
        outcomes.push({
          employeeId: id,
          employeeNo: record.employeeNo,
          name: record.name,
          email: record.email,
          employmentState: record.employmentState,
          employmentStateReason: record.employmentStateReason,
          changes,
          userId: userId ?? null,
          accessAction: decision.action,
          accessReason: decision.reason,
          flagged,
        });
      }
    }

    /* ── Employees present locally but absent from a full fetch ── */

    if (run.fullResync) {
      const fetchedIds = new Set(employeeResult.rows.map((row) => String(row.employeeId)));
      const missing = [...storedEmployees.keys()].filter((id) => !fetchedIds.has(id));
      if (missing.length) {
        // Deliberately not actioned. An employee absent from greytHR may have been deleted, or the
        // API user's scope may have narrowed — and the second is indistinguishable from the first.
        warnings.push(
          `${missing.length} employee record(s) exist here but were not returned by greytHR. ` +
            'They have been left untouched; review them if this is unexpected.',
        );
        for (const id of missing.slice(0, 50)) {
          const stored = storedEmployees.get(id);
          const state = deriveEmploymentState(null, today);
          outcomes.push({
            employeeId: id,
            employeeNo: String(stored?.employeeNo ?? ''),
            name: String(stored?.name ?? ''),
            email: String(stored?.email ?? ''),
            employmentState: state.state,
            employmentStateReason: state.reason,
            changes: [],
            userId: null,
            accessAction: 'none',
            accessReason: 'Not returned by greytHR — left untouched for manual review.',
            flagged: true,
          });
        }
      }
    }

    /* ── Leave and attendance ── */

    const leaveWrites: Array<{ id: string; data: Record<string, unknown> }> = [];
    const attendanceWrites: Array<{ id: string; data: Record<string, unknown> }> = [];

    if (settings.detailGroups.leave) {
      try {
        const year = currentLeaveYear();
        const { rows } = await fetchLeaveBalances(year);

        /**
         * One extra call to learn the leave-type names.
         *
         * The bulk endpoint returns `leaveTypeCategory` as a bare id and greytHR publishes no LOV key
         * for leave types, so the single-employee variant — which does carry descriptions — is asked
         * about the first employee in the result. Leave types are organisation-wide, so one call
         * names them for everybody.
         */
        let leaveTypeNames: Record<string, { name: string; code: string }> = {};
        const sampleId = rows.find((row) => row.employeeId !== undefined)?.employeeId;
        if (sampleId !== undefined) {
          leaveTypeNames = leaveTypeNamesFrom(
            await fetchLeaveTypeDictionary(sampleId, year).catch(() => null),
          );
          if (!Object.keys(leaveTypeNames).length) {
            warnings.push('Leave types could not be named; balances will show numeric type ids.');
          }
        }

        for (const row of rows) {
          const balance = buildLeaveBalance(row, { year, leaveTypeNames, syncedAt: startedAt });
          if (balance.lines.length) {
            leaveWrites.push({ id: balance.employeeId, data: balance as unknown as Record<string, unknown> });
          }
        }
      } catch (error) {
        warnings.push(
          `Leave balances failed and were skipped: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
    }

    if (settings.detailGroups.attendance) {
      try {
        const period = currentAttendancePeriod();
        const { rows } = await fetchAttendanceInsights(period.start, period.end);
        for (const row of rows) {
          const summary = buildAttendanceSummary(row, {
            periodStart: period.start,
            periodEnd: period.end,
            syncedAt: startedAt,
          });
          // Employees with nothing recorded this month are skipped rather than given an empty
          // document — a blank attendance card reads as a system fault rather than as "no data yet".
          if (hasAttendanceData(summary)) {
            attendanceWrites.push({ id: summary.employeeId, data: summary as unknown as Record<string, unknown> });
          }
        }
      } catch (error) {
        warnings.push(
          `Attendance summary failed and was skipped: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
    }

    /* ── Category master lists ── */

    /**
     * The value lists behind `/employee/category` — Department, Designation, Location, Project Name
     * and the rest.
     *
     * Written from the reference data this run already fetched, so the Category screen stops
     * depending on somebody remembering to press its own button. Keyed by `type_id` rather than an
     * auto-id: the previous flow deleted the whole collection and re-added it on every sync, which
     * meant a reader mid-sync saw an empty list. A deterministic id makes the write an idempotent
     * upsert instead.
     *
     * Stale values are left rather than deleted. A category value removed in greytHR is still
     * referenced by historical employee records, and deleting it would turn those into blanks.
     */
    const categoryWrites: Array<{ id: string; data: Record<string, unknown> }> = [];
    if (reference) {
      const maps = buildCategoryIdMaps(reference);
      for (const [categoryName, valuesById] of Object.entries(maps.valueNamesByCategory)) {
        for (const [valueId, valueName] of Object.entries(valuesById)) {
          categoryWrites.push({
            id: `${categoryName}_${valueId}`.replace(/[^a-zA-Z0-9_-]/g, '_'),
            data: { id: Number(valueId), name: valueName, type: categoryName, syncedAt: startedAt },
          });
        }
      }
    }

    /* ── Commit ── */

    if (!options.dryRun) {
      await commitBatched(db, [
        ...employeeWrites.map((write) => ({
          ref: db.collection(GREYTHR_COLLECTIONS.employees).doc(write.id),
          data: stripUndefined(write.record as unknown as Record<string, unknown>),
          merge: true,
        })),
        ...sensitiveWrites.map((write) => ({
          ref: db.collection(GREYTHR_COLLECTIONS.employeeSensitive).doc(write.id),
          data: stripUndefined(write.record as unknown as Record<string, unknown>),
          merge: true,
        })),
        ...positionWrites.map((write) => ({
          ref: db.collection(GREYTHR_COLLECTIONS.employeePositions).doc(write.id),
          data: write.data,
          merge: true,
        })),
        ...userWrites.map((write) => {
          /**
           * The last gate before an HR sync writes to a login record.
           *
           * Checked on the built payload rather than at the point each write is pushed, because a
           * guard next to the construction site can be bypassed by the next person who adds a
           * `userWrites.push`. Here it cannot: every user write in this run passes through this line.
           *
           * A sync that wrote `permissions` would silently undo every additive grant an
           * administrator had made, and nothing downstream would report it. Failing the run loudly
           * is strictly better than that.
           */
          assertNoProtectedFields(write.data, 'The greytHR sync');

          /**
           * Then narrow to the fields greytHR owns.
           *
           * Belt and braces: the assertion above catches the fields that would be catastrophic, this
           * catches everything else that is simply not greytHR's to write. Anything dropped is
           * reported as a run warning rather than discarded quietly — a silent filter turns "my new
           * field is not saving" into an afternoon of debugging.
           */
          const data = pickGreytHRFields(write.data);
          const dropped = Object.keys(write.data).filter((key) => !(key in data));
          if (dropped.length) {
            warnings.push(
              `Ignored ${dropped.join(', ')} on user ${write.id}: greytHR may only write HR fields. ` +
                'Add the field to GREYTHR_OWNED_USER_FIELDS if it genuinely belongs to HR.',
            );
          }

          return {
            ref: db.collection(GREYTHR_COLLECTIONS.users).doc(write.id),
            data,
            merge: true,
          };
        }),
        ...grantWrites.map((write) => ({
          ref: db.collection(GREYTHR_COLLECTIONS.grants).doc(write.id),
          data: write.data,
          merge: true,
        })),
        ...leaveWrites.map((write) => ({
          ref: db.collection(GREYTHR_COLLECTIONS.leaveBalance).doc(write.id),
          data: write.data,
          merge: true,
        })),
        ...attendanceWrites.map((write) => ({
          ref: db.collection(GREYTHR_COLLECTIONS.attendance).doc(write.id),
          data: write.data,
          merge: true,
        })),
        ...categoryWrites.map((write) => ({
          ref: db.collection(GREYTHR_COLLECTIONS.categories).doc(write.id),
          data: write.data,
          merge: true,
        })),
      ]);
    }

    const summary = summarizeRun(outcomes, created);
    Object.assign(run, summary);
    run.membershipUpdated = grantWrites.length;
    run.sensitiveRecordsWritten = sensitiveWrites.length;
    run.detailGroupsRun = Object.entries(settings.detailGroups)
      .filter(([, enabled]) => enabled)
      .map(([group]) => detailGroupSpec(group as EmployeeDetailGroup).label);
    run.ok = true;
    // Only the interesting rows are stored; a 1,300-row dump is not a report and would blow the
    // 1 MB document limit besides.
    run.outcomes = outcomes.slice(0, 300);
    if (outcomes.length > 300) {
      warnings.push(`${outcomes.length - 300} further changed rows are not listed in this run record.`);
    }
  } catch (error) {
    run.ok = false;
    run.error = error instanceof Error ? error.message : 'Unknown error';
  } finally {
    run.finishedAt = new Date().toISOString();
    run.tookMs = Date.now() - startedAtMs;

    if (!options.dryRun) {
      await Promise.all([
        db.collection(GREYTHR_COLLECTIONS.runs).doc(run.id).set(stripUndefined(run as unknown as Record<string, unknown>)),
        db
          .collection(GREYTHR_COLLECTIONS.settings)
          .doc(GREYTHR_COLLECTIONS.settingsDoc)
          .set(
            stripUndefined({
              lastRunAt: run.startedAt,
              lastRunId: run.id,
              // Only a successful run advances the incremental watermark. Advancing it on failure
              // would silently skip everything the failed run should have seen.
              ...(run.ok ? { lastSuccessfulRunAt: run.startedAt } : {}),
              // And only a successful *full* run records a baseline. This is what lets later runs go
              // incremental at all, so it must mean "every employee greytHR has was written", which
              // is only true of a run that asked for every employee.
              ...(run.ok && run.fullResync ? { baselineCompletedAt: run.startedAt } : {}),
              // A mirror version is evidence about the complete roster, so it advances only under
              // the same successful-full-run condition as the baseline timestamp.
              ...(run.ok && run.fullResync ? { mirrorVersion: GREYTHR_MIRROR_VERSION } : {}),
            }),
            { merge: true },
          ),
      ]).catch((error) => {
        console.error('[greythr] Failed to record run', error);
      });
    }
  }

  return run;
}

/* ------------------------------------------------------------------------------------------------
 * Detail groups
 * ---------------------------------------------------------------------------------------------- */

/** Everything the enabled detail groups returned, indexed by employee id. */
interface FetchedDetail {
  profile: Map<string, GreytHRProfileRow>;
  personal: Map<string, GreytHRPersonalRow>;
  orgTree: Map<string, GreytHROrgTreeRow>;
  qualifications: Map<string, GreytHRQualificationRow[]>;
  assets: Map<string, GreytHRAssetRow[]>;
  addresses: Map<string, Partial<Record<GreytHRAddressType, GreytHRAddressRow>>>;
  statutory: Map<string, GreytHRStatutoryRow>;
  identities: Map<string, Partial<Record<GreytHRIdentityCode, GreytHRIdentityRow>>>;
  bank: Map<string, GreytHRBankRow>;
  pf: Map<string, GreytHRPfRow>;
  passport: Map<string, GreytHRTravelDocRow>;
  visa: Map<string, GreytHRTravelDocRow>;
  /** Which sensitive groups actually ran, so the writer knows whether to touch that collection. */
  sensitiveFetched: boolean;
}

const emptyDetail = (): FetchedDetail => ({
  profile: new Map(),
  personal: new Map(),
  orgTree: new Map(),
  qualifications: new Map(),
  assets: new Map(),
  addresses: new Map(),
  statutory: new Map(),
  identities: new Map(),
  bank: new Map(),
  pf: new Map(),
  passport: new Map(),
  visa: new Map(),
  sensitiveFetched: false,
});

/** The operational-detail keys, so a stored document can be compared against a freshly built block. */
const OPERATIONAL_DETAIL_KEYS: Array<keyof EmployeeOperationalDetail> = [
  'nickname',
  'biography',
  'linkedIn',
  'twitter',
  'facebook',
  'bloodGroup',
  'maritalStatus',
  'marriageDate',
  'spouseName',
  'reportingManagerEmployeeId',
  'reportingManagerName',
  'emergencyContactName',
  'emergencyContactPhone',
  'qualifications',
  'assets',
];

/**
 * The operational-detail half of a stored employee document.
 *
 * Exists so a detail-only change — somebody's blood group being filled in, a new qualification — is
 * detected. `diffSyncedEmployee` deliberately tracks only the core fields, so without this a run
 * would fetch the detail, find the core unchanged, and never write it.
 */
function pickOperational(stored: Partial<SyncedEmployee> | undefined): EmployeeOperationalDetail {
  if (!stored) return {};
  const out: Record<string, unknown> = {};
  for (const key of OPERATIONAL_DETAIL_KEYS) {
    const value = (stored as Record<string, unknown>)[key];
    if (value !== undefined) out[key] = value;
  }
  return out as EmployeeOperationalDetail;
}

/** Index rows by employee id, tolerating the two field names greytHR uses for it. */
function indexById<T extends { employeeId?: number | string; employee?: number | string; relation?: number | string }>(
  rows: T[],
): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) {
    const id = row.employeeId ?? row.employee ?? row.relation;
    if (id === undefined || id === null) continue;
    map.set(String(id), row);
  }
  return map;
}

/** Same, but collecting every row per employee — qualifications and assets are one-to-many. */
function groupById<T extends { employeeId?: number | string; employee?: number | string }>(
  rows: T[],
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const id = row.employeeId ?? row.employee;
    if (id === undefined || id === null) continue;
    const key = String(id);
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }
  return map;
}

async function fetchEnabledDetailGroups(
  groups: Record<EmployeeDetailGroup, boolean>,
  warnings: string[],
): Promise<FetchedDetail> {
  const detail = emptyDetail();

  /** Run one group, converting a failure into a warning rather than an aborted run. */
  const attempt = async (group: EmployeeDetailGroup, work: () => Promise<void>): Promise<void> => {
    if (!groups[group]) return;
    try {
      await work();
      if (isSensitiveGroup(group)) detail.sensitiveFetched = true;
    } catch (error) {
      warnings.push(
        `Detail group "${detailGroupSpec(group).label}" failed and was skipped: ` +
          `${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  };

  await Promise.all([
    attempt('profile', async () => {
      detail.profile = indexById((await fetchEmployeeProfiles()).rows);
    }),
    attempt('personal', async () => {
      detail.personal = indexById((await fetchEmployeePersonal()).rows);
    }),
    attempt('reporting', async () => {
      detail.orgTree = indexById((await fetchEmployeeOrgTree()).rows);
    }),
    attempt('qualifications', async () => {
      detail.qualifications = groupById((await fetchEmployeeQualifications()).rows);
    }),
    attempt('assets', async () => {
      detail.assets = groupById((await fetchEmployeeAssets()).rows);
    }),
    attempt('addresses', async () => {
      const { byType, failed } = await fetchEmployeeAddresses();
      if (failed.length) warnings.push(`Address types unavailable in greytHR: ${failed.join(', ')}.`);
      for (const [type, rows] of Object.entries(byType)) {
        for (const row of rows ?? []) {
          const id = String(row.employeeId);
          const entry = detail.addresses.get(id) ?? {};
          entry[type as GreytHRAddressType] = row;
          detail.addresses.set(id, entry);
        }
      }
    }),
    attempt('statutory', async () => {
      detail.statutory = indexById((await fetchEmployeeStatutory()).rows);
    }),
    attempt('identities', async () => {
      const { byCode, failed } = await fetchEmployeeIdentities();
      if (failed.length) warnings.push(`Identity types unavailable in greytHR: ${failed.join(', ')}.`);
      for (const [code, rows] of Object.entries(byCode)) {
        for (const row of rows ?? []) {
          const id = String(row.employeeId);
          const entry = detail.identities.get(id) ?? {};
          entry[code as GreytHRIdentityCode] = row;
          detail.identities.set(id, entry);
        }
      }
    }),
    attempt('bank', async () => {
      const [bank, pf] = await Promise.all([fetchEmployeeBank(), fetchEmployeePf()]);
      detail.bank = indexById(bank.rows);
      detail.pf = indexById(pf.rows);
    }),
    attempt('travel', async () => {
      const [passports, visas] = await Promise.all([fetchEmployeePassports(), fetchEmployeeVisas()]);
      detail.passport = indexById(passports.rows);
      detail.visa = indexById(visas.rows);
    }),
  ]);

  // The emergency contact is mirrored into the operational record, which means the addresses group
  // being on is what makes that possible. Worth saying, because the alternative is an administrator
  // wondering why the field is always blank.
  if (!groups.addresses) {
    warnings.push(
      'Addresses are not being synced, so emergency contact details are unavailable. Enable the ' +
        '"Addresses & emergency contact" group to populate them.',
    );
  }

  return detail;
}

/** Turn the LOV payload into the code→label maps the detail builders use. */
function detailLabels(reference: GreytHRLovResponse | null) {
  const asMap = (key: string): Record<string, string> | undefined => {
    const rows = reference?.[key];
    if (!Array.isArray(rows)) return undefined;
    const out: Record<string, string> = {};
    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 2) continue;
      if (row[0] === null || row[0] === undefined || typeof row[1] !== 'string') continue;
      out[String(row[0])] = row[1];
    }
    return Object.keys(out).length ? out : undefined;
  };

  return {
    bloodGroup: asMap('lov::bloodgroup'),
    maritalStatus: asMap('lov::maritalstatus'),
    nationality: asMap('lov::nationality'),
    religion: asMap('lov::religion'),
    bank: asMap('lov::bank'),
  };
}

/* ------------------------------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------------------------------- */

/**
 * The department and designation membership to write for one employee.
 *
 * Names, not ids — `accessScopeGrants` for a Designation is keyed by the designation name, and
 * greytHR is the authority on what somebody's designation is called. Departments are matched to the
 * app's own `departments` collection by the caller when an id is needed; here the greytHR name is
 * recorded so a rule can match it either way.
 *
 * Returns null when there is nothing to record, so the caller can skip the write entirely.
 */
function membershipUpdateFor(record: SyncedEmployee): Record<string, unknown> | null {
  const designations = [record.designation].filter(Boolean);
  const greytHR = stripUndefined({
    employeeId: record.employeeId,
    employeeNo: record.employeeNo || undefined,
    department: record.department || undefined,
    designation: record.designation || undefined,
    location: record.location || undefined,
    projectName: record.projectName || undefined,
    projectDivision: record.projectDivision || undefined,
    employmentState: record.employmentState,
    employmentType: record.employmentType || undefined,
  });

  if (!designations.length && !record.department) {
    // Still worth recording the greytHR facts on the grant so the access screens can show them.
    return { greytHR };
  }

  return {
    // Union, never assignment: an administrator may have added a designation by hand and the sync
    // has no business dropping it. `accessGrants.designations` is read by the resolver as a set.
    designations: FieldValue.arrayUnion(...designations),
    greytHR,
  };
}

/**
 * Users who can administer access, for the last-administrator guard.
 *
 * Uses the same resolver the access screens use, so the sync's idea of "can administer" cannot drift
 * from theirs.
 */
async function loadAdministrators(
  db: Firestore,
  users: Array<{ id: string; status: 'Active' | 'Inactive'; role: string }>,
): Promise<Array<{ userId: string; status: string }>> {
  const [roleSnapshot, grantSnapshot, scopeSnapshot] = await Promise.all([
    db.collection(GREYTHR_COLLECTIONS.roles).get(),
    db.collection(GREYTHR_COLLECTIONS.grants).get(),
    db
      .collection(GREYTHR_COLLECTIONS.scopeGrants)
      .get()
      .catch(() => null),
  ]);

  const roles = roleSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as RoleLike);
  const grants = new Map(grantSnapshot.docs.map((doc) => [doc.id, doc.data() as Record<string, unknown>]));
  const scopeGrants =
    scopeSnapshot?.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as ScopeGrantConfig) ?? [];

  const administrators: Array<{ userId: string; status: string }> = [];
  for (const user of users) {
    const access = resolveEffectiveAccess({
      user: { id: user.id, role: user.role, status: user.status },
      roles,
      grant: normalizeUserAccessGrant(user.id, grants.get(user.id) ?? null),
      scopeGrants,
    });
    const canManageUsers = (access.permissions['Settings.User Management'] ?? []).includes('Edit');
    const canManageRoles = (access.permissions['Settings.Role Management'] ?? []).includes('Edit');
    const canAdminister = (access.permissions['Settings.Access Management'] ?? []).some((action) =>
      ['Assign', 'Administer'].includes(action),
    );
    if ((canManageUsers && canManageRoles) || canAdminister) {
      administrators.push({ userId: user.id, status: user.status });
    }
  }
  return administrators;
}

/**
 * Firestore caps a batch at 500 writes; a full sync of 1,300 employees needs several.
 *
 * Every payload is stripped of `undefined` here rather than at each call site. That is the whole
 * reason this failed once: nine kinds of write are assembled in `runGreytHRSync` and only two of them
 * were being stripped, so the safety depended on remembering. One `undefined` anywhere in a chunk
 * rejects the entire batch, so the guarantee belongs at the point of commit, where nothing can skip
 * it.
 */
async function commitBatched(
  db: Firestore,
  writes: Array<{ ref: ReturnType<Firestore['doc']>; data: Record<string, unknown>; merge?: boolean }>,
): Promise<void> {
  const CHUNK = 400;
  for (let index = 0; index < writes.length; index += CHUNK) {
    const batch = db.batch();
    for (const write of writes.slice(index, index + CHUNK)) {
      batch.set(write.ref, stripUndefined(write.data), { merge: write.merge !== false });
    }
    await batch.commit();
  }
}

/* ------------------------------------------------------------------------------------------------
 * Reads for the settings screen
 * ---------------------------------------------------------------------------------------------- */

export interface MirrorCounts {
  /** Real employee records — salary rows excluded. */
  employees: number;
  /** How many of those greytHR reports as still working. */
  working: number;
  /** Monthly salary documents the legacy salary sync writes into the same collection. */
  salaryRows: number;
  byState: Record<string, number>;
}

/**
 * What the employee mirror actually contains, by employment state.
 *
 * This exists because every other number on the sync console describes the most recent **run**, and a
 * run tells you nothing about the mirror behind it. An incremental run that correctly fetched three
 * changed employees reports "3 fetched, 1 updated" and looks perfectly healthy whether the collection
 * holds 1,300 records or 182.
 *
 * And the failure it exposes is specifically hard to see: what an incremental run returns is whatever
 * changed, which in an HR system is leavers and people on notice. So a mirror built only by
 * incremental runs is not visibly sparse — it is visibly *wrong*, full of people who have left, with
 * the active majority missing. "182 records, 0 working" says that in one line; nothing else did.
 *
 * Reads the documents rather than using an aggregation query because the states have to be counted,
 * and `count()` cannot group. At a few hundred to a few thousand small documents on a screen an
 * administrator opens deliberately, that is the right trade.
 */
export async function countMirrorEmployees(
  db: Firestore = getFirebaseAdminFirestore(),
): Promise<MirrorCounts> {
  const snapshot = await db.collection(GREYTHR_COLLECTIONS.employees).get();

  const counts: MirrorCounts = { employees: 0, working: 0, salaryRows: 0, byState: {} };
  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (!isEmployeeMasterRecord(data)) {
      counts.salaryRows += 1;
      continue;
    }
    counts.employees += 1;
    // Records written before this integration have no `employmentState` at all; they are counted as
    // Unknown rather than silently folded into Active.
    const state = String(data.employmentState ?? 'Unknown');
    counts.byState[state] = (counts.byState[state] ?? 0) + 1;
    if (isWorkingState(state as EmploymentState)) counts.working += 1;
  }
  return counts;
}

export async function listSyncRuns(
  max = 20,
  db: Firestore = getFirebaseAdminFirestore(),
): Promise<GreytHRSyncRun[]> {
  try {
    const snapshot = await db
      .collection(GREYTHR_COLLECTIONS.runs)
      .orderBy('startedAt', 'desc')
      .limit(max)
      .get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as GreytHRSyncRun);
  } catch {
    const snapshot = await db.collection(GREYTHR_COLLECTIONS.runs).get();
    return snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }) as GreytHRSyncRun)
      .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''))
      .slice(0, max);
  }
}

export async function getSyncRun(
  runId: string,
  db: Firestore = getFirebaseAdminFirestore(),
): Promise<GreytHRSyncRun | null> {
  const snapshot = await db.collection(GREYTHR_COLLECTIONS.runs).doc(runId).get();
  return snapshot.exists ? ({ id: snapshot.id, ...snapshot.data() } as GreytHRSyncRun) : null;
}

export { DEFAULT_SYNC_SETTINGS };

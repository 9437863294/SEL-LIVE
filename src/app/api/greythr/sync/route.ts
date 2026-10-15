import { NextResponse } from 'next/server';
import {
  authenticateAccess,
  accessErrorResponse,
  requireAccess,
} from '@/lib/access-control-server';
import {
  dueSyncUnits,
  isSyncDue,
  normalizeSyncSettings,
  shouldForceFullResync,
  syncUnitEnabled,
  syncUnitLastSuccessAt,
  syncUnitSpec,
  SYNC_UNIT_KEYS,
  type GreytHRSyncSettings,
  type ReviewAction,
  type SyncUnitKey,
} from '@/lib/greythr';
import { isGreytHRConfigured, testGreytHRConnection } from '@/lib/greythr-client';
import { readSnapshotMeta } from '@/lib/greythr-roster-store';
import {
  applyReviewDecision,
  countMirrorEmployees,
  listSyncReviews,
  listSyncRuns,
  readSyncSettings,
  runGreytHRSync,
  writeSyncSettings,
} from '@/lib/greythr-sync-service';

/**
 * The greytHR sync endpoint. Three jobs, three methods.
 *
 *   `GET`   — the scheduled tick. Guarded by `CRON_SECRET`, decides for itself whether a run is due.
 *   `POST`  — a signed-in administrator running it now, previewing it, or saving the schedule.
 *   `GET ?report=1` — the settings screen reading current state (authenticated, no side effects).
 *
 * ── Why the cron asks whether it is due ─────────────────────────────────────────────────────────
 *
 * `vercel.json` crons are static, so the frequency an administrator picks in the UI cannot become a
 * cron expression. This route is registered hourly and consults `isSyncDue` against the stored
 * schedule on every tick. A tick that is not due returns `skipped` in a few milliseconds and costs
 * one Firestore read — which is the price of having the schedule be data rather than a redeploy.
 *
 * The same reasoning applies on Firebase App Hosting, where there is no built-in cron at all. What
 * calls this route on this deployment is `.github/workflows/greythr-sync.yml`, hourly at :05;
 * `scripts/setup-cloud-scheduler.sh` sets up the GCP-native equivalent for whoever has gcloud.
 * `vercel.json` also declares the cron and is inert here — it reads as configuration but calls
 * nothing, which is why this endpoint went 19 runs without a single scheduled one.
 */

export const runtime = 'nodejs';
/** A full resync pages through four endpoints for ~1,300 employees. */
export const maxDuration = 300;

/** Distinguishes a scheduler calling us from a browser doing so. */
function isAuthorizedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Matches the convention the other cron routes in this app use: with no secret configured the
    // endpoint is open, which is acceptable for a read-mostly job and keeps local runs working.
    return true;
  }
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);

  /* ── The settings screen reading state ── */

  if (url.searchParams.get('report') === '1') {
    try {
      const context = await authenticateAccess(request);
      requireAccess(context, 'Settings.Employee Management', 'View');
      const [settings, runs, mirror, rosterMeta, reviews] = await Promise.all([
        readSyncSettings(),
        listSyncRuns(20),
        /**
         * How many employee records the mirror actually holds.
         *
         * The one number that settles "is the mirror incomplete?", and it was missing. Everything the
         * console showed — last run, last successful run, employees fetched — describes the most
         * recent *run*, and an incremental run that correctly fetched 3 changed records looks healthy
         * whether the mirror behind it has 182 records or 1,300.
         *
         * Counted with an aggregation query rather than by reading the documents: this is on the
         * report path, which loads whenever the console opens.
         */
        countMirrorEmployees(),
        /**
         * How many people greytHR says currently work here, and when it said so.
         *
         * Not the same question as anything above it, and the difference is the point. Every figure
         * the console and the Employee hub showed came from the mirror, so a mirror holding nothing
         * but ex-employees reported "182 records, 3 still working" and looked merely unremarkable.
         * The correct answer was already on disk in the roster snapshot — nothing read it.
         *
         * One document read: `settings/greythrCurrentRoster` carries the count and the timestamp, so
         * this costs the report path a single get rather than a collection scan.
         */
        readSnapshotMeta(),
        listSyncReviews(200),
      ]);
      const due = isSyncDue(settings.schedule, settings.lastSuccessfulRunAt);
      const mirrorRefresh = shouldForceFullResync(settings);
      return NextResponse.json({
        ok: true,
        configured: isGreytHRConfigured(),
        settings,
        runs,
        nextRun: due,
        /** Decisions already taken, so a flagged row can show as dealt with rather than nag. */
        reviews,
        /**
         * The same question per module, which is what the schedule screen shows against each card.
         *
         * `nextRun` above is kept: it still answers it for the employees module, whose schedule is
         * the one the deprecated `settings.schedule` alias carries.
         */
        unitStatus: dueSyncUnits(settings).map((verdict) => ({
          ...verdict,
          lastSuccessfulRunAt: syncUnitLastSuccessAt(settings, verdict.key),
          lastRunAt: settings.unitRuns?.[verdict.key]?.lastRunAt ?? null,
          enabled: syncUnitEnabled(settings, verdict.key),
        })),
        mirrorRefresh,
        mirror,
        currentRoster: { count: rosterMeta.count, fetchedAt: rosterMeta.fetchedAt },
      });
    } catch (error) {
      const { message, status } = accessErrorResponse(error);
      return NextResponse.json({ error: message }, { status });
    }
  }

  /* ── The scheduled tick ── */

  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isGreytHRConfigured()) {
    return NextResponse.json(
      { ok: false, skipped: true, reason: 'greytHR credentials are not configured.' },
      { status: 200 },
    );
  }

  /**
   * Everything below can throw before `runGreytHRSync` gets a chance to record a run — most often
   * because the Admin SDK has no service-account key, which is the normal state in local
   * development. A scheduler retrying against a bare 500 with an empty body learns nothing, so the
   * reason is returned as JSON.
   */
  try {
    const settings = await readSyncSettings();

    /**
     * Asked per module, because each one now carries its own schedule.
     *
     * The verdicts for the modules that are *not* due are returned as well. A scheduler that
     * explains why it did nothing is far easier to trust than one that simply reports "skipped",
     * and this is the only place that answer is visible.
     */
    const verdicts = dueSyncUnits(settings);
    const dueUnits = verdicts.filter((verdict) => verdict.due).map((verdict) => verdict.key);
    const byUnit = Object.fromEntries(
      verdicts.map((verdict) => [verdict.key, verdict.reason]),
    );

    if (!dueUnits.length) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: 'No unit is due.',
        units: byUnit,
      });
    }

    const run = await runGreytHRSync({ trigger: 'cron', units: dueUnits });
    return NextResponse.json({
      ok: run.ok,
      runId: run.id,
      reason: dueUnits.map((key) => `${syncUnitSpec(key).label}: ${byUnit[key]}`).join(' '),
      unitsRun: run.unitsRun ?? [],
      units: byUnit,
      employeesFetched: run.employeesFetched,
      employeesCreated: run.employeesCreated,
      employeesUpdated: run.employeesUpdated,
      usersDeactivated: run.usersDeactivated,
      usersReactivated: run.usersReactivated,
      flaggedForReview: run.flaggedForReview,
      warnings: run.warnings,
      error: run.error ?? null,
      tookMs: run.tookMs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[greythr] Scheduled sync could not start', error);
    return NextResponse.json({ ok: false, error: `Scheduled sync could not start: ${message}` }, { status: 500 });
  }
}

interface PostBody {
  action?: 'run' | 'preview' | 'save-settings' | 'test-connection' | 'review';
  fullResync?: boolean;
  /** Which units to run. Omitted means all of them — the whole-run button. */
  units?: SyncUnitKey[];
  settings?: Partial<GreytHRSyncSettings>;
  /** For `action: 'review'` — the flagged employee and what to do about them. */
  employeeId?: string;
  reviewAction?: ReviewAction;
  reason?: string;
  runId?: string;
}

const REVIEW_ACTIONS: ReviewAction[] = ['enable', 'disable', 'dismiss'];

export async function POST(request: Request) {
  try {
    const context = await authenticateAccess(request);
    const body = (await request.json().catch(() => ({}))) as PostBody;
    const action = body.action ?? 'run';

    if (action === 'test-connection') {
      requireAccess(context, 'Settings.Employee Management', 'View');
      return NextResponse.json(await testGreytHRConnection());
    }

    if (action === 'review') {
      /**
       * Gated on Edit rather than on an access-management permission.
       *
       * This is the same power the exit policy exercises — "a greytHR separation closes a login"
       * — and that policy is set under Edit on this very screen. Requiring something stronger
       * here would mean the person who configured the rule could not apply it to the one row the
       * rule deliberately refused to decide.
       */
      requireAccess(context, 'Settings.Employee Management', 'Edit');

      const employeeId = String(body.employeeId ?? '').trim();
      if (!employeeId) {
        return NextResponse.json({ ok: false, error: 'No employee was named.' }, { status: 400 });
      }
      if (!body.reviewAction || !REVIEW_ACTIONS.includes(body.reviewAction)) {
        return NextResponse.json(
          { ok: false, error: `Unknown review action. Expected one of: ${REVIEW_ACTIONS.join(', ')}.` },
          { status: 400 },
        );
      }

      const result = await applyReviewDecision({
        employeeId,
        action: body.reviewAction,
        reason: body.reason ?? null,
        runId: body.runId ?? null,
        actor: { userId: context.userId, userName: context.userName },
      });
      // 200 even for a refusal: the guards are an answer, not a transport failure, and the
      // screen shows the message either way.
      return NextResponse.json(result);
    }

    if (action === 'save-settings') {
      // Changing the schedule or the exit policy decides whether people keep their logins, so it
      // needs the same permission as editing employees rather than merely viewing them.
      requireAccess(context, 'Settings.Employee Management', 'Edit');
      const settings = await writeSyncSettings(
        normalizeSyncSettings({ ...(body.settings ?? {}) }),
        { userId: context.userId, userName: context.userName },
      );
      return NextResponse.json({ ok: true, settings });
    }

    // Running the sync is what the existing screen's button does, and it is gated on the permission
    // that button has always required.
    requireAccess(context, 'Settings.Employee Management', 'Sync from GreytHR');

    if (!isGreytHRConfigured()) {
      return NextResponse.json(
        { ok: false, error: 'greytHR credentials are not configured on the server.' },
        { status: 400 },
      );
    }

    const run = await runGreytHRSync({
      trigger: 'manual',
      triggeredBy: context.userId,
      triggeredByName: context.userName,
      fullResync: body.fullResync === true,
      // Filtered against the known keys rather than passed through: this arrives from a request
      // body, and an unrecognised key would otherwise silently narrow the run to nothing.
      units: Array.isArray(body.units)
        ? body.units.filter((key): key is SyncUnitKey => SYNC_UNIT_KEYS.includes(key))
        : undefined,
      // A preview computes everything and writes nothing, so an administrator can see the first
      // run's findings before letting it touch a single account.
      dryRun: action === 'preview',
    });

    return NextResponse.json({ ok: run.ok, run });
  } catch (error) {
    const { message, status } = accessErrorResponse(error);
    return NextResponse.json({ error: message }, { status });
  }
}

import { NextResponse } from 'next/server';
import {
  authenticateAccess,
  accessErrorResponse,
  requireAccess,
} from '@/lib/access-control-server';
import { isSyncDue, normalizeSyncSettings, type GreytHRSyncSettings } from '@/lib/greythr';
import { isGreytHRConfigured, testGreytHRConnection } from '@/lib/greythr-client';
import {
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
 * The same reasoning applies on Firebase App Hosting, where there is no built-in cron at all: point
 * a Cloud Scheduler job at this URL hourly and the behaviour is identical.
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
      const [settings, runs] = await Promise.all([readSyncSettings(), listSyncRuns(20)]);
      const due = isSyncDue(settings.schedule, settings.lastSuccessfulRunAt);
      return NextResponse.json({
        ok: true,
        configured: isGreytHRConfigured(),
        settings,
        runs,
        nextRun: due,
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
    const due = isSyncDue(settings.schedule, settings.lastSuccessfulRunAt);

    if (!due.due) {
      return NextResponse.json({ ok: true, skipped: true, reason: due.reason });
    }

    const run = await runGreytHRSync({ trigger: 'cron' });
    return NextResponse.json({
      ok: run.ok,
      runId: run.id,
      reason: due.reason,
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
  action?: 'run' | 'preview' | 'save-settings' | 'test-connection';
  fullResync?: boolean;
  settings?: Partial<GreytHRSyncSettings>;
}

export async function POST(request: Request) {
  try {
    const context = await authenticateAccess(request);
    const body = (await request.json().catch(() => ({}))) as PostBody;
    const action = body.action ?? 'run';

    if (action === 'test-connection') {
      requireAccess(context, 'Settings.Employee Management', 'View');
      return NextResponse.json(await testGreytHRConnection());
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

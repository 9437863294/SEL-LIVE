import { NextResponse } from 'next/server';
import { runOfficeHubSweep } from '@/lib/office-hub-server';

/**
 * Office Hub's scheduled job (§62).
 *
 * `GET /api/office-hub/cron` runs every sweep: due reminders, meeting status transitions, overdue
 * task notices, decision and action-item chasers, the recurring-series top-up, and the retry of
 * any Google Meet link that failed to be created. See `office-hub-server.ts` for what each does and
 * the property that makes it safe to run twice.
 *
 * ── Scheduling it ──────────────────────────────────────────────────────────────────────────────
 *
 * The provider is deliberately not baked in (§62 says it should be configurable). Any of these
 * work, and all of them hit the same endpoint:
 *
 *   • **Vercel Cron** — add to `vercel.json`:
 *       { "crons": [{ "path": "/api/office-hub/cron", "schedule": "0,30 * * * *" }] }
 *   • **Google Cloud Scheduler** (Firebase App Hosting) — an HTTP target with an
 *       `Authorization: Bearer $CRON_SECRET` header.
 *   • **Any external scheduler**, or a manual curl while testing.
 *
 * **Every 30 minutes is the right cadence.** Reminder offsets go down to ten minutes, so a sweep
 * that ran hourly would deliver a "10 minutes before" reminder up to an hour late — and
 * `dueReminders`' three-hour grace window would rather drop it than send it after the meeting
 * started. Every 30 minutes keeps the worst-case lateness under the grace window while remaining a
 * trivial number of reads.
 *
 * ── Why GET, and how it is protected ───────────────────────────────────────────────────────────
 *
 * GET because that is what every cron provider sends, and this matches the convention the app's
 * other scheduled routes already use (`/api/e-approval/escalations`, `/api/hr/sla`). It is
 * therefore *not* safe in the HTTP sense — it writes — so it is guarded by `CRON_SECRET`.
 *
 * **If `CRON_SECRET` is unset the route refuses to run.** The other routes in this application
 * treat an unset secret as "no guard", which is the more permissive default; this one does not,
 * because an unauthenticated endpoint that can send notifications to every user in the
 * organisation is an endpoint worth being strict about. The error says exactly what to set.
 */

/** Never cached: it writes, and a cached response would report a sweep that did not happen. */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * The sweep touches several hundred documents and awaits notification writes, so it needs more
 * than the default serverless budget. Node runtime because the Admin SDK requires it.
 */
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return NextResponse.json(
      {
        error: 'CRON_SECRET is not configured',
        detail:
          'Office Hub refuses to run its scheduled job without a shared secret, because the ' +
          'endpoint can notify every user in the organisation. Set CRON_SECRET in the ' +
          'environment and send it as "Authorization: Bearer <secret>".',
      },
      { status: 503 },
    );
  }

  const authorized =
    request.headers.get('authorization') === `Bearer ${secret}` ||
    // Vercel Cron sends the secret in this header rather than Authorization.
    request.headers.get('x-vercel-cron-signature') === secret;

  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  /**
   * `?only=reminders,series` runs a subset.
   *
   * The step names are `reminders`, `statuses`, `overdue-tasks`, `due-items`, `series` and
   * `google-meet`. Useful when investigating one sweep in isolation, and for an installation that
   * wants the reminder pass every 30 minutes but the series top-up only nightly — two schedules
   * against one endpoint rather than two endpoints.
   */
  const url = new URL(request.url);
  const only = (url.searchParams.get('only') ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  try {
    const result = await runOfficeHubSweep({ only: only.length ? only : undefined });

    return NextResponse.json({
      ok: result.errors.length === 0,
      ranAt: new Date().toISOString(),
      only: only.length ? only : 'all',
      ...result,
    });
  } catch (error) {
    // A total failure, as opposed to one step failing — those are collected into `errors` and
    // still return 200, because the sweep did run and the rest of it worked.
    console.error('[office-hub] Sweep failed outright', error);
    return NextResponse.json(
      {
        ok: false,
        error: 'The Office Hub sweep could not run',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

/**
 * POST does exactly the same thing.
 *
 * Some schedulers only send POST, and offering both is cheaper than documenting which providers
 * need which.
 */
export async function POST(request: Request) {
  return GET(request);
}

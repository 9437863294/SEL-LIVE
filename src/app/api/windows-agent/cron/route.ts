import { NextResponse } from 'next/server';

import { purgeExpiredActivity, reapAbandonedSessions, seedAppCatalog } from '@/lib/windows-agent-server';
import { expireStaleNotifications } from '@/lib/windows-agent-notifications';

/**
 * The Windows Agent's scheduled job (§28, §51).
 *
 * Three sweeps, all idempotent:
 *
 *   • **`sessions`** — close sessions whose agent stopped reporting, as `UNCLEAN_END` with an
 *     estimated end time (§28). This is the one that must run often: an unreaped session shows a
 *     PC as online on the live board long after its user went home, and sits in the way of the
 *     next sign-in resuming correctly.
 *   • **`notifications`** — expire receipts for notifications whose window has closed, so a
 *     meeting reminder does not pop up two days late (§25) and the §39 delivery report accounts
 *     for every intended recipient.
 *   • **`retention`** — delete raw spans past the retention window (§51). Nightly is enough; it is
 *     capped per run and converges over successive runs.
 *
 * ── Cadence ────────────────────────────────────────────────────────────────────────────────────
 *
 * Every 15 minutes for `sessions,notifications`, and once a night for `retention`:
 *
 *     { "crons": [
 *         { "path": "/api/windows-agent/cron?only=sessions,notifications", "schedule": "*​/15 * * * *" },
 *         { "path": "/api/windows-agent/cron?only=retention,catalog",      "schedule": "30 19 * * *" }
 *     ]}
 *
 * Fifteen minutes is chosen against the reaper's own threshold, not arbitrarily: it only closes a
 * session after ten missed heartbeats — over twelve minutes at the default interval — so a sweep
 * any more frequent would find nothing new, and a much less frequent one would leave the live
 * board wrong for the gap.
 *
 * ── Why it refuses to run without a secret ─────────────────────────────────────────────────────
 *
 * `CRON_SECRET` is required, not optional, matching `/api/office-hub/cron`. This endpoint *deletes
 * activity records* and closes people's attendance sessions. An unauthenticated caller who could
 * hit it repeatedly could close every open session in the company, which would land in the
 * attendance report as a fleet-wide early departure.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 300;

type StepName = 'sessions' | 'notifications' | 'retention' | 'catalog';

const ALL_STEPS: StepName[] = ['sessions', 'notifications', 'retention', 'catalog'];

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      {
        error: 'CRON_SECRET is not configured',
        detail:
          'The Windows Agent sweep refuses to run without a shared secret, because it closes ' +
          'attendance sessions and deletes activity records. Set CRON_SECRET in the environment ' +
          'and send it as "Authorization: Bearer <secret>".',
      },
      { status: 503 },
    );
  }

  const authorized =
    request.headers.get('authorization') === `Bearer ${secret}` ||
    request.headers.get('x-vercel-cron-signature') === secret;
  if (!authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const requested = (url.searchParams.get('only') ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry): entry is StepName => (ALL_STEPS as string[]).includes(entry));
  const steps = requested.length ? requested : ALL_STEPS;

  const results: Record<string, unknown> = {};
  const errors: { step: string; message: string }[] = [];

  // Each step is caught separately: a failing retention purge must not stop sessions being
  // reaped, because that is the one with a user-visible consequence.
  for (const step of steps) {
    try {
      if (step === 'sessions') results.sessionsClosed = await reapAbandonedSessions({});
      if (step === 'notifications') results.receiptsExpired = await expireStaleNotifications({});
      if (step === 'retention') results.retention = await purgeExpiredActivity({});
      if (step === 'catalog') results.catalogSeeded = await seedAppCatalog();
    } catch (error) {
      errors.push({ step, message: error instanceof Error ? error.message : String(error) });
    }
  }

  return NextResponse.json({
    ok: errors.length === 0,
    ranAt: new Date().toISOString(),
    steps,
    ...results,
    errors,
  });
}

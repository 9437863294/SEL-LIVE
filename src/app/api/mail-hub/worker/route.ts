import { cronAuthorized } from '@/lib/mail-hub/config';
import { runWorkerTick } from '@/lib/mail-hub/worker';

/**
 * Mail Hub's background worker (`GET|POST /api/mail-hub/worker`), run every minute by a scheduler
 * with `Authorization: Bearer $CRON_SECRET`. Refuses to run without the secret — this endpoint
 * syncs every mailbox and sends scheduled mail.
 *
 * See `src/lib/mail-hub/worker.ts` for what a tick does, and docs/mail-hub.md for scheduling it on
 * Cloud Scheduler (App Hosting) or Vercel Cron.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: Request) {
  const auth = cronAuthorized(request);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  try {
    const result = await runWorkerTick({ budgetMs: 240_000 });
    return Response.json({ ok: result.worker.errors.length === 0, ranAt: new Date().toISOString(), ...result });
  } catch (error) {
    console.error('[mail-hub] worker tick failed', error);
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export const POST = GET;

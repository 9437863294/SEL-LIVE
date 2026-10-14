import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { advanceReportingCopy } from '@/lib/reporting-copy-server';

export const runtime = 'nodejs';
/** A slice works for TICK_BUDGET_MS, then saves and returns; this leaves room for the last page. */
export const maxDuration = 300;
/** Never cached: every call is a scheduler tick that may do work. */
export const dynamic = 'force-dynamic';

/** About four minutes of copying per tick; a full copy takes several ticks and resumes across them. */
const TICK_BUDGET_MS = 240_000;

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * The scheduler tick for the reporting copy, called every 15 minutes by
 * `.github/workflows/reporting-copy.yml` (App Hosting has no scheduler of its own). It continues a
 * run in progress, starts one when the schedule in Settings › Reporting Database or a "Refresh now"
 * says so, and otherwise returns after two reads.
 *
 * Fails closed, unlike the app's older cron routes: with CRON_SECRET unset it refuses to run (503)
 * rather than letting anyone start a full copy of the database — including from a developer's
 * machine, where `.env` points at production and no secret is set.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: 'CRON_SECRET is not configured.' }, { status: 503 });
  if (!timingSafeEqual(digest(request.headers.get('authorization') || ''), digest(`Bearer ${secret}`))) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json({ ...(await advanceReportingCopy({ budgetMs: TICK_BUDGET_MS })), checkedAt: new Date().toISOString() });
  } catch (error) {
    console.error('[reporting-copy] tick failed', error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

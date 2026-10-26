import { NextResponse } from 'next/server';

import { cronAuthorised } from '@/lib/fleet/server/context';
import { FLEET_JOBS } from '@/lib/fleet/server/jobs';

/**
 * The fleet's scheduled jobs (Cloud Scheduler, IST; scripts/setup-cloud-scheduler.sh), one route per
 * job name: approvals, idle, midnight, daily-summary, digest, service-due, monthly-report.
 * Fail closed on `CRON_SECRET` — without it these would close trips and send mail for anyone.
 */
export async function GET(request: Request, segment: { params: Promise<{ job: string }> }) {
  const denied = cronAuthorised(request);
  if (denied) return denied;
  const { job } = await segment.params;
  if (!Object.hasOwn(FLEET_JOBS, job)) return NextResponse.json({ error: 'Unknown job.' }, { status: 404 });
  const now = new Date().toISOString();
  try {
    const result = await FLEET_JOBS[job as keyof typeof FLEET_JOBS](now);
    return NextResponse.json({ job, now, ...result });
  } catch (error) {
    console.error(`[fleet cron ${job}]`, error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error');
    return NextResponse.json({ error: 'The job failed.', job }, { status: 500 });
  }
}

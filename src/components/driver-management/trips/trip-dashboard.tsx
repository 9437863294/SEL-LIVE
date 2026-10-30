'use client';

/**
 * Driver Management's landing page: figures, not links (the sidebar navigates).
 *
 * - Everyone: a hero with this month's reimbursement and the two things people come here to do
 *   (start a trip — or return to the one running — and claim what is unclaimed); where their money
 *   is, stage by stage; their monthly reimbursement, own-vs-company kilometres and latest claims.
 * - Drivers linked to a Vehicle Management driver record: their vehicle and driving figures
 *   (`DriverPanel`, which replaced the separate Driver Mobile hub page).
 * - People named on the workflow (or holding Override): what waits for them, oldest first.
 * - Trip Claims · View All: the organisation's pipeline, trend, projects and top claimants.
 *
 * `TripDashboardView` draws it from the dashboard payload alone, so it renders without the API.
 */

import { useRouter } from 'next/navigation';
import { ArrowRight, CalendarClock, Clock, Gauge, Inbox, Undo2, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { KpiCard, KpiGrid } from '@/components/shared/kpi-card';
import { SectionHeader } from '@/components/shared/page-header';
import { useCurrentDriverProfile } from '@/components/vehicle-management/hooks';
import { useFleet } from '@/components/fleet/fleet-provider';
import { DriverPanel } from '@/components/driver-management/driver-app/driver-panel';
import { formatINRCompact } from '@/lib/employee-trips/rates';
import { cn } from '@/lib/utils';
import type { ClaimRow, DashboardData } from './trip-api';
import { useTripQuery } from './use-trip-query';
import { ChartCard, MonthlyAmountChart, OwnershipSplit, RankedAmounts } from './trip-charts';
import { ClaimJourney, OverviewHero, PipelineBar } from './overview-parts';
import { ClaimStatusBadge, ErrorBlock, Money, shortDate } from './trip-ui';

const STATUS_DOT: Record<ClaimRow['status'], string> = {
  pending: 'bg-amber-400',
  approved: 'bg-violet-500',
  paid: 'bg-emerald-500',
  returned: 'bg-amber-400',
  rejected: 'bg-rose-500',
  withdrawn: 'bg-slate-300',
};

function ClaimRows({ rows, showEmployee, empty }: { rows: ClaimRow[]; showEmployee?: boolean; empty: string }) {
  const router = useRouter();
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="-mx-2 divide-y divide-slate-100">
      {rows.map((row) => (
        <li key={row.id}>
          <button type="button" onClick={() => router.push(`/driver-management/claims/${row.id}`)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-slate-50">
            <span className={cn('h-2 w-2 shrink-0 rounded-full', STATUS_DOT[row.status])} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-slate-800">
                {showEmployee ? row.employeeName : row.claimNumber}
                {showEmployee ? <span className="font-normal text-muted-foreground"> · {row.claimNumber}</span> : null}
              </span>
              <span className={cn('block truncate text-xs', row.overdue ? 'text-rose-700' : 'text-muted-foreground')}>
                {row.status === 'paid'
                  ? `Paid ${shortDate(row.paidOn)}`
                  : row.waitingFor.length
                    ? `${row.stageName} · ${row.waitingFor.join(', ')}${row.overdue ? ' · overdue' : ''}`
                    : `${row.totals.tripCount} trips · submitted ${shortDate(row.submittedAt)}`}
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1">
              <Money value={row.status === 'pending' ? row.totals.claimedAmount : row.totals.approvedAmount} className="text-sm font-semibold text-slate-800" />
              <ClaimStatusBadge status={row.status} />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Notice({ icon: Icon, children, action, onAction }: { icon: React.ElementType; children: React.ReactNode; action: string; onAction: () => void }) {
  return (
    <div className="flex flex-1 items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1">{children}</p>
      <Button type="button" variant="ghost" size="sm" onClick={onAction} className="h-8 shrink-0 px-2 text-amber-900 hover:bg-amber-100">
        {action}
        <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden />
      </Button>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true">
      <Skeleton className="h-52 w-full rounded-2xl sm:h-48" />
      <Skeleton className="h-36 w-full rounded-2xl lg:h-28" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Skeleton className="h-72 w-full rounded-xl lg:col-span-2" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    </div>
  );
}

export function TripDashboardView({
  data,
  error,
  onRetry,
  openTrip,
  driverPanel,
}: {
  data: DashboardData | null;
  error: string | null;
  onRetry?: () => void;
  openTrip: { vehicleNumber: string } | null;
  driverPanel?: React.ReactNode;
}) {
  const router = useRouter();
  if (error && !data) return <ErrorBlock message={error} onRetry={onRetry} />;
  if (!data) return <DashboardSkeleton />;

  const { personal, workflow, organisation } = data;
  const toMyTrips = () => router.push('/driver-management/my-trips');

  return (
    <div className="space-y-5">
      <OverviewHero
        today={data.today}
        financialYear={data.financialYear}
        personal={personal}
        openTrip={openTrip}
        onStart={() => router.push('/driver-management/fleet?kind=choose')}
        onClaim={() => router.push('/driver-management/my-trips?claim=1')}
      />

      {(personal.unclaimed.expiringSoon > 0 || personal.unclaimed.sentBack > 0) && (
        <div className="flex flex-col gap-2 sm:flex-row">
          {personal.unclaimed.sentBack > 0 && (
            <Notice icon={Undo2} action="Correct" onAction={toMyTrips}>
              {personal.unclaimed.sentBack} trip{personal.unclaimed.sentBack === 1 ? ' was' : 's were'} sent back for correction.
            </Notice>
          )}
          {personal.unclaimed.expiringSoon > 0 && (
            <Notice icon={CalendarClock} action="Claim" onAction={() => router.push('/driver-management/my-trips?claim=1')}>
              {personal.unclaimed.expiringSoon} unclaimed trip{personal.unclaimed.expiringSoon === 1 ? '' : 's'} must be submitted within a week.
            </Notice>
          )}
        </div>
      )}

      <ClaimJourney personal={personal} financialYear={data.financialYear} />

      {workflow && (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700" aria-hidden>
                <Inbox className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-slate-800">Waiting for you</h2>
                <p className="text-xs text-muted-foreground">Claims at a stage you are named on, oldest first.</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:flex sm:gap-6">
              <div>
                <p className="text-[11px] font-medium text-muted-foreground">To approve</p>
                <p className="text-lg font-semibold tabular-nums text-slate-900">{workflow.approvals}</p>
                <p className="truncate text-[11px] text-muted-foreground">{formatINRCompact(workflow.approvalsAmount)}</p>
              </div>
              <div>
                <p className="text-[11px] font-medium text-muted-foreground">To pay</p>
                <p className="text-lg font-semibold tabular-nums text-slate-900">{workflow.payments}</p>
                <p className="truncate text-[11px] text-muted-foreground">{formatINRCompact(workflow.paymentsAmount)}</p>
              </div>
              <div>
                <p className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                  <Clock className="h-3 w-3" aria-hidden />
                  Overdue
                </p>
                <p className={cn('text-lg font-semibold tabular-nums', workflow.overdue ? 'text-rose-700' : 'text-slate-900')}>{workflow.overdue}</p>
                <p className="truncate text-[11px] text-muted-foreground">past the stage&apos;s time</p>
              </div>
            </div>
          </div>
          <div className="px-4 py-2">
            <ClaimRows rows={workflow.oldest} showEmployee empty="Nothing is waiting for you." />
          </div>
        </section>
      )}

      {driverPanel}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <ChartCard title="My reimbursement by month" description="Last six months, by trip date — approved figures where an approver changed them.">
            <MonthlyAmountChart points={personal.trend} label="My reimbursement by month" />
          </ChartCard>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <ChartCard title="Own vs company vehicle" description="Kilometres over the last six months.">
            <OwnershipSplit own={personal.ownership.own} company={personal.ownership.company} />
          </ChartCard>
          <ChartCard title="My latest claims">
            <ClaimRows rows={personal.recentClaims} empty="No claims yet — submit trips from My Trips." />
          </ChartCard>
        </div>
      </div>

      {organisation && (
        <section className="space-y-4 border-t border-slate-200 pt-5">
          <SectionHeader title={`Organisation · FY ${organisation.financialYear}`} icon={Gauge} description="Every employee's claims this financial year." />
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <PipelineBar
              parts={[
                { label: 'In approval', amount: organisation.inApproval.amount, claims: organisation.inApproval.claims, color: 'bg-amber-400' },
                { label: 'Awaiting payment', amount: organisation.awaitingPayment.amount, claims: organisation.awaitingPayment.claims, color: 'bg-violet-500' },
                { label: 'Paid', amount: organisation.paid.amount, claims: organisation.paid.claims, color: 'bg-emerald-500' },
                { label: 'Rejected', amount: organisation.rejected.amount, claims: organisation.rejected.claims, color: 'bg-rose-400' },
              ]}
            />
          </div>
          <KpiGrid>
            <KpiCard label="Overdue" value={organisation.overdue} hint="Past their stage's time" icon={Clock} tone={organisation.overdue ? 'rose' : 'slate'} accent />
            <KpiCard label="Not yet claimed" value={formatINRCompact(organisation.unclaimed.amount)} hint={`${organisation.unclaimed.trips} trips, last 6 months`} icon={Wallet} tone="cyan" accent />
          </KpiGrid>
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
            <div className="min-w-0 lg:col-span-2">
              <ChartCard title="Claimed trips by month" description="Last six months, by trip date, every employee.">
                <MonthlyAmountChart points={organisation.trend} label="Organisation reimbursement by month" />
              </ChartCard>
            </div>
            <ChartCard title="Own vs company vehicle" description="Kilometres claimed, last six months.">
              <OwnershipSplit own={organisation.ownership.own} company={organisation.ownership.company} />
            </ChartCard>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard title="By project" description="Claimed trips, last six months.">
              <RankedAmounts rows={organisation.byProject} empty="No claimed trips yet." />
            </ChartCard>
            <ChartCard title="Top claimants" description="Claimed trips, last six months.">
              <RankedAmounts rows={organisation.byEmployee} empty="No claimed trips yet." />
            </ChartCard>
          </div>
        </section>
      )}
    </div>
  );
}

export default function TripDashboard() {
  const { driver } = useCurrentDriverProfile();
  const fleet = useFleet();
  const { data, error, reload } = useTripQuery<DashboardData>('dashboard');
  const openTrip = fleet.data?.openTrip ?? null;
  return (
    <TripDashboardView
      data={data}
      error={error}
      onRetry={reload}
      openTrip={openTrip ? { vehicleNumber: openTrip.vehicleNumber } : null}
      driverPanel={driver?.id ? <DriverPanel driver={driver} /> : null}
    />
  );
}

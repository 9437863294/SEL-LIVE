'use client';

/**
 * Driver Management's landing page: figures, not links (the sidebar navigates).
 *
 * - Drivers linked to a Vehicle Management driver record: their vehicle and driving figures
 *   (`DriverPanel`, which replaced the separate Driver Mobile hub page).
 * - Everyone: their unclaimed trips, claims in approval and awaiting payment, what was paid this
 *   year, their monthly reimbursement and own-vs-company kilometres, and their latest claims.
 * - People named on the workflow (or holding Override): what waits for them, oldest first.
 * - Trip Claims · View All: the organisation's pipeline, trend, projects and top claimants.
 */

import { useRouter } from 'next/navigation';
import { Banknote, CalendarClock, CircleCheck, Clock, Gauge, Hourglass, Inbox, Plus, ReceiptText, Route, Undo2, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { KpiCard } from '@/components/shared/kpi-card';
import { PageHeader, SectionHeader } from '@/components/shared/page-header';
import { useCurrentDriverProfile } from '@/components/vehicle-management/hooks';
import { DriverPanel } from '@/components/driver-management/driver-app/driver-panel';
import { VM_PRIMARY_BUTTON } from '@/components/vehicle-management/vm-ui';
import { formatINR, formatINRCompact } from '@/lib/employee-trips/rates';
import { formatKm } from '@/lib/employee-trips/types';
import { cn } from '@/lib/utils';
import type { ClaimRow, DashboardData } from './trip-api';
import { useTripClaims } from './trip-claims-provider';
import { useTripQuery } from './use-trip-query';
import { ChartCard, MonthlyAmountChart, OwnershipSplit, RankedAmounts } from './trip-charts';
import { ClaimStatusBadge, ErrorBlock, LoadingBlock, Money, shortDate } from './trip-ui';

function ClaimRows({ rows, showEmployee, empty }: { rows: ClaimRow[]; showEmployee?: boolean; empty: string }) {
  const router = useRouter();
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="divide-y divide-slate-100">
      {rows.map((row) => (
        <li key={row.id}>
          <button type="button" onClick={() => router.push(`/driver-management/claims/${row.id}`)} className="flex w-full items-start justify-between gap-3 px-1 py-2.5 text-left transition-colors hover:bg-slate-50">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-800">
                {row.claimNumber}
                {showEmployee ? <span className="font-normal text-muted-foreground"> · {row.employeeName}</span> : null}
              </p>
              <p className={cn('truncate text-xs', row.overdue ? 'text-rose-700' : 'text-muted-foreground')}>
                {row.status === 'paid'
                  ? `Paid ${shortDate(row.paidOn)}`
                  : row.waitingFor.length
                    ? `${row.stageName} · ${row.waitingFor.join(', ')}${row.overdue ? ' · overdue' : ''}`
                    : `${row.totals.tripCount} trips · submitted ${shortDate(row.submittedAt)}`}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <Money value={row.status === 'pending' ? row.totals.claimedAmount : row.totals.approvedAmount} className="text-sm font-semibold text-slate-800" />
              <ClaimStatusBadge status={row.status} />
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function TripDashboard() {
  const router = useRouter();
  const { data: boot } = useTripClaims();
  const { driver } = useCurrentDriverProfile();
  const { data, error, reload } = useTripQuery<DashboardData>('dashboard');

  const assignedVehicle = driver?.assignedVehicleNumber ? String(driver.assignedVehicleNumber) : null;

  const header = (
    <PageHeader
      title="Driver Management"
      icon={Gauge}
      description="Your official trips and claims, and anything waiting for you."
      meta={[
        { label: 'Signed in as', value: boot?.user.name ?? '—' },
        ...(assignedVehicle ? [{ label: 'Assigned vehicle', value: assignedVehicle }] : []),
        ...(data ? [{ label: 'Financial year', value: data.financialYear }] : []),
      ]}
      actions={
        <>
          <Button type="button" variant={data?.personal.unclaimed.trips ? 'outline' : 'default'} className={data?.personal.unclaimed.trips ? undefined : VM_PRIMARY_BUTTON} onClick={() => router.push('/driver-management/my-trips?new=1')}>
            <Plus className="mr-2 h-4 w-4" aria-hidden />
            Record trip
          </Button>
          {Boolean(data?.personal.unclaimed.trips) && (
            <Button type="button" className={VM_PRIMARY_BUTTON} onClick={() => router.push('/driver-management/my-trips?claim=1')}>
              <ReceiptText className="mr-2 h-4 w-4" aria-hidden />
              Create claim ({data?.personal.unclaimed.trips} unclaimed)
            </Button>
          )}
        </>
      }
    />
  );

  if (error && !data) return <div className="space-y-4">{header}<ErrorBlock message={error} onRetry={reload} /></div>;
  if (!data) return <div className="space-y-4">{header}<LoadingBlock /></div>;

  const { personal, workflow, organisation } = data;

  return (
    <div className="space-y-6">
      {header}

      {driver?.id ? <DriverPanel driver={driver} /> : null}

      <section className="space-y-3">
        <SectionHeader title="My trips" icon={Route} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Unclaimed" value={<Money value={personal.unclaimed.amount} />} hint={`${personal.unclaimed.trips} trips · ${formatKm(personal.unclaimed.km)}`} icon={Wallet} tone={personal.unclaimed.expiringSoon ? 'amber' : 'slate'} accent />
          <KpiCard label="In approval" value={<Money value={personal.inApproval.amount} />} hint={`${personal.inApproval.claims} claim${personal.inApproval.claims === 1 ? '' : 's'}`} icon={Hourglass} tone="amber" accent />
          <KpiCard label="Awaiting payment" value={<Money value={personal.awaitingPayment.amount} />} hint={`${personal.awaitingPayment.claims} claim${personal.awaitingPayment.claims === 1 ? '' : 's'} approved`} icon={CircleCheck} tone="violet" accent />
          <KpiCard label={`Paid in FY ${data.financialYear}`} value={<Money value={personal.paidThisYear.amount} />} hint={`${personal.paidThisYear.claims} claim${personal.paidThisYear.claims === 1 ? '' : 's'} · this month ${formatKm(personal.thisMonth.km)}`} icon={Banknote} tone="emerald" accent />
        </div>
        {(personal.unclaimed.expiringSoon > 0 || personal.unclaimed.sentBack > 0) && (
          <div className="flex flex-col gap-2 sm:flex-row">
            {personal.unclaimed.expiringSoon > 0 && (
              <p className="flex flex-1 items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                {personal.unclaimed.expiringSoon} unclaimed trip{personal.unclaimed.expiringSoon === 1 ? '' : 's'} must be submitted within a week.
              </p>
            )}
            {personal.unclaimed.sentBack > 0 && (
              <p className="flex flex-1 items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <Undo2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                {personal.unclaimed.sentBack} trip{personal.unclaimed.sentBack === 1 ? ' was' : 's were'} sent back for correction.
              </p>
            )}
          </div>
        )}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ChartCard title="My reimbursement by month" description="Last six months, by trip date — approved figures where an approver changed them.">
              <MonthlyAmountChart points={personal.trend} label="My reimbursement by month" />
            </ChartCard>
          </div>
          <div className="space-y-4">
            <ChartCard title="Own vs company vehicle" description="Kilometres over the last six months.">
              <OwnershipSplit own={personal.ownership.own} company={personal.ownership.company} />
            </ChartCard>
            <ChartCard title="My latest claims">
              <ClaimRows rows={personal.recentClaims} empty="No claims yet — submit trips from My Trips." />
            </ChartCard>
          </div>
        </div>
      </section>

      {workflow && (
        <section className="space-y-3">
          <SectionHeader title="Waiting for you" icon={Inbox} description="Claims at a stage you are named on. Oldest first." />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <KpiCard label="To approve" value={workflow.approvals} hint={formatINR(workflow.approvalsAmount)} icon={Inbox} tone="amber" accent />
            <KpiCard label="To pay" value={workflow.payments} hint={formatINR(workflow.paymentsAmount)} icon={Banknote} tone="violet" accent />
            <KpiCard label="Past their time" value={workflow.overdue} hint="Waiting longer than the stage allows" icon={Clock} tone={workflow.overdue ? 'rose' : 'slate'} accent />
          </div>
          <ChartCard title="Oldest waiting">
            <ClaimRows rows={workflow.oldest} showEmployee empty="Nothing is waiting for you." />
          </ChartCard>
        </section>
      )}

      {organisation && (
        <section className="space-y-3">
          <SectionHeader title={`Organisation · FY ${organisation.financialYear}`} icon={Gauge} description="Every employee's claims this financial year." />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="In approval" value={formatINRCompact(organisation.inApproval.amount)} hint={`${organisation.inApproval.claims} claims${organisation.overdue ? ` · ${organisation.overdue} overdue` : ''}`} icon={Hourglass} tone="amber" accent />
            <KpiCard label="Awaiting payment" value={formatINRCompact(organisation.awaitingPayment.amount)} hint={`${organisation.awaitingPayment.claims} claims`} icon={CircleCheck} tone="violet" accent />
            <KpiCard label="Paid" value={formatINRCompact(organisation.paid.amount)} hint={`${organisation.paid.claims} claims`} icon={Banknote} tone="emerald" accent />
            <KpiCard label="Not yet claimed" value={formatINRCompact(organisation.unclaimed.amount)} hint={`${organisation.unclaimed.trips} trips recorded, last 6 months`} icon={Wallet} tone="slate" accent />
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
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

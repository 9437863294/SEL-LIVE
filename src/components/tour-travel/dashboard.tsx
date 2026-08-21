'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CalendarClock,
  ClipboardCheck,
  Coins,
  Plane,
  PlaneTakeoff,
  ReceiptIndianRupee,
  Undo2,
  Wallet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import {
  TT_COLLECTIONS,
  dayDifference,
  parseTravelDateTime,
  roundMoney,
  summarizeAdvanceAgeing,
  type TravelAdvance,
  type TravelClaim,
  type TravelPayment,
  type TravelRecovery,
  type TravelRequest,
} from '@/lib/tour-travel';
import { TT_PERMISSION_MODULE } from './module-layout-shell';
import { useTravelCollection, useTravelConfig } from './use-travel-config';
import {
  Money,
  TravelEmptyState,
  TravelKpiCard,
  TravelLoader,
  TravelPageHeader,
  TravelSection,
  TravelStatusBadge,
  TravelDataList,
} from './travel-ui';

const today = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

/**
 * Module dashboard (spec section 2).
 *
 * The organizing principle is that the first screen answers "what needs me?" before "how are we
 * doing?" — My Actions sits above the aggregate KPIs, because an approver landing here is far more
 * likely to be looking for the two tours waiting on them than for the FY travel spend.
 *
 * Financial figures are gated behind the `View Financial Values` permission rather than hidden
 * entirely: a travel-desk user should see who is travelling and when without seeing what anyone's
 * settlement is worth.
 */
export default function TourTravelDashboard() {
  const { user } = useAuth();
  const { can } = useAuthorization();
  const { settings, loading: configLoading } = useTravelConfig();

  const { records: requests, loading: requestsLoading } = useTravelCollection<TravelRequest>(TT_COLLECTIONS.requests);
  const { records: advances, loading: advancesLoading } = useTravelCollection<TravelAdvance>(TT_COLLECTIONS.advances);
  const { records: claims, loading: claimsLoading } = useTravelCollection<TravelClaim>(TT_COLLECTIONS.claims);
  const { records: payments } = useTravelCollection<TravelPayment>(TT_COLLECTIONS.payments);
  const { records: recoveries } = useTravelCollection<TravelRecovery>(TT_COLLECTIONS.recoveries);

  const canSeeMoney = can('View Financial Values', `${TT_PERMISSION_MODULE}.Dashboard`);
  const loading = configLoading || requestsLoading || advancesLoading || claimsLoading;

  const stats = useMemo(() => {
    const now = today();
    const live = requests.filter(request => !request.deleted);

    const activeTours = live.filter(request => ['APPROVED', 'TRAVEL_SCHEDULED', 'IN_PROGRESS'].includes(request.status));
    const awaitingApproval = live.filter(request => request.status === 'UNDER_APPROVAL');
    const upcoming = live
      .filter(request => {
        const departure = parseTravelDateTime(request.departureDate);
        return !!departure && departure >= now && ['APPROVED', 'TRAVEL_SCHEDULED', 'UNDER_APPROVAL'].includes(request.status);
      })
      .sort((a, b) => a.departureDate.localeCompare(b.departureDate));

    // "Currently travelling" is derived from the itinerary window rather than from a status, so it
    // stays right even when nobody has remembered to flag a tour as in progress.
    const travellingNow = live.filter(request => {
      if (!['APPROVED', 'TRAVEL_SCHEDULED', 'IN_PROGRESS'].includes(request.status)) return false;
      const from = parseTravelDateTime(request.departureDate);
      const to = parseTravelDateTime(request.returnDate);
      return !!from && !!to && from <= now && to >= now;
    });

    const openAdvances = advances.filter(advance => !['REJECTED', 'CANCELLED'].includes(advance.status));
    const advanceApproved = roundMoney(openAdvances.reduce((sum, advance) => sum + Number(advance.approvedAmount || 0), 0));
    const advancePaid = roundMoney(openAdvances.reduce((sum, advance) => sum + Number(advance.paidAmount || 0), 0));
    const advanceOutstanding = roundMoney(
      openAdvances.reduce((sum, advance) => sum + Math.max(0, Number(advance.paidAmount || 0) - Number(advance.settledAmount || 0)), 0),
    );

    const claimsPendingSubmission = live.filter(request => request.status === 'COMPLETED' && !request.claimId);
    const claimsUnderVerification = claims.filter(claim => ['SUBMITTED', 'MANAGER_REVIEW', 'FINANCE_REVIEW'].includes(claim.status));
    const claimsPendingValue = roundMoney(claimsUnderVerification.reduce((sum, claim) => sum + Number(claim.totalClaimed || 0), 0));

    const paymentPending = payments.filter(payment => payment.status === 'PENDING');
    const paymentPendingValue = roundMoney(paymentPending.reduce((sum, payment) => sum + Number(payment.amount || 0), 0));

    const recoveryPending = recoveries.filter(recovery => ['PENDING', 'PARTIALLY_RECOVERED'].includes(recovery.status));
    const recoveryPendingValue = roundMoney(
      recoveryPending.reduce((sum, recovery) => sum + Math.max(0, Number(recovery.amount || 0) - Number(recovery.recoveredAmount || 0)), 0),
    );

    // Spend counts approved claim value, not claimed — the dashboard should report what the company
    // actually owns as cost, not what was asked for.
    const currentMonth = new Date().toISOString().slice(0, 7);
    const settledClaims = claims.filter(claim => ['APPROVED', 'PAYMENT_PENDING', 'PAID', 'RECOVERY_PENDING', 'SETTLED'].includes(claim.status));
    const monthSpend = roundMoney(
      settledClaims.filter(claim => (claim.claimDate || '').startsWith(currentMonth)).reduce((sum, claim) => sum + Number(claim.totalApproved || 0), 0),
    );
    const fySpend = roundMoney(settledClaims.reduce((sum, claim) => sum + Number(claim.totalApproved || 0), 0));

    const ageing = summarizeAdvanceAgeing(
      openAdvances.map(advance => ({ paidAmount: advance.paidAmount, settledAmount: advance.settledAmount, paidOn: advance.paidOn })),
    );
    const overdueAdvances = openAdvances.filter(advance => {
      const paidOn = parseTravelDateTime(advance.paidOn);
      if (!paidOn) return false;
      const outstanding = Number(advance.paidAmount || 0) - Number(advance.settledAmount || 0);
      return outstanding > 0 && dayDifference(paidOn, new Date()) > settings.general.advanceSettlementDeadlineDays;
    });

    return {
      activeTours,
      awaitingApproval,
      upcoming,
      travellingNow,
      advanceApproved,
      advancePaid,
      advanceOutstanding,
      claimsPendingSubmission,
      claimsUnderVerification,
      claimsPendingValue,
      paymentPending,
      paymentPendingValue,
      recoveryPending,
      recoveryPendingValue,
      monthSpend,
      fySpend,
      ageing,
      overdueAdvances,
    };
  }, [requests, advances, claims, payments, recoveries, settings.general.advanceSettlementDeadlineDays]);

  /** What is waiting on *this* user specifically. */
  const myActions = useMemo(() => {
    const userId = user?.id;
    if (!userId) return { approvals: [], verifications: [], advanceApprovals: [], myClaimsDue: [], corrections: [] };
    return {
      approvals: requests.filter(request => request.status === 'UNDER_APPROVAL' && (request.currentApprovers || []).includes(userId)),
      verifications: claims.filter(
        claim =>
          (claim.status === 'MANAGER_REVIEW' && claim.reportingManagerId === userId) ||
          (claim.status === 'FINANCE_REVIEW' && can('Verify', `${TT_PERMISSION_MODULE}.Claims`)),
      ),
      advanceApprovals: advances.filter(advance => advance.status === 'REQUESTED' && can('Approve', `${TT_PERMISSION_MODULE}.Advances`)),
      myClaimsDue: requests.filter(request => request.employeeUserId === userId && request.status === 'COMPLETED' && !request.claimId),
      corrections: claims.filter(claim => claim.status === 'CORRECTION_REQUIRED' && claim.employeeUserId === userId),
    };
  }, [requests, claims, advances, user?.id, can]);

  if (loading) return <TravelLoader label="Loading travel data…" />;

  const actionCount =
    myActions.approvals.length +
    myActions.verifications.length +
    myActions.advanceApprovals.length +
    myActions.myClaimsDue.length +
    myActions.corrections.length;

  return (
    <div className="space-y-4">
      <TravelPageHeader
        title="Tour, Travel & Expense"
        description="Tour requests, advances, expense claims and settlements."
        actions={
          <Button asChild className="gap-2 bg-gradient-to-r from-sky-500 to-cyan-600">
            <Link href="/tour-travel/requests/new">
              <PlaneTakeoff className="h-4 w-4" /> New Tour Request
            </Link>
          </Button>
        }
      />

      {/* My Actions comes first: an approver's two pending tours matter more to them than the FY total. */}
      <TravelSection
        title="My Actions"
        description={actionCount ? `${actionCount} item(s) need your attention.` : 'Nothing is waiting on you.'}
      >
        {actionCount === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">You are all caught up.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <ActionTile label="Tours awaiting my approval" count={myActions.approvals.length} href="/tour-travel/approvals" icon={ClipboardCheck} />
            <ActionTile label="Claims to verify" count={myActions.verifications.length} href="/tour-travel/claims" icon={ReceiptIndianRupee} />
            <ActionTile label="Advance approvals" count={myActions.advanceApprovals.length} href="/tour-travel/advances" icon={Wallet} />
            <ActionTile label="My claims to submit" count={myActions.myClaimsDue.length} href="/tour-travel/my-travel" icon={CalendarClock} />
            <ActionTile label="Claims returned to me" count={myActions.corrections.length} href="/tour-travel/my-travel" icon={AlertTriangle} tone="rose" />
          </div>
        )}
      </TravelSection>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <TravelKpiCard label="Active Tours" value={stats.activeTours.length} icon={Plane} tone="blue" href="/tour-travel/requests" />
        <TravelKpiCard label="Awaiting Approval" value={stats.awaitingApproval.length} icon={ClipboardCheck} tone="amber" href="/tour-travel/approvals" />
        <TravelKpiCard label="Travelling Now" value={stats.travellingNow.length} icon={PlaneTakeoff} tone="indigo" />
        <TravelKpiCard label="Upcoming Tours" value={stats.upcoming.length} icon={CalendarClock} tone="slate" href="/tour-travel/requests" />

        {canSeeMoney && (
          <>
            <TravelKpiCard
              label="Advances Outstanding"
              value={<Money value={stats.advanceOutstanding} />}
              hint={`${stats.overdueAdvances.length} overdue`}
              icon={Wallet}
              tone={stats.overdueAdvances.length ? 'rose' : 'violet'}
              href="/tour-travel/advances"
            />
            <TravelKpiCard
              label="Claims Under Verification"
              value={<Money value={stats.claimsPendingValue} />}
              hint={`${stats.claimsUnderVerification.length} claim(s)`}
              icon={ReceiptIndianRupee}
              tone="orange"
              href="/tour-travel/claims"
            />
            <TravelKpiCard
              label="Reimbursement Pending"
              value={<Money value={stats.paymentPendingValue} />}
              hint={`${stats.paymentPending.length} payment(s)`}
              icon={Coins}
              tone="emerald"
              href="/tour-travel/payments"
            />
            <TravelKpiCard
              label="Recovery Pending"
              value={<Money value={stats.recoveryPendingValue} />}
              hint={`${stats.recoveryPending.length} employee(s)`}
              icon={Undo2}
              tone="rose"
              href="/tour-travel/recoveries"
            />
          </>
        )}
      </div>

      {canSeeMoney && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <TravelSection title="Financial Exposure" description="Money committed to travel that has not yet settled.">
            <dl className="space-y-2 text-sm">
              <ExposureRow label="Approved Advances" value={stats.advanceApproved} />
              <ExposureRow label="Advance Paid" value={stats.advancePaid} />
              <ExposureRow label="Unsettled Advances" value={stats.advanceOutstanding} emphasis />
              <ExposureRow label="Claims Pending Verification" value={stats.claimsPendingValue} />
              <ExposureRow label="Payment Pending" value={stats.paymentPendingValue} />
              <ExposureRow label="Recovery Pending" value={stats.recoveryPendingValue} />
              <div className="mt-2 border-t border-slate-100 pt-2">
                <ExposureRow label="Travel Spend — This Month" value={stats.monthSpend} />
                <ExposureRow label="Travel Spend — Financial Year" value={stats.fySpend} emphasis />
              </div>
            </dl>
          </TravelSection>

          <TravelSection
            title="Advance Ageing"
            description="How long employees have been holding unsettled travel advances."
            actions={
              <Button asChild variant="ghost" size="sm">
                <Link href="/tour-travel/advances">Open register</Link>
              </Button>
            }
          >
            {/* On a phone the amount sits above its own full-width bar; the single-line layout only
                fits from `sm` up, where the fixed label/amount columns have room. */}
            <div className="space-y-2.5 sm:space-y-1.5">
              {(['0-7', '8-15', '16-30', '31-60', '>60'] as const).map(bucket => {
                const entry = stats.ageing[bucket];
                const total = Object.values(stats.ageing).reduce((sum, value) => sum + value.amount, 0);
                const width = total > 0 ? Math.round((entry.amount / total) * 100) : 0;
                const alarming = bucket === '31-60' || bucket === '>60';
                return (
                  <div key={bucket} className="text-xs sm:flex sm:items-center sm:gap-2">
                    <div className="mb-1 flex items-baseline justify-between gap-2 sm:mb-0 sm:contents">
                      <span className="text-muted-foreground sm:w-14 sm:shrink-0">{bucket} days</span>
                      <span className="order-3 font-medium tabular-nums sm:w-24 sm:text-right">
                        <Money value={entry.amount} />
                        <span className="ml-1 font-normal text-muted-foreground sm:hidden">({entry.count})</span>
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100 sm:order-2 sm:flex-1">
                      <div className={alarming ? 'h-full rounded-full bg-rose-400' : 'h-full rounded-full bg-sky-400'} style={{ width: `${width}%` }} />
                    </div>
                    <span className="hidden text-right text-muted-foreground sm:order-4 sm:block sm:w-8 sm:shrink-0">{entry.count}</span>
                  </div>
                );
              })}
            </div>
            {stats.overdueAdvances.length > 0 && (
              <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {stats.overdueAdvances.length} advance(s) are past the {settings.general.advanceSettlementDeadlineDays}-day settlement deadline.
              </p>
            )}
          </TravelSection>
        </div>
      )}

      <TravelSection title="Upcoming Travel" description="The next journeys scheduled across the organization.">
        <TravelDataList
          rows={stats.upcoming.slice(0, 10)}
          cardHref={request => `/tour-travel/requests/${request.id}`}
          empty={<TravelEmptyState title="No upcoming travel" description="Approved tours with a future departure date appear here." icon={Plane} />}
          columns={[
            {
              header: 'Employee',
              mobile: 'title',
              cell: request => (
                <>
                  <Link href={`/tour-travel/requests/${request.id}`} className="font-medium hover:underline">
                    {request.employeeName}
                  </Link>
                  <p className="text-[11px] text-muted-foreground">{request.referenceNumber}</p>
                </>
              ),
            },
            { header: 'Status', mobile: 'aside', cell: request => <TravelStatusBadge status={request.status} /> },
            { header: 'Project', cell: request => request.projectName || request.tourType },
            {
              header: 'From → To',
              className: 'hidden md:table-cell',
              cell: request => `${request.itinerary?.[0]?.fromCity || '—'} → ${request.itinerary?.[0]?.toCity || '—'}`,
            },
            { header: 'Departure', cell: request => <span className="tabular-nums">{request.departureDate}</span> },
            { header: 'Return', cell: request => <span className="tabular-nums">{request.returnDate}</span> },
          ]}
        />
      </TravelSection>
    </div>
  );
}

function ActionTile({
  label,
  count,
  href,
  icon: Icon,
  tone = 'sky',
}: {
  label: string;
  count: number;
  href: string;
  icon: React.ElementType;
  tone?: 'sky' | 'rose';
}) {
  if (count === 0) return null;
  return (
    <Link
      href={href}
      className={
        tone === 'rose'
          ? 'flex items-center gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 transition-colors hover:bg-rose-100'
          : 'flex items-center gap-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 transition-colors hover:bg-sky-100'
      }
    >
      <Icon className={tone === 'rose' ? 'h-4 w-4 shrink-0 text-rose-600' : 'h-4 w-4 shrink-0 text-sky-600'} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700">{label}</span>
      <span className={tone === 'rose' ? 'shrink-0 rounded-full bg-rose-600 px-2 py-0.5 text-xs font-semibold text-white' : 'shrink-0 rounded-full bg-sky-600 px-2 py-0.5 text-xs font-semibold text-white'}>
        {count}
      </span>
    </Link>
  );
}

function ExposureRow({ label, value, emphasis }: { label: string; value: number; emphasis?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={emphasis ? 'font-medium text-slate-800' : 'text-muted-foreground'}>{label}</dt>
      <dd className={emphasis ? 'font-semibold text-slate-900' : 'font-medium text-slate-700'}>
        <Money value={value} />
      </dd>
    </div>
  );
}

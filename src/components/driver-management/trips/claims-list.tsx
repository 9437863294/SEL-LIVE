'use client';

/**
 * The claim registers, one component in four modes:
 *
 * - `mine` — the employee's own claims and where each stands.
 * - `approvals` — claims waiting for this person at an approval stage, what they processed, and
 *   (with Override or View All) everything in approval.
 * - `payments` — approved claims waiting for this person to pay, ticked and paid together, and the
 *   payments they recorded.
 * - `all` — every claim of a financial year (Trip Claims · View All), with a CSV export.
 *
 * `embedded` drops the page header: the approvals view is a tab of Driver Management › Approvals
 * (approvals-hub.tsx), which has its own.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Banknote, Download, Inbox, ReceiptText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CellLink, DataList, type ListColumn } from '@/components/shared/data-list';
import { FilterBar } from '@/components/shared/filter-bar';
import { PageHeader } from '@/components/shared/page-header';
import { VM_PRIMARY_BUTTON } from '@/components/vehicle-management/vm-ui';
import { sumMoney } from '@/lib/employee-trips/rates';
import { isClaimable } from '@/lib/employee-trips/trips';
import { stageAge } from '@/lib/employee-trips/workflow';
import { CLAIM_STATUS_LABELS, formatKm, type ClaimStatus, type TripClaim, type TripRecord } from '@/lib/employee-trips/types';
import { cn } from '@/lib/utils';
import { useTripClaims } from './trip-claims-provider';
import { useTripQuery } from './use-trip-query';
import { PayDialog } from './pay-dialog';
import { CreateClaimDialog } from './submit-claim-dialog';
import { ClaimSteps, ClaimStatusBadge, EmptyBlock, ErrorBlock, LoadingBlock, Money, SegmentTabs, downloadCsv, shortDate } from './trip-ui';

export type ClaimsListMode = 'mine' | 'approvals' | 'payments' | 'all';

type Tab = { value: string; label: string; scope: 'mine' | 'inbox' | 'processed' | 'active' | 'all'; filter: (claim: TripClaim, userId: string) => boolean };

const ACTIVE: ClaimStatus[] = ['pending', 'approved'];
const CLOSED: ClaimStatus[] = ['returned', 'rejected', 'withdrawn'];

function tabsFor(mode: ClaimsListMode, wide: boolean): Tab[] {
  switch (mode) {
    case 'mine':
      return [
        { value: 'process', label: 'In process', scope: 'mine', filter: (claim) => ACTIVE.includes(claim.status) },
        { value: 'paid', label: 'Paid', scope: 'mine', filter: (claim) => claim.status === 'paid' },
        { value: 'closed', label: 'Sent back / rejected', scope: 'mine', filter: (claim) => CLOSED.includes(claim.status) },
        { value: 'all', label: 'All', scope: 'mine', filter: () => true },
      ];
    case 'approvals':
      return [
        { value: 'waiting', label: 'Waiting for me', scope: 'inbox', filter: (claim) => claim.status === 'pending' },
        { value: 'processed', label: 'Processed by me', scope: 'processed', filter: (claim, userId) => claim.history.some((entry) => entry.byId === userId && entry.action !== 'paid') },
        ...(wide ? [{ value: 'everyone', label: 'All in approval', scope: 'active' as const, filter: (claim: TripClaim) => claim.status === 'pending' }] : []),
      ];
    case 'payments':
      return [
        { value: 'ready', label: 'Ready to pay', scope: 'inbox', filter: (claim) => claim.status === 'approved' },
        { value: 'paid', label: 'Paid by me', scope: 'processed', filter: (claim, userId) => claim.payment?.byId === userId },
        ...(wide ? [{ value: 'everyone', label: 'All awaiting payment', scope: 'active' as const, filter: (claim: TripClaim) => claim.status === 'approved' }] : []),
      ];
    case 'all':
      return [
        { value: 'all', label: 'All', scope: 'all', filter: () => true },
        { value: 'process', label: 'In approval', scope: 'all', filter: (claim) => claim.status === 'pending' },
        { value: 'payment', label: 'Awaiting payment', scope: 'all', filter: (claim) => claim.status === 'approved' },
        { value: 'paid', label: 'Paid', scope: 'all', filter: (claim) => claim.status === 'paid' },
        { value: 'closed', label: 'Closed', scope: 'all', filter: (claim) => CLOSED.includes(claim.status) },
      ];
  }
}

const HEADINGS: Record<ClaimsListMode, { title: string; description: string; icon: typeof Inbox }> = {
  mine: { title: 'My Claims', description: 'Each claim holds one or more of your trips. See who it is with now, and what was paid.', icon: ReceiptText },
  approvals: { title: 'Approvals', description: 'Trip claims waiting for your verification and approval.', icon: Inbox },
  payments: { title: 'Payments', description: 'Approved trip claims waiting to be paid. Tick several to record one payment for all.', icon: Banknote },
  all: { title: 'All Claims', description: 'Every trip claim in the financial year, across employees.', icon: ReceiptText },
};

const previousYears = (financialYear: string, count = 3) => {
  const start = Number(financialYear.slice(0, 4));
  return Array.from({ length: count }, (_, index) => `${start - index}-${String((start - index + 1) % 100).padStart(2, '0')}`);
};

export default function ClaimsList({ mode, embedded = false }: { mode: ClaimsListMode; embedded?: boolean }) {
  const router = useRouter();
  const { data, error: bootError, loading: bootLoading, reload: reloadBootstrap } = useTripClaims();
  const wide = Boolean(data?.access.override || data?.access.viewAll);
  const tabs = useMemo(() => tabsFor(mode, wide), [mode, wide]);
  const [tab, setTab] = useState(tabs[0].value);
  const [financialYear, setFinancialYear] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [payOpen, setPayOpen] = useState(false);

  const current = tabs.find((entry) => entry.value === tab) ?? tabs[0];
  const fy = financialYear || data?.financialYear || '';
  const allowed = mode !== 'all' || Boolean(data?.access.viewAll);
  const path = data && allowed ? `claims?scope=${current.scope}${current.scope === 'all' ? `&fy=${fy}` : ''}` : null;
  const query = useTripQuery<{ claims: TripClaim[] }>(path);
  // While another list loads, the previous one is not shown as this one (a reload of this one is).
  const claims = query.dataPath === path ? query.data?.claims : undefined;
  const error = query.loading ? null : query.error;

  // My Claims creates claims too: the employee's unclaimed trips feed "Create claim".
  const [claimOpen, setClaimOpen] = useState(false);
  const tripsQuery = useTripQuery<{ trips: TripRecord[] }>(mode === 'mine' && data ? 'trips' : null);
  const candidates = useMemo(() => (data ? (tripsQuery.data?.trips ?? []).filter((trip) => isClaimable(trip, data.today, data.settings.rules)) : []), [data, tripsQuery.data]);

  const userId = data?.user.id ?? '';
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (claims ?? []).filter((claim) => current.filter(claim, userId) && (!needle || [claim.claimNumber, claim.employeeName, claim.projectName, claim.departmentName].some((value) => String(value ?? '').toLowerCase().includes(needle))));
  }, [claims, current, search, userId]);

  const selectable = mode === 'payments' && current.value !== 'paid';
  const payable = (claim: TripClaim) => selectable && claim.status === 'approved' && claim.employeeId !== userId && (claim.currentAssigneeIds.includes(userId) || Boolean(data?.access.override));
  const chosen = visible.filter((claim) => selected.has(claim.id) && payable(claim));

  const refresh = () => {
    setSelected(new Set());
    query.reload();
    reloadBootstrap();
  };

  const columns: ListColumn<TripClaim>[] = [];
  if (selectable) {
    columns.push({
      header: 'Select',
      mobile: 'footer',
      className: 'w-10',
      cell: (claim) =>
        payable(claim) ? (
          <label className="flex items-center gap-2 text-sm" onClick={(event) => event.stopPropagation()}>
            <Checkbox
              checked={selected.has(claim.id)}
              onCheckedChange={(value) =>
                setSelected((existing) => {
                  const next = new Set(existing);
                  if (value === true) next.add(claim.id);
                  else next.delete(claim.id);
                  return next;
                })
              }
              aria-label={`Select ${claim.claimNumber}`}
            />
            <span className="sm:hidden">Select to pay</span>
          </label>
        ) : null,
    });
  }
  columns.push(
    {
      header: 'Claim',
      mobile: 'title',
      cell: (claim) => (
        <div className="min-w-0">
          <CellLink href={`/driver-management/claims/${claim.id}`} className="font-medium text-slate-800 hover:underline">
            {claim.claimNumber}
          </CellLink>
          {mode !== 'mine' && <p className="truncate text-xs text-muted-foreground">{claim.employeeName}</p>}
          {(claim.projectName || claim.departmentName) && <p className="truncate text-[11px] text-muted-foreground">{claim.projectName || claim.departmentName}</p>}
        </div>
      ),
    },
    { header: 'Period', cell: (claim) => <span className="whitespace-nowrap text-xs">{shortDate(claim.periodFrom)}{claim.periodTo !== claim.periodFrom ? ` – ${shortDate(claim.periodTo)}` : ''}</span> },
    { header: 'Trips', align: 'right', cell: (claim) => <span className="whitespace-nowrap tabular-nums text-xs">{claim.totals.tripCount} · {formatKm(claim.totals.distanceKm)}</span> },
    { header: 'Claimed', align: 'right', cell: (claim) => <Money value={claim.totals.claimedAmount} /> },
    {
      header: 'Approved',
      align: 'right',
      cell: (claim) => (claim.status === 'pending' && claim.currentStageIndex === 0 ? <span className="text-xs text-muted-foreground">—</span> : <Money value={claim.status === 'paid' ? claim.payment?.amount ?? claim.totals.approvedAmount : claim.totals.approvedAmount} className="font-medium" />),
    },
    {
      header: 'Where it is',
      cell: (claim) => {
        const stage = claim.stages[claim.currentStageIndex];
        const age = stageAge(claim);
        if (claim.status === 'paid') return <span className="text-xs text-muted-foreground">Paid {shortDate(claim.payment?.paidOn)}{claim.payment?.reference ? ` · ${claim.payment.reference}` : ''}</span>;
        if (!ACTIVE.includes(claim.status)) {
          const last = claim.history[claim.history.length - 1];
          return <span className="block max-w-[16rem] truncate text-xs text-muted-foreground" title={last?.remarks}>{last ? `${last.byName}${last.remarks ? `: ${last.remarks}` : ''}` : '—'}</span>;
        }
        return (
          <span className="block max-w-[16rem] text-xs">
            <span className="font-medium text-slate-700">{stage?.name}</span>
            <span className={cn('block truncate', age.overdue ? 'text-rose-700' : 'text-muted-foreground')}>
              {stage?.assigneeNames.join(', ') || 'Unassigned'} · {age.hours < 24 ? `${Math.floor(age.hours)} h` : `${Math.floor(age.hours / 24)} d`}
              {age.overdue ? ' · overdue' : ''}
            </span>
          </span>
        );
      },
    },
    { header: 'Status', mobile: 'aside', cell: (claim) => <ClaimStatusBadge status={claim.status} /> },
  );

  if (bootLoading && !data) return <LoadingBlock />;
  if (!data) return <ErrorBlock message={bootError ?? 'Could not load trip claims.'} onRetry={() => void reloadBootstrap()} />;
  if (mode === 'all' && !data.access.viewAll) return <ErrorBlock message="The claims register needs Driver Management · Trip Claims · View All." />;

  const heading = HEADINGS[mode];
  const counts = Object.fromEntries(tabs.map((entry) => [entry.value, entry.scope === current.scope ? (claims ?? []).filter((claim) => entry.filter(claim, userId)).length : undefined]));

  function exportCsv() {
    downloadCsv(
      `trip-claims-${fy}.csv`,
      ['Claim', 'Employee', 'Project', 'Department', 'From', 'To', 'Trips', 'Km', 'Claimed', 'Approved', 'Status', 'Stage', 'Submitted', 'Paid on', 'Mode', 'Reference'],
      visible.map((claim) => [
        claim.claimNumber,
        claim.employeeName,
        claim.projectName,
        claim.departmentName,
        claim.periodFrom,
        claim.periodTo,
        claim.totals.tripCount,
        claim.totals.distanceKm,
        claim.totals.claimedAmount,
        claim.totals.approvedAmount,
        CLAIM_STATUS_LABELS[claim.status],
        ACTIVE.includes(claim.status) ? claim.stages[claim.currentStageIndex]?.name : '',
        claim.submittedAt.slice(0, 10),
        claim.payment?.paidOn,
        claim.payment?.mode,
        claim.payment?.reference,
      ]),
    );
  }

  return (
    <div className="space-y-4">
      {!embedded && (
        <PageHeader
          title={heading.title}
          icon={heading.icon}
          description={heading.description}
          meta={claims ? [{ label: 'Claims', value: String(visible.length) }, { label: mode === 'payments' ? 'To pay' : 'Claimed', value: <Money value={sumMoney(visible.map((claim) => (mode === 'payments' ? claim.totals.approvedAmount : claim.totals.claimedAmount)))} /> }] : undefined}
          actions={
            <>
              {mode === 'mine' && (
                <Button type="button" className={VM_PRIMARY_BUTTON} onClick={() => setClaimOpen(true)}>
                  <ReceiptText className="mr-2 h-4 w-4" aria-hidden />
                  {candidates.length ? `Create claim (${candidates.length} unclaimed trip${candidates.length === 1 ? '' : 's'})` : 'Create claim'}
                </Button>
              )}
              {mode === 'all' && data.access.exportAll && (
                <Button type="button" variant="outline" onClick={exportCsv} disabled={!visible.length}>
                  <Download className="mr-2 h-4 w-4" aria-hidden />
                  Export CSV
                </Button>
              )}
              {selectable && chosen.length > 0 && (
                <Button type="button" className={VM_PRIMARY_BUTTON} onClick={() => setPayOpen(true)}>
                  <Banknote className="mr-2 h-4 w-4" aria-hidden />
                  Pay {chosen.length} · <Money value={sumMoney(chosen.map((claim) => claim.totals.approvedAmount))} className="ml-1" />
                </Button>
              )}
            </>
          }
        />
      )}

      {mode === 'mine' && <ClaimSteps approvalName={data.settings.stages.find((stage) => stage.kind === 'approval')?.name} paymentName={data.settings.stages.find((stage) => stage.kind === 'payment')?.name} />}

      <FilterBar search={{ value: search, onChange: setSearch, placeholder: 'Search claim, employee, project…', label: 'Search claims' }} onClear={() => setSearch('')}>
        {mode === 'all' && (
          <Select value={fy} onValueChange={setFinancialYear}>
            <SelectTrigger className="w-full bg-white text-left sm:w-36" aria-label="Financial year">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {previousYears(data.financialYear).map((year) => (
                <SelectItem key={year} value={year}>
                  FY {year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </FilterBar>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentTabs label="Claims" value={current.value} onChange={(value) => { setTab(value); setSelected(new Set()); }} options={tabs.map((entry) => ({ value: entry.value, label: entry.label, count: counts[entry.value] }))} />
        {selectable && visible.some(payable) && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setSelected((existing) => (visible.filter(payable).every((claim) => existing.has(claim.id)) ? new Set() : new Set(visible.filter(payable).map((claim) => claim.id))))}>
            {visible.filter(payable).every((claim) => selected.has(claim.id)) ? 'Clear selection' : `Select all ${visible.filter(payable).length}`}
          </Button>
        )}
      </div>

      {error ? (
        <ErrorBlock message={error} onRetry={query.reload} />
      ) : !claims ? (
        <LoadingBlock />
      ) : (
        <DataList
          rows={visible}
          columns={columns}
          dense
          onRowClick={(claim) => router.push(`/driver-management/claims/${claim.id}`)}
          cardHref={(claim) => `/driver-management/claims/${claim.id}`}
          rowClassName={(claim) => (stageAge(claim).overdue ? 'bg-rose-50/40' : selected.has(claim.id) ? 'bg-primary/5' : undefined)}
          empty={
            <EmptyBlock icon={heading.icon} title={current.value === 'waiting' || current.value === 'ready' ? 'Nothing is waiting for you' : 'No claims here'}>
              {mode === 'mine' ? 'Use “Create claim” to put one or more of your recorded trips on a claim.' : current.value === 'waiting' || current.value === 'ready' ? 'You will be notified when a claim reaches you.' : 'Try another tab.'}
            </EmptyBlock>
          }
        />
      )}

      <PayDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        claims={chosen.map((claim) => ({ id: claim.id, claimNumber: claim.claimNumber, employeeName: claim.employeeName, amount: claim.totals.approvedAmount }))}
        today={data.today}
        onPaid={refresh}
      />
      {mode === 'mine' && (
        <CreateClaimDialog
          open={claimOpen}
          onOpenChange={setClaimOpen}
          data={data}
          candidates={candidates}
          preselected={[]}
          onSubmitted={(created) => {
            tripsQuery.reload();
            refresh();
            if (created.length === 1) router.push(`/driver-management/claims/${created[0].id}`);
          }}
          onRecordTrip={() => router.push('/driver-management/fleet?kind=own')}
        />
      )}
    </div>
  );
}

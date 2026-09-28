'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ReceiptIndianRupee } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { CLAIM_STATUSES, TT_COLLECTIONS, roundMoney, travelStatusLabel, type TravelClaim } from '@/lib/tour-travel';
import { TT_PERMISSION_MODULE } from './module-layout-shell';
import { useTravelCollection } from './use-travel-config';
import { Money, TravelEmptyState, TravelLoader } from './travel-ui';
import { PageHeader } from '@/components/shared/page-header';
import { DataList } from '@/components/shared/data-list';
import { FilterBar } from '@/components/shared/filter-bar';
import { StatusBadge } from '@/components/shared/status-badge';
import { TableCard } from '@/components/shared/table-card';

/**
 * Expense claim register.
 *
 * Defaults to the queue that needs work — anything under review — rather than to every claim ever
 * filed, because the people who open this page are almost always here to verify something. A
 * verifier's own claims are excluded from their action count elsewhere, but they remain visible
 * here so nobody loses sight of their own submission.
 */
export default function ClaimsRegister() {
  const { user } = useAuth();
  const { can } = useAuthorization();
  const { records, loading } = useTravelCollection<TravelClaim>(TT_COLLECTIONS.claims);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('pending');

  const canViewAll = can('View All', `${TT_PERMISSION_MODULE}.Claims`);
  const canVerify = can('Verify', `${TT_PERMISSION_MODULE}.Claims`);

  const visible = useMemo(
    () =>
      records.filter(
        claim => canViewAll || claim.employeeUserId === user?.id || claim.reportingManagerId === user?.id || canVerify,
      ),
    [records, canViewAll, canVerify, user?.id],
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const pendingStatuses = ['SUBMITTED', 'MANAGER_REVIEW', 'FINANCE_REVIEW', 'CORRECTION_REQUIRED'];
    return visible
      .filter(claim => {
        if (status === 'pending' && !pendingStatuses.includes(claim.status)) return false;
        if (status !== 'pending' && status !== 'all' && claim.status !== status) return false;
        if (!needle) return true;
        return [claim.referenceNumber, claim.travelRequestNumber, claim.employeeName, claim.projectName]
          .some(value => (value || '').toLowerCase().includes(needle));
      })
      .sort((a, b) => (b.claimDate || '').localeCompare(a.claimDate || ''));
  }, [visible, search, status]);

  const totals = useMemo(
    () => ({
      claimed: roundMoney(filtered.reduce((sum, claim) => sum + Number(claim.totalClaimed || 0), 0)),
      approved: roundMoney(filtered.reduce((sum, claim) => sum + Number(claim.totalApproved || 0), 0)),
    }),
    [filtered],
  );

  if (loading) return <TravelLoader label="Loading claims…" />;

  return (
    <div className="space-y-3">
      <PageHeader title="Expense Claims" description="Travel expense claims, verification and settlement." />

      <TableCard
        title="Claims"
        icon={ReceiptIndianRupee}
        count={filtered.length}
        noun="claim"
        toolbar={
          <FilterBar
            search={{ value: search, onChange: setSearch, placeholder: 'Claim, tour, employee, project' }}
            activeCount={status !== 'pending' ? 1 : 0}
            onClear={() => { setSearch(''); setStatus('pending'); }}
            summary={`Claimed ${totals.claimed.toLocaleString('en-IN')} · approved ${totals.approved.toLocaleString('en-IN')}`}
          >
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger aria-label="Status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Needs attention</SelectItem>
                <SelectItem value="all">All statuses</SelectItem>
                {CLAIM_STATUSES.map(value => <SelectItem key={value} value={value}>{value.replace(/_/g, ' ')}</SelectItem>)}
              </SelectContent>
            </Select>
          </FilterBar>
        }
      >
        <div className="p-3 sm:p-0">
          <DataList
            frameless
            rows={filtered}
            empty={
              <TravelEmptyState
                title="No claims match"
                description="Claims appear here once an employee raises one against a completed tour."
                icon={ReceiptIndianRupee}
              />
            }
            columns={[
              {
                header: 'Claim',
                mobile: 'title',
                cell: claim => (
                  <>
                    <Link href={`/tour-travel/claims/${claim.id}`} className="font-medium text-sky-700 hover:underline">
                      {claim.referenceNumber}
                    </Link>
                    <p className="text-[11px] text-muted-foreground">{claim.claimDate}</p>
                  </>
                ),
              },
              { header: 'Employee', mobile: 'title', cell: claim => claim.employeeName },
              { header: 'Status', mobile: 'aside', cell: claim => <StatusBadge status={claim.status}>{travelStatusLabel(claim.status)}</StatusBadge> },
              {
                header: 'Tour / Project',
                className: 'hidden md:table-cell',
                cell: claim => (
                  <>
                    {claim.travelRequestNumber}
                    {claim.projectName && <p className="text-[11px] text-muted-foreground">{claim.projectName}</p>}
                  </>
                ),
              },
              { header: 'Claimed', align: 'right', cell: claim => <Money value={claim.totalClaimed} /> },
              {
                header: 'Approved',
                align: 'right',
                cell: claim => (
                  <>
                    <Money value={claim.totalApproved} />
                    {claim.totalDisallowed > 0 && (
                      <p className="text-[11px] text-rose-600">−<Money value={claim.totalDisallowed} /></p>
                    )}
                  </>
                ),
              },
              {
                header: 'Net',
                align: 'right',
                cell: claim =>
                  claim.netRecoverable > 0 ? (
                    <span className="text-rose-600">−<Money value={claim.netRecoverable} /></span>
                  ) : (
                    <span className="text-emerald-700"><Money value={claim.netPayable} /></span>
                  ),
              },
              {
                header: 'Action',
                mobile: 'footer',
                cell: claim =>
                  canVerify && ['SUBMITTED', 'MANAGER_REVIEW', 'FINANCE_REVIEW'].includes(claim.status) ? (
                    <Button asChild size="sm" variant="outline" className="h-7 px-2 text-xs sm:h-7">
                      <Link href={`/tour-travel/claims/${claim.id}/verify`}>Verify</Link>
                    </Button>
                  ) : (
                    <Button asChild size="sm" variant="outline" className="h-7 px-2 text-xs sm:hidden">
                      <Link href={`/tour-travel/claims/${claim.id}`}>Open</Link>
                    </Button>
                  ),
              },
            ]}
          />
        </div>
      </TableCard>
    </div>
  );
}

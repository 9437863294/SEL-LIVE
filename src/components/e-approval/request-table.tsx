'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrowUpDown, FileSearch, Inbox, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import {
  eApprovalAgeingBucket,
  E_APPROVAL_BASE_PATH,
  E_APPROVAL_STATUSES,
  type EApprovalRequest,
  type EApprovalStatus,
} from '@/lib/e-approval';
import {
  EApprovalConfidentialBadge,
  EApprovalDueBadge,
  EApprovalEmptyState,
  EApprovalPriorityBadge,
  EApprovalStatusBadge,
} from './shared';
import { formatEApprovalAmount, formatEApprovalDate } from './hooks';

type SortKey = 'created' | 'due' | 'amount' | 'reference';

/**
 * The register table every list screen uses (spec section 14).
 *
 * One component rather than one per screen: the inbox, "created by me", the department queue and the
 * full register differ only in which rows they are handed and which columns are worth showing, and
 * six near-identical tables is how four of them end up missing the ageing column.
 */
export function EApprovalRequestTable({
  rows,
  isLoading,
  emptyTitle = 'Nothing here',
  emptyDescription,
  showRequester = true,
  showPendingWith = true,
  showAgeing = true,
  showStatusFilter = true,
}: {
  rows: EApprovalRequest[];
  isLoading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  showRequester?: boolean;
  showPendingWith?: boolean;
  showAgeing?: boolean;
  showStatusFilter?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'All' | EApprovalStatus>('All');
  const [sortKey, setSortKey] = useState<SortKey>('created');
  const [ascending, setAscending] = useState(false);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    let list = rows;
    if (term) {
      list = list.filter(
        (row) =>
          row.subject?.toLowerCase().includes(term) ||
          row.referenceNo?.toLowerCase().includes(term) ||
          row.requesterName?.toLowerCase().includes(term) ||
          row.departmentName?.toLowerCase().includes(term) ||
          row.projectName?.toLowerCase().includes(term) ||
          row.pendingLabel?.toLowerCase().includes(term),
      );
    }
    if (status !== 'All') list = list.filter((row) => row.status === status);

    const direction = ascending ? 1 : -1;
    return [...list].sort((a, b) => {
      if (sortKey === 'amount') return ((a.amount ?? 0) - (b.amount ?? 0)) * direction;
      if (sortKey === 'reference') return String(a.referenceNo ?? '').localeCompare(String(b.referenceNo ?? '')) * direction;
      if (sortKey === 'due') {
        const left = a.currentDueAt ? new Date(a.currentDueAt).getTime() : Number.MAX_SAFE_INTEGER;
        const right = b.currentDueAt ? new Date(b.currentDueAt).getTime() : Number.MAX_SAFE_INTEGER;
        return (left - right) * direction;
      }
      const left = a.createdAt?.toMillis() ?? 0;
      const right = b.createdAt?.toMillis() ?? 0;
      return (left - right) * direction;
    });
  }, [rows, search, status, sortKey, ascending]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setAscending((value) => !value);
    else {
      setSortKey(key);
      setAscending(key === 'due');
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-2 p-3">
        {[0, 1, 2, 3, 4].map((row) => (
          <Skeleton key={row} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 px-1">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search reference, subject, person…"
            className="h-9 pl-7 text-xs"
          />
        </div>
        {showStatusFilter && (
          <Select value={status} onValueChange={(next) => setStatus(next as 'All' | EApprovalStatus)}>
            <SelectTrigger className="h-9 w-[180px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All statuses</SelectItem>
              {E_APPROVAL_STATUSES.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {filtered.length} of {rows.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <EApprovalEmptyState icon={rows.length ? FileSearch : Inbox} title={emptyTitle} description={emptyDescription} />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="whitespace-nowrap">
                  <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort('reference')}>
                    Reference <ArrowUpDown className="h-3 w-3" />
                  </button>
                </TableHead>
                <TableHead>Subject</TableHead>
                {showRequester && <TableHead className="whitespace-nowrap">From</TableHead>}
                <TableHead className="whitespace-nowrap">Department</TableHead>
                <TableHead className="whitespace-nowrap text-right">
                  <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort('amount')}>
                    Amount <ArrowUpDown className="h-3 w-3" />
                  </button>
                </TableHead>
                {showPendingWith && <TableHead className="whitespace-nowrap">Pending with</TableHead>}
                {showAgeing && <TableHead className="whitespace-nowrap">Age</TableHead>}
                <TableHead className="whitespace-nowrap">
                  <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort('due')}>
                    SLA <ArrowUpDown className="h-3 w-3" />
                  </button>
                </TableHead>
                <TableHead className="whitespace-nowrap">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row) => (
                <TableRow key={row.id} className="hover:bg-muted/30">
                  <TableCell className="whitespace-nowrap font-mono text-[11px]">
                    <Link href={`${E_APPROVAL_BASE_PATH}/${row.id}`} className="text-sky-700 hover:underline">
                      {row.referenceNo || 'Draft'}
                    </Link>
                  </TableCell>
                  <TableCell className="min-w-[220px] max-w-[360px]">
                    <Link href={`${E_APPROVAL_BASE_PATH}/${row.id}`} className="block hover:underline">
                      <span className="line-clamp-1 text-sm font-medium">{row.subject}</span>
                    </Link>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1">
                      <EApprovalPriorityBadge priority={row.priority} />
                      <EApprovalConfidentialBadge confidential={row.confidential} />
                      {(row.version ?? 1) > 1 && (
                        <span className="text-[10px] text-muted-foreground">v{row.version}</span>
                      )}
                    </span>
                  </TableCell>
                  {showRequester && (
                    <TableCell className="whitespace-nowrap text-xs">{row.requesterName || '—'}</TableCell>
                  )}
                  <TableCell className="whitespace-nowrap text-xs">{row.departmentName || '—'}</TableCell>
                  <TableCell className="whitespace-nowrap text-right text-xs font-medium tabular-nums">
                    {row.amount == null ? '—' : formatEApprovalAmount(row.amount)}
                  </TableCell>
                  {showPendingWith && (
                    <TableCell className="max-w-[200px] text-xs">
                      <span className="line-clamp-1">{row.pendingLabel || '—'}</span>
                      {row.currentStepName && (
                        <span className="block truncate text-[10px] text-muted-foreground">{row.currentStepName}</span>
                      )}
                    </TableCell>
                  )}
                  {showAgeing && (
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {eApprovalAgeingBucket(row.submittedAt)}
                      <span className="block text-[10px]">{formatEApprovalDate(row.submittedAt)}</span>
                    </TableCell>
                  )}
                  <TableCell className="whitespace-nowrap">
                    <EApprovalDueBadge dueAt={row.currentDueAt} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <EApprovalStatusBadge status={row.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

/** A compact card list for the dashboard's "Requires My Action" panel. */
export function EApprovalActionList({
  rows,
  emptyTitle = 'Nothing needs your action',
}: {
  rows: EApprovalRequest[];
  emptyTitle?: string;
}) {
  if (!rows.length) {
    return <EApprovalEmptyState icon={Inbox} title={emptyTitle} description="Approvals assigned to you appear here." />;
  }
  return (
    <div className="divide-y">
      {rows.map((row) => (
        <Link
          key={row.id}
          href={`${E_APPROVAL_BASE_PATH}/${row.id}`}
          className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/40"
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[11px] text-muted-foreground">{row.referenceNo}</span>
              <EApprovalPriorityBadge priority={row.priority} />
              <EApprovalConfidentialBadge confidential={row.confidential} />
            </div>
            <p className="line-clamp-1 text-sm font-medium">{row.subject}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {row.requesterName}
              {row.departmentName ? ` · ${row.departmentName}` : ''}
              {row.currentStepName ? ` · ${row.currentStepName}` : ''}
            </p>
          </div>
          <div className={cn('shrink-0 text-right')}>
            {row.amount != null && (
              <p className="text-xs font-semibold tabular-nums">{formatEApprovalAmount(row.amount)}</p>
            )}
            <EApprovalDueBadge dueAt={row.currentDueAt} />
          </div>
        </Link>
      ))}
    </div>
  );
}

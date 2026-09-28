'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowUpDown, CheckCircle2, FileSearch, Inbox, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FilterBar } from '@/components/shared/filter-bar';
import { StatusBadge } from '@/components/shared/status-badge';
import { TableCard } from '@/components/shared/table-card';
import {
  eApprovalAgeingBucket,
  E_APPROVAL_BASE_PATH,
  E_APPROVAL_STATUSES,
  type EApprovalRequest,
  type EApprovalStatus,
} from '@/lib/e-approval';
import {
  EApprovalConfidentialBadge,
  EApprovalSourceBadge,
  EApprovalDueBadge,
  EApprovalEmptyState,
  eApprovalPriorityTone,
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
  renderActions,
}: {
  rows: EApprovalRequest[];
  isLoading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  showRequester?: boolean;
  showPendingWith?: boolean;
  showAgeing?: boolean;
  showStatusFilter?: boolean;
  /**
   * Per-row controls in a trailing column — today, deleting a request.
   *
   * A render prop rather than a `canDelete` flag and a built-in button: the register has no business
   * knowing which permissions govern which action, and the next thing wanted here (re-open a
   * cancelled file, export one row) would otherwise be a second flag and a second button.
   */
  renderActions?: (row: EApprovalRequest) => ReactNode;
}) {
  const [search, setSearch] = useState('');
  /**
   * The term the list is actually filtered by, a beat behind what is being typed.
   *
   * The register renders every row it is given — the full-register screen loads four hundred, each
   * one nine cells with badges and two links — and filtering on each keystroke re-rendered all of
   * them per character. Holding the committed term separately means the input stays immediate while
   * the table redraws once the typing pauses, which is the only moment the results are being read.
   */
  const [appliedSearch, setAppliedSearch] = useState('');
  const [status, setStatus] = useState<'All' | EApprovalStatus>('All');
  const [sortKey, setSortKey] = useState<SortKey>('created');
  const [ascending, setAscending] = useState(false);

  useEffect(() => {
    if (search === appliedSearch) return;
    const timer = setTimeout(() => setAppliedSearch(search), 200);
    return () => clearTimeout(timer);
  }, [search, appliedSearch]);

  const filtered = useMemo(() => {
    const term = appliedSearch.trim().toLowerCase();
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
  }, [rows, appliedSearch, status, sortKey, ascending]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setAscending((value) => !value);
    else {
      setSortKey(key);
      setAscending(key === 'due');
    }
  };

  return (
    // The card scrolls the rows under a pinned header, so the filters above stay reachable however
    // many approvals are loaded.
    <TableCard
      title="Approvals"
      count={isLoading ? undefined : filtered.length}
      total={isLoading ? undefined : rows.length}
      noun="approval"
      toolbar={
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: 'Search reference, subject, person…' }}
          activeCount={status !== 'All' ? 1 : 0}
          onClear={() => {
            setSearch('');
            setStatus('All');
          }}
        >
          {showStatusFilter && (
            <Select value={status} onValueChange={(next) => setStatus(next as 'All' | EApprovalStatus)}>
              <SelectTrigger aria-label="Status">
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
        </FilterBar>
      }
    >
      {isLoading ? (
        <div className="space-y-2 p-3">
          {[0, 1, 2, 3, 4].map((row) => (
            <Skeleton key={row} className="h-10 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EApprovalEmptyState icon={rows.length ? FileSearch : Inbox} title={emptyTitle} description={emptyDescription} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
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
                {renderActions && <TableHead className="w-10" aria-label="Actions" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap font-mono">
                    <Link href={`${E_APPROVAL_BASE_PATH}/${row.id}`} className="text-sky-700 hover:underline">
                      {row.referenceNo || 'Draft'}
                    </Link>
                  </TableCell>
                  <TableCell className="min-w-[220px] max-w-[360px]">
                    <Link href={`${E_APPROVAL_BASE_PATH}/${row.id}`} className="block hover:underline">
                      <span className="line-clamp-1 font-medium">{row.subject}</span>
                    </Link>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1">
                      {row.priority && row.priority !== 'Normal' && (
                        <StatusBadge status={row.priority} tone={eApprovalPriorityTone[row.priority]} />
                      )}
                      <EApprovalConfidentialBadge confidential={row.confidential} />
                      <EApprovalSourceBadge source={row.source} />
                      {(row.version ?? 1) > 1 && (
                        <span className="text-[10px] text-muted-foreground">v{row.version}</span>
                      )}
                    </span>
                  </TableCell>
                  {showRequester && (
                    <TableCell className="whitespace-nowrap">{row.requesterName || '—'}</TableCell>
                  )}
                  <TableCell className="whitespace-nowrap">{row.departmentName || '—'}</TableCell>
                  <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">
                    {row.amount == null ? '—' : formatEApprovalAmount(row.amount)}
                  </TableCell>
                  {showPendingWith && (
                    <TableCell className="max-w-[200px]">
                      <span className="line-clamp-1">{row.pendingLabel || '—'}</span>
                      {row.currentStepName && (
                        <span className="block truncate text-[10px] text-muted-foreground">{row.currentStepName}</span>
                      )}
                    </TableCell>
                  )}
                  {showAgeing && (
                    <TableCell className="whitespace-nowrap">
                      {eApprovalAgeingBucket(row.submittedAt)}
                      <span className="block text-[10px] text-muted-foreground">{formatEApprovalDate(row.submittedAt)}</span>
                    </TableCell>
                  )}
                  <TableCell className="whitespace-nowrap">
                    <EApprovalDueBadge dueAt={row.currentDueAt} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <StatusBadge status={row.status}>
                      {row.status === 'Superseded' ? <s>Superseded</s> : undefined}
                    </StatusBadge>
                  </TableCell>
                  {renderActions && (
                    <TableCell className="whitespace-nowrap text-right">
                      {renderActions(row)}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
      )}
    </TableCard>
  );
}

/**
 * A compact card list for the dashboard's "Requires My Action" panel.
 *
 * `onQuickApprove` + `isQuickApprovable` are optional: pass both to offer a one-click Approve on the
 * rows safe for it (see `eApprovalRowIsQuickApprovable` — a plain approval, assigned by name, alone).
 * The row stays a link everywhere else; only the button intercepts the click, so the common case of
 * "clear the easy ones without leaving the dashboard" does not cost the ability to open a file for a
 * closer look.
 */
export function EApprovalActionList({
  rows,
  emptyTitle = 'Nothing needs your action',
  isQuickApprovable,
  onQuickApprove,
}: {
  rows: EApprovalRequest[];
  emptyTitle?: string;
  isQuickApprovable?: (row: EApprovalRequest) => boolean;
  onQuickApprove?: (row: EApprovalRequest) => Promise<void>;
}) {
  const [approvingId, setApprovingId] = useState<string | null>(null);

  if (!rows.length) {
    return <EApprovalEmptyState icon={Inbox} title={emptyTitle} description="Approvals assigned to you appear here." />;
  }
  return (
    <div className="divide-y">
      {rows.map((row) => {
        const quickApprovable = Boolean(onQuickApprove && isQuickApprovable?.(row));
        const approving = approvingId === row.id;
        return (
          // A plain row, not a <Link> — a Button nested inside an <a> is invalid HTML nesting (React
          // warns and can mis-hydrate), so the anchor covers only the content beside the button.
          <div key={row.id} className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/40">
            <Link href={`${E_APPROVAL_BASE_PATH}/${row.id}`} className="flex min-w-0 flex-1 items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[11px] text-muted-foreground">{row.referenceNo}</span>
                  {row.priority && row.priority !== 'Normal' && (
                    <StatusBadge status={row.priority} tone={eApprovalPriorityTone[row.priority]} />
                  )}
                  <EApprovalConfidentialBadge confidential={row.confidential} />
                  <EApprovalSourceBadge source={row.source} />
                </div>
                <p className="line-clamp-1 text-sm font-medium">{row.subject}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {row.requesterName}
                  {row.departmentName ? ` · ${row.departmentName}` : ''}
                  {row.currentStepName ? ` · ${row.currentStepName}` : ''}
                </p>
              </div>
              <div className="shrink-0 text-right">
                {row.amount != null && (
                  <p className="text-xs font-semibold tabular-nums">{formatEApprovalAmount(row.amount)}</p>
                )}
                <EApprovalDueBadge dueAt={row.currentDueAt} />
              </div>
            </Link>
            {quickApprovable && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 shrink-0 gap-1 border-emerald-200 bg-emerald-50 px-2 text-[11px] text-emerald-800 hover:bg-emerald-100"
                disabled={approving}
                onClick={async () => {
                  if (approvingId) return;
                  setApprovingId(row.id);
                  try {
                    await onQuickApprove?.(row);
                  } finally {
                    setApprovingId((current) => (current === row.id ? null : current));
                  }
                }}
              >
                {approving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                Approve
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

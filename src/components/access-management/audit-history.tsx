'use client';

/**
 * The access audit trail (§27) and bulk-operation history (§28).
 *
 * Every permission change goes through `grantAccess` / `revokeAccess`, and every one of those
 * writes a row here plus a batch record. The two views are on one screen because an investigation
 * moves between them constantly: a user complains, you find the audit row, the row names a batch,
 * and the batch tells you the other thirty-six people it touched.
 *
 * Access changes are *also* written to the existing `userLogs` collection, so they show up in
 * Settings › Audit Logs alongside everything else. This screen is the richer, access-specific view —
 * it carries the before/after permission pairs, which a generic activity log has nowhere to put.
 */

import * as React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  Download,
  History,
  Layers,
  Loader2,
  RefreshCw,
  Search,
  ShieldMinus,
  ShieldPlus,
  SlidersHorizontal,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { HrDataList, HrEmptyState, type HrListColumn } from '@/components/hr/hr-ui';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { exportRowsToExcel } from '@/lib/report-excel';
import { describeAuditEntry, formatGrantDate, type AccessAuditEntry, type AccessBatchRecord } from '@/lib/access-control';
import { listAccessAuditEntries, listAccessBatches } from '@/lib/access-control-service';
import type { AccessDirectoryState } from '@/hooks/useAccessDirectory';
import { AccessCard, PermissionPairList } from './access-ui';

export function AuditHistory({
  state,
  initialUserId,
}: {
  state: AccessDirectoryState;
  initialUserId?: string;
}) {
  const { toast } = useToast();
  const { directory } = state;

  const [entries, setEntries] = useState<AccessAuditEntry[]>([]);
  const [batches, setBatches] = useState<AccessBatchRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [term, setTerm] = useState('');
  const [targetUserId, setTargetUserId] = useState(initialUserId ?? 'all');
  const [changedBy, setChangedBy] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [expandedBatch, setExpandedBatch] = useState<string | null>(null);
  const [batchFilter, setBatchFilter] = useState<string | null>(null);
  /**
   * Controlled, because "Open changes" on a batch card filters the timeline — a filter applied to a
   * tab the user cannot see is indistinguishable from a button that does nothing.
   */
  const [view, setView] = useState<'timeline' | 'batches'>('timeline');
  /** Below `lg` the four non-search filters fold away; the button carries how many are in effect. */
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilterCount = [targetUserId !== 'all', changedBy !== 'all', !!from, !!to].filter(Boolean).length;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [auditRows, batchRows] = await Promise.all([
        listAccessAuditEntries({
          targetUserId: targetUserId === 'all' ? undefined : targetUserId,
          batchId: batchFilter ?? undefined,
          changedBy: changedBy === 'all' ? undefined : changedBy,
          from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
          to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
          limit: 400,
        }),
        listAccessBatches(100),
      ]);
      setEntries(auditRows);
      setBatches(batchRows);
    } catch (error) {
      toast({
        title: 'Could not load the audit trail',
        description: error instanceof Error ? error.message : 'Unexpected error.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [targetUserId, changedBy, from, to, batchFilter, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const query = term.trim().toLowerCase();
    if (!query) return entries;
    return entries.filter((entry) =>
      [entry.targetUserName, entry.changedByName, entry.action, entry.reason, ...entry.roleNames]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query),
    );
  }, [entries, term]);

  const handleExport = async () => {
    if (!visible.length) return;
    try {
      await exportRowsToExcel(
        'Access change report',
        visible.map((entry) => ({
          When: entry.changedAt,
          'Affected user': entry.targetUserName,
          Action: entry.action,
          Roles: entry.roleNames.join(', '),
          'Permissions added': entry.permissionsAdded.length,
          'Permissions removed': entry.permissionsRemoved.length,
          'Already had': entry.permissionsSkipped.length,
          Source: entry.sourceKind,
          'Changed by': entry.changedByName,
          Reason: entry.reason ?? '',
          Batch: entry.batchId ?? '',
        })),
        { filename: 'access-change-report.xlsx' },
      );
    } catch (error) {
      toast({
        title: 'Export failed',
        description: error instanceof Error ? error.message : 'Unexpected error.',
        variant: 'destructive',
      });
    }
  };

  const administrators = useMemo(() => {
    const seen = new Map<string, string>();
    for (const entry of entries) seen.set(entry.changedBy, entry.changedByName);
    return [...seen.entries()];
  }, [entries]);

  const rows = useMemo<TimelineRow[]>(
    () =>
      visible.map((entry, index) => ({
        id: entry.id ?? `${entry.targetUserId}-${entry.changedAt}-${index}`,
        entry,
      })),
    [visible],
  );

  /**
   * One column spec for the desktop table and the phone cards. Low-priority columns drop out as the
   * table narrows (batch, reason, then the two names) rather than forcing a sideways scroll; on a
   * phone the reason rides under the headline and the batch lives in the expanded detail.
   */
  const columns: Array<HrListColumn<TimelineRow>> = [
    {
      header: 'When',
      className: 'whitespace-nowrap',
      cell: ({ entry }) => (
        <span className="text-xs text-muted-foreground">
          {formatGrantDate(entry.changedAt)}{' '}
          {new Date(entry.changedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      ),
    },
    {
      header: 'Change',
      mobile: 'title',
      cell: ({ entry }) => {
        const isRemoval = entry.action === 'Revoke Access';
        return (
          <span className="flex items-start gap-2">
            <span
              className={cn(
                'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
                isRemoval ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700',
              )}
            >
              {isRemoval ? <ShieldMinus className="h-3.5 w-3.5" /> : <ShieldPlus className="h-3.5 w-3.5" />}
            </span>
            <span className="min-w-0">
              <span className="block font-medium text-slate-800 max-sm:line-clamp-2">{describeAuditEntry(entry)}</span>
              {entry.reason && (
                <span className="mt-0.5 block text-xs font-normal text-muted-foreground sm:hidden">“{entry.reason}”</span>
              )}
            </span>
          </span>
        );
      },
    },
    { header: 'Affected user', className: 'hidden lg:table-cell', cell: ({ entry }) => entry.targetUserName },
    { header: 'Changed by', className: 'hidden lg:table-cell', cell: ({ entry }) => entry.changedByName },
    {
      header: 'Source',
      className: 'hidden md:table-cell',
      cell: ({ entry }) => (
        <Badge variant="outline" className="text-[10px] text-slate-600">
          {entry.sourceKind}
        </Badge>
      ),
    },
    {
      header: 'Permissions',
      align: 'right',
      className: 'whitespace-nowrap',
      mobile: 'aside',
      cell: ({ entry }) => (
        <span className="inline-flex items-center gap-1">
          {entry.permissionsAdded.length > 0 && (
            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700">
              +{entry.permissionsAdded.length}
            </Badge>
          )}
          <Badge
            variant="outline"
            className={cn(
              'text-[10px]',
              entry.permissionsRemoved.length
                ? 'border-destructive/40 bg-destructive/10 text-destructive'
                : 'border-slate-200 bg-white text-slate-500',
            )}
          >
            −{entry.permissionsRemoved.length}
          </Badge>
        </span>
      ),
    },
    {
      header: 'Batch',
      className: 'hidden xl:table-cell',
      mobile: 'omit',
      cell: ({ entry }) => (entry.batchId ? <BatchBadge batchId={entry.batchId} onSelect={setBatchFilter} /> : '—'),
    },
    {
      header: 'Reason',
      className: 'hidden xl:table-cell',
      mobile: 'omit',
      cell: ({ entry }) => (
        <span className="line-clamp-2 text-xs text-muted-foreground">{entry.reason ? `“${entry.reason}”` : '—'}</span>
      ),
    },
    {
      header: '',
      className: 'w-8',
      mobile: 'aside',
      // Purely visual — the row itself toggles, so a second button here would fire both.
      cell: (row) => (
        <ChevronDown
          aria-hidden
          className={cn('h-4 w-4 text-slate-400 transition-transform', expanded === row.id && 'rotate-180')}
        />
      ),
    },
  ];

  /** "Open changes": the timeline, filtered to this batch. */
  const openBatchChanges = (batchId: string) => {
    setBatchFilter(batchId);
    setTargetUserId('all');
    setView('timeline');
  };

  const batchRows = useMemo<BatchRow[]>(() => batches.map((batch) => ({ id: batch.id, batch })), [batches]);

  const batchColumns: Array<HrListColumn<BatchRow>> = [
    {
      header: 'Operation',
      mobile: 'title',
      cell: ({ batch }) => <span className="font-medium text-slate-800">{batch.label}</span>,
    },
    {
      header: 'Batch',
      className: 'whitespace-nowrap',
      mobile: 'title',
      cell: ({ batch }) => (
        <Badge variant="outline" className="border-indigo-200 bg-indigo-50 font-mono text-[10px] text-indigo-700">
          {batch.id}
        </Badge>
      ),
    },
    {
      header: 'When',
      className: 'whitespace-nowrap',
      cell: ({ batch }) => (
        <span className="text-xs text-muted-foreground">
          {formatGrantDate(batch.performedAt)}{' '}
          {new Date(batch.performedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      ),
    },
    { header: 'By', className: 'hidden lg:table-cell', cell: ({ batch }) => batch.performedByName },
    { header: 'Users', align: 'right', cell: ({ batch }) => batch.userCount },
    {
      header: 'Updated',
      align: 'right',
      cell: ({ batch }) => <span className="font-medium text-emerald-700">{batch.successCount}</span>,
    },
    { header: 'Skipped', align: 'right', className: 'hidden lg:table-cell', cell: ({ batch }) => batch.skippedCount },
    {
      header: 'Failed',
      align: 'right',
      mobile: 'aside',
      cell: ({ batch }) =>
        batch.failedCount ? (
          <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-[10px] text-destructive">
            {batch.failedCount} failed
          </Badge>
        ) : (
          <span className="text-muted-foreground">0</span>
        ),
    },
    {
      header: 'Permissions',
      align: 'right',
      className: 'whitespace-nowrap',
      mobile: 'aside',
      cell: ({ batch }) => (
        <span className="inline-flex items-center gap-1">
          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700">
            +{batch.permissionsAdded}
          </Badge>
          <Badge
            variant="outline"
            className={cn(
              'text-[10px]',
              batch.permissionsRemoved
                ? 'border-destructive/40 bg-destructive/10 text-destructive'
                : 'border-slate-200 bg-white text-slate-500',
            )}
          >
            −{batch.permissionsRemoved}
          </Badge>
        </span>
      ),
    },
    {
      header: 'Reason',
      className: 'hidden xl:table-cell',
      mobile: 'omit',
      cell: ({ batch }) => (
        <span className="line-clamp-2 text-xs text-muted-foreground">{batch.reason ? `“${batch.reason}”` : '—'}</span>
      ),
    },
    {
      header: 'Actions',
      align: 'right',
      className: 'whitespace-nowrap',
      mobile: 'footer',
      cell: ({ batch }) => (
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={(event) => {
            event.stopPropagation();
            openBatchChanges(batch.id);
          }}
        >
          Open changes
        </Button>
      ),
    },
    {
      header: '',
      className: 'w-8',
      mobile: 'aside',
      // A real button here, unlike the timeline's: a card with a footer action is not itself
      // tappable, so on a phone this is the only way to open the detail.
      cell: (row) => (
        <button
          type="button"
          aria-label={expandedBatch === row.id ? 'Hide details' : 'Show details'}
          aria-expanded={expandedBatch === row.id}
          className="hr-inline-action inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100"
          onClick={(event) => {
            event.stopPropagation();
            setExpandedBatch((current) => (current === row.id ? null : row.id));
          }}
        >
          <ChevronDown className={cn('h-4 w-4 transition-transform', expandedBatch === row.id && 'rotate-180')} />
        </button>
      ),
    },
  ];

  return (
    <Tabs value={view} onValueChange={(value) => setView(value as 'timeline' | 'batches')} className="space-y-3">
      <TabsList className="grid h-auto w-full grid-cols-2 sm:h-10 sm:w-auto sm:grid-cols-2">
        <TabsTrigger value="timeline" className="text-xs">Change timeline</TabsTrigger>
        <TabsTrigger value="batches" className="text-xs">Bulk operations</TabsTrigger>
      </TabsList>

      <TabsContent value="timeline" className="space-y-3">
        <AccessCard>
          <CardContent className="p-3">
            {/* One row from `lg` up: the search stretches, the four filters sit beside it at compact
                widths (the wrapper is `display: contents` there, so they are items of this row).
                Below `lg` the four fold behind the "Filters" button, the same way the user picker's
                do — otherwise they were ~200px of controls between the tab strip and the first entry
                on a phone. */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[14rem] flex-1">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <Input
                  value={term}
                  onChange={(event) => setTerm(event.target.value)}
                  placeholder="Search user, admin, role or reason…"
                  className="pl-9"
                />
              </div>
              <Button
                type="button"
                variant={activeFilterCount > 0 ? 'default' : 'outline'}
                className="shrink-0 gap-1 lg:hidden"
                aria-expanded={filtersOpen}
                onClick={() => setFiltersOpen((flag) => !flag)}
              >
                <SlidersHorizontal className="h-4 w-4" />
                Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
              </Button>

              <div
                className={cn(
                  'grid w-full grid-cols-1 gap-2 sm:grid-cols-2 lg:contents',
                  !filtersOpen && 'hidden lg:contents',
                )}
              >
                <Select value={targetUserId} onValueChange={setTargetUserId}>
                  <SelectTrigger className="lg:w-52" aria-label="Affected user">
                    <SelectValue placeholder="Affected user" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72 max-w-[calc(100vw-2rem)]">
                    <SelectItem value="all">Any affected user</SelectItem>
                    {directory.users
                      .slice()
                      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
                      .map((user) => (
                        <SelectItem key={user.id} value={user.id}>{user.name || user.email}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <Select value={changedBy} onValueChange={setChangedBy}>
                  <SelectTrigger className="lg:w-48" aria-label="Changed by">
                    <SelectValue placeholder="Changed by" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any administrator</SelectItem>
                    {administrators.map(([id, name]) => (
                      <SelectItem key={id} value={id}>{name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="audit-from" className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    From
                  </Label>
                  <Input
                    id="audit-from"
                    type="date"
                    value={from}
                    onChange={(event) => setFrom(event.target.value)}
                    className="min-w-0 flex-1 lg:w-40 lg:flex-none"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="audit-to" className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    To
                  </Label>
                  <Input
                    id="audit-to"
                    type="date"
                    value={to}
                    onChange={(event) => setTo(event.target.value)}
                    className="min-w-0 flex-1 lg:w-40 lg:flex-none"
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </AccessCard>

        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{visible.length} change(s)</span>
            {batchFilter && (
              <Badge variant="outline" className="gap-1 border-indigo-200 bg-indigo-50 text-indigo-700">
                Batch {batchFilter}
                <button
                  type="button"
                  onClick={() => setBatchFilter(null)}
                  aria-label="Clear the batch filter"
                  className="hr-inline-action -my-1 inline-flex items-center justify-center rounded-full px-1 hover:bg-indigo-100"
                >
                  ×
                </button>
              </Badge>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={() => void handleExport()} disabled={!visible.length}>
              <Download className="mr-1.5 h-4 w-4" />
              Export
            </Button>
          </div>
        </div>

        {loading ? (
          <AccessCard>
            <CardContent className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading the audit trail…
            </CardContent>
          </AccessCard>
        ) : visible.length === 0 ? (
          <HrEmptyState
            icon={History}
            title="No access changes recorded yet"
            description="Every grant and removal made from this screen is logged here with who, what, when, why and the exact permissions involved."
          />
        ) : (
          <HrDataList
            rows={rows}
            columns={columns}
            onRowClick={(row) => setExpanded((current) => (current === row.id ? null : row.id))}
            expandedId={expanded}
            renderExpanded={(row) => <AuditEntryDetail entry={row.entry} onSelectBatch={setBatchFilter} />}
            maxHeightClassName="sm:max-h-[30rem]"
          />
        )}
      </TabsContent>

      <TabsContent value="batches" className="space-y-3">
        {batches.length === 0 ? (
          <HrEmptyState
            icon={Layers}
            title="No bulk operations yet"
            description="Every assignment — one user or a thousand — gets a batch identifier so it can be reviewed as one operation."
          />
        ) : (
          <HrDataList
            rows={batchRows}
            columns={batchColumns}
            onRowClick={(row) => setExpandedBatch((current) => (current === row.id ? null : row.id))}
            expandedId={expandedBatch}
            renderExpanded={(row) => <BatchDetail batch={row.batch} />}
            maxHeightClassName="sm:max-h-[30rem]"
            dense
          />
        )}
      </TabsContent>
    </Tabs>
  );
}

/** `HrDataList` keys rows by `id`; an audit entry may lack one, so the row carries a derived key. */
interface TimelineRow {
  id: string;
  entry: AccessAuditEntry;
}

interface BatchRow {
  id: string;
  batch: AccessBatchRecord;
}

/** What a batch row does not have room for: the reason in full, the roles, and any failures. */
function BatchDetail({ batch }: { batch: AccessBatchRecord }) {
  return (
    <div className="grid gap-3 p-3 max-sm:p-0 sm:grid-cols-3">
      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600">Reason</p>
        <p className="text-xs text-slate-700">{batch.reason ? `“${batch.reason}”` : '—'}</p>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Performed by {batch.performedByName} · {batch.skippedCount} skipped
        </p>
      </div>
      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
          Roles ({batch.roleNames.length})
        </p>
        {batch.roleNames.length ? (
          <div className="flex flex-wrap gap-1">
            {batch.roleNames.map((name) => (
              <Badge key={name} variant="outline" className="text-[10px] text-slate-600">
                {name}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">None — direct permissions, projects or scope only</p>
        )}
      </div>
      <div>
        <p
          className={cn(
            'mb-1 text-[11px] font-semibold uppercase tracking-wide',
            batch.failures?.length ? 'text-destructive' : 'text-slate-600',
          )}
        >
          Failed assignments ({batch.failures?.length ?? 0})
        </p>
        {batch.failures && batch.failures.length > 0 ? (
          <ul className="space-y-0.5 text-[11px] text-destructive">
            {batch.failures.map((failure) => (
              <li key={failure.userId}>
                <span className="font-medium">{failure.userName}</span> — {failure.message}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">None</p>
        )}
      </div>
    </div>
  );
}

/** The batch id, as the filter it applies — inside a clickable row, so it stops the click there. */
function BatchBadge({ batchId, onSelect }: { batchId: string; onSelect: (batchId: string) => void }) {
  return (
    <Badge
      variant="outline"
      className="cursor-pointer border-indigo-200 bg-indigo-50 font-mono text-[10px] text-indigo-700"
      onClick={(event) => {
        event.stopPropagation();
        onSelect(batchId);
      }}
    >
      {batchId}
    </Badge>
  );
}

/** What one change did, exactly: the permission pairs it added, removed and left alone. */
function AuditEntryDetail({
  entry,
  onSelectBatch,
}: {
  entry: AccessAuditEntry;
  onSelectBatch: (batchId: string) => void;
}) {
  const isRemoval = entry.action === 'Revoke Access';
  return (
    <div className="grid gap-3 p-3 max-sm:p-0 sm:grid-cols-3">
      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
          Added ({entry.permissionsAdded.length})
        </p>
        <PermissionPairList pairs={entry.permissionsAdded} emptyLabel="None" max={80} />
      </div>
      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-destructive">
          Removed ({entry.permissionsRemoved.length})
        </p>
        <PermissionPairList pairs={entry.permissionsRemoved} emptyLabel="None" max={80} />
      </div>
      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
          {isRemoval ? 'Retained by another source' : 'Already held'} ({entry.permissionsSkipped.length})
        </p>
        <PermissionPairList pairs={entry.permissionsSkipped} emptyLabel="None" max={80} />
        <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
          {entry.batchId && (
            <div className="flex flex-wrap items-center gap-1.5">
              Batch: <BatchBadge batchId={entry.batchId} onSelect={onSelectBatch} />
            </div>
          )}
          {entry.userAgent && <p className="line-clamp-2 break-all">Device: {entry.userAgent}</p>}
          {entry.ipAddress && <p>IP: {entry.ipAddress}</p>}
          {entry.approvalReference && <p>Approval ref: {entry.approvalReference}</p>}
        </div>
      </div>
    </div>
  );
}

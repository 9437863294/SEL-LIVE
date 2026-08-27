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
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { HrEmptyState } from '@/components/hr/hr-ui';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { exportRowsToExcel } from '@/lib/report-excel';
import { describeAuditEntry, formatGrantDate, type AccessAuditEntry, type AccessBatchRecord } from '@/lib/access-control';
import { listAccessAuditEntries, listAccessBatches } from '@/lib/access-control-service';
import type { AccessDirectoryState } from '@/hooks/useAccessDirectory';
import { AccessCard, PermissionPairList, StatLine } from './access-ui';

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
  const [batchFilter, setBatchFilter] = useState<string | null>(null);

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

  return (
    <Tabs defaultValue="timeline" className="space-y-3">
      <TabsList className="grid w-full grid-cols-2 sm:w-auto sm:grid-cols-2">
        <TabsTrigger value="timeline" className="text-xs">Change timeline</TabsTrigger>
        <TabsTrigger value="batches" className="text-xs">Bulk operations</TabsTrigger>
      </TabsList>

      <TabsContent value="timeline" className="space-y-3">
        <AccessCard>
          <CardContent className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="relative lg:col-span-2">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                placeholder="Search user, admin, role or reason…"
                className="pl-9"
              />
            </div>
            <Select value={targetUserId} onValueChange={setTargetUserId}>
              <SelectTrigger><SelectValue placeholder="Affected user" /></SelectTrigger>
              <SelectContent className="max-h-72">
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
              <SelectTrigger><SelectValue placeholder="Changed by" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any administrator</SelectItem>
                {administrators.map(([id, name]) => (
                  <SelectItem key={id} value={id}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">From</Label>
                <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">To</Label>
                <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
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
                <button type="button" onClick={() => setBatchFilter(null)} className="px-1">×</button>
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
          <AccessCard className="overflow-hidden">
            <ScrollArea className="h-[30rem]">
              <div className="divide-y divide-slate-100">
                {visible.map((entry, index) => {
                  const key = entry.id ?? `${entry.targetUserId}-${entry.changedAt}-${index}`;
                  const isOpen = expanded === key;
                  const isRemoval = entry.action === 'Revoke Access';
                  return (
                    <div key={key}>
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : key)}
                        className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left hover:bg-slate-50/70"
                      >
                        <span
                          className={cn(
                            'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
                            isRemoval ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700',
                          )}
                        >
                          {isRemoval ? <ShieldMinus className="h-3.5 w-3.5" /> : <ShieldPlus className="h-3.5 w-3.5" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-800">
                            {describeAuditEntry(entry)}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {formatGrantDate(entry.changedAt)}{' '}
                            {new Date(entry.changedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ·{' '}
                            {entry.changedByName}
                            {entry.reason ? ` · “${entry.reason}”` : ''}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            <Badge variant="outline" className="text-[10px] text-slate-600">{entry.sourceKind}</Badge>
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
                            {entry.batchId && (
                              <Badge
                                variant="outline"
                                className="cursor-pointer border-indigo-200 bg-indigo-50 text-[10px] text-indigo-700"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setBatchFilter(entry.batchId ?? null);
                                }}
                              >
                                {entry.batchId}
                              </Badge>
                            )}
                          </div>
                        </div>
                        <ChevronDown
                          className={cn('mt-1 h-4 w-4 shrink-0 text-slate-400 transition-transform', isOpen && 'rotate-180')}
                        />
                      </button>

                      {isOpen && (
                        <div className="grid gap-3 bg-slate-50/60 px-3 py-3 sm:grid-cols-3">
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
                              {isRemoval ? 'Retained by another source' : 'Already held'} (
                              {entry.permissionsSkipped.length})
                            </p>
                            <PermissionPairList pairs={entry.permissionsSkipped} emptyLabel="None" max={80} />
                            <div className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
                              {entry.userAgent && <p className="truncate">Device: {entry.userAgent}</p>}
                              {entry.ipAddress && <p>IP: {entry.ipAddress}</p>}
                              {entry.approvalReference && <p>Approval ref: {entry.approvalReference}</p>}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </AccessCard>
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
          <div className="space-y-2.5">
            {batches.map((batch) => (
              <AccessCard key={batch.id}>
                <CardContent className="space-y-2.5 p-3.5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className="border-indigo-200 bg-indigo-50 font-mono text-[10px] text-indigo-700">
                          {batch.id}
                        </Badge>
                        <span className="truncate text-sm font-semibold text-slate-800">{batch.label}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatGrantDate(batch.performedAt)}{' '}
                        {new Date(batch.performedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ·{' '}
                        {batch.performedByName}
                        {batch.reason ? ` · “${batch.reason}”` : ''}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setBatchFilter(batch.id);
                        setTargetUserId('all');
                      }}
                    >
                      Open changes
                    </Button>
                  </div>

                  {batch.roleNames.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {batch.roleNames.map((name) => (
                        <Badge key={name} variant="outline" className="text-[10px] text-slate-600">{name}</Badge>
                      ))}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                    <StatLine label="Users" value={batch.userCount} />
                    <StatLine label="Updated" value={batch.successCount} tone="emerald" />
                    <StatLine label="Skipped" value={batch.skippedCount} />
                    <StatLine label="Failed" value={batch.failedCount} tone={batch.failedCount ? 'rose' : 'slate'} />
                    <StatLine label="Permissions added" value={batch.permissionsAdded} tone="indigo" />
                    <StatLine
                      label="Permissions removed"
                      value={batch.permissionsRemoved}
                      tone={batch.permissionsRemoved ? 'rose' : 'emerald'}
                    />
                  </div>

                  {batch.failures && batch.failures.length > 0 && (
                    <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-2.5">
                      <p className="mb-1 text-xs font-semibold text-destructive">Failed assignments</p>
                      <ul className="space-y-0.5 text-[11px] text-destructive">
                        {batch.failures.map((failure) => (
                          <li key={failure.userId}>
                            <span className="font-medium">{failure.userName}</span> — {failure.message}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </AccessCard>
            ))}
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
}

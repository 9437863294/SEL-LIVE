'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  CheckCircle2,
  Clock,
  CornerDownLeft,
  FileSignature,
  History,
  MessageSquarePlus,
  Search,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  E_APPROVAL_ACTIVITY_GROUPS,
  E_APPROVAL_ACTION_LABELS,
  E_APPROVAL_BASE_PATH,
  eApprovalActivityGroupOf,
  summarizeEApprovalMyActivity,
  type EApprovalActivityGroup,
  type EApprovalHistoryEntry,
  type EApprovalSignatureRecord,
} from '@/lib/e-approval';
import { listEApprovalMyActivity, loadEApprovalSignature } from '@/lib/e-approval-service';
import { EApprovalEmptyState } from '@/components/e-approval/shared';
import { EApprovalSignaturePad } from '@/components/e-approval/signature-pad';
import { StatTile } from '@/components/e-approval/dashboard-parts';
import { PageHeader } from '@/components/e-approval/page-header';
import { formatEApprovalAmount, formatEApprovalDateTime, useEApprovalActor } from '@/components/e-approval/hooks';

/**
 * "My Activity" — everything one person has done, across every approval (the user's own request:
 * "a log of mine like what I have done — approved, reviewed — so I get to know later what I have
 * done").
 *
 * Reads `eApprovalHistory` filtered to `actorId === me` — the same append-only trail every detail
 * screen's Activity tab already shows for one file, just turned sideways to show one *person* across
 * every file instead. Nothing new is recorded for this: an approval, a verification, a return, a
 * rejection, a forward, a delegation, an escalation, a hold, a recall, a reverse were all already
 * being written; this is the first screen that reads them back that way.
 *
 * Deliberately excludes actions a delegate took on this person's own steps (`onBehalfOfUserId ===
 * me`, `actorId !== me`) — that is what the delegate did, not what this person did — and excludes the
 * cron's own `actorId: 'system'` escalation entries, which never match a real user.
 */

const GROUP_LABEL: Record<EApprovalActivityGroup | 'All', string> = {
  All: 'Everything',
  Approved: 'Approved',
  Verified: 'Verified',
  Clarified: 'Clarified',
  Returned: 'Returned',
  Rejected: 'Rejected',
  Routed: 'Forwarded / delegated / escalated',
  Other: 'Everything else',
};

const GROUP_TONE: Record<EApprovalActivityGroup, string> = {
  Approved: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  Verified: 'border-violet-200 bg-violet-50 text-violet-800',
  Clarified: 'border-amber-200 bg-amber-50 text-amber-900',
  Returned: 'border-orange-200 bg-orange-50 text-orange-800',
  Rejected: 'border-rose-200 bg-rose-50 text-rose-800',
  Routed: 'border-sky-200 bg-sky-50 text-sky-800',
  Other: 'border-slate-200 bg-slate-50 text-slate-600',
};

const GROUP_ICON: Record<EApprovalActivityGroup, typeof CheckCircle2> = {
  Approved: CheckCircle2,
  Verified: ShieldCheck,
  Clarified: MessageSquarePlus,
  Returned: CornerDownLeft,
  Rejected: XCircle,
  Routed: ArrowUpRight,
  Other: History,
};

/** The label on the row — the action's own label where one exists, else the raw event kind. */
const entryLabel = (entry: EApprovalHistoryEntry): string =>
  (E_APPROVAL_ACTION_LABELS as Record<string, string>)[entry.kind] ?? entry.kind;

const PERIODS = [
  { key: 'all', label: 'All time', days: null },
  { key: '7', label: 'Last 7 days', days: 7 },
  { key: '30', label: 'Last 30 days', days: 30 },
  { key: '90', label: 'Last 90 days', days: 90 },
] as const;

export default function EApprovalMyActivityPage() {
  const { serviceActor, isLoading: actorLoading } = useEApprovalActor();
  const [entries, setEntries] = useState<EApprovalHistoryEntry[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState<EApprovalActivityGroup | 'All'>('All');
  const [period, setPeriod] = useState<(typeof PERIODS)[number]['key']>('all');
  const [signature, setSignature] = useState<EApprovalSignatureRecord | null>(null);
  const [signatureLoading, setSignatureLoading] = useState(true);

  const load = useCallback(async () => {
    if (!serviceActor) return;
    setIsLoading(true);
    try {
      const result = await listEApprovalMyActivity(serviceActor.userId, serviceActor.organizationId);
      setEntries(result.entries);
      setTruncated(result.truncated);
    } catch (error) {
      console.error('[e-approval] Failed to load my activity', error);
    } finally {
      setIsLoading(false);
    }
  }, [serviceActor]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!serviceActor) return;
    setSignatureLoading(true);
    loadEApprovalSignature(serviceActor.userId)
      .then(setSignature)
      .catch((error) => console.error('[e-approval] Failed to load signature', error))
      .finally(() => setSignatureLoading(false));
  }, [serviceActor]);

  const summary = useMemo(() => summarizeEApprovalMyActivity(entries), [entries]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const periodDays = PERIODS.find((entry) => entry.key === period)?.days ?? null;
    const cutoff = periodDays != null ? Date.now() - periodDays * 86_400_000 : null;
    return entries.filter((entry) => {
      if (group !== 'All' && eApprovalActivityGroupOf(entry.kind) !== group) return false;
      if (cutoff != null) {
        const at = new Date(entry.at).getTime();
        if (Number.isNaN(at) || at < cutoff) return false;
      }
      if (!term) return true;
      return [entry.referenceNo, entry.subject, entry.summary, entry.stepName]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(term));
    });
  }, [entries, search, group, period]);

  const showSkeletons = (isLoading || actorLoading) && entries.length === 0;

  return (
    <div className="min-w-0 space-y-3">
      <PageHeader
        title="My Activity"
        description="Every action you have taken, across every approval — approved, verified, returned and everything else. This is your own record, drawn from the same trail nothing is ever removed from."
      />

      {/* ── Signature ──────────────────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="px-3 py-2.5 sm:px-4">
          <CardTitle className="flex items-center gap-1.5 text-sm">
            <FileSignature className="h-4 w-4" /> My Signature
          </CardTitle>
          <CardDescription className="text-xs">
            Set this up once here, and it is ready whenever you sign a PDF attachment on any approval —
            you will not be asked to draw it again.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-3 pb-3 sm:px-4">
          {signatureLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <EApprovalSignaturePad existing={signature} serviceActor={serviceActor} onSaved={setSignature} />
          )}
        </CardContent>
      </Card>

      {/* ── Summary ────────────────────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Total actions" value={summary.total} hint="in this log" isLoading={showSkeletons} />
        <StatTile label="This month" value={summary.thisMonth} isLoading={showSkeletons} />
        <StatTile label="Approved" value={summary.byGroup.Approved} isLoading={showSkeletons} />
        <StatTile label="Verified" value={summary.byGroup.Verified} isLoading={showSkeletons} />
        <StatTile label="Returned" value={summary.byGroup.Returned} isLoading={showSkeletons} />
        <StatTile label="Rejected" value={summary.byGroup.Rejected} isLoading={showSkeletons} />
      </div>

      {/* ── Filters ────────────────────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search reference, subject…"
            className="h-9 pl-7 text-xs"
          />
        </div>
        <Select value={group} onValueChange={(value) => setGroup(value as EApprovalActivityGroup | 'All')}>
          <SelectTrigger className="h-9 w-[200px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">{GROUP_LABEL.All}</SelectItem>
            {E_APPROVAL_ACTIVITY_GROUPS.map((option) => (
              <SelectItem key={option} value={option}>
                {GROUP_LABEL[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={period} onValueChange={(value) => setPeriod(value as typeof period)}>
          <SelectTrigger className="h-9 w-[150px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIODS.map((option) => (
              <SelectItem key={option.key} value={option.key}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="ml-auto text-xs text-muted-foreground">
          {filtered.length} of {entries.length}
        </span>
      </div>

      {truncated && !showSkeletons && (
        <p className="text-[11px] text-muted-foreground">
          Showing your {entries.length} most recent actions. Older ones are still on the record — this log just
          does not reach back that far yet.
        </p>
      )}

      {/* ── The log ────────────────────────────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="px-3 py-2 sm:px-4">
          {showSkeletons ? (
            <div className="space-y-2 py-2">
              {[0, 1, 2, 3].map((row) => (
                <Skeleton key={row} className="h-14 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <EApprovalEmptyState
              icon={History}
              title={entries.length === 0 ? 'Nothing here yet' : 'Nothing matches that filter'}
              description={
                entries.length === 0
                  ? 'Once you approve, verify, return or otherwise act on a note-sheet, it appears here.'
                  : 'Try a different search term, group or period.'
              }
            />
          ) : (
            <ol className="divide-y">
              {filtered.map((entry) => {
                const entryGroup = eApprovalActivityGroupOf(entry.kind);
                const Icon = GROUP_ICON[entryGroup];
                return (
                  <li key={entry.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2.5">
                    <span
                      className={cn(
                        'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border',
                        GROUP_TONE[entryGroup],
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className={cn('text-[10px] font-medium', GROUP_TONE[entryGroup])}>
                          {entryLabel(entry)}
                        </Badge>
                        {entry.stepName && (
                          <span className="text-[11px] text-muted-foreground">on “{entry.stepName}”</span>
                        )}
                      </div>
                      {entry.referenceNo || entry.subject ? (
                        <Link
                          href={`${E_APPROVAL_BASE_PATH}/${entry.approvalId}`}
                          className="mt-0.5 block truncate text-sm font-medium text-sky-800 hover:underline"
                        >
                          {entry.subject || 'Untitled'}
                          {entry.referenceNo && (
                            <span className="ml-1.5 font-mono text-[11px] font-normal text-muted-foreground">
                              {entry.referenceNo}
                            </span>
                          )}
                        </Link>
                      ) : (
                        <Link
                          href={`${E_APPROVAL_BASE_PATH}/${entry.approvalId}`}
                          className="mt-0.5 block text-xs text-sky-800 hover:underline"
                        >
                          View approval
                        </Link>
                      )}
                      <p className="mt-0.5 text-xs text-muted-foreground">{entry.summary}</p>
                      {entry.approvedAmount != null && (
                        <p className="mt-0.5 text-xs font-medium text-emerald-700">
                          Sanctioned {formatEApprovalAmount(entry.approvedAmount)}
                          {entry.requestedAmount != null && entry.requestedAmount !== entry.approvedAmount && (
                            <span className="font-normal text-muted-foreground">
                              {' '}
                              (requested {formatEApprovalAmount(entry.requestedAmount)})
                            </span>
                          )}
                        </p>
                      )}
                      {(entry.comment || entry.reason || entry.instruction) && (
                        <p className="mt-0.5 text-xs italic text-muted-foreground">
                          “{entry.comment || entry.reason || entry.instruction}”
                        </p>
                      )}
                      {entry.departmentName && (
                        <p className="mt-0.5 text-[11px] text-muted-foreground">{entry.departmentName}</p>
                      )}
                    </div>
                    <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                      <Clock className="h-3 w-3" /> {formatEApprovalDateTime(entry.at)}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

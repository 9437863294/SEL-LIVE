'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  BarChart3,
  FileClock,
  FilePlus2,
  FileStack,
  RadioTower,
  Search,
  Stamp,
  Users,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  eApprovalAgeingBucket,
  eApprovalAgenda,
  eApprovalCoverageNotices,
  eApprovalMomentum,
  eApprovalRowIsQuickApprovable,
  eApprovalWorkQueue,
  E_APPROVAL_BASE_PATH,
  isOpenEApprovalStatus,
  projectEApprovalBreaches,
  staleEApprovalDrafts,
  summarizeEApprovalHolders,
  type EApprovalRequest,
} from '@/lib/e-approval';
import { performEApprovalAction } from '@/lib/e-approval-service';
import { EApprovalActionList } from '@/components/e-approval/request-table';
import {
  ChartCard,
  compactRupees,
  eaTooltipStyle,
  EA_VIZ,
  EApprovalAgendaStrip,
  EApprovalBreachBanner,
  EApprovalCoverageBanner,
  HeroFigure,
  StatTile,
  TriageChip,
} from '@/components/e-approval/dashboard-parts';
import { useEApprovalPermissions, useEApprovalWorkload } from '@/components/e-approval/hooks';

const DAY = 86_400_000;
const AGEING_BUCKETS = ['0-1 day', '2-3 days', '4-7 days', '8-15 days', '15+ days'] as const;

/** The states an open file can be sitting in, as the register describes them. */
const OPEN_STATES: Array<{ key: string; label: string; match: (row: EApprovalRequest) => boolean }> = [
  { key: 'approval', label: 'With an approver', match: (row) => row.currentStepType === 'APPROVAL' },
  {
    key: 'verification',
    label: 'Under verification',
    match: (row) => row.currentStepType === 'VERIFICATION' || row.currentStepType === 'REVIEW',
  },
  { key: 'clarification', label: 'Awaiting clarification', match: (row) => row.currentStepType === 'CLARIFICATION' },
  { key: 'returned', label: 'Returned for correction', match: (row) => row.status === 'Returned' },
  { key: 'hold', label: 'On hold', match: (row) => row.status === 'On Hold' },
  { key: 'draft', label: 'Draft, not submitted', match: (row) => row.status === 'Draft' },
];

/** "Good morning" / "Good afternoon" / "Good evening", from local wall-clock time. */
function timeOfDayGreeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * The E-Approval dashboard (spec sections 14 and 32).
 *
 * Reading order is the point: who you are and what to do first, how urgent it is, whether the pace
 * is about to bite, the queue itself, a diary of what is due when, then the analysis. Everything
 * comes from one live subscription (`useEApprovalWorkload`) rather than a fetch-and-refresh, so a
 * file somebody else acts on moves out of the queue on its own — and every number on this page is a
 * view of the same `queue`, computed once by the pure `eApprovalWorkQueue` selector, so the hero
 * figure, the triage chips and the kind tiles can never disagree with each other.
 *
 * Chart choices follow `docs/e-approval.md` and the validated palette in `dashboard-parts.tsx`:
 * one hue for magnitude comparisons, the ordinal ramp only where the categories are genuinely
 * ordered (ageing bands), two validated categorical slots for the two-series trend, and a
 * table-view twin on every chart so no value is reachable only by hovering.
 */
export default function EApprovalDashboardPage() {
  const { toast } = useToast();
  const permissions = useEApprovalPermissions();
  const { rows, engineActor, serviceActor, isLoading, hasLoadedOnce, isRevalidating, lastUpdated, error } =
    useEApprovalWorkload();

  const now = useMemo(() => new Date(), [lastUpdated]);

  const queue = useMemo(() => (engineActor ? eApprovalWorkQueue(rows, engineActor, now) : null), [rows, engineActor, now]);
  const withMe = queue?.rows ?? [];

  const breaches = useMemo(() => projectEApprovalBreaches(withMe, now, [24]), [withMe, now]);
  const agenda = useMemo(() => eApprovalAgenda(withMe, now), [withMe, now]);
  const coverageNotices = useMemo(() => (engineActor ? eApprovalCoverageNotices(engineActor, now) : []), [engineActor, now]);
  const staleDrafts = useMemo(
    () => (serviceActor ? staleEApprovalDrafts(rows, serviceActor.userId, now) : []),
    [rows, serviceActor, now],
  );
  const momentum = useMemo(() => eApprovalMomentum(rows, now, 'month'), [rows, now]);

  /** Every open file I am involved in, by the state it is in. Nominal states → one hue. */
  const openStates = useMemo(() => {
    const open = rows.filter((row) => isOpenEApprovalStatus(row.status) || row.status === 'Draft');
    return OPEN_STATES.map((state) => ({
      state: state.label,
      count: open.filter(state.match).length,
    })).filter((entry) => entry.count > 0);
  }, [rows]);

  /** Ordered age bands → the ordinal ramp, so the reader sees the order in the colour. */
  const ageing = useMemo(() => {
    const tally = new Map<string, number>(AGEING_BUCKETS.map((bucket) => [bucket, 0]));
    rows
      .filter((row) => isOpenEApprovalStatus(row.status))
      .forEach((row) => {
        const bucket = eApprovalAgeingBucket(row.submittedAt);
        if (tally.has(bucket)) tally.set(bucket, (tally.get(bucket) ?? 0) + 1);
      });
    return AGEING_BUCKETS.map((bucket) => ({ bucket, count: tally.get(bucket) ?? 0 }));
  }, [rows]);

  const ageingPeak = useMemo(
    () => ageing.reduce((peak, entry) => (entry.count > peak.count ? entry : peak), ageing[0]),
    [ageing],
  );

  /** Six months of raised against approved. Two series, so a legend is present. */
  const trend = useMemo(() => {
    const months: Array<{ key: string; month: string; raised: number; approved: number }> = [];
    for (let offset = 5; offset >= 0; offset -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      months.push({
        key: `${date.getFullYear()}-${date.getMonth()}`,
        month: date.toLocaleDateString('en-IN', { month: 'short' }),
        raised: 0,
        approved: 0,
      });
    }
    const index = new Map(months.map((entry) => [entry.key, entry]));
    const keyOf = (value: string | null | undefined) => {
      if (!value) return null;
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : `${date.getFullYear()}-${date.getMonth()}`;
    };
    for (const row of rows) {
      const raisedKey = keyOf(row.submittedAt);
      if (raisedKey && index.has(raisedKey)) (index.get(raisedKey) as { raised: number }).raised += 1;
      if (row.status === 'Approved') {
        const closedKey = keyOf(row.completedAt);
        if (closedKey && index.has(closedKey)) (index.get(closedKey) as { approved: number }).approved += 1;
      }
    }
    return months;
  }, [rows, now]);

  const holders = useMemo(
    () => (serviceActor ? summarizeEApprovalHolders(rows, serviceActor.userId, now) : []),
    [rows, serviceActor, now],
  );

  const quickApprove = async (row: EApprovalRequest) => {
    if (!serviceActor) return;
    try {
      await performEApprovalAction(row.id, { kind: 'Approve' }, serviceActor);
      toast({ title: 'Approved', description: row.subject });
    } catch (actionError) {
      toast({
        variant: 'destructive',
        title: 'Could not approve',
        description: actionError instanceof Error ? actionError.message : 'Something went wrong.',
      });
    }
  };

  const showSkeletons = isLoading && !hasLoadedOnce;

  return (
    <div className={cn('min-w-0 space-y-3 transition-opacity', isRevalidating && 'opacity-95')}>
      {/* ── Header ─────────────────────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 px-3 py-2.5 sm:px-4 sm:py-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-1.5 text-base tracking-tight sm:text-lg">
              <Stamp className="h-4 w-4 text-sky-600" />
              {timeOfDayGreeting(now)}
              {serviceActor?.userName ? `, ${serviceActor.userName.split(' ')[0]}` : ''}
            </CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
              <span>Note-sheets, verification and approval across departments.</span>
              {!error ? (
                <span className="inline-flex items-center gap-1 text-emerald-600">
                  <RadioTower className="h-3 w-3" /> Live
                </span>
              ) : (
                <span className="text-rose-600">Live updates unavailable — showing the last load.</span>
              )}
            </CardDescription>
          </div>
          {permissions.canCreate && (
            <Button asChild size="sm" className="h-8 shrink-0 gap-1.5">
              <Link href={`${E_APPROVAL_BASE_PATH}/create`}>
                <FilePlus2 className="h-3.5 w-3.5" /> Create Approval
              </Link>
            </Button>
          )}
        </CardHeader>
      </Card>

      <EApprovalCoverageBanner notices={coverageNotices} />

      {/* ── Hero + SLA triage: what you owe, and how urgent it is ──────────────────────────── */}
      <Card className="border-sky-200 bg-gradient-to-r from-sky-50/80 via-background to-indigo-50/60">
        <CardContent className="grid gap-4 px-3 py-3 sm:px-4 lg:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
          <HeroFigure
            value={withMe.length}
            label="Awaiting your action"
            caption={
              withMe.length === 0
                ? 'Nothing is waiting on you.'
                : `${compactRupees(queue?.valuePending ?? 0)} of value pending your decision`
            }
            href={withMe.length > 0 ? `${E_APPROVAL_BASE_PATH}/inbox` : undefined}
            isLoading={showSkeletons}
            tone={(queue?.byUrgency.Overdue ?? 0) > 0 ? 'critical' : 'default'}
          />

          <div className="min-w-0 space-y-2">
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Against SLA
              </p>
              <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-4">
                <TriageChip
                  tone="critical"
                  label="Overdue"
                  count={queue?.byUrgency.Overdue ?? 0}
                  href={`${E_APPROVAL_BASE_PATH}/inbox`}
                  isLoading={showSkeletons}
                />
                <TriageChip
                  tone="warning"
                  label="Due within 24h"
                  count={queue?.byUrgency['Due Today'] ?? 0}
                  href={`${E_APPROVAL_BASE_PATH}/inbox`}
                  isLoading={showSkeletons}
                />
                <TriageChip
                  tone="good"
                  label="On track"
                  count={(queue?.byUrgency['Due Soon'] ?? 0) + (queue?.byUrgency['On Track'] ?? 0)}
                  isLoading={showSkeletons}
                />
                <TriageChip tone="good" label="No SLA set" count={queue?.byUrgency['No Clock'] ?? 0} isLoading={showSkeletons} />
              </div>
            </div>
            {!showSkeletons && (
              <EApprovalBreachBanner
                count={breaches[0]?.count ?? 0}
                value={breaches[0]?.value ?? 0}
                withinHours={24}
                href={`${E_APPROVAL_BASE_PATH}/inbox`}
              />
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── KPI row ────────────────────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <StatTile
          label="Approvals"
          value={queue?.byKind.Approval ?? 0}
          hint="pending your sign-off"
          href={`${E_APPROVAL_BASE_PATH}/inbox`}
          isLoading={showSkeletons}
        />
        <StatTile
          label="Verifications"
          value={queue?.byKind.Verification ?? 0}
          hint="sent to you to check"
          href={`${E_APPROVAL_BASE_PATH}/inbox`}
          isLoading={showSkeletons}
        />
        <StatTile
          label="Clarifications"
          value={queue?.byKind.Clarification ?? 0}
          hint="questions for you"
          href={`${E_APPROVAL_BASE_PATH}/inbox`}
          isLoading={showSkeletons}
        />
        <StatTile
          label="Returned to you"
          value={queue?.byKind.Correction ?? 0}
          hint="needs correcting"
          href={`${E_APPROVAL_BASE_PATH}/inbox`}
          isLoading={showSkeletons}
        />
        <StatTile
          label="Approved this month"
          value={momentum.current.approved}
          delta={{ value: momentum.current.approved - momentum.previous.approved, period: 'last month' }}
          upIsGood
          hint={
            momentum.current.medianCycleHours != null
              ? `median ${Math.round(momentum.current.medianCycleHours / 24)}d to close`
              : undefined
          }
          href={`${E_APPROVAL_BASE_PATH}/completed`}
          isLoading={showSkeletons}
        />
      </div>

      <EApprovalAgendaStrip groups={agenda} />

      {/* ── Queue ──────────────────────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 px-3 py-2.5 sm:px-4">
          <div>
            <CardTitle className="text-sm">Requires your action</CardTitle>
            <CardDescription className="text-xs">
              Soonest deadline first. Files marked Approve can be cleared right here.
            </CardDescription>
          </div>
          <Button asChild size="sm" variant="ghost" className="h-8 text-xs">
            <Link href={`${E_APPROVAL_BASE_PATH}/inbox`}>Open inbox</Link>
          </Button>
        </CardHeader>
        <CardContent className="px-0 pb-2">
          {showSkeletons ? (
            <div className="space-y-2 px-3">
              {[0, 1, 2].map((row) => (
                <Skeleton key={row} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <EApprovalActionList
              rows={withMe.slice(0, 8)}
              emptyTitle="Nothing needs your action"
              isQuickApprovable={(row) => (engineActor ? eApprovalRowIsQuickApprovable(row, engineActor) : false)}
              onQuickApprove={quickApprove}
            />
          )}
        </CardContent>
      </Card>

      {staleDrafts.length > 0 && !showSkeletons && (
        <Card className="border-amber-200 bg-amber-50/60">
          <CardContent className="flex flex-wrap items-center gap-2 px-3 py-2.5 sm:px-4">
            <FileClock className="h-4 w-4 shrink-0 text-amber-600" />
            <p className="min-w-0 flex-1 text-xs text-amber-900">
              <span className="font-semibold">
                {staleDrafts.length} draft{staleDrafts.length === 1 ? '' : 's'}
              </span>{' '}
              {staleDrafts.length === 1 ? 'has' : 'have'} been sitting unsubmitted for a few days.
            </p>
            <Button asChild size="sm" variant="outline" className="h-7 gap-1.5 border-amber-300 bg-white text-xs">
              <Link href={`${E_APPROVAL_BASE_PATH}/drafts`}>Review drafts</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Analysis ───────────────────────────────────────────────────────────────────────── */}
      <div className="grid min-w-0 gap-3 xl:grid-cols-2">
        <ChartCard
          title="Where your files are"
          description="Every open approval you are involved in, by the state it is sitting in."
          isLoading={showSkeletons}
          tableColumns={['State', 'Approvals']}
          tableRows={openStates.map((entry) => [entry.state, entry.count])}
          emptyMessage="No open approvals."
          chart={
            <ResponsiveContainer width="100%" height={Math.max(180, openStates.length * 42 + 30)}>
              <BarChart data={openStates} layout="vertical" margin={{ top: 4, right: 44, bottom: 4, left: 4 }}>
                <CartesianGrid horizontal={false} stroke={EA_VIZ.grid} />
                <XAxis type="number" allowDecimals={false} fontSize={11} stroke={EA_VIZ.axis} tickLine={false} />
                <YAxis
                  type="category"
                  dataKey="state"
                  width={152}
                  fontSize={11}
                  stroke={EA_VIZ.axis}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip cursor={{ fill: 'rgba(15,23,42,0.03)' }} {...eaTooltipStyle} />
                {/* Nominal states, so one hue for every bar — bar length already carries the value. */}
                <Bar isAnimationActive={false} dataKey="count" name="Approvals" fill={EA_VIZ.series[0]} radius={[0, 4, 4, 0]} maxBarSize={22}>
                  <LabelList dataKey="count" position="right" fontSize={11} fill="#52514e" />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          }
        />

        <ChartCard
          title="How long they have been open"
          description="Ageing of open approvals. Darker means older."
          isLoading={showSkeletons}
          tableColumns={['Age', 'Approvals']}
          tableRows={ageing.map((entry) => [entry.bucket, entry.count])}
          emptyMessage="No open approvals."
          chart={
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={ageing} margin={{ top: 16, right: 12, bottom: 4, left: 4 }}>
                <CartesianGrid vertical={false} stroke={EA_VIZ.grid} />
                <XAxis dataKey="bucket" fontSize={11} stroke={EA_VIZ.axis} tickLine={false} />
                <YAxis allowDecimals={false} fontSize={11} stroke={EA_VIZ.axis} tickLine={false} axisLine={false} />
                <Tooltip cursor={{ fill: 'rgba(15,23,42,0.03)' }} {...eaTooltipStyle} />
                {/* Ordered bands, so the ordinal ramp: the order is visible in the colour. */}
                <Bar isAnimationActive={false} dataKey="count" name="Approvals" radius={[4, 4, 0, 0]} maxBarSize={24}>
                  {ageing.map((entry, index) => (
                    <Cell key={entry.bucket} fill={EA_VIZ.ramp[index] ?? EA_VIZ.ramp[EA_VIZ.ramp.length - 1]} />
                  ))}
                  {/* Only the extreme is labelled; the axis and tooltip carry the rest. */}
                  <LabelList
                    dataKey="count"
                    position="top"
                    fontSize={11}
                    fill="#52514e"
                    formatter={(value: unknown) => (value === ageingPeak?.count && ageingPeak.count > 0 ? String(value) : '')}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          }
        />
      </div>

      <ChartCard
        title="Raised against approved"
        description="Six months of throughput on the approvals you are involved in."
        isLoading={showSkeletons}
        tableColumns={['Month', 'Raised', 'Approved']}
        tableRows={trend.map((entry) => [entry.month, entry.raised, entry.approved])}
        chart={
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={trend} margin={{ top: 12, right: 24, bottom: 4, left: 4 }}>
              <CartesianGrid vertical={false} stroke={EA_VIZ.grid} />
              <XAxis dataKey="month" fontSize={11} stroke={EA_VIZ.axis} tickLine={false} />
              <YAxis allowDecimals={false} fontSize={11} stroke={EA_VIZ.axis} tickLine={false} axisLine={false} />
              <Tooltip {...eaTooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11 }} iconType="plainline" />
              <Line
                isAnimationActive={false}
                type="monotone"
                dataKey="raised"
                name="Raised"
                stroke={EA_VIZ.series[0]}
                strokeWidth={2}
                strokeLinecap="round"
                dot={{ r: 4, fill: EA_VIZ.series[0], stroke: EA_VIZ.surface, strokeWidth: 2 }}
                activeDot={{ r: 5 }}
              />
              <Line
                isAnimationActive={false}
                type="monotone"
                dataKey="approved"
                name="Approved"
                stroke={EA_VIZ.series[1]}
                strokeWidth={2}
                strokeLinecap="round"
                dot={{ r: 4, fill: EA_VIZ.series[1], stroke: EA_VIZ.surface, strokeWidth: 2 }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        }
      />

      {/* ── Bottlenecks ────────────────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="px-3 py-2.5 sm:px-4">
          <CardTitle className="flex items-center gap-1.5 text-sm">
            <Users className="h-4 w-4" /> Who has the files you raised
          </CardTitle>
          <CardDescription className="text-xs">
            Where your own requests are sitting, oldest first — so chasing goes to the right desk.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-2 pb-3 sm:px-3">
          {showSkeletons ? (
            <Skeleton className="h-28 w-full" />
          ) : holders.length === 0 ? (
            <p className="px-3 py-10 text-center text-sm text-muted-foreground">
              None of your requests are open. {permissions.canCreate && 'Raise one from Create Approval.'}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead>Pending with</TableHead>
                    <TableHead className="text-right">Files</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead className="text-right">Oldest</TableHead>
                    <TableHead className="text-right">Overdue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {holders.slice(0, 8).map((entry) => (
                    <TableRow key={entry.holder}>
                      <TableCell className="text-xs font-medium">{entry.holder}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{entry.count}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{compactRupees(entry.value)}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {entry.oldestDays} {entry.oldestDays === 1 ? 'day' : 'days'}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {entry.overdue > 0 ? (
                          <span className="font-semibold text-rose-700">{entry.overdue}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Shortcuts ──────────────────────────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="flex flex-wrap gap-1.5 px-3 py-2.5 sm:px-4">
          {[
            { href: `${E_APPROVAL_BASE_PATH}/inbox`, label: 'My inbox', icon: Stamp },
            { href: `${E_APPROVAL_BASE_PATH}/created-by-me`, label: 'Created by me', icon: FilePlus2 },
            { href: `${E_APPROVAL_BASE_PATH}/drafts`, label: 'Drafts', icon: FileStack },
            { href: `${E_APPROVAL_BASE_PATH}/department`, label: 'Department queue', icon: Users, gate: permissions.canViewDepartment },
            { href: `${E_APPROVAL_BASE_PATH}/all`, label: 'All approvals', icon: Search, gate: permissions.canViewAll },
            { href: `${E_APPROVAL_BASE_PATH}/reports`, label: 'Reports', icon: BarChart3, gate: permissions.canViewReports },
          ]
            .filter((item) => item.gate !== false)
            .map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1.5 text-xs font-medium shadow-sm transition-transform hover:-translate-y-0.5"
              >
                <item.icon className="h-3.5 w-3.5 shrink-0 text-sky-600" />
                {item.label}
              </Link>
            ))}
        </CardContent>
      </Card>
    </div>
  );
}

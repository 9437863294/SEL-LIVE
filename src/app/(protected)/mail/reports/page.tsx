'use client';

/**
 * Shared-mailbox reports: how much mail was assigned, how much is open, how much is overdue, how
 * fast the team answers, and how the load is spread across people and departments.
 *
 * Counts and times only — no subject lines, no content — and only for shared mailboxes. Personal
 * mailboxes never feed anybody else's report.
 *
 * ── The workload bars ──────────────────────────────────────────────────────────────────────────
 *
 * Two parts per row: "open, on time" (categorical slot 1, blue) and "overdue" (the status-critical
 * red — overdue is a state, not a series). Validated as a pair in both modes (CVD ΔE ≥ 23, normal
 * ≥ 31, ≥ 3:1 on the surface). Colour is never the only carrier: a legend sits above, every row
 * shows both numbers in its own columns, and hovering the bar names them. The repo's
 * `--chart-1..5` tokens are dark-only, so the two colours are declared here, per mode.
 */

import { useMemo, useState } from 'react';
import { AlertTriangle, Clock, Inbox, Loader2, Timer } from 'lucide-react';

import { useLoader } from '@/components/mail-hub/hooks';
import { EmptyState, ErrorNotice, PageHeader } from '@/components/mail-hub/ui';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { mailApi } from '@/lib/mail-hub/client';

const VIZ_VARS = '[--mh-open:#2a78d6] [--mh-overdue:#d03b3b] dark:[--mh-open:#3987e5] dark:[--mh-overdue:#d03b3b]';

const isoDay = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

function Tile({ label, value, hint, icon }: { label: string; value: string; hint?: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-white p-3 dark:bg-slate-900">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon}{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900 dark:text-white">{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function WorkloadBar({ open, overdue, max }: { open: number; overdue: number; max: number }) {
  const onTime = Math.max(0, open - overdue);
  const width = (count: number) => `${max > 0 ? (count / max) * 100 : 0}%`;
  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* The whole cell is the hit target, not the thin bar inside it. */}
          <div className="flex h-7 w-full cursor-default items-center" aria-label={`${onTime} open on time, ${overdue} overdue`}>
            <div className="flex h-3 w-full items-center gap-[2px]">
              {onTime > 0 && <div className="h-full rounded-r-[4px] bg-[var(--mh-open)]" style={{ width: width(onTime) }} />}
              {overdue > 0 && <div className="h-full rounded-r-[4px] bg-[var(--mh-overdue)]" style={{ width: width(overdue) }} />}
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs"><span className="mr-1.5 inline-block h-2 w-2 rounded-sm bg-[var(--mh-open)]" />Open, on time: <b>{onTime}</b></p>
          <p className="text-xs"><span className="mr-1.5 inline-block h-2 w-2 rounded-sm bg-[var(--mh-overdue)]" />Overdue: <b>{overdue}</b></p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 dark:text-slate-300">
      <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[var(--mh-open)]" /> Open, on time</span>
      <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[var(--mh-overdue)]" /> Overdue</span>
    </div>
  );
}

const hours = (value: number | null) => (value == null ? '—' : value < 1 ? `${Math.round(value * 60)} min` : `${value} h`);

export default function MailReportsPage() {
  const [from, setFrom] = useState(isoDay(-30));
  const [to, setTo] = useState(isoDay(1));
  const [mailbox, setMailbox] = useState<string>('all');
  const { value: report, loading, error, reload } = useLoader(() => mailApi.reports({ from, to, sharedMailboxId: mailbox === 'all' ? null : mailbox }), [from, to, mailbox]);
  const maxAssignee = useMemo(() => Math.max(1, ...(report?.byAssignee ?? []).map((row) => row.open)), [report]);
  const maxDepartment = useMemo(() => Math.max(1, ...(report?.byDepartment ?? []).map((row) => row.open)), [report]);

  return (
    <div className={`space-y-4 ${VIZ_VARS}`}>
      <PageHeader title="Reports" description="Shared-mailbox workload. Counts and response times only — never message content." />

      {/* Filters in one row, above everything they affect. */}
      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1 text-xs text-muted-foreground">From<Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="h-9 bg-white" /></label>
        <label className="space-y-1 text-xs text-muted-foreground">To<Input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="h-9 bg-white" /></label>
        <div className="space-y-1 text-xs text-muted-foreground">
          Mailbox
          <Select value={mailbox} onValueChange={setMailbox}>
            <SelectTrigger className="h-9 w-[220px] bg-white"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All shared mailboxes</SelectItem>
              {(report?.mailboxes ?? []).map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {loading && <Loader2 className="mb-2.5 h-4 w-4 animate-spin text-slate-400" />}
      </div>

      {error && <ErrorNotice message={error} onRetry={reload} />}

      {report && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Assigned" value={String(report.assignedVolume)} hint={`${report.answered} answered`} icon={<Inbox className="h-3.5 w-3.5" />} />
            <Tile label="Open" value={String(report.openWork)} icon={<Clock className="h-3.5 w-3.5" />} />
            <Tile label="Overdue" value={String(report.overdue)} hint={report.overdue ? 'Past their reply deadline' : 'Nothing past its deadline'} icon={<AlertTriangle className="h-3.5 w-3.5 text-[#d03b3b]" />} />
            <Tile label="Median first response" value={hours(report.medianResponseHours)} hint={`Average ${hours(report.averageResponseHours)}`} icon={<Timer className="h-3.5 w-3.5" />} />
          </div>

          <section className="rounded-xl border bg-white p-3 dark:bg-slate-900">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Workload by person</h2>
              <Legend />
            </div>
            {report.byAssignee.length === 0 ? (
              <EmptyState title="No assigned conversations in this period" />
            ) : (
              <div className="overflow-x-auto">
                <Table className="min-w-[640px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Person</TableHead>
                      <TableHead className="w-[38%]">Open work</TableHead>
                      <TableHead className="text-right">Open</TableHead>
                      <TableHead className="text-right">Overdue</TableHead>
                      <TableHead className="text-right">Closed</TableHead>
                      <TableHead className="text-right">Median response</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.byAssignee.map((row) => (
                      <TableRow key={row.userId}>
                        <TableCell className="font-medium">{row.name}</TableCell>
                        <TableCell><WorkloadBar open={row.open} overdue={row.overdue} max={maxAssignee} /></TableCell>
                        <TableCell className="text-right tabular-nums">{row.open}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.overdue}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.closed}</TableCell>
                        <TableCell className="text-right tabular-nums">{hours(row.medianResponseHours)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>

          <div className="grid gap-4 xl:grid-cols-2">
            <section className="rounded-xl border bg-white p-3 dark:bg-slate-900">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">By department</h2>
                <Legend />
              </div>
              <div className="overflow-x-auto">
                <Table className="min-w-[440px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Department</TableHead>
                      <TableHead className="w-[40%]">Open work</TableHead>
                      <TableHead className="text-right">Assigned</TableHead>
                      <TableHead className="text-right">Open</TableHead>
                      <TableHead className="text-right">Overdue</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.byDepartment.map((row) => (
                      <TableRow key={row.department}>
                        <TableCell className="font-medium">{row.department}</TableCell>
                        <TableCell><WorkloadBar open={row.open} overdue={row.overdue} max={maxDepartment} /></TableCell>
                        <TableCell className="text-right tabular-nums">{row.assigned}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.open}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.overdue}</TableCell>
                      </TableRow>
                    ))}
                    {report.byDepartment.length === 0 && (
                      <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground">No data in this period.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </section>

            <section className="rounded-xl border bg-white p-3 dark:bg-slate-900">
              <h2 className="mb-2 text-sm font-semibold">By mailbox</h2>
              <div className="overflow-x-auto">
                <Table className="min-w-[440px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mailbox</TableHead>
                      <TableHead className="text-right">Assigned</TableHead>
                      <TableHead className="text-right">Open</TableHead>
                      <TableHead className="text-right">Overdue</TableHead>
                      <TableHead className="text-right">Median response</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.perMailbox.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>
                          <p className="font-medium">{row.name}</p>
                          <p className="text-xs text-muted-foreground">{row.address}</p>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{row.assigned}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.open}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.overdue}</TableCell>
                        <TableCell className="text-right tabular-nums">{hours(row.medianResponseHours)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          </div>

          <p className="text-xs text-muted-foreground">
            Follow-ups on shared mail in this period: {report.followUps.open} open, {report.followUps.overdue} overdue, {report.followUps.done} done.
          </p>
        </>
      )}
    </div>
  );
}

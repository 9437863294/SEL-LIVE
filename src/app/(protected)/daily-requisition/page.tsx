'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock,
  FileText,
  Inbox,
  RefreshCw,
  Search,
  ShieldAlert,
  Users,
  Wallet,
} from 'lucide-react';

import { useAuthorization } from '@/hooks/useAuthorization';
import { db } from '@/lib/firebase';
import { dailyPageContainerClass } from '@/components/daily-requisition/module-shell';
import { dailyRequisitionAccess, useDailyRequisitionWorkflowSteps } from '@/components/daily-requisition/nav';
import {
  AgeingChart,
  DashboardPanel,
  DepartmentDueChart,
  MonthlyFlowChart,
  PipelinePanel,
} from '@/components/daily-requisition/dashboard-charts';
import ViewDailyRequisitionDialog from '@/components/daily-requisition/ViewDailyRequisitionDialog';
import { PageHeader } from '@/components/shared/page-header';
import { FilterBar } from '@/components/shared/filter-bar';
import { KpiCard } from '@/components/shared/kpi-card';
import { StatusBadge } from '@/components/shared/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { dateKeyOf, formatDay, localDateKey, toJsDate } from '@/app/(protected)/daily-requisition/reports/_components/report-kit';
import { formatInr } from '@/lib/bank-balance-ledger';
import {
  DASHBOARD_PERIODS,
  NO_FILTERS,
  activeFilterCount,
  buildDashboard,
  describePeriod,
  filterRows,
  topWithOther,
  type DashboardFilters,
  type DashboardPeriod,
  type DashboardRow,
  type OpenStage,
  type PaidEvent,
} from '@/lib/daily-requisition-dashboard';
import { balanceOf, paidOf, requisitionProgress } from '@/lib/requisition-progress';
import type { DailyRequisitionEntry, Department, Project } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Stage names when the workflow has fewer than three steps configured. */
const FALLBACK_STAGE_NAMES: Record<OpenStage, string> = {
  receiving: 'Receiving at Finance',
  verification: 'GST & TDS Verification',
  payment: 'Processed for Payment',
};

const OTHER_DEPARTMENTS = '__other__';

/** "At least this much", on the larger of gross and net. */
const AMOUNT_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0, label: 'Any amount' },
  { value: 10_000, label: '₹10,000+' },
  { value: 50_000, label: '₹50,000+' },
  { value: 100_000, label: '₹1 lakh+' },
  { value: 500_000, label: '₹5 lakh+' },
  { value: 1_000_000, label: '₹10 lakh+' },
];

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`;

/** When money went out on a requisition: each voucher line on its instrument date, else the day it was marked paid. */
function paidEventsOf(entry: DailyRequisitionEntry, paid: number, receptionKey: string): PaidEvent[] {
  const payments = entry.payments ?? [];
  if (payments.length > 0) {
    return payments.map((payment) => ({ dateKey: dateKeyOf(payment.instrumentDate), amount: Number(payment.amount) || 0 }));
  }
  if (paid <= 0) return [];
  return [{ dateKey: dateKeyOf(entry.paidAt) || dateKeyOf(entry.lastPaidAt) || receptionKey, amount: paid }];
}

function toRow(entry: DailyRequisitionEntry): DashboardRow {
  const paid = paidOf(entry);
  const dateKey = dateKeyOf(entry.date);
  return {
    id: entry.id,
    receptionNo: entry.receptionNo || '',
    depNo: entry.depNo || '',
    partyName: entry.partyName || '',
    description: entry.description || '',
    departmentId: entry.departmentId || '',
    projectId: entry.projectId || '',
    status: entry.status || 'Pending',
    documentStatus: entry.documentStatus || 'Pending',
    gross: Number(entry.grossAmount) || 0,
    net: Number(entry.netAmount) || 0,
    paid,
    balance: balanceOf(entry),
    dateKey,
    createdMs: toJsDate(entry.createdAt)?.getTime() ?? 0,
    paidEvents: paidEventsOf(entry, paid, dateKey),
  };
}

export default function DailyRequisitionDashboardPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { steps, isLoading: stepsLoading } = useDailyRequisitionWorkflowSteps();
  const access = useMemo(() => dailyRequisitionAccess(can), [can]);

  // The dashboard shows every requisition's figures, so it opens for whoever may already see them
  // in bulk: the Entry Sheet, the Reports, or any stage queue.
  const canView =
    access.entrySheet || can('View', 'Daily Requisition.Reports') || steps.some((step) => access.stage(step.name));

  const [entries, setEntries] = useState<DailyRequisitionEntry[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [period, setPeriod] = useState<DashboardPeriod>('this-month');
  const [customRange, setCustomRange] = useState({ from: '', to: '' });
  const [filters, setFilters] = useState<DashboardFilters>(NO_FILTERS);
  const [selected, setSelected] = useState<DailyRequisitionEntry | null>(null);

  const setFilter = <K extends keyof DashboardFilters>(key: K, value: DashboardFilters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(false);
    try {
      const [requisitionSnap, projectSnap, departmentSnap] = await Promise.all([
        getDocs(collection(db, 'dailyRequisitions')),
        getDocs(collection(db, 'projects')),
        getDocs(collection(db, 'departments')),
      ]);
      setEntries(requisitionSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as DailyRequisitionEntry));
      setProjects(projectSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Project));
      setDepartments(departmentSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Department));
      setLoadedAt(new Date());
    } catch (error) {
      console.error('Could not load the Daily Requisition dashboard:', error);
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthLoading || stepsLoading || !canView) return;
    void load();
  }, [isAuthLoading, stepsLoading, canView, load]);

  const todayKey = localDateKey(new Date());
  const rows = useMemo(() => entries.map(toRow), [entries]);
  const filtered = useMemo(() => filterRows(rows, filters), [rows, filters]);
  const figures = useMemo(
    () => buildDashboard(filtered, { todayKey, period, custom: customRange }),
    [filtered, todayKey, period, customRange],
  );
  const filterCount = activeFilterCount(filters);
  const rangeLabel = describePeriod(figures.range);

  const stageNames: Record<OpenStage, string> = {
    receiving: steps[0]?.name || FALLBACK_STAGE_NAMES.receiving,
    verification: steps[1]?.name || FALLBACK_STAGE_NAMES.verification,
    payment: steps[2]?.name || FALLBACK_STAGE_NAMES.payment,
  };
  const departmentName = useMemo(() => {
    const names = new Map(departments.map((d) => [d.id, d.name]));
    return (key: string) => (key === OTHER_DEPARTMENTS ? 'Other departments' : names.get(key) || (key ? key : 'No department'));
  }, [departments]);

  const recent = useMemo(() => {
    const allowed = new Set(filtered.map((row) => row.id));
    return entries
      .filter((entry) => allowed.has(entry.id))
      .sort((a, b) => (toJsDate(b.createdAt)?.getTime() ?? 0) - (toJsDate(a.createdAt)?.getTime() ?? 0))
      .slice(0, 8);
  }, [entries, filtered]);
  const waitingParties = figures.byParty.filter((group) => group.balance > 0).slice(0, 8);

  /** Only the departments and projects that actually appear, so the lists stay short. */
  const departmentOptions = useMemo(() => {
    const ids = new Set(rows.map((row) => row.departmentId).filter(Boolean));
    return departments.filter((d) => ids.has(d.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, departments]);
  const projectOptions = useMemo(() => {
    const ids = new Set(rows.map((row) => row.projectId).filter(Boolean));
    return projects.filter((p) => ids.has(p.id)).sort((a, b) => (a.projectName || '').localeCompare(b.projectName || ''));
  }, [rows, projects]);
  const ageingOver30 = figures.ageing.filter((bucket) => bucket.minDays > 30).reduce((sum, bucket) => sum + bucket.count, 0);
  const documentTotal = Object.values(figures.documents).reduce((sum, n) => sum + n, 0);

  if (isAuthLoading || stepsLoading) return <DashboardSkeleton />;

  if (!canView) {
    return (
      <div className={dailyPageContainerClass}>
        <PageHeader eyebrow="Daily Requisition" title="Dashboard" />
        <Card className="mx-auto max-w-lg border-white/60 bg-white/80">
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
            <ShieldAlert className="h-8 w-8 text-slate-400" />
            <p className="font-medium text-slate-800">No dashboard for your role</p>
            <p className="text-sm text-muted-foreground">
              The dashboard summarises every requisition. Ask an administrator for access to the Entry Sheet, the Reports or a workflow stage.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={cn(dailyPageContainerClass, 'space-y-4')}>
      <PageHeader
        eyebrow="Daily Requisition"
        title="Dashboard"
        description="Where every requisition stands — what is waiting in each stage, what is still due, and how money is moving."
        meta={loadedAt ? <span className="text-xs text-muted-foreground">Updated {loadedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span> : undefined}
        actions={
          <Button variant="outline" size="icon" className="h-9 w-9 bg-white/80" onClick={() => void load()} disabled={isLoading} aria-label="Refresh">
            <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
          </Button>
        }
      />

      {/* Everything below reads only the requisitions these filters allow. */}
      <FilterBar
        className="rounded-xl border border-white/60 bg-white/70 p-2 shadow-sm backdrop-blur-sm"
        search={{
          value: filters.search,
          onChange: (value) => setFilter('search', value),
          placeholder: 'Reception No, DEP No, party or description',
          label: 'Search requisitions',
        }}
        activeCount={filterCount + (period === 'this-month' ? 0 : 1)}
        onClear={() => {
          setFilters(NO_FILTERS);
          setPeriod('this-month');
          setCustomRange({ from: '', to: '' });
        }}
        summary={
          <span>
            <span className="font-medium text-slate-700">{filtered.length.toLocaleString('en-IN')}</span>
            {filtered.length !== rows.length && <> of {rows.length.toLocaleString('en-IN')}</>} requisition
            {filtered.length === 1 ? '' : 's'} · <span className="whitespace-nowrap">{rangeLabel}</span>
          </span>
        }
      >
        <FilterSelect
          label="Period"
          value={period}
          onChange={(value) => setPeriod(value as DashboardPeriod)}
          className="w-[10.5rem]"
          options={DASHBOARD_PERIODS.map((option) => ({ value: option.value, label: option.label }))}
        />
        {period === 'custom' && (
          <div className="flex items-center gap-1.5">
            <Label htmlFor="dash-from" className="sr-only">
              From
            </Label>
            <Input
              id="dash-from"
              type="date"
              value={customRange.from}
              max={customRange.to || undefined}
              onChange={(event) => setCustomRange((range) => ({ ...range, from: event.target.value }))}
              className="h-9 w-[9.5rem] text-sm"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Label htmlFor="dash-to" className="sr-only">
              To
            </Label>
            <Input
              id="dash-to"
              type="date"
              value={customRange.to}
              min={customRange.from || undefined}
              onChange={(event) => setCustomRange((range) => ({ ...range, to: event.target.value }))}
              className="h-9 w-[9.5rem] text-sm"
            />
          </div>
        )}
        <FilterSelect
          label="Department"
          value={filters.departmentId}
          onChange={(value) => setFilter('departmentId', value)}
          className="w-[11rem]"
          options={[{ value: '', label: 'All departments' }, ...departmentOptions.map((d) => ({ value: d.id, label: d.name }))]}
        />
        <FilterSelect
          label="Project"
          value={filters.projectId}
          onChange={(value) => setFilter('projectId', value)}
          className="w-[11rem]"
          options={[{ value: '', label: 'All projects' }, ...projectOptions.map((p) => ({ value: p.id, label: p.projectName || p.id }))]}
        />
        <FilterSelect
          label="Documents"
          value={filters.documentStatus}
          onChange={(value) => setFilter('documentStatus', value)}
          className="w-[10rem]"
          options={[
            { value: '', label: 'Any documents' },
            { value: 'Uploaded', label: 'Uploaded' },
            { value: 'Pending', label: 'Pending' },
            { value: 'Missing', label: 'Missing' },
            { value: 'Not Required', label: 'Not required' },
          ]}
        />
        <FilterSelect
          label="Amount"
          value={String(filters.minAmount)}
          onChange={(value) => setFilter('minAmount', Number(value) || 0)}
          className="w-[10rem]"
          options={AMOUNT_OPTIONS.map((option) => ({ value: String(option.value), label: option.label }))}
        />
        <Button
          type="button"
          variant={filters.dueOnly ? 'default' : 'outline'}
          size="sm"
          className="h-9"
          aria-pressed={filters.dueOnly}
          onClick={() => setFilter('dueOnly', !filters.dueOnly)}
        >
          Still due only
        </Button>
      </FilterBar>

      {loadError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          The requisitions could not be loaded. Try Refresh.
        </div>
      )}

      {isLoading && entries.length === 0 ? (
        <DashboardSkeleton bare />
      ) : filtered.length === 0 && rows.length > 0 ? (
        <Card className="border-white/60 bg-white/80">
          <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
            <Search className="h-7 w-7 text-slate-300" />
            <p className="font-medium text-slate-800">No requisition matches these filters</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              {rows.length.toLocaleString('en-IN')} requisitions were loaded. Widen the filters, or clear them to start again.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-1"
              onClick={() => {
                setFilters(NO_FILTERS);
                setPeriod('this-month');
                setCustomRange({ from: '', to: '' });
              }}
            >
              Clear filters
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Headline figures */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Open requisitions"
              value={figures.open.count.toLocaleString('en-IN')}
              hint={`${formatInr(figures.open.balance)} still due`}
              icon={Inbox}
              tone="blue"
              accent
            />
            <KpiCard
              label="Received in period"
              value={formatInr(figures.received.net)}
              hint={`${plural(figures.received.count, 'requisition')} · gross ${formatInr(figures.received.gross)}`}
              icon={FileText}
              tone="indigo"
              accent
            />
            <KpiCard
              label="Paid out in period"
              value={formatInr(figures.paidOut.amount)}
              hint={`against ${plural(figures.paidOut.requisitions, 'requisition')}`}
              icon={CheckCircle2}
              tone="emerald"
              accent
            />
            <KpiCard
              label="Awaiting payment"
              value={formatInr(figures.stages[2].balance)}
              hint={`${plural(figures.stages[2].count, 'requisition')} in ${stageNames.payment}`}
              icon={Wallet}
              tone="amber"
              accent
            />
          </div>
          <p className="-mt-1 text-xs text-muted-foreground">
            “In period” covers {rangeLabel.toLowerCase() === 'all time' ? 'every date' : rangeLabel}. Open work is counted whatever its date.
          </p>

          <PipelinePanel stages={figures.stages} names={stageNames} />

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <MonthlyFlowChart points={figures.monthly} paidAhead={figures.paidAhead} className="xl:col-span-2" />
            <AgeingChart buckets={figures.ageing} />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <DepartmentDueChart groups={topWithOther(figures.byDepartment.filter((g) => g.balance > 0), 7, OTHER_DEPARTMENTS)} nameOf={departmentName} />

            <DashboardPanel title="Parties waiting longest for money" icon={Users} description="Largest amounts still due, by party." contentClassName="px-0 pb-2">
              {waitingParties.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nothing is due to any party.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="h-9 pl-4 text-xs">Party</TableHead>
                        <TableHead className="h-9 text-right text-xs">Requisitions</TableHead>
                        <TableHead className="h-9 text-right text-xs">Oldest</TableHead>
                        <TableHead className="h-9 pr-4 text-right text-xs">Still due</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {waitingParties.map((party) => (
                        <TableRow key={party.key}>
                          <TableCell className="max-w-[16rem] truncate py-2 pl-4 font-medium" title={party.key}>
                            {party.key}
                          </TableCell>
                          <TableCell className="py-2 text-right tabular-nums">{party.count}</TableCell>
                          <TableCell className={cn('py-2 text-right tabular-nums', (party.oldestDays ?? 0) > 30 && 'font-medium text-amber-700')}>
                            {party.oldestDays === null ? '—' : `${party.oldestDays} d`}
                          </TableCell>
                          <TableCell className="py-2 pr-4 text-right font-semibold tabular-nums">{formatInr(party.balance)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </DashboardPanel>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <DashboardPanel title="Documents" icon={FileText} description="Supporting documents on requisitions not cancelled.">
              <div className="space-y-2.5">
                {(
                  [
                    ['Uploaded', 'bg-emerald-500'],
                    ['Not Required', 'bg-slate-400'],
                    ['Pending', 'bg-amber-500'],
                    ['Missing', 'bg-red-500'],
                  ] as const
                ).map(([label, bar]) => {
                  const count = figures.documents[label];
                  const pct = documentTotal ? (count / documentTotal) * 100 : 0;
                  return (
                    <div key={label}>
                      <div className="flex items-baseline justify-between text-sm">
                        <span className="text-slate-700">{label}</span>
                        <span className="tabular-nums">
                          <span className="font-semibold text-slate-900">{count.toLocaleString('en-IN')}</span>
                          <span className="ml-1.5 text-xs text-muted-foreground">{pct.toFixed(0)}%</span>
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div className={cn('h-full rounded-full', bar)} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              {ageingOver30 > 0 && (
                <p className="mt-4 flex items-start gap-1.5 rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
                  <Clock className="mt-px h-3.5 w-3.5 shrink-0" />
                  {plural(ageingOver30, 'open requisition has', 'open requisitions have')} waited more than 30 days.
                </p>
              )}
            </DashboardPanel>

            <DashboardPanel
              title="Recently added"
              icon={BarChart3}
              description="The latest requisitions keyed in. Click one for its details."
              className="xl:col-span-2"
              contentClassName="px-0 pb-2"
            >
              {recent.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">No requisitions yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="h-9 pl-4 text-xs">Reception No</TableHead>
                        <TableHead className="h-9 text-xs">Date</TableHead>
                        <TableHead className="h-9 text-xs">Party</TableHead>
                        <TableHead className="h-9 text-xs">Status</TableHead>
                        <TableHead className="h-9 pr-4 text-right text-xs">Net</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recent.map((entry) => {
                        const progress = requisitionProgress(entry);
                        return (
                          <TableRow
                            key={entry.id}
                            className="cursor-pointer"
                            tabIndex={0}
                            onClick={() => setSelected(entry)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                setSelected(entry);
                              }
                            }}
                          >
                            <TableCell className="whitespace-nowrap py-2 pl-4 font-mono text-xs font-medium">{entry.receptionNo}</TableCell>
                            <TableCell className="whitespace-nowrap py-2 text-sm">{formatDay(entry.date)}</TableCell>
                            <TableCell className="max-w-[14rem] truncate py-2 text-sm" title={entry.partyName}>
                              {entry.partyName || '—'}
                            </TableCell>
                            <TableCell className="py-2">
                              <StatusBadge tone={progress.tone}>{progress.label}</StatusBadge>
                            </TableCell>
                            <TableCell className="whitespace-nowrap py-2 pr-4 text-right tabular-nums">{formatInr(entry.netAmount)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </DashboardPanel>
          </div>
        </>
      )}

      {selected && (
        <ViewDailyRequisitionDialog
          isOpen={!!selected}
          onOpenChange={(open) => {
            if (!open) setSelected(null);
          }}
          entry={selected}
          projects={projects}
          departments={departments}
          onActionComplete={() => void load()}
        />
      )}
    </div>
  );
}

/** One labelled filter control for the bar. The label shows above it from `sm` up. */
function FilterSelect({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  className?: string;
}) {
  // Radix Select cannot hold '' as an item value, so "any" travels as a sentinel.
  const ANY = '__any__';
  return (
    <Select value={value === '' ? ANY : value} onValueChange={(next) => onChange(next === ANY ? '' : next)}>
      <SelectTrigger className={cn('h-9 bg-white text-sm', className)} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value || ANY} value={option.value || ANY}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function DashboardSkeleton({ bare = false }: { bare?: boolean }) {
  const body = (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-40 rounded-xl" />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Skeleton className="h-80 rounded-xl xl:col-span-2" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    </div>
  );
  if (bare) return body;
  return (
    <div className={cn(dailyPageContainerClass, 'space-y-4')}>
      <Skeleton className="h-12 w-full max-w-md" />
      {body}
    </div>
  );
}

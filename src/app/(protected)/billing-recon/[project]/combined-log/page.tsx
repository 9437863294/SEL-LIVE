'use client';

/**
 * Combined Log — every JMC and MVAC entry of the project in one list, newest first, with what each
 * executed and certified (quantity × the line's rate). Opening an entry shows it in its own JMC /
 * MVAC dialog, with the BOQ quantities beside its lines.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Hourglass, HardHat, History, IndianRupee, Truck, View } from 'lucide-react';
import { useParams } from 'next/navigation';
import { collection, getDocs, query } from 'firebase/firestore';
import { format, getYear } from 'date-fns';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import type { BoqItem, JmcEntry, MvacEntry, Project } from '@/lib/types';
import { projectMatchesSlug } from '@/lib/project-slug';
import { billingReconRegister } from '@/lib/billing-recon/register';
import { entryIsVoid, formatAmount, formatAmountCompact, readEntryLine } from '@/lib/billing-recon/lines';
import { PageHeader } from '@/components/shared/page-header';
import { KpiCard } from '@/components/shared/kpi-card';
import { TableCard } from '@/components/shared/table-card';
import { FilterBar } from '@/components/shared/filter-bar';
import { DataList, type ListColumn } from '@/components/shared/data-list';
import { StatusBadge } from '@/components/shared/status-badge';
import { BrAccessDenied, BrNotice, BrPage, BrPageSkeleton, BR_TONE } from '@/components/billing-recon/page-kit';
import ViewJmcEntryDialog from '@/components/billing-recon/ViewJmcEntryDialog';
import ViewMvacEntryDialog from '@/components/billing-recon/ViewMvacEntryDialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/* ---------- helpers ---------- */

function toDateSafe(value: any): Date | null {
  if (!value) return null;
  if (typeof value?.toDate === 'function') return value.toDate();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') {
    const d = new Date(value);
    return isNaN(+d) ? null : d;
  }
  if (value?.seconds) return new Date(value.seconds * 1000);
  return null;
}

type CombinedLogEntry = (JmcEntry | MvacEntry) & {
  id: string;
  type: 'JMC' | 'MVAC';
  number: string;
  date: Date | null;
  sortTime: number;
  executedAmount: number;
  certifiedAmount: number;
};

const OPEN = new Set(['pending', 'in progress']);
const PAGE = 100;

const amountsOf = (items: unknown) => {
  let executed = 0;
  let certified = 0;
  for (const raw of Array.isArray(items) ? items : []) {
    const line = readEntryLine(raw);
    executed += line.executedQty * line.rate;
    certified += line.certifiedQty * line.rate;
  }
  return { executed, certified };
};

const MONTHS = Array.from({ length: 12 }, (_, i) => ({ label: format(new Date(2000, i, 1), 'MMMM'), value: i.toString() }));

export default function CombinedLogPage() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();
  const params = useParams();
  const projectSlug = params.project as string;

  const canView = can('View', 'Billing Recon.Combined Log');

  const [log, setLog] = useState<CombinedLogEntry[]>([]);
  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [projectName, setProjectName] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<'not-found' | 'failed' | null>(null);

  const [selectedJmc, setSelectedJmc] = useState<JmcEntry | null>(null);
  const [isJmcViewOpen, setIsJmcViewOpen] = useState(false);
  const [selectedMvac, setSelectedMvac] = useState<MvacEntry | null>(null);
  const [isMvacViewOpen, setIsMvacViewOpen] = useState(false);

  const [search, setSearch] = useState('');
  const [yearFilter, setYearFilter] = useState<string>('all');
  const [monthFilter, setMonthFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [shown, setShown] = useState(PAGE);

  const fetchLogs = useCallback(async () => {
    if (!projectSlug) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      // 1) Find project by slug
      const projectSnap = await getDocs(query(collection(db, 'projects')));
      const project = projectSnap.docs
        .map((d) => ({ id: d.id, ...d.data() } as Project))
        .find((p) => projectMatchesSlug(p.projectName, projectSlug));

      if (!project) {
        console.error('Project not found');
        setLog([]);
        setLoadError('not-found');
        return;
      }
      setProjectName(project.projectName);

      const projectId = project.id;
      const reg = billingReconRegister(project);

      // 2) JMC + MVAC entries, and the BOQ for the entry dialogs' BOQ quantity column. No
      // orderBy('createdAt'): Firestore leaves out every document without that field, which hid
      // older and copied entries; the list is sorted here instead.
      const [jmcSnapshot, mvacSnapshot, boqSnapshot] = await Promise.all([
        getDocs(collection(db, 'projects', projectId, reg.jmcEntries)),
        getDocs(collection(db, 'projects', projectId, reg.mvacEntries)),
        getDocs(collection(db, 'projects', projectId, reg.boqItems)),
      ]);

      const build = (type: 'JMC' | 'MVAC', id: string, data: JmcEntry | MvacEntry): CombinedLogEntry => {
        const { executed, certified } = amountsOf(data.items);
        const rawDate = type === 'JMC' ? (data as JmcEntry).jmcDate : (data as MvacEntry).mvacDate;
        const date = toDateSafe(rawDate);
        const created = toDateSafe((data as any).createdAt);
        return {
          ...data,
          id,
          type,
          number: String((type === 'JMC' ? (data as JmcEntry).jmcNo : (data as MvacEntry).mvacNo) ?? '').trim(),
          date,
          sortTime: (created ?? date ?? new Date(0)).getTime(),
          executedAmount: executed,
          certifiedAmount: certified,
        };
      };

      const combined = [
        ...jmcSnapshot.docs.map((d) => build('JMC', d.id, d.data() as JmcEntry)),
        ...mvacSnapshot.docs.map((d) => build('MVAC', d.id, d.data() as MvacEntry)),
      ].sort((a, b) => b.sortTime - a.sortTime);

      setLog(combined);
      setBoqItems(boqSnapshot.docs.map((d) => ({ id: d.id, ...d.data() } as BoqItem)));
    } catch (error) {
      console.error('Error fetching logs: ', error);
      setLoadError('failed');
      toast({ title: 'Error', description: 'Failed to fetch combined log for this project.', variant: 'destructive' });
      setLog([]);
    } finally {
      setIsLoading(false);
    }
  }, [projectSlug, toast]);

  useEffect(() => {
    if (!authLoading && canView) void fetchLogs();
  }, [fetchLogs, authLoading, canView]);

  /* ---------- filters ---------- */

  const statusOptions = useMemo(() => [...new Set(log.map((l) => String((l as any).status ?? '').trim()).filter(Boolean))].sort(), [log]);

  const filteredLog = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return log.filter((entry) => {
      // An entry without a readable date still shows while no period is chosen (it used to vanish).
      if (yearFilter !== 'all' || monthFilter !== 'all') {
        if (!entry.date) return false;
        if (yearFilter !== 'all' && getYear(entry.date).toString() !== yearFilter) return false;
        if (monthFilter !== 'all' && entry.date.getMonth().toString() !== monthFilter) return false;
      }
      if (typeFilter !== 'all' && entry.type !== typeFilter) return false;
      if (statusFilter !== 'all' && String((entry as any).status ?? '').trim() !== statusFilter) return false;
      if (!needle) return true;
      return [entry.number, (entry as any).woNo, (entry as any).stage].some((v) => String(v ?? '').toLowerCase().includes(needle));
    });
  }, [log, search, yearFilter, monthFilter, typeFilter, statusFilter]);

  const resetShown = () => setShown(PAGE);

  const figures = useMemo(() => {
    let jmc = 0;
    let mvac = 0;
    let open = 0;
    let certifiedValue = 0;
    let jmcOpen = 0;
    let mvacOpen = 0;
    for (const entry of filteredLog) {
      const status = String((entry as any).status ?? '').trim().toLowerCase();
      const isOpen = OPEN.has(status);
      if (entry.type === 'JMC') {
        jmc += 1;
        if (isOpen) jmcOpen += 1;
      } else {
        mvac += 1;
        if (isOpen) mvacOpen += 1;
      }
      if (isOpen) open += 1;
      if (!entryIsVoid(status)) certifiedValue += entry.certifiedAmount;
    }
    return { jmc, mvac, open, certifiedValue, jmcOpen, mvacOpen };
  }, [filteredLog]);

  const handleViewDetails = (entry: CombinedLogEntry) => {
    if (entry.type === 'JMC') {
      setSelectedJmc(entry as JmcEntry);
      setIsJmcViewOpen(true);
    } else {
      setSelectedMvac(entry as MvacEntry);
      setIsMvacViewOpen(true);
    }
  };

  const yearOptions = useMemo(() => {
    const years = new Set<number>();
    log.forEach((l) => {
      if (l.date) years.add(getYear(l.date));
    });
    return Array.from(years).sort((a, b) => b - a);
  }, [log]);

  const activeFilters = [yearFilter, monthFilter, typeFilter, statusFilter].filter((v) => v !== 'all').length;

  const columns: Array<ListColumn<CombinedLogEntry>> = [
    {
      header: 'Number',
      mobile: 'title',
      cell: (entry) => (
        <span className="flex min-w-0 items-center gap-2">
          <StatusBadge tone={entry.type === 'JMC' ? 'info' : 'progress'} className="shrink-0">
            {entry.type}
          </StatusBadge>
          <span className="truncate font-medium text-foreground">{entry.number || 'No number'}</span>
        </span>
      ),
    },
    {
      header: 'Date',
      cell: (entry) => <span className="whitespace-nowrap">{entry.date ? format(entry.date, 'dd MMM yyyy') : '—'}</span>,
    },
    { header: 'WO no', className: 'hidden lg:table-cell', cell: (entry) => <span className="whitespace-nowrap">{String((entry as any).woNo ?? '') || '—'}</span> },
    { header: 'Lines', align: 'right', cell: (entry) => (Array.isArray(entry.items) ? entry.items.length : 0) },
    {
      header: 'Executed',
      align: 'right',
      cell: (entry) => <span className="whitespace-nowrap tabular-nums">{formatAmount(entry.executedAmount)}</span>,
    },
    {
      header: 'Certified',
      align: 'right',
      cell: (entry) => <span className="whitespace-nowrap font-medium tabular-nums text-foreground">{formatAmount(entry.certifiedAmount)}</span>,
    },
    { header: 'Stage', className: 'hidden md:table-cell', cell: (entry) => <span className="text-muted-foreground">{String((entry as any).stage ?? '') || '—'}</span> },
    { header: 'Status', mobile: 'aside', cell: (entry) => <StatusBadge status={String((entry as any).status ?? '') || 'Unknown'} /> },
    {
      header: '',
      align: 'right',
      mobile: 'omit',
      cell: (entry) => (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label={`Open ${entry.type} ${entry.number}`}
          title="Open"
          onClick={(e) => {
            e.stopPropagation();
            handleViewDetails(entry);
          }}
        >
          <View className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  /* ---------- render ---------- */

  if (authLoading) return <BrPageSkeleton kpis={4} />;
  if (!canView) return <BrAccessDenied message="You need Billing Recon › Combined Log › View to open this log." />;

  const loadingFirst = isLoading && log.length === 0;
  const dash = '—';
  const visibleRows = filteredLog.slice(0, shown);

  return (
    <>
      <BrPage tone={BR_TONE.log}>
        <PageHeader
          title="Combined JMC & MVAC Log"
          description="Every JMC and MVAC entry of the project, newest first. Open one for its lines, approvals and print."
          icon={History}
          backHref={`/billing-recon/${projectSlug}`}
          backLabel="Back to project"
          meta={projectName ? [{ label: 'Project', value: projectName }] : undefined}
        />

        {loadError === 'not-found' && (
          <BrNotice tone="danger" icon={AlertTriangle} title="Project not found">
            This link does not match any project. It may have been renamed or removed.
          </BrNotice>
        )}
        {loadError === 'failed' && (
          <BrNotice
            tone="danger"
            icon={AlertTriangle}
            title="Could not load the log"
            action={
              <Button type="button" size="sm" variant="outline" onClick={() => void fetchLogs()}>
                Try again
              </Button>
            }
          >
            Check your connection and try again.
          </BrNotice>
        )}

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <KpiCard
            label="JMC entries"
            value={loadingFirst ? dash : figures.jmc.toLocaleString('en-IN')}
            hint={loadingFirst ? undefined : `${figures.jmcOpen} open`}
            icon={HardHat}
            tone="orange"
            accent
          />
          <KpiCard
            label="MVAC entries"
            value={loadingFirst ? dash : figures.mvac.toLocaleString('en-IN')}
            hint={loadingFirst ? undefined : `${figures.mvacOpen} open`}
            icon={Truck}
            tone="amber"
            accent
          />
          <KpiCard
            label="Open"
            value={loadingFirst ? dash : figures.open.toLocaleString('en-IN')}
            hint="Pending or in progress"
            icon={Hourglass}
            tone={figures.open ? 'blue' : 'emerald'}
            accent
          />
          <KpiCard
            label="Certified value"
            value={loadingFirst ? dash : formatAmountCompact(figures.certifiedValue)}
            hint={loadingFirst ? undefined : formatAmount(figures.certifiedValue)}
            icon={figures.certifiedValue ? IndianRupee : CheckCircle2}
            tone="emerald"
            accent
            info="Certified quantity × the line's rate, on entries that are not rejected or cancelled."
          />
        </div>

        <TableCard
          title="JMC & MVAC entries"
          icon={History}
          count={loadingFirst ? undefined : filteredLog.length}
          total={log.length}
          noun="entry"
          scroll="natural"
          toolbar={
            <FilterBar
              search={{
                value: search,
                onChange: (v) => {
                  setSearch(v);
                  resetShown();
                },
                placeholder: 'Number, WO no or stage',
              }}
              activeCount={activeFilters}
              onClear={() => {
                setSearch('');
                setYearFilter('all');
                setMonthFilter('all');
                setTypeFilter('all');
                setStatusFilter('all');
                resetShown();
              }}
            >
              <Select
                value={typeFilter}
                onValueChange={(v) => {
                  setTypeFilter(v);
                  resetShown();
                }}
              >
                <SelectTrigger aria-label="Type">
                  <SelectValue placeholder="JMC and MVAC" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">JMC and MVAC</SelectItem>
                  <SelectItem value="JMC">JMC only</SelectItem>
                  <SelectItem value="MVAC">MVAC only</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={yearFilter}
                onValueChange={(v) => {
                  setYearFilter(v);
                  resetShown();
                }}
              >
                <SelectTrigger aria-label="Year">
                  <SelectValue placeholder="Every year" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Every year</SelectItem>
                  {yearOptions.map((year) => (
                    <SelectItem key={year} value={String(year)}>
                      {year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={monthFilter}
                onValueChange={(v) => {
                  setMonthFilter(v);
                  resetShown();
                }}
              >
                <SelectTrigger aria-label="Month">
                  <SelectValue placeholder="Every month" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Every month</SelectItem>
                  {MONTHS.map((month) => (
                    <SelectItem key={month.value} value={month.value}>
                      {month.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {statusOptions.length > 0 && (
                <Select
                  value={statusFilter}
                  onValueChange={(v) => {
                    setStatusFilter(v);
                    resetShown();
                  }}
                >
                  <SelectTrigger aria-label="Status" className="text-left">
                    <span className="truncate">
                      <SelectValue placeholder="Every status" />
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Every status</SelectItem>
                    {statusOptions.map((status) => (
                      <SelectItem key={status} value={status}>
                        {status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FilterBar>
          }
          footer={
            filteredLog.length > shown ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  Showing {visibleRows.length.toLocaleString('en-IN')} of {filteredLog.length.toLocaleString('en-IN')}
                </span>
                <Button type="button" variant="outline" size="sm" onClick={() => setShown((n) => n + PAGE)}>
                  Show {Math.min(PAGE, filteredLog.length - shown)} more
                </Button>
              </div>
            ) : undefined
          }
        >
          <div className="p-3 sm:p-4">
            {loadingFirst ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : (
              <DataList
                rows={visibleRows}
                columns={columns}
                onRowClick={handleViewDetails}
                rowClassName={(entry) => (entryIsVoid((entry as any).status) ? 'opacity-70' : undefined)}
                dense
                empty={
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    {log.length === 0 ? 'No JMC or MVAC entries yet for this project.' : 'No entries match these filters.'}
                  </p>
                }
              />
            )}
          </div>
        </TableCard>
      </BrPage>

      {/* Detail dialogs (they handle print themselves) — one each for the page, outside the list. */}
      <ViewJmcEntryDialog isOpen={isJmcViewOpen} onOpenChange={setIsJmcViewOpen} jmcEntry={selectedJmc} boqItems={boqItems} />

      <ViewMvacEntryDialog isOpen={isMvacViewOpen} onOpenChange={setIsMvacViewOpen} MvacEntry={selectedMvac} boqItems={boqItems} />
    </>
  );
}

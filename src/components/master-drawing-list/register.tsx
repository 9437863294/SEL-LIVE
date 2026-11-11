'use client';

/**
 * Drawing Register (`/master-drawing-list/register`): one project's drawing list under schedule ›
 * scope › group headings, with a status summary whose counts filter the table, schedule / scope /
 * status filters, a search over description, drawing number and group, and an Excel export of the
 * view on screen. Filters live in the URL, so Back from an item returns to the same view.
 *
 * Desktop: one table with full-width heading rows. Phone: the same headings over `DataList` cards.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { CircleCheck, CirclePause, Download, FileStack, ListTree, MessageSquare, PackageX, Plus, Send, type LucideIcon } from 'lucide-react';

import { DataList, CellLink, type ListColumn } from '@/components/shared/data-list';
import { FilterBar } from '@/components/shared/filter-bar';
import { KpiCard, KpiGrid, type Tone } from '@/components/shared/kpi-card';
import { PageHeader } from '@/components/shared/page-header';
import { TableCard } from '@/components/shared/table-card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { exportWorkbook } from '@/lib/report-excel';
import {
  countByStatus,
  exportFileName,
  filterItems,
  filterWithoutStatus,
  groupForRegister,
  isSchedule,
  isScope,
  isStatus,
  registerSheet,
  type RegisterFilters,
} from '@/lib/master-drawing-list/register';
import { SCHEDULES, SCOPES, STATUS_LABEL, type MdlItem, type MdlStatus } from '@/lib/master-drawing-list/types';
import { cn } from '@/lib/utils';

import { useDebounced, useMdl, useMdlQuery, useRegisterParams, type MdlProjectView } from './mdl-client';
import { DateText, DaysText, MdlEmpty, MdlError, MdlLoading, MdlStatusBadge, NoDrawingList, ProjectSelect, RevisionTrack, STATUS_ORDER } from './mdl-ui';
import { MDL_BASE } from './module-layout-shell';

interface RegisterData {
  project: MdlProjectView;
  items: MdlItem[];
  today: string;
}

const SUMMARY: Record<MdlStatus, { tone: Tone; icon: LucideIcon; hint: string }> = {
  approved: { tone: 'emerald', icon: CircleCheck, hint: 'Closed' },
  under_review: { tone: 'blue', icon: Send, hint: 'With client' },
  comments_received: { tone: 'amber', icon: MessageSquare, hint: 'With SEL' },
  not_submitted: { tone: 'slate', icon: FileStack, hint: 'With SEL' },
  vendor_not_finalised: { tone: 'rose', icon: PackageX, hint: 'With procurement' },
  on_hold: { tone: 'violet', icon: CirclePause, hint: 'Parked' },
};

const COLUMN_COUNT = 7;

export const itemHref = (id: string) => `${MDL_BASE}/register/${encodeURIComponent(id)}`;

export default function Register() {
  const { lookups, can } = useMdl();
  const params = useRegisterParams();
  const router = useRouter();
  const pathname = usePathname() ?? `${MDL_BASE}/register`;
  const { toast } = useToast();
  const query = useMdlQuery<RegisterData>(params.project ? `items?project=${encodeURIComponent(params.project)}` : null);

  // The search box types into local state; the URL follows once typing pauses.
  const [search, setSearch] = useState(params.q);
  const settledSearch = useDebounced(search);
  const { q: urlSearch, set } = params;
  useEffect(() => {
    if (settledSearch !== urlSearch) set({ q: settledSearch.trim() || null });
  }, [settledSearch, urlSearch, set]);

  const filters: RegisterFilters = {
    schedule: isSchedule(params.schedule) ? params.schedule : null,
    scope: isScope(params.scope) ? params.scope : null,
    status: isStatus(params.status) ? params.status : null,
    q: settledSearch,
  };
  const items = useMemo(() => query.data?.items ?? [], [query.data]);
  const today = query.data?.today ?? lookups?.today ?? '';
  const project = query.data?.project ?? lookups?.projects.find((entry) => entry.code === params.project) ?? null;
  const counts = countByStatus(filterWithoutStatus(items, filters));
  const shown = filterItems(items, filters);
  const sections = groupForRegister(shown);
  const activeCount = [filters.schedule, filters.scope, filters.status].filter(Boolean).length;

  const statusHref = (status: MdlStatus | null) => {
    const next = new URLSearchParams(params.search);
    if (status && status !== filters.status) next.set('status', status);
    else next.delete('status');
    const text = next.toString();
    return text ? `${pathname}?${text}` : pathname;
  };

  const exportView = async () => {
    if (!project) return;
    try {
      await exportWorkbook(exportFileName(project, today), [registerSheet(shown, project, today)]);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Export failed', description: error instanceof Error ? error.message : 'The workbook could not be built.' });
    }
  };

  if (!lookups) return <MdlLoading />;
  if (!lookups.projects.length) {
    return (
      <>
        <PageHeader icon={ListTree} title="Drawing Register" />
        <NoDrawingList />
      </>
    );
  }

  const columns: ListColumn<MdlItem>[] = [
    { header: 'Description', mobile: 'title', cell: (item) => <span className="line-clamp-3">{item.description}</span> },
    { header: 'Status', mobile: 'aside', cell: (item) => <MdlStatusBadge status={item.status} /> },
    { header: 'Sl. No.', cell: (item) => item.slNo || '—' },
    { header: 'Drawing No.', cell: (item) => item.drgNo || '—' },
    { header: 'Revisions', cell: (item) => <RevisionTrack item={item} /> },
    { header: 'Approved on', cell: (item) => <DateText value={item.approvedOn} /> },
    { header: 'Days', align: 'right', cell: (item) => <DaysText item={item} today={today} /> },
  ];

  return (
    <>
      <PageHeader
        icon={ListTree}
        title="Drawing Register"
        description={project ? [project.displayName, project.displayClient].filter(Boolean).join(' · ') : 'Every drawing and document submitted to the client for approval.'}
        actions={
          <>
            <ProjectSelect projects={lookups.projects} value={params.project} onChange={(code) => set({ project: code, status: null })} className="sm:w-56" />
            {can('Drawings', 'Export') && (
              <Button variant="outline" onClick={() => void exportView()} disabled={!shown.length}>
                <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                Export
              </Button>
            )}
            {can('Drawings', 'Add') && (
              <Button asChild>
                <Link href={`${MDL_BASE}/new${params.project ? `?project=${encodeURIComponent(params.project)}` : ''}`}>
                  <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                  Add item
                </Link>
              </Button>
            )}
          </>
        }
      />

      <MdlError message={query.error} onRetry={query.reload} />

      <KpiGrid>
        {STATUS_ORDER.map((status) => (
          <KpiCard
            key={status}
            label={STATUS_LABEL[status]}
            value={query.loading && !query.data ? '…' : counts[status].toLocaleString('en-IN')}
            hint={SUMMARY[status].hint}
            icon={SUMMARY[status].icon}
            tone={SUMMARY[status].tone}
            href={statusHref(status)}
            accent={filters.status === status}
            className={cn(filters.status === status && 'ring-2 ring-primary/60')}
          />
        ))}
      </KpiGrid>

      <TableCard
        title={filters.status ? STATUS_LABEL[filters.status] : 'All drawings'}
        count={shown.length}
        total={items.length}
        noun="item"
        toolbar={
          <FilterBar
            search={{ value: search, onChange: setSearch, placeholder: 'Search description, drawing no., group…' }}
            activeCount={activeCount}
            onClear={() => {
              setSearch('');
              set({ schedule: null, scope: null, status: null, q: null });
            }}
          >
            <Select value={filters.schedule ?? 'all'} onValueChange={(value) => set({ schedule: value === 'all' ? null : value })}>
              <SelectTrigger aria-label="Schedule" className="text-left">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All schedules</SelectItem>
                {SCHEDULES.map((schedule) => (
                  <SelectItem key={schedule} value={schedule}>
                    {schedule}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.scope ?? 'all'} onValueChange={(value) => set({ scope: value === 'all' ? null : value })}>
              <SelectTrigger aria-label="Scope" className="text-left">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All scopes</SelectItem>
                {SCOPES.map((scope) => (
                  <SelectItem key={scope} value={scope}>
                    {scope}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.status ?? 'all'} onValueChange={(value) => set({ status: value === 'all' ? null : value })}>
              <SelectTrigger aria-label="Status" className="text-left">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {STATUS_ORDER.map((status) => (
                  <SelectItem key={status} value={status}>
                    {STATUS_LABEL[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterBar>
        }
      >
        {query.loading && !query.data ? (
          <MdlLoading />
        ) : !shown.length ? (
          <MdlEmpty
            title={items.length ? 'No item matches these filters' : 'This drawing list has no items yet'}
            description={items.length ? 'Clear a filter or the search to see more.' : undefined}
          />
        ) : (
          <>
            <Table containerClassName="hidden sm:block">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Sl. No.</TableHead>
                  <TableHead className="min-w-[18rem]">Description</TableHead>
                  <TableHead className="min-w-[10rem]">Drawing No.</TableHead>
                  <TableHead>Revisions</TableHead>
                  <TableHead className="whitespace-nowrap">Approved on</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Days</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sections.flatMap((section) => [
                  <TableRow key={section.key} className="bg-muted/60 hover:bg-muted/60">
                    <TableCell colSpan={COLUMN_COUNT} className="py-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                        {section.schedule} › {section.scope}
                      </span>
                      <span className="ml-2 text-xs text-muted-foreground">{section.count}</span>
                    </TableCell>
                  </TableRow>,
                  ...section.groups.flatMap((group) => [
                    ...(group.group
                      ? [
                          <TableRow key={group.key} className="bg-muted/25 hover:bg-muted/25">
                            <TableCell colSpan={COLUMN_COUNT} className="py-1.5 pl-6 text-[13px] font-medium text-slate-700">
                              {group.group}
                            </TableCell>
                          </TableRow>,
                        ]
                      : []),
                    ...group.items.map((item) => (
                      <TableRow key={item.id} className="cursor-pointer" onClick={() => router.push(itemHref(item.id))}>
                        <TableCell className="tabular-nums text-muted-foreground">{item.slNo || '—'}</TableCell>
                        <TableCell className="max-w-[28rem]">
                          <CellLink href={itemHref(item.id)} className="line-clamp-2 font-medium text-slate-800 hover:underline">
                            {item.description}
                          </CellLink>
                        </TableCell>
                        <TableCell className="break-words text-slate-700">{item.drgNo || <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell>
                          <RevisionTrack item={item} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <DateText value={item.approvedOn} />
                        </TableCell>
                        <TableCell>
                          <MdlStatusBadge status={item.status} />
                        </TableCell>
                        <TableCell className="text-right">
                          <DaysText item={item} today={today} />
                        </TableCell>
                      </TableRow>
                    )),
                  ]),
                ])}
              </TableBody>
            </Table>

            <div className="divide-y sm:hidden">
              {sections.map((section) => (
                <section key={section.key} className="space-y-2 px-3 py-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                    {section.schedule} › {section.scope} <span className="ml-1 font-normal normal-case text-muted-foreground">{section.count}</span>
                  </h3>
                  {section.groups.map((group) => (
                    <div key={group.key} className="space-y-2">
                      {group.group && <p className="text-[13px] font-medium text-slate-600">{group.group}</p>}
                      <DataList cardsOnly rows={group.items} columns={columns} cardHref={(item) => itemHref(item.id)} />
                    </div>
                  ))}
                </section>
              ))}
            </div>
          </>
        )}
      </TableCard>
    </>
  );
}

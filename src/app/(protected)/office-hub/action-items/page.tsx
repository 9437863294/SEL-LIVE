'use client';

/**
 * The action item register (§22).
 *
 * The single most useful column here is the last one. An action item with no task is work somebody
 * agreed to in a meeting that nothing is reminding them about — so the register has a view for
 * exactly that, and a one-click "Create task" on every row of it. §91's chain only works if the
 * gap between "agreed" and "tracked" is visible.
 */

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckSquare,
  Download,
  ExternalLink,
  ListTodo,
  Search,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ACTION_ITEM_STATUSES,
  OFFICE_HUB_BASE_PATH,
  OFFICE_HUB_PRIORITIES,
  activeFilterCount,
  applyActionItemFilters,
  buildActionItemReport,
  formatIsoDate,
  hasActiveFilters,
  isActionItemOverdue,
  type ActionItemFilters,
  type ActionItemStatus,
  type OfficeHubActionItem,
  type OfficeHubPriority,
} from '@/lib/office-hub';
import { listActionItems } from '@/lib/office-hub-service';
import { useDebouncedValue, useOfficeHub, useOfficeHubQuery } from '@/components/office-hub/hooks';
import {
  OfficeHubAccessDenied,
  OfficeHubDataList,
  OfficeHubEmptyState,
  OfficeHubFilterCard,
  OfficeHubKpiCard,
  OfficeHubPageHeader,
  PersonChip,
  PriorityBadge,
  ResultCount,
  type OfficeHubListColumn,
} from '@/components/office-hub/ui';
import { MultiSelect } from '@/components/office-hub/selectors';
import { CreateTaskFromActionItemDialog } from '@/components/office-hub/decision-forms';

type View = 'open' | 'overdue' | 'no-task' | 'mine' | 'all';

const STATUS_TONE: Record<ActionItemStatus, string> = {
  Open: 'border-sky-200 bg-sky-50 text-sky-700',
  'In Progress': 'border-indigo-200 bg-indigo-50 text-indigo-700',
  Completed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  Cancelled: 'border-rose-200 bg-rose-50 text-rose-700',
};

export default function ActionItemsPage() {
  const { viewer, capabilities, directory, today, isLoading } = useOfficeHub();

  const [view, setView] = useState<View>('open');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [filters, setFilters] = useState<ActionItemFilters>({});
  const [converting, setConverting] = useState<OfficeHubActionItem | null>(null);

  const itemsQuery = useOfficeHubQuery(
    () =>
      capabilities.canViewAllMeetings || capabilities.canEditAnyActionItem
        ? listActionItems({ limit: 500 })
        : listActionItems({ responsibleUserId: viewer.userId, limit: 400 }),
    [capabilities.canViewAllMeetings, capabilities.canEditAnyActionItem, viewer.userId],
    { enabled: capabilities.canViewActionItems, initial: [] },
  );

  const all = itemsQuery.data ?? [];

  const effectiveFilters = useMemo<ActionItemFilters>(() => {
    const base: ActionItemFilters = { ...filters, search: debouncedSearch };
    if (view === 'overdue') return { ...base, overdueOnly: true };
    if (view === 'no-task') return { ...base, withoutTaskOnly: true, statuses: ['Open', 'In Progress'] };
    if (view === 'open') return { ...base, statuses: base.statuses?.length ? base.statuses : ['Open', 'In Progress'] };
    if (view === 'mine') return { ...base, responsibleIds: [viewer.userId] };
    return base;
  }, [filters, debouncedSearch, view, viewer.userId]);

  const filtered = useMemo(
    () =>
      applyActionItemFilters(all, effectiveFilters, today).sort((a, b) => {
        const aLate = isActionItemOverdue(a, today) ? 0 : 1;
        const bLate = isActionItemOverdue(b, today) ? 0 : 1;
        if (aLate !== bLate) return aLate - bLate;
        return (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31');
      }),
    [all, effectiveFilters, today],
  );

  const report = useMemo(() => buildActionItemReport(all, today), [all, today]);

  const clearFilters = () => {
    setFilters({});
    setSearch('');
    setView('open');
  };

  const exportRows = async () => {
    const { exportRowsToExcel } = await import('@/lib/report-excel');
    await exportRowsToExcel(
      'Action items',
      filtered.map((item) => ({
        Reference: item.reference,
        Action: item.title,
        Responsible: item.responsibleUserName || item.responsibleTeamName || '',
        Department: item.departmentName ?? '',
        'Due date': item.dueDate ?? '',
        Overdue: isActionItemOverdue(item, today) ? 'Yes' : 'No',
        Priority: item.priority,
        Status: item.status,
        Meeting: item.meetingTitle ?? '',
        'Meeting date': item.meetingDate ?? '',
        'Task raised': item.taskId ? 'Yes' : 'No',
      })),
      { filename: `office-hub-action-items-${today}.xlsx` },
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (!capabilities.canViewActionItems) return <OfficeHubAccessDenied what="action items" />;

  const columns: OfficeHubListColumn<OfficeHubActionItem>[] = [
    {
      header: 'Action',
      mobile: 'title',
      cell: (item) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-800">{item.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {item.reference}
            {item.meetingTitle ? ` · ${item.meetingTitle}` : ''}
            {item.meetingDate ? ` · ${formatIsoDate(item.meetingDate)}` : ''}
          </p>
        </div>
      ),
    },
    {
      header: 'Responsible',
      mobile: 'detail',
      className: 'w-44',
      cell: (item) => (
        <PersonChip
          name={item.responsibleUserName ?? item.responsibleTeamName ?? null}
          subtitle={item.responsibleUserName && item.responsibleTeamName ? item.responsibleTeamName : item.departmentName}
        />
      ),
    },
    {
      header: 'Due',
      mobile: 'aside',
      className: 'w-32',
      cell: (item) =>
        item.dueDate ? (
          <span
            className={
              isActionItemOverdue(item, today)
                ? 'inline-flex items-center gap-1 text-xs font-medium tabular-nums text-rose-700'
                : 'text-xs tabular-nums text-slate-700'
            }
          >
            {isActionItemOverdue(item, today) && <AlertTriangle className="h-3.5 w-3.5" />}
            {formatIsoDate(item.dueDate)}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">No due date</span>
        ),
    },
    {
      header: 'Priority',
      mobile: 'detail',
      className: 'hidden md:table-cell w-24',
      cell: (item) => <PriorityBadge priority={item.priority} />,
    },
    {
      header: 'Status',
      mobile: 'detail',
      className: 'w-28',
      cell: (item) => (
        <Badge variant="outline" className={`border text-[11px] font-medium ${STATUS_TONE[item.status]}`}>
          {item.status}
        </Badge>
      ),
    },
    {
      header: 'Task',
      mobile: 'footer',
      align: 'right',
      className: 'w-32',
      cell: (item) =>
        item.taskId ? (
          <Button size="sm" variant="ghost" asChild className="gap-1.5">
            <Link href={`${OFFICE_HUB_BASE_PATH}/tasks/${item.taskId}`}>
              <ExternalLink className="h-3.5 w-3.5" />
              View
            </Link>
          </Button>
        ) : capabilities.canConvertActionItem && item.status !== 'Completed' && item.status !== 'Cancelled' ? (
          <Button size="sm" className="gap-1.5" onClick={() => setConverting(item)}>
            <ListTodo className="h-3.5 w-3.5" />
            Create
          </Button>
        ) : (
          <span className="text-[11px] text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <div className="space-y-3">
      <OfficeHubPageHeader
        title="Action items"
        description="What meetings asked for. Turn one into a task and it starts reminding people."
        actions={
          filtered.length > 0 ? (
            <Button variant="outline" onClick={() => void exportRows()} className="gap-2">
              <Download className="h-4 w-4" />
              Export
            </Button>
          ) : undefined
        }
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <OfficeHubKpiCard label="Total" value={report.total} icon={CheckSquare} tone="slate" />
        <OfficeHubKpiCard label="Open" value={report.open} icon={CheckSquare} tone="blue" />
        <OfficeHubKpiCard label="In progress" value={report.inProgress} icon={CheckSquare} tone="indigo" />
        <OfficeHubKpiCard label="Completed" value={report.completed} icon={CheckSquare} tone="emerald" />
        <OfficeHubKpiCard
          label="No task yet"
          value={report.withoutTask}
          icon={ListTodo}
          tone={report.withoutTask ? 'amber' : 'slate'}
        />
      </div>

      <Tabs value={view} onValueChange={(next) => setView(next as View)}>
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="open" className="text-xs">
            Open
          </TabsTrigger>
          <TabsTrigger value="overdue" className="text-xs">
            Overdue{report.overdue ? ` (${report.overdue})` : ''}
          </TabsTrigger>
          <TabsTrigger value="no-task" className="text-xs">
            Untracked{report.withoutTask ? ` (${report.withoutTask})` : ''}
          </TabsTrigger>
          <TabsTrigger value="mine" className="text-xs">
            Mine
          </TabsTrigger>
          <TabsTrigger value="all" className="text-xs">
            Everything
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {view === 'no-task' && report.withoutTask > 0 && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          These were agreed in a meeting but have no task, so nothing is reminding anybody about them.
          Creating a task from one carries over the responsible person, the due date and the link back
          to the meeting.
        </p>
      )}

      <OfficeHubFilterCard
        summary={
          hasActiveFilters(effectiveFilters)
            ? `${activeFilterCount(effectiveFilters)} filter(s) active`
            : 'Open action items'
        }
        actions={
          hasActiveFilters(effectiveFilters) ? (
            <Button size="sm" variant="ghost" onClick={clearFilters} className="h-7 gap-1 px-2 text-[11px]">
              <X className="h-3 w-3" />
              Clear
            </Button>
          ) : undefined
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <Label className="mb-1 block text-xs">Search</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Reference, action, person"
                className="bg-white pl-8"
              />
            </div>
          </div>

          <MultiSelect
            label="Responsible"
            placeholder="Anyone"
            options={directory.people.map((person) => ({ value: person.userId, label: person.name }))}
            value={filters.responsibleIds ?? []}
            onChange={(next) => setFilters((current) => ({ ...current, responsibleIds: next }))}
          />

          <MultiSelect
            label="Team"
            placeholder="Any team"
            options={directory.teams.map((team) => ({ value: team.id, label: team.name }))}
            value={filters.teamIds ?? []}
            onChange={(next) => setFilters((current) => ({ ...current, teamIds: next }))}
          />

          <MultiSelect
            label="Status"
            placeholder="Any status"
            options={ACTION_ITEM_STATUSES.map((status) => ({ value: status, label: status }))}
            value={filters.statuses ?? []}
            onChange={(next) => setFilters((current) => ({ ...current, statuses: next as ActionItemStatus[] }))}
          />

          <MultiSelect
            label="Priority"
            placeholder="Any priority"
            options={OFFICE_HUB_PRIORITIES.map((priority) => ({ value: priority, label: priority }))}
            value={filters.priorities ?? []}
            onChange={(next) => setFilters((current) => ({ ...current, priorities: next as OfficeHubPriority[] }))}
          />
        </div>
      </OfficeHubFilterCard>

      <ResultCount shown={filtered.length} total={all.length} noun="action item" />

      {itemsQuery.isLoading ? (
        <Skeleton className="h-96 w-full rounded-xl" />
      ) : (
        <OfficeHubDataList
          rows={filtered}
          columns={columns}
          maxHeightClassName="sm:max-h-[42rem]"
          rowClassName={(item) => (isActionItemOverdue(item, today) ? 'bg-rose-50/60' : undefined)}
          empty={
            <OfficeHubEmptyState
              icon={CheckSquare}
              title={
                view === 'overdue'
                  ? 'Nothing overdue.'
                  : view === 'no-task'
                    ? 'Every open action item has a task.'
                    : 'No action items.'
              }
              description={
                view === 'no-task'
                  ? 'Everything agreed in a meeting is being tracked.'
                  : hasActiveFilters(effectiveFilters)
                    ? 'Clear a filter to widen the list.'
                    : 'Action items raised during a meeting appear here.'
              }
              action={
                hasActiveFilters(effectiveFilters) ? (
                  <Button size="sm" variant="outline" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          }
        />
      )}

      {report.byResponsible.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Open items by person
          </span>
          {report.byResponsible.slice(0, 8).map((row) => (
            <Badge key={row.label} variant="outline" className="border-slate-200 bg-white text-[11px]">
              {row.label}: <span className="ml-1 font-semibold tabular-nums">{row.count}</span>
            </Badge>
          ))}
        </div>
      )}

      {converting && (
        <CreateTaskFromActionItemDialog
          item={converting}
          meeting={
            converting.meetingId
              ? { id: converting.meetingId, title: converting.meetingTitle ?? 'Meeting', projectId: null, projectName: null }
              : null
          }
          open
          onOpenChange={(open) => !open && setConverting(null)}
          onCreated={() => {
            setConverting(null);
            itemsQuery.reload();
          }}
        />
      )}
    </div>
  );
}

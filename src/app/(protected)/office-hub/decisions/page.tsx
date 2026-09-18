'use client';

/**
 * The Decision Register (§21).
 *
 * A decision taken in a meeting is the thing most likely to be forgotten, because unlike a task
 * nobody is assigned to *do* it — somebody is assigned to see it through. So this register exists
 * separately from the meeting it came from, with its own reference number, owner, due date and
 * status, and it is the screen a management review opens.
 *
 * Overdue open decisions lead the register by default. That ordering is the feature: a decision
 * register sorted by date reads like a history, and what a reader needs is what has been sitting.
 */

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, Download, Gavel, Plus, Search, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DECISION_STATUSES,
  OFFICE_HUB_BASE_PATH,
  OFFICE_HUB_PRIORITIES,
  activeFilterCount,
  applyDecisionFilters,
  buildDecisionReport,
  formatIsoDate,
  hasActiveFilters,
  isDecisionOverdue,
  type DecisionFilters,
  type DecisionStatus,
  type OfficeHubDecision,
  type OfficeHubPriority,
} from '@/lib/office-hub';
import { listDecisions } from '@/lib/office-hub-service';
import { useDebouncedValue, useOfficeHub, useOfficeHubQuery } from '@/components/office-hub/hooks';
import {
  HrCellLink,
  DecisionStatusBadge,
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
import { DateRangePicker, MultiSelect } from '@/components/office-hub/selectors';
import { DecisionDialog, decisionDraftFor } from '@/components/office-hub/decision-forms';

type View = 'open' | 'overdue' | 'all' | 'mine';

export default function DecisionsPage() {
  const searchParams = useSearchParams();
  const { viewer, capabilities, directory, today, isLoading } = useOfficeHub();

  const [view, setView] = useState<View>('open');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [filters, setFilters] = useState<DecisionFilters>({});
  const [creating, setCreating] = useState(searchParams?.get('new') === '1');
  const [draft, setDraft] = useState(() => decisionDraftFor({ today, viewer }));

  useEffect(() => {
    if (viewer.userId) setDraft(decisionDraftFor({ today, viewer }));
  }, [viewer.userId, viewer.name, today, viewer.departmentId, viewer.departmentName]);

  const decisionsQuery = useOfficeHubQuery(
    () =>
      // A viewer without `View All` still gets the register, narrowed to the decisions they own; the
      // visibility rules then apply per row.
      capabilities.canViewAllDecisions
        ? listDecisions({ limit: 400 })
        : listDecisions({ ownerId: viewer.userId, limit: 400 }),
    [capabilities.canViewAllDecisions, viewer.userId],
    { enabled: capabilities.canViewDecisions, initial: [] },
  );

  const all = decisionsQuery.data ?? [];

  const effectiveFilters = useMemo<DecisionFilters>(() => {
    const base: DecisionFilters = { ...filters, search: debouncedSearch };
    if (view === 'overdue') return { ...base, overdueOnly: true };
    if (view === 'open') return { ...base, statuses: base.statuses?.length ? base.statuses : ['Open', 'In Progress'] };
    if (view === 'mine') return { ...base, ownerIds: [viewer.userId] };
    return base;
  }, [filters, debouncedSearch, view, viewer.userId]);

  const filtered = useMemo(
    () =>
      applyDecisionFilters(all, effectiveFilters, today).sort((a, b) => {
        const aLate = isDecisionOverdue(a, today) ? 0 : 1;
        const bLate = isDecisionOverdue(b, today) ? 0 : 1;
        if (aLate !== bLate) return aLate - bLate;
        return b.decisionDate.localeCompare(a.decisionDate);
      }),
    [all, effectiveFilters, today],
  );

  const report = useMemo(() => buildDecisionReport(all, today), [all, today]);

  const clearFilters = () => {
    setFilters({});
    setSearch('');
    setView('open');
  };

  const exportRows = async () => {
    const { exportRowsToExcel } = await import('@/lib/report-excel');
    await exportRowsToExcel(
      'Decisions',
      filtered.map((decision) => ({
        Reference: decision.reference,
        Decision: decision.title,
        'Decision date': decision.decisionDate,
        Owner: decision.ownerName,
        Department: decision.departmentName ?? '',
        Priority: decision.priority,
        Status: decision.status,
        'Due date': decision.dueDate ?? '',
        Overdue: isDecisionOverdue(decision, today) ? 'Yes' : 'No',
        Meeting: decision.meetingTitle ?? '',
        Project: decision.projectName ?? '',
        Description: decision.description ?? '',
      })),
      { filename: `office-hub-decisions-${today}.xlsx` },
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

  if (!capabilities.canViewDecisions) return <OfficeHubAccessDenied what="the decision register" />;

  const columns: OfficeHubListColumn<OfficeHubDecision>[] = [
    {
      header: 'Decision',
      mobile: 'title',
      cell: (decision) => (
        <div className="min-w-0">
          <HrCellLink
            href={`${OFFICE_HUB_BASE_PATH}/decisions/${decision.id}`}
            className="block truncate font-medium hover:underline"
          >
            {decision.title}
          </HrCellLink>
          <p className="truncate text-xs text-muted-foreground">
            {decision.reference}
            {decision.meetingTitle ? ` · ${decision.meetingTitle}` : ''}
          </p>
        </div>
      ),
    },
    {
      header: 'Owner',
      mobile: 'detail',
      className: 'w-44',
      cell: (decision) => <PersonChip name={decision.ownerName} subtitle={decision.departmentName} />,
    },
    {
      header: 'Taken',
      mobile: 'aside',
      className: 'hidden sm:table-cell w-28',
      cell: (decision) => <span className="text-xs tabular-nums">{formatIsoDate(decision.decisionDate)}</span>,
    },
    {
      header: 'Due',
      mobile: 'aside',
      className: 'w-32',
      cell: (decision) =>
        decision.dueDate ? (
          <span
            className={
              isDecisionOverdue(decision, today)
                ? 'inline-flex items-center gap-1 text-xs font-medium tabular-nums text-rose-700'
                : 'text-xs tabular-nums text-slate-700'
            }
          >
            {isDecisionOverdue(decision, today) && <AlertTriangle className="h-3.5 w-3.5" />}
            {formatIsoDate(decision.dueDate)}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">No due date</span>
        ),
    },
    {
      header: 'Priority',
      mobile: 'detail',
      className: 'hidden md:table-cell w-24',
      cell: (decision) => <PriorityBadge priority={decision.priority} />,
    },
    {
      header: 'Status',
      mobile: 'detail',
      className: 'w-32',
      cell: (decision) => <DecisionStatusBadge status={decision.status} />,
    },
  ];

  return (
    <div className="space-y-3">
      <OfficeHubPageHeader
        title="Decision register"
        description="Every decision taken in a meeting, who owns it, and whether it has been seen through."
        actions={
          <div className="flex flex-wrap gap-2">
            {filtered.length > 0 && (
              <Button variant="outline" onClick={() => void exportRows()} className="gap-2">
                <Download className="h-4 w-4" />
                Export
              </Button>
            )}
            {capabilities.canCreateDecision && (
              <Button onClick={() => setCreating(true)} className="gap-2">
                <Plus className="h-4 w-4" />
                Record a decision
              </Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <OfficeHubKpiCard label="Total" value={report.total} icon={Gavel} tone="slate" />
        <OfficeHubKpiCard label="Open" value={report.open} icon={Gavel} tone="blue" />
        <OfficeHubKpiCard label="In progress" value={report.inProgress} icon={Gavel} tone="indigo" />
        <OfficeHubKpiCard label="Completed" value={report.completed} icon={Gavel} tone="emerald" />
        <OfficeHubKpiCard
          label="Overdue"
          value={report.overdue}
          icon={AlertTriangle}
          tone={report.overdue ? 'rose' : 'slate'}
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
          <TabsTrigger value="mine" className="text-xs">
            Mine
          </TabsTrigger>
          <TabsTrigger value="all" className="text-xs">
            Everything
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <OfficeHubFilterCard
        summary={
          hasActiveFilters(effectiveFilters)
            ? `${activeFilterCount(effectiveFilters)} filter(s) active`
            : capabilities.canViewAllDecisions
              ? 'All decisions you can see'
              : 'Decisions you own'
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
                placeholder="Reference, decision, owner"
                className="bg-white pl-8"
              />
            </div>
          </div>

          <DateRangePicker
            label="Taken between"
            from={filters.fromDate}
            to={filters.toDate}
            onChange={(range) => setFilters((current) => ({ ...current, fromDate: range.from, toDate: range.to }))}
          />

          <MultiSelect
            label="Status"
            placeholder="Any status"
            options={DECISION_STATUSES.map((status) => ({ value: status, label: status }))}
            value={filters.statuses ?? []}
            onChange={(next) => setFilters((current) => ({ ...current, statuses: next as DecisionStatus[] }))}
          />

          <MultiSelect
            label="Owner"
            placeholder="Anyone"
            options={directory.people.map((person) => ({ value: person.userId, label: person.name }))}
            value={filters.ownerIds ?? []}
            onChange={(next) => setFilters((current) => ({ ...current, ownerIds: next }))}
          />

          <MultiSelect
            label="Department"
            placeholder="Any department"
            options={directory.departments.map((department) => ({ value: department.id, label: department.name }))}
            value={filters.departmentIds ?? []}
            onChange={(next) => setFilters((current) => ({ ...current, departmentIds: next }))}
          />

          <MultiSelect
            label="Priority"
            placeholder="Any priority"
            options={OFFICE_HUB_PRIORITIES.map((priority) => ({ value: priority, label: priority }))}
            value={filters.priorities ?? []}
            onChange={(next) => setFilters((current) => ({ ...current, priorities: next as OfficeHubPriority[] }))}
          />

          <MultiSelect
            label="Project"
            placeholder="Any project"
            options={directory.projects.map((project) => ({ value: project.id, label: project.name }))}
            value={filters.projectIds ?? []}
            onChange={(next) => setFilters((current) => ({ ...current, projectIds: next }))}
          />
        </div>
      </OfficeHubFilterCard>

      <ResultCount shown={filtered.length} total={all.length} noun="decision" />

      {decisionsQuery.isLoading ? (
        <Skeleton className="h-96 w-full rounded-xl" />
      ) : (
        <OfficeHubDataList
          rows={filtered}
          columns={columns}
          cardHref={(decision) => `${OFFICE_HUB_BASE_PATH}/decisions/${decision.id}`}
          maxHeightClassName="sm:max-h-[42rem]"
          rowClassName={(decision) => (isDecisionOverdue(decision, today) ? 'bg-rose-50/60' : undefined)}
          empty={
            <OfficeHubEmptyState
              icon={Gavel}
              title={
                view === 'overdue'
                  ? 'No overdue decisions.'
                  : hasActiveFilters(effectiveFilters)
                    ? 'No decisions found.'
                    : 'No decisions recorded yet.'
              }
              description={
                view === 'overdue'
                  ? 'Everything with a follow-up date is on time.'
                  : hasActiveFilters(effectiveFilters)
                    ? 'Clear a filter or widen the date range.'
                    : 'Decisions recorded during a meeting appear here with their own reference number.'
              }
              action={
                hasActiveFilters(effectiveFilters) ? (
                  <Button size="sm" variant="outline" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : capabilities.canCreateDecision ? (
                  <Button size="sm" onClick={() => setCreating(true)}>
                    Record a decision
                  </Button>
                ) : undefined
              }
            />
          }
        />
      )}

      {report.ageing.some((row) => row.count > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Open decisions by age
          </span>
          {report.ageing
            .filter((row) => row.count > 0)
            .map((row) => (
              <Badge key={row.label} variant="outline" className="border-slate-200 bg-white text-[11px]">
                {row.label}: <span className="ml-1 font-semibold tabular-nums">{row.count}</span>
              </Badge>
            ))}
        </div>
      )}

      <DecisionDialog
        open={creating}
        onOpenChange={setCreating}
        draft={draft}
        setDraft={setDraft}
        onSaved={() => {
          setDraft(decisionDraftFor({ today, viewer }));
          decisionsQuery.reload();
        }}
      />
    </div>
  );
}

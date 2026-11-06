'use client';

/**
 * The task register (§25's views, §38's filters, §65's export). Redesigned 2026-11-06 from the
 * user's mockup (`sel-tasks-redesign.html`): a band with a quick-add line and figures that filter,
 * then one register as a due-date-grouped list or a board, and a new-task window.
 *
 *   • **Scope** picks the Firestore query (mine / created / team / department / all), bounded by
 *     what the viewer's grants allow.
 *   • **Tabs** are presets over the filters — Open, Overdue, Completed, Unassigned.
 *   • **Display** is list or board; the calendar route already shows task deadlines.
 *
 * Every action is the service's own: quick add and the new-task window create through
 * `createTask`, the round tick through `setTaskStatus`, "Take it" through `updateTask`, the board
 * through `TaskKanban` — each offered only where `canEditTask` (the rules' twin) allows it.
 *
 * Left out from the mockup on purpose: its "Common tasks to start with" suggestions (sample titles
 * with nothing behind them) and its "Your data / A busy week" preview switch.
 */

import Link from 'next/link';
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Circle,
  CircleCheck,
  CircleDot,
  Download,
  KanbanSquare,
  ListChecks,
  Loader2,
  Maximize2,
  PauseCircle,
  Plus,
  Rows3,
  Search,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  DUE_GROUPS,
  OFFICE_HUB_BASE_PATH,
  OFFICE_HUB_PRIORITIES,
  TASK_STATUSES,
  applyTaskFilters,
  buildTaskStatistics,
  canEditTask,
  dueGroupOf,
  formatIsoDate,
  isTaskOverdue,
  parseQuickTask,
  relativeDue,
  subtaskCompletion,
  type OfficeHubPriority,
  type OfficeHubTask,
  type TaskFilters,
  type TaskStatus,
} from '@/lib/office-hub';
import { createTask, listMyTasks, listTasks, setTaskStatus, updateTask } from '@/lib/office-hub-service';
import { useDebouncedValue, useOfficeHub, useOfficeHubAction, useOfficeHubQuery } from '@/components/office-hub/hooks';
import { OfficeHubAccessDenied } from '@/components/office-hub/ui';
import { MultiSelect } from '@/components/office-hub/selectors';
import { TaskKanban, TaskKanbanSkeleton } from '@/components/office-hub/task-kanban';
import { NewTaskDialog, PriorityBars } from '@/components/office-hub/task-create-dialog';
import { Avatar } from '@/components/office-hub/meeting-form-parts';

type Scope = 'mine' | 'created' | 'team' | 'department' | 'all';
type Tab = 'open' | 'overdue' | 'completed' | 'unassigned';
type Display = 'list' | 'board';
const BASE = OFFICE_HUB_BASE_PATH;

const TABS: { value: Tab; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'completed', label: 'Completed' },
  { value: 'unassigned', label: 'Unassigned' },
];

const STATUS_CHIP: Record<TaskStatus, string> = {
  'Not Started': 'bg-muted text-muted-foreground',
  'In Progress': 'bg-blue-100 text-blue-700',
  'On Hold': 'bg-amber-100 text-amber-800',
  Completed: 'bg-emerald-100 text-emerald-700',
  Cancelled: 'bg-muted text-muted-foreground',
};

const GROUP_COLOUR: Record<string, string> = {
  overdue: 'text-rose-600',
  today: 'text-amber-600',
  week: 'text-primary',
  later: 'text-blue-600',
  none: 'text-muted-foreground',
  done: 'text-emerald-600',
};

const isOpen = (task: OfficeHubTask) => task.status !== 'Completed' && task.status !== 'Cancelled';

function inTab(task: OfficeHubTask, tab: Tab, today: string): boolean {
  if (tab === 'open') return isOpen(task);
  if (tab === 'overdue') return isTaskOverdue(task, today);
  if (tab === 'completed') return task.status === 'Completed';
  return isOpen(task) && !task.assigneeId;
}

export default function TasksPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { actor, viewer, capabilities, settings, directory, today, isLoading } = useOfficeHub();
  const { isBusy, run } = useOfficeHubAction();

  const initialView = searchParams?.get('view');
  const [scope, setScope] = useState<Scope>((searchParams?.get('scope') as Scope) ?? 'mine');
  const [tab, setTab] = useState<Tab>(initialView === 'overdue' ? 'overdue' : initialView === 'completed' ? 'completed' : initialView === 'unassigned' ? 'unassigned' : 'open');
  const [display, setDisplay] = useState<Display>(searchParams?.get('display') === 'board' ? 'board' : 'list');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const meetingId = searchParams?.get('meeting') ?? null;
  const [filters, setFilters] = useState<TaskFilters>(() => (meetingId ? { meetingIds: [meetingId] } : {}));
  const [creating, setCreating] = useState(false);
  const [quick, setQuick] = useState('');

  // A meeting id arriving later (client navigation to ?meeting=…) narrows the register to it.
  const [seenMeeting, setSeenMeeting] = useState(meetingId);
  if (meetingId !== seenMeeting) {
    setSeenMeeting(meetingId);
    if (meetingId) setFilters((current) => ({ ...current, meetingIds: [meetingId] }));
  }

  const scopes = useMemo(() => {
    const list: { value: Scope; label: string }[] = [
      { value: 'mine', label: 'Assigned to me' },
      { value: 'created', label: 'Raised by me' },
    ];
    if (capabilities.canViewTeamTasks && (viewer.teamIds?.length ?? 0) > 0) list.push({ value: 'team', label: 'My teams' });
    if (capabilities.canViewDepartmentTasks && viewer.departmentId) list.push({ value: 'department', label: 'My department' });
    if (capabilities.canViewAllTasks) list.push({ value: 'all', label: 'Everything I can see' });
    return list;
  }, [capabilities, viewer.teamIds, viewer.departmentId]);
  const effectiveScope: Scope = scopes.some((entry) => entry.value === scope) ? scope : 'mine';

  const tasksQuery = useOfficeHubQuery(
    () =>
      effectiveScope === 'mine'
        ? // "Assigned to me" includes tasks the viewer watches — theirs to follow even after reassigning.
          listMyTasks(viewer.userId, { limit: 400 })
        : listTasks(effectiveScope, viewer, { limit: 400 }),
    [effectiveScope, viewer.userId, viewer.departmentId],
    { enabled: Boolean(actor) && capabilities.canViewTasks, initial: [] },
  );

  const all = useMemo(() => (tasksQuery.data ?? []).filter((task) => !task.isDeleted), [tasksQuery.data]);
  const filtered = useMemo(() => applyTaskFilters(all, { ...filters, search: debouncedSearch }, today), [all, filters, debouncedSearch, today]);
  const inCurrentTab = useMemo(() => filtered.filter((task) => inTab(task, tab, today)), [filtered, tab, today]);
  const stats = useMemo(() => buildTaskStatistics(all, today), [all, today]);

  const grouped = useMemo(() => {
    const groups = DUE_GROUPS.map((group) => ({ ...group, tasks: [] as OfficeHubTask[] }));
    for (const task of inCurrentTab) groups.find((group) => group.value === dueGroupOf(task, today))?.tasks.push(task);
    const priorityRank = (priority: OfficeHubPriority) => OFFICE_HUB_PRIORITIES.indexOf(priority);
    for (const group of groups) {
      group.tasks.sort(
        (a, b) => (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31') || priorityRank(b.priority) - priorityRank(a.priority),
      );
    }
    return groups.filter((group) => group.tasks.length);
  }, [inCurrentTab, today]);

  /* ── quick add ── */
  const parsed = useMemo(
    () => (quick.trim() ? parseQuickTask(quick, { today, people: directory.people, defaultAssignee: { userId: viewer.userId, name: viewer.name } }) : null),
    [quick, today, directory.people, viewer.userId, viewer.name],
  );

  const quickAdd = async () => {
    if (!actor || !parsed?.title) return;
    const person = directory.people.find((entry) => entry.userId === parsed.assigneeId);
    const id = await run(
      () =>
        createTask(
          actor,
          {
            title: parsed.title,
            assigneeId: parsed.assigneeId,
            assigneeName: parsed.assigneeName,
            departmentId: person?.departmentId ?? viewer.departmentId ?? null,
            departmentName: person?.departmentName ?? viewer.departmentName ?? null,
            startDate: today,
            dueDate: parsed.dueDate,
            priority: parsed.priority,
            tags: parsed.tags,
          },
          { settings },
        ),
      {
        success: parsed.assigneeId && parsed.assigneeId !== viewer.userId ? `Task added · ${parsed.assigneeName?.split(' ')[0]} notified` : 'Task added',
        failure: 'Could not add the task',
        describe: 'Quick add task',
      },
    );
    if (id) {
      setQuick('');
      tasksQuery.reload();
    }
  };

  /* ── row actions ── */
  const toggleDone = async (task: OfficeHubTask) => {
    if (!actor) return;
    const next: TaskStatus = task.status === 'Completed' ? ((task.progress ?? 0) > 0 ? 'In Progress' : 'Not Started') : 'Completed';
    const done = await run(
      async () => {
        await setTaskStatus(actor, task.id, next, { settings });
        return true;
      },
      { success: next === 'Completed' ? `${task.reference} completed` : `${task.reference} reopened`, failure: 'Could not change the task', describe: 'Change task status' },
    );
    if (done) tasksQuery.reload();
  };

  const takeIt = async (task: OfficeHubTask) => {
    if (!actor) return;
    const done = await run(
      async () => {
        await updateTask(actor, task.id, { assigneeId: viewer.userId, assigneeName: viewer.name }, { settings });
        return true;
      },
      { success: `${task.reference} is now yours`, failure: 'Could not take the task', describe: 'Take task' },
    );
    if (done) tasksQuery.reload();
  };

  const exportRows = async () => {
    const { exportRowsToExcel } = await import('@/lib/report-excel');
    await exportRowsToExcel(
      'Tasks',
      inCurrentTab.map((task) => ({
        Reference: task.reference,
        Title: task.title,
        Assignee: task.assigneeName ?? '',
        Team: task.teamName ?? '',
        Department: task.departmentName ?? '',
        'Start date': task.startDate ?? '',
        'Due date': task.dueDate ?? '',
        Priority: task.priority,
        Status: task.status,
        'Progress %': task.progress ?? 0,
        Overdue: isTaskOverdue(task, today) ? 'Yes' : 'No',
        'Source meeting': task.meetingTitle ?? '',
        Project: task.projectName ?? '',
        Tags: (task.tags ?? []).join(', '),
        Comments: task.commentCount ?? 0,
      })),
      { filename: `office-hub-tasks-${today}.xlsx` },
    );
  };

  const clearFilters = () => {
    setFilters({});
    setSearch('');
  };
  const filterCount =
    (filters.statuses?.length ? 1 : 0) +
    (filters.priorities?.length ? 1 : 0) +
    (filters.assigneeIds?.length ? 1 : 0) +
    (filters.teamIds?.length ? 1 : 0) +
    (filters.departmentIds?.length ? 1 : 0) +
    (filters.projectIds?.length ? 1 : 0) +
    (filters.meetingIds?.length ? 1 : 0) +
    (filters.dueFrom || filters.dueTo ? 1 : 0) +
    (debouncedSearch.trim() ? 1 : 0);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-44 w-full rounded-[22px]" />
        <Skeleton className="h-[28rem] w-full rounded-[18px]" />
      </div>
    );
  }
  if (!capabilities.canViewTasks) return <OfficeHubAccessDenied what="the task register" />;

  const figures: { key: string; label: string; value: number; icon: LucideIcon; tone: [string, string]; on: boolean; alert?: boolean; pick: () => void }[] = [
    { key: 'total', label: 'Total', value: stats.total, icon: ListChecks, tone: ['#cbd5e1', '#64748b'], on: tab === 'open' && !filters.statuses?.length, pick: () => { setTab('open'); setFilters((current) => ({ ...current, statuses: [] })); } },
    { key: 'ns', label: 'Not started', value: stats.notStarted, icon: Circle, tone: ['#e2e8f0', '#64748b'], on: tab === 'open' && sameStatuses(filters.statuses, 'Not Started'), pick: () => { setTab('open'); setFilters((current) => ({ ...current, statuses: ['Not Started'] })); } },
    { key: 'ip', label: 'In progress', value: stats.inProgress, icon: CircleDot, tone: ['#93c5fd', '#1d4ed8'], on: tab === 'open' && sameStatuses(filters.statuses, 'In Progress'), pick: () => { setTab('open'); setFilters((current) => ({ ...current, statuses: ['In Progress'] })); } },
    { key: 'hold', label: 'On hold', value: stats.onHold, icon: PauseCircle, tone: ['#fcd34d', '#b45309'], on: tab === 'open' && sameStatuses(filters.statuses, 'On Hold'), pick: () => { setTab('open'); setFilters((current) => ({ ...current, statuses: ['On Hold'] })); } },
    { key: 'done', label: 'Completed', value: stats.completed, icon: CircleCheck, tone: ['#86efac', '#15803d'], on: tab === 'completed', pick: () => { setTab('completed'); setFilters((current) => ({ ...current, statuses: [] })); } },
    { key: 'late', label: 'Overdue', value: stats.overdue, icon: AlertTriangle, tone: ['#fda4af', '#be123c'], on: tab === 'overdue', alert: stats.overdue > 0, pick: () => { setTab('overdue'); setFilters((current) => ({ ...current, statuses: [] })); } },
  ];

  return (
    <div className="space-y-3.5">
      {/* ── band ── */}
      <section className="oh-hero oh-hero--glow keep-light relative overflow-hidden rounded-[22px] px-4 pb-4 pt-4 text-white sm:px-6">
        <div aria-hidden className="wd-hero-dots pointer-events-none absolute inset-0" />
        <div className="relative flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1 basis-64">
            <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-violet-100">Office Hub · Tasks</div>
            <h1 className="mt-0.5 text-[23px] font-extrabold tracking-tight">Tasks</h1>
            <p className="text-[12.5px] text-indigo-100">One register for everything you can see. Switch to the board to move work along.</p>
          </div>
          {capabilities.canExportTasks && (
            <HeroButton onClick={() => void exportRows()} disabled={!inCurrentTab.length}>
              <Download className="h-3.5 w-3.5" aria-hidden />
              Export
            </HeroButton>
          )}
          {capabilities.canCreateTask && (
            <>
              <Link
                href={`${BASE}/tasks/new`}
                className="flex items-center gap-1.5 rounded-[10px] border border-white/25 bg-white/10 px-3.5 py-2 text-[12.5px] font-bold text-white hover:bg-white/20"
              >
                <Maximize2 className="h-3.5 w-3.5" aria-hidden />
                Full form
              </Link>
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="flex items-center gap-1.5 rounded-[10px] border border-white bg-white px-3.5 py-2 text-[12.5px] font-bold text-violet-900 hover:bg-violet-50"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                New task
              </button>
            </>
          )}
        </div>

        {capabilities.canCreateTask && (
          <>
            <form
              className="relative mt-3.5 flex items-center gap-2.5 rounded-[14px] bg-white py-1.5 pl-3.5 pr-1.5 shadow-lg"
              onSubmit={(event) => {
                event.preventDefault();
                void quickAdd();
              }}
            >
              <Plus className="h-4 w-4 shrink-0 text-violet-600" aria-hidden />
              <input
                value={quick}
                onChange={(event) => setQuick(event.target.value)}
                placeholder="Quick add: “Send RA-14 backup @name fri !high #billing” and press Enter"
                aria-label="Quick add a task"
                className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-900 outline-none placeholder:font-medium placeholder:text-slate-400"
              />
              <span className="hidden whitespace-nowrap text-[11px] font-semibold text-slate-400 xl:inline">
                <b className="rounded bg-slate-100 px-1 text-slate-600">@</b> person · <b className="rounded bg-slate-100 px-1 text-slate-600">#</b> tag ·{' '}
                <b className="rounded bg-slate-100 px-1 text-slate-600">!</b> priority · a day for the due date
              </span>
              <Button type="submit" size="sm" disabled={isBusy || !parsed?.title} className="h-8 bg-gradient-to-r from-violet-600 to-indigo-600 text-white">
                {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Add'}
              </Button>
            </form>
            <div className="relative mt-2 flex min-h-[22px] flex-wrap gap-1.5 text-[11.5px] font-bold">
              {parsed && (
                <>
                  <QuickChip>“{parsed.title || '…'}”</QuickChip>
                  <QuickChip>{parsed.assigneeId === viewer.userId ? 'You' : parsed.assigneeName ?? 'Nobody'}</QuickChip>
                  <QuickChip>Due {relativeDue(parsed.dueDate, today).toLowerCase()}</QuickChip>
                  <QuickChip>{parsed.priority}</QuickChip>
                  {parsed.tags.map((tag) => (
                    <QuickChip key={tag}>#{tag}</QuickChip>
                  ))}
                  {parsed.unknownMention && <QuickChip warn>@{parsed.unknownMention} matches nobody, or more than one person</QuickChip>}
                </>
              )}
            </div>
          </>
        )}

        <div className="relative mt-2.5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
          {figures.map((figure) => {
            const Icon = figure.icon;
            return (
              <button
                key={figure.key}
                type="button"
                aria-pressed={figure.on}
                onClick={figure.pick}
                className={cn(
                  'flex min-w-0 items-center gap-2.5 rounded-[14px] border px-3 py-2 text-left transition-colors',
                  figure.on ? 'border-white bg-white text-slate-900' : 'border-white/20 bg-white/10 text-white hover:bg-white/15',
                )}
              >
                <span
                  aria-hidden
                  className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] text-white"
                  style={{ background: `linear-gradient(145deg, ${figure.tone[0]}, ${figure.tone[1]})` }}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <small className={cn('block truncate text-[11px] font-semibold', figure.on ? 'text-slate-500' : 'text-violet-100')}>{figure.label}</small>
                  <b className={cn('text-xl font-extrabold leading-tight', figure.alert && (figure.on ? 'text-rose-600' : 'text-rose-200'))}>
                    {tasksQuery.isLoading ? '–' : figure.value}
                  </b>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="overflow-hidden rounded-[18px] border bg-card">
        {/* tabs and display */}
        <div className="flex flex-wrap items-center gap-2 border-b px-3.5 pt-2.5">
          <div className="flex gap-0.5 overflow-x-auto" role="tablist" aria-label="Which tasks">
            {TABS.map((entry) => {
              const on = tab === entry.value;
              return (
                <button
                  key={entry.value}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setTab(entry.value)}
                  className={cn(
                    'flex shrink-0 items-center gap-1.5 border-b-2 px-3 pb-2.5 pt-2 text-[13px] font-bold transition-colors',
                    on ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  {entry.label}
                  <em className={cn('rounded-full px-1.5 text-[11px] not-italic', on ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground')}>
                    {filtered.filter((task) => inTab(task, entry.value, today)).length}
                  </em>
                </button>
              );
            })}
          </div>
          <span className="flex-1" />
          <div role="radiogroup" aria-label="Display" className="mb-2 inline-flex rounded-[10px] bg-muted p-[3px]">
            {(
              [
                ['list', 'List', Rows3],
                ['board', 'Board', KanbanSquare],
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={display === value}
                onClick={() => setDisplay(value)}
                className={cn(
                  'flex items-center gap-1.5 rounded-[7px] px-3 py-1 text-xs font-bold',
                  display === value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground',
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* filters */}
        <div className="flex flex-wrap items-center gap-2 px-3.5 py-3">
          <label className="flex h-9 w-full items-center gap-2 rounded-[10px] border px-2.5 text-muted-foreground sm:w-64">
            <Search className="h-4 w-4 shrink-0" aria-hidden />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Reference, title, assignee, tag…"
              aria-label="Search tasks"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
            />
          </label>
          <Select value={effectiveScope} onValueChange={(next) => setScope(next as Scope)}>
            <SelectTrigger aria-label="Whose tasks" className="h-9 w-auto min-w-[150px] rounded-[10px] font-semibold">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {scopes.map((entry) => (
                <SelectItem key={entry.value} value={entry.value}>
                  {entry.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex h-9 items-center gap-1.5 rounded-[10px] border px-2.5 text-xs font-semibold text-muted-foreground">
            Due
            <input
              type="date"
              value={filters.dueFrom ?? ''}
              max={filters.dueTo ?? undefined}
              onChange={(event) => setFilters((current) => ({ ...current, dueFrom: event.target.value || null }))}
              className="bg-transparent font-semibold text-foreground outline-none"
              aria-label="Due from"
            />
            to
            <input
              type="date"
              value={filters.dueTo ?? ''}
              min={filters.dueFrom ?? undefined}
              onChange={(event) => setFilters((current) => ({ ...current, dueTo: event.target.value || null }))}
              className="bg-transparent font-semibold text-foreground outline-none"
              aria-label="Due to"
            />
          </label>
          <FilterBox>
            <MultiSelect
              placeholder="Any status"
              options={TASK_STATUSES.map((status) => ({ value: status, label: status }))}
              value={filters.statuses ?? []}
              onChange={(next) => setFilters((current) => ({ ...current, statuses: next as TaskStatus[] }))}
            />
          </FilterBox>
          <FilterBox>
            <MultiSelect
              placeholder="Any priority"
              options={OFFICE_HUB_PRIORITIES.map((priority) => ({ value: priority, label: priority }))}
              value={filters.priorities ?? []}
              onChange={(next) => setFilters((current) => ({ ...current, priorities: next as OfficeHubPriority[] }))}
            />
          </FilterBox>
          <FilterBox>
            <MultiSelect
              placeholder="Any assignee"
              options={directory.people.map((person) => ({ value: person.userId, label: person.name, hint: person.departmentName ?? undefined }))}
              value={filters.assigneeIds ?? []}
              onChange={(next) => setFilters((current) => ({ ...current, assigneeIds: next }))}
            />
          </FilterBox>
          <FilterBox>
            <MultiSelect
              placeholder="Any team"
              options={directory.teams.map((team) => ({ value: team.id, label: team.name }))}
              value={filters.teamIds ?? []}
              onChange={(next) => setFilters((current) => ({ ...current, teamIds: next }))}
            />
          </FilterBox>
          <FilterBox>
            <MultiSelect
              placeholder="Any department"
              options={directory.departments.map((department) => ({ value: department.id, label: department.name }))}
              value={filters.departmentIds ?? []}
              onChange={(next) => setFilters((current) => ({ ...current, departmentIds: next }))}
            />
          </FilterBox>
          <FilterBox>
            <MultiSelect
              placeholder="Any project"
              options={directory.projects.map((project) => ({ value: project.id, label: project.name }))}
              value={filters.projectIds ?? []}
              onChange={(next) => setFilters((current) => ({ ...current, projectIds: next }))}
            />
          </FilterBox>
          <span className="hidden flex-1 lg:block" />
          {filterCount > 0 && (
            <Button type="button" variant="ghost" size="sm" className="h-9 gap-1" onClick={clearFilters}>
              <X className="h-3.5 w-3.5" aria-hidden />
              {filters.meetingIds?.length ? 'Clear (showing one meeting’s tasks)' : 'Clear'}
            </Button>
          )}
        </div>

        {display === 'board' ? (
          <div className="px-3.5 pb-3.5">
            {tasksQuery.isLoading ? (
              <TaskKanbanSkeleton />
            ) : (
              // On the Open tab the board still shows its Completed column — that is where cards land.
              <TaskKanban tasks={tab === 'open' ? filtered.filter((task) => task.status !== 'Cancelled') : inCurrentTab} onChanged={tasksQuery.reload} />
            )}
          </div>
        ) : tasksQuery.isLoading ? (
          <div className="p-3.5">
            <Skeleton className="h-96 w-full rounded-xl" />
          </div>
        ) : grouped.length === 0 ? (
          <div className="px-4 py-10 text-center text-muted-foreground">
            <span aria-hidden className="mx-auto mb-3 grid h-[62px] w-[62px] place-items-center rounded-[20px] bg-gradient-to-br from-emerald-300 to-emerald-700 text-white shadow-lg">
              <Check className="h-7 w-7" />
            </span>
            <b className="block text-base text-foreground">{all.length === 0 ? 'No pending tasks' : tab === 'overdue' ? 'Nothing is overdue' : 'Nothing here'}</b>
            <p className="mb-3.5 mt-1 text-sm">
              {all.length === 0
                ? 'You’re all caught up. Add one with the quick-add line above.'
                : tab === 'overdue'
                  ? 'Everything with a due date is on time.'
                  : 'No tasks match this tab and these filters.'}
            </p>
            {filterCount > 0 ? (
              <Button size="sm" variant="outline" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : capabilities.canCreateTask ? (
              <Button size="sm" onClick={() => setCreating(true)} className="gap-1.5 bg-gradient-to-r from-primary to-indigo-600 text-white">
                <Plus className="h-3.5 w-3.5" aria-hidden />
                Create a task
              </Button>
            ) : null}
          </div>
        ) : (
          <>
            {/* desktop */}
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[980px] border-collapse">
                <thead>
                  <tr className="bg-muted/40 text-left text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
                    <th className="w-10 border-b px-3 py-2" />
                    <th className="border-b px-3 py-2">Task</th>
                    <th className="border-b px-3 py-2">Assignee</th>
                    <th className="hidden border-b px-3 py-2 xl:table-cell">Project · team</th>
                    <th className="border-b px-3 py-2">Due</th>
                    <th className="border-b px-3 py-2">Priority</th>
                    <th className="hidden border-b px-3 py-2 xl:table-cell">Checklist</th>
                    <th className="border-b px-3 py-2">Status</th>
                    <th className="border-b px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {grouped.map((group) => (
                    <Fragment key={group.value}>
                      <tr>
                        <td colSpan={9} className="border-b px-3 pb-1.5 pt-3">
                          <b className={cn('inline-flex items-center gap-1.5 text-xs font-extrabold', GROUP_COLOUR[group.value])}>
                            <i aria-hidden className="h-2 w-2 rounded-full bg-current" />
                            {group.label}
                          </b>
                          <em className="ml-1.5 text-[11.5px] font-bold not-italic text-muted-foreground">{group.tasks.length}</em>
                        </td>
                      </tr>
                      {group.tasks.map((task) => (
                        <TaskRow
                          key={task.id}
                          task={task}
                          today={today}
                          viewerId={viewer.userId}
                          canEdit={canEditTask(task, viewer, capabilities).allowed}
                          busy={isBusy}
                          onOpen={() => router.push(`${BASE}/tasks/${task.id}`)}
                          onToggle={() => void toggleDone(task)}
                          onTake={() => void takeIt(task)}
                        />
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            {/* phones and tablets */}
            <div className="lg:hidden">
              {grouped.map((group) => (
                <div key={group.value}>
                  <div className={cn('border-b bg-muted/40 px-3.5 py-1.5 text-xs font-extrabold', GROUP_COLOUR[group.value])}>
                    {group.label} <span className="font-bold text-muted-foreground">{group.tasks.length}</span>
                  </div>
                  <ul>
                    {group.tasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        today={today}
                        viewerId={viewer.userId}
                        canEdit={canEditTask(task, viewer, capabilities).allowed}
                        busy={isBusy}
                        onToggle={() => void toggleDone(task)}
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t px-3.5 py-2.5 text-xs text-muted-foreground">
          {inCurrentTab.length} task{inCurrentTab.length === 1 ? '' : 's'} · {scopes.find((entry) => entry.value === effectiveScope)?.label.toLowerCase()}
        </div>
      </section>

      <NewTaskDialog open={creating} onOpenChange={setCreating} knownTasks={all} onCreated={() => tasksQuery.reload()} />
    </div>
  );
}

function sameStatuses(statuses: readonly string[] | undefined, status: TaskStatus): boolean {
  return (statuses ?? []).length === 1 && statuses?.[0] === status;
}

function HeroButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1.5 rounded-[10px] border border-white/25 bg-white/10 px-3.5 py-2 text-[12.5px] font-bold text-white hover:bg-white/20 disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function QuickChip({ children, warn }: { children: ReactNode; warn?: boolean }) {
  return (
    <span className={cn('rounded-full border px-2.5 py-px', warn ? 'border-amber-200 bg-amber-300/30 text-amber-50' : 'border-white/25 bg-white/15')}>{children}</span>
  );
}

function FilterBox({ children }: { children: ReactNode }) {
  return <div className="w-[calc(50%-4px)] sm:w-40">{children}</div>;
}

function DoneTick({ done, disabled, onToggle, label }: { done: boolean; disabled: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={label}
      title={disabled ? 'Only the assignee, the person who raised it or a team leader can change this task' : done ? 'Reopen' : 'Mark complete'}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className={cn(
        'grid h-5 w-5 place-items-center rounded-full border-2 transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        done ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-muted-foreground/40 text-transparent hover:border-emerald-600 hover:text-emerald-600',
      )}
    >
      <Check className="h-3 w-3" strokeWidth={3.2} />
    </button>
  );
}

function DueCell({ task, today }: { task: OfficeHubTask; today: string }) {
  const late = isTaskOverdue(task, today);
  const dueToday = task.dueDate === today && task.status !== 'Completed';
  return (
    <div className={cn('whitespace-nowrap text-xs font-bold', late ? 'text-rose-600' : dueToday ? 'text-amber-600' : '')}>
      {relativeDue(task.dueDate, today)}
      {task.dueDate && <small className="block text-[11px] font-semibold text-muted-foreground">{formatIsoDate(task.dueDate, { withWeekday: true, year: false })}</small>}
    </div>
  );
}

function AssigneeCell({ task, viewerId, canEdit, busy, onTake }: { task: OfficeHubTask; viewerId: string; canEdit: boolean; busy: boolean; onTake: () => void }) {
  if (task.assigneeId) {
    return (
      <span className="flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold">
        <Avatar seed={task.assigneeId} name={task.assigneeName ?? '?'} size={24} />
        {task.assigneeId === viewerId ? 'You' : task.assigneeName}
      </span>
    );
  }
  if (canEdit && task.status !== 'Completed' && task.status !== 'Cancelled') {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy}
        className="h-7 px-2.5 text-xs"
        onClick={(event) => {
          event.stopPropagation();
          onTake();
        }}
      >
        Take it
      </Button>
    );
  }
  return <span className="text-xs text-muted-foreground">{task.teamName ? `${task.teamName} (team)` : 'Unassigned'}</span>;
}

function TaskRow({
  task,
  today,
  viewerId,
  canEdit,
  busy,
  onOpen,
  onToggle,
  onTake,
}: {
  task: OfficeHubTask;
  today: string;
  viewerId: string;
  canEdit: boolean;
  busy: boolean;
  onOpen: () => void;
  onToggle: () => void;
  onTake: () => void;
}) {
  const done = task.status === 'Completed';
  const checklist = subtaskCompletion(task.subtasks);
  return (
    <tr onClick={onOpen} className="cursor-pointer border-b transition-colors hover:bg-primary/[0.04]">
      <td className="px-3 py-2.5">
        <DoneTick done={done} disabled={!canEdit || busy || task.status === 'Cancelled'} onToggle={onToggle} label={`${done ? 'Reopen' : 'Complete'} ${task.title}`} />
      </td>
      <td className="max-w-[380px] px-3 py-2.5">
        <span className={cn('block truncate text-[13px] font-bold leading-snug', done && 'text-muted-foreground line-through')}>{task.title}</span>
        <span className="flex flex-wrap items-center gap-1 text-[11px] font-bold text-muted-foreground">
          {task.reference}
          {(task.tags ?? []).slice(0, 3).map((tag) => (
            <span key={tag} className="rounded-md bg-primary/10 px-1.5 text-[10.5px] text-primary">
              #{tag}
            </span>
          ))}
        </span>
      </td>
      <td className="px-3 py-2.5">
        <AssigneeCell task={task} viewerId={viewerId} canEdit={canEdit} busy={busy} onTake={onTake} />
      </td>
      <td className="hidden max-w-[220px] px-3 py-2.5 xl:table-cell">
        <span className="block truncate text-xs font-semibold text-muted-foreground">{task.projectName ?? '—'}</span>
        <span className="block truncate text-[11px] font-bold text-muted-foreground/80">{task.teamName ?? task.departmentName ?? ''}</span>
      </td>
      <td className="px-3 py-2.5">
        <DueCell task={task} today={today} />
      </td>
      <td className="px-3 py-2.5">
        <PriorityBars priority={task.priority} />
      </td>
      <td className="hidden px-3 py-2.5 xl:table-cell">
        {checklist.total ? (
          <span className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground">
            <span className="h-[5px] w-[54px] overflow-hidden rounded-full bg-muted">
              <i className="block h-full bg-emerald-600" style={{ width: `${(checklist.done / checklist.total) * 100}%` }} />
            </span>
            {checklist.done}/{checklist.total}
          </span>
        ) : (
          <span className="text-[11px] font-bold text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 py-2.5">
        <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold', STATUS_CHIP[task.status])}>
          <i aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
          {task.status}
        </span>
      </td>
      <td className="px-3 py-2.5 text-muted-foreground">
        <ChevronRight className="h-4 w-4" aria-hidden />
      </td>
    </tr>
  );
}

function TaskCard({
  task,
  today,
  viewerId,
  canEdit,
  busy,
  onToggle,
}: {
  task: OfficeHubTask;
  today: string;
  viewerId: string;
  canEdit: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  const done = task.status === 'Completed';
  return (
    <li className="flex items-start gap-2.5 border-b px-3.5 py-3">
      <span className="pt-0.5">
        <DoneTick done={done} disabled={!canEdit || busy || task.status === 'Cancelled'} onToggle={onToggle} label={`${done ? 'Reopen' : 'Complete'} ${task.title}`} />
      </span>
      <Link href={`${BASE}/tasks/${task.id}`} className="min-w-0 flex-1">
        <b className={cn('block text-[13px] leading-snug', done && 'text-muted-foreground line-through')}>{task.title}</b>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted-foreground">
          <span className="font-bold">{task.reference}</span>
          <span>{task.assigneeId === viewerId ? 'You' : task.assigneeName ?? task.teamName ?? 'Unassigned'}</span>
          <span className={cn('font-bold', isTaskOverdue(task, today) && 'text-rose-600')}>{relativeDue(task.dueDate, today)}</span>
          <span className={cn('inline-flex rounded-full px-2 py-px text-[10.5px] font-bold', STATUS_CHIP[task.status])}>{task.status}</span>
        </span>
      </Link>
      <PriorityBars priority={task.priority} />
    </li>
  );
}

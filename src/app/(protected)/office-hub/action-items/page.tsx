'use client';

/**
 * The action item register (§22). Redesigned 2026-11-07 from the user's mockup
 * (`sel-decisions-actions-teams-redesign.html`): a pink band whose figures filter, a banner for the
 * items nothing is reminding anybody about, and the items grouped under the meeting that raised them.
 *
 * The gap between "agreed" and "tracked" is the point of the page, so:
 *   • "Turn into task" creates the task in one click whenever the item already names who does it —
 *     `taskDraftFromActionItem` carries everything over (§23) — and opens the prefilled form when it
 *     does not, so nobody is guessed.
 *   • "Turn all into tasks" does the same for every untracked item that can be converted, after a
 *     confirmation that says how many people will be notified.
 *   • The round tick completes an item. When it already has a task, the task is completed too (that
 *     in turn closes the item, §23); if the viewer may not change that task, the item is closed alone
 *     and the screen says the task is still open.
 *
 * Left out from the mockup on purpose: its "Your data / Sample data" preview switch.
 */

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { BellRing, CalendarDays, Circle, CircleCheck, CircleDot, Download, Link2, Plus, Search, SquareCheck, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { useToast } from '@/hooks/use-toast';
import {
  ACTION_ITEM_STATUSES,
  ACTION_TABS,
  OFFICE_HUB_BASE_PATH,
  OFFICE_HUB_PRIORITIES,
  addDays,
  applyActionItemFilters,
  buildActionItemReport,
  canBecomeTask,
  canEditActionItem,
  groupActionItemsByMeeting,
  inActionTab,
  isActionItemOverdue,
  taskDraftFromActionItem,
  type ActionItemFilters,
  type ActionItemStatus,
  type ActionTab,
  type OfficeHubActionItem,
  type OfficeHubPriority,
} from '@/lib/office-hub';
import { createTask, listActionItems, listDecisionReferences, listMeetings, setTaskStatus, updateActionItem } from '@/lib/office-hub-service';
import { useDebouncedValue, useOfficeHub, useOfficeHubAction, useOfficeHubQuery } from '@/components/office-hub/hooks';
import { OfficeHubAccessDenied } from '@/components/office-hub/ui';
import { MultiSelect } from '@/components/office-hub/selectors';
import { ActionItemDialog, CreateTaskFromActionItemDialog, actionItemDraftFor } from '@/components/office-hub/decision-forms';
import { ActionGroupHeader, ActionRow, HowActionItemsWork } from '@/components/office-hub/follow-up-rows';
import { EmptyPanel, FilterBox, HeroButton, RegisterHero, RegisterTabs, SearchBox, type HeroFigureSpec } from '@/components/office-hub/register-parts';

const BASE = OFFICE_HUB_BASE_PATH;

export default function ActionItemsPage() {
  const { actor, viewer, capabilities, settings, directory, today, isLoading } = useOfficeHub();
  const { isBusy, run } = useOfficeHubAction();
  const { toast } = useToast();

  const [tab, setTab] = useState<ActionTab>('open');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [filters, setFilters] = useState<ActionItemFilters>({});
  const [converting, setConverting] = useState<OfficeHubActionItem | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [adding, setAdding] = useState<ReturnType<typeof actionItemDraftFor> | null>(null);

  // The meetings an item can be raised in from here: the ones the viewer took part in lately.
  const recentMeetings = useOfficeHubQuery(
    () => listMeetings('mine', viewer, { fromDate: addDays(today, -120), toDate: addDays(today, 1), direction: 'desc', limit: 80 }),
    [viewer.userId, today],
    { enabled: Boolean(adding), initial: [] },
  );
  const meetingChoices = useMemo(
    () =>
      (recentMeetings.data ?? [])
        .filter((meeting) => meeting.status !== 'Draft' && meeting.status !== 'Cancelled' && meeting.status !== 'Postponed')
        .map((meeting) => ({ id: meeting.id, title: meeting.title, date: meeting.date, seriesId: meeting.seriesId ?? null })),
    [recentMeetings.data],
  );

  const itemsQuery = useOfficeHubQuery(
    () =>
      capabilities.canViewAllMeetings || capabilities.canEditAnyActionItem
        ? listActionItems({ limit: 500 })
        : listActionItems({ responsibleUserId: viewer.userId, limit: 400 }),
    [capabilities.canViewAllMeetings, capabilities.canEditAnyActionItem, viewer.userId],
    { enabled: capabilities.canViewActionItems, initial: [] },
  );

  const all = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data]);
  const decisionIds = useMemo(() => [...new Set(all.map((item) => item.decisionId).filter((id): id is string => Boolean(id)))].sort(), [all]);
  const referencesQuery = useOfficeHubQuery(() => listDecisionReferences(decisionIds), [decisionIds.join(',')], {
    enabled: decisionIds.length > 0,
    initial: new Map<string, string>(),
  });

  const context = useMemo(() => ({ today, viewerId: viewer.userId }), [today, viewer.userId]);
  const filtered = useMemo(() => applyActionItemFilters(all, { ...filters, search: debouncedSearch }, today), [all, filters, debouncedSearch, today]);
  const inTab = useMemo(() => filtered.filter((item) => inActionTab(item, tab, context)), [filtered, tab, context]);
  const groups = useMemo(() => groupActionItemsByMeeting(inTab), [inTab]);
  const report = useMemo(() => buildActionItemReport(all, today), [all, today]);
  const untracked = useMemo(() => all.filter((item) => inActionTab(item, 'untracked', context)), [all, context]);
  const convertible = useMemo(() => untracked.filter(canBecomeTask), [untracked]);
  const convertiblePeople = useMemo(
    () => new Set(convertible.map((item) => item.responsibleUserId ?? item.responsibleTeamId ?? '')).size,
    [convertible],
  );

  const statuses = filters.statuses ?? [];
  const pickStatus = (status: ActionItemStatus) => {
    setTab('all');
    setFilters((current) => ({ ...current, statuses: statuses.length === 1 && statuses[0] === status ? [] : [status] }));
  };
  const clearFilters = () => {
    setFilters({});
    setSearch('');
  };
  const filterCount =
    (statuses.length ? 1 : 0) +
    (filters.responsibleIds?.length ? 1 : 0) +
    (filters.teamIds?.length ? 1 : 0) +
    (filters.priorities?.length ? 1 : 0) +
    (debouncedSearch.trim() ? 1 : 0);

  /** Creates the task an item becomes and links it; the service writes the link back (§23). */
  const raiseTask = async (item: OfficeHubActionItem) => {
    if (!actor) throw new Error('Not signed in');
    const draft = taskDraftFromActionItem(item, today);
    const teamLeaderId = draft.teamId ? directory.teams.find((team) => team.id === draft.teamId)?.leaderId ?? null : null;
    return createTask(
      actor,
      {
        title: draft.title,
        description: draft.description ?? null,
        assigneeId: draft.assigneeId ?? null,
        assigneeName: draft.assigneeName ?? null,
        teamId: draft.teamId ?? null,
        teamName: draft.teamName ?? null,
        departmentId: draft.departmentId ?? null,
        departmentName: draft.departmentName ?? null,
        startDate: draft.startDate ?? today,
        dueDate: draft.dueDate ?? null,
        priority: draft.priority ?? 'Medium',
        status: 'Not Started',
        progress: 0,
        meetingId: item.meetingId ?? null,
        meetingTitle: item.meetingTitle ?? null,
        actionItemId: item.id,
        decisionId: item.decisionId ?? null,
      },
      { settings, teamLeaderId },
    );
  };

  const turnIntoTask = async (item: OfficeHubActionItem) => {
    if (!canBecomeTask(item)) {
      setConverting(item);
      return;
    }
    const who = item.responsibleUserName?.split(' ')[0] ?? item.responsibleTeamName ?? 'They';
    const id = await run(() => raiseTask(item), {
      success: `Task created · ${who} will get reminders`,
      failure: 'Could not create the task',
      describe: 'Turn action item into task',
    });
    if (id) itemsQuery.reload();
  };

  const turnAllIntoTasks = async () => {
    const list = convertible;
    setBulkProgress({ done: 0, total: list.length });
    const outcome = await run(
      async () => {
        let created = 0;
        let failed = 0;
        // One at a time: each task takes a reference number from the same counter.
        for (const item of list) {
          try {
            await raiseTask(item);
            created += 1;
          } catch (caught) {
            console.error('[office-hub] Could not raise a task from', item.reference, caught);
            failed += 1;
          }
          setBulkProgress({ done: created + failed, total: list.length });
        }
        return { created, failed };
      },
      { failure: 'Could not create the tasks', describe: 'Turn all action items into tasks' },
    );
    setBulkProgress(null);
    setConfirmAll(false);
    if (outcome) {
      toast({
        title: `${outcome.created} task${outcome.created === 1 ? '' : 's'} created · reminders switched on`,
        description: outcome.failed ? `${outcome.failed} could not be created; they are still in the Untracked tab.` : undefined,
        variant: outcome.failed ? 'destructive' : undefined,
      });
    }
    itemsQuery.reload();
  };

  const toggleDone = async (item: OfficeHubActionItem) => {
    if (!actor) return;
    if (item.status === 'Completed') {
      const ok = await run(
        async () => {
          await updateActionItem(actor, item.id, { status: 'Open', completedAt: null });
          return true;
        },
        { success: `${item.reference} reopened`, failure: 'Could not reopen the action item', describe: 'Reopen action item' },
      );
      if (ok) itemsQuery.reload();
      return;
    }
    const taskClosed = await run(
      async () => {
        let closed = false;
        if (item.taskId) {
          try {
            await setTaskStatus(actor, item.taskId, 'Completed', { settings });
            closed = true;
          } catch (caught) {
            console.warn('[office-hub] The linked task could not be completed', caught);
          }
        }
        await updateActionItem(actor, item.id, { status: 'Completed' });
        return closed;
      },
      { failure: 'Could not complete the action item', describe: 'Complete action item' },
    );
    if (taskClosed === null) return;
    toast({
      title: `${item.reference} done${taskClosed ? ' · its task is closed too' : ''}`,
      description: item.taskId && !taskClosed ? 'Its task is still open — you cannot change that task, so ask its assignee to close it.' : undefined,
    });
    itemsQuery.reload();
  };

  const exportRows = async () => {
    const { exportRowsToExcel } = await import('@/lib/report-excel');
    await exportRowsToExcel(
      'Action items',
      inTab.map((item) => ({
        Reference: item.reference,
        Action: item.title,
        Responsible: item.responsibleUserName || item.responsibleTeamName || '',
        Team: item.responsibleTeamName ?? '',
        Department: item.departmentName ?? '',
        'Due date': item.dueDate ?? '',
        Overdue: isActionItemOverdue(item, today) ? 'Yes' : 'No',
        Priority: item.priority,
        Status: item.status,
        Meeting: item.meetingTitle ?? '',
        'Meeting date': item.meetingDate ?? '',
        Decision: item.decisionId ? referencesQuery.data?.get(item.decisionId) ?? 'Yes' : '',
        'Task raised': item.taskId ? 'Yes' : 'No',
      })),
      { filename: `office-hub-action-items-${today}.xlsx` },
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-44 w-full rounded-[22px]" />
        <Skeleton className="h-[28rem] w-full rounded-[18px]" />
      </div>
    );
  }
  if (!capabilities.canViewActionItems) return <OfficeHubAccessDenied what="action items" />;

  const figures: HeroFigureSpec[] = [
    { key: 'total', label: 'Total', value: report.total, icon: SquareCheck, tone: ['#fbcfe8', '#be185d'], on: tab === 'all' && !statuses.length, onPick: () => { setTab('all'); setFilters((current) => ({ ...current, statuses: [] })); } },
    { key: 'open', label: 'Open', value: report.open, icon: Circle, tone: ['#c4b5fd', '#6d28d9'], on: statuses.length === 1 && statuses[0] === 'Open', onPick: () => pickStatus('Open') },
    { key: 'ip', label: 'In progress', value: report.inProgress, icon: CircleDot, tone: ['#93c5fd', '#1d4ed8'], on: statuses.length === 1 && statuses[0] === 'In Progress', onPick: () => pickStatus('In Progress') },
    { key: 'done', label: 'Completed', value: report.completed, icon: CircleCheck, tone: ['#86efac', '#15803d'], on: statuses.length === 1 && statuses[0] === 'Completed', onPick: () => pickStatus('Completed') },
    {
      key: 'untracked',
      label: 'No task yet',
      value: untracked.length,
      icon: BellRing,
      tone: ['#fcd34d', '#b45309'],
      on: tab === 'untracked',
      alert: untracked.length > 0,
      hint: untracked.length ? 'nobody is being reminded' : 'all tracked',
      onPick: () => { setTab('untracked'); setFilters((current) => ({ ...current, statuses: [] })); },
    },
  ];

  const showBanner = untracked.length > 0 && tab !== 'all' && !(statuses.length === 1 && statuses[0] === 'Completed');

  return (
    <div className="space-y-3.5">
      <RegisterHero
        tone="rose"
        eyebrow="Action items"
        title="Action items"
        subtitle="What meetings asked for. Turn one into a task and it starts reminding people."
        loading={itemsQuery.isLoading}
        figures={figures}
        actions={
          <>
            <HeroButton onClick={() => void exportRows()} disabled={!inTab.length}>
              <Download className="h-3.5 w-3.5" aria-hidden />
              Export
            </HeroButton>
            {capabilities.canCreateActionItem && (
              <HeroButton primary onClick={() => setAdding(actionItemDraftFor({ viewer }))}>
                <Plus className="h-3.5 w-3.5" aria-hidden />
                Add action item
              </HeroButton>
            )}
          </>
        }
      />

      <section className="overflow-hidden rounded-[18px] border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b px-3.5 pt-2.5">
          <RegisterTabs
            tone="rose"
            label="Which action items"
            value={tab}
            onChange={setTab}
            tabs={ACTION_TABS.map((entry) => ({ ...entry, count: filtered.filter((item) => inActionTab(item, entry.value, context)).length }))}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3.5 py-3">
          <SearchBox value={search} onChange={setSearch} placeholder="Reference, action, person, meeting…" label="Search action items" />
          <FilterBox>
            <MultiSelect
              placeholder="Anyone responsible"
              options={directory.people.map((person) => ({ value: person.userId, label: person.name, hint: person.departmentName ?? undefined }))}
              value={filters.responsibleIds ?? []}
              onChange={(next) => setFilters((current) => ({ ...current, responsibleIds: next }))}
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
              placeholder="Any status"
              options={ACTION_ITEM_STATUSES.map((status) => ({ value: status, label: status }))}
              value={statuses}
              onChange={(next) => setFilters((current) => ({ ...current, statuses: next as ActionItemStatus[] }))}
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
          <span className="hidden flex-1 lg:block" />
          {filterCount > 0 && (
            <Button type="button" variant="ghost" size="sm" className="h-9 gap-1" onClick={clearFilters}>
              <X className="h-3.5 w-3.5" aria-hidden />
              Clear
            </Button>
          )}
        </div>

        {showBanner && !itemsQuery.isLoading && (
          <div className="flex flex-wrap items-center gap-3 border-b border-pink-200 bg-gradient-to-r from-pink-50 to-orange-50 px-3.5 py-2.5 text-[12.5px]">
            <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] bg-gradient-to-br from-amber-300 to-amber-700 text-white">
              <BellRing className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 flex-1 basis-64">
              <b>
                {untracked.length} action item{untracked.length === 1 ? ' is' : 's are'} not tracked as tasks.
              </b>{' '}
              Nobody gets a reminder until each one becomes a task.
              {capabilities.canConvertActionItem && convertible.length < untracked.length && (
                <span className="text-muted-foreground">
                  {' '}
                  {untracked.length - convertible.length === 1
                    ? 'One names nobody responsible, so it needs the form.'
                    : `${untracked.length - convertible.length} name nobody responsible, so they need the form.`}
                </span>
              )}
            </span>
            {capabilities.canConvertActionItem && convertible.length > 0 && (
              <Button size="sm" disabled={isBusy} onClick={() => setConfirmAll(true)} className="gap-1.5 bg-gradient-to-r from-pink-600 to-orange-600 text-white">
                <Link2 className="h-3.5 w-3.5" aria-hidden />
                {convertible.length === untracked.length ? `Turn all ${convertible.length} into tasks` : `Turn ${convertible.length} into tasks`}
              </Button>
            )}
          </div>
        )}

        {itemsQuery.isLoading ? (
          <div className="space-y-2 p-3.5">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-24 w-full rounded-xl" />
            ))}
          </div>
        ) : groups.length === 0 ? (
          all.length === 0 ? (
            <EmptyPanel
              icon={SquareCheck}
              tone={['#f9a8d4', '#be185d']}
              title="No action items yet"
              body="Action items come from meeting minutes. Add them while writing minutes, or record one here and link it to a meeting."
              action={
                capabilities.canCreateActionItem ? (
                  <Button size="sm" onClick={() => setAdding(actionItemDraftFor({ viewer }))} className="gap-1.5 bg-gradient-to-r from-pink-600 to-orange-600 text-white">
                    <Plus className="h-3.5 w-3.5" aria-hidden />
                    Add an action item
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" asChild className="gap-1.5">
                    <Link href={`${BASE}/meetings`}>
                      <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                      Open meetings
                    </Link>
                  </Button>
                )
              }
              aside={<HowActionItemsWork />}
            />
          ) : (
            <EmptyPanel
              icon={tab === 'untracked' && !filterCount ? CircleCheck : Search}
              tone={tab === 'untracked' && !filterCount ? ['#86efac', '#15803d'] : ['#e2e8f0', '#94a3b8']}
              title={tab === 'untracked' && !filterCount ? 'Every open action item has a task' : tab === 'overdue' && !filterCount ? 'Nothing is overdue' : 'No action items match'}
              body={tab === 'untracked' && !filterCount ? 'Everything agreed in a meeting is being tracked.' : 'Clear a filter or pick another tab.'}
              action={
                filterCount > 0 ? (
                  <Button size="sm" variant="outline" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          )
        ) : (
          groups.map((group) => (
            <div key={group.key} className="border-t border-border/60 first:border-t-0">
              <ActionGroupHeader group={group} />
              <ul>
                {group.items.map((item) => (
                  <ActionRow
                    key={item.id}
                    item={item}
                    today={today}
                    viewerId={viewer.userId}
                    decisionReference={item.decisionId ? referencesQuery.data?.get(item.decisionId) ?? null : null}
                    canTick={canEditActionItem(item, viewer, capabilities).allowed}
                    canConvert={capabilities.canConvertActionItem}
                    busy={isBusy}
                    onToggle={() => void toggleDone(item)}
                    onConvert={() => void turnIntoTask(item)}
                  />
                ))}
              </ul>
            </div>
          ))
        )}

        <div className="flex flex-wrap items-center gap-2 border-t px-3.5 py-2.5 text-xs text-muted-foreground">
          {inTab.length} action item{inTab.length === 1 ? '' : 's'} · grouped by the meeting that raised them
        </div>
      </section>

      {converting && (
        <CreateTaskFromActionItemDialog
          item={converting}
          meeting={converting.meetingId ? { id: converting.meetingId, title: converting.meetingTitle ?? 'Meeting', projectId: null, projectName: null } : null}
          open
          onOpenChange={(open) => !open && setConverting(null)}
          onCreated={() => {
            setConverting(null);
            itemsQuery.reload();
          }}
        />
      )}

      {adding && (
        <ActionItemDialog
          open
          onOpenChange={(open) => !open && setAdding(null)}
          draft={adding}
          setDraft={setAdding}
          meetingChoices={meetingChoices}
          onSaved={() => itemsQuery.reload()}
        />
      )}

      <ConfirmDialog
        open={confirmAll}
        onOpenChange={(open) => !open && !bulkProgress && setConfirmAll(false)}
        title={`Turn ${convertible.length} action item${convertible.length === 1 ? '' : 's'} into tasks?`}
        description={
          bulkProgress
            ? `Creating ${bulkProgress.done + 1 > bulkProgress.total ? bulkProgress.total : bulkProgress.done + 1} of ${bulkProgress.total}…`
            : `Each becomes a task for the person or team already responsible, with its due date and priority. ${convertiblePeople} ${convertiblePeople === 1 ? 'person or team is' : 'people or teams are'} notified and start getting reminders.`
        }
        confirmLabel={`Create ${convertible.length} task${convertible.length === 1 ? '' : 's'}`}
        loading={isBusy}
        onConfirm={turnAllIntoTasks}
      />
    </div>
  );
}

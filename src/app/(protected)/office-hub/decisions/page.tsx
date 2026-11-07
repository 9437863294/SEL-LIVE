'use client';

/**
 * The Decision Register (§21). Redesigned 2026-11-07 from the user's mockup
 * (`sel-decisions-actions-teams-redesign.html`): a violet band whose figures filter, tabs, filters,
 * then decisions as cards under month headings, a side drawer, and a record-a-decision window.
 *
 * A decision taken in a meeting is the thing most likely to be forgotten, because unlike a task
 * nobody is assigned to *do* it — somebody is assigned to see it through. So overdue follow-ups are
 * pinned above the months on every tab: a register sorted only by date reads like a history, and
 * what a reader needs first is what has been sitting.
 *
 * Each card shows how many of the decision's action items are done, counted over every action item
 * raised from it (one `decisionId != null` query), not only the ones the viewer is responsible for.
 *
 * Left out from the mockup on purpose: its "Decisions teams usually record" sample suggestions,
 * and its "Your data / Sample data" preview switch.
 */

import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, Circle, CircleCheck, CircleDot, Download, Gavel, Plus, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DECISION_STATUSES,
  DECISION_TABS,
  OFFICE_HUB_PRIORITIES,
  actionProgressByDecision,
  applyDecisionFilters,
  buildDecisionReport,
  canEditDecision,
  groupDecisions,
  inDecisionTab,
  isDecisionOverdue,
  type DecisionFilters,
  type DecisionStatus,
  type DecisionTab,
  type OfficeHubDecision,
  type OfficeHubPriority,
} from '@/lib/office-hub';
import { getMeeting, listDecisionActionItems, listDecisions, updateDecision } from '@/lib/office-hub-service';
import { useDebouncedValue, useOfficeHub, useOfficeHubAction, useOfficeHubQuery } from '@/components/office-hub/hooks';
import { OfficeHubAccessDenied } from '@/components/office-hub/ui';
import { MultiSelect } from '@/components/office-hub/selectors';
import { ActionItemDialog, actionItemDraftFor } from '@/components/office-hub/decision-forms';
import { DecisionWindow } from '@/components/office-hub/decision-window';
import { DecisionDrawer } from '@/components/office-hub/decision-drawer';
import { DecisionCard } from '@/components/office-hub/follow-up-rows';
import {
  EmptyPanel,
  FilterBox,
  GroupHeading,
  HeroButton,
  RegisterHero,
  RegisterTabs,
  SearchBox,
  type HeroFigureSpec,
} from '@/components/office-hub/register-parts';

type ActionDraft = ReturnType<typeof actionItemDraftFor>;
type DraftMeeting = { id: string; title: string; date: string; seriesId?: string | null } | null;

export default function DecisionsPage() {
  const searchParams = useSearchParams();
  const { actor, viewer, capabilities, settings, directory, today, isLoading } = useOfficeHub();
  const { isBusy, run } = useOfficeHubAction();

  const [tab, setTab] = useState<DecisionTab>('open');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [filters, setFilters] = useState<DecisionFilters>({});
  const [windowFor, setWindowFor] = useState<{ decision: OfficeHubDecision | null; key: number } | null>(
    searchParams?.get('new') === '1' ? { decision: null, key: 0 } : null,
  );
  const [openId, setOpenId] = useState<string | null>(null);
  const [actionDraft, setActionDraft] = useState<{ draft: ActionDraft; meeting: DraftMeeting } | null>(null);

  const decisionsQuery = useOfficeHubQuery(
    () =>
      // A viewer without `View All` still gets the register, narrowed to the decisions they own.
      capabilities.canViewAllDecisions ? listDecisions({ limit: 400 }) : listDecisions({ ownerId: viewer.userId, limit: 400 }),
    [capabilities.canViewAllDecisions, viewer.userId],
    { enabled: capabilities.canViewDecisions, initial: [] },
  );
  const actionsQuery = useOfficeHubQuery(() => listDecisionActionItems(), [], {
    enabled: capabilities.canViewDecisions && capabilities.canViewActionItems,
    initial: [],
  });

  const all = useMemo(() => decisionsQuery.data ?? [], [decisionsQuery.data]);
  const actionsKnown = capabilities.canViewActionItems && !actionsQuery.error;
  const progress = useMemo(() => actionProgressByDecision(actionsQuery.data ?? []), [actionsQuery.data]);
  const context = useMemo(() => ({ today, viewerId: viewer.userId }), [today, viewer.userId]);
  const filtered = useMemo(() => applyDecisionFilters(all, { ...filters, search: debouncedSearch }, today), [all, filters, debouncedSearch, today]);
  const inTab = useMemo(() => filtered.filter((decision) => inDecisionTab(decision, tab, context)), [filtered, tab, context]);
  const groups = useMemo(() => groupDecisions(inTab, today, { pinOverdue: tab !== 'overdue' }), [inTab, today, tab]);
  const report = useMemo(() => buildDecisionReport(all, today), [all, today]);

  const opened = all.find((decision) => decision.id === openId) ?? null;
  const openedActions = useMemo(() => (actionsQuery.data ?? []).filter((item) => item.decisionId === openId), [actionsQuery.data, openId]);

  const statuses = filters.statuses ?? [];
  const pickStatus = (status: DecisionStatus) => {
    setTab('all');
    setFilters((current) => ({ ...current, statuses: statuses.length === 1 && statuses[0] === status ? [] : [status] }));
  };
  const clearFilters = () => {
    setFilters({});
    setSearch('');
  };
  const filterCount =
    (statuses.length ? 1 : 0) +
    (filters.ownerIds?.length ? 1 : 0) +
    (filters.departmentIds?.length ? 1 : 0) +
    (filters.priorities?.length ? 1 : 0) +
    (filters.projectIds?.length ? 1 : 0) +
    (filters.fromDate || filters.toDate ? 1 : 0) +
    (debouncedSearch.trim() ? 1 : 0);

  const setStatus = async (decision: OfficeHubDecision, status: DecisionStatus) => {
    if (!actor) return;
    const label = status === 'Completed' ? 'seen through' : status === 'In Progress' ? 'in progress' : 'reopened';
    const done = await run(
      async () => {
        await updateDecision(actor, decision.id, { status }, { settings });
        return true;
      },
      { success: `${decision.reference} · ${label}`, failure: 'Could not change the decision', describe: 'Change decision status' },
    );
    if (done) decisionsQuery.reload();
  };

  const addAction = async (decision: OfficeHubDecision) => {
    // The meeting is read for its date and series, so the item carries forward with the series.
    const meeting = decision.meetingId ? await getMeeting(decision.meetingId).catch(() => null) : null;
    setOpenId(null);
    setActionDraft({
      draft: {
        ...actionItemDraftFor({ viewer, decisionId: decision.id }),
        responsibleUserId: decision.ownerId,
        responsibleUserName: decision.ownerName,
        departmentId: decision.departmentId ?? null,
        departmentName: decision.departmentName ?? null,
        dueDate: decision.dueDate ?? null,
        priority: decision.priority,
      },
      meeting: meeting
        ? { id: meeting.id, title: meeting.title, date: meeting.date, seriesId: meeting.seriesId ?? null }
        : decision.meetingId
          ? { id: decision.meetingId, title: decision.meetingTitle ?? 'Meeting', date: decision.decisionDate, seriesId: null }
          : null,
    });
  };

  const exportRows = async () => {
    const { exportRowsToExcel } = await import('@/lib/report-excel');
    await exportRowsToExcel(
      'Decisions',
      inTab.map((decision) => {
        const actions = progress.get(decision.id);
        return {
          Reference: decision.reference,
          Decision: decision.title,
          'Decision date': decision.decisionDate,
          Owner: decision.ownerName,
          Department: decision.departmentName ?? '',
          Priority: decision.priority,
          Status: decision.status,
          'Follow-up due': decision.dueDate ?? '',
          Overdue: isDecisionOverdue(decision, today) ? 'Yes' : 'No',
          'Action items done': actions ? `${actions.done}/${actions.total}` : '',
          Meeting: decision.meetingTitle ?? '',
          Project: decision.projectName ?? '',
          Background: decision.description ?? '',
        };
      }),
      { filename: `office-hub-decisions-${today}.xlsx` },
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
  if (!capabilities.canViewDecisions) return <OfficeHubAccessDenied what="the decision register" />;

  const completedShare = report.total ? Math.round((report.completed / report.total) * 100) : 0;
  const figures: HeroFigureSpec[] = [
    { key: 'total', label: 'Total', value: report.total, icon: Gavel, tone: ['#e0e7ff', '#6366f1'], on: tab === 'all' && !statuses.length, onPick: () => { setTab('all'); setFilters((current) => ({ ...current, statuses: [] })); } },
    { key: 'open', label: 'Open', value: report.open, icon: Circle, tone: ['#c4b5fd', '#6d28d9'], on: statuses.length === 1 && statuses[0] === 'Open', onPick: () => pickStatus('Open') },
    { key: 'ip', label: 'In progress', value: report.inProgress, icon: CircleDot, tone: ['#93c5fd', '#1d4ed8'], on: statuses.length === 1 && statuses[0] === 'In Progress', onPick: () => pickStatus('In Progress') },
    {
      key: 'done',
      label: 'Completed',
      value: report.completed,
      icon: CircleCheck,
      tone: ['#86efac', '#15803d'],
      on: statuses.length === 1 && statuses[0] === 'Completed',
      hint: report.total ? `${completedShare}% seen through` : null,
      onPick: () => pickStatus('Completed'),
    },
    {
      key: 'late',
      label: 'Follow-up overdue',
      value: report.overdue,
      icon: AlertTriangle,
      tone: ['#fda4af', '#be123c'],
      on: tab === 'overdue',
      alert: report.overdue > 0,
      onPick: () => { setTab('overdue'); setFilters((current) => ({ ...current, statuses: [] })); },
    },
  ];

  return (
    <div className="space-y-3.5">
      <RegisterHero
        tone="violet"
        eyebrow="Decisions"
        title="Decision register"
        subtitle="Every decision taken in a meeting, who owns it, and whether it has been seen through."
        loading={decisionsQuery.isLoading}
        figures={figures}
        actions={
          <>
            <HeroButton onClick={() => void exportRows()} disabled={!inTab.length}>
              <Download className="h-3.5 w-3.5" aria-hidden />
              Export
            </HeroButton>
            {capabilities.canCreateDecision && (
              <HeroButton primary onClick={() => setWindowFor({ decision: null, key: Date.now() })}>
                <Plus className="h-3.5 w-3.5" aria-hidden />
                Record a decision
              </HeroButton>
            )}
          </>
        }
      />

      <section className="overflow-hidden rounded-[18px] border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b px-3.5 pt-2.5">
          <RegisterTabs
            tone="violet"
            label="Which decisions"
            value={tab}
            onChange={setTab}
            tabs={DECISION_TABS.map((entry) => ({ ...entry, count: filtered.filter((decision) => inDecisionTab(decision, entry.value, context)).length }))}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3.5 py-3">
          <SearchBox value={search} onChange={setSearch} placeholder="Reference, decision, owner…" label="Search decisions" />
          <label className="flex h-9 items-center gap-1.5 rounded-[10px] border px-2.5 text-xs font-semibold text-muted-foreground">
            Taken
            <input
              type="date"
              value={filters.fromDate ?? ''}
              max={filters.toDate ?? undefined}
              onChange={(event) => setFilters((current) => ({ ...current, fromDate: event.target.value || undefined }))}
              className="bg-transparent font-semibold text-foreground outline-none"
              aria-label="Taken from"
            />
            to
            <input
              type="date"
              value={filters.toDate ?? ''}
              min={filters.fromDate ?? undefined}
              onChange={(event) => setFilters((current) => ({ ...current, toDate: event.target.value || undefined }))}
              className="bg-transparent font-semibold text-foreground outline-none"
              aria-label="Taken to"
            />
          </label>
          <FilterBox>
            <MultiSelect
              placeholder="Any status"
              options={DECISION_STATUSES.map((status) => ({ value: status, label: status }))}
              value={statuses}
              onChange={(next) => setFilters((current) => ({ ...current, statuses: next as DecisionStatus[] }))}
            />
          </FilterBox>
          <FilterBox>
            <MultiSelect
              placeholder="Any owner"
              options={directory.people.map((person) => ({ value: person.userId, label: person.name, hint: person.departmentName ?? undefined }))}
              value={filters.ownerIds ?? []}
              onChange={(next) => setFilters((current) => ({ ...current, ownerIds: next }))}
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
              placeholder="Any priority"
              options={OFFICE_HUB_PRIORITIES.map((priority) => ({ value: priority, label: priority }))}
              value={filters.priorities ?? []}
              onChange={(next) => setFilters((current) => ({ ...current, priorities: next as OfficeHubPriority[] }))}
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
              Clear
            </Button>
          )}
        </div>

        {decisionsQuery.isLoading ? (
          <div className="space-y-2 p-3.5">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-[84px] w-full rounded-[15px]" />
            ))}
          </div>
        ) : groups.length === 0 ? (
          all.length === 0 ? (
            <EmptyPanel
              icon={Gavel}
              tone={['#c4b5fd', '#6d28d9']}
              title="No decisions recorded yet"
              body="Record what was agreed in a meeting, who owns it and when to check on it. Six months from now nobody will have to remember why."
              action={
                capabilities.canCreateDecision ? (
                  <Button size="sm" onClick={() => setWindowFor({ decision: null, key: Date.now() })} className="gap-1.5 bg-gradient-to-r from-primary to-indigo-600 text-white">
                    <Plus className="h-3.5 w-3.5" aria-hidden />
                    Record the first decision
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <EmptyPanel
              icon={tab === 'overdue' && !filterCount ? CircleCheck : Search}
              tone={tab === 'overdue' && !filterCount ? ['#86efac', '#15803d'] : ['#e2e8f0', '#94a3b8']}
              title={tab === 'overdue' && !filterCount ? 'No follow-up is overdue' : 'No decisions match'}
              body={tab === 'overdue' && !filterCount ? 'Every decision with a follow-up date is on time.' : 'Try another tab, clear a filter or widen the date range.'}
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
          <div className="pb-2.5">
            {groups.map((group) => (
              <div key={group.key}>
                <GroupHeading tone={group.overdue ? 'late' : undefined} count={group.overdue ? group.items.length : undefined}>
                  {group.label}
                </GroupHeading>
                <div className="grid gap-2 px-3.5 pb-1.5 pt-1">
                  {group.items.map((decision) => (
                    <DecisionCard
                      key={decision.id}
                      decision={decision}
                      today={today}
                      viewerId={viewer.userId}
                      actions={actionsKnown ? progress.get(decision.id) ?? null : null}
                      onOpen={() => setOpenId(decision.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t px-3.5 py-2.5 text-xs text-muted-foreground">
          <span>
            {inTab.length} decision{inTab.length === 1 ? '' : 's'}
            {tab !== 'overdue' && groups.some((group) => group.overdue) ? ' · overdue follow-ups first, then newest' : ' · newest first'}
          </span>
          <span className="flex-1" />
          {report.ageing.some((row) => row.count > 0) && (
            <span>
              Open by age:{' '}
              {report.ageing
                .filter((row) => row.count > 0)
                .map((row) => `${row.label} ${row.count}`)
                .join(' · ')}
            </span>
          )}
        </div>
      </section>

      <DecisionDrawer
        decision={opened}
        actions={openedActions}
        actionsKnown={actionsKnown}
        today={today}
        canEdit={opened ? canEditDecision(opened, viewer, capabilities).allowed : false}
        canClose={capabilities.canCloseAnyDecision}
        canAddAction={capabilities.canCreateActionItem}
        busy={isBusy}
        onClose={() => setOpenId(null)}
        onSetStatus={(status) => opened && void setStatus(opened, status)}
        onEdit={() => {
          if (!opened) return;
          setOpenId(null);
          setWindowFor({ decision: opened, key: Date.now() });
        }}
        onAddAction={() => opened && void addAction(opened)}
      />

      {windowFor && (
        <DecisionWindow
          key={windowFor.key}
          decision={windowFor.decision}
          open
          onOpenChange={(open) => !open && setWindowFor(null)}
          onSaved={() => {
            decisionsQuery.reload();
            actionsQuery.reload();
          }}
        />
      )}

      {actionDraft && (
        <ActionItemDialog
          open
          onOpenChange={(open) => !open && setActionDraft(null)}
          draft={actionDraft.draft}
          setDraft={(draft) => setActionDraft((current) => (current ? { ...current, draft } : current))}
          meeting={actionDraft.meeting}
          onSaved={() => actionsQuery.reload()}
        />
      )}
    </div>
  );
}

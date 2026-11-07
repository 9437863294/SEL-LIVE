'use client';

/**
 * The "Record a decision" window (2026-11-07 redesign, from the user's mockup
 * `sel-decisions-actions-teams-redesign.html`): the decision on the left, and on the right how it
 * will read in the register and what is still missing. It also edits an existing decision.
 *
 * Everything maps onto the service as it stands:
 *   • "Taken in meeting" lists the meetings the viewer took part in over the last four months (the
 *     participant-and-date index), and picking one carries its date and project over.
 *   • Action items written here are created after the decision with `decisionId` set, so they show
 *     in the Action items register under the same meeting and count towards the decision's progress.
 *     They are only offered to someone who may create action items.
 *   • The department defaults to the owner's, as the old form did.
 */

import { useMemo, useState } from 'react';
import { Bell, Building2, CalendarDays, Gavel, ListChecks, Loader2, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  DECISION_STATUSES,
  OFFICE_HUB_PRIORITIES,
  addDays,
  firstFieldError,
  followUpPresets,
  formatIsoDate,
  relativeDue,
  validateDecisionInput,
  type DecisionStatus,
  type OfficeHubDecision,
  type OfficeHubFieldErrors,
  type OfficeHubPriority,
} from '@/lib/office-hub';
import { createActionItem, createDecision, listMeetings, updateDecision } from '@/lib/office-hub-service';
import { useOfficeHub, useOfficeHubAction, useOfficeHubQuery } from './hooks';
import { Avatar } from './meeting-form-parts';
import { PeopleGrid } from './people-grid';
import { PRIORITY_COLOUR } from './task-create-dialog';
import { FieldError } from './ui';
import { KeyHint, PreviewRow, ReadyList, WindowBand, WindowField, WindowLabel, WorkStatusChip } from './register-parts';

interface ActionRow {
  key: number;
  text: string;
  responsibleId: string;
  due: string | null;
}

/** `owner` = the owner's department, `none` = no department, else a department id. */
type DepartmentChoice = string;

export function DecisionWindow({
  decision,
  open,
  onOpenChange,
  onSaved,
}: {
  /** The decision to edit, or null to record a new one. Mount with a `key` so the fields reset. */
  decision: OfficeHubDecision | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (decisionId: string) => void;
}) {
  const { actor, viewer, capabilities, directory, settings, today } = useOfficeHub();
  const { isBusy, run } = useOfficeHubAction();

  const startOwner = directory.people.find((person) => person.userId === (decision?.ownerId ?? viewer.userId));
  const [title, setTitle] = useState(decision?.title ?? '');
  const [background, setBackground] = useState(decision?.description ?? '');
  const [decisionDate, setDecisionDate] = useState(decision?.decisionDate ?? today);
  const [dueDate, setDueDate] = useState<string | null>(decision?.dueDate ?? null);
  const [ownerId, setOwnerId] = useState(decision?.ownerId ?? viewer.userId);
  const [department, setDepartment] = useState<DepartmentChoice>(() =>
    !decision || (decision.departmentId && decision.departmentId === startOwner?.departmentId) ? 'owner' : decision.departmentId ?? 'none',
  );
  const [status, setStatus] = useState<DecisionStatus>(decision?.status ?? 'Open');
  const [priority, setPriority] = useState<OfficeHubPriority>(decision?.priority ?? 'Medium');
  const [projectId, setProjectId] = useState<string | null>(decision?.projectId ?? null);
  const [meetingId, setMeetingId] = useState<string | null>(decision?.meetingId ?? null);
  const [closureNote, setClosureNote] = useState(decision?.closureNote ?? '');
  const [ownerSearch, setOwnerSearch] = useState('');
  const [actions, setActions] = useState<ActionRow[]>([]);
  const [errors, setErrors] = useState<OfficeHubFieldErrors>({});

  const meetingsQuery = useOfficeHubQuery(
    () => listMeetings('mine', viewer, { fromDate: addDays(today, -120), toDate: addDays(today, 1), direction: 'desc', limit: 80 }),
    [viewer.userId, today],
    { enabled: open && Boolean(viewer.userId), initial: [] },
  );

  const meetings = useMemo(() => {
    const list = (meetingsQuery.data ?? [])
      .filter((meeting) => meeting.status !== 'Draft' && meeting.status !== 'Cancelled' && meeting.status !== 'Postponed')
      .map((meeting) => ({ id: meeting.id, title: meeting.title, date: meeting.date, seriesId: meeting.seriesId ?? null, projectId: meeting.projectId ?? null }));
    if (decision?.meetingId && !list.some((meeting) => meeting.id === decision.meetingId)) {
      list.unshift({ id: decision.meetingId, title: decision.meetingTitle ?? 'Meeting', date: decision.decisionDate, seriesId: null, projectId: null });
    }
    return list;
  }, [meetingsQuery.data, decision]);

  const meeting = meetings.find((entry) => entry.id === meetingId) ?? null;
  const ownerPerson = directory.people.find((person) => person.userId === ownerId);
  const owner = ownerPerson ?? {
    userId: ownerId,
    name: decision?.ownerId === ownerId ? decision.ownerName : viewer.name,
    departmentId: decision?.departmentId ?? viewer.departmentId ?? null,
    departmentName: decision?.departmentName ?? viewer.departmentName ?? null,
  };
  const resolvedDepartment =
    department === 'owner'
      ? { id: owner.departmentId ?? null, name: owner.departmentName ?? null }
      : department === 'none'
        ? { id: null, name: null }
        : { id: department, name: directory.departments.find((entry) => entry.id === department)?.name ?? decision?.departmentName ?? null };
  const project = directory.projects.find((entry) => entry.id === projectId) ?? null;
  const projectName = project?.name ?? (projectId && projectId === decision?.projectId ? decision?.projectName ?? null : null);

  const ownerChoices = useMemo(() => {
    const needle = ownerSearch.trim().toLowerCase();
    return directory.people.filter(
      (person) => !needle || `${person.name} ${person.designation ?? ''} ${person.departmentName ?? ''}`.toLowerCase().includes(needle),
    );
  }, [directory.people, ownerSearch]);

  const rows = actions.filter((row) => row.text.trim());
  const canAddActions = !decision && capabilities.canCreateActionItem;
  const statuses = decision ? DECISION_STATUSES : DECISION_STATUSES.filter((entry) => entry !== 'Cancelled');

  const pickMeeting = (next: string | null) => {
    setMeetingId(next);
    const picked = meetings.find((entry) => entry.id === next);
    if (!picked || decision) return;
    // A decision taken in a meeting was taken on its day, and usually belongs to its project.
    setDecisionDate(picked.date);
    if (!projectId && picked.projectId) setProjectId(picked.projectId);
  };

  const submit = async () => {
    if (!actor) return;
    const found = validateDecisionInput({ title, decisionDate, ownerId, dueDate });
    setErrors(found);
    if (Object.keys(found).length) return;

    const fields = {
      title: title.trim(),
      description: background.trim() || null,
      decisionDate,
      meetingId: meeting?.id ?? null,
      meetingTitle: meeting?.title ?? null,
      ownerId,
      ownerName: owner.name,
      departmentId: resolvedDepartment.id,
      departmentName: resolvedDepartment.name,
      projectId,
      projectName,
      priority,
      dueDate,
      status,
      closureNote: status === 'Completed' || status === 'Cancelled' ? closureNote.trim() || null : decision?.closureNote ?? null,
    };

    const savedId = await run(
      async () => {
        if (decision) {
          await updateDecision(actor, decision.id, fields, { settings });
          return decision.id;
        }
        return createDecision(actor, { ...fields, agendaItemId: null, documentIds: [], tags: [] }, { settings });
      },
      {
        success: decision ? 'Decision saved' : rows.length ? undefined : 'Decision recorded',
        failure: 'Could not save the decision',
        describe: 'Save decision',
      },
    );
    if (!savedId) return;

    if (!decision && rows.length && canAddActions) {
      // A second step, so a failure here never makes it look as if the decision itself was lost.
      await run(
        async () => {
          for (const row of rows) {
            const person = directory.people.find((entry) => entry.userId === row.responsibleId);
            await createActionItem(
              actor,
              {
                title: row.text.trim(),
                description: null,
                meetingId: meeting?.id ?? null,
                meetingTitle: meeting?.title ?? null,
                meetingDate: meeting?.date ?? null,
                seriesId: meeting?.seriesId ?? null,
                agendaItemId: null,
                decisionId: savedId,
                responsibleUserId: row.responsibleId,
                responsibleUserName: person?.name ?? owner.name,
                responsibleTeamId: null,
                responsibleTeamName: null,
                departmentId: person?.departmentId ?? null,
                departmentName: person?.departmentName ?? null,
                dueDate: row.due,
                priority,
                status: 'Open',
              },
              { settings },
            );
          }
          return true;
        },
        {
          success: `Decision recorded · ${rows.length} action item${rows.length === 1 ? '' : 's'} added`,
          failure: 'The decision was recorded, but not all of its action items',
          describe: 'Add decision action items',
        },
      );
    }

    onSaved(savedId);
    onOpenChange(false);
  };

  const followUpLabel = dueDate ? relativeDue(dueDate, today).toLowerCase() : null;
  const checks: [boolean, string][] = [
    [Boolean(title.trim()), 'The decision'],
    [Boolean(background.trim()), 'Why it was taken'],
    [Boolean(ownerId), 'An owner'],
    [Boolean(dueDate), 'A follow-up date'],
    ...(canAddActions ? ([[rows.length > 0, 'Action items (optional)']] as [boolean, string][]) : []),
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="xl"
        className="flex flex-col gap-0 overflow-hidden p-0"
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void submit();
          }
        }}
      >
        <WindowBand
          tone="violet"
          icon={Gavel}
          title={decision ? `Edit ${decision.reference}` : 'Record a decision'}
          description="Decisions are kept in the register so they can be followed up."
        />

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* ── the decision ── */}
          <div className="min-w-0 px-5 py-4">
            <input
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                if (errors.title) setErrors((current) => ({ ...current, title: '' }));
              }}
              autoFocus
              placeholder="What was decided? e.g. Approve an additional overdraft of ₹2 crore"
              aria-label="The decision"
              aria-invalid={Boolean(errors.title)}
              className={cn(
                'w-full border-0 border-b-2 bg-transparent pb-2 pt-1 text-lg font-extrabold outline-none transition-colors focus:border-primary',
                errors.title ? 'border-destructive' : 'border-border',
              )}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">Write it as an instruction someone can act on: start with a verb such as Approve, Defer or Move.</p>
            <FieldError message={errors.title} />
            <Textarea
              value={background}
              onChange={(event) => setBackground(event.target.value)}
              placeholder="Why the decision was taken, and anything a reader six months from now would need."
              rows={3}
              className="mt-2.5 rounded-xl"
              aria-label="Background and reasoning"
            />

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div>
                <WindowLabel>Taken in meeting</WindowLabel>
                <Select value={meetingId ?? 'none'} onValueChange={(next) => pickMeeting(next === 'none' ? null : next)}>
                  <SelectTrigger className="rounded-[10px]" aria-label="Taken in meeting">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not from a meeting</SelectItem>
                    {meetings.map((entry) => (
                      <SelectItem key={entry.id} value={entry.id}>
                        {entry.title} · {formatIsoDate(entry.date, { year: false })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {meetingsQuery.isLoading && <p className="mt-1 text-[11px] text-muted-foreground">Loading your recent meetings…</p>}
              </div>
              <div>
                <WindowLabel>Related project</WindowLabel>
                <Select value={projectId ?? 'none'} onValueChange={(next) => setProjectId(next === 'none' ? null : next)}>
                  <SelectTrigger className="rounded-[10px]" aria-label="Related project">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not linked to a project</SelectItem>
                    {projectId && !project && <SelectItem value={projectId}>{projectName ?? 'Linked project'}</SelectItem>}
                    {directory.projects.map((entry) => (
                      <SelectItem key={entry.id} value={entry.id}>
                        {entry.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <WindowLabel>Dates</WindowLabel>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <WindowField label="Decision date *">
                <Input
                  type="date"
                  value={decisionDate}
                  onChange={(event) => event.target.value && setDecisionDate(event.target.value)}
                  className={cn('rounded-[10px]', errors.decisionDate && 'border-destructive')}
                />
              </WindowField>
              <WindowField label={<>Follow-up due{followUpLabel && <span className="text-primary"> · {followUpLabel}</span>}</>}>
                <Input
                  type="date"
                  value={dueDate ?? ''}
                  min={decisionDate}
                  onChange={(event) => setDueDate(event.target.value || null)}
                  className={cn('rounded-[10px]', errors.dueDate && 'border-destructive')}
                />
              </WindowField>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {followUpPresets(decisionDate).map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setDueDate(preset.date)}
                  className={cn(
                    'rounded-full border px-2.5 py-0.5 text-[11px] font-bold transition-colors hover:border-primary/60 hover:text-primary',
                    dueDate === preset.date ? 'border-primary/50 bg-primary/10 text-primary' : 'bg-card text-muted-foreground',
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <FieldError message={errors.decisionDate || errors.dueDate} />

            <WindowLabel>Decision owner</WindowLabel>
            <label className="flex h-9 items-center gap-2 rounded-[10px] border px-2.5 text-muted-foreground">
              <Search className="h-4 w-4 shrink-0" aria-hidden />
              <input
                value={ownerSearch}
                onChange={(event) => setOwnerSearch(event.target.value)}
                placeholder="Search people by name, designation or department"
                aria-label="Search for the owner"
                className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none"
              />
            </label>
            <PeopleGrid
              people={ownerChoices}
              picked={[ownerId]}
              onPick={(userId) => {
                setOwnerId(userId);
                if (errors.ownerId) setErrors((current) => ({ ...current, ownerId: '' }));
              }}
              viewerId={viewer.userId}
              label="Decision owner"
              limit={24}
              className="max-h-44"
            />
            <FieldError message={errors.ownerId} />

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div>
                <WindowLabel>Department</WindowLabel>
                <Select value={department} onValueChange={setDepartment}>
                  <SelectTrigger className="rounded-[10px]" aria-label="Department">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="owner">{owner.departmentName ? `Same as owner (${owner.departmentName})` : 'Same as owner (none)'}</SelectItem>
                    <SelectItem value="none">No department</SelectItem>
                    {directory.departments.map((entry) => (
                      <SelectItem key={entry.id} value={entry.id}>
                        {entry.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <WindowLabel>Status</WindowLabel>
                <div role="radiogroup" aria-label="Status" className="flex w-full rounded-[10px] bg-muted p-[3px]">
                  {statuses.map((entry) => (
                    <button
                      key={entry}
                      type="button"
                      role="radio"
                      aria-checked={status === entry}
                      onClick={() => setStatus(entry)}
                      className={cn(
                        'min-w-0 flex-1 truncate rounded-[7px] px-1.5 py-1 text-xs font-bold',
                        status === entry ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground',
                      )}
                    >
                      {entry === 'In Progress' ? 'In progress' : entry}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {(status === 'Completed' || status === 'Cancelled') && (
              <>
                <WindowLabel>Closure note</WindowLabel>
                <Textarea value={closureNote} onChange={(event) => setClosureNote(event.target.value)} rows={2} className="rounded-xl" placeholder="What happened in the end." />
              </>
            )}

            <WindowLabel>Priority</WindowLabel>
            <div role="radiogroup" aria-label="Priority" className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {OFFICE_HUB_PRIORITIES.map((option) => {
                const on = option === priority;
                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setPriority(option)}
                    className={cn('flex items-center justify-center gap-1.5 rounded-[11px] border px-2 py-1.5 text-xs font-bold transition-colors', on ? 'bg-muted' : 'bg-card hover:bg-muted/50')}
                    style={on ? { borderColor: PRIORITY_COLOUR[option], boxShadow: `0 0 0 2px ${PRIORITY_COLOUR[option]}33` } : undefined}
                  >
                    <i aria-hidden className="h-2 w-2 rounded-full" style={{ background: PRIORITY_COLOUR[option] }} />
                    {option}
                  </button>
                );
              })}
            </div>

            {canAddActions && (
              <>
                <WindowLabel
                  action={
                    <button
                      type="button"
                      onClick={() => setActions([...actions, { key: Date.now(), text: '', responsibleId: ownerId, due: dueDate ?? addDays(decisionDate, 7) }])}
                      className="text-[11.5px] font-bold text-primary hover:underline"
                    >
                      + Add action item
                    </button>
                  }
                >
                  Action items to carry it out
                </WindowLabel>
                {actions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Optional. Each one appears in Action items and can be turned into a task with reminders.</p>
                ) : (
                  <div className="space-y-1.5">
                    {actions.map((row, index) => (
                      <div
                        key={row.key}
                        className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_24px] items-center gap-1.5 sm:grid-cols-[minmax(0,1fr)_160px_136px_24px]"
                      >
                        <Input
                          value={row.text}
                          autoFocus={index === actions.length - 1 && !row.text}
                          onChange={(event) => setActions(actions.map((entry) => (entry.key === row.key ? { ...entry, text: event.target.value } : entry)))}
                          placeholder="What has to happen"
                          aria-label={`Action item ${index + 1}`}
                          className="col-span-2 h-9 rounded-[9px] sm:col-span-1"
                        />
                        <button
                          type="button"
                          aria-label={`Remove action item ${index + 1}`}
                          onClick={() => setActions(actions.filter((entry) => entry.key !== row.key))}
                          className="col-start-3 row-start-1 grid h-6 w-6 place-items-center text-muted-foreground hover:text-foreground sm:col-start-4"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                        <Select
                          value={row.responsibleId}
                          onValueChange={(next) => setActions(actions.map((entry) => (entry.key === row.key ? { ...entry, responsibleId: next } : entry)))}
                        >
                          <SelectTrigger className="col-start-1 row-start-2 h-9 rounded-[9px] sm:col-start-2 sm:row-start-1" aria-label={`Responsible for action item ${index + 1}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {directory.people.map((person) => (
                              <SelectItem key={person.userId} value={person.userId}>
                                {person.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          type="date"
                          value={row.due ?? ''}
                          onChange={(event) => setActions(actions.map((entry) => (entry.key === row.key ? { ...entry, due: event.target.value || null } : entry)))}
                          aria-label={`Due date for action item ${index + 1}`}
                          className="col-start-2 row-start-2 h-9 rounded-[9px] sm:col-start-3 sm:row-start-1"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* ── how it reads ── */}
          <aside className="border-t bg-primary/[0.02] p-4 lg:border-l lg:border-t-0">
            <h6 className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.07em] text-muted-foreground">How it reads in the register</h6>
            <div className="rounded-[14px] border border-l-4 bg-card p-3" style={{ borderLeftColor: PRIORITY_COLOUR[priority] }}>
              <div className="flex items-center justify-between gap-2 text-[11px] font-bold text-muted-foreground">
                <span className="truncate">
                  {decision?.reference ?? 'New decision'} · {formatIsoDate(decisionDate)}
                </span>
                <WorkStatusChip status={status} />
              </div>
              <b className={cn('mb-1.5 mt-1 block break-words text-sm leading-snug', !title.trim() && 'text-muted-foreground/60')}>{title.trim() || 'The decision, in one line'}</b>
              {background.trim() && (
                <p className="mb-1.5 break-words text-xs text-muted-foreground">
                  {background.trim().slice(0, 140)}
                  {background.trim().length > 140 ? '…' : ''}
                </p>
              )}
              <div className="flex min-w-0 items-center gap-2 border-t border-dashed py-1 text-xs text-muted-foreground">
                <Avatar seed={ownerId} name={owner.name} size={20} />
                <span className="truncate">
                  {owner.name}
                  {resolvedDepartment.name ? ` · ${resolvedDepartment.name}` : ''}
                </span>
              </div>
              <PreviewRow icon={Bell}>{dueDate ? `Follow-up ${formatIsoDate(dueDate, { withWeekday: true })}` : 'No follow-up date'}</PreviewRow>
              {meeting && <PreviewRow icon={CalendarDays}>{meeting.title}</PreviewRow>}
              {projectName && <PreviewRow icon={Building2}>{projectName}</PreviewRow>}
              {rows.length > 0 && (
                <PreviewRow icon={ListChecks}>
                  {rows.length} action item{rows.length === 1 ? '' : 's'}
                </PreviewRow>
              )}
            </div>
            <ReadyList title={decision ? 'Before you save' : 'Before you record'} items={checks} />
            {firstFieldError(errors) && <p className="mt-2 text-xs font-semibold text-destructive">{firstFieldError(errors)}</p>}
          </aside>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 border-t bg-muted/30 px-5 py-3">
          <span className="flex-1" />
          <KeyHint action={decision ? 'save' : 'record'} />
          <Button type="button" variant="outline" disabled={isBusy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={isBusy} onClick={() => void submit()} className="gap-1.5 bg-gradient-to-r from-primary to-indigo-600 text-white">
            {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gavel className="h-4 w-4" />}
            {decision ? 'Save decision' : 'Record decision'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

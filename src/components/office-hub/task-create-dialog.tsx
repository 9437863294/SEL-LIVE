'use client';

/**
 * The new-task window (2026-11-06 redesign, from the user's mockup): the task on the left, and on
 * the right how it will look, the chosen person's workload and what is still missing.
 *
 * Everything maps onto `createTask` as it stands: a person, a team, or a person within a team (§26);
 * the checklist becomes the task's `subtasks`; tags are the task's tags, with suggestions drawn from
 * tags already in use. The workload figure is one count query (`countOpenTasksFor`) and is simply
 * left out when the rules do not let the viewer count that person's tasks.
 *
 * Left out from the mockup on purpose: its per-task "Reminder" choice — task reminders follow the
 * office setting and each person's own preference, and there is no per-task field to store one in.
 */

import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { Check, Loader2, Maximize2, Plus, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  OFFICE_HUB_BASE_PATH,
  OFFICE_HUB_PRIORITIES,
  dueQuickPicks,
  firstFieldError,
  formatIsoDate,
  relativeDue,
  tagSuggestions,
  validateTaskInput,
  type OfficeHubFieldErrors,
  type OfficeHubPriority,
  type OfficeHubTask,
  type TaskSubtask,
} from '@/lib/office-hub';
import { countOpenTasksFor, createTask } from '@/lib/office-hub-service';
import { useOfficeHub, useOfficeHubAction, useOfficeHubQuery } from './hooks';
import { Avatar } from './meeting-form-parts';
import { FieldError } from './ui';

type Mode = 'person' | 'team' | 'both';

export const PRIORITY_COLOUR: Record<OfficeHubPriority, string> = {
  Low: '#10b981',
  Medium: '#f59e0b',
  High: '#ea580c',
  Critical: '#e11d48',
};

export function PriorityBars({ priority }: { priority: OfficeHubPriority }) {
  const level = OFFICE_HUB_PRIORITIES.indexOf(priority) + 1;
  const colour = PRIORITY_COLOUR[priority];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-bold" style={{ color: colour }}>
      <span aria-hidden className="flex items-end gap-0.5">
        {[5, 8, 11, 14].map((height, index) => (
          <em key={height} className="w-[3px] rounded-[1px]" style={{ height, background: index < level ? colour : 'hsl(var(--muted))' }} />
        ))}
      </span>
      {priority}
    </span>
  );
}

export function NewTaskDialog({
  open,
  onOpenChange,
  onCreated,
  knownTasks,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (taskId: string) => void;
  /** Tasks already loaded, for tag suggestions. */
  knownTasks: readonly Pick<OfficeHubTask, 'tags'>[];
}) {
  const { actor, viewer, directory, settings, today } = useOfficeHub();
  const { isBusy, run } = useOfficeHubAction();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState<Mode>('person');
  const [teamId, setTeamId] = useState<string | null>(null);
  const [departmentId, setDepartmentId] = useState<string | null>(viewer.departmentId ?? null);
  const [assigneeId, setAssigneeId] = useState<string | null>(viewer.userId);
  const [peopleSearch, setPeopleSearch] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [priority, setPriority] = useState<OfficeHubPriority>('Medium');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [steps, setSteps] = useState<string[]>([]);
  const [another, setAnother] = useState(false);
  const [errors, setErrors] = useState<OfficeHubFieldErrors>({});

  const team = directory.teams.find((entry) => entry.id === teamId) ?? null;
  const assignee = directory.people.find((person) => person.userId === assigneeId) ?? null;
  const project = directory.projects.find((entry) => entry.id === projectId) ?? null;
  const department = directory.departments.find((entry) => entry.id === departmentId) ?? null;

  const people = useMemo(() => {
    const needle = peopleSearch.trim().toLowerCase();
    const pool = mode === 'both' && team ? directory.people.filter((person) => (team.memberUserIds ?? []).includes(person.userId)) : directory.people;
    const matches = pool.filter((person) => !needle || `${person.name} ${person.departmentName ?? ''} ${person.designation ?? ''}`.toLowerCase().includes(needle));
    // You first, then the chosen person, then everyone else — so the likely picks need no scrolling.
    return matches.sort((a, b) => Number(b.userId === viewer.userId) - Number(a.userId === viewer.userId) || a.name.localeCompare(b.name)).slice(0, 40);
  }, [directory.people, peopleSearch, mode, team, viewer.userId]);

  const owner = mode === 'team' ? null : assigneeId;
  const workload = useOfficeHubQuery(() => countOpenTasksFor(owner ?? ''), [owner], { enabled: open && Boolean(owner), initial: null });
  const suggestions = useMemo(() => tagSuggestions(knownTasks, tags), [knownTasks, tags]);

  const reset = (keep: boolean) => {
    setTitle('');
    setDescription('');
    setSteps([]);
    setTags(keep ? tags : []);
    setErrors({});
    if (!keep) {
      setMode('person');
      setTeamId(null);
      setAssigneeId(viewer.userId);
      setDueDate(null);
      setPriority('Medium');
      setProjectId(null);
      setStartDate(today);
    }
  };

  const addTag = (value: string) => {
    const clean = value.trim().replace(/^#/, '').toLowerCase();
    if (clean && !tags.includes(clean)) setTags([...tags, clean]);
    setTagInput('');
  };

  const submit = async () => {
    if (!actor) return;
    const input = {
      title: title.trim(),
      assigneeId: owner,
      teamId: mode === 'person' ? null : teamId,
      startDate,
      dueDate,
      progress: 0,
    };
    const found = validateTaskInput(input);
    setErrors(found);
    if (Object.keys(found).length) return;

    const subtasks: TaskSubtask[] = steps
      .map((step) => step.trim())
      .filter(Boolean)
      .map((step, index) => ({ id: crypto.randomUUID(), title: step, done: false, order: index + 1 }));

    const id = await run(
      () =>
        createTask(
          actor,
          {
            title: input.title,
            description: description.trim() || null,
            assigneeId: owner,
            assigneeName: owner ? assignee?.name ?? null : null,
            teamId: input.teamId,
            teamName: input.teamId ? team?.name ?? null : null,
            departmentId,
            departmentName: department?.name ?? null,
            startDate,
            dueDate,
            priority,
            tags,
            projectId,
            projectName: project?.name ?? null,
            ...(subtasks.length ? { subtasks } : {}),
          },
          { settings, teamLeaderId: input.teamId ? team?.leaderId ?? null : null },
        ),
      {
        success: owner && owner !== viewer.userId ? `Task created · ${assignee?.name.split(' ')[0] ?? 'the assignee'} notified` : 'Task created',
        failure: 'Could not create the task',
        describe: 'Create task',
      },
    );
    if (!id) return;
    onCreated(id);
    if (another) reset(true);
    else {
      reset(false);
      onOpenChange(false);
    }
  };

  const ownerLabel =
    mode === 'team' ? team?.name ?? 'No team chosen' : `${assignee?.name ?? 'Nobody chosen'}${mode === 'both' && team ? ` · ${team.name}` : ''}`;
  const checks: [boolean, string][] = [
    [Boolean(title.trim()), 'Title'],
    [mode === 'team' ? Boolean(teamId) : Boolean(assigneeId), 'Owner'],
    [Boolean(dueDate), 'Due date'],
    [Boolean(description.trim()), 'Description (optional)'],
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
        <div className="keep-light oh-hero relative flex items-center gap-3 px-5 py-3.5 pr-24 text-white">
          <div className="min-w-0">
            <DialogTitle className="text-base font-bold text-white">New task</DialogTitle>
            <DialogDescription className="text-xs text-indigo-100">Assign it to a person, a team, or a person within a team</DialogDescription>
          </div>
          <Link
            href={`${OFFICE_HUB_BASE_PATH}/tasks/new`}
            title="Open the full form"
            className="ml-auto grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] bg-white/15 hover:bg-white/25"
          >
            <Maximize2 className="h-4 w-4" aria-hidden />
            <span className="sr-only">Open the full form</span>
          </Link>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* ── the task ── */}
          <div className="min-w-0 px-5 py-4">
            <input
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                if (errors.title) setErrors((current) => ({ ...current, title: '' }));
              }}
              autoFocus
              placeholder="What needs to be done?"
              aria-label="Task title"
              aria-invalid={Boolean(errors.title)}
              className={cn(
                'w-full border-0 border-b-2 bg-transparent pb-2 pt-1 text-[19px] font-extrabold outline-none transition-colors focus:border-primary',
                errors.title ? 'border-destructive' : 'border-border',
              )}
            />
            <FieldError message={errors.title} />
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What has to be done, and anything the assignee needs to know."
              rows={3}
              className="mt-2.5 rounded-xl"
            />

            <Label>Assign to</Label>
            <div role="radiogroup" aria-label="Assign to" className="mb-2 inline-flex flex-wrap rounded-[10px] bg-muted p-[3px]">
              {(
                [
                  ['person', 'A person'],
                  ['team', 'A team'],
                  ['both', 'A person within a team'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={mode === value}
                  onClick={() => setMode(value)}
                  className={cn('rounded-[7px] px-3 py-1 text-xs font-bold', mode === value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground')}
                >
                  {label}
                </button>
              ))}
            </div>
            {mode !== 'person' && (
              <div className="mb-2 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <Field label="Team">
                  <Select
                    value={teamId ?? 'none'}
                    onValueChange={(next) => {
                      const nextTeam = next === 'none' ? null : next;
                      setTeamId(nextTeam);
                      const members = directory.teams.find((entry) => entry.id === nextTeam)?.memberUserIds ?? [];
                      if (mode === 'both' && assigneeId && !members.includes(assigneeId)) setAssigneeId(null);
                    }}
                  >
                    <SelectTrigger className="rounded-[10px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No team</SelectItem>
                      {directory.teams.map((entry) => (
                        <SelectItem key={entry.id} value={entry.id}>
                          {entry.name} ({entry.memberCount})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Department">
                  <Select value={departmentId ?? 'none'} onValueChange={(next) => setDepartmentId(next === 'none' ? null : next)}>
                    <SelectTrigger className="rounded-[10px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No department</SelectItem>
                      {directory.departments.map((entry) => (
                        <SelectItem key={entry.id} value={entry.id}>
                          {entry.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            )}
            {mode !== 'team' && (
              <div>
                <label className="mb-1.5 flex h-9 items-center gap-2 rounded-[10px] border px-2.5 text-muted-foreground">
                  <Search className="h-4 w-4 shrink-0" aria-hidden />
                  <input
                    value={peopleSearch}
                    onChange={(event) => setPeopleSearch(event.target.value)}
                    placeholder={mode === 'both' && team ? `Search ${team.name}` : 'Search people'}
                    className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none"
                  />
                </label>
                <div role="radiogroup" aria-label="Assignee" className="grid max-h-44 grid-cols-1 gap-1.5 overflow-y-auto p-0.5 sm:grid-cols-2">
                  {people.map((person) => {
                    const on = person.userId === assigneeId;
                    return (
                      <button
                        key={person.userId}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => {
                          setAssigneeId(person.userId);
                          if (person.departmentId) setDepartmentId(person.departmentId);
                          if (errors.assigneeId) setErrors((current) => ({ ...current, assigneeId: '' }));
                        }}
                        className={cn(
                          'flex min-w-0 items-center gap-2 rounded-[11px] border px-2 py-1.5 text-left transition-colors',
                          on ? 'border-primary bg-primary/5 ring-2 ring-primary/15' : 'bg-card hover:border-primary/40',
                        )}
                      >
                        <Avatar seed={person.userId} name={person.name} size={24} />
                        <span className="min-w-0">
                          <b className="block truncate text-xs leading-tight">
                            {person.name}
                            {person.userId === viewer.userId ? ' (you)' : ''}
                          </b>
                          <span className="block truncate text-[10.5px] font-semibold text-muted-foreground">
                            {[person.designation, person.departmentName].filter(Boolean).join(' · ') || 'No department'}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                  {people.length === 0 && <p className="col-span-full py-3 text-center text-xs text-muted-foreground">Nobody matches.</p>}
                </div>
              </div>
            )}
            <FieldError message={errors.assigneeId} />

            <Label>Dates</Label>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <Field label="Start date">
                <Input type="date" value={startDate} onChange={(event) => event.target.value && setStartDate(event.target.value)} className="rounded-[10px]" />
              </Field>
              <Field label={`Due date${dueDate ? ` · ${relativeDue(dueDate, today).toLowerCase()}` : ''}`}>
                <Input
                  type="date"
                  value={dueDate ?? ''}
                  min={startDate}
                  onChange={(event) => setDueDate(event.target.value || null)}
                  className={cn('rounded-[10px]', errors.dueDate && 'border-destructive')}
                />
              </Field>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {dueQuickPicks(today).map((pick) => (
                <button
                  key={pick.label}
                  type="button"
                  onClick={() => setDueDate(pick.date)}
                  className={cn(
                    'rounded-full border px-2.5 py-0.5 text-[11px] font-bold transition-colors hover:border-primary/60 hover:text-primary',
                    dueDate === pick.date ? 'border-primary/50 bg-primary/10 text-primary' : 'bg-card text-muted-foreground',
                  )}
                >
                  {pick.label}
                </button>
              ))}
            </div>
            <FieldError message={errors.dueDate} />

            <Label>Priority</Label>
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

            <Label>Related project</Label>
            <Select value={projectId ?? 'none'} onValueChange={(next) => setProjectId(next === 'none' ? null : next)}>
              <SelectTrigger className="rounded-[10px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not linked to a project</SelectItem>
                {directory.projects.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Label>Tags</Label>
            <div className="flex flex-wrap items-center gap-1.5 rounded-[10px] border px-2 py-1.5">
              {tags.map((tag) => (
                <span key={tag} className="inline-flex items-center gap-0.5 rounded-[7px] bg-primary/10 py-px pl-2 pr-0.5 text-[11.5px] font-bold text-primary">
                  #{tag}
                  <button type="button" aria-label={`Remove ${tag}`} onClick={() => setTags(tags.filter((entry) => entry !== tag))} className="rounded px-1 hover:bg-primary/15">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <input
                value={tagInput}
                onChange={(event) => setTagInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ',') {
                    event.preventDefault();
                    addTag(tagInput);
                  } else if (event.key === 'Backspace' && !tagInput && tags.length) {
                    setTags(tags.slice(0, -1));
                  }
                }}
                onBlur={() => tagInput.trim() && addTag(tagInput)}
                placeholder={tags.length ? '' : 'Type and press Enter or comma'}
                aria-label="Add a tag"
                className="min-w-[120px] flex-1 bg-transparent text-[13px] font-semibold outline-none"
              />
            </div>
            {suggestions.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {suggestions.map((tag) => (
                  <button key={tag} type="button" onClick={() => addTag(tag)} className="rounded-full border border-dashed border-primary/40 px-2 py-px text-[11px] font-bold text-primary hover:bg-primary/10">
                    + {tag}
                  </button>
                ))}
              </div>
            )}

            <Label
              action={
                <button type="button" onClick={() => setSteps([...steps, ''])} className="text-[11.5px] font-bold normal-case tracking-normal text-primary hover:underline">
                  + Add step
                </button>
              }
            >
              Checklist
            </Label>
            {steps.length === 0 ? (
              <p className="text-xs text-muted-foreground">Break the work into steps the assignee can tick off.</p>
            ) : (
              <div className="space-y-1.5">
                {steps.map((step, index) => (
                  <div key={index} className="flex items-center gap-2 rounded-[10px] border px-2.5 py-1">
                    <i aria-hidden className="h-3.5 w-3.5 shrink-0 rounded border-2 border-muted-foreground/40" />
                    <input
                      value={step}
                      autoFocus={index === steps.length - 1 && !step}
                      onChange={(event) => setSteps(steps.map((entry, position) => (position === index ? event.target.value : entry)))}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey) {
                          event.preventDefault();
                          setSteps([...steps, '']);
                        }
                      }}
                      placeholder={`Step ${index + 1}`}
                      className="min-w-0 flex-1 bg-transparent py-1 text-[13px] font-semibold outline-none"
                    />
                    <button type="button" aria-label="Remove step" onClick={() => setSteps(steps.filter((_, position) => position !== index))} className="text-muted-foreground hover:text-foreground">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── how it will look ── */}
          <aside className="border-t bg-primary/[0.02] p-4 lg:border-l lg:border-t-0">
            <h6 className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.07em] text-muted-foreground">How it will look</h6>
            <div className="rounded-[14px] border border-t-4 bg-card p-3" style={{ borderTopColor: PRIORITY_COLOUR[priority] }}>
              <div className="flex items-center justify-between text-[11px] font-bold text-muted-foreground">
                <span>New task</span>
                <PriorityBars priority={priority} />
              </div>
              <b className={cn('mb-1.5 mt-1 block break-words text-sm leading-snug', !title.trim() && 'text-muted-foreground/60')}>{title.trim() || 'Task title'}</b>
              {tags.length > 0 && (
                <div className="mb-1.5 flex flex-wrap gap-1">
                  {tags.map((tag) => (
                    <span key={tag} className="rounded-md bg-primary/10 px-1.5 text-[10.5px] font-bold text-primary">
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
              <PreviewRow>{ownerLabel}</PreviewRow>
              <PreviewRow>
                {formatIsoDate(startDate, { year: false })} → {dueDate ? <b>{formatIsoDate(dueDate, { withWeekday: true, year: false })}</b> : 'no due date'}
              </PreviewRow>
              {project && <PreviewRow>{project.name}</PreviewRow>}
              {steps.filter((step) => step.trim()).length > 0 && <PreviewRow>{steps.filter((step) => step.trim()).length}-step checklist</PreviewRow>}
            </div>

            <div className="mt-3 rounded-[14px] border bg-card px-3 py-2.5">
              {mode === 'team' ? (
                <small className="text-[11.5px] text-muted-foreground">
                  <b className="text-foreground">Team task.</b> Anyone in {team?.name ?? 'the team'} can pick it up from the Unassigned tab.
                </small>
              ) : workload.data == null ? (
                <small className="text-[11.5px] text-muted-foreground">
                  {owner ? (workload.isLoading ? 'Checking their workload…' : 'Their workload is not visible to you.') : 'Choose who will do it.'}
                </small>
              ) : (
                <>
                  <small className="text-[11.5px]">
                    <b>{owner === viewer.userId ? 'Your' : `${assignee?.name.split(' ')[0] ?? 'Their'}'s`} workload</b>
                  </small>
                  <div className="my-1.5 h-[7px] overflow-hidden rounded bg-muted">
                    <i
                      className={cn('block h-full rounded', workload.data > 5 ? 'bg-rose-600' : workload.data > 3 ? 'bg-amber-500' : 'bg-emerald-600')}
                      style={{ width: `${Math.min(100, (workload.data / 8) * 100)}%` }}
                    />
                  </div>
                  <small className="text-[11.5px] text-muted-foreground">
                    {workload.data} open task{workload.data === 1 ? '' : 's'}
                    {workload.data > 5 ? ' — quite busy; consider someone else or a later due date' : workload.data ? '' : ' — free to take this'}
                  </small>
                </>
              )}
            </div>

            <h6 className="mb-1 mt-3.5 text-[11px] font-extrabold uppercase tracking-[0.07em] text-muted-foreground">Before you create</h6>
            {checks.map(([ok, label]) => (
              <div key={label} className={cn('flex items-center gap-2 py-0.5 text-xs font-semibold', ok ? 'text-foreground' : 'text-muted-foreground')}>
                <span aria-hidden className={cn('grid h-4 w-4 place-items-center rounded-full border-2', ok ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-muted-foreground/40')}>
                  {ok && <Check className="h-2.5 w-2.5" strokeWidth={3.5} />}
                </span>
                {label}
              </div>
            ))}
            {firstFieldError(errors) && <p className="mt-2 text-xs font-semibold text-destructive">{firstFieldError(errors)}</p>}
          </aside>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 border-t bg-muted/30 px-5 py-3">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-muted-foreground">
            <Switch checked={another} onCheckedChange={setAnother} />
            Create another after this
          </label>
          <span className="flex-1" />
          <span className="hidden text-[11.5px] text-muted-foreground sm:inline">
            <kbd className="rounded border border-b-2 bg-card px-1 text-[10.5px] font-bold">Ctrl</kbd> + <kbd className="rounded border border-b-2 bg-card px-1 text-[10.5px] font-bold">Enter</kbd> to create
          </span>
          <Button type="button" variant="outline" disabled={isBusy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={isBusy} onClick={() => void submit()} className="gap-1.5 bg-gradient-to-r from-primary to-indigo-600 text-white">
            {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Create task
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Label({ children, action }: { children: string; action?: ReactNode }) {
  return (
    <div className="mb-1.5 mt-4 flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.07em] text-muted-foreground">
      {children}
      {action && <span className="ml-auto">{action}</span>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <small className="mb-1 block text-[11.5px] font-bold text-muted-foreground">{label}</small>
      {children}
    </label>
  );
}

function PreviewRow({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-2 border-t border-dashed py-1 text-xs text-muted-foreground">{children}</div>;
}

'use client';

/**
 * Decisions, action items, and the one-click conversion of an action item into a task
 * (§21, §22, §23).
 *
 * ── The workflow this file exists to make short ─────────────────────────────────────────────────
 *
 * §91 calls `Meeting → Decision → Action Item → Task` the most important path in the application,
 * and says it must take as few clicks as possible. So:
 *
 *   • "Add decision" from a meeting arrives with the meeting, its date, and the agenda item already
 *     filled in. The user types the decision and picks an owner.
 *   • "Add action item" arrives with the meeting and, if raised from a decision, that decision.
 *   • **"Create task" opens a dialog that is already complete** — title, description, assignee, due
 *     date, priority, source meeting and source action item all carried over by
 *     `taskDraftFromActionItem`. The user can change anything, and most of the time presses Save.
 *     That last point is §84's rule: never make somebody re-enter what the system already knows.
 *
 * Once a task exists, the button becomes "View task" rather than offering to create a second one.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  CheckSquare,
  ExternalLink,
  Gavel,
  ListTodo,
  Pencil,
  Plus,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  ACTION_ITEM_STATUSES,
  DECISION_STATUSES,
  OFFICE_HUB_BASE_PATH,
  OFFICE_HUB_PRIORITIES,
  formatIsoDate,
  isActionItemOverdue,
  isDecisionOverdue,
  taskDraftFromActionItem,
  validateActionItemInput,
  validateDecisionInput,
  type ActionItemStatus,
  type DecisionStatus,
  type OfficeHubActionItem,
  type OfficeHubAgendaItem,
  type OfficeHubDecision,
  type OfficeHubFieldErrors,
  type OfficeHubMeeting,
  type OfficeHubPriority,
} from '@/lib/office-hub';
import {
  createActionItem,
  createDecision,
  createTask,
  updateActionItem,
  updateDecision,
} from '@/lib/office-hub-service';
import { useOfficeHub, useOfficeHubAction } from './hooks';
import { DateField, DepartmentSelector, ProjectSelector, TeamSelector, UserSelector } from './selectors';
import {
  DecisionStatusBadge,
  FieldError,
  OfficeHubEmptyState,
  PriorityBadge,
  TaskStatusBadge,
  officeHubDialog,
} from './ui';

/* ── decisions ───────────────────────────────────────────────────────────────────────────────── */

interface DecisionDraft {
  id?: string;
  title: string;
  description: string;
  decisionDate: string;
  ownerId: string | null;
  ownerName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  projectId: string | null;
  projectName: string | null;
  priority: OfficeHubPriority;
  dueDate: string | null;
  status: DecisionStatus;
  agendaItemId: string | null;
  closureNote: string;
}

export function decisionDraftFor(options: {
  meeting?: Pick<OfficeHubMeeting, 'date' | 'projectId' | 'projectName'> | null;
  today: string;
  viewer: { userId: string; name: string; departmentId?: string | null; departmentName?: string | null };
  agendaItemId?: string | null;
}): DecisionDraft {
  return {
    title: '',
    description: '',
    decisionDate: options.meeting?.date ?? options.today,
    ownerId: options.viewer.userId,
    ownerName: options.viewer.name,
    departmentId: options.viewer.departmentId ?? null,
    departmentName: options.viewer.departmentName ?? null,
    projectId: options.meeting?.projectId ?? null,
    projectName: options.meeting?.projectName ?? null,
    priority: 'Medium',
    dueDate: null,
    status: 'Open',
    agendaItemId: options.agendaItemId ?? null,
    closureNote: '',
  };
}

export function DecisionDialog({
  open,
  onOpenChange,
  draft,
  setDraft,
  meeting,
  agenda,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: DecisionDraft;
  setDraft: (next: DecisionDraft) => void;
  meeting?: Pick<OfficeHubMeeting, 'id' | 'title' | 'date'> | null;
  agenda?: OfficeHubAgendaItem[];
  onSaved: () => void;
}) {
  const { actor, settings } = useOfficeHub();
  const { isBusy, run } = useOfficeHubAction();
  const [errors, setErrors] = useState<OfficeHubFieldErrors>({});

  const save = async () => {
    const found = validateDecisionInput(draft);
    setErrors(found);
    if (Object.keys(found).length || !actor) return;

    const payload = {
      title: draft.title.trim(),
      description: draft.description.trim() || null,
      decisionDate: draft.decisionDate,
      meetingId: meeting?.id ?? null,
      meetingTitle: meeting?.title ?? null,
      agendaItemId: draft.agendaItemId,
      ownerId: draft.ownerId!,
      ownerName: draft.ownerName!,
      departmentId: draft.departmentId,
      departmentName: draft.departmentName,
      projectId: draft.projectId,
      projectName: draft.projectName,
      priority: draft.priority,
      dueDate: draft.dueDate,
      status: draft.status,
      closureNote: draft.closureNote.trim() || null,
      documentIds: [],
      tags: [],
    };

    const result = await run<void>(
      async () => {
        // Awaited rather than returned, so both branches have the same type — `createDecision`
        // resolves to an id and `updateDecision` to nothing, and the caller needs neither.
        if (draft.id) await updateDecision(actor, draft.id, payload, { settings });
        else await createDecision(actor, payload, { settings });
      },
      {
        success: draft.id ? 'Decision updated' : 'Decision recorded',
        failure: 'Could not save the decision',
      },
    );
    if (result !== null) {
      onOpenChange(false);
      onSaved();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={officeHubDialog.contentTall}>
        <DialogHeader className={officeHubDialog.header}>
          <DialogTitle>{draft.id ? 'Edit decision' : 'Record a decision'}</DialogTitle>
          <DialogDescription>
            {meeting
              ? `Taken in ${meeting.title} on ${formatIsoDate(meeting.date)}. Decisions are kept in the register so they can be followed up.`
              : 'Decisions are kept in the register so they can be followed up.'}
          </DialogDescription>
        </DialogHeader>

        <div className={officeHubDialog.bodyScroll}>
          <div>
            <Label className="mb-1 block text-xs">
              Decision<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Input
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              placeholder="e.g. Approve an additional overdraft of ₹2 crore"
              className="bg-white"
              autoFocus
            />
            <FieldError message={errors.title} />
          </div>

          <div>
            <Label className="mb-1 block text-xs">Background and reasoning</Label>
            <Textarea
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              rows={3}
              className="bg-white"
              placeholder="Why the decision was taken, and anything a reader six months from now would need."
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <DateField
              label="Decision date"
              required
              value={draft.decisionDate}
              onChange={(next) => setDraft({ ...draft, decisionDate: next ?? draft.decisionDate })}
              error={errors.decisionDate}
            />
            <DateField
              label="Follow-up due"
              value={draft.dueDate}
              min={draft.decisionDate}
              onChange={(next) => setDraft({ ...draft, dueDate: next })}
              error={errors.dueDate}
            />

            <UserSelector
              label="Decision owner"
              value={draft.ownerId}
              allowClear={false}
              error={errors.ownerId}
              onChange={(userId, person) =>
                setDraft({
                  ...draft,
                  ownerId: userId,
                  ownerName: person?.name ?? null,
                  // The owner's department is the useful default for a decision's department, and
                  // it is nearly always right.
                  departmentId: person?.departmentId ?? draft.departmentId,
                  departmentName: person?.departmentName ?? draft.departmentName,
                })
              }
            />

            <DepartmentSelector
              label="Department"
              value={draft.departmentId}
              placeholder="No department"
              onChange={(departmentId, name) =>
                setDraft({ ...draft, departmentId, departmentName: name })
              }
            />

            <div>
              <Label className="mb-1 block text-xs">Priority</Label>
              <Select
                value={draft.priority}
                onValueChange={(value) => setDraft({ ...draft, priority: value as OfficeHubPriority })}
              >
                <SelectTrigger className="bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OFFICE_HUB_PRIORITIES.map((priority) => (
                    <SelectItem key={priority} value={priority}>
                      {priority}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="mb-1 block text-xs">Status</Label>
              <Select
                value={draft.status}
                onValueChange={(value) => setDraft({ ...draft, status: value as DecisionStatus })}
              >
                <SelectTrigger className="bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DECISION_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <ProjectSelector
              label="Related project"
              value={draft.projectId}
              onChange={(projectId, name) => setDraft({ ...draft, projectId, projectName: name })}
            />

            {agenda && agenda.length > 0 && (
              <div>
                <Label className="mb-1 block text-xs">Agenda item</Label>
                <Select
                  value={draft.agendaItemId ?? '__none__'}
                  onValueChange={(value) =>
                    setDraft({ ...draft, agendaItemId: value === '__none__' ? null : value })
                  }
                >
                  <SelectTrigger className="bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Not tied to an agenda item</SelectItem>
                    {agenda.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.order}. {item.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {(draft.status === 'Completed' || draft.status === 'Cancelled') && (
            <div>
              <Label className="mb-1 block text-xs">Closure note</Label>
              <Textarea
                value={draft.closureNote}
                onChange={(event) => setDraft({ ...draft, closureNote: event.target.value })}
                rows={2}
                className="bg-white"
                placeholder="What happened in the end."
              />
            </div>
          )}
        </div>

        <DialogFooter className={officeHubDialog.footer}>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isBusy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={isBusy} className="gap-2">
            <Gavel className="h-4 w-4" />
            {draft.id ? 'Save decision' : 'Record decision'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── action items ────────────────────────────────────────────────────────────────────────────── */

interface ActionItemDraft {
  id?: string;
  title: string;
  description: string;
  responsibleUserId: string | null;
  responsibleUserName: string | null;
  responsibleTeamId: string | null;
  responsibleTeamName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  dueDate: string | null;
  priority: OfficeHubPriority;
  status: ActionItemStatus;
  agendaItemId: string | null;
  decisionId: string | null;
}

export function actionItemDraftFor(options: {
  viewer: { userId: string; name: string; departmentId?: string | null; departmentName?: string | null };
  decisionId?: string | null;
  agendaItemId?: string | null;
}): ActionItemDraft {
  return {
    title: '',
    description: '',
    responsibleUserId: options.viewer.userId,
    responsibleUserName: options.viewer.name,
    responsibleTeamId: null,
    responsibleTeamName: null,
    departmentId: options.viewer.departmentId ?? null,
    departmentName: options.viewer.departmentName ?? null,
    dueDate: null,
    priority: 'Medium',
    status: 'Open',
    agendaItemId: options.agendaItemId ?? null,
    decisionId: options.decisionId ?? null,
  };
}

export function ActionItemDialog({
  open,
  onOpenChange,
  draft,
  setDraft,
  meeting,
  agenda,
  decisions,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: ActionItemDraft;
  setDraft: (next: ActionItemDraft) => void;
  meeting?: Pick<OfficeHubMeeting, 'id' | 'title' | 'date' | 'seriesId'> | null;
  agenda?: OfficeHubAgendaItem[];
  decisions?: OfficeHubDecision[];
  onSaved: () => void;
}) {
  const { actor, settings } = useOfficeHub();
  const { isBusy, run } = useOfficeHubAction();
  const [errors, setErrors] = useState<OfficeHubFieldErrors>({});

  const save = async () => {
    const found = validateActionItemInput(draft);
    setErrors(found);
    if (Object.keys(found).length || !actor) return;

    const payload = {
      title: draft.title.trim(),
      description: draft.description.trim() || null,
      meetingId: meeting?.id ?? null,
      meetingTitle: meeting?.title ?? null,
      meetingDate: meeting?.date ?? null,
      seriesId: meeting?.seriesId ?? null,
      agendaItemId: draft.agendaItemId,
      decisionId: draft.decisionId,
      responsibleUserId: draft.responsibleUserId,
      responsibleUserName: draft.responsibleUserName,
      responsibleTeamId: draft.responsibleTeamId,
      responsibleTeamName: draft.responsibleTeamName,
      departmentId: draft.departmentId,
      departmentName: draft.departmentName,
      dueDate: draft.dueDate,
      priority: draft.priority,
      status: draft.status,
    };

    const result = await run<void>(
      async () => {
        if (draft.id) await updateActionItem(actor, draft.id, payload);
        else await createActionItem(actor, payload, { settings });
      },
      { success: draft.id ? 'Action item updated' : 'Action item added', failure: 'Could not save the action item' },
    );
    if (result !== null) {
      onOpenChange(false);
      onSaved();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={officeHubDialog.contentTall}>
        <DialogHeader className={officeHubDialog.header}>
          <DialogTitle>{draft.id ? 'Edit action item' : 'Add an action item'}</DialogTitle>
          <DialogDescription>
            Who will do what, by when. Turn it into a tracked task once it is agreed.
          </DialogDescription>
        </DialogHeader>

        <div className={officeHubDialog.bodyScroll}>
          <div>
            <Label className="mb-1 block text-xs">
              Action<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Input
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              placeholder="e.g. Prepare the August bank reconciliation"
              className="bg-white"
              autoFocus
            />
            <FieldError message={errors.title} />
          </div>

          <div>
            <Label className="mb-1 block text-xs">Detail</Label>
            <Textarea
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              rows={3}
              className="bg-white"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <UserSelector
              label="Responsible person"
              value={draft.responsibleUserId}
              error={errors.responsibleUserId}
              onChange={(userId, person) =>
                setDraft({
                  ...draft,
                  responsibleUserId: userId,
                  responsibleUserName: person?.name ?? null,
                  departmentId: person?.departmentId ?? draft.departmentId,
                  departmentName: person?.departmentName ?? draft.departmentName,
                })
              }
            />

            <TeamSelector
              label="Or a team"
              value={draft.responsibleTeamId}
              onChange={(teamId, name) =>
                setDraft({ ...draft, responsibleTeamId: teamId, responsibleTeamName: name })
              }
            />

            <DateField
              label="Due date"
              value={draft.dueDate}
              onChange={(next) => setDraft({ ...draft, dueDate: next })}
              error={errors.dueDate}
            />

            <div>
              <Label className="mb-1 block text-xs">Priority</Label>
              <Select
                value={draft.priority}
                onValueChange={(value) => setDraft({ ...draft, priority: value as OfficeHubPriority })}
              >
                <SelectTrigger className="bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OFFICE_HUB_PRIORITIES.map((priority) => (
                    <SelectItem key={priority} value={priority}>
                      {priority}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="mb-1 block text-xs">Status</Label>
              <Select
                value={draft.status}
                onValueChange={(value) => setDraft({ ...draft, status: value as ActionItemStatus })}
              >
                <SelectTrigger className="bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACTION_ITEM_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {decisions && decisions.length > 0 && (
              <div>
                <Label className="mb-1 block text-xs">Arising from decision</Label>
                <Select
                  value={draft.decisionId ?? '__none__'}
                  onValueChange={(value) => setDraft({ ...draft, decisionId: value === '__none__' ? null : value })}
                >
                  <SelectTrigger className="bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Not tied to a decision</SelectItem>
                    {decisions.map((decision) => (
                      <SelectItem key={decision.id} value={decision.id}>
                        {decision.reference} — {decision.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {agenda && agenda.length > 0 && (
              <div>
                <Label className="mb-1 block text-xs">Agenda item</Label>
                <Select
                  value={draft.agendaItemId ?? '__none__'}
                  onValueChange={(value) => setDraft({ ...draft, agendaItemId: value === '__none__' ? null : value })}
                >
                  <SelectTrigger className="bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Not tied to an agenda item</SelectItem>
                    {agenda.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.order}. {item.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className={officeHubDialog.footer}>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isBusy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={isBusy} className="gap-2">
            <CheckSquare className="h-4 w-4" />
            {draft.id ? 'Save action item' : 'Add action item'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── action item → task ──────────────────────────────────────────────────────────────────────── */

/**
 * The "Create Task" dialog (§23).
 *
 * Opens already filled in from the action item, and the source relationships — meeting, decision,
 * action item — are carried onto the task so its header can say where it came from and
 * "View source meeting" works. The user is free to change anything before saving; the point is that
 * they do not have to.
 */
export function CreateTaskFromActionItemDialog({
  item,
  meeting,
  open,
  onOpenChange,
  onCreated,
}: {
  item: OfficeHubActionItem;
  meeting?: Pick<OfficeHubMeeting, 'id' | 'title' | 'projectId' | 'projectName'> | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (taskId: string) => void;
}) {
  const { actor, today, settings, directory } = useOfficeHub();
  const { isBusy, run } = useOfficeHubAction();

  const seeded = useMemo(() => taskDraftFromActionItem(item, today), [item, today]);
  const [title, setTitle] = useState(seeded.title);
  const [description, setDescription] = useState(seeded.description ?? '');
  const [assigneeId, setAssigneeId] = useState<string | null>(seeded.assigneeId ?? null);
  const [assigneeName, setAssigneeName] = useState<string | null>(seeded.assigneeName ?? null);
  const [teamId, setTeamId] = useState<string | null>(seeded.teamId ?? null);
  const [teamName, setTeamName] = useState<string | null>(seeded.teamName ?? null);
  const [dueDate, setDueDate] = useState<string | null>(seeded.dueDate ?? null);
  const [startDate, setStartDate] = useState<string | null>(seeded.startDate ?? today);
  const [priority, setPriority] = useState<OfficeHubPriority>(seeded.priority ?? 'Medium');
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!title.trim()) {
      setError('Give the task a title.');
      return;
    }
    if (!assigneeId && !teamId) {
      setError('Assign the task to an employee or a team.');
      return;
    }
    if (!actor) return;

    const teamLeaderId = teamId ? directory.teams.find((team) => team.id === teamId)?.leaderId ?? null : null;

    const taskId = await run(
      () =>
        createTask(
          actor,
          {
            title: title.trim(),
            description: description.trim() || null,
            assigneeId,
            assigneeName,
            teamId,
            teamName,
            departmentId: seeded.departmentId ?? null,
            departmentName: seeded.departmentName ?? null,
            startDate,
            dueDate,
            priority,
            status: 'Not Started',
            progress: 0,
            meetingId: item.meetingId ?? meeting?.id ?? null,
            meetingTitle: item.meetingTitle ?? meeting?.title ?? null,
            actionItemId: item.id,
            decisionId: item.decisionId ?? null,
            projectId: meeting?.projectId ?? null,
            projectName: meeting?.projectName ?? null,
          },
          { settings, teamLeaderId },
        ),
      { success: 'Task created from the action item', failure: 'Could not create the task' },
    );

    if (taskId) {
      onOpenChange(false);
      onCreated(taskId);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={officeHubDialog.contentTall}>
        <DialogHeader className={officeHubDialog.header}>
          <DialogTitle>Create a task from this action item</DialogTitle>
          <DialogDescription>
            Everything below is carried over from the action item. Change what you need and save —
            the task will keep a link back to {item.meetingTitle ?? 'the meeting'}.
          </DialogDescription>
        </DialogHeader>

        <div className={officeHubDialog.bodyScroll}>
          <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-xs text-indigo-900">
            <p className="flex flex-wrap items-center gap-1.5">
              <span className="font-semibold">{item.reference}</span>
              <ArrowRight className="h-3 w-3" />
              <span>new task</span>
              {item.meetingTitle && (
                <>
                  <span className="opacity-60">· from</span>
                  <span className="font-medium">{item.meetingTitle}</span>
                </>
              )}
            </p>
          </div>

          <div>
            <Label className="mb-1 block text-xs">
              Task title<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} className="bg-white" autoFocus />
          </div>

          <div>
            <Label className="mb-1 block text-xs">Description</Label>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              className="bg-white"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <UserSelector
              label="Assignee"
              value={assigneeId}
              onChange={(userId, person) => {
                setAssigneeId(userId);
                setAssigneeName(person?.name ?? null);
              }}
            />
            <TeamSelector
              label="Or a team"
              value={teamId}
              onChange={(nextTeamId, name) => {
                setTeamId(nextTeamId);
                setTeamName(name);
              }}
            />
            <DateField label="Start date" value={startDate} onChange={setStartDate} />
            <DateField label="Due date" value={dueDate} min={startDate ?? undefined} onChange={setDueDate} />
            <div>
              <Label className="mb-1 block text-xs">Priority</Label>
              <Select value={priority} onValueChange={(value) => setPriority(value as OfficeHubPriority)}>
                <SelectTrigger className="bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OFFICE_HUB_PRIORITIES.map((entry) => (
                    <SelectItem key={entry} value={entry}>
                      {entry}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter className={officeHubDialog.footer}>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isBusy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={isBusy} className="gap-2">
            <ListTodo className="h-4 w-4" />
            Create task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── panels ──────────────────────────────────────────────────────────────────────────────────── */

export function DecisionsPanel({
  decisions,
  meeting,
  agenda,
  canCreate,
  canEdit,
  onChanged,
  today,
}: {
  decisions: OfficeHubDecision[];
  meeting?: Pick<OfficeHubMeeting, 'id' | 'title' | 'date' | 'projectId' | 'projectName'> | null;
  agenda?: OfficeHubAgendaItem[];
  canCreate: boolean;
  canEdit: boolean;
  onChanged: () => void;
  today: string;
}) {
  const { viewer } = useOfficeHub();
  const [draft, setDraft] = useState<DecisionDraft | null>(null);

  return (
    <div className="space-y-3">
      {decisions.length === 0 ? (
        <OfficeHubEmptyState
          icon={Gavel}
          title="No decisions recorded."
          description={
            canCreate
              ? 'A meeting that decided something should say so here — the register is what makes it followable.'
              : undefined
          }
          action={
            canCreate ? (
              <Button
                size="sm"
                className="gap-2"
                onClick={() => setDraft(decisionDraftFor({ meeting, today, viewer }))}
              >
                <Plus className="h-4 w-4" />
                Record a decision
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="space-y-2">
          {decisions.map((decision) => (
            <li key={decision.id} className="rounded-lg border bg-white p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Link
                      href={`${OFFICE_HUB_BASE_PATH}/decisions/${decision.id}`}
                      className="min-w-0 break-words text-sm font-medium text-slate-800 hover:underline"
                    >
                      {decision.title}
                    </Link>
                    <DecisionStatusBadge status={decision.status} />
                    <PriorityBadge priority={decision.priority} />
                    {isDecisionOverdue(decision, today) && (
                      <Badge variant="outline" className="border-rose-200 bg-rose-50 text-[11px] text-rose-700">
                        Overdue
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {decision.reference} · {decision.ownerName}
                    {decision.dueDate ? ` · due ${formatIsoDate(decision.dueDate)}` : ''}
                  </p>
                  {decision.description && (
                    <p className="mt-1 whitespace-pre-wrap break-words text-xs text-slate-600">{decision.description}</p>
                  )}
                </div>
                {canEdit && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0"
                    aria-label={`Edit ${decision.title}`}
                    onClick={() =>
                      setDraft({
                        id: decision.id,
                        title: decision.title,
                        description: decision.description ?? '',
                        decisionDate: decision.decisionDate,
                        ownerId: decision.ownerId,
                        ownerName: decision.ownerName,
                        departmentId: decision.departmentId ?? null,
                        departmentName: decision.departmentName ?? null,
                        projectId: decision.projectId ?? null,
                        projectName: decision.projectName ?? null,
                        priority: decision.priority,
                        dueDate: decision.dueDate ?? null,
                        status: decision.status,
                        agendaItemId: decision.agendaItemId ?? null,
                        closureNote: decision.closureNote ?? '',
                      })
                    }
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canCreate && decisions.length > 0 && (
        <Button
          size="sm"
          variant="outline"
          className="gap-2"
          onClick={() => setDraft(decisionDraftFor({ meeting, today, viewer }))}
        >
          <Plus className="h-4 w-4" />
          Record another decision
        </Button>
      )}

      {draft && (
        <DecisionDialog
          open
          onOpenChange={(open) => !open && setDraft(null)}
          draft={draft}
          setDraft={setDraft}
          meeting={meeting}
          agenda={agenda}
          onSaved={onChanged}
        />
      )}
    </div>
  );
}

export function ActionItemsPanel({
  items,
  meeting,
  agenda,
  decisions,
  canCreate,
  canEdit,
  canConvert,
  onChanged,
  today,
}: {
  items: OfficeHubActionItem[];
  meeting?: Pick<OfficeHubMeeting, 'id' | 'title' | 'date' | 'seriesId' | 'projectId' | 'projectName'> | null;
  agenda?: OfficeHubAgendaItem[];
  decisions?: OfficeHubDecision[];
  canCreate: boolean;
  canEdit: boolean;
  canConvert: boolean;
  onChanged: () => void;
  today: string;
}) {
  const { viewer } = useOfficeHub();
  const [draft, setDraft] = useState<ActionItemDraft | null>(null);
  const [converting, setConverting] = useState<OfficeHubActionItem | null>(null);

  return (
    <div className="space-y-3">
      {items.length === 0 ? (
        <OfficeHubEmptyState
          icon={CheckSquare}
          title="No action items yet."
          description={canCreate ? 'A meeting that agreed to do something should record it here.' : undefined}
          action={
            canCreate ? (
              <Button size="sm" className="gap-2" onClick={() => setDraft(actionItemDraftFor({ viewer }))}>
                <Plus className="h-4 w-4" />
                Add an action item
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="rounded-lg border bg-white p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="min-w-0 break-words text-sm font-medium text-slate-800">{item.title}</p>
                    <TaskStatusBadge
                      status={
                        item.status === 'Open'
                          ? 'Not Started'
                          : item.status === 'In Progress'
                            ? 'In Progress'
                            : item.status === 'Completed'
                              ? 'Completed'
                              : 'Cancelled'
                      }
                    />
                    <PriorityBadge priority={item.priority} />
                    {isActionItemOverdue(item, today) && (
                      <Badge variant="outline" className="border-rose-200 bg-rose-50 text-[11px] text-rose-700">
                        Overdue
                      </Badge>
                    )}
                    {item.carriedFromActionItemId && (
                      <Badge variant="outline" className="border-amber-200 bg-amber-50 text-[11px] text-amber-800">
                        Carried forward
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {item.reference} · {item.responsibleUserName || item.responsibleTeamName || 'Unassigned'}
                    {item.dueDate ? ` · due ${formatIsoDate(item.dueDate)}` : ''}
                  </p>
                  {item.description && (
                    <p className="mt-1 whitespace-pre-wrap break-words text-xs text-slate-600">{item.description}</p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  {item.taskId ? (
                    <Button size="sm" variant="outline" asChild className="gap-1.5">
                      <Link href={`${OFFICE_HUB_BASE_PATH}/tasks/${item.taskId}`}>
                        <ExternalLink className="h-3.5 w-3.5" />
                        View task
                      </Link>
                    </Button>
                  ) : canConvert ? (
                    <Button size="sm" className="gap-1.5" onClick={() => setConverting(item)}>
                      <ListTodo className="h-3.5 w-3.5" />
                      Create task
                    </Button>
                  ) : null}
                  {canEdit && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      aria-label={`Edit ${item.title}`}
                      onClick={() =>
                        setDraft({
                          id: item.id,
                          title: item.title,
                          description: item.description ?? '',
                          responsibleUserId: item.responsibleUserId ?? null,
                          responsibleUserName: item.responsibleUserName ?? null,
                          responsibleTeamId: item.responsibleTeamId ?? null,
                          responsibleTeamName: item.responsibleTeamName ?? null,
                          departmentId: item.departmentId ?? null,
                          departmentName: item.departmentName ?? null,
                          dueDate: item.dueDate ?? null,
                          priority: item.priority,
                          status: item.status,
                          agendaItemId: item.agendaItemId ?? null,
                          decisionId: item.decisionId ?? null,
                        })
                      }
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {canCreate && items.length > 0 && (
        <Button size="sm" variant="outline" className="gap-2" onClick={() => setDraft(actionItemDraftFor({ viewer }))}>
          <Plus className="h-4 w-4" />
          Add another action item
        </Button>
      )}

      {draft && (
        <ActionItemDialog
          open
          onOpenChange={(open) => !open && setDraft(null)}
          draft={draft}
          setDraft={setDraft}
          meeting={meeting}
          agenda={agenda}
          decisions={decisions}
          onSaved={onChanged}
        />
      )}

      {converting && (
        <CreateTaskFromActionItemDialog
          item={converting}
          meeting={meeting}
          open
          onOpenChange={(open) => !open && setConverting(null)}
          onCreated={() => {
            setConverting(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

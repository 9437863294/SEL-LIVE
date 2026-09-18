'use client';

/**
 * The task form (§24, §26, §67).
 *
 * One component for create and edit, and for the "quick create" dialog that can be opened from
 * anywhere (§67). The dialog and the full-page form are the same fields — the difference is only
 * which chrome wraps them — so a task raised in a hurry from a meeting carries the same information
 * as one created deliberately from the register.
 *
 * ── Team assignment (§26) ───────────────────────────────────────────────────────────────────────
 *
 * A task may be assigned to a person, to a team, or to a team *and* a person within it. The third
 * case is what §26's example describes — "Task: prepare project report / Team: Project Team /
 * Responsible: Project Manager" — so choosing a team narrows the assignee picker to that team's
 * members rather than clearing it. Choosing neither is refused: a task nobody owns is a task nobody
 * does.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Save } from 'lucide-react';
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
import { cn } from '@/lib/utils';
import {
  OFFICE_HUB_BASE_PATH,
  OFFICE_HUB_PRIORITIES,
  TASK_STATUSES,
  clampPercent,
  firstFieldError,
  validateTaskInput,
  type OfficeHubFieldErrors,
  type OfficeHubPriority,
  type OfficeHubTask,
  type TaskStatus,
} from '@/lib/office-hub';
import { createTask, updateTask } from '@/lib/office-hub-service';
import { useOfficeHub, useOfficeHubAction } from './hooks';
import {
  DateField,
  DepartmentSelector,
  ProjectSelector,
  TeamSelector,
  UserSelector,
} from './selectors';
import { FieldError, OfficeHubSection, officeHubDialog } from './ui';

export interface TaskDraft {
  title: string;
  description: string;
  assigneeId: string | null;
  assigneeName: string | null;
  teamId: string | null;
  teamName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  startDate: string | null;
  dueDate: string | null;
  priority: OfficeHubPriority;
  status: TaskStatus;
  progress: number;
  tags: string;
  projectId: string | null;
  projectName: string | null;
  meetingId: string | null;
  meetingTitle: string | null;
  actionItemId: string | null;
  decisionId: string | null;
  parentTaskId: string | null;
  parentTaskTitle: string | null;
}

export function emptyTaskDraft(options: {
  today: string;
  viewer: { userId: string; name: string; departmentId?: string | null; departmentName?: string | null };
  /** Pre-fill from wherever the task is being raised (§67, §84). */
  source?: {
    meetingId?: string | null;
    meetingTitle?: string | null;
    decisionId?: string | null;
    actionItemId?: string | null;
    projectId?: string | null;
    projectName?: string | null;
    parentTaskId?: string | null;
    parentTaskTitle?: string | null;
    assigneeId?: string | null;
    assigneeName?: string | null;
  };
}): TaskDraft {
  return {
    title: '',
    description: '',
    assigneeId: options.source?.assigneeId ?? options.viewer.userId,
    assigneeName: options.source?.assigneeName ?? options.viewer.name,
    teamId: null,
    teamName: null,
    departmentId: options.viewer.departmentId ?? null,
    departmentName: options.viewer.departmentName ?? null,
    startDate: options.today,
    dueDate: null,
    priority: 'Medium',
    status: 'Not Started',
    progress: 0,
    tags: '',
    projectId: options.source?.projectId ?? null,
    projectName: options.source?.projectName ?? null,
    meetingId: options.source?.meetingId ?? null,
    meetingTitle: options.source?.meetingTitle ?? null,
    actionItemId: options.source?.actionItemId ?? null,
    decisionId: options.source?.decisionId ?? null,
    parentTaskId: options.source?.parentTaskId ?? null,
    parentTaskTitle: options.source?.parentTaskTitle ?? null,
  };
}

export function draftFromTask(task: OfficeHubTask): TaskDraft {
  return {
    title: task.title,
    description: task.description ?? '',
    assigneeId: task.assigneeId ?? null,
    assigneeName: task.assigneeName ?? null,
    teamId: task.teamId ?? null,
    teamName: task.teamName ?? null,
    departmentId: task.departmentId ?? null,
    departmentName: task.departmentName ?? null,
    startDate: task.startDate ?? null,
    dueDate: task.dueDate ?? null,
    priority: task.priority,
    status: task.status,
    progress: task.progress ?? 0,
    tags: (task.tags ?? []).join(', '),
    projectId: task.projectId ?? null,
    projectName: task.projectName ?? null,
    meetingId: task.meetingId ?? null,
    meetingTitle: task.meetingTitle ?? null,
    actionItemId: task.actionItemId ?? null,
    decisionId: task.decisionId ?? null,
    parentTaskId: task.parentTaskId ?? null,
    parentTaskTitle: task.parentTaskTitle ?? null,
  };
}

/** The shared field set, used by both the page form and the dialog. */
function TaskFields({
  draft,
  setDraft,
  errors,
  showStatus,
  hasSubtasks,
}: {
  draft: TaskDraft;
  setDraft: (next: TaskDraft) => void;
  errors: OfficeHubFieldErrors;
  showStatus: boolean;
  hasSubtasks?: boolean;
}) {
  const { directory } = useOfficeHub();

  /** A chosen team narrows the assignee list to its members (§26). */
  const restrictAssignee = useMemo(() => {
    if (!draft.teamId) return undefined;
    const team = directory.teams.find((entry) => entry.id === draft.teamId);
    return team?.memberUserIds;
  }, [draft.teamId, directory.teams]);

  return (
    <>
      <div>
        <Label className="mb-1 block text-xs">
          Task title<span className="ml-0.5 text-destructive">*</span>
        </Label>
        <Input
          value={draft.title}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          placeholder="e.g. Prepare the August bank reconciliation"
          className={cn('bg-white', errors.title && 'border-destructive')}
          aria-invalid={Boolean(errors.title)}
        />
        <FieldError message={errors.title} />
      </div>

      <div>
        <Label className="mb-1 block text-xs">Description</Label>
        <Textarea
          value={draft.description}
          onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          rows={3}
          className="bg-white"
          placeholder="What has to be done, and anything the assignee needs to know."
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TeamSelector
          label="Team"
          value={draft.teamId}
          onChange={(teamId, name) => {
            const team = directory.teams.find((entry) => entry.id === teamId);
            const assigneeStillInTeam =
              !teamId || !draft.assigneeId || (team?.memberUserIds ?? []).includes(draft.assigneeId);
            setDraft({
              ...draft,
              teamId,
              teamName: name,
              // An assignee who is not in the newly chosen team is cleared rather than left as a
              // contradiction the form would happily save.
              assigneeId: assigneeStillInTeam ? draft.assigneeId : null,
              assigneeName: assigneeStillInTeam ? draft.assigneeName : null,
            });
          }}
        />

        <UserSelector
          label={draft.teamId ? 'Responsible within the team' : 'Assignee'}
          value={draft.assigneeId}
          restrictTo={restrictAssignee}
          error={errors.assigneeId}
          onChange={(userId, person) =>
            setDraft({
              ...draft,
              assigneeId: userId,
              assigneeName: person?.name ?? null,
              departmentId: person?.departmentId ?? draft.departmentId,
              departmentName: person?.departmentName ?? draft.departmentName,
            })
          }
        />

        <DepartmentSelector
          label="Department"
          value={draft.departmentId}
          placeholder="No department"
          onChange={(departmentId, name) => setDraft({ ...draft, departmentId, departmentName: name })}
        />

        <ProjectSelector
          label="Related project"
          value={draft.projectId}
          onChange={(projectId, name) => setDraft({ ...draft, projectId, projectName: name })}
        />

        <DateField
          label="Start date"
          value={draft.startDate}
          onChange={(next) => setDraft({ ...draft, startDate: next })}
          error={errors.startDate}
        />

        <DateField
          label="Due date"
          value={draft.dueDate}
          min={draft.startDate ?? undefined}
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

        {showStatus && (
          <div>
            <Label className="mb-1 block text-xs">Status</Label>
            <Select value={draft.status} onValueChange={(value) => setDraft({ ...draft, status: value as TaskStatus })}>
              <SelectTrigger className="bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TASK_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {showStatus && (
          <div>
            <Label className="mb-1 block text-xs">Progress</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                max={100}
                value={draft.progress}
                disabled={hasSubtasks}
                onChange={(event) => setDraft({ ...draft, progress: clampPercent(Number(event.target.value)) })}
                className="bg-white"
              />
              <span className="text-xs text-muted-foreground">%</span>
            </div>
            {hasSubtasks && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Calculated from the checklist — tick items to move it.
              </p>
            )}
            <FieldError message={errors.progress} />
          </div>
        )}

        <div className="sm:col-span-2">
          <Label className="mb-1 block text-xs">Tags</Label>
          <Input
            value={draft.tags}
            onChange={(event) => setDraft({ ...draft, tags: event.target.value })}
            placeholder="Comma separated, e.g. bank, month-end"
            className="bg-white"
          />
        </div>
      </div>
    </>
  );
}

const tagsOf = (value: string): string[] =>
  value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

export function TaskForm({
  initial,
  mode,
  taskId,
  hasSubtasks,
  onSaved,
}: {
  initial: TaskDraft;
  mode: 'create' | 'edit';
  taskId?: string;
  hasSubtasks?: boolean;
  onSaved?: (taskId: string) => void;
}) {
  const router = useRouter();
  const { actor, settings, directory } = useOfficeHub();
  const { isBusy, run } = useOfficeHubAction();
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<OfficeHubFieldErrors>({});

  const submit = async () => {
    const found = validateTaskInput(draft);
    setErrors(found);
    if (Object.keys(found).length || !actor) return;

    const teamLeaderId = draft.teamId
      ? directory.teams.find((team) => team.id === draft.teamId)?.leaderId ?? null
      : null;

    if (mode === 'create') {
      const id = await run(
        () =>
          createTask(
            actor,
            {
              ...draft,
              description: draft.description.trim() || null,
              tags: tagsOf(draft.tags),
            },
            { settings, teamLeaderId },
          ),
        { success: 'Task created', failure: 'Could not create the task', describe: 'Create task' },
      );
      if (id) {
        if (onSaved) onSaved(id);
        else router.push(`${OFFICE_HUB_BASE_PATH}/tasks/${id}`);
      }
      return;
    }

    if (!taskId) return;
    const ok = await run(
      () =>
        updateTask(
          actor,
          taskId,
          {
            title: draft.title.trim(),
            description: draft.description.trim() || null,
            assigneeId: draft.assigneeId,
            assigneeName: draft.assigneeName,
            teamId: draft.teamId,
            teamName: draft.teamName,
            departmentId: draft.departmentId,
            departmentName: draft.departmentName,
            startDate: draft.startDate,
            dueDate: draft.dueDate,
            priority: draft.priority,
            status: draft.status,
            progress: draft.progress,
            tags: tagsOf(draft.tags),
            projectId: draft.projectId,
            projectName: draft.projectName,
          },
          { settings },
        ),
      { success: 'Task updated', failure: 'Could not save your changes', describe: 'Update task' },
    );
    if (ok !== null && onSaved) onSaved(taskId);
  };

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <OfficeHubSection title="Task details" description="What has to be done, by whom, and by when.">
        <div className="space-y-3">
          <TaskFields
            draft={draft}
            setDraft={setDraft}
            errors={errors}
            showStatus={mode === 'edit'}
            hasSubtasks={hasSubtasks}
          />
        </div>
      </OfficeHubSection>

      {(draft.meetingTitle || draft.parentTaskTitle) && (
        <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-xs text-indigo-900">
          {draft.meetingTitle && <p>Raised from meeting: {draft.meetingTitle}</p>}
          {draft.parentTaskTitle && <p>Subtask of: {draft.parentTaskTitle}</p>}
        </div>
      )}

      {firstFieldError(errors) && (
        <p className="text-sm text-destructive">{firstFieldError(errors)}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={isBusy} className="gap-2">
          {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {mode === 'create' ? 'Create task' : 'Save changes'}
        </Button>
        <Button type="button" variant="ghost" disabled={isBusy} onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * Quick create (§67).
 *
 * The same fields in a dialog, so a task can be raised from a meeting, a decision, a dashboard or a
 * register without losing the page underneath — and with the source relationships already filled in
 * by whoever opened it.
 */
export function QuickCreateTaskDialog({
  open,
  onOpenChange,
  source,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source?: Parameters<typeof emptyTaskDraft>[0]['source'];
  onCreated?: (taskId: string) => void;
}) {
  const { actor, viewer, today, settings, directory } = useOfficeHub();
  const { isBusy, run } = useOfficeHubAction();
  const [draft, setDraft] = useState(() => emptyTaskDraft({ today, viewer, source }));
  const [errors, setErrors] = useState<OfficeHubFieldErrors>({});

  const submit = async () => {
    const found = validateTaskInput(draft);
    setErrors(found);
    if (Object.keys(found).length || !actor) return;

    const teamLeaderId = draft.teamId
      ? directory.teams.find((team) => team.id === draft.teamId)?.leaderId ?? null
      : null;

    const id = await run(
      () =>
        createTask(
          actor,
          { ...draft, description: draft.description.trim() || null, tags: tagsOf(draft.tags) },
          { settings, teamLeaderId },
        ),
      { success: 'Task created', failure: 'Could not create the task' },
    );

    if (id) {
      onOpenChange(false);
      // Reset, so reopening the dialog does not present the previous task's values.
      setDraft(emptyTaskDraft({ today, viewer, source }));
      setErrors({});
      onCreated?.(id);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={officeHubDialog.contentTall}>
        <DialogHeader className={officeHubDialog.header}>
          <DialogTitle>New task</DialogTitle>
          <DialogDescription>
            {source?.meetingTitle
              ? `Linked to ${source.meetingTitle}, so the task keeps a way back to where it came from.`
              : 'Assign it to a person, a team, or a person within a team.'}
          </DialogDescription>
        </DialogHeader>

        <div className={officeHubDialog.bodyScroll}>
          <TaskFields draft={draft} setDraft={setDraft} errors={errors} showStatus={false} />
        </div>

        <DialogFooter className={officeHubDialog.footer}>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isBusy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={isBusy} className="gap-2">
            {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Create task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

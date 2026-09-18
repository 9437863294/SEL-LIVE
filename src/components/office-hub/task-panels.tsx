'use client';

/**
 * A task's subtasks, dependencies, comments and activity trail (§28, §29, §30, §31).
 *
 * Four panels in one file because they are four tabs of one screen and share the same task object
 * and the same reload callback; splitting them would mean four files each importing the same six
 * things.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Ban,
  Check,
  CornerDownRight,
  Link2,
  Link2Off,
  MessageSquare,
  Plus,
  Send,
  Trash2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { formatAuditStamp } from '@/lib/audit-fields';
import {
  OFFICE_HUB_BASE_PATH,
  appendSubtask,
  canCompleteTask,
  dependencyEdges,
  dependencyWouldCycle,
  extractMentions,
  formatIsoDate,
  formatRelativeToNow,
  stripMentionMarkup,
  subtaskCompletion,
  taskBlockers,
  taskProgress,
  type OfficeHubTask,
  type OfficeHubTaskActivity,
  type OfficeHubTaskComment,
  type TaskDependency,
  type TaskDependencyType,
  type TaskStatus,
  type TaskSubtask,
} from '@/lib/office-hub';
import {
  addTaskComment,
  addTaskDependency,
  removeTaskDependency,
  saveSubtasks,
} from '@/lib/office-hub-service';
import { useOfficeHub, useOfficeHubAction } from './hooks';
import { UserSelector } from './selectors';
import {
  OfficeHubEmptyState,
  PersonChip,
  TaskProgressBar,
  TaskStatusBadge,
  officeHubDialog,
} from './ui';

/* ── subtasks (§28) ──────────────────────────────────────────────────────────────────────────── */

/**
 * The checklist.
 *
 * Progress is *derived* from it whenever there is one, so ticking an item moves the bar and a
 * hand-set percentage cannot sit stale next to a half-ticked list. That is `taskProgress`'s rule,
 * enforced in the service on every write rather than trusted to this component.
 */
export function SubtaskPanel({
  task,
  canEdit,
  onChanged,
}: {
  task: OfficeHubTask;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const { actor } = useOfficeHub();
  const { isBusy, run } = useOfficeHubAction();
  const [title, setTitle] = useState('');

  const subtasks = task.subtasks ?? [];
  const completion = subtaskCompletion(subtasks);

  const save = async (next: TaskSubtask[]) => {
    if (!actor) return;
    await run(() => saveSubtasks(actor, task.id, next), { failure: 'Could not save the checklist' });
    onChanged();
  };

  const add = async () => {
    if (!title.trim() || !actor) return;
    const next = appendSubtask(subtasks, {
      id: `st-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: title.trim(),
      done: false,
    });
    setTitle('');
    await save(next);
  };

  const toggle = async (subtaskId: string) => {
    const next = subtasks.map((subtask) =>
      subtask.id === subtaskId
        ? { ...subtask, done: !subtask.done, completedAt: subtask.done ? null : new Date().toISOString() }
        : subtask,
    );
    await save(next);
  };

  const remove = async (subtaskId: string) => {
    await save(subtasks.filter((subtask) => subtask.id !== subtaskId));
  };

  return (
    <div className="space-y-3">
      {subtasks.length > 0 && (
        <div className="flex items-center gap-3">
          <p className="text-xs text-muted-foreground">
            {completion.done} of {completion.total} complete
          </p>
          <TaskProgressBar task={task} className="max-w-xs flex-1" />
        </div>
      )}

      {subtasks.length === 0 ? (
        <OfficeHubEmptyState
          icon={Check}
          title="No checklist."
          description={
            canEdit
              ? 'Break the task into steps and its progress will follow them automatically.'
              : undefined
          }
        />
      ) : (
        <ul className="divide-y rounded-lg border bg-white">
          {subtasks.map((subtask) => (
            <li key={subtask.id} className="flex items-center gap-2 px-3 py-2">
              <Checkbox
                checked={subtask.done}
                disabled={!canEdit || isBusy}
                onCheckedChange={() => void toggle(subtask.id)}
                aria-label={`Mark "${subtask.title}" ${subtask.done ? 'not done' : 'done'}`}
              />
              <span
                className={cn(
                  'min-w-0 flex-1 break-words text-sm',
                  subtask.done ? 'text-muted-foreground line-through' : 'text-slate-800',
                )}
              >
                {subtask.title}
                {subtask.assigneeName && (
                  <span className="ml-2 text-[11px] text-muted-foreground">{subtask.assigneeName}</span>
                )}
                {subtask.dueDate && (
                  <span className="ml-2 text-[11px] text-muted-foreground">{formatIsoDate(subtask.dueDate)}</span>
                )}
              </span>
              {canEdit && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-destructive"
                  disabled={isBusy}
                  onClick={() => void remove(subtask.id)}
                  aria-label={`Remove "${subtask.title}"`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <div className="flex gap-2">
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void add();
              }
            }}
            placeholder="Add a step and press Enter"
            className="bg-white"
          />
          <Button onClick={() => void add()} disabled={isBusy || !title.trim()} className="shrink-0 gap-1.5">
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </div>
      )}
    </div>
  );
}

/* ── dependencies (§29) ──────────────────────────────────────────────────────────────────────── */

const DEPENDENCY_LABELS: Record<TaskDependencyType, string> = {
  'blocked-by': 'Blocked by',
  'depends-on': 'Depends on',
  blocks: 'Blocks',
};

export function DependencyPanel({
  task,
  candidates,
  statusByTaskId,
  canEdit,
  onChanged,
}: {
  task: OfficeHubTask;
  /** Tasks the viewer can see, for the picker and the cycle check. */
  candidates: OfficeHubTask[];
  statusByTaskId: Record<string, TaskStatus>;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const { actor } = useOfficeHub();
  const { isBusy, run } = useOfficeHubAction();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<TaskDependencyType>('blocked-by');
  const [otherId, setOtherId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dependencies = task.dependencies ?? [];
  const blockers = taskBlockers(task, statusByTaskId);
  const completion = canCompleteTask(task, statusByTaskId);

  const edges = useMemo(() => dependencyEdges(candidates), [candidates]);

  const add = async () => {
    setError(null);
    if (!otherId || !actor) {
      setError('Choose the other task.');
      return;
    }
    const other = candidates.find((entry) => entry.id === otherId);
    if (!other) {
      setError('That task could not be found.');
      return;
    }
    if (dependencies.some((dependency) => dependency.taskId === otherId && dependency.type === type)) {
      setError('That link already exists.');
      return;
    }

    /**
     * Refuse a cycle.
     *
     * A → B → C → A is three tasks none of which can ever be completed, with nothing on screen to
     * explain why. For a `blocks` link the direction is reversed, so the check is made from the
     * other end.
     */
    const dependent = type === 'blocks' ? otherId : task.id;
    const prerequisite = type === 'blocks' ? task.id : otherId;
    if (dependencyWouldCycle(dependent, prerequisite, edges)) {
      setError(
        'That link would create a circle — each task would be waiting on the other, and neither could ever be completed.',
      );
      return;
    }

    const ok = await run(
      () =>
        addTaskDependency(actor, task.id, {
          type,
          taskId: other.id,
          taskTitle: other.title,
          taskReference: other.reference,
        }),
      { success: 'Tasks linked', failure: 'Could not link the tasks' },
    );
    if (ok !== null) {
      setOpen(false);
      setOtherId(null);
      onChanged();
    }
  };

  const remove = async (dependency: TaskDependency) => {
    if (!actor) return;
    await run(() => removeTaskDependency(actor, task.id, dependency), { failure: 'Could not unlink the tasks' });
    onChanged();
  };

  return (
    <div className="space-y-3">
      {!completion.allowed && completion.reason && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <Ban className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
          <p className="text-xs text-amber-900">{completion.reason}</p>
        </div>
      )}

      {dependencies.length === 0 ? (
        <OfficeHubEmptyState
          icon={Link2}
          title="No linked tasks."
          description={canEdit ? 'Link a task that must finish first, or one that is waiting on this.' : undefined}
        />
      ) : (
        <ul className="space-y-1.5">
          {dependencies.map((dependency) => {
            const isBlocker = blockers.some(
              (blocker) => blocker.taskId === dependency.taskId && blocker.type === dependency.type,
            );
            const status = statusByTaskId[dependency.taskId];
            return (
              <li
                key={`${dependency.type}-${dependency.taskId}`}
                className={cn('flex items-center gap-2 rounded-lg border bg-white px-3 py-2', isBlocker && 'border-amber-200')}
              >
                {dependency.type === 'blocks' ? (
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                ) : (
                  <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                )}
                <Badge variant="outline" className="shrink-0 border-slate-200 bg-slate-50 text-[11px]">
                  {DEPENDENCY_LABELS[dependency.type]}
                </Badge>
                <Link
                  href={`${OFFICE_HUB_BASE_PATH}/tasks/${dependency.taskId}`}
                  className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 hover:underline"
                >
                  {dependency.taskTitle}
                </Link>
                {status && <TaskStatusBadge status={status} className="shrink-0" />}
                {isBlocker && (
                  <Badge variant="outline" className="shrink-0 border-amber-200 bg-amber-50 text-[11px] text-amber-800">
                    Blocking
                  </Badge>
                )}
                {canEdit && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0 text-destructive"
                    disabled={isBusy}
                    onClick={() => void remove(dependency)}
                    aria-label={`Unlink ${dependency.taskTitle}`}
                  >
                    <Link2Off className="h-3.5 w-3.5" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canEdit && (
        <Button size="sm" variant="outline" onClick={() => setOpen(true)} className="gap-2">
          <Link2 className="h-4 w-4" />
          Link a task
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className={officeHubDialog.content}>
          <DialogHeader className={officeHubDialog.header}>
            <DialogTitle>Link a task</DialogTitle>
            <DialogDescription>
              Both ends of the link are written, so the other task shows it too.
            </DialogDescription>
          </DialogHeader>

          <div className={officeHubDialog.body}>
            <div>
              <Label className="mb-1 block text-xs">This task</Label>
              <Select value={type} onValueChange={(value) => setType(value as TaskDependencyType)}>
                <SelectTrigger className="bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="blocked-by">is blocked by</SelectItem>
                  <SelectItem value="depends-on">depends on</SelectItem>
                  <SelectItem value="blocks">blocks</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="mb-1 block text-xs">Task</Label>
              <Select value={otherId ?? ''} onValueChange={setOtherId}>
                <SelectTrigger className="bg-white">
                  <SelectValue placeholder="Choose a task" />
                </SelectTrigger>
                <SelectContent>
                  {candidates
                    .filter((candidate) => candidate.id !== task.id)
                    .slice(0, 100)
                    .map((candidate) => (
                      <SelectItem key={candidate.id} value={candidate.id}>
                        {candidate.reference} — {candidate.title}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {error && (
              <p className="flex items-start gap-1.5 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                {error}
              </p>
            )}
          </div>

          <DialogFooter className={officeHubDialog.footer}>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={isBusy}>
              Cancel
            </Button>
            <Button onClick={() => void add()} disabled={isBusy}>
              Link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ── comments (§30) ──────────────────────────────────────────────────────────────────────────── */

/**
 * The comment thread, with @mentions and replies.
 *
 * Mentions are stored as `@[Name](userId)` — the name so the text reads correctly forever even if
 * the person is renamed, the id so the notification reaches the right account. The composer inserts
 * that markup when a name is picked; readers only ever see `@Name`.
 */
export function TaskCommentsPanel({
  task,
  comments,
  canComment,
  onChanged,
}: {
  task: OfficeHubTask;
  comments: OfficeHubTaskComment[];
  canComment: boolean;
  onChanged: () => void;
}) {
  const { actor, settings, directory } = useOfficeHub();
  const { isBusy, run } = useOfficeHubAction();
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<OfficeHubTaskComment | null>(null);
  const [mentioning, setMentioning] = useState<string | null>(null);

  const threaded = useMemo(() => {
    const roots = comments.filter((comment) => !comment.parentCommentId);
    const repliesByParent = new Map<string, OfficeHubTaskComment[]>();
    for (const comment of comments) {
      if (!comment.parentCommentId) continue;
      const list = repliesByParent.get(comment.parentCommentId) ?? [];
      list.push(comment);
      repliesByParent.set(comment.parentCommentId, list);
    }
    return roots.map((root) => ({ comment: root, replies: repliesByParent.get(root.id) ?? [] }));
  }, [comments]);

  const send = async () => {
    if (!body.trim() || !actor) return;
    const ok = await run(
      () =>
        addTaskComment(actor, task.id, body, {
          parentCommentId: replyTo?.id ?? null,
          settings,
        }),
      { failure: 'Could not post your comment' },
    );
    if (ok) {
      setBody('');
      setReplyTo(null);
      onChanged();
    }
  };

  const insertMention = (userId: string) => {
    const person = directory.people.find((entry) => entry.userId === userId);
    if (!person) return;
    setBody((current) => `${current}${current && !current.endsWith(' ') ? ' ' : ''}@[${person.name}](${person.userId}) `);
    setMentioning(null);
  };

  return (
    <div className="space-y-3">
      {threaded.length === 0 ? (
        <OfficeHubEmptyState
          icon={MessageSquare}
          title="No comments yet."
          description={canComment ? 'Ask a question, or record what changed. Mention somebody with @.' : undefined}
        />
      ) : (
        <ul className="space-y-3">
          {threaded.map(({ comment, replies }) => (
            <li key={comment.id} className="rounded-lg border bg-white p-3">
              <CommentBody comment={comment} />
              {canComment && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-1 h-6 px-1.5 text-[11px]"
                  onClick={() => setReplyTo(comment)}
                >
                  Reply
                </Button>
              )}
              {replies.length > 0 && (
                <ul className="mt-2 space-y-2 border-l-2 border-slate-100 pl-3">
                  {replies.map((reply) => (
                    <li key={reply.id}>
                      <CommentBody comment={reply} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      {canComment && (
        <div className="space-y-2 rounded-lg border bg-white p-3">
          {replyTo && (
            <div className="flex items-center justify-between gap-2 rounded bg-slate-50 px-2 py-1 text-[11px] text-muted-foreground">
              <span className="truncate">Replying to {replyTo.createdByName}</span>
              <Button size="sm" variant="ghost" className="h-5 px-1 text-[11px]" onClick={() => setReplyTo(null)}>
                Cancel
              </Button>
            </div>
          )}

          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={3}
            placeholder="Write a comment. Use the button below to mention somebody."
            className="bg-white"
          />

          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-[12rem] flex-1">
              <UserSelector
                value={mentioning}
                placeholder="Mention somebody"
                allowClear={false}
                onChange={(userId) => userId && insertMention(userId)}
              />
            </div>
            <Button onClick={() => void send()} disabled={isBusy || !body.trim()} className="gap-2">
              <Send className="h-4 w-4" />
              {replyTo ? 'Reply' : 'Comment'}
            </Button>
          </div>

          {extractMentions(body).length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              {extractMentions(body).length} {extractMentions(body).length === 1 ? 'person' : 'people'} will be
              notified.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function CommentBody({ comment }: { comment: OfficeHubTaskComment }) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline gap-2">
        <PersonChip name={comment.createdByName} />
        <span className="text-[11px] text-muted-foreground">
          {formatAuditStamp(null, comment.createdAt) || '—'}
        </span>
        {comment.editedAt && <span className="text-[11px] italic text-muted-foreground">edited</span>}
      </div>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-700">
        {stripMentionMarkup(comment.body)}
      </p>
    </div>
  );
}

/* ── activity (§31) ──────────────────────────────────────────────────────────────────────────── */

/**
 * The activity timeline.
 *
 * Every entry names a change — "Priority changed from Medium to High" — because the entries come
 * from the diff rather than from the form. An edit that changed nothing writes nothing, which is
 * what keeps this readable after six months.
 */
export function TaskActivityPanel({ entries }: { entries: OfficeHubTaskActivity[] }) {
  if (!entries.length) {
    return <OfficeHubEmptyState icon={Activity} title="No activity recorded yet." />;
  }

  return (
    <ol className="space-y-0">
      {entries.map((entry, index) => (
        <li key={entry.id} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span
              className={cn(
                'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                entry.kind === 'completed'
                  ? 'bg-emerald-500'
                  : entry.kind === 'reopened' || entry.kind === 'archived'
                    ? 'bg-rose-400'
                    : 'bg-slate-300',
              )}
            />
            {index < entries.length - 1 && <span className="w-px flex-1 bg-slate-200" />}
          </div>
          <div className="min-w-0 flex-1 pb-3">
            <p className="break-words text-sm text-slate-800">{entry.summary}</p>
            <p className="text-[11px] text-muted-foreground">
              {entry.actorName ?? 'Someone'} ·{' '}
              {formatRelativeToNow(entry.at ? new Date(entry.at) : null)}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** The read-only progress figure, for a screen that shows it without the checklist. */
export function TaskProgressSummary({ task }: { task: OfficeHubTask }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-semibold tabular-nums text-slate-800">{taskProgress(task)}%</span>
      <TaskProgressBar task={task} className="flex-1" />
    </div>
  );
}

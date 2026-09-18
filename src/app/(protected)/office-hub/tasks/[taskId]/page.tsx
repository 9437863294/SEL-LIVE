'use client';

/**
 * The task detail page (§24, §28–§31).
 *
 * ── The source chain (§23) ──────────────────────────────────────────────────────────────────────
 *
 * The header carries the whole chain a task came out of — meeting, decision, action item — as
 * links, because "View Source Meeting" is what makes the chain worth recording. A task raised from
 * a meeting five weeks ago should be able to answer "what were we discussing when we agreed this?"
 * in one click, and that is the difference between a task list and a record of decisions.
 *
 * The task record itself is a live listener: status and progress change from the Kanban board, from
 * a subtask being ticked, and from whoever else has this open.
 */

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Ban,
  CheckCircle2,
  CheckSquare,
  Link2,
  ListTodo,
  MessageSquare,
  Paperclip,
  Pencil,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { formatAuditStamp } from '@/lib/audit-fields';
import {
  OFFICE_HUB_BASE_PATH,
  TASK_STATUSES,
  canCompleteTask,
  canCompleteTaskAs,
  canEditTask,
  canViewTask,
  formatIsoDate,
  isTaskOverdue,
  subtaskCompletion,
  taskOverdueDays,
  taskProgress,
  type OfficeHubTask,
  type OfficeHubTaskComment,
  type TaskStatus,
} from '@/lib/office-hub';
import {
  archiveTask,
  listDocuments,
  listMyTasks,
  listTaskActivity,
  listTasks,
  subscribeTask,
  subscribeTaskComments,
  updateTask,
} from '@/lib/office-hub-service';
import { useOfficeHub, useOfficeHubAction, useOfficeHubQuery } from '@/components/office-hub/hooks';
import {
  OfficeHubAccessDenied,
  OfficeHubCallout,
  OfficeHubEmptyState,
  OfficeHubField,
  OfficeHubLoader,
  OfficeHubPageHeader,
  PersonChip,
  PriorityBadge,
  TaskDueDate,
  TaskStatusBadge,
} from '@/components/office-hub/ui';
import {
  DependencyPanel,
  SubtaskPanel,
  TaskActivityPanel,
  TaskCommentsPanel,
  TaskProgressSummary,
} from '@/components/office-hub/task-panels';
import { DocumentsPanel } from '@/components/office-hub/documents-panel';
import { TaskForm, draftFromTask } from '@/components/office-hub/task-form';

export default function TaskDetailPage() {
  const params = useParams<{ taskId: string }>();
  const taskId = params?.taskId ?? '';
  const router = useRouter();
  const { actor, viewer, capabilities, settings, today, isLoading } = useOfficeHub();
  const { isBusy, run } = useOfficeHubAction();

  const [task, setTask] = useState<OfficeHubTask | null>(null);
  const [taskLoading, setTaskLoading] = useState(true);
  const [comments, setComments] = useState<OfficeHubTaskComment[]>([]);
  const [tab, setTab] = useState('overview');
  const [editing, setEditing] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveReason, setArchiveReason] = useState('');

  useEffect(() => {
    if (!taskId) return;
    setTaskLoading(true);
    return subscribeTask(taskId, (next) => {
      setTask(next);
      setTaskLoading(false);
    });
  }, [taskId]);

  useEffect(() => {
    if (!taskId) return;
    return subscribeTaskComments(taskId, setComments);
  }, [taskId]);

  const activityQuery = useOfficeHubQuery(() => listTaskActivity(taskId), [taskId], {
    enabled: Boolean(taskId),
    initial: [],
  });
  const documentsQuery = useOfficeHubQuery(() => listDocuments('task', taskId), [taskId], {
    enabled: Boolean(taskId),
    initial: [],
  });

  /**
   * Candidate tasks for the dependency picker, and their statuses.
   *
   * Scoped to what the viewer can see, so the picker cannot be used to discover tasks they are not
   * entitled to. `canViewAllTasks` gets the wide list; everybody else gets their own.
   */
  const candidatesQuery = useOfficeHubQuery(
    () =>
      capabilities.canViewAllTasks
        ? listTasks('all', viewer, { limit: 200 })
        : listMyTasks(viewer.userId, { limit: 200 }),
    [capabilities.canViewAllTasks, viewer.userId],
    { enabled: Boolean(taskId), initial: [] },
  );

  const candidates = candidatesQuery.data ?? [];
  const statusByTaskId = useMemo(() => {
    const map: Record<string, TaskStatus> = {};
    for (const candidate of candidates) map[candidate.id] = candidate.status;
    // The task's own dependencies may point at tasks outside the candidate list; those resolve to
    // "unknown", which `taskBlockers` deliberately does not treat as blocking.
    return map;
  }, [candidates]);

  const verdicts = useMemo(() => {
    if (!task) return null;
    return {
      edit: canEditTask(task, viewer, capabilities),
      complete: canCompleteTaskAs(task, viewer, capabilities),
      dependencies: canCompleteTask(task, statusByTaskId),
    };
  }, [task, viewer, capabilities, statusByTaskId]);

  const reload = () => {
    activityQuery.reload();
    documentsQuery.reload();
    candidatesQuery.reload();
  };

  if (isLoading || taskLoading) return <OfficeHubLoader label="Loading the task" />;

  if (!task) {
    return (
      <OfficeHubEmptyState
        icon={AlertTriangle}
        title="That task could not be found."
        action={
          <Button variant="outline" asChild>
            <Link href={`${OFFICE_HUB_BASE_PATH}/tasks`}>Back to tasks</Link>
          </Button>
        }
      />
    );
  }

  if (!canViewTask(task, viewer, capabilities)) return <OfficeHubAccessDenied what="this task" />;

  const overdue = isTaskOverdue(task, today);
  const checklist = subtaskCompletion(task.subtasks);
  const canEdit = verdicts?.edit.allowed ?? false;

  const setStatus = async (next: TaskStatus) => {
    if (!actor) return;
    if (next === 'Completed' && !verdicts?.dependencies.allowed) {
      const { toast } = await import('@/hooks/use-toast');
      toast({
        variant: 'destructive',
        title: 'Blocked by another task',
        description: verdicts?.dependencies.reason ?? undefined,
      });
      return;
    }
    await run(() => updateTask(actor, task.id, { status: next }, { settings }), {
      success: next === 'Completed' ? 'Task completed' : `Status set to ${next}`,
      failure: 'Could not change the status',
    });
    reload();
  };

  const doArchive = async () => {
    if (!actor) return;
    const ok = await run(() => archiveTask(actor, task.id, archiveReason.trim() || undefined), {
      success: 'Task removed',
      failure: 'Could not remove the task',
    });
    if (ok !== null) {
      setArchiveOpen(false);
      router.push(`${OFFICE_HUB_BASE_PATH}/tasks`);
    }
  };

  return (
    <div className="space-y-3">
      <OfficeHubPageHeader
        title={task.title}
        description={`${task.reference}${task.projectName ? ` · ${task.projectName}` : ''}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canEdit && (
              <Select value={task.status} onValueChange={(value) => void setStatus(value as TaskStatus)}>
                <SelectTrigger className="h-9 w-36 bg-white" aria-label="Task status">
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
            )}
            {verdicts?.complete.allowed && task.status !== 'Completed' && (
              <Button onClick={() => void setStatus('Completed')} disabled={isBusy} className="gap-2">
                <CheckCircle2 className="h-4 w-4" />
                Mark complete
              </Button>
            )}
            {canEdit && task.status === 'Completed' && (
              <Button variant="outline" onClick={() => void setStatus('In Progress')} disabled={isBusy} className="gap-2">
                <RotateCcw className="h-4 w-4" />
                Reopen
              </Button>
            )}
            {canEdit && (
              <Button variant="outline" onClick={() => setEditing(true)} className="gap-2">
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
            )}
            {capabilities.canDeleteTask && (
              <Button variant="ghost" onClick={() => setArchiveOpen(true)} className="gap-2 text-destructive">
                <Trash2 className="h-4 w-4" />
                Remove
              </Button>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <TaskStatusBadge status={task.status} />
        <PriorityBadge priority={task.priority} />
        <TaskDueDate task={task} today={today} />
        {overdue && (
          <Badge variant="outline" className="border-rose-200 bg-rose-50 text-[11px] text-rose-700">
            {taskOverdueDays(task, today)} day{taskOverdueDays(task, today) === 1 ? '' : 's'} overdue
          </Badge>
        )}
        {(task.tags ?? []).map((tag) => (
          <Badge key={tag} variant="outline" className="border-slate-200 bg-slate-50 text-[11px]">
            {tag}
          </Badge>
        ))}
      </div>

      {/* §23's chain, as links. */}
      {(task.meetingId || task.decisionId || task.actionItemId || task.parentTaskId) && (
        <Card className="border-indigo-100 bg-indigo-50/60">
          <CardContent className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2.5 text-xs text-indigo-900">
            <span className="font-semibold uppercase tracking-wide">Came from</span>
            {task.meetingId && (
              <>
                <ArrowRight className="h-3 w-3" />
                <Link href={`${OFFICE_HUB_BASE_PATH}/meetings/${task.meetingId}`} className="font-medium hover:underline">
                  {task.meetingTitle ?? 'Source meeting'}
                </Link>
              </>
            )}
            {task.decisionId && (
              <>
                <ArrowRight className="h-3 w-3" />
                <Link href={`${OFFICE_HUB_BASE_PATH}/decisions/${task.decisionId}`} className="font-medium hover:underline">
                  Decision
                </Link>
              </>
            )}
            {task.actionItemId && (
              <>
                <ArrowRight className="h-3 w-3" />
                <span className="font-medium">Action item</span>
              </>
            )}
            {task.parentTaskId && (
              <>
                <span className="opacity-60">·</span>
                <span>Under</span>
                <Link href={`${OFFICE_HUB_BASE_PATH}/tasks/${task.parentTaskId}`} className="font-medium hover:underline">
                  {task.parentTaskTitle ?? 'parent task'}
                </Link>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {overdue && (
        <OfficeHubCallout
          tone="rose"
          icon={AlertTriangle}
          title={`This task is ${taskOverdueDays(task, today)} day${
            taskOverdueDays(task, today) === 1 ? '' : 's'
          } past its due date`}
          description={
            canEdit
              ? 'Either move the date and say why, or close it out. An overdue date nobody has looked at stops meaning anything.'
              : undefined
          }
        />
      )}

      {!verdicts?.dependencies.allowed && verdicts?.dependencies.reason && (
        <OfficeHubCallout tone="amber" icon={Ban} title="Blocked" description={verdicts.dependencies.reason} />
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="overview" className="text-xs">
            Overview
          </TabsTrigger>
          <TabsTrigger value="checklist" className="gap-1.5 text-xs">
            <CheckSquare className="h-3.5 w-3.5" />
            Checklist{checklist.total ? ` (${checklist.done}/${checklist.total})` : ''}
          </TabsTrigger>
          <TabsTrigger value="dependencies" className="gap-1.5 text-xs">
            <Link2 className="h-3.5 w-3.5" />
            Links{(task.dependencies?.length ?? 0) ? ` (${task.dependencies!.length})` : ''}
          </TabsTrigger>
          <TabsTrigger value="comments" className="gap-1.5 text-xs">
            <MessageSquare className="h-3.5 w-3.5" />
            Comments{comments.length ? ` (${comments.length})` : ''}
          </TabsTrigger>
          <TabsTrigger value="documents" className="gap-1.5 text-xs">
            <Paperclip className="h-3.5 w-3.5" />
            Files{(documentsQuery.data?.length ?? 0) ? ` (${documentsQuery.data!.length})` : ''}
          </TabsTrigger>
          <TabsTrigger value="activity" className="gap-1.5 text-xs">
            <Activity className="h-3.5 w-3.5" />
            Activity
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-3 space-y-3">
          <Card>
            <CardContent className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
              <OfficeHubField label="Assignee">
                <PersonChip name={task.assigneeName ?? null} subtitle={task.departmentName} />
              </OfficeHubField>
              {task.teamName && (
                <OfficeHubField label="Team">
                  <Link
                    href={`${OFFICE_HUB_BASE_PATH}/teams/${task.teamId}`}
                    className="text-indigo-600 hover:underline"
                  >
                    {task.teamName}
                  </Link>
                </OfficeHubField>
              )}
              <OfficeHubField label="Department">{task.departmentName}</OfficeHubField>
              <OfficeHubField label="Start date">
                {task.startDate ? formatIsoDate(task.startDate) : '—'}
              </OfficeHubField>
              <OfficeHubField label="Due date">
                <TaskDueDate task={task} today={today} />
              </OfficeHubField>
              <OfficeHubField label="Priority">
                <PriorityBadge priority={task.priority} />
              </OfficeHubField>
              <OfficeHubField label="Status">
                <TaskStatusBadge status={task.status} />
              </OfficeHubField>
              <OfficeHubField label="Progress">
                <TaskProgressSummary task={task} />
              </OfficeHubField>
              {task.projectName && <OfficeHubField label="Project">{task.projectName}</OfficeHubField>}
              {task.completedByName && (
                <OfficeHubField label="Completed by">
                  {task.completedByName}
                  {task.completedAt && (
                    <span className="block text-[11px] text-muted-foreground">
                      {formatIsoDate(task.completedAt.slice(0, 10))}
                    </span>
                  )}
                </OfficeHubField>
              )}
            </CardContent>
          </Card>

          {task.description && (
            <Card>
              <CardContent className="p-4">
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Description
                </p>
                <p className="whitespace-pre-wrap text-sm text-slate-700">{task.description}</p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-1 p-4 text-xs text-muted-foreground">
              <span>Raised by {formatAuditStamp(task.createdByName, task.createdAt)}</span>
              <span>Last updated {formatAuditStamp(task.updatedByName, task.updatedAt)}</span>
              {(task.watcherUserIds?.length ?? 0) > 0 && (
                <span>
                  {task.watcherUserIds!.length} {task.watcherUserIds!.length === 1 ? 'person' : 'people'} following
                </span>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="checklist" className="mt-3">
          <SubtaskPanel task={task} canEdit={canEdit} onChanged={reload} />
        </TabsContent>

        <TabsContent value="dependencies" className="mt-3">
          <DependencyPanel
            task={task}
            candidates={candidates}
            statusByTaskId={statusByTaskId}
            canEdit={canEdit}
            onChanged={reload}
          />
        </TabsContent>

        <TabsContent value="comments" className="mt-3">
          <TaskCommentsPanel
            task={task}
            comments={comments}
            canComment={capabilities.canCommentOnTasks}
            onChanged={reload}
          />
        </TabsContent>

        <TabsContent value="documents" className="mt-3">
          <DocumentsPanel
            entityType="task"
            entityId={task.id}
            meetingId={task.meetingId ?? null}
            documents={documentsQuery.data ?? []}
            canUpload={capabilities.canUploadDocuments}
            canRemove={capabilities.canRemoveDocuments || canEdit}
            onChanged={documentsQuery.reload}
          />
        </TabsContent>

        <TabsContent value="activity" className="mt-3">
          <TaskActivityPanel entries={activityQuery.data ?? []} />
        </TabsContent>
      </Tabs>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Edit task</DialogTitle>
            <DialogDescription>
              Changing the assignee or the due date notifies the people following this task.
            </DialogDescription>
          </DialogHeader>
          <TaskForm
            initial={draftFromTask(task)}
            mode="edit"
            taskId={task.id}
            hasSubtasks={(task.subtasks?.length ?? 0) > 0}
            onSaved={() => {
              setEditing(false);
              reload();
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove this task?</DialogTitle>
            <DialogDescription>
              The task is hidden from the registers but not destroyed — its comments, activity trail
              and link back to the meeting are kept, and an administrator can restore it.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label className="mb-1 block text-xs">Reason (optional)</Label>
            <Textarea
              value={archiveReason}
              onChange={(event) => setArchiveReason(event.target.value)}
              rows={2}
              className="bg-white"
              placeholder="e.g. Duplicate of TSK-2627-0019"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setArchiveOpen(false)} disabled={isBusy}>
              Keep it
            </Button>
            <Button variant="destructive" onClick={() => void doArchive()} disabled={isBusy} className="gap-2">
              <Trash2 className="h-4 w-4" />
              Remove task
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {task.status === 'Completed' && (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <ListTodo className="h-3 w-3" />
          Progress is pinned at {taskProgress(task)}% for a completed task.
        </p>
      )}
    </div>
  );
}

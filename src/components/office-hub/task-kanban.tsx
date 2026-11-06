'use client';

/**
 * The Kanban board (§25).
 *
 * Four columns — Not Started, In Progress, On Hold, Completed — and a drag moves a task's status.
 * Cancelled is deliberately not a column: it is an outcome, not a stage of work, and giving it a
 * lane invites people to park things there instead of saying why.
 *
 * ── Drag-and-drop, and the two things it has to get right ───────────────────────────────────────
 *
 *  1. **Optimistic, but honestly so.** The card moves the instant it is dropped, because a board
 *     that waits for a round trip feels broken. If the write fails the card moves back and a toast
 *     says so — §2's "optimistic UI where appropriate" is only appropriate when the rollback is
 *     real.
 *
 *  2. **Keyboard-operable.** `@hello-pangea/dnd` is a fork of react-beautiful-dnd precisely because
 *     it kept the accessible behaviour: space to lift, arrows to move, space to drop, with live
 *     announcements. §55 asks for keyboard navigation, and a board that can only be used with a
 *     mouse fails that no matter how good the mouse experience is. Each card also carries a plain
 *     status dropdown for anybody who would rather not drag at all.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { AlertTriangle, GripVertical, ListTodo, Paperclip, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  OFFICE_HUB_BASE_PATH,
  TASK_KANBAN_COLUMNS,
  TASK_STATUSES,
  canEditTask,
  isTaskOverdue,
  subtaskCompletion,
  taskProgress,
  type OfficeHubTask,
  type TaskStatus,
} from '@/lib/office-hub';
import { setTaskStatus } from '@/lib/office-hub-service';
import { useOfficeHub, useOfficeHubAction } from './hooks';
import { OfficeHubEmptyState, TaskDueDate } from './ui';

/*
  Type-only, so it is erased at compile time and does not pull the library into the server bundle.
  The runtime pieces below are still loaded through `next/dynamic` with `ssr: false`.
*/
import type {
  DraggableProvided,
  DraggableStateSnapshot,
  DropResult,
  DroppableProvided,
  DroppableStateSnapshot,
} from '@hello-pangea/dnd';

/**
 * The DnD context is loaded on the client only.
 *
 * `@hello-pangea/dnd` touches `document` during module initialisation, so importing it statically
 * breaks the server render of any page that shows the board. The board is also the one view in the
 * module most people never open, which makes it a good candidate to keep out of the initial bundle
 * regardless.
 */
const DragDropContext = dynamic(
  () => import('@hello-pangea/dnd').then((module) => module.DragDropContext),
  { ssr: false },
);
const Droppable = dynamic(() => import('@hello-pangea/dnd').then((module) => module.Droppable), {
  ssr: false,
});
const Draggable = dynamic(() => import('@hello-pangea/dnd').then((module) => module.Draggable), {
  ssr: false,
});

/** The column's dot — the board itself is one quiet surface, so the colour sits in the header. */
const COLUMN_DOT: Record<TaskStatus, string> = {
  'Not Started': 'bg-slate-400',
  'In Progress': 'bg-blue-500',
  'On Hold': 'bg-amber-500',
  Completed: 'bg-emerald-600',
  Cancelled: 'bg-rose-500',
};

const PRIORITY_EDGE: Record<string, string> = {
  Low: '#10b981',
  Medium: '#f59e0b',
  High: '#ea580c',
  Critical: '#e11d48',
};

export function TaskKanban({
  tasks,
  onChanged,
}: {
  tasks: OfficeHubTask[];
  onChanged: () => void;
}) {
  const { actor, viewer, capabilities, settings, today } = useOfficeHub();
  const { run } = useOfficeHubAction();

  /** Status overrides applied while a write is in flight, so the card stays where it was dropped. */
  const [pending, setPending] = useState<Record<string, TaskStatus>>({});

  const statusOf = (task: OfficeHubTask): TaskStatus => pending[task.id] ?? task.status;

  const columns = useMemo(() => {
    const grouped = new Map<TaskStatus, OfficeHubTask[]>();
    for (const status of TASK_KANBAN_COLUMNS) grouped.set(status, []);
    for (const task of tasks) {
      const status = statusOf(task);
      // A cancelled task has no lane; it is reachable from the register and its own page.
      if (!grouped.has(status)) continue;
      grouped.get(status)!.push(task);
    }
    for (const [, list] of grouped) {
      list.sort((a, b) => {
        const aOverdue = isTaskOverdue(a, today) ? 0 : 1;
        const bOverdue = isTaskOverdue(b, today) ? 0 : 1;
        if (aOverdue !== bOverdue) return aOverdue - bOverdue;
        return (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31');
      });
    }
    return grouped;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, pending, today]);

  const move = async (task: OfficeHubTask, next: TaskStatus) => {
    if (!actor || next === statusOf(task)) return;

    const verdict = canEditTask(task, viewer, capabilities);
    if (!verdict.allowed) {
      const { toast } = await import('@/hooks/use-toast');
      toast({ variant: 'destructive', title: 'Not your task to move', description: verdict.reason ?? undefined });
      return;
    }

    setPending((current) => ({ ...current, [task.id]: next }));

    const ok = await run(() => setTaskStatus(actor, task.id, next, { settings }), {
      failure: 'Could not move the task',
      describe: 'Move task',
    });

    if (ok === null) {
      // Rolled back: the card returns to the column it came from, which is what the failed write
      // means. Keeping it in the new column would be a lie the next refresh would undo anyway.
      setPending((current) => {
        const copy = { ...current };
        delete copy[task.id];
        return copy;
      });
      return;
    }

    onChanged();
    // Cleared after the reload, so the card does not jump twice.
    setPending((current) => {
      const copy = { ...current };
      delete copy[task.id];
      return copy;
    });
  };

  if (!tasks.length) {
    return (
      <OfficeHubEmptyState
        icon={ListTodo}
        title="No tasks on the board."
        description="Tasks appear here as soon as they are assigned."
      />
    );
  }

  return (
    <DragDropContext
      onDragEnd={(result: DropResult) => {
        if (!result.destination) return;
        const task = tasks.find((entry) => entry.id === result.draggableId);
        if (!task) return;
        void move(task, result.destination.droppableId as TaskStatus);
      }}
    >
      {/*
        A horizontal scroll container rather than a four-column grid: on a phone the columns have to
        be swipeable, and `ScrollArea` is deliberately not used here — this module's registers learned
        that a ScrollArea wrapper swallows the native scrollbar and the sticky behaviour with it.
      */}
      <div className="-mx-1 overflow-x-auto px-1 pb-2">
        <div className="flex min-w-0 gap-3 lg:grid lg:grid-cols-4">
          {TASK_KANBAN_COLUMNS.map((status) => {
            const list = columns.get(status) ?? [];
            return (
              <Droppable droppableId={status} key={status}>
                {(provided: DroppableProvided, snapshot: DroppableStateSnapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={cn(
                      'flex min-h-[18rem] w-[17rem] shrink-0 flex-col rounded-2xl bg-muted/60 p-2.5 transition-colors lg:w-auto',
                      snapshot.isDraggingOver && 'bg-primary/10 outline-dashed outline-2 outline-primary/50',
                    )}
                  >
                    <div className="mx-1 mb-2.5 mt-0.5 flex items-center gap-2">
                      <i aria-hidden className={cn('h-[9px] w-[9px] rounded-full', COLUMN_DOT[status])} />
                      <p className="text-[12.5px] font-extrabold">{status}</p>
                      <span className="rounded-full bg-card px-2 text-[11px] font-bold tabular-nums text-muted-foreground">{list.length}</span>
                    </div>

                    <div className="flex min-h-[4rem] flex-col gap-2">
                      {list.map((task, index) => (
                        <Draggable draggableId={task.id} index={index} key={task.id}>
                          {(dragProvided: DraggableProvided, dragSnapshot: DraggableStateSnapshot) => (
                            <div
                              ref={dragProvided.innerRef}
                              {...dragProvided.draggableProps}
                              className={cn(dragSnapshot.isDragging && 'opacity-90')}
                            >
                              <KanbanCard
                                task={task}
                                today={today}
                                dragHandleProps={dragProvided.dragHandleProps}
                                onStatusChange={(next) => void move(task, next)}
                                canEdit={canEditTask(task, viewer, capabilities).allowed}
                              />
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>

                    {list.length === 0 && (
                      <p className="rounded-xl border-[1.5px] border-dashed py-8 text-center text-xs text-muted-foreground">
                        Drop tasks here
                      </p>
                    )}
                  </div>
                )}
              </Droppable>
            );
          })}
        </div>
      </div>

      <p className="mt-1 text-[11px] text-muted-foreground">
        Drag a card to change its status, or use the dropdown on the card. With the keyboard: tab to
        a card&rsquo;s handle, press space to lift it, arrow keys to move, space to drop.
      </p>
    </DragDropContext>
  );
}

function KanbanCard({
  task,
  today,
  dragHandleProps,
  onStatusChange,
  canEdit,
}: {
  task: OfficeHubTask;
  today: string;
  dragHandleProps: DraggableProvided['dragHandleProps'];
  onStatusChange: (next: TaskStatus) => void;
  canEdit: boolean;
}) {
  const overdue = isTaskOverdue(task, today);
  const checklist = subtaskCompletion(task.subtasks);

  return (
    <Card
      className="rounded-[13px] border border-t-[3px] bg-card shadow-sm transition-all hover:-translate-y-px hover:shadow-md"
      style={{ borderTopColor: PRIORITY_EDGE[task.priority] ?? PRIORITY_EDGE.Medium }}
    >
      <CardContent className="space-y-1.5 p-2.5">
        <div className="flex items-center gap-1.5">
          <span
            {...(dragHandleProps ?? {})}
            className="shrink-0 cursor-grab rounded p-0.5 text-muted-foreground/50 hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label={`Move ${task.title}`}
            role="button"
            tabIndex={0}
          >
            <GripVertical className="h-3.5 w-3.5" />
          </span>
          <span className="text-[11px] font-bold text-muted-foreground">{task.reference}</span>
          {(task.tags ?? []).slice(0, 2).map((tag) => (
            <span key={tag} className="truncate rounded-md bg-primary/10 px-1.5 text-[10.5px] font-bold text-primary">
              #{tag}
            </span>
          ))}
        </div>
        <Link
          href={`${OFFICE_HUB_BASE_PATH}/tasks/${task.id}`}
          className="block break-words text-[12.5px] font-bold leading-snug hover:underline"
        >
          {task.title}
        </Link>

        <div className="flex items-center justify-between gap-1.5">
          <span className="flex min-w-0 items-center gap-1">
            <TaskDueDate task={task} today={today} />
            {overdue && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-600" aria-label="Overdue" />}
          </span>
          <span className="flex items-center gap-1.5">
            {checklist.total > 0 && (
              <span className="text-[11px] font-bold tabular-nums text-muted-foreground">
                {checklist.done}/{checklist.total}
              </span>
            )}
            <span
              title={task.assigneeName || task.teamName || 'Unassigned'}
              className="grid h-6 w-6 place-items-center rounded-full bg-muted text-[9px] font-extrabold text-muted-foreground"
            >
              {(task.assigneeName || task.teamName || '?')
                .split(/[\s.]+/)
                .filter(Boolean)
                .map((part) => part[0])
                .join('')
                .slice(0, 2)
                .toUpperCase()}
            </span>
          </span>
        </div>

        {((task.commentCount ?? 0) > 0 || (task.documentIds?.length ?? 0) > 0) && (
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            {(task.commentCount ?? 0) > 0 && (
              <span className="inline-flex items-center gap-0.5">
                <MessageSquare className="h-3 w-3" />
                {task.commentCount}
              </span>
            )}
            {(task.documentIds?.length ?? 0) > 0 && (
              <span className="inline-flex items-center gap-0.5">
                <Paperclip className="h-3 w-3" />
                {task.documentIds!.length}
              </span>
            )}
            <span className="ml-auto tabular-nums">{taskProgress(task)}%</span>
          </div>
        )}

        {task.meetingTitle && (
          <p className="truncate text-[11px] text-indigo-600" title={task.meetingTitle}>
            from {task.meetingTitle}
          </p>
        )}

        {canEdit && (
          <Select value={task.status} onValueChange={(value) => onStatusChange(value as TaskStatus)}>
            <SelectTrigger className="h-7 bg-white text-[11px]" aria-label={`Status of ${task.title}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TASK_STATUSES.map((status) => (
                <SelectItem key={status} value={status} className="text-xs">
                  {status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </CardContent>
    </Card>
  );
}

/** A skeleton with the board's own shape, so the layout does not jump when it loads. */
export function TaskKanbanSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
      {TASK_KANBAN_COLUMNS.map((status) => (
        <div key={status} className="rounded-2xl bg-muted/60 p-2.5">
          <Skeleton className="mb-2 h-4 w-24" />
          <div className="space-y-2">
            <Skeleton className="h-20 w-full rounded-lg" />
            <Skeleton className="h-20 w-full rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function KanbanHint() {
  return (
    <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px] text-muted-foreground" disabled>
      Drag or use the dropdown
    </Button>
  );
}

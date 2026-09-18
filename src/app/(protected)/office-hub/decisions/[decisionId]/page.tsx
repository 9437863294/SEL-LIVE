'use client';

/**
 * A decision's own page (§21).
 *
 * Carries the link back to the meeting that took it, the tasks raised to see it through, and its
 * attachments — the three things somebody asking "what happened about this?" needs. Creating a task
 * straight from here is §67's "create task from a decision", pre-filled with the decision's owner
 * and due date.
 */

import Link from 'next/link';
import { useState } from 'react';
import { useParams } from 'next/navigation';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Gavel,
  ListTodo,
  Paperclip,
  Pencil,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatAuditStamp } from '@/lib/audit-fields';
import {
  OFFICE_HUB_BASE_PATH,
  canEditDecision,
  canViewDecision,
  formatIsoDate,
  isDecisionOverdue,
  type OfficeHubTask,
} from '@/lib/office-hub';
import {
  getDecision,
  listDocuments,
  listTasks,
  updateDecision,
} from '@/lib/office-hub-service';
import { useOfficeHub, useOfficeHubAction, useOfficeHubQuery } from '@/components/office-hub/hooks';
import {
  DecisionStatusBadge,
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
import { DecisionDialog } from '@/components/office-hub/decision-forms';
import { DocumentsPanel } from '@/components/office-hub/documents-panel';
import { QuickCreateTaskDialog } from '@/components/office-hub/task-form';

export default function DecisionDetailPage() {
  const params = useParams<{ decisionId: string }>();
  const decisionId = params?.decisionId ?? '';
  const { actor, viewer, capabilities, settings, today, isLoading } = useOfficeHub();
  const { isBusy, run } = useOfficeHubAction();

  const [editing, setEditing] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);
  const [draft, setDraft] = useState<Parameters<typeof DecisionDialog>[0]['draft'] | null>(null);

  const decisionQuery = useOfficeHubQuery(() => getDecision(decisionId), [decisionId], {
    enabled: Boolean(decisionId),
  });
  const decision = decisionQuery.data ?? null;

  const documentsQuery = useOfficeHubQuery(() => listDocuments('decision', decisionId), [decisionId], {
    enabled: Boolean(decisionId),
    initial: [],
  });

  /** Tasks raised against this decision. */
  const tasksQuery = useOfficeHubQuery(
    async () => {
      const scope = capabilities.canViewAllTasks ? 'all' : 'mine';
      const tasks = await listTasks(scope, viewer, { limit: 300 }).catch(() => [] as OfficeHubTask[]);
      return tasks.filter((task) => task.decisionId === decisionId);
    },
    [decisionId, capabilities.canViewAllTasks, viewer.userId],
    { enabled: Boolean(decisionId), initial: [] },
  );

  const overdue = decision ? isDecisionOverdue(decision, today) : false;

  const close = async () => {
    if (!actor || !decision) return;
    await run(() => updateDecision(actor, decision.id, { status: 'Completed' }, { settings }), {
      success: 'Decision closed',
      failure: 'Could not close the decision',
    });
    decisionQuery.reload();
  };

  if (isLoading || decisionQuery.isLoading) return <OfficeHubLoader label="Loading the decision" />;

  if (!decision) {
    return (
      <OfficeHubEmptyState
        icon={AlertTriangle}
        title="That decision could not be found."
        action={
          <Button variant="outline" asChild>
            <Link href={`${OFFICE_HUB_BASE_PATH}/decisions`}>Back to the register</Link>
          </Button>
        }
      />
    );
  }

  if (!canViewDecision(decision, viewer, capabilities)) {
    return <OfficeHubAccessDenied what="this decision" />;
  }

  const editVerdict = canEditDecision(decision, viewer, capabilities);

  return (
    <div className="space-y-3">
      <OfficeHubPageHeader
        title={decision.title}
        description={`${decision.reference} · taken ${formatIsoDate(decision.decisionDate, { withWeekday: true })}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {capabilities.canCreateTask && (
              <Button variant="outline" onClick={() => setCreatingTask(true)} className="gap-2">
                <ListTodo className="h-4 w-4" />
                Create task
              </Button>
            )}
            {editVerdict.allowed && decision.status !== 'Completed' && (
              <Button onClick={() => void close()} disabled={isBusy} className="gap-2">
                <CheckCircle2 className="h-4 w-4" />
                Mark completed
              </Button>
            )}
            {editVerdict.allowed && (
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => {
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
                  });
                  setEditing(true);
                }}
              >
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <DecisionStatusBadge status={decision.status} />
        <PriorityBadge priority={decision.priority} />
        {overdue && (
          <Badge variant="outline" className="border-rose-200 bg-rose-50 text-[11px] text-rose-700">
            <AlertTriangle className="mr-1 h-3 w-3" />
            Overdue
          </Badge>
        )}
        {decision.departmentName && (
          <Badge variant="outline" className="border-slate-200 bg-slate-50 text-[11px]">
            {decision.departmentName}
          </Badge>
        )}
      </div>

      {decision.meetingId && (
        <Card className="border-indigo-100 bg-indigo-50/60">
          <CardContent className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-xs text-indigo-900">
            <span className="font-semibold uppercase tracking-wide">Taken in</span>
            <ArrowRight className="h-3 w-3" />
            <Link
              href={`${OFFICE_HUB_BASE_PATH}/meetings/${decision.meetingId}`}
              className="inline-flex items-center gap-1 font-medium hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              {decision.meetingTitle ?? 'the source meeting'}
            </Link>
          </CardContent>
        </Card>
      )}

      {overdue && (
        <OfficeHubCallout
          tone="rose"
          icon={AlertTriangle}
          title="This decision has passed its follow-up date"
          description={
            editVerdict.allowed
              ? 'Either move the date and say why, or close it out — an overdue decision nobody has revisited stops being a decision.'
              : `${decision.ownerName} owns this one.`
          }
        />
      )}

      <Card>
        <CardContent className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <OfficeHubField label="Owner">
            <PersonChip name={decision.ownerName} subtitle={decision.departmentName} />
          </OfficeHubField>
          <OfficeHubField label="Decision date">{formatIsoDate(decision.decisionDate)}</OfficeHubField>
          <OfficeHubField label="Follow-up due">
            {decision.dueDate ? formatIsoDate(decision.dueDate) : 'No due date'}
          </OfficeHubField>
          <OfficeHubField label="Status">
            <DecisionStatusBadge status={decision.status} />
          </OfficeHubField>
          <OfficeHubField label="Priority">
            <PriorityBadge priority={decision.priority} />
          </OfficeHubField>
          {decision.projectName && <OfficeHubField label="Project">{decision.projectName}</OfficeHubField>}
          {decision.closedAt && (
            <OfficeHubField label="Closed">{formatIsoDate(decision.closedAt.slice(0, 10))}</OfficeHubField>
          )}
        </CardContent>
      </Card>

      {decision.description && (
        <Card>
          <CardContent className="p-4">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Background and reasoning
            </p>
            <p className="whitespace-pre-wrap text-sm text-slate-700">{decision.description}</p>
          </CardContent>
        </Card>
      )}

      {decision.closureNote && (
        <Card className="border-emerald-200 bg-emerald-50/60">
          <CardContent className="p-4">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-emerald-800">Closure note</p>
            <p className="whitespace-pre-wrap text-sm text-emerald-900">{decision.closureNote}</p>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="tasks">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="tasks" className="gap-1.5 text-xs">
            <ListTodo className="h-3.5 w-3.5" />
            Tasks ({tasksQuery.data?.length ?? 0})
          </TabsTrigger>
          <TabsTrigger value="documents" className="gap-1.5 text-xs">
            <Paperclip className="h-3.5 w-3.5" />
            Documents ({documentsQuery.data?.length ?? 0})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tasks" className="mt-3">
          {(tasksQuery.data?.length ?? 0) === 0 ? (
            <OfficeHubEmptyState
              icon={ListTodo}
              title="No tasks raised against this decision."
              description="A decision that needs work doing should have a task, so somebody is reminded about it."
              action={
                capabilities.canCreateTask ? (
                  <Button size="sm" onClick={() => setCreatingTask(true)}>
                    Create a task
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <ul className="divide-y rounded-lg border bg-white">
              {tasksQuery.data!.map((task) => (
                <li key={task.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <Link
                      href={`${OFFICE_HUB_BASE_PATH}/tasks/${task.id}`}
                      className="block truncate text-sm font-medium text-slate-800 hover:underline"
                    >
                      {task.title}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">
                      {task.reference} · {task.assigneeName || task.teamName || 'Unassigned'}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <TaskDueDate task={task} today={today} />
                    <TaskStatusBadge status={task.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="documents" className="mt-3">
          <DocumentsPanel
            entityType="decision"
            entityId={decision.id}
            meetingId={decision.meetingId ?? null}
            documents={documentsQuery.data ?? []}
            canUpload={capabilities.canUploadDocuments}
            canRemove={capabilities.canRemoveDocuments || editVerdict.allowed}
            onChanged={documentsQuery.reload}
          />
        </TabsContent>
      </Tabs>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-1 p-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Gavel className="h-3 w-3" />
            Recorded by {formatAuditStamp(decision.createdByName, decision.createdAt)}
          </span>
          <span>Last updated {formatAuditStamp(decision.updatedByName, decision.updatedAt)}</span>
        </CardContent>
      </Card>

      {draft && (
        <DecisionDialog
          open={editing}
          onOpenChange={(open) => {
            setEditing(open);
            if (!open) setDraft(null);
          }}
          draft={draft}
          setDraft={setDraft}
          meeting={
            decision.meetingId
              ? { id: decision.meetingId, title: decision.meetingTitle ?? 'Meeting', date: decision.decisionDate }
              : null
          }
          onSaved={() => {
            setDraft(null);
            decisionQuery.reload();
          }}
        />
      )}

      <QuickCreateTaskDialog
        open={creatingTask}
        onOpenChange={setCreatingTask}
        source={{
          meetingId: decision.meetingId,
          meetingTitle: decision.meetingTitle,
          decisionId: decision.id,
          projectId: decision.projectId,
          projectName: decision.projectName,
          assigneeId: decision.ownerId,
          assigneeName: decision.ownerName,
        }}
        onCreated={() => tasksQuery.reload()}
      />
    </div>
  );
}

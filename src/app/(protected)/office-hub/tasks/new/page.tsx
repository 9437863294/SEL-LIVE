'use client';

/**
 * Create a task on a full page (§24, §67).
 *
 * The quick-create dialog covers most cases; this route exists for the times somebody is setting up
 * a piece of work properly, and for links from outside the module that want a real page to land on.
 * Both use the same `TaskForm`, so the two cannot disagree about validation.
 *
 * The query string pre-fills the source relationships — `?meeting=`, `?decision=`, `?parent=`,
 * `?assignee=` — so "create a task from this" works from anywhere without the caller having to
 * teach the form about its own context.
 */

import Link from 'next/link';
import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { OFFICE_HUB_BASE_PATH } from '@/lib/office-hub';
import { getMeeting, getTask } from '@/lib/office-hub-service';
import { useOfficeHub, useOfficeHubQuery } from '@/components/office-hub/hooks';
import {
  OfficeHubAccessDenied,
  OfficeHubLoader,
  OfficeHubPageHeader,
} from '@/components/office-hub/ui';
import { TaskForm, emptyTaskDraft } from '@/components/office-hub/task-form';

export default function NewTaskPage() {
  const searchParams = useSearchParams();
  const meetingId = searchParams?.get('meeting') ?? null;
  const decisionId = searchParams?.get('decision') ?? null;
  const parentTaskId = searchParams?.get('parent') ?? null;
  const assigneeId = searchParams?.get('assignee') ?? null;

  const { viewer, capabilities, directory, today, isLoading } = useOfficeHub();

  /** Only the two lookups the query string actually asks for. */
  const sourceQuery = useOfficeHubQuery(
    async () => {
      const [meeting, parent] = await Promise.all([
        meetingId ? getMeeting(meetingId) : Promise.resolve(null),
        parentTaskId ? getTask(parentTaskId) : Promise.resolve(null),
      ]);
      return { meeting, parent };
    },
    [meetingId, parentTaskId],
    { enabled: Boolean(meetingId || parentTaskId) },
  );

  const initial = useMemo(() => {
    const assignee = assigneeId ? directory.people.find((person) => person.userId === assigneeId) : null;
    return emptyTaskDraft({
      today,
      viewer,
      source: {
        meetingId,
        meetingTitle: sourceQuery.data?.meeting?.title ?? null,
        decisionId,
        projectId: sourceQuery.data?.meeting?.projectId ?? sourceQuery.data?.parent?.projectId ?? null,
        projectName: sourceQuery.data?.meeting?.projectName ?? sourceQuery.data?.parent?.projectName ?? null,
        parentTaskId,
        parentTaskTitle: sourceQuery.data?.parent?.title ?? null,
        assigneeId: assignee?.userId ?? null,
        assigneeName: assignee?.name ?? null,
      },
    });
  }, [today, viewer, meetingId, decisionId, parentTaskId, assigneeId, directory.people, sourceQuery.data]);

  if (isLoading || sourceQuery.isLoading) return <OfficeHubLoader label="Preparing the form" />;
  if (!capabilities.canCreateTask) return <OfficeHubAccessDenied what="creating tasks" />;

  return (
    <div className="space-y-3">
      <OfficeHubPageHeader
        title="New task"
        description={
          sourceQuery.data?.meeting
            ? `Linked to ${sourceQuery.data.meeting.title} — the task will keep a way back to it.`
            : 'Assign it to a person, a team, or a person within a team.'
        }
        actions={
          <Button variant="ghost" asChild className="gap-2">
            <Link href={`${OFFICE_HUB_BASE_PATH}/tasks`}>
              <ArrowLeft className="h-4 w-4" />
              Back
            </Link>
          </Button>
        }
      />

      <TaskForm initial={initial} mode="create" />
    </div>
  );
}

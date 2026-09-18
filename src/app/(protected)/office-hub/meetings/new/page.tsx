'use client';

/**
 * Schedule a meeting (§9), from scrat, from a template (§43), or as a follow-up (§69).
 *
 * All three arrive at the same form; what differs is what it is pre-filled with. The query string
 * decides:
 *
 *   `?template=<id>`   — populate from a meeting template, agenda included.
 *   `?followUp=<id>`   — populate from a meeting that has happened: its participants (as teams and
 *                        departments, not a frozen roster), its type, its agenda, and its open
 *                        action items as the first agenda item.
 *   `?date=yyyy-mm-dd` — the slot the user clicked in the calendar.
 *
 * That is §84's rule in practice: a follow-up to last month's review should not be typed in again.
 */

import Link from 'next/link';
import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, ArrowLeft, CalendarPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  OFFICE_HUB_BASE_PATH,
  buildFollowUpDraft,
  formatIsoDate,
  isOpenActionItemStatus,
  meetingDraftFromTemplate,
  type ParticipantSelection,
} from '@/lib/office-hub';
import {
  getMeeting,
  listActionItems,
  listAgenda,
  listMeetingParticipants,
  listMeetingTemplates,
} from '@/lib/office-hub-service';
import { useOfficeHub, useOfficeHubQuery } from '@/components/office-hub/hooks';
import {
  OfficeHubAccessDenied,
  OfficeHubCallout,
  OfficeHubLoader,
  OfficeHubPageHeader,
} from '@/components/office-hub/ui';
import {
  MeetingForm,
  emptyMeetingDraft,
  type MeetingDraft,
} from '@/components/office-hub/meeting-form';

export default function NewMeetingPage() {
  const searchParams = useSearchParams();
  const templateId = searchParams?.get('template') ?? null;
  const followUpId = searchParams?.get('followUp') ?? null;
  const requestedDate = searchParams?.get('date') ?? null;
  const requestedTime = searchParams?.get('time') ?? null;

  const { actor, viewer, capabilities, settings, today, isLoading } = useOfficeHub();

  const templatesQuery = useOfficeHubQuery(() => listMeetingTemplates(), [], {
    enabled: Boolean(templateId),
    initial: [],
  });

  /**
   * The source meeting for a follow-up, with everything the draft needs.
   *
   * Four reads, done together: the meeting, its participants, its agenda, and the open action items
   * of its whole series — because §70's unfinished business is a property of the series, not of the
   * one instance.
   */
  const followUpQuery = useOfficeHubQuery(
    async () => {
      if (!followUpId) return null;
      const meeting = await getMeeting(followUpId);
      if (!meeting) return null;
      const [participants, agenda, actionItems] = await Promise.all([
        listMeetingParticipants(followUpId),
        listAgenda(followUpId),
        meeting.seriesId
          ? listActionItems({ seriesId: meeting.seriesId })
          : listActionItems({ meetingId: followUpId }),
      ]);
      return {
        meeting,
        participants,
        agenda,
        openActionItems: actionItems.filter((item) => isOpenActionItemStatus(item.status)),
      };
    },
    [followUpId],
    { enabled: Boolean(followUpId) },
  );

  const initial = useMemo<MeetingDraft | null>(() => {
    if (!actor) return null;

    const base = emptyMeetingDraft({
      today: requestedDate ?? today,
      defaultStartTime: requestedTime ?? settings.workingHoursStart,
      durationMinutes: settings.defaultMeetingDurationMinutes,
      timeZone: viewer.timeZone ?? settings.defaultTimeZone,
      organizerId: actor.userId,
      organizerName: actor.userName,
      reminderOffsets: settings.defaultReminderOffsets,
    });

    if (followUpId) {
      const source = followUpQuery.data;
      if (!source) return followUpQuery.isLoading ? null : base;
      const draft = buildFollowUpDraft(
        source.meeting,
        source.agenda,
        source.participants,
        source.openActionItems,
      );
      return {
        ...base,
        title: draft.title,
        meetingType: draft.meetingType,
        description: draft.description ?? '',
        priority: draft.priority,
        mode: draft.mode,
        onlinePlatform: draft.onlinePlatform ?? null,
        meetingUrl: draft.meetingUrl ?? '',
        location: draft.location ?? '',
        room: draft.room ?? '',
        timeZone: draft.timeZone,
        date: requestedDate ?? draft.date,
        startTime: draft.startTime,
        endTime: draft.endTime,
        reminderOffsets: draft.reminderOffsets,
        selection: draft.selection,
        projectId: draft.projectId,
        projectName: draft.projectName,
      };
    }

    if (templateId) {
      const template = (templatesQuery.data ?? []).find((entry) => entry.id === templateId);
      if (!template) return templatesQuery.isLoading ? null : base;
      const fromTemplate = meetingDraftFromTemplate(template, {
        date: requestedDate ?? today,
        startTime: requestedTime ?? template.defaultStartTime ?? settings.workingHoursStart,
        timeZone: viewer.timeZone ?? settings.defaultTimeZone,
      });
      const selection: ParticipantSelection = {
        ...fromTemplate.selection,
        // The organizer is always a participant.
        userIds: Array.from(new Set([...fromTemplate.selection.userIds, actor.userId])),
      };
      return {
        ...base,
        title: fromTemplate.title ?? base.title,
        meetingType: fromTemplate.meetingType ?? base.meetingType,
        description: fromTemplate.description ?? '',
        priority: fromTemplate.priority ?? base.priority,
        mode: fromTemplate.mode ?? base.mode,
        onlinePlatform: fromTemplate.onlinePlatform ?? null,
        meetingUrl: fromTemplate.meetingUrl ?? '',
        location: fromTemplate.location ?? '',
        room: fromTemplate.room ?? '',
        date: fromTemplate.date ?? base.date,
        startTime: fromTemplate.startTime ?? base.startTime,
        endTime: fromTemplate.endTime ?? base.endTime,
        timeZone: fromTemplate.timeZone ?? base.timeZone,
        reminderOffsets: fromTemplate.reminderOffsets ?? base.reminderOffsets,
        recurrence: fromTemplate.recurrence ?? base.recurrence,
        selection,
      };
    }

    return base;
  }, [
    actor,
    today,
    requestedDate,
    requestedTime,
    settings,
    viewer.timeZone,
    followUpId,
    followUpQuery.data,
    followUpQuery.isLoading,
    templateId,
    templatesQuery.data,
    templatesQuery.isLoading,
  ]);

  const followUpAgendaItems = useMemo(() => {
    if (!followUpId || !followUpQuery.data) return undefined;
    const draft = buildFollowUpDraft(
      followUpQuery.data.meeting,
      followUpQuery.data.agenda,
      followUpQuery.data.participants,
      followUpQuery.data.openActionItems,
    );
    return draft.agendaItems.map((item) => ({
      title: item.title,
      description: item.description ?? null,
      expectedOutcome: item.expectedOutcome ?? null,
      estimatedMinutes: item.estimatedMinutes ?? null,
      priority: item.priority,
    }));
  }, [followUpId, followUpQuery.data]);

  const templateAgendaItems = useMemo(() => {
    if (!templateId) return undefined;
    const template = (templatesQuery.data ?? []).find((entry) => entry.id === templateId);
    if (!template?.agendaItems?.length) return undefined;
    return template.agendaItems.map((item) => ({
      title: item.title,
      description: item.description ?? null,
      expectedOutcome: item.expectedOutcome ?? null,
      estimatedMinutes: item.estimatedMinutes ?? null,
      priority: item.priority,
    }));
  }, [templateId, templatesQuery.data]);

  if (isLoading) return <OfficeHubLoader label="Preparing the form" />;
  if (!capabilities.canCreateMeeting) return <OfficeHubAccessDenied what="scheduling meetings" />;

  if (!initial) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  const source = followUpQuery.data;
  const template = templateId ? (templatesQuery.data ?? []).find((entry) => entry.id === templateId) : null;

  return (
    <div className="space-y-3">
      <OfficeHubPageHeader
        title={source ? 'Schedule a follow-up meeting' : template ? `New meeting from "${template.name}"` : 'Schedule a meeting'}
        description={
          source
            ? `Following ${source.meeting.title} on ${formatIsoDate(source.meeting.date)}.`
            : 'Invite people, whole teams or whole departments. Everything is editable before you send.'
        }
        actions={
          <Button variant="ghost" asChild className="gap-2">
            <Link href={`${OFFICE_HUB_BASE_PATH}/meetings`}>
              <ArrowLeft className="h-4 w-4" />
              Back
            </Link>
          </Button>
        }
      />

      {followUpId && !source && !followUpQuery.isLoading && (
        <OfficeHubCallout
          tone="amber"
          icon={AlertTriangle}
          title="The meeting you are following could not be found"
          description="The form below is blank. Fill it in, or go back and pick the meeting again."
        />
      )}

      {source && (
        <Card className="border-indigo-200 bg-indigo-50/60">
          <CardContent className="space-y-1 px-4 py-3 text-xs text-indigo-900">
            <p className="text-sm font-semibold">Carried over from {source.meeting.title}</p>
            <ul className="space-y-0.5">
              <li>
                {source.participants.length} participant{source.participants.length === 1 ? '' : 's'} — teams and
                departments stay as selections, so anybody who has joined since will be invited too.
              </li>
              <li>
                {source.agenda.length} agenda item{source.agenda.length === 1 ? '' : 's'}
                {source.openActionItems.length
                  ? `, plus ${source.openActionItems.length} unfinished action item${
                      source.openActionItems.length === 1 ? '' : 's'
                    } as the first item`
                  : ''}
                .
              </li>
              <li>Suggested for {formatIsoDate(initial.date, { withWeekday: true })} — change it if that is wrong.</li>
            </ul>
          </CardContent>
        </Card>
      )}

      {template && (
        <OfficeHubCallout
          tone="indigo"
          icon={CalendarPlus}
          title={`Pre-filled from the "${template.name}" template`}
          description={`${template.durationMinutes} minutes · ${template.meetingType} · ${
            template.participantUserIds.length + template.participantTeamIds.length + template.participantDepartmentIds.length
          } default invitee selection(s). Change anything before you send.`}
        />
      )}

      <MeetingForm
        initial={initial}
        mode="create"
        agendaItems={followUpAgendaItems ?? templateAgendaItems}
        carryActionItemIds={source?.openActionItems.map((item) => item.id)}
        followUpOf={source ? { id: source.meeting.id, title: source.meeting.title } : null}
        templateId={templateId}
      />
    </div>
  );
}

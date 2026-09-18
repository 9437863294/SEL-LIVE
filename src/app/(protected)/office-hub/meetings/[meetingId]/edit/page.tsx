'use client';

/**
 * Edit a meeting (§9, §11's "edit this occurrence / edit entire series").
 *
 * The form is reconstructed from the stored participant rows back into a *selection* — teams as
 * teams, departments as departments, individuals as individuals. That inversion matters: a meeting
 * that invited the Finance department should still say so when reopened, so that saving it again
 * invites whoever is in Finance now rather than freezing the roster as it was (§84).
 */

import Link from 'next/link';
import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import { AlertTriangle, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  OFFICE_HUB_BASE_PATH,
  canEditMeeting,
  canViewMeeting,
  formatIsoDate,
  uniqueStrings,
  type ParticipantSelection,
} from '@/lib/office-hub';
import { getMeeting, listMeetingParticipants } from '@/lib/office-hub-service';
import { useOfficeHub, useOfficeHubQuery } from '@/components/office-hub/hooks';
import {
  OfficeHubAccessDenied,
  OfficeHubCallout,
  OfficeHubEmptyState,
  OfficeHubLoader,
  OfficeHubPageHeader,
} from '@/components/office-hub/ui';
import { MeetingForm, draftFromMeeting } from '@/components/office-hub/meeting-form';

export default function EditMeetingPage() {
  const params = useParams<{ meetingId: string }>();
  const meetingId = params?.meetingId ?? '';
  const { viewer, capabilities, isLoading } = useOfficeHub();

  const query = useOfficeHubQuery(
    async () => {
      const meeting = await getMeeting(meetingId);
      if (!meeting) return null;
      const participants = await listMeetingParticipants(meetingId);
      return { meeting, participants };
    },
    [meetingId],
    { enabled: Boolean(meetingId) },
  );

  /**
   * Participant rows back into a selection.
   *
   * `source` and `sourceId` on each participant row are what make this possible — they record *how*
   * somebody was invited, which is precisely the information a flattened list throws away.
   */
  const selection = useMemo<ParticipantSelection | null>(() => {
    const participants = query.data?.participants;
    if (!participants) return null;
    return {
      userIds: uniqueStrings(
        participants
          .filter((participant) => participant.source === 'Individual' || participant.source === 'Organizer')
          .map((participant) => participant.userId),
      ),
      teamIds: uniqueStrings(
        participants.filter((participant) => participant.source === 'Team').map((participant) => participant.sourceId),
      ),
      departmentIds: uniqueStrings(
        participants
          .filter((participant) => participant.source === 'Department')
          .map((participant) => participant.sourceId),
      ),
      optionalUserIds: uniqueStrings(
        participants
          .filter(
            (participant) =>
              participant.attendanceRole === 'Optional' &&
              (participant.source === 'Individual' || participant.source === 'Organizer'),
          )
          .map((participant) => participant.userId),
      ),
      optionalTeamIds: uniqueStrings(
        participants
          .filter((participant) => participant.attendanceRole === 'Optional' && participant.source === 'Team')
          .map((participant) => participant.sourceId),
      ),
      optionalDepartmentIds: uniqueStrings(
        participants
          .filter((participant) => participant.attendanceRole === 'Optional' && participant.source === 'Department')
          .map((participant) => participant.sourceId),
      ),
    };
  }, [query.data?.participants]);

  if (isLoading || query.isLoading) return <OfficeHubLoader label="Loading the meeting" />;

  const meeting = query.data?.meeting;
  if (!meeting) {
    return (
      <OfficeHubEmptyState
        icon={AlertTriangle}
        title="That meeting could not be found."
        action={
          <Button variant="outline" asChild>
            <Link href={`${OFFICE_HUB_BASE_PATH}/meetings`}>Back to meetings</Link>
          </Button>
        }
      />
    );
  }

  if (!canViewMeeting(meeting, viewer, capabilities)) return <OfficeHubAccessDenied what="this meeting" />;

  const verdict = canEditMeeting(meeting, viewer, capabilities);
  if (!verdict.allowed) {
    return (
      <div className="space-y-3">
        <OfficeHubPageHeader title={meeting.title} description="This meeting cannot be edited." />
        <OfficeHubCallout tone="amber" icon={AlertTriangle} title="Not editable" description={verdict.reason ?? undefined} />
        <Button variant="outline" asChild className="gap-2">
          <Link href={`${OFFICE_HUB_BASE_PATH}/meetings/${meeting.id}`}>
            <ArrowLeft className="h-4 w-4" />
            Back to the meeting
          </Link>
        </Button>
      </div>
    );
  }

  if (!selection) return <Skeleton className="h-96 w-full rounded-xl" />;

  return (
    <div className="space-y-3">
      <OfficeHubPageHeader
        title={`Edit: ${meeting.title}`}
        description={`Currently ${formatIsoDate(meeting.date, { withWeekday: true })} at ${meeting.startTime}. Changing the date, time or place notifies every participant.`}
        actions={
          <Button variant="ghost" asChild className="gap-2">
            <Link href={`${OFFICE_HUB_BASE_PATH}/meetings/${meeting.id}`}>
              <ArrowLeft className="h-4 w-4" />
              Back
            </Link>
          </Button>
        }
      />

      <MeetingForm
        initial={draftFromMeeting(meeting, selection)}
        mode="edit"
        meetingId={meeting.id}
        isSeriesMember={Boolean(meeting.seriesId)}
      />
    </div>
  );
}

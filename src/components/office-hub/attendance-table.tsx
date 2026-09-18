'use client';

/**
 * The participant list, the response controls, and the attendance sheet (§13, §19).
 *
 * One component for all three because they are one table with different columns showing: before the
 * meeting it is "who is coming", during and after it is "who came". Splitting them would mean two
 * tables that have to agree about the same rows.
 *
 * ── Attendance starts pre-filled, and that is deliberate ────────────────────────────────────────
 *
 * `prefillAttendance` starts everybody who accepted at Present, anybody who declined at Absent, and
 * leaves optional attendees blank. Marking twenty rows by hand is ten times the work of correcting
 * two, and the common case is that almost everybody came. The draft is local until Save, so the
 * organizer can see the whole sheet before committing it.
 */

import { useEffect, useMemo, useState } from 'react';
import { Check, ClipboardCheck, MessageSquare, Send, Users } from 'lucide-react';
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
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  ATTENDANCE_STATUSES,
  INVITATION_RESPONSES,
  describeResponses,
  prefillAttendance,
  summarizeAttendance,
  summarizeResponses,
  type AttendanceStatus,
  type InvitationResponse,
  type OfficeHubMeeting,
  type OfficeHubParticipant,
} from '@/lib/office-hub';
import { recordAttendance, remindNonResponders, respondToInvitation } from '@/lib/office-hub-service';
import { useOfficeHub, useOfficeHubAction } from './hooks';
import {
  AttendanceBadge,
  OfficeHubDataList,
  OfficeHubEmptyState,
  PersonChip,
  ResponseBadge,
  officeHubDialog,
  type OfficeHubListColumn,
} from './ui';

export function ParticipantPanel({
  meeting,
  participants,
  canRecordAttendance,
  canManageParticipants,
  onChanged,
  /** Show the attendance column and the save bar. */
  attendanceMode,
}: {
  meeting: OfficeHubMeeting;
  participants: OfficeHubParticipant[];
  canRecordAttendance: boolean;
  canManageParticipants: boolean;
  onChanged: () => void;
  attendanceMode?: boolean;
}) {
  const { actor, viewer, settings } = useOfficeHub();
  const { isBusy, run } = useOfficeHubAction();

  const [draft, setDraft] = useState<Record<string, AttendanceStatus | null>>({});
  const [responseDialog, setResponseDialog] = useState<InvitationResponse | null>(null);
  const [responseMessage, setResponseMessage] = useState('');

  /**
   * Re-seed the draft when the participant list changes identity.
   *
   * Keyed on the ids and their stored attendance, not on the array reference: a live listener hands
   * this component a new array on every snapshot, and re-seeding on the reference would discard the
   * organizer's half-finished sheet every few seconds.
   */
  const seedKey = useMemo(
    () => participants.map((participant) => `${participant.id}:${participant.attendance ?? ''}`).join('|'),
    [participants],
  );

  useEffect(() => {
    setDraft(prefillAttendance(participants));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey]);

  const responses = useMemo(() => summarizeResponses(participants), [participants]);
  const attendance = useMemo(
    () => summarizeAttendance(participants.map((participant) => ({ attendance: draft[participant.id] ?? null }))),
    [participants, draft],
  );

  const mine = participants.find((participant) => participant.userId === viewer.userId) ?? null;
  const outstanding = participants.filter((participant) => participant.response === 'No Response');

  const dirty = useMemo(
    () => participants.some((participant) => (draft[participant.id] ?? null) !== (participant.attendance ?? null)),
    [participants, draft],
  );

  const submitResponse = async (response: InvitationResponse) => {
    if (!actor) return;
    const ok = await run(
      () => respondToInvitation(actor, meeting.id, response, { message: responseMessage.trim() || null, settings }),
      { success: `Response recorded: ${response}`, failure: 'Could not record your response' },
    );
    if (ok !== null) {
      setResponseDialog(null);
      setResponseMessage('');
      onChanged();
    }
  };

  const saveAttendance = async () => {
    if (!actor) return;
    const marks: Record<string, { status: AttendanceStatus | null }> = {};
    for (const participant of participants) {
      const next = draft[participant.id] ?? null;
      if (next !== (participant.attendance ?? null)) marks[participant.id] = { status: next };
    }
    const saved = await run(() => recordAttendance(actor, meeting.id, marks), {
      success: 'Attendance saved',
      failure: 'Could not save the attendance sheet',
    });
    if (saved != null) onChanged();
  };

  const chase = async () => {
    if (!actor) return;
    await run(() => remindNonResponders(actor, meeting.id, { settings }), {
      success: `Reminder sent to ${outstanding.length} ${outstanding.length === 1 ? 'person' : 'people'}`,
      failure: 'Could not send the reminders',
    });
    onChanged();
  };

  const columns: OfficeHubListColumn<OfficeHubParticipant>[] = [
    {
      header: 'Name',
      mobile: 'title',
      cell: (participant) => (
        <PersonChip
          name={participant.name}
          subtitle={[participant.designation, participant.departmentName].filter(Boolean).join(' · ') || null}
        />
      ),
    },
    {
      header: 'Role',
      mobile: 'detail',
      className: 'hidden sm:table-cell w-24',
      cell: (participant) => (
        <span className={cn('text-xs', participant.attendanceRole === 'Optional' ? 'text-muted-foreground' : 'text-slate-700')}>
          {participant.attendanceRole}
        </span>
      ),
    },
    {
      header: 'Invited via',
      mobile: 'omit',
      className: 'hidden lg:table-cell w-32',
      cell: (participant) => (
        <span className="text-xs text-muted-foreground">
          {participant.source === 'Individual' || participant.source === 'Organizer'
            ? participant.source
            : `${participant.source}: ${participant.sourceName ?? '—'}`}
        </span>
      ),
    },
    {
      header: 'Response',
      mobile: 'detail',
      className: 'w-32',
      cell: (participant) => (
        <div className="min-w-0">
          <ResponseBadge response={participant.response} />
          {participant.responseMessage && (
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={participant.responseMessage}>
              &ldquo;{participant.responseMessage}&rdquo;
            </p>
          )}
        </div>
      ),
    },
  ];

  if (attendanceMode) {
    columns.push({
      header: 'Attendance',
      mobile: 'footer',
      className: 'w-64',
      cell: (participant) =>
        canRecordAttendance ? (
          <div className="flex flex-wrap gap-1" role="group" aria-label={`Attendance for ${participant.name}`}>
            {ATTENDANCE_STATUSES.map((status) => {
              const active = (draft[participant.id] ?? null) === status;
              return (
                <Button
                  key={status}
                  size="sm"
                  variant={active ? 'default' : 'outline'}
                  aria-pressed={active}
                  className={cn('h-7 px-2 text-[11px]', !active && 'bg-white')}
                  onClick={() =>
                    setDraft((current) => ({ ...current, [participant.id]: active ? null : status }))
                  }
                >
                  {status}
                </Button>
              );
            })}
          </div>
        ) : (
          <AttendanceBadge attendance={participant.attendance} />
        ),
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Users className="h-3.5 w-3.5" />
          {participants.length} invited
        </span>
        <span className="text-xs text-muted-foreground">{describeResponses(responses)}</span>
        {attendanceMode && (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <ClipboardCheck className="h-3.5 w-3.5" />
            {attendance.present + attendance.late} of {attendance.invited} attended
            {attendance.unmarked > 0 && ` · ${attendance.unmarked} unmarked`}
          </span>
        )}
      </div>

      {/* The participant's own invitation, front and centre — this is the action they came to do. */}
      {mine && meeting.status !== 'Cancelled' && meeting.status !== 'Completed' && (
        <Card className="border-indigo-200 bg-indigo-50/60">
          <CardContent className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-indigo-900">
                {mine.response === 'No Response' ? 'Can you attend?' : `You responded: ${mine.response}`}
              </p>
              <p className="text-xs text-indigo-900/80">
                {mine.attendanceRole === 'Required' ? 'You are a required participant.' : 'Your attendance is optional.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {INVITATION_RESPONSES.filter((response) => response !== 'No Response').map((response) => (
                <Button
                  key={response}
                  size="sm"
                  variant={mine.response === response ? 'default' : 'outline'}
                  disabled={isBusy}
                  className={cn('text-xs', mine.response !== response && 'bg-white')}
                  onClick={() => {
                    // Declining asks why: the organizer usually needs to know, and a decline with no
                    // reason is the most common cause of a chasing phone call.
                    if (response === 'Declined') {
                      setResponseDialog(response);
                      return;
                    }
                    void submitResponse(response);
                  }}
                >
                  {response}
                </Button>
              ))}
              <Button
                size="sm"
                variant="ghost"
                className="text-xs"
                onClick={() => setResponseDialog(mine.response === 'No Response' ? 'Accepted' : mine.response)}
              >
                <MessageSquare className="mr-1 h-3.5 w-3.5" />
                With a note
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <OfficeHubDataList
        rows={participants}
        columns={columns}
        empty={
          <OfficeHubEmptyState
            icon={Users}
            title="Nobody invited yet."
            description={canManageParticipants ? 'Edit the meeting to add participants.' : undefined}
          />
        }
      />

      <div className="flex flex-wrap gap-2">
        {attendanceMode && canRecordAttendance && (
          <Button onClick={() => void saveAttendance()} disabled={isBusy || !dirty} className="gap-2">
            <Check className="h-4 w-4" />
            {dirty ? 'Save attendance' : 'Attendance saved'}
          </Button>
        )}
        {canManageParticipants && outstanding.length > 0 && meeting.status === 'Scheduled' && (
          <Button variant="outline" onClick={() => void chase()} disabled={isBusy} className="gap-2">
            <Send className="h-4 w-4" />
            Remind {outstanding.length} who have not responded
          </Button>
        )}
      </div>

      <Dialog
        open={Boolean(responseDialog)}
        onOpenChange={(open) => {
          if (!open) {
            setResponseDialog(null);
            setResponseMessage('');
          }
        }}
      >
        <DialogContent className={officeHubDialog.content}>
          <DialogHeader className={officeHubDialog.header}>
            <DialogTitle>Respond to the invitation</DialogTitle>
            <DialogDescription>
              {meeting.title} · {meeting.date} at {meeting.startTime}
            </DialogDescription>
          </DialogHeader>

          <div className={officeHubDialog.body}>
            <div>
              <Label className="mb-1 block text-xs">Your answer</Label>
              <div className="flex flex-wrap gap-1.5">
                {INVITATION_RESPONSES.filter((response) => response !== 'No Response').map((response) => (
                  <Button
                    key={response}
                    size="sm"
                    variant={responseDialog === response ? 'default' : 'outline'}
                    className={cn('text-xs', responseDialog !== response && 'bg-white')}
                    onClick={() => setResponseDialog(response)}
                  >
                    {response}
                  </Button>
                ))}
              </div>
            </div>
            <div>
              <Label className="mb-1 block text-xs">Message to the organizer</Label>
              <Textarea
                value={responseMessage}
                onChange={(event) => setResponseMessage(event.target.value)}
                rows={3}
                placeholder={
                  responseDialog === 'Declined'
                    ? 'e.g. On site that day — happy to send my figures beforehand.'
                    : 'Optional'
                }
                className="bg-white"
              />
            </div>
          </div>

          <DialogFooter className={officeHubDialog.footer}>
            <Button variant="ghost" onClick={() => setResponseDialog(null)} disabled={isBusy}>
              Cancel
            </Button>
            <Button
              onClick={() => responseDialog && void submitResponse(responseDialog)}
              disabled={isBusy || !responseDialog}
            >
              Send response
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

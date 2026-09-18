'use client';

/**
 * The meeting detail page (§14).
 *
 * Every section §14 lists is here, as tabs rather than one long scroll: a meeting with twenty
 * participants, ten agenda items, four decisions, seven action items and a page of notes is several
 * screens tall, and on a phone the thing people actually came for — the Join button — would be
 * below all of it.
 *
 * ── What loads live and what does not ───────────────────────────────────────────────────────────
 *
 * The meeting itself and its participants are live listeners: responses and attendance change while
 * this page is open and §52 names both. Everything else is a plain read with an explicit reload,
 * because a decision does not appear while you are looking at the page unless you put it there —
 * and a listener per section would be seven listeners per open meeting (§52's cost warning).
 */

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  AlertTriangle,
  CalendarClock,
  CalendarPlus,
  ClipboardCheck,
  ClipboardList,
  Copy,
  ExternalLink,
  FileText,
  ListTodo,
  Loader2,
  MapPin,
  Pencil,
  PlayCircle,
  Radio,
  Repeat,
  Video,
  XCircle,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
// The app-wide audit stamp formatter, shared with every other module's detail screens.
import { formatAuditStamp } from '@/lib/audit-fields';
import {
  OFFICE_HUB_BASE_PATH,
  canCancelMeeting,
  canEditMeeting,
  canManageAgenda,
  canManageParticipants,
  canRecordAttendance as canRecordAttendanceFor,
  canRunMeeting,
  canViewMeeting,
  describeRecurrence,
  describeResponses,
  formatClockTime,
  formatIsoDate,
  googleMeetCode,
  isMeetingOrganizer,
  meetingDurationMinutes,
  meetingInViewerZone,
  meetingJoinView,
  formatDuration,
  postMeetingSummary,
  type OfficeHubMeeting,
  type OfficeHubParticipant,
} from '@/lib/office-hub';
import {
  cancelMeeting,
  endMeeting,
  getMeetingNotes,
  listActionItems,
  listAgenda,
  listAgendaTemplates,
  listDecisions,
  listMeetingDocuments,
  listTasksForMeeting,
  startMeeting,
  subscribeMeeting,
  subscribeMeetingParticipants,
  getMom,
} from '@/lib/office-hub-service';
import { syncGoogleMeet } from '@/lib/office-hub-google-client';
import { useOfficeHub, useOfficeHubAction, useOfficeHubQuery } from '@/components/office-hub/hooks';
import {
  MeetingModeBadge,
  MeetingStatusBadge,
  MeetingWhenBadge,
  MomStageBadge,
  OfficeHubAccessDenied,
  OfficeHubCallout,
  OfficeHubEmptyState,
  OfficeHubField,
  OfficeHubLoader,
  OfficeHubPageHeader,
  PriorityBadge,
  ResponseSummaryChip,
  TaskDueDate,
  TaskStatusBadge,
  useTickingNow,
} from '@/components/office-hub/ui';
import { ParticipantPanel } from '@/components/office-hub/attendance-table';
import { AgendaEditor } from '@/components/office-hub/agenda-editor';
import { MeetingNotesEditor } from '@/components/office-hub/notes-editor';
import { ActionItemsPanel, DecisionsPanel } from '@/components/office-hub/decision-forms';
import { DocumentsPanel } from '@/components/office-hub/documents-panel';

export default function MeetingDetailPage() {
  const params = useParams<{ meetingId: string }>();
  const meetingId = params?.meetingId ?? '';
  const router = useRouter();
  const now = useTickingNow();

  const { actor, viewer, capabilities, settings, isLoading, today } = useOfficeHub();
  const { isBusy, run } = useOfficeHubAction();
  const { toast } = useToast();

  const [meeting, setMeeting] = useState<OfficeHubMeeting | null>(null);
  const [meetingLoading, setMeetingLoading] = useState(true);
  const [participants, setParticipants] = useState<OfficeHubParticipant[]>([]);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelScope, setCancelScope] = useState<'occurrence' | 'series'>('occurrence');
  const [tab, setTab] = useState('overview');
  const [isSyncingMeet, setIsSyncingMeet] = useState(false);
  const [meetSyncError, setMeetSyncError] = useState<string | null>(null);

  /* Live: the meeting record and its participants (§52). */
  useEffect(() => {
    if (!meetingId) return;
    setMeetingLoading(true);
    const stop = subscribeMeeting(meetingId, (next) => {
      setMeeting(next);
      setMeetingLoading(false);
    });
    return stop;
  }, [meetingId]);

  useEffect(() => {
    if (!meetingId) return;
    return subscribeMeetingParticipants(meetingId, setParticipants);
  }, [meetingId]);

  const agendaQuery = useOfficeHubQuery(() => listAgenda(meetingId), [meetingId], { enabled: Boolean(meetingId), initial: [] });
  const decisionsQuery = useOfficeHubQuery(() => listDecisions({ meetingId }), [meetingId], { enabled: Boolean(meetingId), initial: [] });
  const actionItemsQuery = useOfficeHubQuery(() => listActionItems({ meetingId }), [meetingId], { enabled: Boolean(meetingId), initial: [] });
  const tasksQuery = useOfficeHubQuery(() => listTasksForMeeting(meetingId), [meetingId], { enabled: Boolean(meetingId), initial: [] });
  const documentsQuery = useOfficeHubQuery(() => listMeetingDocuments(meetingId), [meetingId], { enabled: Boolean(meetingId), initial: [] });
  const notesQuery = useOfficeHubQuery(() => getMeetingNotes(meetingId), [meetingId], { enabled: Boolean(meetingId) });
  const momQuery = useOfficeHubQuery(() => getMom(meetingId), [meetingId], { enabled: Boolean(meetingId) });
  const templatesQuery = useOfficeHubQuery(() => listAgendaTemplates(), [], { enabled: capabilities.canViewTemplates, initial: [] });

  const agenda = agendaQuery.data ?? [];
  const decisions = decisionsQuery.data ?? [];
  const actionItems = actionItemsQuery.data ?? [];
  const tasks = tasksQuery.data ?? [];
  const documents = documentsQuery.data ?? [];
  const notes = notesQuery.data ?? null;
  const mom = momQuery.data ?? null;

  const verdicts = useMemo(() => {
    if (!meeting) return null;
    return {
      edit: canEditMeeting(meeting, viewer, capabilities),
      cancel: canCancelMeeting(meeting, viewer, capabilities),
      participants: canManageParticipants(meeting, viewer, capabilities),
      agenda: canManageAgenda(meeting, viewer, capabilities),
      attendance: canRecordAttendanceFor(meeting, viewer, capabilities),
      run: canRunMeeting(meeting, viewer, capabilities),
      isOrganizer: isMeetingOrganizer(meeting, viewer),
    };
  }, [meeting, viewer, capabilities]);

  const join = useMemo(
    () =>
      meeting
        ? meetingJoinView(meeting, viewer.userId, { canViewAllMeetings: capabilities.canViewAllMeetings, now })
        : null,
    [meeting, viewer.userId, capabilities.canViewAllMeetings, now],
  );

  const viewerZone = useMemo(
    () => (meeting ? meetingInViewerZone(meeting, viewer.timeZone) : null),
    [meeting, viewer.timeZone],
  );

  /** The `abc-defg-hij` part of a Meet link, which is what people read out on a phone call. */
  const meetCode = useMemo(() => googleMeetCode(join?.url ?? null), [join?.url]);

  const followUp = useMemo(
    () =>
      meeting
        ? postMeetingSummary({
            participants,
            notesPlainText: notes?.plainText ?? null,
            decisions,
            actionItems,
            momStage: mom?.stage ?? meeting.momStage ?? null,
          })
        : null,
    [meeting, participants, notes?.plainText, decisions, actionItems, mom?.stage],
  );

  const reloadAll = () => {
    agendaQuery.reload();
    decisionsQuery.reload();
    actionItemsQuery.reload();
    tasksQuery.reload();
    documentsQuery.reload();
    notesQuery.reload();
    momQuery.reload();
  };

  if (isLoading || meetingLoading) return <OfficeHubLoader label="Loading the meeting" />;

  if (!meeting) {
    return (
      <OfficeHubEmptyState
        icon={AlertTriangle}
        title="That meeting could not be found."
        description="It may have been removed, or the link may be wrong."
        action={
          <Button variant="outline" asChild>
            <Link href={`${OFFICE_HUB_BASE_PATH}/meetings`}>Back to meetings</Link>
          </Button>
        }
      />
    );
  }

  if (!canViewMeeting(meeting, viewer, capabilities)) {
    return <OfficeHubAccessDenied what="this meeting" />;
  }

  const doStart = async () => {
    if (!actor) return;
    const ok = await run(() => startMeeting(actor, meeting.id), {
      success: 'Meeting started',
      failure: 'Could not start the meeting',
    });
    if (ok !== null) router.push(`${OFFICE_HUB_BASE_PATH}/meetings/${meeting.id}/live`);
  };

  const doEnd = async () => {
    if (!actor) return;
    await run(() => endMeeting(actor, meeting.id), {
      success: 'Meeting marked complete',
      failure: 'Could not complete the meeting',
    });
  };

  const doCancel = async () => {
    if (!actor) return;
    if (!cancelReason.trim()) return;
    const result = await run(
      () => cancelMeeting(actor, meeting.id, { reason: cancelReason.trim(), scope: cancelScope, settings }),
      { success: 'Meeting cancelled and participants notified', failure: 'Could not cancel the meeting' },
    );
    if (result) {
      setCancelOpen(false);
      setCancelReason('');
    }
  };

  /**
   * Create, or retry, the Google Meet link for this meeting.
   *
   * Offered only to whoever may edit the meeting, and only when there is no link — a "Retry" next
   * to a working link would invite somebody to replace a URL participants already hold.
   *
   * The error is held in state rather than only shown as a toast, because it has to stay on screen
   * next to the button that produced it — a toast for "the organizer has not connected Google" is
   * gone by the time somebody wonders why there is no link.
   *
   * No reload afterwards: `subscribeMeeting` is a live listener, so the link the server just wrote
   * arrives on its own.
   */
  const retryMeetLink = async () => {
    setMeetSyncError(null);
    setIsSyncingMeet(true);
    try {
      const result = await syncGoogleMeet(meeting.id);
      if (result.ok && result.meetUrl) {
        toast({ title: 'Meet link created', description: 'Participants can now join from Office Hub or Google Calendar.' });
      } else {
        setMeetSyncError(result.error ?? 'Google did not return a Meet link.');
      }
      for (const warning of result.warnings) {
        toast({ title: 'One thing to know', description: warning, duration: 12_000 });
      }
    } catch (error) {
      setMeetSyncError(error instanceof Error ? error.message : 'The Meet link could not be created.');
    } finally {
      setIsSyncingMeet(false);
    }
  };

  const copyJoinLink = async () => {
    if (!join?.url) return;
    try {
      await navigator.clipboard.writeText(join.url);
    } catch {
      // Clipboard access is blocked in some embedded webviews. Nothing to recover — the link is
      // visible on the page and can be copied by hand.
    }
  };

  return (
    <div className="space-y-3">
      <OfficeHubPageHeader
        title={meeting.title}
        description={`${formatIsoDate(meeting.date, { withWeekday: true })} · ${formatClockTime(
          meeting.startTime,
        )} – ${formatClockTime(meeting.endTime)} · ${meeting.timeZone}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {join?.canJoin && join.url && (
              <Button asChild variant={join.emphasise ? 'default' : 'outline'} className="gap-2">
                <a href={join.url} target="_blank" rel="noopener noreferrer">
                  <Video className="h-4 w-4" />
                  Join meeting
                </a>
              </Button>
            )}
            {verdicts?.run.allowed && meeting.status !== 'In Progress' && (
              <Button onClick={() => void doStart()} disabled={isBusy} className="gap-2">
                <PlayCircle className="h-4 w-4" />
                Start meeting
              </Button>
            )}
            {meeting.status === 'In Progress' && (
              <Button asChild className="gap-2">
                <Link href={`${OFFICE_HUB_BASE_PATH}/meetings/${meeting.id}/live`}>
                  <Radio className="h-4 w-4" />
                  Meeting mode
                </Link>
              </Button>
            )}
            <Button variant="outline" asChild className="gap-2">
              <Link href={`${OFFICE_HUB_BASE_PATH}/meetings/${meeting.id}/prepare`}>
                <ClipboardList className="h-4 w-4" />
                Prepare
              </Link>
            </Button>
            {verdicts?.edit.allowed && (
              <Button variant="outline" asChild className="gap-2">
                <Link href={`${OFFICE_HUB_BASE_PATH}/meetings/${meeting.id}/edit`}>
                  <Pencil className="h-4 w-4" />
                  Edit
                </Link>
              </Button>
            )}
            {verdicts?.cancel.allowed && (
              <Button variant="outline" onClick={() => setCancelOpen(true)} className="gap-2 text-destructive">
                <XCircle className="h-4 w-4" />
                Cancel
              </Button>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <MeetingStatusBadge status={meeting.status} />
        <PriorityBadge priority={meeting.priority} />
        <Badge variant="outline" className="border-slate-200 bg-slate-50 text-[11px]">
          {meeting.meetingType}
        </Badge>
        <MeetingModeBadge mode={meeting.mode} />
        <MeetingWhenBadge meeting={meeting} now={now} />
        <ResponseSummaryChip summary={meeting.responseSummary} />
        {meeting.recurrence.frequency !== 'None' && (
          <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-[11px] text-indigo-700">
            <Repeat className="mr-1 h-3 w-3" />
            {describeRecurrence(meeting.recurrence, meeting.date)}
          </Badge>
        )}
        {meeting.momStage && <MomStageBadge stage={meeting.momStage} />}
      </div>

      {meeting.status === 'Cancelled' && (
        <OfficeHubCallout
          tone="rose"
          icon={XCircle}
          title="This meeting was cancelled"
          description={meeting.cancellationReason ?? undefined}
        />
      )}

      {/* A participant whose own zone differs sees what their clock will read (§59). */}
      {viewerZone?.shifted && (
        <OfficeHubCallout
          tone="amber"
          icon={CalendarClock}
          title={`In your time zone (${viewer.timeZone}): ${formatIsoDate(viewerZone.date, {
            withWeekday: true,
          })}, ${formatClockTime(viewerZone.startTime)} – ${formatClockTime(viewerZone.endTime)}`}
          description={`Scheduled by the organizer in ${meeting.timeZone}.`}
        />
      )}

      {meeting.status === 'Completed' && followUp && (
        <Card className="border-emerald-200 bg-emerald-50/70">
          <CardContent className="space-y-2 px-4 py-3">
            <p className="text-sm font-semibold text-emerald-900">Meeting completed</p>
            <ul className="grid grid-cols-1 gap-x-4 gap-y-0.5 text-xs text-emerald-900/90 sm:grid-cols-2">
              <li>
                {followUp.attendanceRecorded ? '✓' : '○'} Attendance {followUp.attendanceMarked} of{' '}
                {followUp.attendanceTotal} recorded
              </li>
              <li>{followUp.notesSaved ? '✓' : '○'} Notes {followUp.notesSaved ? 'saved' : 'not saved'}</li>
              <li>✓ {followUp.decisions} decision{followUp.decisions === 1 ? '' : 's'} recorded</li>
              <li>✓ {followUp.actionItems} action item{followUp.actionItems === 1 ? '' : 's'} created</li>
              <li>✓ {followUp.tasksGenerated} task{followUp.tasksGenerated === 1 ? '' : 's'} generated</li>
              <li>
                {followUp.momStage === 'Published' ? '✓' : '○'} Minutes{' '}
                {followUp.momStage ? followUp.momStage.toLowerCase() : 'not started'}
              </li>
            </ul>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button size="sm" asChild className="gap-1.5">
                <Link href={`${OFFICE_HUB_BASE_PATH}/meetings/${meeting.id}/mom`}>
                  <FileText className="h-3.5 w-3.5" />
                  {followUp.momStage ? 'Open minutes' : 'Prepare MOM'}
                </Link>
              </Button>
              {tasks.length > 0 && (
                <Button size="sm" variant="outline" asChild>
                  <Link href={`${OFFICE_HUB_BASE_PATH}/tasks?meeting=${meeting.id}`}>View tasks</Link>
                </Button>
              )}
              {capabilities.canCreateMeeting && (
                <Button size="sm" variant="outline" asChild className="gap-1.5">
                  <Link href={`${OFFICE_HUB_BASE_PATH}/meetings/new?followUp=${meeting.id}`}>
                    <CalendarPlus className="h-3.5 w-3.5" />
                    Schedule follow-up
                  </Link>
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {meeting.status === 'In Progress' && verdicts?.run.allowed && (
        <OfficeHubCallout
          tone="emerald"
          icon={Radio}
          title="This meeting is in progress"
          description="Open meeting mode to mark attendance, take notes and record decisions as you go."
          action={
            <div className="flex flex-wrap gap-2">
              <Button size="sm" asChild>
                <Link href={`${OFFICE_HUB_BASE_PATH}/meetings/${meeting.id}/live`}>Meeting mode</Link>
              </Button>
              <Button size="sm" variant="outline" onClick={() => void doEnd()} disabled={isBusy}>
                End meeting
              </Button>
            </div>
          }
        />
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="overview" className="text-xs">
            Overview
          </TabsTrigger>
          <TabsTrigger value="participants" className="text-xs">
            Participants ({participants.length})
          </TabsTrigger>
          <TabsTrigger value="agenda" className="text-xs">
            Agenda ({agenda.length})
          </TabsTrigger>
          <TabsTrigger value="attendance" className="text-xs">
            Attendance
          </TabsTrigger>
          <TabsTrigger value="notes" className="text-xs">
            Notes
          </TabsTrigger>
          <TabsTrigger value="decisions" className="text-xs">
            Decisions ({decisions.length})
          </TabsTrigger>
          <TabsTrigger value="actions" className="text-xs">
            Action items ({actionItems.length})
          </TabsTrigger>
          <TabsTrigger value="tasks" className="text-xs">
            Tasks ({tasks.length})
          </TabsTrigger>
          <TabsTrigger value="documents" className="text-xs">
            Documents ({documents.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-3 space-y-3">
          <Card>
            <CardContent className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
              <OfficeHubField label="Organizer">{meeting.organizerName}</OfficeHubField>
              <OfficeHubField label="Meeting type">{meeting.meetingType}</OfficeHubField>
              <OfficeHubField label="Priority">
                <PriorityBadge priority={meeting.priority} />
              </OfficeHubField>
              <OfficeHubField label="Date">{formatIsoDate(meeting.date, { withWeekday: true })}</OfficeHubField>
              <OfficeHubField label="Time">
                {formatClockTime(meeting.startTime)} – {formatClockTime(meeting.endTime)} ({meeting.timeZone})
              </OfficeHubField>
              <OfficeHubField label="Duration">{formatDuration(meetingDurationMinutes(meeting))}</OfficeHubField>
              <OfficeHubField label="Mode">{meeting.mode}</OfficeHubField>

              {meeting.mode !== 'Offline' && (
                <OfficeHubField label="Online">
                  <div className="space-y-1">
                    <p>{meeting.onlinePlatform ?? 'Online'}</p>
                    {join?.url ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <a
                          href={join.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 break-all text-xs text-indigo-600 hover:underline"
                        >
                          <ExternalLink className="h-3 w-3 shrink-0" />
                          Joining link
                        </a>
                        <Button size="sm" variant="ghost" className="h-6 gap-1 px-1.5 text-[11px]" onClick={() => void copyJoinLink()}>
                          <Copy className="h-3 w-3" />
                          Copy
                        </Button>
                        {meetCode && <span className="text-[11px] text-muted-foreground">{meetCode}</span>}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">{join?.reason ?? 'No link yet.'}</p>
                    )}

                    {/*
                      The Meet link is created on save, so its absence on a scheduled online meeting
                      means the Google call did not succeed. Shown with the reason and one action,
                      to the people who can take it — everybody else would see a button that 403s.
                    */}
                    {!join?.url && verdicts?.edit.allowed && meeting.status !== 'Cancelled' && (
                      <div className="mt-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2">
                        {(meeting.googleSyncError || meetSyncError) && (
                          <p className="text-[11px] leading-relaxed text-amber-900">
                            {meetSyncError ?? meeting.googleSyncError}
                          </p>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-1.5 h-7 gap-1.5 bg-white text-[11px]"
                          onClick={() => void retryMeetLink()}
                          disabled={isSyncingMeet}
                        >
                          {isSyncingMeet ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Video className="h-3 w-3" />
                          )}
                          {meeting.googleSyncState === 'failed' ? 'Retry Meet link' : 'Create Meet link'}
                        </Button>
                      </div>
                    )}

                    {meeting.meetingPasscode && (
                      <p className="text-xs text-muted-foreground">Passcode: {meeting.meetingPasscode}</p>
                    )}
                    {meeting.googleEventHtmlLink && (
                      <a
                        href={meeting.googleEventHtmlLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:underline"
                      >
                        <ExternalLink className="h-3 w-3 shrink-0" />
                        Open in Google Calendar
                      </a>
                    )}
                  </div>
                </OfficeHubField>
              )}

              {meeting.mode !== 'Online' && (
                <OfficeHubField label="Location">
                  <span className="inline-flex items-start gap-1">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span>
                      {[meeting.location, meeting.room].filter(Boolean).join(' · ') || 'To be confirmed'}
                      {meeting.address && (
                        <span className="block text-xs text-muted-foreground">{meeting.address}</span>
                      )}
                    </span>
                  </span>
                </OfficeHubField>
              )}

              {meeting.projectName && (
                <OfficeHubField label="Project">{meeting.projectName}</OfficeHubField>
              )}
              <OfficeHubField label="Responses">{describeResponses(meeting.responseSummary)}</OfficeHubField>
              <OfficeHubField label="Reminders">
                {meeting.reminderOffsets?.length
                  ? meeting.reminderOffsets
                      .map((offset) => (offset === 0 ? 'at start' : formatDuration(offset) + ' before'))
                      .join(', ')
                  : 'Each participant’s own default'}
              </OfficeHubField>
              {meeting.followUpOfMeetingTitle && (
                <OfficeHubField label="Follows">
                  <Link
                    href={`${OFFICE_HUB_BASE_PATH}/meetings/${meeting.followUpOfMeetingId}`}
                    className="text-indigo-600 hover:underline"
                  >
                    {meeting.followUpOfMeetingTitle}
                  </Link>
                </OfficeHubField>
              )}
            </CardContent>
          </Card>

          {meeting.description && (
            <Card>
              <CardContent className="p-4">
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Description
                </p>
                <p className="whitespace-pre-wrap text-sm text-slate-700">{meeting.description}</p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-1 p-4 text-xs text-muted-foreground">
              <span>Created by {formatAuditStamp(meeting.createdByName, meeting.createdAt)}</span>
              {meeting.scheduledByName && meeting.scheduledById !== meeting.organizerId && (
                <span>Scheduled on behalf of the organizer by {meeting.scheduledByName}</span>
              )}
              <span>Last updated {formatAuditStamp(meeting.updatedByName, meeting.updatedAt)}</span>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="participants" className="mt-3">
          <ParticipantPanel
            meeting={meeting}
            participants={participants}
            canRecordAttendance={verdicts?.attendance.allowed ?? false}
            canManageParticipants={verdicts?.participants.allowed ?? false}
            onChanged={reloadAll}
          />
        </TabsContent>

        <TabsContent value="agenda" className="mt-3">
          <AgendaEditor
            meeting={meeting}
            items={agenda}
            canEdit={verdicts?.agenda.allowed ?? false}
            templates={templatesQuery.data ?? []}
            onChanged={agendaQuery.reload}
          />
          {!verdicts?.agenda.allowed && verdicts?.agenda.reason && agenda.length > 0 && (
            <p className="mt-2 text-[11px] text-muted-foreground">{verdicts.agenda.reason}</p>
          )}
        </TabsContent>

        <TabsContent value="attendance" className="mt-3">
          {verdicts?.attendance.allowed || participants.some((participant) => participant.attendance) ? (
            <ParticipantPanel
              meeting={meeting}
              participants={participants}
              canRecordAttendance={verdicts?.attendance.allowed ?? false}
              canManageParticipants={verdicts?.participants.allowed ?? false}
              onChanged={reloadAll}
              attendanceMode
            />
          ) : (
            <OfficeHubEmptyState
              icon={ClipboardCheck}
              title="Attendance has not been recorded."
              description={verdicts?.attendance.reason ?? 'The organizer records attendance for this meeting.'}
            />
          )}
        </TabsContent>

        <TabsContent value="notes" className="mt-3">
          <MeetingNotesEditor
            meetingId={meeting.id}
            meetingTitle={meeting.title}
            notes={notes}
            canEdit={(verdicts?.isOrganizer ?? false) || capabilities.canPrepareMinutes}
          />
        </TabsContent>

        <TabsContent value="decisions" className="mt-3">
          <DecisionsPanel
            decisions={decisions}
            meeting={meeting}
            agenda={agenda}
            canCreate={capabilities.canCreateDecision}
            canEdit={capabilities.canEditAnyDecision || (verdicts?.isOrganizer ?? false)}
            onChanged={reloadAll}
            today={today}
          />
        </TabsContent>

        <TabsContent value="actions" className="mt-3">
          <ActionItemsPanel
            items={actionItems}
            meeting={meeting}
            agenda={agenda}
            decisions={decisions}
            canCreate={capabilities.canCreateActionItem}
            canEdit={capabilities.canEditAnyActionItem || (verdicts?.isOrganizer ?? false)}
            canConvert={capabilities.canConvertActionItem}
            onChanged={reloadAll}
            today={today}
          />
        </TabsContent>

        <TabsContent value="tasks" className="mt-3">
          {tasks.length === 0 ? (
            <OfficeHubEmptyState
              icon={ListTodo}
              title="No tasks have come out of this meeting yet."
              description="Turn an action item into a task and it will appear here, linked back to this meeting."
            />
          ) : (
            <ul className="divide-y rounded-lg border bg-white">
              {tasks.map((task) => (
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
            entityType="meeting"
            entityId={meeting.id}
            meetingId={meeting.id}
            documents={documents}
            canUpload={capabilities.canUploadDocuments && meeting.status !== 'Cancelled'}
            canRemove={capabilities.canRemoveDocuments || (verdicts?.isOrganizer ?? false)}
            onChanged={documentsQuery.reload}
          />
        </TabsContent>
      </Tabs>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this meeting?</DialogTitle>
            <DialogDescription>
              Every participant is notified and their reminders are cancelled. The meeting stays on
              the record as cancelled — nothing is deleted.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <Label className="mb-1 block text-xs">
                Reason<span className="ml-0.5 text-destructive">*</span>
              </Label>
              <Textarea
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value)}
                rows={3}
                placeholder="Participants see this, so say enough for them to plan around it."
                className="bg-white"
                autoFocus
              />
            </div>

            {meeting.seriesId && (
              <div>
                <Label className="mb-1 block text-xs">Applies to</Label>
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    size="sm"
                    variant={cancelScope === 'occurrence' ? 'default' : 'outline'}
                    className={cn('text-xs', cancelScope !== 'occurrence' && 'bg-white')}
                    onClick={() => setCancelScope('occurrence')}
                  >
                    Only this occurrence
                  </Button>
                  <Button
                    size="sm"
                    variant={cancelScope === 'series' ? 'default' : 'outline'}
                    className={cn('text-xs', cancelScope !== 'series' && 'bg-white')}
                    onClick={() => setCancelScope('series')}
                  >
                    This and all future occurrences
                  </Button>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setCancelOpen(false)} disabled={isBusy}>
              Keep the meeting
            </Button>
            <Button
              variant="destructive"
              onClick={() => void doCancel()}
              disabled={isBusy || !cancelReason.trim()}
              className="gap-2"
            >
              <XCircle className="h-4 w-4" />
              Cancel meeting
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}

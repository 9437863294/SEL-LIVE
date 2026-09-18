'use client';

/**
 * Meeting mode (§18).
 *
 * A single screen for the twenty minutes somebody is actually running a meeting, laid out for that
 * and nothing else: a timer, the agenda to tick through, the notes to type into, and one-tap ways to
 * record a decision, raise an action item and mark attendance — without navigating away and losing
 * the notes.
 *
 * ── The three decisions that shape this screen ──────────────────────────────────────────────────
 *
 *  1. **Nothing here navigates.** Everything that would be a separate page elsewhere is a dialog,
 *     because the person using it has a room waiting and half a paragraph of unsaved notes.
 *  2. **The timer counts from `startedAt`, not from the scheduled start.** A meeting that began ten
 *     minutes late is ten minutes in, not twenty — and a facilitator watching the clock needs the
 *     honest number.
 *  3. **Ending the meeting is the one destructive-feeling action, so it is confirmed and it
 *     summarises.** The confirmation is also the §68 receipt: what was recorded, and what was not.
 */

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  AlertTriangle,
  CheckSquare,
  ClipboardCheck,
  Gavel,
  ListOrdered,
  Paperclip,
  Radio,
  Square,
  StickyNote,
  Timer,
  Users,
} from 'lucide-react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
  OFFICE_HUB_BASE_PATH,
  canRunMeeting,
  canViewMeeting,
  formatClockTime,
  formatDuration,
  meetingDurationMinutes,
  postMeetingSummary,
  summarizeAttendance,
  type OfficeHubMeeting,
  type OfficeHubParticipant,
} from '@/lib/office-hub';
import {
  endMeeting,
  getMeetingNotes,
  listActionItems,
  listAgenda,
  listDecisions,
  listMeetingDocuments,
  startMeeting,
  subscribeMeeting,
  subscribeMeetingParticipants,
} from '@/lib/office-hub-service';
import { useOfficeHub, useOfficeHubAction, useOfficeHubQuery } from '@/components/office-hub/hooks';
import {
  OfficeHubAccessDenied,
  OfficeHubEmptyState,
  OfficeHubLoader,
} from '@/components/office-hub/ui';
import { AgendaEditor } from '@/components/office-hub/agenda-editor';
import { ParticipantPanel } from '@/components/office-hub/attendance-table';
import { MeetingNotesEditor } from '@/components/office-hub/notes-editor';
import { ActionItemsPanel, DecisionsPanel } from '@/components/office-hub/decision-forms';
import { DocumentsPanel } from '@/components/office-hub/documents-panel';

export default function LiveMeetingPage() {
  const params = useParams<{ meetingId: string }>();
  const meetingId = params?.meetingId ?? '';
  const router = useRouter();

  const { actor, viewer, capabilities, isLoading, today } = useOfficeHub();
  const { isBusy, run } = useOfficeHubAction();

  const [meeting, setMeeting] = useState<OfficeHubMeeting | null>(null);
  const [meetingLoading, setMeetingLoading] = useState(true);
  const [participants, setParticipants] = useState<OfficeHubParticipant[]>([]);
  const [tab, setTab] = useState('agenda');
  const [endOpen, setEndOpen] = useState(false);

  /**
   * A one-second tick, only here.
   *
   * The rest of the module uses a 30-second tick, which is right for "starts in 20 minutes". A
   * running timer has to move every second or it looks broken, and this is the one screen where
   * somebody is watching it.
   */
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!meetingId) return;
    setMeetingLoading(true);
    return subscribeMeeting(meetingId, (next) => {
      setMeeting(next);
      setMeetingLoading(false);
    });
  }, [meetingId]);

  useEffect(() => {
    if (!meetingId) return;
    return subscribeMeetingParticipants(meetingId, setParticipants);
  }, [meetingId]);

  const agendaQuery = useOfficeHubQuery(() => listAgenda(meetingId), [meetingId], { enabled: Boolean(meetingId), initial: [] });
  const decisionsQuery = useOfficeHubQuery(() => listDecisions({ meetingId }), [meetingId], { enabled: Boolean(meetingId), initial: [] });
  const actionItemsQuery = useOfficeHubQuery(() => listActionItems({ meetingId }), [meetingId], { enabled: Boolean(meetingId), initial: [] });
  const documentsQuery = useOfficeHubQuery(() => listMeetingDocuments(meetingId), [meetingId], { enabled: Boolean(meetingId), initial: [] });
  const notesQuery = useOfficeHubQuery(() => getMeetingNotes(meetingId), [meetingId], { enabled: Boolean(meetingId) });

  const agenda = agendaQuery.data ?? [];
  const decisions = decisionsQuery.data ?? [];
  const actionItems = actionItemsQuery.data ?? [];
  const documents = documentsQuery.data ?? [];
  const notes = notesQuery.data ?? null;

  const elapsed = useMemo(() => {
    if (!meeting?.startedAt) return null;
    const started = Date.parse(meeting.startedAt);
    if (Number.isNaN(started)) return null;
    return Math.max(0, Math.floor((now.getTime() - started) / 1000));
  }, [meeting?.startedAt, now]);

  const booked = meeting ? meetingDurationMinutes(meeting) : 0;
  const overrunning = elapsed != null && booked > 0 && elapsed > booked * 60;

  const attendance = useMemo(() => summarizeAttendance(participants), [participants]);
  const covered = agenda.filter((item) => item.covered).length;

  const summary = useMemo(
    () =>
      postMeetingSummary({
        participants,
        notesPlainText: notes?.plainText ?? null,
        decisions,
        actionItems,
        momStage: meeting?.momStage ?? null,
      }),
    [participants, notes?.plainText, decisions, actionItems, meeting?.momStage],
  );

  const reloadAll = () => {
    agendaQuery.reload();
    decisionsQuery.reload();
    actionItemsQuery.reload();
    documentsQuery.reload();
    notesQuery.reload();
  };

  if (isLoading || meetingLoading) return <OfficeHubLoader label="Opening meeting mode" />;

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

  const runVerdict = canRunMeeting(meeting, viewer, capabilities);
  const canRun = runVerdict.allowed || meeting.status === 'In Progress';

  const doStart = async () => {
    if (!actor) return;
    await run(() => startMeeting(actor, meeting.id), { success: 'Meeting started', failure: 'Could not start the meeting' });
  };

  const doEnd = async () => {
    if (!actor) return;
    const ok = await run(() => endMeeting(actor, meeting.id), {
      success: 'Meeting completed',
      failure: 'Could not complete the meeting',
    });
    if (ok !== null) {
      setEndOpen(false);
      router.push(`${OFFICE_HUB_BASE_PATH}/meetings/${meeting.id}/mom`);
    }
  };

  return (
    <div className="space-y-3">
      {/* The header is the control panel: state, timer, and the one action that ends the meeting. */}
      <Card
        className={cn(
          'border-2',
          meeting.status === 'In Progress'
            ? overrunning
              ? 'border-amber-300 bg-amber-50/70'
              : 'border-emerald-300 bg-emerald-50/70'
            : 'border-slate-200 bg-white',
        )}
      >
        <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-700">
              {meeting.status === 'In Progress' ? (
                <>
                  <Radio className="h-3.5 w-3.5 animate-pulse" />
                  Meeting in progress
                </>
              ) : (
                <span className="text-slate-500">Meeting mode</span>
              )}
            </p>
            <h1 className="mt-0.5 truncate text-lg font-semibold tracking-tight text-slate-800 sm:text-xl">
              {meeting.title}
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              {formatClockTime(meeting.startTime)} – {formatClockTime(meeting.endTime)} · booked{' '}
              {formatDuration(booked)} · {meeting.organizerName}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="text-right">
              <p className="flex items-center justify-end gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                <Timer className="h-3.5 w-3.5" />
                Elapsed
              </p>
              <p
                className={cn(
                  'font-mono text-2xl font-semibold tabular-nums',
                  overrunning ? 'text-amber-700' : 'text-slate-800',
                )}
                aria-live="off"
              >
                {elapsed == null ? '—:—:—' : formatElapsed(elapsed)}
              </p>
              {overrunning && <p className="text-[11px] font-medium text-amber-700">Over the booked slot</p>}
            </div>

            {canRun && meeting.status !== 'In Progress' && meeting.status !== 'Completed' && (
              <Button onClick={() => void doStart()} disabled={isBusy} className="gap-2">
                <Radio className="h-4 w-4" />
                Start
              </Button>
            )}
            {canRun && meeting.status === 'In Progress' && (
              <Button variant="destructive" onClick={() => setEndOpen(true)} disabled={isBusy} className="gap-2">
                <Square className="h-4 w-4" />
                End meeting
              </Button>
            )}
            <Button variant="outline" asChild>
              <Link href={`${OFFICE_HUB_BASE_PATH}/meetings/${meeting.id}`}>Exit</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {!canRun && (
        <Card className="border-amber-200 bg-amber-50/70">
          <CardContent className="px-4 py-3">
            <p className="text-sm text-amber-900">
              {runVerdict.reason ?? 'You are viewing this meeting in read-only mode.'}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Live counters, so the facilitator can see what still needs doing without changing tab. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <LiveStat icon={Users} label="Attendance" value={`${attendance.present + attendance.late}/${attendance.invited}`} hint={attendance.unmarked ? `${attendance.unmarked} unmarked` : 'all marked'} />
        <LiveStat icon={ListOrdered} label="Agenda" value={`${covered}/${agenda.length}`} hint="covered" />
        <LiveStat icon={Gavel} label="Decisions" value={decisions.length} hint="recorded" />
        <LiveStat icon={CheckSquare} label="Action items" value={actionItems.length} hint={`${summary.tasksGenerated} became tasks`} />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="agenda" className="gap-1.5 text-xs">
            <ListOrdered className="h-3.5 w-3.5" />
            Agenda
          </TabsTrigger>
          <TabsTrigger value="notes" className="gap-1.5 text-xs">
            <StickyNote className="h-3.5 w-3.5" />
            Notes
          </TabsTrigger>
          <TabsTrigger value="attendance" className="gap-1.5 text-xs">
            <ClipboardCheck className="h-3.5 w-3.5" />
            Attendance
          </TabsTrigger>
          <TabsTrigger value="decisions" className="gap-1.5 text-xs">
            <Gavel className="h-3.5 w-3.5" />
            Decisions
          </TabsTrigger>
          <TabsTrigger value="actions" className="gap-1.5 text-xs">
            <CheckSquare className="h-3.5 w-3.5" />
            Actions
          </TabsTrigger>
          <TabsTrigger value="documents" className="gap-1.5 text-xs">
            <Paperclip className="h-3.5 w-3.5" />
            Files
          </TabsTrigger>
        </TabsList>

        <TabsContent value="agenda" className="mt-3">
          <AgendaEditor
            meeting={meeting}
            items={agenda}
            canEdit={canRun}
            onChanged={agendaQuery.reload}
            liveMode
          />
        </TabsContent>

        <TabsContent value="notes" className="mt-3">
          <MeetingNotesEditor
            meetingId={meeting.id}
            meetingTitle={meeting.title}
            notes={notes}
            canEdit={canRun}
          />
        </TabsContent>

        <TabsContent value="attendance" className="mt-3">
          <ParticipantPanel
            meeting={meeting}
            participants={participants}
            canRecordAttendance={canRun}
            canManageParticipants={canRun}
            onChanged={reloadAll}
            attendanceMode
          />
        </TabsContent>

        <TabsContent value="decisions" className="mt-3">
          <DecisionsPanel
            decisions={decisions}
            meeting={meeting}
            agenda={agenda}
            canCreate={capabilities.canCreateDecision}
            canEdit={capabilities.canEditAnyDecision || canRun}
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
            canEdit={capabilities.canEditAnyActionItem || canRun}
            canConvert={capabilities.canConvertActionItem}
            onChanged={reloadAll}
            today={today}
          />
        </TabsContent>

        <TabsContent value="documents" className="mt-3">
          <DocumentsPanel
            entityType="meeting"
            entityId={meeting.id}
            meetingId={meeting.id}
            documents={documents}
            canUpload={capabilities.canUploadDocuments}
            canRemove={capabilities.canRemoveDocuments || canRun}
            onChanged={documentsQuery.reload}
          />
        </TabsContent>
      </Tabs>

      <Dialog open={endOpen} onOpenChange={setEndOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>End the meeting?</DialogTitle>
            <DialogDescription>
              The meeting is marked complete and its reminders are cancelled. You can still record
              attendance and prepare the minutes afterwards.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What was recorded</p>
            <ul className="space-y-0.5 text-sm text-slate-700">
              <li>
                {summary.attendanceRecorded ? '✓' : '○'} Attendance: {summary.attendanceMarked} of{' '}
                {summary.attendanceTotal}
              </li>
              <li>{summary.notesSaved ? '✓' : '○'} Discussion notes {summary.notesSaved ? 'saved' : 'not saved'}</li>
              <li>✓ {summary.decisions} decision{summary.decisions === 1 ? '' : 's'}</li>
              <li>
                ✓ {summary.actionItems} action item{summary.actionItems === 1 ? '' : 's'} ·{' '}
                {summary.tasksGenerated} task{summary.tasksGenerated === 1 ? '' : 's'} generated
              </li>
            </ul>

            {summary.outstanding.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                <p className="text-xs font-semibold text-amber-900">Still outstanding</p>
                <ul className="mt-0.5 space-y-0.5 text-xs text-amber-900/90">
                  {summary.outstanding.map((line) => (
                    <li key={line}>• {line}</li>
                  ))}
                </ul>
                <p className="mt-1 text-[11px] text-amber-900/70">
                  You can end the meeting anyway — none of this is blocked, and all of it can be done
                  afterwards.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setEndOpen(false)} disabled={isBusy}>
              Keep it running
            </Button>
            <Button onClick={() => void doEnd()} disabled={isBusy} className="gap-2">
              <Square className="h-4 w-4" />
              End and prepare minutes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LiveStat({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <Card className="border-white/60 bg-white/80">
      <CardContent className="flex items-center gap-2.5 p-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100">
          <Icon className="h-4 w-4 text-slate-500" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="truncate text-base font-semibold tabular-nums leading-tight text-slate-800">{value}</p>
          {hint && <p className="truncate text-[11px] text-muted-foreground">{hint}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

/** `1:04:32`, or `04:32` under an hour — the shape a stopwatch is read in. */
function formatElapsed(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

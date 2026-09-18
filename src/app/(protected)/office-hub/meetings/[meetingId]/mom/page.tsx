'use client';

/**
 * Minutes of Meeting, with the optional approval ladder (§45, §46).
 *
 * ── The ladder, and what it actually enforces ───────────────────────────────────────────────────
 *
 * `Draft → Prepared → Reviewed → Approved → Published`, but only when the installation has switched
 * approval on. With it off, preparation goes straight to publication: an office that said it does
 * not want a ladder should not be walked up one, because the intermediate steps get clicked through
 * without being read, which is worse than not having them.
 *
 * Two rules the screen cannot talk you out of, both from `canAdvanceMinutes`:
 *
 *   • Minutes cannot be **published** before the meeting is marked complete. Publishing the minutes
 *     of a meeting that has not happened describes a meeting that does not exist.
 *   • With approval on, the person who **prepared** the minutes may not also **approve** them. A
 *     ladder one person can walk alone records four signatures from one signatory.
 *
 * Publication is what circulates the minutes to every participant, so it is the one transition with
 * a confirmation.
 */

import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileText,
  Printer,
  Save,
  Send,
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  MOM_STAGES,
  OFFICE_HUB_BASE_PATH,
  buildMomDocument,
  canAdvanceMinutes,
  canViewMeeting,
  formatIsoDate,
  isMeetingOrganizer,
  nextMomStage,
  type MomStage,
} from '@/lib/office-hub';
import {
  advanceMom,
  getMeetingNotes,
  getMom,
  listActionItems,
  listAgenda,
  listDecisions,
  listMeetingParticipants,
  getMeeting,
  saveMom,
} from '@/lib/office-hub-service';
import { useOfficeHub, useOfficeHubAction, useOfficeHubQuery } from '@/components/office-hub/hooks';
import {
  MomStageBadge,
  OfficeHubAccessDenied,
  OfficeHubCallout,
  OfficeHubEmptyState,
  OfficeHubLoader,
  OfficeHubPageHeader,
  OfficeHubSection,
} from '@/components/office-hub/ui';
import { DateField, TimeField } from '@/components/office-hub/selectors';
import { MomView } from '@/components/office-hub/mom-view';

export default function MeetingMomPage() {
  const params = useParams<{ meetingId: string }>();
  const meetingId = params?.meetingId ?? '';
  const { actor, viewer, capabilities, settings, isLoading } = useOfficeHub();
  const { isBusy, run } = useOfficeHubAction();
  const printRef = useRef<HTMLDivElement>(null);

  const [confirming, setConfirming] = useState<MomStage | null>(null);
  const [note, setNote] = useState('');
  const [nextDate, setNextDate] = useState<string | null>(null);
  const [nextTime, setNextTime] = useState<string | null>(null);
  const [nextNote, setNextNote] = useState('');
  const [nextDirty, setNextDirty] = useState(false);

  const query = useOfficeHubQuery(
    async () => {
      const meeting = await getMeeting(meetingId);
      if (!meeting) return null;
      const [participants, agenda, decisions, actionItems, notes, mom] = await Promise.all([
        listMeetingParticipants(meetingId),
        listAgenda(meetingId),
        listDecisions({ meetingId }),
        listActionItems({ meetingId }),
        getMeetingNotes(meetingId),
        getMom(meetingId),
      ]);
      return { meeting, participants, agenda, decisions, actionItems, notes, mom };
    },
    [meetingId],
    { enabled: Boolean(meetingId) },
  );

  const data = query.data;
  const meeting = data?.meeting ?? null;
  const mom = data?.mom ?? null;

  const approvalRequired = mom?.approvalRequired ?? meeting?.momRequired ?? settings.momApprovalRequired;
  const stage: MomStage = mom?.stage ?? 'Draft';

  const document = useMemo(() => {
    if (!meeting) return null;
    return buildMomDocument({
      meeting,
      participants: data?.participants ?? [],
      agenda: data?.agenda ?? [],
      decisions: data?.decisions ?? [],
      actionItems: data?.actionItems ?? [],
      notesPlainText: data?.notes?.plainText ?? null,
      mom: mom
        ? {
            reference: mom.reference,
            stage: mom.stage,
            discussionHtml: data?.notes?.html ?? mom.discussionHtml ?? null,
            summary: mom.summary,
            nextMeetingDate: nextDirty ? nextDate : mom.nextMeetingDate,
            nextMeetingTime: nextDirty ? nextTime : mom.nextMeetingTime,
            nextMeetingNote: nextDirty ? nextNote : mom.nextMeetingNote,
            preparedByName: mom.preparedByName,
            approvedByName: mom.approvedByName,
          }
        : {
            // Not yet prepared: still render the document, so the organizer can see what the
            // minutes *will* say before committing to preparing them.
            stage: 'Draft',
            discussionHtml: data?.notes?.html ?? null,
            nextMeetingDate: nextDirty ? nextDate : null,
            nextMeetingTime: nextDirty ? nextTime : null,
            nextMeetingNote: nextDirty ? nextNote : null,
          },
    });
  }, [meeting, data, mom, nextDate, nextTime, nextNote, nextDirty]);

  const verdicts = useMemo(() => {
    if (!meeting) return null;
    const context = { stage, approvalRequired, preparedById: mom?.preparedById, reviewedById: mom?.reviewedById };
    return Object.fromEntries(
      MOM_STAGES.map((target) => [
        target,
        canAdvanceMinutes(context, meeting, viewer, capabilities, target),
      ]),
    ) as Record<MomStage, ReturnType<typeof canAdvanceMinutes>>;
  }, [meeting, stage, approvalRequired, mom?.preparedById, mom?.reviewedById, viewer, capabilities]);

  const next = nextMomStage(stage, approvalRequired);

  const saveNextMeeting = async () => {
    if (!actor) return;
    const ok = await run(
      () =>
        saveMom(
          actor,
          meetingId,
          {
            nextMeetingDate: nextDate,
            nextMeetingTime: nextTime,
            nextMeetingNote: nextNote.trim() || null,
            discussionHtml: data?.notes?.html ?? null,
          },
          { approvalRequired },
        ),
      { success: 'Minutes saved', failure: 'Could not save the minutes' },
    );
    if (ok !== null) {
      setNextDirty(false);
      query.reload();
    }
  };

  const advance = async (target: MomStage) => {
    if (!actor) return;
    // Snapshot the discussion into the minutes at preparation time, so a later edit to the notes
    // does not silently change minutes somebody has already reviewed.
    if (target === 'Prepared') {
      await saveMom(
        actor,
        meetingId,
        { discussionHtml: data?.notes?.html ?? null },
        { approvalRequired },
      ).catch(() => {});
    }
    const ok = await run(() => advanceMom(actor, meetingId, target, { note: note.trim() || null, settings }), {
      success:
        target === 'Published'
          ? 'Minutes published and circulated to participants'
          : `Minutes marked ${target.toLowerCase()}`,
      failure: 'Could not update the minutes',
    });
    if (ok !== null) {
      setConfirming(null);
      setNote('');
      query.reload();
    }
  };

  const print = () => {
    // The dedicated print route rather than `window.print()` on this page: the module layout strips
    // its chrome for `/print`, so the paper copy is the minutes and nothing else.
    window.open(`${OFFICE_HUB_BASE_PATH}/meetings/${meetingId}/mom/print`, '_blank', 'noopener,noreferrer');
  };

  if (isLoading || query.isLoading) return <OfficeHubLoader label="Assembling the minutes" />;

  if (!meeting || !document) {
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

  if (!canViewMeeting(meeting, viewer, capabilities)) return <OfficeHubAccessDenied what="these minutes" />;

  const isOrganizer = isMeetingOrganizer(meeting, viewer);
  const canEditNextMeeting = isOrganizer || capabilities.canPrepareMinutes;

  return (
    <div className="space-y-3">
      <OfficeHubPageHeader
        title="Minutes of meeting"
        description={`${meeting.title} · ${formatIsoDate(meeting.date, { withWeekday: true })}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={print} className="gap-2">
              <Printer className="h-4 w-4" />
              Print / PDF
            </Button>
            <Button variant="ghost" asChild>
              <Link href={`${OFFICE_HUB_BASE_PATH}/meetings/${meeting.id}`}>Meeting page</Link>
            </Button>
          </div>
        }
      />

      {/* The ladder, as a row of stages with the current one marked. */}
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {(approvalRequired ? MOM_STAGES : (['Draft', 'Prepared', 'Published'] as MomStage[])).map(
              (entry, index, list) => (
                <span key={entry} className="flex items-center gap-1.5">
                  <span
                    className={
                      entry === stage
                        ? 'rounded-md bg-indigo-600 px-2 py-1 text-[11px] font-semibold text-white'
                        : MOM_STAGES.indexOf(entry) < MOM_STAGES.indexOf(stage)
                          ? 'rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700'
                          : 'rounded-md bg-slate-100 px-2 py-1 text-[11px] text-slate-500'
                    }
                  >
                    {MOM_STAGES.indexOf(entry) < MOM_STAGES.indexOf(stage) && '✓ '}
                    {entry}
                  </span>
                  {index < list.length - 1 && <ArrowRight className="h-3 w-3 text-slate-300" />}
                </span>
              ),
            )}
            {!approvalRequired && (
              <span className="ml-1 text-[11px] text-muted-foreground">(approval not required)</span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <MomStageBadge stage={stage} />
            {next && verdicts?.[next]?.allowed && (
              <Button onClick={() => setConfirming(next)} disabled={isBusy} className="gap-2">
                {next === 'Published' ? <Send className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                {next === 'Prepared' ? 'Prepare minutes' : `Mark ${next.toLowerCase()}`}
              </Button>
            )}
            {next && verdicts?.[next] && !verdicts[next].allowed && (
              <p className="max-w-xs text-[11px] text-muted-foreground">{verdicts[next].reason}</p>
            )}
            {!next && (
              <p className="text-[11px] text-emerald-700">
                Published{mom?.circulatedToUserIds?.length ? ` to ${mom.circulatedToUserIds.length} participants` : ''}.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {meeting.status !== 'Completed' && (
        <OfficeHubCallout
          tone="amber"
          icon={AlertTriangle}
          title="This meeting is not marked complete"
          description="Minutes can be drafted now, but they cannot be published until the meeting has finished."
        />
      )}

      {mom?.history && mom.history.length > 0 && (
        <OfficeHubSection title="Approval trail" description="Append-only. Every stage, who moved it, and when.">
          <ul className="space-y-1.5 text-sm">
            {mom.history.map((entry, index) => (
              <li key={`${entry.stage}-${entry.at}-${index}`} className="flex flex-wrap items-baseline gap-2">
                <MomStageBadge stage={entry.stage} />
                <span className="text-slate-700">{entry.byName}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(entry.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                </span>
                {entry.note && <span className="text-xs italic text-muted-foreground">&ldquo;{entry.note}&rdquo;</span>}
              </li>
            ))}
          </ul>
        </OfficeHubSection>
      )}

      {canEditNextMeeting && stage !== 'Published' && (
        <OfficeHubSection
          title="Next meeting"
          description="Printed at the foot of the minutes. Leave blank if there is no follow-up."
          actions={
            nextDirty ? (
              <Button size="sm" onClick={() => void saveNextMeeting()} disabled={isBusy} className="gap-2">
                <Save className="h-4 w-4" />
                Save
              </Button>
            ) : undefined
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <DateField
              label="Date"
              value={nextDirty ? nextDate : mom?.nextMeetingDate ?? null}
              min={meeting.date}
              onChange={(value) => {
                setNextDate(value);
                setNextDirty(true);
              }}
            />
            <TimeField
              label="Time"
              value={nextDirty ? nextTime : mom?.nextMeetingTime ?? null}
              onChange={(value) => {
                setNextTime(value);
                setNextDirty(true);
              }}
            />
            <div>
              <Label className="mb-1 block text-xs">Note</Label>
              <Textarea
                value={nextDirty ? nextNote : mom?.nextMeetingNote ?? ''}
                onChange={(event) => {
                  setNextNote(event.target.value);
                  setNextDirty(true);
                }}
                rows={1}
                className="bg-white"
                placeholder="e.g. Same room"
              />
            </div>
          </div>
          {capabilities.canCreateMeeting && (
            <Button size="sm" variant="outline" asChild className="mt-2 gap-2">
              <Link
                href={`${OFFICE_HUB_BASE_PATH}/meetings/new?followUp=${meeting.id}${
                  (nextDirty ? nextDate : mom?.nextMeetingDate) ? `&date=${nextDirty ? nextDate : mom?.nextMeetingDate}` : ''
                }`}
              >
                <FileText className="h-4 w-4" />
                Schedule the follow-up now
              </Link>
            </Button>
          )}
        </OfficeHubSection>
      )}

      <Card className="overflow-hidden">
        <CardContent className="overflow-x-auto p-0">
          <MomView ref={printRef} document={document} organizationName={settings.organizationName} />
        </CardContent>
      </Card>

      <Dialog open={Boolean(confirming)} onOpenChange={(open) => !open && setConfirming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirming === 'Published' ? 'Publish and circulate these minutes?' : `Mark the minutes ${confirming?.toLowerCase()}?`}
            </DialogTitle>
            <DialogDescription>
              {confirming === 'Published'
                ? `Every participant (${meeting.participantCount}) is notified and the minutes become the record of this meeting.`
                : confirming === 'Prepared'
                  ? 'The discussion notes are snapshotted into the minutes now, so later edits to the notes will not change what has been reviewed.'
                  : 'Your name and the time are recorded against this stage. The trail is append-only.'}
            </DialogDescription>
          </DialogHeader>

          <div>
            <Label className="mb-1 block text-xs">Note (optional)</Label>
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
              className="bg-white"
              placeholder={confirming === 'Approved' ? 'e.g. Approved subject to the capex figure being confirmed.' : 'Anything worth recording.'}
            />
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(null)} disabled={isBusy}>
              Cancel
            </Button>
            <Button onClick={() => confirming && void advance(confirming)} disabled={isBusy} className="gap-2">
              {confirming === 'Published' ? <Send className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
              {confirming === 'Published' ? 'Publish' : `Mark ${confirming?.toLowerCase()}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

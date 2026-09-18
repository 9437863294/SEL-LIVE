'use client';

/**
 * The meeting preparation page (§71), which doubles as the post-meeting page (§72).
 *
 * One route rather than two, because they are the same six things read at different times: the
 * details, the participants, the agenda, the previous meeting's minutes and decisions, the open
 * action items, and the documents. Before the meeting that list is a checklist; after it, it is a
 * record. Splitting them into two routes would mean two screens showing the same data with
 * different headings.
 *
 * ── The part that is genuinely useful ───────────────────────────────────────────────────────────
 *
 * §70's carry-forward. Opening the preparation page for a recurring meeting shows the unfinished
 * action items from *earlier meetings in the same series*, worst-overdue first, with a button to
 * carry them into this one. That is the mechanism that stops a monthly review quietly losing track
 * of what it asked for last month, and `previousActionItemsFor` makes it idempotent — an item
 * already carried here is not offered again.
 */

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckSquare,
  ClipboardList,
  FileText,
  Gavel,
  ListOrdered,
  PlayCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  OFFICE_HUB_BASE_PATH,
  canManageAgenda,
  canRunMeeting,
  canViewMeeting,
  formatClockTime,
  formatIsoDate,
  isActionItemOverdue,
  meetingPreparationState,
  previousActionItemsFor,
  type OfficeHubActionItem,
} from '@/lib/office-hub';
import {
  carryActionItemsForward,
  getMeeting,
  getMom,
  listActionItems,
  listAgenda,
  listDecisions,
  listMeetingDocuments,
  listMeetingParticipants,
  listMeetings,
} from '@/lib/office-hub-service';
import { useOfficeHub, useOfficeHubAction, useOfficeHubQuery } from '@/components/office-hub/hooks';
import {
  DecisionStatusBadge,
  MeetingStatusBadge,
  MomStageBadge,
  OfficeHubAccessDenied,
  OfficeHubEmptyState,
  OfficeHubField,
  OfficeHubLoader,
  OfficeHubPageHeader,
  OfficeHubSection,
  PriorityBadge,
  ResponseSummaryChip,
} from '@/components/office-hub/ui';
import { ParticipantList } from '@/components/office-hub/selectors';
import { DocumentsPanel } from '@/components/office-hub/documents-panel';

export default function MeetingPreparePage() {
  const params = useParams<{ meetingId: string }>();
  const meetingId = params?.meetingId ?? '';
  const { actor, viewer, capabilities, isLoading, today } = useOfficeHub();
  const { isBusy, run } = useOfficeHubAction();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const query = useOfficeHubQuery(
    async () => {
      const meeting = await getMeeting(meetingId);
      if (!meeting) return null;

      const [participants, agenda, decisions, documents, mom] = await Promise.all([
        listMeetingParticipants(meetingId),
        listAgenda(meetingId),
        listDecisions({ meetingId }),
        listMeetingDocuments(meetingId),
        getMom(meetingId),
      ]);

      /**
       * The series' action items, and the previous instance's minutes.
       *
       * Both are only fetched for a recurring meeting — a one-off has no previous instance, and
       * there is no reason to spend the reads finding that out.
       */
      const seriesActionItems = meeting.seriesId
        ? await listActionItems({ seriesId: meeting.seriesId, limit: 300 })
        : await listActionItems({ meetingId, limit: 100 });

      let previous: { meeting: Awaited<ReturnType<typeof getMeeting>>; mom: Awaited<ReturnType<typeof getMom>> } | null =
        null;
      if (meeting.seriesId) {
        const siblings = await listMeetings('all', viewer, {
          toDate: meeting.date,
          limit: 60,
          direction: 'desc',
        }).catch(() => []);
        const earlier = siblings
          .filter((entry) => entry.seriesId === meeting.seriesId && entry.id !== meeting.id && entry.date < meeting.date)
          .sort((a, b) => b.date.localeCompare(a.date))[0];
        if (earlier) {
          previous = { meeting: earlier, mom: await getMom(earlier.id).catch(() => null) };
        }
      }

      return { meeting, participants, agenda, decisions, documents, mom, seriesActionItems, previous };
    },
    [meetingId, viewer.userId],
    { enabled: Boolean(meetingId) },
  );

  const data = query.data;
  const meeting = data?.meeting ?? null;

  const carryable = useMemo(
    () => (meeting ? previousActionItemsFor(data?.seriesActionItems ?? [], meeting.id, today) : []),
    [data?.seriesActionItems, meeting, today],
  );

  const ownItems = useMemo(
    () => (data?.seriesActionItems ?? []).filter((item) => item.meetingId === meetingId),
    [data?.seriesActionItems, meetingId],
  );

  const preparation = useMemo(() => {
    if (!meeting) return null;
    return meetingPreparationState({
      meeting,
      agendaCount: data?.agenda.length ?? 0,
      participants: data?.participants ?? [],
      openActionItems: carryable.length,
      documentsAttached: data?.documents.length ?? 0,
      previousMomStage: data?.previous?.mom?.stage ?? null,
    });
  }, [meeting, data, carryable.length]);

  const carry = async () => {
    if (!actor || !meeting || selected.size === 0) return;
    const ok = await run(() => carryActionItemsForward(actor, [...selected], meeting), {
      success: `${selected.size} item${selected.size === 1 ? '' : 's'} carried into this meeting`,
      failure: 'Could not carry the items forward',
    });
    if (ok != null) {
      setSelected(new Set());
      query.reload();
    }
  };

  if (isLoading || query.isLoading) return <OfficeHubLoader label="Gathering everything for this meeting" />;

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

  const isAfter = meeting.status === 'Completed';
  const canCarry = canManageAgenda(meeting, viewer, capabilities).allowed || capabilities.canEditAnyActionItem;

  return (
    <div className="space-y-3">
      <OfficeHubPageHeader
        title={isAfter ? 'Post-meeting' : 'Meeting preparation'}
        description={`${meeting.title} · ${formatIsoDate(meeting.date, { withWeekday: true })} at ${formatClockTime(
          meeting.startTime,
        )}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link href={`${OFFICE_HUB_BASE_PATH}/meetings/${meeting.id}`}>Meeting page</Link>
            </Button>
            {isAfter ? (
              <Button asChild className="gap-2">
                <Link href={`${OFFICE_HUB_BASE_PATH}/meetings/${meeting.id}/mom`}>
                  <FileText className="h-4 w-4" />
                  Minutes
                </Link>
              </Button>
            ) : (
              canRunMeeting(meeting, viewer, capabilities).allowed && (
                <Button asChild className="gap-2">
                  <Link href={`${OFFICE_HUB_BASE_PATH}/meetings/${meeting.id}/live`}>
                    <PlayCircle className="h-4 w-4" />
                    Start meeting
                  </Link>
                </Button>
              )
            )}
          </div>
        }
      />

      {preparation && preparation.outstanding.length > 0 && !isAfter && (
        <Card className="border-amber-200 bg-amber-50/70">
          <CardContent className="px-4 py-3">
            <p className="text-sm font-semibold text-amber-900">Before this meeting starts</p>
            <ul className="mt-1 space-y-0.5 text-xs text-amber-900/90">
              {preparation.outstanding.map((line) => (
                <li key={line}>• {line}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {preparation && preparation.outstanding.length === 0 && !isAfter && (
        <Card className="border-emerald-200 bg-emerald-50/70">
          <CardContent className="px-4 py-3">
            <p className="text-sm font-semibold text-emerald-900">Everything is ready for this meeting.</p>
            <p className="text-xs text-emerald-900/80">
              Agenda published, everybody has responded, and last time&rsquo;s business is closed out.
            </p>
          </CardContent>
        </Card>
      )}

      <OfficeHubSection title="Meeting details" description="The essentials, without leaving this page.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <OfficeHubField label="Status">
            <MeetingStatusBadge status={meeting.status} />
          </OfficeHubField>
          <OfficeHubField label="Type">{meeting.meetingType}</OfficeHubField>
          <OfficeHubField label="Priority">
            <PriorityBadge priority={meeting.priority} />
          </OfficeHubField>
          <OfficeHubField label="Organizer">{meeting.organizerName}</OfficeHubField>
          <OfficeHubField label="When">
            {formatIsoDate(meeting.date)} · {formatClockTime(meeting.startTime)} –{' '}
            {formatClockTime(meeting.endTime)}
          </OfficeHubField>
          <OfficeHubField label="Where">
            {meeting.mode === 'Online'
              ? meeting.onlinePlatform ?? 'Online'
              : [meeting.location, meeting.room].filter(Boolean).join(' · ') || 'To be confirmed'}
          </OfficeHubField>
          <OfficeHubField label="Responses">
            <ResponseSummaryChip summary={meeting.responseSummary} />
          </OfficeHubField>
          <OfficeHubField label="Minutes">
            <MomStageBadge stage={data?.mom?.stage ?? meeting.momStage} />
          </OfficeHubField>
        </div>
      </OfficeHubSection>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <OfficeHubSection
          title={`Participants (${data?.participants.length ?? 0})`}
          description="Who is expected, and who has answered."
          actions={
            <Button size="sm" variant="ghost" asChild>
              <Link href={`${OFFICE_HUB_BASE_PATH}/meetings/${meeting.id}`}>Responses</Link>
            </Button>
          }
        >
          <ParticipantList participants={data?.participants ?? []} />
        </OfficeHubSection>

        <OfficeHubSection
          title={`Agenda (${data?.agenda.length ?? 0})`}
          description="What the meeting will cover."
          actions={
            <Button size="sm" variant="ghost" asChild>
              <Link href={`${OFFICE_HUB_BASE_PATH}/meetings/${meeting.id}`}>Edit agenda</Link>
            </Button>
          }
        >
          {(data?.agenda.length ?? 0) === 0 ? (
            <OfficeHubEmptyState icon={ListOrdered} title="No agenda items yet." />
          ) : (
            <ol className="space-y-1.5">
              {data!.agenda.map((item) => (
                <li key={item.id} className="flex items-start gap-2 text-sm">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-slate-100 text-[10px] font-semibold text-slate-600">
                    {item.order}
                  </span>
                  <span className="min-w-0">
                    <span className="block break-words font-medium text-slate-800">{item.title}</span>
                    {(item.presenterName || item.estimatedMinutes) && (
                      <span className="block text-[11px] text-muted-foreground">
                        {[item.presenterName, item.estimatedMinutes ? `${item.estimatedMinutes} min` : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </OfficeHubSection>
      </div>

      {/* §70. The single most useful thing on this page for a recurring meeting. */}
      <OfficeHubSection
        title="Previous action items"
        description={
          meeting.seriesId
            ? 'Unfinished business from earlier meetings in this series, most overdue first.'
            : 'Open action items related to this meeting.'
        }
        actions={
          canCarry && selected.size > 0 ? (
            <Button size="sm" onClick={() => void carry()} disabled={isBusy} className="gap-2">
              <ArrowRight className="h-4 w-4" />
              Carry {selected.size} into this meeting
            </Button>
          ) : undefined
        }
      >
        {carryable.length === 0 ? (
          <OfficeHubEmptyState
            icon={CheckSquare}
            title="Nothing outstanding from last time."
            description={
              meeting.seriesId
                ? 'Every action item from earlier meetings in this series is closed.'
                : undefined
            }
          />
        ) : (
          <ul className="space-y-2">
            {carryable.map((item: OfficeHubActionItem) => {
              const overdue = isActionItemOverdue(item, today);
              const checked = selected.has(item.id);
              return (
                <li
                  key={item.id}
                  className={`flex items-start gap-2 rounded-lg border bg-white p-2.5 ${
                    overdue ? 'border-rose-200' : ''
                  }`}
                >
                  {canCarry && (
                    <Checkbox
                      checked={checked}
                      className="mt-0.5"
                      aria-label={`Carry "${item.title}" into this meeting`}
                      onCheckedChange={() =>
                        setSelected((current) => {
                          const next = new Set(current);
                          if (next.has(item.id)) next.delete(item.id);
                          else next.add(item.id);
                          return next;
                        })
                      }
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span aria-hidden className="text-sm">
                        {overdue ? '🔴' : item.status === 'In Progress' ? '🟡' : '⚪'}
                      </span>
                      <p className="min-w-0 break-words text-sm font-medium text-slate-800">{item.title}</p>
                      <Badge variant="outline" className="border-slate-200 bg-slate-50 text-[11px]">
                        {item.status}
                      </Badge>
                      <PriorityBadge priority={item.priority} />
                      {overdue && (
                        <Badge variant="outline" className="border-rose-200 bg-rose-50 text-[11px] text-rose-700">
                          Overdue
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {item.reference} · {item.responsibleUserName || item.responsibleTeamName || 'Unassigned'}
                      {item.dueDate ? ` · due ${formatIsoDate(item.dueDate)}` : ''}
                      {item.meetingTitle ? ` · from ${item.meetingTitle}` : ''}
                    </p>
                  </div>
                  {item.taskId && (
                    <Button size="sm" variant="ghost" asChild className="shrink-0">
                      <Link href={`${OFFICE_HUB_BASE_PATH}/tasks/${item.taskId}`}>Task</Link>
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </OfficeHubSection>

      {data?.previous?.meeting && (
        <OfficeHubSection
          title="Last time"
          description={`${data.previous.meeting.title} on ${formatIsoDate(data.previous.meeting.date)}.`}
          actions={
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" asChild>
                <Link href={`${OFFICE_HUB_BASE_PATH}/meetings/${data.previous.meeting.id}`}>Open</Link>
              </Button>
              <Button size="sm" variant="ghost" asChild>
                <Link href={`${OFFICE_HUB_BASE_PATH}/meetings/${data.previous.meeting.id}/mom`}>Minutes</Link>
              </Button>
            </div>
          }
        >
          <div className="flex flex-wrap items-center gap-2">
            <MomStageBadge stage={data.previous.mom?.stage ?? data.previous.meeting.momStage} />
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <CalendarClock className="h-3.5 w-3.5" />
              {formatIsoDate(data.previous.meeting.date, { withWeekday: true })}
            </span>
            <ResponseSummaryChip summary={data.previous.meeting.responseSummary} />
          </div>
        </OfficeHubSection>
      )}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <OfficeHubSection
          title={`Decisions from this meeting (${data?.decisions.length ?? 0})`}
          description="Recorded in the register."
        >
          {(data?.decisions.length ?? 0) === 0 ? (
            <OfficeHubEmptyState icon={Gavel} title="No decisions recorded yet." />
          ) : (
            <ul className="space-y-1.5">
              {data!.decisions.map((decision) => (
                <li key={decision.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <Link
                    href={`${OFFICE_HUB_BASE_PATH}/decisions/${decision.id}`}
                    className="min-w-0 flex-1 truncate font-medium text-slate-800 hover:underline"
                  >
                    {decision.title}
                  </Link>
                  <DecisionStatusBadge status={decision.status} />
                </li>
              ))}
            </ul>
          )}
        </OfficeHubSection>

        <OfficeHubSection
          title={`This meeting's action items (${ownItems.length})`}
          description="Raised here, tracked here."
        >
          {ownItems.length === 0 ? (
            <OfficeHubEmptyState icon={ClipboardList} title="Nothing raised in this meeting yet." />
          ) : (
            <ul className="space-y-1.5">
              {ownItems.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{item.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {item.responsibleUserName || item.responsibleTeamName || 'Unassigned'}
                  </span>
                  {item.taskId && (
                    <Button size="sm" variant="ghost" asChild className="h-6 px-2 text-[11px]">
                      <Link href={`${OFFICE_HUB_BASE_PATH}/tasks/${item.taskId}`}>Task</Link>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </OfficeHubSection>
      </div>

      <OfficeHubSection title="Documents" description="Anything participants should read.">
        <DocumentsPanel
          entityType="meeting"
          entityId={meeting.id}
          meetingId={meeting.id}
          documents={data?.documents ?? []}
          canUpload={capabilities.canUploadDocuments && meeting.status !== 'Cancelled'}
          canRemove={capabilities.canRemoveDocuments}
          onChanged={query.reload}
          emptyDescription="Attach the papers people need before the meeting rather than emailing them."
        />
      </OfficeHubSection>

      <p className="text-[11px] text-muted-foreground">
        This page gathers what already exists. Edit the agenda, participants and minutes from the
        meeting page itself.
      </p>
    </div>
  );
}

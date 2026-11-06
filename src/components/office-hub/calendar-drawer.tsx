'use client';

/**
 * The calendar's side drawer: what a clicked meeting or task is, my reply, and what I can do with
 * it from here (2026-11-06, from the user's mockup). Everything with consequences beyond a reply or
 * a tick — editing, cancelling, ending a series — stays on the meeting's own page, one click away,
 * where those actions already ask the questions they need to.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Bell, Check, CheckSquare, Clock, FileText, MapPin, Repeat, Users, Video, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import {
  DEFAULT_REMINDER_CHOICES,
  OFFICE_HUB_BASE_PATH,
  describeRecurrence,
  formatClockTime,
  formatIsoDate,
  type InvitationResponse,
  type OfficeHubPerson,
} from '@/lib/office-hub';
import { Avatar } from './meeting-form-parts';
import { placeOf, STATE_LABEL, type CalendarItem } from './meeting-calendar';

const BASE = OFFICE_HUB_BASE_PATH;

export function CalendarDrawer({
  item,
  onClose,
  people,
  myResponse,
  canReply,
  canEdit,
  joinUrl,
  canCompleteTask,
  busy,
  onReply,
  onCompleteTask,
}: {
  item: CalendarItem | null;
  onClose: () => void;
  people: readonly OfficeHubPerson[];
  /** My answer, when I am invited and not the organiser. */
  myResponse: InvitationResponse | null;
  canReply: boolean;
  canEdit: boolean;
  joinUrl: string | null;
  canCompleteTask: boolean;
  busy: boolean;
  onReply: (response: 'Accepted' | 'Maybe' | 'Declined') => void;
  onCompleteTask: () => void;
}) {
  return (
    <Sheet open={Boolean(item)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[400px]">
        {item?.kind === 'meeting' && (
          <MeetingBody
            item={item}
            people={people}
            myResponse={myResponse}
            canReply={canReply}
            canEdit={canEdit}
            joinUrl={joinUrl}
            busy={busy}
            onReply={onReply}
          />
        )}
        {item?.kind === 'task' && <TaskBody item={item} canComplete={canCompleteTask} busy={busy} onComplete={onCompleteTask} />}
      </SheetContent>
    </Sheet>
  );
}

function Header({ tone, eyebrow, title, detail }: { tone: 'primary' | 'amber' | 'muted'; eyebrow: string; title: string; detail: string }) {
  return (
    <div
      className={cn(
        'keep-light px-5 pb-4 pt-5 pr-12 text-white',
        tone === 'primary' && 'bg-gradient-to-br from-primary to-indigo-900',
        tone === 'amber' && 'bg-gradient-to-br from-amber-600 to-amber-900',
        tone === 'muted' && 'bg-gradient-to-br from-slate-500 to-slate-800',
      )}
    >
      <small className="text-[11px] font-bold uppercase tracking-[0.07em] opacity-85">{eyebrow}</small>
      <SheetTitle className="mt-1 text-[19px] font-bold leading-snug text-white">{title}</SheetTitle>
      <SheetDescription className="text-[12.5px] text-white/90">{detail}</SheetDescription>
    </div>
  );
}

function Row({ icon: Icon, title, children }: { icon: typeof Clock; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-start gap-3 border-b py-2.5 last:border-b-0">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <b className="block text-[12.5px]">{title}</b>
        {children && <div className="text-xs text-muted-foreground">{children}</div>}
      </div>
    </div>
  );
}

function MeetingBody({
  item,
  people,
  myResponse,
  canReply,
  canEdit,
  joinUrl,
  busy,
  onReply,
}: {
  item: Extract<CalendarItem, { kind: 'meeting' }>;
  people: readonly OfficeHubPerson[];
  myResponse: InvitationResponse | null;
  canReply: boolean;
  canEdit: boolean;
  joinUrl: string | null;
  busy: boolean;
  onReply: (response: 'Accepted' | 'Maybe' | 'Declined') => void;
}) {
  const meeting = item.meeting;
  const participantIds = meeting.participantUserIds ?? [];
  const shown = participantIds.slice(0, 10);
  const reminders = (meeting.reminderOffsets ?? [])
    .map((minutes) => DEFAULT_REMINDER_CHOICES.find((choice) => choice.minutes === minutes)?.label ?? `${minutes} minutes before`)
    .join(', ');
  const repeats =
    meeting.recurrence && meeting.recurrence.frequency !== 'None'
      ? describeRecurrence(meeting.recurrence, meeting.date)
      : meeting.seriesId
        ? 'Part of a repeating series'
        : null;

  return (
    <>
      <Header
        tone={item.state === 'cancelled' || item.state === 'declined' ? 'muted' : 'primary'}
        eyebrow={`${meeting.meetingType || 'Meeting'}${repeats ? ' · repeats' : ''} · ${STATE_LABEL[item.state]}`}
        title={meeting.title}
        detail={`${formatIsoDate(meeting.date, { withWeekday: true })} · ${formatClockTime(meeting.startTime, { lowercaseMeridiem: true })} – ${formatClockTime(meeting.endTime, { lowercaseMeridiem: true })}`}
      />
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {canReply && (
          <div className="mb-2">
            <div className="text-[11.5px] font-bold uppercase tracking-wide text-muted-foreground">Your reply</div>
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              {(
                [
                  ['Accepted', 'Accept', Check],
                  ['Maybe', 'Maybe', null],
                  ['Declined', 'Decline', X],
                ] as const
              ).map(([response, label, Icon]) => (
                <Button
                  key={response}
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  aria-pressed={myResponse === response}
                  onClick={() => onReply(response)}
                  className={cn(
                    'gap-1.5',
                    myResponse === response && 'ring-2 ring-primary',
                    response === 'Accepted' && myResponse === response && 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700 hover:text-white',
                    response === 'Declined' && 'text-rose-700',
                  )}
                >
                  {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden /> : null}
                  {label}
                </Button>
              ))}
            </div>
            {myResponse === 'No Response' && <p className="mt-1.5 text-[11.5px] text-amber-700">The organizer is waiting for your answer.</p>}
          </div>
        )}

        <Row icon={MapPin} title={placeOf(meeting)}>
          {meeting.mode === 'Offline' ? 'In person' : meeting.mode === 'Hybrid' ? 'In person, with a video link' : 'Online meeting'}
          {meeting.address ? ` · ${meeting.address}` : ''}
        </Row>
        <Row icon={Users} title={`${participantIds.length} ${participantIds.length === 1 ? 'person' : 'people'} · organised by ${meeting.organizerName}`}>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {shown.map((userId) => {
              const person = people.find((candidate) => candidate.userId === userId);
              return (
                <span key={userId} className="inline-flex max-w-full items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2 text-[11.5px] font-semibold text-foreground">
                  <Avatar seed={userId} name={person?.name ?? '?'} size={20} />
                  <span className="truncate">{person?.name ?? 'Former employee'}</span>
                </span>
              );
            })}
            {participantIds.length > shown.length && (
              <span className="self-center text-[11.5px] font-bold">+{participantIds.length - shown.length} more</span>
            )}
          </div>
        </Row>
        {repeats && <Row icon={Repeat} title={repeats} />}
        <Row icon={Bell} title={reminders ? `Reminders: ${reminders}` : 'Each person’s own reminders'} />
        <Row icon={FileText} title="Agenda & minutes">
          <span className="flex flex-wrap gap-x-3">
            <Link href={`${BASE}/meetings/${meeting.id}/prepare`} className="font-semibold text-primary hover:underline">
              Agenda
            </Link>
            <Link href={`${BASE}/meetings/${meeting.id}/mom`} className="font-semibold text-primary hover:underline">
              Minutes
            </Link>
          </span>
        </Row>
      </div>
      <div className="flex flex-wrap gap-2 border-t px-5 py-3.5">
        {joinUrl && item.state !== 'cancelled' && (
          <Button asChild size="sm" className="gap-1.5 bg-gradient-to-r from-primary to-indigo-600 text-white">
            <a href={joinUrl} target="_blank" rel="noopener noreferrer">
              <Video className="h-3.5 w-3.5" aria-hidden />
              Join
            </a>
          </Button>
        )}
        <Button asChild size="sm" variant="outline">
          <Link href={`${BASE}/meetings/${meeting.id}`}>Open meeting</Link>
        </Button>
        {canEdit && item.state !== 'cancelled' && (
          <Button asChild size="sm" variant="outline">
            <Link href={`${BASE}/meetings/${meeting.id}/edit`}>Edit or reschedule</Link>
          </Button>
        )}
      </div>
    </>
  );
}

function TaskBody({
  item,
  canComplete,
  busy,
  onComplete,
}: {
  item: Extract<CalendarItem, { kind: 'task' }>;
  canComplete: boolean;
  busy: boolean;
  onComplete: () => void;
}) {
  const task = item.task;
  return (
    <>
      <Header
        tone={item.state === 'done' ? 'muted' : 'amber'}
        eyebrow="Task deadline"
        title={task.title}
        detail={task.dueDate ? formatIsoDate(task.dueDate, { withWeekday: true }) : 'No due date'}
      />
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <Row icon={Clock} title={item.state === 'late' ? 'Overdue' : item.state === 'done' ? 'Completed' : 'Due this day'}>
          {task.status} · {task.priority} priority{task.progress ? ` · ${task.progress}% done` : ''}
        </Row>
        <Row icon={Users} title={task.assigneeName ? `Assigned to ${task.assigneeName}` : 'Not assigned to anyone'}>
          {task.reference}
        </Row>
        {task.meetingId && (
          <Row icon={FileText} title="From a meeting">
            <Link href={`${BASE}/meetings/${task.meetingId}`} className="font-semibold text-primary hover:underline">
              {task.meetingTitle ?? 'Open the meeting'}
            </Link>
          </Row>
        )}
      </div>
      <div className="flex flex-wrap gap-2 border-t px-5 py-3.5">
        {canComplete && item.state !== 'done' && (
          <Button size="sm" disabled={busy} onClick={onComplete} className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700">
            <CheckSquare className="h-3.5 w-3.5" aria-hidden />
            Mark done
          </Button>
        )}
        <Button asChild size="sm" variant="outline">
          <Link href={`${BASE}/tasks/${task.id}`}>Open task</Link>
        </Button>
      </div>
    </>
  );
}

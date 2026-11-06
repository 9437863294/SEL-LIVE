'use client';

/**
 * The meeting register's side drawer (2026-11-06, from the user's mockup): the meeting at a glance,
 * every participant's reply, where its minutes stand, and the rest of its series. The participant
 * rows are read when the drawer opens — one query — because the register itself only carries the
 * meeting's tally.
 */

import Link from 'next/link';
import { Bell, FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import {
  MINUTES_LABEL,
  OFFICE_HUB_BASE_PATH,
  describeRecurrence,
  formatClockTime,
  formatIsoDate,
  minutesState,
  responseLine,
  type OfficeHubMeeting,
} from '@/lib/office-hub';
import { listMeetingParticipants } from '@/lib/office-hub-service';
import { useOfficeHubQuery } from './hooks';
import { Avatar } from './meeting-form-parts';
import { placeOf } from './meeting-calendar';

const BASE = OFFICE_HUB_BASE_PATH;

const REPLY_CHIP: Record<string, string> = {
  Accepted: 'text-emerald-700 dark:text-emerald-300',
  Declined: 'text-rose-700 dark:text-rose-300',
  Maybe: 'text-sky-700 dark:text-sky-300',
  'No Response': 'text-amber-700 dark:text-amber-300',
};

export function RegisterDrawer({
  meeting,
  series,
  departmentNames,
  canEdit,
  canRemind,
  canClear,
  busy,
  onClose,
  onRemind,
  onClear,
}: {
  meeting: OfficeHubMeeting | null;
  /** Every occurrence of its series in the register, oldest first. */
  series: readonly OfficeHubMeeting[];
  departmentNames: string;
  canEdit: boolean;
  canRemind: boolean;
  canClear: boolean;
  busy: boolean;
  onClose: () => void;
  onRemind: () => void;
  onClear: () => void;
}) {
  const participants = useOfficeHubQuery(() => listMeetingParticipants(meeting?.id ?? ''), [meeting?.id], {
    enabled: Boolean(meeting),
    initial: [],
  });

  const cancelled = meeting?.status === 'Cancelled' || meeting?.status === 'Postponed';
  const minutes = meeting ? minutesState(meeting) : 'later';
  const tally = responseLine(meeting?.responseSummary);
  const repeats =
    meeting?.recurrence && meeting.recurrence.frequency !== 'None'
      ? describeRecurrence(meeting.recurrence, meeting.date)
      : meeting?.seriesId
        ? 'Part of a repeating series'
        : 'One-time';

  return (
    <Sheet open={Boolean(meeting)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[430px]">
        {meeting && (
          <>
            <div className={cn('keep-light px-5 pb-4 pt-5 pr-12 text-white', cancelled ? 'bg-gradient-to-br from-slate-500 to-slate-800' : 'bg-gradient-to-br from-primary to-indigo-900')}>
              <small className="text-[11px] font-bold uppercase tracking-[0.07em] opacity-85">
                {meeting.meetingType || 'Meeting'} · {meeting.status}
              </small>
              <SheetTitle className={cn('mt-1 text-[19px] font-bold leading-snug text-white', cancelled && 'line-through decoration-white/50')}>
                {meeting.title}
              </SheetTitle>
              <SheetDescription className="text-[12.5px] text-white/90">
                {formatIsoDate(meeting.date, { withWeekday: true })} · {formatClockTime(meeting.startTime, { lowercaseMeridiem: true })} –{' '}
                {formatClockTime(meeting.endTime, { lowercaseMeridiem: true })}
              </SheetDescription>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ['Mode', meeting.mode === 'Offline' ? 'In person' : meeting.mode],
                    ['Where', placeOf(meeting)],
                    ['Department', departmentNames || '—'],
                    ['Priority', meeting.priority],
                    ['Organiser', meeting.organizerName],
                    ['Repeats', repeats],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="min-w-0 rounded-[11px] bg-muted/60 px-2.5 py-1.5">
                    <small className="block text-[10.5px] font-bold text-muted-foreground">{label}</small>
                    <b className="block truncate text-[12.5px]" title={value}>
                      {value}
                    </b>
                  </div>
                ))}
              </div>

              <h4 className="mb-1.5 mt-4 text-[11px] font-extrabold uppercase tracking-[0.07em] text-muted-foreground">
                People · {cancelled ? 'cancelled' : tally.text}
              </h4>
              {participants.isLoading ? (
                <p className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  Loading replies…
                </p>
              ) : (
                <ul>
                  {(participants.data ?? []).map((participant) => (
                    <li key={participant.id} className="flex items-center gap-2.5 border-b py-1.5 text-[12.5px] last:border-b-0">
                      <Avatar seed={participant.userId} name={participant.name} size={26} />
                      <span className="min-w-0 flex-1 truncate font-semibold">
                        {participant.name}
                        {participant.userId === meeting.organizerId && <small className="font-medium text-muted-foreground"> · organiser</small>}
                        {participant.attendanceRole === 'Optional' && <small className="font-medium text-muted-foreground"> · optional</small>}
                      </span>
                      <b className={cn('shrink-0 text-[11.5px]', cancelled ? 'text-muted-foreground' : REPLY_CHIP[participant.response])}>
                        {cancelled ? '—' : participant.response === 'No Response' ? 'No reply' : participant.response}
                      </b>
                    </li>
                  ))}
                </ul>
              )}

              <h4 className="mb-1.5 mt-4 text-[11px] font-extrabold uppercase tracking-[0.07em] text-muted-foreground">Minutes</h4>
              <p className="text-[12.5px] text-muted-foreground">
                {minutes === 'not-needed'
                  ? 'Not needed — this meeting did not go ahead.'
                  : minutes === 'later'
                    ? 'Minutes can be written once the meeting starts.'
                    : minutes === 'due'
                      ? (
                          <>
                            <b className="text-rose-700 dark:text-rose-300">Minutes not written yet.</b> Record them while it is fresh.
                          </>
                        )
                      : `Minutes are at the ${MINUTES_LABEL[minutes].toLowerCase()} stage.`}
              </p>

              {series.length > 1 && (
                <>
                  <h4 className="mb-1.5 mt-4 text-[11px] font-extrabold uppercase tracking-[0.07em] text-muted-foreground">
                    This series · {series.length} in the register
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {series.map((occurrence) => {
                      const gone = occurrence.status === 'Cancelled' || occurrence.status === 'Postponed';
                      return (
                        <span
                          key={occurrence.id}
                          title={occurrence.status}
                          className={cn(
                            'rounded-[7px] px-2 py-0.5 text-[11px] font-bold',
                            occurrence.id === meeting.id ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
                            gone && 'line-through',
                          )}
                        >
                          {formatIsoDate(occurrence.date, { year: false })}
                        </span>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            <div className="flex flex-wrap gap-2 border-t px-5 py-3.5">
              {cancelled ? (
                <>
                  {canClear && (
                    <Button size="sm" variant="outline" disabled={busy} onClick={onClear} className="border-rose-200 text-rose-700">
                      Clear from register
                    </Button>
                  )}
                  <Button asChild size="sm" variant="outline">
                    <Link href={`${BASE}/meetings/${meeting.id}`}>Open meeting</Link>
                  </Button>
                </>
              ) : (
                <>
                  <Button asChild size="sm" className="gap-1.5 bg-gradient-to-r from-primary to-indigo-600 text-white">
                    <Link href={minutes === 'due' || (meeting.status === 'Completed' && minutes !== 'Published') ? `${BASE}/meetings/${meeting.id}/mom` : `${BASE}/meetings/${meeting.id}`}>
                      {meeting.status === 'Completed' && minutes !== 'Published' ? (
                        <>
                          <FileText className="h-3.5 w-3.5" aria-hidden />
                          Write minutes
                        </>
                      ) : (
                        'Open meeting'
                      )}
                    </Link>
                  </Button>
                  {canEdit && (
                    <Button asChild size="sm" variant="outline">
                      <Link href={`${BASE}/meetings/${meeting.id}/edit`}>Edit</Link>
                    </Button>
                  )}
                  {canRemind && (
                    <Button size="sm" variant="outline" disabled={busy} onClick={onRemind} className="gap-1.5">
                      <Bell className="h-3.5 w-3.5" aria-hidden />
                      Remind {meeting.responseSummary.noResponse}
                    </Button>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

'use client';

/**
 * "Who's free" and the room chips on the meeting form.
 *
 * The busy times come from `/api/office-hub/meetings/availability` — Office Hub meetings only, and
 * only *when*, never *what*. One request per day and time zone, kept for the life of the form, so
 * clicking back and forth along the week does not ask again.
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  busyMinutesOnDay,
  formatClockTime,
  isIsoDate,
  minuteToClock,
  roomKey,
  type MeetingAvailability,
  type MinuteSpan,
  type RoomAvailability,
} from '@/lib/office-hub';
import { fetchMeetingAvailability } from '@/lib/office-hub-availability-client';
import { Avatar } from './meeting-form-parts';

export interface AvailabilityState {
  data: MeetingAvailability | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

export function useMeetingAvailability(input: {
  date: string;
  timeZone: string;
  excludeMeetingId?: string | null;
  enabled?: boolean;
}): AvailabilityState {
  const { date, timeZone, excludeMeetingId = null, enabled = true } = input;
  const key = `${date}|${timeZone}`;
  const valid = enabled && isIsoDate(date) && Boolean(timeZone);
  const [results, setResults] = useState<Record<string, { data?: MeetingAvailability; error?: string }>>({});
  const entry = results[key];

  useEffect(() => {
    if (!valid || entry) return;
    let cancelled = false;
    fetchMeetingAvailability({ date, timeZone, excludeMeetingId, includeRooms: true })
      .then((data) => {
        if (!cancelled) setResults((current) => ({ ...current, [key]: { data } }));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : 'The server could not be reached.';
        setResults((current) => ({ ...current, [key]: { error: message } }));
      });
    return () => {
      cancelled = true;
    };
  }, [valid, entry, key, date, timeZone, excludeMeetingId]);

  const retry = useCallback(() => {
    setResults((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, [key]);

  return { data: entry?.data ?? null, loading: valid && !entry, error: entry?.error ?? null, retry };
}

const VISIBLE_ROWS = 8;

function hourLabel(minute: number): string {
  const hour = Math.floor(minute / 60) % 24;
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}${hour < 12 ? 'a' : 'p'}`;
}

/**
 * The day as one bar per person, busy times shaded, the chosen slot drawn across all of them.
 *
 * Clicking a bar moves the meeting there (keeping its length); the time fields stay the precise,
 * keyboard-friendly way to set it.
 */
export function AvailabilityTimeline({
  people,
  spansByUser,
  clashingIds,
  state,
  start,
  end,
  workStart,
  workEnd,
  freeSlot,
  viewerId,
  onMoveStart,
}: {
  people: readonly { userId: string; name: string }[];
  spansByUser: ReadonlyMap<string, MinuteSpan[]>;
  clashingIds: ReadonlySet<string>;
  state: AvailabilityState;
  /** The chosen slot, in minutes after midnight; null when the times are not valid yet. */
  start: number | null;
  end: number | null;
  workStart: number;
  workEnd: number;
  /** The first time everyone is free, when the chosen one is not. */
  freeSlot: number | null;
  viewerId: string | null;
  onMoveStart: (minute: number) => void;
}) {
  const slotValid = start != null && end != null && end > start;
  // The slot as plain numbers; only drawn or compared when `slotValid`.
  const slotStart = start ?? 0;
  const slotEnd = end ?? 0;
  let from = Math.floor(Math.min(workStart, slotValid ? slotStart : workStart) / 60) * 60;
  let to = Math.ceil(Math.max(workEnd, slotValid ? slotEnd : workEnd) / 60) * 60;
  if (to - from < 360) to = Math.min(1440, from + 360);
  from = Math.max(0, from);
  to = Math.min(1440, to);
  const range = to - from;
  const hourCount = range / 60;
  const labelEvery = hourCount > 12 ? 2 : 1;
  const percent = (minute: number) => ((minute - from) / range) * 100;

  // Clashes first, so the reason for the warning is on screen without scrolling the list.
  const ordered = [...people].sort((a, b) => Number(clashingIds.has(b.userId)) - Number(clashingIds.has(a.userId)));
  const visible = ordered.slice(0, VISIBLE_ROWS);
  const hidden = ordered.length - visible.length;
  const hiddenClashes = ordered.slice(VISIBLE_ROWS).filter((person) => clashingIds.has(person.userId)).length;
  const clashing = people.filter((person) => clashingIds.has(person.userId));

  const duration = slotValid ? slotEnd - slotStart : 60;
  const moveTo = (clientX: number, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    if (!rect.width) return;
    const minute = from + ((clientX - rect.left) / rect.width) * range;
    const snapped = Math.round((minute - duration / 2) / 15) * 15;
    onMoveStart(Math.max(0, Math.min(1440 - duration, snapped)));
  };

  const gridLines = {
    backgroundImage: `repeating-linear-gradient(90deg, hsl(var(--border)) 0 1px, transparent 1px ${100 / hourCount}%)`,
  };

  return (
    <div className="overflow-hidden rounded-2xl border">
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-2 text-xs font-bold">
        Who&rsquo;s free
        <span className="flex-1" />
        <small className="font-semibold text-muted-foreground">
          {formatClockTime(minuteToClock(from), { lowercaseMeridiem: true })} – {formatClockTime(minuteToClock(to === 1440 ? 1439 : to), { lowercaseMeridiem: true })} · shaded = in another meeting
        </small>
      </div>

      <div className="px-3 pb-2 pt-1">
        <div className="grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)] gap-x-2 sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)]">
          <div>
            <div className="h-5" />
            {visible.map((person) => (
              <div key={person.userId} className="flex h-7 min-w-0 items-center gap-1.5 text-xs font-semibold">
                <Avatar seed={person.userId} name={person.name} size={18} />
                <span className={cn('truncate', clashingIds.has(person.userId) && 'text-rose-700')}>
                  {person.name}
                  {person.userId === viewerId ? ' (you)' : ''}
                </span>
              </div>
            ))}
          </div>

          <div
            className="relative cursor-pointer"
            title="Click to move the meeting here"
            onClick={(event) => moveTo(event.clientX, event.currentTarget)}
          >
            <div className="relative h-5 text-[10px] font-bold text-muted-foreground">
              {Array.from({ length: hourCount }, (_, index) => from + index * 60)
                .filter((_, index) => index % labelEvery === 0)
                .map((minute) => (
                  <span key={minute} className="absolute top-1" style={{ left: `${percent(minute)}%` }}>
                    {hourLabel(minute)}
                  </span>
                ))}
            </div>
            {visible.map((person) => (
              <div key={person.userId} className="flex h-7 items-center">
                <div className="relative h-3.5 w-full overflow-hidden rounded bg-muted/60" style={gridLines}>
                  {(spansByUser.get(person.userId) ?? [])
                    .filter((span) => span.end > from && span.start < to)
                    .map((span, index) => {
                      const left = Math.max(0, percent(span.start));
                      const right = Math.min(100, percent(span.end));
                      const clash = slotValid && span.start < slotEnd && span.end > slotStart;
                      return (
                        <div
                          key={index}
                          className={cn('absolute inset-y-0 rounded', clash ? 'bg-rose-400' : 'bg-muted-foreground/35')}
                          style={{ left: `${left}%`, width: `${right - left}%` }}
                        />
                      );
                    })}
                </div>
              </div>
            ))}
            {slotValid && (
              <div
                aria-hidden
                className={cn(
                  'pointer-events-none absolute bottom-0 top-5 rounded-lg border-2 transition-all duration-200',
                  clashing.length ? 'border-rose-500 bg-rose-500/10' : 'border-primary bg-primary/10',
                )}
                style={{
                  left: `${Math.max(0, percent(slotStart))}%`,
                  width: `${Math.max(0.8, Math.min(100, percent(slotEnd)) - Math.max(0, percent(slotStart)))}%`,
                }}
              />
            )}
          </div>
        </div>
        {hidden > 0 && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            +{hidden} more not shown{hiddenClashes ? ` · ${hiddenClashes} of them busy then` : ''}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2 text-xs">
        {state.loading ? (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            Checking who&rsquo;s free…
          </span>
        ) : state.error ? (
          <>
            <span className="flex min-w-0 items-center gap-1.5 text-amber-800">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="min-w-0">Could not check who&rsquo;s free: {state.error}</span>
            </span>
            <button
              type="button"
              onClick={state.retry}
              className="ml-auto flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-bold hover:bg-muted"
            >
              <RefreshCw className="h-3 w-3" aria-hidden />
              Try again
            </button>
          </>
        ) : !slotValid ? (
          <span className="text-muted-foreground">Set an end time after the start to check clashes.</span>
        ) : clashing.length ? (
          <>
            <span className="rounded-full bg-rose-100 px-2 py-px text-[11px] font-bold text-rose-700">{clashing.length} busy</span>
            <span className="min-w-0">
              {clashing
                .slice(0, 3)
                .map((person) => person.name.split(/\s+/)[0])
                .join(', ')}
              {clashing.length > 3 ? ` and ${clashing.length - 3} more` : ''} {clashing.length > 1 ? 'have' : 'has'} another meeting then.
            </span>
            {freeSlot != null ? (
              <span className="flex items-center gap-1.5 sm:ml-auto">
                Everyone is free at
                <button
                  type="button"
                  onClick={() => onMoveStart(freeSlot)}
                  className="rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 font-bold text-primary hover:bg-primary/15"
                >
                  {formatClockTime(minuteToClock(freeSlot), { lowercaseMeridiem: true })}
                </button>
              </span>
            ) : (
              <span className="text-muted-foreground sm:ml-auto">No time in working hours that day suits everyone.</span>
            )}
          </>
        ) : (
          <>
            <span className="rounded-full bg-emerald-100 px-2 py-px text-[11px] font-bold text-emerald-700">Everyone free</span>
            <span className="text-muted-foreground">
              {people.length} {people.length === 1 ? 'person' : 'people'}, no clashes in Office Hub
            </span>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Rooms meetings have been held in, each marked free or booked for the chosen slot.
 *
 * Booked rooms stay clickable: the booking may be one that is about to move, and the organizer is
 * told rather than overruled. The warning also appears in "Before you send".
 */
export function RoomChips({
  rooms,
  date,
  timeZone,
  start,
  end,
  selectedRoom,
  selectedLocation,
  onPick,
}: {
  rooms: readonly RoomAvailability[];
  date: string;
  timeZone: string;
  start: number | null;
  end: number | null;
  selectedRoom: string;
  selectedLocation: string;
  onPick: (room: RoomAvailability) => void;
}) {
  if (!rooms.length) return null;
  const selectedKey = selectedRoom.trim() ? roomKey(selectedRoom, selectedLocation) : null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {rooms.slice(0, 12).map((room) => {
        const booking = roomBookingAt(room, date, timeZone, start, end);
        const selected = selectedKey === roomKey(room.room, room.location);
        return (
          <button
            key={roomKey(room.room, room.location)}
            type="button"
            aria-pressed={selected}
            onClick={() => onPick(room)}
            title={
              booking
                ? `Booked ${formatClockTime(minuteToClock(booking.start), { lowercaseMeridiem: true })} – ${formatClockTime(minuteToClock(booking.end), { lowercaseMeridiem: true })}`
                : 'Free at this time'
            }
            className={cn(
              'flex max-w-full items-center gap-1.5 rounded-[10px] border px-2.5 py-1 text-xs font-bold transition-colors',
              selected ? 'border-primary/50 bg-primary/10 text-primary' : 'bg-card text-muted-foreground hover:text-foreground',
            )}
          >
            <span aria-hidden className={cn('h-[7px] w-[7px] shrink-0 rounded-full', booking ? 'bg-rose-500' : 'bg-emerald-500')} />
            <span className="truncate">
              {room.room}
              {room.location ? <span className="font-medium opacity-70"> · {room.location}</span> : null}
            </span>
            {booking && <span className="shrink-0 font-semibold text-rose-600">booked</span>}
          </button>
        );
      })}
    </div>
  );
}

/** The booking that overlaps the chosen slot, if any. */
export function roomBookingAt(
  room: RoomAvailability,
  date: string,
  timeZone: string,
  start: number | null,
  end: number | null,
): MinuteSpan | null {
  if (start == null || end == null || end <= start) return null;
  return busyMinutesOnDay(room.busy, date, timeZone).find((span) => span.start < end && span.end > start) ?? null;
}

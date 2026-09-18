'use client';

/**
 * The calendar route (§8).
 *
 * Owns the window, the filters and the reschedule; `MeetingCalendar` owns the grid. Two things
 * worth knowing:
 *
 *   • **The window is the view's period plus a margin**, not a fixed range, so switching from month
 *     to day does not refetch and paging forward a week usually does not either.
 *   • **A drag-reschedule goes through `updateMeeting`**, the same path the form uses. So the
 *     participants are notified, the reminder rows are rebuilt against the new instant, and the
 *     audit trail records it as a reschedule with the before and after — none of which a direct
 *     field write would do.
 */

import { useCallback, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CalendarPlus, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  OFFICE_HUB_BASE_PATH,
  addDays,
  endOfMonth,
  startOfMonth,
  startOfWeek,
  type CalendarView,
  type OfficeHubMeeting,
} from '@/lib/office-hub';
import { listMeetings, listMyTasks, listTasks, updateMeeting } from '@/lib/office-hub-service';
import { useOfficeHub, useOfficeHubAction, useOfficeHubQuery } from '@/components/office-hub/hooks';
import {
  OfficeHubAccessDenied,
  OfficeHubPageHeader,
  useTickingNow,
} from '@/components/office-hub/ui';
import {
  MeetingCalendar,
  buildCalendarEntries,
} from '@/components/office-hub/meeting-calendar';

type Scope = 'mine' | 'organized' | 'team' | 'department' | 'all';

export default function CalendarPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const now = useTickingNow(60_000);
  const { actor, viewer, capabilities, settings, userSettings, today, isLoading } = useOfficeHub();
  const { run } = useOfficeHubAction();

  const [view, setView] = useState<CalendarView>(
    (searchParams?.get('view') as CalendarView) ?? userSettings?.defaultCalendarView ?? 'month',
  );
  const [anchorDate, setAnchorDate] = useState(searchParams?.get('date') ?? today);
  const [scope, setScope] = useState<Scope>('mine');
  const [showMeetings, setShowMeetings] = useState(true);
  const [showTasks, setShowTasks] = useState(true);
  const [showHolidays, setShowHolidays] = useState(true);

  /**
   * The fetch window: the widest period any view could show from this anchor, plus a margin.
   *
   * Deliberately generous — a month's grid already spans up to six weeks, and paging one step in
   * either direction is the commonest interaction. Fetching exactly the visible period would mean a
   * read on every arrow press.
   */
  const window = useMemo(() => {
    const from = addDays(startOfWeek(startOfMonth(anchorDate)), -7);
    const to = addDays(endOfMonth(anchorDate), 21);
    return { from, to };
  }, [anchorDate]);

  const availableScopes = useMemo(() => {
    const scopes: { value: Scope; label: string }[] = [
      { value: 'mine', label: 'My meetings' },
      { value: 'organized', label: 'Organized by me' },
    ];
    if (capabilities.canViewTeamMeetings && (viewer.teamIds?.length ?? 0) > 0) {
      scopes.push({ value: 'team', label: 'My teams' });
    }
    if (capabilities.canViewDepartmentMeetings && viewer.departmentId) {
      scopes.push({ value: 'department', label: 'My department' });
    }
    if (capabilities.canViewAllMeetings) scopes.push({ value: 'all', label: 'All meetings' });
    return scopes;
  }, [capabilities, viewer.teamIds, viewer.departmentId]);

  const effectiveScope: Scope = availableScopes.some((entry) => entry.value === scope) ? scope : 'mine';

  const meetingsQuery = useOfficeHubQuery(
    () => listMeetings(effectiveScope, viewer, { fromDate: window.from, toDate: window.to, limit: 400 }),
    [effectiveScope, viewer.userId, viewer.departmentId, window.from, window.to],
    { enabled: Boolean(actor) && capabilities.canViewCalendar, initial: [] },
  );

  const tasksQuery = useOfficeHubQuery(
    () =>
      effectiveScope === 'all' && capabilities.canViewAllTasks
        ? listTasks('all', viewer, { limit: 400 })
        : listMyTasks(viewer.userId, { limit: 400 }),
    [effectiveScope, viewer.userId, capabilities.canViewAllTasks],
    { enabled: Boolean(actor) && capabilities.canViewTasks && showTasks, initial: [] },
  );

  const entries = useMemo(
    () =>
      buildCalendarEntries({
        meetings: meetingsQuery.data ?? [],
        tasks: tasksQuery.data ?? [],
        settings,
        from: window.from,
        to: window.to,
        today,
        showMeetings,
        showTasks,
        showHolidays,
        canReschedule: capabilities.canRescheduleFromCalendar,
        now,
      }),
    [
      meetingsQuery.data,
      tasksQuery.data,
      settings,
      window.from,
      window.to,
      today,
      showMeetings,
      showTasks,
      showHolidays,
      capabilities.canRescheduleFromCalendar,
      now,
    ],
  );

  const reschedule = useCallback(
    async (meeting: OfficeHubMeeting, toDate: string) => {
      if (!actor) return;
      const ok = await run(
        () =>
          updateMeeting(
            actor,
            meeting.id,
            { date: toDate },
            {
              settings,
              reason: 'Rescheduled from the calendar',
              // A single occurrence, always. Dragging one chip cannot reasonably be read as
              // "move every meeting in this series", and §11 refuses to let the two be confused.
              scope: 'occurrence',
            },
          ),
        {
          success: `"${meeting.title}" moved — participants notified`,
          failure: 'Could not reschedule the meeting',
          describe: 'Reschedule meeting',
        },
      );
      if (ok) meetingsQuery.reload();
    },
    [actor, run, settings, meetingsQuery],
  );

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-[32rem] w-full rounded-xl" />
      </div>
    );
  }

  if (!capabilities.canViewCalendar) return <OfficeHubAccessDenied what="the calendar" />;

  return (
    <div className="space-y-3">
      <OfficeHubPageHeader
        title="Calendar"
        description={`Meetings, task deadlines and holidays. Times in ${viewer.timeZone ?? settings.defaultTimeZone}.`}
        actions={
          capabilities.canCreateMeeting ? (
            <Button asChild className="gap-2">
              <Link href={`${OFFICE_HUB_BASE_PATH}/meetings/new?date=${anchorDate}`}>
                <CalendarPlus className="h-4 w-4" />
                Schedule meeting
              </Link>
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardContent className="flex flex-col gap-3 p-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:w-96">
            <div>
              <Label className="mb-1 block text-xs">Show</Label>
              <Select value={effectiveScope} onValueChange={(next) => setScope(next as Scope)}>
                <SelectTrigger className="bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableScopes.map((entry) => (
                    <SelectItem key={entry.value} value={entry.value}>
                      {entry.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="mb-1 block text-xs">Jump to</Label>
              <input
                type="date"
                value={anchorDate}
                onChange={(event) => event.target.value && setAnchorDate(event.target.value)}
                className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
                aria-label="Jump to date"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <label className="flex cursor-pointer items-center gap-1.5 text-xs">
              <Checkbox checked={showMeetings} onCheckedChange={(value) => setShowMeetings(value === true)} />
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-indigo-400" />
                Meetings
              </span>
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs">
              <Checkbox checked={showTasks} onCheckedChange={(value) => setShowTasks(value === true)} />
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-amber-400" />
                Task deadlines
              </span>
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs">
              <Checkbox checked={showHolidays} onCheckedChange={(value) => setShowHolidays(value === true)} />
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-violet-400" />
                Holidays
              </span>
            </label>
            {(settings.holidays?.length ?? 0) === 0 && showHolidays && capabilities.canEditSettings && (
              <Button size="sm" variant="ghost" asChild className="h-6 gap-1 px-1.5 text-[11px]">
                <Link href={`${OFFICE_HUB_BASE_PATH}/settings`}>
                  <Filter className="h-3 w-3" />
                  Add holidays
                </Link>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {meetingsQuery.isLoading ? (
        <Skeleton className="h-[32rem] w-full rounded-xl" />
      ) : (
        <MeetingCalendar
          view={view}
          anchorDate={anchorDate}
          entries={entries}
          settings={settings}
          today={today}
          onNavigate={setAnchorDate}
          onViewChange={(next) => {
            setView(next);
            // Reflected in the URL so a particular view can be linked to and survives a refresh.
            const params = new URLSearchParams(searchParams?.toString() ?? '');
            params.set('view', next);
            router.replace(`${OFFICE_HUB_BASE_PATH}/calendar?${params.toString()}`, { scroll: false });
          }}
          onReschedule={capabilities.canRescheduleFromCalendar ? reschedule : undefined}
          onPickSlot={
            capabilities.canCreateMeeting
              ? (date, time) =>
                  router.push(
                    `${OFFICE_HUB_BASE_PATH}/meetings/new?date=${date}${time ? `&time=${time}` : ''}`,
                  )
              : undefined
          }
        />
      )}

      <p className="text-[11px] text-muted-foreground">
        Click a date or an hour to schedule something in that slot.
      </p>
    </div>
  );
}

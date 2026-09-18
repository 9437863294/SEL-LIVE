'use client';

/**
 * Settings (§35's per-user preferences, §75's system settings).
 *
 * Two audiences on one route, as two tabs:
 *
 *   • **My preferences** — everybody. Time zone, default reminders, and the notification switches
 *     §35 lists. No permission needed: these are the user's own choices about their own inbox.
 *   • **Office settings** — `Settings.Edit` only. Working days, default durations, the meeting-type
 *     list, upload limits, holidays, and whether minutes need approval.
 *
 * ── Two behaviours worth knowing ────────────────────────────────────────────────────────────────
 *
 *  1. **An office switch can withdraw a channel but never force one on.** Turning email off
 *     office-wide silences it for everybody; turning it on does not override a user who asked not
 *     to be emailed. That rule lives in `effectivePreferences`, and the copy here says so.
 *  2. **Browser permission is never requested on load.** A prompt nobody asked for is the fastest
 *     way to get it denied permanently, and a denial cannot be undone from the page — so it is
 *     behind an explicit button, and denial leaves the in-app bell as the only channel, which §34
 *     says is correct.
 */

import { useEffect, useMemo, useState } from 'react';
import { Bell, BellOff, Building2, Calendar, Loader2, Plus, Save, Trash2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  DEFAULT_REMINDER_CHOICES,
  OFFICE_HUB_ALLOWED_UPLOAD_EXTENSIONS,
  OFFICE_HUB_WEEKDAYS,
  effectivePreferences,
  formatIsoDate,
  isIsoDate,
  isKnownTimeZone,
  type OfficeHubNotificationPreferences,
  type OfficeHubSettings,
} from '@/lib/office-hub';
import { saveOfficeHubSettings, saveOfficeHubUserSettings } from '@/lib/office-hub-service';
import {
  useBrowserNotifications,
  useOfficeHub,
  useOfficeHubAction,
} from '@/components/office-hub/hooks';
import {
  OfficeHubEmptyState,
  OfficeHubLoader,
  OfficeHubPageHeader,
  OfficeHubSection,
} from '@/components/office-hub/ui';
import { DateField, TimeField } from '@/components/office-hub/selectors';
import { GoogleMeetPanel } from '@/components/office-hub/google-meet-panel';

/** The switches §35 lists, in its order, with the sentence each one governs. */
const NOTIFICATION_ROWS: {
  key: keyof OfficeHubNotificationPreferences;
  label: string;
  hint: string;
}[] = [
  { key: 'meetingInvitations', label: 'Meeting invitations', hint: 'When somebody invites you to a meeting.' },
  { key: 'meetingReminders', label: 'Meeting reminders', hint: 'Before a meeting starts, at the offsets below.' },
  { key: 'meetingChanges', label: 'Meeting changes', hint: 'When a meeting you are in is moved or cancelled.' },
  { key: 'participantResponses', label: 'Participant responses', hint: 'When somebody answers a meeting you organised.' },
  { key: 'taskAssignments', label: 'Task assignments', hint: 'When a task is assigned or reassigned to you.' },
  { key: 'taskDueReminders', label: 'Task due reminders', hint: 'Before a task you own falls due.' },
  { key: 'overdueAlerts', label: 'Overdue alerts', hint: 'Once a day while something of yours is late.' },
  { key: 'comments', label: 'Comments', hint: 'When somebody comments on a task you are following.' },
  { key: 'mentions', label: 'Mentions', hint: 'When somebody writes @your-name.' },
  { key: 'teamNotifications', label: 'Team notifications', hint: 'Being added to or removed from a team.' },
  { key: 'decisionUpdates', label: 'Decision updates', hint: 'Decisions assigned to you, and their due dates.' },
];

export default function OfficeHubSettingsPage() {
  const { actor, capabilities, settings, userSettings, today, isLoading, refreshUserSettings } = useOfficeHub();
  const { isBusy, run } = useOfficeHubAction();
  const browser = useBrowserNotifications();

  /* ── my preferences ─────────────────────────────────────────────────────────────────────────── */

  const [timeZone, setTimeZone] = useState(userSettings?.timeZone ?? settings.defaultTimeZone);
  const [myReminders, setMyReminders] = useState<number[]>(userSettings?.defaultReminderOffsets ?? []);
  const [prefs, setPrefs] = useState<Partial<OfficeHubNotificationPreferences>>(userSettings?.notifications ?? {});

  useEffect(() => {
    setTimeZone(userSettings?.timeZone ?? settings.defaultTimeZone);
    setMyReminders(userSettings?.defaultReminderOffsets ?? []);
    setPrefs(userSettings?.notifications ?? {});
  }, [userSettings, settings.defaultTimeZone]);

  const effective = useMemo(() => effectivePreferences({ notifications: prefs }, settings), [prefs, settings]);

  const savePreferences = async () => {
    if (!actor) return;
    const ok = await run(
      () =>
        saveOfficeHubUserSettings(actor, {
          timeZone: isKnownTimeZone(timeZone) ? timeZone : settings.defaultTimeZone,
          defaultReminderOffsets: myReminders,
          notifications: prefs,
        }),
      { success: 'Your preferences were saved', failure: 'Could not save your preferences' },
    );
    if (ok !== null) await refreshUserSettings();
  };

  /* ── office settings ────────────────────────────────────────────────────────────────────────── */

  const [office, setOffice] = useState<OfficeHubSettings>(settings);
  const [newType, setNewType] = useState('');
  const [holidayDate, setHolidayDate] = useState<string | null>(null);
  const [holidayName, setHolidayName] = useState('');

  useEffect(() => setOffice(settings), [settings]);

  const saveOffice = async () => {
    if (!actor) return;
    await run(
      () =>
        saveOfficeHubSettings(actor, {
          organizationName: office.organizationName.trim() || 'Office Hub',
          defaultTimeZone: isKnownTimeZone(office.defaultTimeZone)
            ? office.defaultTimeZone
            : settings.defaultTimeZone,
          workingDays: office.workingDays.length ? office.workingDays : settings.workingDays,
          workingHoursStart: office.workingHoursStart,
          workingHoursEnd: office.workingHoursEnd,
          defaultMeetingDurationMinutes: Math.max(5, Math.min(480, office.defaultMeetingDurationMinutes)),
          defaultReminderOffsets: office.defaultReminderOffsets,
          meetingTypes: office.meetingTypes.length ? office.meetingTypes : settings.meetingTypes,
          maxUploadMb: Math.max(1, Math.min(200, office.maxUploadMb)),
          allowedUploadExtensions: office.allowedUploadExtensions,
          momApprovalRequired: office.momApprovalRequired,
          emailNotificationsEnabled: office.emailNotificationsEnabled,
          browserNotificationsEnabled: office.browserNotificationsEnabled,
          taskDueReminderDaysBefore: office.taskDueReminderDaysBefore,
          holidays: office.holidays ?? [],
          googleMeetEnabled: office.googleMeetEnabled !== false,
          googleSendUpdates: office.googleSendUpdates ?? 'all',
          // `primary` rather than an empty string: a blank calendar id would make every Calendar
          // call 404 on a path Google reads as "no calendar", which is a confusing way to fail.
          googleCalendarId: office.googleCalendarId?.trim() || 'primary',
        }),
      { success: 'Office settings saved', failure: 'Could not save the office settings' },
    );
  };

  if (isLoading) return <OfficeHubLoader label="Loading settings" />;

  return (
    <div className="space-y-3">
      <OfficeHubPageHeader
        title="Settings"
        description="Your own notification preferences, and — if you administer the module — the office-wide defaults."
      />

      <Tabs defaultValue="mine">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="mine" className="gap-1.5 text-xs">
            <Bell className="h-3.5 w-3.5" />
            My preferences
          </TabsTrigger>
          {capabilities.canViewSettings && (
            <TabsTrigger value="office" className="gap-1.5 text-xs">
              <Building2 className="h-3.5 w-3.5" />
              Office settings
            </TabsTrigger>
          )}
        </TabsList>

        {/* ── my preferences ───────────────────────────────────────────────────────────────────── */}
        <TabsContent value="mine" className="mt-3 space-y-3">
          <OfficeHubSection
            title="Time zone"
            description="Meeting times are shown in this zone, and your task reminders arrive in its morning."
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label className="mb-1 block text-xs">My time zone</Label>
                <Select value={timeZone} onValueChange={setTimeZone}>
                  <SelectTrigger className="bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from(
                      new Set([
                        settings.defaultTimeZone,
                        'Asia/Kolkata',
                        'Asia/Dubai',
                        'Asia/Singapore',
                        'Europe/London',
                        'Europe/Berlin',
                        'America/New_York',
                        'America/Los_Angeles',
                        'Australia/Sydney',
                        'UTC',
                        timeZone,
                      ]),
                    ).map((zone) => (
                      <SelectItem key={zone} value={zone}>
                        {zone}
                        {zone === settings.defaultTimeZone ? ' (office default)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  A meeting scheduled in another zone shows a note with your local time on its own
                  page.
                </p>
              </div>
            </div>
          </OfficeHubSection>

          <OfficeHubSection
            title="My default meeting reminders"
            description="Used for any meeting whose organizer has not set their own reminders."
          >
            <div className="flex flex-wrap gap-1.5">
              {DEFAULT_REMINDER_CHOICES.map((choice) => {
                const active = myReminders.includes(choice.minutes);
                return (
                  <Button
                    key={choice.minutes}
                    type="button"
                    size="sm"
                    variant={active ? 'default' : 'outline'}
                    aria-pressed={active}
                    className={cn('h-8 text-xs', !active && 'bg-white')}
                    onClick={() =>
                      setMyReminders((current) =>
                        current.includes(choice.minutes)
                          ? current.filter((entry) => entry !== choice.minutes)
                          : [...current, choice.minutes],
                      )
                    }
                  >
                    {choice.label}
                  </Button>
                );
              })}
            </div>
            {myReminders.length === 0 && (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Nothing selected — the office default applies (
                {settings.defaultReminderOffsets.join(', ')} minutes before).
              </p>
            )}
          </OfficeHubSection>

          <OfficeHubSection title="What I am notified about" description="Every switch governs one kind of alert.">
            <ul className="divide-y rounded-lg border bg-white">
              {NOTIFICATION_ROWS.map((row) => {
                const value = prefs[row.key] ?? DEFAULT_NOTIFICATION_PREFERENCES[row.key];
                return (
                  <li key={row.key} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800">{row.label}</p>
                      <p className="text-[11px] text-muted-foreground">{row.hint}</p>
                    </div>
                    <Switch
                      checked={Boolean(value)}
                      onCheckedChange={(next) => setPrefs((current) => ({ ...current, [row.key]: next }))}
                      aria-label={row.label}
                    />
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Some alerts have no switch on purpose — a cancelled meeting you are in, and published
              minutes, always reach you. A switch that can hide &ldquo;your meeting was cancelled&rdquo;
              is a switch that makes people turn up to meetings that are not happening.
            </p>
          </OfficeHubSection>

          <OfficeHubSection title="Channels" description="Where those alerts arrive.">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 rounded-lg border bg-white px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800">In-app notifications</p>
                  <p className="text-[11px] text-muted-foreground">
                    The bell in the header. Always on — it is the record of what you were told.
                  </p>
                </div>
                <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[11px] text-emerald-700">
                  Always on
                </Badge>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-lg border bg-white px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800">Email</p>
                  <p className="text-[11px] text-muted-foreground">
                    {settings.emailNotificationsEnabled
                      ? 'Configured for this office.'
                      : 'Turned off office-wide, so nothing is emailed regardless of this switch.'}
                  </p>
                </div>
                <Switch
                  checked={effective.email}
                  disabled={!settings.emailNotificationsEnabled}
                  onCheckedChange={(next) => setPrefs((current) => ({ ...current, email: next }))}
                  aria-label="Email notifications"
                />
              </div>

              <div className="flex items-center justify-between gap-3 rounded-lg border bg-white px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800">Browser notifications</p>
                  <p className="text-[11px] text-muted-foreground">
                    {browser.permission === 'unsupported'
                      ? 'This browser does not support them.'
                      : browser.permission === 'denied'
                        ? 'Blocked in your browser settings — the in-app bell still works.'
                        : browser.permission === 'granted'
                          ? 'Allowed by your browser.'
                          : 'Your browser has not been asked yet.'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {browser.permission === 'default' && (
                    <Button size="sm" variant="outline" onClick={() => void browser.request()} className="gap-1.5">
                      <Bell className="h-3.5 w-3.5" />
                      Allow
                    </Button>
                  )}
                  {browser.permission === 'denied' && <BellOff className="h-4 w-4 text-muted-foreground" />}
                  <Switch
                    checked={effective.browser}
                    disabled={browser.permission !== 'granted' || !settings.browserNotificationsEnabled}
                    onCheckedChange={(next) => setPrefs((current) => ({ ...current, browser: next }))}
                    aria-label="Browser notifications"
                  />
                </div>
              </div>
            </div>
          </OfficeHubSection>

          {/*
            Outside the save bar below, deliberately. Connecting Google is a redirect to Google and
            back, not a value in this form — putting it above a "Save my preferences" button would
            imply the connection is pending until saved, and lose the form's other edits to the
            navigation.
          */}
          <GoogleMeetPanel showAdministratorDetail={capabilities.canViewSettings} />

          <div className="sticky bottom-0 -mx-1 flex items-center gap-2 border-t bg-white/95 px-1 py-3 backdrop-blur">
            <Button onClick={() => void savePreferences()} disabled={isBusy} className="gap-2">
              {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save my preferences
            </Button>
          </div>
        </TabsContent>

        {/* ── office settings ──────────────────────────────────────────────────────────────────── */}
        {capabilities.canViewSettings && (
          <TabsContent value="office" className="mt-3 space-y-3">
            {!capabilities.canEditSettings && (
              <Card className="border-slate-200 bg-slate-50">
                <CardContent className="px-4 py-3">
                  <p className="text-sm text-slate-700">
                    You can see these settings but not change them. Ask an administrator for
                    <span className="font-medium"> Office Hub → Settings → Edit</span>.
                  </p>
                </CardContent>
              </Card>
            )}

            <OfficeHubSection title="Organization" description="Shown on printed minutes.">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label className="mb-1 block text-xs">Organization name</Label>
                  <Input
                    value={office.organizationName}
                    disabled={!capabilities.canEditSettings}
                    onChange={(event) => setOffice({ ...office, organizationName: event.target.value })}
                    className="bg-white"
                  />
                </div>
                <div>
                  <Label className="mb-1 block text-xs">Default time zone</Label>
                  <Select
                    value={office.defaultTimeZone}
                    disabled={!capabilities.canEditSettings}
                    onValueChange={(next) => setOffice({ ...office, defaultTimeZone: next })}
                  >
                    <SelectTrigger className="bg-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'UTC', office.defaultTimeZone]
                        .filter((zone, index, list) => list.indexOf(zone) === index)
                        .map((zone) => (
                          <SelectItem key={zone} value={zone}>
                            {zone}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </OfficeHubSection>

            <OfficeHubSection
              title="Working week"
              description="Shades the calendar and sets the default slot a new meeting opens on."
            >
              <div className="space-y-3">
                <div>
                  <Label className="mb-1 block text-xs">Working days</Label>
                  <div className="flex flex-wrap gap-1">
                    {OFFICE_HUB_WEEKDAYS.map((weekday) => {
                      const active = office.workingDays.includes(weekday.index);
                      return (
                        <Button
                          key={weekday.index}
                          type="button"
                          size="sm"
                          variant={active ? 'default' : 'outline'}
                          disabled={!capabilities.canEditSettings}
                          aria-pressed={active}
                          className={cn('h-8 w-12 px-0 text-xs', !active && 'bg-white')}
                          onClick={() =>
                            setOffice({
                              ...office,
                              workingDays: active
                                ? office.workingDays.filter((day) => day !== weekday.index)
                                : [...office.workingDays, weekday.index].sort(),
                            })
                          }
                        >
                          {weekday.short}
                        </Button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <TimeField
                    label="Working hours start"
                    value={office.workingHoursStart}
                    disabled={!capabilities.canEditSettings}
                    onChange={(next) => setOffice({ ...office, workingHoursStart: next })}
                  />
                  <TimeField
                    label="Working hours end"
                    value={office.workingHoursEnd}
                    disabled={!capabilities.canEditSettings}
                    onChange={(next) => setOffice({ ...office, workingHoursEnd: next })}
                  />
                  <div>
                    <Label className="mb-1 block text-xs">Default meeting duration (minutes)</Label>
                    <Input
                      type="number"
                      min={5}
                      max={480}
                      value={office.defaultMeetingDurationMinutes}
                      disabled={!capabilities.canEditSettings}
                      onChange={(event) =>
                        setOffice({ ...office, defaultMeetingDurationMinutes: Number(event.target.value) || 60 })
                      }
                      className="bg-white"
                    />
                  </div>
                </div>
              </div>
            </OfficeHubSection>

            <OfficeHubSection
              title="Meeting types"
              description="The dropdown on the meeting form. Removing one does not change meetings already using it."
            >
              <div className="mb-2 flex flex-wrap gap-1.5">
                {office.meetingTypes.map((type) => (
                  <Badge key={type} variant="outline" className="gap-1 border-slate-200 bg-white py-1 text-xs">
                    {type}
                    {capabilities.canEditSettings && office.meetingTypes.length > 1 && (
                      <button
                        type="button"
                        aria-label={`Remove ${type}`}
                        onClick={() =>
                          setOffice({ ...office, meetingTypes: office.meetingTypes.filter((entry) => entry !== type) })
                        }
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </Badge>
                ))}
              </div>
              {capabilities.canEditSettings && (
                <div className="flex max-w-sm gap-2">
                  <Input
                    value={newType}
                    onChange={(event) => setNewType(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter') return;
                      event.preventDefault();
                      const value = newType.trim();
                      if (!value || office.meetingTypes.includes(value)) return;
                      setOffice({ ...office, meetingTypes: [...office.meetingTypes, value] });
                      setNewType('');
                    }}
                    placeholder="e.g. Safety Review"
                    className="bg-white"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="shrink-0 gap-1.5"
                    onClick={() => {
                      const value = newType.trim();
                      if (!value || office.meetingTypes.includes(value)) return;
                      setOffice({ ...office, meetingTypes: [...office.meetingTypes, value] });
                      setNewType('');
                    }}
                  >
                    <Plus className="h-4 w-4" />
                    Add
                  </Button>
                </div>
              )}
            </OfficeHubSection>

            <OfficeHubSection title="Reminders and minutes" description="Defaults, and whether minutes need approving.">
              <div className="space-y-3">
                <div>
                  <Label className="mb-1 block text-xs">Default meeting reminders</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {DEFAULT_REMINDER_CHOICES.map((choice) => {
                      const active = office.defaultReminderOffsets.includes(choice.minutes);
                      return (
                        <Button
                          key={choice.minutes}
                          type="button"
                          size="sm"
                          variant={active ? 'default' : 'outline'}
                          disabled={!capabilities.canEditSettings}
                          aria-pressed={active}
                          className={cn('h-8 text-xs', !active && 'bg-white')}
                          onClick={() =>
                            setOffice({
                              ...office,
                              defaultReminderOffsets: active
                                ? office.defaultReminderOffsets.filter((entry) => entry !== choice.minutes)
                                : [...office.defaultReminderOffsets, choice.minutes],
                            })
                          }
                        >
                          {choice.label}
                        </Button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <Label className="mb-1 block text-xs">Task due reminders (days before)</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {[7, 3, 2, 1].map((days) => {
                      const active = office.taskDueReminderDaysBefore.includes(days);
                      return (
                        <Button
                          key={days}
                          type="button"
                          size="sm"
                          variant={active ? 'default' : 'outline'}
                          disabled={!capabilities.canEditSettings}
                          aria-pressed={active}
                          className={cn('h-8 text-xs', !active && 'bg-white')}
                          onClick={() =>
                            setOffice({
                              ...office,
                              taskDueReminderDaysBefore: active
                                ? office.taskDueReminderDaysBefore.filter((entry) => entry !== days)
                                : [...office.taskDueReminderDaysBefore, days],
                            })
                          }
                        >
                          {days} day{days === 1 ? '' : 's'}
                        </Button>
                      );
                    })}
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    A reminder on the due date itself is always sent.
                  </p>
                </div>

                <div className="flex items-center justify-between gap-3 rounded-lg border bg-white px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800">Minutes need approval before publishing</p>
                    <p className="text-[11px] text-muted-foreground">
                      With this on, minutes climb Draft → Prepared → Reviewed → Approved → Published,
                      and the person who prepared them cannot also approve them. With it off,
                      preparation goes straight to publication.
                    </p>
                  </div>
                  <Switch
                    checked={office.momApprovalRequired}
                    disabled={!capabilities.canEditSettings}
                    onCheckedChange={(next) => setOffice({ ...office, momApprovalRequired: next })}
                    aria-label="Minutes need approval"
                  />
                </div>
              </div>
            </OfficeHubSection>

            <OfficeHubSection title="Notification channels" description="Office-wide. These can only withdraw a channel.">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3 rounded-lg border bg-white px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800">Email notifications</p>
                    <p className="text-[11px] text-muted-foreground">
                      Turning this off stops all email regardless of individual preferences. Turning
                      it on does not override a user who has asked not to be emailed.
                    </p>
                  </div>
                  <Switch
                    checked={office.emailNotificationsEnabled}
                    disabled={!capabilities.canEditSettings}
                    onCheckedChange={(next) => setOffice({ ...office, emailNotificationsEnabled: next })}
                    aria-label="Email notifications office-wide"
                  />
                </div>
                <div className="flex items-center justify-between gap-3 rounded-lg border bg-white px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800">Browser notifications</p>
                    <p className="text-[11px] text-muted-foreground">
                      Whether users may opt in. Each still has to grant permission in their own
                      browser.
                    </p>
                  </div>
                  <Switch
                    checked={office.browserNotificationsEnabled}
                    disabled={!capabilities.canEditSettings}
                    onCheckedChange={(next) => setOffice({ ...office, browserNotificationsEnabled: next })}
                    aria-label="Browser notifications office-wide"
                  />
                </div>
              </div>
            </OfficeHubSection>

            <OfficeHubSection
              title="Google Meet"
              description="Office-wide behaviour for the Meet links and calendar events Office Hub creates."
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3 rounded-lg border bg-white px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800">Create Meet links</p>
                    <p className="text-[11px] text-muted-foreground">
                      Off makes every online meeting ask for a joining link to paste, as it did
                      before this integration. The escape hatch if Google is misbehaving — existing
                      links keep working.
                    </p>
                  </div>
                  <Switch
                    checked={office.googleMeetEnabled !== false}
                    disabled={!capabilities.canEditSettings}
                    onCheckedChange={(next) => setOffice({ ...office, googleMeetEnabled: next })}
                    aria-label="Create Google Meet links"
                  />
                </div>

                <div className="rounded-lg border bg-white px-3 py-2.5">
                  <Label className="mb-1 block text-xs">Google’s own invitation emails</Label>
                  <Select
                    value={office.googleSendUpdates ?? 'all'}
                    disabled={!capabilities.canEditSettings || office.googleMeetEnabled === false}
                    onValueChange={(next) =>
                      setOffice({ ...office, googleSendUpdates: next as OfficeHubSettings['googleSendUpdates'] })
                    }
                  >
                    <SelectTrigger className="bg-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Email everyone — two invitations per meeting</SelectItem>
                      <SelectItem value="externalOnly">Email external guests only</SelectItem>
                      <SelectItem value="none">Do not email — calendar entry only</SelectItem>
                    </SelectContent>
                  </Select>
                  {/*
                    The trade-off stated where the choice is made. Neither option is wrong, and the
                    wrong one for a given office produces either duplicate mail or a missing
                    invitation for someone who lives in Google Calendar.
                  */}
                  <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                    {office.googleSendUpdates === 'none'
                      ? 'The meeting still appears on participants’ Google Calendars; Office Hub sends the only invitation. The quieter arrangement.'
                      : 'Participants receive Google’s invitation as well as Office Hub’s. Note that Office Hub never reads the RSVPs given in Google Calendar — only its own.'}
                  </p>
                </div>

                <div className="rounded-lg border bg-white px-3 py-2.5">
                  <Label className="mb-1 block text-xs">Calendar to write to</Label>
                  <Input
                    value={office.googleCalendarId ?? 'primary'}
                    disabled={!capabilities.canEditSettings || office.googleMeetEnabled === false}
                    onChange={(event) => setOffice({ ...office, googleCalendarId: event.target.value })}
                    placeholder="primary"
                    className="bg-white font-mono text-xs"
                  />
                  <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                    <span className="font-mono">primary</span> is each organizer’s own calendar,
                    which is almost always what you want. A shared calendar’s id works too, but
                    every organizer’s Google account must have permission to write to it — and one
                    who does not will see their Meet link fail.
                  </p>
                </div>
              </div>
            </OfficeHubSection>

            <OfficeHubSection title="File uploads" description="Enforced here and again in the Storage rules.">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label className="mb-1 block text-xs">Maximum file size (MB)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={200}
                    value={office.maxUploadMb}
                    disabled={!capabilities.canEditSettings}
                    onChange={(event) => setOffice({ ...office, maxUploadMb: Number(event.target.value) || 25 })}
                    className="bg-white"
                  />
                </div>
                <div>
                  <Label className="mb-1 block text-xs">Allowed file types</Label>
                  <div className="flex flex-wrap gap-1">
                    {OFFICE_HUB_ALLOWED_UPLOAD_EXTENSIONS.map((extension) => {
                      const active = office.allowedUploadExtensions.includes(extension);
                      return (
                        <Button
                          key={extension}
                          type="button"
                          size="sm"
                          variant={active ? 'default' : 'outline'}
                          disabled={!capabilities.canEditSettings}
                          aria-pressed={active}
                          className={cn('h-7 px-2 text-[11px]', !active && 'bg-white')}
                          onClick={() =>
                            setOffice({
                              ...office,
                              allowedUploadExtensions: active
                                ? office.allowedUploadExtensions.filter((entry) => entry !== extension)
                                : [...office.allowedUploadExtensions, extension],
                            })
                          }
                        >
                          .{extension}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </OfficeHubSection>

            <OfficeHubSection
              title="Holidays"
              description="Shown on the calendar and excluded from working days."
            >
              {(office.holidays?.length ?? 0) === 0 ? (
                <OfficeHubEmptyState
                  icon={Calendar}
                  title="No holidays configured."
                  description="Add the office's non-working days so the calendar shades them."
                />
              ) : (
                <ul className="mb-2 divide-y rounded-lg border bg-white">
                  {[...(office.holidays ?? [])]
                    .sort((a, b) => a.date.localeCompare(b.date))
                    .map((holiday) => (
                      <li key={holiday.date} className="flex items-center justify-between gap-2 px-3 py-2">
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-slate-800">{holiday.name}</span>
                          <span className="block text-[11px] text-muted-foreground">
                            {formatIsoDate(holiday.date, { withWeekday: true })}
                            {holiday.date < today ? ' · past' : ''}
                          </span>
                        </span>
                        {capabilities.canEditSettings && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive"
                            aria-label={`Remove ${holiday.name}`}
                            onClick={() =>
                              setOffice({
                                ...office,
                                holidays: (office.holidays ?? []).filter((entry) => entry.date !== holiday.date),
                              })
                            }
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </li>
                    ))}
                </ul>
              )}

              {capabilities.canEditSettings && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[10rem_minmax(0,1fr)_auto]">
                  <DateField value={holidayDate} onChange={setHolidayDate} label="Date" />
                  <div>
                    <Label className="mb-1 block text-xs">Name</Label>
                    <Input
                      value={holidayName}
                      onChange={(event) => setHolidayName(event.target.value)}
                      placeholder="e.g. Gandhi Jayanti"
                      className="bg-white"
                    />
                  </div>
                  <div className="flex items-end">
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full gap-1.5 sm:w-auto"
                      disabled={!holidayDate || !isIsoDate(holidayDate) || !holidayName.trim()}
                      onClick={() => {
                        if (!holidayDate || !isIsoDate(holidayDate) || !holidayName.trim()) return;
                        // Keyed by date, so adding the same day twice replaces rather than duplicates.
                        const others = (office.holidays ?? []).filter((entry) => entry.date !== holidayDate);
                        setOffice({
                          ...office,
                          holidays: [...others, { date: holidayDate, name: holidayName.trim() }],
                        });
                        setHolidayDate(null);
                        setHolidayName('');
                      }}
                    >
                      <Plus className="h-4 w-4" />
                      Add holiday
                    </Button>
                  </div>
                </div>
              )}
            </OfficeHubSection>

            {capabilities.canEditSettings && (
              <div className="sticky bottom-0 -mx-1 flex items-center gap-2 border-t bg-white/95 px-1 py-3 backdrop-blur">
                <Button onClick={() => void saveOffice()} disabled={isBusy} className="gap-2">
                  {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save office settings
                </Button>
                <Button variant="ghost" onClick={() => setOffice(settings)} disabled={isBusy}>
                  Discard changes
                </Button>
              </div>
            )}
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

'use client';

/**
 * The meeting form (§9, §10, §11, §12).
 *
 * One component for create and edit, because the two differ in what they *do* with the values, not
 * in what the values are — and two forms would drift on validation within a release.
 *
 * ── Three things the form does that are worth pointing at ───────────────────────────────────────
 *
 *  1. **Values survive a failed submit** (§79). Everything lives in one `draft` state object, and
 *     validation only ever sets `errors`. Nothing resets, nothing reloads: the user fixes the one
 *     field that was wrong and submits again.
 *
 *  2. **Validation is the same function the service trusts.** `validateMeetingInput` is pure and
 *     unit-tested, and it is called here on submit and on blur. There is no second, looser copy of
 *     the rules living in the component — which is how "end before start" gets through in the
 *     version of this screen that validates inline.
 *
 *  3. **The mode drives which fields are required, and says so.** An online meeting asks for a link
 *     and refuses one pasted from the wrong platform; an offline one asks for a room. Hybrid asks
 *     for both, because that is what hybrid means.
 */

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CalendarPlus, Loader2, Save, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  MEETING_MODES,
  NO_RECURRENCE,
  OFFICE_HUB_BASE_PATH,
  OFFICE_HUB_PRIORITIES,
  ONLINE_MEETING_PLATFORMS,
  endTimeFromDuration,
  firstFieldError,
  getMeetingProvider,
  hasFieldErrors,
  isKnownTimeZone,
  validateMeetingInput,
  type MeetingMode,
  type MeetingRecurrence,
  type OfficeHubFieldErrors,
  type OfficeHubMeeting,
  type OfficeHubPriority,
  type OnlineMeetingPlatform,
  type ParticipantSelection,
} from '@/lib/office-hub';
import { createMeeting, sendMeetingInvitations, updateMeeting } from '@/lib/office-hub-service';
import { useOfficeHub, useOfficeHubAction } from './hooks';
import { ParticipantSelector, DateField, ProjectSelector, TimeField, UserSelector } from './selectors';
import { RecurrenceEditor, ReminderEditor } from './recurrence-editor';
import { FieldError, OfficeHubSection } from './ui';

export interface MeetingDraft {
  title: string;
  meetingType: string;
  description: string;
  priority: OfficeHubPriority;
  date: string;
  startTime: string;
  endTime: string;
  timeZone: string;
  mode: MeetingMode;
  onlinePlatform: OnlineMeetingPlatform | null;
  meetingUrl: string;
  meetingPasscode: string;
  location: string;
  room: string;
  address: string;
  organizerId: string;
  organizerName: string;
  selection: ParticipantSelection;
  reminderOffsets: number[];
  recurrence: MeetingRecurrence;
  projectId: string | null;
  projectName: string | null;
}

/** Zones offered in the picker. Short on purpose — a 400-entry list is not a choice, it is a search. */
const COMMON_TIME_ZONES = [
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Los_Angeles',
  'Australia/Sydney',
  'UTC',
];

export function emptyMeetingDraft(input: {
  today: string;
  defaultStartTime?: string;
  durationMinutes: number;
  timeZone: string;
  organizerId: string;
  organizerName: string;
  reminderOffsets: number[];
  meetingType?: string;
}): MeetingDraft {
  const startTime = input.defaultStartTime || '10:00';
  return {
    title: '',
    meetingType: input.meetingType || '',
    description: '',
    priority: 'Medium',
    date: input.today,
    startTime,
    endTime: endTimeFromDuration(startTime, input.durationMinutes),
    timeZone: input.timeZone,
    mode: 'Offline',
    onlinePlatform: null,
    meetingUrl: '',
    meetingPasscode: '',
    location: '',
    room: '',
    address: '',
    organizerId: input.organizerId,
    organizerName: input.organizerName,
    // The organizer is always a participant; the selector enforces it and shows it ticked.
    selection: { userIds: [input.organizerId], teamIds: [], departmentIds: [], optionalUserIds: [], optionalTeamIds: [], optionalDepartmentIds: [] },
    reminderOffsets: input.reminderOffsets,
    recurrence: { ...NO_RECURRENCE },
    projectId: null,
    projectName: null,
  };
}

export function draftFromMeeting(meeting: OfficeHubMeeting, selection: ParticipantSelection): MeetingDraft {
  return {
    title: meeting.title,
    meetingType: meeting.meetingType,
    description: meeting.description ?? '',
    priority: meeting.priority,
    date: meeting.date,
    startTime: meeting.startTime,
    endTime: meeting.endTime,
    timeZone: meeting.timeZone,
    mode: meeting.mode,
    onlinePlatform: meeting.onlinePlatform ?? null,
    meetingUrl: meeting.meetingUrl ?? '',
    meetingPasscode: meeting.meetingPasscode ?? '',
    location: meeting.location ?? '',
    room: meeting.room ?? '',
    address: meeting.address ?? '',
    organizerId: meeting.organizerId,
    organizerName: meeting.organizerName,
    selection,
    reminderOffsets: [...(meeting.reminderOffsets ?? [])],
    recurrence: meeting.recurrence ?? { ...NO_RECURRENCE },
    projectId: meeting.projectId ?? null,
    projectName: meeting.projectName ?? null,
  };
}

export function MeetingForm({
  initial,
  mode,
  meetingId,
  agendaItems,
  carryActionItemIds,
  followUpOf,
  templateId,
  isSeriesMember,
}: {
  initial: MeetingDraft;
  mode: 'create' | 'edit';
  meetingId?: string;
  agendaItems?: { title: string; description?: string | null; expectedOutcome?: string | null; estimatedMinutes?: number | null; priority?: OfficeHubPriority }[];
  carryActionItemIds?: string[];
  followUpOf?: { id: string; title: string } | null;
  templateId?: string | null;
  isSeriesMember?: boolean;
}) {
  const router = useRouter();
  const { actor, capabilities, settings, directory, today } = useOfficeHub();
  const { toast } = useToast();
  const { isBusy, run } = useOfficeHubAction();

  const [draft, setDraft] = useState<MeetingDraft>(initial);
  const [errors, setErrors] = useState<OfficeHubFieldErrors>({});
  const [seriesScope, setSeriesScope] = useState<'occurrence' | 'series'>('occurrence');

  const set = useCallback(<K extends keyof MeetingDraft>(key: K, value: MeetingDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    // Clearing the field's own error as it is edited: leaving it visible while the user fixes it
    // reads as "still wrong".
    setErrors((current) => {
      if (!current[key as string]) return current;
      const next = { ...current };
      delete next[key as string];
      return next;
    });
  }, []);

  const validate = useCallback(
    (status: 'Draft' | 'Scheduled'): OfficeHubFieldErrors => {
      const found = validateMeetingInput(
        {
          ...draft,
          status,
          participantUserIds: draft.selection.userIds,
        },
        {
          settings,
          // An edit of an existing meeting must not be refused because the meeting is today and its
          // slot has passed — that is exactly when somebody needs to correct the room.
          allowPast: mode === 'edit',
        },
      );

      // The platform-specific link check the model cannot make: it needs the provider registry.
      if (!found.meetingUrl && (draft.mode === 'Online' || draft.mode === 'Hybrid') && draft.meetingUrl.trim()) {
        const provider = getMeetingProvider(draft.onlinePlatform);
        const verdict = provider.validateUrl(draft.meetingUrl);
        if (!verdict.ok && verdict.reason) found.meetingUrl = verdict.reason;
      }

      if (draft.timeZone && !isKnownTimeZone(draft.timeZone)) {
        found.timeZone = 'That is not a time zone this browser recognises.';
      }

      return found;
    },
    [draft, settings, mode],
  );

  const submit = async (status: 'Draft' | 'Scheduled') => {
    const found = validate(status);
    setErrors(found);
    if (hasFieldErrors(found)) {
      // A toast as well as the inline errors: this form is long enough that the offending field is
      // often off-screen when the user presses the button, and a submit that appears to do nothing
      // is the worst of the available failures.
      toast({
        variant: 'destructive',
        title: 'Check the highlighted fields',
        description: firstFieldError(found) ?? 'Some required information is missing.',
      });
      return;
    }
    if (!actor) return;

    if (mode === 'create') {
      const result = await run(
        () =>
          createMeeting(
            actor,
            {
              ...draft,
              description: draft.description || null,
              meetingUrl: draft.meetingUrl || null,
              meetingPasscode: draft.meetingPasscode || null,
              location: draft.location || null,
              room: draft.room || null,
              address: draft.address || null,
              status,
              agendaItems,
              carryActionItemIds,
              followUpOfMeetingId: followUpOf?.id ?? null,
              followUpOfMeetingTitle: followUpOf?.title ?? null,
              templateId: templateId ?? null,
            },
            { settings, directory },
          ),
        {
          success: status === 'Draft' ? 'Draft saved' : 'Meeting scheduled and invitations sent',
          failure: 'Could not create the meeting',
          describe: 'Create meeting',
        },
      );
      if (result) router.push(`${OFFICE_HUB_BASE_PATH}/meetings/${result.meetingId}`);
      return;
    }

    if (!meetingId) return;
    const result = await run(
      () =>
        updateMeeting(
          actor,
          meetingId,
          {
            ...draft,
            description: draft.description || null,
            meetingUrl: draft.meetingUrl || null,
            meetingPasscode: draft.meetingPasscode || null,
            location: draft.location || null,
            room: draft.room || null,
            address: draft.address || null,
          },
          { settings, directory, scope: isSeriesMember ? seriesScope : 'occurrence' },
        ),
      {
        success: 'Meeting updated',
        failure: 'Could not save your changes',
        describe: 'Update meeting',
      },
    );
    if (result) router.push(`${OFFICE_HUB_BASE_PATH}/meetings/${meetingId}`);
  };

  const sendNow = async () => {
    if (!meetingId || !actor) return;
    const sent = await run(() => sendMeetingInvitations(actor, meetingId, { settings }), {
      success: 'Invitations sent',
      failure: 'Could not send the invitations',
      describe: 'Send invitations',
    });
    if (sent != null) router.push(`${OFFICE_HUB_BASE_PATH}/meetings/${meetingId}`);
  };

  const durationMinutes = useMemo(() => {
    const [startHour, startMinute] = draft.startTime.split(':').map(Number);
    const [endHour, endMinute] = draft.endTime.split(':').map(Number);
    const span = (endHour * 60 + endMinute) - (startHour * 60 + startMinute);
    return span > 0 ? span : span + 1440;
  }, [draft.startTime, draft.endTime]);

  const meetingTypes = settings.meetingTypes;
  const summaryError = firstFieldError(errors);

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit('Scheduled');
      }}
    >
      <OfficeHubSection title="Basic information" description="What the meeting is and when it happens.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label className="mb-1 block text-xs">
              Meeting title<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Input
              value={draft.title}
              onChange={(event) => set('title', event.target.value)}
              onBlur={() => setErrors((current) => ({ ...current, ...pick(validate('Scheduled'), ['title']) }))}
              placeholder="e.g. Monthly Finance Review"
              className={cn('bg-white', errors.title && 'border-destructive')}
              aria-invalid={Boolean(errors.title)}
              autoFocus
            />
            <FieldError message={errors.title} />
          </div>

          <div>
            <Label className="mb-1 block text-xs">
              Meeting type<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Select value={draft.meetingType} onValueChange={(next) => set('meetingType', next)}>
              <SelectTrigger className={cn('bg-white', errors.meetingType && 'border-destructive')}>
                <SelectValue placeholder="Choose a type" />
              </SelectTrigger>
              <SelectContent>
                {meetingTypes.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError message={errors.meetingType} />
          </div>

          <div>
            <Label className="mb-1 block text-xs">Priority</Label>
            <Select value={draft.priority} onValueChange={(next) => set('priority', next as OfficeHubPriority)}>
              <SelectTrigger className="bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OFFICE_HUB_PRIORITIES.map((priority) => (
                  <SelectItem key={priority} value={priority}>
                    {priority}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="sm:col-span-2">
            <Label className="mb-1 block text-xs">Description</Label>
            <Textarea
              value={draft.description}
              onChange={(event) => set('description', event.target.value)}
              placeholder="What is this meeting for? Anything participants should read beforehand."
              rows={3}
              className="bg-white"
            />
          </div>

          <DateField
            label="Date"
            required
            value={draft.date}
            min={mode === 'create' ? today : undefined}
            onChange={(next) => set('date', next ?? draft.date)}
            error={errors.date}
          />

          <div>
            <Label className="mb-1 block text-xs">Time zone</Label>
            <Select value={draft.timeZone} onValueChange={(next) => set('timeZone', next)}>
              <SelectTrigger className={cn('bg-white', errors.timeZone && 'border-destructive')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from(new Set([settings.defaultTimeZone, ...COMMON_TIME_ZONES, draft.timeZone])).map((zone) => (
                  <SelectItem key={zone} value={zone}>
                    {zone}
                    {zone === settings.defaultTimeZone ? ' (office)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError message={errors.timeZone} />
          </div>

          <TimeField
            label="Start time"
            required
            value={draft.startTime}
            onChange={(next) => {
              // Moving the start keeps the duration the user had chosen, rather than leaving an end
              // time that is now before it.
              setDraft((current) => ({
                ...current,
                startTime: next,
                endTime: next ? endTimeFromDuration(next, durationMinutes) : current.endTime,
              }));
              setErrors((current) => ({ ...current, startTime: '', endTime: '' }));
            }}
            error={errors.startTime}
          />

          <div>
            <TimeField
              label="End time"
              required
              value={draft.endTime}
              onChange={(next) => set('endTime', next)}
              error={errors.endTime}
            />
            <div className="mt-1 flex flex-wrap gap-1">
              {[15, 30, 45, 60, 90, 120].map((minutes) => (
                <Button
                  key={minutes}
                  type="button"
                  size="sm"
                  variant="ghost"
                  className={cn('h-6 px-1.5 text-[11px]', durationMinutes === minutes && 'bg-indigo-50 text-indigo-700')}
                  onClick={() => set('endTime', endTimeFromDuration(draft.startTime, minutes))}
                >
                  {minutes < 60 ? `${minutes}m` : `${minutes / 60}h`}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </OfficeHubSection>

      <OfficeHubSection title="Where" description="Online, in person, or both.">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {MEETING_MODES.map((meetingMode) => (
              <Button
                key={meetingMode}
                type="button"
                size="sm"
                variant={draft.mode === meetingMode ? 'default' : 'outline'}
                aria-pressed={draft.mode === meetingMode}
                className={cn('text-xs', draft.mode !== meetingMode && 'bg-white')}
                onClick={() => set('mode', meetingMode)}
              >
                {meetingMode}
              </Button>
            ))}
          </div>

          {(draft.mode === 'Online' || draft.mode === 'Hybrid') && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label className="mb-1 block text-xs">
                  Platform<span className="ml-0.5 text-destructive">*</span>
                </Label>
                <Select
                  value={draft.onlinePlatform ?? ''}
                  onValueChange={(next) => set('onlinePlatform', next as OnlineMeetingPlatform)}
                >
                  <SelectTrigger className={cn('bg-white', errors.onlinePlatform && 'border-destructive')}>
                    <SelectValue placeholder="Choose a platform" />
                  </SelectTrigger>
                  <SelectContent>
                    {ONLINE_MEETING_PLATFORMS.map((platform) => (
                      <SelectItem key={platform} value={platform}>
                        {platform}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError message={errors.onlinePlatform} />
              </div>

              <div>
                <Label className="mb-1 block text-xs">Passcode</Label>
                <Input
                  value={draft.meetingPasscode}
                  onChange={(event) => set('meetingPasscode', event.target.value)}
                  placeholder="Optional"
                  className="bg-white"
                />
              </div>

              <div className="sm:col-span-2">
                <Label className="mb-1 block text-xs">
                  Joining link<span className="ml-0.5 text-destructive">*</span>
                </Label>
                <Input
                  value={draft.meetingUrl}
                  onChange={(event) => set('meetingUrl', event.target.value)}
                  onBlur={() => setErrors((current) => ({ ...current, ...pick(validate('Scheduled'), ['meetingUrl']) }))}
                  placeholder="https://teams.microsoft.com/l/meetup-join/…"
                  className={cn('bg-white', errors.meetingUrl && 'border-destructive')}
                  aria-invalid={Boolean(errors.meetingUrl)}
                  inputMode="url"
                />
                <FieldError message={errors.meetingUrl} />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Only invited participants can see this link.
                </p>
              </div>
            </div>
          )}

          {(draft.mode === 'Offline' || draft.mode === 'Hybrid') && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label className="mb-1 block text-xs">
                  Location<span className="ml-0.5 text-destructive">*</span>
                </Label>
                <Input
                  value={draft.location}
                  onChange={(event) => set('location', event.target.value)}
                  placeholder="e.g. Head Office"
                  className={cn('bg-white', errors.location && 'border-destructive')}
                  aria-invalid={Boolean(errors.location)}
                />
                <FieldError message={errors.location} />
              </div>
              <div>
                <Label className="mb-1 block text-xs">Room</Label>
                <Input
                  value={draft.room}
                  onChange={(event) => set('room', event.target.value)}
                  placeholder="e.g. Board Room, 3rd floor"
                  className="bg-white"
                />
              </div>
              <div className="sm:col-span-2">
                <Label className="mb-1 block text-xs">Address</Label>
                <Textarea
                  value={draft.address}
                  onChange={(event) => set('address', event.target.value)}
                  placeholder="Only needed when participants are travelling to an unfamiliar site."
                  rows={2}
                  className="bg-white"
                />
              </div>
            </div>
          )}
        </div>
      </OfficeHubSection>

      <OfficeHubSection
        title="Organizer"
        description={
          capabilities.canChangeOrganizer
            ? 'You are the organizer unless you name somebody else.'
            : 'You are the organizer of this meeting.'
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {capabilities.canChangeOrganizer ? (
            <UserSelector
              label="Organizer"
              value={draft.organizerId}
              allowClear={false}
              error={errors.organizerId}
              onChange={(userId, person) => {
                if (!userId || !person) return;
                setDraft((current) => ({
                  ...current,
                  organizerId: userId,
                  organizerName: person.name,
                  // The new organizer must be a participant too.
                  selection: {
                    ...current.selection,
                    userIds: Array.from(new Set([...current.selection.userIds, userId])),
                  },
                }));
              }}
            />
          ) : (
            <div>
              <Label className="mb-1 block text-xs">Organizer</Label>
              <Input value={draft.organizerName} readOnly disabled className="bg-slate-50" />
            </div>
          )}

          <ProjectSelector
            label="Related project"
            value={draft.projectId}
            onChange={(projectId, name) =>
              setDraft((current) => ({ ...current, projectId, projectName: name }))
            }
          />
        </div>
      </OfficeHubSection>

      <OfficeHubSection
        title="Participants"
        description="Pick people, whole teams, whole departments — or any mix. Duplicates are removed automatically."
      >
        <ParticipantSelector
          selection={draft.selection}
          organizerId={draft.organizerId}
          error={errors.participants}
          onChange={(next) => {
            setDraft((current) => ({ ...current, selection: next }));
            setErrors((current) => {
              if (!current.participants) return current;
              const copy = { ...current };
              delete copy.participants;
              return copy;
            });
          }}
        />
      </OfficeHubSection>

      <OfficeHubSection title="Reminders" description="When participants are reminded about this meeting.">
        <ReminderEditor
          value={draft.reminderOffsets}
          onChange={(next) => set('reminderOffsets', next)}
          defaults={settings.defaultReminderOffsets}
        />
      </OfficeHubSection>

      <OfficeHubSection title="Repeats" description="For a recurring meeting, set the pattern here.">
        <RecurrenceEditor
          value={draft.recurrence}
          startDate={draft.date}
          onChange={(next) => set('recurrence', next)}
        />
      </OfficeHubSection>

      {mode === 'edit' && isSeriesMember && (
        <Card className="border-amber-200 bg-amber-50/70">
          <CardContent className="space-y-2 px-4 py-3">
            <p className="text-sm font-semibold text-amber-900">This meeting is part of a series</p>
            <div className="flex flex-wrap gap-1.5">
              <Button
                type="button"
                size="sm"
                variant={seriesScope === 'occurrence' ? 'default' : 'outline'}
                className={cn('text-xs', seriesScope !== 'occurrence' && 'bg-white')}
                onClick={() => setSeriesScope('occurrence')}
              >
                Only this occurrence
              </Button>
              <Button
                type="button"
                size="sm"
                variant={seriesScope === 'series' ? 'default' : 'outline'}
                className={cn('text-xs', seriesScope !== 'series' && 'bg-white')}
                onClick={() => setSeriesScope('series')}
              >
                This and all future occurrences
              </Button>
            </div>
            <p className="text-[11px] text-amber-900/80">
              {seriesScope === 'occurrence'
                ? 'Only the meeting on this date changes. The rest of the series is untouched.'
                : 'Every future meeting in the series is updated. Past meetings are left as they happened.'}
            </p>
          </CardContent>
        </Card>
      )}

      {summaryError && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="px-4 py-3">
            <p className="text-sm font-medium text-destructive">{summaryError}</p>
            <p className="text-xs text-destructive/80">
              Nothing has been saved. Fix the highlighted fields and try again.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center gap-2 border-t bg-white/95 px-1 py-3 backdrop-blur">
        <Button type="submit" disabled={isBusy} className="gap-2">
          {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === 'create' ? <Send className="h-4 w-4" /> : <Save className="h-4 w-4" />}
          {mode === 'create' ? 'Schedule & send invitations' : 'Save changes'}
        </Button>

        {mode === 'create' && (
          <Button type="button" variant="outline" disabled={isBusy} onClick={() => void submit('Draft')} className="gap-2">
            <CalendarPlus className="h-4 w-4" />
            Save as draft
          </Button>
        )}

        {mode === 'edit' && meetingId && (
          <Button type="button" variant="outline" disabled={isBusy} onClick={() => void sendNow()} className="gap-2">
            <Send className="h-4 w-4" />
            Send invitations now
          </Button>
        )}

        <Button type="button" variant="ghost" asChild disabled={isBusy}>
          <Link href={meetingId ? `${OFFICE_HUB_BASE_PATH}/meetings/${meetingId}` : `${OFFICE_HUB_BASE_PATH}/meetings`}>
            Cancel
          </Link>
        </Button>
      </div>
    </form>
  );
}

/** The named subset of an error map, for a blur handler that should only touch its own field. */
function pick(errors: OfficeHubFieldErrors, keys: readonly string[]): OfficeHubFieldErrors {
  const output: OfficeHubFieldErrors = {};
  for (const key of keys) output[key] = errors[key] ?? '';
  return output;
}

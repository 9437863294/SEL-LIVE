'use client';

/**
 * The meeting form (§9, §10, §11, §12). Redesigned 2026-11-06 from the user's mockup: a hero band
 * with the title and type, cards for When / Who / Where / Agenda / Invitation, and beside them a live
 * invitation preview and a "Before you send" checklist.
 *
 * One component for create and edit, because the two differ in what they *do* with the values, not
 * in what the values are — and two forms would drift on validation within a release.
 *
 * ── Things the form does that are worth pointing at ─────────────────────────────────────────────
 *
 *  1. **Values survive a failed submit** (§79). Everything lives in one `draft` state object, and
 *     validation only ever sets `errors`. Nothing resets, nothing reloads: the user fixes the one
 *     field that was wrong and submits again — and the page scrolls to it.
 *
 *  2. **Validation is the same function the service trusts.** `validateMeetingInput` is pure and
 *     unit-tested, and it is called here on submit and on blur. There is no second, looser copy of
 *     the rules living in the component.
 *
 *  3. **The mode drives which fields are required, and says so.** An online meeting asks for a link
 *     unless Google will create one; an offline one asks for a place. Hybrid asks for both.
 *
 *  4. **"Who's free" is real.** Busy times come from every Office Hub meeting that day through a
 *     server route (`useMeetingAvailability`), not from the meetings this viewer happens to be
 *     allowed to read — which would show most people as free and be confidently wrong.
 */

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  BellOff,
  Briefcase,
  CalendarPlus,
  CheckCircle2,
  Clock,
  Globe,
  LayoutTemplate,
  ListChecks,
  Loader2,
  Lock,
  Mail,
  MapPin,
  MonitorSmartphone,
  Bell,
  Paperclip,
  Save,
  Send,
  Users,
  Video,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/components/auth/AuthProvider';
import { cn } from '@/lib/utils';
import {
  DEFAULT_REMINDER_CHOICES,
  NO_RECURRENCE,
  OFFICE_HUB_BASE_PATH,
  OFFICE_HUB_PRIORITIES,
  SELECTABLE_MEETING_PLATFORMS,
  busyMinutesOnDay,
  clockToMinutes,
  endTimeFromDuration,
  expandParticipantSelection,
  findFreeSlot,
  firstFieldError,
  formatClockTime,
  formatDuration,
  formatIsoDate,
  getMeetingProvider,
  googleSyncSummary,
  hasFieldErrors,
  isKnownTimeZone,
  meetingSendUpdates,
  minuteToClock,
  roomKey,
  spansOverlap,
  utcToZonedParts,
  validateMeetingInput,
  type MeetingJoinAccess,
  type MeetingMode,
  type MeetingRecurrence,
  type MinuteSpan,
  type OfficeHubFieldErrors,
  type OfficeHubMeeting,
  type OfficeHubPriority,
  type OnlineMeetingPlatform,
  type ParticipantSelection,
} from '@/lib/office-hub';
import { createMeeting, listAgendaTemplates, sendMeetingInvitations, updateMeeting } from '@/lib/office-hub-service';
import { canCreateMeetLinks } from '@/lib/office-hub-google-client';
import { useGoogleMeetStatus, useOfficeHub, useOfficeHubAction, useOfficeHubQuery } from './hooks';
import { ProjectSelector, UserSelector } from './selectors';
import { RecurrenceEditor } from './recurrence-editor';
import { FieldError, useTickingNow } from './ui';
import {
  ChoiceCards,
  DayStrip,
  DurationChips,
  FieldLabel,
  FormCard,
  InvitationPreview,
  MeetingHero,
  ModeCards,
  PreflightChecklist,
  ReminderChips,
  type InvitationPreviewRow,
  type PreflightCheck,
} from './meeting-form-parts';
import { AvailabilityTimeline, RoomChips, roomBookingAt, useMeetingAvailability } from './meeting-availability';
import { ParticipantPicker } from './participant-picker';

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
  /** Null until the organizer answers — scheduling is refused until they do. */
  emailInvitations: boolean | null;
  /** Null until answered; only asked for an online or hybrid meeting. */
  joinAccess: MeetingJoinAccess | null;
}

type AgendaDraftItem = {
  title: string;
  description?: string | null;
  expectedOutcome?: string | null;
  estimatedMinutes?: number | null;
  priority?: OfficeHubPriority;
};

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

/** Where each field's error is on the page, in page order — a failed submit scrolls to the first. */
const ERROR_TARGETS: [string, string][] = [
  ['title', 'oh-title'],
  ['meetingType', 'oh-types'],
  ['date', 'oh-when'],
  ['startTime', 'oh-start'],
  ['endTime', 'oh-end'],
  ['timeZone', 'oh-when'],
  ['participants', 'oh-who-picker'],
  ['organizerId', 'oh-who'],
  ['location', 'oh-location'],
  ['onlinePlatform', 'oh-where'],
  ['meetingUrl', 'oh-meeting-url'],
  ['joinAccess', 'oh-join'],
  ['emailInvitations', 'oh-email'],
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
    // The organizer is always a participant; the picker shows them and will not remove them.
    selection: { userIds: [input.organizerId], teamIds: [], departmentIds: [], optionalUserIds: [], optionalTeamIds: [], optionalDepartmentIds: [] },
    reminderOffsets: input.reminderOffsets,
    recurrence: { ...NO_RECURRENCE },
    projectId: null,
    projectName: null,
    // Deliberately unanswered: whether to email and who may join are asked every time, never
    // defaulted, so nobody emails forty people or opens a meeting to everyone by not looking.
    emailInvitations: null,
    joinAccess: null,
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
    emailInvitations: meeting.emailInvitations ?? null,
    joinAccess: meeting.joinAccess ?? null,
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
  eyebrow,
  subtitle,
  backHref,
  intro,
}: {
  initial: MeetingDraft;
  mode: 'create' | 'edit';
  meetingId?: string;
  agendaItems?: AgendaDraftItem[];
  carryActionItemIds?: string[];
  followUpOf?: { id: string; title: string } | null;
  templateId?: string | null;
  isSeriesMember?: boolean;
  /** The hero's small line, e.g. "Office Hub · Schedule a meeting". */
  eyebrow?: string;
  subtitle?: string;
  backHref?: string;
  /** Shown between the hero and the cards: where a follow-up or template came from. */
  intro?: ReactNode;
}) {
  const router = useRouter();
  const { actor, viewer, capabilities, settings, directory, today } = useOfficeHub();
  const { user, originalUser, isImpersonating } = useAuth();
  const { toast } = useToast();
  const { isBusy, run } = useOfficeHubAction();
  const now = useTickingNow(60_000);

  const [draft, setDraft] = useState<MeetingDraft>(initial);
  const [errors, setErrors] = useState<OfficeHubFieldErrors>({});
  const [seriesScope, setSeriesScope] = useState<'occurrence' | 'series'>('occurrence');
  const [agenda, setAgenda] = useState<AgendaDraftItem[]>(agendaItems ?? []);
  const [agendaPickerOpen, setAgendaPickerOpen] = useState(false);

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

  const clearErrors = useCallback((...keys: string[]) => {
    setErrors((current) => {
      if (!keys.some((key) => current[key])) return current;
      const next = { ...current };
      for (const key of keys) delete next[key];
      return next;
    });
  }, []);

  const isOnline = draft.mode === 'Online' || draft.mode === 'Hybrid';
  const isPhysical = draft.mode === 'Offline' || draft.mode === 'Hybrid';

  /**
   * The draft as it will be saved. An online meeting with no platform yet gets the only one there
   * is — there is nothing to choose, so asking would be a field that exists only to be filled in.
   * A value already on the draft is left alone, including a legacy `'Zoom'`.
   */
  const resolved = useMemo<MeetingDraft>(
    () =>
      isOnline && !draft.onlinePlatform && SELECTABLE_MEETING_PLATFORMS.length === 1
        ? { ...draft, onlinePlatform: SELECTABLE_MEETING_PLATFORMS[0] }
        : draft,
    [draft, isOnline],
  );

  /**
   * Google Meet's state, read only while it is relevant: an in-person-only office never makes this
   * request, and never sees a Google prompt for something it does not use.
   */
  const googleMeet = useGoogleMeetStatus({ enabled: isOnline });

  /** Whether the joining link will be created rather than typed. */
  const conferenceWillBeCreated =
    isOnline &&
    // Your own connection, or the one office account an administrator shared for everyone.
    canCreateMeetLinks(googleMeet.status) &&
    googleMeet.status.settings.enabled &&
    getMeetingProvider(resolved.onlinePlatform).supportsCreation;
  /** The link will come from the shared office account, not the user's own. */
  const viaSharedAccount = conferenceWillBeCreated && !googleMeet.status.connection.connected;

  const validate = useCallback(
    (status: 'Draft' | 'Scheduled'): OfficeHubFieldErrors => {
      const found = validateMeetingInput(
        { ...resolved, status, participantUserIds: resolved.selection.userIds },
        {
          settings,
          // An edit of an existing meeting must not be refused because the meeting is today and its
          // slot has passed — that is exactly when somebody needs to correct the room.
          allowPast: mode === 'edit',
          conferenceWillBeCreated,
        },
      );

      // The platform-specific link check the model cannot make: it needs the provider registry.
      if (!found.meetingUrl && isOnline && resolved.meetingUrl.trim()) {
        const verdict = getMeetingProvider(resolved.onlinePlatform).validateUrl(resolved.meetingUrl);
        if (!verdict.ok && verdict.reason) found.meetingUrl = verdict.reason;
      }

      if (resolved.timeZone && !isKnownTimeZone(resolved.timeZone)) {
        found.timeZone = 'That is not a time zone this browser recognises.';
      }

      // Asked, never assumed — but only once it matters: a draft emails nobody and opens nothing.
      if (status === 'Scheduled') Object.assign(found, unansweredInvitationQuestions(resolved));

      return found;
    },
    [resolved, settings, mode, conferenceWillBeCreated, isOnline],
  );

  /** The two answers as they are saved: who may join means nothing for an in-person meeting. */
  const invitationAnswers = {
    emailInvitations: draft.emailInvitations,
    joinAccess: isOnline ? draft.joinAccess : null,
  };

  /** Scroll a section or field into view, and focus it when it is a field. */
  const jumpTo = useCallback((target: string) => {
    const element = document.getElementById(target);
    if (!element) return;
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      element.focus({ preventScroll: true });
    }
  }, []);

  /**
   * Show what the save could not finish. The meeting is written before Google is contacted, so a
   * warning here means "saved, but" — something the organizer has to know and can act on.
   */
  const reportWarnings = useCallback(
    (warnings: string[] | undefined) => {
      for (const warning of warnings ?? []) {
        toast({ title: 'Saved, with one thing to know', description: warning, duration: 12_000 });
      }
    },
    [toast],
  );

  const refuse = (found: OfficeHubFieldErrors, title: string) => {
    toast({ variant: 'destructive', title, description: firstFieldError(found) ?? 'Some required information is missing.' });
    const first = ERROR_TARGETS.find(([key]) => found[key]);
    if (first) jumpTo(first[1]);
  };

  const submit = async (status: 'Draft' | 'Scheduled') => {
    const found = validate(status);
    setErrors(found);
    if (hasFieldErrors(found)) {
      refuse(found, 'Check the highlighted fields');
      return;
    }
    if (!actor) return;

    const values = {
      ...resolved,
      description: resolved.description || null,
      meetingUrl: resolved.meetingUrl || null,
      meetingPasscode: resolved.meetingPasscode || null,
      location: resolved.location || null,
      room: resolved.room || null,
      address: resolved.address || null,
      ...invitationAnswers,
    };

    if (mode === 'create') {
      const result = await run(
        () =>
          createMeeting(
            actor,
            {
              ...values,
              status,
              agendaItems: agenda.length ? agenda : undefined,
              carryActionItemIds,
              followUpOfMeetingId: followUpOf?.id ?? null,
              followUpOfMeetingTitle: followUpOf?.title ?? null,
              templateId: templateId ?? null,
            },
            { settings, directory },
          ),
        {
          success:
            status === 'Draft'
              ? 'Draft saved'
              : draft.emailInvitations
                ? 'Meeting scheduled and invitations sent'
                : 'Meeting scheduled and participants notified',
          failure: 'Could not create the meeting',
          describe: 'Create meeting',
        },
      );
      if (result) {
        reportWarnings(result.warnings);
        router.push(`${OFFICE_HUB_BASE_PATH}/meetings/${result.meetingId}`);
      }
      return;
    }

    if (!meetingId) return;
    const result = await run(
      () => updateMeeting(actor, meetingId, values, { settings, directory, scope: isSeriesMember ? seriesScope : 'occurrence' }),
      { success: 'Meeting updated', failure: 'Could not save your changes', describe: 'Update meeting' },
    );
    if (result) {
      reportWarnings(result.warnings);
      router.push(`${OFFICE_HUB_BASE_PATH}/meetings/${meetingId}`);
    }
  };

  const sendNow = async () => {
    if (!meetingId || !actor) return;
    // Sending is the moment the two questions matter, so it asks them as Schedule does.
    const unanswered = unansweredInvitationQuestions(draft);
    if (hasFieldErrors(unanswered)) {
      setErrors((current) => ({ ...current, ...unanswered }));
      refuse(unanswered, 'Answer before sending');
      return;
    }
    const sent = await run(() => sendMeetingInvitations(actor, meetingId, { settings, ...invitationAnswers }), {
      success: 'Invitations sent',
      failure: 'Could not send the invitations',
      describe: 'Send invitations',
    });
    if (sent != null) {
      reportWarnings(sent.warnings);
      router.push(`${OFFICE_HUB_BASE_PATH}/meetings/${meetingId}`);
    }
  };

  /* ── time ── */
  const startMinute = clockToMinutes(draft.startTime);
  const endMinute = clockToMinutes(draft.endTime);
  const slotValid = startMinute != null && endMinute != null && endMinute > startMinute;
  const durationMinutes = useMemo(() => {
    if (startMinute == null || endMinute == null) return 60;
    const span = endMinute - startMinute;
    return span > 0 ? span : span + 1440;
  }, [startMinute, endMinute]);

  const moveStart = (minute: number) => {
    const next = minuteToClock(minute);
    setDraft((current) => ({ ...current, startTime: next, endTime: endTimeFromDuration(next, durationMinutes) }));
    clearErrors('startTime', 'endTime');
  };

  /* ── who ── */
  const organizer = useMemo(
    () => directory.people.find((person) => person.userId === draft.organizerId) ?? null,
    [directory.people, draft.organizerId],
  );
  const expansion = useMemo(
    () => expandParticipantSelection(draft.selection, directory, organizer),
    [draft.selection, directory, organizer],
  );

  /* ── who's free ── */
  const availability = useMeetingAvailability({ date: draft.date, timeZone: draft.timeZone, excludeMeetingId: meetingId ?? null });
  const spansByUser = useMemo(() => {
    const map = new Map<string, MinuteSpan[]>();
    if (!availability.data) return map;
    for (const participant of expansion.participants) {
      map.set(participant.userId, busyMinutesOnDay(availability.data.busy[participant.userId], draft.date, draft.timeZone));
    }
    return map;
  }, [availability.data, expansion.participants, draft.date, draft.timeZone]);
  const clashingIds = useMemo(() => {
    const ids = new Set<string>();
    if (startMinute == null || endMinute == null || endMinute <= startMinute) return ids;
    for (const [userId, spans] of spansByUser) {
      if (spansOverlap(spans, startMinute, endMinute)) ids.add(userId);
    }
    return ids;
  }, [spansByUser, startMinute, endMinute]);

  const workStart = clockToMinutes(settings.workingHoursStart) ?? 9 * 60;
  const workEnd = clockToMinutes(settings.workingHoursEnd) ?? 18 * 60;
  const zonedNow = utcToZonedParts(now, draft.timeZone);
  const freeSlot = useMemo(() => {
    if (!availability.data || !clashingIds.size) return null;
    return findFreeSlot({
      busy: [...spansByUser.values()],
      duration: durationMinutes,
      from: workStart,
      to: workEnd,
      notBefore: zonedNow.date === draft.date ? clockToMinutes(zonedNow.time) ?? undefined : undefined,
    });
  }, [availability.data, clashingIds, spansByUser, durationMinutes, workStart, workEnd, zonedNow.date, zonedNow.time, draft.date]);

  const isBusyThen = useCallback(
    (userId: string): boolean | null => {
      if (!availability.data || startMinute == null || endMinute == null || endMinute <= startMinute) return null;
      return spansOverlap(busyMinutesOnDay(availability.data.busy[userId], draft.date, draft.timeZone), startMinute, endMinute);
    },
    [availability.data, draft.date, draft.timeZone, startMinute, endMinute],
  );

  /* ── where ── */
  const rooms = availability.data?.rooms ?? [];
  const chosenRoom = draft.room.trim()
    ? rooms.find((room) => roomKey(room.room, room.location) === roomKey(draft.room, draft.location)) ??
      rooms.find((room) => room.room.trim().toLowerCase() === draft.room.trim().toLowerCase())
    : undefined;
  const roomClash = isPhysical && chosenRoom ? roomBookingAt(chosenRoom, draft.date, draft.timeZone, startMinute, endMinute) : null;

  /* ── agenda templates (create only; an existing meeting's agenda is edited on Prepare) ── */
  const agendaTemplates = useOfficeHubQuery(() => listAgendaTemplates(), [], { enabled: agendaPickerOpen, initial: [] });

  const meetingTypes = useMemo(() => {
    const list = [...settings.meetingTypes];
    // A retired type still shows on a meeting that uses it, rather than looking unset.
    if (draft.meetingType && !list.includes(draft.meetingType)) list.push(draft.meetingType);
    return list;
  }, [settings.meetingTypes, draft.meetingType]);

  const summaryError = firstFieldError(errors);
  const participantCount = expansion.participants.length;
  const startLabel = formatClockTime(draft.startTime, { lowercaseMeridiem: true });
  const endLabel = formatClockTime(draft.endTime, { lowercaseMeridiem: true });

  /* ── the side panel ── */
  const placeTitle = [draft.room, draft.location].map((part) => part.trim()).filter(Boolean).join(' · ');
  const platformName = resolved.onlinePlatform ?? 'Google Meet';
  const whereRow: InvitationPreviewRow =
    draft.mode === 'Online'
      ? {
          icon: Video,
          title: `Online · ${platformName}`,
          detail: [
            conferenceWillBeCreated && !draft.meetingUrl.trim()
              ? 'Link created when you send'
              : draft.meetingUrl.trim() || 'Joining link not added yet',
            draft.joinAccess === 'open' ? 'Anyone with the link can join' : draft.joinAccess === 'invited' ? 'Invited people only' : null,
          ]
            .filter(Boolean)
            .join(' · '),
        }
      : {
          icon: MapPin,
          title: placeTitle || 'Place not set yet',
          detail: [draft.address.trim() || null, draft.mode === 'Hybrid' ? `+ ${platformName} link` : null].filter(Boolean).join('\n') || null,
        };
  const agendaText =
    agenda.length > 0
      ? agenda
          .slice(0, 4)
          .map((item, index) => `${index + 1}. ${item.title}`)
          .join('\n') + (agenda.length > 4 ? `\n+${agenda.length - 4} more` : '')
      : draft.description.trim().slice(0, 140);
  const previewRows: InvitationPreviewRow[] = [
    {
      icon: Clock,
      title: `${startLabel} – ${endLabel}`,
      detail: `${slotValid ? formatDuration(durationMinutes) : 'Ends before it starts'} · ${draft.timeZone}`,
    },
    whereRow,
    {
      icon: Users,
      title: `${participantCount} participant${participantCount === 1 ? '' : 's'}`,
      detail: `Organised by ${draft.organizerName}`,
    },
    {
      icon: Bell,
      title: draft.reminderOffsets.length
        ? `${draft.reminderOffsets.length} reminder${draft.reminderOffsets.length === 1 ? '' : 's'}`
        : 'Each person’s own reminders',
      detail:
        draft.emailInvitations === null ? 'Choose whether to email' : draft.emailInvitations ? 'Email + SEL Live' : 'SEL Live only',
    },
  ];
  if (draft.projectName) previewRows.push({ icon: Briefcase, title: 'Project', detail: draft.projectName });
  if (agendaText) previewRows.push({ icon: ListChecks, title: 'Agenda', detail: agendaText });

  const previewMeta = [
    draft.meetingType || 'Meeting',
    `${draft.priority} priority`,
    draft.recurrence.frequency !== 'None' ? `repeats ${draft.recurrence.frequency.toLowerCase()}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const checks: PreflightCheck[] = [
    { key: 'title', state: draft.title.trim() ? 'ok' : 'missing', label: draft.title.trim() ? 'Title written' : 'Title missing', target: 'oh-title' },
    { key: 'type', state: draft.meetingType ? 'ok' : 'missing', label: draft.meetingType ? 'Meeting type chosen' : 'Meeting type not chosen', target: 'oh-types' },
    { key: 'time', state: slotValid ? 'ok' : 'missing', label: slotValid ? 'End after start' : 'End time is not after the start', target: 'oh-end' },
    availability.loading
      ? { key: 'free', state: 'warn', label: 'Checking who’s free…', target: 'oh-when' }
      : availability.error
        ? { key: 'free', state: 'warn', label: 'Could not check who’s free', target: 'oh-when' }
        : clashingIds.size
          ? { key: 'free', state: 'warn', label: `${clashingIds.size} participant${clashingIds.size === 1 ? '' : 's'} busy then`, target: 'oh-when' }
          : { key: 'free', state: 'ok', label: 'Everyone free' },
    participantCount > 1
      ? { key: 'who', state: 'ok', label: `${participantCount} participants added` }
      : { key: 'who', state: 'warn', label: 'Only you so far', target: 'oh-who-picker' },
  ];
  if (isPhysical) {
    checks.push(
      draft.location.trim()
        ? { key: 'place', state: 'ok', label: 'Location set' }
        : { key: 'place', state: 'missing', label: 'Location missing', target: 'oh-location' },
    );
    if (roomClash) {
      checks.push({
        key: 'room',
        state: 'warn',
        label: `${draft.room.trim()} is booked ${formatClockTime(minuteToClock(roomClash.start), { lowercaseMeridiem: true })}–${formatClockTime(minuteToClock(roomClash.end), { lowercaseMeridiem: true })}`,
        target: 'oh-where',
      });
    }
  }
  if (isOnline) {
    const linkReady = conferenceWillBeCreated || Boolean(draft.meetingUrl.trim());
    checks.push(
      linkReady
        ? { key: 'link', state: 'ok', label: conferenceWillBeCreated && !draft.meetingUrl.trim() ? 'Meet link made on send' : 'Joining link added' }
        : { key: 'link', state: 'missing', label: 'Joining link missing', target: 'oh-meeting-url' },
      draft.joinAccess
        ? { key: 'join', state: 'ok', label: draft.joinAccess === 'open' ? 'Open meeting' : 'Invited people only' }
        : { key: 'join', state: 'missing', label: 'Who can join not chosen', target: 'oh-join' },
    );
  }
  checks.push(
    draft.emailInvitations === null
      ? { key: 'email', state: 'missing', label: 'Email decision not made', target: 'oh-email' }
      : { key: 'email', state: 'ok', label: draft.emailInvitations ? 'Emailing the invitation' : 'Not emailing' },
  );

  const primaryLabel =
    mode === 'edit' ? 'Save changes' : draft.emailInvitations === false ? 'Schedule' : 'Schedule & send';

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit('Scheduled');
      }}
    >
      <MeetingHero
        eyebrow={eyebrow ?? (mode === 'create' ? 'Office Hub · Schedule a meeting' : 'Office Hub · Edit meeting')}
        subtitle={subtitle}
        backHref={
          backHref ?? (meetingId ? `${OFFICE_HUB_BASE_PATH}/meetings/${meetingId}` : `${OFFICE_HUB_BASE_PATH}/meetings`)
        }
        title={draft.title}
        onTitleChange={(next) => set('title', next)}
        onTitleBlur={() => setErrors((current) => ({ ...current, ...pick(validate('Scheduled'), ['title']) }))}
        titleError={errors.title}
        meetingTypes={meetingTypes}
        meetingType={draft.meetingType}
        onMeetingTypeChange={(next) => set('meetingType', next)}
        typeError={errors.meetingType}
        priorities={OFFICE_HUB_PRIORITIES}
        priority={draft.priority}
        onPriorityChange={(next) => set('priority', next)}
        autoFocus={mode === 'create' && !draft.title}
      />

      {/*
        Said before the form is filled in, not after Save is refused: the database records every
        change under the person shown, sees the administrator, and refuses the mismatch.
      */}
      {isImpersonating && (
        <Card className="border-amber-200 bg-amber-50/70">
          <CardContent className="px-4 py-3">
            <p className="text-sm font-semibold text-amber-900">
              You are using Switch User{user?.name ? ` as ${user.name}` : ''}
            </p>
            <p className="mt-0.5 text-xs text-amber-900/80">
              Saving here will be refused: the database still sees you as {originalUser?.name ?? 'yourself'} and
              does not accept changes made in another person’s name. Switch back to your own account to
              schedule or edit meetings.
            </p>
          </CardContent>
        </Card>
      )}

      {intro}

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          {/* ── When ── */}
          <FormCard
            id="oh-when"
            icon={Clock}
            tone="violet"
            title="When"
            description="Pick a day and time; see who’s free"
            aside={
              <Select value={draft.timeZone} onValueChange={(next) => set('timeZone', next)}>
                <SelectTrigger
                  aria-label="Time zone"
                  className={cn('h-8 w-auto max-w-full gap-1.5 rounded-lg text-xs', errors.timeZone && 'border-destructive')}
                >
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
            }
          >
            <DayStrip
              value={draft.date}
              onChange={(next) => set('date', next)}
              today={today}
              min={mode === 'create' ? today : undefined}
              workingDays={settings.workingDays}
              holidays={settings.holidays ?? []}
            />
            <FieldError message={errors.date ?? errors.timeZone} />

            <div className="mt-4 flex flex-wrap items-end gap-x-3 gap-y-2">
              <div className="w-[7.5rem]">
                <FieldLabel htmlFor="oh-start" required>
                  Start
                </FieldLabel>
                <Input
                  id="oh-start"
                  type="time"
                  step={900}
                  value={draft.startTime}
                  aria-invalid={Boolean(errors.startTime)}
                  onChange={(event) => {
                    const next = event.target.value;
                    // Moving the start keeps the length the user had chosen, rather than leaving an
                    // end time that is now before it.
                    setDraft((current) => ({
                      ...current,
                      startTime: next,
                      endTime: next ? endTimeFromDuration(next, durationMinutes) : current.endTime,
                    }));
                    clearErrors('startTime', 'endTime');
                  }}
                  className={cn('rounded-xl', errors.startTime && 'border-destructive')}
                />
              </div>
              <span aria-hidden className="pb-2.5 text-muted-foreground">
                →
              </span>
              <div className="w-[7.5rem]">
                <FieldLabel htmlFor="oh-end" required>
                  End
                </FieldLabel>
                <Input
                  id="oh-end"
                  type="time"
                  step={900}
                  value={draft.endTime}
                  aria-invalid={Boolean(errors.endTime)}
                  onChange={(event) => set('endTime', event.target.value)}
                  className={cn('rounded-xl', errors.endTime && 'border-destructive')}
                />
              </div>
              <div className="min-w-0">
                <FieldLabel>Duration</FieldLabel>
                <DurationChips
                  value={slotValid ? durationMinutes : -1}
                  onChange={(minutes) => set('endTime', endTimeFromDuration(draft.startTime, minutes))}
                />
              </div>
            </div>
            <FieldError message={errors.startTime ?? errors.endTime} />

            <div className="mt-4">
              <AvailabilityTimeline
                people={expansion.participants}
                spansByUser={spansByUser}
                clashingIds={clashingIds}
                state={availability}
                start={startMinute}
                end={endMinute}
                workStart={workStart}
                workEnd={workEnd}
                freeSlot={freeSlot}
                viewerId={viewer.userId}
                onMoveStart={moveStart}
              />
            </div>

            <div className="mt-4">
              <RecurrenceEditor
                value={draft.recurrence}
                startDate={draft.date}
                onChange={(next) => set('recurrence', next)}
                holidays={settings.holidays ?? []}
                workingDays={settings.workingDays}
                durationMinutes={slotValid ? durationMinutes : undefined}
                today={today}
              />
            </div>
          </FormCard>

          {/* ── Who ── */}
          <FormCard
            id="oh-who"
            icon={Users}
            tone="blue"
            title="Who"
            description="Type a name, team or department. Duplicates are removed automatically."
          >
            <ParticipantPicker
              selection={draft.selection}
              organizerId={draft.organizerId}
              directory={directory}
              viewer={viewer}
              expansion={expansion}
              isBusy={isBusyThen}
              error={errors.participants}
              onChange={(next) => {
                setDraft((current) => ({ ...current, selection: next }));
                clearErrors('participants');
              }}
            />

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                  <FieldLabel>Organizer</FieldLabel>
                  <Input value={draft.organizerName} readOnly disabled className="rounded-xl" />
                </div>
              )}

              <ProjectSelector
                label="Related project (optional)"
                value={draft.projectId}
                onChange={(projectId, name) => setDraft((current) => ({ ...current, projectId, projectName: name }))}
              />
            </div>
          </FormCard>

          {/* ── Where ── */}
          <FormCard id="oh-where" icon={MapPin} tone="emerald" title="Where" description="Online, in person, or both">
            <ModeCards<MeetingMode>
              value={draft.mode}
              onChange={(next) => set('mode', next)}
              options={[
                {
                  value: 'Online',
                  title: 'Online',
                  description: conferenceWillBeCreated || !isOnline ? 'Video link created for you' : 'Paste a video link',
                  icon: Video,
                  tone: 'blue',
                },
                { value: 'Offline', title: 'In person', description: 'A room or site', icon: MapPin, tone: 'emerald' },
                { value: 'Hybrid', title: 'Hybrid', description: 'Room plus a video link', icon: MonitorSmartphone, tone: 'violet' },
              ]}
            />
            <FieldError message={errors.onlinePlatform} />

            {isPhysical && (
              <div className="mt-4 space-y-3">
                {rooms.length > 0 && (
                  <div>
                    <FieldLabel hint="from earlier meetings; green is free at this time">Room</FieldLabel>
                    <RoomChips
                      rooms={rooms}
                      date={draft.date}
                      timeZone={draft.timeZone}
                      start={startMinute}
                      end={endMinute}
                      selectedRoom={draft.room}
                      selectedLocation={draft.location}
                      onPick={(room) => {
                        setDraft((current) => ({ ...current, room: room.room, location: room.location ?? current.location }));
                        clearErrors('location');
                      }}
                    />
                  </div>
                )}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <FieldLabel htmlFor="oh-location" required>
                      Location
                    </FieldLabel>
                    <Input
                      id="oh-location"
                      value={draft.location}
                      onChange={(event) => set('location', event.target.value)}
                      placeholder="e.g. Head Office"
                      aria-invalid={Boolean(errors.location)}
                      className={cn('rounded-xl', errors.location && 'border-destructive')}
                    />
                    <FieldError message={errors.location} />
                  </div>
                  <div>
                    <FieldLabel htmlFor="oh-room">{rooms.length ? 'Room (or type a new one)' : 'Room'}</FieldLabel>
                    <Input
                      id="oh-room"
                      value={draft.room}
                      onChange={(event) => set('room', event.target.value)}
                      placeholder="e.g. Board Room, 3rd floor"
                      className="rounded-xl"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <FieldLabel htmlFor="oh-address" hint="for unfamiliar sites">
                      Address
                    </FieldLabel>
                    <Textarea
                      id="oh-address"
                      value={draft.address}
                      onChange={(event) => set('address', event.target.value)}
                      placeholder="Only needed when participants are travelling to an unfamiliar site."
                      rows={2}
                      className="rounded-xl"
                    />
                  </div>
                </div>
              </div>
            )}

            {isOnline && (
              <div className="mt-4 space-y-4">
                <OnlineLink
                  draft={resolved}
                  errors={errors}
                  conferenceWillBeCreated={conferenceWillBeCreated}
                  viaSharedAccount={viaSharedAccount}
                  actorUserId={actor?.userId ?? null}
                  googleMeet={googleMeet}
                  participantCount={draft.selection.userIds.length}
                  onSwitchToMeet={() => {
                    set('onlinePlatform', 'Google Meet');
                    set('meetingUrl', '');
                  }}
                  onUrlChange={(next) => set('meetingUrl', next)}
                  onUrlBlur={() => setErrors((current) => ({ ...current, ...pick(validate('Scheduled'), ['meetingUrl']) }))}
                  onPasscodeChange={(next) => set('meetingPasscode', next)}
                />

                <ChoiceCards<MeetingJoinAccess>
                  id="oh-join"
                  label="Who can join?"
                  value={draft.joinAccess}
                  onChange={(next) => set('joinAccess', next)}
                  error={errors.joinAccess}
                  options={[
                    {
                      value: 'invited',
                      icon: Lock,
                      title: 'Only invited people',
                      description: 'Only participants see the joining link in Office Hub. In Google Meet, anyone else has to ask to be let in.',
                    },
                    {
                      value: 'open',
                      icon: Globe,
                      title: 'Anyone with the link (open meeting)',
                      description:
                        'Everyone who can see this meeting in Office Hub gets the link, and Google Meet lets anyone with the link or meeting code join without asking.',
                    },
                  ]}
                />
              </div>
            )}
          </FormCard>

          {/* ── Agenda & notes ── */}
          <FormCard
            id="oh-agenda"
            icon={ListChecks}
            tone="amber"
            title="Agenda & notes"
            description="What it’s for, and anything to read beforehand"
          >
            <Textarea
              id="oh-description"
              value={draft.description}
              onChange={(event) => set('description', event.target.value)}
              placeholder="What is this meeting for? Anything participants should read beforehand."
              rows={4}
              className="rounded-xl"
            />

            {mode === 'create' ? (
              <div className="mt-3 space-y-2">
                {agenda.length > 0 && (
                  <ol className="space-y-1">
                    {agenda.map((item, index) => (
                      <li key={`${index}-${item.title}`} className="flex items-center gap-2 rounded-xl border bg-muted/30 px-3 py-1.5 text-sm">
                        <span className="w-5 shrink-0 text-xs font-bold text-muted-foreground">{index + 1}.</span>
                        <span className="min-w-0 flex-1 truncate">{item.title}</span>
                        {item.estimatedMinutes ? <span className="shrink-0 text-xs text-muted-foreground">{item.estimatedMinutes} min</span> : null}
                        <button
                          type="button"
                          aria-label={`Remove agenda item ${item.title}`}
                          onClick={() => setAgenda((current) => current.filter((_, position) => position !== index))}
                          className="shrink-0 rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <X className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Popover open={agendaPickerOpen} onOpenChange={setAgendaPickerOpen}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="flex items-center gap-1.5 rounded-full border border-dashed px-3 py-1 text-xs font-bold text-muted-foreground transition-colors hover:border-primary/60 hover:text-primary"
                      >
                        <LayoutTemplate className="h-3.5 w-3.5" aria-hidden />
                        Use agenda template
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-[min(22rem,90vw)] p-1.5">
                      {agendaTemplates.isLoading ? (
                        <p className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                          Loading templates…
                        </p>
                      ) : agendaTemplates.error ? (
                        <p className="px-3 py-4 text-sm text-muted-foreground">The agenda templates could not be loaded.</p>
                      ) : (agendaTemplates.data ?? []).filter((template) => template.status !== 'Archived').length === 0 ? (
                        <p className="px-3 py-4 text-sm text-muted-foreground">
                          No agenda templates yet. They are made under Office Hub › Templates.
                        </p>
                      ) : (
                        (agendaTemplates.data ?? [])
                          .filter((template) => template.status !== 'Archived')
                          .map((template) => (
                            <button
                              key={template.id}
                              type="button"
                              onClick={() => {
                                setAgenda((current) => [
                                  ...current,
                                  ...[...template.items]
                                    .sort((a, b) => a.order - b.order)
                                    .map((item) => ({
                                      title: item.title,
                                      description: item.description ?? null,
                                      expectedOutcome: item.expectedOutcome ?? null,
                                      estimatedMinutes: item.estimatedMinutes ?? null,
                                      priority: item.priority,
                                    })),
                                ]);
                                setAgendaPickerOpen(false);
                              }}
                              className="block w-full rounded-lg px-3 py-2 text-left hover:bg-muted"
                            >
                              <b className="block text-sm">{template.name}</b>
                              <small className="block text-xs text-muted-foreground">
                                {template.items.length} item{template.items.length === 1 ? '' : 's'}
                                {template.meetingType ? ` · ${template.meetingType}` : ''}
                              </small>
                            </button>
                          ))
                      )}
                    </PopoverContent>
                  </Popover>
                  <span className="flex items-center gap-1 text-[11.5px] text-muted-foreground">
                    <Paperclip className="h-3 w-3" aria-hidden />
                    Files can be attached on the meeting’s page once it is saved.
                  </span>
                </div>
              </div>
            ) : (
              meetingId && (
                <p className="mt-2 text-[11.5px] text-muted-foreground">
                  The agenda and files are edited on the{' '}
                  <Link href={`${OFFICE_HUB_BASE_PATH}/meetings/${meetingId}/prepare`} className="font-semibold text-primary underline-offset-2 hover:underline">
                    Prepare page
                  </Link>
                  .
                </p>
              )
            )}
          </FormCard>

          {/* ── Invitation & reminders ── */}
          <FormCard id="oh-invite" icon={Bell} tone="pink" title="Invitation & reminders" description="How people hear about it">
            <ChoiceCards
              id="oh-email"
              label="Send email invitations?"
              value={draft.emailInvitations === null ? null : draft.emailInvitations ? 'yes' : 'no'}
              onChange={(next) => set('emailInvitations', next === 'yes')}
              error={errors.emailInvitations}
              options={[
                {
                  value: 'yes',
                  icon: Mail,
                  title: 'Yes, email the invitation',
                  description: conferenceWillBeCreated
                    ? 'Google Calendar emails each participant the invitation with the Meet link. They are also notified in SEL Live.'
                    : 'Each participant gets the invitation by email, and in SEL Live.',
                },
                {
                  value: 'no',
                  icon: BellOff,
                  title: 'No, don’t email',
                  description: conferenceWillBeCreated
                    ? 'Participants are notified in SEL Live only. The meeting still appears on their Google Calendar, without an email.'
                    : 'Participants are notified in SEL Live only (the bell and the phone app).',
                },
              ]}
            />
            <div className="mt-4">
              <FieldLabel>Remind participants</FieldLabel>
              <ReminderChips
                choices={DEFAULT_REMINDER_CHOICES}
                value={draft.reminderOffsets}
                onChange={(next) => set('reminderOffsets', next)}
                defaults={settings.defaultReminderOffsets}
              />
            </div>
          </FormCard>

          {mode === 'edit' && isSeriesMember && (
            <Card className="rounded-2xl border-amber-200 bg-amber-50/70">
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
        </div>

        <aside className="min-w-0 space-y-4 xl:sticky xl:top-4">
          <InvitationPreview date={draft.date} title={draft.title.trim()} meta={previewMeta} rows={previewRows} />
          <PreflightChecklist checks={checks} onJump={jumpTo} />
        </aside>
      </div>

      {summaryError && (
        <Card className="rounded-2xl border-destructive/40 bg-destructive/5">
          <CardContent className="px-4 py-3">
            <p className="text-sm font-medium text-destructive">{summaryError}</p>
            <p className="text-xs text-destructive/80">Nothing has been saved. Fix the highlighted fields and try again.</p>
          </CardContent>
        </Card>
      )}

      <div className="sticky bottom-0 z-20 -mx-1 flex flex-wrap items-center gap-2 rounded-t-2xl border-t bg-background/95 px-3 py-3 backdrop-blur">
        <p className="min-w-0 flex-1 basis-full text-[12.5px] text-muted-foreground sm:basis-auto">
          <b className="text-foreground">
            {formatIsoDate(draft.date, { withWeekday: true, year: false })}, {startLabel}
          </b>
          {' · '}
          {slotValid ? formatDuration(durationMinutes) : 'check the times'} · {participantCount}{' '}
          {participantCount === 1 ? 'person' : 'people'}
          {clashingIds.size > 0 && <span className="font-bold text-amber-700"> · {clashingIds.size} busy</span>}
        </p>

        <Button type="button" variant="ghost" asChild disabled={isBusy}>
          <Link href={meetingId ? `${OFFICE_HUB_BASE_PATH}/meetings/${meetingId}` : `${OFFICE_HUB_BASE_PATH}/meetings`}>Cancel</Link>
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

        <Button
          type="submit"
          disabled={isBusy}
          className="gap-2 bg-gradient-to-r from-primary to-blue-600 text-white shadow-[0_10px_22px_-12px_hsl(var(--primary))] hover:opacity-95"
        >
          {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === 'create' ? <Send className="h-4 w-4" /> : <Save className="h-4 w-4" />}
          {primaryLabel}
        </Button>
      </div>
    </form>
  );
}

/**
 * The online half of "Where": either "the link will be made for you", or a field to paste one with
 * the reason Office Hub cannot make it. Without the reason the form looks identical whether Google is
 * unconfigured, disconnected or switched off — three problems with three different fixes.
 */
function OnlineLink({
  draft,
  errors,
  conferenceWillBeCreated,
  viaSharedAccount,
  actorUserId,
  googleMeet,
  participantCount,
  onSwitchToMeet,
  onUrlChange,
  onUrlBlur,
  onPasscodeChange,
}: {
  draft: MeetingDraft;
  errors: OfficeHubFieldErrors;
  conferenceWillBeCreated: boolean;
  viaSharedAccount: boolean;
  actorUserId: string | null;
  googleMeet: ReturnType<typeof useGoogleMeetStatus>;
  participantCount: number;
  onSwitchToMeet: () => void;
  onUrlChange: (next: string) => void;
  onUrlBlur: () => void;
  onPasscodeChange: (next: string) => void;
}) {
  // A meeting created before Office Hub standardised on Meet keeps what it actually uses.
  if (draft.onlinePlatform && !SELECTABLE_MEETING_PLATFORMS.includes(draft.onlinePlatform)) {
    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-xs font-medium text-amber-900">{draft.onlinePlatform}</p>
          <p className="mt-0.5 text-[11px] text-amber-800">
            This meeting was created before Office Hub moved to Google Meet. Keep the pasted link, or{' '}
            <button type="button" className="font-medium underline underline-offset-2" onClick={onSwitchToMeet}>
              switch it to Google Meet
            </button>
            .
          </p>
        </div>
        <PastedLinkFields draft={draft} errors={errors} required onUrlChange={onUrlChange} onUrlBlur={onUrlBlur} onPasscodeChange={onPasscodeChange} />
      </div>
    );
  }

  if (conferenceWillBeCreated && !draft.meetingUrl.trim()) {
    // Nothing to fill in: the link is created with the Google Calendar event when the meeting is
    // saved, so an input here would be a required field with no correct value.
    return (
      <div id="oh-meeting-url" className="flex items-start gap-2.5 rounded-xl border border-dashed border-primary/40 bg-primary/5 px-3 py-2.5 text-[12.5px]">
        <Video className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-semibold">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
            A Google Meet link is created when you send
          </p>
          {viaSharedAccount && (
            <p className="mt-1 text-[11.5px] text-muted-foreground">
              {draft.organizerId === actorUserId
                ? 'Created with the office Google account'
                : 'Created with the organizer’s Google account if they have connected one, otherwise the office account'}
              {googleMeet.status.sharedAccount?.googleEmail ? ` (${googleMeet.status.sharedAccount.googleEmail})` : ''}
              {draft.organizerId === actorUserId ? ', so you do not need to connect your own.' : '.'}
            </p>
          )}
          <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
            {googleSyncSummary({
              connected: true,
              sendUpdates: meetingSendUpdates(draft, googleMeet.status.settings.sendUpdates),
              attendeeCount: participantCount,
            })}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <PastedLinkFields
        draft={draft}
        errors={errors}
        required={!conferenceWillBeCreated}
        onUrlChange={onUrlChange}
        onUrlBlur={onUrlBlur}
        onPasscodeChange={onPasscodeChange}
      />
      {!conferenceWillBeCreated && googleMeet.status.settings.enabled && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-[11.5px] leading-relaxed text-sky-900">
          {/*
            "Could not check" comes first and is kept apart from "not configured": they look the
            same from here but need opposite responses — a lapsed session versus an admin task.
          */}
          {googleMeet.status.unavailable ? (
            <p>
              Google Meet could not be checked, so paste a joining link for now. <span className="text-sky-800">{googleMeet.status.unavailable}</span>{' '}
              <button type="button" className="font-medium underline underline-offset-2" onClick={() => googleMeet.reload()}>
                Try again
              </button>
            </p>
          ) : !googleMeet.status.configured ? (
            <p>
              Google Meet is not set up on this server, so paste a joining link for now. An administrator can enable it — see{' '}
              <span className="font-medium">docs/office-hub.md</span>.
            </p>
          ) : googleMeet.status.connection.health === 'reauth-required' ? (
            <p>
              Google stopped accepting your connection
              {googleMeet.status.connection.reauthReason ? `: ${googleMeet.status.connection.reauthReason}` : '.'}{' '}
              <button
                type="button"
                className="font-medium underline underline-offset-2"
                onClick={() => void googleMeet.connect()}
                disabled={googleMeet.isBusy}
              >
                Reconnect Google
              </button>{' '}
              and Office Hub will create the link for you.
            </p>
          ) : (
            <p>
              <button
                type="button"
                className="font-medium underline underline-offset-2"
                onClick={() => void googleMeet.connect()}
                disabled={googleMeet.isBusy}
              >
                Connect your Google account
              </button>{' '}
              and Office Hub will create the Meet link and add the meeting to participants’ Google Calendars — no link to paste.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function PastedLinkFields({
  draft,
  errors,
  required,
  onUrlChange,
  onUrlBlur,
  onPasscodeChange,
}: {
  draft: MeetingDraft;
  errors: OfficeHubFieldErrors;
  required: boolean;
  onUrlChange: (next: string) => void;
  onUrlBlur: () => void;
  onPasscodeChange: (next: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
      <div className="min-w-0">
        <FieldLabel htmlFor="oh-meeting-url" required={required} hint={required ? undefined : 'optional'}>
          Joining link
        </FieldLabel>
        <Input
          id="oh-meeting-url"
          value={draft.meetingUrl}
          onChange={(event) => onUrlChange(event.target.value)}
          onBlur={onUrlBlur}
          placeholder="https://meet.google.com/abc-defg-hij"
          aria-invalid={Boolean(errors.meetingUrl)}
          inputMode="url"
          className={cn('rounded-xl', errors.meetingUrl && 'border-destructive')}
        />
        <FieldError message={errors.meetingUrl} />
      </div>
      <div>
        <FieldLabel htmlFor="oh-passcode">Passcode</FieldLabel>
        <Input
          id="oh-passcode"
          value={draft.meetingPasscode}
          onChange={(event) => onPasscodeChange(event.target.value)}
          placeholder="Optional"
          className="rounded-xl"
        />
      </div>
    </div>
  );
}

/** The invitation questions still unanswered, as field errors. */
function unansweredInvitationQuestions(draft: MeetingDraft): OfficeHubFieldErrors {
  const errors: OfficeHubFieldErrors = {};
  if (draft.emailInvitations === null) {
    errors.emailInvitations = 'Choose whether to send email invitations.';
  }
  if ((draft.mode === 'Online' || draft.mode === 'Hybrid') && !draft.joinAccess) {
    errors.joinAccess = 'Choose who can join: only invited people, or anyone with the link.';
  }
  return errors;
}

/** The named subset of an error map, for a blur handler that should only touch its own field. */
function pick(errors: OfficeHubFieldErrors, keys: readonly string[]): OfficeHubFieldErrors {
  const output: OfficeHubFieldErrors = {};
  for (const key of keys) output[key] = errors[key] ?? '';
  return output;
}

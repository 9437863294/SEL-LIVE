/**
 * Integration interfaces for external calendars, conferencing, email and push (§63).
 *
 * §63 asks for the *interfaces*, and is explicit that no external integration is mandatory for the
 * first local version. So this module defines four provider contracts, ships a working default for
 * each that needs no third-party account, and provides a registry so a real provider can be dropped
 * in later without touching a single call site.
 *
 * ── What "working default" means here, provider by provider ─────────────────────────────────────
 *
 *   • `CalendarProvider` → **ICS**. The default emits a standards-compliant iCalendar invitation
 *     that Outlook, Google Calendar and Apple Calendar all import. That is not a stub: a
 *     participant who wants this meeting in their own calendar can have it today, without the
 *     office first negotiating OAuth with Microsoft. A Google or Graph provider added later
 *     replaces the transport, not the payload.
 *
 *   • `MeetingProvider` → **manual link**. The organizer pastes a Teams/Meet/Zoom URL, which is
 *     what people actually do. A provider that *creates* the conference through an API is a strict
 *     addition; `supportsCreation` is the flag screens read to decide whether to offer the button.
 *
 *   • `EmailProvider` → the app's existing `nodemailer` transport (`@/lib/mail`), wired in by
 *     `office-hub-server.ts`. §33 says not to hard-code a provider, so the templates below produce
 *     subject + HTML + text and know nothing about how it is sent.
 *
 *   • `NotificationProvider` → the existing central bell and web-push, wired in by the service.
 *
 * Everything in this file is pure. The providers are interfaces plus data builders; the wiring that
 * actually sends is in the service and server modules, which is what keeps this testable.
 */

import {
  formatIsoDate,
  type ClockTime,
  type IsoDate,
} from './office-hub-time.ts';
import type {
  MomDocument,
} from './office-hub-rules.ts';
import type {
  OfficeHubMeeting,
  OfficeHubParticipant,
  OfficeHubTask,
  OnlineMeetingPlatform,
} from './office-hub-model.ts';

/* ── the four contracts ──────────────────────────────────────────────────────────────────────── */

export interface CalendarEvent {
  uid: string;
  title: string;
  description: string;
  location: string;
  /** ISO instants. */
  startAt: string;
  endAt: string;
  organizer: { name: string; email?: string | null };
  attendees: { name: string; email?: string | null; required: boolean }[];
  url?: string | null;
  /** Bumped on every change, so a calendar client replaces rather than duplicates the event. */
  sequence: number;
  status: 'CONFIRMED' | 'CANCELLED' | 'TENTATIVE';
  /** RFC 5545 recurrence rule, when the meeting is a series. */
  recurrenceRule?: string | null;
}

export interface CalendarProvider {
  readonly id: string;
  readonly label: string;
  /** Whether this provider can write to the user's remote calendar, or only export. */
  readonly supportsPush: boolean;
  /** Produce the payload for an event. The ICS provider returns the .ics body. */
  serialize(event: CalendarEvent): string;
  /** Push to the remote calendar. The default provider has nothing to push to. */
  push?(event: CalendarEvent, context: { userId: string }): Promise<{ ok: boolean; remoteId?: string; error?: string }>;
}

export interface MeetingProvider {
  readonly id: string;
  readonly platform: OnlineMeetingPlatform;
  readonly label: string;
  /** Whether the provider can create a conference, or only accept a pasted link. */
  readonly supportsCreation: boolean;
  /** Validate a link the organizer pasted. */
  validateUrl(url: string): { ok: boolean; reason: string | null };
  create?(input: {
    title: string;
    startAt: string;
    endAt: string;
    organizerEmail?: string | null;
    /**
     * The saved meeting the conference belongs to.
     *
     * Optional because a provider that mints a standalone room needs nothing but a time range. The
     * Google Meet provider does need it: a Meet link is a property of a Google Calendar event, so
     * there has to *be* a meeting to attach the event to, and the server reads its participants and
     * recurrence from the document rather than trusting a client to restate them.
     */
    meetingId?: string | null;
  }): Promise<{
    ok: boolean;
    joinUrl?: string;
    passcode?: string;
    error?: string;
    /** Participants left off the remote invitation, and why. Shown, never swallowed. */
    warnings?: string[];
    /** Set when the failure is "the organizer has not connected their account". */
    needsConnect?: boolean;
  }>;
}

export interface EmailMessage {
  to: string[];
  cc?: string[];
  subject: string;
  html: string;
  text: string;
  /** Calendar invitation attached as `text/calendar`, when the message is a meeting invitation. */
  icsBody?: string | null;
  icsMethod?: 'REQUEST' | 'CANCEL' | 'PUBLISH';
}

export interface EmailProvider {
  readonly id: string;
  readonly label: string;
  send(message: EmailMessage): Promise<{ ok: boolean; error?: string }>;
}

export interface NotificationProvider {
  readonly id: string;
  deliver(input: {
    userIds: string[];
    type: string;
    title: string;
    body: string;
    link?: string | null;
    severity?: 'INFO' | 'WARNING' | 'CRITICAL';
    entityType?: string;
    entityId?: string;
  }): Promise<{ delivered: number }>;
}

/* ── the registry ────────────────────────────────────────────────────────────────────────────── */

interface ProviderRegistry {
  calendar: CalendarProvider;
  meeting: Record<string, MeetingProvider>;
  email: EmailProvider | null;
  notification: NotificationProvider | null;
}

/**
 * Where the application's providers are registered.
 *
 * A mutable singleton rather than dependency injection through twenty call sites, because the set
 * is decided once at boot from configuration and never varies per request. `office-hub-service.ts`
 * registers the notification provider, `office-hub-server.ts` registers the email one, and a future
 * Graph or Google integration registers itself from wherever its credentials are read.
 */
const registry: ProviderRegistry = {
  calendar: createIcsCalendarProvider(),
  meeting: {},
  email: null,
  notification: null,
};

export function registerCalendarProvider(provider: CalendarProvider): void {
  registry.calendar = provider;
}

export function registerMeetingProvider(provider: MeetingProvider): void {
  registry.meeting[provider.platform] = provider;
}

export function registerEmailProvider(provider: EmailProvider | null): void {
  registry.email = provider;
}

export function registerNotificationProvider(provider: NotificationProvider | null): void {
  registry.notification = provider;
}

export const getCalendarProvider = (): CalendarProvider => registry.calendar;

export const getEmailProvider = (): EmailProvider | null => registry.email;

export const getNotificationProvider = (): NotificationProvider | null => registry.notification;

/**
 * The provider for a platform, falling back to the manual-link one.
 *
 * Never null, so a screen never has to branch on whether a platform is "supported" — every platform
 * supports a pasted link, and `supportsCreation` distinguishes the ones that can do more.
 */
export function getMeetingProvider(platform: OnlineMeetingPlatform | null | undefined): MeetingProvider {
  if (platform && registry.meeting[platform]) return registry.meeting[platform];
  return manualMeetingProvider(platform ?? 'Other');
}

/** Platforms with a registered provider that can create conferences, for the form's hint. */
export const platformsSupportingCreation = (): OnlineMeetingPlatform[] =>
  Object.values(registry.meeting)
    .filter((provider) => provider.supportsCreation)
    .map((provider) => provider.platform);

/* ── the manual meeting provider ─────────────────────────────────────────────────────────────── */

/** Host patterns that identify a platform, used to warn about an obviously mismatched link. */
const PLATFORM_HOSTS: Record<OnlineMeetingPlatform, RegExp | null> = {
  'Microsoft Teams': /(^|\.)teams\.(microsoft|live)\.com$/i,
  'Google Meet': /(^|\.)meet\.google\.com$/i,
  Zoom: /(^|\.)zoom\.(us|com)$/i,
  Webex: /(^|\.)webex\.com$/i,
  Other: null,
};

export function manualMeetingProvider(platform: OnlineMeetingPlatform): MeetingProvider {
  return {
    id: `manual:${platform}`,
    platform,
    label: `${platform} (paste link)`,
    supportsCreation: false,
    validateUrl(url: string) {
      const trimmed = url.trim();
      if (!trimmed) return { ok: false, reason: 'Paste the joining link.' };
      let parsed: URL;
      try {
        parsed = new URL(trimmed);
      } catch {
        return { ok: false, reason: 'That does not look like a link. It should start with https://' };
      }
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return { ok: false, reason: 'The link must be an http(s) address.' };
      }
      const expected = PLATFORM_HOSTS[platform];
      if (expected && !expected.test(parsed.hostname)) {
        // A warning phrased as a rejection, because the usual cause is a link pasted against the
        // wrong platform — which produces a Join button that takes people nowhere.
        return {
          ok: false,
          reason: `That link is not a ${platform} address. Change the platform, or paste the ${platform} link.`,
        };
      }
      return { ok: true, reason: null };
    },
  };
}

/* ── ICS ─────────────────────────────────────────────────────────────────────────────────────── */

/**
 * The default calendar provider: a standards-compliant `.ics` file.
 *
 * Folding, escaping and CRLF line endings are all load-bearing — RFC 5545 requires CRLF, requires
 * commas and semicolons in text values to be escaped, and requires lines over 75 octets to be
 * folded. Outlook in particular rejects a file that gets any of the three wrong, and rejects it
 * silently, which is the worst way to find out.
 */
export function createIcsCalendarProvider(): CalendarProvider {
  return {
    id: 'ics',
    label: 'Calendar file (.ics)',
    supportsPush: false,
    serialize(event: CalendarEvent): string {
      const lines: string[] = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//SEL Live//Office Hub//EN',
        'CALSCALE:GREGORIAN',
        `METHOD:${event.status === 'CANCELLED' ? 'CANCEL' : 'REQUEST'}`,
        'BEGIN:VEVENT',
        `UID:${event.uid}`,
        `DTSTAMP:${toIcsInstant(new Date().toISOString())}`,
        `DTSTART:${toIcsInstant(event.startAt)}`,
        `DTEND:${toIcsInstant(event.endAt)}`,
        `SEQUENCE:${event.sequence}`,
        `STATUS:${event.status}`,
        `SUMMARY:${escapeIcsText(event.title)}`,
      ];

      if (event.description) lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
      if (event.location) lines.push(`LOCATION:${escapeIcsText(event.location)}`);
      if (event.url) lines.push(`URL:${escapeIcsText(event.url)}`);
      if (event.recurrenceRule) lines.push(`RRULE:${event.recurrenceRule}`);

      lines.push(
        `ORGANIZER;CN=${escapeIcsText(event.organizer.name)}:mailto:${event.organizer.email ?? 'noreply@invalid'}`,
      );
      for (const attendee of event.attendees) {
        lines.push(
          `ATTENDEE;CN=${escapeIcsText(attendee.name)};ROLE=${
            attendee.required ? 'REQ-PARTICIPANT' : 'OPT-PARTICIPANT'
          };RSVP=TRUE:mailto:${attendee.email ?? 'noreply@invalid'}`,
        );
      }

      lines.push('END:VEVENT', 'END:VCALENDAR');
      return lines.map(foldIcsLine).join('\r\n');
    },
  };
}

const toIcsInstant = (iso: string): string => {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '19700101T000000Z';
  return `${parsed.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
};

const escapeIcsText = (value: string): string =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');

/** RFC 5545 §3.1: fold at 75 octets, continuation lines start with a single space. */
function foldIcsLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 74) {
    parts.push(` ${rest.slice(0, 74)}`);
    rest = rest.slice(74);
  }
  if (rest.length) parts.push(` ${rest}`);
  return parts.join('\r\n');
}

/** A meeting as a calendar event, ready for any provider. */
export function calendarEventFromMeeting(
  meeting: Pick<
    OfficeHubMeeting,
    | 'id'
    | 'title'
    | 'description'
    | 'startAt'
    | 'endAt'
    | 'mode'
    | 'meetingUrl'
    | 'location'
    | 'room'
    | 'address'
    | 'status'
    | 'organizerId'
    | 'organizerName'
    | 'recurrence'
    | 'date'
  >,
  participants: readonly Pick<OfficeHubParticipant, 'name' | 'email' | 'attendanceRole'>[],
  options: { organizerEmail?: string | null; sequence?: number } = {},
): CalendarEvent {
  const locationParts =
    meeting.mode === 'Online'
      ? [meeting.meetingUrl]
      : [meeting.location, meeting.room, meeting.address];

  return {
    uid: `office-hub-${meeting.id}@sel-live`,
    title: meeting.title,
    description: [meeting.description, meeting.meetingUrl ? `Join: ${meeting.meetingUrl}` : null]
      .filter(Boolean)
      .join('\n\n'),
    location: locationParts.filter(Boolean).join(', '),
    startAt: meeting.startAt,
    endAt: meeting.endAt,
    organizer: { name: meeting.organizerName, email: options.organizerEmail ?? null },
    attendees: participants.map((participant) => ({
      name: participant.name,
      email: participant.email ?? null,
      required: participant.attendanceRole === 'Required',
    })),
    url: meeting.meetingUrl ?? null,
    sequence: options.sequence ?? 0,
    status: meeting.status === 'Cancelled' ? 'CANCELLED' : 'CONFIRMED',
    recurrenceRule: recurrenceRuleFor(meeting.recurrence),
  };
}

/**
 * The meeting's recurrence as an RFC 5545 RRULE, or null when it does not repeat.
 *
 * Deliberately conservative: only the rules that map cleanly are emitted. An Office Hub rule an
 * external calendar cannot express is better sent as a single event per instance than as an RRULE
 * that means something subtly different in Outlook than it does here.
 */
export function recurrenceRuleFor(
  recurrence: OfficeHubMeeting['recurrence'] | null | undefined,
): string | null {
  if (!recurrence || recurrence.frequency === 'None') return null;

  const parts: string[] = [];
  const interval = Math.max(1, recurrence.interval || 1);

  switch (recurrence.frequency) {
    case 'Daily':
      parts.push('FREQ=DAILY');
      break;
    case 'Weekly':
    case 'Custom': {
      parts.push('FREQ=WEEKLY');
      const days = (recurrence.weekdays ?? []).map((day) => ICS_WEEKDAYS[day]).filter(Boolean);
      if (days.length) parts.push(`BYDAY=${days.join(',')}`);
      break;
    }
    case 'Monthly':
      parts.push('FREQ=MONTHLY');
      if (recurrence.monthlyMode === 'weekday-of-month') {
        const day = ICS_WEEKDAYS[recurrence.weekday ?? 1];
        if (day) parts.push(`BYDAY=${recurrence.weekdayOrdinal ?? 1}${day}`);
      } else if (recurrence.dayOfMonth) {
        parts.push(`BYMONTHDAY=${recurrence.dayOfMonth}`);
      }
      break;
    case 'Yearly':
      parts.push('FREQ=YEARLY');
      break;
    default:
      return null;
  }

  if (interval > 1) parts.push(`INTERVAL=${interval}`);
  if (recurrence.endMode === 'after-occurrences' && recurrence.occurrences) {
    parts.push(`COUNT=${recurrence.occurrences}`);
  } else if (recurrence.endMode === 'on-date' && recurrence.endDate) {
    parts.push(`UNTIL=${recurrence.endDate.replace(/-/g, '')}T235959Z`);
  }

  return parts.join(';');
}

const ICS_WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/* ── email templates (§33) ───────────────────────────────────────────────────────────────────── */

export type OfficeHubEmailTemplate =
  | 'meeting-invitation'
  | 'meeting-reminder'
  | 'meeting-changed'
  | 'meeting-cancelled'
  | 'minutes-published'
  | 'task-assigned'
  | 'task-reminder'
  | 'task-overdue'
  | 'task-completed'
  | 'decision-assigned';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Plain, single-column HTML with inline styles.
 *
 * Every mail client that matters strips `<style>` blocks, ignores external stylesheets and has
 * patchy flexbox support, so a shared table shell with inline styles is not laziness — it is the
 * only layout that survives Outlook. The text alternative is generated alongside rather than
 * derived, because a text part auto-stripped from HTML reads like stripped HTML.
 */
function shell(title: string, bodyHtml: string, cta?: { label: string; url: string } | null): string {
  const button = cta
    ? `<tr><td style="padding:24px 0 8px"><a href="${cta.url}" style="background:#4f46e5;color:#fff;text-decoration:none;padding:11px 20px;border-radius:6px;font:600 14px/1.4 Segoe UI,Arial,sans-serif;display:inline-block">${cta.label}</a></td></tr>`
    : '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6fa;padding:24px 0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:28px">
<tr><td style="font:600 18px/1.4 Segoe UI,Arial,sans-serif;color:#111827;padding-bottom:12px">${title}</td></tr>
<tr><td style="font:400 14px/1.6 Segoe UI,Arial,sans-serif;color:#374151">${bodyHtml}</td></tr>
${button}
<tr><td style="padding-top:22px;border-top:1px solid #f3f4f6;font:400 12px/1.5 Segoe UI,Arial,sans-serif;color:#9ca3af">Office Hub · sent automatically. Change what you are emailed about in Office Hub → Settings → Notifications.</td></tr>
</table></td></tr></table>`;
}

const row = (label: string, value: string): string =>
  `<div style="margin:2px 0"><span style="color:#6b7280">${label}:</span> <strong style="color:#111827">${value}</strong></div>`;

export function renderMeetingEmail(
  template: Extract<
    OfficeHubEmailTemplate,
    'meeting-invitation' | 'meeting-reminder' | 'meeting-changed' | 'meeting-cancelled'
  >,
  input: {
    meeting: Pick<
      OfficeHubMeeting,
      'title' | 'date' | 'startTime' | 'endTime' | 'timeZone' | 'mode' | 'meetingUrl' | 'location' | 'room' | 'organizerName' | 'meetingType'
    >;
    recipientName: string;
    baseUrl: string;
    meetingId: string;
    reason?: string | null;
    agendaTitles?: string[];
  },
): RenderedEmail {
  const { meeting } = input;
  const where =
    meeting.mode === 'Online'
      ? `Online (${meeting.meetingUrl ? 'link in the meeting' : 'link to follow'})`
      : [meeting.location, meeting.room].filter(Boolean).join(' · ') || 'To be confirmed';
  const when = `${formatIsoDate(meeting.date, { withWeekday: true })}, ${meeting.startTime}–${meeting.endTime} (${meeting.timeZone})`;
  const url = `${input.baseUrl}/office-hub/meetings/${input.meetingId}`;

  const details = [
    row('When', when),
    row('Where', where),
    row('Organizer', meeting.organizerName),
    row('Type', meeting.meetingType),
  ].join('');

  const agenda = input.agendaTitles?.length
    ? `<div style="margin-top:14px"><div style="color:#6b7280;margin-bottom:4px">Agenda</div><ol style="margin:0;padding-left:20px">${input.agendaTitles
        .map((title) => `<li>${title}</li>`)
        .join('')}</ol></div>`
    : '';

  const textDetails = `When: ${when}\nWhere: ${where}\nOrganizer: ${meeting.organizerName}`;

  switch (template) {
    case 'meeting-invitation':
      return {
        subject: `Invitation: ${meeting.title} — ${formatIsoDate(meeting.date)}`,
        html: shell(
          `You are invited to ${meeting.title}`,
          `<p style="margin:0 0 12px">Hello ${input.recipientName},</p>${details}${agenda}<p style="margin:14px 0 0">Please let the organizer know whether you can attend.</p>`,
          { label: 'Respond to invitation', url },
        ),
        text: `Hello ${input.recipientName},\n\nYou are invited to ${meeting.title}.\n\n${textDetails}\n\nRespond: ${url}`,
      };
    case 'meeting-reminder':
      return {
        subject: `Reminder: ${meeting.title} — ${meeting.startTime}`,
        html: shell(
          `${meeting.title} is coming up`,
          `<p style="margin:0 0 12px">Hello ${input.recipientName},</p>${details}${agenda}`,
          { label: 'Open meeting', url },
        ),
        text: `Hello ${input.recipientName},\n\n${meeting.title} is coming up.\n\n${textDetails}\n\nOpen: ${url}`,
      };
    case 'meeting-changed':
      return {
        subject: `Changed: ${meeting.title} — now ${formatIsoDate(meeting.date)}`,
        html: shell(
          `${meeting.title} has been rescheduled`,
          `<p style="margin:0 0 12px">Hello ${input.recipientName},</p><p style="margin:0 0 12px">This meeting has moved. The new details are below.</p>${details}${
            input.reason ? `<p style="margin:14px 0 0;color:#6b7280">Reason: ${input.reason}</p>` : ''
          }`,
          { label: 'Open meeting', url },
        ),
        text: `Hello ${input.recipientName},\n\n${meeting.title} has been rescheduled.\n\n${textDetails}${
          input.reason ? `\n\nReason: ${input.reason}` : ''
        }\n\nOpen: ${url}`,
      };
    case 'meeting-cancelled':
      return {
        subject: `Cancelled: ${meeting.title} — ${formatIsoDate(meeting.date)}`,
        html: shell(
          `${meeting.title} has been cancelled`,
          `<p style="margin:0 0 12px">Hello ${input.recipientName},</p><p style="margin:0 0 12px">The meeting scheduled for ${when} is no longer going ahead.</p>${
            input.reason ? `<p style="margin:0;color:#6b7280">Reason: ${input.reason}</p>` : ''
          }`,
          null,
        ),
        text: `Hello ${input.recipientName},\n\n${meeting.title} on ${when} has been cancelled.${
          input.reason ? `\n\nReason: ${input.reason}` : ''
        }`,
      };
    default:
      return { subject: meeting.title, html: shell(meeting.title, details, { label: 'Open', url }), text: textDetails };
  }
}

export function renderTaskEmail(
  template: Extract<OfficeHubEmailTemplate, 'task-assigned' | 'task-reminder' | 'task-overdue' | 'task-completed'>,
  input: {
    task: Pick<OfficeHubTask, 'title' | 'reference' | 'dueDate' | 'priority' | 'meetingTitle' | 'description'>;
    recipientName: string;
    actorName?: string | null;
    overdueDays?: number;
    baseUrl: string;
    taskId: string;
  },
): RenderedEmail {
  const { task } = input;
  const url = `${input.baseUrl}/office-hub/tasks/${input.taskId}`;
  const details = [
    row('Reference', task.reference),
    row('Due', task.dueDate ? formatIsoDate(task.dueDate) : 'No due date'),
    row('Priority', task.priority),
    ...(task.meetingTitle ? [row('From meeting', task.meetingTitle)] : []),
  ].join('');
  const textDetails = `Reference: ${task.reference}\nDue: ${
    task.dueDate ? formatIsoDate(task.dueDate) : 'No due date'
  }\nPriority: ${task.priority}`;

  switch (template) {
    case 'task-assigned':
      return {
        subject: `New task: ${task.title}`,
        html: shell(
          task.title,
          `<p style="margin:0 0 12px">Hello ${input.recipientName},</p><p style="margin:0 0 12px">${
            input.actorName ?? 'Someone'
          } has assigned this task to you.</p>${details}${
            task.description ? `<p style="margin:14px 0 0">${task.description}</p>` : ''
          }`,
          { label: 'Open task', url },
        ),
        text: `Hello ${input.recipientName},\n\n${input.actorName ?? 'Someone'} assigned you: ${task.title}\n\n${textDetails}\n\nOpen: ${url}`,
      };
    case 'task-reminder':
      return {
        subject: `Task due ${task.dueDate ? formatIsoDate(task.dueDate) : 'soon'}: ${task.title}`,
        html: shell(
          `${task.title} is due soon`,
          `<p style="margin:0 0 12px">Hello ${input.recipientName},</p>${details}`,
          { label: 'Open task', url },
        ),
        text: `Hello ${input.recipientName},\n\n${task.title} is due soon.\n\n${textDetails}\n\nOpen: ${url}`,
      };
    case 'task-overdue':
      return {
        subject: `Overdue: ${task.title}`,
        html: shell(
          `${task.title} is overdue`,
          `<p style="margin:0 0 12px">Hello ${input.recipientName},</p><p style="margin:0 0 12px">This task is ${
            input.overdueDays ?? 1
          } day${(input.overdueDays ?? 1) === 1 ? '' : 's'} past its due date.</p>${details}`,
          { label: 'Update task', url },
        ),
        text: `Hello ${input.recipientName},\n\n${task.title} is ${input.overdueDays ?? 1} day(s) overdue.\n\n${textDetails}\n\nUpdate: ${url}`,
      };
    case 'task-completed':
      return {
        subject: `Completed: ${task.title}`,
        html: shell(
          `${task.title} is complete`,
          `<p style="margin:0 0 12px">Hello ${input.recipientName},</p><p style="margin:0 0 12px">${
            input.actorName ?? 'Someone'
          } marked this task complete.</p>${details}`,
          { label: 'Open task', url },
        ),
        text: `Hello ${input.recipientName},\n\n${input.actorName ?? 'Someone'} completed ${task.title}.\n\n${textDetails}`,
      };
    default:
      return { subject: task.title, html: shell(task.title, details, { label: 'Open', url }), text: textDetails };
  }
}

export function renderDecisionEmail(input: {
  decision: { title: string; reference: string; dueDate?: IsoDate | null; meetingTitle?: string | null; description?: string | null };
  recipientName: string;
  actorName?: string | null;
  baseUrl: string;
  decisionId: string;
}): RenderedEmail {
  const url = `${input.baseUrl}/office-hub/decisions/${input.decisionId}`;
  const details = [
    row('Reference', input.decision.reference),
    row('Due', input.decision.dueDate ? formatIsoDate(input.decision.dueDate) : 'No due date'),
    ...(input.decision.meetingTitle ? [row('From meeting', input.decision.meetingTitle)] : []),
  ].join('');

  return {
    subject: `Decision assigned: ${input.decision.title}`,
    html: shell(
      input.decision.title,
      `<p style="margin:0 0 12px">Hello ${input.recipientName},</p><p style="margin:0 0 12px">${
        input.actorName ?? 'Someone'
      } has made you the owner of this decision.</p>${details}${
        input.decision.description ? `<p style="margin:14px 0 0">${input.decision.description}</p>` : ''
      }`,
      { label: 'Open decision', url },
    ),
    text: `Hello ${input.recipientName},\n\nYou own decision ${input.decision.reference}: ${input.decision.title}\n\nOpen: ${url}`,
  };
}

export function renderMinutesEmail(input: {
  mom: MomDocument;
  recipientName: string;
  baseUrl: string;
  meetingId: string;
}): RenderedEmail {
  const { mom } = input;
  const url = `${input.baseUrl}/office-hub/meetings/${input.meetingId}/mom`;

  const actions = mom.actionItems.length
    ? `<table role="presentation" width="100%" cellpadding="6" cellspacing="0" style="margin-top:14px;border-collapse:collapse;font:400 13px/1.5 Segoe UI,Arial,sans-serif">
<tr style="background:#f9fafb"><th align="left" style="border:1px solid #e5e7eb">Action</th><th align="left" style="border:1px solid #e5e7eb">Responsible</th><th align="left" style="border:1px solid #e5e7eb">Due</th><th align="left" style="border:1px solid #e5e7eb">Status</th></tr>
${mom.actionItems
  .map(
    (item) =>
      `<tr><td style="border:1px solid #e5e7eb">${item.action}</td><td style="border:1px solid #e5e7eb">${item.responsible}</td><td style="border:1px solid #e5e7eb">${item.dueDate}</td><td style="border:1px solid #e5e7eb">${item.status}</td></tr>`,
  )
  .join('')}</table>`
    : '<p style="margin:14px 0 0;color:#6b7280">No action items were recorded.</p>';

  const decisions = mom.decisions.length
    ? `<div style="margin-top:14px"><div style="color:#6b7280;margin-bottom:4px">Decisions</div><ul style="margin:0;padding-left:20px">${mom.decisions
        .map((decision) => `<li>${decision.title} — ${decision.owner}</li>`)
        .join('')}</ul></div>`
    : '';

  return {
    subject: `Minutes: ${mom.meetingTitle} — ${mom.date}`,
    html: shell(
      `Minutes of ${mom.meetingTitle}`,
      `<p style="margin:0 0 12px">Hello ${input.recipientName},</p>${row('Date', mom.date)}${row('Time', mom.time)}${row(
        'Location',
        mom.location,
      )}${row('Organizer', mom.organizer)}${decisions}${actions}`,
      { label: 'Open minutes', url },
    ),
    text: `Hello ${input.recipientName},\n\nMinutes of ${mom.meetingTitle} (${mom.date}) are published.\n\nDecisions: ${mom.decisions.length}\nAction items: ${mom.actionItems.length}\n\nOpen: ${url}`,
  };
}

/** A calendar file's suggested download name. */
export const icsFileName = (title: string, date: IsoDate): string =>
  `${title.replace(/[^\w\-. ]+/g, '_').slice(0, 60) || 'meeting'}-${date}.ics`;

/** The office's public base URL, for links inside emails. Configured, never guessed. */
export function resolveBaseUrl(explicit?: string | null): string {
  if (explicit?.trim()) return explicit.trim().replace(/\/$/, '');
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  // Deliberately a relative-safe fallback rather than a hard-coded host: a wrong absolute URL in an
  // email is worse than a visibly incomplete one, because it looks like it should work.
  return '';
}

/** Next-meeting time, used by the "schedule follow-up" prompt in a published minutes email. */
export interface NextMeetingHint {
  date: IsoDate;
  time: ClockTime;
}

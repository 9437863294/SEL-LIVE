'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { cn } from '@/lib/utils';
import {
  formatSeconds,
  type AppCategory,
  type AttendanceStatus,
  type DeviceStatus,
  type PresenceState,
  type SessionStatus,
} from '@/lib/windows-agent';

/**
 * The module's shared visual vocabulary.
 *
 * Every badge here encodes a fact — a state the machine reported, a status an administrator set.
 * There is deliberately no component that renders a score, a rating or a traffic light over
 * somebody's hours: §19 and §22 both rule that out, and the way to keep a rule like that is to
 * not build the component that would break it.
 *
 * Colour follows the meaning rather than the mood. Idle is amber because it is worth noticing,
 * not because it is bad; an employee reading a report of their own day should not find the design
 * arguing with them.
 */

const PRESENCE_META: Record<PresenceState, { label: string; tone: StatusTone }> = {
  ACTIVE: { label: 'Active', tone: 'success' },
  IDLE: { label: 'Idle', tone: 'warning' },
  EXTENDED_IDLE: { label: 'Idle (extended)', tone: 'warning' },
  LOCKED: { label: 'Locked', tone: 'neutral' },
  OFFLINE: { label: 'Offline', tone: 'neutral' },
};

export function PresenceBadge({ presence, className }: { presence: PresenceState; className?: string }) {
  const meta = PRESENCE_META[presence] ?? PRESENCE_META.OFFLINE;
  return (
    <StatusBadge status={presence} tone={meta.tone} dot className={className}>
      {meta.label}
    </StatusBadge>
  );
}

const DEVICE_STATUS_META: Record<DeviceStatus, { label: string; tone: StatusTone }> = {
  PENDING: { label: 'Awaiting approval', tone: 'warning' },
  ACTIVE: { label: 'Active', tone: 'success' },
  BLOCKED: { label: 'Blocked', tone: 'danger' },
  DISABLED: { label: 'Disabled', tone: 'neutral' },
  MAINTENANCE: { label: 'Maintenance', tone: 'info' },
  RETIRED: { label: 'Retired', tone: 'neutral' },
};

export function DeviceStatusBadge({ status, className }: { status: DeviceStatus; className?: string }) {
  const meta = DEVICE_STATUS_META[status] ?? DEVICE_STATUS_META.DISABLED;
  return (
    <StatusBadge status={status} tone={meta.tone} className={className}>
      {meta.label}
    </StatusBadge>
  );
}

const SESSION_STATUS_META: Record<SessionStatus, { label: string; tone: StatusTone }> = {
  OPEN: { label: 'Open', tone: 'success' },
  CLOSED: { label: 'Closed', tone: 'neutral' },
  // Amber rather than red: an unclean end is usually a power cut, not a person's fault, and
  // colouring it as an error invites somebody to be asked to explain a thunderstorm.
  UNCLEAN_END: { label: 'Ended uncleanly', tone: 'warning' },
};

export function SessionStatusBadge({ status, className }: { status: SessionStatus; className?: string }) {
  const meta = SESSION_STATUS_META[status] ?? SESSION_STATUS_META.CLOSED;
  return (
    <StatusBadge status={status} tone={meta.tone} className={className}>
      {meta.label}
    </StatusBadge>
  );
}

const ATTENDANCE_TONE: Record<AttendanceStatus, StatusTone> = {
  Present: 'success',
  Late: 'warning',
  'Short Duration': 'info',
  'Incomplete Logout': 'warning',
  'Offline Session': 'progress',
};

export function AttendanceStatusBadge({ status, className }: { status: AttendanceStatus; className?: string }) {
  return (
    <StatusBadge status={status} tone={ATTENDANCE_TONE[status]} className={className}>
      {status}
    </StatusBadge>
  );
}

const CATEGORY_LABELS: Record<AppCategory, string> = {
  ERP: 'ERP',
  OFFICE: 'Office',
  COMMUNICATION: 'Communication',
  DEVELOPMENT: 'Development',
  REFERENCE: 'Reference',
  WORK: 'Work tools',
  SYSTEM: 'System',
  UNCLASSIFIED: 'Unclassified',
};

/** A category is a tag, not a state: one neutral chip for all of them. */
export function CategoryBadge({ category, className }: { category: AppCategory; className?: string }) {
  return (
    <Badge variant="neutral" className={className}>
      {CATEGORY_LABELS[category] ?? category}
    </Badge>
  );
}

export const categoryLabel = (category: AppCategory): string => CATEGORY_LABELS[category] ?? category;

/**
 * A duration, with the raw seconds always available on hover.
 *
 * §19 asks for measurements rather than judgements, and §20 asks reports to "still expose raw
 * time". A formatted total is easier to read and harder to check; keeping the exact figure one
 * hover away means nobody has to take the rounding on trust when a number is being questioned.
 */
export function Duration({
  seconds,
  className,
  muted,
}: {
  seconds: number | null | undefined;
  className?: string;
  muted?: boolean;
}) {
  const value = Math.max(0, Math.round(Number(seconds) || 0));
  return (
    <span
      className={cn('tabular-nums', muted && value === 0 && 'text-muted-foreground', className)}
      title={value.toLocaleString() + ' seconds'}
    >
      {formatSeconds(value)}
    </span>
  );
}

/**
 * A stacked bar of a day's buckets — active, idle, extended idle, locked.
 *
 * Proportional to the session, so the four segments always fill the bar exactly. That is not a
 * cosmetic choice: the buckets are built to partition the session (see `foldSpan`), and a bar
 * that failed to fill would mean the arithmetic was wrong, which makes this a visible check on it.
 */
export function ActivityBar({
  activeSeconds,
  idleSeconds,
  extendedIdleSeconds,
  lockedSeconds,
  className,
}: {
  activeSeconds: number;
  idleSeconds: number;
  extendedIdleSeconds: number;
  lockedSeconds: number;
  className?: string;
}) {
  const total = Math.max(1, activeSeconds + idleSeconds + extendedIdleSeconds + lockedSeconds);
  const segments = [
    { seconds: activeSeconds, className: 'bg-emerald-500', label: 'Active' },
    { seconds: idleSeconds, className: 'bg-amber-400', label: 'Idle' },
    { seconds: extendedIdleSeconds, className: 'bg-orange-400', label: 'Extended idle' },
    { seconds: lockedSeconds, className: 'bg-slate-300', label: 'Locked' },
  ].filter((segment) => segment.seconds > 0);

  return (
    <div className={cn('flex h-2 w-full overflow-hidden rounded-full bg-muted', className)}>
      {segments.map((segment) => (
        <div
          key={segment.label}
          className={segment.className}
          style={{ width: `${(segment.seconds / total) * 100}%` }}
          title={`${segment.label}: ${formatSeconds(segment.seconds)}`}
        />
      ))}
    </div>
  );
}

/** A person, with their department, linking to their activity page. */
export function PersonCell({
  userId,
  name,
  department,
  href,
}: {
  userId: string;
  name: string;
  department?: string | null;
  href?: string;
}) {
  const body = (
    <span className="flex flex-col">
      <span className="font-medium text-foreground">{name}</span>
      {department ? <span className="text-xs text-muted-foreground">{department}</span> : null}
    </span>
  );
  if (!href) return body;
  return (
    <Link href={href} className="hover:underline" prefetch={false}>
      {body}
    </Link>
  );
}

/**
 * A clock time in the office timezone.
 *
 * Every time in this module is rendered through here rather than through `toLocaleTimeString`,
 * because a manager in a different timezone reading a site office's attendance must see the
 * site's clock. Rendering in the browser's zone would show somebody arriving at 03:32.
 */
export function ClockTime({ value, className }: { value: string | Date | null | undefined; className?: string }) {
  if (!value) return <span className={cn('text-muted-foreground', className)}>—</span>;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return <span className={cn('text-muted-foreground', className)}>—</span>;
  return (
    <span className={cn('tabular-nums', className)} title={date.toISOString()}>
      {new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone: 'Asia/Kolkata',
      }).format(date)}
    </span>
  );
}

/**
 * "40 seconds ago" as a plain string, for the places that need the words rather than the element.
 *
 * Exported so a KPI card's hint and the table cell beside it cannot describe the same instant
 * differently — which is what happens the moment somebody writes a second version of this
 * ladder inline.
 */
export function relativeLabel(value: string | Date | null | undefined, now: Date): string {
  if (!value) return 'Never';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const seconds = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  return seconds < 45 ? 'Now'
    : seconds < 90 ? 'a minute ago'
    : seconds < 3600 ? `${Math.round(seconds / 60)} min ago`
    : seconds < 86_400 ? `${Math.round(seconds / 3600)} h ago`
    : `${Math.round(seconds / 86_400)} d ago`;
}

/** "40 seconds ago" / "Now", against a shared ticking clock. */
export function RelativeTime({
  value,
  now,
  className,
}: {
  value: string | Date | null | undefined;
  now: Date;
  className?: string;
}) {
  if (!value) return <span className={cn('text-muted-foreground', className)}>Never</span>;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return <span className={cn('text-muted-foreground', className)}>—</span>;

  const seconds = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  const text = relativeLabel(date, now);

  return (
    <span className={cn('tabular-nums', seconds > 600 && 'text-muted-foreground', className)} title={date.toISOString()}>
      {text}
    </span>
  );
}

/**
 * The note that appears on every screen showing somebody else's activity.
 *
 * §19 and §22 ask for measurements rather than performance judgements, and the most effective
 * place to say so is on the reports themselves — a policy document nobody opens does not stop a
 * manager reading "6h active" as a grade. Small, permanent, and not dismissible.
 */
export function MeasurementNotice({ className }: { className?: string }) {
  return (
    <p className={cn('text-xs text-muted-foreground', className)}>
      These figures measure computer use, not contribution. Time away from a keyboard covers
      meetings, site visits, phone calls and thinking. Read them alongside what the person is
      actually working on.
    </p>
  );
}

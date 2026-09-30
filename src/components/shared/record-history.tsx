'use client';

/**
 * Who did what to one record, and when — a compact timeline read straight from `userLogs`.
 *
 * Every write in the app is logged by `useActivityLogger` / `logUserActivity` with the record's
 * Firestore id (`recordId`) and its human reference (`recordRef` — a Reception No, a Request No).
 * Older rows carry only the reference, so both are queried and merged. Neither query has an
 * `orderBy`: `recordRef` has no composite index with `timestamp`, and one record's history is small
 * enough to sort here.
 *
 * The formatting helpers are exported for the module-wide audit log (`module-audit-log.tsx`), so a
 * change reads the same in the register and in a record's own history.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { format, formatDistanceToNow, isValid, parseISO } from 'date-fns';
import { collection, getDocs, limit, query, where, type QueryDocumentSnapshot } from 'firebase/firestore';
import { ChevronDown, ChevronRight, History } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { db } from '@/lib/firebase';
import { canonicalModuleName } from '@/lib/activity-modules';
import { cn } from '@/lib/utils';

// ─── shared log shape + helpers ───────────────────────────────────────────────

export interface AuditLogEntry {
  id: string;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  module: string;
  action: string;
  details: Record<string, any>;
  recordId: string | null;
  recordRef: string | null;
  source?: string | null;
  sessionId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  timestamp: { seconds: number; nanoseconds: number } | null;
}

export type FieldChange = { from: unknown; to: unknown };

/** A `userLogs` document with its module resolved to the current name. */
export const toAuditLog = (d: QueryDocumentSnapshot): AuditLogEntry => {
  const data = d.data();
  return { id: d.id, ...data, details: data.details ?? {}, module: canonicalModuleName(data.module) } as AuditLogEntry;
};

export const logDate = (log: Pick<AuditLogEntry, 'timestamp'>): Date | null =>
  log.timestamp?.seconds != null ? new Date(log.timestamp.seconds * 1000) : null;

export const logTime = (log: Pick<AuditLogEntry, 'timestamp'>): number => log.timestamp?.seconds ?? 0;

export const userLabel = (log: Pick<AuditLogEntry, 'userName' | 'userEmail' | 'userId'>): string =>
  log.userName || log.userEmail || log.userId?.slice(0, 8) || 'Unknown user';

/** "Ashish Kumar" → "AK"; an email falls back to its first letter. */
export const initialsOf = (name: string): string => {
  const parts = name.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

/** "netAmount" / "net_amount" → "Net amount". */
export const humanizeField = (key: string): string => {
  const words = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : key;
};

/** Update logs carry `details.changes` as `{ field: { from, to } }` (see diffFields). */
export const changesOf = (details: Record<string, any> | null | undefined): Array<[string, FieldChange]> => {
  const changes = details?.changes;
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return [];
  return Object.entries(changes).filter(
    ([, c]) => c && typeof c === 'object' && ('from' in (c as object) || 'to' in (c as object)),
  ) as Array<[string, FieldChange]>;
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** A Firestore Timestamp (live or serialised), Date or ISO string as a Date, with whether it has a time. */
const asDate = (value: unknown): { date: Date; hasTime: boolean } | null => {
  if (value instanceof Date) return isValid(value) ? { date: value, hasTime: true } : null;
  if (value && typeof value === 'object') {
    const maybe = value as { toDate?: () => Date; seconds?: unknown; nanoseconds?: unknown };
    let date: Date | null = null;
    if (typeof maybe.toDate === 'function') date = maybe.toDate();
    else if (typeof maybe.seconds === 'number' && typeof maybe.nanoseconds === 'number') date = new Date(maybe.seconds * 1000);
    if (!date || !isValid(date)) return null;
    // A day stored as a Timestamp lands on local midnight; showing 00:00 would be noise.
    return { date, hasTime: date.getHours() !== 0 || date.getMinutes() !== 0 };
  }
  if (typeof value === 'string' && (ISO_DAY.test(value) || ISO_DATE_TIME.test(value))) {
    const date = parseISO(value);
    return isValid(date) ? { date, hasTime: !ISO_DAY.test(value) } : null;
  }
  return null;
};

/** A logged value as a person would read it: dates as dates, numbers grouped, blanks as a dash. */
export const formatAuditValue = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : String(value);
  }
  const date = asDate(value);
  if (date) return format(date.date, date.hasTime ? 'dd MMM yyyy, HH:mm' : 'dd MMM yyyy');
  if (Array.isArray(value)) return value.length ? value.map(formatAuditValue).join(', ') : '—';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
};

export type ActionTone = 'emerald' | 'sky' | 'red' | 'amber' | 'violet' | 'slate';

export const ACTION_TONE_CLASSES: Record<ActionTone, string> = {
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  sky: 'border-sky-200 bg-sky-50 text-sky-700',
  red: 'border-red-200 bg-red-50 text-red-700',
  amber: 'border-amber-200 bg-amber-50 text-amber-800',
  violet: 'border-violet-200 bg-violet-50 text-violet-700',
  slate: 'border-slate-200 bg-slate-50 text-slate-700',
};

/**
 * The colour an action reads as, from its verb. Order matters: "Cancel" beats "Update", and
 * "Update Requisition Status" is a status move before it is an edit.
 */
export const actionTone = (action: string | null | undefined): ActionTone => {
  const a = action ?? '';
  if (/\b(delete|cancel|reject|remove|revers|revoke|void)/i.test(a)) return 'red';
  if (/\b(setting|config|serial|workflow|column|printing|field|seed|template)/i.test(a)) return 'violet';
  if (/\b(create|add|import|new|upload|raise)/i.test(a)) return 'emerald';
  if (/\b(status|mark|return|verify|send|move|receive|approve|forward|pay|submit|hold|release|complete|reopen)/i.test(a)) return 'amber';
  if (/\b(update|edit|change|rename|modify|set)\b/i.test(a)) return 'sky';
  return 'slate';
};

export function ActionPill({ action, className }: { action: string | null | undefined; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-tight',
        ACTION_TONE_CLASSES[actionTone(action)],
        className,
      )}
    >
      <span className="truncate">{action || '—'}</span>
    </span>
  );
}

/** Stable per-user avatar colour, so one person reads the same down the timeline. */
const AVATAR_TONES = [
  'bg-sky-100 text-sky-700',
  'bg-violet-100 text-violet-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-800',
  'bg-rose-100 text-rose-700',
  'bg-teal-100 text-teal-700',
  'bg-indigo-100 text-indigo-700',
];

export const avatarTone = (key: string): string => {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length];
};

// ─── the timeline ─────────────────────────────────────────────────────────────

/** Past this many characters a value is cut, with the whole of it in the tooltip. */
const VALUE_CAP = 80;

function Value({ value, tone }: { value: unknown; tone: 'from' | 'to' }) {
  const text = formatAuditValue(value);
  const cut = text.length > VALUE_CAP ? `${text.slice(0, VALUE_CAP)}…` : text;
  return (
    <span
      className={cn('break-words', tone === 'from' ? 'text-red-700 line-through decoration-red-300' : 'font-medium text-emerald-700')}
      title={text !== cut ? text : undefined}
    >
      {cut}
    </span>
  );
}

/** The few details worth a line when a log has no field-level changes (status moves, deletes). */
function detailLines(log: AuditLogEntry): Array<[string, ReactNode]> {
  const d = log.details ?? {};
  const lines: Array<[string, ReactNode]> = [];
  if ('from' in d || 'to' in d) {
    lines.push(['Status', <><Value value={d.from} tone="from" /> <span className="text-muted-foreground">→</span> <Value value={d.to} tone="to" /></>]);
  }
  for (const key of ['reason', 'remarks', 'note', 'notes', 'fileName', 'fileNames']) {
    if (d[key] !== undefined && d[key] !== null && d[key] !== '') lines.push([humanizeField(key), formatAuditValue(d[key])]);
  }
  return lines;
}

export interface RecordHistoryProps {
  /** Firestore id of the record. */
  recordId: string;
  /** Its human reference; older logs are found by this alone. */
  recordRef?: string | null;
  /** Only logs of this module (canonical name); all modules when omitted. */
  module?: string;
  className?: string;
}

/** Every logged action on one record, newest first. Fetches once, on mount. */
export function RecordHistory({ recordId, recordRef, module, className }: RecordHistoryProps) {
  const [logs, setLogs] = useState<AuditLogEntry[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const logsRef = collection(db, 'userLogs');
    const ref = recordRef?.trim();
    Promise.all([
      recordId ? getDocs(query(logsRef, where('recordId', '==', recordId), limit(300))) : null,
      ref ? getDocs(query(logsRef, where('recordRef', '==', ref), limit(300))) : null,
    ])
      .then((snaps) => {
        if (cancelled) return;
        const byId = new Map<string, AuditLogEntry>();
        snaps.forEach((snap) => snap?.docs.forEach((d) => byId.set(d.id, toAuditLog(d))));
        const wanted = module ? canonicalModuleName(module) : null;
        setLogs(
          [...byId.values()]
            .filter((l) => !wanted || l.module === wanted)
            .sort((a, b) => logTime(b) - logTime(a)),
        );
      })
      .catch((err) => {
        console.error('Could not load record history', err);
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [recordId, recordRef, module]);

  if (error) {
    return <p className={cn('text-xs text-red-700', className)}>Could not load the activity for this record.</p>;
  }

  if (!logs) {
    return (
      <div className={cn('space-y-3', className)} aria-busy="true">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!logs.length) {
    return (
      <div className={cn('flex items-center gap-2 rounded-lg border border-dashed px-3 py-4 text-xs text-muted-foreground', className)}>
        <History className="h-4 w-4 shrink-0" aria-hidden="true" />
        No activity recorded yet
      </div>
    );
  }

  return (
    <ol className={cn('relative space-y-4', className)}>
      {/* The rail behind the avatars. */}
      <span aria-hidden className="absolute bottom-2 left-[13px] top-2 w-px bg-slate-200" />
      {logs.map((log) => {
        const name = userLabel(log);
        const when = logDate(log);
        const changes = changesOf(log.details);
        const extra = changes.length ? [] : detailLines(log);
        return (
          <li key={log.id} className="relative flex gap-3">
            <span
              className={cn(
                'relative z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ring-2 ring-white',
                avatarTone(log.userId || name),
              )}
              title={log.userEmail ?? name}
              aria-hidden="true"
            >
              {initialsOf(name)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-sm">
                <span className="font-semibold text-slate-900">{name}</span>
                <span className="text-slate-600">{(log.action || 'did something').toLowerCase()}</span>
              </div>
              <div className="text-[11px] text-muted-foreground" title={when ? format(when, 'dd MMM yyyy, HH:mm:ss') : undefined}>
                {when ? (
                  <>
                    {formatDistanceToNow(when, { addSuffix: true })} · {format(when, 'dd MMM yyyy, HH:mm')}
                  </>
                ) : (
                  'Time not recorded'
                )}
              </div>
              {(changes.length > 0 || extra.length > 0) && (
                <ul className="mt-1.5 space-y-0.5 rounded-md bg-slate-50 px-2.5 py-1.5 text-xs">
                  {changes.map(([field, c]) => (
                    <li key={field} className="break-words">
                      <span className="text-slate-500">{humanizeField(field)}:</span>{' '}
                      <Value value={c.from} tone="from" /> <span className="text-muted-foreground">→</span> <Value value={c.to} tone="to" />
                    </li>
                  ))}
                  {extra.map(([label, value]) => (
                    <li key={label} className="break-words">
                      <span className="text-slate-500">{label}:</span> {value}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export interface RecordActivityProps extends RecordHistoryProps {
  /** Classes for the section — a dialog passes its own separator and spacing. */
  sectionClassName?: string;
  /** Classes for the "Activity" label, to match the dialog's section headings. */
  headingClassName?: string;
}

/**
 * A closed-by-default "Activity" section for a details dialog. The history is only fetched once
 * opened. Give it `key={recordId}` so moving to another record closes it again.
 */
export function RecordActivity({ sectionClassName, headingClassName, ...history }: RecordActivityProps) {
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <section aria-label="Activity" className={cn('no-print print:hidden', sectionClassName)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Chevron className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
        <span className={cn('text-xs font-semibold uppercase tracking-wide text-slate-500', headingClassName)}>Activity</span>
        <span className="text-xs text-muted-foreground">· {open ? 'hide history' : 'show history'}</span>
      </button>
      {open && <RecordHistory {...history} className="mt-3" />}
    </section>
  );
}

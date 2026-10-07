'use client';

import { useState } from 'react';
import { format, startOfDay } from 'date-fns';
import type { DropdownProps } from 'react-day-picker';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, ExternalLink, File as FileIcon, ShieldAlert, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { cn } from '@/lib/utils';
import type { Attachment } from '@/lib/types';
import {
  parseTypedDate,
  PERSONAL_STATE_LABEL,
  PROJECT_STATE_LABEL,
  type InstalmentState,
  type PersonalPolicyState,
  type ProjectPolicyState,
} from '@/lib/insurance';

/**
 * Small pieces the insurance pages share. Each page used to carry its own copy of the date picker,
 * the access-denied card and the status wording, and the copies had drifted apart.
 */

export function AccessDenied({ what }: { what: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-destructive" /> Access Denied
        </CardTitle>
        <CardDescription>You do not have permission to {what}.</CardDescription>
      </CardHeader>
    </Card>
  );
}

/** Month and year pickers as native selects: they scroll on every device and sit beside the arrows. */
function CalendarDropdown({ value, onChange, children, name, 'aria-label': ariaLabel }: DropdownProps) {
  return (
    <select
      name={name}
      aria-label={ariaLabel}
      value={value}
      onChange={onChange}
      className="h-8 cursor-pointer rounded-md border border-input bg-background px-2 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
    >
      {children}
    </select>
  );
}

const CALENDAR_CLASSES = {
  caption: 'flex items-center justify-between gap-2 px-1 pb-1',
  caption_dropdowns: 'flex items-center gap-1.5',
  caption_label: 'hidden',
  vhidden: 'sr-only',
  nav: 'flex items-center gap-1',
  nav_button_previous: 'static',
  nav_button_next: 'static',
};

/**
 * A date typed by hand or chosen from a calendar. Typing accepts DD/MM/YYYY and the other common
 * day-first forms (see `parseTypedDate`); the typed text is committed on blur or Enter, and a
 * date that is not real stays on screen, marked, rather than being silently dropped or rolled over.
 */
export function DateField({
  value,
  onChange,
  disabled,
  placeholder,
  fromYear = 1950,
  toYear = new Date().getFullYear() + 60,
  maxDate,
  className,
  id,
}: {
  value: Date | null | undefined;
  onChange: (date: Date | undefined) => void;
  disabled?: boolean;
  placeholder?: string;
  fromYear?: number;
  toYear?: number;
  /** Latest allowed day, e.g. today for a date of birth; later days are greyed out and refused when typed. */
  maxDate?: Date;
  className?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  // What is being typed; null while the field simply shows the current value.
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = draft ?? (value ? format(value, 'dd/MM/yyyy') : '');

  const commit = () => {
    if (draft === null) return;
    if (!draft.trim()) {
      onChange(undefined);
      setDraft(null);
      setError(null);
      return;
    }
    const parsed = parseTypedDate(draft);
    if (!parsed) { setError('Not a valid date — use DD/MM/YYYY'); return; }
    if (parsed.getFullYear() < fromYear || parsed.getFullYear() > toYear) {
      setError(`Year must be between ${fromYear} and ${toYear}`);
      return;
    }
    if (maxDate && startOfDay(parsed) > startOfDay(maxDate)) {
      setError(`Cannot be after ${format(maxDate, 'dd/MM/yyyy')}`);
      return;
    }
    onChange(parsed);
    setDraft(null);
    setError(null);
  };

  const pick = (date: Date | undefined) => {
    onChange(date);
    setDraft(null);
    setError(null);
    setOpen(false);
  };

  const today = new Date();
  const todayAllowed = today.getFullYear() >= fromYear && today.getFullYear() <= toYear
    && (!maxDate || startOfDay(today) <= startOfDay(maxDate));

  return (
    <div className={cn('space-y-1', className)}>
      <div className="relative">
        <Input
          id={id}
          value={shown}
          onChange={(e) => { setDraft(e.target.value); setError(null); }}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
          disabled={disabled}
          placeholder={placeholder ? `${placeholder} · DD/MM/YYYY` : 'DD/MM/YYYY'}
          inputMode="numeric"
          autoComplete="off"
          aria-invalid={!!error}
          className={cn('pr-10', error && 'border-destructive focus-visible:ring-destructive')}
        />
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={disabled}
              aria-label="Open calendar"
              className="absolute right-0.5 top-1/2 h-8 w-8 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <CalendarIcon className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <Calendar
              mode="single"
              selected={value ?? undefined}
              defaultMonth={value ?? undefined}
              onSelect={pick}
              captionLayout="dropdown-buttons"
              fromYear={fromYear}
              toYear={toYear}
              classNames={CALENDAR_CLASSES}
              disabled={maxDate ? { after: maxDate } : undefined}
              toDate={maxDate}
              components={{
                IconLeft: () => <ChevronLeft className="h-4 w-4" />,
                IconRight: () => <ChevronRight className="h-4 w-4" />,
                Dropdown: CalendarDropdown,
              }}
              initialFocus
            />
            <div className="flex items-center justify-between gap-2 border-t border-border/60 px-3 py-2">
              <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => pick(undefined)} disabled={!value}>
                Clear
              </Button>
              {todayAllowed && (
                <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => pick(startOfDay(today))}>
                  Today
                </Button>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>
      {error && <p className="text-xs font-medium text-destructive">{error}</p>}
    </div>
  );
}

const PERSONAL_TONE: Partial<Record<PersonalPolicyState, StatusTone>> = {
  grace: 'warning',
  'paid-up': 'info',
  claimed: 'success',
  surrendered: 'neutral',
};

export function PersonalStateBadge({ state, className }: { state: PersonalPolicyState; className?: string }) {
  const label = PERSONAL_STATE_LABEL[state];
  return <StatusBadge status={label} tone={PERSONAL_TONE[state]} className={className} />;
}

const PROJECT_TONE: Partial<Record<ProjectPolicyState, StatusTone>> = {
  expiring: 'warning',
  'not-required': 'neutral',
};

export function ProjectStateBadge({ state, className }: { state: ProjectPolicyState; className?: string }) {
  return <StatusBadge status={PROJECT_STATE_LABEL[state]} tone={PROJECT_TONE[state]} className={className} />;
}

const INSTALMENT_LABEL: Record<InstalmentState, { label: string; tone: StatusTone }> = {
  paid: { label: 'Paid', tone: 'success' },
  lapsed: { label: 'Lapsed', tone: 'danger' },
  grace: { label: 'In Grace', tone: 'warning' },
  'due-soon': { label: 'Due Soon', tone: 'warning' },
  due: { label: 'Due', tone: 'info' },
  upcoming: { label: 'Upcoming', tone: 'neutral' },
};

export function InstalmentBadge({ state }: { state: InstalmentState }) {
  const meta = INSTALMENT_LABEL[state];
  return <StatusBadge status={meta.label} tone={meta.tone} />;
}

/** Stored documents as links, each removable when `onRemove` is given. */
export function AttachmentList({
  attachments,
  onRemove,
  empty = 'No documents uploaded yet.',
}: {
  attachments: Attachment[];
  onRemove?: (index: number) => void;
  empty?: string;
}) {
  if (attachments.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="space-y-2">
      {attachments.map((file, i) => (
        <li key={`${file.url}-${i}`} className="flex min-w-0 items-center justify-between gap-2 rounded-md bg-muted p-2">
          <a
            href={file.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-w-0 items-center gap-2 text-sm hover:underline"
          >
            <FileIcon className="h-4 w-4 shrink-0" />
            <span className="truncate">{file.name}</span>
            <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
          </a>
          {onRemove && (
            <Button type="button" variant="ghost" size="icon" className="h-6 w-6 shrink-0" aria-label={`Remove ${file.name}`} onClick={() => onRemove(i)}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Files picked but not uploaded yet. */
export function PendingFiles({ files, onRemove }: { files: File[]; onRemove: (index: number) => void }) {
  if (files.length === 0) return null;
  return (
    <ul className="space-y-2">
      {files.map((file, i) => (
        <li key={`${file.name}-${i}`} className="flex min-w-0 items-center justify-between gap-2 rounded-md bg-muted p-2">
          <span className="flex min-w-0 items-center gap-2 text-sm">
            <FileIcon className="h-4 w-4 shrink-0" />
            <span className="truncate">{file.name}</span>
          </span>
          <Button type="button" variant="ghost" size="icon" className="h-6 w-6 shrink-0" aria-label={`Remove ${file.name}`} onClick={() => onRemove(i)}>
            <X className="h-4 w-4" />
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** A label over a value, for the summary cards on the detail pages. */
export function Fact({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="break-words font-semibold">{children}</div>
    </div>
  );
}

'use client';

import { format } from 'date-fns';
import { Calendar as CalendarIcon, ExternalLink, File as FileIcon, ShieldAlert, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { cn } from '@/lib/utils';
import type { Attachment } from '@/lib/types';
import {
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

/** A date chosen from a calendar popover; `type="button"` so it never submits the form it sits in. */
export function DateField({
  value,
  onChange,
  disabled,
  placeholder = 'Pick a date',
  fromYear = 1950,
  toYear = new Date().getFullYear() + 60,
  className,
  id,
}: {
  value: Date | null | undefined;
  onChange: (date: Date | undefined) => void;
  disabled?: boolean;
  placeholder?: string;
  fromYear?: number;
  toYear?: number;
  className?: string;
  id?: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn('w-full justify-start pl-3 text-left font-normal', !value && 'text-muted-foreground', className)}
        >
          {value ? format(value, 'dd MMM yyyy') : <span>{placeholder}</span>}
          <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value ?? undefined}
          defaultMonth={value ?? undefined}
          onSelect={onChange}
          captionLayout="dropdown-buttons"
          fromYear={fromYear}
          toYear={toYear}
          initialFocus
        />
      </PopoverContent>
    </Popover>
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

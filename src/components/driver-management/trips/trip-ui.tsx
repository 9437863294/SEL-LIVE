'use client';

/**
 * The trip-claims screens' shared pieces: money and distance, the status words, flag chips, the
 * claim's stage trail, and two pickers (one value from a long list, several people). Built on the
 * app's kit — StatusBadge, Popover/Command, Vehicle Management's segment look — so the screens
 * read like the rest of Driver Management.
 */

import { useState, type ReactNode } from 'react';
import { AlertTriangle, Check, ChevronsUpDown, CircleCheck, Clock, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { VM_SEGMENT_TRACK, vmSegmentItem } from '@/components/vehicle-management/vm-ui';
import { formatINR, formatINRCompact } from '@/lib/employee-trips/rates';
import { stageAge } from '@/lib/employee-trips/workflow';
import {
  CLAIM_STATUS_LABELS,
  FLAG_HINTS,
  FLAG_LABELS,
  OWNERSHIP_LABELS,
  TRIP_STATUS_LABELS,
  formatKm,
  type ClaimStatus,
  type FlagCode,
  type TripClaim,
  type TripStatus,
  type VehicleOwnership,
} from '@/lib/employee-trips/types';
import { cn } from '@/lib/utils';

export function Money({ value, compact = false, className }: { value: number | null | undefined; compact?: boolean; className?: string }) {
  return (
    <span className={cn('tabular-nums', className)} title={compact ? formatINR(value, { paise: true }) : undefined}>
      {compact ? formatINRCompact(value) : formatINR(value)}
    </span>
  );
}

export const Km = ({ value, className }: { value: number | null | undefined; className?: string }) => <span className={cn('tabular-nums', className)}>{formatKm(value)}</span>;

const TRIP_TONES: Record<TripStatus, StatusTone> = { draft: 'neutral', submitted: 'warning', approved: 'progress', rejected: 'danger', paid: 'success' };
const CLAIM_TONES: Record<ClaimStatus, StatusTone> = { pending: 'warning', approved: 'progress', paid: 'success', returned: 'warning', rejected: 'danger', withdrawn: 'neutral' };

export const TripStatusBadge = ({ status }: { status: TripStatus }) => <StatusBadge tone={TRIP_TONES[status]}>{TRIP_STATUS_LABELS[status]}</StatusBadge>;
export const ClaimStatusBadge = ({ status }: { status: ClaimStatus }) => <StatusBadge tone={CLAIM_TONES[status]}>{CLAIM_STATUS_LABELS[status]}</StatusBadge>;

export function FlagChips({ flags, className }: { flags: readonly FlagCode[]; className?: string }) {
  if (!flags.length) return null;
  return (
    <span className={cn('inline-flex flex-wrap gap-1', className)}>
      {flags.map((flag) => (
        <span key={flag} title={FLAG_HINTS[flag]} className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
          <AlertTriangle className="h-3 w-3" aria-hidden />
          {FLAG_LABELS[flag]}
        </span>
      ))}
    </span>
  );
}

export function VehicleLabel({ ownership, vehicleNumber, vehicleType, inline = false }: { ownership: VehicleOwnership; vehicleNumber: string; vehicleType: string; inline?: boolean }) {
  // One line for registers scanned row by row: "OD02AB1234 · Two Wheeler · Own".
  if (inline) {
    return (
      <span className="inline-flex min-w-0 items-baseline gap-1 whitespace-nowrap" title={`${vehicleNumber} · ${vehicleType} · ${OWNERSHIP_LABELS[ownership]}`}>
        <span className="font-medium text-slate-800">{vehicleNumber}</span>
        <span className="truncate text-xs text-muted-foreground">
          · {vehicleType} · {ownership === 'own' ? 'Own' : 'Company'}
        </span>
      </span>
    );
  }
  return (
    <span className="inline-flex min-w-0 flex-col">
      <span className="truncate font-medium text-slate-800">{vehicleNumber}</span>
      <span className="truncate text-[11px] text-muted-foreground">
        {vehicleType} · {OWNERSHIP_LABELS[ownership]}
      </span>
    </span>
  );
}

/** One label per short filter; the chosen one in the user's accent. */
export function SegmentTabs<T extends string>({ value, onChange, options, label }: { value: T; onChange: (next: T) => void; options: { value: T; label: string; count?: number }[]; label: string }) {
  return (
    <div role="tablist" aria-label={label} className={VM_SEGMENT_TRACK}>
      {options.map((option) => (
        <button key={option.value} type="button" role="tab" aria-selected={value === option.value} onClick={() => onChange(option.value)} className={vmSegmentItem(value === option.value)}>
          {option.label}
          {option.count !== undefined && <span className={cn('rounded-full px-1.5 text-[10px] tabular-nums', value === option.value ? 'bg-white/25' : 'bg-slate-200 text-slate-600')}>{option.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, required, error, hint, children, className, htmlFor }: { label: string; required?: boolean; error?: string; hint?: ReactNode; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={cn('min-w-0 space-y-1.5', className)}>
      <Label htmlFor={htmlFor} className="text-xs font-medium">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export interface PickOption {
  value: string;
  label: string;
  hint?: string;
}

/** One value from a long list, searchable — company vehicles, projects. */
export function SearchSelect({ options, value, onChange, placeholder = 'Choose…', emptyText = 'Nothing matches.', disabled, invalid, allowClear, id }: { options: PickOption[]; value: string | null; onChange: (next: string | null) => void; placeholder?: string; emptyText?: string; disabled?: boolean; invalid?: boolean; allowClear?: boolean; id?: string }) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" role="combobox" aria-expanded={open} disabled={disabled} className={cn('w-full justify-between bg-white text-left font-normal', invalid && 'border-destructive')}>
          <span className={cn('min-w-0 truncate', !selected && 'text-muted-foreground')}>{selected ? selected.label : placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(26rem,92vw)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search…" />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {allowClear && value && (
                <CommandItem value="__clear__" onSelect={() => { onChange(null); setOpen(false); }}>
                  <X className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden />
                  Clear
                </CommandItem>
              )}
              {options.map((option) => (
                <CommandItem key={option.value} value={`${option.label} ${option.hint ?? ''}`} onSelect={() => { onChange(option.value); setOpen(false); }}>
                  <Check className={cn('mr-2 h-4 w-4 shrink-0', option.value === value ? 'opacity-100' : 'opacity-0')} aria-hidden />
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{option.label}</span>
                    {option.hint && <span className="block truncate text-[11px] text-muted-foreground">{option.hint}</span>}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Several people, shown as removable chips under the picker. */
export function PeoplePicker({ users, value, onChange, disabled, placeholder = 'Add people…', invalid }: { users: { id: string; name: string; email?: string }[]; value: string[]; onChange: (next: string[]) => void; disabled?: boolean; placeholder?: string; invalid?: boolean }) {
  const [open, setOpen] = useState(false);
  const nameOf = (id: string) => users.find((user) => user.id === id)?.name ?? 'Unknown user';
  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" disabled={disabled} className={cn('w-full justify-between bg-white text-left font-normal', invalid && 'border-destructive')}>
            <span className="min-w-0 truncate text-muted-foreground">{value.length ? `${value.length} selected — add or remove` : placeholder}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(24rem,92vw)] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search people…" />
            <CommandList>
              <CommandEmpty>Nobody matches.</CommandEmpty>
              <CommandGroup>
                {users.map((user) => {
                  const checked = value.includes(user.id);
                  return (
                    <CommandItem key={user.id} value={`${user.name} ${user.email ?? ''}`} onSelect={() => onChange(checked ? value.filter((id) => id !== user.id) : [...value, user.id])}>
                      <Check className={cn('mr-2 h-4 w-4 shrink-0', checked ? 'opacity-100' : 'opacity-0')} aria-hidden />
                      <span className="min-w-0">
                        <span className="block truncate text-sm">{user.name}</span>
                        {user.email && <span className="block truncate text-[11px] text-muted-foreground">{user.email}</span>}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((id) => (
            <span key={id} className="inline-flex max-w-full items-center gap-1 rounded-full border border-slate-200 bg-slate-50 py-0.5 pl-2.5 pr-1 text-xs text-slate-700">
              <span className="truncate">{nameOf(id)}</span>
              {!disabled && (
                <button type="button" onClick={() => onChange(value.filter((entry) => entry !== id))} className="-my-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-slate-200" aria-label={`Remove ${nameOf(id)}`}>
                  <X className="h-3 w-3" aria-hidden />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const hoursText = (hours: number) => (hours < 1 ? 'under an hour' : hours < 48 ? `${Math.floor(hours)} h` : `${Math.floor(hours / 24)} days`);

/** Where the claim has been and where it waits: done stages with who and when, the current one with its people and age. */
export function StageTrail({ claim }: { claim: TripClaim }) {
  const active = claim.status === 'pending' || claim.status === 'approved';
  const age = stageAge(claim);
  return (
    <ol className="space-y-3">
      {claim.stages.map((stage, index) => {
        const done = index < claim.currentStageIndex || claim.status === 'paid';
        const current = active && index === claim.currentStageIndex;
        const entry = [...claim.history].reverse().find((item) => item.stageName === stage.name && (item.action === 'approved' || item.action === 'paid'));
        const stopped = !active && !done && index === claim.currentStageIndex && claim.status !== 'paid';
        const stopEntry = stopped ? [...claim.history].reverse().find((item) => item.action === 'returned' || item.action === 'rejected' || item.action === 'withdrawn') : null;
        return (
          <li key={stage.id} className="flex gap-3">
            <span
              className={cn(
                'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold',
                done ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : current ? (age.overdue ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-amber-200 bg-amber-50 text-amber-700') : stopped ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-slate-200 bg-white text-slate-400',
              )}
              aria-hidden
            >
              {done ? <CircleCheck className="h-3.5 w-3.5" /> : current ? <Clock className="h-3.5 w-3.5" /> : stopped ? <X className="h-3.5 w-3.5" /> : index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-800">{stage.name}</p>
              {done && entry ? (
                <p className="text-xs text-muted-foreground">
                  {entry.action === 'paid' ? 'Paid' : 'Approved'} by {entry.byName}
                  {entry.override ? ' (override)' : ''} · {new Date(entry.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                </p>
              ) : current ? (
                <p className={cn('text-xs', age.overdue ? 'text-rose-700' : 'text-muted-foreground')}>
                  {stage.assigneeNames.length ? `Waiting for ${stage.assigneeNames.join(', ')}` : 'Nobody else is assigned — an administrator with Override must act'} · {hoursText(age.hours)}
                  {age.overdue ? ' · overdue' : ''}
                </p>
              ) : stopEntry ? (
                <p className="text-xs text-rose-700">
                  {stopEntry.action === 'withdrawn' ? 'Withdrawn' : stopEntry.action === 'returned' ? 'Sent back' : 'Rejected'} by {stopEntry.byName}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">{stage.assigneeNames.join(', ') || 'Not assigned'}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The four steps from a trip to a payment, in one line. Trips and claims are different things — a
 * claim holds one or more trips — and the screens that record and claim them say so up front.
 */
export function ClaimSteps({ approvalName = 'Approval', paymentName = 'Payment' }: { approvalName?: string; paymentName?: string }) {
  const steps = ['Record your trips', 'Create a claim with one or more trips', approvalName, paymentName];
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600" aria-label="How trips are paid">
      {steps.map((step, index) => (
        <li key={step} className="flex items-center gap-2">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">{index + 1}</span>
          <span className={cn(index === 1 && 'font-semibold text-slate-800')}>{step}</span>
          {index < steps.length - 1 && <span className="text-slate-300" aria-hidden>→</span>}
        </li>
      ))}
    </ol>
  );
}

export function LoadingBlock() {
  return (
    <div className="space-y-3" aria-busy="true">
      <Skeleton className="h-16 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <AlertTriangle className="h-8 w-8 text-amber-500" aria-hidden />
        <p className="max-w-md text-sm text-slate-700">{message}</p>
        {onRetry && (
          <Button type="button" variant="outline" onClick={onRetry}>
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden />
            Try again
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function EmptyBlock({ icon: Icon, title, children }: { icon: React.ComponentType<{ className?: string }>; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-200 bg-white/60 px-4 py-12 text-center">
      <Icon className="h-8 w-8 text-slate-300" />
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {children && <div className="max-w-md text-xs text-muted-foreground">{children}</div>}
    </div>
  );
}

export const shortDate = (value: string | null | undefined) => {
  if (!value) return '—';
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

/** A list as CSV, downloaded — every value quoted, so commas and line breaks in places survive. */
export function downloadCsv(fileName: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const cell = (value: string | number | null | undefined) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const text = [header, ...rows].map((row) => row.map(cell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`﻿${text}`], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

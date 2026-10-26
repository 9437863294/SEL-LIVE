'use client';

/**
 * Small shared pieces of the fleet screens — status badges, flag chips, the daily-km meter, photo
 * capture and display, empty and restricted states — so the driver, manager and admin screens say
 * the same thing the same way.
 *
 * Badges render a <div> (memory: badge-is-a-div): keep them out of <p> and Dialog descriptions.
 * Photos are fetched with the caller's token (the `fleet/` Storage prefix is closed to browsers)
 * and shown from object URLs created and revoked by the same effect, so React's double-mount in
 * development never leaves a revoked URL on screen.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Camera, ImageOff, Loader2, Lock, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { BLOCKING_FLAGS } from '@/lib/fleet/trips';
import {
  APPROVAL_STATUS_LABELS,
  FLEET_TRIP_STATUS_LABELS,
  FUEL_FLAG_LABELS,
  TRIP_FLAG_HINTS,
  TRIP_FLAG_LABELS,
  round1,
  type ApprovalStatus,
  type FleetTripStatus,
  type FuelFlagCode,
  type TripFlagCode,
} from '@/lib/fleet/types';
import { cn } from '@/lib/utils';
import { fetchFleetBlob, fleetErrorMessage } from './fleet-api';
import { compressPhoto } from './photo';

/* ── badges and chips ── */

const TRIP_TONES: Record<FleetTripStatus, StatusTone> = {
  running: 'progress',
  paused: 'warning',
  completed: 'success',
  pending_review: 'warning',
  cancelled: 'neutral',
};

export function TripStatusBadge({ status }: { status: FleetTripStatus }) {
  return (
    <StatusBadge tone={TRIP_TONES[status]} dot={status === 'running'}>
      {FLEET_TRIP_STATUS_LABELS[status]}
    </StatusBadge>
  );
}

const APPROVAL_TONES: Record<ApprovalStatus, StatusTone> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  expired: 'neutral',
  cancelled: 'neutral',
  used: 'info',
};

export function ApprovalStatusBadge({ status }: { status: ApprovalStatus }) {
  return (
    <StatusBadge tone={APPROVAL_TONES[status]} dot={status === 'pending'}>
      {APPROVAL_STATUS_LABELS[status]}
    </StatusBadge>
  );
}

const chip = 'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold';

/** Flags on a trip. The ones that hold a trip for review are red; the rest are amber notes. */
export function TripFlagChips({ flags, className }: { flags: readonly TripFlagCode[]; className?: string }) {
  if (!flags.length) return null;
  return (
    <span className={cn('inline-flex flex-wrap gap-1', className)}>
      {flags.map((flag) => (
        <span
          key={flag}
          title={TRIP_FLAG_HINTS[flag]}
          className={cn(chip, BLOCKING_FLAGS.includes(flag) ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-amber-200 bg-amber-50 text-amber-800')}
        >
          <AlertTriangle className="h-3 w-3" aria-hidden />
          {TRIP_FLAG_LABELS[flag]}
        </span>
      ))}
    </span>
  );
}

export function FuelFlagChips({ flags, className }: { flags: readonly FuelFlagCode[]; className?: string }) {
  if (!flags.length) return null;
  return (
    <span className={cn('inline-flex flex-wrap gap-1', className)}>
      {flags.map((flag) => (
        <span key={flag} className={cn(chip, 'border-amber-200 bg-amber-50 text-amber-800')}>
          <AlertTriangle className="h-3 w-3" aria-hidden />
          {FUEL_FLAG_LABELS[flag]}
        </span>
      ))}
    </span>
  );
}

/* ── the day's km against the limit ── */

/**
 * Today's km on a vehicle: what has run, the trip about to start, and the line it may not cross.
 * The allowance is the limit, or more when a manager approved extra running for today.
 */
export function KmLimitMeter({
  usedKm,
  allowedKm,
  limitKm,
  expectedKm = 0,
  compact = false,
}: {
  usedKm: number;
  allowedKm: number;
  limitKm: number;
  expectedKm?: number;
  compact?: boolean;
}) {
  const scale = Math.max(allowedKm, limitKm, usedKm + expectedKm, 1);
  const pct = (value: number) => `${Math.min(100, Math.max(0, (value / scale) * 100))}%`;
  const over = usedKm + expectedKm > allowedKm + 0.05;
  const left = Math.max(0, allowedKm - usedKm);
  const fmt = (value: number) => round1(value).toLocaleString('en-IN', { maximumFractionDigits: 1 });
  return (
    <div className="min-w-0 space-y-1">
      {!compact && (
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs">
          <span className="font-medium text-slate-700">
            <span className="tabular-nums">{fmt(usedKm)}</span> of <span className="tabular-nums">{fmt(allowedKm)}</span> km today
          </span>
          <span className={cn('tabular-nums', over ? 'font-semibold text-rose-700' : 'text-muted-foreground')}>
            {over && expectedKm > 0 ? `${fmt(usedKm + expectedKm - allowedKm)} km over with this trip` : `${fmt(left)} km left`}
          </span>
        </div>
      )}
      <div
        className={cn('relative w-full overflow-hidden rounded-full bg-slate-100', compact ? 'h-1.5' : 'h-2.5')}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={allowedKm}
        aria-valuenow={round1(usedKm)}
        aria-label={`${fmt(usedKm)} of ${fmt(allowedKm)} km today`}
      >
        <div className={cn('absolute inset-y-0 left-0 rounded-full', usedKm > allowedKm ? 'bg-rose-500' : usedKm > allowedKm * 0.85 ? 'bg-amber-500' : 'bg-emerald-500')} style={{ width: pct(usedKm) }} />
        {expectedKm > 0 && (
          <div className={cn('absolute inset-y-0 opacity-70', over ? 'bg-rose-300' : 'bg-sky-400')} style={{ left: pct(usedKm), width: pct(expectedKm) }} />
        )}
        <div className="absolute inset-y-0 w-0.5 bg-slate-700" style={{ left: `calc(${pct(limitKm)} - 1px)` }} title={`Daily limit ${fmt(limitKm)} km`} />
        {allowedKm > limitKm && (
          <div className="absolute inset-y-0 w-0.5 bg-emerald-700" style={{ left: `calc(${pct(allowedKm)} - 1px)` }} title={`Approved for today: ${fmt(allowedKm)} km`} />
        )}
      </div>
      {compact && (
        <div className="text-[11px] tabular-nums text-muted-foreground">
          {fmt(usedKm)}/{fmt(allowedKm)} km
        </div>
      )}
    </div>
  );
}

/* ── photos ── */

/** A blob shown as a data URL, read by the effect for the blob it was given. */
function useBlobPreview(value: Blob | null): string | null {
  const [preview, setPreview] = useState<{ blob: Blob; url: string } | null>(null);
  useEffect(() => {
    if (!value || !value.type.startsWith('image/')) return undefined;
    let cancelled = false;
    const reader = new FileReader();
    reader.onload = () => {
      if (!cancelled) setPreview({ blob: value, url: String(reader.result) });
    };
    reader.readAsDataURL(value);
    return () => {
      cancelled = true;
    };
  }, [value]);
  return preview && preview.blob === value ? preview.url : null;
}

/**
 * Take a photo (the rear camera on a phone; a file picker on a computer), shrunk before it is held.
 * The parent holds the Blob and uploads it with the record.
 */
export function PhotoCapture({
  label,
  value,
  onChange,
  required = false,
  accept = 'image/*',
  hint,
  disabled = false,
}: {
  label: string;
  value: Blob | null;
  onChange: (blob: Blob | null) => void;
  required?: boolean;
  accept?: string;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const preview = useBlobPreview(value);
  const isPdf = value?.type === 'application/pdf';

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      onChange(await compressPhoto(file));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="min-w-0 space-y-1.5">
      <label htmlFor={inputId} className="text-xs font-medium text-slate-700">
        {label}
        {required && <span className="text-rose-600"> *</span>}
      </label>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={accept}
        capture="environment"
        className="sr-only"
        disabled={disabled || busy}
        onChange={(event) => void pick(event.target.files?.[0])}
      />
      {value ? (
        <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-2">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- a local data URL, not an optimisable asset
            <img src={preview} alt={label} className="h-16 w-16 shrink-0 rounded-md object-cover" />
          ) : (
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md bg-slate-100 text-[10px] font-semibold text-slate-500">{isPdf ? 'PDF' : '…'}</div>
          )}
          <div className="min-w-0 flex-1 text-xs text-muted-foreground">
            <div className="truncate font-medium text-slate-700">{isPdf ? 'Bill attached (PDF)' : 'Photo ready'}</div>
            <div>{Math.max(1, Math.round(value.size / 1024)).toLocaleString('en-IN')} KB</div>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button type="button" variant="outline" size="sm" disabled={disabled || busy} onClick={() => inputRef.current?.click()} aria-label={`Retake ${label}`}>
              <RotateCcw className="h-4 w-4" aria-hidden />
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={disabled || busy} onClick={() => onChange(null)} aria-label={`Remove ${label}`}>
              <X className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" variant="outline" className="h-auto w-full justify-start gap-2 border-dashed py-3" disabled={disabled || busy} onClick={() => inputRef.current?.click()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Camera className="h-4 w-4" aria-hidden />}
          {busy ? 'Preparing photo…' : 'Take photo'}
        </Button>
      )}
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

/** A stored photo (odometer, bill), fetched with the caller's token; tap to see it full size. */
export function FleetPhoto({ uploadId, alt, className }: { uploadId: string | null; alt: string; className?: string }) {
  const [shown, setShown] = useState<{ id: string; url: string; type: string } | null>(null);
  const [failed, setFailed] = useState<{ id: string; message: string } | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!uploadId) return undefined;
    let cancelled = false;
    let created: string | null = null;
    fetchFleetBlob(`uploads/${encodeURIComponent(uploadId)}`)
      .then((blob) => {
        if (cancelled) return;
        created = URL.createObjectURL(blob);
        setShown({ id: uploadId, url: created, type: blob.type });
      })
      .catch((error: unknown) => {
        if (!cancelled) setFailed({ id: uploadId, message: fleetErrorMessage(error, 'Could not load the photo.') });
      });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [uploadId]);

  const frame = cn('flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50', className);
  if (!uploadId) {
    return (
      <div className={frame} title="No photo">
        <ImageOff className="h-5 w-5 text-slate-300" aria-label="No photo" />
      </div>
    );
  }
  const current = shown?.id === uploadId ? shown : null;
  const error = failed?.id === uploadId ? failed.message : null;
  if (!current) {
    return (
      <div className={frame} title={error ?? 'Loading'}>
        {error ? <ImageOff className="h-5 w-5 text-slate-300" aria-label={error} /> : <Loader2 className="h-5 w-5 animate-spin text-slate-300" aria-label="Loading photo" />}
      </div>
    );
  }
  if (current.type === 'application/pdf') {
    return (
      <a href={current.url} target="_blank" rel="noreferrer" className={cn(frame, 'text-xs font-semibold text-slate-600 no-underline hover:bg-slate-100')}>
        PDF
      </a>
    );
  }
  return (
    <>
      <button type="button" className={cn(frame, 'p-0')} onClick={() => setOpen(true)} aria-label={`Open ${alt}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- an authenticated object URL */}
        <img src={current.url} alt={alt} className="h-full w-full object-cover" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>{alt}</DialogTitle>
          </DialogHeader>
          {/* eslint-disable-next-line @next/next/no-img-element -- an authenticated object URL */}
          <img src={current.url} alt={alt} className="keep-light max-h-[75vh] w-full rounded-lg object-contain" />
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ── empty and restricted ── */

export function FleetEmpty({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-200 px-4 py-10 text-center">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {description && <div className="max-w-md text-xs text-muted-foreground">{description}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function FleetRestricted({ message = 'You do not have access to this part of the fleet.' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-10 text-center">
      <Lock className="h-6 w-6 text-slate-300" aria-hidden />
      <p className="text-sm font-semibold text-slate-800">Access restricted</p>
      <div className="max-w-md text-xs text-muted-foreground">{message}</div>
    </div>
  );
}

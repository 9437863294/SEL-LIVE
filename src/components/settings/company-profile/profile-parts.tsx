'use client';

/**
 * The pieces of Settings › Company Profile that every tab shares: the labelled field with its
 * check, the company card at the top, the A4 preview, the save bar and the loading state. They
 * draw what they are given; the editor (profile-editor.tsx) holds the draft.
 */

import type { ComponentProps, ReactNode } from 'react';
import { AlertTriangle, Loader2, MapPin, Save, XCircle, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { PreviewToggle } from '@/components/appearance/controls';
import { LetterheadA4Preview } from '@/components/shared/letterhead-designer';
import { formatCompanyAddress, primaryGstin, type CompanyProfile } from '@/lib/company-profile';
import type { ProfileArea, ProfileIssue } from '@/lib/company-profile-checks';
import { cn } from '@/lib/utils';

/** The element id of a field, from its name in the checks (`gst.2` → `cp-gst-2`). */
export const fieldDomId = (field: string) => `cp-${field.replace(/\./g, '-')}`;

/** A control's outline while its value would be dropped on save. */
export const INVALID_CONTROL = 'border-rose-400 focus-visible:ring-rose-400';

export const AREA_LABEL: Record<ProfileArea, string> = {
  details: 'Details',
  gst: 'GST',
  letterhead: 'Letterhead',
  print: 'Print',
};

/** What a control needs to be named by its field and described by its check or hint. */
export function controlProps(field: string, issue?: ProfileIssue, hasHint = false) {
  const id = fieldDomId(field);
  return {
    id,
    'aria-invalid': issue?.severity === 'error' ? true : undefined,
    'aria-describedby': issue || hasHint ? `${id}-note` : undefined,
  };
}

/**
 * A label over its control, with the check under it: red when Save would drop the value, amber for
 * a note, else the hint. `status` sits at the label's end (a "Valid" mark).
 */
export function ProfileField({
  field,
  label,
  hint,
  issue,
  status,
  children,
  className,
}: {
  field: string;
  label: string;
  hint?: ReactNode;
  issue?: ProfileIssue;
  status?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const id = fieldDomId(field);
  const Icon = issue?.severity === 'error' ? XCircle : AlertTriangle;
  return (
    <div className={cn('min-w-0 space-y-1.5', className)}>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <Label htmlFor={id} className="text-xs font-semibold">{label}</Label>
        {status}
      </div>
      {children}
      {issue ? (
        <p id={`${id}-note`} className={cn('flex items-start gap-1 text-[11px] leading-snug', issue.severity === 'error' ? 'text-rose-600' : 'text-amber-700')}>
          <Icon className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="min-w-0">{issue.message}</span>
        </p>
      ) : hint ? (
        <div id={`${id}-note`} className="text-[11px] leading-snug text-muted-foreground">{hint}</div>
      ) : null}
    </div>
  );
}

/** An input with a small icon inside its left edge. */
export function IconInput({ icon: Icon, className, ...props }: ComponentProps<typeof Input> & { icon: LucideIcon }) {
  return (
    <div className="relative">
      <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input className={cn('pl-9', className)} {...props} />
    </div>
  );
}

/** Two stacks of sections side by side on a wide screen; one column below `xl`, or with `single`. */
export function ProfileColumns({ single, children }: { single: boolean; children: [ReactNode, ReactNode] }) {
  return (
    <div className={cn('grid grid-cols-1 gap-4', !single && 'xl:grid-cols-2 xl:items-start')}>
      <div className="min-w-0 space-y-4">{children[0]}</div>
      <div className="min-w-0 space-y-4">{children[1]}</div>
    </div>
  );
}

/** An email or web address that may wrap after its `@`, dots and slashes, rather than mid-word. */
function breakable(text: string): ReactNode {
  return text.split(/(?<=[@./])/).map((part, index) => (
    <span key={index}>
      {index > 0 && <wbr />}
      {part}
    </span>
  ));
}

function initials(name: string): string {
  const letters = name.replace(/[^A-Za-z0-9]/g, '');
  return (letters.length <= 3 ? letters : name.split(/\s+/).filter(Boolean).map((word) => word[0]).join('')).slice(0, 3).toUpperCase() || '?';
}

/**
 * The company as its documents name it: logo, names, address, and the numbers that print. Drawn
 * from the draft as Save would store it, so it changes as the person types.
 */
export function CompanyProfileCard({ profile, logoFromBranding }: { profile: CompanyProfile; logoFromBranding: boolean }) {
  const accent = profile.design.letterhead.accentColor;
  const primary = primaryGstin(profile);
  const registration = profile.gstRegistrations.find((entry) => entry.gstin === primary);
  const others = profile.gstRegistrations.length - (primary ? 1 : 0);
  const facts: { label: string; value: string | null; hint?: string; code?: boolean; address?: boolean }[] = [
    {
      label: 'GSTIN',
      value: primary,
      hint: registration ? [registration.label || registration.state, others > 0 && `+${others} more`].filter(Boolean).join(' · ') : undefined,
      code: true,
    },
    { label: 'CIN', value: profile.cin, code: true },
    { label: 'PAN', value: profile.pan, code: true },
    { label: 'Phone', value: profile.phone },
    { label: 'Email', value: profile.email, address: true },
    { label: 'Website', value: profile.website, address: true },
  ];
  return (
    <Card className="min-w-0 overflow-hidden">
      {/* The letterhead's accent colour, fading out, so the card reads as the company's own. */}
      <div className="h-1" style={{ backgroundImage: `linear-gradient(90deg, ${accent}, ${accent}b3 45%, ${accent}00)` }} aria-hidden="true" />
      <div className="flex min-w-0 items-start gap-3 p-4 sm:items-center sm:gap-4">
        <div className="w-20 shrink-0 sm:w-28">
          {/* White under the logo whatever the theme: logos are drawn for paper. */}
          <div className="keep-light flex h-12 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white p-1.5 sm:h-16">
            {profile.logoUrl ? (
              // A Storage download URL; next/image would need the bucket allow-listed.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.logoUrl} alt={`${profile.shortName} logo`} className="max-h-full max-w-full object-contain" />
            ) : (
              <span className="text-xl font-black tracking-wider" style={{ color: accent }}>{initials(profile.shortName)}</span>
            )}
          </div>
          {logoFromBranding && <p className="mt-1 text-center text-[10px] text-muted-foreground">Branding logo</p>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="min-w-0 break-words text-base font-bold leading-tight sm:text-xl">{profile.legalName}</h2>
            <Badge variant="neutral" className="font-mono">{profile.shortName}</Badge>
          </div>
          {profile.tagline && <p className="mt-0.5 break-words text-sm text-muted-foreground">{profile.tagline}</p>}
          <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
            <MapPin className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 break-words">{formatCompanyAddress(profile, { singleLine: true, includeCountry: true })}</span>
          </p>
        </div>
      </div>
      {/* Hairlines between the cells: the grid's gap shows the border colour behind them. */}
      <dl className="grid grid-cols-2 gap-px border-t bg-border sm:grid-cols-3 xl:grid-cols-6">
        {facts.map(({ label, value, hint, code, address }) => (
          <div key={label} className="min-w-0 bg-card px-3 py-2.5 sm:px-4">
            <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
            {/* A CIN is 21 characters: small enough to fit half a phone's width on one line. */}
            <dd className={cn('mt-0.5 font-medium leading-snug', code ? 'break-all font-mono text-xs sm:text-[13px]' : 'break-words text-sm')}>
              {value ? (address ? breakable(value) : value) : <span className="font-sans text-sm font-normal italic text-muted-foreground">Not set</span>}
            </dd>
            {value && hint && <dd className="truncate text-[11px] text-muted-foreground">{hint}</dd>}
          </div>
        ))}
      </dl>
    </Card>
  );
}

/** The A4 sample on a grey desk, with the button that puts it away. */
export function DocumentPreviewPanel({ profile, onHide, className }: { profile: CompanyProfile; onHide: () => void; className?: string }) {
  return (
    <section aria-label="Preview" className={cn('min-w-0 rounded-xl border bg-card p-3 shadow-sm', className)}>
      <div className="mb-2.5 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Preview</p>
          <p className="text-xs text-muted-foreground">A sample voucher, with your unsaved changes.</p>
        </div>
        <PreviewToggle visible onToggle={() => onHide()} className="shrink-0" />
      </div>
      <div className="rounded-lg bg-muted/60 p-3">
        <LetterheadA4Preview profile={profile} />
      </div>
    </section>
  );
}

function listOf(words: string[]): string {
  return words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/**
 * The bar that follows the page while anything is unsaved: where the changes are, what must be
 * fixed before Save (each a link to its field), Discard and Save. `sticky bottom-0` also tells the
 * phone's floating bar to step aside (FloatingBottomNav's action-bar rule).
 */
export function ProfileSaveBar({
  areas,
  issues,
  saving,
  saveLabel,
  onSave,
  onDiscard,
  onGoTo,
}: {
  areas: ProfileArea[];
  issues: ProfileIssue[];
  saving: boolean;
  saveLabel: string;
  onSave: () => void;
  onDiscard: () => void;
  onGoTo: (issue: ProfileIssue) => void;
}) {
  const errors = issues.filter((issue) => issue.severity === 'error');
  const notes = issues.length - errors.length;
  return (
    <div className="sticky bottom-0 z-30 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-2">
      <div role="region" aria-label="Unsaved changes" className="flex flex-col gap-2 rounded-xl border bg-background/95 px-3 py-2.5 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:gap-4 sm:px-4">
        <div className="min-w-0 flex-1" aria-live="polite">
          <p className="flex flex-wrap items-center gap-x-1.5 text-sm font-medium">
            <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
            Unsaved changes
            <span className="font-normal text-muted-foreground">in {listOf(areas.map((area) => AREA_LABEL[area]))}</span>
          </p>
          {errors.length > 0 ? (
            <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-rose-600">
              <span>Fix before saving:</span>
              {errors.slice(0, 4).map((issue) => (
                <button
                  key={issue.field}
                  type="button"
                  onClick={() => onGoTo(issue)}
                  className="rounded font-semibold underline underline-offset-2 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {issue.label}
                </button>
              ))}
              {errors.length > 4 && <span>and {errors.length - 4} more</span>}
            </p>
          ) : notes > 0 ? (
            <p className="mt-0.5 text-xs text-amber-700">
              {notes === 1 ? '1 note' : `${notes} notes`} on the fields marked in amber.{' '}
              <button type="button" onClick={() => onGoTo(issues[0])} className="rounded font-semibold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Show
              </button>
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2">
          <Button variant="ghost" onClick={onDiscard} disabled={saving}>Discard</Button>
          <Button onClick={onSave} disabled={saving || errors.length > 0} action="save">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="mr-2 h-4 w-4" aria-hidden="true" />}
            {saveLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** The page's place while the profile loads, shaped like it: header, card, tabs, form and preview. */
export function CompanyProfileSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <span className="sr-only">Loading…</span>
      <div className="flex items-start gap-3" aria-hidden="true">
        <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-6 w-48 max-w-full rounded-md" />
          <Skeleton className="h-4 w-80 max-w-full rounded-md" />
        </div>
      </div>
      <Skeleton className="h-44 w-full rounded-xl" aria-hidden="true" />
      <Skeleton className="h-10 w-full max-w-md rounded-xl" aria-hidden="true" />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,25rem)]" aria-hidden="true">
        <Skeleton className="h-96 rounded-xl" />
        <Skeleton className="hidden h-[34rem] rounded-xl xl:block" />
      </div>
    </div>
  );
}

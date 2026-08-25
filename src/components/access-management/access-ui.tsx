'use client';

/**
 * Atoms specific to access management.
 *
 * Everything generic — page headers, KPI cards, the responsive register, the mobile dialog classes —
 * comes from `@/components/hr/hr-ui`, which is the app's shared kit despite the prefix. Only the
 * pieces that mean something about *access* live here: the source badge that answers "where did
 * this permission come from", the risk badges, and the two small readouts the preview screens rely
 * on.
 */

import * as React from 'react';
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  Check,
  FolderKanban,
  BadgeCheck,
  KeyRound,
  Layers,
  Minus,
  ShieldCheck,
  Sparkles,
  UserCog,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  formatGrantDate,
  splitPermissionKey,
  type AccessSourceKind,
  type PermissionSource,
  type PrivilegeFinding,
  type SodConflict,
} from '@/lib/access-control';

/* ------------------------------------------------------------------------------------------------
 * Source badges (§8)
 * ---------------------------------------------------------------------------------------------- */

const SOURCE_STYLE: Record<AccessSourceKind, { className: string; icon: React.ElementType; short: string }> = {
  Existing: { className: 'border-slate-200 bg-slate-50 text-slate-700', icon: ShieldCheck, short: 'Existing' },
  'Base Role': { className: 'border-slate-200 bg-slate-50 text-slate-700', icon: ShieldCheck, short: 'Base' },
  'Additional Role': { className: 'border-indigo-200 bg-indigo-50 text-indigo-700', icon: Layers, short: 'Added' },
  'Direct Permission': { className: 'border-violet-200 bg-violet-50 text-violet-700', icon: KeyRound, short: 'Direct' },
  Department: { className: 'border-cyan-200 bg-cyan-50 text-cyan-700', icon: Building2, short: 'Dept' },
  Designation: { className: 'border-teal-200 bg-teal-50 text-teal-700', icon: BadgeCheck, short: 'Desig' },
  Project: { className: 'border-emerald-200 bg-emerald-50 text-emerald-700', icon: FolderKanban, short: 'Project' },
  Temporary: { className: 'border-amber-200 bg-amber-50 text-amber-800', icon: CalendarClock, short: 'Temp' },
  System: { className: 'border-slate-200 bg-white text-slate-600', icon: Sparkles, short: 'System' },
};

/**
 * One badge per reason a user holds a permission.
 *
 * The label carries the *specific* grant (the role name, the project name) rather than just the
 * kind, because "Additional Role" tells an administrator nothing they can act on and "Finance
 * Manager (Additional Role)" tells them exactly which grant to remove.
 */
export function SourceBadge({
  source,
  compact = false,
  className,
}: {
  source: PermissionSource;
  compact?: boolean;
  className?: string;
}) {
  const style = SOURCE_STYLE[source.kind] ?? SOURCE_STYLE.System;
  const Icon = style.icon;

  const detail = [
    source.kind,
    source.assignedByName ? `assigned by ${source.assignedByName}` : null,
    source.assignedAt ? formatGrantDate(source.assignedAt) : null,
    source.expiresAt ? `expires ${formatGrantDate(source.expiresAt)}` : null,
    source.reason ? `reason: ${source.reason}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className={cn('gap-1 whitespace-nowrap text-[10px] font-medium', style.className, className)}
          >
            <Icon className="h-3 w-3 shrink-0" />
            <span className="max-w-[10rem] truncate">{compact ? style.short : source.label}</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs">{detail}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Several sources, collapsed past `max` so a table row cannot grow without bound. */
export function SourceBadges({
  sources,
  max = 3,
  compact,
}: {
  sources: PermissionSource[];
  max?: number;
  compact?: boolean;
}) {
  if (!sources.length) {
    return <span className="text-xs text-muted-foreground">Not granted</span>;
  }
  const shown = sources.slice(0, max);
  const hidden = sources.length - shown.length;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {shown.map((source, index) => (
        <SourceBadge key={`${source.kind}-${source.refId ?? source.label}-${index}`} source={source} compact={compact} />
      ))}
      {hidden > 0 && (
        <Badge variant="outline" className="text-[10px] text-muted-foreground">
          +{hidden} more
        </Badge>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Role badges (§40)
 * ---------------------------------------------------------------------------------------------- */

/**
 * A role, marked as base or additional.
 *
 * §40 asks for the distinction to be visible everywhere, and the reason is operational: an
 * administrator about to remove a role needs to know at a glance whether they are touching the
 * additive layer (this screen's job) or the user's original role (User Management's job).
 */
export function RoleBadge({
  name,
  kind = 'additional',
  onRemove,
  disabled,
  className,
}: {
  name: string;
  kind?: 'base' | 'additional' | 'temporary';
  onRemove?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const palette =
    kind === 'base'
      ? 'border-slate-300 bg-slate-100 text-slate-800'
      : kind === 'temporary'
        ? 'border-amber-200 bg-amber-50 text-amber-800'
        : 'border-indigo-200 bg-indigo-50 text-indigo-700';

  return (
    <Badge variant="outline" className={cn('gap-1 text-xs font-medium', palette, className)}>
      {kind === 'base' && <ShieldCheck className="h-3 w-3" />}
      {kind === 'additional' && <Layers className="h-3 w-3" />}
      {kind === 'temporary' && <CalendarClock className="h-3 w-3" />}
      <span className="max-w-[12rem] truncate">{name}</span>
      {kind === 'base' && <span className="text-[9px] uppercase tracking-wide opacity-70">base</span>}
      {onRemove && !disabled && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${name}`}
          className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-black/10"
        >
          <Minus className="h-3 w-3" />
        </button>
      )}
    </Badge>
  );
}

/* ------------------------------------------------------------------------------------------------
 * The two numbers the preview screens exist to show (§15, §34, §47)
 * ---------------------------------------------------------------------------------------------- */

/**
 * The "0 existing permissions removed" readout.
 *
 * Rendered as its own component with its own emphasis because it is the promise the whole feature
 * makes. When it is zero it is reassuring and green; if it is ever non-zero it must be impossible
 * to miss, so it turns red and says so in words rather than just showing a number.
 */
export function RemovalReadout({ removed, className }: { removed: number; className?: string }) {
  const safe = removed === 0;
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm',
        safe
          ? 'border-emerald-200 bg-emerald-50/80 text-emerald-800'
          : 'border-destructive/40 bg-destructive/10 text-destructive',
        className,
      )}
    >
      {safe ? <Check className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
      <div className="min-w-0">
        <p className="font-semibold">Existing permissions removed: {removed}</p>
        <p className="text-xs opacity-90">
          {safe
            ? 'No existing permissions will be removed. Everything these users can do today, they will still be able to do.'
            : 'This operation would reduce access. Use the explicit removal workflow instead.'}
        </p>
      </div>
    </div>
  );
}

/** A compact "17 new · 6 already assigned · 0 removed" line for table rows and card footers. */
export function DiffSummary({
  added,
  already,
  removed,
  className,
}: {
  added: number;
  already: number;
  removed: number;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1.5 text-xs', className)}>
      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
        +{added} new
      </Badge>
      {already > 0 && (
        <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">
          {already} already assigned
        </Badge>
      )}
      <Badge
        variant="outline"
        className={
          removed === 0
            ? 'border-slate-200 bg-white text-slate-500'
            : 'border-destructive/40 bg-destructive/10 text-destructive'
        }
      >
        {removed} removed
      </Badge>
    </span>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Risk (§46)
 * ---------------------------------------------------------------------------------------------- */

/** Privilege and segregation-of-duties findings, as warnings. Never as blockers — see §46. */
export function RiskBadges({
  privileges,
  conflicts,
  className,
}: {
  privileges: PrivilegeFinding[];
  conflicts: SodConflict[];
  className?: string;
}) {
  if (!privileges.length && !conflicts.length) return null;
  return (
    <TooltipProvider>
      <span className={cn('inline-flex flex-wrap items-center gap-1', className)}>
        {privileges.length > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="gap-1 border-amber-200 bg-amber-50 text-[10px] text-amber-800">
                <UserCog className="h-3 w-3" />
                High privilege
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">
              <ul className="list-disc pl-4">
                {privileges.map((finding) => (
                  <li key={finding.label}>{finding.label}</li>
                ))}
              </ul>
            </TooltipContent>
          </Tooltip>
        )}
        {conflicts.length > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="gap-1 border-rose-200 bg-rose-50 text-[10px] text-rose-700">
                <AlertTriangle className="h-3 w-3" />
                {conflicts.length} SoD conflict{conflicts.length === 1 ? '' : 's'}
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">
              <ul className="list-disc pl-4">
                {conflicts.map((conflict) => (
                  <li key={conflict.id}>{conflict.label}</li>
                ))}
              </ul>
            </TooltipContent>
          </Tooltip>
        )}
      </span>
    </TooltipProvider>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Permission pair rendering
 * ---------------------------------------------------------------------------------------------- */

/** `"Project Management.BOQ::Import"` → `Project Management › BOQ · Import`. */
export function PermissionPair({ pair, className }: { pair: string; className?: string }) {
  const { resource, action } = splitPermissionKey(pair);
  const segments = resource.split('.');
  return (
    <span className={cn('inline-flex min-w-0 items-baseline gap-1 text-xs', className)}>
      <span className="truncate text-slate-500">{segments.join(' › ')}</span>
      <span className="shrink-0 font-medium text-slate-800">· {action}</span>
    </span>
  );
}

/** A scrollable list of permission pairs, for the preview and audit detail views. */
export function PermissionPairList({
  pairs,
  emptyLabel = 'None',
  max = 400,
}: {
  pairs: string[];
  emptyLabel?: string;
  max?: number;
}) {
  if (!pairs.length) return <p className="text-xs text-muted-foreground">{emptyLabel}</p>;
  const shown = pairs.slice(0, max);
  return (
    <div className="space-y-0.5">
      {shown.map((pair) => (
        <div key={pair} className="truncate">
          <PermissionPair pair={pair} />
        </div>
      ))}
      {pairs.length > shown.length && (
        <p className="pt-1 text-xs text-muted-foreground">+{pairs.length - shown.length} more</p>
      )}
    </div>
  );
}

/** Small labelled counter used across the preview and result panels. */
export function StatLine({
  label,
  value,
  tone = 'slate',
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'slate' | 'emerald' | 'amber' | 'rose' | 'indigo';
}) {
  const palette = {
    slate: 'text-slate-800',
    emerald: 'text-emerald-700',
    amber: 'text-amber-700',
    rose: 'text-rose-700',
    indigo: 'text-indigo-700',
  }[tone];
  return (
    <div className="rounded-xl border border-white/70 bg-white/80 px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('mt-0.5 text-lg font-semibold leading-tight', palette)}>{value}</p>
    </div>
  );
}

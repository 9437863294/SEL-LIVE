'use client';

import { useState } from 'react';
import {
  AlertTriangle, CalendarClock, Clock, Loader2, Lock, LockOpen, Save, Timer, Users,
} from 'lucide-react';
import {
  AUTO_CLOSE_DAY_MAX,
  AUTO_CLOSE_DAY_MIN,
  autoCloseDateFor,
  describeAutoRule,
  effectiveClosure,
  previewAutoRuleChange,
  validateAutoCloseRule,
  validateReopenReason,
  withAutoRule,
  type SASAutoCloseRule,
  type SASMonthClosureSettings,
} from '@/lib/site-account-statement-month-closure';
import { periodLabel, shiftPeriod } from '@/lib/site-account-statement-period-range';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/** For a project: follow the organisation, use its own rule, or never close automatically. */
type ProjectMode = 'inherit' | 'own' | 'off';

interface Draft {
  mode: ProjectMode;
  /** Only meaningful on the all-projects scope. */
  enabled: boolean;
  day: number;
  start: string;
}

/** How many months the schedule strip shows. */
const SCHEDULE_LENGTH = 4;

// ── Small formatting helpers ──────────────────────────────────────────────────

/** 1 → "1st", 22 → "22nd" — the trigger reads as a date, not a count. */
function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/** `2026-10-07` → "7 Oct", with the year only when it is not the current one. */
function shortDay(date: string, asOf: string): string {
  const [label, year] = periodLabel(date.slice(0, 7)).split(' ');
  const day = Number(date.slice(8, 10));
  return date.slice(0, 4) === asOf.slice(0, 4) ? `${day} ${label}` : `${day} ${label} ${year}`;
}

/** Whole days from `from` to `to`. */
function daysBetween(from: string, to: string): number {
  const toUtc = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
}

function relative(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

// ── Draft handling ────────────────────────────────────────────────────────────

function draftFrom(
  closure: SASMonthClosureSettings,
  projectId: string | undefined,
  fallbackStart: string,
): Draft {
  const own = projectId ? closure.projectAutoClose[projectId] : closure.autoClose;
  const mode: ProjectMode = !projectId ? 'own' : !own ? 'inherit' : own.enabled ? 'own' : 'off';
  return {
    mode,
    enabled: projectId ? true : Boolean(own?.enabled),
    // A disabled or absent rule still pre-fills sensible values, so switching it on is one click.
    day: own?.dayOfNextMonth && own.dayOfNextMonth >= 1 ? own.dayOfNextMonth : 5,
    start: own?.startPeriod || fallbackStart,
  };
}

/** The rule the draft describes, or null for "follow the organisation". */
function ruleFromDraft(draft: Draft, projectId: string | undefined): SASAutoCloseRule | null {
  if (projectId) {
    if (draft.mode === 'inherit') return null;
    if (draft.mode === 'off') return { enabled: false, dayOfNextMonth: draft.day, startPeriod: draft.start };
    return { enabled: true, dayOfNextMonth: draft.day, startPeriod: draft.start };
  }
  return { enabled: draft.enabled, dayOfNextMonth: draft.day, startPeriod: draft.start };
}

function sameRule(a: SASAutoCloseRule | null | undefined, b: SASAutoCloseRule | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  if (a.enabled !== b.enabled) return false;
  // Two disabled rules mean the same thing whatever their leftover day and start say.
  if (!a.enabled) return true;
  return a.dayOfNextMonth === b.dayOfNextMonth && a.startPeriod === b.startPeriod;
}

// ── The schedule strip ────────────────────────────────────────────────────────

interface ScheduleTile {
  period: string;
  tone: 'locked' | 'manual' | 'current' | 'upcoming' | 'reopened';
  title: string;
  detail: string;
}

/**
 * The next few months as the saved-or-draft rule would leave them.
 *
 * Read through the real closure state, not the rule alone, so a month someone reopened or closed
 * by hand shows as exactly that rather than as what the rule would have done — the strip answers
 * "what will happen to my months", which a manual entry changes.
 */
function buildSchedule(
  closure: SASMonthClosureSettings,
  projectId: string | undefined,
  rule: SASAutoCloseRule | null,
  currentPeriodKey: string,
): { tiles: ScheduleTile[]; earlierLocked: number } {
  const settings = withAutoRule(closure, projectId, rule);
  const governing = projectId ? settings.projectAutoClose[projectId] ?? settings.autoClose : settings.autoClose;
  if (!governing?.enabled) return { tiles: [], earlierLocked: 0 };

  const asOf = settings.asOf;
  // Start just behind the current month — the one closing next — but never before the rule does.
  const behind = shiftPeriod(currentPeriodKey, -1);
  const first = governing.startPeriod > behind ? governing.startPeriod : behind;

  const tiles: ScheduleTile[] = [];
  for (let i = 0, p = first; i < SCHEDULE_LENGTH; i++, p = shiftPeriod(p, 1)) {
    const effect = effectiveClosure(settings, p, projectId);
    const closesOn = autoCloseDateFor(p, governing);
    if (effect.source === 'auto') {
      tiles.push({ period: p, tone: 'locked', title: 'Locked', detail: `on ${shortDay(closesOn, asOf)}` });
    } else if (effect.closed) {
      tiles.push({ period: p, tone: 'manual', title: 'Closed by hand', detail: 'rule not needed' });
    } else if (effect.record) {
      // A manual reopen outranks the rule, so the rule will not touch this month.
      tiles.push({ period: p, tone: 'reopened', title: 'Reopened', detail: 'rule will not lock it' });
    } else {
      tiles.push({
        period: p,
        tone: p === currentPeriodKey ? 'current' : 'upcoming',
        title: `Locks ${shortDay(closesOn, asOf)}`,
        detail: relative(daysBetween(asOf, closesOn)),
      });
    }
  }

  // Months the rule covers before the strip begins, already settled — summarised, not tiled.
  // Bounded by step count, not by the tally: `shiftPeriod` hands back a malformed period
  // unchanged, so a loop bounded only by `p < first` could never end.
  let earlierLocked = 0;
  for (let p = governing.startPeriod, steps = 0; p < first && steps < 600; p = shiftPeriod(p, 1), steps++) {
    if (effectiveClosure(settings, p, projectId).closed) earlierLocked++;
  }
  return { tiles, earlierLocked };
}

const TILE_STYLE: Record<ScheduleTile['tone'], { box: string; icon: typeof Lock }> = {
  locked:   { box: 'border-slate-300 bg-slate-100 text-slate-700', icon: Lock },
  manual:   { box: 'border-slate-200 bg-slate-50 text-slate-600', icon: Lock },
  reopened: { box: 'border-amber-200 bg-amber-50 text-amber-800', icon: LockOpen },
  current:  { box: 'border-indigo-300 bg-indigo-50 text-indigo-800', icon: Clock },
  upcoming: { box: 'border-slate-200 bg-white text-slate-700', icon: Timer },
};

function Schedule({ tiles, earlierLocked }: { tiles: ScheduleTile[]; earlierLocked: number }) {
  if (tiles.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Schedule</p>
        {earlierLocked > 0 && (
          <p className="text-[11px] text-muted-foreground">
            + {earlierLocked} earlier month{earlierLocked === 1 ? '' : 's'} already locked
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiles.map(tile => {
          const style = TILE_STYLE[tile.tone];
          const Icon = style.icon;
          return (
            <div key={tile.period} className={cn('rounded-lg border px-3 py-2.5', style.box)}>
              <p className="text-xs font-semibold">
                {periodLabel(tile.period)}
                {tile.tone === 'current' && <span className="font-normal opacity-75"> · this month</span>}
              </p>
              <p className="mt-1 flex items-center gap-1 text-[13px] font-medium">
                <Icon className="h-3.5 w-3.5 shrink-0" />
                {tile.title}
              </p>
              <p className="text-[11px] opacity-75">{tile.detail}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── The card ──────────────────────────────────────────────────────────────────

/**
 * The automatic-closing rule for the scope being viewed.
 *
 * Laid out as the rule reads — "close each month on the 7th of the following month, starting with
 * September" — with a schedule underneath showing what that means for the next few months, so the
 * consequence of a number is visible before it is saved rather than discovered after.
 *
 * Saving is gated on what the change would actually do, not on what it looks like: a change that
 * closes months now is confirmed with the list, and a change that would open months the current
 * rule has closed — turning it off, moving its day or start later — is treated as the reopen it
 * is, needing the Reopen permission and a written reason.
 */
export function AutoCloseRuleCard({
  closure,
  scopeProject,
  scopeName,
  currentPeriodKey,
  canClose,
  canReopen,
  onSave,
}: {
  closure: SASMonthClosureSettings;
  scopeProject?: string;
  scopeName: string;
  currentPeriodKey: string;
  canClose: boolean;
  canReopen: boolean;
  onSave: (next: SASAutoCloseRule | null, changeReason: string) => Promise<void>;
}) {
  // A new rule defaults to starting with last month: the month it would close next, and nothing
  // older, so switching it on never sweeps a site's history shut by surprise.
  const fallbackStart = shiftPeriod(currentPeriodKey, -1);

  /*
   * The draft is derived from the stored rule until the user changes something, and only then
   * held as its own state. Copying the stored rule into state with an effect would either clobber
   * an edit in progress whenever another administrator saved, or need a "dirty" flag to dodge
   * that — deriving it has neither problem. The parent keys this card by scope, so switching
   * scope starts from a clean slate without an effect either.
   */
  const baseline = draftFrom(closure, scopeProject, fallbackStart);
  const [edited, setEdited] = useState<Draft | null>(null);
  const draft = edited ?? baseline;
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reason, setReason] = useState('');

  const stored = scopeProject ? closure.projectAutoClose[scopeProject] ?? null : closure.autoClose;
  const inherited = scopeProject ? closure.autoClose : null;

  function update(patch: Partial<Draft>) {
    setEdited(prev => ({ ...(prev ?? baseline), ...patch }));
  }

  const next = ruleFromDraft(draft, scopeProject);
  /*
   * For the organisation, "no rule stored" and "rule switched off" mean the same thing, so a
   * fresh installation's untouched card must not read as a pending change. For a project they
   * differ — no rule is "follow all projects", a switched-off rule is "opt out" — so it is
   * compared as stored.
   */
  const comparable = stored ?? (scopeProject ? null : { enabled: false, dayOfNextMonth: 5, startPeriod: '' });
  const changed = !sameRule(next, comparable);
  const validity = next ? validateAutoCloseRule(next) : { ok: true };
  // Cheap — a few dozen months compared at most — so these are simply recomputed each render.
  const preview = previewAutoRuleChange(closure, scopeProject, next);
  const schedule = buildSchedule(closure, scopeProject, next, currentPeriodKey);

  const needsReopen = preview.reopens.length > 0;
  const closesSome = preview.closesNow.length > 0;
  const allowed = canClose && (!needsReopen || canReopen);

  const startOptions: string[] = [];
  for (let i = 3; i >= -24; i--) startOptions.push(shiftPeriod(currentPeriodKey, i));
  if (draft.start && !startOptions.includes(draft.start)) startOptions.push(draft.start);

  const ruleActive = scopeProject ? draft.mode === 'own' : draft.enabled;
  // The rule actually in force for this scope as drafted — a project following the organisation
  // shows the organisation's — which is what the header pill and empty states describe.
  const inForce = scopeProject && draft.mode === 'inherit' ? inherited : next;
  const inForceOn = Boolean(inForce?.enabled);

  async function commit() {
    setSaving(true);
    try {
      await onSave(next, needsReopen ? reason.trim() : '');
      // Back to following the stored rule, which now is the one just saved.
      setEdited(null);
      setConfirmOpen(false);
      setReason('');
    } catch {
      // The parent has already shown the error. The draft is kept, so nothing typed is lost.
    } finally {
      setSaving(false);
    }
  }

  function handleSave() {
    if (!validity.ok) return;
    // Anything that changes a month's state gets a confirmation that names the months.
    if (needsReopen || closesSome) setConfirmOpen(true);
    else void commit();
  }

  const effectLine = needsReopen
    ? `Reopens ${preview.reopens.map(periodLabel).join(', ')} — needs a reason`
    : closesSome
      ? `Locks ${preview.closesNow.map(periodLabel).join(', ')} immediately`
      : 'No month changes state right away';

  return (
    <Card className="overflow-hidden">
      {/* ── Header: what this is, and whether it is on ──
          No wrap: the switch belongs top-right on a phone too, not dropped under the title. */}
      <div className="flex items-start justify-between gap-3 px-5 py-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
            <Timer className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-slate-800">Automatic closing</h3>
              <span className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1',
                inForceOn
                  ? 'bg-indigo-50 text-indigo-700 ring-indigo-200'
                  : 'bg-slate-100 text-slate-600 ring-slate-200',
              )}>
                <span className={cn('h-1.5 w-1.5 rounded-full', inForceOn ? 'bg-indigo-500' : 'bg-slate-400')} />
                {inForceOn ? `On · ${ordinal(inForce!.dayOfNextMonth)} of next month` : 'Off'}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {scopeProject ? scopeName : 'All projects'} · months lock themselves on a set day.
              A manual close or reopen always wins.
            </p>
          </div>
        </div>
        {!scopeProject && (
          <Switch
            checked={draft.enabled}
            onCheckedChange={v => update({ enabled: v })}
            disabled={!canClose}
            aria-label="Close months automatically"
            className="mt-2 data-[state=checked]:bg-indigo-600"
          />
        )}
      </div>

      <div className="space-y-5 border-t px-5 py-5">
        {/* A project picks between following, its own rule, and opting out. */}
        {scopeProject && (
          /*
           * Three equal segments that never wrap. On a phone the labels shorten ("Follow all",
           * "Never") rather than breaking onto two lines or pushing a segment onto a row of its own.
           */
          <div
            role="radiogroup"
            aria-label="Automatic closing for this project"
            className="grid w-full grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1 sm:inline-grid sm:w-auto"
          >
            {([
              { mode: 'inherit', short: 'Follow all', rest: ' projects', icon: Users },
              { mode: 'own', short: 'Own rule', rest: '', icon: Timer },
              { mode: 'off', short: 'Never', rest: ' automatically', icon: LockOpen },
            ] as const).map(option => {
              const Icon = option.icon;
              const active = draft.mode === option.mode;
              return (
                <button
                  key={option.mode}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={!canClose}
                  onClick={() => update({ mode: option.mode })}
                  className={cn(
                    'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 sm:px-3',
                    active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900',
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    {option.short}
                    {option.rest && <span className="hidden sm:inline">{option.rest}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {ruleActive ? (
          /*
           * The rule as a sentence, with its two values inline. Reading the controls left to
           * right reads the rule — which is the whole point of laying them out this way rather
           * than as two labelled fields at opposite ends of the card.
           */
          <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm text-slate-700">
            <span>Close each month on the</span>
            <Select
              value={String(draft.day)}
              onValueChange={v => update({ day: Number(v) })}
              disabled={!canClose}
            >
              <SelectTrigger className="h-9 w-[92px] font-semibold text-indigo-700" aria-label="Day of the following month">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {Array.from({ length: AUTO_CLOSE_DAY_MAX - AUTO_CLOSE_DAY_MIN + 1 }, (_, i) => i + AUTO_CLOSE_DAY_MIN).map(day => (
                  <SelectItem key={day} value={String(day)}>{ordinal(day)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span>of the following month, starting with</span>
            <Select value={draft.start} onValueChange={start => update({ start })} disabled={!canClose}>
              <SelectTrigger className="h-9 w-[130px] font-semibold text-indigo-700" aria-label="First month the rule applies to">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {startOptions.map(p => (
                  <SelectItem key={p} value={p}>{periodLabel(p)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <p className="flex items-start gap-2 rounded-lg border border-dashed bg-slate-50/60 px-3 py-2.5 text-sm text-slate-600">
            {/* "Inherited" and "unlocked" are different messages; the icon says which. */}
            {scopeProject && draft.mode === 'inherit'
              ? <Users className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              : <LockOpen className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />}
            {scopeProject
              ? draft.mode === 'inherit'
                ? inherited?.enabled
                  ? `Follows the all-projects rule — closes on the ${ordinal(inherited.dayOfNextMonth)} of the following month, from ${periodLabel(inherited.startPeriod)}.`
                  : 'Follows all projects, which have no automatic closing — months close only by hand.'
                : `${scopeName} never closes automatically. Its months close only when someone closes them.`
              : 'Off — months close only when someone closes them by hand. Switch it on to set a day.'}
          </p>
        )}

        {/* What the rule means for the coming months — the strip that replaces "e.g.". */}
        <Schedule tiles={schedule.tiles} earlierLocked={schedule.earlierLocked} />

        {ruleActive && (
          <p className="text-xs text-muted-foreground">
            Months before {periodLabel(draft.start)} are never closed by the rule — close those by hand if needed.
          </p>
        )}

        {!validity.ok && <p className="text-xs text-destructive">{validity.reason}</p>}
      </div>

      {/* ── Footer: only when there is something to save, and saying what saving does ── */}
      {canClose && changed ? (
        <div className={cn(
          'flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3',
          needsReopen ? 'bg-amber-50' : 'bg-indigo-50/60',
        )}>
          <p className={cn(
            'flex min-w-0 items-center gap-1.5 text-xs font-medium',
            needsReopen ? 'text-amber-800' : 'text-indigo-800',
          )}>
            {needsReopen
              ? <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              : closesSome ? <Lock className="h-3.5 w-3.5 shrink-0" /> : <CalendarClock className="h-3.5 w-3.5 shrink-0" />}
            <span className="truncate">{effectLine}</span>
          </p>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEdited(null)} disabled={saving}>
              Discard
            </Button>
            <Button
              size="sm"
              className="gap-2 bg-indigo-600 hover:bg-indigo-700"
              onClick={handleSave}
              disabled={saving || !validity.ok || !allowed}
              title={!allowed ? 'Reopening months needs the Month Closure · Reopen permission.' : undefined}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save rule
            </Button>
          </div>
        </div>
      ) : (stored?.updatedByName || !canClose) && (
        <div className="flex flex-wrap items-center gap-1.5 border-t bg-slate-50/60 px-5 py-2.5 text-[11px] text-muted-foreground">
          <CalendarClock className="h-3 w-3" />
          {!canClose && <span className="font-medium text-slate-600">View only ·</span>}
          {stored?.updatedByName
            ? <>Last changed by {stored.updatedByName}{stored.changeReason ? ` — ${stored.changeReason}` : ''}</>
            : 'changing the rule needs Month Closure · Close.'}
        </div>
      )}

      {/* ── Confirmation, naming the months either way ── */}
      <Dialog open={confirmOpen} onOpenChange={open => { if (!open && !saving) setConfirmOpen(false); }}>
        <DialogContent className="max-w-[95vw] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Save the automatic rule · {scopeProject ? scopeName : 'all projects'}</DialogTitle>
            <DialogDescription>
              {next ? describeAutoRule(next) : `Follow the all-projects rule: ${describeAutoRule(inherited).toLowerCase()}`}.
            </DialogDescription>
          </DialogHeader>

          {closesSome && (
            <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2.5 text-xs text-indigo-900">
              <p className="font-medium">Locks now — no expense or receipt dated in these can be added, edited or deleted:</p>
              <p className="mt-1">{preview.closesNow.map(periodLabel).join(', ')}</p>
            </div>
          )}

          {needsReopen && (
            <>
              <div className="flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                <p>
                  Reopens {preview.reopens.map(periodLabel).join(', ')} — months that have already
                  been closed. Changing the rule is held to the same standard as reopening by hand.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rule-reason">Reason <span className="text-destructive">*</span></Label>
                <Textarea
                  id="rule-reason" rows={3}
                  placeholder="e.g. Head Office moved the closing date to the 15th from this quarter."
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                />
              </div>
            </>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={saving}>Cancel</Button>
            <Button
              className="gap-2 bg-indigo-600 hover:bg-indigo-700"
              disabled={saving || (needsReopen && !validateReopenReason(reason).ok)}
              onClick={() => void commit()}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save rule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

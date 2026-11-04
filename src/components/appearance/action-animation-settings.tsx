'use client';

/**
 * Settings for the animated action buttons, self-contained (its own load, save, loading and error
 * states, toasts): the company's animations per action kind — saved into Settings › Company Profile
 * (`design.animations`), editable with Settings.Company Profile › Edit. Everyone gets them; there is
 * no personal choice (it was removed from My Appearance), and Appearance › Motion "Reduced" turns
 * them off for one person.
 *
 * Laid out as a grid and an editor: every action kind as a compact tile, one row per group, with its
 * current effects and a mark when it differs from its default; under it the chosen kind's editor —
 * the sample buttons on the left ("Try it"), and on the right each effect as a row of chips (picking
 * one plays it on the sample), intensity and speed. The master switch sits in the section's header
 * and Save in its footer bar.
 */

import { useEffect, useId, useRef, useState, type ComponentType, type ReactNode } from 'react';
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import {
  CheckCircle2,
  ClipboardCheck,
  Copy,
  Download,
  FileSpreadsheet,
  Loader2,
  MousePointerClick,
  PencilLine,
  Play,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  Sparkles,
  Trash2,
  TriangleAlert,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import { auth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { SettingsSection } from '@/components/appearance/controls';
import { useReducedMotion } from '@/components/theme/ThemeProvider';
import { playActionAnimation } from '@/components/shared/action-animations';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import { invalidateCompanyProfile, useCompanyProfile } from '@/hooks/use-company-profile';
import { COMPANY_PROFILE_RESOURCE, sanitizeCompanyProfile, type CompanyProfile } from '@/lib/company-profile';
import {
  ACTION_ANIMATION_PRESETS,
  ACTION_KINDS,
  ACTION_KIND_META,
  DEFAULT_ACTION_ANIMATIONS,
  DEFAULT_ACTION_KIND_CONFIGS,
  MAX_DURATION_MS,
  MIN_DURATION_MS,
  sanitizeActionAnimations,
  sanitizeKindConfig,
  type ActionAnimationSettings as CompanyAnimations,
  type ActionKind,
  type ActionKindConfig,
} from '@/lib/action-animations';
import { cn } from '@/lib/utils';

type Kinds = Record<ActionKind, ActionKindConfig>;

async function authorizedFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error('Your session has expired. Please sign in again.');
  const token = await user.getIdToken();
  const response = await fetch(input, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : `The server answered ${response.status}.`);
  return data as T;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const labelOf = <T extends string>(list: { id: T; label: string }[], id: T) => list.find((option) => option.id === id)?.label ?? id;

const KIND_ICONS: Record<ActionKind, ComponentType<{ className?: string }>> = {
  save: Save,
  create: Plus,
  update: PencilLine,
  delete: Trash2,
  approve: CheckCircle2,
  reject: XCircle,
  submit: ClipboardCheck,
  send: Send,
  upload: Upload,
  download: Download,
  export: FileSpreadsheet,
  print: Printer,
  copy: Copy,
  refresh: RefreshCw,
  cancel: X,
  generic: MousePointerClick,
  error: TriangleAlert,
};

const NAMED_GROUPS: { label: string; kinds: ActionKind[] }[] = [
  { label: 'Save and edit', kinds: ['save', 'create', 'update', 'delete'] },
  { label: 'Decisions', kinds: ['approve', 'reject', 'submit'] },
  { label: 'Files and sharing', kinds: ['send', 'upload', 'download', 'export', 'print', 'copy'] },
  { label: 'Everything else', kinds: ['refresh', 'cancel', 'generic', 'error'] },
];
// A kind added to ACTION_KINDS later still gets a place in the list, under the last group.
const KIND_GROUPS = (() => {
  const named = new Set(NAMED_GROUPS.flatMap((group) => group.kinds));
  const rest = ACTION_KINDS.filter((kind) => !named.has(kind));
  const last = NAMED_GROUPS[NAMED_GROUPS.length - 1];
  return [...NAMED_GROUPS.slice(0, -1), { ...last, kinds: [...last.kinds, ...rest] }];
})();

const summaryOf = (config: ActionKindConfig) =>
  config.enabled
    ? `${labelOf(ACTION_ANIMATION_PRESETS.press, config.press)} · ${labelOf(ACTION_ANIMATION_PRESETS.complete, config.complete)}`
    : 'Off';

export function ActionAnimationSettings() {
  return <CompanyAnimationSettings />;
}

// ── Company scope ────────────────────────────────────────────────────────────────────────────────

function CompanyAnimationSettings() {
  const { toast } = useToast();
  const { can, isLoading: authzLoading } = useAuthorization();
  const canEdit = can('Edit', COMPANY_PROFILE_RESOURCE);
  const { profile, loading } = useCompanyProfile();
  const current = profile.design.animations;
  // Null until the admin changes something: until then the stored value is shown as it updates.
  const [edited, setEdited] = useState<CompanyAnimations | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draft = edited ?? current;
  const setDraft = (next: CompanyAnimations | null) => setEdited(next && same(next, current) ? null : next);

  const dirty = Boolean(edited && !same(edited, current));
  const readOnly = !canEdit || saving;

  const save = async () => {
    if (!draft || !canEdit) return;
    setSaving(true);
    setError(null);
    try {
      // Read the stored document fresh, so only the animations change.
      const stored = sanitizeCompanyProfile(await authorizedFetch<CompanyProfile>('/api/company-profile?stored=1'));
      const body: CompanyProfile = { ...stored, design: { ...stored.design, animations: sanitizeActionAnimations(draft) } };
      const result = await authorizedFetch<{ profile: CompanyProfile; stored: CompanyProfile }>('/api/company-profile', {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      setEdited(null);
      invalidateCompanyProfile(result.profile);
      toast({ title: 'Button animations saved', description: 'Everyone sees them on their next page load.' });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Please try again.';
      setError(message);
      toast({ title: 'Could not save button animations', description: message, variant: 'destructive' });
    }
    setSaving(false);
  };

  const ready = !loading && !authzLoading;

  return (
    <SettingsSection
      title="Button animations"
      icon={Sparkles}
      description="How action buttons respond when pressed, and when their action finishes or fails, for everyone. Anyone with Reduced motion sees none."
      action={
        ready ? (
          <div className="flex items-center gap-2 rounded-full border bg-background py-1 pl-3 pr-1.5">
            <Label htmlFor="action-animations-enabled" className="text-sm">
              Animate buttons
            </Label>
            <Switch id="action-animations-enabled" checked={draft.enabled} disabled={readOnly} onCheckedChange={(enabled) => setDraft({ ...draft, enabled })} />
          </div>
        ) : null
      }
      footer={
        ready && canEdit ? (
          <>
            <span role="status" className={cn('mr-auto text-xs', dirty ? 'font-medium text-amber-700 dark:text-amber-300' : 'text-muted-foreground')}>
              {dirty ? 'Unsaved changes' : 'No unsaved changes'}
            </span>
            <Button variant="ghost" disabled={saving} action={false} onClick={() => setDraft(DEFAULT_ACTION_ANIMATIONS)}>
              <RotateCcw className="mr-2 h-4 w-4" /> Restore built-in defaults
            </Button>
            <Button variant="outline" disabled={!dirty || saving} onClick={() => setDraft(null)}>
              Discard changes
            </Button>
            <Button disabled={!dirty || saving} onClick={() => void save()} action="save">
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </>
        ) : undefined
      }
      contentClassName="space-y-4"
    >
      {!ready ? (
        <LoadingRows />
      ) : (
        <>
          {!canEdit && (
            <Notice>Only people with Settings › Company Profile › Edit can change the button animations. You can still try each animation.</Notice>
          )}
          <ReducedMotionNotice />
          {!draft.enabled && <Notice>Button animations are off for everyone. Switch on “Animate buttons” above to choose them again.</Notice>}
          <KindEditor
            kinds={draft.kinds}
            disabled={readOnly || !draft.enabled}
            onChange={(kind, config) => setDraft({ ...draft, kinds: { ...draft.kinds, [kind]: config } })}
            resetTo={(kind) => DEFAULT_ACTION_KIND_CONFIGS[kind]}
            resetLabel="Built-in default"
          />
          {error && <Notice tone="error">{error}</Notice>}
        </>
      )}
    </SettingsSection>
  );
}

// ── The kinds and the editor ─────────────────────────────────────────────────────────────────────

/**
 * Every kind of button as a compact grid, one row per group, with the chosen kind's editor
 * underneath at full width. It replaced a list of seventeen rows down the left, which made the page
 * three times the height of the editor beside it.
 */
function KindEditor({
  kinds,
  disabled,
  onChange,
  resetTo,
  resetLabel,
}: {
  kinds: Kinds;
  disabled: boolean;
  onChange: (kind: ActionKind, config: ActionKindConfig) => void;
  resetTo: (kind: ActionKind) => ActionKindConfig;
  resetLabel: string;
}) {
  const [selected, setSelected] = useState<ActionKind>('save');
  const panelId = useId();
  const changedCount = ACTION_KINDS.filter((kind) => !same(kinds[kind], resetTo(kind))).length;

  return (
    // The editor's own controls are not actions; only the sample buttons play, and explicitly.
    <div data-action-animations="off" className="space-y-4">
      <nav aria-label="Kinds of button" className="rounded-xl border bg-muted/30 p-3">
        <div className="space-y-3 md:space-y-2">
          {KIND_GROUPS.map((group) => (
            <div key={group.label} className="md:grid md:grid-cols-[9rem_minmax(0,1fr)] md:items-start md:gap-3">
              <p className="pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground md:pb-0 md:pt-3">{group.label}</p>
              <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                {group.kinds.map((kind) => {
                  const config = kinds[kind];
                  const changed = !same(config, resetTo(kind));
                  const active = kind === selected;
                  const Icon = KIND_ICONS[kind];
                  return (
                    <li key={kind} className="min-w-0">
                      <button
                        type="button"
                        aria-current={active ? 'true' : undefined}
                        aria-controls={panelId}
                        onClick={() => setSelected(kind)}
                        className={cn(
                          'flex w-full min-w-0 items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          active ? 'border-primary bg-background shadow-sm ring-1 ring-primary' : 'border-transparent bg-background/60 hover:border-border hover:bg-background',
                        )}
                      >
                        <span
                          className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md', active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}
                          aria-hidden="true"
                        >
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={cn('block truncate text-sm', active ? 'font-semibold' : 'font-medium')}>{ACTION_KIND_META[kind].label}</span>
                          <span className="block truncate text-[11px] text-muted-foreground">{summaryOf(config)}</span>
                        </span>
                        {changed ? <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" title={`Changed from the ${resetLabel.toLowerCase()}`} aria-hidden="true" /> : null}
                        {changed ? <span className="sr-only">, changed from the {resetLabel.toLowerCase()}</span> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
        {changedCount > 0 && (
          <p className="mt-3 flex items-center gap-1.5 border-t pt-2.5 text-[11px] text-muted-foreground">
            <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
            {changedCount === 1 ? '1 kind differs' : `${changedCount} kinds differ`} from the {resetLabel.toLowerCase()}
          </p>
        )}
      </nav>

      <KindPanel
        key={selected}
        id={panelId}
        kind={selected}
        config={kinds[selected]}
        disabled={disabled}
        onChange={(config) => onChange(selected, config)}
        reset={resetTo(selected)}
        resetLabel={resetLabel}
      />
    </div>
  );
}

function KindPanel({
  id,
  kind,
  config,
  disabled,
  onChange,
  reset,
  resetLabel,
}: {
  id: string;
  kind: ActionKind;
  config: ActionKindConfig;
  disabled: boolean;
  onChange: (config: ActionKindConfig) => void;
  reset: ActionKindConfig;
  resetLabel: string;
}) {
  const tryRef = useRef<HTMLButtonElement>(null);
  const failRef = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const meta = ACTION_KIND_META[kind];
  const Icon = KIND_ICONS[kind];
  const changed = !same(config, reset);
  // The effects can be changed only when this kind animates at all.
  const locked = disabled || !config.enabled;

  /** Press, then completion — on the sample button, with `shown` rather than what is saved. */
  const tryIt = (shown: ActionKindConfig = config) => {
    const element = tryRef.current;
    if (!element) return;
    window.clearTimeout(timer.current);
    playActionAnimation(element, kind, 'press', { config: shown, force: true });
    const pressMs = shown.press === 'none' ? 0 : Math.max(150, Math.round(shown.durationMs * 0.5));
    timer.current = window.setTimeout(() => playActionAnimation(tryRef.current, kind, 'complete', { config: shown, force: true }), pressMs * 0.7 + 60);
  };
  const tryFailure = (shown: ActionKindConfig = config) => {
    const element = failRef.current;
    if (!element) return;
    playActionAnimation(element, kind, 'press', { config: shown, force: true });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => playActionAnimation(failRef.current, kind, 'failure', { config: shown, force: true }), 220);
  };

  /** Apply a change and show it straight away, so a choice is seen rather than guessed at. */
  const pick = (patch: Partial<ActionKindConfig>, show: 'complete' | 'failure' | null = 'complete') => {
    const next = sanitizeKindConfig({ ...config, ...patch }, config);
    onChange(next);
    if (show === 'complete') tryIt(next);
    else if (show === 'failure') tryFailure(next);
  };

  return (
    <section id={id} aria-label={`${meta.label} buttons`} className="min-w-0 overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden="true">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-tight">{meta.label}</p>
          <p className="text-xs text-muted-foreground">{summaryOf(config)}</p>
        </div>
        {!disabled && changed && (
          <Button type="button" size="sm" variant="ghost" className="h-8" action={false} onClick={() => onChange(reset)}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> {resetLabel}
          </Button>
        )}
        <div className="flex items-center gap-2">
          <Switch id={`${id}-enabled`} checked={config.enabled} disabled={disabled} onCheckedChange={(enabled) => pick({ enabled }, enabled ? 'complete' : null)} />
          <Label htmlFor={`${id}-enabled`} className="text-sm">
            Animated
          </Label>
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
        {/* The stage: the real buttons, playing exactly what is on screen (saved or not). */}
        <div className="flex flex-col items-center justify-center gap-3 border-b bg-muted/30 px-4 py-6 lg:border-b-0 lg:border-r">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Try it</p>
          <div className="flex flex-wrap justify-center gap-2 lg:w-full lg:flex-col lg:items-stretch">
            <Button ref={tryRef} type="button" action={false} onClick={() => tryIt()}>
              <Play className="mr-2 h-4 w-4" /> {meta.example}
            </Button>
            <Button ref={failRef} type="button" variant="outline" action={false} onClick={() => tryFailure()}>
              <TriangleAlert className="mr-2 h-4 w-4" /> Try failure
            </Button>
          </div>
          <p className="max-w-[16rem] text-center text-xs text-muted-foreground">
            {config.enabled
              ? 'The press, then what happens when the action finishes. Picking an effect plays it here too.'
              : `${meta.label} buttons do not animate. Switch on “Animated” to choose their effects.`}
          </p>
        </div>

        <div className={cn('min-w-0 divide-y', locked && 'opacity-60')}>
          <EffectRow label="When pressed" options={ACTION_ANIMATION_PRESETS.press} value={config.press} disabled={locked} onPick={(press) => pick({ press })} />
          <EffectRow label="When it finishes" options={ACTION_ANIMATION_PRESETS.complete} value={config.complete} disabled={locked} onPick={(complete) => pick({ complete })} />
          <EffectRow label="When it fails" options={ACTION_ANIMATION_PRESETS.failure} value={config.failure} disabled={locked} onPick={(failure) => pick({ failure }, 'failure')} />
          <EffectRow label="Intensity" options={ACTION_ANIMATION_PRESETS.intensity} value={config.intensity} disabled={locked} onPick={(intensity) => pick({ intensity })} />
          <SettingRow
            label={
              <Label htmlFor={`${id}-speed`} className="text-sm font-medium">
                Speed
              </Label>
            }
            note={`${config.durationMs} ms`}
          >
            <div className="max-w-md space-y-1.5 pt-1">
              <Slider
                id={`${id}-speed`}
                min={MIN_DURATION_MS}
                max={MAX_DURATION_MS}
                step={50}
                value={[config.durationMs]}
                disabled={locked}
                onValueChange={([durationMs]) => pick({ durationMs }, null)}
                // Played once the thumb is let go, not on every step of the drag.
                onValueCommit={([durationMs]) => tryIt(sanitizeKindConfig({ ...config, durationMs }, config))}
                aria-label={`${meta.label} animation length in milliseconds`}
              />
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>Faster</span>
                <span>Slower</span>
              </div>
            </div>
          </SettingRow>
        </div>
      </div>
    </section>
  );
}

/** One setting of the editor: its name and a note on the left, the control on the right (stacked on a phone). */
function SettingRow({ label, note, children }: { label: ReactNode; note?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-2 px-4 py-3 md:grid-cols-[10rem_minmax(0,1fr)] md:gap-4">
      <div className="min-w-0">
        {label}
        {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * One effect as a row of chips — a real radio group, so arrow keys move through it and each move
 * plays the effect on the sample button. The chosen effect's description sits under its name.
 */
function EffectRow<T extends string>({
  label,
  options,
  value,
  disabled,
  onPick,
}: {
  label: string;
  options: { id: T; label: string; description: string }[];
  value: T;
  disabled: boolean;
  onPick: (value: T) => void;
}) {
  const labelId = useId();
  const current = options.find((option) => option.id === value);
  return (
    <SettingRow
      label={
        <p id={labelId} className="text-sm font-medium">
          {label}
        </p>
      }
      note={current?.description}
    >
      <RadioGroupPrimitive.Root
        value={value}
        onValueChange={(next) => onPick(next as T)}
        aria-labelledby={labelId}
        disabled={disabled}
        className="flex flex-wrap gap-1.5"
      >
        {options.map((option) => {
          const on = option.id === value;
          return (
            <RadioGroupPrimitive.Item
              key={option.id}
              value={option.id}
              title={option.description}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed',
                on ? 'border-primary bg-primary text-primary-foreground' : 'bg-background text-foreground hover:border-primary/40 hover:bg-muted',
              )}
            >
              {option.label}
            </RadioGroupPrimitive.Item>
          );
        })}
      </RadioGroupPrimitive.Root>
    </SettingRow>
  );
}

function ReducedMotionNotice() {
  const reduced = useReducedMotion();
  if (!reduced) return null;
  return (
    <Notice>
      Reduced motion is on (this device’s setting or Appearance › Motion), so no button animations play here — not even the sample buttons.
    </Notice>
  );
}

function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'error' }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={tone === 'error' ? 'rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive' : 'rounded-lg border bg-muted/50 px-3 py-2 text-sm text-muted-foreground'}
    >
      {children}
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading button animations">
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-72 w-full rounded-xl" />
    </div>
  );
}

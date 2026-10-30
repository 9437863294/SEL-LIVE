'use client';

/**
 * Settings for the animated action buttons, self-contained (its own load, save, loading and error
 * states, toasts):
 *
 *   <ActionAnimationSettings scope="company" />   the company default per action kind — saved into
 *       Settings › Company Profile (`design.animations`), editable with Settings.Company Profile › Edit
 *   <ActionAnimationSettings scope="personal" />  this user's own choice — Company default / My own /
 *       Off — saved with their appearance preferences (`animations`)
 *
 * Laid out as a list and an editor: the action kinds down the left, grouped (a scrolling strip on a
 * phone), with each one's current effects and a mark when it differs from its default; the chosen
 * kind on the right, with a live sample button, every effect as a row of chips — picking one plays it
 * on the sample — intensity and speed. It replaced seventeen accordion rows stretched across the
 * page, which showed nothing until opened and one at a time when they were.
 */

import { useEffect, useId, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
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
import { ChoiceGroup, SettingsSection, SwitchRow } from '@/components/appearance/controls';
import { useAppearance, useReducedMotion } from '@/components/theme/ThemeProvider';
import { playActionAnimation } from '@/components/shared/action-animations';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import { invalidateCompanyProfile, useCompanyProfile } from '@/hooks/use-company-profile';
import { COMPANY_PROFILE_RESOURCE, sanitizeCompanyProfile, type CompanyProfile } from '@/lib/company-profile';
import {
  ACTION_ANIMATION_PRESETS,
  ACTION_KINDS,
  ACTION_KIND_META,
  ANIMATION_MODES,
  DEFAULT_ACTION_ANIMATIONS,
  DEFAULT_ACTION_KIND_CONFIGS,
  MAX_DURATION_MS,
  MIN_DURATION_MS,
  resolveActionAnimations,
  sanitizeActionAnimations,
  sanitizeKindConfig,
  type ActionAnimationSettings as CompanyAnimations,
  type ActionKind,
  type ActionKindConfig,
  type AnimationMode,
  type UserActionAnimations,
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

export function ActionAnimationSettings({ scope }: { scope: 'company' | 'personal' }) {
  return scope === 'company' ? <CompanyAnimationSettings /> : <PersonalAnimationSettings />;
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
      toast({ title: 'Button animations saved', description: 'Everyone who follows the company default now sees them.' });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Please try again.';
      setError(message);
      toast({ title: 'Could not save button animations', description: message, variant: 'destructive' });
    }
    setSaving(false);
  };

  return (
    <SettingsSection
      title="Button animations"
      icon={Sparkles}
      description="The company default: how action buttons respond when pressed, and when their action finishes or fails — for everyone who has not chosen their own."
    >
      {loading || authzLoading ? (
        <LoadingRows />
      ) : (
        <>
          {!canEdit && (
            <Notice>Only people with Settings › Company Profile › Edit can change the company default. You can still try each animation.</Notice>
          )}
          <ReducedMotionNotice />
          <SwitchRow
            label="Animate action buttons"
            description="Off turns every button animation off for people who follow the company."
            checked={draft.enabled}
            disabled={readOnly}
            onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
          />
          <KindEditor
            kinds={draft.kinds}
            disabled={readOnly || !draft.enabled}
            onChange={(kind, config) => setDraft({ ...draft, kinds: { ...draft.kinds, [kind]: config } })}
            resetTo={(kind) => DEFAULT_ACTION_KIND_CONFIGS[kind]}
            resetLabel="Built-in default"
          />
          {error && <Notice tone="error">{error}</Notice>}
          {canEdit && (
            <Footer dirty={dirty}>
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
            </Footer>
          )}
        </>
      )}
    </SettingsSection>
  );
}

// ── Personal scope ───────────────────────────────────────────────────────────────────────────────

const MODE_META: Record<AnimationMode, { label: string; description: string }> = {
  company: { label: 'Company default', description: 'Use the animations your company chose.' },
  custom: { label: 'My own', description: 'Choose each animation yourself.' },
  off: { label: 'Off', description: 'No button animations.' },
};

/** What to store for a choice: nothing for the company default, only the kinds that differ for "My own". */
function toStored(mode: AnimationMode, kinds: Kinds, company: CompanyAnimations): UserActionAnimations | undefined {
  if (mode === 'company') return undefined;
  if (mode === 'off') return { mode: 'off' };
  const own: Partial<Kinds> = {};
  for (const kind of ACTION_KINDS) if (!same(kinds[kind], company.kinds[kind])) own[kind] = kinds[kind];
  return { mode: 'custom', kinds: own };
}

function PersonalAnimationSettings() {
  const { toast } = useToast();
  const { preferences, updatePreferences, ready, signedIn, saveStatus, saveError } = useAppearance();
  const { profile, loading } = useCompanyProfile();
  const company = profile.design.animations;
  const stored = preferences.animations;

  const storedKinds = useMemo(() => resolveActionAnimations(company, stored?.mode === 'custom' ? stored : undefined).kinds, [company, stored]);
  // Null until the user changes something: until then what is stored is shown.
  const [edited, setEdited] = useState<{ mode: AnimationMode; kinds: Kinds } | null>(null);
  const mode = edited?.mode ?? stored?.mode ?? 'company';
  const kinds = edited?.kinds ?? storedKinds;
  const setMode = (id: AnimationMode) => setEdited({ mode: id, kinds });
  const setKinds = (next: Kinds) => setEdited({ mode, kinds: next });
  const awaiting = useRef<'idle' | 'requested' | 'saving'>('idle');

  const next = useMemo(() => toStored(mode, kinds, company), [mode, kinds, company]);
  const dirty = Boolean(edited) && !same(next ?? null, stored ?? null);

  useEffect(() => {
    if (awaiting.current === 'idle') return;
    if (saveStatus === 'saving') awaiting.current = 'saving';
    else if (saveStatus === 'saved' && awaiting.current === 'saving') {
      awaiting.current = 'idle';
      toast({ title: 'Button animations saved', description: 'Your choice applies on every device you sign in on.' });
    } else if (saveStatus === 'error') {
      awaiting.current = 'idle';
      toast({ title: 'Could not save button animations', description: saveError ?? 'Please try again.', variant: 'destructive' });
    }
  }, [saveStatus, saveError, toast]);

  const save = () => {
    updatePreferences((current) => {
      const updated = { ...current };
      if (next) updated.animations = next;
      else delete updated.animations;
      return updated;
    });
    setEdited(null);
    if (signedIn) awaiting.current = 'requested';
    else toast({ title: 'Button animations saved on this device' });
  };

  const discard = () => setEdited(null);

  const shownKinds = mode === 'custom' ? kinds : company.kinds;
  const busy = saveStatus === 'saving';

  return (
    <SettingsSection title="Button animations" icon={Sparkles} description="Just for you: how action buttons respond when pressed, and when their action finishes or fails.">
      {!ready || loading ? (
        <LoadingRows />
      ) : (
        <>
          <ReducedMotionNotice />
          <ChoiceGroup<AnimationMode>
            label="Animations"
            value={mode}
            options={ANIMATION_MODES.map((id) => ({ value: id, label: MODE_META[id].label, description: MODE_META[id].description }))}
            onChange={setMode}
          />
          {mode !== 'off' && (
            <>
              {mode === 'company' && (
                <Notice>
                  {company.enabled ? 'These are the company’s choices. Pick “My own” to change them for yourself.' : 'Your company has button animations turned off. Pick “My own” to have them anyway.'}
                </Notice>
              )}
              <KindEditor
                kinds={shownKinds}
                disabled={mode !== 'custom'}
                onChange={(kind, config) => setKinds({ ...kinds, [kind]: config })}
                resetTo={(kind) => company.kinds[kind]}
                resetLabel="Company default"
              />
            </>
          )}
          <Footer dirty={dirty}>
            <Button variant="outline" disabled={!dirty} onClick={discard}>
              Discard changes
            </Button>
            <Button disabled={!dirty || busy} onClick={save} action="save">
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </Footer>
        </>
      )}
    </SettingsSection>
  );
}

// ── The list and the editor ──────────────────────────────────────────────────────────────────────

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

  return (
    // The editor's own controls are not actions; only the sample buttons play, and explicitly.
    // `items-start` and a sticky editor: the list is the taller of the two, and the editor stays in
    // view while it is scrolled instead of stretching to match it.
    <div data-action-animations="off" className="grid gap-3 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] lg:items-start lg:gap-4">
      <nav aria-label="Kinds of button" className="min-w-0 rounded-xl border bg-muted/40 p-1.5">
        {/* A scrolling strip on a phone (the groups' wrappers are `contents` there, so every kind is a
            direct item of the strip); a grouped list beside the editor from `lg`. */}
        <div className="flex gap-1 overflow-x-auto lg:block lg:overflow-visible">
          {KIND_GROUPS.map((group, index) => (
            <div key={group.label} className={cn('contents lg:block lg:space-y-0.5', index > 0 && 'lg:mt-2')}>
              <p className="hidden px-2 pb-0.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground lg:block">{group.label}</p>
              {group.kinds.map((kind) => {
                const config = kinds[kind];
                const changed = !same(config, resetTo(kind));
                const active = kind === selected;
                const Icon = KIND_ICONS[kind];
                return (
                  <button
                    key={kind}
                    type="button"
                    aria-current={active ? 'true' : undefined}
                    aria-controls={panelId}
                    onClick={() => setSelected(kind)}
                    className={cn(
                      'flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:w-full',
                      active ? 'bg-background font-medium text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:bg-background/70 hover:text-foreground',
                    )}
                  >
                    <Icon className={cn('h-4 w-4 shrink-0', active && 'text-primary')} aria-hidden="true" />
                    <span className="min-w-0 lg:flex-1">
                      <span className="block whitespace-nowrap lg:truncate">{ACTION_KIND_META[kind].label}</span>
                      <span className="hidden truncate text-[11px] font-normal text-muted-foreground lg:block">{summaryOf(config)}</span>
                    </span>
                    {!config.enabled ? (
                      <span className="rounded bg-muted px-1.5 text-[10px] font-semibold uppercase text-muted-foreground">Off</span>
                    ) : changed ? (
                      <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" title={`Changed from the ${resetLabel.toLowerCase()}`} aria-hidden="true" />
                    ) : null}
                    {changed ? <span className="sr-only">, changed from the {resetLabel.toLowerCase()}</span> : null}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
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
    <section
      id={id}
      aria-label={`${meta.label} buttons`}
      className="min-w-0 space-y-4 rounded-xl border bg-card p-3 sm:p-4 lg:sticky lg:top-[calc(var(--app-header-offset,4rem)+1rem)]"
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4 w-4" aria-hidden="true" />
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

      {/* The stage: the real button, playing exactly what is on screen (saved or not). */}
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed bg-muted/30 px-4 py-5">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button ref={tryRef} type="button" action={false} onClick={() => tryIt()}>
            <Play className="mr-2 h-4 w-4" /> {meta.example}
          </Button>
          <Button ref={failRef} type="button" variant="outline" action={false} onClick={() => tryFailure()}>
            <TriangleAlert className="mr-2 h-4 w-4" /> Try failure
          </Button>
        </div>
        <p className="text-center text-xs text-muted-foreground">
          {config.enabled
            ? 'Press to see it: the press, then what happens when the action finishes. Picking an effect below plays it here too.'
            : `${meta.label} buttons do not animate. Switch on “Animated” to choose their effects.`}
        </p>
      </div>

      <div className={cn('space-y-4', locked && 'opacity-60')}>
        <EffectChips label="When pressed" options={ACTION_ANIMATION_PRESETS.press} value={config.press} disabled={locked} onPick={(press) => pick({ press })} />
        <EffectChips label="When it finishes" options={ACTION_ANIMATION_PRESETS.complete} value={config.complete} disabled={locked} onPick={(complete) => pick({ complete })} />
        <EffectChips label="When it fails" options={ACTION_ANIMATION_PRESETS.failure} value={config.failure} disabled={locked} onPick={(failure) => pick({ failure }, 'failure')} />
        <div className="grid gap-4 sm:grid-cols-2">
          <EffectChips label="Intensity" options={ACTION_ANIMATION_PRESETS.intensity} value={config.intensity} disabled={locked} onPick={(intensity) => pick({ intensity })} />
          <div className="min-w-0 space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <Label htmlFor={`${id}-speed`} className="text-sm font-medium">
                Speed
              </Label>
              <span className="text-xs tabular-nums text-muted-foreground">{config.durationMs} ms</span>
            </div>
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
        </div>
      </div>
    </section>
  );
}

/**
 * One effect as a row of chips — a real radio group, so arrow keys move through it and each move
 * plays the effect on the sample button. The chosen effect's description sits beside the label.
 */
function EffectChips<T extends string>({
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
    <div className="min-w-0 space-y-1.5">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <p id={labelId} className="text-sm font-medium">
          {label}
        </p>
        {current ? <p className="text-xs text-muted-foreground">{current.description}</p> : null}
      </div>
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
    </div>
  );
}

/** Save and discard, with whether anything is waiting to be saved. */
function Footer({ dirty, children }: { dirty: boolean; children: ReactNode }) {
  return (
    <div className="flex flex-col-reverse gap-2 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
      <span role="status" className={cn('text-xs', dirty ? 'font-medium text-amber-700 dark:text-amber-300' : 'text-muted-foreground')}>
        {dirty ? 'Unsaved changes' : 'No unsaved changes'}
      </span>
      <div className="flex flex-wrap gap-2 sm:justify-end">{children}</div>
    </div>
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
    <div className="grid gap-3 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]" aria-busy="true" aria-label="Loading button animations">
      <Skeleton className="h-64 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}

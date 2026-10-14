/**
 * Animated action buttons: the vocabulary (action kinds, press / completion / failure effects),
 * the built-in defaults per kind, inference of a button's kind from its label, the validators for
 * the company defaults (`CompanyProfile.design.animations`) and a user's own override
 * (`UserAppearancePreferences.animations`), and how the two combine.
 *
 * Pure TypeScript — no React, no DOM — so it is unit-tested with node
 * (`tests/action-animations.test.mjs`); hence no enums and no constructor parameter properties.
 * The engine that plays the effects is src/components/shared/action-animations.tsx.
 */

export const ACTION_KINDS = [
  'save', 'create', 'update', 'delete', 'approve', 'reject', 'submit', 'send', 'upload', 'download',
  'export', 'print', 'copy', 'refresh', 'cancel', 'generic', 'error',
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export const PRESS_EFFECTS = ['none', 'press', 'ripple', 'pulse', 'glow', 'bounce'] as const;
export type PressEffect = (typeof PRESS_EFFECTS)[number];

export const COMPLETE_EFFECTS = ['none', 'check', 'check-burst', 'burst', 'glow', 'pop', 'slide', 'confetti-lite', 'shake', 'fade'] as const;
export type CompleteEffect = (typeof COMPLETE_EFFECTS)[number];

export const FAILURE_EFFECTS = ['shake', 'flash', 'none'] as const;
export type FailureEffect = (typeof FAILURE_EFFECTS)[number];

export const ANIMATION_INTENSITIES = ['subtle', 'normal', 'strong'] as const;
export type AnimationIntensity = (typeof ANIMATION_INTENSITIES)[number];

export const ANIMATION_MODES = ['company', 'custom', 'off'] as const;
export type AnimationMode = (typeof ANIMATION_MODES)[number];

export const MIN_DURATION_MS = 150;
export const MAX_DURATION_MS = 1200;

export interface ActionKindConfig {
  enabled: boolean;
  press: PressEffect;
  complete: CompleteEffect;
  failure: FailureEffect;
  /** How long the completion / failure effect runs; the press effect runs for about half of it. */
  durationMs: number;
  intensity: AnimationIntensity;
}

/** The company's defaults, stored at `CompanyProfile.design.animations`. */
export interface ActionAnimationSettings {
  enabled: boolean;
  kinds: Record<ActionKind, ActionKindConfig>;
}

/** A user's own choice, stored at `UserAppearancePreferences.animations`. */
export interface UserActionAnimations {
  mode: AnimationMode;
  /** Only with `mode: 'custom'`: the kinds this user set differently from the company. */
  kinds?: Partial<Record<ActionKind, ActionKindConfig>>;
}

type Option<T extends string> = { id: T; label: string; description: string };

/** Every choice the settings screen offers, with a name and a line on what it looks like. */
export const ACTION_ANIMATION_PRESETS: {
  press: Option<PressEffect>[];
  complete: Option<CompleteEffect>[];
  failure: Option<FailureEffect>[];
  intensity: Option<AnimationIntensity>[];
} = {
  press: [
    { id: 'none', label: 'None', description: 'No press effect.' },
    { id: 'press', label: 'Press', description: 'The button dips slightly, like a key.' },
    { id: 'ripple', label: 'Ripple', description: 'A ripple spreads from where it was pressed.' },
    { id: 'pulse', label: 'Pulse', description: 'A ring pulses out from the edge.' },
    { id: 'glow', label: 'Glow', description: 'A soft glow around the button.' },
    { id: 'bounce', label: 'Bounce', description: 'Dips, then springs back past its size.' },
  ],
  complete: [
    { id: 'none', label: 'None', description: 'Nothing when the action finishes.' },
    { id: 'check', label: 'Check mark', description: 'The button briefly becomes a tick.' },
    { id: 'check-burst', label: 'Check + burst', description: 'A tick with a small burst of dots.' },
    { id: 'burst', label: 'Burst', description: 'A small burst of dots.' },
    { id: 'glow', label: 'Glow', description: 'A soft glow fades out.' },
    { id: 'pop', label: 'Pop', description: 'Grows a little and settles.' },
    { id: 'slide', label: 'Slide', description: 'The icon slides away and back.' },
    { id: 'confetti-lite', label: 'Confetti (light)', description: 'A dozen pieces of confetti, at most.' },
    { id: 'shake', label: 'Shake', description: 'A short side-to-side shake.' },
    { id: 'fade', label: 'Fade', description: 'Dims and returns.' },
  ],
  failure: [
    { id: 'shake', label: 'Shake', description: 'A short side-to-side shake.' },
    { id: 'flash', label: 'Red flash', description: 'Flashes the danger colour.' },
    { id: 'none', label: 'None', description: 'Nothing when the action fails.' },
  ],
  intensity: [
    { id: 'subtle', label: 'Subtle', description: 'Barely there.' },
    { id: 'normal', label: 'Normal', description: 'Clearly visible.' },
    { id: 'strong', label: 'Strong', description: 'Hard to miss.' },
  ],
};

export const ACTION_KIND_META: Record<ActionKind, { label: string; example: string }> = {
  save: { label: 'Save', example: 'Save' },
  create: { label: 'Create / Add', example: 'Add item' },
  update: { label: 'Update / Edit', example: 'Update' },
  delete: { label: 'Delete / Remove', example: 'Delete' },
  approve: { label: 'Approve', example: 'Approve' },
  reject: { label: 'Reject', example: 'Reject' },
  submit: { label: 'Submit', example: 'Submit' },
  send: { label: 'Send', example: 'Send' },
  upload: { label: 'Upload', example: 'Upload' },
  download: { label: 'Download', example: 'Download' },
  export: { label: 'Export', example: 'Export' },
  print: { label: 'Print', example: 'Print' },
  copy: { label: 'Copy', example: 'Copy' },
  refresh: { label: 'Refresh', example: 'Refresh' },
  cancel: { label: 'Cancel / Close', example: 'Cancel' },
  generic: { label: 'Any other button', example: 'Continue' },
  error: { label: 'Errors', example: 'Retry' },
};

const kind = (press: PressEffect, complete: CompleteEffect, failure: FailureEffect, durationMs: number): ActionKindConfig => ({
  enabled: true,
  press,
  complete,
  failure,
  durationMs,
  intensity: 'subtle',
});

/** Built-in defaults: subtle everywhere, a tick where something was kept, red where something went. */
export const DEFAULT_ACTION_KIND_CONFIGS: Record<ActionKind, ActionKindConfig> = {
  save: kind('press', 'check', 'shake', 650),
  create: kind('press', 'pop', 'shake', 450),
  update: kind('press', 'check', 'shake', 600),
  delete: kind('press', 'fade', 'flash', 500),
  approve: kind('press', 'check-burst', 'shake', 750),
  reject: kind('press', 'shake', 'flash', 450),
  submit: kind('ripple', 'check', 'shake', 650),
  send: kind('press', 'slide', 'shake', 550),
  upload: kind('press', 'slide', 'shake', 550),
  download: kind('press', 'slide', 'shake', 550),
  export: kind('press', 'pop', 'shake', 450),
  print: kind('press', 'pop', 'none', 400),
  copy: kind('press', 'check', 'shake', 500),
  refresh: kind('press', 'pop', 'shake', 400),
  cancel: kind('press', 'none', 'none', 300),
  generic: kind('press', 'glow', 'shake', 500),
  error: kind('none', 'shake', 'shake', 450),
};

export const DEFAULT_ACTION_ANIMATIONS: ActionAnimationSettings = {
  enabled: true,
  kinds: DEFAULT_ACTION_KIND_CONFIGS,
};

// ── Validation ───────────────────────────────────────────────────────────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const pick = <T extends string>(list: readonly T[], value: unknown, fallback: T): T =>
  typeof value === 'string' && (list as readonly string[]).includes(value) ? (value as T) : fallback;

export const isActionKind = (value: unknown): value is ActionKind =>
  typeof value === 'string' && (ACTION_KINDS as readonly string[]).includes(value);

export function clampDuration(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.round(Math.min(MAX_DURATION_MS, Math.max(MIN_DURATION_MS, n)));
}

export function sanitizeKindConfig(raw: unknown, fallback: ActionKindConfig): ActionKindConfig {
  const source = isRecord(raw) ? raw : {};
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : fallback.enabled,
    press: pick(PRESS_EFFECTS, source.press, fallback.press),
    complete: pick(COMPLETE_EFFECTS, source.complete, fallback.complete),
    failure: pick(FAILURE_EFFECTS, source.failure, fallback.failure),
    durationMs: clampDuration(source.durationMs, fallback.durationMs),
    intensity: pick(ANIMATION_INTENSITIES, source.intensity, fallback.intensity),
  };
}

/** The company's settings: every kind present, anything invalid or missing taken from `fallback`. */
export function sanitizeActionAnimations(raw: unknown, fallback: ActionAnimationSettings = DEFAULT_ACTION_ANIMATIONS): ActionAnimationSettings {
  const source = isRecord(raw) ? raw : {};
  const kindsRaw = isRecord(source.kinds) ? source.kinds : {};
  const kinds = {} as Record<ActionKind, ActionKindConfig>;
  for (const id of ACTION_KINDS) {
    const base = fallback.kinds?.[id] ?? DEFAULT_ACTION_KIND_CONFIGS[id];
    kinds[id] = sanitizeKindConfig(kindsRaw[id], base);
  }
  return { enabled: typeof source.enabled === 'boolean' ? source.enabled : fallback.enabled, kinds };
}

/**
 * A user's override, or `undefined` when there is nothing valid (absent = follow the company).
 * Kinds are kept only in `custom` mode and only when they are well-formed objects; a stored kind
 * missing a field takes it from the built-in default, so a stored value is always complete and
 * never contains `undefined` (which Firestore refuses).
 */
export function sanitizeUserAnimations(raw: unknown): UserActionAnimations | undefined {
  if (!isRecord(raw)) return undefined;
  if (typeof raw.mode !== 'string' || !(ANIMATION_MODES as readonly string[]).includes(raw.mode)) return undefined;
  const mode = raw.mode as AnimationMode;
  if (mode !== 'custom') return { mode };
  const kindsRaw = isRecord(raw.kinds) ? raw.kinds : {};
  const kinds: Partial<Record<ActionKind, ActionKindConfig>> = {};
  for (const id of ACTION_KINDS) {
    if (isRecord(kindsRaw[id])) kinds[id] = sanitizeKindConfig(kindsRaw[id], DEFAULT_ACTION_KIND_CONFIGS[id]);
  }
  return { mode, kinds };
}

/** What applies to this user: off → nothing; custom → their kinds over the company's; company → company. */
export function resolveActionAnimations(company: ActionAnimationSettings, user?: UserActionAnimations | null): ActionAnimationSettings {
  if (user?.mode === 'off') return { enabled: false, kinds: company.kinds };
  if (user?.mode === 'custom') {
    const kinds = { ...company.kinds };
    for (const id of ACTION_KINDS) {
      const own = user.kinds?.[id];
      if (own) kinds[id] = own;
    }
    // A user who chose their own animations sees them even when the company default is off.
    return { enabled: true, kinds };
  }
  return company;
}

// ── Inference ────────────────────────────────────────────────────────────────────────────────────

/** Plain verb → its inflections ("save" → saves, saved, saving). */
function forms(...bases: string[]): string[] {
  const out: string[] = [];
  for (const base of bases) {
    const stem = base.endsWith('e') ? base.slice(0, -1) : base;
    out.push(base, `${base}s`, `${stem}ed`, `${stem}ing`);
  }
  return out;
}

/** Word → kind. Checked word by word, first match wins: "Save and send" is a save. */
const WORDS: [ActionKind, string[]][] = [
  ['cancel', [...forms('cancel', 'discard', 'dismiss', 'close'), 'cancelled', 'cancelling']],
  ['delete', forms('delete', 'remove', 'trash', 'erase')],
  ['reject', [...forms('reject', 'decline', 'deny'), 'denied', 'denies']],
  ['approve', [...forms('approve', 'accept', 'authorise', 'authorize', 'certify', 'sanction'), 'certified', 'certifies']],
  ['submit', ['submit', 'submits', 'submitted', 'submitting']],
  ['send', [...forms('send', 'email', 'share', 'notify', 'forward', 'resend'), 'sent', 'notified']],
  ['upload', forms('upload', 'import', 'attach')],
  ['download', forms('download')],
  ['export', [...forms('export'), 'excel', 'csv']],
  ['print', forms('print')],
  ['copy', ['copy', 'copies', 'copied', 'copying', ...forms('duplicate', 'clone')]],
  ['refresh', [...forms('refresh', 'reload', 'sync', 'retry'), 'retried', 'synced', 'syncing']],
  ['save', forms('save')],
  ['update', [...forms('update', 'edit', 'modify', 'change', 'rename'), 'modified', 'modifies']],
  ['create', [...forms('create', 'add', 'generate', 'register'), 'new', 'added', 'adding']],
];
const WORD_KIND = new Map<string, ActionKind>();
for (const [id, words] of WORDS) for (const word of words) if (!WORD_KIND.has(word)) WORD_KIND.set(word, id);

/** Which company UI text label means which kind (Settings › Company Profile › UI text). */
const LABEL_KINDS: Record<string, ActionKind> = {
  save: 'save',
  cancel: 'cancel',
  close: 'cancel',
  delete: 'delete',
  edit: 'update',
  add: 'create',
  export: 'export',
  print: 'print',
  refresh: 'refresh',
  confirm: 'submit',
};

const normalise = (text: string) => text.toLowerCase().replace(/[^\p{L}]+/gu, ' ').trim();

export interface InferActionKindInput {
  /** The button's visible text or aria-label. */
  label?: string | null;
  /** The Button variant; `destructive` with no telling word is a delete. */
  variant?: string | null;
  /** A kind named by the caller (Button `action`, `data-action`), which wins when valid. */
  explicit?: unknown;
  /** The company's UI text labels, so a renamed "Save" ("Keep") is still a save. */
  labels?: Partial<Record<string, string>> | null;
}

export function inferActionKind({ label, variant, explicit, labels }: InferActionKindInput): ActionKind {
  if (isActionKind(explicit)) return explicit;
  const text = normalise(label ?? '');
  if (text && labels) {
    for (const [key, id] of Object.entries(LABEL_KINDS)) {
      const custom = labels[key];
      if (custom && normalise(custom) === text) return id;
    }
  }
  if (text) {
    for (const word of text.split(' ')) {
      const id = WORD_KIND.get(word);
      if (id) return id;
    }
  }
  if (variant === 'destructive') return 'delete';
  return 'generic';
}

/** A toast title that reads as a failure even without the destructive variant. */
export function looksLikeFailure(text: string | null | undefined): boolean {
  return /\b(fail|failed|failure|error|could ?n[o']t|cannot|can't|unable|denied|invalid|not allowed|not saved|missing)\b/i.test(text ?? '');
}

/** Intensity as a multiplier for distances, scales and particle counts. */
export const INTENSITY_SCALE: Record<AnimationIntensity, number> = { subtle: 0.6, normal: 1, strong: 1.6 };

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ACTION_ANIMATION_PRESETS,
  ACTION_KINDS,
  COMPLETE_EFFECTS,
  DEFAULT_ACTION_ANIMATIONS,
  DEFAULT_ACTION_KIND_CONFIGS,
  FAILURE_EFFECTS,
  MAX_DURATION_MS,
  MIN_DURATION_MS,
  PRESS_EFFECTS,
  inferActionKind,
  looksLikeFailure,
  resolveActionAnimations,
  sanitizeActionAnimations,
  sanitizeUserAnimations,
} from '../src/lib/action-animations.ts';
import { DEFAULT_COMPANY_PROFILE, sanitizeCompanyProfile } from '../src/lib/company-profile.ts';

test('every kind has a complete, valid, enabled default', () => {
  assert.equal(ACTION_KINDS.length, 17);
  for (const kind of ACTION_KINDS) {
    const config = DEFAULT_ACTION_KIND_CONFIGS[kind];
    assert.ok(config, kind);
    assert.ok(PRESS_EFFECTS.includes(config.press), kind);
    assert.ok(COMPLETE_EFFECTS.includes(config.complete), kind);
    assert.ok(FAILURE_EFFECTS.includes(config.failure), kind);
    assert.ok(config.durationMs >= MIN_DURATION_MS && config.durationMs <= MAX_DURATION_MS, kind);
    assert.equal(config.intensity, 'subtle', kind);
    assert.equal(config.enabled, true, kind);
  }
  assert.equal(DEFAULT_ACTION_ANIMATIONS.enabled, true);
});

test('the defaults read sensibly per kind', () => {
  assert.equal(DEFAULT_ACTION_KIND_CONFIGS.delete.complete, 'fade');
  assert.equal(DEFAULT_ACTION_KIND_CONFIGS.delete.failure, 'flash');
  assert.equal(DEFAULT_ACTION_KIND_CONFIGS.approve.complete, 'check-burst');
  assert.equal(DEFAULT_ACTION_KIND_CONFIGS.reject.complete, 'shake');
  assert.equal(DEFAULT_ACTION_KIND_CONFIGS.error.complete, 'shake');
  assert.equal(DEFAULT_ACTION_KIND_CONFIGS.save.complete, 'check');
});

test('the presets offer every effect, each with a label', () => {
  assert.deepEqual(ACTION_ANIMATION_PRESETS.press.map((o) => o.id), [...PRESS_EFFECTS]);
  assert.deepEqual(ACTION_ANIMATION_PRESETS.complete.map((o) => o.id), [...COMPLETE_EFFECTS]);
  assert.deepEqual(ACTION_ANIMATION_PRESETS.failure.map((o) => o.id), [...FAILURE_EFFECTS]);
  for (const id of ['none', 'press', 'ripple', 'pulse', 'glow', 'bounce']) assert.ok(PRESS_EFFECTS.includes(id), id);
  for (const id of ['none', 'check', 'burst', 'glow', 'pop', 'slide', 'confetti-lite', 'shake', 'fade']) assert.ok(COMPLETE_EFFECTS.includes(id), id);
});

test('kinds are inferred from English button text', () => {
  const cases = {
    Save: 'save', Saved: 'save', 'Saving…': 'save', 'Save changes': 'save',
    Create: 'create', 'Add item': 'create', 'New invoice': 'create', '+ Add': 'create',
    Update: 'update', Edit: 'update', Delete: 'delete', Remove: 'delete',
    Approve: 'approve', 'Approve & close': 'approve', Reject: 'reject', Submit: 'submit',
    'Send for approval': 'send', Upload: 'upload', Import: 'upload', 'Download PDF': 'download',
    'Export to Excel': 'export', Print: 'print', Copy: 'copy', Duplicate: 'copy',
    Refresh: 'refresh', Retry: 'refresh', Cancel: 'cancel', Close: 'cancel',
    Continue: 'generic', '': 'generic', 'Save and send': 'save',
  };
  for (const [label, kind] of Object.entries(cases)) assert.equal(inferActionKind({ label }), kind, label);
});

test('inference: explicit kind wins, destructive means delete, company labels count', () => {
  assert.equal(inferActionKind({ label: 'Save', explicit: 'approve' }), 'approve');
  assert.equal(inferActionKind({ label: 'Save', explicit: 'bogus' }), 'save');
  assert.equal(inferActionKind({ label: 'Yes, go ahead', variant: 'destructive' }), 'delete');
  assert.equal(inferActionKind({ label: 'Reject', variant: 'destructive' }), 'reject');
  assert.equal(inferActionKind({ label: 'Keep it', labels: { save: 'Keep it' } }), 'save');
  assert.equal(inferActionKind({ label: 'Hatao', labels: { delete: 'Hatao' } }), 'delete');
  // Words inside other words do not count.
  assert.equal(inferActionKind({ label: 'Address book' }), 'generic');
  assert.equal(inferActionKind({ label: 'News' }), 'generic');
});

test('failure-sounding toast titles are recognised', () => {
  assert.ok(looksLikeFailure('Could not save'));
  assert.ok(looksLikeFailure("Couldn't load"));
  assert.ok(looksLikeFailure('Upload failed'));
  assert.ok(!looksLikeFailure('Company profile saved'));
  assert.ok(!looksLikeFailure(undefined));
});

test('company settings are sanitised field by field, durations clamped', () => {
  const out = sanitizeActionAnimations({
    enabled: false,
    kinds: {
      save: { press: 'ripple', complete: 'confetti-lite', failure: 'flash', durationMs: 5000, intensity: 'strong', enabled: false },
      delete: { press: 'explode', complete: '<script>', durationMs: 10 },
      bogus: { press: 'press' },
    },
  });
  assert.equal(out.enabled, false);
  assert.deepEqual(out.kinds.save, { enabled: false, press: 'ripple', complete: 'confetti-lite', failure: 'flash', durationMs: MAX_DURATION_MS, intensity: 'strong' });
  assert.equal(out.kinds.delete.press, DEFAULT_ACTION_KIND_CONFIGS.delete.press);
  assert.equal(out.kinds.delete.complete, DEFAULT_ACTION_KIND_CONFIGS.delete.complete);
  assert.equal(out.kinds.delete.durationMs, MIN_DURATION_MS);
  assert.equal('bogus' in out.kinds, false);
  assert.deepEqual(Object.keys(out.kinds).sort(), [...ACTION_KINDS].sort());
  assert.deepEqual(sanitizeActionAnimations(null), DEFAULT_ACTION_ANIMATIONS);
  assert.deepEqual(sanitizeActionAnimations('nonsense'), DEFAULT_ACTION_ANIMATIONS);
});

test('a missing value falls back to the given settings, not the built-in ones', () => {
  const stored = sanitizeActionAnimations({ enabled: false, kinds: { save: { press: 'bounce' } } });
  const next = sanitizeActionAnimations({ kinds: { copy: { press: 'glow' } } }, stored);
  assert.equal(next.enabled, false);
  assert.equal(next.kinds.save.press, 'bounce');
  assert.equal(next.kinds.copy.press, 'glow');
});

test('user overrides: only valid modes, kinds only in custom mode, never undefined values', () => {
  assert.equal(sanitizeUserAnimations(undefined), undefined);
  assert.equal(sanitizeUserAnimations({ mode: 'loud' }), undefined);
  assert.deepEqual(sanitizeUserAnimations({ mode: 'off', kinds: { save: { press: 'bounce' } } }), { mode: 'off' });
  assert.deepEqual(sanitizeUserAnimations({ mode: 'company' }), { mode: 'company' });
  const custom = sanitizeUserAnimations({ mode: 'custom', kinds: { save: { press: 'bounce' }, bogus: {}, delete: 'x' } });
  assert.deepEqual(Object.keys(custom.kinds), ['save']);
  assert.deepEqual(custom.kinds.save, { ...DEFAULT_ACTION_KIND_CONFIGS.save, press: 'bounce' });
  assert.ok(!JSON.stringify(custom).includes('undefined'));
});

test('resolution: off plays nothing, custom layers over the company, company is the company', () => {
  const company = sanitizeActionAnimations({ enabled: false, kinds: { save: { press: 'glow' } } });
  assert.equal(resolveActionAnimations(company, { mode: 'off' }).enabled, false);
  assert.equal(resolveActionAnimations(company, undefined), company);
  assert.equal(resolveActionAnimations(company, { mode: 'company' }), company);
  const own = resolveActionAnimations(company, { mode: 'custom', kinds: { delete: { ...DEFAULT_ACTION_KIND_CONFIGS.delete, press: 'bounce' } } });
  assert.equal(own.enabled, true);
  assert.equal(own.kinds.delete.press, 'bounce');
  assert.equal(own.kinds.save.press, 'glow');
});

test('the company profile carries the animations through its sanitiser', () => {
  assert.deepEqual(DEFAULT_COMPANY_PROFILE.design.animations, DEFAULT_ACTION_ANIMATIONS);
  const profile = sanitizeCompanyProfile({ design: { animations: { enabled: false, kinds: { approve: { complete: 'confetti-lite' } } } } });
  assert.equal(profile.design.animations.enabled, false);
  assert.equal(profile.design.animations.kinds.approve.complete, 'confetti-lite');
  assert.equal(sanitizeCompanyProfile({}).design.animations.enabled, true);
  // A save that leaves the animations out keeps the stored ones.
  const kept = sanitizeCompanyProfile({ legalName: 'X' }, profile);
  assert.equal(kept.design.animations.kinds.approve.complete, 'confetti-lite');
});

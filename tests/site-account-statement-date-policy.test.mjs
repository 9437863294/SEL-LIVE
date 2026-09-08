import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  describeDateWindow,
  resolveDateControl,
  resolveDateWindow,
  shiftDays,
  todayLocal,
  validateEntryDate,
} from '../src/lib/site-account-statement-date-policy.ts';

const TODAY = '2026-09-15';

const settings = (over = {}) => resolveDateControl({
  enabled: true,
  backdateDays: 7,
  futureDays: 0,
  applyToExpenses: true,
  applyToPayments: true,
  ...over,
});

const check = (date, over = {}, canBypass = false, kind = 'expense') =>
  validateEntryDate({ date, settings: settings(over), kind, canBypass, today: TODAY });

describe('shiftDays', () => {
  it('moves within a month', () => {
    assert.equal(shiftDays('2026-09-15', -7), '2026-09-08');
    assert.equal(shiftDays('2026-09-15', 1), '2026-09-16');
  });

  it('crosses month and year boundaries', () => {
    assert.equal(shiftDays('2026-09-01', -1), '2026-08-31');
    assert.equal(shiftDays('2026-01-01', -1), '2025-12-31');
    assert.equal(shiftDays('2025-12-31', 1), '2026-01-01');
  });

  it('handles leap days', () => {
    assert.equal(shiftDays('2024-03-01', -1), '2024-02-29');
    assert.equal(shiftDays('2026-03-01', -1), '2026-02-28');
  });

  it('returns the input unchanged when it is not a date', () => {
    assert.equal(shiftDays('', -1), '');
    assert.equal(shiftDays('nonsense', -1), 'nonsense');
  });

  it('does not drift a day regardless of the host timezone', () => {
    // Date-only values must not shift when the host is west or east of UTC — the reason the
    // implementation does its arithmetic in UTC rather than with local Date construction.
    assert.equal(shiftDays('2026-09-15', 0), '2026-09-15');
    assert.equal(shiftDays('2026-01-01', 0), '2026-01-01');
  });
});

describe('todayLocal', () => {
  it('formats a local date as YYYY-MM-DD', () => {
    // Constructed from local-time components, so it must read back as the same local day even
    // late at night, when a UTC-based formatter would already have rolled over.
    assert.equal(todayLocal(new Date(2026, 8, 15, 23, 59)), '2026-09-15');
    assert.equal(todayLocal(new Date(2026, 0, 5, 0, 1)), '2026-01-05');
  });
});

describe('resolveDateControl', () => {
  it('is disabled when nothing is stored, so existing installations are unaffected', () => {
    assert.equal(resolveDateControl(undefined).enabled, false);
    assert.equal(resolveDateControl(null).enabled, false);
  });

  it('treats a missing enabled flag as off rather than on', () => {
    assert.equal(resolveDateControl({ backdateDays: 3 }).enabled, false);
  });

  it('falls back to defaults for negative or unparseable day counts', () => {
    // A negative window would invert the range and lock out every possible date.
    assert.equal(resolveDateControl({ enabled: true, backdateDays: -5 }).backdateDays, 7);
    assert.equal(resolveDateControl({ enabled: true, backdateDays: 'abc' }).backdateDays, 7);
    assert.equal(resolveDateControl({ enabled: true, futureDays: -1 }).futureDays, 0);
  });

  it('keeps zero, which is a meaningful setting', () => {
    assert.equal(resolveDateControl({ enabled: true, backdateDays: 0 }).backdateDays, 0);
  });

  it('floors fractional day counts', () => {
    assert.equal(resolveDateControl({ enabled: true, backdateDays: 7.9 }).backdateDays, 7);
  });

  it('defaults both scopes to on', () => {
    const resolved = resolveDateControl({ enabled: true });
    assert.equal(resolved.applyToExpenses, true);
    assert.equal(resolved.applyToPayments, true);
  });
});

describe('resolveDateWindow', () => {
  it('is unrestricted while the feature is off', () => {
    const window = resolveDateWindow({ settings: settings({ enabled: false }), kind: 'expense', canBypass: false, today: TODAY });
    assert.equal(window.enforced, false);
    assert.equal(window.min, null);
  });

  it('is unrestricted for a Backdated Entry holder', () => {
    const window = resolveDateWindow({ settings: settings(), kind: 'expense', canBypass: true, today: TODAY });
    assert.equal(window.enforced, false);
  });

  it('spans backdateDays before today to futureDays after', () => {
    const window = resolveDateWindow({ settings: settings({ backdateDays: 7, futureDays: 2 }), kind: 'expense', canBypass: false, today: TODAY });
    assert.deepEqual([window.min, window.max], ['2026-09-08', '2026-09-17']);
  });

  it('collapses to today when both limits are zero', () => {
    const window = resolveDateWindow({ settings: settings({ backdateDays: 0, futureDays: 0 }), kind: 'expense', canBypass: false, today: TODAY });
    assert.deepEqual([window.min, window.max], [TODAY, TODAY]);
  });

  it('respects the per-record-type scope switches', () => {
    const only = settings({ applyToExpenses: true, applyToPayments: false });
    assert.equal(resolveDateWindow({ settings: only, kind: 'expense', canBypass: false, today: TODAY }).enforced, true);
    assert.equal(resolveDateWindow({ settings: only, kind: 'payment', canBypass: false, today: TODAY }).enforced, false);
  });
});

describe('validateEntryDate', () => {
  it('accepts today', () => {
    assert.equal(check(TODAY).ok, true);
  });

  it('accepts the oldest date in the window, inclusive', () => {
    assert.equal(check('2026-09-08', { backdateDays: 7 }).ok, true);
  });

  it('rejects the day before the window opens', () => {
    const result = check('2026-09-07', { backdateDays: 7 });
    assert.equal(result.ok, false);
    assert.match(result.reason, /cannot be earlier than 2026-09-08/);
    // The message has to say how to proceed, or people work around it with a wrong date.
    assert.match(result.reason, /Backdated Entry/);
  });

  it('rejects a future date when futureDays is zero', () => {
    const result = check('2026-09-16');
    assert.equal(result.ok, false);
    assert.match(result.reason, /cannot be in the future/);
  });

  it('accepts a future date inside an allowed forward window', () => {
    assert.equal(check('2026-09-17', { futureDays: 2 }).ok, true);
    assert.equal(check('2026-09-18', { futureDays: 2 }).ok, false);
  });

  it('allows today only when backdateDays is zero', () => {
    assert.equal(check(TODAY, { backdateDays: 0 }).ok, true);
    assert.equal(check('2026-09-14', { backdateDays: 0 }).ok, false);
  });

  it('accepts anything for a Backdated Entry holder', () => {
    assert.equal(check('2019-01-01', {}, true).ok, true);
    assert.equal(check('2030-01-01', {}, true).ok, true);
  });

  it('accepts anything while the feature is off', () => {
    assert.equal(check('2019-01-01', { enabled: false }).ok, true);
  });

  it('rejects an empty date with a field-specific message', () => {
    assert.match(check('', {}).reason, /Expense date is required/);
    assert.match(check('', {}, false, 'payment').reason, /Receipt date is required/);
  });

  it('uses the record type in its rejection message', () => {
    assert.match(check('2020-01-01', {}, false, 'payment').reason, /^Receipt date/);
  });

  it('does not restrict a record type the window is switched off for', () => {
    assert.equal(check('2019-01-01', { applyToPayments: false }, false, 'payment').ok, true);
    assert.equal(check('2019-01-01', { applyToPayments: false }, false, 'expense').ok, false);
  });
});

describe('describeDateWindow', () => {
  it('says nothing when unrestricted', () => {
    const config = settings({ enabled: false });
    const window = resolveDateWindow({ settings: config, kind: 'expense', canBypass: false, today: TODAY });
    assert.equal(describeDateWindow(window, config), null);
  });

  it('describes a today-only window without a range', () => {
    const config = settings({ backdateDays: 0 });
    const window = resolveDateWindow({ settings: config, kind: 'expense', canBypass: false, today: TODAY });
    assert.equal(describeDateWindow(window, config), 'Today only');
  });

  it('describes a normal window as a range ending at today', () => {
    const config = settings({ backdateDays: 7 });
    const window = resolveDateWindow({ settings: config, kind: 'expense', canBypass: false, today: TODAY });
    assert.equal(describeDateWindow(window, config), 'From 2026-09-08 to today');
  });

  it('names the far date when future dating is allowed', () => {
    const config = settings({ backdateDays: 7, futureDays: 2 });
    const window = resolveDateWindow({ settings: config, kind: 'expense', canBypass: false, today: TODAY });
    assert.equal(describeDateWindow(window, config), 'From 2026-09-08 to 2026-09-17');
  });
});

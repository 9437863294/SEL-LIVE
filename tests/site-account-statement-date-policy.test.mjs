import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MAX_BACKDATE_DAYS,
  MAX_FUTURE_DAYS,
  RULES_LOADING,
  RULES_UNAVAILABLE,
  clampDays,
  describeDateWindow,
  isIsoDate,
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

const check = (date, over = {}, kind = 'expense') =>
  validateEntryDate({ date, settings: settings(over), kind, today: TODAY });

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
    const window = resolveDateWindow({ settings: settings({ enabled: false }), kind: 'expense', today: TODAY });
    assert.equal(window.enforced, false);
    assert.equal(window.min, null);
  });

  it('is the same for everyone — the function takes no permission at all', () => {
    // An earlier version took a canBypass flag that lifted the window. Passing one now does
    // nothing, because there is no parameter for it to reach.
    const window = resolveDateWindow({ settings: settings(), kind: 'expense', canBypass: true, today: TODAY });
    assert.equal(window.enforced, true);
    assert.equal(window.min, '2026-09-08');
  });

  it('spans backdateDays before today to futureDays after', () => {
    const window = resolveDateWindow({ settings: settings({ backdateDays: 7, futureDays: 2 }), kind: 'expense', today: TODAY });
    assert.deepEqual([window.min, window.max], ['2026-09-08', '2026-09-17']);
  });

  it('collapses to today when both limits are zero', () => {
    const window = resolveDateWindow({ settings: settings({ backdateDays: 0, futureDays: 0 }), kind: 'expense', today: TODAY });
    assert.deepEqual([window.min, window.max], [TODAY, TODAY]);
  });

  it('respects the per-record-type scope switches', () => {
    const only = settings({ applyToExpenses: true, applyToPayments: false });
    assert.equal(resolveDateWindow({ settings: only, kind: 'expense', today: TODAY }).enforced, true);
    assert.equal(resolveDateWindow({ settings: only, kind: 'payment', today: TODAY }).enforced, false);
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
    assert.match(result.reason, /Settings → Date Control/);
    // And it must not point at a permission that no longer exists.
    assert.doesNotMatch(result.reason, /Backdated Entry/);
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

  it('refuses an out-of-window date whatever is passed alongside it', () => {
    const attempt = (date) => validateEntryDate({
      date, settings: settings(), kind: 'expense', today: TODAY,
      // Extra arguments an old caller might still send — none of them is read.
      canBypass: true, isAdmin: true, override: true,
    });
    assert.equal(attempt('2019-01-01').ok, false);
    assert.equal(attempt('2030-01-01').ok, false);
  });

  it('accepts anything while the feature is off', () => {
    assert.equal(check('2019-01-01', { enabled: false }).ok, true);
  });

  it('rejects an empty date with a field-specific message', () => {
    assert.match(check('', {}).reason, /Expense date is required/);
    assert.match(check('', {}, 'payment').reason, /Receipt date is required/);
  });

  it('uses the record type in its rejection message', () => {
    assert.match(check('2020-01-01', {}, 'payment').reason, /^Receipt date/);
  });

  it('does not restrict a record type the window is switched off for', () => {
    assert.equal(check('2019-01-01', { applyToPayments: false }, 'payment').ok, true);
    assert.equal(check('2019-01-01', { applyToPayments: false }, 'expense').ok, false);
  });
});

describe('describeDateWindow', () => {
  it('says nothing when unrestricted', () => {
    const config = settings({ enabled: false });
    const window = resolveDateWindow({ settings: config, kind: 'expense', today: TODAY });
    assert.equal(describeDateWindow(window, config), null);
  });

  it('describes a today-only window without a range', () => {
    const config = settings({ backdateDays: 0 });
    const window = resolveDateWindow({ settings: config, kind: 'expense', today: TODAY });
    assert.equal(describeDateWindow(window, config), 'Today only');
  });

  it('describes a normal window as a range ending at today', () => {
    const config = settings({ backdateDays: 7 });
    const window = resolveDateWindow({ settings: config, kind: 'expense', today: TODAY });
    assert.equal(describeDateWindow(window, config), 'From 2026-09-08 to today');
  });

  it('names the far date when future dating is allowed', () => {
    const config = settings({ backdateDays: 7, futureDays: 2 });
    const window = resolveDateWindow({ settings: config, kind: 'expense', today: TODAY });
    assert.equal(describeDateWindow(window, config), 'From 2026-09-08 to 2026-09-17');
  });
});

describe('isIsoDate', () => {
  it('accepts real calendar dates', () => {
    assert.equal(isIsoDate('2026-09-15'), true);
    assert.equal(isIsoDate('2024-02-29'), true); // leap year
    assert.equal(isIsoDate('2026-12-31'), true);
  });

  it('rejects days that do not exist', () => {
    assert.equal(isIsoDate('2026-02-29'), false); // not a leap year
    assert.equal(isIsoDate('2026-02-30'), false);
    assert.equal(isIsoDate('2026-04-31'), false);
    assert.equal(isIsoDate('2026-13-01'), false);
    assert.equal(isIsoDate('2026-00-10'), false);
    assert.equal(isIsoDate('2026-09-00'), false);
  });

  it('rejects anything not exactly YYYY-MM-DD', () => {
    for (const bad of ['2026-9-15', '2026-09-15x', ' 2026-09-15', '15-09-2026', '2026/09/15', '', null, 20260915]) {
      assert.equal(isIsoDate(bad), false, String(bad));
    }
  });
});

describe('validateEntryDate — malformed input', () => {
  it('refuses a malformed date that would sort inside the window', () => {
    // String comparison alone put this between the 14th and the 15th and waved it through.
    const result = check('2026-09-14x');
    assert.equal(result.ok, false);
    assert.match(result.reason, /real date in YYYY-MM-DD/);
  });

  it('refuses a day that does not exist even inside the window', () => {
    assert.equal(check('2026-09-31', { backdateDays: 30, futureDays: 30 }).ok, false);
  });

  it('refuses a malformed date even while the window is off', () => {
    // The window being off is "any date", not "anything at all".
    assert.equal(check('2026-02-30', { enabled: false }).ok, false);
    assert.equal(check('2026-09-15', { enabled: false }).ok, true);
  });
});

describe('resolveDateControl — stored values', () => {
  it('reads only real numbers as day counts', () => {
    // Number(null) and Number('') are both 0, which used to turn a half-written document into
    // "today only" for every site.
    const fromNull = resolveDateControl({ enabled: true, backdateDays: null, futureDays: '' });
    assert.equal(fromNull.backdateDays, 7);
    assert.equal(fromNull.futureDays, 0);
    assert.equal(resolveDateControl({ enabled: true, backdateDays: '30' }).backdateDays, 7);
  });

  it('caps stored windows at the published maximum', () => {
    const huge = resolveDateControl({ enabled: true, backdateDays: 99999, futureDays: 99999 });
    assert.equal(huge.backdateDays, MAX_BACKDATE_DAYS);
    assert.equal(huge.futureDays, MAX_FUTURE_DAYS);
  });

  it('floors fractional days rather than rejecting them', () => {
    assert.equal(resolveDateControl({ enabled: true, backdateDays: 7.9 }).backdateDays, 7);
  });

  it('keeps zero as a real answer', () => {
    assert.equal(resolveDateControl({ enabled: true, backdateDays: 0 }).backdateDays, 0);
  });
});

describe('clampDays', () => {
  it('makes typed input whole, non-negative and bounded', () => {
    assert.equal(clampDays('15', 3650), 15);
    assert.equal(clampDays('1.9', 3650), 1);
    assert.equal(clampDays('-3', 3650), 0);
    assert.equal(clampDays('99999', 3650), 3650);
    assert.equal(clampDays('', 3650), 0);
    assert.equal(clampDays('abc', 3650), 0);
    assert.equal(clampDays(NaN, 3650), 0);
  });
});

describe('unresolved rules', () => {
  it('refuse rather than fall back to the "off" defaults', () => {
    // The hook starts from defaults that say unrestricted; these are what it answers instead
    // until the real settings have arrived.
    assert.equal(RULES_LOADING.ok, false);
    assert.equal(RULES_UNAVAILABLE.ok, false);
    assert.match(RULES_LOADING.reason, /still loading/);
    assert.match(RULES_UNAVAILABLE.reason, /could not be loaded/);
  });
});

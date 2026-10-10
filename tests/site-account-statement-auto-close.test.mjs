import test from 'node:test';
import assert from 'node:assert/strict';

const {
  resolveMonthClosure,
  effectiveClosure,
  isMonthClosed,
  closedPeriods,
  autoCloseDateFor,
  autoRuleFor,
  projectsWithOverride,
  validateAgainstClosure,
  validateRecordChange,
  canClosePeriod,
  canReopenPeriod,
  monthState,
  hasOwnAutoRule,
  clampAutoCloseDay,
  validateAutoCloseRule,
  describeAutoRule,
  withAutoRule,
  previewAutoRuleChange,
  upcomingAutoCloses,
  relockDateFor,
  isIsoDay,
  addDays,
  nextPeriod,
  AUTO_CLOSE_DAY_MAX,
} = await import('../src/lib/site-account-statement-month-closure.ts');

const RULE = { enabled: true, dayOfNextMonth: 5, startPeriod: '2026-04' };

/** A snapshot read for a pinned day, so every test is independent of the real clock. */
function snap(stored, asOf = '2026-10-10') {
  return resolveMonthClosure(stored, asOf);
}

// ── Calendar helpers ───────────────────────────────────────────────────────────

test('calendar helpers roll over months and years', () => {
  assert.equal(nextPeriod('2026-09'), '2026-10');
  assert.equal(nextPeriod('2026-12'), '2027-01');
  assert.equal(addDays('2026-10-30', 3), '2026-11-02');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(isIsoDay('2026-02-29'), false);
  assert.equal(isIsoDay('2024-02-29'), true);
});

// ── The trigger ────────────────────────────────────────────────────────────────

test('a month closes on the configured day of the following month', () => {
  assert.equal(autoCloseDateFor('2026-09', RULE), '2026-10-05');
  assert.equal(autoCloseDateFor('2026-12', RULE), '2027-01-05');
  assert.equal(autoCloseDateFor('2026-09', { dayOfNextMonth: 1 }), '2026-10-01');
});

test('a month is open the day before its trigger and closed on the day itself', () => {
  const stored = { autoClose: RULE };
  assert.equal(isMonthClosed(snap(stored, '2026-10-04'), '2026-09'), false);
  assert.equal(isMonthClosed(snap(stored, '2026-10-05'), '2026-09'), true);
  assert.equal(isMonthClosed(snap(stored, '2026-10-06'), '2026-09'), true);
});

test('the result says the rule closed it, and when', () => {
  const effect = effectiveClosure(snap({ autoClose: RULE }), '2026-09');
  assert.equal(effect.closed, true);
  assert.equal(effect.source, 'auto');
  assert.equal(effect.autoScope, 'all');
  assert.equal(effect.closesOn, '2026-10-05');
  assert.equal(effect.record, null);
});

test('an open month under a rule reports the day it will close', () => {
  const effect = effectiveClosure(snap({ autoClose: RULE }), '2026-10');
  assert.equal(effect.closed, false);
  assert.equal(effect.source, 'none');
  assert.equal(effect.closesOn, '2026-11-05');
});

test('the current month and future months never close automatically', () => {
  const settings = snap({ autoClose: RULE });
  assert.equal(isMonthClosed(settings, '2026-10'), false);
  assert.equal(isMonthClosed(settings, '2026-11'), false);
  assert.equal(monthState('2026-10', settings, '2026-10'), 'current');
});

test('months before the start month are never touched by the rule', () => {
  // Without a start month, switching the rule on would close a site's whole history at once.
  const settings = snap({ autoClose: RULE });
  assert.equal(isMonthClosed(settings, '2026-03'), false);
  assert.equal(isMonthClosed(settings, '2026-04'), true);
});

test('a disabled rule closes nothing', () => {
  assert.equal(isMonthClosed(snap({ autoClose: { ...RULE, enabled: false } }), '2026-09'), false);
});

// ── Reading stored rules ───────────────────────────────────────────────────────

test('an enabled rule missing its start month is dropped, not guessed', () => {
  // A guessed start would close history nobody chose to close.
  assert.equal(snap({ autoClose: { enabled: true, dayOfNextMonth: 5 } }).autoClose, null);
  assert.equal(snap({ autoClose: { enabled: true, dayOfNextMonth: 5, startPeriod: 'soon' } }).autoClose, null);
});

test('an enabled rule with an impossible day is dropped', () => {
  for (const day of [0, 29, 31, 5.5, '5', null]) {
    assert.equal(
      snap({ autoClose: { enabled: true, dayOfNextMonth: day, startPeriod: '2026-04' } }).autoClose,
      null,
      `day ${day}`,
    );
  }
});

test('a disabled project rule survives being incomplete — it means "opt out"', () => {
  const settings = snap({ projectAutoClose: { p1: { enabled: false } } });
  assert.equal(settings.projectAutoClose.p1.enabled, false);
});

test('a rules map of the wrong shape is survived', () => {
  assert.deepEqual(snap({ projectAutoClose: 'all' }).projectAutoClose, {});
  assert.deepEqual(snap({ projectAutoClose: [] }).projectAutoClose, {});
  assert.equal(snap({ autoClose: 'yes' }).autoClose, null);
});

// ── Order of authority ─────────────────────────────────────────────────────────

test('a manual reopen for all projects beats the rule', () => {
  const settings = snap({
    autoClose: RULE,
    months: { '2026-09': { closed: false, reopenReason: 'Late HO bill' } },
  });
  assert.equal(isMonthClosed(settings, '2026-09'), false);
  assert.equal(effectiveClosure(settings, '2026-09').source, 'all');
});

test('a manual reopen for one project beats the rule for that project only', () => {
  const settings = snap({
    autoClose: RULE,
    projects: { p1: { '2026-09': { closed: false, reopenReason: 'Missed bill' } } },
  });
  assert.equal(isMonthClosed(settings, '2026-09', 'p1'), false);
  assert.equal(isMonthClosed(settings, '2026-09', 'p2'), true);
});

test('a manual close beats a rule that would not yet have closed the month', () => {
  const settings = snap({ autoClose: { ...RULE, dayOfNextMonth: 20 }, months: { '2026-09': { closed: true } } });
  assert.equal(isMonthClosed(settings, '2026-09'), true);
  assert.equal(effectiveClosure(settings, '2026-09').source, 'all');
});

test('the all-projects manual entry outranks a project rule', () => {
  // Anything decided by a person outranks anything decided by a rule.
  const settings = snap({
    months: { '2026-09': { closed: false, reopenReason: 'Reopened for everyone' } },
    projectAutoClose: { p1: RULE },
  });
  assert.equal(isMonthClosed(settings, '2026-09', 'p1'), false);
});

test('a project rule replaces the organisation rule for that project', () => {
  const settings = snap({ autoClose: RULE, projectAutoClose: { p1: { ...RULE, dayOfNextMonth: 15 } } });
  // Organisation: Sept closed on 5 Oct. p1: not until 15 Oct.
  assert.equal(isMonthClosed(settings, '2026-09'), true);
  assert.equal(isMonthClosed(settings, '2026-09', 'p1'), false);
  assert.equal(autoRuleFor(settings, 'p1').scope, 'project');
  assert.equal(autoRuleFor(settings, 'p2').scope, 'all');
});

test('a project can opt out of the organisation rule', () => {
  const settings = snap({ autoClose: RULE, projectAutoClose: { p1: { enabled: false } } });
  assert.equal(isMonthClosed(settings, '2026-09', 'p1'), false);
  assert.equal(isMonthClosed(settings, '2026-09', 'p2'), true);
});

test('a project can close itself automatically while the organisation has no rule', () => {
  const settings = snap({ projectAutoClose: { p1: RULE } });
  assert.equal(isMonthClosed(settings, '2026-09', 'p1'), true);
  assert.equal(isMonthClosed(settings, '2026-09'), false);
});

test('projects that differ only by their own rule are reported as differing', () => {
  const settings = snap({ autoClose: RULE, projectAutoClose: { p1: { enabled: false } } });
  assert.deepEqual(projectsWithOverride(settings, '2026-09'), [{ projectId: 'p1', closed: false }]);
});

test('a project rule that agrees with the organisation is not reported as differing', () => {
  const settings = snap({ autoClose: RULE, projectAutoClose: { p1: RULE } });
  assert.deepEqual(projectsWithOverride(settings, '2026-09'), []);
});

// ── Listing ────────────────────────────────────────────────────────────────────

test('closed periods include automatically closed months, which have no stored entry', () => {
  const settings = snap({ autoClose: { ...RULE, startPeriod: '2026-06' } });
  assert.deepEqual(closedPeriods(settings), ['2026-06', '2026-07', '2026-08', '2026-09']);
});

test('closed periods merge manual and automatic, without duplicates', () => {
  const settings = snap({
    autoClose: { ...RULE, startPeriod: '2026-08' },
    months: { '2026-08': { closed: true }, '2026-05': { closed: true } },
  });
  assert.deepEqual(closedPeriods(settings), ['2026-05', '2026-08', '2026-09']);
});

test('upcoming closes are listed only for open months a rule will close', () => {
  const settings = snap({ autoClose: RULE });
  assert.deepEqual(
    upcomingAutoCloses(['2026-09', '2026-10', '2026-11', '2026-03'], settings),
    { '2026-10': '2026-11-05', '2026-11': '2026-12-05' },
  );
});

// ── Enforcement ────────────────────────────────────────────────────────────────

test('an entry dated in an automatically closed month is refused, saying so', () => {
  const check = validateAgainstClosure({ date: '2026-09-20', settings: snap({ autoClose: RULE }), kind: 'expense' });
  assert.equal(check.ok, false);
  assert.match(check.reason, /closed automatically on 2026-10-05/);
});

test('editing and deleting inside an automatically closed month are refused', () => {
  const settings = snap({ autoClose: RULE });
  for (const action of ['edit', 'delete']) {
    const check = validateRecordChange({
      originalDate: '2026-09-20', nextDate: '2026-09-21', settings, kind: 'expense', action,
    });
    assert.equal(check.ok, false);
    assert.match(check.reason, /automatically/);
  }
});

test('the same entry is accepted the day before the trigger', () => {
  assert.equal(validateAgainstClosure({
    date: '2026-09-20', settings: snap({ autoClose: RULE }, '2026-10-04'), kind: 'expense',
  }).ok, true);
});

test('an automatically closed month can be reopened but not closed again', () => {
  const settings = snap({ autoClose: RULE });
  assert.equal(canReopenPeriod('2026-09', settings).ok, true);
  assert.equal(canClosePeriod('2026-09', settings, '2026-10').ok, false);
});

// ── Timed reopens ──────────────────────────────────────────────────────────────

test('a reopen with a lock-again date is open until that day, then closed', () => {
  const stored = { months: { '2026-09': { closed: false, reopenReason: 'Fix', relockOn: '2026-10-13' } } };
  assert.equal(isMonthClosed(snap(stored, '2026-10-12'), '2026-09'), false);
  assert.equal(isMonthClosed(snap(stored, '2026-10-13'), '2026-09'), true);
  assert.equal(effectiveClosure(snap(stored, '2026-10-13'), '2026-09').relocked, true);
});

test('a reopen that has locked again says so in the refusal', () => {
  const stored = { months: { '2026-09': { closed: false, relockOn: '2026-10-13' } } };
  const check = validateAgainstClosure({ date: '2026-09-20', settings: snap(stored, '2026-10-14'), kind: 'payment' });
  assert.equal(check.ok, false);
  assert.match(check.reason, /locked again/);
});

test('a reopen with no lock-again date stays open', () => {
  const stored = { autoClose: RULE, months: { '2026-09': { closed: false } } };
  assert.equal(isMonthClosed(snap(stored, '2027-06-01'), '2026-09'), false);
});

test('a malformed lock-again date means no limit, never "locked now"', () => {
  const stored = { months: { '2026-09': { closed: false, relockOn: 'next week' } } };
  assert.equal(isMonthClosed(snap(stored), '2026-09'), false);
  assert.equal(snap(stored).months['2026-09'].relockOn, undefined);
});

test('the lock-again date is the reopen day plus the chosen days', () => {
  assert.equal(relockDateFor('2026-10-10', 1), '2026-10-11');
  assert.equal(relockDateFor('2026-10-10', 3), '2026-10-13');
  assert.equal(relockDateFor('2026-10-30', 7), '2026-11-06');
  assert.equal(relockDateFor('2026-10-10', null), undefined);
  assert.equal(relockDateFor('2026-10-10', 0), undefined);
});

// ── Editing a rule ─────────────────────────────────────────────────────────────

test('a typed trigger day is kept inside 1–28', () => {
  assert.equal(clampAutoCloseDay('5'), 5);
  assert.equal(clampAutoCloseDay('31'), AUTO_CLOSE_DAY_MAX);
  assert.equal(clampAutoCloseDay('0'), 1);
  assert.equal(clampAutoCloseDay('7.8'), 7);
  assert.equal(clampAutoCloseDay('abc'), 1);
});

test('an enabled rule must have a real day and start month', () => {
  assert.equal(validateAutoCloseRule(RULE).ok, true);
  assert.equal(validateAutoCloseRule({ ...RULE, dayOfNextMonth: 30 }).ok, false);
  assert.equal(validateAutoCloseRule({ ...RULE, startPeriod: '' }).ok, false);
  // Off needs nothing.
  assert.equal(validateAutoCloseRule({ enabled: false, dayOfNextMonth: 0, startPeriod: '' }).ok, true);
});

test('a rule is described in plain words', () => {
  assert.match(describeAutoRule(RULE), /day 5 of the following month, from 2026-04/);
  assert.match(describeAutoRule({ ...RULE, enabled: false }), /Never/);
  assert.match(describeAutoRule(null), /No automatic/);
});

test('switching a rule on previews exactly the months it closes now', () => {
  const settings = snap({});
  const preview = previewAutoRuleChange(settings, undefined, { ...RULE, startPeriod: '2026-07' });
  assert.deepEqual(preview.closesNow, ['2026-07', '2026-08', '2026-09']);
  assert.deepEqual(preview.reopens, []);
});

test('turning a rule off is caught as a reopen of everything it closed', () => {
  const settings = snap({ autoClose: { ...RULE, startPeriod: '2026-08' } });
  const preview = previewAutoRuleChange(settings, undefined, { ...RULE, startPeriod: '2026-08', enabled: false });
  assert.deepEqual(preview.reopens, ['2026-08', '2026-09']);
  assert.deepEqual(preview.closesNow, []);
});

test('moving the trigger later is caught as a reopen when it crosses today', () => {
  // On 10 Oct, day 5 has closed September; day 15 would not have yet.
  const settings = snap({ autoClose: RULE });
  const preview = previewAutoRuleChange(settings, undefined, { ...RULE, dayOfNextMonth: 15 });
  assert.deepEqual(preview.reopens, ['2026-09']);
});

test('moving the start month later is caught as a reopen', () => {
  const settings = snap({ autoClose: { ...RULE, startPeriod: '2026-06' } });
  const preview = previewAutoRuleChange(settings, undefined, { ...RULE, startPeriod: '2026-08' });
  assert.deepEqual(preview.reopens, ['2026-06', '2026-07']);
});

test('a month held closed by hand is not reported as reopened when the rule goes', () => {
  const settings = snap({ autoClose: RULE, months: { '2026-09': { closed: true } } });
  const preview = previewAutoRuleChange(settings, undefined, { ...RULE, enabled: false });
  assert.equal(preview.reopens.includes('2026-09'), false);
});

test('removing a project rule previews against the organisation rule it falls back to', () => {
  const settings = snap({ autoClose: RULE, projectAutoClose: { p1: { enabled: false } } });
  // p1 opted out; following the organisation again closes April–September for it.
  const preview = previewAutoRuleChange(settings, 'p1', null);
  assert.deepEqual(preview.closesNow, ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
});

test('withAutoRule removes a project rule when given null, and leaves others alone', () => {
  const settings = snap({ projectAutoClose: { p1: RULE, p2: RULE } });
  const after = withAutoRule(settings, 'p1', null);
  assert.equal(hasOwnAutoRule(after, 'p1'), false);
  assert.equal(hasOwnAutoRule(after, 'p2'), true);
  // The original is not mutated.
  assert.equal(hasOwnAutoRule(settings, 'p1'), true);
});

test('an unchanged rule previews no change', () => {
  const settings = snap({ autoClose: RULE });
  assert.deepEqual(previewAutoRuleChange(settings, undefined, RULE), { closesNow: [], reopens: [] });
});

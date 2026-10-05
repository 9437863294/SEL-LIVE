import test from 'node:test';
import assert from 'node:assert/strict';

const {
  EMPTY_MONTH_CLOSURE,
  isPeriodKey,
  resolveMonthClosure,
  closureFor,
  isMonthClosed,
  closedPeriods,
  latestClosedPeriod,
  monthState,
  canClosePeriod,
  canReopenPeriod,
  validateReopenReason,
  validateAgainstClosure,
  summariseClosure,
  periodsToBulkClose,
} = await import('../src/lib/site-account-statement-month-closure.ts');

const NOW = '2026-10';

/** Settings holding the given periods as closed. */
function closedOn(...periods) {
  return resolveMonthClosure({
    months: Object.fromEntries(periods.map(p => [p, { period: p, closed: true, closedByName: 'A. Bhoi' }])),
  });
}

// ── Period keys ───────────────────────────────────────────────────────────────

test('a period key is a year and a real month', () => {
  assert.equal(isPeriodKey('2026-04'), true);
  assert.equal(isPeriodKey('2026-12'), true);
  assert.equal(isPeriodKey('2026-00'), false);
  assert.equal(isPeriodKey('2026-13'), false);
  assert.equal(isPeriodKey('2026-4'), false);
  assert.equal(isPeriodKey('2026-04-01'), false);
  assert.equal(isPeriodKey(''), false);
  assert.equal(isPeriodKey(undefined), false);
});

// ── Reading what is stored ────────────────────────────────────────────────────

test('nothing stored resolves to nothing closed', () => {
  assert.deepEqual(resolveMonthClosure(null), EMPTY_MONTH_CLOSURE);
  assert.deepEqual(resolveMonthClosure(undefined).months, {});
  assert.deepEqual(resolveMonthClosure({}).months, {});
});

test('a stored closure is read back with its audit fields', () => {
  const settings = resolveMonthClosure({
    months: {
      '2026-09': {
        period: '2026-09', closed: true, closedByName: 'A. Bhoi',
        note: 'Reported to HO', closedAt: 'ts',
      },
    },
  });
  const entry = closureFor(settings, '2026-09');
  assert.equal(entry.closed, true);
  assert.equal(entry.closedByName, 'A. Bhoi');
  assert.equal(entry.note, 'Reported to HO');
  assert.equal(entry.closedAt, 'ts');
});

test('a malformed period key is dropped rather than repaired', () => {
  const settings = resolveMonthClosure({
    months: { 'last-month': { closed: true }, '2026-13': { closed: true } },
  });
  assert.deepEqual(settings.months, {});
});

test('a non-object entry is dropped', () => {
  const settings = resolveMonthClosure({ months: { '2026-09': 'closed', '2026-08': null } });
  assert.deepEqual(settings.months, {});
});

test('anything other than an explicit true leaves the month open', () => {
  // A half-written document must never read as a lock nobody applied, nor unlock one they did.
  const settings = resolveMonthClosure({
    months: {
      '2026-09': { closed: 'yes' },
      '2026-08': { closed: 1 },
      '2026-07': { closed: true },
    },
  });
  assert.equal(isMonthClosed(settings, '2026-09'), false);
  assert.equal(isMonthClosed(settings, '2026-08'), false);
  assert.equal(isMonthClosed(settings, '2026-07'), true);
});

test('a months field of the wrong shape is survived', () => {
  assert.deepEqual(resolveMonthClosure({ months: 'all' }).months, {});
  assert.deepEqual(resolveMonthClosure({ months: [] }).months, {});
});

test('an unknown period is not closed and has no record', () => {
  assert.equal(isMonthClosed(EMPTY_MONTH_CLOSURE, '2026-09'), false);
  assert.equal(closureFor(EMPTY_MONTH_CLOSURE, '2026-09'), null);
});

// ── Listing ───────────────────────────────────────────────────────────────────

test('closed periods come back oldest first, open ones excluded', () => {
  const settings = resolveMonthClosure({
    months: {
      '2026-09': { closed: true },
      '2026-04': { closed: true },
      '2026-07': { closed: false },
      '2026-06': { closed: true },
    },
  });
  assert.deepEqual(closedPeriods(settings), ['2026-04', '2026-06', '2026-09']);
});

test('the latest closed period is the newest one, across a year boundary', () => {
  assert.equal(latestClosedPeriod(closedOn('2025-12', '2026-01')), '2026-01');
  assert.equal(latestClosedPeriod(EMPTY_MONTH_CLOSURE), null);
});

// ── State ─────────────────────────────────────────────────────────────────────

test('a month is current, future, open or closed', () => {
  assert.equal(monthState('2026-10', EMPTY_MONTH_CLOSURE, NOW), 'current');
  assert.equal(monthState('2026-11', EMPTY_MONTH_CLOSURE, NOW), 'future');
  assert.equal(monthState('2026-09', EMPTY_MONTH_CLOSURE, NOW), 'open');
  assert.equal(monthState('2026-09', closedOn('2026-09'), NOW), 'closed');
});

test('closure outranks every other state', () => {
  // A current month that somehow got closed must read as closed, not as current.
  assert.equal(monthState('2026-10', closedOn('2026-10'), NOW), 'closed');
});

// ── Closing and reopening ─────────────────────────────────────────────────────

test('a past month can be closed', () => {
  assert.equal(canClosePeriod('2026-09', EMPTY_MONTH_CLOSURE, NOW).ok, true);
});

test('the current month cannot be closed while it is still running', () => {
  const check = canClosePeriod('2026-10', EMPTY_MONTH_CLOSURE, NOW);
  assert.equal(check.ok, false);
  assert.match(check.reason, /still in progress/i);
});

test('a future month cannot be closed', () => {
  const check = canClosePeriod('2026-12', EMPTY_MONTH_CLOSURE, NOW);
  assert.equal(check.ok, false);
  assert.match(check.reason, /future/i);
});

test('an already-closed month cannot be closed again', () => {
  const check = canClosePeriod('2026-09', closedOn('2026-09'), NOW);
  assert.equal(check.ok, false);
  assert.match(check.reason, /already closed/i);
});

test('a malformed period cannot be closed', () => {
  assert.equal(canClosePeriod('2026-99', EMPTY_MONTH_CLOSURE, NOW).ok, false);
});

test('only a closed month can be reopened', () => {
  assert.equal(canReopenPeriod('2026-09', closedOn('2026-09')).ok, true);
  const check = canReopenPeriod('2026-09', EMPTY_MONTH_CLOSURE);
  assert.equal(check.ok, false);
  assert.match(check.reason, /not closed/i);
});

test('a reopen reason must be given and must say something', () => {
  assert.equal(validateReopenReason('').ok, false);
  assert.equal(validateReopenReason('   ').ok, false);
  assert.equal(validateReopenReason('typo').ok, false);
  assert.equal(validateReopenReason('Missed bill from the vendor, approved by HO.').ok, true);
});

test('a reopen reason is measured after trimming', () => {
  assert.equal(validateReopenReason('        oops        ').ok, false);
});

// ── Enforcement on an entry date ──────────────────────────────────────────────

test('a date in an open month passes', () => {
  assert.equal(validateAgainstClosure({
    date: '2026-10-02', settings: closedOn('2026-09'), kind: 'expense', canOverride: false,
  }).ok, true);
});

test('a date inside a closed month is refused, naming the month', () => {
  const check = validateAgainstClosure({
    date: '2026-09-28', settings: closedOn('2026-09'), kind: 'expense', canOverride: false,
  });
  assert.equal(check.ok, false);
  assert.match(check.reason, /2026-09/);
  assert.match(check.reason, /closed/i);
});

test('the message names the field the form actually shows', () => {
  const expense = validateAgainstClosure({
    date: '2026-09-01', settings: closedOn('2026-09'), kind: 'expense', canOverride: false,
  });
  const payment = validateAgainstClosure({
    date: '2026-09-01', settings: closedOn('2026-09'), kind: 'payment', canOverride: false,
  });
  assert.match(expense.reason, /^Expense date/);
  assert.match(payment.reason, /^Receipt date/);
});

test('the first and last day of a closed month are both inside it', () => {
  for (const date of ['2026-09-01', '2026-09-30']) {
    assert.equal(validateAgainstClosure({
      date, settings: closedOn('2026-09'), kind: 'expense', canOverride: false,
    }).ok, false);
  }
  // And the days either side are not.
  for (const date of ['2026-08-31', '2026-10-01']) {
    assert.equal(validateAgainstClosure({
      date, settings: closedOn('2026-09'), kind: 'expense', canOverride: false,
    }).ok, true);
  }
});

test('whoever can close a month may post into it', () => {
  assert.equal(validateAgainstClosure({
    date: '2026-09-28', settings: closedOn('2026-09'), kind: 'expense', canOverride: true,
  }).ok, true);
});

test('an empty date is left to the field that owns it', () => {
  // Required-ness is Date Control's message to give; two errors for one blank field is noise.
  assert.equal(validateAgainstClosure({
    date: '', settings: closedOn('2026-09'), kind: 'expense', canOverride: false,
  }).ok, true);
});

test('a malformed date is not treated as closed', () => {
  assert.equal(validateAgainstClosure({
    date: 'yesterday', settings: closedOn('2026-09'), kind: 'expense', canOverride: false,
  }).ok, true);
});

// ── Summary and bulk close ────────────────────────────────────────────────────

const FY = [
  '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09',
  '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03',
];

test('the summary counts closed, open and what could be closed now', () => {
  const s = summariseClosure(FY, closedOn('2026-04', '2026-05'), NOW);
  assert.equal(s.total, 12);
  assert.equal(s.closed, 2);
  assert.equal(s.open, 10);
  // June to September. October is current, November onwards is future.
  assert.equal(s.closable, 4);
});

test('a financial year with nothing closed has nothing closed', () => {
  const s = summariseClosure(FY, EMPTY_MONTH_CLOSURE, NOW);
  assert.equal(s.closed, 0);
  assert.equal(s.open, 12);
});

test('bulk close resolves to the months it will really act on', () => {
  const list = periodsToBulkClose(FY, '2026-09', closedOn('2026-05'), NOW);
  // May is already closed and is skipped; the rest up to September are included.
  assert.deepEqual(list, ['2026-04', '2026-06', '2026-07', '2026-08', '2026-09']);
});

test('bulk close never reaches the current or a future month', () => {
  // Asking for everything through March takes only what is genuinely past.
  const list = periodsToBulkClose(FY, '2027-03', EMPTY_MONTH_CLOSURE, NOW);
  assert.deepEqual(list, ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
  assert.equal(list.includes('2026-10'), false);
});

test('bulk close over an already-settled year is empty rather than an error', () => {
  assert.deepEqual(periodsToBulkClose(FY, '2026-09', closedOn(...FY), NOW), []);
});

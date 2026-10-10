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
  isRecordLocked,
  validateRecordChange,
  effectiveClosure,
  projectsWithOverride,
  canFollowAllProjects,
  ALL_PROJECTS,
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
  // Same as the empty constant apart from the day it was read for.
  assert.deepEqual(
    resolveMonthClosure(null, '2026-10-10'),
    { ...EMPTY_MONTH_CLOSURE, asOf: '2026-10-10' },
  );
  assert.deepEqual(resolveMonthClosure(undefined).months, {});
  assert.deepEqual(resolveMonthClosure({}).months, {});
  assert.equal(resolveMonthClosure({}).autoClose, null);
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
    date: '2026-10-02', settings: closedOn('2026-09'), kind: 'expense',
  }).ok, true);
});

test('a date inside a closed month is refused, naming the month', () => {
  const check = validateAgainstClosure({
    date: '2026-09-28', settings: closedOn('2026-09'), kind: 'expense',
  });
  assert.equal(check.ok, false);
  assert.match(check.reason, /2026-09/);
  assert.match(check.reason, /closed/i);
});

test('the message names the field the form actually shows', () => {
  const expense = validateAgainstClosure({
    date: '2026-09-01', settings: closedOn('2026-09'), kind: 'expense',
  });
  const payment = validateAgainstClosure({
    date: '2026-09-01', settings: closedOn('2026-09'), kind: 'payment',
  });
  assert.match(expense.reason, /^Expense date/);
  assert.match(payment.reason, /^Receipt date/);
});

test('the first and last day of a closed month are both inside it', () => {
  for (const date of ['2026-09-01', '2026-09-30']) {
    assert.equal(validateAgainstClosure({
      date, settings: closedOn('2026-09'), kind: 'expense',
    }).ok, false);
  }
  // And the days either side are not.
  for (const date of ['2026-08-31', '2026-10-01']) {
    assert.equal(validateAgainstClosure({
      date, settings: closedOn('2026-09'), kind: 'expense',
    }).ok, true);
  }
});

test('nobody may post into a closed month — the check takes no permission at all', () => {
  // The signature deliberately has no override parameter: a bypass would make the lock depend on
  // who is writing rather than on the state of the period.
  const check = validateAgainstClosure({
    date: '2026-09-28', settings: closedOn('2026-09'), kind: 'expense',
  });
  assert.equal(check.ok, false);
  assert.match(check.reason, /reopened/i);
});

test('an empty date is left to the field that owns it', () => {
  // Required-ness is Date Control's message to give; two errors for one blank field is noise.
  assert.equal(validateAgainstClosure({
    date: '', settings: closedOn('2026-09'), kind: 'expense',
  }).ok, true);
});

test('a malformed date is not treated as closed', () => {
  assert.equal(validateAgainstClosure({
    date: 'yesterday', settings: closedOn('2026-09'), kind: 'expense',
  }).ok, true);
});

// ── Editing and deleting stored records ───────────────────────────────────────

test('a record dated in a closed month is locked', () => {
  const settings = closedOn('2026-09');
  assert.equal(isRecordLocked({ date: '2026-09-15', settings }), true);
  assert.equal(isRecordLocked({ date: '2026-10-15', settings }), false);
});

test('a record with no date is never locked', () => {
  const settings = closedOn('2026-09');
  assert.equal(isRecordLocked({ date: '', settings }), false);
  assert.equal(isRecordLocked({ date: undefined, settings }), false);
  // ...but one that does sit in the closed month is, for everyone.
  assert.equal(isRecordLocked({ date: '2026-09-15', settings }), true);
});

test('an expense in a closed month cannot be edited', () => {
  const check = validateRecordChange({
    originalDate: '2026-09-15', nextDate: '2026-09-16',
    settings: closedOn('2026-09'), kind: 'expense', action: 'edit',
  });
  assert.equal(check.ok, false);
  assert.match(check.reason, /2026-09/);
  assert.match(check.reason, /cannot be changed/i);
});

test('an expense in a closed month cannot be deleted', () => {
  const check = validateRecordChange({
    originalDate: '2026-09-15',
    settings: closedOn('2026-09'), kind: 'expense', action: 'delete',
  });
  assert.equal(check.ok, false);
  assert.match(check.reason, /cannot be deleted/i);
});

test('a record cannot be moved OUT of a closed month', () => {
  // The most damaging edit: the destination is open, so a date-only check would wave it through
  // while the closed month quietly loses a reported figure.
  const check = validateRecordChange({
    originalDate: '2026-09-28', nextDate: '2026-10-02',
    settings: closedOn('2026-09'), kind: 'expense', action: 'edit',
  });
  assert.equal(check.ok, false);
  assert.match(check.reason, /2026-09/);
});

test('a record cannot be moved INTO a closed month', () => {
  const check = validateRecordChange({
    originalDate: '2026-10-02', nextDate: '2026-09-28',
    settings: closedOn('2026-09'), kind: 'payment', action: 'edit',
  });
  assert.equal(check.ok, false);
  assert.match(check.reason, /moved into it/i);
  assert.match(check.reason, /receipt/);
});

test('an edit entirely within open months passes', () => {
  assert.equal(validateRecordChange({
    originalDate: '2026-10-02', nextDate: '2026-10-20',
    settings: closedOn('2026-09'), kind: 'expense', action: 'edit',
  }).ok, true);
});

test('the message names the kind of record the user is looking at', () => {
  const expense = validateRecordChange({
    originalDate: '2026-09-15', settings: closedOn('2026-09'),
    kind: 'expense', action: 'delete',
  });
  const payment = validateRecordChange({
    originalDate: '2026-09-15', settings: closedOn('2026-09'),
    kind: 'payment', action: 'delete',
  });
  assert.match(expense.reason, /expense/);
  assert.match(payment.reason, /receipt/);
});

test('no role can edit or delete inside a closed month', () => {
  // `validateRecordChange` takes no permission argument, so there is nothing a caller could pass
  // to get a different answer — the lock cannot be argued with from the UI side.
  for (const action of ['edit', 'delete']) {
    const check = validateRecordChange({
      originalDate: '2026-09-15', nextDate: '2026-09-16',
      settings: closedOn('2026-09'), kind: 'expense', action,
    });
    assert.equal(check.ok, false);
    assert.match(check.reason, /by anyone/i);
  }
});

test('a delete needs no destination date to be allowed', () => {
  assert.equal(validateRecordChange({
    originalDate: '2026-10-02', settings: closedOn('2026-09'),
    kind: 'expense', action: 'delete',
  }).ok, true);
});

test('an edit that clears the date is not treated as a move into a closed month', () => {
  // Blank dates are the date field's own error to report, not closure's.
  assert.equal(validateRecordChange({
    originalDate: '2026-10-02', nextDate: '',
    settings: closedOn('2026-09'), kind: 'expense', action: 'edit',
  }).ok, true);
});

// ── Per-project closure ───────────────────────────────────────────────────────

/** The organisation's calendar, plus per-project exceptions. */
function withProjects(allClosed, projects) {
  return resolveMonthClosure({
    months: Object.fromEntries(allClosed.map(p => [p, { period: p, closed: true }])),
    projects,
  });
}

test('a project with no exception follows the all-projects calendar', () => {
  const settings = withProjects(['2026-09'], {});
  const effect = effectiveClosure(settings, '2026-09', 'p1');
  assert.equal(effect.closed, true);
  assert.equal(effect.source, 'all');
  assert.equal(isMonthClosed(settings, '2026-09', 'p1'), true);
});

test('one project can be closed while the rest stay open', () => {
  const settings = withProjects([], { p1: { '2026-09': { period: '2026-09', closed: true } } });
  assert.equal(isMonthClosed(settings, '2026-09', 'p1'), true);
  assert.equal(isMonthClosed(settings, '2026-09', 'p2'), false);
  // And the organisation's own calendar is untouched.
  assert.equal(isMonthClosed(settings, '2026-09'), false);
});

test('one project can be reopened while everyone else stays closed', () => {
  // The reason the override has to be a tri-state: present-and-false is a real answer.
  const settings = withProjects(['2026-09'], {
    p1: { '2026-09': { period: '2026-09', closed: false, reopenReason: 'Late vendor bill.' } },
  });
  assert.equal(isMonthClosed(settings, '2026-09', 'p1'), false);
  assert.equal(isMonthClosed(settings, '2026-09', 'p2'), true);
  assert.equal(effectiveClosure(settings, '2026-09', 'p1').source, 'project');
});

test('a project exception wins over the all-projects calendar in both directions', () => {
  const closedEverywhere = withProjects(['2026-09'], {
    open1: { '2026-09': { period: '2026-09', closed: false } },
  });
  const openEverywhere = withProjects([], {
    shut1: { '2026-09': { period: '2026-09', closed: true } },
  });
  assert.equal(isMonthClosed(closedEverywhere, '2026-09', 'open1'), false);
  assert.equal(isMonthClosed(openEverywhere, '2026-09', 'shut1'), true);
});

test('with no project given, only the all-projects calendar is consulted', () => {
  const settings = withProjects([], { p1: { '2026-09': { period: '2026-09', closed: true } } });
  assert.equal(isMonthClosed(settings, '2026-09'), false);
});

test('a project map with nothing usable in it is dropped, not kept as an empty exception', () => {
  const settings = resolveMonthClosure({ months: {}, projects: { p1: { 'nope': { closed: true } } } });
  assert.deepEqual(settings.projects, {});
});

test('a projects field of the wrong shape is survived', () => {
  assert.deepEqual(resolveMonthClosure({ projects: 'all' }).projects, {});
  assert.deepEqual(resolveMonthClosure({ projects: [] }).projects, {});
  assert.deepEqual(resolveMonthClosure(null).projects, {});
});

test('closed periods are listed per project, merging both layers', () => {
  const settings = withProjects(['2026-04'], {
    p1: { '2026-06': { period: '2026-06', closed: true }, '2026-04': { period: '2026-04', closed: false } },
  });
  // p1 is let back into April but frozen in June; everyone else just has April.
  assert.deepEqual(closedPeriods(settings, 'p1'), ['2026-06']);
  assert.deepEqual(closedPeriods(settings, 'p2'), ['2026-04']);
  assert.deepEqual(closedPeriods(settings), ['2026-04']);
});

test('projects that depart from the all-projects calendar are listed', () => {
  const settings = withProjects(['2026-09'], {
    p1: { '2026-09': { period: '2026-09', closed: false } },
    p2: { '2026-09': { period: '2026-09', closed: true } },  // agrees — not an exception
  });
  assert.deepEqual(projectsWithOverride(settings, '2026-09'), [{ projectId: 'p1', closed: false }]);
});

test('an exception can be dropped only when there is one', () => {
  const settings = withProjects(['2026-09'], {
    p1: { '2026-09': { period: '2026-09', closed: false } },
  });
  assert.equal(canFollowAllProjects('2026-09', settings, 'p1').ok, true);
  assert.equal(canFollowAllProjects('2026-09', settings, 'p2').ok, false);
});

test('close and reopen eligibility are judged per project', () => {
  const settings = withProjects([], { p1: { '2026-09': { period: '2026-09', closed: true } } });
  assert.equal(canClosePeriod('2026-09', settings, NOW, 'p1').ok, false);  // already closed there
  assert.equal(canClosePeriod('2026-09', settings, NOW, 'p2').ok, true);
  assert.equal(canReopenPeriod('2026-09', settings, 'p1').ok, true);
  assert.equal(canReopenPeriod('2026-09', settings, 'p2').ok, false);
});

test('a month state is read through the project lens', () => {
  const settings = withProjects([], { p1: { '2026-09': { period: '2026-09', closed: true } } });
  assert.equal(monthState('2026-09', settings, NOW, 'p1'), 'closed');
  assert.equal(monthState('2026-09', settings, NOW, 'p2'), 'open');
});

// ── Enforcement respects the project ──────────────────────────────────────────

test('an entry date is judged against its own project calendar', () => {
  const settings = withProjects([], { p1: { '2026-09': { period: '2026-09', closed: true } } });
  assert.equal(validateAgainstClosure({
    date: '2026-09-15', settings, kind: 'expense', projectId: 'p1',
  }).ok, false);
  assert.equal(validateAgainstClosure({
    date: '2026-09-15', settings, kind: 'expense', projectId: 'p2',
  }).ok, true);
});

test('a project let back in can record again while the rest cannot', () => {
  const settings = withProjects(['2026-09'], {
    p1: { '2026-09': { period: '2026-09', closed: false } },
  });
  assert.equal(validateAgainstClosure({
    date: '2026-09-15', settings, kind: 'expense', projectId: 'p1',
  }).ok, true);
  assert.equal(validateAgainstClosure({
    date: '2026-09-15', settings, kind: 'expense', projectId: 'p2',
  }).ok, false);
});

test('editing is judged against the project the record belongs to', () => {
  const settings = withProjects([], { p1: { '2026-09': { period: '2026-09', closed: true } } });
  assert.equal(validateRecordChange({
    originalDate: '2026-09-15', nextDate: '2026-09-16', settings,
    kind: 'expense', action: 'edit', originalProjectId: 'p1',
  }).ok, false);
  assert.equal(validateRecordChange({
    originalDate: '2026-09-15', nextDate: '2026-09-16', settings,
    kind: 'expense', action: 'edit', originalProjectId: 'p2',
  }).ok, true);
});

test('moving a record to another project is judged against that project calendar', () => {
  // p2 is frozen in September; an expense cannot be reassigned into it.
  const settings = withProjects([], { p2: { '2026-09': { period: '2026-09', closed: true } } });
  const check = validateRecordChange({
    originalDate: '2026-09-15', nextDate: '2026-09-15', settings,
    kind: 'expense', action: 'edit', originalProjectId: 'p1', nextProjectId: 'p2',
  });
  assert.equal(check.ok, false);
  assert.match(check.reason, /project you are moving this to/i);
});

test('reassigning out of a frozen project is still refused', () => {
  const settings = withProjects([], { p1: { '2026-09': { period: '2026-09', closed: true } } });
  assert.equal(validateRecordChange({
    originalDate: '2026-09-15', nextDate: '2026-09-15', settings,
    kind: 'expense', action: 'edit', originalProjectId: 'p1', nextProjectId: 'p2',
  }).ok, false);
});

test('deleting is judged against the record own project', () => {
  const settings = withProjects([], { p1: { '2026-09': { period: '2026-09', closed: true } } });
  assert.equal(validateRecordChange({
    originalDate: '2026-09-15', settings, kind: 'expense',
    action: 'delete', originalProjectId: 'p1',
  }).ok, false);
  assert.equal(validateRecordChange({
    originalDate: '2026-09-15', settings, kind: 'expense',
    action: 'delete', originalProjectId: 'p2',
  }).ok, true);
});

test('bulk close and the summary are both per project', () => {
  const settings = withProjects(['2026-04'], {
    p1: { '2026-04': { period: '2026-04', closed: false } },
  });
  // p1 is open in April, so a bulk close through June picks it up again; others skip it.
  assert.ok(periodsToBulkClose(FY, '2026-06', settings, NOW, 'p1').includes('2026-04'));
  assert.equal(periodsToBulkClose(FY, '2026-06', settings, NOW, 'p2').includes('2026-04'), false);
  assert.equal(summariseClosure(FY, settings, NOW, 'p1').closed, 0);
  assert.equal(summariseClosure(FY, settings, NOW, 'p2').closed, 1);
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

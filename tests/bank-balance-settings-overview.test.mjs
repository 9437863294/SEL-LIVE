import test from 'node:test';
import assert from 'node:assert/strict';
import { settingsOverview } from '../src/lib/bank-balance-settings-overview.ts';
import { resolveBBDateControl } from '../src/lib/bank-balance-entry-controls.ts';
import { resolveMonthClosure } from '../src/lib/site-account-statement-month-closure.ts';

const today = new Date('2026-11-02T10:00:00');
const limitOn = (account) => (account.drawingPower?.length ? 1000 : 0);
const cc = (id, extra = {}) => ({
  id, shortName: id.toUpperCase(), accountType: 'Cash Credit', status: 'Active', openingDate: '2026-04-01',
  drawingPower: [{ fromDate: '2026-09-30', toDate: null }], interestRateLog: [{ fromDate: '2026-04-01', toDate: null, rate: 9.5 }], ...extra,
});
const ca = (id, extra = {}) => ({ id, shortName: id.toUpperCase(), accountType: 'Current Account', status: 'Active', openingDate: '2026-04-01', ...extra });

test('a fully set-up module scores every judged card and lists nothing to fix', () => {
  const overview = settingsOverview({
    accounts: [cc('sbi'), cc('pnb'), ca('canara')],
    limitOn,
    today,
    lastMonthEntered: true,
    fieldControl: { doc: null, updatedAt: null },
    dateControl: resolveBBDateControl(null),
    closure: resolveMonthClosure(null, '2026-11-02'),
  });
  assert.deepEqual(overview.issues, []);
  assert.deepEqual(overview.health, { ok: 4, total: 4 });
  assert.deepEqual(overview.cards.accounts.stats.map((s) => s.value), ['3', '2', '1']);
  assert.deepEqual(overview.cards.dp.stats, [{ value: '₹2 K', label: 'total limit' }, { value: '30 Sep', label: 'last change' }]);
  assert.equal(overview.cards.rates.stats[0].value, '2 of 2');
  // Optional controls not in use are neutral, and left out of the score.
  assert.equal(overview.cards.fieldControl.statusLabel, 'Defaults');
  assert.equal(overview.cards.dateControl.statusLabel, 'Off');
  assert.equal(overview.cards.monthClosure.statusLabel, 'Not in use');
});

test('missing opening dates, limits, rates and interest become issues', () => {
  const overview = settingsOverview({
    accounts: [cc('sbi', { drawingPower: [], interestRateLog: [] }), ca('canara', { openingDate: '' }), ca('old', { status: 'Inactive', openingDate: '' })],
    limitOn,
    today,
    lastMonthEntered: false,
  });
  assert.deepEqual(overview.issues.map((i) => i.card), ['accounts', 'dp', 'rates', 'monthlyInterest']);
  assert.match(overview.issues[0].text, /1 account without an opening date \(CANARA\)/);
  assert.equal(overview.cards.rates.note, 'SBI has no rate');
  assert.equal(overview.cards.monthlyInterest.note, 'Oct 2026 not entered yet');
  assert.deepEqual(overview.health, { ok: 0, total: 4 });
  // Unreadable sources are neutral, not guessed.
  assert.equal(overview.cards.dateControl.statusLabel, 'Not available');
});

test('date control and month closure describe what is in force', () => {
  const overview = settingsOverview({
    accounts: [ca('canara')],
    limitOn,
    today,
    lastMonthEntered: true,
    dateControl: resolveBBDateControl({ enabled: true, backdateDays: 3, accounts: { canara: { enabled: false } } }),
    closure: resolveMonthClosure({ months: { '2026-09': { closed: true } } }, '2026-11-02'),
  });
  assert.deepEqual(overview.cards.dateControl.stats.map((s) => s.value), ['3 days', '0 days', '90 days']);
  assert.equal(overview.cards.dateControl.note, '1 account with a rule of its own');
  assert.equal(overview.cards.monthClosure.stats[0].value, 'Sep 2026');
  assert.equal(overview.cards.monthClosure.status, 'due');
  assert.equal(overview.issues.at(-1).text, 'Oct 2026 has not been closed yet');

  const automatic = settingsOverview({
    accounts: [ca('canara')], limitOn, today, lastMonthEntered: true,
    closure: resolveMonthClosure({ autoClose: { enabled: true, dayOfNextMonth: 5, startPeriod: '2026-09' } }, '2026-11-02'),
  });
  assert.equal(automatic.cards.monthClosure.statusLabel, 'Automatic');
  assert.equal(automatic.cards.monthClosure.note, 'Oct 2026 closes automatically on 5 Nov');
});

test('the appearance card names the design in use and stays out of the health score', () => {
  const chosen = settingsOverview({
    accounts: [ca('canara')], limitOn, today, lastMonthEntered: true,
    dashboardDesign: { label: 'Aurora', designs: 5, chosenBy: 'A. Person', chosenAt: new Date('2026-11-02T16:09:00') },
  });
  assert.deepEqual(chosen.cards.appearance.stats, [{ value: 'Aurora', label: 'in use' }, { value: '5', label: 'designs' }]);
  assert.equal(chosen.cards.appearance.statusLabel, 'Chosen');
  assert.equal(chosen.cards.appearance.note, 'Set by A. Person · 2 Nov');
  assert.deepEqual(chosen.health, { ok: 2, total: 2 });
  const fresh = settingsOverview({ accounts: [ca('canara')], limitOn, today, lastMonthEntered: true, dashboardDesign: { label: 'Classic', designs: 5 } });
  assert.equal(fresh.cards.appearance.statusLabel, 'Default');
});

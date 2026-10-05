import test from 'node:test';
import assert from 'node:assert/strict';
import {
  annualisedPremium,
  bucketByMonth,
  compactInr,
  premiumByInsurer,
  coverEndDate,
  dayKey,
  dueState,
  firstInstalmentFrom,
  graceDays,
  instalmentRegister,
  intervalYears,
  isPremiumFrequency,
  nextDueAfterPayment,
  normalisePolicyNo,
  parseTypedDate,
  personalPolicyState,
  premiumOutflows,
  premiumSchedule,
  policyFrequency,
  projectPolicyState,
  taskCheckId,
  toDate,
} from '../src/lib/insurance.ts';

// Mid-morning local time, so no test depends on how the machine's time zone treats midnight.
const at = (day) => new Date(`${day}T10:00:00`);
const keys = (dates) => dates.map(dayKey);

test('schedule steps from commencement and keeps month-end dates', () => {
  const s = premiumSchedule(at('2024-01-31'), 'Monthly', 1);
  assert.equal(s.length, 12);
  assert.deepEqual(keys(s).slice(0, 3), ['2024-01-31', '2024-02-29', '2024-03-31']);
});

test('schedule counts per frequency and handles One-Time and empty terms', () => {
  assert.equal(premiumSchedule(at('2024-04-01'), 'Yearly', 10).length, 10);
  assert.equal(premiumSchedule(at('2024-04-01'), 'Half-Yearly', 3).length, 6);
  assert.equal(premiumSchedule(at('2024-04-01'), 'Quarterly', 2).length, 8);
  assert.deepEqual(keys(premiumSchedule(at('2024-04-01'), 'One-Time', 0)), ['2024-04-01']);
  assert.deepEqual(premiumSchedule(at('2024-04-01'), 'Yearly', 0), []);
  assert.deepEqual(premiumSchedule(null, 'Yearly', 5), []);
  assert.equal(premiumSchedule(at('2024-04-01'), 'Monthly', 9999).length, 1200, 'capped');
});

test('first instalment from today does not loop for a past One-Time policy', () => {
  const past = premiumSchedule(at('2020-01-01'), 'One-Time', 0);
  assert.equal(firstInstalmentFrom(past, at('2026-09-29')), null);
  const yearly = premiumSchedule(at('2020-10-15'), 'Yearly', 10);
  assert.equal(dayKey(firstInstalmentFrom(yearly, at('2026-09-29'))), '2026-10-15');
  assert.equal(dayKey(firstInstalmentFrom(yearly, at('2026-10-15'))), '2026-10-15', 'due today counts');
});

test('next due after payment follows the schedule and stops at the end or maturity', () => {
  const inputs = { commencement: at('2024-01-10'), frequency: 'Yearly', termYears: 3, maturity: null };
  assert.equal(dayKey(nextDueAfterPayment(inputs, at('2024-01-10'))), '2025-01-10');
  assert.equal(nextDueAfterPayment(inputs, at('2026-01-10')), null, 'last instalment');
  assert.equal(
    nextDueAfterPayment({ ...inputs, termYears: 10, maturity: at('2025-01-10') }, at('2024-01-10')),
    null,
    'next would fall on maturity',
  );
  assert.equal(nextDueAfterPayment({ ...inputs, frequency: 'One-Time' }, at('2024-01-10')), null);
  const legacy = { commencement: null, frequency: 'Quarterly', termYears: 0, maturity: null };
  assert.equal(dayKey(nextDueAfterPayment(legacy, at('2024-01-10'))), '2024-04-10', 'no schedule: one step on');
});

test('grace period defaults by frequency and honours an override', () => {
  assert.equal(graceDays('Monthly'), 15);
  assert.equal(graceDays('Yearly'), 30);
  assert.equal(graceDays('Yearly', 0), 0);
  assert.equal(graceDays('Yearly', 45), 45);
});

test('due state moves from upcoming to due soon, grace and lapsed', () => {
  const due = at('2026-10-01');
  assert.equal(dueState(due, at('2026-08-01'), 30), 'upcoming');
  assert.equal(dueState(due, at('2026-09-15'), 30), 'due-soon');
  assert.equal(dueState(due, at('2026-10-01'), 30), 'due-soon', 'due today');
  assert.equal(dueState(due, at('2026-10-02'), 30), 'grace');
  assert.equal(dueState(due, at('2026-10-31'), 30), 'grace', 'last grace day');
  assert.equal(dueState(due, at('2026-11-01'), 30), 'lapsed');
});

test('personal state: stored lifecycle wins, then maturity, then the due date', () => {
  const now = at('2026-09-29');
  const base = { payment_type: 'Yearly', due_date: at('2026-10-10'), date_of_maturity: at('2040-01-01') };
  assert.equal(personalPolicyState(base, now), 'due-soon');
  assert.equal(personalPolicyState({ ...base, status: 'Active' }, now), 'due-soon');
  assert.equal(personalPolicyState({ ...base, status: 'Surrendered' }, now), 'surrendered');
  assert.equal(personalPolicyState({ ...base, date_of_maturity: at('2026-09-01') }, now), 'matured');
  assert.equal(personalPolicyState({ ...base, due_date: null }, now), 'active', 'fully paid');
  assert.equal(personalPolicyState({ ...base, due_date: at('2026-09-20') }, now), 'grace');
  assert.equal(personalPolicyState({ ...base, due_date: at('2026-08-01') }, now), 'lapsed');
  assert.equal(
    personalPolicyState({ ...base, payment_type: 'Monthly', due_date: at('2026-09-10') }, now),
    'lapsed',
    'monthly grace is 15 days',
  );
  assert.equal(personalPolicyState({ ...base, due_date: { seconds: at('2027-06-01').getTime() / 1000 } }, now), 'active');
});

test('instalment register attaches labelled payments and paid-late legacy payments', () => {
  const schedule = premiumSchedule(at('2022-05-01'), 'Yearly', 6); // 2022 … 2027
  const payments = [
    // Paid a week late — the old register matched on exact date and left this instalment unpaid.
    { id: 'legacy-2024', paymentDate: at('2024-05-08') },
    { id: 'labelled-2025', paymentDate: at('2025-04-28'), instalmentDueDate: at('2025-05-01') },
  ];
  const rows = instalmentRegister(schedule, at('2026-05-01'), payments, at('2026-05-20'), 30);
  assert.deepEqual(
    rows.map((r) => [r.no, r.state, r.payment?.id ?? null, r.isCurrent]),
    [
      [1, 'paid', null, false], // settled before the policy was recorded here
      [2, 'paid', null, false],
      [3, 'paid', 'legacy-2024', false],
      [4, 'paid', 'labelled-2025', false],
      [5, 'grace', null, true],
      [6, 'upcoming', null, false],
    ],
  );
});

test('instalment register with no next due treats every instalment as paid', () => {
  const schedule = premiumSchedule(at('2022-05-01'), 'Yearly', 2);
  const rows = instalmentRegister(schedule, null, [], at('2026-05-20'), 30);
  assert.deepEqual(rows.map((r) => r.state), ['paid', 'paid']);
});

test('project state is decided by the end date, not the stale stored Active', () => {
  const now = at('2026-09-29');
  assert.equal(projectPolicyState({ status: 'Active', insured_until: at('2026-09-01') }, now), 'expired');
  assert.equal(projectPolicyState({ status: 'Active', insured_until: at('2026-10-20') }, now), 'expiring');
  assert.equal(projectPolicyState({ status: 'Active', insured_until: at('2027-10-20') }, now), 'active');
  assert.equal(projectPolicyState({ status: 'Not Required', insured_until: at('2026-09-01') }, now), 'not-required');
  assert.equal(projectPolicyState({ status: 'Close' }, now), 'closed');
  assert.equal(projectPolicyState({ status: 'Expired', insured_until: at('2030-01-01') }, now), 'expired');
});

test('policy numbers compare without case, spaces or dashes', () => {
  assert.equal(normalisePolicyNo('ab-12 34/5'), normalisePolicyNo('AB12345'));
});

test('task check ids keep the legacy premium format', () => {
  assert.equal(taskCheckId('p1', at('2026-10-01')), 'p1-2026-10-01');
  assert.equal(taskCheckId('p1', at('2026-10-01'), 'maturity'), 'p1-maturity-2026-10-01');
});

test('annualised premium', () => {
  assert.equal(annualisedPremium(1000, 'Monthly'), 12000);
  assert.equal(annualisedPremium(1000, 'Half-Yearly'), 2000);
  assert.equal(annualisedPremium(1000, 'One-Time'), 0);
});

test('every-N-years frequency drives schedule, outgo and next due', () => {
  assert.equal(intervalYears('Every 5 Years'), 5);
  assert.equal(intervalYears('Every 1 Years'), null, 'one year is Yearly');
  assert.equal(intervalYears('Yearly'), null);
  assert.ok(isPremiumFrequency('Every 2 Years'));
  assert.ok(!isPremiumFrequency('Every Two Years'));
  assert.equal(policyFrequency({ payment_type: 'Every 3 Years' }), 'Every 3 Years');
  assert.deepEqual(keys(premiumSchedule(at('2024-04-01'), 'Every 2 Years', 6)), ['2024-04-01', '2026-04-01', '2028-04-01']);
  assert.deepEqual(keys(premiumSchedule(at('2024-04-01'), 'Every 5 Years', 12)), ['2024-04-01', '2029-04-01', '2034-04-01'], 'partial cycle still pays');
  assert.equal(annualisedPremium(50000, 'Every 5 Years'), 10000);
  const inputs = { commencement: at('2024-04-01'), frequency: 'Every 3 Years', termYears: 9, maturity: null };
  assert.equal(dayKey(nextDueAfterPayment(inputs, at('2024-04-01'))), '2027-04-01');
  assert.equal(nextDueAfterPayment(inputs, at('2030-04-01')), null, 'last instalment');
  assert.equal(dayKey(nextDueAfterPayment({ ...inputs, commencement: null }, at('2024-04-01'))), '2027-04-01', 'no schedule: one step on');
  assert.equal(graceDays('Every 2 Years'), 30);
});

test('typed dates are day first and must be real', () => {
  const k = (t) => { const d = parseTypedDate(t); return d ? dayKey(d) : null; };
  assert.equal(k('15/03/2026'), '2026-03-15');
  assert.equal(k('5-3-2026'), '2026-03-05');
  assert.equal(k('15.03.26'), '2026-03-15');
  assert.equal(k('01/01/85'), '1985-01-01');
  assert.equal(k('15032026'), '2026-03-15');
  assert.equal(k('15 Mar 2026'), '2026-03-15');
  assert.equal(k('15-march-2026'), '2026-03-15');
  assert.equal(k('3 Sept 2026'), '2026-09-03');
  assert.equal(k(' 2026-03-15 '), '2026-03-15');
  assert.equal(k('29/02/2024'), '2024-02-29');
  assert.equal(k('29/02/2026'), null, 'not a leap year');
  assert.equal(k('31/04/2026'), null);
  assert.equal(k('13/13/2026'), null);
  assert.equal(k('15 Xyz 2026'), null);
  assert.equal(k('2026'), null);
  assert.equal(k(''), null);
});

test('toDate accepts Firestore-like values', () => {
  const d = at('2026-01-01');
  assert.equal(toDate({ toDate: () => d }), d);
  assert.equal(toDate(null), null);
  assert.equal(toDate('not a date'), null);
});

test('forecast carries arrears, walks instalments and skips retired policies', () => {
  const now = at('2026-09-29');
  const personal = [
    {
      id: 'a', policy_no: 'A', insured_person: 'Asha', insurance_company: 'LIC', premium: 1000,
      payment_type: 'Quarterly', due_date: at('2026-09-01'), date_of_comm: at('2025-09-01'), tenure: 5,
    },
    {
      id: 'b', policy_no: 'B', insured_person: 'Ben', insurance_company: 'LIC', premium: 500,
      payment_type: 'Yearly', due_date: at('2026-11-01'), status: 'Surrendered',
    },
  ];
  const project = [
    { id: 'p', policy_no: 'P', assetName: 'Site', insurance_company: 'ICICI', premium: 9000, status: 'Active', insured_until: at('2027-01-15') },
    { id: 'q', policy_no: 'Q', assetName: 'Old', insurance_company: 'ICICI', premium: 1, status: 'Not Required', insured_until: at('2026-12-01') },
  ];
  const out = premiumOutflows(personal, project, at('2026-09-29'), at('2027-03-29'), now);
  assert.deepEqual(
    out.map((o) => [o.policyId, dayKey(o.date), o.overdue]),
    [
      ['a', '2026-09-29', true],
      ['a', '2026-12-01', false],
      ['p', '2027-01-15', false],
      ['a', '2027-03-01', false],
    ],
  );
  const buckets = bucketByMonth(out, at('2026-09-29'), 6);
  assert.equal(buckets.length, 6);
  assert.equal(buckets[0].key, '2026-09');
  assert.equal(buckets[0].total, 1000);
  assert.equal(buckets[4].project, 9000);
});

test('cover runs to the day before the anniversary', () => {
  assert.equal(dayKey(coverEndDate(at('2026-04-01'), 1, 0)), '2027-03-31');
  assert.equal(dayKey(coverEndDate(at('2026-04-01'), 0, 6)), '2026-09-30');
  assert.equal(coverEndDate(at('2026-04-01'), 0, 0), null);
});

test('compact rupees use Indian units', () => {
  assert.equal(compactInr(950), '₹950');
  assert.equal(compactInr(12500), '₹12.5 K');
  assert.equal(compactInr(420000), '₹4.2 L');
  assert.equal(compactInr(13500000), '₹1.35 Cr');
});

test('premium by insurer counts live cover only and folds the tail into Other', () => {
  const now = at('2026-09-29');
  const personal = [
    { insurance_company: 'LIC', premium: 1000, payment_type: 'Monthly', due_date: at('2026-10-10') },
    { insurance_company: 'LIC', premium: 5000, payment_type: 'Yearly', due_date: at('2026-08-01') }, // lapsed
    { insurance_company: 'HDFC', premium: 3000, payment_type: 'Yearly', due_date: at('2027-01-01'), status: 'Surrendered' },
  ];
  const project = [
    { insurance_company: 'ICICI', premium: 9000, status: 'Active', insured_until: at('2027-03-31') },
    { insurance_company: 'LIC', premium: 500, status: 'Active', insured_until: at('2026-01-01') }, // expired
  ];
  assert.deepEqual(premiumByInsurer(personal, project, now), [
    { name: 'LIC', personal: 12000, project: 0, total: 12000, policies: 1 },
    { name: 'ICICI', personal: 0, project: 9000, total: 9000, policies: 1 },
  ]);
  const many = ['A', 'B', 'C', 'D'].map((n, i) => ({ insurance_company: n, premium: 100 - i, status: 'Active', insured_until: at('2027-06-01') }));
  const folded = premiumByInsurer([], many, now, 3);
  assert.deepEqual(folded.map((r) => [r.name, r.total, r.policies]), [['A', 100, 1], ['B', 99, 1], ['Other', 195, 2]]);
});

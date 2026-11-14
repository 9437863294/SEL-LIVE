import assert from 'node:assert/strict';
import test from 'node:test';

const checks = await import('../src/lib/project-management-dpr-sheet-checks.ts');
const { buildDprSheetChecks, dprSheetBoqState, dprSheetLineQty } = checks;

const row = (over = {}) => ({
  boqItemId: 'a',
  slNo: '2.2',
  unit: 'Cum',
  decimals: 3,
  boqQty: 250,
  planned: 2,
  doneBefore: 10,
  actual: '1.5',
  location: 'Block A',
  agency: 'Own',
  ...over,
});

const input = (over = {}) => ({
  rows: [row()],
  weather: 'Clear',
  lostTimeHours: '',
  lostTimeReason: '',
  tolerancePct: 0,
  ...over,
});

const keys = (findings) => findings.map((finding) => finding.key);

test('a complete sheet has nothing to flag', () => {
  const findings = buildDprSheetChecks(input());
  assert.deepEqual(keys(findings), ['clear']);
  assert.equal(findings[0].tone, 'success');
  assert.equal(findings[0].title, 'Nothing to flag');
});

test('the mock-up sheet: whole BOQ in a day with no plan, a reason with no time lost, blanks', () => {
  const findings = buildDprSheetChecks(
    input({
      rows: [row({ boqItemId: 'lot', slNo: '7.4', unit: 'Lot', decimals: 0, boqQty: 1, planned: 0, doneBefore: 0, actual: '1', location: '', agency: '' })],
      weather: '',
      lostTimeReason: 'ok',
    }),
  );
  assert.deepEqual(keys(findings), ['unplanned', 'reason-no-time', 'blanks']);
  const [unplanned, reason, blanks] = findings;
  assert.equal(unplanned.tone, 'danger');
  assert.equal(unplanned.mark, '7.4');
  assert.equal(unplanned.detail, '1 Lot recorded on a line with no projection for the day — the whole BOQ quantity in one day.');
  assert.equal(reason.title, 'Reason “ok” with no time lost');
  assert.match(reason.detail, /Time lost is blank/);
  assert.equal(blanks.tone, 'info');
  assert.equal(blanks.title, 'Weather, location and agency not recorded');
  // One line: no "on 1 of 1 lines".
  assert.equal(blanks.detail, 'Left blank: weather; location; agency. Optional, but it backs a delay or a hindrance later.');
});

test('a zero or blank actual on an unplanned line is not work done without a plan', () => {
  assert.deepEqual(keys(buildDprSheetChecks(input({ rows: [row({ planned: 0, actual: '0' })] }))), ['clear']);
  assert.deepEqual(keys(buildDprSheetChecks(input({ rows: [row({ planned: 0, actual: '' })] }))), ['clear']);
});

test('several unplanned lines make one finding naming them', () => {
  const rows = ['1', '2', '3', '4', '5'].map((slNo) => row({ boqItemId: slNo, slNo, planned: 0, actual: '1' }));
  const [finding] = buildDprSheetChecks(input({ rows }));
  assert.equal(finding.key, 'unplanned');
  assert.equal(finding.mark, '5');
  assert.equal(finding.detail, '1, 2, 3 and 2 more have work recorded but nothing projected for the day.');
});

test('above the BOQ quantity: blocking past the tolerance, a warning within it', () => {
  const past = buildDprSheetChecks(input({ rows: [row({ boqQty: 10, doneBefore: 9, actual: '2' })] }));
  assert.deepEqual(keys(past), ['over-a']);
  assert.equal(past[0].tone, 'danger');
  assert.equal(past[0].mark, '2.2');
  assert.equal(past[0].detail, '2.2: 11 against a BOQ of 10 Cum — past the BOQ quantity, so the sheet cannot be submitted.');

  const within = buildDprSheetChecks(input({ rows: [row({ boqQty: 10, doneBefore: 9, actual: '2' })], tolerancePct: 15 }));
  assert.equal(within[0].tone, 'warning');
  assert.equal(within[0].detail, '2.2: 11 against a BOQ of 10 Cum, within the 15% tolerance.');

  const beyond = buildDprSheetChecks(input({ rows: [row({ boqQty: 10, doneBefore: 9, actual: '3' })], tolerancePct: 15 }));
  assert.equal(beyond[0].tone, 'danger');
  assert.match(beyond[0].detail, /past the BOQ quantity plus the 15% tolerance/);
});

test('a line on two rows is checked once, with both rows added', () => {
  const rows = [
    row({ boqQty: 10, doneBefore: 6, actual: '3', location: 'A' }),
    row({ boqQty: 10, doneBefore: 6, actual: '3', location: 'B' }),
  ];
  const findings = buildDprSheetChecks(input({ rows }));
  assert.deepEqual(keys(findings), ['over-a']);
  assert.match(findings[0].detail, /^2\.2: 12 against a BOQ of 10 Cum/);
});

test('a line with no BOQ quantity is never above it', () => {
  assert.deepEqual(keys(buildDprSheetChecks(input({ rows: [row({ boqQty: 0, actual: '500' })] }))), ['clear']);
});

test('time lost without a reason, and a 0 with a reason', () => {
  const noReason = buildDprSheetChecks(input({ lostTimeHours: '2.5' }));
  assert.deepEqual(keys(noReason), ['time-no-reason']);
  assert.equal(noReason[0].detail, '2.5 hrs lost — add the reason; the sheet cannot be submitted without it.');
  assert.equal(buildDprSheetChecks(input({ lostTimeHours: '1' }))[0].detail.startsWith('1 hr lost'), true);

  const zero = buildDprSheetChecks(input({ lostTimeHours: '0', lostTimeReason: 'Rain in the morning' }));
  assert.deepEqual(keys(zero), ['reason-no-time']);
  assert.match(zero[0].detail, /Time lost is 0/);
  assert.deepEqual(keys(buildDprSheetChecks(input({ lostTimeHours: '2', lostTimeReason: 'Rain' }))), ['clear']);
});

test('a long reason is cut short in the title', () => {
  const [finding] = buildDprSheetChecks(input({ lostTimeReason: 'Power failure across the whole site for most of the shift' }));
  assert.equal(finding.title, 'Reason “Power failure across the whole site for…” with no time lost');
});

test('blanks count the lines they are missing on', () => {
  const rows = [row({ boqItemId: 'a', location: '' }), row({ boqItemId: 'b', slNo: '3', location: '', agency: '' }), row({ boqItemId: 'c', slNo: '4' })];
  const [finding] = buildDprSheetChecks(input({ rows }));
  assert.equal(finding.title, 'Location and agency not recorded');
  assert.equal(finding.detail, 'Left blank: location on 2 of 3 lines; agency on 1 of 3 lines. Optional, but it backs a delay or a hindrance later.');
});

test('rows with no BOQ line chosen are left to the submit checks', () => {
  const findings = buildDprSheetChecks(input({ rows: [row(), row({ boqItemId: '', slNo: '', location: '', agency: '', planned: 0, actual: '9' })] }));
  assert.deepEqual(keys(findings), ['clear']);
});

test('the line totals add every row of a line and ignore what is not a quantity', () => {
  const totals = dprSheetLineQty([
    { boqItemId: 'a', actual: '1.5' },
    { boqItemId: 'a', actual: '1,000' },
    { boqItemId: 'b', actual: '' },
    { boqItemId: 'b', actual: '-3' },
    { boqItemId: 'c', actual: 'abc' },
    { boqItemId: '', actual: '7' },
  ]);
  assert.deepEqual([...totals.entries()], [['a', 1001.5], ['b', 0], ['c', 0]]);
});

test('a line’s standing against its BOQ quantity', () => {
  assert.equal(dprSheetBoqState({ boqQty: 0, doneBefore: 5, sheetQty: 1, tolerancePct: 0 }), null);
  assert.deepEqual(dprSheetBoqState({ boqQty: 10, doneBefore: 6, sheetQty: 2, tolerancePct: 0 }), {
    total: 8,
    beforePct: 60,
    withTodayPct: 80,
    overBoq: false,
    overLimit: false,
  });
  const within = dprSheetBoqState({ boqQty: 10, doneBefore: 9, sheetQty: 2, tolerancePct: 10 });
  assert.equal(within.overBoq, true);
  assert.equal(within.overLimit, false);
  assert.equal(within.withTodayPct.toFixed(0), '110');
  const past = dprSheetBoqState({ boqQty: 10, doneBefore: 12, sheetQty: 0.5, tolerancePct: 10 });
  assert.equal(past.beforePct, 100);
  assert.equal(past.overLimit, true);
  // Exactly the BOQ quantity is not above it.
  assert.equal(dprSheetBoqState({ boqQty: 0.3, doneBefore: 0.1, sheetQty: 0.2, tolerancePct: 0 }).overBoq, false);
});

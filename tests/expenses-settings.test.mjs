import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_EXPENSE_DATA_CONTROL,
  EXPENSE_FORM_FIELDS,
  EXPENSE_REGISTER_COLUMNS,
  LOCKED_COLUMNS,
  applyColumnSettings,
  defaultExpensesSettings,
  hasBlockingIssue,
  moveColumn,
  resolveColumnSettings,
  resolveDatePreset,
  resolveExpensesSettings,
  resolveFormField,
  setColumnVisibility,
  validateExpensesSettings,
  validateFieldControl,
  validateDataControl,
  fieldControlPayload,
  dataControlPayload,
  flattenFieldControl,
  flattenDataControl,
  requestAmountError,
  findDuplicateRequest,
  settingsStampFor,
  toIsoStamp,
} from '../src/lib/expenses-settings.ts';

const TODAY = new Date(2026, 8, 17); // Thursday 17 Sep 2026
const keys = settings => settings.map(column => column.key);

/* ── defaults ────────────────────────────────────────────────────────────── */

test('the shipped defaults cover every column and every field exactly once', () => {
  const settings = defaultExpensesSettings();
  assert.deepEqual(keys(settings.registers.all), [...EXPENSE_REGISTER_COLUMNS]);
  assert.deepEqual(keys(settings.registers.department), [...EXPENSE_REGISTER_COLUMNS]);
  assert.deepEqual(
    settings.fields.map(field => field.key),
    EXPENSE_FORM_FIELDS.map(field => field.key),
  );
  assert.deepEqual(settings.data, DEFAULT_EXPENSE_DATA_CONTROL);
});

test('the department register hides the Department column, since it is already scoped to one', () => {
  const settings = defaultExpensesSettings();
  assert.equal(settings.registers.department.find(column => column.key === 'Department').visible, false);
  assert.equal(settings.registers.all.find(column => column.key === 'Department').visible, true);
});

test('Remarks ships optional and everything else required', () => {
  const settings = defaultExpensesSettings();
  const optional = settings.fields.filter(field => !field.required).map(field => field.key);
  assert.deepEqual(optional.sort(), ['headOfAccount', 'remarks']);
});

/* ── resolution ──────────────────────────────────────────────────────────── */

test('an empty or malformed document resolves to the shipped defaults', () => {
  for (const stored of [undefined, null, {}, 'nonsense', { registers: 'no' }, { fields: 7 }]) {
    const resolved = resolveExpensesSettings(stored);
    assert.deepEqual(keys(resolved.registers.all), [...EXPENSE_REGISTER_COLUMNS]);
    assert.equal(resolved.fields.length, EXPENSE_FORM_FIELDS.length);
    assert.equal(resolved.data.defaultDateRange, 'all');
  }
});

test('a column added to the module since the document was saved still appears', () => {
  const stale = ['Request No', 'Amount', 'Project Name'];
  const resolved = resolveColumnSettings(stale);
  assert.deepEqual(resolved.slice(0, 3).map(column => column.key), stale, 'saved order leads');
  assert.equal(resolved.length, EXPENSE_REGISTER_COLUMNS.length, 'the rest are appended, not lost');
  assert.deepEqual(
    [...new Set(resolved.map(column => column.key))].length,
    EXPENSE_REGISTER_COLUMNS.length,
    'no duplicates',
  );
});

test('a column the module no longer has is dropped', () => {
  const resolved = resolveColumnSettings([{ key: 'Retired Column', visible: true }, { key: 'Amount', visible: true }]);
  assert.ok(!resolved.some(column => column.key === 'Retired Column'));
  assert.equal(resolved.length, EXPENSE_REGISTER_COLUMNS.length);
});

test('a duplicated entry in the stored order is taken once', () => {
  const resolved = resolveColumnSettings(['Amount', 'Amount', 'Request No']);
  assert.deepEqual(resolved.slice(0, 2).map(column => column.key), ['Amount', 'Request No']);
});

test('a locked column cannot be hidden, however the document was saved', () => {
  const resolved = resolveColumnSettings(LOCKED_COLUMNS.map(key => ({ key, visible: false })));
  for (const locked of LOCKED_COLUMNS) {
    assert.equal(resolved.find(column => column.key === locked).visible, true, `${locked} stays visible`);
  }
});

test('a stored required flag is honoured, and an unmentioned field keeps its shipped default', () => {
  const resolved = resolveExpensesSettings({
    fields: [{ key: 'remarks', visible: true, required: true }],
  });
  assert.equal(resolved.fields.find(field => field.key === 'remarks').required, true, 'stored wins');
  assert.equal(
    resolved.fields.find(field => field.key === 'description').required,
    true,
    'unmentioned keeps the shipped default',
  );
});

test('a hidden field is never resolved as required', () => {
  const resolved = resolveExpensesSettings({
    fields: [{ key: 'remarks', visible: false, required: true }],
  });
  const remarks = resolved.fields.find(field => field.key === 'remarks');
  assert.equal(remarks.visible, false);
  assert.equal(remarks.required, false);
});

test('a locked field stays visible and required even if the document says otherwise', () => {
  const resolved = resolveExpensesSettings({
    fields: [{ key: 'amount', visible: false, required: false }],
  });
  const amount = resolved.fields.find(field => field.key === 'amount');
  assert.equal(amount.visible, true);
  assert.equal(amount.required, true);
});

test('a nonsense threshold or preset falls back instead of poisoning the module', () => {
  const resolved = resolveExpensesSettings({
    data: { highValueThreshold: -5, defaultDateRange: 'next-tuesday' },
  });
  assert.equal(resolved.data.highValueThreshold, 100000);
  assert.equal(resolved.data.defaultDateRange, 'all');
  assert.equal(resolveExpensesSettings({ data: { highValueThreshold: '250000' } }).data.highValueThreshold, 250000);
});

/* ── editing ─────────────────────────────────────────────────────────────── */

test('moving a column swaps it with its neighbour, and the ends are a no-op', () => {
  const columns = resolveColumnSettings([]);
  const moved = moveColumn(columns, 1, 'up');
  assert.deepEqual(keys(moved).slice(0, 2), [columns[1].key, columns[0].key]);
  assert.deepEqual(keys(moveColumn(columns, 0, 'up')), keys(columns));
  assert.deepEqual(keys(moveColumn(columns, columns.length - 1, 'down')), keys(columns));
  assert.deepEqual(keys(moveColumn(columns, 99, 'up')), keys(columns));
});

test('visibility can be toggled, except on a locked column', () => {
  const columns = resolveColumnSettings([]);
  assert.equal(setColumnVisibility(columns, 'Remarks', false).find(c => c.key === 'Remarks').visible, false);
  assert.equal(setColumnVisibility(columns, 'Amount', false).find(c => c.key === 'Amount').visible, true);
});

/* ── validation ──────────────────────────────────────────────────────────── */

test('the shipped defaults raise nothing blocking', () => {
  const issues = validateExpensesSettings(defaultExpensesSettings());
  assert.equal(hasBlockingIssue(issues), false);
});

test('hiding everything but one column is an error, not a warning', () => {
  const settings = defaultExpensesSettings();
  settings.registers.all = settings.registers.all.map(column => ({
    ...column,
    visible: column.key === 'Request No',
  }));
  const issues = validateExpensesSettings(settings);
  assert.ok(hasBlockingIssue(issues));
  assert.ok(issues.some(issue => /at least two visible columns/.test(issue.message)));
});

test('a hidden-but-required field is reported as an error', () => {
  const settings = defaultExpensesSettings();
  settings.fields = settings.fields.map(field =>
    field.key === 'description' ? { ...field, visible: false, required: true } : field,
  );
  const issues = validateExpensesSettings(settings);
  assert.ok(hasBlockingIssue(issues));
  assert.ok(issues.some(issue => /hidden but still required/.test(issue.message)));
});

test('risky-but-legal choices warn without blocking the save', () => {
  const settings = defaultExpensesSettings();
  settings.data.allowEditAfterReception = true;
  settings.data.importDuplicateDetection = false;
  const issues = validateExpensesSettings(settings);
  assert.equal(hasBlockingIssue(issues), false);
  assert.equal(issues.filter(issue => issue.severity === 'warning').length >= 2, true);
});

/* ── consumption ─────────────────────────────────────────────────────────── */

test('a register renders the configured order and visibility', () => {
  const configured = [
    { key: 'Amount', visible: true },
    { key: 'Request No', visible: true },
    { key: 'Remarks', visible: false },
  ];
  const { order, visibility } = applyColumnSettings(configured);
  assert.deepEqual(order, ['Amount', 'Request No', 'Remarks']);
  assert.equal(visibility.Remarks, false);
});

test("a user's own arrangement overrides the organisation default", () => {
  const configured = resolveColumnSettings([]);
  const { order, visibility } = applyColumnSettings(configured, {
    order: ['Remarks', 'Amount'],
    visibility: { Timestamp: false },
  });
  assert.deepEqual(order.slice(0, 2), ['Remarks', 'Amount']);
  assert.equal(order.length, configured.length, 'the rest still follow');
  assert.equal(visibility.Timestamp, false);
});

test('a personal preference cannot hide a locked column either', () => {
  const { visibility } = applyColumnSettings(resolveColumnSettings([]), { visibility: { Amount: false } });
  assert.equal(visibility.Amount, true);
});

test('a personal preference naming a retired column is ignored', () => {
  const { order } = applyColumnSettings(resolveColumnSettings([]), { order: ['Retired', 'Amount'] });
  assert.equal(order[0], 'Amount');
  assert.ok(!order.includes('Retired'));
});

/* ── presets ─────────────────────────────────────────────────────────────── */

test('each date preset resolves to the range it names', () => {
  assert.equal(resolveDatePreset('all', TODAY), undefined);

  const today = resolveDatePreset('today', TODAY);
  assert.equal(today.from.getDate(), 17);
  assert.equal(today.to.getHours(), 23);

  const week = resolveDatePreset('this-week', TODAY);
  assert.equal(week.from.getDay(), 1, 'weeks start on Monday');
  assert.equal(week.from.getDate(), 14);
  assert.equal(week.to.getDate(), 20);

  const month = resolveDatePreset('this-month', TODAY);
  assert.equal(month.from.getDate(), 1);
  assert.equal(month.to.getDate(), 30, 'September has 30 days');

  const last30 = resolveDatePreset('last-30', TODAY);
  assert.equal(last30.from.getMonth(), 7, 'reaches back into August');
  assert.equal(last30.from.getDate(), 19);

  const year = resolveDatePreset('this-year', TODAY);
  assert.equal(year.from.getMonth(), 0);
  assert.equal(year.to.getMonth(), 11);
});

test('the form reads its label and required-ness from the settings', () => {
  const settings = resolveExpensesSettings({
    fields: [{ key: 'partyName', visible: true, required: false, label: 'Vendor', helpText: 'Who we pay' }],
  });
  assert.deepEqual(resolveFormField(settings, 'partyName'), {
    visible: true,
    required: false,
    label: 'Vendor',
    helpText: 'Who we pay',
  });
  assert.equal(resolveFormField(settings, 'description').label, 'Description', 'unset falls back to shipped');
});

/* ── data rules added with Data Control ──────────────────────────────────── */

test('a document saved before the new data rules reads as the shipped behaviour', () => {
  const legacy = resolveExpensesSettings({
    data: { defaultDateRange: 'this-month', allowEditAfterReception: true, highValueThreshold: 50000 },
    updatedAt: '2026-01-02T03:04:05.000Z',
    updatedBy: 'Asha Rao',
  });
  assert.equal(legacy.data.gstTdsCapture, true, 'GST & TDS still shown');
  assert.equal(legacy.data.maxRequestAmount, 0, 'no amount cap');
  assert.equal(legacy.data.duplicateRequestWarningDays, 0, 'no duplicate prompt');
  assert.equal(legacy.data.allowStatutoryEditAfterReception, false, 'statutory figures stay fixed');
  assert.equal(legacy.data.defaultDateRange, 'this-month', 'the old rules survive');
  assert.deepEqual(settingsStampFor(legacy, 'fieldControl'), { at: '2026-01-02T03:04:05.000Z', by: 'Asha Rao' });
});

test('the new rules resolve tolerant of junk and keep what was saved', () => {
  const resolved = resolveExpensesSettings({
    data: { gstTdsCapture: false, maxRequestAmount: '500000', duplicateRequestWarningDays: -3, allowStatutoryEditAfterReception: 'yes' },
  });
  assert.equal(resolved.data.gstTdsCapture, false);
  assert.equal(resolved.data.maxRequestAmount, 500000);
  assert.equal(resolved.data.duplicateRequestWarningDays, 0);
  assert.equal(resolved.data.allowStatutoryEditAfterReception, false, 'only a real true turns it on');
});

test('a Firestore timestamp stamp is read, and each part keeps its own stamp', () => {
  const at = new Date('2026-09-01T10:00:00.000Z');
  const resolved = resolveExpensesSettings({
    updatedAt: { toDate: () => at },
    updatedBy: 'uid-1',
    updatedByName: 'Ravi',
    stamps: {
      dataControl: { updatedAt: { seconds: at.getTime() / 1000 + 60 }, updatedBy: 'uid-2', updatedByName: 'Meera' },
    },
  });
  assert.equal(resolved.updatedAt, at.toISOString());
  assert.equal(settingsStampFor(resolved, 'dataControl').by, 'Meera');
  assert.equal(settingsStampFor(resolved, 'fieldControl').by, 'Ravi', 'falls back to the document stamp');
  assert.equal(toIsoStamp('   '), undefined);
});

test('data validation blocks nonsense numbers and warns on contradictory rules', () => {
  const data = { ...DEFAULT_EXPENSE_DATA_CONTROL };
  assert.equal(hasBlockingIssue(validateDataControl(data)), false);
  assert.ok(hasBlockingIssue(validateDataControl({ ...data, maxRequestAmount: -1 })));
  assert.ok(hasBlockingIssue(validateDataControl({ ...data, duplicateRequestWarningDays: 400 })));
  assert.ok(hasBlockingIssue(validateDataControl({ ...data, duplicateRequestWarningDays: 2.5 })));
  const contradictory = validateDataControl({ ...data, allowStatutoryEditAfterReception: true });
  assert.equal(hasBlockingIssue(contradictory), false);
  assert.ok(contradictory.some(issue => /no effect/.test(issue.message)));
  assert.ok(validateDataControl({ ...data, maxRequestAmount: 5000 }).some(issue => /never flag/.test(issue.message)));
});

test('field and data validation split the whole-document validation between them', () => {
  const settings = defaultExpensesSettings();
  settings.data.allowEditAfterReception = true;
  settings.fields = settings.fields.map(field => (field.key === 'remarks' ? { ...field, visible: false, required: false } : field));
  const whole = validateExpensesSettings(settings).map(issue => issue.message);
  const parts = [...validateFieldControl(settings), ...validateDataControl(settings.data)].map(issue => issue.message);
  assert.deepEqual(whole, parts);
  assert.ok(!validateFieldControl(settings).some(issue => /reception/.test(issue.message)));
});

test('the field-control payload carries no undefined values and no data rules', () => {
  const settings = defaultExpensesSettings();
  settings.fields[4] = { ...settings.fields[4], label: '  Vendor ', helpText: '' };
  const payload = fieldControlPayload(settings);
  assert.deepEqual(Object.keys(payload).sort(), ['fields', 'registers']);
  const walk = value => {
    if (value === undefined) assert.fail('undefined found in payload');
    if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  walk(payload);
  assert.equal(payload.fields[4].label, 'Vendor');
  assert.ok(!('helpText' in payload.fields[4]));
});

test('flattened settings diff into readable keys', () => {
  const before = defaultExpensesSettings();
  const after = defaultExpensesSettings();
  after.fields = after.fields.map(field => (field.key === 'partyName' ? { ...field, required: false } : field));
  after.registers.all = moveColumn(after.registers.all, 1, 'up');
  const a = flattenFieldControl(before);
  const b = flattenFieldControl(after);
  const changed = Object.keys(b).filter(key => a[key] !== b[key]);
  assert.deepEqual(changed.sort(), ['Consolidated Register · column order', 'Name of the Party · required']);

  const data = flattenDataControl({ ...DEFAULT_EXPENSE_DATA_CONTROL, gstTdsCapture: false });
  assert.equal(data['Capture GST & TDS on new requests'], false);
  assert.equal(Object.keys(data).length, Object.keys(DEFAULT_EXPENSE_DATA_CONTROL).length, 'every rule has a label');
  assert.deepEqual(dataControlPayload(DEFAULT_EXPENSE_DATA_CONTROL), DEFAULT_EXPENSE_DATA_CONTROL);
});

test('the request amount cap applies only above a non-zero limit', () => {
  assert.equal(requestAmountError(1_000_000, { maxRequestAmount: 0 }), undefined, '0 means no limit');
  assert.equal(requestAmountError(50_000, { maxRequestAmount: 50_000 }), undefined, 'the limit itself is allowed');
  assert.match(requestAmountError(50_001, { maxRequestAmount: 50_000 }), /cannot be more than/);
});

test('a duplicate is the newest same-party, same-amount request inside the window', () => {
  const now = new Date('2026-09-30T12:00:00.000Z');
  const daysAgo = n => new Date(now.getTime() - n * 86400000).toISOString();
  const existing = [
    { requestNo: 'OLD', partyName: 'Acme Traders', amount: 5000, createdAt: daysAgo(20) },
    { requestNo: 'A-1', partyName: 'acme  traders', amount: 5000, createdAt: daysAgo(3) },
    { requestNo: 'A-2', partyName: 'Acme Traders', amount: 5000, createdAt: daysAgo(1) },
    { requestNo: 'OTHER', partyName: 'Acme Traders', amount: 5000.5, createdAt: daysAgo(0) },
    { requestNo: 'UNDATED', partyName: 'Acme Traders', amount: 5000 },
  ];
  assert.equal(findDuplicateRequest(existing, { partyName: 'ACME Traders', amount: 5000 }, 7, now).requestNo, 'A-2');
  assert.equal(findDuplicateRequest(existing, { partyName: 'Acme Traders', amount: 5000 }, 0, now), undefined, '0 is off');
  assert.equal(findDuplicateRequest(existing, { partyName: '', amount: 5000 }, 7, now), undefined, 'no party, no check');
  assert.equal(findDuplicateRequest(existing.slice(0, 1), { partyName: 'Acme Traders', amount: 5000 }, 7, now), undefined);
  assert.equal(findDuplicateRequest(existing, { partyName: 'Acme Traders', amount: 5000.5 }, 1, now).requestNo, 'OTHER');
});

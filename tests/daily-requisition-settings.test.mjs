import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DAILY_REQUISITION_SETTINGS_PATH,
  DR_COLUMN_REGISTRY,
  DR_STATIC_SEGMENTS,
  DR_FIELD_REGISTRY,
  applyColumnSettings,
  dailyStepNameProblem,
  dailyStepSlug,
  defaultDailyRequisitionSettings,
  describeDateWindow,
  flattenDataControl,
  flattenFieldControl,
  hasBlockingIssue,
  isHighValue,
  moveColumn,
  receivedRuleBlock,
  resolveColumnSettings,
  resolveDailyRequisitionSettings,
  resolveDatePreset,
  resolveDateWindow,
  resolveField,
  resolveSettingsMeta,
  setColumnVisibility,
  shiftDays,
  toStoredSettings,
  validateDailyRequisitionSettings,
  validateEntryValues,
  validateReceptionDate,
} from '../src/lib/daily-requisition-settings.ts';

const TODAY = '2026-09-30';
const withData = (data) => {
  const settings = defaultDailyRequisitionSettings();
  return { ...settings, data: { ...settings.data, ...data, dateControl: { ...settings.data.dateControl, ...(data.dateControl ?? {}) } } };
};

test('the settings document path', () => {
  assert.deepEqual(DAILY_REQUISITION_SETTINGS_PATH, { collection: 'dailyRequisitionSettings', doc: 'module-config' });
});

test('defaults reproduce the shipped behaviour', () => {
  const settings = resolveDailyRequisitionSettings(undefined);
  assert.deepEqual(settings, defaultDailyRequisitionSettings());
  for (const def of DR_FIELD_REGISTRY) {
    const field = resolveField(settings, def.key);
    assert.equal(field.visible, true, def.key);
    assert.equal(field.label, def.defaultLabel);
    // Only the reception date was ever mandatory (the date picker always holds one).
    assert.equal(field.required, def.key === 'receptionDate', def.key);
  }
  assert.deepEqual(
    applyColumnSettings(settings.columns).map((column) => column.key),
    DR_COLUMN_REGISTRY.map((column) => column.key),
  );
  assert.equal(settings.data.dateControl.enabled, false);
  assert.equal(settings.data.allowEditAfterReceived, true);
  assert.equal(settings.data.allowDeleteAfterReceived, true);
  assert.equal(settings.data.requireExpenseRequest, false);
  assert.equal(settings.data.netMayExceedGross, true);
  assert.equal(settings.data.highValueThreshold, 0);
  assert.equal(settings.data.defaultDateRange, 'all');
  assert.equal(settings.data.importDuplicateDetection, true);
  assert.deepEqual(validateDailyRequisitionSettings(settings), []);
});

test('defaults: every submission the old form accepted is still accepted', () => {
  const settings = defaultDailyRequisitionSettings();
  const window = resolveDateWindow(TODAY, settings);
  assert.equal(window.enforced, false);
  assert.deepEqual(validateEntryValues({ receptionDate: '2019-01-01', netAmount: '500', grossAmount: '100' }, settings, { mode: 'add', window }), {});
  assert.equal(receivedRuleBlock('Paid', settings.data, 'edit'), null);
  assert.equal(receivedRuleBlock('Received', settings.data, 'delete'), null);
  assert.equal(isHighValue({ grossAmount: 1e9 }, settings.data.highValueThreshold), false);
});

test('a partial document merges over the defaults', () => {
  const settings = resolveDailyRequisitionSettings({
    fields: { partyName: { required: true, label: '  Vendor  ' } },
    data: { requireExpenseRequest: true, dateControl: { enabled: true } },
  });
  assert.deepEqual(settings.fields.partyName, { visible: true, required: true, label: 'Vendor' });
  assert.equal(resolveField(settings, 'partyName').label, 'Vendor');
  assert.equal(settings.fields.projectId.required, false);
  assert.equal(settings.data.requireExpenseRequest, true);
  assert.equal(settings.data.dateControl.enabled, true);
  assert.equal(settings.data.dateControl.backdateDays, 7);
  assert.equal(settings.data.netMayExceedGross, true);
});

test('garbage and legacy values fall back instead of locking anyone out', () => {
  const settings = resolveDailyRequisitionSettings({
    fields: 'nope',
    columns: [{ key: 'bogus' }, 42, null],
    data: {
      highValueThreshold: -5,
      defaultDateRange: 'last-decade',
      dateControl: { backdateDays: -3, futureDays: 'x', enabled: 'yes' },
      allowEditAfterReceived: 'false',
    },
  });
  assert.deepEqual(settings.fields, defaultDailyRequisitionSettings().fields);
  assert.equal(settings.columns.length, DR_COLUMN_REGISTRY.length);
  assert.equal(settings.data.highValueThreshold, 0);
  assert.equal(settings.data.defaultDateRange, 'all');
  assert.equal(settings.data.dateControl.backdateDays, 7);
  assert.equal(settings.data.dateControl.futureDays, 0);
  assert.equal(settings.data.dateControl.enabled, false);
  assert.equal(settings.data.allowEditAfterReceived, true);
});

test('locked fields can only be relabelled', () => {
  const settings = resolveDailyRequisitionSettings({
    fields: {
      receptionDate: { visible: false, required: false, label: 'Received on' },
      netAmount: { visible: false, required: true },
      depNo: { required: true },
    },
  });
  assert.deepEqual(settings.fields.receptionDate, { visible: true, required: true, label: 'Received on' });
  // Always visible, but its required-ness is the admin's call.
  assert.deepEqual(settings.fields.netAmount, { visible: true, required: true, label: '' });
  // DEP No's required-ness is Data Control's.
  assert.equal(settings.fields.depNo.required, false);

  const issues = validateDailyRequisitionSettings({
    ...defaultDailyRequisitionSettings(),
    fields: { ...defaultDailyRequisitionSettings().fields, receptionDate: { visible: false, required: true, label: '' } },
  });
  assert.ok(hasBlockingIssue(issues));
  assert.ok(issues.some((issue) => issue.message.includes('Reception date')));
});

test('a hidden field is never required', () => {
  const settings = resolveDailyRequisitionSettings({ fields: { partyName: { visible: false, required: true } } });
  assert.equal(settings.fields.partyName.required, false);
  const field = resolveField(settings, 'partyName');
  assert.equal(field.visible, false);
  assert.equal(field.required, false);
  const window = resolveDateWindow(TODAY, settings);
  assert.deepEqual(validateEntryValues({ receptionDate: TODAY }, settings, { mode: 'add', window }), {});

  const draft = defaultDailyRequisitionSettings();
  draft.fields.partyName = { visible: false, required: true, label: '' };
  assert.ok(hasBlockingIssue(validateDailyRequisitionSettings(draft)));
});

test('a label equal to the default is stored blank; long labels are rejected', () => {
  const settings = resolveDailyRequisitionSettings({ fields: { description: { label: 'Description' } } });
  assert.equal(settings.fields.description.label, '');
  const draft = defaultDailyRequisitionSettings();
  draft.fields.description = { visible: true, required: false, label: 'x'.repeat(61) };
  assert.ok(hasBlockingIssue(validateDailyRequisitionSettings(draft)));
});

test('column order: stored order wins, new columns slot in, locked forced, Actions last', () => {
  const columns = resolveColumnSettings([
    { key: 'actions', visible: false },
    { key: 'partyName', visible: true },
    { key: 'receptionNo', visible: false },
    { key: 'createdAt', visible: false },
    'status',
  ]);
  const keys = columns.map((column) => column.key);
  assert.equal(keys[0], 'partyName');
  assert.equal(keys.at(-1), 'actions');
  assert.equal(new Set(keys).size, DR_COLUMN_REGISTRY.length);
  assert.equal(columns.find((c) => c.key === 'receptionNo').visible, true);
  assert.equal(columns.find((c) => c.key === 'createdAt').visible, false);
  // `date` shipped after `status`, so it follows it.
  assert.equal(keys.indexOf('date'), keys.indexOf('status') + 1);

  const rendered = applyColumnSettings(columns).map((column) => column.key);
  assert.ok(!rendered.includes('createdAt'));
  assert.equal(rendered.at(-1), 'actions');
});

test('moving and hiding columns respects the locks', () => {
  const columns = defaultDailyRequisitionSettings().columns;
  const moved = moveColumn(columns, 1, 'up');
  assert.deepEqual(moved.slice(0, 2).map((c) => c.key), ['receptionNo', 'createdAt']);
  const last = columns.length - 1;
  assert.deepEqual(moveColumn(columns, last, 'up'), columns);
  assert.deepEqual(moveColumn(columns, last - 1, 'down'), columns);
  assert.deepEqual(moveColumn(columns, 0, 'up'), columns);
  const hidden = setColumnVisibility(columns, 'status', false);
  assert.equal(hidden.find((c) => c.key === 'status').visible, true);
  const hiddenParty = setColumnVisibility(columns, 'partyName', false);
  assert.equal(hiddenParty.find((c) => c.key === 'partyName').visible, false);
});

test('date window and validation', () => {
  assert.equal(shiftDays('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftDays('2026-12-31', 1), '2027-01-01');

  const settings = withData({ dateControl: { enabled: true, backdateDays: 7, futureDays: 0 } });
  const window = resolveDateWindow(TODAY, settings);
  assert.deepEqual([window.min, window.max, window.enforced], ['2026-09-23', '2026-09-30', true]);
  assert.equal(describeDateWindow(window), 'Entries can be dated 23 Sep 2026 – 30 Sep 2026');
  assert.equal(validateReceptionDate('2026-09-23', window).ok, true);
  assert.equal(validateReceptionDate('2026-09-30', window).ok, true);
  const early = validateReceptionDate('2026-09-22', window);
  assert.equal(early.ok, false);
  assert.match(early.reason, /23 Sep 2026/);
  assert.match(validateReceptionDate('2026-10-01', window).reason, /future/);
  assert.equal(validateReceptionDate('', window).ok, false);

  const todayOnly = resolveDateWindow(TODAY, withData({ dateControl: { enabled: true, backdateDays: 0, futureDays: 0 } }));
  assert.equal(describeDateWindow(todayOnly), 'Entries can be dated 30 Sep 2026 only');
  const ahead = resolveDateWindow(TODAY, withData({ dateControl: { enabled: true, backdateDays: 1, futureDays: 3 } }));
  assert.equal(ahead.max, '2026-10-03');
  assert.match(validateReceptionDate('2026-10-04', ahead).reason, /03 Oct 2026/);
});

test('entry validation: required fields, DEP rule, net vs gross, date window', () => {
  const settings = withData({ requireExpenseRequest: true, netMayExceedGross: false, dateControl: { enabled: true, backdateDays: 3 } });
  settings.fields.partyName = { visible: true, required: true, label: 'Vendor' };
  settings.fields.attachments = { visible: true, required: true, label: '' };
  const window = resolveDateWindow(TODAY, settings);

  const errors = validateEntryValues(
    { receptionDate: '2026-09-01', partyName: ' ', grossAmount: '100', netAmount: '150' },
    settings,
    { mode: 'add', window, attachmentCount: 0 },
  );
  assert.equal(errors.partyName, 'Vendor is required.');
  assert.match(errors.depNo, /expense request/);
  assert.match(errors.netAmount, /more than the gross/);
  assert.match(errors.receptionDate, /27 Sep 2026/);
  assert.equal(errors.attachments, 'Attachments is required.');

  // Edit: an unchanged old date is not re-judged, the DEP and attachment rules are Add-only,
  // and payment-locked fields are never enforced.
  const editErrors = validateEntryValues(
    { receptionDate: '2026-09-01', partyName: '', grossAmount: '100', netAmount: '150' },
    settings,
    { mode: 'edit', window, originalReceptionDate: '2026-09-01', lockedKeys: ['partyName', 'grossAmount', 'netAmount', 'receptionDate'] },
  );
  assert.deepEqual(editErrors, {});
  const moved = validateEntryValues(
    { receptionDate: '2026-09-02', partyName: 'A', grossAmount: '100', netAmount: '90' },
    settings,
    { mode: 'edit', window, originalReceptionDate: '2026-09-01' },
  );
  assert.deepEqual(Object.keys(moved), ['receptionDate']);
});

test('the DEP rule is never enforced on a hidden DEP field, and saving that combination is blocked', () => {
  const settings = withData({ requireExpenseRequest: true });
  settings.fields.depNo = { visible: false, required: false, label: '' };
  const window = resolveDateWindow(TODAY, settings);
  assert.deepEqual(validateEntryValues({ receptionDate: TODAY }, settings, { mode: 'add', window }), {});
  assert.ok(hasBlockingIssue(validateDailyRequisitionSettings(settings)));
});

test('received-status rule', () => {
  const data = withData({ allowEditAfterReceived: false, allowDeleteAfterReceived: false }).data;
  assert.equal(receivedRuleBlock('Pending', data, 'edit'), null);
  assert.equal(receivedRuleBlock(undefined, data, 'delete'), null);
  assert.match(receivedRuleBlock('Received', data, 'edit'), /cannot be edited/);
  assert.match(receivedRuleBlock('Verified', data, 'delete'), /cannot be deleted/);
});

test('high value and date presets', () => {
  assert.equal(isHighValue({ grossAmount: 100000, netAmount: 90000 }, 100000), true);
  assert.equal(isHighValue({ grossAmount: 99999 }, 100000), false);
  assert.equal(isHighValue({ netAmount: '250000' }, 100000), true);
  assert.equal(resolveDatePreset('all'), undefined);
  const week = resolveDatePreset('this-week', new Date(2026, 8, 30)); // a Wednesday
  assert.equal(week.from.getDate(), 28);
  assert.equal(week.to.getDate(), 4);
  const month = resolveDatePreset('this-month', new Date(2026, 1, 10));
  assert.equal(month.to.getDate(), 28);
});

test('settings validation errors', () => {
  const draft = defaultDailyRequisitionSettings();
  draft.data.dateControl.backdateDays = -1;
  draft.data.dateControl.futureDays = 1.5;
  draft.data.highValueThreshold = -10;
  draft.columns = draft.columns.map((c) => (c.key === 'status' ? { ...c, visible: false } : c));
  const errors = validateDailyRequisitionSettings(draft).filter((i) => i.severity === 'error').map((i) => i.message);
  assert.ok(errors.some((m) => m.startsWith('Days back')));
  assert.ok(errors.some((m) => m.startsWith('Days ahead')));
  assert.ok(errors.some((m) => m.includes('high-value')));
  assert.ok(errors.some((m) => m.includes('"Status" column')));

  const misplaced = defaultDailyRequisitionSettings();
  misplaced.columns = [misplaced.columns.at(-1), ...misplaced.columns.slice(0, -1)];
  assert.ok(validateDailyRequisitionSettings(misplaced).some((i) => i.message.includes('Actions')));
});

test('stored form has no undefined and round-trips', () => {
  const settings = resolveDailyRequisitionSettings({ fields: { partyName: { label: 'Vendor', required: true } } });
  const stored = toStoredSettings(settings);
  const hasUndefined = (value) =>
    value === undefined || (typeof value === 'object' && value !== null && Object.values(value).some(hasUndefined));
  assert.equal(hasUndefined(stored), false);
  assert.deepEqual(resolveDailyRequisitionSettings(stored), settings);
});

test('section meta is read from the document', () => {
  const meta = resolveSettingsMeta({ meta: { fieldControl: { updatedByName: 'Asha', updatedById: 'u1', updatedAt: 5 } } });
  assert.equal(meta.fieldControl.updatedByName, 'Asha');
  assert.equal(meta.fieldControl.updatedAt, 5);
  assert.equal(meta.dataControl.updatedByName, undefined);
  assert.deepEqual(resolveSettingsMeta(null).dataControl, { updatedAt: undefined, updatedById: undefined, updatedByName: undefined });
});

test('audit flattening names exactly what changed', () => {
  const before = defaultDailyRequisitionSettings();
  const after = resolveDailyRequisitionSettings({
    fields: { partyName: { required: true } },
    columns: moveColumn(before.columns, 1, 'up'),
  });
  const a = flattenFieldControl(before);
  const b = flattenFieldControl(after);
  const changed = Object.keys(b).filter((key) => a[key] !== b[key]);
  assert.deepEqual(changed, ['Party name · required', 'Column order']);

  const d1 = flattenDataControl(before.data);
  const d2 = flattenDataControl({ ...before.data, defaultDateRange: 'this-month', dateControl: { ...before.data.dateControl, enabled: true } });
  assert.deepEqual(
    Object.keys(d2).filter((key) => d1[key] !== d2[key]),
    ['Reception date window · enabled', 'Default date range'],
  );
  assert.equal(d2['Default date range'], 'This month');
});

test('a workflow stage name becomes the page it is reached at', () => {
  assert.equal(dailyStepSlug('Receiving at Finance'), 'receiving-at-finance');
  assert.equal(dailyStepSlug('GST & TDS Verification'), 'gst-tds-verification');
  // Leading, trailing and repeated punctuation collapse rather than leaving a stray dash.
  assert.equal(dailyStepSlug('  Processed / for  Payment!  '), 'processed-for-payment');
  assert.equal(dailyStepSlug('Stage 2'), 'stage-2');
  assert.equal(dailyStepSlug(undefined), '');
});

test('a stage name that could never be opened is rejected', () => {
  // A real stage name is fine.
  assert.equal(dailyStepNameProblem('Receiving at Finance'), null);
  assert.equal(dailyStepNameProblem('Processed for Payment'), null);

  // Every static route of the module: the static page wins over [step], so the stage is lost.
  for (const segment of DR_STATIC_SEGMENTS) {
    const problem = dailyStepNameProblem(segment.replace(/-/g, ' '));
    assert.ok(problem, segment + ' must be refused as a stage name');
    assert.match(problem, new RegExp(segment));
  }
  // Case and punctuation do not get round it.
  assert.ok(dailyStepNameProblem('Reports'));
  assert.ok(dailyStepNameProblem('Entry  Sheet!'));
  assert.ok(dailyStepNameProblem('Audit-Log'));

  // A name with nothing to slug would address the dashboard itself.
  assert.match(dailyStepNameProblem('###'), /no letters or digits/);
  assert.match(dailyStepNameProblem('   '), /no letters or digits/);

  // Two stages whose names slug alike share one page — Workflow Configuration compares slugs.
  assert.equal(dailyStepSlug('Payment Stage'), dailyStepSlug('payment  stage'));
});

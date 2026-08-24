import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVITY_ROUTE_SEGMENTS,
  DEFAULT_ACTIVITY_WEIGHTS,
  DEFAULT_TOWER_PROGRESS_SETTINGS,
  TOWER_ACTIVITIES,
  activityFromRouteSegment,
  activityStatusCredit,
  addDaysToKey,
  calculateTowerProgressSummary,
  canTransitionActivity,
  compareTowers,
  computeTowerProgressPct,
  daysInCurrentStatus,
  emptyTowerActivities,
  formatKm,
  formatTowerDate,
  hasCompleteEvidence,
  isEvidenceClientReady,
  isoWeekNumber,
  missingRequiredPhotoKinds,
  parseTowerSequence,
  readTower,
  resolveTowerProgressSettings,
  validateTowerDraft,
  validateTowerProgressSettings,
  validateTowerProgressUpdate,
  weekStartKey,
} from '../src/lib/project-management-tower-progress.ts';
import {
  buildBeforeAfterRows,
  buildCompletedTowerReport,
  buildDailyProgressReport,
  buildDelayedReport,
  buildMissingEvidenceReport,
  buildPendingReport,
  buildPeriodProgressReport,
  buildTowerStatusRows,
  filterTowers,
  recomputeActivityState,
  selectReportPhoto,
  TOWER_REPORTS,
  towerReportById,
} from '../src/lib/project-management-tower-reports.ts';
import {
  buildTowerRouteMap,
  haversineKm,
  routeStatusOf,
} from '../src/lib/project-management-tower-map.ts';
import {
  detectDelimiter,
  parseDelimitedText,
  parseTowerImportRows,
} from '../src/lib/project-management-tower-import.ts';

const SETTINGS = DEFAULT_TOWER_PROGRESS_SETTINGS;

/** Builds a tower whose activities carry the given statuses; everything else is Not Started. */
const makeTower = (towerNo, statuses = {}, extra = {}) => {
  const activities = emptyTowerActivities();
  Object.entries(statuses).forEach(([activity, value]) => {
    activities[activity] = {
      ...activities[activity],
      ...(typeof value === 'string' ? { status: value } : value),
    };
  });
  return {
    id: `id-${towerNo}`,
    towerNo,
    sequence: parseTowerSequence(towerNo),
    activities,
    overallProgressPct: 0,
    ...extra,
  };
};

const makeUpdate = (overrides = {}) => ({
  id: 'u1',
  towerId: 'id-T-01',
  towerNo: 'T-01',
  activity: 'foundation',
  fromStatus: 'In Progress',
  toStatus: 'Completed',
  progressDate: '2026-08-10',
  photos: [],
  verificationState: 'Approved',
  createdBy: 'user-1',
  createdByName: 'Engineer 01',
  ...overrides,
});

const photo = (id, kind, extra = {}) => ({
  id,
  kind,
  fileName: `${id}.jpg`,
  url: `https://example.test/${id}.jpg`,
  storagePath: `path/${id}.jpg`,
  mimeType: 'image/jpeg',
  fileSize: 1024,
  gps: null,
  ...extra,
});

/* ── Progress weighting ─────────────────────────────────────────────────────────────────────── */

test('default weights reproduce the specification worked example exactly', () => {
  const complete = 'Completed';
  const t01 = makeTower('T-01', {
    survey: complete, row: complete, foundation: complete, structure: complete,
    erection: complete, stringing: complete, opgw: complete,
  });
  const t02 = makeTower('T-02', {
    survey: complete, row: complete, foundation: complete, structure: complete,
    erection: complete, stringing: 'In Progress', opgw: 'In Progress',
  });
  const t03 = makeTower('T-03', {
    survey: complete, row: complete, foundation: complete, structure: complete,
    erection: 'In Progress',
  });
  const t04 = makeTower('T-04', { survey: complete });

  assert.equal(computeTowerProgressPct(t01), 100);
  assert.equal(computeTowerProgressPct(t02), 85);
  assert.equal(computeTowerProgressPct(t03), 65);
  assert.equal(computeTowerProgressPct(t04), 15);
});

test('default weights total 100 and every activity carries one', () => {
  const total = TOWER_ACTIVITIES.reduce((sum, a) => sum + DEFAULT_ACTIVITY_WEIGHTS[a], 0);
  assert.equal(total, 100);
  TOWER_ACTIVITIES.forEach((activity) => {
    assert.ok(DEFAULT_ACTIVITY_WEIGHTS[activity] > 0, `${activity} has no weight`);
  });
});

test('status credit distinguishes stopped work from paused work', () => {
  assert.equal(activityStatusCredit('Completed'), 1);
  assert.equal(activityStatusCredit('Under Verification'), 1, 'built is built, signature or not');
  assert.equal(activityStatusCredit('Approved'), 1);
  assert.equal(activityStatusCredit('In Progress'), 0.5);
  assert.equal(activityStatusCredit('Hold'), 0.5, 'started then paused');
  assert.equal(activityStatusCredit('Blocked'), 0, 'a blocked ROW has produced nothing');
  assert.equal(activityStatusCredit('Rejected'), 0, 'rejected work must be redone');
  assert.equal(activityStatusCredit('Ready'), 0);
  assert.equal(activityStatusCredit('Not Started'), 0);
});

test('weights are normalised by their own total, so a zeroed activity still yields 0-100', () => {
  // A line with no fibre scope: OPGW zeroed. A tower complete through stringing must read 100.
  const weights = { ...DEFAULT_ACTIVITY_WEIGHTS, opgw: 0 };
  const tower = makeTower('T-10', {
    survey: 'Completed', row: 'Completed', foundation: 'Completed', structure: 'Completed',
    erection: 'Completed', stringing: 'Completed',
  });
  assert.equal(computeTowerProgressPct(tower, weights), 100);

  // Misconfigured weights that do not total 100 still produce a sane percentage.
  const half = TOWER_ACTIVITIES.reduce((map, a) => ({ ...map, [a]: 7 }), {});
  assert.equal(computeTowerProgressPct(makeTower('T-11'), half), 0);
  assert.equal(computeTowerProgressPct(tower, half), 86);
});

/* ── Transitions ────────────────────────────────────────────────────────────────────────────── */

test('status only moves along allowed transitions', () => {
  assert.ok(canTransitionActivity('In Progress', 'Completed'));
  assert.ok(canTransitionActivity('Completed', 'Under Verification'));
  assert.ok(canTransitionActivity('Under Verification', 'Rejected'));
  assert.ok(canTransitionActivity('Rejected', 'In Progress'));
  assert.ok(canTransitionActivity('Blocked', 'In Progress'));
  assert.ok(canTransitionActivity('Completed', 'Completed'), 'a no-op re-save is allowed');

  assert.equal(canTransitionActivity('Completed', 'Not Started'), false, 'no silent un-completion');
  assert.equal(canTransitionActivity('Not Started', 'Completed'), false, 'must pass through work');
  assert.equal(canTransitionActivity('Approved', 'In Progress'), false, 'reopen via verification');
});

/* ── Evidence enforcement ───────────────────────────────────────────────────────────────────── */

const foundationTower = () =>
  makeTower('T-37', { survey: 'Completed', row: 'Completed', foundation: 'In Progress' });

test('block enforcement refuses a completion missing its photographs', () => {
  const result = validateTowerProgressUpdate(
    {
      activity: 'foundation',
      fromStatus: 'In Progress',
      toStatus: 'Completed',
      progressDate: '2026-08-10',
      remarks: '',
      reason: '',
      photoKinds: ['excavation'],
    },
    {
      tower: foundationTower(),
      settings: { evidenceEnforcement: 'block', requireGps: false },
      today: new Date('2026-08-24T00:00:00'),
    },
  );
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /cannot be completed without photographic evidence/);
  assert.match(result.errors[0], /Reinforcement/);
  assert.match(result.errors[0], /Concreting/);
  assert.equal(result.evidenceShortfall, false);
});

test('warn enforcement records the completion but flags the shortfall', () => {
  const result = validateTowerProgressUpdate(
    {
      activity: 'foundation',
      fromStatus: 'In Progress',
      toStatus: 'Completed',
      progressDate: '2026-08-10',
      remarks: '',
      reason: '',
      photoKinds: ['excavation'],
    },
    {
      tower: foundationTower(),
      settings: { evidenceEnforcement: 'warn', requireGps: false },
      today: new Date('2026-08-24T00:00:00'),
    },
  );
  assert.equal(result.errors.length, 0);
  assert.equal(result.evidenceShortfall, true);
  assert.ok(result.warnings.some((w) => /No Evidence report/.test(w)));
});

test('photographs already on the activity satisfy the requirement', () => {
  const tower = makeTower('T-37', {
    survey: 'Completed',
    row: 'Completed',
    foundation: {
      status: 'In Progress',
      presentPhotoKinds: ['excavation', 'reinforcement', 'concreting'],
    },
  });
  const result = validateTowerProgressUpdate(
    {
      activity: 'foundation',
      fromStatus: 'In Progress',
      toStatus: 'Completed',
      progressDate: '2026-08-10',
      remarks: '',
      reason: '',
      photoKinds: ['foundation-complete'],
    },
    {
      tower,
      settings: { evidenceEnforcement: 'block', requireGps: false },
      today: new Date('2026-08-24T00:00:00'),
    },
  );
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

test('evidence is only checked when a completion is claimed', () => {
  const result = validateTowerProgressUpdate(
    {
      activity: 'foundation',
      fromStatus: 'Not Started',
      toStatus: 'In Progress',
      progressDate: '2026-08-10',
      remarks: '',
      reason: '',
      photoKinds: [],
    },
    {
      tower: makeTower('T-37', { survey: 'Completed', row: 'Completed' }),
      settings: { evidenceEnforcement: 'block', requireGps: false },
      today: new Date('2026-08-24T00:00:00'),
    },
  );
  assert.deepEqual(result.errors, [], 'nobody needs four photographs to say work started');
});

test('out-of-sequence work warns but is never refused', () => {
  const result = validateTowerProgressUpdate(
    {
      activity: 'erection',
      fromStatus: 'In Progress',
      toStatus: 'Completed',
      progressDate: '2026-08-20',
      remarks: '',
      reason: '',
      photoKinds: ['erection-progress', 'tower-complete'],
    },
    {
      tower: makeTower('T-45', { erection: 'In Progress' }), // structure still Not Started
      settings: { evidenceEnforcement: 'block', requireGps: false },
      today: new Date('2026-08-24T00:00:00'),
    },
  );
  assert.deepEqual(result.errors, []);
  assert.ok(result.warnings.some((w) => /out of sequence/.test(w)));
});

test('span activities need a length, a reason is required to block, and future dates are refused', () => {
  const base = {
    activity: 'stringing',
    fromStatus: 'In Progress',
    toStatus: 'Completed',
    progressDate: '2026-08-20',
    remarks: '',
    reason: '',
    photoKinds: ['conductor-pulling', 'span-complete'],
  };
  const options = {
    tower: makeTower('T-50', { erection: 'Completed', stringing: 'In Progress' }),
    settings: { evidenceEnforcement: 'block', requireGps: false },
    today: new Date('2026-08-24T00:00:00'),
  };

  const noQty = validateTowerProgressUpdate(base, options);
  assert.ok(noQty.errors.some((e) => /measured per span/.test(e)));

  const withQty = validateTowerProgressUpdate({ ...base, quantityM: 320 }, options);
  assert.deepEqual(withQty.errors, []);

  const future = validateTowerProgressUpdate(
    { ...base, quantityM: 320, progressDate: '2026-09-01' },
    options,
  );
  assert.ok(future.errors.some((e) => /cannot be in the future/.test(e)));

  const blocked = validateTowerProgressUpdate(
    { ...base, toStatus: 'Blocked', quantityM: undefined },
    options,
  );
  assert.ok(blocked.errors.some((e) => /Record why/.test(e)));

  const blockedWithReason = validateTowerProgressUpdate(
    { ...base, toStatus: 'Blocked', reason: 'Crane unavailable' },
    options,
  );
  assert.deepEqual(blockedWithReason.errors, []);
});

test('a project can require a GPS fix on every update', () => {
  const result = validateTowerProgressUpdate(
    {
      activity: 'survey',
      fromStatus: 'In Progress',
      toStatus: 'Completed',
      progressDate: '2026-08-02',
      remarks: '',
      reason: '',
      photoKinds: ['survey-location'],
    },
    {
      tower: makeTower('T-01', { survey: 'In Progress' }),
      settings: { evidenceEnforcement: 'block', requireGps: true },
      today: new Date('2026-08-24T00:00:00'),
    },
  );
  assert.ok(result.errors.some((e) => /requires a GPS fix/.test(e)));
});

test('missing photograph kinds are reported, and the client gate also needs verification', () => {
  assert.deepEqual(missingRequiredPhotoKinds('foundation', ['excavation']), [
    'reinforcement',
    'concreting',
    'foundation-complete',
  ]);
  assert.deepEqual(missingRequiredPhotoKinds('erection', ['erection-progress', 'tower-complete']), []);

  const complete = { presentPhotoKinds: ['erection-progress', 'tower-complete'] };
  assert.ok(hasCompleteEvidence('erection', complete));
  assert.equal(
    isEvidenceClientReady('erection', { ...complete, verificationState: 'Pending' }, {
      clientReportsRequireApprovedPhotos: true,
    }),
    false,
  );
  assert.ok(
    isEvidenceClientReady('erection', { ...complete, verificationState: 'Approved' }, {
      clientReportsRequireApprovedPhotos: true,
    }),
  );
  assert.ok(
    isEvidenceClientReady('erection', { ...complete, verificationState: 'Pending' }, {
      clientReportsRequireApprovedPhotos: false,
    }),
  );
});

/* ── Tower master ───────────────────────────────────────────────────────────────────────────── */

test('tower numbers sort numerically however they are labelled', () => {
  assert.equal(parseTowerSequence('T-37'), 37);
  assert.equal(parseTowerSequence('T037'), 37);
  assert.equal(parseTowerSequence('AP-37/A'), 37);
  assert.equal(parseTowerSequence('37'), 37);
  assert.equal(parseTowerSequence('no digits'), Number.MAX_SAFE_INTEGER);

  const sorted = ['T-9', 'T-100', 'T-37', 'T-37/A']
    .map((towerNo) => makeTower(towerNo))
    .sort(compareTowers)
    .map((tower) => tower.towerNo);
  assert.deepEqual(sorted, ['T-9', 'T-37', 'T-37/A', 'T-100']);
});

test('tower validation catches duplicates, unpaired coordinates and unit mix-ups', () => {
  const base = { towerNo: 'T-01' };
  assert.deepEqual(validateTowerDraft(base, []), []);

  assert.match(validateTowerDraft({ towerNo: '' }, [])[0].message, /required/);
  assert.match(validateTowerDraft({ towerNo: 't-01' }, ['T-01'])[0].message, /already exists/);
  assert.match(
    validateTowerDraft({ towerNo: 'T-02', latitude: 20.3 }, [])[0].message,
    /both latitude and longitude/,
  );
  assert.match(
    validateTowerDraft({ towerNo: 'T-02', latitude: 200, longitude: 85 }, [])[0].message,
    /between -90 and 90/,
  );
  assert.match(
    validateTowerDraft({ towerNo: 'T-02', spanToNextM: 9000 }, [])[0].message,
    /unit mix-up/,
  );
  assert.deepEqual(validateTowerDraft({ towerNo: 'T-02', latitude: 20.3, longitude: 85.4 }, []), []);
});

test('a stored tower document is read tolerantly', () => {
  const tower = readTower('abc', {
    towerNo: ' T-05 ',
    latitude: '20.3456',
    activities: { foundation: { status: 'Nonsense', photoCount: '4', presentPhotoKinds: ['excavation', 'junk'] } },
  });
  assert.equal(tower.towerNo, 'T-05');
  assert.equal(tower.sequence, 5);
  assert.equal(tower.latitude, 20.3456);
  assert.equal(tower.activities.foundation.status, 'Not Started', 'unknown status degrades safely');
  assert.equal(tower.activities.foundation.photoCount, 4);
  assert.deepEqual(tower.activities.foundation.presentPhotoKinds, ['excavation']);
  assert.equal(tower.activities.opgw.status, 'Not Started', 'absent activities are filled in');
});

/* ── Project roll-up ────────────────────────────────────────────────────────────────────────── */

test('span activities are counted against spans, not towers', () => {
  // Three towers means two spans. All three carry a completed stringing state; the summary must not
  // report 3 of 2.
  const towers = ['T-01', 'T-02', 'T-03'].map((towerNo) =>
    makeTower(towerNo, { stringing: { status: 'Completed', quantityM: 300 } }),
  );
  const summary = calculateTowerProgressSummary(towers, SETTINGS);
  assert.equal(summary.totalTowers, 3);
  assert.equal(summary.totalSpans, 2);
  const stringing = summary.activities.find((a) => a.activity === 'stringing');
  assert.equal(stringing.total, 2);
  assert.equal(stringing.completed, 2, 'clamped to the number of spans');
  assert.equal(stringing.completionPct, 100);
  assert.equal(stringing.quantityM, 900);

  const survey = summary.activities.find((a) => a.activity === 'survey');
  assert.equal(survey.total, 3);
  assert.equal(survey.pending, 3);
});

test('the roll-up counts fully completed towers, blocked towers and evidence gaps', () => {
  const all = TOWER_ACTIVITIES.reduce((map, a) => ({ ...map, [a]: 'Completed' }), {});
  const towers = [
    makeTower('T-01', all),
    makeTower('T-02', { survey: 'Completed', row: 'Blocked' }),
    makeTower('T-03', { foundation: { status: 'Completed', presentPhotoKinds: ['excavation'] } }),
  ];
  const summary = calculateTowerProgressSummary(towers, SETTINGS);
  assert.equal(summary.fullyCompletedTowers, 1);
  assert.equal(summary.blockedTowers, 1);
  // All three: T-01 completed everything with no photographs at all, T-02's survey is complete with
  // none, and T-03's foundation carries only one of its four.
  assert.equal(summary.towersWithoutEvidence, 3);
  const foundation = summary.activities.find((a) => a.activity === 'foundation');
  assert.equal(foundation.missingEvidence, 2, 'T-01 and T-03; T-02 never started its foundation');
});

test('days in current status is measured from statusSince', () => {
  assert.equal(
    daysInCurrentStatus({ statusSince: '2026-08-16' }, new Date('2026-08-24T00:00:00')),
    8,
  );
  assert.equal(daysInCurrentStatus({}, new Date('2026-08-24T00:00:00')), undefined);
  assert.equal(
    daysInCurrentStatus({ statusSince: '2026-09-01' }, new Date('2026-08-24T00:00:00')),
    0,
    'a future date never reads as negative',
  );
});

/* ── Filters and status matrix ──────────────────────────────────────────────────────────────── */

test('tower ranges filter on the parsed number, not the label', () => {
  const towers = ['T-9', 'T-37', 'T-100'].map((towerNo) => makeTower(towerNo));
  const inRange = filterTowers(towers, { fromTowerNo: 'T-001', toTowerNo: 'T-050' });
  assert.deepEqual(inRange.map((t) => t.towerNo), ['T-9', 'T-37']);
});

test('filters narrow by section, contractor and "has status"', () => {
  const towers = [
    makeTower('T-01', { row: 'Blocked' }, { section: 'S1', contractor: 'ABC', location: 'Village A' }),
    makeTower('T-02', {}, { section: 'S2', contractor: 'XYZ', location: 'Village B' }),
  ];
  assert.equal(filterTowers(towers, { section: 'S1' }).length, 1);
  assert.equal(filterTowers(towers, { contractor: 'XYZ' }).length, 1);
  assert.equal(filterTowers(towers, { status: 'Blocked' }).length, 1);
  assert.equal(filterTowers(towers, { status: 'Blocked' }, 'foundation').length, 0);
  assert.equal(filterTowers(towers, { search: 'village b' }).length, 1);
});

test('the status matrix flags completions whose evidence is incomplete', () => {
  const rows = buildTowerStatusRows(
    [
      makeTower('T-01', {
        survey: { status: 'Completed', presentPhotoKinds: ['survey-location'] },
        foundation: { status: 'Completed', presentPhotoKinds: ['excavation'] },
      }),
    ],
    SETTINGS,
  );
  assert.equal(rows[0].evidenceGap, true);
  const survey = rows[0].cells.find((cell) => cell.activity === 'survey');
  assert.equal(survey.evidenceComplete, true);
  assert.equal(survey.token, '✓');
  const foundation = rows[0].cells.find((cell) => cell.activity === 'foundation');
  assert.equal(foundation.evidenceComplete, false);
});

/* ── Daily and period reports ───────────────────────────────────────────────────────────────── */

test('the daily report counts fresh completions only, never re-saves', () => {
  const updates = [
    makeUpdate({ id: 'a', towerNo: 'T-41', activity: 'foundation', progressDate: '2026-08-24' }),
    makeUpdate({ id: 'b', towerNo: 'T-42', activity: 'foundation', progressDate: '2026-08-24' }),
    // A correction to an already-complete activity: it moved nothing forward.
    makeUpdate({
      id: 'c', towerNo: 'T-41', activity: 'foundation', progressDate: '2026-08-24',
      fromStatus: 'Completed', toStatus: 'Approved',
    }),
    // Not a completion, and on a different day.
    makeUpdate({
      id: 'd', towerNo: 'T-43', activity: 'erection', progressDate: '2026-08-23',
      fromStatus: 'Ready', toStatus: 'In Progress',
    }),
    makeUpdate({
      id: 'e', towerNo: 'T-51', activity: 'stringing', progressDate: '2026-08-24', quantityM: 2800,
    }),
  ];
  const report = buildDailyProgressReport(updates, '2026-08-24');
  const foundation = report.completions.find((line) => line.activity === 'foundation');
  assert.equal(foundation.count, 2);
  assert.deepEqual(foundation.towerNos, ['T-41', 'T-42']);
  const stringing = report.completions.find((line) => line.activity === 'stringing');
  assert.equal(stringing.quantityM, 2800);
  assert.equal(formatKm(stringing.quantityM), '2.80 KM');
  assert.equal(report.otherUpdates.length, 1, 'the Approved re-save is listed, not counted');
  assert.equal(report.totalUpdates, 4);
});

test('the period report derives opening from cumulative so it agrees with the dashboard', () => {
  // Six towers, four foundations complete; one of those four was completed inside the week.
  const towers = ['T-01', 'T-02', 'T-03', 'T-04', 'T-05', 'T-06'].map((towerNo, index) =>
    makeTower(towerNo, index < 4 ? { foundation: 'Completed' } : {}),
  );
  const updates = [
    makeUpdate({ id: 'x', towerId: 'id-T-04', towerNo: 'T-04', progressDate: '2026-08-19' }),
    // Outside the window.
    makeUpdate({ id: 'y', towerId: 'id-T-03', towerNo: 'T-03', progressDate: '2026-08-05' }),
  ];
  const report = buildPeriodProgressReport(
    towers,
    updates,
    { fromDate: '2026-08-17', toDate: '2026-08-23', label: 'Week 34' },
    SETTINGS,
  );
  const foundation = report.lines.find((line) => line.activity === 'foundation');
  assert.equal(foundation.total, 6);
  assert.equal(foundation.cumulative, 4);
  assert.equal(foundation.thisPeriod, 1);
  assert.equal(foundation.opening, 3);
  assert.equal(foundation.balance, 2);
  assert.deepEqual(foundation.towerNos, ['T-04']);
});

test('the period report collects the constraints raised in the window', () => {
  const towers = [makeTower('T-66')];
  const updates = [
    makeUpdate({
      id: 'b1', towerId: 'id-T-66', towerNo: 'T-66', activity: 'row',
      fromStatus: 'In Progress', toStatus: 'Blocked', reason: 'Landowner dispute',
      progressDate: '2026-08-18',
    }),
  ];
  const report = buildPeriodProgressReport(
    towers, updates,
    { fromDate: '2026-08-17', toDate: '2026-08-23', label: 'Week 34' },
    SETTINGS,
  );
  assert.equal(report.constraints.length, 1);
  assert.equal(report.constraints[0].reason, 'Landowner dispute');
});

/* ── Exception reports ──────────────────────────────────────────────────────────────────────── */

test('pending excludes work whose predecessor is not done', () => {
  const ready = makeTower('T-45', {
    survey: 'Completed', row: 'Completed', foundation: 'Completed', structure: 'Completed',
    erection: { status: 'Ready', statusSince: '2026-08-16', reason: '' },
  });
  const notReady = makeTower('T-46', { survey: 'Completed' }); // foundation blocked behind ROW
  const rows = buildPendingReport([ready, notReady], 'erection', new Date('2026-08-24T00:00:00'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].towerNo, 'T-45');
  assert.equal(rows[0].daysWaiting, 8);
  assert.match(rows[0].predecessorStatuses, /Structure: ✓/);
});

test('survey has no predecessor so it is always considered ready', () => {
  const rows = buildPendingReport([makeTower('T-01')], 'survey');
  assert.equal(rows.length, 1);
});

test('delayed catches both past-plan and stalled activities', () => {
  const pastPlan = makeTower('T-01', {
    survey: { status: 'In Progress', plannedEndDate: '2026-08-01', statusSince: '2026-08-23' },
  });
  const stalled = makeTower('T-02', {
    survey: { status: 'In Progress', statusSince: '2026-08-10' },
  });
  const fine = makeTower('T-03', {
    survey: { status: 'In Progress', statusSince: '2026-08-23' },
  });
  const rows = buildDelayedReport(
    [pastPlan, stalled, fine],
    { ...SETTINGS, delayThresholdDays: 7 },
    new Date('2026-08-24T00:00:00'),
  );
  const towerNos = rows.map((row) => row.towerNo);
  assert.ok(towerNos.includes('T-01'));
  assert.ok(towerNos.includes('T-02'));
  assert.equal(towerNos.includes('T-03'), false);
});

test('the no-evidence report separates missing photographs from unverified ones', () => {
  const towers = [
    makeTower('T-22', {
      foundation: { status: 'Completed', completedDate: '2026-08-10', presentPhotoKinds: ['excavation'], photoCount: 1 },
    }),
    makeTower('T-38', {
      erection: {
        status: 'Completed', completedDate: '2026-08-20', photoCount: 2,
        presentPhotoKinds: ['erection-progress', 'tower-complete'],
        verificationState: 'Pending',
      },
    }),
    makeTower('T-40', {
      survey: {
        status: 'Completed', presentPhotoKinds: ['survey-location'], photoCount: 1,
        verificationState: 'Approved',
      },
    }),
  ];
  const rows = buildMissingEvidenceReport(towers, SETTINGS);
  assert.equal(rows.length, 2, 'T-40 is fully evidenced and verified');
  const missing = rows.find((row) => row.towerNo === 'T-22');
  assert.equal(missing.missingCount, 3);
  assert.match(missing.missing, /Reinforcement/);
  const unverified = rows.find((row) => row.towerNo === 'T-38');
  assert.equal(unverified.awaitingVerification, true);
  assert.equal(unverified.missing, 'Awaiting verification');
  assert.equal(rows[0].towerNo, 'T-22', 'the worst gap sorts first');
});

test('completed towers require all seven activities and report construction time', () => {
  const all = TOWER_ACTIVITIES.reduce(
    (map, a) => ({ ...map, [a]: { status: 'Completed', completedDate: '2026-08-20' } }),
    {},
  );
  const done = makeTower('T-37', { ...all, survey: { status: 'Completed', completedDate: '2026-08-02' } });
  const nearly = makeTower('T-38', { ...all, opgw: 'In Progress' });
  const rows = buildCompletedTowerReport([done, nearly]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].towerNo, 'T-37');
  assert.equal(rows[0].surveyDate, '2026-08-02');
  assert.equal(rows[0].finalDate, '2026-08-20');
  assert.equal(rows[0].constructionDays, 18);
});

/* ── Photograph selection and recompute ─────────────────────────────────────────────────────── */

test('a marked report photo wins, then the newest verified, then the newest', () => {
  const approvedOld = makeUpdate({
    id: 'old', progressDate: '2026-08-01', photos: [photo('p1', 'excavation')],
    verificationState: 'Approved',
  });
  const pendingNew = makeUpdate({
    id: 'new', progressDate: '2026-08-10', photos: [photo('p2', 'concreting')],
    verificationState: 'Pending',
  });

  // A verified photograph beats a newer unverified one — it is better evidence.
  assert.equal(
    selectReportPhoto([approvedOld, pendingNew], 'id-T-01', 'foundation').photo.id,
    'p1',
  );

  // Among verified photographs, the newest wins.
  const approvedNew = { ...pendingNew, verificationState: 'Approved' };
  assert.equal(
    selectReportPhoto([approvedOld, approvedNew], 'id-T-01', 'foundation').photo.id,
    'p2',
  );

  // With nothing verified, the newest is used.
  const pendingOld = { ...approvedOld, verificationState: 'Pending' };
  assert.equal(
    selectReportPhoto([pendingOld, pendingNew], 'id-T-01', 'foundation').photo.id,
    'p2',
  );

  // A client-facing report skips unverified photographs entirely.
  assert.equal(
    selectReportPhoto([pendingOld, pendingNew], 'id-T-01', 'foundation', { requireApproved: true }),
    undefined,
  );

  // An explicitly marked report photograph outranks both rules.
  const marked = [
    approvedOld,
    pendingNew,
    makeUpdate({
      id: 'mark', progressDate: '2026-08-05',
      photos: [photo('p3', 'reinforcement', { isReportPhoto: true })],
    }),
  ];
  assert.equal(selectReportPhoto(marked, 'id-T-01', 'foundation').photo.id, 'p3');
});

test('a rejected update is never chosen as evidence', () => {
  const updates = [
    makeUpdate({ id: 'ok', progressDate: '2026-08-01', photos: [photo('p1', 'excavation')], verificationState: 'Approved' }),
    makeUpdate({ id: 'bad', progressDate: '2026-08-10', photos: [photo('p2', 'concreting')], verificationState: 'Rejected' }),
  ];
  assert.equal(selectReportPhoto(updates, 'id-T-01', 'foundation').photo.id, 'p1');
});

test('recompute derives state from history and excludes rejected photographs', () => {
  const previous = { status: 'Not Started', photoCount: 0, approvedPhotoCount: 0, presentPhotoKinds: [], plannedEndDate: '2026-08-15' };
  const history = [
    makeUpdate({ id: '1', fromStatus: 'Not Started', toStatus: 'In Progress', progressDate: '2026-08-05', photos: [photo('a', 'excavation')] }),
    makeUpdate({ id: '2', fromStatus: 'In Progress', toStatus: 'Completed', progressDate: '2026-08-10', photos: [photo('b', 'reinforcement'), photo('c', 'concreting')] }),
    makeUpdate({ id: '3', fromStatus: 'Completed', toStatus: 'Completed', progressDate: '2026-08-11', photos: [photo('d', 'foundation-complete')], verificationState: 'Rejected' }),
  ];
  const state = recomputeActivityState('foundation', history, previous);
  assert.equal(state.status, 'Completed');
  assert.equal(state.startedDate, '2026-08-05');
  assert.equal(state.completedDate, '2026-08-11');
  assert.equal(state.photoCount, 3, 'the rejected photograph is not evidence');
  assert.deepEqual(state.presentPhotoKinds, ['excavation', 'reinforcement', 'concreting']);
  assert.equal(
    hasCompleteEvidence('foundation', state),
    false,
    'rejecting the completion photo puts the activity back in the No Evidence report',
  );
  assert.equal(state.plannedEndDate, '2026-08-15', 'planned dates survive a recompute');
  assert.equal(state.statusSince, '2026-08-10', 'measured from the last real status change');
});

test('recompute clears counters when every update is gone', () => {
  const previous = { status: 'Completed', photoCount: 4, approvedPhotoCount: 4, presentPhotoKinds: ['excavation'], reportPhotoUrl: 'x' };
  const state = recomputeActivityState('foundation', [], previous);
  assert.equal(state.photoCount, 0);
  assert.deepEqual(state.presentPhotoKinds, []);
  assert.equal(state.reportPhotoUrl, undefined);
});

test('before/after needs both ends, and reports the elapsed days', () => {
  const tower = makeTower('T-37', {
    survey: { status: 'Completed', completedDate: '2026-08-02' },
    erection: { status: 'Completed', completedDate: '2026-08-20' },
  });
  const updates = [
    makeUpdate({ id: 's', towerId: 'id-T-37', towerNo: 'T-37', activity: 'survey', progressDate: '2026-08-02', photos: [photo('s1', 'survey-location')] }),
    makeUpdate({ id: 'e', towerId: 'id-T-37', towerNo: 'T-37', activity: 'erection', progressDate: '2026-08-20', photos: [photo('e1', 'tower-complete')] }),
  ];
  const rows = buildBeforeAfterRows([tower], updates, SETTINGS);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].constructionDays, 18);

  const onlySurvey = buildBeforeAfterRows([tower], [updates[0]], SETTINGS);
  assert.equal(onlySurvey.length, 0, 'a half-empty before/after is a mistake, not progress');
});

/* ── Map projection ─────────────────────────────────────────────────────────────────────────── */

test('route status ranks delayed above in-progress and completed above both', () => {
  const all = TOWER_ACTIVITIES.reduce((map, a) => ({ ...map, [a]: 'Completed' }), {});
  const today = new Date('2026-08-24T00:00:00');
  assert.equal(routeStatusOf(makeTower('T-01', all), SETTINGS, today), 'completed');
  assert.equal(routeStatusOf(makeTower('T-02'), SETTINGS, today), 'not-started');
  assert.equal(
    routeStatusOf(makeTower('T-03', { survey: 'In Progress' }), SETTINGS, today),
    'in-progress',
  );
  assert.equal(
    routeStatusOf(makeTower('T-04', { survey: 'Completed', row: 'Blocked' }), SETTINGS, today),
    'delayed',
  );
  assert.equal(
    routeStatusOf(
      makeTower('T-05', { survey: { status: 'In Progress', statusSince: '2026-08-01' } }),
      SETTINGS,
      today,
    ),
    'delayed',
    'stalled beyond the threshold',
  );
});

test('the map projects coordinates inside the viewBox with north at the top', () => {
  const towers = [
    makeTower('T-01', {}, { latitude: 20.0, longitude: 85.0 }),
    makeTower('T-02', {}, { latitude: 20.5, longitude: 85.5 }),
    makeTower('T-03', {}, { latitude: 21.0, longitude: 86.0 }),
    makeTower('T-04'), // no coordinates
  ];
  const map = buildTowerRouteMap(towers, SETTINGS, { width: 1000, height: 600, padding: 40 });
  assert.equal(map.points.length, 3);
  assert.deepEqual(map.towersWithoutCoordinates, ['T-04']);
  map.points.forEach((point) => {
    assert.ok(point.x >= 0 && point.x <= 1000, 'x inside the box');
    assert.ok(point.y >= 0 && point.y <= 600, 'y inside the box');
  });
  const north = map.points.find((p) => p.towerNo === 'T-03');
  const south = map.points.find((p) => p.towerNo === 'T-01');
  assert.ok(north.y < south.y, 'higher latitude renders higher on the page');
  assert.ok(map.routeKm > 0);
  assert.equal(map.counts['not-started'], 4, 'unplotted towers still count in the legend');
});

test('the map survives a single tower and a perfectly straight line', () => {
  const single = buildTowerRouteMap([makeTower('T-01', {}, { latitude: 20, longitude: 85 })], SETTINGS);
  assert.equal(single.points.length, 1);
  assert.ok(Number.isFinite(single.points[0].x) && Number.isFinite(single.points[0].y));

  const straight = buildTowerRouteMap(
    [
      makeTower('T-01', {}, { latitude: 20.0, longitude: 85.0 }),
      makeTower('T-02', {}, { latitude: 20.5, longitude: 85.0 }),
    ],
    SETTINGS,
  );
  straight.points.forEach((point) => {
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
  });
});

test('haversine distance is right to within a kilometre', () => {
  // One degree of latitude is ~111 km.
  const km = haversineKm({ latitude: 20, longitude: 85 }, { latitude: 21, longitude: 85 });
  assert.ok(Math.abs(km - 111.2) < 1, `expected ~111.2 km, got ${km}`);
});

/* ── Import ─────────────────────────────────────────────────────────────────────────────────── */

test('import matches headings by alias regardless of column order', () => {
  const rows = [
    ['Contractor', 'Loc No', 'Structure Type', 'Village', 'Lat', 'Long', 'Span'],
    ['ABC', 'T-001', 'DA+3', 'Village ABC', '20.3456', '85.4567', '320'],
  ];
  const result = parseTowerImportRows(rows, []);
  assert.deepEqual(result.issues, []);
  assert.equal(result.towers.length, 1);
  assert.deepEqual(result.towers[0], {
    towerNo: 'T-001',
    towerType: 'DA+3',
    section: undefined,
    location: 'Village ABC',
    latitude: 20.3456,
    longitude: 85.4567,
    contractor: 'ABC',
    spanToNextM: 320,
  });
  assert.equal(result.columnMap.towerNo, 'Loc No');
});

test('import skips towers already in the project rather than overwriting their progress', () => {
  const rows = [
    ['Tower No'],
    ['T-001'],
    ['t-001'],
    ['T-002'],
  ];
  const result = parseTowerImportRows(rows, ['T-001']);
  assert.equal(result.towers.length, 1);
  assert.equal(result.towers[0].towerNo, 'T-002');
  assert.equal(result.duplicates.length, 2, 'the in-file repeat is caught too');
  assert.match(result.duplicates[0].message, /not overwritten|not be overwritten|not overwritten|progress/);
});

test('import rejects a bad row rather than importing it with the field dropped', () => {
  const rows = [
    ['Tower No', 'Latitude', 'Longitude'],
    ['T-001', 'twenty', '85.4'],
    ['T-002', '20.3', '85.4'],
    ['', '20.3', '85.4'],
  ];
  const result = parseTowerImportRows(rows, []);
  assert.equal(result.towers.length, 1);
  assert.equal(result.towers[0].towerNo, 'T-002');
  assert.equal(result.issues.length, 2);
  assert.match(result.issues[0].message, /not a coordinate/);
  assert.equal(result.issues[0].row, 2, 'row numbers match the user\'s sheet');
  assert.match(result.issues[1].message, /blank/);
});

test('import reads hemisphere suffixes and refuses a sheet with no tower column', () => {
  const withHemisphere = parseTowerImportRows(
    [['Tower No', 'Lat', 'Long'], ['T-001', '20.3456 N', '85.4567 W']],
    [],
  );
  assert.equal(withHemisphere.towers[0].latitude, 20.3456);
  assert.equal(withHemisphere.towers[0].longitude, -85.4567);

  const noColumn = parseTowerImportRows([['Village', 'Type'], ['A', 'B']], []);
  assert.equal(noColumn.towers.length, 0);
  assert.match(noColumn.issues[0].message, /needs a "Tower No" column/);
});

test('import reports the headings it ignored and sorts the result numerically', () => {
  const result = parseTowerImportRows(
    [
      ['Tower No', 'Remarks', 'Weight'],
      ['T-010'],
      ['T-002'],
    ],
    [],
  );
  assert.deepEqual(result.towers.map((t) => t.towerNo), ['T-002', 'T-010']);
  assert.deepEqual(result.unmappedHeadings, ['Remarks', 'Weight']);
});

test('delimited parsing honours quoted fields containing the delimiter', () => {
  const rows = parseDelimitedText('Tower No,Location\nT-001,"Village ABC, Dist XYZ"\n');
  assert.deepEqual(rows, [
    ['Tower No', 'Location'],
    ['T-001', 'Village ABC, Dist XYZ'],
  ]);
  assert.deepEqual(parseDelimitedText('a,"say ""hi"""')[0], ['a', 'say "hi"']);
  assert.equal(detectDelimiter('a\tb\tc'), '\t');
  assert.equal(detectDelimiter('a;b;c'), ';');
  assert.equal(detectDelimiter('single'), ',');
});

/* ── Settings ───────────────────────────────────────────────────────────────────────────────── */

test('stored settings are read tolerantly and fall back to defaults', () => {
  const resolved = resolveTowerProgressSettings({
    evidenceEnforcement: 'nonsense',
    delayThresholdDays: '10',
    activityWeights: { survey: 20, opgw: 'bad' },
    watermarkOrganisation: '  ',
  });
  assert.equal(resolved.evidenceEnforcement, 'block');
  assert.equal(resolved.delayThresholdDays, 10);
  assert.equal(resolved.activityWeights.survey, 20);
  assert.equal(resolved.activityWeights.opgw, DEFAULT_ACTIVITY_WEIGHTS.opgw);
  assert.equal(resolved.watermarkOrganisation, DEFAULT_TOWER_PROGRESS_SETTINGS.watermarkOrganisation);
  assert.equal(resolved.requireVerification, true);

  const empty = resolveTowerProgressSettings(undefined);
  assert.deepEqual(empty.activityWeights, DEFAULT_ACTIVITY_WEIGHTS);
});

test('settings validation insists the weights total 100', () => {
  assert.deepEqual(validateTowerProgressSettings(SETTINGS), []);
  const bad = validateTowerProgressSettings({
    ...SETTINGS,
    activityWeights: { ...DEFAULT_ACTIVITY_WEIGHTS, survey: 5 },
  });
  assert.equal(bad.length, 1);
  assert.match(bad[0].message, /must total 100/);

  const thirds = TOWER_ACTIVITIES.reduce((map, a, index) => ({ ...map, [a]: index < 6 ? 14.29 : 14.26 }), {});
  assert.deepEqual(
    validateTowerProgressSettings({ ...SETTINGS, activityWeights: thirds }),
    [],
    'rounding does not make a valid split read as invalid',
  );

  const noWatermark = validateTowerProgressSettings({ ...SETTINGS, watermarkOrganisation: ' ' });
  assert.ok(noWatermark.some((issue) => /organisation name/.test(issue.message)));
});

/* ── Formatting and date helpers ────────────────────────────────────────────────────────────── */

test('dates and lengths render the way progress reports quote them', () => {
  assert.equal(formatTowerDate('2026-08-10'), '10-Aug-2026');
  assert.equal(formatTowerDate(''), '—');
  assert.equal(formatTowerDate('not a date'), 'not a date');
  assert.equal(formatKm(2800), '2.80 KM');
});

test('weeks run Monday to Sunday and week numbers match ISO', () => {
  assert.equal(weekStartKey(new Date('2026-08-24T00:00:00')), '2026-08-24', 'a Monday');
  assert.equal(weekStartKey(new Date('2026-08-23T00:00:00')), '2026-08-17', 'Sunday belongs to the week before');
  assert.equal(addDaysToKey('2026-08-24', 6), '2026-08-30');
  assert.equal(addDaysToKey('2026-08-31', -1), '2026-08-30', 'crosses a month boundary');
  assert.equal(isoWeekNumber(new Date('2026-08-24T00:00:00')), 35);
  assert.equal(isoWeekNumber(new Date('2026-01-01T00:00:00')), 1);
});

/* ── Report registry ────────────────────────────────────────────────────────────────────────── */

test('activity route segments round-trip and match the report ids', () => {
  TOWER_ACTIVITIES.forEach((activity) => {
    const segment = ACTIVITY_ROUTE_SEGMENTS[activity];
    assert.ok(segment, `${activity} has no route segment`);
    assert.equal(activityFromRouteSegment(segment), activity);
    // The activity-wise report shares the segment, so `/activity/foundation` and
    // `/reports/foundation` cannot drift apart.
    assert.ok(towerReportById(segment), `no report at /reports/${segment}`);
  });
  assert.equal(ACTIVITY_ROUTE_SEGMENTS.structure, 'tower-structure');
  assert.equal(activityFromRouteSegment('structure'), undefined);
  assert.equal(activityFromRouteSegment('nonsense'), undefined);
});

test('the report registry has unique ids and every report a renderer', () => {
  const ids = TOWER_REPORTS.map((report) => report.id);
  assert.equal(new Set(ids).size, ids.length, 'report ids double as routes and must be unique');
  TOWER_REPORTS.forEach((report) => {
    assert.ok(report.title && report.description && report.kind, `${report.id} is incomplete`);
    assert.equal(towerReportById(report.id), report);
  });
  // The routes the specification names must all resolve.
  [
    'tower-status', 'photo-progress', 'daily-progress', 'weekly-progress', 'monthly-progress',
    'foundation', 'erection', 'stringing', 'opgw', 'pending', 'delayed', 'missing-evidence',
    'survey', 'row', 'tower-structure', 'latest-photos', 'before-after', 'photo-timeline', 'map',
    'completed-towers', 'row-blocked', 'project-summary',
  ].forEach((id) => {
    assert.ok(towerReportById(id), `report route ${id} is missing`);
  });
  assert.equal(towerReportById('not-a-report'), undefined);
});

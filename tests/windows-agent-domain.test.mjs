import test from 'node:test';
import assert from 'node:assert/strict';

// Imported from the pure modules rather than `windows-agent.ts`, which re-exports types that only
// resolve inside the bundler.
import {
  DEFAULT_APP_CATALOG,
  MAX_SPAN_SECONDS,
  attendanceStatusOf,
  buildApplicationBreakdown,
  buildApplicationUsageDeltas,
  buildTimeline,
  compareVersions,
  defaultCategoryFor,
  dominantClassification,
  estimateUncleanEnd,
  evaluateAgentHealth,
  evaluateLateLogin,
  extractBrowserDomain,
  foldSpan,
  foldSpans,
  formatSeconds,
  isSessionAbandoned,
  normalizeProcessKey,
  normalizeSpans,
  presenceFromIdleSeconds,
  resolveApplicationName,
  resolvePresence,
  resolveSpanOverlaps,
  retentionCutoffDate,
  sanitizeWindowTitle,
  shouldResumeSession,
  summariseByCategory,
  workDateOf,
} from '../src/lib/windows-agent-rules.ts';

import {
  AGENT_POLICY_KEYS,
  DEFAULT_AGENT_POLICY,
  defaultResolvedPolicy,
  policyApplies,
  resolveAgentPolicy,
  sanitizePolicySettings,
  thresholdsOf,
} from '../src/lib/windows-agent-policy.ts';

import {
  canBroadcastNotifications,
  canOpenWindowsAgent,
  canViewActivityOf,
  canViewLiveBoard,
  canViewOwnActivity,
  filterVisibleSubjects,
  resolveActivityScope,
} from '../src/lib/windows-agent-permissions.ts';

const THRESHOLDS = { idleThresholdSeconds: 300, extendedIdleThresholdSeconds: 900 };

const iso = (value) => new Date(value).toISOString();

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * Process identity
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

test('normalizeProcessKey reduces a path or a mixed-case name to one grouping key', () => {
  assert.equal(normalizeProcessKey('EXCEL.EXE'), 'excel.exe');
  assert.equal(normalizeProcessKey('C:\\Program Files\\Microsoft Office\\root\\Office16\\EXCEL.EXE'), 'excel.exe');
  assert.equal(normalizeProcessKey('/usr/bin/Code.exe'), 'code.exe');
  assert.equal(normalizeProcessKey('   '), '');
  assert.equal(normalizeProcessKey(null), '');
  assert.equal(normalizeProcessKey(undefined), '');
});

test('the built-in catalogue classifies the software §8 names, and judges nobody', () => {
  assert.equal(defaultCategoryFor('excel.exe'), 'OFFICE');
  assert.equal(defaultCategoryFor('winword.exe'), 'OFFICE');
  assert.equal(defaultCategoryFor('chrome.exe'), 'REFERENCE');
  assert.equal(defaultCategoryFor('msedge.exe'), 'REFERENCE');
  assert.equal(defaultCategoryFor('outlook.exe'), 'COMMUNICATION');
  assert.equal(defaultCategoryFor('powerpnt.exe'), 'OFFICE');
  assert.equal(defaultCategoryFor('acrobat.exe'), 'REFERENCE');
  assert.equal(defaultCategoryFor('code.exe'), 'DEVELOPMENT');
  assert.equal(defaultCategoryFor('totally-unknown.exe'), 'UNCLASSIFIED');

  // §22: no category in the catalogue expresses a verdict about the person using the software.
  const categories = new Set(Object.values(DEFAULT_APP_CATALOG).map((entry) => entry.category));
  for (const banned of ['PRODUCTIVE', 'UNPRODUCTIVE', 'WASTE', 'DISTRACTION']) {
    assert.ok(!categories.has(banned), `${banned} must not be a category`);
  }
});

test('resolveApplicationName prefers the catalogue, then the built-in, then what the agent read', () => {
  assert.equal(resolveApplicationName('excel.exe', 'Excel', 'Microsoft Excel 365'), 'Microsoft Excel 365');
  assert.equal(resolveApplicationName('excel.exe', 'Excel'), 'Microsoft Excel');
  assert.equal(resolveApplicationName('bespoke.exe', 'Bespoke Estimating Tool'), 'Bespoke Estimating Tool');
  assert.equal(resolveApplicationName('bespoke.exe', null), 'bespoke.exe');
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * The accounting rule the header of windows-agent-rules.ts is about
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

test('a span that ends idle still credits the work that preceded it', () => {
  // Thirty minutes in Excel, the last six of them idle. Labelling the whole span would erase
  // twenty-four minutes of work; splitting the seconds does not.
  const contribution = foldSpan(
    { eventType: 'APP_ACTIVE', durationSeconds: 1800, idleSeconds: 360, recordedOffline: false },
    THRESHOLDS,
  );
  assert.equal(contribution.totalSeconds, 1800);
  assert.equal(contribution.activeSeconds, 1440);
  assert.equal(contribution.idleSeconds, 360);
  assert.equal(contribution.extendedIdleSeconds, 0);
  assert.equal(contribution.lockedSeconds, 0);
});

test('idle past the extended threshold lands in the extended bucket, not the idle one', () => {
  const contribution = foldSpan(
    { eventType: 'APP_ACTIVE', durationSeconds: 3600, idleSeconds: 1200, recordedOffline: false },
    THRESHOLDS,
  );
  assert.equal(contribution.activeSeconds, 2400);
  assert.equal(contribution.idleSeconds, 0);
  assert.equal(contribution.extendedIdleSeconds, 1200);
});

test('locked time is locked in full, never partly active', () => {
  const contribution = foldSpan(
    { eventType: 'LOCK', durationSeconds: 3000, idleSeconds: 0, recordedOffline: false },
    THRESHOLDS,
  );
  assert.equal(contribution.lockedSeconds, 3000);
  assert.equal(contribution.activeSeconds, 0);
  assert.equal(contribution.idleSeconds, 0);
});

test('offline is a tag on the same seconds, not a fifth bucket that double-counts them', () => {
  const contribution = foldSpan(
    { eventType: 'APP_ACTIVE', durationSeconds: 600, idleSeconds: 0, recordedOffline: true },
    THRESHOLDS,
  );
  assert.equal(contribution.activeSeconds, 600);
  assert.equal(contribution.offlineSeconds, 600);
  // The buckets that partition the time still sum to the duration.
  assert.equal(
    contribution.activeSeconds +
      contribution.idleSeconds +
      contribution.extendedIdleSeconds +
      contribution.lockedSeconds,
    contribution.totalSeconds,
  );
});

test('a day of spans never totals more than the wall clock it covers', () => {
  const spans = [
    { eventType: 'APP_ACTIVE', durationSeconds: 1800, idleSeconds: 120, recordedOffline: false },
    { eventType: 'APP_ACTIVE', durationSeconds: 2400, idleSeconds: 1000, recordedOffline: false },
    { eventType: 'LOCK', durationSeconds: 3000, idleSeconds: 0, recordedOffline: false },
    { eventType: 'APP_ACTIVE', durationSeconds: 900, idleSeconds: 900, recordedOffline: false },
  ];
  const totals = foldSpans(spans, THRESHOLDS);
  assert.equal(totals.totalSeconds, 8100);
  assert.equal(
    totals.activeSeconds + totals.idleSeconds + totals.extendedIdleSeconds + totals.lockedSeconds,
    totals.totalSeconds,
  );
});

test('dominantClassification labels the bar without the totals ever reading it', () => {
  assert.equal(
    dominantClassification({ eventType: 'APP_ACTIVE', durationSeconds: 1800, idleSeconds: 360, recordedOffline: false }, THRESHOLDS),
    'ACTIVE',
  );
  assert.equal(
    dominantClassification({ eventType: 'APP_ACTIVE', durationSeconds: 600, idleSeconds: 500, recordedOffline: false }, THRESHOLDS),
    'IDLE',
  );
  assert.equal(
    dominantClassification({ eventType: 'APP_ACTIVE', durationSeconds: 1800, idleSeconds: 1700, recordedOffline: false }, THRESHOLDS),
    'EXTENDED_IDLE',
  );
  assert.equal(
    dominantClassification({ eventType: 'LOCK', durationSeconds: 60, idleSeconds: 0, recordedOffline: false }, THRESHOLDS),
    'LOCKED',
  );
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * Ingest hardening (§31, §59)
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

const ingestOptions = {
  sessionStart: new Date('2026-09-20T03:30:00Z'),
  sessionEnd: new Date('2026-09-20T13:30:00Z'),
  now: new Date('2026-09-20T13:30:00Z'),
  allowWindowTitles: false,
  allowBrowserDomains: false,
};

test('normalizeSpans recomputes duration and rejects what it cannot trust', () => {
  const { spans, rejected } = normalizeSpans(
    [
      {
        spanId: 'a',
        eventType: 'APP_ACTIVE',
        processName: 'C:\\Office\\EXCEL.EXE',
        applicationName: 'Microsoft Excel',
        startedAt: iso('2026-09-20T04:00:00Z'),
        endedAt: iso('2026-09-20T04:30:00Z'),
        idleSeconds: 60,
      },
      // No id.
      { spanId: '', eventType: 'APP_ACTIVE', startedAt: iso('2026-09-20T04:00:00Z'), endedAt: iso('2026-09-20T04:01:00Z'), idleSeconds: 0 },
      // Ends before it starts.
      { spanId: 'b', eventType: 'APP_ACTIVE', startedAt: iso('2026-09-20T05:00:00Z'), endedAt: iso('2026-09-20T04:00:00Z'), idleSeconds: 0 },
      // A clock that jumped a year forward.
      { spanId: 'c', eventType: 'APP_ACTIVE', startedAt: iso('2027-09-20T04:00:00Z'), endedAt: iso('2027-09-20T04:30:00Z'), idleSeconds: 0 },
      // Longer than any real focus stretch.
      { spanId: 'd', eventType: 'APP_ACTIVE', startedAt: iso('2026-09-19T00:00:00Z'), endedAt: iso('2026-09-20T13:00:00Z'), idleSeconds: 0 },
      // Duplicate id inside one batch.
      { spanId: 'a', eventType: 'APP_ACTIVE', startedAt: iso('2026-09-20T06:00:00Z'), endedAt: iso('2026-09-20T06:10:00Z'), idleSeconds: 0 },
    ],
    ingestOptions,
  );

  assert.equal(spans.length, 1);
  assert.equal(spans[0].spanId, 'a');
  assert.equal(spans[0].processKey, 'excel.exe');
  assert.equal(spans[0].durationSeconds, 1800);
  assert.equal(spans[0].idleSeconds, 60);
  assert.equal(rejected.length, 5);
  assert.ok(rejected.every((entry) => typeof entry.reason === 'string' && entry.reason.length > 0));
});

test('a span straddling sign-in is clamped to the session, not thrown away', () => {
  const { spans } = normalizeSpans(
    [
      {
        spanId: 'straddle',
        eventType: 'APP_ACTIVE',
        processName: 'chrome.exe',
        startedAt: iso('2026-09-20T03:00:00Z'), // 30 minutes before the session opened
        endedAt: iso('2026-09-20T04:00:00Z'),
        idleSeconds: 0,
      },
    ],
    ingestOptions,
  );
  assert.equal(spans.length, 1);
  assert.equal(spans[0].startedAt.toISOString(), '2026-09-20T03:30:00.000Z');
  assert.equal(spans[0].durationSeconds, 1800);
});

test('idleSeconds is clamped to the span it belongs to', () => {
  const { spans } = normalizeSpans(
    [
      {
        spanId: 'overclaimed-idle',
        eventType: 'APP_ACTIVE',
        processName: 'excel.exe',
        startedAt: iso('2026-09-20T04:00:00Z'),
        endedAt: iso('2026-09-20T04:10:00Z'),
        idleSeconds: 99_999,
      },
    ],
    ingestOptions,
  );
  assert.equal(spans[0].idleSeconds, 600);
  assert.equal(foldSpan(spans[0], THRESHOLDS).activeSeconds, 0);
});

test('window titles and browser domains are dropped unless the policy allows them', () => {
  const raw = [
    {
      spanId: 'titled',
      eventType: 'APP_ACTIVE',
      processName: 'chrome.exe',
      startedAt: iso('2026-09-20T04:00:00Z'),
      endedAt: iso('2026-09-20T04:05:00Z'),
      idleSeconds: 0,
      windowTitle: 'Payroll 2026 - Google Sheets',
      browserDomain: 'https://docs.google.com/spreadsheets/d/secret/edit?q=salary',
    },
  ];

  const denied = normalizeSpans(raw, ingestOptions).spans[0];
  assert.equal(denied.windowTitle, null);
  assert.equal(denied.browserDomain, null);

  const allowed = normalizeSpans(raw, {
    ...ingestOptions,
    allowWindowTitles: true,
    allowBrowserDomains: true,
  }).spans[0];
  assert.equal(allowed.windowTitle, 'Payroll 2026 - Google Sheets');
  // Host only — the path and the query never survive.
  assert.equal(allowed.browserDomain, 'docs.google.com');
});

test('resolveSpanOverlaps stops a multi-monitor day from totalling more than the day', () => {
  const base = { eventType: 'APP_ACTIVE', recordedOffline: false, processKey: 'excel.exe', processName: 'excel.exe', reportedApplicationName: null, windowTitle: null, browserDomain: null };
  const resolved = resolveSpanOverlaps([
    { ...base, spanId: '1', startedAt: new Date('2026-09-20T04:00:00Z'), endedAt: new Date('2026-09-20T04:30:00Z'), durationSeconds: 1800, idleSeconds: 0 },
    // Starts ten minutes before the previous one ended.
    { ...base, spanId: '2', startedAt: new Date('2026-09-20T04:20:00Z'), endedAt: new Date('2026-09-20T04:50:00Z'), durationSeconds: 1800, idleSeconds: 0 },
    // Entirely inside the first.
    { ...base, spanId: '3', startedAt: new Date('2026-09-20T04:05:00Z'), endedAt: new Date('2026-09-20T04:10:00Z'), durationSeconds: 300, idleSeconds: 0 },
  ]);

  const total = resolved.reduce((sum, span) => sum + span.durationSeconds, 0);
  assert.equal(total, 3000); // 04:00 → 04:50, counted once
  assert.equal(resolved.length, 2);
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * Application rollups (§9)
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

const span = (spanId, processKey, startedAt, endedAt, idleSeconds = 0, eventType = 'APP_ACTIVE') => ({
  spanId,
  eventType,
  processKey,
  processName: processKey,
  reportedApplicationName: null,
  startedAt: new Date(startedAt),
  endedAt: new Date(endedAt),
  durationSeconds: Math.round((new Date(endedAt) - new Date(startedAt)) / 1000),
  idleSeconds,
  recordedOffline: false,
  windowTitle: null,
  browserDomain: null,
});

test('application usage counts foreground time only, and never locked time', () => {
  const deltas = buildApplicationUsageDeltas(
    [
      span('1', 'excel.exe', '2026-09-20T04:00:00Z', '2026-09-20T05:00:00Z'),
      span('2', 'chrome.exe', '2026-09-20T05:00:00Z', '2026-09-20T05:30:00Z', 300),
      span('3', 'excel.exe', '2026-09-20T05:30:00Z', '2026-09-20T06:00:00Z'),
      // A lock while Excel still held focus behind it. Must not reach Excel's total.
      span('4', 'excel.exe', '2026-09-20T06:00:00Z', '2026-09-20T07:00:00Z', 0, 'LOCK'),
    ],
    THRESHOLDS,
    defaultCategoryFor,
  );

  const excel = deltas.find((entry) => entry.processKey === 'excel.exe');
  const chrome = deltas.find((entry) => entry.processKey === 'chrome.exe');
  assert.equal(excel.totalSeconds, 5400); // 60m + 30m, lock excluded
  assert.equal(excel.activeSeconds, 5400);
  assert.equal(excel.focusCount, 2);
  assert.equal(excel.category, 'OFFICE');
  assert.equal(chrome.totalSeconds, 1800);
  assert.equal(chrome.activeSeconds, 1500);
  assert.equal(chrome.idleSeconds, 300);
});

test('the breakdown folds a long tail into Others and its percentages sum to 100', () => {
  const usage = [
    { processKey: 'excel.exe', applicationName: 'Microsoft Excel', category: 'OFFICE', totalSeconds: 11_520, activeSeconds: 11_520 },
    { processKey: 'chrome.exe', applicationName: 'Google Chrome', category: 'REFERENCE', totalSeconds: 7_800, activeSeconds: 7_800 },
    { processKey: 'winword.exe', applicationName: 'Microsoft Word', category: 'OFFICE', totalSeconds: 4_800, activeSeconds: 4_800 },
    { processKey: 'a.exe', applicationName: 'A', category: 'UNCLASSIFIED', totalSeconds: 300, activeSeconds: 300 },
    { processKey: 'b.exe', applicationName: 'B', category: 'UNCLASSIFIED', totalSeconds: 200, activeSeconds: 200 },
    { processKey: 'c.exe', applicationName: 'C', category: 'UNCLASSIFIED', totalSeconds: 100, activeSeconds: 100 },
  ];
  const { rows, totalActiveSeconds } = buildApplicationBreakdown(usage, { topN: 3 });

  assert.equal(totalActiveSeconds, 24_720);
  assert.equal(rows.length, 4);
  assert.equal(rows[0].applicationName, 'Microsoft Excel');
  const others = rows[rows.length - 1];
  assert.equal(others.applicationName, 'Others');
  assert.equal(others.activeSeconds, 600);
  const sum = rows.reduce((total, row) => total + row.percentOfActive, 0);
  assert.ok(Math.abs(sum - 100) < 0.5, `percentages summed to ${sum}`);
});

test('an empty day produces zero percentages rather than NaN', () => {
  const { rows, totalActiveSeconds } = buildApplicationBreakdown([]);
  assert.equal(rows.length, 0);
  assert.equal(totalActiveSeconds, 0);
});

test('summariseByCategory folds applications up to §22 categories', () => {
  const summary = summariseByCategory([
    { category: 'OFFICE', activeSeconds: 1000 },
    { category: 'OFFICE', activeSeconds: 500 },
    { category: 'REFERENCE', activeSeconds: 200 },
  ]);
  assert.deepEqual(summary, { OFFICE: 1500, REFERENCE: 200 });
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * Timeline (§10)
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

test('the timeline merges the forty focus events an hour in Excel really produces', () => {
  const events = [];
  for (let minute = 0; minute < 30; minute += 1) {
    events.push({
      startedAt: iso(`2026-09-20T04:${String(minute).padStart(2, '0')}:00Z`),
      endedAt: iso(`2026-09-20T04:${String(minute).padStart(2, '0')}:59Z`),
      durationSeconds: 59,
      classification: 'ACTIVE',
      applicationName: 'Microsoft Excel',
      processName: 'excel.exe',
      category: 'OFFICE',
      eventType: 'APP_ACTIVE',
    });
  }
  events.push({
    startedAt: iso('2026-09-20T04:30:00Z'),
    endedAt: iso('2026-09-20T05:00:00Z'),
    durationSeconds: 1800,
    classification: 'ACTIVE',
    applicationName: 'Google Chrome',
    processName: 'chrome.exe',
    category: 'REFERENCE',
    eventType: 'APP_ACTIVE',
  });

  const timeline = buildTimeline(events);
  assert.equal(timeline.length, 2);
  assert.equal(timeline[0].label, 'Microsoft Excel');
  assert.equal(timeline[0].durationSeconds, 1799);
  assert.equal(timeline[1].label, 'Google Chrome');
});

test('the timeline names states rather than applications when the machine was not in use', () => {
  const timeline = buildTimeline([
    { startedAt: iso('2026-09-20T04:00:00Z'), endedAt: iso('2026-09-20T04:01:00Z'), durationSeconds: 60, classification: 'ACTIVE', applicationName: null, processName: null, category: 'SYSTEM', eventType: 'LOGIN' },
    { startedAt: iso('2026-09-20T07:00:00Z'), endedAt: iso('2026-09-20T07:45:00Z'), durationSeconds: 2700, classification: 'LOCKED', applicationName: 'Microsoft Excel', processName: 'excel.exe', category: 'OFFICE', eventType: 'LOCK' },
  ]);
  assert.equal(timeline[0].label, 'Login');
  assert.equal(timeline[1].label, 'PC Locked');
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * Presence, health and versions (§16, §17, §47)
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

test('a device that stopped beating reads OFFLINE whatever it last claimed', () => {
  const now = new Date('2026-09-20T10:00:00Z');
  assert.equal(
    resolvePresence(new Date('2026-09-20T09:59:00Z'), 'ACTIVE', { heartbeatIntervalSeconds: 90, now }),
    'ACTIVE',
  );
  assert.equal(
    resolvePresence(new Date('2026-09-20T09:50:00Z'), 'ACTIVE', { heartbeatIntervalSeconds: 90, now }),
    'OFFLINE',
  );
  assert.equal(resolvePresence(null, 'ACTIVE', { heartbeatIntervalSeconds: 90, now }), 'OFFLINE');
});

test('raising the heartbeat interval does not make the whole fleet look offline', () => {
  const now = new Date('2026-09-20T10:00:00Z');
  // Six minutes ago: past three missed 90s beats (4m30s), well inside three missed 180s ones (9m).
  const lastBeat = new Date('2026-09-20T09:54:00Z');
  assert.equal(resolvePresence(lastBeat, 'ACTIVE', { heartbeatIntervalSeconds: 90, now }), 'OFFLINE');
  assert.equal(resolvePresence(lastBeat, 'ACTIVE', { heartbeatIntervalSeconds: 180, now }), 'ACTIVE');
});

test('presenceFromIdleSeconds walks §11’s ladder and lock beats everything', () => {
  assert.equal(presenceFromIdleSeconds(30, THRESHOLDS, false), 'ACTIVE');
  assert.equal(presenceFromIdleSeconds(400, THRESHOLDS, false), 'IDLE');
  assert.equal(presenceFromIdleSeconds(1200, THRESHOLDS, false), 'EXTENDED_IDLE');
  assert.equal(presenceFromIdleSeconds(30, THRESHOLDS, true), 'LOCKED');
});

test('compareVersions orders numerically, so 1.10.0 is newer than 1.9.0', () => {
  assert.equal(compareVersions('1.10.0', '1.9.0'), 1);
  assert.equal(compareVersions('1.4.2', '1.4.2'), 0);
  assert.equal(compareVersions('1.4.2', '1.4.10'), -1);
  assert.equal(compareVersions('1.4.2-beta', '1.4.2'), 0);
  assert.equal(compareVersions('2', '1.99.99'), 1);
});

test('agent health flags the four §47 problems and nothing else', () => {
  const now = new Date('2026-09-20T10:00:00Z');
  assert.deepEqual(
    evaluateAgentHealth({
      status: 'ACTIVE',
      lastHeartbeatAt: new Date('2026-09-20T09:59:00Z'),
      agentVersion: '1.4.2',
      latestVersion: '1.4.2',
      queuedSpanCount: 3,
      clockSkewSeconds: 2,
      heartbeatIntervalSeconds: 90,
      now,
    }),
    [],
  );

  const flags = evaluateAgentHealth({
    status: 'ACTIVE',
    lastHeartbeatAt: new Date('2026-09-20T08:00:00Z'),
    agentVersion: '1.3.0',
    latestVersion: '1.4.2',
    queuedSpanCount: 900,
    clockSkewSeconds: -600,
    heartbeatIntervalSeconds: 90,
    now,
  });
  assert.deepEqual(flags.sort(), ['CLOCK_SKEW', 'NO_HEARTBEAT', 'OUTDATED_VERSION', 'SYNC_BACKLOG']);

  assert.ok(
    evaluateAgentHealth({
      status: 'ACTIVE',
      lastHeartbeatAt: null,
      agentVersion: null,
      latestVersion: '1.4.2',
      queuedSpanCount: 0,
      clockSkewSeconds: 0,
      heartbeatIntervalSeconds: 90,
      now,
    }).includes('NEVER_REPORTED'),
  );
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * Sessions (§7, §28)
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

test('a reconnect resumes today’s session rather than opening a second one', () => {
  const existing = { status: 'OPEN', loginAt: iso('2026-09-20T03:32:00Z'), workDate: '2026-09-20', deviceId: 'pc-23', userId: 'u1' };
  assert.equal(shouldResumeSession(existing, { workDate: '2026-09-20', deviceId: 'pc-23', userId: 'u1' }), true);
  // Different PC, different day, closed session, or nothing at all: all open a new one.
  assert.equal(shouldResumeSession(existing, { workDate: '2026-09-20', deviceId: 'pc-24', userId: 'u1' }), false);
  assert.equal(shouldResumeSession(existing, { workDate: '2026-09-21', deviceId: 'pc-23', userId: 'u1' }), false);
  assert.equal(shouldResumeSession({ ...existing, status: 'CLOSED' }, { workDate: '2026-09-20', deviceId: 'pc-23', userId: 'u1' }), false);
  assert.equal(shouldResumeSession(null, { workDate: '2026-09-20', deviceId: 'pc-23', userId: 'u1' }), false);
});

test('an unclean end is estimated from the last evidence and says that it was estimated', () => {
  const estimate = estimateUncleanEnd({
    loginAt: iso('2026-09-20T03:32:00Z'),
    lastHeartbeatAt: iso('2026-09-20T11:14:00Z'),
    lastActivityAt: iso('2026-09-20T11:12:00Z'),
  });
  assert.equal(estimate.endedAt, '2026-09-20T11:14:00.000Z');
  assert.equal(estimate.estimated, true);
  assert.equal(estimate.endReason, 'HEARTBEAT_TIMEOUT');
});

test('a session that never beat records zero rather than inventing a day', () => {
  const estimate = estimateUncleanEnd({
    loginAt: iso('2026-09-20T03:32:00Z'),
    lastHeartbeatAt: null,
    lastActivityAt: null,
  });
  assert.equal(estimate.endedAt, '2026-09-20T03:32:00.000Z');
  assert.equal(estimate.estimated, true);
});

test('isSessionAbandoned waits out a lunch-length network blip before reaping', () => {
  const now = new Date('2026-09-20T10:00:00Z');
  assert.equal(
    isSessionAbandoned({ lastHeartbeatAt: iso('2026-09-20T09:55:00Z'), loginAt: iso('2026-09-20T03:30:00Z') }, { heartbeatIntervalSeconds: 90, now }),
    false,
  );
  assert.equal(
    isSessionAbandoned({ lastHeartbeatAt: iso('2026-09-20T09:40:00Z'), loginAt: iso('2026-09-20T03:30:00Z') }, { heartbeatIntervalSeconds: 90, now }),
    true,
  );
});

test('late login is read in the office timezone, with the configured grace', () => {
  // 03:32Z is 09:02 in Asia/Kolkata — two minutes past nine, inside a fifteen-minute grace.
  assert.deepEqual(
    evaluateLateLogin(new Date('2026-09-20T03:32:00Z'), { workdayStart: '09:00', lateLoginGraceMinutes: 15 }),
    { lateLogin: false, lateByMinutes: 0 },
  );
  // 04:20Z is 09:50 — thirty-five minutes past, twenty past the grace.
  assert.deepEqual(
    evaluateLateLogin(new Date('2026-09-20T04:20:00Z'), { workdayStart: '09:00', lateLoginGraceMinutes: 15 }),
    { lateLogin: true, lateByMinutes: 35 },
  );
  // An unparseable workday start must not accuse anybody.
  assert.deepEqual(
    evaluateLateLogin(new Date('2026-09-20T04:20:00Z'), { workdayStart: 'nonsense', lateLoginGraceMinutes: 15 }),
    { lateLogin: false, lateByMinutes: 0 },
  );
});

test('attendance status reports the most actionable fact first', () => {
  const base = { sessionSeconds: 9 * 3600, offlineSeconds: 0, lateLogin: false, hasUncleanSession: false };
  assert.equal(attendanceStatusOf(base), 'Present');
  assert.equal(attendanceStatusOf({ ...base, lateLogin: true }), 'Late');
  assert.equal(attendanceStatusOf({ ...base, sessionSeconds: 4 * 3600 }), 'Short Duration');
  assert.equal(attendanceStatusOf({ ...base, offlineSeconds: 8 * 3600 }), 'Offline Session');
  assert.equal(attendanceStatusOf({ ...base, hasUncleanSession: true, lateLogin: true }), 'Incomplete Logout');
});

test('workDateOf partitions by the office day, not by UTC', () => {
  // 20:30Z on the 19th is 02:00 on the 20th in Asia/Kolkata.
  assert.equal(workDateOf(new Date('2026-09-19T20:30:00Z')), '2026-09-20');
  assert.equal(workDateOf(new Date('2026-09-20T18:29:00Z')), '2026-09-20');
  assert.equal(workDateOf(new Date('2026-09-20T18:31:00Z')), '2026-09-21');
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * Privacy filters (§12, §14)
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

test('window titles are redacted of the things a monitoring tool must not hold', () => {
  assert.equal(
    sanitizeWindowTitle('Mail from priya.das@selindia.net - Outlook'),
    'Mail from [email] - Outlook',
  );
  assert.ok(!sanitizeWindowTitle('Vault — password: hunter2').includes('hunter2'));
  assert.ok(!sanitizeWindowTitle('Card 4111 1111 1111 1111 — Netbanking').includes('4111'));
  assert.equal(sanitizeWindowTitle('   '), null);
  assert.equal(sanitizeWindowTitle(null), null);
  assert.ok(sanitizeWindowTitle('x'.repeat(400)).length <= 120);
});

test('a browser domain is a host and can never smuggle a path or a query', () => {
  assert.equal(extractBrowserDomain('https://www.selindia.net/projects/t-104?q=secret'), 'selindia.net');
  assert.equal(extractBrowserDomain('docs.google.com/document/d/abc/edit'), 'docs.google.com');
  assert.equal(extractBrowserDomain('https://mail.google.com/mail/u/0/#search/salary'), 'mail.google.com');
  assert.equal(extractBrowserDomain('not a url at all !!'), null);
  assert.equal(extractBrowserDomain(''), null);
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * Formatting and retention
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

test('formatSeconds prints the §7 shape', () => {
  assert.equal(formatSeconds(35_160), '09h 46m');
  assert.equal(formatSeconds(3_600), '01h 00m');
  assert.equal(formatSeconds(900), '15m');
  assert.equal(formatSeconds(42), '42s');
  assert.equal(formatSeconds(0), '0s');
  assert.equal(formatSeconds(null), '0s');
  assert.equal(formatSeconds(-5), '0s');
});

test('retentionCutoffDate walks back whole office days', () => {
  assert.equal(retentionCutoffDate(90, new Date('2026-09-20T06:00:00Z')), '2026-06-22');
  assert.equal(retentionCutoffDate(30, new Date('2026-09-20T06:00:00Z')), '2026-08-21');
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * Policy inheritance (§35)
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

const policy = (id, scopeKind, scopeId, settings) => ({
  id,
  scopeKind,
  scopeId,
  scopeLabel: id,
  enabled: true,
  settings,
});

test('defaults are cautious: the access gate is off and nothing extra is captured', () => {
  assert.equal(DEFAULT_AGENT_POLICY.requireMorningLogin, false);
  assert.equal(DEFAULT_AGENT_POLICY.windowTitleTrackingEnabled, false);
  assert.equal(DEFAULT_AGENT_POLICY.browserDomainTrackingEnabled, false);
  assert.equal(DEFAULT_AGENT_POLICY.idleThresholdSeconds, 300);
  assert.equal(DEFAULT_AGENT_POLICY.extendedIdleThresholdSeconds, 900);
});

test('a narrower policy overrides one setting and inherits the rest — the §35 trap', () => {
  const resolved = resolveAgentPolicy(
    [
      policy('company', 'COMPANY', null, {
        requireMorningLogin: true,
        applicationTrackingEnabled: true,
        heartbeatIntervalSeconds: 120,
        offlineGraceMinutes: 480,
      }),
      // A department administrator adjusts one threshold. Everything else must survive.
      policy('dept-hr', 'DEPARTMENT', 'dept-hr', { idleThresholdSeconds: 600 }),
    ],
    { userId: 'u1', deviceId: 'pc-1', departmentIds: ['dept-hr'] },
  );

  assert.equal(resolved.settings.idleThresholdSeconds, 600);
  assert.equal(resolved.settings.requireMorningLogin, true, 'company setting must survive');
  assert.equal(resolved.settings.applicationTrackingEnabled, true);
  assert.equal(resolved.settings.heartbeatIntervalSeconds, 120);
  assert.equal(resolved.settings.offlineGraceMinutes, 480);
  assert.equal(resolved.sources.idleThresholdSeconds, 'DEPARTMENT');
  assert.equal(resolved.sources.requireMorningLogin, 'COMPANY');
  assert.equal(resolved.sources.lateLoginGraceMinutes, 'DEFAULT');
  assert.deepEqual(resolved.appliedPolicyIds, ['company', 'dept-hr']);
});

test('device beats user beats department beats company', () => {
  const resolved = resolveAgentPolicy(
    [
      policy('c', 'COMPANY', null, { heartbeatIntervalSeconds: 60 }),
      policy('d', 'DEPARTMENT', 'dept-hr', { heartbeatIntervalSeconds: 90 }),
      policy('u', 'USER', 'u1', { heartbeatIntervalSeconds: 120 }),
      policy('v', 'DEVICE', 'pc-1', { heartbeatIntervalSeconds: 180 }),
    ],
    { userId: 'u1', deviceId: 'pc-1', departmentIds: ['dept-hr'] },
  );
  assert.equal(resolved.settings.heartbeatIntervalSeconds, 180);
  assert.equal(resolved.sources.heartbeatIntervalSeconds, 'DEVICE');
});

test('a disabled or inapplicable policy contributes nothing', () => {
  const resolved = resolveAgentPolicy(
    [
      { ...policy('off', 'COMPANY', null, { requireMorningLogin: true }), enabled: false },
      policy('other-dept', 'DEPARTMENT', 'dept-finance', { requireMorningLogin: true }),
      policy('other-user', 'USER', 'someone-else', { requireMorningLogin: true }),
    ],
    { userId: 'u1', deviceId: 'pc-1', departmentIds: ['dept-hr'] },
  );
  assert.equal(resolved.settings.requireMorningLogin, false);
  assert.deepEqual(resolved.appliedPolicyIds, []);
});

test('two department policies resolve in a stable order rather than whatever Firestore returned', () => {
  const policies = [
    policy('zzz', 'DEPARTMENT', 'dept-b', { idleThresholdSeconds: 600 }),
    policy('aaa', 'DEPARTMENT', 'dept-a', { idleThresholdSeconds: 900 }),
  ];
  const subject = { userId: 'u1', deviceId: 'pc-1', departmentIds: ['dept-a', 'dept-b'] };
  const first = resolveAgentPolicy(policies, subject);
  const second = resolveAgentPolicy([...policies].reverse(), subject);
  assert.equal(first.settings.idleThresholdSeconds, second.settings.idleThresholdSeconds);
  assert.equal(first.settings.idleThresholdSeconds, 600); // 'zzz' sorts last, so it wins
});

test('sanitizePolicySettings drops nonsense so it falls through instead of resetting', () => {
  const clean = sanitizePolicySettings({
    idleThresholdSeconds: 'ten minutes',
    heartbeatIntervalSeconds: 5, // below the floor
    extendedIdleThresholdSeconds: 1200,
    requireMorningLogin: 'yes', // not a boolean
    notificationMode: 'SHOUT',
    workdayStart: '9am',
    workdayEnd: '18:30',
    unknownKey: 1,
  });
  assert.equal(clean.idleThresholdSeconds, undefined);
  assert.equal(clean.heartbeatIntervalSeconds, 30); // clamped, not dropped — it was a number
  assert.equal(clean.extendedIdleThresholdSeconds, 1200);
  assert.equal(clean.requireMorningLogin, undefined);
  assert.equal(clean.notificationMode, undefined);
  assert.equal(clean.workdayStart, undefined);
  assert.equal(clean.workdayEnd, '18:30');
  assert.equal('unknownKey' in clean, false);
});

test('the resolver repairs an extended-idle threshold that inheritance pushed below idle', () => {
  const resolved = resolveAgentPolicy(
    [
      policy('c', 'COMPANY', null, { extendedIdleThresholdSeconds: 900 }),
      policy('d', 'DEPARTMENT', 'dept-hr', { idleThresholdSeconds: 1800 }),
    ],
    { userId: 'u1', deviceId: 'pc-1', departmentIds: ['dept-hr'] },
  );
  assert.ok(resolved.settings.extendedIdleThresholdSeconds > resolved.settings.idleThresholdSeconds);
});

test('turning application tracking off turns off everything that depends on it', () => {
  const resolved = resolveAgentPolicy(
    [
      policy('c', 'COMPANY', null, {
        applicationTrackingEnabled: false,
        windowTitleTrackingEnabled: true,
        browserDomainTrackingEnabled: true,
      }),
    ],
    { userId: 'u1', deviceId: 'pc-1', departmentIds: [] },
  );
  assert.equal(resolved.settings.windowTitleTrackingEnabled, false);
  assert.equal(resolved.settings.browserDomainTrackingEnabled, false);
});

test('every policy key is resolvable and defaulted', () => {
  const resolved = defaultResolvedPolicy();
  for (const key of AGENT_POLICY_KEYS) {
    assert.notEqual(resolved.settings[key], undefined, `${key} has no default`);
    assert.equal(resolved.sources[key], 'DEFAULT');
  }
  assert.deepEqual(thresholdsOf(resolved), {
    idleThresholdSeconds: DEFAULT_AGENT_POLICY.idleThresholdSeconds,
    extendedIdleThresholdSeconds: DEFAULT_AGENT_POLICY.extendedIdleThresholdSeconds,
  });
});

test('policyApplies matches a device through either its own or its user’s department', () => {
  const p = policy('d', 'DEPARTMENT', 'dept-hr', {});
  assert.equal(policyApplies(p, { userId: 'u1', deviceId: 'pc-1', departmentIds: ['dept-hr'] }), true);
  assert.equal(policyApplies(p, { userId: 'u1', deviceId: 'pc-1', departmentIds: ['dept-fin'] }), false);
  assert.equal(policyApplies(policy('c', 'COMPANY', null, {}), { userId: null, deviceId: null, departmentIds: [] }), true);
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * Permissions (§36, §37)
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

const viewer = (permissions, overrides = {}) => ({
  userId: 'u1',
  userName: 'Viewer',
  permissions,
  departmentIds: ['dept-hr'],
  teamUserIds: [],
  selfViewEnabled: true,
  ...overrides,
});

test('the live board is never implied by another grant', () => {
  const reportsOnly = viewer({ 'Windows Agent.Reports': ['View', 'Export'] });
  assert.equal(canOpenWindowsAgent(reportsOnly), true);
  assert.equal(canViewLiveBoard(reportsOnly), false);
  assert.equal(canViewLiveBoard(viewer({ 'Windows Agent.Live Users': ['View'] })), true);
});

test('broadcasting to everybody is separate from being able to send at all', () => {
  const sender = viewer({ 'Windows Agent.Notifications': ['View', 'Send'] });
  assert.equal(canBroadcastNotifications(sender), false);
  assert.equal(canBroadcastNotifications(viewer({ 'Windows Agent.Notifications': ['Send', 'Send Broadcast'] })), true);
});

test('an employee can see their own record without anybody granting them anything', () => {
  assert.equal(canViewOwnActivity(viewer({})), true);
  // …unless the organisation has switched self-view off.
  assert.equal(canViewOwnActivity(viewer({}, { selfViewEnabled: false })), false);
  // A grant still works when it is off.
  assert.equal(canViewOwnActivity(viewer({ 'Windows Agent.Activity': ['View Own'] }, { selfViewEnabled: false })), true);
});

test('activity scope widens in the documented order', () => {
  assert.deepEqual(resolveActivityScope(viewer({ 'Windows Agent.Activity': ['View All'] })), { kind: 'ALL' });
  assert.equal(resolveActivityScope(viewer({ 'Windows Agent.Activity': ['View Department'] })).kind, 'DEPARTMENT');
  assert.equal(resolveActivityScope(viewer({ 'Windows Agent.Activity': ['View Team'] })).kind, 'TEAM');
  assert.equal(resolveActivityScope(viewer({})).kind, 'SELF');
  assert.deepEqual(resolveActivityScope(viewer({}, { selfViewEnabled: false })), { kind: 'NONE' });
});

test('a manager holding View Team is inside their own team’s picture', () => {
  const scope = resolveActivityScope(viewer({ 'Windows Agent.Activity': ['View Team'] }, { teamUserIds: ['u2', 'u3'] }));
  assert.equal(scope.kind, 'TEAM');
  assert.deepEqual(scope.userIds.sort(), ['u1', 'u2', 'u3']);
});

test('a department manager cannot see another department', () => {
  const manager = viewer({ 'Windows Agent.Activity': ['View Department'] });
  assert.equal(canViewActivityOf(manager, { userId: 'u2', departmentId: 'dept-hr' }), true);
  assert.equal(canViewActivityOf(manager, { userId: 'u9', departmentId: 'dept-fin' }), false);
  // Always themselves, even if their own department record is missing.
  assert.equal(canViewActivityOf(manager, { userId: 'u1', departmentId: null }), true);
});

test('filterVisibleSubjects narrows a list the same way the query would', () => {
  const manager = viewer({ 'Windows Agent.Activity': ['View Department'] });
  const subjects = [
    { userId: 'u2', departmentId: 'dept-hr' },
    { userId: 'u9', departmentId: 'dept-fin' },
    { userId: 'u1', departmentId: 'dept-hr' },
  ];
  assert.deepEqual(
    filterVisibleSubjects(manager, subjects).map((entry) => entry.userId).sort(),
    ['u1', 'u2'],
  );
  assert.deepEqual(filterVisibleSubjects(viewer({}, { selfViewEnabled: false }), subjects), []);
  assert.equal(filterVisibleSubjects(viewer({ 'Windows Agent.Activity': ['View All'] }), subjects).length, 3);
});

test('MAX_SPAN_SECONDS is a bound the ingest path actually enforces', () => {
  assert.equal(MAX_SPAN_SECONDS, 12 * 60 * 60);
});

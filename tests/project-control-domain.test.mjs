import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canActivateContract,
  canAddContractVersion,
  canDeleteContractVersion,
  computeContractCompletion,
  computeContractGrowth,
  nextContractVersionNumber,
  originalContractValue,
  resolveContractTermsAsOf,
  resolveContractVersionAsOf,
  revisedContractValue,
  sortContractVersions,
  validateContractVersion,
  wholeDaysBetween,
} from '../src/lib/project-control-contract.ts';
import {
  accountMatchesBoqItem,
  assignBoqItemsToControlAccounts,
  controlAccountDepth,
  describeMatchRule,
  descendantAccountIds,
  isAssignmentComplete,
  readBoqDimension,
  ruleMatchesBoqItem,
  sortControlAccounts,
  validateControlAccount,
  validateControlAccounts,
} from '../src/lib/project-control-wbs.ts';

/* ── Contract fixtures ──────────────────────────────────────────────────────────────────────── */

const terms = (overrides = {}) => ({
  contractValue: 229700000,
  gstPct: 18,
  zeroDate: '2026-04-01',
  contractCompletionDate: '2026-10-30',
  retentionPct: 5,
  mobilisationAdvancePct: 10,
  advanceRecoveryPct: 10,
  ldPctPerWeek: 0.5,
  ldCapPct: 10,
  performanceBgPct: 10,
  interestRatePct: 12,
  labourCessPct: 1,
  ...overrides,
});

const version = (overrides = {}) => ({
  id: overrides.id ?? 'v0',
  globalProjectId: 'proj-1',
  version: 0,
  label: 'Contract V0',
  effectiveFrom: '2026-04-01',
  sourceType: 'Original',
  terms: terms(),
  ...overrides,
});

/** The Lapanga-shaped history: original, then an amendment lifting value, then an EOT. */
const contractHistory = () => [
  version({ id: 'v0', version: 0, label: 'Contract V0', effectiveFrom: '2026-04-01' }),
  version({
    id: 'v1',
    version: 1,
    label: 'Amendment 01',
    effectiveFrom: '2026-07-01',
    sourceType: 'Amendment',
    terms: terms({ contractValue: 234000000 }),
    approvedVia: 'ea-101',
  }),
  version({
    id: 'v2',
    version: 2,
    label: 'EOT 01',
    effectiveFrom: '2026-09-15',
    sourceType: 'EOT',
    terms: terms({ contractValue: 234000000, contractCompletionDate: '2026-11-20' }),
    approvedVia: 'ea-102',
  }),
];

/* ── Contract: resolving terms as of a date ─────────────────────────────────────────────────── */

test('terms resolve to the version in force on the date, not the latest one entered', () => {
  const history = contractHistory();

  // A bill dated in June must price against V0 even though two later versions exist.
  assert.equal(resolveContractVersionAsOf(history, '2026-06-30').label, 'Contract V0');
  assert.equal(resolveContractTermsAsOf(history, '2026-06-30').contractValue, 229700000);

  assert.equal(resolveContractVersionAsOf(history, '2026-07-15').label, 'Amendment 01');
  assert.equal(resolveContractTermsAsOf(history, '2026-07-15').contractValue, 234000000);

  assert.equal(resolveContractVersionAsOf(history, '2026-12-01').label, 'EOT 01');
});

test('a version effective on the date itself already applies', () => {
  const history = contractHistory();
  assert.equal(resolveContractVersionAsOf(history, '2026-07-01').label, 'Amendment 01');
});

test('terms are null before the contract starts rather than a zeroed default', () => {
  // Computing a bill against silently-zeroed terms is the failure the module exists to prevent,
  // so callers must handle absence explicitly.
  assert.equal(resolveContractTermsAsOf(contractHistory(), '2026-03-31'), null);
  assert.equal(resolveContractVersionAsOf(contractHistory(), '2026-03-31'), null);
  assert.equal(resolveContractTermsAsOf([], '2026-06-01'), null);
});

test('a future-dated amendment does not affect todays terms', () => {
  const history = [
    version({ id: 'v0' }),
    version({
      id: 'v1',
      version: 1,
      label: 'Amendment 01',
      effectiveFrom: '2026-12-01',
      sourceType: 'Amendment',
      terms: terms({ contractValue: 300000000 }),
    }),
  ];
  assert.equal(revisedContractValue(history, '2026-08-01'), 229700000);
  assert.equal(revisedContractValue(history, '2026-12-01'), 300000000);
});

test('two versions effective the same day resolve to the higher version number', () => {
  const history = [
    version({ id: 'v1', version: 1, label: 'Amendment 01', effectiveFrom: '2026-07-01', sourceType: 'Amendment' }),
    version({
      id: 'v2',
      version: 2,
      label: 'Amendment 02',
      effectiveFrom: '2026-07-01',
      sourceType: 'Amendment',
      terms: terms({ contractValue: 240000000 }),
    }),
  ];
  assert.equal(resolveContractVersionAsOf(history, '2026-07-01').label, 'Amendment 02');
});

test('sorting is by effective date then version, regardless of stored order', () => {
  const [v0, v1, v2] = contractHistory();
  const sorted = sortControlOrder([v2, v0, v1]);
  assert.deepEqual(sorted, ['Contract V0', 'Amendment 01', 'EOT 01']);
});

function sortControlOrder(versions) {
  return sortContractVersions(versions).map((item) => item.label);
}

/* ── Contract: growth and completion ────────────────────────────────────────────────────────── */

test('contract growth measures the revised value against the original, not the previous one', () => {
  const growth = computeContractGrowth(contractHistory(), '2026-12-01');
  assert.equal(growth.originalValue, 229700000);
  assert.equal(growth.revisedValue, 234000000);
  assert.equal(growth.varianceValue, 4300000);
  assert.equal(growth.variancePct, 1.9);
});

test('contract growth is zero-safe and reports descoping as negative', () => {
  assert.equal(computeContractGrowth([], '2026-06-01').variancePct, 0);
  const descoped = computeContractGrowth(
    [
      version({ id: 'v0' }),
      version({
        id: 'v1',
        version: 1,
        label: 'Amendment 01',
        effectiveFrom: '2026-07-01',
        sourceType: 'Amendment',
        terms: terms({ contractValue: 200000000 }),
      }),
    ],
    '2026-08-01',
  );
  assert.ok(descoped.varianceValue < 0, 'descoping must report a negative variance');
});

test('original value falls back to the earliest version when no Original is recorded', () => {
  // A mapping set up mid-project has no Original row; measuring growth from zero would report
  // every such project as infinitely grown.
  const history = [
    version({ id: 'v1', version: 1, label: 'Amendment 01', effectiveFrom: '2026-07-01', sourceType: 'Amendment' }),
  ];
  assert.equal(originalContractValue(history), 229700000);
});

test('completion tracks the contractual date and the days it has been extended', () => {
  const completion = computeContractCompletion(contractHistory(), '2026-12-01');
  assert.equal(completion.originalDate, '2026-10-30');
  assert.equal(completion.currentDate, '2026-11-20');
  assert.equal(completion.extendedByDays, 21);
});

test('completion reports no extension before the EOT takes effect', () => {
  const completion = computeContractCompletion(contractHistory(), '2026-08-01');
  assert.equal(completion.currentDate, '2026-10-30');
  assert.equal(completion.extendedByDays, 0);
});

test('whole days between dates is signed and tolerant of unparsable input', () => {
  assert.equal(wholeDaysBetween('2026-10-30', '2026-11-20'), 21);
  assert.equal(wholeDaysBetween('2026-11-20', '2026-10-30'), -21);
  assert.equal(wholeDaysBetween('', '2026-11-20'), 0);
  assert.equal(wholeDaysBetween('not-a-date', '2026-11-20'), 0);
});

/* ── Contract: validation ───────────────────────────────────────────────────────────────────── */

test('contract validation requires a label, an effective date and a positive value', () => {
  const errors = validateContractVersion({
    globalProjectId: 'proj-1',
    version: 0,
    label: '  ',
    effectiveFrom: '',
    sourceType: 'Original',
    terms: terms({ contractValue: 0 }),
  });
  const fields = errors.map((error) => error.field);
  assert.ok(fields.includes('label'));
  assert.ok(fields.includes('effectiveFrom'));
  assert.ok(fields.includes('contractValue'));
});

test('percentages outside 0-100 are rejected', () => {
  const errors = validateContractVersion({
    globalProjectId: 'proj-1',
    version: 0,
    label: 'Contract V0',
    effectiveFrom: '2026-04-01',
    sourceType: 'Original',
    terms: terms({ retentionPct: 120, ldCapPct: -1 }),
  });
  const fields = errors.map((error) => error.field);
  assert.ok(fields.includes('retentionPct'));
  assert.ok(fields.includes('ldCapPct'));
});

test('an advance with no recovery rate is rejected as money never recovered', () => {
  const errors = validateContractVersion({
    globalProjectId: 'proj-1',
    version: 0,
    label: 'Contract V0',
    effectiveFrom: '2026-04-01',
    sourceType: 'Original',
    terms: terms({ mobilisationAdvancePct: 10, advanceRecoveryPct: 0 }),
  });
  assert.ok(errors.some((error) => error.field === 'advanceRecoveryPct'));
});

test('completion before the zero date is rejected', () => {
  const errors = validateContractVersion({
    globalProjectId: 'proj-1',
    version: 0,
    label: 'Contract V0',
    effectiveFrom: '2026-04-01',
    sourceType: 'Original',
    terms: terms({ zeroDate: '2026-04-01', contractCompletionDate: '2026-03-01' }),
  });
  assert.ok(errors.some((error) => error.field === 'contractCompletionDate'));
});

test('a valid contract passes both the save and the activation bar', () => {
  const draft = {
    globalProjectId: 'proj-1',
    version: 0,
    label: 'Contract V0',
    effectiveFrom: '2026-04-01',
    sourceType: 'Original',
    terms: terms(),
  };
  assert.deepEqual(validateContractVersion(draft), []);
  assert.deepEqual(canActivateContract(draft), []);
});

test('activation demands the deduction terms a bill will need, save does not', () => {
  // A blank retention percentage is indistinguishable from a genuine zero by the time it reaches
  // a bill, so it has to be stated explicitly before terms price anything.
  const draft = {
    globalProjectId: 'proj-1',
    version: 0,
    label: 'Contract V0',
    effectiveFrom: '2026-04-01',
    sourceType: 'Original',
    terms: { contractValue: 229700000 },
  };
  assert.deepEqual(validateContractVersion(draft), []);
  const fields = canActivateContract(draft).map((error) => error.field);
  assert.ok(fields.includes('zeroDate'));
  assert.ok(fields.includes('contractCompletionDate'));
  assert.ok(fields.includes('retentionPct'));
});

test('retention explicitly set to zero satisfies activation', () => {
  const draft = {
    globalProjectId: 'proj-1',
    version: 0,
    label: 'Contract V0',
    effectiveFrom: '2026-04-01',
    sourceType: 'Original',
    terms: terms({ retentionPct: 0 }),
  };
  assert.deepEqual(canActivateContract(draft), []);
});

/* ── Contract: adding and removing versions ─────────────────────────────────────────────────── */

test('a version cannot be backdated behind one already in force', () => {
  const history = contractHistory();
  const blocked = canAddContractVersion(history, '2026-08-01');
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /EOT 01 is already effective/);

  assert.equal(canAddContractVersion(history, '2026-09-15').ok, true);
  assert.equal(canAddContractVersion(history, '2026-10-01').ok, true);
  assert.equal(canAddContractVersion([], '2026-04-01').ok, true);
  assert.equal(canAddContractVersion(history, '').ok, false);
});

test('version numbers come from the highest so far, so a deleted draft cannot reuse one', () => {
  assert.equal(nextContractVersionNumber([]), 0);
  assert.equal(nextContractVersionNumber(contractHistory()), 3);
  // v1 deleted: the next version is still 3, not 2.
  const gapped = contractHistory().filter((item) => item.version !== 1);
  assert.equal(nextContractVersionNumber(gapped), 3);
});

test('the original contract version can never be deleted', () => {
  const [v0, v1] = contractHistory();
  assert.equal(canDeleteContractVersion(v0), false);
  assert.equal(canDeleteContractVersion(v1), true);
});

/* ── WBS fixtures ───────────────────────────────────────────────────────────────────────────── */

const account = (overrides = {}) => ({
  id: overrides.id ?? 'a1',
  code: 'WBS-01',
  name: 'Supply',
  order: 1,
  matchRules: [{ scope2: 'Supply' }],
  ...overrides,
});

const boq = (id, fields = {}) => ({ id, Unit: 'Nos', QTY: 10, ...fields });

/* ── WBS: reading dimensions off a dynamic BOQ item ─────────────────────────────────────────── */

test('dimensions are read from the reserved key first', () => {
  assert.equal(readBoqDimension({ scope2: 'Civil' }, 'scope2'), 'Civil');
  assert.equal(readBoqDimension({ category1: ' Foundation ' }, 'category1'), 'Foundation');
});

test('dimensions fall back to the legacy header spellings', () => {
  // BOQ items are dynamic-column documents, so the same dimension arrives under several headers
  // depending on which spreadsheet the project was imported from.
  assert.equal(readBoqDimension({ 'Scope 2': 'Civil' }, 'scope2'), 'Civil');
  assert.equal(readBoqDimension({ 'Scope.2': 'Civil' }, 'scope2'), 'Civil');
  assert.equal(readBoqDimension({ SCOPE2: 'Civil' }, 'scope2'), 'Civil');
  assert.equal(readBoqDimension({ 'Category 1': 'Tower' }, 'category1'), 'Tower');
});

test('a missing or non-string dimension reads as empty rather than throwing', () => {
  assert.equal(readBoqDimension({}, 'scope1'), '');
  assert.equal(readBoqDimension(null, 'scope1'), '');
  assert.equal(readBoqDimension({ scope1: 42 }, 'scope1'), '');
});

/* ── WBS: rule matching ─────────────────────────────────────────────────────────────────────── */

test('a rule matches only when every dimension it names matches', () => {
  const item = boq('b1', { scope1: 'EPC', scope2: 'Civil', category1: 'Foundation' });
  assert.equal(ruleMatchesBoqItem({ scope2: 'Civil' }, item), true);
  assert.equal(ruleMatchesBoqItem({ scope2: 'Civil', category1: 'Foundation' }, item), true);
  assert.equal(ruleMatchesBoqItem({ scope2: 'Civil', category1: 'Erection' }, item), false);
});

test('rule matching is case-insensitive and trims', () => {
  const item = boq('b1', { scope2: 'Civil' });
  assert.equal(ruleMatchesBoqItem({ scope2: '  civil ' }, item), true);
  assert.equal(ruleMatchesBoqItem({ scope2: 'CIVIL' }, item), true);
});

test('an empty rule matches nothing rather than everything', () => {
  // A blank rule acting as a catch-all would silently absorb every line the other accounts
  // missed, hiding the unassigned-lines exception this module reports.
  const item = boq('b1', { scope2: 'Civil' });
  assert.equal(ruleMatchesBoqItem({}, item), false);
  assert.equal(ruleMatchesBoqItem({ scope2: '   ' }, item), false);
  assert.equal(accountMatchesBoqItem({ matchRules: [] }, item), false);
});

test('an account matches when any of its rules matches', () => {
  const acc = { matchRules: [{ scope2: 'Civil' }, { scope2: 'Erection' }] };
  assert.equal(accountMatchesBoqItem(acc, boq('b1', { scope2: 'Erection' })), true);
  assert.equal(accountMatchesBoqItem(acc, boq('b2', { scope2: 'Supply' })), false);
});

/* ── WBS: assignment ────────────────────────────────────────────────────────────────────────── */

test('every non-header BOQ line lands in exactly one account', () => {
  const accounts = [
    account({ id: 'sup', code: 'WBS-01', name: 'Supply', matchRules: [{ scope2: 'Supply' }] }),
    account({ id: 'civ', code: 'WBS-02', name: 'Civil', order: 2, matchRules: [{ scope2: 'Civil' }] }),
  ];
  const items = [
    boq('b1', { scope2: 'Supply' }),
    boq('b2', { scope2: 'Supply' }),
    boq('b3', { scope2: 'Civil' }),
  ];

  const assignment = assignBoqItemsToControlAccounts(items, accounts);
  assert.deepEqual(assignment.byAccount.get('sup'), ['b1', 'b2']);
  assert.deepEqual(assignment.byAccount.get('civ'), ['b3']);
  assert.equal(assignment.accountOfBoqItem.get('b3'), 'civ');
  assert.deepEqual(assignment.unassigned, []);
  assert.deepEqual(assignment.conflicts, []);
  assert.equal(isAssignmentComplete(assignment), true);
});

test('section headers are skipped, not counted as unassigned', () => {
  // A header carries no unit and no quantity, so it is not work and must not appear as a gap.
  const items = [
    { id: 'h1', Description: 'CIVIL WORKS', Unit: '', QTY: '' },
    boq('b1', { scope2: 'Civil' }),
  ];
  const assignment = assignBoqItemsToControlAccounts(items, [
    account({ id: 'civ', matchRules: [{ scope2: 'Civil' }] }),
  ]);
  assert.equal(assignment.skippedHeaderCount, 1);
  assert.deepEqual(assignment.unassigned, []);
  assert.equal(isAssignmentComplete(assignment), true);
});

test('a line matching no account is reported as unassigned', () => {
  const assignment = assignBoqItemsToControlAccounts(
    [boq('b1', { scope2: 'Supply' }), boq('b2', { scope2: 'Testing' })],
    [account({ id: 'sup', matchRules: [{ scope2: 'Supply' }] })],
  );
  assert.deepEqual(assignment.unassigned, ['b2']);
  assert.equal(isAssignmentComplete(assignment), false);
});

test('a line matching two accounts is excluded from both and reported as a conflict', () => {
  // Picking one would make the project total right by luck while filing the line under an account
  // nobody chose, and the exception would never surface.
  const accounts = [
    account({ id: 'a', code: 'WBS-01', matchRules: [{ scope2: 'Civil' }] }),
    account({ id: 'b', code: 'WBS-02', order: 2, matchRules: [{ category1: 'Foundation' }] }),
  ];
  const assignment = assignBoqItemsToControlAccounts(
    [boq('b1', { scope2: 'Civil', category1: 'Foundation' })],
    accounts,
  );
  assert.deepEqual(assignment.byAccount.get('a'), []);
  assert.deepEqual(assignment.byAccount.get('b'), []);
  assert.equal(assignment.accountOfBoqItem.has('b1'), false);
  assert.deepEqual(assignment.conflicts, [{ boqItemId: 'b1', accountIds: ['a', 'b'] }]);
  assert.equal(isAssignmentComplete(assignment), false);
});

test('explicit include beats the rules, explicit exclude beats everything', () => {
  const accounts = [
    account({
      id: 'sup',
      code: 'WBS-01',
      matchRules: [{ scope2: 'Supply' }],
      explicitIncludeBoqItemIds: ['odd'],
      explicitExcludeBoqItemIds: ['b2'],
    }),
  ];
  const items = [
    boq('b1', { scope2: 'Supply' }),
    boq('b2', { scope2: 'Supply' }),
    boq('odd', { scope2: 'Testing' }),
  ];
  const assignment = assignBoqItemsToControlAccounts(items, accounts);
  assert.deepEqual(assignment.byAccount.get('sup'), ['b1', 'odd']);
  assert.deepEqual(assignment.unassigned, ['b2']);
});

test('a line excluded by one account still lands in another that wants it', () => {
  const accounts = [
    account({ id: 'a', code: 'WBS-01', matchRules: [{ scope2: 'Civil' }], explicitExcludeBoqItemIds: ['b1'] }),
    account({ id: 'b', code: 'WBS-02', order: 2, matchRules: [{ scope2: 'Civil' }] }),
  ];
  const assignment = assignBoqItemsToControlAccounts([boq('b1', { scope2: 'Civil' })], accounts);
  assert.deepEqual(assignment.byAccount.get('b'), ['b1']);
  assert.deepEqual(assignment.conflicts, []);
});

test('a BOQ line with no id is skipped rather than assigned to a blank key', () => {
  const assignment = assignBoqItemsToControlAccounts(
    [{ id: '', Unit: 'Nos', QTY: 5, scope2: 'Civil' }],
    [account({ id: 'civ', matchRules: [{ scope2: 'Civil' }] })],
  );
  assert.deepEqual(assignment.byAccount.get('civ'), []);
  assert.deepEqual(assignment.unassigned, []);
});

/* ── WBS: hierarchy ─────────────────────────────────────────────────────────────────────────── */

test('accounts sort parents before children and siblings by order', () => {
  const accounts = [
    account({ id: 'c2', code: 'WBS-01-B', name: 'Erection', parentId: 'p1', order: 2 }),
    account({ id: 'p2', code: 'WBS-02', name: 'Supply', order: 2 }),
    account({ id: 'c1', code: 'WBS-01-A', name: 'Foundation', parentId: 'p1', order: 1 }),
    account({ id: 'p1', code: 'WBS-01', name: 'Civil', order: 1 }),
  ];
  assert.deepEqual(
    sortControlAccounts(accounts).map((item) => item.id),
    ['p1', 'c1', 'c2', 'p2'],
  );
});

test('accounts orphaned or cyclic are appended rather than dropped from the register', () => {
  const accounts = [
    account({ id: 'root', code: 'WBS-01', order: 1 }),
    account({ id: 'orphan', code: 'WBS-09', parentId: 'gone', order: 9 }),
  ];
  const sorted = sortControlAccounts(accounts).map((item) => item.id);
  assert.equal(sorted.length, 2, 'a broken hierarchy must still show every account');
  assert.ok(sorted.includes('orphan'));
});

test('depth counts ancestors and returns -1 inside a cycle', () => {
  const accounts = [
    account({ id: 'p', code: 'WBS-01' }),
    account({ id: 'c', code: 'WBS-01-A', parentId: 'p' }),
    account({ id: 'g', code: 'WBS-01-A-1', parentId: 'c' }),
  ];
  assert.equal(controlAccountDepth(accounts, 'p'), 0);
  assert.equal(controlAccountDepth(accounts, 'c'), 1);
  assert.equal(controlAccountDepth(accounts, 'g'), 2);

  const cyclic = [
    account({ id: 'x', code: 'WBS-X', parentId: 'y' }),
    account({ id: 'y', code: 'WBS-Y', parentId: 'x' }),
  ];
  assert.equal(controlAccountDepth(cyclic, 'x'), -1);
});

test('descendants collect the whole subtree and survive a cycle', () => {
  const accounts = [
    account({ id: 'p', code: 'WBS-01' }),
    account({ id: 'c1', code: 'WBS-01-A', parentId: 'p' }),
    account({ id: 'c2', code: 'WBS-01-B', parentId: 'p' }),
    account({ id: 'g', code: 'WBS-01-A-1', parentId: 'c1' }),
  ];
  assert.deepEqual(descendantAccountIds(accounts, 'p').sort(), ['c1', 'c2', 'g']);
  assert.deepEqual(descendantAccountIds(accounts, 'g'), []);

  const cyclic = [
    account({ id: 'x', code: 'WBS-X', parentId: 'y' }),
    account({ id: 'y', code: 'WBS-Y', parentId: 'x' }),
  ];
  assert.deepEqual(descendantAccountIds(cyclic, 'x').sort(), ['x', 'y']);
});

/* ── WBS: validation ────────────────────────────────────────────────────────────────────────── */

test('an account needs a code, a name, and something to collect', () => {
  const errors = validateControlAccount({ code: '', name: '', order: 1, matchRules: [] });
  const fields = errors.map((error) => error.field);
  assert.ok(fields.includes('code'));
  assert.ok(fields.includes('name'));
  assert.ok(fields.includes('matchRules'));
});

test('an account with only explicit BOQ lines and no rules is valid', () => {
  assert.deepEqual(
    validateControlAccount({
      code: 'WBS-99',
      name: 'Odds and ends',
      order: 99,
      matchRules: [],
      explicitIncludeBoqItemIds: ['b1'],
    }),
    [],
  );
});

test('codes are format-checked and rejected when already in use', () => {
  assert.ok(
    validateControlAccount(
      { code: 'WBS 01!', name: 'Civil', order: 1, matchRules: [{ scope2: 'Civil' }] },
      [],
    ).some((error) => error.field === 'code'),
  );
  assert.ok(
    validateControlAccount(
      { code: 'wbs-01', name: 'Civil', order: 1, matchRules: [{ scope2: 'Civil' }] },
      ['WBS-01'],
    ).some((error) => error.field === 'code'),
  );
});

test('whole-set validation catches duplicate codes, missing parents and cycles', () => {
  const errors = validateControlAccounts([
    account({ id: 'a', code: 'WBS-01', name: 'Civil' }),
    account({ id: 'b', code: 'WBS-01', name: 'Supply' }),
    account({ id: 'c', code: 'WBS-03', name: 'Orphan', parentId: 'nope' }),
    account({ id: 'd', code: 'WBS-04', name: 'Self', parentId: 'd' }),
  ]);
  const messages = errors.map((error) => error.message).join(' | ');
  assert.match(messages, /used by more than one account/);
  assert.match(messages, /parent that no longer exists/);
  assert.match(messages, /cannot be its own parent/);
});

test('a clean account set validates with no errors', () => {
  assert.deepEqual(
    validateControlAccounts([
      account({ id: 'p', code: 'WBS-01', name: 'Civil' }),
      account({ id: 'c', code: 'WBS-01-A', name: 'Foundation', parentId: 'p', order: 1 }),
    ]),
    [],
  );
});

test('a rule describes itself in the language of the BOQ columns', () => {
  assert.equal(describeMatchRule({ scope2: 'Civil' }), 'Scope 2 = Civil');
  assert.equal(
    describeMatchRule({ scope2: 'Civil', category1: 'Foundation' }),
    'Scope 2 = Civil and Category 1 = Foundation',
  );
  assert.match(describeMatchRule({}), /matches nothing/);
});

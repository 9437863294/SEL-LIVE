import assert from 'node:assert/strict';
import test from 'node:test';

const register = await import('../src/lib/project-management-dpr-register.ts');
const { dprSectionOf, groupDprRegisterSections, dprRegisterShows, dprFurthestAlong } = register;

test('a section is the first segment of the SL No', () => {
  assert.equal(dprSectionOf('2.1.3'), '2');
  assert.equal(dprSectionOf(' 10 '), '10');
  assert.equal(dprSectionOf('7.4....'), '7');
  assert.equal(dprSectionOf(''), '—');
});

test('rows group by section in first-seen order, keeping their own order', () => {
  const rows = [{ sl: '1.1' }, { sl: '1.2' }, { sl: '2.1' }, { sl: '1.3' }, { sl: '3' }];
  const groups = groupDprRegisterSections(rows, (row) => dprSectionOf(row.sl));
  assert.deepEqual(
    groups.map((group) => [group.key, group.rows.map((row) => row.sl)]),
    [
      ['1', ['1.1', '1.2', '1.3']],
      ['2', ['2.1']],
      ['3', ['3']],
    ],
  );
});

test('show choices decide on the line at the top of the branch', () => {
  const started = { broken: false, done: 1.2 };
  const untouched = { broken: true, done: 0 };
  assert.equal(dprRegisterShows('all', untouched), true);
  assert.equal(dprRegisterShows('progress', started), true);
  assert.equal(dprRegisterShows('progress', untouched), false);
  assert.equal(dprRegisterShows('notStarted', untouched), true);
  assert.equal(dprRegisterShows('notStarted', started), false);
  assert.equal(dprRegisterShows('broken', untouched), true);
  assert.equal(dprRegisterShows('whole', untouched), false);
});

test('furthest along is the largest share of a leaf’s own quantity', () => {
  const leaves = [
    { id: 'pcc', qty: 250, done: 1.2 },
    { id: 'rwh', qty: 60, done: 6 },
    { id: 'none', qty: 0, done: 5 },
    { id: 'idle', qty: 10, done: 0 },
  ];
  const best = dprFurthestAlong(leaves);
  assert.equal(best.id, 'rwh');
  assert.equal(Math.round(best.pct * 10) / 10, 10);
  assert.equal(dprFurthestAlong([{ id: 'a', qty: 5, done: 0 }]), null);
});

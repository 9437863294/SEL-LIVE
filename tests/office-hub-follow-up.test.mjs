import test from 'node:test';
import assert from 'node:assert/strict';

import {
  actionProgressByDecision,
  canBecomeTask,
  decisionFollowUp,
  followUpPresets,
  groupActionItemsByMeeting,
  groupDecisions,
  inActionTab,
  inDecisionTab,
  teamDepartments,
  teamTone,
  teamsInView,
} from '../src/lib/office-hub-follow-up.ts';

const today = '2026-11-07';
const context = { today, viewerId: 'me' };

test('decision tabs: open is open or in progress, overdue needs a passed follow-up on an open decision', () => {
  const d = (status, dueDate = null, ownerId = 'x') => ({ status, dueDate, ownerId });
  assert.equal(inDecisionTab(d('In Progress'), 'open', context), true);
  assert.equal(inDecisionTab(d('Completed'), 'open', context), false);
  assert.equal(inDecisionTab(d('Open', '2026-11-06'), 'overdue', context), true);
  assert.equal(inDecisionTab(d('Completed', '2026-11-06'), 'overdue', context), false, 'seen through is never late');
  assert.equal(inDecisionTab(d('Open', today), 'overdue', context), false, 'due today is not late yet');
  assert.equal(inDecisionTab(d('Completed', null, 'me'), 'mine', context), true);
});

test('decisions group by month, newest first, with overdue follow-ups pinned above', () => {
  const list = [
    { reference: 'DEC-1', decisionDate: '2026-10-12', status: 'Open', dueDate: '2026-10-31' },
    { reference: 'DEC-2', decisionDate: '2026-11-06', status: 'Open', dueDate: '2026-11-09' },
    { reference: 'DEC-3', decisionDate: '2026-10-22', status: 'In Progress', dueDate: '2026-11-12' },
    { reference: 'DEC-4', decisionDate: '2026-10-20', status: 'Open', dueDate: '2026-11-05' },
  ];
  const pinned = groupDecisions(list, today, { pinOverdue: true });
  assert.deepEqual(pinned.map((group) => group.label), ['Follow-up overdue', 'November 2026', 'October 2026']);
  assert.deepEqual(pinned[0].items.map((d) => d.reference), ['DEC-1', 'DEC-4'], 'oldest follow-up first');
  assert.deepEqual(pinned[2].items.map((d) => d.reference), ['DEC-3']);

  const plain = groupDecisions(list, today, { pinOverdue: false });
  assert.deepEqual(plain.map((group) => group.label), ['November 2026', 'October 2026']);
  assert.deepEqual(plain[1].items.map((d) => d.reference), ['DEC-3', 'DEC-4', 'DEC-1']);
});

test('follow-up line: late, today, seen through, none', () => {
  assert.deepEqual(decisionFollowUp({ status: 'Open', dueDate: '2026-11-04' }, today), {
    label: '3 days late',
    detail: 'Follow-up · Wed, 4 Nov',
    tone: 'late',
  });
  assert.equal(decisionFollowUp({ status: 'Open', dueDate: today }, today).tone, 'today');
  assert.deepEqual(decisionFollowUp({ status: 'Completed', dueDate: '2026-11-02', closedAt: '2026-11-03T09:00:00.000Z' }, today), {
    label: 'Seen through',
    detail: '3 Nov',
    tone: 'done',
  });
  assert.equal(decisionFollowUp({ status: 'Open', dueDate: null }, today).label, 'No follow-up');
});

test('action progress per decision ignores cancelled items', () => {
  const progress = actionProgressByDecision([
    { decisionId: 'a', status: 'Completed' },
    { decisionId: 'a', status: 'Open' },
    { decisionId: 'a', status: 'Cancelled' },
    { decisionId: null, status: 'Open' },
  ]);
  assert.deepEqual(progress.get('a'), { done: 1, total: 2 });
  assert.equal(progress.size, 1);
});

test('follow-up presets count from the decision date; end of month on the 31st means next month', () => {
  const presets = followUpPresets('2026-10-31');
  assert.deepEqual(
    presets.map((preset) => preset.date),
    ['2026-11-07', '2026-11-14', '2026-11-30', '2027-01-31', null],
  );
  assert.equal(followUpPresets('2026-11-07')[2].date, '2026-11-30');
});

test('action tabs and the untracked rule', () => {
  const a = (status, extra = {}) => ({ status, dueDate: null, responsibleUserId: 'x', ...extra });
  assert.equal(inActionTab(a('Open'), 'untracked', context), true);
  assert.equal(inActionTab(a('Open', { taskId: 't1' }), 'untracked', context), false);
  assert.equal(inActionTab(a('Completed'), 'untracked', context), false);
  assert.equal(inActionTab(a('Open', { dueDate: '2026-11-03' }), 'overdue', context), true);
  assert.equal(canBecomeTask(a('Open')), true);
  assert.equal(canBecomeTask(a('Open', { responsibleUserId: null })), false, 'nobody to give it to');
  assert.equal(canBecomeTask(a('Open', { responsibleUserId: null, responsibleTeamId: 'team' })), true);
  assert.equal(canBecomeTask(a('In Progress', { taskId: 't1' })), false);
});

test('action items group under their meeting, latest first, loose items last, unfinished first', () => {
  const groups = groupActionItemsByMeeting([
    { meetingId: 'm1', meetingTitle: 'Finance review', meetingDate: '2026-10-30', status: 'Completed', dueDate: '2026-11-01' },
    { meetingId: null, status: 'Open', dueDate: null },
    { meetingId: 'm2', meetingTitle: 'IT review', meetingDate: '2026-11-06', status: 'Open', dueDate: '2026-11-07' },
    { meetingId: 'm1', meetingTitle: 'Finance review', meetingDate: '2026-10-30', status: 'Open', dueDate: '2026-11-10' },
    { meetingId: 'm1', meetingTitle: 'Finance review', meetingDate: '2026-10-30', status: 'Open', dueDate: '2026-11-04' },
  ]);
  assert.deepEqual(groups.map((group) => group.title), ['IT review', 'Finance review', 'Not from a meeting']);
  assert.deepEqual(groups[1].items.map((item) => item.dueDate), ['2026-11-04', '2026-11-10', '2026-11-01']);
  assert.equal(groups[1].done, 1);
});

test('team views: member, lead, archived and search over member names', () => {
  const teams = [
    { name: 'Finance team', leaderId: 'a', leaderName: 'A', status: 'Active', memberUserIds: ['a', 'me'], members: [{ name: 'Aswini' }] },
    { name: 'IT team', leaderId: 'me', leaderName: 'Me', status: 'Active', memberUserIds: ['me'] },
    { name: 'Old group', leaderId: 'me', leaderName: 'Me', status: 'Archived', memberUserIds: ['me'] },
  ];
  const view = (name, extra = {}) => teamsInView(teams, name, { viewerId: 'me', showArchived: false, search: '', ...extra }).map((team) => team.name);
  assert.deepEqual(view('all'), ['Finance team', 'IT team']);
  assert.deepEqual(view('all', { showArchived: true }), ['Finance team', 'IT team', 'Old group']);
  assert.deepEqual(view('lead'), ['IT team']);
  assert.deepEqual(view('archived'), ['Old group']);
  assert.deepEqual(view('all', { search: 'aswini' }), ['Finance team']);
});

test('team departments are counted, and a tone is stable for its key', () => {
  assert.deepEqual(
    teamDepartments({ members: [{ departmentName: 'Finance' }, { departmentName: 'IT' }, { departmentName: 'Finance' }, { departmentName: null }] }),
    ['Finance', 'IT'],
  );
  assert.deepEqual(teamTone('finance'), teamTone('finance'));
});

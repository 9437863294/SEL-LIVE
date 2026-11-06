import test from 'node:test';
import assert from 'node:assert/strict';

import { dueGroupOf, dueQuickPicks, parseQuickTask, relativeDue, tagSuggestions } from '../src/lib/office-hub-task-register.ts';

const TODAY = '2026-11-06'; // Friday
const people = [
  { userId: 'u1', name: 'Asha Rao' },
  { userId: 'u2', name: 'Rajesh Nayak' },
  { userId: 'u3', name: 'Rajesh Kumar' },
  { userId: 'u4', name: 'R. Mohanty' },
];
const me = { userId: 'me', name: 'Me Myself' };

test('quick add: person, tags, priority, weekday; the rest is the title', () => {
  const parsed = parseQuickTask('Send RA-14 backup to OPTCL @asha fri !high #billing #Bank', { today: TODAY, people, defaultAssignee: me });
  assert.deepEqual(parsed, {
    title: 'Send RA-14 backup to OPTCL',
    assigneeId: 'u1',
    assigneeName: 'Asha Rao',
    unknownMention: null,
    dueDate: '2026-11-13',
    priority: 'High',
    tags: ['billing', 'bank'],
  });
});

test('quick add: an ambiguous or unknown @name is reported and left in the title, never guessed', () => {
  const ambiguous = parseQuickTask('Call vendor @rajesh tomorrow', { today: TODAY, people, defaultAssignee: me });
  assert.equal(ambiguous.assigneeId, 'me');
  assert.equal(ambiguous.unknownMention, 'rajesh');
  assert.equal(ambiguous.title, 'Call vendor @rajesh');
  assert.equal(ambiguous.dueDate, '2026-11-07');
  assert.equal(parseQuickTask('x @mohanty', { today: TODAY, people }).assigneeId, 'u4', 'last name works');
});

test('quick add: !urgent is Critical; an unknown !word stays; full weekday names; next week; today', () => {
  assert.equal(parseQuickTask('a !urgent', { today: TODAY, people }).priority, 'Critical');
  const odd = parseQuickTask('fix it !soon', { today: TODAY, people });
  assert.equal(odd.priority, 'Medium');
  assert.equal(odd.title, 'fix it !soon');
  assert.equal(parseQuickTask('meet Monday', { today: TODAY, people }).dueDate, '2026-11-09');
  assert.equal(parseQuickTask('send next week', { today: TODAY, people }).dueDate, '2026-11-13');
  assert.equal(parseQuickTask('call today', { today: TODAY, people }).dueDate, TODAY);
  assert.equal(parseQuickTask('due fri', { today: TODAY, people }).dueDate, '2026-11-13', 'on a Friday, "fri" means next Friday');
});

test('due groups and labels', () => {
  assert.equal(dueGroupOf({ status: 'In Progress', dueDate: '2026-11-04' }, TODAY), 'overdue');
  assert.equal(dueGroupOf({ status: 'Not Started', dueDate: TODAY }, TODAY), 'today');
  assert.equal(dueGroupOf({ status: 'Not Started', dueDate: '2026-11-13' }, TODAY), 'week');
  assert.equal(dueGroupOf({ status: 'Not Started', dueDate: '2026-11-14' }, TODAY), 'later');
  assert.equal(dueGroupOf({ status: 'On Hold' }, TODAY), 'none');
  assert.equal(dueGroupOf({ status: 'Completed', dueDate: '2026-11-01' }, TODAY), 'done');
  assert.equal(relativeDue('2026-11-03', TODAY), '3 days late');
  assert.equal(relativeDue('2026-11-07', TODAY), 'Tomorrow');
  assert.equal(relativeDue('2026-11-10', TODAY), 'Tuesday');
  assert.equal(relativeDue('2027-01-02', TODAY), '2 Jan 2027');
  assert.equal(relativeDue(null, TODAY), 'No due date');
});

test('due quick picks and tag suggestions', () => {
  const picks = dueQuickPicks(TODAY);
  assert.deepEqual(picks.map((pick) => pick.date), ['2026-11-06', '2026-11-07', '2026-11-13', '2026-11-13', '2026-11-20', '2026-11-30', null]);
  assert.equal(dueQuickPicks('2026-11-30').find((pick) => pick.label === 'End of month').date, '2026-12-31');
  assert.deepEqual(
    tagSuggestions([{ tags: ['bank', 'GST'] }, { tags: ['bank'] }, { tags: ['vendor', ' '] }, {}], ['vendor']),
    ['bank', 'gst'],
  );
});

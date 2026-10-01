import test from 'node:test';
import assert from 'node:assert/strict';
import {
  eApprovalDiscussion,
  eApprovalStepDiscussion,
  eApprovalStepHops,
} from '../src/lib/e-approval-policy.ts';

/*
 * The workflow tab used to render each stage's *current* fields. A step document keeps only the last
 * comment written on it, so an approver who forwarded with a covering note and a later approver who
 * sanctioned with a remark appeared as one anonymous quotation — and nothing said which desk either
 * belonged to. These tests pin the rule that every note survives, attached to its stage and author.
 */

const person = (userId, name) => ({ kind: 'User', userId, userName: name });

const step = (id, overrides = {}) => ({
  id,
  approvalId: 'req-1',
  name: 'Approval',
  type: 'APPROVAL',
  sequence: 1,
  depth: 0,
  status: 'Active',
  assignment: person('u1', 'One'),
  ...overrides,
});

/* ── every note survives, filed under its stage ──────────────────────────────────────────────── */

test('two comments on the same stage both survive, with their authors', () => {
  const steps = [step('s1')];
  const discussion = eApprovalDiscussion(steps, {
    events: [
      {
        at: '2026-09-30T06:00:00.000Z',
        actorId: 'u1',
        actorName: 'SHAIKH ABDUR RAHEMAN',
        kind: 'Forward',
        stepId: 's1',
        comment: 'Rate verified against the last purchase order.',
        summary: 'Forwarded',
      },
      {
        at: '2026-09-30T07:00:00.000Z',
        actorId: 'u2',
        actorName: 'Sidhartha Palo',
        kind: 'Approve',
        stepId: 's1',
        comment: 'Approved at the reduced figure.',
        approvedAmount: 23350,
        summary: 'Approved',
      },
    ],
  });

  const thread = eApprovalStepDiscussion(discussion, 's1');
  assert.equal(thread.length, 2);
  assert.equal(thread[0].actorName, 'SHAIKH ABDUR RAHEMAN');
  assert.equal(thread[0].notes[0].label, 'Comment');
  assert.match(thread[0].notes[0].text, /last purchase order/);
  assert.equal(thread[1].actorName, 'Sidhartha Palo');
  assert.equal(thread[1].headline, 'Approved');
  assert.equal(thread[1].approvedAmount, 23350);
  assert.equal(discussion.noteCount, 2);
});

test('the thread is chronological however the log came back', () => {
  const discussion = eApprovalDiscussion([step('s1')], {
    events: [
      { at: '2026-09-30T09:00:00.000Z', actorId: 'u2', kind: 'Approve', stepId: 's1', summary: 'Approved' },
      { at: '2026-09-30T08:00:00.000Z', actorId: 'u1', kind: 'Submit', stepId: 's1', summary: 'Submitted' },
    ],
  });
  const thread = eApprovalStepDiscussion(discussion, 's1');
  assert.deepEqual(
    thread.map((entry) => entry.kind),
    ['Submit', 'Approve'],
  );
});

/* ── an instruction is never dressed as a remark ─────────────────────────────────────────────── */

test('comment, instruction and reason are kept apart and all three are shown', () => {
  const discussion = eApprovalDiscussion([step('s1')], {
    events: [
      {
        at: '2026-09-30T06:00:00.000Z',
        actorId: 'u1',
        kind: 'Request Clarification',
        stepId: 's1',
        comment: 'Please see my note.',
        instruction: 'Confirm the measurement sheet with the site engineer.',
        reason: 'Quantity looks high for the stage of work.',
        summary: 'Asked for clarification',
      },
    ],
  });
  const [entry] = eApprovalStepDiscussion(discussion, 's1');
  assert.deepEqual(
    entry.notes.map((note) => note.label),
    ['Comment', 'Instruction', 'Reason'],
  );
  assert.equal(entry.headline, 'Asked for clarification');
});

test('a field repeated across comment and reason is not printed twice', () => {
  const discussion = eApprovalDiscussion([step('s1')], {
    events: [
      {
        at: '2026-09-30T06:00:00.000Z',
        actorId: 'u1',
        kind: 'Return',
        stepId: 's1',
        comment: 'Bill copy missing.',
        reason: 'Bill copy missing.',
        summary: 'Returned',
      },
    ],
  });
  const [entry] = eApprovalStepDiscussion(discussion, 's1');
  assert.equal(entry.notes.length, 1);
  assert.equal(entry.notes[0].label, 'Comment');
});

test('an entry with no words written does not count as a note', () => {
  const discussion = eApprovalDiscussion([step('s1')], {
    events: [{ at: '2026-09-30T06:00:00.000Z', actorId: 'u1', kind: 'Resume', stepId: 's1', summary: 'Resumed' }],
  });
  assert.equal(eApprovalStepDiscussion(discussion, 's1').length, 1);
  assert.equal(discussion.noteCount, 0);
});

/* ── a move says where the file went ─────────────────────────────────────────────────────────── */

test('a forward event absorbs the matching reassignment and names the receiving desk once', () => {
  const steps = [
    step('s1', {
      reassignments: [
        {
          at: '2026-09-30T06:00:00.000Z',
          kind: 'Forward',
          byUserId: 'u1',
          byName: 'SHAIKH ABDUR RAHEMAN',
          from: person('u1', 'SHAIKH ABDUR RAHEMAN'),
          to: person('u2', 'Sidhartha Palo'),
          reason: 'Beyond my sanction limit.',
        },
      ],
    }),
  ];
  const discussion = eApprovalDiscussion(steps, {
    events: [
      {
        at: '2026-09-30T06:00:00.000Z',
        actorId: 'u1',
        actorName: 'SHAIKH ABDUR RAHEMAN',
        kind: 'Forward',
        stepId: 's1',
        summary: 'Forwarded',
      },
    ],
  });
  const thread = eApprovalStepDiscussion(discussion, 's1');
  assert.equal(thread.length, 1, 'the move must not be drawn a second time on its own');
  assert.equal(thread[0].headline, 'Forwarded for approval');
  assert.match(thread[0].movedTo, /Sidhartha Palo/);
  assert.equal(thread[0].notes[0].label, 'Reason');
});

test('a move with no event of its own still gets a line', () => {
  const steps = [
    step('s1', {
      reassignments: [
        {
          at: '2026-09-30T06:00:00.000Z',
          kind: 'Escalate',
          byUserId: 'u9',
          byName: 'System',
          from: person('u1', 'One'),
          to: person('u2', 'Two'),
        },
      ],
    }),
  ];
  const discussion = eApprovalDiscussion(steps, { events: [] });
  const [entry] = eApprovalStepDiscussion(discussion, 's1');
  assert.equal(entry.source, 'Reassignment');
  assert.match(entry.headline, /^Escalated from /);
  assert.match(entry.movedTo, /Two/);
});

/* ── comments land on the stage they were written against ────────────────────────────────────── */

test('a comment filed against a stage appears in that stage, not the request', () => {
  const discussion = eApprovalDiscussion([step('s1'), step('s2', { sequence: 2 })], {
    comments: [
      {
        id: 'c1',
        stepId: 's2',
        body: 'Measurement sheet attached.',
        authorId: 'u3',
        authorName: 'S. K. Bhanja',
        authorDesignation: 'Project GM',
        at: '2026-09-30T10:00:00.000Z',
      },
    ],
  });
  assert.equal(eApprovalStepDiscussion(discussion, 's1').length, 0);
  const [entry] = eApprovalStepDiscussion(discussion, 's2');
  assert.equal(entry.source, 'Comment');
  assert.equal(entry.actorDesignation, 'Project GM');
  assert.equal(entry.headline, 'Commented');
});

test('a reply hangs off the comment it answers', () => {
  const discussion = eApprovalDiscussion([step('s1')], {
    comments: [
      { id: 'c1', stepId: 's1', body: 'Why this rate?', authorId: 'u1', at: '2026-09-30T10:00:00.000Z' },
      {
        id: 'c2',
        stepId: 's1',
        parentCommentId: 'c1',
        body: 'Last approved rate for the same item.',
        authorId: 'u2',
        at: '2026-09-30T11:00:00.000Z',
      },
    ],
  });
  const thread = eApprovalStepDiscussion(discussion, 's1');
  assert.equal(thread.length, 1, 'the reply must not also sit at the top level');
  assert.equal(thread[0].replies.length, 1);
  assert.equal(thread[0].replies[0].headline, 'Replied');
  assert.equal(discussion.noteCount, 2, 'a reply is a note of its own');
});

test('a retracted comment is kept and labelled rather than dropped', () => {
  const discussion = eApprovalDiscussion([step('s1')], {
    comments: [
      {
        id: 'c1',
        stepId: 's1',
        body: 'Wrong figure quoted.',
        authorId: 'u1',
        at: '2026-09-30T10:00:00.000Z',
        retracted: true,
        retractedReason: 'Posted on the wrong file.',
      },
    ],
  });
  const [entry] = eApprovalStepDiscussion(discussion, 's1');
  assert.equal(entry.retracted, true);
  assert.equal(entry.notes[0].label, 'Retracted');
  assert.equal(entry.notes[1].label, 'Reason');
});

/* ── nothing is lost ─────────────────────────────────────────────────────────────────────────── */

test('an entry with no stage, or one naming a stage that is gone, falls to the request', () => {
  const discussion = eApprovalDiscussion([step('s1')], {
    events: [
      { at: '2026-09-30T05:00:00.000Z', actorId: 'u1', kind: 'Created', summary: 'Created' },
      { at: '2026-09-30T05:30:00.000Z', actorId: 'u1', kind: 'Approve', stepId: 'gone', summary: 'Approved' },
    ],
    comments: [{ id: 'c1', body: 'General note.', authorId: 'u1', at: '2026-09-30T06:00:00.000Z' }],
  });
  assert.equal(eApprovalStepDiscussion(discussion, 's1').length, 0);
  assert.equal(discussion.general.length, 3);
  assert.deepEqual(
    discussion.general.map((entry) => entry.stepId),
    [null, null, null],
  );
  assert.equal(discussion.general[0].headline, 'Created the request');
});

test('an unknown event kind still reads as its own summary rather than as nothing', () => {
  const discussion = eApprovalDiscussion([step('s1')], {
    events: [{ at: '2026-09-30T06:00:00.000Z', actorId: 'u1', kind: 'Something New', stepId: 's1', summary: 'Did a thing' }],
  });
  assert.equal(eApprovalStepDiscussion(discussion, 's1')[0].headline, 'Did a thing');
});

test('nested verification and clarification stages get their own threads', () => {
  const steps = [
    step('s1'),
    step('v1', { depth: 1, parentStepId: 's1', type: 'VERIFICATION', name: 'Verification' }),
  ];
  const discussion = eApprovalDiscussion(steps, {
    events: [
      { at: '2026-09-30T06:00:00.000Z', actorId: 'u1', kind: 'Send For Verification', stepId: 's1', summary: 'Sent' },
      {
        at: '2026-09-30T07:00:00.000Z',
        actorId: 'u5',
        kind: 'Verify',
        stepId: 'v1',
        outcome: 'Verified With Observation',
        comment: 'Quantity tallies; rate is 3% above the last PO.',
        summary: 'Verified',
      },
    ],
  });
  assert.equal(eApprovalStepDiscussion(discussion, 's1').length, 1);
  const [verified] = eApprovalStepDiscussion(discussion, 'v1');
  assert.equal(verified.outcome, 'Verified With Observation');
  assert.match(verified.notes[0].text, /3% above/);
});

test('no log and no comments is an empty discussion, not a throw', () => {
  const discussion = eApprovalDiscussion([step('s1')]);
  assert.deepEqual(discussion.byStepId, {});
  assert.deepEqual(discussion.general, []);
  assert.equal(discussion.noteCount, 0);
  assert.deepEqual(eApprovalStepDiscussion(discussion, 's1'), []);
});

/* ── a stage is the chain of desks it passed through ─────────────────────────────────────────── */

const node = (step, children = []) => ({
  step,
  depth: step.depth,
  children,
  sla: { state: 'None' },
  label: step.name,
  assigneeLabel: '',
});

test('a stage nobody moved is a single desk', () => {
  const hops = eApprovalStepHops(step('s1'), []);
  assert.equal(hops.length, 1);
  assert.equal(hops[0].isCurrent, true);
  assert.equal(hops[0].move, undefined);
});

test('two forwards make three desks, in the order the file went', () => {
  const s = step('s1', {
    name: 'SHAIKH ABDUR RAHEMAN',
    assignment: person('u2', 'Sidhartha Palo'),
    startedAt: '2026-09-29T10:00:00.000Z',
    reassignments: [
      {
        at: '2026-09-29T11:00:00.000Z',
        kind: 'Forward',
        byUserId: 'u1',
        from: person('u1', 'SHAIKH ABDUR RAHEMAN'),
        to: person('u3', 'S. K. Bhanja'),
      },
      {
        at: '2026-09-30T05:00:00.000Z',
        kind: 'Forward',
        byUserId: 'u3',
        from: person('u3', 'S. K. Bhanja'),
        to: person('u2', 'Sidhartha Palo'),
      },
    ],
  });
  const hops = eApprovalStepHops(s, []);
  assert.equal(hops.length, 3);
  // The first desk's assignment was overwritten by the forward, so it comes back from the move.
  assert.match(hops[0].assigneeLabel, /SHAIKH ABDUR RAHEMAN/);
  assert.match(hops[1].assigneeLabel, /S\. K\. Bhanja/);
  assert.match(hops[2].assigneeLabel, /Sidhartha Palo/);
  assert.equal(hops[0].title, 'SHAIKH ABDUR RAHEMAN', 'the first desk keeps the stage name');
  assert.equal(hops[1].title, hops[1].assigneeLabel, 'later desks are titled by who received it');
  assert.deepEqual(
    hops.map((hop) => hop.isCurrent),
    [false, false, true],
  );
  assert.equal(hops[0].arrivedAt, '2026-09-29T10:00:00.000Z');
  assert.equal(hops[1].arrivedAt, '2026-09-29T11:00:00.000Z');
});

test('reassignments recorded out of order are still read as a chain', () => {
  const s = step('s1', {
    reassignments: [
      { at: '2026-09-30T05:00:00.000Z', kind: 'Forward', byUserId: 'u3', from: person('u3', 'Two'), to: person('u2', 'Three') },
      { at: '2026-09-29T11:00:00.000Z', kind: 'Forward', byUserId: 'u1', from: person('u1', 'One'), to: person('u3', 'Two') },
    ],
  });
  assert.deepEqual(
    eApprovalStepHops(s, []).map((hop) => hop.assigneeLabel),
    ['One', 'Two', 'Three'],
  );
});

test('a covering note sits with the desk that wrote it, never with the one that received it', () => {
  const s = step('s1', {
    startedAt: '2026-09-29T10:00:00.000Z',
    reassignments: [
      { at: '2026-09-29T11:00:00.000Z', kind: 'Forward', byUserId: 'u1', from: person('u1', 'One'), to: person('u3', 'Two') },
    ],
  });
  const discussion = eApprovalDiscussion([s], {
    events: [
      // Recorded at exactly the boundary: it is the action that caused the move.
      { at: '2026-09-29T11:00:00.000Z', actorId: 'u1', actorName: 'One', kind: 'Forward', stepId: 's1', comment: 'Beyond my limit.', summary: 'Forwarded' },
      { at: '2026-09-29T14:00:00.000Z', actorId: 'u3', actorName: 'Two', kind: 'Approve', stepId: 's1', comment: 'Sanctioned.', summary: 'Approved' },
    ],
  });
  const hops = eApprovalStepHops(s, eApprovalStepDiscussion(discussion, 's1'));
  assert.equal(hops[0].entries.length, 1);
  assert.equal(hops[0].entries[0].notes[0].text, 'Beyond my limit.');
  assert.equal(hops[1].entries.length, 1);
  assert.equal(hops[1].entries[0].notes[0].text, 'Sanctioned.');
});

test('a clarification is raised under the desk that raised it, not under the first approver', () => {
  const parent = step('s1', {
    startedAt: '2026-09-29T10:00:00.000Z',
    reassignments: [
      { at: '2026-09-29T11:00:00.000Z', kind: 'Forward', byUserId: 'u1', from: person('u1', 'One'), to: person('u3', 'Two') },
    ],
  });
  const child = step('v1', {
    depth: 1,
    parentStepId: 's1',
    type: 'CLARIFICATION',
    startedAt: '2026-09-29T12:00:00.000Z',
  });
  const hops = eApprovalStepHops(parent, [], [node(child)]);
  assert.equal(hops[0].children.length, 0, 'it was raised after the file had moved on');
  assert.equal(hops[1].children.length, 1);
  assert.equal(hops[1].children[0].step.id, 'v1');
});

test('an entry with no timestamp falls to the first desk rather than being lost', () => {
  const s = step('s1', {
    reassignments: [
      { at: '2026-09-29T11:00:00.000Z', kind: 'Forward', byUserId: 'u1', from: person('u1', 'One'), to: person('u3', 'Two') },
    ],
  });
  const hops = eApprovalStepHops(s, [
    { id: 'x', at: '', stepId: 's1', source: 'Comment', headline: 'Commented', notes: [], replies: [] },
  ]);
  assert.equal(hops[0].entries.length, 1);
});

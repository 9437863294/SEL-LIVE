// Stage 2, Office Hub: the module's records are readable by whoever may open it (`canViewModule`),
// and each person's own rows by them; writes follow the relationship (organiser, assignee, owner,
// participant, team leader) or the action the screen checks (src/lib/office-hub-permissions.ts).
// Auth uids differ from `users` ids on purpose: every filter and stamp uses the `users` id.
import test, { after, before } from 'node:test';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { as, rulesEnv, seed } from './helpers.mjs';

const perms = (userDocId, p) => ({ v: 1, p, active: true, userDocId, roleNames: [], projectIds: [], departmentIds: [] });
const stamp = (userId) => ({ updatedBy: userId, updatedByName: userId, updatedAt: new Date() });
const created = (userId) => ({ createdBy: userId, createdByName: userId, createdAt: new Date(), ...stamp(userId) });

let env;
before(async () => {
  env = await rulesEnv();
  await seed(env, {
    'userPermissions/org': perms('U-org', { 'Office Hub.Meetings': ['View', 'Create'] }),
    'userPermissions/part': perms('U-part', { 'Office Hub.Meetings': ['View'] }),
    'userPermissions/viewer': perms('U-viewer', { 'Office Hub': ['View Module'], 'Office Hub.Tasks': ['View'] }),
    'userPermissions/admin': perms('U-admin', {
      'Office Hub': ['View Module'],
      'Office Hub.Meetings': ['View', 'View All', 'Create', 'Edit', 'Cancel', 'Change Organizer'],
      'Office Hub.Attendance': ['Record'], 'Office Hub.Agenda': ['Add', 'Edit'],
      'Office Hub.Minutes': ['Prepare', 'Approve', 'Publish'],
      'Office Hub.Decisions': ['View All', 'Create', 'Edit', 'Close'],
      'Office Hub.Action Items': ['Create', 'Edit'],
      'Office Hub.Tasks': ['View All', 'Create', 'Edit', 'Delete'],
      'Office Hub.Teams': ['Create', 'Edit', 'Archive', 'Change Leader'],
      'Office Hub.Documents': ['Upload', 'Delete'], 'Office Hub.Templates': ['Add', 'Edit'],
      'Office Hub.Settings': ['Edit'],
    }),
    'userPermissions/cal': perms('U-cal', { 'Office Hub.Calendar': ['View', 'Reschedule'] }),
    'userPermissions/cancel': perms('U-cancel', { 'Office Hub.Meetings': ['View', 'Cancel'] }),
    'userPermissions/closer': perms('U-closer', { 'Office Hub.Meetings': ['View'], 'Office Hub.Decisions': ['View', 'Close'] }),
    'userPermissions/reviewer': perms('U-rev', { 'Office Hub.Meetings': ['View'], 'Office Hub.Minutes': ['Review'] }),
    'userPermissions/approver': perms('U-appr', { 'Office Hub.Meetings': ['View'], 'Office Hub.Minutes': ['Approve'] }),
    'userPermissions/uploader': perms('U-up', { 'Office Hub.Meetings': ['View'], 'Office Hub.Documents': ['Upload'] }),
    'userPermissions/lead': perms('U-lead', { 'Office Hub.Tasks': ['View'] }),
    'userPermissions/asg': perms('U-asg', { 'Office Hub.Tasks': ['View'] }),
    // Mail Hub's "also create an Office Hub task": Tasks Create and nothing else in the module.
    'userPermissions/mail': perms('U-mail', { 'Office Hub.Tasks': ['Create'], 'Mail Hub': ['View Module'] }),
    // Invited to a meeting and named on work, holding nothing in Office Hub (the home dashboard).
    'userPermissions/out': perms('U-out', { 'Site Account Statement.Expenses': ['View'] }),
    'userPermissions/gone': { ...perms('U-gone', {}), active: false },
    // `nodoc` has no permissions document at all.

    'officeHubMeetings/m1': {
      title: 'Weekly review', status: 'Scheduled', date: '2026-10-20', startTime: '10:00', endTime: '11:00',
      organizerId: 'U-org', scheduledById: 'U-org', participantUserIds: ['U-org', 'U-part', 'U-out'],
      seriesId: 'm1', isSeriesParent: true, recurrence: { frequency: 'Weekly', exceptions: [] },
      responseSummary: { accepted: 0, noResponse: 3 }, momStage: 'Prepared', isDeleted: false,
      organizationId: 'org1', ...created('U-org'),
    },
    'officeHubMeetings/m2': {
      title: 'Live one', status: 'In Progress', date: '2026-10-13', organizerId: 'U-org', scheduledById: 'U-org',
      participantUserIds: ['U-org', 'U-part'], isDeleted: false, organizationId: 'org1', ...created('U-org'),
    },
    'officeHubMeetings/m3': {
      title: 'Board', status: 'Completed', date: '2026-10-01', organizerId: 'U-admin', scheduledById: 'U-admin',
      participantUserIds: ['U-admin'], momStage: 'Reviewed', isDeleted: false, organizationId: 'org1', ...created('U-admin'),
    },
    'officeHubParticipants/m1_U-part': { meetingId: 'm1', userId: 'U-part', response: 'No Response', remindersSent: 0, ...created('U-org') },
    'officeHubParticipants/m1_U-out': { meetingId: 'm1', userId: 'U-out', response: 'No Response', remindersSent: 0, ...created('U-org') },
    'officeHubAgenda/a1': { meetingId: 'm2', order: 1, title: 'Opening', covered: false, ...created('U-org') },
    'officeHubAgenda/a2': { meetingId: 'm1', order: 1, title: 'Numbers', covered: false, ...created('U-org') },
    'officeHubMom/m1': {
      meetingId: 'm1', reference: 'MOM-2627-0001', stage: 'Prepared', approvalRequired: true, preparedById: 'U-org',
      history: [{ stage: 'Prepared', byId: 'U-org' }], ...created('U-org'),
    },
    'officeHubMom/m3': {
      meetingId: 'm3', reference: 'MOM-2627-0002', stage: 'Reviewed', approvalRequired: true, preparedById: 'U-admin',
      reviewedById: 'U-rev', history: [{ stage: 'Prepared' }, { stage: 'Reviewed' }], ...created('U-admin'),
    },
    'officeHubDecisions/d1': { title: 'Buy', ownerId: 'U-part', meetingId: 'm1', decisionDate: '2026-10-20', status: 'Open', reference: 'DEC-1', ...created('U-org') },
    'officeHubDecisions/d2': { title: 'Sell', ownerId: 'U-out', decisionDate: '2026-10-21', status: 'Open', reference: 'DEC-2', ...created('U-admin') },
    'officeHubActionItems/ai1': { title: 'Chase', responsibleUserId: 'U-part', responsibleTeamId: 't1', meetingId: 'm1', taskId: 'tk2', status: 'Open', reference: 'ACT-1', ...created('U-org') },
    'officeHubActionItems/ai2': { title: 'Call', responsibleUserId: 'U-out', status: 'Open', taskId: null, reference: 'ACT-2', ...created('U-admin') },
    'officeHubActionItems/ai3': { title: 'Open task', responsibleUserId: 'U-admin', status: 'Open', taskId: 'tk1', reference: 'ACT-3', ...created('U-admin') },
    'officeHubTasks/tk1': {
      title: 'Report', assigneeId: 'U-asg', teamId: 't1', status: 'In Progress', progress: 10, commentCount: 0,
      watcherUserIds: ['U-asg'], dependencies: [], documentIds: [], reference: 'TSK-1', isDeleted: false,
      organizationId: 'org1', ...created('U-admin'),
    },
    'officeHubTasks/tk2': { title: 'Done', assigneeId: 'U-part', actionItemId: 'ai1', status: 'Completed', watcherUserIds: [], reference: 'TSK-2', ...created('U-org') },
    'officeHubTasks/tk3': { title: 'Other', assigneeId: 'U-admin', status: 'Not Started', dependencies: [], watcherUserIds: [], reference: 'TSK-3', ...created('U-admin') },
    'officeHubTasks/tk4': { title: 'Mine', assigneeId: 'U-out', status: 'Not Started', watcherUserIds: ['U-out'], reference: 'TSK-4', actionItemId: 'ai2', ...created('U-admin') },
    'officeHubTeams/t1': { name: 'Ops', leaderId: 'U-lead', memberUserIds: ['U-lead', 'U-asg'], members: [], status: 'Active', ...created('U-admin') },
    'officeHubDocuments/doc1': { fileName: 'a.pdf', entityType: 'task', entityId: 'tk1', meetingId: null, uploadedById: 'U-admin', isDeleted: false, ...created('U-admin') },
    'officeHubDocuments/doc2': { fileName: 'b.pdf', entityType: 'meeting', entityId: 'm1', meetingId: 'm1', uploadedById: 'U-admin', isDeleted: false, ...created('U-admin') },
    'officeHubDocuments/doc3': { fileName: 'c.pdf', entityType: 'decision', entityId: 'd1', meetingId: null, uploadedById: 'U-admin', isDeleted: false, ...created('U-admin') },
    'officeHubReminders/meeting_m1_U-part_before_15': { entityType: 'meeting', entityId: 'm1', userId: 'U-part', status: 'Scheduled' },
    'officeHubReminders/task_tk4_U-out_due_0': { entityType: 'task', entityId: 'tk4', userId: 'U-out', status: 'Scheduled' },
    'officeHubMeetingTemplates/mt1': { name: 'Standup', status: 'Active', usageCount: 3 },
    'officeHubAgendaTemplates/at1': { name: 'Standard', status: 'Active', items: [] },
    'officeHubSettings/global': { organizationName: 'SEL', defaultTimeZone: 'Asia/Kolkata' },
    'officeHubUserSettings/U-part': { meetingReminders: true },
    'officeHubCounters/TSK-2627': { prefix: 'TSK', financialYear: '2627', value: 5 },
  });
});
after(async () => env?.cleanup());

const meetings = (db) => db.collection('officeHubMeetings');

test('reading: module users read everything; others only their own rows', async () => {
  for (const uid of ['viewer', 'part', 'cal', 'admin']) {
    const db = as(env, uid);
    await assertSucceeds(meetings(db).orderBy('date', 'desc').limit(150).get()); // listMeetings('all')
    await assertSucceeds(meetings(db).where('teamIds', 'array-contains-any', ['t1']).orderBy('date').limit(200).get());
    await assertSucceeds(db.collection('officeHubParticipants').where('meetingId', '==', 'm1').get());
    await assertSucceeds(db.collection('officeHubAgenda').where('meetingId', '==', 'm2').orderBy('order', 'asc').get());
    await assertSucceeds(db.collection('officeHubTasks').limit(300).get());
    await assertSucceeds(db.collection('officeHubDecisions').orderBy('decisionDate', 'desc').limit(150).get());
    await assertSucceeds(db.collection('officeHubActionItems').limit(150).get());
    await assertSucceeds(db.doc('officeHubMom/m1').get());
    await assertSucceeds(db.doc('officeHubNotes/m1').get());
    await assertSucceeds(db.collection('officeHubDocuments').where('meetingId', '==', 'm1').limit(200).get());
    await assertSucceeds(db.collection('officeHubTaskComments').where('taskId', '==', 'tk1').orderBy('createdAt', 'asc').limit(200).get());
    await assertSucceeds(db.collection('officeHubTaskActivity').where('taskId', '==', 'tk1').orderBy('at', 'desc').limit(100).get());
  }
  // The provider's directory and settings, for anyone with an Office Hub grant (Mail Hub's task creator too).
  for (const uid of ['viewer', 'mail']) {
    await assertSucceeds(as(env, uid).collection('officeHubTeams').where('status', '==', 'Active').get());
    await assertSucceeds(as(env, uid).doc('officeHubSettings/global').get());
  }
  for (const uid of ['out', 'mail', 'gone', 'nodoc']) {
    const db = as(env, uid);
    await assertFails(meetings(db).orderBy('date', 'desc').limit(150).get());
    await assertFails(db.doc('officeHubMeetings/m3').get());
    await assertFails(db.collection('officeHubParticipants').where('meetingId', '==', 'm1').get());
    await assertFails(db.collection('officeHubTasks').limit(300).get());
    await assertFails(db.doc('officeHubMom/m1').get());
  }
  for (const uid of ['out', 'gone', 'nodoc']) {
    await assertFails(as(env, uid).collection('officeHubTeams').where('status', '==', 'Active').get());
    await assertFails(as(env, uid).doc('officeHubSettings/global').get());
  }
  await assertFails(as(env, null).doc('officeHubMeetings/m1').get());
});

test('the home dashboard and My Work: own rows for anyone signed in, by users id', async () => {
  const out = as(env, 'out');
  // loadMeetingsInRange (no gate at all) and the meetings/invitations sources.
  await assertSucceeds(meetings(out).where('participantUserIds', 'array-contains', 'U-out')
    .where('date', '>=', '2026-10-01').where('date', '<=', '2026-10-31').orderBy('date', 'asc').limit(600).get());
  await assertSucceeds(meetings(out).where('participantUserIds', 'array-contains', 'U-out').limit(100).get());
  await assertSucceeds(out.doc('officeHubMeetings/m1').get());
  await assertSucceeds(out.collection('officeHubParticipants').where('userId', '==', 'U-out').limit(100).get());
  await assertSucceeds(out.collection('officeHubTasks').where('assigneeId', '==', 'U-out').limit(100).get());
  await assertSucceeds(out.collection('officeHubTasks').where('watcherUserIds', 'array-contains', 'U-out').limit(100).get());
  await assertSucceeds(out.collection('officeHubDecisions').where('ownerId', '==', 'U-out').limit(100).get());
  await assertSucceeds(out.collection('officeHubActionItems').where('responsibleUserId', '==', 'U-out').limit(100).get());
  await assertSucceeds(out.collection('officeHubReminders').where('userId', '==', 'U-out').limit(100).get());
  // Somebody else's id, or the auth uid, is refused.
  await assertFails(meetings(out).where('participantUserIds', 'array-contains', 'U-part').limit(100).get());
  await assertFails(out.collection('officeHubTasks').where('assigneeId', '==', 'U-asg').limit(100).get());
  await assertFails(out.collection('officeHubReminders').where('userId', '==', 'out').limit(100).get());
  await assertFails(out.collection('officeHubReminders').where('entityId', '==', 'm1').limit(100).get());
  // The "awaiting my response" count (getCountFromServer, same constraints) and list.
  const part = as(env, 'part');
  await assertSucceeds(part.collection('officeHubParticipants').where('userId', '==', 'U-part').where('response', '==', 'No Response').get());
  await assertSucceeds(out.collection('officeHubParticipants').where('userId', '==', 'U-out').where('response', '==', 'No Response').get());
});

test('creating a meeting: by its scheduler, with its invitations and agenda in one batch', async () => {
  const org = as(env, 'org');
  const batch = org.batch();
  batch.set(org.doc('officeHubMeetings/n1'), {
    title: 'New', status: 'Scheduled', organizerId: 'U-org', scheduledById: 'U-org',
    participantUserIds: ['U-org', 'U-part'], isSeriesParent: false, seriesId: null, ...created('U-org'),
  });
  batch.set(org.doc('officeHubParticipants/n1_U-part'), { meetingId: 'n1', userId: 'U-part', response: 'No Response', ...created('U-org') }, { merge: true });
  batch.set(org.doc('officeHubAgenda/n1a'), { meetingId: 'n1', order: 1, title: 'Intro', ...created('U-org') });
  await assertSucceeds(batch.commit());

  // Somebody else as organiser needs Change Organizer.
  await assertFails(org.doc('officeHubMeetings/n2').set({ organizerId: 'U-admin', scheduledById: 'U-org', ...created('U-org') }));
  await assertSucceeds(as(env, 'admin').doc('officeHubMeetings/n3').set({ organizerId: 'U-org', scheduledById: 'U-admin', ...created('U-admin') }));
  // No Create; a forged scheduler or creator; Switch User stamping the impersonated user's id.
  await assertFails(as(env, 'part').doc('officeHubMeetings/n4').set({ organizerId: 'U-part', scheduledById: 'U-part', ...created('U-part') }));
  await assertFails(org.doc('officeHubMeetings/n5').set({ organizerId: 'U-org', scheduledById: 'U-admin', ...created('U-org') }));
  await assertFails(as(env, 'admin').doc('officeHubMeetings/n6').set({ organizerId: 'U-part', scheduledById: 'U-part', ...created('U-part') }));
  // A participant row with a doc id that does not match, or for a meeting the caller does not run.
  await assertFails(org.doc('officeHubParticipants/n1_U-x').set({ meetingId: 'n1', userId: 'U-viewer', ...created('U-org') }));
  await assertFails(as(env, 'part').doc('officeHubParticipants/m3_U-part').set({ meetingId: 'm3', userId: 'U-part', ...created('U-part') }));
});

test('a series: later occurrences raised by whoever runs its first meeting', async () => {
  const org = as(env, 'org');
  const batch = org.batch();
  for (const id of ['s1', 's2']) {
    batch.set(org.doc(`officeHubMeetings/${id}`), {
      title: 'Weekly review', organizerId: 'U-org', scheduledById: 'U-org', seriesId: 'm1', isSeriesParent: false,
      occurrenceKey: id, status: 'Scheduled', participantUserIds: ['U-org', 'U-part'], ...created('U-org'),
    });
    batch.set(org.doc(`officeHubParticipants/${id}_U-part`), { meetingId: id, userId: 'U-part', ...created('U-org') }, { merge: true });
    batch.set(org.doc(`officeHubAgenda/${id}-a`), { meetingId: id, order: 1, title: 'Numbers', ...created('U-org') });
  }
  await assertSucceeds(batch.commit());
  // materializeSeriesInstances reads the existing occurrences first.
  await assertSucceeds(meetings(org).where('seriesId', '==', 'm1').limit(400).get());
  // Nobody else's series, and never with another organiser.
  await assertFails(as(env, 'part').doc('officeHubMeetings/s3').set({ organizerId: 'U-org', scheduledById: 'U-org', seriesId: 'm1', isSeriesParent: false, ...created('U-part') }));
  await assertFails(org.doc('officeHubMeetings/s4').set({ organizerId: 'U-admin', scheduledById: 'U-org', seriesId: 'm1', isSeriesParent: false, ...created('U-org') }));
});

test('changing a meeting: the organiser; Cancel, Reschedule and answers on their own fields', async () => {
  await assertSucceeds(as(env, 'org').doc('officeHubMeetings/m1').update({ title: 'Weekly review (v2)', ...stamp('U-org') }));
  await assertSucceeds(as(env, 'admin').doc('officeHubMeetings/m1').update({ description: 'Edited', ...stamp('U-admin') }));
  await assertFails(as(env, 'part').doc('officeHubMeetings/m1').update({ title: 'Mine now', ...stamp('U-part') }));
  await assertFails(as(env, 'org').doc('officeHubMeetings/m1').update({ title: 'x', ...stamp('U-part') }));
  // The organiser cannot hand it on without Change Organizer, nor rewrite who scheduled it.
  await assertFails(as(env, 'org').doc('officeHubMeetings/m1').update({ organizerId: 'U-part', ...stamp('U-org') }));
  await assertFails(as(env, 'org').doc('officeHubMeetings/m1').update({ scheduledById: 'U-part', ...stamp('U-org') }));

  const cal = as(env, 'cal');
  await assertSucceeds(cal.doc('officeHubMeetings/m1').update({ date: '2026-10-21', startAt: new Date(), endAt: new Date(), ...stamp('U-cal') }));
  await assertFails(cal.doc('officeHubMeetings/m1').update({ title: 'Moved', ...stamp('U-cal') }));

  const cancel = as(env, 'cancel');
  await assertSucceeds(cancel.doc('officeHubMeetings/m1').update({ 'recurrence.exceptions': ['2026-10-27'] }));
  await assertFails(cancel.doc('officeHubMeetings/m1').update({ 'recurrence.frequency': 'Daily' }));
  await assertFails(cancel.doc('officeHubMeetings/m2').update({ status: 'Completed', ...stamp('U-cancel') }));
  await assertSucceeds(cancel.doc('officeHubMeetings/m2').update({ status: 'Cancelled', cancellationReason: 'x', ...stamp('U-cancel') }));
  await seed(env, { 'officeHubMeetings/m2': {
    title: 'Live one', status: 'In Progress', date: '2026-10-13', organizerId: 'U-org', scheduledById: 'U-org',
    participantUserIds: ['U-org', 'U-part'], isDeleted: false, organizationId: 'org1', ...created('U-org') } });
});

test('answering an invitation: your own row, and the tally on the meeting', async () => {
  for (const [uid, me] of [['part', 'U-part'], ['out', 'U-out']]) {
    const db = as(env, uid);
    const batch = db.batch();
    batch.update(db.doc(`officeHubParticipants/m1_${me}`), { response: 'Accepted', responseMessage: null, respondedAt: '2026-10-13', ...stamp(me) });
    batch.update(db.doc('officeHubMeetings/m1'), { responseSummary: { accepted: 1, noResponse: 2 } });
    await assertSucceeds(batch.commit());
  }
  const part = as(env, 'part');
  await assertFails(part.doc('officeHubParticipants/m1_U-out').update({ response: 'Declined', ...stamp('U-part') }));
  await assertFails(part.doc('officeHubParticipants/m1_U-part').update({ attendance: 'Present', ...stamp('U-part') }));
  // Not invited: no tally.
  await assertFails(as(env, 'viewer').doc('officeHubMeetings/m1').update({ responseSummary: { accepted: 9 } }));
});

test('the invitation list and attendance: the organiser, Manage Participants, Attendance Record', async () => {
  const org = as(env, 'org');
  await assertSucceeds(org.doc('officeHubParticipants/m1_U-part').update({ remindersSent: 1, lastRemindedAt: '2026-10-13' }));
  await assertSucceeds(org.doc('officeHubParticipants/m1_U-part').update({ attendance: 'Present', attendanceMarkedById: 'U-org', ...stamp('U-org') }));
  await assertSucceeds(as(env, 'admin').doc('officeHubParticipants/m1_U-out').update({
    attendance: 'Absent', attendanceNote: null, checkInAt: null, attendanceMarkedById: 'U-admin', attendanceMarkedByName: 'A', ...stamp('U-admin') }));
  await assertFails(as(env, 'viewer').doc('officeHubParticipants/m1_U-out').update({ attendance: 'Present', attendanceMarkedById: 'U-viewer', ...stamp('U-viewer') }));
  await assertFails(as(env, 'part').doc('officeHubParticipants/m1_U-out').delete());
  await assertFails(org.doc('officeHubParticipants/m1_U-part').update({ meetingId: 'm3', ...stamp('U-org') }));
  await seed(env, { 'officeHubParticipants/m1_U-gone': { meetingId: 'm1', userId: 'U-gone', ...created('U-org') } });
  await assertSucceeds(org.doc('officeHubParticipants/m1_U-gone').delete());
});

test('agenda and notes: whoever runs the meeting, and its participants while it is In Progress', async () => {
  const part = as(env, 'part');
  await assertSucceeds(part.collection('officeHubAgenda').add({ meetingId: 'm2', order: 2, title: 'Raised live', ...created('U-part') }));
  await assertSucceeds(part.doc('officeHubAgenda/a1').update({ covered: true, coveredAt: '2026-10-13', ...stamp('U-part') }));
  await assertSucceeds(part.doc('officeHubNotes/m2').set({ meetingId: 'm2', html: '<p>x</p>', ...stamp('U-part') }, { merge: true }));
  // Not yet running, or not invited.
  await assertFails(part.collection('officeHubAgenda').add({ meetingId: 'm1', order: 2, title: 'Early', ...created('U-part') }));
  await assertFails(part.doc('officeHubNotes/m1').set({ meetingId: 'm1', html: 'x', ...stamp('U-part') }, { merge: true }));
  await assertFails(as(env, 'viewer').collection('officeHubAgenda').add({ meetingId: 'm2', order: 3, title: 'x', ...created('U-viewer') }));
  await assertFails(as(env, 'viewer').doc('officeHubNotes/m2').set({ meetingId: 'm2', html: 'x', ...stamp('U-viewer') }, { merge: true }));
  // The organiser deletes and renumbers in one batch; Agenda Add covers anyone's meeting.
  const org = as(env, 'org');
  await seed(env, { 'officeHubAgenda/a3': { meetingId: 'm1', order: 2, title: 'Spare', ...created('U-org') } });
  const batch = org.batch();
  batch.delete(org.doc('officeHubAgenda/a3'));
  batch.update(org.doc('officeHubAgenda/a2'), { order: 1 });
  await assertSucceeds(batch.commit());
  await assertSucceeds(org.doc('officeHubNotes/m1').set({ meetingId: 'm1', html: 'y', ...stamp('U-org') }, { merge: true }));
  await assertSucceeds(as(env, 'admin').collection('officeHubAgenda').add({ meetingId: 'm1', order: 2, title: 'x', ...created('U-admin') }));
  await assertFails(part.doc('officeHubAgenda/a1').update({ meetingId: 'm1', ...stamp('U-part') }));
});

test('minutes: written by the organiser, each stage signed by its own grant', async () => {
  const org = as(env, 'org');
  await assertSucceeds(org.doc('officeHubMom/m2').set({ meetingId: 'm2', reference: 'MOM-3', stage: 'Draft', approvalRequired: true, ...created('U-org') }, { merge: true }));
  await assertSucceeds(org.doc('officeHubMom/m1').set({ nextMeetingDate: '2026-10-27', discussionHtml: '<p/>', ...stamp('U-org') }, { merge: true }));
  await assertFails(as(env, 'viewer').doc('officeHubMom/m1').set({ discussionHtml: 'x', ...stamp('U-viewer') }, { merge: true }));
  await assertFails(org.doc('officeHubMom/m1').set({ stage: 'Approved', approvedById: 'U-org', ...stamp('U-org') }, { merge: true }));

  // Review, with the meeting's mirror in the same batch.
  const rev = as(env, 'reviewer');
  const batch = rev.batch();
  batch.set(rev.doc('officeHubMom/m1'), {
    stage: 'Reviewed', reviewedById: 'U-rev', reviewedByName: 'R', reviewedAt: 'now',
    history: [{ stage: 'Prepared', byId: 'U-org' }, { stage: 'Reviewed', byId: 'U-rev' }], ...stamp('U-rev'),
  }, { merge: true });
  batch.update(rev.doc('officeHubMeetings/m1'), { momStage: 'Reviewed' });
  await assertSucceeds(batch.commit());
  // A mirror that disagrees with the minutes, a forged signature, a history that did not grow.
  await assertFails(rev.doc('officeHubMeetings/m1').update({ momStage: 'Published' }));
  await assertFails(as(env, 'approver').doc('officeHubMom/m1').set({
    stage: 'Approved', approvedById: 'U-rev', history: [{}, {}, {}], ...stamp('U-appr') }, { merge: true }));
  await assertFails(as(env, 'approver').doc('officeHubMom/m1').set({
    stage: 'Approved', approvedById: 'U-appr', history: [{}, {}], ...stamp('U-appr') }, { merge: true }));
  // The preparer may not approve their own minutes when approval is required.
  await assertFails(as(env, 'admin').doc('officeHubMom/m3').set({
    stage: 'Approved', approvedById: 'U-admin', history: [{}, {}, {}], ...stamp('U-admin') }, { merge: true }));
  await assertSucceeds(as(env, 'approver').doc('officeHubMom/m3').set({
    stage: 'Approved', approvedById: 'U-appr', history: [{}, {}, {}], ...stamp('U-appr') }, { merge: true }));
  // Publishing (the organiser of m3 holds Publish too), then recording who it went to.
  await assertSucceeds(as(env, 'admin').doc('officeHubMom/m3').set({ stage: 'Published', publishedAt: 'now', history: [{}, {}, {}, {}], ...stamp('U-admin') }, { merge: true }));
  await assertSucceeds(as(env, 'admin').doc('officeHubMom/m3').set({ circulatedToUserIds: ['U-admin'], circulatedAt: 'now' }, { merge: true }));
  await assertFails(as(env, 'viewer').doc('officeHubMom/m3').set({ circulatedToUserIds: [], circulatedAt: 'now' }, { merge: true }));
});

test('decisions and action items: their owner, the meeting organiser, or the grant', async () => {
  await assertSucceeds(as(env, 'part').doc('officeHubDecisions/d1').update({ dueDate: '2026-11-01', ...stamp('U-part') }));
  await assertSucceeds(as(env, 'org').doc('officeHubDecisions/d1').update({ title: 'Buy now', ...stamp('U-org') }));
  await assertSucceeds(as(env, 'closer').doc('officeHubDecisions/d2').update({ status: 'Completed', closedAt: 'now', ...stamp('U-closer') }));
  await assertFails(as(env, 'closer').doc('officeHubDecisions/d2').update({ title: 'x', ...stamp('U-closer') }));
  await assertFails(as(env, 'viewer').doc('officeHubDecisions/d1').update({ title: 'x', ...stamp('U-viewer') }));
  await assertFails(as(env, 'part').doc('officeHubDecisions/d1').update({ reference: 'DEC-9', ...stamp('U-part') }));
  await assertSucceeds(as(env, 'admin').collection('officeHubDecisions').add({ title: 'New', ownerId: 'U-part', ...created('U-admin') }));
  await assertFails(as(env, 'viewer').collection('officeHubDecisions').add({ title: 'New', ownerId: 'U-part', ...created('U-viewer') }));

  await assertSucceeds(as(env, 'part').doc('officeHubActionItems/ai1').update({ status: 'In Progress', ...stamp('U-part') }));
  await assertSucceeds(as(env, 'lead').doc('officeHubActionItems/ai1').update({ dueDate: '2026-11-02', ...stamp('U-lead') }));
  await assertFails(as(env, 'viewer').doc('officeHubActionItems/ai2').update({ title: 'x', ...stamp('U-viewer') }));
  // Closed with its finished task, by whoever completed it; not while the task is open.
  await assertSucceeds(as(env, 'viewer').doc('officeHubActionItems/ai1').update({ status: 'Completed', completedAt: 'now', ...stamp('U-viewer') }));
  await assertFails(as(env, 'viewer').doc('officeHubActionItems/ai3').update({ status: 'Completed', completedAt: 'now', ...stamp('U-viewer') }));
  // Linked to the task raised from it (Mail Hub's Tasks Create counts as Convert).
  await assertSucceeds(as(env, 'mail').doc('officeHubActionItems/ai2').update({ taskId: 'tk4', ...stamp('U-mail') }));
  await assertFails(as(env, 'mail').doc('officeHubActionItems/ai2').update({ taskId: 'tk3', ...stamp('U-mail') }));
  // Carried into a meeting the caller runs.
  await assertSucceeds(as(env, 'org').doc('officeHubActionItems/ai2').update({ carriedToMeetingId: 'm1', ...stamp('U-org') }));
  await assertFails(as(env, 'org').doc('officeHubActionItems/ai2').update({ carriedToMeetingId: 'm3', ...stamp('U-org') }));
});

test('tasks: the assignee, creator and team leader; Delete, Comment and Upload on their own fields', async () => {
  await assertSucceeds(as(env, 'asg').doc('officeHubTasks/tk1').update({ progress: 50, status: 'In Progress', ...stamp('U-asg') }));
  await assertSucceeds(as(env, 'lead').doc('officeHubTasks/tk1').update({ dueDate: '2026-11-03', ...stamp('U-lead') }));
  await assertFails(as(env, 'viewer').doc('officeHubTasks/tk1').update({ title: 'x', ...stamp('U-viewer') }));
  await assertFails(as(env, 'asg').doc('officeHubTasks/tk1').update({ isDeleted: true, deletedBy: 'U-asg', ...stamp('U-asg') }));
  await assertFails(as(env, 'asg').doc('officeHubTasks/tk1').update({ createdBy: 'U-asg', ...stamp('U-asg') }));
  await assertSucceeds(as(env, 'admin').doc('officeHubTasks/tk3').update({ isDeleted: true, deletedBy: 'U-admin', ...stamp('U-admin') }));
  await seed(env, { 'officeHubTasks/tk3': { title: 'Other', assigneeId: 'U-admin', status: 'Not Started', dependencies: [], watcherUserIds: [], reference: 'TSK-3', ...created('U-admin') } });

  // A comment by any Tasks viewer, counted on the task.
  const viewer = as(env, 'viewer');
  await assertSucceeds(viewer.collection('officeHubTaskComments').add({ taskId: 'tk1', body: 'Hi', ...created('U-viewer') }));
  await assertSucceeds(viewer.doc('officeHubTasks/tk1').update({ commentCount: 1, watcherUserIds: ['U-asg', 'U-viewer'], ...stamp('U-viewer') }));
  await assertFails(viewer.doc('officeHubTasks/tk1').update({ commentCount: 5, watcherUserIds: ['U-viewer'], ...stamp('U-viewer') }));
  await assertFails(as(env, 'org').collection('officeHubTaskComments').add({ taskId: 'tk1', body: 'Hi', ...created('U-org') }));
  await assertFails(viewer.collection('officeHubTaskComments').add({ taskId: 'tk1', body: 'Hi', ...created('U-asg') }));

  // A dependency: both ends in one batch, by the source task's editor.
  const asg = as(env, 'asg');
  const batch = asg.batch();
  batch.update(asg.doc('officeHubTasks/tk1'), { dependencies: [{ type: 'blocks', taskId: 'tk3' }], ...stamp('U-asg') });
  batch.update(asg.doc('officeHubTasks/tk3'), { dependencies: [{ type: 'blocked-by', taskId: 'tk1' }] });
  await assertSucceeds(batch.commit());
  await assertFails(asg.doc('officeHubTasks/tk3').update({ dependencies: [], title: 'x' }));
  // An upload's link.
  await assertSucceeds(as(env, 'uploader').doc('officeHubTasks/tk1').update({ documentIds: ['doc9'] }));
  await assertFails(as(env, 'uploader').doc('officeHubTasks/tk1').update({ documentIds: [] }));
  await assertFails(as(env, 'viewer').doc('officeHubTasks/tk1').update({ documentIds: ['doc9', 'doc10'] }));
});

test('raising a task, as Mail Hub does: counter, task, trail and reminder', async () => {
  const mail = as(env, 'mail');
  await assertSucceeds(mail.runTransaction(async (tx) => {
    const ref = mail.doc('officeHubCounters/TSK-2627');
    const snap = await tx.get(ref);
    tx.set(ref, { value: snap.data().value + 1, updatedAt: new Date() }, { merge: true });
  }));
  await assertSucceeds(mail.doc('officeHubCounters/ACT-2627').set({ prefix: 'ACT', value: 1 }, { merge: true }));
  await assertFails(mail.doc('officeHubCounters/TSK-2627').set({ value: 99 }, { merge: true }));
  await assertSucceeds(mail.collection('officeHubTasks').add({ title: 'From mail', assigneeId: 'U-asg', watcherUserIds: ['U-mail', 'U-asg'], ...created('U-mail') }));
  await assertSucceeds(mail.collection('officeHubTaskActivity').add({ taskId: 'tkX', kind: 'created', actorId: 'U-mail', ...created('U-mail') }));
  await assertSucceeds(mail.doc('officeHubReminders/task_tkX_U-asg_due_0').set({ entityType: 'task', entityId: 'tkX', userId: 'U-asg', status: 'Scheduled' }));
  await assertSucceeds(mail.doc('officeHubUserSettings/U-asg').get());
  await assertFails(mail.collection('officeHubTasks').add({ title: 'Forged', ...created('U-asg') }));
  await assertFails(as(env, 'viewer').collection('officeHubTasks').add({ title: 'No grant', ...created('U-viewer') }));
  await assertFails(as(env, 'out').doc('officeHubCounters/TSK-2627').get());
});

test('teams: the leader manages theirs; Change Leader and Archive have their own grants', async () => {
  const lead = as(env, 'lead');
  await assertSucceeds(lead.doc('officeHubTeams/t1').update({ name: 'Operations', memberUserIds: ['U-lead', 'U-asg', 'U-part'], ...stamp('U-lead') }));
  await assertFails(lead.doc('officeHubTeams/t1').update({ status: 'Archived', ...stamp('U-lead') }));
  await assertFails(as(env, 'asg').doc('officeHubTeams/t1').update({ name: 'Mine', ...stamp('U-asg') }));
  await assertSucceeds(as(env, 'admin').doc('officeHubTeams/t1').update({ status: 'Archived', archivedAt: 'now', ...stamp('U-admin') }));
  await assertSucceeds(as(env, 'admin').doc('officeHubTeams/t1').update({ status: 'Active', archivedAt: null, ...stamp('U-admin') }));
  await assertSucceeds(as(env, 'admin').collection('officeHubTeams').add({ name: 'New', leaderId: 'U-part', ...created('U-admin') }));
  await assertFails(lead.collection('officeHubTeams').add({ name: 'New', leaderId: 'U-lead', ...created('U-lead') }));
});

test('files: uploaded as yourself; removed by Documents Delete or the record they belong to', async () => {
  await assertSucceeds(as(env, 'admin').collection('officeHubDocuments').add({ fileName: 'c.pdf', uploadedById: 'U-admin', entityType: 'meeting', entityId: 'm1', ...created('U-admin') }));
  await assertFails(as(env, 'viewer').collection('officeHubDocuments').add({ fileName: 'c.pdf', uploadedById: 'U-viewer', ...created('U-viewer') }));
  const remove = (who) => ({ isDeleted: true, deletedBy: who, deletedByName: who, deletedAt: new Date(), ...stamp(who) });
  await assertSucceeds(as(env, 'asg').doc('officeHubDocuments/doc1').update(remove('U-asg')));
  await assertSucceeds(as(env, 'org').doc('officeHubDocuments/doc2').update(remove('U-org')));
  await seed(env, { 'officeHubDocuments/doc2': { fileName: 'b.pdf', entityType: 'meeting', entityId: 'm1', meetingId: 'm1', uploadedById: 'U-admin', isDeleted: false, ...created('U-admin') } });
  await assertFails(as(env, 'viewer').doc('officeHubDocuments/doc2').update(remove('U-viewer')));
  await assertFails(as(env, 'org').doc('officeHubDocuments/doc2').update({ fileName: 'x', ...stamp('U-org') }));
  // A decision's file, by the decision's owner.
  await assertFails(as(env, 'viewer').doc('officeHubDocuments/doc3').update(remove('U-viewer')));
  await assertSucceeds(as(env, 'part').doc('officeHubDocuments/doc3').update(remove('U-part')));
});

test('reminders: scheduled and cancelled by the module, read by their recipient', async () => {
  const org = as(env, 'org');
  // cancelRemindersFor: no user filter.
  const snap = await org.collection('officeHubReminders').where('entityType', '==', 'meeting').where('entityId', '==', 'm1')
    .where('status', '==', 'Scheduled').limit(500).get();
  const batch = org.batch();
  for (const entry of snap.docs) batch.update(entry.ref, { status: 'Cancelled', updatedAt: new Date() });
  await assertSucceeds(batch.commit());
  await assertSucceeds(org.doc('officeHubReminders/meeting_m1_U-part_before_15').set({ entityType: 'meeting', entityId: 'm1', userId: 'U-part', status: 'Scheduled' }));
  await assertFails(org.doc('officeHubReminders/meeting_m1_U-part_before_15').update({ status: 'Sent' }));
  await assertFails(org.doc('officeHubReminders/meeting_m1_U-part_before_15').update({ userId: 'U-org' }));
  await assertFails(as(env, 'out').doc('officeHubReminders/meeting_m1_U-part_before_15').update({ status: 'Cancelled' }));
});

test('templates, settings and preferences', async () => {
  await assertSucceeds(as(env, 'org').doc('officeHubMeetingTemplates/mt1').update({ usageCount: 4 }));
  await assertFails(as(env, 'org').doc('officeHubMeetingTemplates/mt1').update({ usageCount: 10 }));
  await assertFails(as(env, 'org').doc('officeHubMeetingTemplates/mt1').update({ name: 'x' }));
  await assertSucceeds(as(env, 'admin').doc('officeHubMeetingTemplates/mt1').update({ status: 'Archived', ...stamp('U-admin') }));
  await assertSucceeds(as(env, 'admin').collection('officeHubAgendaTemplates').add({ name: 'x', items: [] }));
  await assertFails(as(env, 'viewer').collection('officeHubAgendaTemplates').add({ name: 'x', items: [] }));
  await assertSucceeds(as(env, 'viewer').collection('officeHubMeetingTemplates').limit(200).get());

  await assertSucceeds(as(env, 'admin').doc('officeHubSettings/global').set({ maxUploadMb: 20 }, { merge: true }));
  await assertFails(as(env, 'viewer').doc('officeHubSettings/global').set({ maxUploadMb: 20 }, { merge: true }));

  await assertSucceeds(as(env, 'part').doc('officeHubUserSettings/U-part').set({ meetingReminders: false, ...stamp('U-part') }, { merge: true }));
  await assertSucceeds(as(env, 'out').doc('officeHubUserSettings/U-out').get());
  await assertFails(as(env, 'part').doc('officeHubUserSettings/U-viewer').set({ meetingReminders: false }, { merge: true }));
  await assertFails(as(env, 'part').doc('officeHubUserSettings/part').set({ meetingReminders: false }, { merge: true }));
  await assertFails(as(env, 'out').doc('officeHubUserSettings/U-part').get());
});

test('still closed: the Google tokens, and every write to a signed-out client', async () => {
  await assertFails(as(env, 'admin').doc('officeHubGoogleConnections/U-admin').get());
  await assertFails(as(env, null).collection('officeHubTasks').add({ title: 'x' }));
  await assertFails(as(env, 'nodoc').doc('officeHubSettings/global').get());
});

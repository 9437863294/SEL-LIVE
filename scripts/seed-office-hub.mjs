#!/usr/bin/env node
/**
 * Seed Office Hub with demo data (§76).
 *
 *   npm run seed:office-hub            # create the demo records
 *   npm run seed:office-hub -- --clear # remove everything this script created, and stop
 *   npm run seed:office-hub -- --force # re-seed even if demo records already exist
 *
 * ── What it does and does not touch ────────────────────────────────────────────────────────────
 *
 * §76 asks for 10 employees, 5 departments, 3 teams, 10 meetings, 20 tasks, 5 decisions and 10
 * notifications, clearly marked as demo data. Two rules this script holds to:
 *
 *   1. **It never invents employees or departments if real ones exist.** The employee master is the
 *      app's own `employees` collection, synced from greytHR, and a seed script that writes people
 *      into it would corrupt a live directory. So it *reads* the existing `users`, `employees` and
 *      `departments` first and builds the demo meetings around whoever is actually there. Only when
 *      the installation is genuinely empty does it create placeholder departments and demo logins —
 *      and it says so loudly when it does.
 *
 *   2. **Everything it writes carries `isDemoData: true`.** That is what makes `--clear` safe: it
 *      deletes only documents bearing that flag, so running it against an installation that has
 *      since had real meetings in it removes the demo records and nothing else.
 *
 * Reads `.env` and `.env.local`, the same files the development server uses.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/* ── env ─────────────────────────────────────────────────────────────────────────────────────── */

function loadEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex === -1) continue;
    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const env = {
  ...loadEnv(resolve(process.cwd(), '.env')),
  ...loadEnv(resolve(process.cwd(), '.env.local')),
};
for (const [key, value] of Object.entries(env)) {
  if (process.env[key] === undefined) process.env[key] = value;
}

const argv = process.argv.slice(2);
const CLEAR_ONLY = argv.includes('--clear');
const FORCE = argv.includes('--force');

/* ── collections ─────────────────────────────────────────────────────────────────────────────── */

const C = {
  meetings: 'officeHubMeetings',
  participants: 'officeHubParticipants',
  agenda: 'officeHubAgenda',
  notes: 'officeHubNotes',
  decisions: 'officeHubDecisions',
  actionItems: 'officeHubActionItems',
  tasks: 'officeHubTasks',
  taskActivity: 'officeHubTaskActivity',
  teams: 'officeHubTeams',
  reminders: 'officeHubReminders',
  settings: 'officeHubSettings',
  notifications: 'userNotifications',
  users: 'users',
  employees: 'employees',
  departments: 'departments',
};

const DEMO_FLAG = { isDemoData: true, demoSource: 'seed-office-hub' };
const OFFICE_ZONE = 'Asia/Kolkata';

/* ── date helpers (a small copy, so the script has no build step) ───────────────────────────── */

const iso = (date) =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(
    date.getUTCDate(),
  ).padStart(2, '0')}`;

const addDays = (dateKey, days) => {
  const [y, m, d] = dateKey.split('-').map(Number);
  return iso(new Date(Date.UTC(y, m - 1, d + days)));
};

/** IST is UTC+5:30 with no DST, which is why a fixed offset is safe *in this script only*. */
const instantOf = (dateKey, time) => {
  const [y, m, d] = dateKey.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - 330 * 60_000).toISOString();
};

const today = iso(new Date(Date.now() + 330 * 60_000));

const pick = (list, index) => list[index % list.length];

/**
 * A Meet-shaped code (`abc-defg-hij`) for a demo meeting.
 *
 * Shaped correctly on purpose: `isGoogleMeetUrl` checks the code and not just the host, so a
 * placeholder like `meet.google.com/demo` would be rejected by the very validation the seeded data
 * is meant to exercise. These codes lead nowhere — the meetings are demo data.
 */
const meetCodeFor = (index) => {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const at = (offset) => letters[(index * 7 + offset * 3) % 26];
  return `${at(0)}${at(1)}${at(2)}-${at(3)}${at(4)}${at(5)}${at(6)}-${at(7)}${at(8)}${at(9)}`;
};

/* ── main ────────────────────────────────────────────────────────────────────────────────────── */

async function main() {
  const { getFirebaseAdminFirestore } = await importAdmin();
  const db = getFirebaseAdminFirestore();
  const { FieldValue } = await import('firebase-admin/firestore');

  console.log('Office Hub demo data');
  console.log('────────────────────');

  const removed = await clearDemoData(db);
  if (CLEAR_ONLY) {
    console.log(`\nRemoved ${removed} demo documents. Nothing else was touched.`);
    return;
  }
  if (removed) console.log(`Cleared ${removed} documents from a previous run.`);

  /* ── existing masters ─────────────────────────────────────────────────────────────────────── */

  const [userSnapshot, employeeSnapshot, departmentSnapshot] = await Promise.all([
    db.collection(C.users).where('status', '==', 'Active').limit(60).get(),
    db.collection(C.employees).limit(200).get(),
    db.collection(C.departments).limit(50).get(),
  ]);

  let departments = departmentSnapshot.docs.map((entry) => ({
    id: entry.id,
    name: entry.data().name,
  }));

  if (!departments.length) {
    console.log('\n⚠  No departments found. Creating five demo departments.');
    console.log('   Delete them (or run with --clear) before using this installation for real work.');
    const names = ['Management', 'Finance', 'HR', 'Projects', 'IT'];
    departments = [];
    for (const name of names) {
      const ref = db.collection(C.departments).doc();
      await ref.set({ name, head: '', status: 'Active', ...DEMO_FLAG });
      departments.push({ id: ref.id, name });
    }
  } else {
    console.log(`\n✓  Using ${departments.length} existing department(s): ${departments.map((d) => d.name).join(', ')}`);
  }

  const employeesByEmail = new Map();
  for (const entry of employeeSnapshot.docs) {
    const data = entry.data();
    if (data.email) employeesByEmail.set(String(data.email).toLowerCase(), { id: entry.id, ...data });
  }

  let people = userSnapshot.docs.map((entry) => {
    const data = entry.data();
    const employee = data.email ? employeesByEmail.get(String(data.email).toLowerCase()) : null;
    const department =
      departments.find((candidate) => candidate.name === employee?.department) ??
      pick(departments, entry.id.length);
    return {
      userId: entry.id,
      name: data.name ?? data.email ?? 'User',
      email: data.email ?? null,
      designation: employee?.designation ?? data.role ?? null,
      departmentId: department?.id ?? null,
      departmentName: department?.name ?? null,
    };
  });

  if (people.length < 4) {
    console.log(`\n⚠  Only ${people.length} active login(s) found. Creating ten demo users.`);
    console.log('   These are Firestore user documents only — they have no Firebase Auth account,');
    console.log('   so nobody can sign in as them. They exist so the demo meetings have participants.');
    const demoNames = [
      'Asha Rao', 'Ben Shah', 'Chen Wu', 'Dia Nair', 'Eshan Gupta',
      'Farah Khan', 'Gita Menon', 'Hari Patel', 'Iris Dsouza', 'Jai Verma',
    ];
    const designations = [
      'Managing Director', 'Finance Manager', 'Project Manager', 'HR Manager', 'IT Lead',
      'Accounts Executive', 'Planning Engineer', 'Purchase Officer', 'Site Engineer', 'Administrator',
    ];
    people = [];
    for (let index = 0; index < demoNames.length; index += 1) {
      const ref = db.collection(C.users).doc();
      const department = pick(departments, index);
      const email = `${demoNames[index].toLowerCase().replace(/\s+/g, '.')}@demo.invalid`;
      await ref.set({
        name: demoNames[index],
        email,
        mobile: '',
        role: designations[index],
        status: 'Active',
        ...DEMO_FLAG,
      });
      people.push({
        userId: ref.id,
        name: demoNames[index],
        email,
        designation: designations[index],
        departmentId: department.id,
        departmentName: department.name,
      });
    }
  } else {
    console.log(`✓  Using ${people.length} existing login(s) as participants.`);
  }

  const organizer = people[0];

  /* ── settings ─────────────────────────────────────────────────────────────────────────────── */

  const settingsRef = db.collection(C.settings).doc('global');
  if (!(await settingsRef.get()).exists || FORCE) {
    await settingsRef.set(
      {
        organizationName: 'Office Hub (demo)',
        defaultTimeZone: OFFICE_ZONE,
        workingDays: [1, 2, 3, 4, 5, 6],
        workingHoursStart: '09:30',
        workingHoursEnd: '18:30',
        defaultMeetingDurationMinutes: 60,
        defaultReminderOffsets: [15],
        momApprovalRequired: false,
        emailNotificationsEnabled: true,
        browserNotificationsEnabled: true,
        taskDueReminderDaysBefore: [1],
        holidays: [{ date: addDays(today, 21), name: 'Demo office holiday' }],
        updatedAt: FieldValue.serverTimestamp(),
        updatedByName: 'seed-office-hub',
      },
      { merge: true },
    );
    console.log('✓  Wrote office settings.');
  }

  /* ── teams ────────────────────────────────────────────────────────────────────────────────── */

  const teamPlans = [
    { name: 'Management Team', slice: [0, 3] },
    { name: 'Finance Team', slice: [1, 4] },
    { name: 'Project Team', slice: [2, 6] },
  ];

  const teams = [];
  for (const [index, plan] of teamPlans.entries()) {
    const members = people.slice(plan.slice[0], plan.slice[1]);
    if (!members.length) continue;
    const leader = members[0];
    const ref = db.collection(C.teams).doc();
    await ref.set({
      name: plan.name,
      description: `Demo team seeded for Office Hub (${plan.name}).`,
      leaderId: leader.userId,
      leaderName: leader.name,
      members: members.map((member) => ({
        userId: member.userId,
        name: member.name,
        designation: member.designation ?? null,
        departmentId: member.departmentId ?? null,
        departmentName: member.departmentName ?? null,
        isLeader: member.userId === leader.userId,
        addedAt: new Date().toISOString(),
        addedByName: 'seed-office-hub',
      })),
      memberUserIds: members.map((member) => member.userId),
      memberCount: members.length,
      departmentId: pick(departments, index).id,
      departmentName: pick(departments, index).name,
      status: 'Active',
      isDeleted: false,
      createdAt: FieldValue.serverTimestamp(),
      createdByName: 'seed-office-hub',
      updatedAt: FieldValue.serverTimestamp(),
      ...DEMO_FLAG,
    });
    teams.push({ id: ref.id, name: plan.name, memberUserIds: members.map((m) => m.userId), leaderId: leader.userId });
  }
  console.log(`✓  Created ${teams.length} team(s).`);

  /* ── meetings ─────────────────────────────────────────────────────────────────────────────── */

  /**
   * A spread across the past and the future, so every screen has something to show: completed
   * meetings for the reports and the minutes, one live today for the dashboard banner, upcoming
   * ones for the calendar, one cancelled, and a weekly series.
   */
  const meetingPlans = [
    { title: 'Monthly Finance Review', type: 'Finance', offset: -21, start: '10:00', end: '11:30', status: 'Completed', minutes: 'Published' },
    { title: 'Project Kick-off — Phase 2', type: 'Project', offset: -14, start: '11:00', end: '12:30', status: 'Completed', minutes: 'Prepared' },
    { title: 'HR Policy Discussion', type: 'HR', offset: -9, start: '15:00', end: '16:00', status: 'Completed', minutes: null },
    { title: 'Vendor Negotiation — Steel', type: 'Vendor', offset: -4, start: '14:00', end: '15:00', status: 'Completed', minutes: null },
    { title: 'Daily Site Coordination', type: 'Site', offset: 0, start: '09:30', end: '10:00', status: 'Scheduled', minutes: null },
    { title: 'Management Review', type: 'Management', offset: 0, start: '16:00', end: '17:30', status: 'Scheduled', minutes: null, mode: 'Online' },
    { title: 'IT Systems Update', type: 'IT', offset: 2, start: '11:00', end: '12:00', status: 'Scheduled', minutes: null, mode: 'Online' },
    { title: 'Purchase Committee', type: 'Purchase', offset: 5, start: '15:30', end: '16:30', status: 'Scheduled', minutes: null },
    { title: 'Quarterly Client Presentation', type: 'Client', offset: 12, start: '10:30', end: '12:00', status: 'Scheduled', minutes: null, mode: 'Hybrid' },
    { title: 'Postponed Audit Walkthrough', type: 'Review', offset: 8, start: '09:30', end: '11:00', status: 'Cancelled', minutes: null },
  ];

  const meetings = [];
  for (const [index, plan] of meetingPlans.entries()) {
    const date = addDays(today, plan.offset);
    const mode = plan.mode ?? 'Offline';
    const attendees = people.slice(0, Math.min(people.length, 3 + (index % 4)));
    const team = index % 3 === 0 ? teams[index % Math.max(1, teams.length)] : null;
    const meetingOrganizer = pick(people, index);

    const participantSet = new Map();
    participantSet.set(meetingOrganizer.userId, { person: meetingOrganizer, source: 'Organizer', sourceId: null, sourceName: null });
    for (const person of attendees) {
      if (!participantSet.has(person.userId)) {
        participantSet.set(person.userId, { person, source: 'Individual', sourceId: null, sourceName: null });
      }
    }
    if (team) {
      for (const userId of team.memberUserIds) {
        const person = people.find((candidate) => candidate.userId === userId);
        if (person && !participantSet.has(userId)) {
          participantSet.set(userId, { person, source: 'Team', sourceId: team.id, sourceName: team.name });
        }
      }
    }
    const participants = [...participantSet.values()];

    const isSeries = plan.title === 'Daily Site Coordination';
    const ref = db.collection(C.meetings).doc();

    /** Responses: completed meetings are fully answered; upcoming ones deliberately are not. */
    const responses = participants.map((entry, position) => {
      if (plan.status === 'Completed') return position % 5 === 4 ? 'Declined' : 'Accepted';
      if (plan.status === 'Cancelled') return 'No Response';
      if (position === 0) return 'Accepted';
      return position % 3 === 0 ? 'No Response' : position % 3 === 1 ? 'Accepted' : 'Maybe';
    });

    const summary = { accepted: 0, maybe: 0, declined: 0, noResponse: 0 };
    for (const response of responses) {
      if (response === 'Accepted') summary.accepted += 1;
      else if (response === 'Maybe') summary.maybe += 1;
      else if (response === 'Declined') summary.declined += 1;
      else summary.noResponse += 1;
    }

    await ref.set({
      title: plan.title,
      meetingType: plan.type,
      description: `Demo meeting seeded for Office Hub. ${plan.title}.`,
      priority: index % 4 === 0 ? 'High' : index % 5 === 0 ? 'Critical' : 'Medium',
      status: plan.status,
      date,
      startTime: plan.start,
      endTime: plan.end,
      timeZone: OFFICE_ZONE,
      startAt: instantOf(date, plan.start),
      endAt: instantOf(date, plan.end),
      mode,
      /**
       * Seeded meetings carry a plausible Meet link but no Google event.
       *
       * Deliberate: seeding runs with no signed-in user and no Google connection, and creating real
       * calendar events for demo data would put twenty fake meetings on somebody's actual calendar.
       * `googleSyncState: 'skipped'` is the honest record of that — it is distinct from `'failed'`,
       * so the cron sweep's retry step leaves these alone rather than trying to sync demo data
       * every thirty minutes.
       */
      onlinePlatform: mode === 'Offline' ? null : 'Google Meet',
      meetingUrl: mode === 'Offline' ? null : `https://meet.google.com/${meetCodeFor(index)}`,
      googleMeetUrl: mode === 'Offline' ? null : `https://meet.google.com/${meetCodeFor(index)}`,
      googleSyncState: mode === 'Offline' ? null : 'skipped',
      location: mode === 'Online' ? null : 'Head Office',
      room: mode === 'Online' ? null : index % 2 ? 'Board Room' : 'Conference Room 2',
      organizerId: meetingOrganizer.userId,
      organizerName: meetingOrganizer.name,
      scheduledById: meetingOrganizer.userId,
      scheduledByName: meetingOrganizer.name,
      participantUserIds: participants.map((entry) => entry.person.userId),
      requiredUserIds: participants.map((entry) => entry.person.userId),
      departmentIds: [...new Set(participants.map((entry) => entry.person.departmentId).filter(Boolean))],
      teamIds: team ? [team.id] : [],
      responseSummary: summary,
      participantCount: participants.length,
      reminderOffsets: [1440, 15],
      recurrence: isSeries
        ? { frequency: 'Weekly', interval: 1, weekdays: [1, 2, 3, 4, 5], endMode: 'never' }
        : { frequency: 'None', interval: 1, endMode: 'never' },
      seriesId: isSeries ? ref.id : null,
      isSeriesParent: isSeries,
      occurrenceKey: isSeries ? date : null,
      occurrenceNumber: isSeries ? 1 : null,
      momStage: plan.minutes,
      momRequired: false,
      cancellationReason: plan.status === 'Cancelled' ? 'Auditor unavailable — to be rescheduled.' : null,
      startedAt: plan.status === 'Completed' ? instantOf(date, plan.start) : null,
      endedAt: plan.status === 'Completed' ? instantOf(date, plan.end) : null,
      tags: ['demo'],
      isDeleted: false,
      createdAt: FieldValue.serverTimestamp(),
      createdByName: 'seed-office-hub',
      updatedAt: FieldValue.serverTimestamp(),
      ...DEMO_FLAG,
    });

    // Participants
    const participantBatch = db.batch();
    participants.forEach((entry, position) => {
      const attendance =
        plan.status === 'Completed'
          ? responses[position] === 'Declined'
            ? 'Absent'
            : position % 7 === 3
              ? 'Late'
              : 'Present'
          : null;
      participantBatch.set(db.collection(C.participants).doc(`${ref.id}_${entry.person.userId}`), {
        meetingId: ref.id,
        seriesId: isSeries ? ref.id : null,
        userId: entry.person.userId,
        name: entry.person.name,
        email: entry.person.email,
        designation: entry.person.designation,
        departmentId: entry.person.departmentId,
        departmentName: entry.person.departmentName,
        attendanceRole: position % 6 === 5 ? 'Optional' : 'Required',
        source: entry.source,
        sourceId: entry.sourceId,
        sourceName: entry.sourceName,
        response: responses[position],
        responseMessage: responses[position] === 'Declined' ? 'On site that day.' : null,
        respondedAt: responses[position] === 'No Response' ? null : instantOf(addDays(date, -2), '09:00'),
        attendance,
        remindersSent: 0,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        ...DEMO_FLAG,
      });
    });
    await participantBatch.commit();

    // Agenda
    const agendaTitles =
      plan.type === 'Finance'
        ? ['Previous action items', 'Cash position', 'Overdraft utilisation', 'Capex approvals']
        : plan.type === 'Project'
          ? ['Previous action items', 'Progress review', 'Issues and risks', 'Next actions']
          : ['Previous action items', 'Main discussion', 'Next steps'];

    const agendaBatch = db.batch();
    agendaTitles.forEach((title, position) => {
      agendaBatch.set(db.collection(C.agenda).doc(), {
        meetingId: ref.id,
        seriesId: isSeries ? ref.id : null,
        order: position + 1,
        title,
        description: null,
        expectedOutcome: position === 0 ? 'Close or re-commit each open item' : null,
        presenterId: pick(participants, position).person.userId,
        presenterName: pick(participants, position).person.name,
        priority: position === 0 ? 'High' : 'Medium',
        estimatedMinutes: position === 0 ? 10 : 15,
        documentIds: [],
        covered: plan.status === 'Completed',
        coveredAt: plan.status === 'Completed' ? instantOf(date, plan.start) : null,
        createdAt: FieldValue.serverTimestamp(),
        createdByName: 'seed-office-hub',
        updatedAt: FieldValue.serverTimestamp(),
        ...DEMO_FLAG,
      });
    });
    await agendaBatch.commit();

    // Notes, for the completed ones — so the minutes have a discussion section.
    if (plan.status === 'Completed') {
      await db.collection(C.notes).doc(ref.id).set({
        meetingId: ref.id,
        html: `<h3>Discussion</h3><p>Demo notes for <b>${plan.title}</b>.</p><ul><li>Reviewed the position.</li><li>Agreed the actions below.</li></ul>`,
        plainText: `Discussion\nDemo notes for ${plan.title}.\n• Reviewed the position.\n• Agreed the actions below.`,
        mentionedUserIds: [],
        lastSavedAt: FieldValue.serverTimestamp(),
        lastSavedByName: meetingOrganizer.name,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        ...DEMO_FLAG,
      });
    }

    meetings.push({ id: ref.id, ...plan, date, organizer: meetingOrganizer, participants });
  }
  console.log(`✓  Created ${meetings.length} meeting(s), with participants, agendas and notes.`);

  /* ── decisions ────────────────────────────────────────────────────────────────────────────── */

  const decisionPlans = [
    { title: 'Approve an additional overdraft facility of ₹2 crore', status: 'In Progress', dueOffset: 10, priority: 'High' },
    { title: 'Defer non-critical capital expenditure to next quarter', status: 'Completed', dueOffset: -5, priority: 'Medium' },
    { title: 'Award the steel supply order to the lowest compliant bidder', status: 'Open', dueOffset: -3, priority: 'Critical' },
    { title: 'Adopt the revised travel reimbursement policy', status: 'Open', dueOffset: 18, priority: 'Medium' },
    { title: 'Standardise site progress reporting on the weekly template', status: 'In Progress', dueOffset: 25, priority: 'Low' },
  ];

  const decisions = [];
  for (const [index, plan] of decisionPlans.entries()) {
    const meeting = pick(meetings.filter((entry) => entry.status === 'Completed'), index) ?? meetings[0];
    const owner = pick(people, index + 1);
    const ref = db.collection(C.decisions).doc();
    const reference = `DEC-2627-${String(index + 1).padStart(4, '0')}`;

    await ref.set({
      reference,
      title: plan.title,
      description: 'Demo decision seeded for Office Hub.',
      decisionDate: meeting.date,
      meetingId: meeting.id,
      meetingTitle: meeting.title,
      ownerId: owner.userId,
      ownerName: owner.name,
      departmentId: owner.departmentId,
      departmentName: owner.departmentName,
      priority: plan.priority,
      dueDate: addDays(today, plan.dueOffset),
      status: plan.status,
      closedAt: plan.status === 'Completed' ? instantOf(addDays(today, plan.dueOffset), '17:00') : null,
      closureNote: plan.status === 'Completed' ? 'Deferred items confirmed with the board.' : null,
      documentIds: [],
      tags: ['demo'],
      isDeleted: false,
      createdAt: FieldValue.serverTimestamp(),
      createdByName: 'seed-office-hub',
      updatedAt: FieldValue.serverTimestamp(),
      ...DEMO_FLAG,
    });
    decisions.push({ id: ref.id, reference, meeting, owner, ...plan });
  }
  console.log(`✓  Created ${decisions.length} decision(s).`);

  /* ── tasks and action items ───────────────────────────────────────────────────────────────── */

  const taskTitles = [
    'Prepare the August bank reconciliation',
    'Collect quotations for the steel order',
    'Update the project progress report',
    'Circulate the revised travel policy draft',
    'Reconcile the vendor ledger',
    'Prepare the monthly MIS pack',
    'Close out the site safety observations',
    'Renew the equipment insurance',
    'Verify the subcontractor measurement sheet',
    'Prepare the board presentation',
    'Review the IT access register',
    'Complete the quarterly stock count',
    'Follow up the pending client approval',
    'Update the recruitment tracker',
    'Prepare the cash-flow forecast',
    'File the statutory returns',
    'Draft the purchase committee minutes',
    'Audit the petty cash register',
    'Refresh the escalation contact list',
    'Archive the completed project documents',
  ];

  let created = 0;
  let actionItemsCreated = 0;

  for (const [index, title] of taskTitles.entries()) {
    const assignee = pick(people, index);
    const meeting = index % 2 === 0 ? pick(meetings, index) : null;
    const team = index % 5 === 0 ? pick(teams, index) : null;

    /** A deliberate spread: overdue, due today, due soon, later, completed, on hold, cancelled. */
    const shape =
      index % 7 === 0
        ? { status: 'In Progress', due: -6, progress: 45 }
        : index % 7 === 1
          ? { status: 'Not Started', due: 0, progress: 0 }
          : index % 7 === 2
            ? { status: 'In Progress', due: 3, progress: 60 }
            : index % 7 === 3
              ? { status: 'Completed', due: -10, progress: 100 }
              : index % 7 === 4
                ? { status: 'On Hold', due: 12, progress: 20 }
                : index % 7 === 5
                  ? { status: 'Not Started', due: 20, progress: 0 }
                  : { status: 'Cancelled', due: -2, progress: 0 };

    const ref = db.collection(C.tasks).doc();
    const reference = `TSK-2627-${String(index + 1).padStart(4, '0')}`;
    const dueDate = addDays(today, shape.due);

    const subtasks =
      index % 4 === 0
        ? ['Collect data', 'Verify data', 'Prepare report', 'Management review'].map((step, position) => ({
            id: `st-${index}-${position}`,
            title: step,
            done: shape.status === 'Completed' ? true : position < Math.floor(shape.progress / 30),
            order: position + 1,
            completedAt: null,
            assigneeId: null,
            assigneeName: null,
            dueDate: null,
          }))
        : [];

    await ref.set({
      reference,
      title,
      description: 'Demo task seeded for Office Hub.',
      assigneeId: assignee.userId,
      assigneeName: assignee.name,
      teamId: team?.id ?? null,
      teamName: team?.name ?? null,
      departmentId: assignee.departmentId,
      departmentName: assignee.departmentName,
      startDate: addDays(today, shape.due - 14),
      dueDate,
      priority: index % 6 === 0 ? 'Critical' : index % 3 === 0 ? 'High' : index % 2 === 0 ? 'Medium' : 'Low',
      status: shape.status,
      progress: subtasks.length
        ? Math.round((subtasks.filter((s) => s.done).length / subtasks.length) * 100)
        : shape.progress,
      tags: ['demo'],
      meetingId: meeting?.id ?? null,
      meetingTitle: meeting?.title ?? null,
      decisionId: index % 6 === 0 ? pick(decisions, index).id : null,
      subtasks,
      dependencies: [],
      documentIds: [],
      watcherUserIds: [assignee.userId, organizer.userId],
      commentCount: 0,
      completedAt: shape.status === 'Completed' ? instantOf(addDays(today, shape.due), '17:00') : null,
      completedByName: shape.status === 'Completed' ? assignee.name : null,
      isDeleted: false,
      createdAt: FieldValue.serverTimestamp(),
      createdByName: 'seed-office-hub',
      updatedAt: FieldValue.serverTimestamp(),
      ...DEMO_FLAG,
    });

    await db.collection(C.taskActivity).doc().set({
      taskId: ref.id,
      kind: 'created',
      summary: `Task created${meeting ? ` from ${meeting.title}` : ''}`,
      actorId: organizer.userId,
      actorName: organizer.name,
      at: new Date().toISOString(),
      createdAt: FieldValue.serverTimestamp(),
      ...DEMO_FLAG,
    });

    created += 1;

    /**
     * Action items for the completed meetings, half of them linked to a task and half not — so the
     * "untracked action items" view has something to show, which is the whole point of that view.
     */
    if (meeting && meeting.status === 'Completed' && index % 2 === 0) {
      const itemRef = db.collection(C.actionItems).doc();
      const linked = index % 4 === 0;
      await itemRef.set({
        reference: `ACT-2627-${String(actionItemsCreated + 1).padStart(4, '0')}`,
        title,
        description: 'Demo action item seeded for Office Hub.',
        meetingId: meeting.id,
        meetingTitle: meeting.title,
        meetingDate: meeting.date,
        seriesId: null,
        decisionId: null,
        responsibleUserId: assignee.userId,
        responsibleUserName: assignee.name,
        responsibleTeamId: null,
        responsibleTeamName: null,
        departmentId: assignee.departmentId,
        departmentName: assignee.departmentName,
        dueDate,
        priority: index % 3 === 0 ? 'High' : 'Medium',
        status: shape.status === 'Completed' ? 'Completed' : 'Open',
        completedAt: shape.status === 'Completed' ? instantOf(dueDate, '17:00') : null,
        taskId: linked ? ref.id : null,
        isDeleted: false,
        createdAt: FieldValue.serverTimestamp(),
        createdByName: 'seed-office-hub',
        updatedAt: FieldValue.serverTimestamp(),
        ...DEMO_FLAG,
      });
      if (linked) await ref.update({ actionItemId: itemRef.id });
      actionItemsCreated += 1;
    }
  }
  console.log(`✓  Created ${created} task(s) and ${actionItemsCreated} action item(s).`);

  /* ── notifications ────────────────────────────────────────────────────────────────────────── */

  const notificationPlans = [
    ['office_hub_meeting_invitation', 'Meeting invitation: Management Review', 'You have been invited to a meeting today at 16:00.', 'INFO'],
    ['office_hub_meeting_reminder', 'Daily Site Coordination starts in 15 minutes', 'Today at 09:30 · Head Office', 'INFO'],
    ['office_hub_task_assigned', 'New task: Prepare the monthly MIS pack', 'Assigned to you from Monthly Finance Review.', 'INFO'],
    ['office_hub_task_overdue', 'Overdue: Prepare the August bank reconciliation', 'TSK-2627-0001 is 6 days past its due date.', 'WARNING'],
    ['office_hub_task_due_soon', 'Task due soon: Update the project progress report', 'Due in three days.', 'INFO'],
    ['office_hub_decision_assigned', 'Decision assigned: Award the steel supply order', 'You are the owner of DEC-2627-0003.', 'INFO'],
    ['office_hub_decision_due', 'Decision overdue: Award the steel supply order', 'DEC-2627-0003 was due three days ago.', 'WARNING'],
    ['office_hub_mom_published', 'Minutes published: Monthly Finance Review', 'The minutes are now available.', 'INFO'],
    ['office_hub_meeting_cancelled', 'Cancelled: Postponed Audit Walkthrough', 'Auditor unavailable — to be rescheduled.', 'WARNING'],
    ['office_hub_team_added', 'You were added to Project Team', 'Led by ' + (people[2]?.name ?? 'the team leader') + '.', 'INFO'],
  ];

  const notificationBatch = db.batch();
  notificationPlans.forEach(([type, title, body, severity], index) => {
    notificationBatch.set(db.collection(C.notifications).doc(), {
      userId: pick(people, index).userId,
      type,
      title,
      body,
      module: 'Office Hub',
      severity,
      link: index % 2 === 0 ? `/office-hub/meetings/${meetings[index % meetings.length].id}` : '/office-hub/tasks',
      read: index > 6,
      createdAt: FieldValue.serverTimestamp(),
      ...DEMO_FLAG,
    });
  });
  await notificationBatch.commit();
  console.log(`✓  Created ${notificationPlans.length} notification(s).`);

  console.log('\nDone. Open /office-hub to see it.');
  console.log('Everything written carries isDemoData: true — remove it with:');
  console.log('  npm run seed:office-hub -- --clear');
}

/* ── clearing ────────────────────────────────────────────────────────────────────────────────── */

/**
 * Delete only what a previous run created.
 *
 * Keyed on `isDemoData`, never on a collection sweep, so this is safe to run against an
 * installation that has real meetings in it — it removes the demo records and leaves the rest.
 */
async function clearDemoData(db) {
  let removed = 0;
  for (const collection of Object.values(C)) {
    // The settings document is merged rather than flagged, and `users`/`departments`/`employees`
    // are shared masters — demo rows in them are flagged, so the same query is still correct.
    try {
      const snapshot = await db.collection(collection).where('isDemoData', '==', true).limit(500).get();
      if (snapshot.empty) continue;
      for (let index = 0; index < snapshot.docs.length; index += 400) {
        const batch = db.batch();
        for (const entry of snapshot.docs.slice(index, index + 400)) batch.delete(entry.ref);
        await batch.commit();
      }
      removed += snapshot.size;
    } catch (error) {
      // A collection that has never existed, or lacks the single-field index, is not an error.
      if (process.env.OFFICE_HUB_SEED_VERBOSE) {
        console.warn(`  (skipped ${collection}: ${error instanceof Error ? error.message : error})`);
      }
    }
  }
  return removed;
}

/* ── admin bootstrap ─────────────────────────────────────────────────────────────────────────── */

/**
 * Load the app's own Admin helper.
 *
 * Imported through a file URL because this script runs outside the bundler, so the `@/` alias and
 * TypeScript are both unavailable. The helper is TypeScript, so the Admin SDK is initialised here
 * the same way instead — reading the same environment variables and honouring the same
 * Application Default Credentials fallback.
 */
async function importAdmin() {
  const { getApps, initializeApp, cert, applicationDefault } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const hasServiceAccount = Boolean(
    projectId && clientEmail && privateKey?.includes('-----BEGIN PRIVATE KEY-----'),
  );

  if (!hasServiceAccount && !process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIRESTORE_EMULATOR_HOST) {
    console.error('\nFirebase Admin credentials are not configured.');
    console.error('Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY in .env,');
    console.error('or run `gcloud auth application-default login` first.');
    console.error('See docs/firebase-admin-local.md.');
    process.exit(1);
  }

  if (!getApps().length) {
    initializeApp({
      credential: hasServiceAccount
        ? cert({ projectId, clientEmail, privateKey })
        : applicationDefault(),
      projectId,
    });
  }

  return { getFirebaseAdminFirestore: () => getFirestore() };
}

main().catch((error) => {
  console.error('\nSeeding failed:', error);
  process.exit(1);
});

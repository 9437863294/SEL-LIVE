import 'server-only';

import { getFirebaseAdminFirestore } from './firebase-admin';
import { E_APPROVAL_COLLECTIONS, OPEN_E_APPROVAL_STATUSES } from './e-approval';
import { OFFICE_HUB_COLLECTIONS } from './office-hub';
import { todayInZone } from './office-hub-time';
import { WINDOWS_AGENT_TIME_ZONE } from './windows-agent-rules';
import type { MorningSummary } from './windows-agent-model';

/**
 * §6's morning dashboard: the six numbers an employee sees between signing in and being released
 * into Windows.
 *
 * Every figure is read from the module that owns it — approvals from `eApprovalRequests`, tasks
 * and meetings from Office Hub, the unread count from `userNotifications`. Nothing is recomputed
 * or cached here, and no new collection is introduced, which is §56's instruction not to build a
 * parallel system: if somebody clears their approval inbox in the browser, the next morning's
 * count is right without anything having to be told.
 *
 * ── Why every query is guarded and every failure is a zero ─────────────────────────────────────
 *
 * This runs on the critical path of somebody starting work. If the Office Hub index is missing on
 * a fresh installation, or the E-Approval collection does not exist yet because the module has not
 * been rolled out, the correct outcome is a dashboard that says "0 approvals" — not a sign-in that
 * fails and a person who cannot use their PC. So each query is independently caught and each
 * failure contributes zero, and the six reads run concurrently so the slowest one sets the latency
 * rather than the sum.
 *
 * The greeting is worth one line of explanation: it is computed from the office-local hour, not
 * the device's, because a laptop whose timezone was never set would otherwise wish somebody good
 * evening at nine in the morning — a small thing that makes the whole screen look broken.
 */

/** How many upcoming meetings the dashboard names rather than merely counts. */
const NAMED_MEETING_LIMIT = 3;

/** Upper bound on each count, so a pathological inbox cannot turn sign-in into a long read. */
const COUNT_LIMIT = 200;

function greetingFor(now: Date): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      hour: 'numeric',
      hour12: false,
      timeZone: WINDOWS_AGENT_TIME_ZONE,
    }).format(now),
  );
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** Count a query without pulling its documents, falling back to zero on any failure. */
async function safeCount(build: () => FirebaseFirestore.Query): Promise<number> {
  try {
    const snapshot = await build().limit(COUNT_LIMIT).count().get();
    return Number(snapshot.data().count || 0);
  } catch {
    return 0;
  }
}

export async function buildMorningSummary(options: {
  userId: string;
  userName: string;
  checkInAt: string;
  now?: Date;
}): Promise<MorningSummary> {
  const firestore = getFirebaseAdminFirestore();
  const now = options.now ?? new Date();
  const today = todayInZone(WINDOWS_AGENT_TIME_ZONE, now);

  const [pendingApprovals, pendingTasks, overdueTasks, unreadNotifications, reminders, meetings] =
    await Promise.all([
      // Approvals waiting on this person specifically — the inbox, not everything they can see.
      //
      // The status list is `OPEN_E_APPROVAL_STATUSES`, the same one `/e-approval/inbox` filters on.
      // It previously read `['PENDING', 'IN_PROGRESS', 'RETURNED']`, which are not members of
      // `EApprovalStatus` — the real values are Title Case with spaces ('Pending Approval',
      // 'Pending Verification', …). An `in` filter against values nothing stores matches nothing, so
      // this count was always zero and the morning screen told everybody their inbox was empty.
      safeCount(() =>
        firestore
          .collection(E_APPROVAL_COLLECTIONS.requests)
          .where('currentAssigneeIds', 'array-contains', options.userId)
          .where('status', 'in', OPEN_E_APPROVAL_STATUSES),
      ),
      safeCount(() =>
        firestore
          .collection(OFFICE_HUB_COLLECTIONS.tasks)
          .where('assigneeId', '==', options.userId)
          .where('status', 'in', ['Not Started', 'In Progress', 'On Hold']),
      ),
      // Overdue is a subset of pending, and is counted separately because §6 shows both.
      safeCount(() =>
        firestore
          .collection(OFFICE_HUB_COLLECTIONS.tasks)
          .where('assigneeId', '==', options.userId)
          .where('status', 'in', ['Not Started', 'In Progress', 'On Hold'])
          .where('dueDate', '<', today),
      ),
      safeCount(() =>
        firestore
          .collection('userNotifications')
          .where('userId', '==', options.userId)
          .where('read', '==', false),
      ),
      // 'Scheduled', not 'PENDING'. `ReminderStatus` is
      // `'Scheduled' | 'Sent' | 'Failed' | 'Cancelled'` and `office-hub-reminders.ts` only ever
      // writes 'Scheduled', so the previous predicate matched a value nothing stores and this count
      // was always zero — a morning dashboard that silently reported "0 reminders" to everybody.
      safeCount(() =>
        firestore
          .collection(OFFICE_HUB_COLLECTIONS.reminders)
          .where('userId', '==', options.userId)
          .where('status', '==', 'Scheduled'),
      ),
      firestore
        .collection(OFFICE_HUB_COLLECTIONS.meetings)
        .where('participantUserIds', 'array-contains', options.userId)
        .where('date', '==', today)
        .limit(20)
        .get()
        .catch(() => null),
    ]);

  const meetingDocs = (meetings?.docs ?? [])
    .filter((doc) => doc.get('status') !== 'Cancelled' && doc.get('isDeleted') !== true)
    .sort((left, right) =>
      String(left.get('startTime') || '').localeCompare(String(right.get('startTime') || '')),
    );

  const nextMeetings = meetingDocs.slice(0, NAMED_MEETING_LIMIT).map((doc) => ({
    id: doc.id,
    title: String(doc.get('title') || 'Meeting'),
    // Composed from the stored calendar date and clock time rather than a stored instant, because
    // that is how Office Hub models a meeting — see the note on timezones in `office-hub-time.ts`.
    startAt: `${today}T${String(doc.get('startTime') || '09:00')}:00`,
    link: `/office-hub/meetings/${doc.id}`,
  }));

  return {
    greeting: `${greetingFor(now)}, ${options.userName.split(' ')[0] || options.userName}`,
    checkInAt: options.checkInAt,
    pendingTasks,
    overdueTasks,
    pendingApprovals,
    meetingsToday: meetingDocs.length,
    reminders,
    unreadNotifications,
    nextMeetings,
  };
}

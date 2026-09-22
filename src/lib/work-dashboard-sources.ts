'use client';

/**
 * Where the central dashboard's rows come from.
 *
 * One entry per queue that can have work waiting in it, each declaring the module it belongs to, the
 * permission that admits the viewer to it, and a loader that returns `WorkItem`s. The registry shape
 * is deliberately the same idea as the `MODULES` array in
 * `src/app/api/workflow/check-escalations/route.ts` — which is the closest thing this codebase had
 * to a cross-module index of pending work — except that this one is typed, covers every module
 * rather than three, and returns rows to render rather than notifications to send.
 *
 * ── Three rules every loader follows ───────────────────────────────────────────────────────────
 *
 * 1. **One `where` clause, no `orderBy`.** Not a style preference: a single-field equality or
 *    `array-contains` with no sort is served by the automatic single-field index Firestore maintains
 *    for every field, so adding a source here needs no `firestore.indexes.json` change and cannot
 *    fail on a missing composite index in production. Status is filtered and rows are sorted in
 *    memory instead — over one person's workload, which is small by construction. The exception is
 *    the seven Project Management sources, whose subcollections need an explicit collection-group
 *    `fieldOverrides` entry; those are declared in `firestore.indexes.json`.
 *
 * 2. **Every loader is capped.** `CAP` rows per source. Somebody with a four-hundred-item backlog
 *    gets the first hundred and an honest "showing 100 of 400+", not a five-second page load.
 *
 * 3. **A loader's failure is that loader's problem.** `loadWorkItems` catches per source, so a
 *    module whose collection does not exist yet, or whose rules deny the read, contributes an empty
 *    list and a named entry in `failures` — it does not blank the dashboard. The UI surfaces the
 *    failures rather than silently showing zero, because "nothing is waiting on you" and "we could
 *    not find out" are very different statements to make to somebody about their work.
 *
 * Sources are also skipped entirely when `visible` says the viewer cannot see the module. That is
 * the main reason this fans out to thirty-one queries without behaving like it: a typical user can
 * see four or five modules, so a typical dashboard issues well under a dozen reads.
 */

import {
  collection,
  getCountFromServer,
  getDocs,
  limit as fsLimit,
  query,
  where,
  type DocumentData,
  type Query,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from './firebase';
import { ACTIVITY_MODULES } from './activity-modules';
import {
  normalizeWorkPriority,
  toWorkDate,
  type WorkItem,
  type WorkLane,
} from './work-dashboard';

import {
  E_APPROVAL_BASE_PATH,
  E_APPROVAL_COLLECTIONS,
  OPEN_E_APPROVAL_STATUSES,
  type EApprovalStatus,
} from './e-approval';
import {
  CLOSED_TASK_STATUSES,
  DECISION_STATUSES,
  OFFICE_HUB_COLLECTIONS,
  TASK_STATUSES,
} from './office-hub';
import { OFFICE_HUB_BASE_PATH } from './office-hub-permissions';
import { HR_COLLECTIONS } from './hr-requirement';
import { PENDING_APPROVAL_STATUSES } from './hr-policy';
import { TT_COLLECTIONS } from './tour-travel';
import { RP_COLLECTIONS } from './recurring-payments';
import { VEHICLE_COLLECTIONS } from './vehicle-management';
import { INVENTORY_COLLECTIONS } from './inventory';
import { FD_COLLECTIONS } from './fixed-deposit';
import { PROJECT_WORK_SOURCES } from './work-dashboard-project-sources';

/* ── context ───────────────────────────────────────────────────────────────────────────────────── */

/** Everything a loader is allowed to know about who is looking. */
export interface WorkContext {
  userId: string;
  userName: string;
  /** The viewer's role name, for the queues that route by role rather than by user. */
  role: string;
  organizationId?: string;
  /** Resolved by `loadEApprovalActorContext`; empty when it could not be determined. */
  departmentIds: string[];
  /** ISO calendar date in the viewer's timezone. Passed in so every row is measured against one clock. */
  today: string;
  /** The `can` from `useAuthorization`, so `visible` asks the real permission system. */
  can: (action: string, resource: string) => boolean;
}

export interface WorkSource {
  id: string;
  /** Canonical name from `@/lib/activity-modules`. */
  module: string;
  /** What this queue is, in one phrase — shown when the source fails to load. */
  label: string;
  lane: WorkLane;
  /** False skips the query entirely. The dashboard's main performance lever. */
  visible: (context: WorkContext) => boolean;
  load: (context: WorkContext) => Promise<WorkItem[]>;
}

/** Rows fetched per source. Beyond this the row count stops being information. */
const CAP = 100;

/* ── helpers ───────────────────────────────────────────────────────────────────────────────────── */

type Row = Record<string, unknown> & { id: string };

function rows(snapshot: { docs: QueryDocumentSnapshot<DocumentData>[] }): Row[] {
  return snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }) as Row);
}

const text = (value: unknown, fallback = ''): string => {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number') return String(value);
  return fallback;
};

const list = (value: unknown): string[] => (Array.isArray(value) ? value.map((entry) => String(entry)) : []);

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** Soft-deleted rows exist in several modules and must never appear as work. */
const isLive = (row: Row): boolean => row.isDeleted !== true;

/** Run a capped, single-predicate query against a top-level collection. */
async function fetchWhere(
  collectionName: string,
  field: string,
  operator: 'array-contains' | '==',
  value: string,
  cap = CAP,
): Promise<Row[]> {
  const built = query(collection(db, collectionName), where(field, operator, value), fsLimit(cap)) as Query<DocumentData>;
  return rows(await getDocs(built)).filter(isLive);
}

/**
 * The depth of a shared queue.
 *
 * `getCountFromServer` rather than reading the documents: the only thing wanted here is the number,
 * and Daily Requisition's open pipeline can run to thousands of rows. Downloading those to call
 * `.length` on them would make the two shared-queue tiles the most expensive thing on the page, for
 * no extra information.
 *
 * The trade-off is that a server-side count cannot also exclude soft-deleted rows without a second
 * predicate, so a queue that holds `isDeleted` rows will read slightly high. The alternative is
 * paying for every document to correct a count nobody acts on directly — the row is a link to the
 * register, which does filter them.
 */
async function fetchCount(collectionName: string, field: string, values: string[]): Promise<number> {
  const built = query(collection(db, collectionName), where(field, 'in', values.slice(0, 10)));
  const snapshot = await getCountFromServer(built);
  return Number(snapshot.data().count || 0);
}

/* ── E-Approval ────────────────────────────────────────────────────────────────────────────────── */

/**
 * Whether an E-Approval file is still somebody's problem.
 *
 * `OPEN_E_APPROVAL_STATUSES` is the same constant the module's own inbox filters on, so this lane
 * and `/e-approval/inbox` cannot disagree about what is open. Worth importing rather than restating:
 * the statuses are Title Case with spaces — `'Pending Approval'`, `'Pending Verification'`,
 * `'Pending Clarification'` — and an inlined guess at `'PENDING'` or `'IN_PROGRESS'` matches none of
 * the fourteen real values, so the source silently returns nothing at all rather than failing.
 */
const isOpen = (status: unknown): boolean =>
  OPEN_E_APPROVAL_STATUSES.includes(text(status) as EApprovalStatus);

/**
 * What the file is waiting for, in the words the inbox uses.
 *
 * A request pending verification and one pending approval are different jobs — one is "check this",
 * the other is "decide this" — and the module models that as `currentStepType` precisely so its
 * three inbox cards can be one query. Losing the distinction here would make the dashboard's row
 * less informative than the screen it links to.
 */
const E_APPROVAL_STEP_LABEL: Record<string, string> = {
  APPROVAL: 'Approval',
  VERIFICATION: 'Verification',
  CLARIFICATION: 'Clarification',
  REVIEW: 'Review',
};

function eApprovalStage(row: Row): string | null {
  const stepType = E_APPROVAL_STEP_LABEL[text(row.currentStepType).toUpperCase()];
  const stepName = text(row.currentStepName) || text(row.pendingLabel);
  // Both when they say different things — "Verification · Finance check" — and whichever exists
  // otherwise. A step named the same as its type is not printed twice.
  if (stepType && stepName && stepName.toLowerCase() !== stepType.toLowerCase()) {
    return `${stepType} · ${stepName}`;
  }
  return stepType || stepName || text(row.status) || null;
}

function eApprovalItem(row: Row, lane: WorkLane, sourceId: string): WorkItem {
  return {
    id: `${sourceId}:${row.id}`,
    sourceId,
    module: ACTIVITY_MODULES.E_APPROVAL,
    lane,
    title: text(row.subject, 'Approval request'),
    reference: text(row.referenceNo) || null,
    stage: eApprovalStage(row),
    href: `${E_APPROVAL_BASE_PATH}/${row.id}`,
    dueAt: toWorkDate(row.currentDueAt),
    amount: num(row.amount),
    priority: normalizeWorkPriority(row.priority),
    raisedBy: text(row.requesterName) || null,
  };
}

const eApprovalVisible = (context: WorkContext) => context.can('View Module', 'E-Approval');

/* ── Office Hub ────────────────────────────────────────────────────────────────────────────────── */

/**
 * Derived from the module's own unions rather than typed out here.
 *
 * The same reasoning as `OPEN_E_APPROVAL_STATUSES`: a hand-written status list is a filter that can
 * stop matching without anything failing. Deriving means a new `TaskStatus` is treated as open until
 * somebody explicitly closes it, which is the safe default for a screen whose job is to not lose
 * work. `CLOSED_TASK_STATUSES` and `DECISION_STATUSES` are the source of truth.
 */
const OFFICE_HUB_OPEN_TASK = new Set<string>(
  TASK_STATUSES.filter((status) => !CLOSED_TASK_STATUSES.includes(status)),
);
const OFFICE_HUB_OPEN_ITEM = new Set<string>(
  DECISION_STATUSES.filter((status) => status !== 'Completed' && status !== 'Cancelled'),
);

const officeHubVisible = (context: WorkContext) => context.can('View Module', 'Office Hub');

/* ── the registry ──────────────────────────────────────────────────────────────────────────────── */

export const WORK_SOURCES: WorkSource[] = [
  /* ---- E-Approval ------------------------------------------------------------------------- */
  {
    id: 'e-approval-mine',
    module: ACTIVITY_MODULES.E_APPROVAL,
    label: 'Approvals pending with you',
    lane: 'action',
    visible: eApprovalVisible,
    load: async (context) =>
      (await fetchWhere(E_APPROVAL_COLLECTIONS.requests, 'currentAssigneeIds', 'array-contains', context.userId))
        .filter((row) => isOpen(row.status))
        .map((row) => eApprovalItem(row, 'action', 'e-approval-mine')),
  },
  {
    id: 'e-approval-department',
    module: ACTIVITY_MODULES.E_APPROVAL,
    label: 'Approvals pending with your department',
    lane: 'shared',
    visible: (context) => eApprovalVisible(context) && context.departmentIds.length > 0,
    load: async (context) => {
      // `array-contains-any` takes at most thirty values, and nobody legitimately sits in thirty
      // departments — the slice is a guard against a malformed context, not an expected case.
      const built = query(
        collection(db, E_APPROVAL_COLLECTIONS.requests),
        where('currentDepartmentIds', 'array-contains-any', context.departmentIds.slice(0, 30)),
        fsLimit(CAP),
      );
      return rows(await getDocs(built))
        .filter(isLive)
        .filter((row) => isOpen(row.status))
        // A file that also names the viewer belongs in `action`; `dropLowerLaneDuplicates` collapses
        // the pair, but filtering here saves the row ever being built.
        .filter((row) => !list(row.currentAssigneeIds).includes(context.userId))
        .map((row) => eApprovalItem(row, 'shared', 'e-approval-department'));
    },
  },
  {
    id: 'e-approval-role',
    module: ACTIVITY_MODULES.E_APPROVAL,
    label: 'Approvals pending with your role',
    lane: 'shared',
    visible: (context) => eApprovalVisible(context) && Boolean(context.role),
    load: async (context) =>
      (await fetchWhere(E_APPROVAL_COLLECTIONS.requests, 'currentRoles', 'array-contains', context.role))
        .filter((row) => isOpen(row.status))
        .filter((row) => !list(row.currentAssigneeIds).includes(context.userId))
        .map((row) => eApprovalItem(row, 'shared', 'e-approval-role')),
  },
  {
    id: 'e-approval-raised',
    module: ACTIVITY_MODULES.E_APPROVAL,
    label: 'Approvals you raised',
    lane: 'watching',
    visible: eApprovalVisible,
    load: async (context) =>
      (await fetchWhere(E_APPROVAL_COLLECTIONS.requests, 'requesterId', '==', context.userId))
        .filter((row) => isOpen(row.status))
        .map((row) => ({
          ...eApprovalItem(row, 'watching', 'e-approval-raised'),
          // On a file you raised, the useful fact is who is holding it, not that you raised it.
          raisedBy: text(row.currentStepName) ? `With ${text(row.currentStepName)}` : null,
        })),
  },

  /* ---- Office Hub ------------------------------------------------------------------------- */
  {
    id: 'office-hub-tasks',
    module: ACTIVITY_MODULES.OFFICE_HUB,
    label: 'Tasks assigned to you',
    lane: 'action',
    visible: officeHubVisible,
    load: async (context) =>
      (await fetchWhere(OFFICE_HUB_COLLECTIONS.tasks, 'assigneeId', '==', context.userId))
        .filter((row) => OFFICE_HUB_OPEN_TASK.has(text(row.status)))
        .map((row) => ({
          id: `office-hub-tasks:${row.id}`,
          sourceId: 'office-hub-tasks',
          module: ACTIVITY_MODULES.OFFICE_HUB,
          lane: 'action' as WorkLane,
          title: text(row.title, 'Task'),
          reference: text(row.reference) || null,
          stage: text(row.status) || null,
          href: `${OFFICE_HUB_BASE_PATH}/tasks/${row.id}`,
          dueAt: toWorkDate(row.dueDate),
          priority: normalizeWorkPriority(row.priority),
          raisedBy: text(row.meetingTitle) || null,
        })),
  },
  {
    id: 'office-hub-action-items',
    module: ACTIVITY_MODULES.OFFICE_HUB,
    label: 'Meeting action items you own',
    lane: 'action',
    visible: officeHubVisible,
    load: async (context) =>
      (await fetchWhere(OFFICE_HUB_COLLECTIONS.actionItems, 'responsibleUserId', '==', context.userId))
        .filter((row) => OFFICE_HUB_OPEN_ITEM.has(text(row.status)))
        .map((row) => ({
          id: `office-hub-action-items:${row.id}`,
          sourceId: 'office-hub-action-items',
          module: ACTIVITY_MODULES.OFFICE_HUB,
          lane: 'action' as WorkLane,
          title: text(row.title, 'Action item'),
          reference: text(row.reference) || null,
          stage: 'Action item',
          href: `${OFFICE_HUB_BASE_PATH}/action-items`,
          dueAt: toWorkDate(row.dueDate),
          priority: normalizeWorkPriority(row.priority),
          raisedBy: text(row.meetingTitle) || null,
        })),
  },
  {
    id: 'office-hub-decisions',
    module: ACTIVITY_MODULES.OFFICE_HUB,
    label: 'Decisions you own',
    lane: 'action',
    visible: officeHubVisible,
    load: async (context) =>
      (await fetchWhere(OFFICE_HUB_COLLECTIONS.decisions, 'ownerId', '==', context.userId))
        .filter((row) => OFFICE_HUB_OPEN_ITEM.has(text(row.status)))
        .map((row) => ({
          id: `office-hub-decisions:${row.id}`,
          sourceId: 'office-hub-decisions',
          module: ACTIVITY_MODULES.OFFICE_HUB,
          lane: 'action' as WorkLane,
          title: text(row.title, 'Decision'),
          reference: text(row.reference) || null,
          stage: 'Decision',
          href: `${OFFICE_HUB_BASE_PATH}/decisions`,
          dueAt: toWorkDate(row.dueDate) ?? toWorkDate(row.decisionDate),
          priority: normalizeWorkPriority(row.priority),
          raisedBy: text(row.meetingTitle) || null,
        })),
  },
  {
    id: 'office-hub-meetings',
    module: ACTIVITY_MODULES.OFFICE_HUB,
    label: 'Your meetings',
    lane: 'meeting',
    visible: officeHubVisible,
    load: async (context) => {
      const horizon = addDays(context.today, 7);
      return (await fetchWhere(OFFICE_HUB_COLLECTIONS.meetings, 'participantUserIds', 'array-contains', context.userId))
        .filter((row) => {
          const date = toWorkDate(row.date);
          return Boolean(date) && date! >= context.today && date! <= horizon;
        })
        .filter((row) => !['Cancelled', 'Completed'].includes(text(row.status)))
        .map((row) => ({
          id: `office-hub-meetings:${row.id}`,
          sourceId: 'office-hub-meetings',
          module: ACTIVITY_MODULES.OFFICE_HUB,
          lane: 'meeting' as WorkLane,
          title: text(row.title, 'Meeting'),
          reference: text(row.meetingType) || null,
          stage: text(row.status) || null,
          href: `${OFFICE_HUB_BASE_PATH}/meetings/${row.id}`,
          dueAt: toWorkDate(row.date),
          // Office Hub stores a calendar date plus a wall time, never an instant — see the note on
          // timezones in `office-hub-time.ts`. The clock time is carried separately for that reason.
          startTime: text(row.startTime) || null,
          // `meetingUrl` is the field every Office Hub screen reads for the joining link, so an
          // online meeting gets a Join button straight from the dashboard.
          actionUrl: text(row.meetingUrl) || null,
          priority: normalizeWorkPriority(row.priority),
        }));
    },
  },
  {
    id: 'office-hub-invites',
    module: ACTIVITY_MODULES.OFFICE_HUB,
    label: 'Invitations awaiting your response',
    lane: 'meeting',
    visible: officeHubVisible,
    load: async (context) => {
      const participants = (await fetchWhere(OFFICE_HUB_COLLECTIONS.participants, 'userId', '==', context.userId))
        .filter((row) => text(row.response, 'No Response') === 'No Response');
      if (!participants.length) return [];

      // The participant row carries the meeting id but not its date, and an invitation to a meeting
      // that has already happened is not something to chase. So the meetings this viewer is on are
      // read once and used to both date and title the invitations.
      const meetings = new Map(
        (await fetchWhere(OFFICE_HUB_COLLECTIONS.meetings, 'participantUserIds', 'array-contains', context.userId))
          .map((row) => [row.id, row]),
      );

      return participants
        .map((row) => ({ row, meeting: meetings.get(text(row.meetingId)) }))
        .filter(({ meeting }) => {
          if (!meeting) return false;
          const date = toWorkDate(meeting.date);
          return Boolean(date) && date! >= context.today && text(meeting.status) !== 'Cancelled';
        })
        .map(({ row, meeting }) => ({
          id: `office-hub-invites:${row.id}`,
          sourceId: 'office-hub-invites',
          module: ACTIVITY_MODULES.OFFICE_HUB,
          lane: 'meeting' as WorkLane,
          title: text(meeting!.title, 'Meeting invitation'),
          reference: 'Awaiting your RSVP',
          stage: text(row.attendanceRole) || null,
          href: `${OFFICE_HUB_BASE_PATH}/meetings/${text(row.meetingId)}`,
          dueAt: toWorkDate(meeting!.date),
          startTime: text(meeting!.startTime) || null,
        }));
    },
  },
  {
    id: 'office-hub-watching',
    module: ACTIVITY_MODULES.OFFICE_HUB,
    label: 'Tasks you watch',
    lane: 'watching',
    visible: officeHubVisible,
    load: async (context) =>
      (await fetchWhere(OFFICE_HUB_COLLECTIONS.tasks, 'watcherUserIds', 'array-contains', context.userId))
        .filter((row) => OFFICE_HUB_OPEN_TASK.has(text(row.status)))
        .filter((row) => text(row.assigneeId) !== context.userId)
        .map((row) => ({
          id: `office-hub-watching:${row.id}`,
          sourceId: 'office-hub-watching',
          module: ACTIVITY_MODULES.OFFICE_HUB,
          lane: 'watching' as WorkLane,
          title: text(row.title, 'Task'),
          reference: text(row.reference) || null,
          stage: text(row.status) || null,
          href: `${OFFICE_HUB_BASE_PATH}/tasks/${row.id}`,
          dueAt: toWorkDate(row.dueDate),
          priority: normalizeWorkPriority(row.priority),
          raisedBy: text(row.assigneeName) ? `With ${text(row.assigneeName)}` : null,
        })),
  },
  {
    id: 'office-hub-reminders',
    module: ACTIVITY_MODULES.OFFICE_HUB,
    label: 'Your reminders',
    lane: 'watching',
    visible: officeHubVisible,
    load: async (context) => {
      const horizon = addDays(context.today, 7);
      return (await fetchWhere(OFFICE_HUB_COLLECTIONS.reminders, 'userId', '==', context.userId))
        // 'Scheduled' — not 'PENDING'. `ReminderStatus` has no such member, which is why the
        // equivalent count in `windows-agent-morning.ts` was always zero.
        .filter((row) => text(row.status) === 'Scheduled')
        .filter((row) => {
          const date = toWorkDate(row.scheduledAt);
          return Boolean(date) && date! <= horizon;
        })
        .map((row) => ({
          id: `office-hub-reminders:${row.id}`,
          sourceId: 'office-hub-reminders',
          module: ACTIVITY_MODULES.OFFICE_HUB,
          lane: 'watching' as WorkLane,
          title: text(row.entityTitle, 'Reminder'),
          reference: 'Reminder',
          stage: text(row.kind) || null,
          href: text(row.link) || `${OFFICE_HUB_BASE_PATH}/notifications`,
          dueAt: toWorkDate(row.scheduledAt),
        }));
    },
  },

  /* ---- the assignee-routed workflows ------------------------------------------------------- */
  workflowSource({
    id: 'site-fund-request',
    module: ACTIVITY_MODULES.SITE_FUND_REQUISITION,
    label: 'Site fund requests at your stage',
    permission: 'Site Fund Request',
    collectionName: 'siteFundRequests',
    basePath: '/site-fund-request',
  }),
  workflowSource({
    id: 'site-fund-requisition-2',
    module: ACTIVITY_MODULES.SITE_FUND_REQUISITION,
    label: 'Site fund requisitions at your stage',
    permission: 'Site Fund Requisition 2',
    // `requisitions`, not `siteFundRequisitions2` — see the note in `docs/work-dashboard.md`. The
    // latter name appears only in the escalation cron and no code has ever written to it.
    collectionName: 'requisitions',
    basePath: '/site-fund-requisition-2',
  }),
  {
    id: 'insurance-tasks',
    module: ACTIVITY_MODULES.INSURANCE,
    label: 'Insurance tasks assigned to you',
    lane: 'action',
    visible: (context) => context.can('View Module', 'Insurance'),
    load: async (context) =>
      (await fetchWhere('insuranceTasks', 'assignees', 'array-contains', context.userId))
        .filter((row) => ['Pending', 'In Progress', 'Needs Review'].includes(text(row.status)))
        .map((row) => ({
          id: `insurance-tasks:${row.id}`,
          sourceId: 'insurance-tasks',
          module: ACTIVITY_MODULES.INSURANCE,
          lane: 'action' as WorkLane,
          title: `${text(row.taskType, 'Task')} — ${text(row.insuredPerson, 'policy')}`,
          reference: text(row.policyNo) || null,
          stage: text(row.currentStage) || null,
          href: '/insurance/my-tasks',
          dueAt: toWorkDate(row.deadline) ?? toWorkDate(row.dueDate),
        })),
  },
  {
    id: 'tour-travel',
    module: 'Tour, Travel & Expense',
    label: 'Tour requests awaiting your approval',
    lane: 'action',
    visible: (context) => context.can('View Module', 'Tour, Travel & Expense'),
    load: async (context) =>
      (await fetchWhere(TT_COLLECTIONS.requests, 'currentApprovers', 'array-contains', context.userId))
        .filter((row) => ['SUBMITTED', 'UNDER_APPROVAL'].includes(text(row.status)))
        .map((row) => {
          const stages = Array.isArray(row.approvalStages) ? (row.approvalStages as Row[]) : [];
          const index = typeof row.currentStageIndex === 'number' ? row.currentStageIndex : -1;
          return {
            id: `tour-travel:${row.id}`,
            sourceId: 'tour-travel',
            module: 'Tour, Travel & Expense',
            lane: 'action' as WorkLane,
            title: `Tour request — ${text(row.employeeName, 'employee')}`,
            reference: text(row.referenceNumber) || null,
            stage: text(stages[index]?.stageName) || null,
            href: '/tour-travel/approvals',
            dueAt: toWorkDate(row.approvalDeadline) ?? toWorkDate(row.departureDate),
            amount: num((row.estimatedCost as Row | undefined)?.total),
            raisedBy: text(row.employeeName) || null,
          };
        }),
  },
  {
    id: 'recurring-payments',
    module: ACTIVITY_MODULES.RECURRING_PAYMENTS,
    label: 'Payment obligations assigned to you',
    lane: 'action',
    visible: (context) => context.can('View Module', 'Recurring Payments'),
    load: async (context) => {
      // Four distinct fields, because an obligation moves through four hands — collector, verifier,
      // approver, processor — and the module names each on the record rather than keeping a single
      // "pending with" pointer. One query each, merged on document id.
      const fields = ['assignedTo', 'verifierId', 'approverId', 'accountsProcessorId'];
      const results = await Promise.all(
        fields.map((field) =>
          fetchWhere(RP_COLLECTIONS.payments, field, '==', context.userId, 50).catch(() => [] as Row[]),
        ),
      );
      const byId = new Map<string, Row>();
      for (const batch of results) for (const row of batch) byId.set(row.id, row);

      return [...byId.values()]
        .filter((row) =>
          [
            'Awaiting Bill',
            'Bill Received',
            'Under Verification',
            'Pending Approval',
            'Payment Processing',
            'Paid Receipt Pending',
            'Returned for Correction',
            'Overdue',
          ].includes(text(row.status)),
        )
        .map((row) => ({
          id: `recurring-payments:${row.id}`,
          sourceId: 'recurring-payments',
          module: ACTIVITY_MODULES.RECURRING_PAYMENTS,
          lane: 'action' as WorkLane,
          title: text(row.title, 'Payment obligation'),
          reference: text(row.vendorName) || null,
          stage: text(row.status) || null,
          href: '/recurring-payments/approvals',
          dueAt: toWorkDate(row.dueDate),
          amount: num(row.billAmount) ?? num(row.expectedAmount),
          priority: normalizeWorkPriority(row.priority),
        }));
    },
  },
  {
    id: 'vehicle-insurance',
    module: ACTIVITY_MODULES.VEHICLE_MANAGEMENT,
    label: 'Vehicle insurance renewals assigned to you',
    lane: 'action',
    visible: (context) => context.can('View Module', 'Vehicle Management'),
    load: async (context) =>
      (await fetchWhere(VEHICLE_COLLECTIONS.insuranceWorkflowCases, 'assigneeIds', 'array-contains', context.userId))
        .filter((row) => !['Completed', 'Rejected', 'Cancelled'].includes(text(row.status)))
        .map((row) => ({
          id: `vehicle-insurance:${row.id}`,
          sourceId: 'vehicle-insurance',
          module: ACTIVITY_MODULES.VEHICLE_MANAGEMENT,
          lane: 'action' as WorkLane,
          title: `Insurance renewal — ${text(row.vehicleNumber, 'vehicle')}`,
          reference: text(row.policyNumber) || null,
          stage: text(row.currentStepName) || null,
          href: '/vehicle-management/insurance/workflow',
          // The policy expiry is the real deadline; the workflow deadline is the internal one.
          dueAt: toWorkDate(row.workflowDeadline) ?? toWorkDate(row.expiryDate),
          amount: num(row.currentPremium),
          priority: normalizeWorkPriority(row.priority),
        })),
  },

  /* ---- HR & Recruitment -------------------------------------------------------------------- */
  {
    id: 'hr-requirements',
    module: ACTIVITY_MODULES.HR_RECRUITMENT,
    label: 'Manpower requirements awaiting your approval',
    lane: 'action',
    visible: (context) => context.can('View Module', 'HR & Recruitment'),
    load: async (context) =>
      (await fetchWhere(HR_COLLECTIONS.requirements, 'pendingApproverIds', 'array-contains', context.userId))
        .filter((row) => (PENDING_APPROVAL_STATUSES as string[]).includes(text(row.status)))
        .map((row) => ({
          id: `hr-requirements:${row.id}`,
          sourceId: 'hr-requirements',
          module: ACTIVITY_MODULES.HR_RECRUITMENT,
          lane: 'action' as WorkLane,
          title: `Manpower requirement — ${text(row.designation, 'position')}`,
          reference: text(row.requirementNumber) || null,
          stage: text(row.currentApprovalStageLabel) || null,
          href: '/hr/approvals',
          dueAt: toWorkDate(row.targetClosureDate),
          priority: normalizeWorkPriority(row.priority),
        })),
  },
  {
    id: 'hr-compensation',
    module: ACTIVITY_MODULES.HR_RECRUITMENT,
    label: 'Compensation approvals pending with you',
    lane: 'action',
    visible: (context) => context.can('View Module', 'HR & Recruitment'),
    load: async (context) =>
      (await fetchWhere(HR_COLLECTIONS.compensationApprovals, 'pendingApproverIds', 'array-contains', context.userId))
        .filter((row) => text(row.status) === 'PENDING')
        .map((row) => ({
          id: `hr-compensation:${row.id}`,
          sourceId: 'hr-compensation',
          module: ACTIVITY_MODULES.HR_RECRUITMENT,
          lane: 'action' as WorkLane,
          title: `Compensation — ${text(row.candidateName, 'candidate')}`,
          reference: text(row.requirementNumber) || null,
          stage: text(row.currentStageLabel) || null,
          href: '/hr/selection',
          dueAt: null,
          amount: num(row.proposedCtc),
        })),
  },
  {
    id: 'hr-offers',
    module: ACTIVITY_MODULES.HR_RECRUITMENT,
    label: 'Offers awaiting your approval',
    lane: 'action',
    visible: (context) => context.can('View Module', 'HR & Recruitment'),
    load: async (context) =>
      (await fetchWhere(HR_COLLECTIONS.offers, 'pendingApproverIds', 'array-contains', context.userId))
        .filter((row) => text(row.status) === 'PENDING_APPROVAL')
        .map((row) => ({
          id: `hr-offers:${row.id}`,
          sourceId: 'hr-offers',
          module: ACTIVITY_MODULES.HR_RECRUITMENT,
          lane: 'action' as WorkLane,
          title: `Offer — ${text(row.candidateName, 'candidate')}`,
          reference: text(row.offerNumber) || null,
          stage: text(row.designation) || null,
          href: '/hr/offers',
          dueAt: toWorkDate(row.joiningDate),
          amount: num(row.offeredCtc),
        })),
  },
  {
    id: 'hr-interviews',
    module: ACTIVITY_MODULES.HR_RECRUITMENT,
    label: 'Interviews on your panel',
    lane: 'action',
    visible: (context) => context.can('View Module', 'HR & Recruitment'),
    load: async (context) =>
      (await fetchWhere(HR_COLLECTIONS.interviews, 'interviewerIds', 'array-contains', context.userId))
        .filter((row) => ['SCHEDULED', 'RESCHEDULED', 'FEEDBACK_PENDING'].includes(text(row.status)))
        .map((row) => ({
          id: `hr-interviews:${row.id}`,
          sourceId: 'hr-interviews',
          module: ACTIVITY_MODULES.HR_RECRUITMENT,
          lane: 'action' as WorkLane,
          title: `Interview — ${text(row.candidateName, 'candidate')}`,
          reference: text(row.interviewNumber) || null,
          stage: `${text(row.round, 'Round')}${text(row.designation) ? ` · ${text(row.designation)}` : ''}`,
          href: '/hr/interviews',
          dueAt: toWorkDate(row.scheduledAt),
        })),
  },

  /* ---- the role- and permission-routed queues ---------------------------------------------- */
  {
    id: 'instrument-approvals',
    module: ACTIVITY_MODULES.FIXED_DEPOSIT,
    label: 'Instrument approvals open to your role',
    lane: 'shared',
    visible: (context) =>
      Boolean(context.role) &&
      (context.can('View Module', 'Fixed Deposit Management') ||
        context.can('View Module', 'Bank Guarantee Management') ||
        context.can('View Module', 'Letter of Credit Management')),
    load: async (context) => {
      // FD, BG and LC share one `approvals` collection and route by `requiredRole`, never by user —
      // so this is the one queue where "pending with me" genuinely cannot be asked. Queried by role
      // and presented as a shared queue, which is what it is.
      const pending = (await fetchWhere(FD_COLLECTIONS.approvals, 'requiredRole', '==', context.role, 300)).filter(
        (row) => text(row.status) === 'PENDING',
      );

      const routes: Record<string, { href: string; permission: string }> = {
        'Fixed Deposit Management': { href: '/fixed-deposit/approvals', permission: 'Fixed Deposit Management' },
        'Bank Guarantee Management': { href: '/bank-guarantee/approvals', permission: 'Bank Guarantee Management' },
        'Letter of Credit Management': { href: '/letter-of-credit/approvals', permission: 'Letter of Credit Management' },
      };

      // One row per module rather than per approval: these are register queues worked as a batch,
      // and the count is the fact worth carrying to the dashboard.
      return Object.entries(routes)
        .filter(([, route]) => context.can('View Module', route.permission))
        .map(([moduleName, route]) => ({
          moduleName,
          route,
          matches: pending.filter((row) => text(row.module) === moduleName),
        }))
        .filter(({ matches }) => matches.length > 0)
        .map(({ moduleName, route, matches }) => ({
          id: `instrument-approvals:${moduleName}`,
          sourceId: 'instrument-approvals',
          module: moduleName,
          lane: 'shared' as WorkLane,
          title: `${matches.length} approval${matches.length === 1 ? '' : 's'} awaiting ${context.role}`,
          reference: null,
          stage: null,
          href: route.href,
          dueAt: null,
          count: matches.length,
          amount: matches.reduce((total, row) => total + (num(row.amount) ?? 0), 0) || null,
        }));
    },
  },
  {
    id: 'daily-requisition-queue',
    module: ACTIVITY_MODULES.DAILY_REQUISITION,
    label: 'Daily requisition entries in progress',
    lane: 'shared',
    visible: (context) => context.can('View Module', 'Daily Requisition'),
    load: async (context) => {
      // Daily Requisition has no assignee field at all — `DailyRequisitionEntry` routes by status,
      // and each stage is worked by whoever holds the permission for that tab. So it is a shared
      // queue by design, and the honest row is its depth.
      const open = await fetchCount('dailyRequisitions', 'status', [
        'Pending',
        'Received',
        'Verified',
        'Received for Payment',
        'Needs Review',
      ]);
      if (!open) return [];
      return [
        {
          id: 'daily-requisition-queue:open',
          sourceId: 'daily-requisition-queue',
          module: ACTIVITY_MODULES.DAILY_REQUISITION,
          lane: 'shared' as WorkLane,
          title: `${open} entr${open === 1 ? 'y' : 'ies'} awaiting action`,
          reference: null,
          stage: null,
          href: '/daily-requisition',
          dueAt: null,
          count: open,
        },
      ];
    },
  },
  {
    id: 'store-stock-submitted',
    module: ACTIVITY_MODULES.STORE_STOCK,
    label: 'Stock documents awaiting approval',
    lane: 'shared',
    visible: (context) => context.can('View Module', 'Store & Stock Management'),
    load: async () => {
      // Inventory documents carry no approver — `Submitted` means "open to anyone holding Approve".
      const open = await fetchCount(INVENTORY_COLLECTIONS.documents, 'status', ['Submitted']);
      if (!open) return [];
      return [
        {
          id: 'store-stock-submitted:open',
          sourceId: 'store-stock-submitted',
          module: ACTIVITY_MODULES.STORE_STOCK,
          lane: 'shared' as WorkLane,
          title: `${open} document${open === 1 ? '' : 's'} submitted for approval`,
          reference: null,
          stage: null,
          href: '/store-stock-management/inventory/movements',
          dueAt: null,
          count: open,
        },
      ];
    },
  },

  /* ---- Project Management ------------------------------------------------------------------ */
  ...PROJECT_WORK_SOURCES,
];

/* ── running them ──────────────────────────────────────────────────────────────────────────────── */

export interface WorkLoadResult {
  items: WorkItem[];
  /** Sources that threw, by label, so the screen can say so instead of showing a confident zero. */
  failures: Array<{ id: string; label: string; message: string }>;
  /** Sources skipped because the viewer cannot see the module. Useful when debugging an empty board. */
  skipped: string[];
}

/**
 * Run every visible source concurrently.
 *
 * Concurrent rather than sequential so the slowest source sets the latency instead of the sum, and
 * individually caught so one of them cannot take the page down — the same two decisions, for the
 * same two reasons, as `buildMorningSummary`.
 */
export async function loadWorkItems(context: WorkContext): Promise<WorkLoadResult> {
  const visible = WORK_SOURCES.filter((source) => source.visible(context));
  const skipped = WORK_SOURCES.filter((source) => !source.visible(context)).map((source) => source.id);

  const settled = await Promise.all(
    visible.map(async (source) => {
      try {
        return { source, items: await source.load(context), error: null as Error | null };
      } catch (error) {
        return {
          source,
          items: [] as WorkItem[],
          error: error instanceof Error ? error : new Error(String(error)),
        };
      }
    }),
  );

  return {
    items: settled.flatMap((entry) => entry.items),
    failures: settled
      .filter((entry) => entry.error)
      .map((entry) => ({ id: entry.source.id, label: entry.source.label, message: entry.error!.message })),
    skipped,
  };
}

/* ── shared builders ───────────────────────────────────────────────────────────────────────────── */

/**
 * The three modules built on the generic `Requisition` shape — `assignees`, `status`, `stage`,
 * `currentStepId`, `deadline` — differ only in their collection and their route, so they are one
 * builder rather than three near-identical entries.
 */
function workflowSource(config: {
  id: string;
  module: string;
  label: string;
  permission: string;
  collectionName: string;
  basePath: string;
}): WorkSource {
  return {
    id: config.id,
    module: config.module,
    label: config.label,
    lane: 'action',
    visible: (context) => context.can('View Module', config.permission),
    load: async (context) =>
      (await fetchWhere(config.collectionName, 'assignees', 'array-contains', context.userId))
        .filter((row) => ['Pending', 'In Progress', 'Needs Review'].includes(text(row.status)))
        .map((row) => ({
          id: `${config.id}:${row.id}`,
          sourceId: config.id,
          module: config.module,
          lane: 'action' as WorkLane,
          title: text(row.partyName) || text(row.description, 'Requisition'),
          reference: text(row.requisitionId) || null,
          stage: text(row.stage) || null,
          // The stage screen is where the action buttons are, so a row lands on the step it is
          // sitting at rather than on the module's front page.
          href: text(row.currentStepId)
            ? `${config.basePath}/stage/${text(row.currentStepId)}`
            : config.basePath,
          dueAt: toWorkDate(row.deadline),
          amount: num(row.amount),
          raisedBy: text(row.raisedBy) || null,
        })),
  };
}

/** `2026-09-22` + 7 → `2026-09-29`. Calendar arithmetic, in UTC so no local DST shift applies. */
export function addDays(date: string, days: number): string {
  const base = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(base)) return date;
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}

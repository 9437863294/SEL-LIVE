import { NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import {
  DEFAULT_E_APPROVAL_SETTINGS_RECORD,
  E_APPROVAL_ACTIVITY_MODULE,
  E_APPROVAL_BASE_PATH,
  E_APPROVAL_COLLECTIONS,
  resolveDueEApprovalEscalations,
  type EApprovalDepartmentRouting,
  type EApprovalEscalationRule,
  type EApprovalRequest,
  type EApprovalSettingsRecord,
  type EApprovalStep,
} from '@/lib/e-approval';

/**
 * The E-Approval reminder and escalation sweep (spec section 22).
 *
 * Runs on the Admin SDK because there is no signed-in user when a 72-hour reminder comes due, and
 * reuses the same pure policy function the UI does — `resolveDueEApprovalEscalations` — so the cron
 * and the screens cannot disagree about whether a step is overdue.
 *
 * Idempotent by construction: each step records the ladder rules already fired, so running this
 * twice sends nothing twice. That is what keeps a Director from filtering the module's mail. Time a
 * step spent on hold, or waiting on a verification it asked for, is excluded from the elapsed
 * calculation — reminding somebody every 24 hours while they wait for an answer they requested is
 * how reminders come to be ignored.
 *
 * `GET /api/e-approval/escalations` — guarded by `CRON_SECRET` when that is configured.
 */

const OPEN_STATUSES = [
  'Submitted',
  'Pending Approval',
  'Pending Verification',
  'Pending Clarification',
  'Resubmitted',
  'Partially Approved',
];

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getFirebaseAdminFirestore();
  const startedAt = Date.now();
  const now = new Date().toISOString();

  const settingsCache = new Map<string, EApprovalSettingsRecord>();
  const loadSettings = async (organizationId: string): Promise<EApprovalSettingsRecord> => {
    const cached = settingsCache.get(organizationId);
    if (cached) return cached;
    const snapshot = await db.collection(E_APPROVAL_COLLECTIONS.settings).doc(organizationId).get();
    const saved = snapshot.data() as Partial<EApprovalSettingsRecord> | undefined;
    const resolved: EApprovalSettingsRecord = {
      ...DEFAULT_E_APPROVAL_SETTINGS_RECORD,
      ...(saved || {}),
      numbering: { ...DEFAULT_E_APPROVAL_SETTINGS_RECORD.numbering, ...(saved?.numbering || {}) },
      escalationLadder: saved?.escalationLadder?.length
        ? saved.escalationLadder
        : DEFAULT_E_APPROVAL_SETTINGS_RECORD.escalationLadder,
    };
    settingsCache.set(organizationId, resolved);
    return resolved;
  };

  /** Department members, for a step addressed to a department rather than a person. */
  const departmentCache = new Map<string, string[]>();
  const usersForDepartment = async (departmentId: string, headOnly: boolean): Promise<string[]> => {
    const key = `${departmentId}:${headOnly ? 'head' : 'all'}`;
    const cached = departmentCache.get(key);
    if (cached) return cached;
    const snapshot = await db.collection(E_APPROVAL_COLLECTIONS.departmentRouting).doc(departmentId).get();
    const routing = snapshot.data() as EApprovalDepartmentRouting | undefined;
    const resolved = routing
      ? headOnly || routing.mode === 'Head'
        ? [routing.headUserId].filter(Boolean as unknown as (value?: string) => value is string)
        : [routing.headUserId, ...(routing.memberUserIds || [])].filter(
            Boolean as unknown as (value?: string) => value is string,
          )
      : [];
    departmentCache.set(key, resolved);
    return resolved;
  };

  const roleCache = new Map<string, string[]>();
  const usersForRole = async (role: string): Promise<string[]> => {
    const cached = roleCache.get(role);
    if (cached) return cached;
    const snapshot = await db.collection('users').where('role', '==', role).get();
    const resolved = snapshot.docs.filter((entry) => entry.data().status !== 'Inactive').map((entry) => entry.id);
    roleCache.set(role, resolved);
    return resolved;
  };

  const notify = async (
    userIds: string[],
    payload: {
      title: string;
      body: string;
      link: string;
      itemId: string;
      itemRef?: string;
      stepName?: string;
      severity: string;
      type: string;
    },
  ): Promise<number> => {
    const targets = [...new Set(userIds.filter(Boolean))];
    if (!targets.length) return 0;
    const batch = db.batch();
    for (const userId of targets) {
      batch.set(db.collection('userNotifications').doc(), {
        userId,
        module: E_APPROVAL_ACTIVITY_MODULE,
        ...payload,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
    return targets.length;
  };

  let requestsChecked = 0;
  let notificationsSent = 0;
  let escalationsRaised = 0;

  const openRequests = await db
    .collection(E_APPROVAL_COLLECTIONS.requests)
    .where('status', 'in', OPEN_STATUSES)
    .get();

  for (const doc of openRequests.docs) {
    const approval = { id: doc.id, ...doc.data() } as EApprovalRequest;
    if (approval.isDeleted === true) continue;
    requestsChecked += 1;

    const settings = await loadSettings(approval.organizationId || 'default');
    if (!settings.escalationLadder.length) continue;

    const stepSnapshot = await db
      .collection(E_APPROVAL_COLLECTIONS.steps)
      .where('approvalId', '==', approval.id)
      .get();
    const steps = stepSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }) as EApprovalStep);

    const due = resolveDueEApprovalEscalations(steps, settings.escalationLadder, now, approval.approvalTypeId);
    if (!due.length) continue;

    const firedByStep = new Map<string, string[]>();

    for (const entry of due) {
      const step = steps.find((candidate) => candidate.id === entry.stepId);
      if (!step) continue;

      const recipients = new Set<string>();
      if (step.assignment.kind === 'User' && step.assignment.userId) recipients.add(step.assignment.userId);
      if (step.ownedByUserId) recipients.add(step.ownedByUserId);
      if (step.delegatedToUserId) recipients.add(step.delegatedToUserId);
      if (step.assignment.kind === 'Department' && step.assignment.departmentId) {
        (await usersForDepartment(step.assignment.departmentId, step.assignment.departmentMode === 'Head')).forEach(
          (userId) => recipients.add(userId),
        );
      }
      if (step.assignment.kind === 'Role' && step.assignment.role) {
        (await usersForRole(step.assignment.role)).forEach((userId) => recipients.add(userId));
      }
      if (step.assignment.kind === 'Requester') recipients.add(approval.requesterId);

      // Ladder targets: an escalation usually names the HOD or a senior authority.
      for (const target of entry.rule.targets ?? []) {
        if (target.userId) recipients.add(target.userId);
        if (target.departmentId) {
          (await usersForDepartment(target.departmentId, target.departmentMode === 'Head')).forEach((userId) =>
            recipients.add(userId),
          );
        }
        if (target.role) (await usersForRole(target.role)).forEach((userId) => recipients.add(userId));
      }
      if (entry.rule.kind === 'Notify Requester') recipients.add(approval.requesterId);

      const escalating = entry.rule.kind === 'Escalation';
      notificationsSent += await notify([...recipients], {
        type: escalating ? 'tat_escalation' : 'approval_required',
        title: escalating
          ? `Escalated — overdue: ${approval.referenceNo || approval.subject}`
          : entry.rule.kind === 'Notify Requester'
            ? `Still pending: ${approval.referenceNo || approval.subject}`
            : `Reminder: ${approval.referenceNo || approval.subject}`,
        body: `${approval.subject} has been pending at "${step.name}" for ${Math.round(entry.pendingHours)} hours${
          entry.rule.label ? ` (${entry.rule.label})` : ''
        }.`,
        link: `${E_APPROVAL_BASE_PATH}/${approval.id}`,
        itemId: approval.id,
        itemRef: approval.referenceNo,
        stepName: step.name,
        severity: escalating ? 'CRITICAL' : entry.rule.kind === 'Notify Requester' ? 'WARNING' : 'INFO',
      });
      if (escalating) escalationsRaised += 1;

      firedByStep.set(entry.stepId, [...(firedByStep.get(entry.stepId) ?? []), entry.rule.id]);
    }

    const batch = db.batch();
    for (const [stepId, ruleIds] of firedByStep) {
      const step = steps.find((candidate) => candidate.id === stepId);
      batch.update(db.collection(E_APPROVAL_COLLECTIONS.steps).doc(stepId), {
        escalationsSent: [...new Set([...(step?.escalationsSent ?? []), ...ruleIds])],
      });
      batch.set(db.collection(E_APPROVAL_COLLECTIONS.history).doc(), {
        approvalId: approval.id,
        organizationId: approval.organizationId ?? null,
        at: now,
        actorId: 'system',
        actorName: 'System',
        kind: 'Escalation Fired',
        stepId,
        stepName: step?.name ?? null,
        summary: `Reminder/escalation sent for "${step?.name ?? stepId}" (${ruleIds.join(', ')})`,
        recordedAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }

  return NextResponse.json({
    ok: true,
    requestsChecked,
    notificationsSent,
    escalationsRaised,
    tookMs: Date.now() - startedAt,
  });
}

/** Convenience for a scheduler that can only POST. */
export const POST = GET;

export type { EApprovalEscalationRule };

import { NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import {
  DEFAULT_ESCALATION_LADDER,
  DEFAULT_SLA_TARGETS,
  HR_COLLECTIONS,
  dueJoiningReminders,
  evaluateRequirementSla,
  isOpenRequirementStatus,
  resolveDueEscalations,
  summarizeDocumentChecklist,
  type EscalationLevel,
  type HrOffer,
  type HrRequirement,
  type HrSettings,
  type JoiningRecord,
  type PreJoiningDocument,
} from '@/lib/hr-requirement';

/**
 * The HR module's daily sweep: SLA escalations (spec section 41), offer expiry (section 29) and
 * pre-joining reminders (section 33).
 *
 * Runs on the Admin SDK because there is no signed-in user at 6am, and reuses the same pure policy
 * functions the UI does — `resolveDueEscalations`, `evaluateRequirementSla`, `dueJoiningReminders` —
 * so the cron and the screens cannot disagree about whether something is overdue.
 *
 * Idempotent by construction. Each requirement records the escalation percentages already sent and
 * each joining record the reminder offsets already fired, so running this twice in a day sends
 * nothing twice — which is what keeps the HR head from filtering the module's mail.
 *
 * `GET /api/hr/sla` — guarded by `CRON_SECRET` when that is configured.
 */

interface OrgSettings {
  targets: Record<string, number>;
  pauseOnHold: boolean;
  ladder: EscalationLevel[];
  escalationEnabled: boolean;
  reminderDays: number[];
  notifications: Partial<HrSettings['notifications']>;
}

const ESCALATION_ROLES: Record<string, string[]> = {
  HR_MANAGER: ['HR Manager'],
  HR_HEAD: ['HR Head'],
  DIRECTOR: ['Director', 'Director HR', 'MD', 'ED'],
};

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getFirebaseAdminFirestore();
  const startedAt = Date.now();
  const today = new Date().toISOString().slice(0, 10);

  const settingsCache = new Map<string, OrgSettings>();
  const loadSettings = async (organizationId: string): Promise<OrgSettings> => {
    const cached = settingsCache.get(organizationId);
    if (cached) return cached;
    const doc = await db.collection(HR_COLLECTIONS.settings).doc(organizationId).get();
    const saved = doc.data() as Partial<HrSettings> | undefined;
    const resolved: OrgSettings = {
      targets: { ...DEFAULT_SLA_TARGETS, ...(saved?.sla?.targets || {}) },
      pauseOnHold: saved?.sla?.pauseOnHold !== false,
      ladder: saved?.sla?.escalationLadder?.length ? saved.sla.escalationLadder : DEFAULT_ESCALATION_LADDER,
      escalationEnabled: saved?.sla?.escalationEnabled !== false,
      reminderDays: saved?.documents?.reminderDays?.length ? saved.documents.reminderDays : [7, 3, 1, 0],
      notifications: saved?.notifications || {},
    };
    settingsCache.set(organizationId, resolved);
    return resolved;
  };

  /** Resolves role names to active user IDs, mirroring `resolveRoleRecipients` on the client. */
  const roleCache = new Map<string, string[]>();
  const usersForRoles = async (roles: string[]): Promise<string[]> => {
    const ids = new Set<string>();
    for (const role of roles) {
      let holders = roleCache.get(role);
      if (!holders) {
        const snapshot = await db.collection('users').where('role', '==', role).get();
        holders = snapshot.docs.filter(doc => doc.data().status !== 'Inactive').map(doc => doc.id);
        roleCache.set(role, holders);
      }
      holders.forEach(id => ids.add(id));
    }
    return [...ids];
  };

  const notify = async (
    userIds: string[],
    payload: { title: string; body: string; link: string; itemId: string; itemRef?: string; severity: string },
  ) => {
    const targets = [...new Set(userIds.filter(Boolean))];
    if (targets.length === 0) return 0;
    const batch = db.batch();
    for (const userId of targets) {
      batch.set(db.collection('userNotifications').doc(), {
        userId,
        type: 'tat_escalation',
        module: 'HR & Recruitment',
        ...payload,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
    return targets.length;
  };

  let requirementsChecked = 0;
  let escalationsSent = 0;
  let offersExpired = 0;
  let remindersSent = 0;

  /* ── SLA and escalations (spec sections 40, 41) ── */

  const requirementSnapshot = await db.collection(HR_COLLECTIONS.requirements).get();
  for (const doc of requirementSnapshot.docs) {
    const requirement = { id: doc.id, ...doc.data() } as HrRequirement;
    if (!isOpenRequirementStatus(requirement.status)) continue;
    const organizationId = requirement.organizationId || 'default';
    const settings = await loadSettings(organizationId);
    requirementsChecked += 1;

    const sla = evaluateRequirementSla({
      startedAt: requirement.slaStartedAt?.toDate?.() || null,
      targetDays: requirement.slaTargetDays || settings.targets[requirement.priority] || settings.targets.Normal,
      heldDays: requirement.slaHeldDays,
      pauseOnHold: settings.pauseOnHold,
    });

    // The stored SLA state is what the register and dashboard filter on, so it is refreshed whether
    // or not an escalation is due.
    if (requirement.slaConsumedPercent !== sla.consumedPercent || requirement.slaState !== sla.state) {
      await doc.ref.update({ slaConsumedPercent: sla.consumedPercent, slaState: sla.state });
    }

    if (!settings.escalationEnabled || sla.state === 'Not started') continue;

    const due = resolveDueEscalations(sla.consumedPercent, settings.ladder, requirement.escalationsSent || []);
    if (due.length === 0) continue;

    for (const level of due) {
      const userIds: string[] = [];
      const roles: string[] = [];
      for (const audience of level.notify) {
        if (audience === 'RECRUITER') {
          if (requirement.primaryRecruiterId) userIds.push(requirement.primaryRecruiterId);
          if (requirement.secondaryRecruiterId) userIds.push(requirement.secondaryRecruiterId);
        } else if (audience === 'DEPARTMENT_HOD') {
          if (requirement.departmentHodId) userIds.push(requirement.departmentHodId);
        } else if (audience === 'REQUESTING_MANAGER') {
          if (requirement.requestingManagerId) userIds.push(requirement.requestingManagerId);
        } else {
          roles.push(...(ESCALATION_ROLES[audience] || [audience]));
        }
      }
      if (roles.length) userIds.push(...(await usersForRoles(roles)));

      const overdue = sla.consumedPercent >= 100;
      if (overdue ? settings.notifications.requirementOverdue !== false : settings.notifications.slaApproaching !== false) {
        escalationsSent += await notify(userIds, {
          title: overdue
            ? `Overdue: ${requirement.requirementNumber}`
            : `SLA warning: ${requirement.requirementNumber}`,
          body: `${requirement.requestedQuantity} × ${requirement.designation} — ${Math.round(
            sla.consumedPercent,
          )}% of the ${sla.targetDays}-day SLA consumed${level.label ? ` (${level.label})` : ''}.`,
          link: `/hr/requirements/${requirement.id}`,
          itemId: requirement.id,
          itemRef: requirement.requirementNumber,
          severity: sla.consumedPercent >= 120 ? 'CRITICAL' : 'WARNING',
        });
      }

      await db.collection(HR_COLLECTIONS.escalations).add({
        organizationId,
        requirementId: requirement.id,
        requirementNumber: requirement.requirementNumber,
        atPercent: level.atPercent,
        label: level.label || '',
        notified: level.notify,
        notifiedUserIds: [...new Set(userIds)],
        consumedPercent: sla.consumedPercent,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    await doc.ref.update({
      escalationsSent: [...new Set([...(requirement.escalationsSent || []), ...due.map(level => level.atPercent)])],
    });
  }

  /* ── Offer expiry (spec section 29) ── */

  const liveOffers = await db
    .collection(HR_COLLECTIONS.offers)
    .where('status', 'in', ['SENT', 'VIEWED'])
    .get();

  for (const doc of liveOffers.docs) {
    const offer = { id: doc.id, ...doc.data() } as HrOffer;
    if (!offer.validUntil || offer.validUntil >= today) continue;
    await doc.ref.update({ status: 'EXPIRED', expiredAt: FieldValue.serverTimestamp(), portalToken: '' });
    offersExpired += 1;

    const requirementDoc = offer.requirementId
      ? await db.collection(HR_COLLECTIONS.requirements).doc(offer.requirementId).get()
      : null;
    const recruiterId = (requirementDoc?.data() as HrRequirement | undefined)?.primaryRecruiterId;
    if (recruiterId) {
      await notify([recruiterId], {
        title: `Offer expired: ${offer.candidateName}`,
        body: `${offer.offerNumber} for ${offer.designation} expired on ${offer.validUntil} with no response.`,
        link: '/hr/offers',
        itemId: offer.id,
        itemRef: offer.offerNumber,
        severity: 'WARNING',
      });
    }
  }

  /* ── Pre-joining reminders (spec section 33) ── */

  const pendingJoinings = await db
    .collection(HR_COLLECTIONS.joiningRecords)
    .where('status', 'in', ['DOCUMENTS_PENDING', 'CONFIRMATION_PENDING', 'CONFIRMED', 'POSTPONED'])
    .get();

  for (const doc of pendingJoinings.docs) {
    const joining = { id: doc.id, ...doc.data() } as JoiningRecord;
    const organizationId = joining.organizationId || 'default';
    const settings = await loadSettings(organizationId);
    const joiningDate = joining.revisedJoiningDate || joining.plannedJoiningDate;

    const dueOffsets = dueJoiningReminders({
      joiningDate,
      reminderDays: settings.reminderDays,
      alreadySent: joining.remindersSent || [],
    });
    if (dueOffsets.length === 0) continue;

    const documents = await db
      .collection(HR_COLLECTIONS.preJoining)
      .where('joiningRecordId', '==', joining.id)
      .get();
    const summary = summarizeDocumentChecklist(
      documents.docs.map(item => {
        const data = item.data() as PreJoiningDocument;
        return { status: data.status, mandatory: data.mandatory };
      }),
    );

    const requirementDoc = joining.requirementId
      ? await db.collection(HR_COLLECTIONS.requirements).doc(joining.requirementId).get()
      : null;
    const requirement = requirementDoc?.data() as HrRequirement | undefined;

    const userIds = [requirement?.primaryRecruiterId, requirement?.requestingManagerId].filter(
      (id): id is string => Boolean(id),
    );
    userIds.push(...(await usersForRoles(['HR Manager'])));

    const offset = dueOffsets[0];
    const when = offset === 0 ? 'today' : `in ${offset} ${offset === 1 ? 'day' : 'days'}`;
    const wantsDocumentAlert = summary.mandatoryPending > 0 && settings.notifications.documentsPending !== false;
    const wantsJoiningAlert = settings.notifications.joiningApproaching !== false;

    if (wantsDocumentAlert || wantsJoiningAlert) {
      remindersSent += await notify(userIds, {
        title: summary.mandatoryPending > 0
          ? `Documents pending: ${joining.candidateName}`
          : `Joining ${when}: ${joining.candidateName}`,
        body: `${joining.designation}${joining.projectName ? ` at ${joining.projectName}` : ''} joins ${when} (${joiningDate}). ${
          summary.mandatoryPending > 0
            ? `${summary.mandatoryPending} mandatory ${summary.mandatoryPending === 1 ? 'document is' : 'documents are'} still outstanding.`
            : 'All mandatory documents are in order.'
        }`,
        link: summary.mandatoryPending > 0 ? '/hr/pre-joining' : '/hr/joining',
        itemId: joining.id,
        itemRef: joining.joiningNumber,
        severity: summary.mandatoryPending > 0 ? 'WARNING' : 'INFO',
      });
    }

    await doc.ref.update({
      remindersSent: [...new Set([...(joining.remindersSent || []), ...dueOffsets])],
      documentsReady: summary.readyForJoining,
      documentCompletionPercent: summary.completionPercent,
    });
  }

  return NextResponse.json({
    ok: true,
    requirementsChecked,
    escalationsSent,
    offersExpired,
    remindersSent,
    tookMs: Date.now() - startedAt,
  });
}

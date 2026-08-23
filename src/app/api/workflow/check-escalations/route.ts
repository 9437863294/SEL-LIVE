/**
 * GET /api/workflow/check-escalations
 *
 * Scheduled hourly by Vercel Cron (see vercel.json).
 * Checks all active workflow items against their step TAT + escalationThreshold config,
 * and writes a notification to `userNotifications` for overdue items.
 *
 * Required environment variables:
 *   CRON_SECRET              — shared secret verified from Authorization header
 *   FIREBASE_PROJECT_ID      — Firebase project ID
 *   FIREBASE_CLIENT_EMAIL    — service account client email
 *   FIREBASE_PRIVATE_KEY     — service account private key (newlines as \n)
 */

import { NextResponse } from 'next/server';
import { initializeApp, getApps, cert, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import type { WorkflowStep } from '@/lib/types';
import { dispatchNotificationOnce } from '@/lib/notifications-server';

/* ── Firebase Admin init (lazy, singleton) ──────────────────────── */
function getAdminApp(): App {
  if (getApps().length) return getApps()[0]!;
  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

/* ── Types ──────────────────────────────────────────────────────── */
interface ModuleConfig {
  /** Firestore document ID inside `workflows/` */
  workflowDocId: string;
  /** Top-level Firestore collection for active items */
  collection: string;
  /** Firestore field that holds the item's current step ID */
  currentStepIdField: string;
  /** Firestore field for human-readable item reference (e.g. requisitionId) */
  refField: string;
  /** Deep-link path prefix — item ID is appended */
  linkPrefix: string;
  /** Status values that mean "actively in a workflow step" */
  activeStatuses: string[];
}

const MODULES: ModuleConfig[] = [
  {
    workflowDocId: 'daily-requisition-workflow',
    collection: 'requisitions',
    currentStepIdField: 'currentStepId',
    refField: 'requisitionId',
    linkPrefix: '/daily-requisition',
    activeStatuses: ['In Progress', 'Needs Review'],
  },
  {
    workflowDocId: 'site-fund-requisition-2-workflow',
    collection: 'siteFundRequisitions2',
    currentStepIdField: 'currentStepId',
    refField: 'requisitionId',
    linkPrefix: '/site-fund-requisition-2',
    activeStatuses: ['In Progress', 'Needs Review'],
  },
  {
    workflowDocId: 'insurance-workflow',
    collection: 'insuranceTasks',
    currentStepIdField: 'currentStepId',
    refField: 'taskNo',
    linkPrefix: '/insurance',
    activeStatuses: ['In Progress', 'Pending'],
  },
];

/* ── Helpers ────────────────────────────────────────────────────── */
function hoursElapsed(since: Timestamp | string | null | undefined): number {
  if (!since) return 0;
  const ms =
    since instanceof Timestamp
      ? Date.now() - since.toDate().getTime()
      : Date.now() - new Date(since as string).getTime();
  return Math.max(0, ms / (1000 * 60 * 60));
}

/* ── Main handler ───────────────────────────────────────────────── */
export async function GET(request: Request) {
  /* Auth check — Vercel sends Authorization: Bearer <CRON_SECRET> */
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get('authorization') ?? '';
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const app = getAdminApp();
  const db = getFirestore(app);

  let totalChecked = 0;
  let totalEscalated = 0;
  const errors: string[] = [];

  for (const mod of MODULES) {
    try {
      /* 1 — Load workflow step config */
      const wfSnap = await db.doc(`workflows/${mod.workflowDocId}`).get();
      if (!wfSnap.exists) continue;
      const steps: WorkflowStep[] = (wfSnap.data()?.steps ?? []) as WorkflowStep[];

      /* Build a step lookup map keyed by step.id */
      const stepMap = new Map<string, WorkflowStep>();
      steps.forEach((s) => stepMap.set(s.id, s));

      /* 2 — Load active workflow items */
      const itemSnap = await db
        .collection(mod.collection)
        .where('status', 'in', mod.activeStatuses)
        .get();

      for (const itemDoc of itemSnap.docs) {
        totalChecked++;
        const item = itemDoc.data();
        const stepId = item[mod.currentStepIdField] as string | null;
        if (!stepId) continue;

        const step = stepMap.get(stepId);
        if (!step) continue;

        const escalationUserId = step.escalationUserId;
        const threshold = step.escalationThreshold ?? 80; // default 80%
        const tatHours = step.tat ?? 0;
        if (!escalationUserId || !tatHours) continue;

        /* 3 — Calculate elapsed time */
        const enteredAt: Timestamp | string | null =
          item.stepEnteredAt ?? item.updatedAt ?? item.createdAt ?? null;
        const elapsed = hoursElapsed(enteredAt);
        const thresholdHours = (threshold / 100) * tatHours;

        if (elapsed < thresholdHours) continue; // not yet due

        /* 4 — Write notification, deliver push, and don't repeat for this step */
        const itemRef = String(item[mod.refField] ?? itemDoc.id);
        const elapsed1dp = elapsed.toFixed(1);

        // Dispatching replaces a direct write plus a preceding "have we already sent
        // this?" query. The deterministic dedupe key does that job in the write
        // itself, which also closes the race the query left open: two overlapping
        // cron invocations could both find nothing and both escalate.
        //
        // It also means the escalation now reaches the assignee's phone and browser.
        // The direct write only ever populated the in-app bell — and until the bell
        // stopped filtering on a type allowlist, 'tat_escalation' was not even
        // displayed there, so these alerts reached nobody at all.
        const delivered = await dispatchNotificationOnce(
          { userIds: [escalationUserId] },
          {
            type: 'tat_escalation',
            title: `TAT Alert: ${step.name}`,
            body: `${itemRef} has been at "${step.name}" for ${elapsed1dp}h (TAT: ${tatHours}h). Action required.`,
            module: mod.workflowDocId,
            severity: 'CRITICAL',
            itemId: itemDoc.id,
            itemRef,
            stepName: step.name,
            link: mod.linkPrefix,
          },
          `tat_${mod.workflowDocId}_${itemDoc.id}_${stepId}`,
        );

        /* 5 — Mark item as escalation-notified so we don't fire again */
        await itemDoc.ref.update({ escalationNotifiedStepId: stepId });

        // A repeat pass finds the notification already created and delivers to nobody.
        // Counting that as an escalation would overstate what the run actually did.
        if (delivered) totalEscalated++;
      }
    } catch (err) {
      const msg = `[${mod.workflowDocId}] ${err instanceof Error ? err.message : String(err)}`;
      errors.push(msg);
      console.error(msg);
    }
  }

  return NextResponse.json({
    ok: true,
    checked: totalChecked,
    escalated: totalEscalated,
    errors: errors.length ? errors : undefined,
  });
}

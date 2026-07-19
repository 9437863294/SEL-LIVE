'use client';

import {
  collection, doc, getDoc, getDocs, query, setDoc, serverTimestamp, where,
} from 'firebase/firestore';
import { db } from './firebase';
import { SAS_COLLECTIONS, type SASBudgetAlertConfig } from './site-account-statement';
import { createUserNotification, type NotificationType } from './notifications';

async function resolveAdminUserIds(): Promise<string[]> {
  try {
    const rolesSnap = await getDocs(collection(db, 'roles'));
    const adminRoleNames = rolesSnap.docs
      .filter(d => {
        const perms = (d.data().permissions || {}) as Record<string, string[]>;
        return (perms['Site Account Statement.All Projects'] || []).includes('View');
      })
      .map(d => d.data().name as string)
      .filter(Boolean);
    if (!adminRoleNames.length) return [];
    const usersSnap = await getDocs(
      query(collection(db, 'users'), where('role', 'in', adminRoleNames), where('status', '==', 'Active'))
    );
    return usersSnap.docs.map(d => d.id);
  } catch {
    return [];
  }
}

/**
 * Called after any expense is saved.
 * Checks if monthly budget thresholds are crossed and fires in-app + email alerts.
 * Swallows all errors so expense save is never blocked.
 */
export async function checkAndFireBudgetAlerts({
  projectId,
  projectName,
  period,
  assignedPersonId,
  altUserId,
}: {
  projectId: string;
  projectName: string;
  period: string;          // "YYYY-MM"
  assignedPersonId?: string;
  altUserId?: string;
}): Promise<void> {
  try {
    // 1. Load alert config — stored with projectId as doc ID for O(1) lookup
    const configSnap = await getDoc(doc(db, SAS_COLLECTIONS.budgetAlertConfigs, projectId));
    if (!configSnap.exists()) return;
    const config = { id: configSnap.id, ...configSnap.data() } as SASBudgetAlertConfig;
    if (!config.enabled || !config.thresholds.length || !config.recipients.length) return;

    // 2. Load monthly budget for this project+period
    const budgetSnap = await getDocs(query(
      collection(db, SAS_COLLECTIONS.budgets),
      where('projectId', '==', projectId),
      where('budgetType', '==', 'monthly'),
      where('period', '==', period),
    ));
    if (budgetSnap.empty) return;
    const budget = budgetSnap.docs[0].data().budgetAmount as number;
    if (!budget || budget <= 0) return;

    // 3. Load current expenses total for this period using date range query
    const expSnap = await getDocs(query(
      collection(db, SAS_COLLECTIONS.expenses),
      where('projectId', '==', projectId),
      where('expenseDate', '>=', `${period}-01`),
      where('expenseDate', '<=', `${period}-31`),
    ));
    const total = expSnap.docs.reduce((s, d) => s + ((d.data().expenseAmount as number) || 0), 0);
    const pctUsed = (total / budget) * 100;

    // 4. Load alert state — tracks which thresholds have already been triggered
    const stateId = `${projectId}_${period}`;
    const stateSnap = await getDoc(doc(db, SAS_COLLECTIONS.budgetAlertState, stateId));
    const sentThresholds: number[] = stateSnap.exists() ? (stateSnap.data().sentThresholds || []) : [];

    // 5. Determine newly triggered thresholds
    const newlyCrossed = config.thresholds.filter(t => pctUsed >= t && !sentThresholds.includes(t));
    if (!newlyCrossed.length) return;

    // 6. Resolve in-app notification recipients
    const notifyIds = new Set<string>();
    if (assignedPersonId) notifyIds.add(assignedPersonId);
    if (altUserId) notifyIds.add(altUserId);
    config.recipients.forEach(r => { if (r.userId) notifyIds.add(r.userId); });
    const adminIds = await resolveAdminUserIds();
    adminIds.forEach(id => notifyIds.add(id));

    const monthLabel = new Date(`${period}-15`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    const link = '/site-account-statement/reports/budget';

    // 7. Fire alerts for each newly crossed threshold
    for (const threshold of newlyCrossed) {
      const isOver = threshold >= 100;
      const title = isOver
        ? `Budget Exceeded — ${projectName}`
        : `Budget ${threshold}% Alert — ${projectName}`;
      const body = `${projectName}: ${monthLabel} budget ${isOver ? 'exceeded' : `at ${Math.round(pctUsed)}%`}. Spent ₹${total.toLocaleString('en-IN')} of ₹${budget.toLocaleString('en-IN')}.`;

      await Promise.allSettled([...notifyIds].map(uid =>
        createUserNotification(uid, {
          type: 'budget_alert' as NotificationType,
          title,
          body,
          module: 'site-account-statement',
          itemId: projectId,
          itemRef: projectName,
          stepName: `${monthLabel} Budget`,
          link,
        })
      ));

      // Email — fire-and-forget; failure must never block expense save
      fetch('/api/sas/budget-alert-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectName,
          monthLabel,
          budgetAmount: budget,
          spentAmount: total,
          pctUsed: Math.round(pctUsed),
          thresholdPct: threshold,
          recipients: config.recipients,
          link: (typeof window !== 'undefined' ? window.location.origin : '') + link,
        }),
      }).catch(() => {});
    }

    // 8. Persist updated alert state
    await setDoc(
      doc(db, SAS_COLLECTIONS.budgetAlertState, stateId),
      { projectId, period, sentThresholds: [...sentThresholds, ...newlyCrossed], updatedAt: serverTimestamp() },
      { merge: true }
    );
  } catch (e) {
    console.error('[SAS Budget Alert] Error (swallowed):', e);
  }
}

'use client';

import {
  collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, where,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { db } from './firebase';
import { SAS_COLLECTIONS, type SASBudgetAlertConfig, type SASBudgetAlertRecipient } from './site-account-statement';
import { createUserNotification, type NotificationType } from './notifications';

// Firestore document ID used for the module-wide (all-projects) alert config
export const MODULE_ALERT_DOC_ID = '__module__';

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
 *
 * Uses the same first-crossing check as checkCategoryBudgetBreach:
 *   prevTotal < thresholdAmount  &&  newTotal >= thresholdAmount
 *
 * Merges project-specific config with the module-wide (__module__) config so
 * HO managers configured globally are always included.
 *
 * Swallows all errors — expense save must never be blocked.
 */
export async function checkAndFireBudgetAlerts({
  projectId,
  projectName,
  period,
  newExpenseAmount,
  assignedPersonId,
  altUserId,
}: {
  projectId: string;
  projectName: string;
  period: string;           // "YYYY-MM"
  newExpenseAmount: number; // amount of the expense just saved (used for prevTotal calculation)
  assignedPersonId?: string;
  altUserId?: string;
}): Promise<void> {
  try {
    // 1. Load project-specific config + module-wide config in parallel
    const [projSnap, moduleSnap] = await Promise.all([
      getDoc(doc(db, SAS_COLLECTIONS.budgetAlertConfigs, projectId)),
      getDoc(doc(db, SAS_COLLECTIONS.budgetAlertConfigs, MODULE_ALERT_DOC_ID)),
    ]);

    const projConfig  = projSnap.exists()   ? { id: projSnap.id,   ...projSnap.data()   } as SASBudgetAlertConfig : null;
    const moduleConfig = moduleSnap.exists() ? { id: moduleSnap.id, ...moduleSnap.data() } as SASBudgetAlertConfig : null;

    // 2. Build combined threshold set (union of both enabled configs)
    const activeThresholds = new Set<number>();
    if (projConfig?.enabled)   projConfig.thresholds.forEach(t  => activeThresholds.add(t));
    if (moduleConfig?.enabled) moduleConfig.thresholds.forEach(t => activeThresholds.add(t));
    if (!activeThresholds.size) return;

    // 3. Build combined recipient list (email-deduplicated)
    const recipientMap = new Map<string, SASBudgetAlertRecipient>();
    if (projConfig?.enabled)   projConfig.recipients.forEach(r   => recipientMap.set(r.email, r));
    if (moduleConfig?.enabled) moduleConfig.recipients.forEach(r  => recipientMap.set(r.email, r));
    const allRecipients = [...recipientMap.values()];
    if (!allRecipients.length) return;

    // 4. Load monthly budget for this project+period
    const budgetSnap = await getDocs(query(
      collection(db, SAS_COLLECTIONS.budgets),
      where('projectId', '==', projectId),
      where('budgetType', '==', 'monthly'),
      where('period', '==', period),
    ));
    if (budgetSnap.empty) return;
    const budget = budgetSnap.docs[0].data().budgetAmount as number;
    if (!budget || budget <= 0) return;

    // 5. Load total expenses for this period (post-save; includes the new expense)
    const expSnap = await getDocs(query(
      collection(db, SAS_COLLECTIONS.expenses),
      where('projectId', '==', projectId),
      where('expenseDate', '>=', `${period}-01`),
      where('expenseDate', '<=', `${period}-31`),
    ));
    const newTotal  = expSnap.docs.reduce((s, d) => s + ((d.data().expenseAmount as number) || 0), 0);
    const prevTotal = newTotal - newExpenseAmount;  // state before this expense was saved
    const pctUsed   = (newTotal / budget) * 100;

    // 6-7. Atomic read-modify-write: read sent thresholds, compute crossings, persist — all in one transaction.
    //      Prevents duplicate alert emails when two expenses are saved concurrently for the same project/period.
    const stateId  = `${projectId}_${period}`;
    const stateRef = doc(db, SAS_COLLECTIONS.budgetAlertState, stateId);
    let newlyCrossed: number[] = [];

    await runTransaction(db, async (txn) => {
      const stateSnap = await txn.get(stateRef);
      const sentThresholds: number[] = stateSnap.exists() ? (stateSnap.data().sentThresholds || []) : [];

      newlyCrossed = [...activeThresholds].filter(t => {
        const line = budget * (t / 100);
        return prevTotal < line && newTotal >= line && !sentThresholds.includes(t);
      });

      if (!newlyCrossed.length) return;

      txn.set(
        stateRef,
        { projectId, period, sentThresholds: [...sentThresholds, ...newlyCrossed], updatedAt: serverTimestamp() },
        { merge: true }
      );
    });

    if (!newlyCrossed.length) return;

    // 8. Resolve in-app notification user IDs
    const notifyIds = new Set<string>();
    if (assignedPersonId) notifyIds.add(assignedPersonId);
    if (altUserId)        notifyIds.add(altUserId);
    allRecipients.forEach(r => { if (r.userId) notifyIds.add(r.userId); });
    const adminIds = await resolveAdminUserIds();
    adminIds.forEach(id => notifyIds.add(id));

    const monthLabel = new Date(`${period}-15`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    const link       = '/site-account-statement/reports/budget';

    // Get Firebase ID token once for authenticated email API calls (best-effort)
    let idToken = '';
    try {
      const user = getAuth().currentUser;
      if (user) idToken = await user.getIdToken();
    } catch { /* best-effort — email will be skipped if token unavailable */ }

    // 9. Fire in-app + email alert for each newly crossed threshold
    for (const threshold of newlyCrossed) {
      const isOver = threshold >= 100;
      const title  = isOver
        ? `Budget Exceeded — ${projectName}`
        : `Budget ${threshold}% Alert — ${projectName}`;
      const body   = `${projectName}: ${monthLabel} budget ${isOver ? 'exceeded' : `at ${Math.round(pctUsed)}%`}. Spent ₹${newTotal.toLocaleString('en-IN')} of ₹${budget.toLocaleString('en-IN')}.`;

      // In-app notifications (fire-and-forget, best-effort)
      void Promise.allSettled([...notifyIds].map(uid =>
        createUserNotification(uid, {
          type:     'budget_alert' as NotificationType,
          title,
          body,
          module:   'site-account-statement',
          itemId:   projectId,
          itemRef:  projectName,
          stepName: `${monthLabel} Budget`,
          link,
        })
      ));

      // Email — fire-and-forget; must never block expense save
      fetch('/api/sas/budget-alert-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          projectName,
          monthLabel,
          budgetAmount: budget,
          spentAmount:  newTotal,
          pctUsed:      Math.round(pctUsed),
          thresholdPct: threshold,
          recipients:   allRecipients,
          link:         (typeof window !== 'undefined' ? window.location.origin : '') + link,
        }),
      }).catch(() => {});
    }

  } catch (e) {
    console.error('[SAS Budget Alert] Error (swallowed):', e);
  }
}

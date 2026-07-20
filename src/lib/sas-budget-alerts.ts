'use client';

import {
  collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, where,
} from 'firebase/firestore';
import { db } from './firebase';
import { SAS_COLLECTIONS, type SASBudgetAlertConfig, type SASBudgetAlertRecipient } from './site-account-statement';
import { createUserNotification, type NotificationType } from './notifications';

export const MODULE_ALERT_DOC_ID = '_module_wide_';

const TAG = '[SAS Budget Alert]';

// ─── Shared helpers ────────────────────────────────────────────────────────────

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
  } catch (e) {
    console.warn(TAG, 'resolveAdminUserIds failed:', e);
    return [];
  }
}

async function loadAlertConfig(projectId: string): Promise<{
  activeThresholds: Set<number>;
  allRecipients: SASBudgetAlertRecipient[];
}> {
  const [projSnap, moduleSnap] = await Promise.all([
    getDoc(doc(db, SAS_COLLECTIONS.budgetAlertConfigs, projectId)),
    getDoc(doc(db, SAS_COLLECTIONS.budgetAlertConfigs, MODULE_ALERT_DOC_ID)),
  ]);

  const projCfg = projSnap.exists()   ? projSnap.data()   as Omit<SASBudgetAlertConfig, 'id'> : null;
  const modCfg  = moduleSnap.exists() ? moduleSnap.data() as Omit<SASBudgetAlertConfig, 'id'> : null;

  console.log(TAG, 'project config:', projCfg ? `enabled=${projCfg.enabled}, thresholds=${projCfg.thresholds}, recipients=${projCfg.recipients.length}` : 'not found');
  console.log(TAG, 'module config:',  modCfg  ? `enabled=${modCfg.enabled},  thresholds=${modCfg.thresholds},  recipients=${modCfg.recipients.length}`  : 'not found');

  const activeThresholds = new Set<number>();
  if (projCfg?.enabled) projCfg.thresholds.forEach(t => activeThresholds.add(t));
  if (modCfg?.enabled)  modCfg.thresholds.forEach(t  => activeThresholds.add(t));

  const recipientMap = new Map<string, SASBudgetAlertRecipient>();
  if (projCfg?.enabled) projCfg.recipients.forEach(r => recipientMap.set(r.email, r));
  if (modCfg?.enabled)  modCfg.recipients.forEach(r  => recipientMap.set(r.email, r));

  return { activeThresholds, allRecipients: [...recipientMap.values()] };
}

// Returns "YYYY-YY" FY string for an expense period "YYYY-MM" (Indian FY: Apr–Mar)
function fyForPeriod(period: string): string {
  const [yr, mo] = period.split('-').map(Number);
  const start = mo >= 4 ? yr : yr - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}

// Returns { from: "YYYY-04-01", to: "YYYY-03-31" } for a fyPeriod like "2026-27"
function fyDateRange(fyPeriod: string): { from: string; to: string } {
  const startYr = Number(fyPeriod.split('-')[0]);
  return {
    from: `${startYr}-04-01`,
    to:   `${startYr + 1}-03-31`,
  };
}

/**
 * Fetch total expense amount for a project, optionally filtered by date range and/or category.
 * Falls back to a client-side filter when composite indexes are still building.
 */
async function fetchExpenseTotal({
  projectId,
  from,
  to,
  categoryName,
}: {
  projectId: string;
  from?: string;
  to?: string;
  categoryName?: string;
}): Promise<number> {
  // Build the full-filter query
  const fullConstraints: Parameters<typeof where>[] = [
    ['projectId', '==', projectId] as Parameters<typeof where>,
  ];
  if (categoryName) fullConstraints.push(['expenseCategory', '==', categoryName] as Parameters<typeof where>);
  if (from)         fullConstraints.push(['expenseDate', '>=', from] as Parameters<typeof where>);
  if (to)           fullConstraints.push(['expenseDate', '<=', to]   as Parameters<typeof where>);

  try {
    const snap = await getDocs(query(
      collection(db, SAS_COLLECTIONS.expenses),
      ...fullConstraints.map(args => where(...args)),
    ));
    return snap.docs.reduce((s, d) => s + ((d.data().expenseAmount as number) || 0), 0);
  } catch (err: any) {
    if (err?.code !== 'failed-precondition') throw err;
    // Composite index still building — use simpler query + client-side date filter
    console.warn(TAG, 'composite index not ready, using fallback query (projectId + optional category)');
    const fallbackConstraints: Parameters<typeof where>[] = [
      ['projectId', '==', projectId] as Parameters<typeof where>,
    ];
    if (categoryName) fallbackConstraints.push(['expenseCategory', '==', categoryName] as Parameters<typeof where>);
    const snap = await getDocs(query(
      collection(db, SAS_COLLECTIONS.expenses),
      ...fallbackConstraints.map(args => where(...args)),
    ));
    return snap.docs
      .filter(d => {
        const dt = d.data().expenseDate as string;
        if (from && dt < from) return false;
        if (to   && dt > to)   return false;
        return true;
      })
      .reduce((s, d) => s + ((d.data().expenseAmount as number) || 0), 0);
  }
}

async function sendAlertEmail(payload: Record<string, unknown>): Promise<void> {
  try {
    const res = await fetch('/api/sas/budget-alert-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(TAG, `email API returned ${res.status}:`, body);
    } else {
      console.log(TAG, 'email sent successfully');
    }
  } catch (e) {
    console.error(TAG, 'email fetch failed:', e);
  }
}

// Shared: check thresholds, dedup via runTransaction, fire notifications + email
async function fireAlertIfCrossed({
  tag,
  stateDocId,
  activeThresholds,
  allRecipients,
  budget,
  newTotal,
  newExpenseAmount,
  projectId,
  projectName,
  period,          // "YYYY-MM" for monthly/category, "YYYY-YY" for FY, undefined for total
  periodLabel,     // human readable: "July 2026", "FY 2026-27", "All Time"
  scopeType,       // 'monthly' | 'category' | 'fy' | 'total'
  categoryName,
  assignedPersonId,
  altUserId,
}: {
  tag: string;
  stateDocId: string;
  activeThresholds: Set<number>;
  allRecipients: SASBudgetAlertRecipient[];
  budget: number;
  newTotal: number;
  newExpenseAmount: number;
  projectId: string;
  projectName: string;
  period?: string;
  periodLabel: string;
  scopeType: 'monthly' | 'category' | 'fy' | 'total';
  categoryName?: string;
  assignedPersonId?: string;
  altUserId?: string;
}): Promise<void> {
  const prevTotal = newTotal - newExpenseAmount;
  const pctUsed   = (newTotal / budget) * 100;

  console.log(TAG, `[${tag}] budget=₹${budget} prevTotal=₹${prevTotal} newTotal=₹${newTotal} (${pctUsed.toFixed(1)}%)`);
  console.log(TAG, `[${tag}] checking thresholds:`, [...activeThresholds]);

  const stateRef = doc(db, SAS_COLLECTIONS.budgetAlertState, stateDocId);
  let newlyCrossed: number[] = [];

  await runTransaction(db, async (txn) => {
    const stateSnap = await txn.get(stateRef);
    const sent: number[] = stateSnap.exists() ? (stateSnap.data().sentThresholds || []) : [];
    console.log(TAG, `[${tag}] already sent thresholds:`, sent);

    newlyCrossed = [...activeThresholds].filter(t => {
      const line   = budget * (t / 100);
      const crosses = prevTotal < line && newTotal >= line && !sent.includes(t);
      console.log(TAG, `  threshold ${t}%: line=₹${line.toFixed(0)}, crosses=${crosses}`);
      return crosses;
    });

    if (!newlyCrossed.length) return;
    txn.set(stateRef, {
      projectId, period: period ?? null, categoryName: categoryName ?? null, scopeType,
      sentThresholds: [...sent, ...newlyCrossed],
      updatedAt: serverTimestamp(),
    }, { merge: true });
  });

  if (!newlyCrossed.length) {
    console.log(TAG, `[${tag}] no newly crossed thresholds`); return;
  }
  console.log(TAG, `[${tag}] newly crossed:`, newlyCrossed);

  const notifyIds = new Set<string>();
  if (assignedPersonId) notifyIds.add(assignedPersonId);
  if (altUserId)        notifyIds.add(altUserId);
  allRecipients.forEach(r => { if (r.userId) notifyIds.add(r.userId); });
  (await resolveAdminUserIds()).forEach(id => notifyIds.add(id));

  const link = '/site-account-statement/reports/budget';

  for (const threshold of newlyCrossed) {
    const isOver     = threshold >= 100;
    const scopeLabel = categoryName ? `${categoryName} Category` : scopeType === 'fy' ? 'FY Budget' : scopeType === 'total' ? 'Project Total Budget' : 'Monthly Budget';
    const title = isOver
      ? `${scopeLabel} Exceeded — ${projectName}`
      : `${scopeLabel} ${threshold}% Alert — ${projectName}`;
    const body  = `${projectName}${categoryName ? ` · ${categoryName}` : ''}: ${periodLabel} ${scopeLabel.toLowerCase()} ${isOver ? 'exceeded' : `at ${Math.round(pctUsed)}%`}. Spent ₹${newTotal.toLocaleString('en-IN')} of ₹${budget.toLocaleString('en-IN')}.`;

    void Promise.allSettled([...notifyIds].map(uid =>
      createUserNotification(uid, {
        type: 'budget_alert' as NotificationType,
        title, body,
        module: 'site-account-statement',
        itemId: projectId, itemRef: projectName,
        stepName: `${periodLabel}${categoryName ? ` · ${categoryName}` : ''}`,
        link,
      })
    ));

    void sendAlertEmail({
      projectName,
      monthLabel:   periodLabel,
      budgetAmount: budget,
      spentAmount:  newTotal,
      pctUsed:      Math.round(pctUsed),
      thresholdPct: threshold,
      categoryName,
      scopeType,
      recipients:   allRecipients,
      link: (typeof window !== 'undefined' ? window.location.origin : '') + link,
    });
  }
}

// ─── 1. Monthly project-wide alert ────────────────────────────────────────────

export async function checkAndFireBudgetAlerts({
  projectId, projectName, period, newExpenseAmount, assignedPersonId, altUserId,
}: {
  projectId: string; projectName: string; period: string;
  newExpenseAmount: number; assignedPersonId?: string; altUserId?: string;
}): Promise<void> {
  console.log(TAG, `[monthly] checking project=${projectId} period=${period} newAmount=${newExpenseAmount}`);
  try {
    const { activeThresholds, allRecipients } = await loadAlertConfig(projectId);
    if (!activeThresholds.size) { console.log(TAG, '[monthly] no active thresholds — skipping'); return; }
    if (!allRecipients.length)  { console.log(TAG, '[monthly] no recipients — skipping'); return; }

    // Monthly budget — explicit monthly, or FY÷12, or sum of category budgets
    const monthSnap = await getDocs(query(collection(db, SAS_COLLECTIONS.budgets),
      where('projectId', '==', projectId), where('budgetType', '==', 'monthly'), where('period', '==', period)));
    let budget: number | null = null;
    if (!monthSnap.empty) {
      const amt = monthSnap.docs[0].data().budgetAmount as number;
      if (amt > 0) { budget = amt; console.log(TAG, `[monthly] monthly budget: ₹${amt}`); }
    }
    if (!budget) {
      const fySnap = await getDocs(query(collection(db, SAS_COLLECTIONS.budgets),
        where('projectId', '==', projectId), where('budgetType', '==', 'fy'), where('period', '==', fyForPeriod(period))));
      if (!fySnap.empty) {
        const amt = fySnap.docs[0].data().budgetAmount as number;
        if (amt > 0) { budget = Math.round(amt / 12); console.log(TAG, `[monthly] FY÷12: ₹${budget}`); }
      }
    }
    if (!budget) {
      const catSnap = await getDocs(query(collection(db, SAS_COLLECTIONS.categoryBudgets),
        where('projectId', '==', projectId), where('period', '==', period)));
      if (!catSnap.empty) {
        const total = catSnap.docs.reduce((s, d) => s + ((d.data().budgetAmount as number) || 0), 0);
        if (total > 0) { budget = total; console.log(TAG, `[monthly] sum of category budgets: ₹${total}`); }
      }
    }
    if (!budget) { console.log(TAG, '[monthly] no budget found — skipping'); return; }

    const newTotal = await fetchExpenseTotal({ projectId, from: `${period}-01`, to: `${period}-31` });
    const monthLabel = new Date(`${period}-15`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

    await fireAlertIfCrossed({
      tag: 'monthly', stateDocId: `${projectId}_${period}`,
      activeThresholds, allRecipients, budget, newTotal, newExpenseAmount,
      projectId, projectName, period, periodLabel: monthLabel,
      scopeType: 'monthly', assignedPersonId, altUserId,
    });
  } catch (e) {
    console.error(TAG, '[monthly] error:', e);
  }
}

// ─── 2. FY-wide alert ─────────────────────────────────────────────────────────

// Returns all 12 "YYYY-MM" period strings belonging to a given FY (e.g. "2026-27")
function fyMonthPeriods(fyPeriod: string): string[] {
  const startYr = Number(fyPeriod.split('-')[0]);
  const months: string[] = [];
  for (let m = 4; m <= 12; m++) months.push(`${startYr}-${String(m).padStart(2, '0')}`);
  for (let m = 1; m <= 3;  m++) months.push(`${startYr + 1}-${String(m).padStart(2, '0')}`);
  return months;
}

export async function checkFyBudgetAlerts({
  projectId, projectName, period, newExpenseAmount, assignedPersonId, altUserId,
}: {
  projectId: string; projectName: string; period: string;
  newExpenseAmount: number; assignedPersonId?: string; altUserId?: string;
}): Promise<void> {
  const fyPeriod = fyForPeriod(period);
  console.log(TAG, `[fy] checking project=${projectId} fy=${fyPeriod} newAmount=${newExpenseAmount}`);
  try {
    const { activeThresholds, allRecipients } = await loadAlertConfig(projectId);
    if (!activeThresholds.size) { console.log(TAG, '[fy] no active thresholds — skipping'); return; }
    if (!allRecipients.length)  { console.log(TAG, '[fy] no recipients — skipping'); return; }

    // 1. Explicit FY budget
    let budget: number | null = null;
    const fySnap = await getDocs(query(collection(db, SAS_COLLECTIONS.budgets),
      where('projectId', '==', projectId), where('budgetType', '==', 'fy'), where('period', '==', fyPeriod)));
    if (!fySnap.empty) {
      const amt = fySnap.docs[0].data().budgetAmount as number;
      if (amt > 0) { budget = amt; console.log(TAG, `[fy] explicit FY budget: ₹${amt}`); }
    }

    // 2. Fallback: sum of monthly budgets set for this FY's 12 months
    if (!budget) {
      const fyMonths = fyMonthPeriods(fyPeriod);
      const monthSnap = await getDocs(query(collection(db, SAS_COLLECTIONS.budgets),
        where('projectId', '==', projectId), where('budgetType', '==', 'monthly'), where('period', 'in', fyMonths)));
      if (!monthSnap.empty) {
        const total = monthSnap.docs.reduce((s, d) => s + ((d.data().budgetAmount as number) || 0), 0);
        if (total > 0) { budget = total; console.log(TAG, `[fy] sum of monthly budgets: ₹${total}`); }
      }
    }

    if (!budget) { console.log(TAG, `[fy] no budget found for ${fyPeriod} — skipping`); return; }

    const { from, to } = fyDateRange(fyPeriod);
    const newTotal = await fetchExpenseTotal({ projectId, from, to });
    const fyLabel  = `FY ${fyPeriod}`;

    await fireAlertIfCrossed({
      tag: 'fy', stateDocId: `${projectId}_fy_${fyPeriod}`,
      activeThresholds, allRecipients, budget, newTotal, newExpenseAmount,
      projectId, projectName, period: fyPeriod, periodLabel: fyLabel,
      scopeType: 'fy', assignedPersonId, altUserId,
    });
  } catch (e) {
    console.error(TAG, '[fy] error:', e);
  }
}

// ─── 3. Project total (all-time) alert ────────────────────────────────────────

export async function checkTotalBudgetAlerts({
  projectId, projectName, newExpenseAmount, assignedPersonId, altUserId,
}: {
  projectId: string; projectName: string;
  newExpenseAmount: number; assignedPersonId?: string; altUserId?: string;
}): Promise<void> {
  console.log(TAG, `[total] checking project=${projectId} newAmount=${newExpenseAmount}`);
  try {
    const { activeThresholds, allRecipients } = await loadAlertConfig(projectId);
    if (!activeThresholds.size) { console.log(TAG, '[total] no active thresholds — skipping'); return; }
    if (!allRecipients.length)  { console.log(TAG, '[total] no recipients — skipping'); return; }

    // 1. Explicit project total budget
    let budget: number | null = null;
    const totalSnap = await getDocs(query(collection(db, SAS_COLLECTIONS.budgets),
      where('projectId', '==', projectId), where('budgetType', '==', 'total')));
    if (!totalSnap.empty) {
      const amt = totalSnap.docs[0].data().budgetAmount as number;
      if (amt > 0) { budget = amt; console.log(TAG, `[total] explicit total budget: ₹${amt}`); }
    }

    // 2. Fallback: sum of all FY budgets set for this project
    if (!budget) {
      const fySnap = await getDocs(query(collection(db, SAS_COLLECTIONS.budgets),
        where('projectId', '==', projectId), where('budgetType', '==', 'fy')));
      if (!fySnap.empty) {
        const total = fySnap.docs.reduce((s, d) => s + ((d.data().budgetAmount as number) || 0), 0);
        if (total > 0) { budget = total; console.log(TAG, `[total] sum of FY budgets: ₹${total}`); }
      }
    }

    // 3. Fallback: sum of all monthly budgets set for this project
    if (!budget) {
      const monthSnap = await getDocs(query(collection(db, SAS_COLLECTIONS.budgets),
        where('projectId', '==', projectId), where('budgetType', '==', 'monthly')));
      if (!monthSnap.empty) {
        const total = monthSnap.docs.reduce((s, d) => s + ((d.data().budgetAmount as number) || 0), 0);
        if (total > 0) { budget = total; console.log(TAG, `[total] sum of monthly budgets: ₹${total}`); }
      }
    }

    if (!budget) { console.log(TAG, '[total] no budget found — skipping'); return; }

    // All-time total — single equality filter, no composite index needed
    const newTotal = await fetchExpenseTotal({ projectId });

    await fireAlertIfCrossed({
      tag: 'total', stateDocId: `${projectId}_total`,
      activeThresholds, allRecipients, budget, newTotal, newExpenseAmount,
      projectId, projectName, periodLabel: 'Project Total',
      scopeType: 'total', assignedPersonId, altUserId,
    });
  } catch (e) {
    console.error(TAG, '[total] error:', e);
  }
}

// ─── 4. Category-wise alert ───────────────────────────────────────────────────

export async function checkCategoryBudgetAlerts({
  projectId, projectName, categoryName, period, newExpenseAmount, assignedPersonId, altUserId,
}: {
  projectId: string; projectName: string; categoryName: string; period: string;
  newExpenseAmount: number; assignedPersonId?: string; altUserId?: string;
}): Promise<void> {
  console.log(TAG, `[category] checking project=${projectId} category="${categoryName}" period=${period} newAmount=${newExpenseAmount}`);
  try {
    const { activeThresholds, allRecipients } = await loadAlertConfig(projectId);
    if (!activeThresholds.size) { console.log(TAG, '[category] no active thresholds — skipping'); return; }
    if (!allRecipients.length)  { console.log(TAG, '[category] no recipients — skipping'); return; }

    const cbSnap = await getDocs(query(collection(db, SAS_COLLECTIONS.categoryBudgets),
      where('projectId', '==', projectId),
      where('categoryName', '==', categoryName),
      where('period', '==', period)));
    if (cbSnap.empty) { console.log(TAG, `[category] no category budget for "${categoryName}" in ${period} — skipping`); return; }
    const budget = cbSnap.docs[0].data().budgetAmount as number;
    if (!budget || budget <= 0) { console.log(TAG, '[category] category budget is zero — skipping'); return; }
    console.log(TAG, `[category] category budget=₹${budget}`);

    const newTotal = await fetchExpenseTotal({ projectId, categoryName, from: `${period}-01`, to: `${period}-31` });
    const monthLabel = new Date(`${period}-15`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    const safeCategory = categoryName.replace(/[^a-zA-Z0-9_-]/g, '_');

    await fireAlertIfCrossed({
      tag: 'category', stateDocId: `${projectId}_${period}_cat_${safeCategory}`,
      activeThresholds, allRecipients, budget, newTotal, newExpenseAmount,
      projectId, projectName, period, periodLabel: monthLabel,
      scopeType: 'category', categoryName, assignedPersonId, altUserId,
    });
  } catch (e) {
    console.error(TAG, '[category] error:', e);
  }
}

'use client';

import {
  collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, where, writeBatch,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { SAS_COLLECTIONS, type SASBudgetAlertConfig, type SASBudgetAlertRecipient } from './site-account-statement';
import { createUserNotification, type NotificationType } from './notifications';

export const MODULE_ALERT_DOC_ID = '_module_wide_';

const TAG = '[SAS Budget Alert]';

/** Firestore caps `in` filters at 30 values. */
const IN_CHUNK = 30;

/**
 * Diagnostic logging is opt-in.
 *
 * This module used to print every project's budget, spend and threshold configuration to the
 * browser console on every expense save. That is a lot of noise for a working feature, and it puts
 * other projects' financial figures into a log that is trivially captured. Set
 * `NEXT_PUBLIC_SAS_ALERT_DEBUG=true` when actually debugging the alert ladder.
 */
const DEBUG = process.env.NEXT_PUBLIC_SAS_ALERT_DEBUG === 'true';
function trace(...args: unknown[]): void {
  if (DEBUG) console.log(TAG, ...args);
}

const chunk = <T,>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

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
    // `in` accepts at most 30 values. An installation with more admin roles than that used to throw
    // here, get swallowed by the catch, and silently stop notifying every administrator.
    const batches = await Promise.all(
      chunk(adminRoleNames, IN_CHUNK).map(names =>
        getDocs(query(collection(db, 'users'), where('role', 'in', names), where('status', '==', 'Active')))
      )
    );
    return [...new Set(batches.flatMap(snap => snap.docs.map(d => d.id)))];
  } catch (e) {
    console.warn(TAG, 'resolveAdminUserIds failed:', e);
    return [];
  }
}

export interface ResolvedAlertConfig {
  activeThresholds: Set<number>;
  allRecipients: SASBudgetAlertRecipient[];
}

async function loadAlertConfig(projectId: string): Promise<ResolvedAlertConfig> {
  const [projSnap, moduleSnap] = await Promise.all([
    getDoc(doc(db, SAS_COLLECTIONS.budgetAlertConfigs, projectId)),
    getDoc(doc(db, SAS_COLLECTIONS.budgetAlertConfigs, MODULE_ALERT_DOC_ID)),
  ]);

  const projCfg = projSnap.exists()   ? projSnap.data()   as Omit<SASBudgetAlertConfig, 'id'> : null;
  const modCfg  = moduleSnap.exists() ? moduleSnap.data() as Omit<SASBudgetAlertConfig, 'id'> : null;

  // `thresholds` and `recipients` are written by the settings UI, but a hand-edited or partially
  // migrated document can be missing either. Reading `.length` off an absent array used to throw
  // inside the caller's try/catch, which disabled alerts for that project with no visible cause.
  const thresholdsOf = (cfg: Omit<SASBudgetAlertConfig, 'id'> | null) =>
    cfg?.enabled ? (Array.isArray(cfg.thresholds) ? cfg.thresholds : []) : [];
  const recipientsOf = (cfg: Omit<SASBudgetAlertConfig, 'id'> | null) =>
    cfg?.enabled ? (Array.isArray(cfg.recipients) ? cfg.recipients : []) : [];

  trace(`config: project(enabled=${projCfg?.enabled ?? false}) module(enabled=${modCfg?.enabled ?? false})`);

  const activeThresholds = new Set<number>([
    ...thresholdsOf(projCfg),
    ...thresholdsOf(modCfg),
  ].filter(t => typeof t === 'number' && Number.isFinite(t)));

  const recipientMap = new Map<string, SASBudgetAlertRecipient>();
  [...recipientsOf(projCfg), ...recipientsOf(modCfg)].forEach(r => {
    if (r?.email) recipientMap.set(r.email.trim().toLowerCase(), r);
  });

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

/**
 * Posts an alert to the mail route.
 *
 * The route is authenticated now (it was previously an open relay that would send a company-branded
 * message to any address on request), so every call carries the caller's Firebase ID token.
 */
export async function sendAlertEmail(payload: Record<string, unknown>): Promise<boolean> {
  try {
    const user = auth.currentUser;
    if (!user) {
      console.warn(TAG, 'no signed-in user — skipping alert email');
      return false;
    }
    const token = await user.getIdToken();
    const res = await fetch('/api/sas/budget-alert-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null) as { error?: string } | null;
      const detail = body?.error || `HTTP ${res.status}`;
      // 503 means the server cannot send mail at all (Admin credentials missing) rather than that
      // anything is wrong with this alert. The in-app notification has already gone out either way,
      // so this is a warning about a degraded channel, not a failed alert.
      if (res.status === 503) console.warn(TAG, 'e-mail channel unavailable —', detail);
      else console.error(TAG, `email API returned ${res.status}:`, detail);
      return false;
    }
    trace('email sent successfully');
    return true;
  } catch (e) {
    console.error(TAG, 'email fetch failed:', e);
    return false;
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
  if (!(budget > 0)) { trace(`[${tag}] budget is zero — skipping`); return; }
  const pctUsed = (newTotal / budget) * 100;

  trace(`[${tag}] budget=₹${budget} newTotal=₹${newTotal} delta=₹${newExpenseAmount} (${pctUsed.toFixed(1)}%)`);

  const stateRef = doc(db, SAS_COLLECTIONS.budgetAlertState, stateDocId);
  let newlyCrossed: number[] = [];

  /*
   * Which thresholds are "newly crossed" is decided purely from the *current* total against the
   * transactionally-read `sentThresholds` set.
   *
   * The previous implementation compared a reconstructed `prevTotal = newTotal - newExpenseAmount`
   * against each line. That is wrong under concurrency: two people saving expenses at the same
   * moment both read the same post-write server total and each subtracts only their own amount, so
   * a line that sits between the two reconstructed "previous" totals is crossed by neither and the
   * alert is silently lost. Testing `newTotal >= line` instead cannot miss a crossing, and
   * `sentThresholds` — read and written inside the transaction — is what guarantees it fires once.
   */
  await runTransaction(db, async (txn) => {
    const stateSnap = await txn.get(stateRef);
    const sent: number[] = stateSnap.exists() ? (stateSnap.data().sentThresholds || []) : [];

    newlyCrossed = [...activeThresholds].filter(t => newTotal >= budget * (t / 100) && !sent.includes(t));

    if (!newlyCrossed.length) return;
    txn.set(stateRef, {
      projectId, period: period ?? null, categoryName: categoryName ?? null, scopeType,
      sentThresholds: [...sent, ...newlyCrossed].sort((a, b) => a - b),
      lastTotal: newTotal,
      lastBudget: budget,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  });

  // Determine which threshold to alert on:
  // • New crossing → highest threshold just crossed (all are saved to Firestore above).
  // • Already past the highest configured threshold → alert on every subsequent expense
  //   so the team knows the project is still over budget even after all thresholds fired.
  let threshold: number;
  if (newlyCrossed.length) {
    threshold = Math.max(...newlyCrossed);
    trace(`[${tag}] newly crossed: ${newlyCrossed.join(', ')}% — alerting for highest: ${threshold}%`);
  } else {
    const maxThreshold = Math.max(...activeThresholds);
    if (newTotal >= budget * (maxThreshold / 100)) {
      threshold = maxThreshold;
      trace(`[${tag}] already past ${maxThreshold}% — per-expense overage alert`);
    } else {
      trace(`[${tag}] no newly crossed thresholds — skipping`); return;
    }
  }

  const notifyIds = new Set<string>();
  if (assignedPersonId) notifyIds.add(assignedPersonId);
  if (altUserId)        notifyIds.add(altUserId);
  allRecipients.forEach(r => { if (r.userId) notifyIds.add(r.userId); });
  (await resolveAdminUserIds()).forEach(id => notifyIds.add(id));

  const link = '/site-account-statement/reports/budget';

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

  // Email is a *delivery channel*, not a precondition. Callers used to bail out entirely when no
  // e-mail recipients were configured, which silently suppressed the in-app notification above —
  // even though its audience (the assigned person, the alt user, administrators) needs no e-mail
  // address at all. A project with thresholds set and no mailing list now still gets the bell.
  if (allRecipients.length === 0) {
    trace(`[${tag}] no e-mail recipients configured — in-app notification only`);
    return;
  }

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

// ─── Alert state reset ────────────────────────────────────────────────────────

/**
 * Clears the "already sent" ledger for a project, so its thresholds can fire again.
 *
 * `sentThresholds` was append-only and never cleared. That is right while a budget and its spend
 * only ever grow, and wrong the moment either changes underneath it: raise a monthly budget after
 * the 80% alert fired and 80% of the *new*, larger budget can never alert; delete the expense that
 * tipped a project over and the 100% mark stays permanently spent. Both leave the team believing
 * alerts are armed when they are not.
 *
 * Callers pass the narrowest scope they can — a specific period after a budget edit, the whole
 * project after a bulk import — because clearing more than necessary re-sends alerts people have
 * already acted on.
 */
export async function resetBudgetAlertState({
  projectId,
  period,
  scopeType,
}: {
  projectId: string;
  /** `YYYY-MM` for monthly/category scopes, `YYYY-YY` for FY. Omit to clear every period. */
  period?: string;
  /** Omit to clear every scope type for the project. */
  scopeType?: 'monthly' | 'category' | 'fy' | 'total';
}): Promise<void> {
  try {
    const snap = await getDocs(query(
      collection(db, SAS_COLLECTIONS.budgetAlertState),
      where('projectId', '==', projectId),
    ));
    const targets = snap.docs.filter(d => {
      const data = d.data();
      if (scopeType && data.scopeType !== scopeType) return false;
      if (period   && data.period    !== period)     return false;
      return true;
    });
    if (!targets.length) return;

    // Small batches by construction — one document per period per scope for one project.
    const batch = writeBatch(db);
    targets.forEach(d => batch.delete(d.ref));
    await batch.commit();
    trace(`reset ${targets.length} alert state doc(s) for ${projectId}`);
  } catch (e) {
    // A failed reset must never block the edit that triggered it. Worst case the operator re-saves.
    console.warn(TAG, 'resetBudgetAlertState failed:', e);
  }
}

/**
 * Re-runs every budget check for one expense in one pass.
 *
 * The four checkers each used to load the same two alert-config documents independently, so a
 * single expense save issued eight `getDoc`s for two documents, four `roles` scans and four `users`
 * scans. This loads the configuration once and hands it to all four.
 *
 * `changedPeriods` exists for edits: moving an expense from June to July has to re-evaluate both
 * months, not just the one the expense now sits in.
 */
export async function runBudgetAlertChecks({
  projectId, projectName, periods, categoryNames, newExpenseAmount, assignedPersonId, altUserId,
}: {
  projectId: string;
  projectName: string;
  /** Every `YYYY-MM` period touched by the change. */
  periods: string[];
  /** Every main-category name touched by the change. */
  categoryNames: string[];
  newExpenseAmount: number;
  assignedPersonId?: string;
  altUserId?: string;
}): Promise<void> {
  try {
    const config = await loadAlertConfig(projectId);
    if (!config.activeThresholds.size) { trace('no active thresholds — skipping all checks'); return; }

    const base = { projectId, projectName, newExpenseAmount, assignedPersonId, altUserId, config };
    const uniquePeriods = [...new Set(periods.filter(Boolean))];
    const uniqueCategories = [...new Set(categoryNames.filter(Boolean))];

    await Promise.allSettled([
      ...uniquePeriods.map(period => checkAndFireBudgetAlerts({ ...base, period })),
      ...uniquePeriods.map(period => checkFyBudgetAlerts({ ...base, period })),
      checkTotalBudgetAlerts(base),
      ...uniquePeriods.flatMap(period =>
        uniqueCategories.map(categoryName => checkCategoryBudgetAlerts({ ...base, period, categoryName }))
      ),
    ]);
  } catch (e) {
    console.error(TAG, 'runBudgetAlertChecks failed:', e);
  }
}

// ─── 1. Monthly project-wide alert ────────────────────────────────────────────

export async function checkAndFireBudgetAlerts({
  projectId, projectName, period, newExpenseAmount, assignedPersonId, altUserId, config,
}: {
  projectId: string; projectName: string; period: string;
  newExpenseAmount: number; assignedPersonId?: string; altUserId?: string;
  config?: ResolvedAlertConfig;
}): Promise<void> {
  trace(`[monthly] checking project=${projectId} period=${period} delta=${newExpenseAmount}`);
  try {
    const { activeThresholds, allRecipients } = config ?? await loadAlertConfig(projectId);
    if (!activeThresholds.size) { trace('[monthly] no active thresholds — skipping'); return; }

    // Monthly budget — explicit monthly, or FY÷12, or sum of category budgets
    const monthSnap = await getDocs(query(collection(db, SAS_COLLECTIONS.budgets),
      where('projectId', '==', projectId), where('budgetType', '==', 'monthly'), where('period', '==', period)));
    let budget: number | null = null;
    if (!monthSnap.empty) {
      const amt = monthSnap.docs[0].data().budgetAmount as number;
      if (amt > 0) { budget = amt; trace(`[monthly] monthly budget: ₹${amt}`); }
    }
    if (!budget) {
      const fySnap = await getDocs(query(collection(db, SAS_COLLECTIONS.budgets),
        where('projectId', '==', projectId), where('budgetType', '==', 'fy'), where('period', '==', fyForPeriod(period))));
      if (!fySnap.empty) {
        const amt = fySnap.docs[0].data().budgetAmount as number;
        if (amt > 0) { budget = Math.round(amt / 12); trace(`[monthly] FY÷12: ₹${budget}`); }
      }
    }
    if (!budget) {
      const catSnap = await getDocs(query(collection(db, SAS_COLLECTIONS.categoryBudgets),
        where('projectId', '==', projectId), where('period', '==', period)));
      if (!catSnap.empty) {
        const total = catSnap.docs.reduce((s, d) => s + ((d.data().budgetAmount as number) || 0), 0);
        if (total > 0) { budget = total; trace(`[monthly] sum of category budgets: ₹${total}`); }
      }
    }
    if (!budget) { trace('[monthly] no budget found — skipping'); return; }

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
  projectId, projectName, period, newExpenseAmount, assignedPersonId, altUserId, config,
}: {
  projectId: string; projectName: string; period: string;
  newExpenseAmount: number; assignedPersonId?: string; altUserId?: string;
  config?: ResolvedAlertConfig;
}): Promise<void> {
  const fyPeriod = fyForPeriod(period);
  trace(`[fy] checking project=${projectId} fy=${fyPeriod} delta=${newExpenseAmount}`);
  try {
    const { activeThresholds, allRecipients } = config ?? await loadAlertConfig(projectId);
    if (!activeThresholds.size) { trace('[fy] no active thresholds — skipping'); return; }

    // 1. Explicit FY budget
    let budget: number | null = null;
    const fySnap = await getDocs(query(collection(db, SAS_COLLECTIONS.budgets),
      where('projectId', '==', projectId), where('budgetType', '==', 'fy'), where('period', '==', fyPeriod)));
    if (!fySnap.empty) {
      const amt = fySnap.docs[0].data().budgetAmount as number;
      if (amt > 0) { budget = amt; trace(`[fy] explicit FY budget: ₹${amt}`); }
    }

    // 2. Fallback: sum of monthly budgets set for this FY's 12 months
    if (!budget) {
      const fyMonths = fyMonthPeriods(fyPeriod);
      const monthSnap = await getDocs(query(collection(db, SAS_COLLECTIONS.budgets),
        where('projectId', '==', projectId), where('budgetType', '==', 'monthly'), where('period', 'in', fyMonths)));
      if (!monthSnap.empty) {
        const total = monthSnap.docs.reduce((s, d) => s + ((d.data().budgetAmount as number) || 0), 0);
        if (total > 0) { budget = total; trace(`[fy] sum of monthly budgets: ₹${total}`); }
      }
    }

    if (!budget) { trace(`[fy] no budget found for ${fyPeriod} — skipping`); return; }

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
  projectId, projectName, newExpenseAmount, assignedPersonId, altUserId, config,
}: {
  projectId: string; projectName: string;
  newExpenseAmount: number; assignedPersonId?: string; altUserId?: string;
  config?: ResolvedAlertConfig;
}): Promise<void> {
  trace(`[total] checking project=${projectId} delta=${newExpenseAmount}`);
  try {
    const { activeThresholds, allRecipients } = config ?? await loadAlertConfig(projectId);
    if (!activeThresholds.size) { trace('[total] no active thresholds — skipping'); return; }

    // 1. Explicit project total budget
    let budget: number | null = null;
    const totalSnap = await getDocs(query(collection(db, SAS_COLLECTIONS.budgets),
      where('projectId', '==', projectId), where('budgetType', '==', 'total')));
    if (!totalSnap.empty) {
      const amt = totalSnap.docs[0].data().budgetAmount as number;
      if (amt > 0) { budget = amt; trace(`[total] explicit total budget: ₹${amt}`); }
    }

    // 2. Fallback: sum of all FY budgets set for this project
    if (!budget) {
      const fySnap = await getDocs(query(collection(db, SAS_COLLECTIONS.budgets),
        where('projectId', '==', projectId), where('budgetType', '==', 'fy')));
      if (!fySnap.empty) {
        const total = fySnap.docs.reduce((s, d) => s + ((d.data().budgetAmount as number) || 0), 0);
        if (total > 0) { budget = total; trace(`[total] sum of FY budgets: ₹${total}`); }
      }
    }

    // 3. Fallback: sum of all monthly budgets set for this project
    if (!budget) {
      const monthSnap = await getDocs(query(collection(db, SAS_COLLECTIONS.budgets),
        where('projectId', '==', projectId), where('budgetType', '==', 'monthly')));
      if (!monthSnap.empty) {
        const total = monthSnap.docs.reduce((s, d) => s + ((d.data().budgetAmount as number) || 0), 0);
        if (total > 0) { budget = total; trace(`[total] sum of monthly budgets: ₹${total}`); }
      }
    }

    if (!budget) { trace('[total] no budget found — skipping'); return; }

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
  projectId, projectName, categoryName, period, newExpenseAmount, assignedPersonId, altUserId, config,
}: {
  projectId: string; projectName: string; categoryName: string; period: string;
  newExpenseAmount: number; assignedPersonId?: string; altUserId?: string;
  config?: ResolvedAlertConfig;
}): Promise<void> {
  trace(`[category] checking project=${projectId} category="${categoryName}" period=${period} delta=${newExpenseAmount}`);
  try {
    const { activeThresholds, allRecipients } = config ?? await loadAlertConfig(projectId);
    if (!activeThresholds.size) { trace('[category] no active thresholds — skipping'); return; }

    const cbSnap = await getDocs(query(collection(db, SAS_COLLECTIONS.categoryBudgets),
      where('projectId', '==', projectId),
      where('categoryName', '==', categoryName),
      where('period', '==', period)));
    if (cbSnap.empty) { trace(`[category] no category budget for "${categoryName}" in ${period} — skipping`); return; }
    const budget = cbSnap.docs[0].data().budgetAmount as number;
    if (!budget || budget <= 0) { trace('[category] category budget is zero — skipping'); return; }
    trace(`[category] category budget=₹${budget}`);

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

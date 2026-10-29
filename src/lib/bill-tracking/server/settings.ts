import 'server-only';

/**
 * Bill Tracking configuration: settings, masters (bill types, deduction types, stages), project
 * profiles (DGM office, billing client, credit days), month closure and per-user saved views.
 */

import { validateAgeingBuckets } from '../calculations.ts';
import { validateCategoryConfig } from '../categories.ts';
import { DEFAULT_CONFIG, withConfigDefaults } from '../defaults.ts';
import { normaliseNoteRules, noteRulesProblem } from '../note-rules.ts';
import { normaliseWorkflowSteps, workflowProblem } from '../workflow.ts';
import type { ConfigInput } from '../schemas';
import type { BillTrackingConfig } from '../types';
import { BtError, db, type BtContext } from './context';
import { BT_COLLECTIONS, clean, configRef, invalidateConfig, loadConfigFresh, logActivity, nowIso } from './store';

/**
 * A configured workflow must hold together (`workflowProblem`), and a step may only be removed once
 * no bill stands on it — a bill at a step that no longer exists could not be moved on. Returned bills
 * remember the step they came from, so those count too. Single-field queries, so no index is needed.
 */
async function checkWorkflow(context: BtContext, current: BillTrackingConfig, steps: NonNullable<ConfigInput['settings']['workflowSteps']>): Promise<void> {
  const problem = workflowProblem(steps);
  if (problem) throw new BtError(problem);
  const before = normaliseWorkflowSteps(current.settings.workflowSteps);
  const removed = before.filter((step) => !steps.some((entry) => entry.status === step.status));
  if (!removed.length) return;
  const ids = removed.map((step) => step.status).slice(0, 30);
  const bills = db().collection(BT_COLLECTIONS.bills);
  const [at, returnedFrom] = await Promise.all([bills.where('workflowStatus', 'in', ids).get(), bills.where('returnedFrom', 'in', ids).get()]);
  const live = [...at.docs, ...returnedFrom.docs]
    .map((doc) => doc.data() as { organizationId?: string; isDeleted?: boolean; workflowStatus?: string; returnedFrom?: string })
    .filter((bill) => bill.organizationId === context.organizationId && !bill.isDeleted && (ids.includes(bill.workflowStatus ?? '') || (bill.workflowStatus === 'returned' && ids.includes(bill.returnedFrom ?? ''))));
  if (!live.length) return;
  const counts = removed
    .map((step) => ({ label: step.label, count: live.filter((bill) => bill.workflowStatus === step.status || bill.returnedFrom === step.status).length }))
    .filter((entry) => entry.count);
  throw new BtError(`Bills are still on a step being removed: ${counts.map((entry) => `${entry.count} at “${entry.label}”`).join(', ')}. Move them on, or switch the step off instead.`, 409);
}

export async function saveConfig(context: BtContext, input: ConfigInput): Promise<BillTrackingConfig> {
  context.require('Settings', 'Manage');
  // Read as stored, never the 30-second cache: a month closed or an import made moments ago must not
  // be undone by this save.
  const current = await loadConfigFresh(context.organizationId);
  const bucketError = validateAgeingBuckets(input.settings.ageingBuckets);
  if (bucketError) throw new BtError(bucketError);
  if (input.settings.workflowSteps) await checkWorkflow(context, current, input.settings.workflowSteps);
  const duplicate = (values: string[]) => values.find((value, index) => values.indexOf(value) !== index);
  // Codes default to the name, so an administrator only has to type the name.
  const billCategories = input.billCategories.map((category) => ({ ...category, code: category.code || category.name.toUpperCase() }));
  const billTypes = input.billTypes.map((type) => ({ ...type, code: type.code || type.name.toUpperCase(), projectIds: [...new Set(type.projectIds)] }));
  const categoryError = validateCategoryConfig(billCategories, billTypes);
  if (categoryError) throw new BtError(categoryError);
  const deductionTypes = input.deductionTypes.map((type) => ({ ...type, code: type.code || type.name.toUpperCase() }));
  // Bills, lines and rules refer to a head by its id: two with one id would be one head twice.
  const dupId = duplicate(deductionTypes.map((type) => type.id));
  if (dupId) throw new BtError(`Two deduction types share the id ${dupId} — reload Settings and make the change again.`);
  const dupCode = duplicate(deductionTypes.map((type) => type.code.toUpperCase()));
  if (dupCode) throw new BtError(`Deduction code ${dupCode} appears twice.`);
  // Deduction codes the importer posts to must keep resolving — they can be deactivated, not removed.
  const removed = current.deductionTypes.filter((type) => !deductionTypes.some((entry) => entry.id === type.id));
  if (removed.length) throw new BtError(`Deduction types cannot be deleted once used — deactivate ${removed.map((type) => type.name).join(', ')} instead.`);
  // A rule keeps only the sub categories and heads saved with it; one left without either is refused.
  const noteRules = normaliseNoteRules(input.settings.noteRules ?? current.settings.noteRules ?? [], billTypes, deductionTypes);
  const ruleProblem = noteRulesProblem(noteRules, billTypes);
  if (ruleProblem) throw new BtError(ruleProblem);

  // Written in a transaction over the stored document: closed months are only ever set by
  // `setMonthClosed`, and a save from a copy older than the stored one is refused.
  const ref = configRef(db(), context.organizationId);
  let next = current;
  await db().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const stored = snapshot.exists ? withConfigDefaults(snapshot.data() as Partial<BillTrackingConfig>) : DEFAULT_CONFIG;
    if (input.expectedUpdatedAt !== undefined && (stored.settings.updatedAt ?? '') !== input.expectedUpdatedAt) {
      throw new BtError('Settings were changed by someone else (or an import) since you opened them — reload and redo your change.', 409);
    }
    next = clean({
      settings: { ...stored.settings, ...input.settings, workflowSteps: normaliseWorkflowSteps(input.settings.workflowSteps ?? stored.settings.workflowSteps), noteRules, closedMonths: stored.settings.closedMonths, updatedAt: nowIso(), updatedBy: context.userId },
      billCategories,
      billTypes,
      deductionTypes,
      stages: input.stages,
      projectProfiles: input.projectProfiles,
      projectMappings: input.projectMappings ?? stored.projectMappings,
    });
    transaction.set(ref, next);
  });
  invalidateConfig(context.organizationId);
  const changedSettings = Object.keys(input.settings).filter((key) => JSON.stringify((current.settings as unknown as Record<string, unknown>)[key]) !== JSON.stringify((input.settings as Record<string, unknown>)[key]));
  await logActivity(context, {
    entityType: 'settings',
    entityId: context.organizationId,
    action: 'settings_saved',
    summary: `Bill Tracking settings saved${changedSettings.length ? `: ${changedSettings.join(', ')}` : ''}`,
    previous: Object.fromEntries(changedSettings.map((key) => [key, (current.settings as unknown as Record<string, unknown>)[key]])),
    next: Object.fromEntries(changedSettings.map((key) => [key, (input.settings as Record<string, unknown>)[key]])),
  });
  return next;
}

export async function setMonthClosed(context: BtContext, month: string, action: 'close' | 'reopen', reason?: string): Promise<string[]> {
  context.require('Settings', 'Close Month');
  if (action === 'reopen' && !reason) throw new BtError('Give a reason for reopening a closed month.');
  const ref = configRef(db(), context.organizationId);
  let closedMonths: string[] = [];
  await db().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = (snapshot.data()?.settings?.closedMonths as string[] | undefined) ?? [];
    closedMonths = action === 'close' ? [...new Set([...current, month])].sort() : current.filter((entry) => entry !== month);
    transaction.set(ref, { settings: { closedMonths } }, { merge: true });
  });
  // The next read (a bill save's month check, a Settings save) must see the month as it now is.
  invalidateConfig(context.organizationId);
  await logActivity(context, { entityType: 'settings', entityId: month, action: action === 'close' ? 'month_closed' : 'month_reopened', summary: `${month} ${action === 'close' ? 'closed' : 'reopened'} for Bill Tracking`, reason });
  return closedMonths;
}

/* ── saved filter views (per user) ───────────────────────────────────────── */

export interface SavedView {
  id: string;
  page: string;
  name: string;
  query: string;
  createdAt: string;
}

export async function listSavedViews(context: BtContext, page: string): Promise<SavedView[]> {
  const snapshot = await db().collection(BT_COLLECTIONS.savedViews).where('userId', '==', context.userId).get();
  return snapshot.docs
    .map((doc) => ({ ...(doc.data() as SavedView), id: doc.id }))
    .filter((view) => view.page === page)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveView(context: BtContext, page: string, name: string, query: string): Promise<{ id: string }> {
  if (!name.trim() || name.length > 60) throw new BtError('Give the view a short name.');
  if (query.length > 2000) throw new BtError('That filter is too long to save.');
  const ref = db().collection(BT_COLLECTIONS.savedViews).doc();
  await ref.set({ userId: context.userId, organizationId: context.organizationId, page: page.slice(0, 80), name: name.trim(), query, createdAt: nowIso() });
  return { id: ref.id };
}

export async function deleteView(context: BtContext, viewId: string): Promise<void> {
  const ref = db().collection(BT_COLLECTIONS.savedViews).doc(viewId);
  const snapshot = await ref.get();
  if (!snapshot.exists || snapshot.data()?.userId !== context.userId) throw new BtError('View not found.', 404);
  await ref.delete();
}

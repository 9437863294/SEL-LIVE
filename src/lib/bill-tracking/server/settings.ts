import 'server-only';

/**
 * Bill Tracking configuration: settings, masters (bill types, deduction types, stages), project
 * profiles (DGM office, billing client, credit days), month closure and per-user saved views.
 */

import { validateAgeingBuckets } from '../calculations.ts';
import { validateCategoryConfig } from '../categories.ts';
import type { ConfigInput } from '../schemas';
import type { BillTrackingConfig } from '../types';
import { BtError, db, type BtContext } from './context';
import { BT_COLLECTIONS, clean, configRef, loadConfig, logActivity, nowIso } from './store';

export async function saveConfig(context: BtContext, input: ConfigInput): Promise<BillTrackingConfig> {
  context.require('Settings', 'Manage');
  const current = await loadConfig(context.organizationId);
  const bucketError = validateAgeingBuckets(input.settings.ageingBuckets);
  if (bucketError) throw new BtError(bucketError);
  const duplicate = (values: string[]) => values.find((value, index) => values.indexOf(value) !== index);
  // Codes default to the name, so an administrator only has to type the name.
  const billCategories = input.billCategories.map((category) => ({ ...category, code: category.code || category.name.toUpperCase() }));
  const billTypes = input.billTypes.map((type) => ({ ...type, code: type.code || type.name.toUpperCase(), projectIds: [...new Set(type.projectIds)] }));
  const categoryError = validateCategoryConfig(billCategories, billTypes);
  if (categoryError) throw new BtError(categoryError);
  const dupCode = duplicate(input.deductionTypes.map((type) => type.code.toUpperCase()));
  if (dupCode) throw new BtError(`Deduction code ${dupCode} appears twice.`);
  // Deduction codes the importer posts to must keep resolving — they can be deactivated, not removed.
  const removed = current.deductionTypes.filter((type) => !input.deductionTypes.some((entry) => entry.id === type.id));
  if (removed.length) throw new BtError(`Deduction types cannot be deleted once used — deactivate ${removed.map((type) => type.name).join(', ')} instead.`);

  const next: BillTrackingConfig = clean({
    settings: { ...current.settings, ...input.settings, closedMonths: current.settings.closedMonths, updatedAt: nowIso(), updatedBy: context.userId },
    billCategories,
    billTypes,
    deductionTypes: input.deductionTypes,
    stages: input.stages,
    projectProfiles: input.projectProfiles,
    projectMappings: input.projectMappings ?? current.projectMappings,
  });
  await configRef(db(), context.organizationId).set(next);
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

import 'server-only';

/**
 * Firestore access for Bill Tracking: collection names, configuration, master lookups, scoped
 * loading and the audit trail. Every write path goes through the services that build on this, never
 * straight from a route.
 */

import { FieldValue, type DocumentReference, type Firestore, type Transaction } from 'firebase-admin/firestore';

import { resolveRegistrationsDoc } from '@/lib/gst-registrations';

import { DEFAULT_CONFIG, withConfigDefaults } from '../defaults.ts';
import type { RegistrationSetup } from '../gst.ts';
import type { Bill, BillActivity, BillTrackingConfig, ProjectProfile } from '../types';
import { BtError, db, type BtContext } from './context';

export const BT_COLLECTIONS = {
  bills: 'billTrackingBills',
  collections: 'billTrackingCollections',
  retention: 'billTrackingRetention',
  followUps: 'billTrackingFollowUps',
  comments: 'billTrackingComments',
  documents: 'billTrackingDocuments',
  targets: 'billTrackingTargets',
  activity: 'billTrackingActivity',
  importJobs: 'billTrackingImportJobs',
  importRows: 'rows',
  config: 'billTrackingConfig',
  counters: 'billTrackingCounters',
  savedViews: 'billTrackingSavedViews',
} as const;

/** One configuration document per organisation. */
export const configRef = (firestore: Firestore, organizationId: string) => firestore.collection(BT_COLLECTIONS.config).doc(organizationId || 'default');

export async function loadConfig(organizationId: string): Promise<BillTrackingConfig> {
  const snapshot = await configRef(db(), organizationId).get();
  return snapshot.exists ? withConfigDefaults(snapshot.data() as Partial<BillTrackingConfig>) : DEFAULT_CONFIG;
}

export const nowIso = () => new Date().toISOString();

/** Firestore rejects `undefined`; strip it recursively so optional fields simply disappear. */
export function clean<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => clean(entry)) as unknown as T;
  if (value && typeof value === 'object' && !(value instanceof Date) && !(value instanceof FieldValue)) {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry !== undefined) result[key] = clean(entry);
    }
    return result as T;
  }
  return value;
}

/* ── masters ─────────────────────────────────────────────────────────────── */

export interface ProjectRecord {
  id: string;
  name: string;
  code?: string;
  status?: string;
  clientId?: string;
  clientName?: string;
  location?: string;
  dgmOffice?: string;
  creditDays?: number;
}

export interface ClientRecord {
  id: string;
  name: string;
  gstin?: string;
  paymentTermsDays?: number;
  status?: string;
}

const toProjectRecord = (id: string, data: Record<string, unknown>, profile: ProjectProfile | undefined): ProjectRecord => ({
  id,
  name: String(data.projectName ?? data.name ?? id),
  code: data.siteCode ? String(data.siteCode) : undefined,
  status: data.status ? String(data.status) : undefined,
  clientId: profile?.clientId ?? (data.clientId ? String(data.clientId) : undefined),
  clientName: profile?.clientName ?? (data.clientName ? String(data.clientName) : undefined),
  location: data.location ? String(data.location) : undefined,
  dgmOffice: profile?.dgmOffice,
  creditDays: profile?.creditDays,
});

/**
 * Projects from the global `projects` master, with this module's profile (DGM office, billing
 * client, credit days) laid over each. Only projects inside the caller's scope are returned.
 */
export async function loadProjects(context: Pick<BtContext, 'scope'>, profiles: readonly ProjectProfile[]): Promise<ProjectRecord[]> {
  const snapshot = await db().collection('projects').get();
  const profileOf = new Map(profiles.map((profile) => [profile.projectId, profile]));
  return snapshot.docs
    .filter((doc) => context.scope === null || context.scope.includes(doc.id))
    .map((doc) => toProjectRecord(doc.id, doc.data(), profileOf.get(doc.id)))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadProject(projectId: string, profiles: readonly ProjectProfile[]): Promise<ProjectRecord> {
  const snapshot = await db().collection('projects').doc(projectId).get();
  if (!snapshot.exists) throw new BtError('That project does not exist in the project master.', 404);
  return toProjectRecord(snapshot.id, snapshot.data() ?? {}, profiles.find((entry) => entry.projectId === snapshot.id));
}

/** The shared `clients` master (Project Management · Clients). */
export async function loadClients(): Promise<ClientRecord[]> {
  const snapshot = await db().collection('clients').get();
  return snapshot.docs
    .map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        name: String(data.name ?? doc.id),
        gstin: data.gstin ? String(data.gstin) : undefined,
        paymentTermsDays: typeof data.paymentTermsDays === 'number' ? data.paymentTermsDays : undefined,
        status: data.status ? String(data.status) : undefined,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadClient(clientId: string | undefined): Promise<ClientRecord | undefined> {
  if (!clientId) return undefined;
  const snapshot = await db().collection('clients').doc(clientId).get();
  if (!snapshot.exists) return undefined;
  const data = snapshot.data() ?? {};
  return { id: snapshot.id, name: String(data.name ?? snapshot.id), gstin: data.gstin, paymentTermsDays: typeof data.paymentTermsDays === 'number' ? data.paymentTermsDays : undefined };
}

export interface UserRecord {
  id: string;
  name: string;
  email?: string;
}

export async function loadUsers(): Promise<UserRecord[]> {
  const snapshot = await db().collection('users').get();
  return snapshot.docs
    .filter((doc) => doc.data().status !== 'Inactive')
    .map((doc) => ({ id: doc.id, name: String(doc.data().name ?? doc.data().email ?? doc.id), email: doc.data().email ? String(doc.data().email) : undefined }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function userName(userId: string | undefined): Promise<string | undefined> {
  if (!userId) return undefined;
  const snapshot = await db().collection('users').doc(userId).get();
  return snapshot.exists ? String(snapshot.data()?.name ?? snapshot.data()?.email ?? userId) : undefined;
}

/**
 * SEL's GST registrations and the attribution chain, from the shared settings document Expenses
 * maintains (Expenses → GST registrations). Bill Tracking reads it; it never edits it.
 */
export async function loadGstSetup(): Promise<RegistrationSetup> {
  const snapshot = await db().collection('expensesSettings').doc('gst-registrations').get();
  const doc = resolveRegistrationsDoc(snapshot.exists ? snapshot.data() : null);
  return { registrations: doc.registrations, attribution: doc.attribution, maps: doc.maps };
}

/* ── scoped loading ──────────────────────────────────────────────────────── */

const chunk = <T>(items: readonly T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
};

/**
 * Every live bill the caller may see, optionally narrowed to one FY. Equality filters only, so no
 * composite index is needed; a project-scoped caller is served by `in` queries of 30 ids each.
 * Report-sized (a year of bills is a few hundred documents) and read on the server — the browser
 * only ever receives the page and the totals.
 */
export async function loadScopedBills(context: Pick<BtContext, 'scope' | 'organizationId'>, financialYear?: string): Promise<Bill[]> {
  if (context.scope && context.scope.length === 0) return [];
  let base = db().collection(BT_COLLECTIONS.bills).where('organizationId', '==', context.organizationId).where('isDeleted', '==', false);
  if (financialYear) base = base.where('financialYear', '==', financialYear);
  const snapshots = context.scope === null ? [await base.get()] : await Promise.all(chunk(context.scope, 30).map((ids) => base.where('projectId', 'in', ids).get()));
  return snapshots.flatMap((snapshot) => snapshot.docs.map((doc) => ({ ...(doc.data() as Bill), id: doc.id })));
}

/**
 * Every live credit / debit note in the caller's scope, any financial year — a note raised next
 * year still adjusts this year's invoice, so certification comparisons cannot use the FY slice.
 */
export async function loadScopedNotes(context: Pick<BtContext, 'scope' | 'organizationId'>): Promise<Bill[]> {
  if (context.scope && context.scope.length === 0) return [];
  const snapshot = await db()
    .collection(BT_COLLECTIONS.bills)
    .where('organizationId', '==', context.organizationId)
    .where('isDeleted', '==', false)
    .where('transactionType', 'in', ['credit_note', 'debit_note'])
    .get();
  const scope = context.scope;
  return snapshot.docs.map((doc) => ({ ...(doc.data() as Bill), id: doc.id })).filter((note) => scope === null || scope.includes(note.projectId));
}

export async function loadScopedDocs<T>(collection: string, context: Pick<BtContext, 'scope' | 'organizationId'>, projectField = 'projectId'): Promise<T[]> {
  if (context.scope && context.scope.length === 0) return [];
  const base = db().collection(collection).where('organizationId', '==', context.organizationId);
  const snapshots = context.scope === null ? [await base.get()] : await Promise.all(chunk(context.scope, 30).map((ids) => base.where(projectField, 'in', ids).get()));
  return snapshots.flatMap((snapshot) => snapshot.docs.map((doc) => ({ ...(doc.data() as T), id: doc.id })));
}

/** Loads one bill and enforces scope; deleted bills are returned only when asked for. */
export async function loadBill(context: BtContext, billId: string, options: { includeDeleted?: boolean } = {}): Promise<Bill> {
  const snapshot = await db().collection(BT_COLLECTIONS.bills).doc(billId).get();
  if (!snapshot.exists) throw new BtError('Bill not found.', 404);
  const bill = { ...(snapshot.data() as Bill), id: snapshot.id };
  if ((bill as Bill & { organizationId?: string }).organizationId !== context.organizationId) throw new BtError('Bill not found.', 404);
  context.requireProject(bill.projectId);
  if (bill.isDeleted && !options.includeDeleted) throw new BtError('This bill has been deleted.', 410);
  return bill;
}

/* ── audit trail ─────────────────────────────────────────────────────────── */

export interface ActivityInput {
  entityType: BillActivity['entityType'];
  entityId: string;
  billId?: string;
  projectId?: string;
  action: string;
  summary: string;
  previous?: Record<string, unknown>;
  next?: Record<string, unknown>;
  reason?: string;
}

const activityDoc = (context: BtContext, input: ActivityInput) =>
  clean({
    ...input,
    organizationId: context.organizationId,
    actorId: context.userId,
    actorName: context.userName,
    at: nowIso(),
    userAgent: context.userAgent,
  });

/** Appends an audit entry inside a transaction, so the change and its record commit together. */
export function logActivityTx(transaction: Transaction, context: BtContext, input: ActivityInput): void {
  transaction.set(db().collection(BT_COLLECTIONS.activity).doc(), activityDoc(context, input));
}

export async function logActivity(context: BtContext, input: ActivityInput): Promise<void> {
  await db().collection(BT_COLLECTIONS.activity).add(activityDoc(context, input));
}

export const activityRef = (): DocumentReference => db().collection(BT_COLLECTIONS.activity).doc();

/** Field-level diff for the audit trail: only what changed, previous and new side by side. */
export function diffFields(before: Record<string, unknown>, after: Record<string, unknown>, keys: readonly string[]): { previous: Record<string, unknown>; next: Record<string, unknown> } | null {
  const previous: Record<string, unknown> = {};
  const next: Record<string, unknown> = {};
  for (const key of keys) {
    if (JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null)) {
      previous[key] = before[key] ?? null;
      next[key] = after[key] ?? null;
    }
  }
  return Object.keys(next).length ? { previous, next } : null;
}

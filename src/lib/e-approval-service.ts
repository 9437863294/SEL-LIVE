'use client';

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit as fsLimit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type Query,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { withCreateAudit, withUpdateAudit, type AuditActor } from '@/lib/audit-fields';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { logUserActivity } from '@/lib/activity-logger';
import { dispatchNotification } from '@/lib/notifications';
import {
  applyEApprovalAction,
  buildEApprovalSteps,
  canManageEApprovalDelegationFor,
  canRecallEApprovalAction,
  canSignEApprovalDocument,
  canReverseEApprovalAction,
  eApprovalUndoState,
  resolveDueEApprovalEscalations,
  DEFAULT_E_APPROVAL_SETTINGS_RECORD,
  E_APPROVAL_ACTIVITY_MODULE,
  E_APPROVAL_BASE_PATH,
  E_APPROVAL_COLLECTIONS,
  E_APPROVAL_STORAGE_PREFIX,
  eApprovalDepartmentCode,
  eApprovalMaterialFingerprint,
  eApprovalReference,
  eApprovalStepSla,
  eApprovalWorkflowBlockingIssues,
  expandEApprovalWorkflow,
  financialYearForEApprovalDate,
  isOpenEApprovalStatus,
  isTerminalEApprovalStatus,
  resolveEApprovalRouting,
  SEED_E_APPROVAL_TEMPLATES,
  type EApprovalActionInput,
  type EApprovalActionKind,
  type EApprovalActor,
  type EApprovalAssignment,
  type EApprovalComment,
  type EApprovalAttachment,
  type EApprovalDelegation,
  type EApprovalDelegationRecord,
  type EApprovalDepartmentRouting,
  type EApprovalDetail,
  type EApprovalEvent,
  type EApprovalHistoryEntry,
  type EApprovalMaterialSnapshot,
  type EApprovalNotificationIntent,
  type EApprovalPriority,
  type EApprovalProjectRouting,
  type EApprovalRequest,
  type EApprovalRequestDraft,
  type EApprovalRequestState,
  type EApprovalRuleRecord,
  type EApprovalSettingsRecord,
  type EApprovalSignatureRecord,
  type EApprovalSourceLink,
  type EApprovalStatus,
  type EApprovalStep,
  type EApprovalStepRecord,
  type EApprovalTemplateRecord,
  type EApprovalTemplateStep,
  type EApprovalType,
  type EApprovalUndoEligibility,
  type EApprovalVersionRecord,
  type EApprovalWorkflowContext,
  type EApprovalWorkflowLibrary,
  type EApprovalWorkflowNote,
} from '@/lib/e-approval';
import type { EApprovalSignaturePosition } from '@/lib/e-approval-pdf-signing';
import {
  eApprovalHtmlIsEmpty,
  eApprovalHtmlToText,
  eApprovalHtmlWithinLimit,
} from '@/lib/e-approval-rich-text';

/**
 * Write-side service for the E-Approval module.
 *
 * Every state transition lives here rather than in the component that triggers it, for the three
 * reasons the HR and travel services give: the rules have to hold whichever screen (or the mobile
 * client, or the escalation cron) initiates the change; reference numbers must be allocated inside a
 * transaction so two simultaneous submissions cannot share a sequence; and every transition owes a
 * history entry, an activity log and a notification, which is far easier to guarantee in one module
 * than across a hundred call sites.
 *
 * The engine itself is `e-approval-policy.ts` and knows nothing about Firestore. This file's job is
 * the sandwich around it: load the request and its steps, hand them to `applyEApprovalAction`,
 * persist what came back atomically, then deliver the notifications the engine asked for. That split
 * is what lets the whole workflow be unit-tested without an emulator.
 *
 * Uses the Firestore *client* SDK — as `tour-travel-service.ts` and `hr-requirement-service.ts` do —
 * so these functions run under the signed-in user's security rules. The reminder/escalation cron of
 * spec section 22 calls `resolveDueEApprovalEscalations` from the policy module with Admin-SDK reads
 * (see `src/app/api/e-approval/escalations/route.ts`).
 */

/* ------------------------------------------------------------------------------------------------
 * Actor
 * ---------------------------------------------------------------------------------------------- */

export interface EApprovalServiceActor extends AuditActor {
  userId: string;
  userName: string;
  userEmail?: string | null;
  designation?: string;
  organizationId?: string;
  role?: string;
  departmentId?: string;
}

/** Thrown for a rule violation the user can act on, so callers can show the message verbatim. */
export class EApprovalServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EApprovalServiceError';
  }
}

const requireActor = (actor: EApprovalServiceActor | null | undefined): EApprovalServiceActor => {
  if (!actor?.userId) throw new EApprovalServiceError('You must be signed in to perform this action.');
  return actor;
};

const nowIso = () => new Date().toISOString();

/**
 * Only plain objects are safe to rebuild key-by-key.
 *
 * Firestore sentinels (`serverTimestamp()`), `Timestamp` and `Date` are class
 * instances: recursing into one and reassembling it with `Object.fromEntries` would
 * hand Firestore a plain object where it expected the real type, turning a working
 * timestamp into a meaningless `{}`.
 */
const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

/**
 * Firestore rejects `undefined`; a draft form legitimately leaves half its fields unset.
 *
 * Recursive, because Firestore rejects `undefined` at *any* depth, not just at the top
 * level. A history event carries `undo`, which nests `steps: EApprovalStepRecord[]` and
 * `request: EApprovalRequestState` — both full of optional fields. A shallow prune sees
 * that `undo` itself is defined, passes it through untouched, and every unset optional
 * inside it reaches Firestore, which fails the whole batch with "Unsupported field
 * value: undefined". That took out submitting any approval whose action was undoable.
 */
const pruneUndefined = <T>(value: T): T => {
  if (Array.isArray(value)) {
    // Dropping an undefined element would shift every later index, so this only
    // recurses into elements. A genuinely undefined element is a bug worth surfacing
    // as a Firestore error rather than silently renumbering the array.
    return value.map((entry) => pruneUndefined(entry)) as unknown as T;
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, pruneUndefined(entry)]),
    ) as T;
  }
  return value;
};

/** Firestore document ids for engine-created steps, so nothing is renumbered on write. */
const firestoreIdFactory = () => () => doc(collection(db, E_APPROVAL_COLLECTIONS.steps)).id;

const scopeQuery = (organizationId?: string) =>
  organizationId ? [where('organizationId', '==', organizationId)] : [];

/* ------------------------------------------------------------------------------------------------
 * Configuration read cache
 *
 * Everything in this section is *configuration* — approval types, workflow templates, the matrix,
 * department and project routing, delegations, the settings document and the organisation's
 * department/project/role masters. All of it is read constantly and changes perhaps weekly.
 *
 * Before this cache existed the module re-read it continuously and visibly:
 *
 *   - Opening the module read `departments` twice and `eApprovalProjectRouting` twice, because the
 *     actor context and the directory each fetched their own copy of both.
 *   - **Every approve/reject/forward** re-read four whole collections before it could write, because
 *     `performEApprovalAction` rebuilds the actor context from scratch — so clearing ten files from
 *     the inbox cost forty collection reads nobody had asked for.
 *   - Every report page re-read up to 18,000 documents on mount, so moving between the seven report
 *     screens re-fetched the entire reporting corpus each time.
 *
 * Two properties make this safe rather than merely fast:
 *
 *   1. **Every write through this service clears it.** `invalidateEApprovalCache()` is called by each
 *     config write below, so a screen that saves and reloads always sees its own change. The window
 *     of staleness is only ever against *another* user's edit.
 *   2. **A failed read is never cached.** The entry is dropped on rejection, so one offline moment
 *     does not pin an error for the next half minute.
 *
 * The TTL is deliberately short. Thirty seconds is long enough to collapse the burst of reads a
 * screen makes on mount — and every action makes while the user works through an inbox — and short
 * enough that an administrator's routing change reaches everybody else within one screen refresh.
 * ---------------------------------------------------------------------------------------------- */

const E_APPROVAL_CACHE_TTL_MS = 30_000;

/** The reporting corpus is far more expensive to fetch and far less sensitive to being a minute old. */
const E_APPROVAL_ANALYTICS_TTL_MS = 60_000;

const configCache = new Map<string, { at: number; value: Promise<unknown> }>();

/**
 * One in-flight read per key, reused for `ttlMs` after it resolves.
 *
 * The promise is cached rather than its result, so ten callers that ask at once share a single round
 * trip instead of starting ten — which is the case that matters on mount, where the actor context,
 * the directory and the first screen all ask for the same collections in the same tick.
 */
function cachedRead<T>(
  key: string,
  load: () => Promise<T>,
  options: { ttlMs?: number; force?: boolean } = {},
): Promise<T> {
  const ttlMs = options.ttlMs ?? E_APPROVAL_CACHE_TTL_MS;
  const existing = configCache.get(key);
  if (!options.force && existing && Date.now() - existing.at < ttlMs) return existing.value as Promise<T>;
  const value = load().catch((error) => {
    // A rejection must not be served for the rest of the window — see property 2 above.
    if (configCache.get(key)?.value === value) configCache.delete(key);
    throw error;
  });
  configCache.set(key, { at: Date.now(), value });
  return value;
}

/**
 * Drops cached configuration.
 *
 * Called with no argument by every config write in this file. Clearing everything rather than the
 * one key that changed is deliberate: config writes happen on administration screens a few times a
 * week, and "which of the eleven keys does saving a project routing invalidate?" is precisely the
 * question a cache should not make anybody answer. Exported so a caller that writes one of these
 * collections by another route can say so.
 */
export function invalidateEApprovalCache(keyPrefix?: string): void {
  if (!keyPrefix) {
    configCache.clear();
    return;
  }
  for (const key of Array.from(configCache.keys())) {
    if (key.startsWith(keyPrefix)) configCache.delete(key);
  }
}

/** Every document in a collection, id included. Used for the org-wide masters this module reads. */
const readWholeCollection = async (name: string): Promise<Array<Record<string, unknown> & { id: string }>> => {
  const snapshot = await getDocs(collection(db, name));
  return snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
};

/**
 * The organisation's department / project / role masters.
 *
 * Exposed from the service — rather than each screen calling `getDocs(collection(db, 'departments'))`
 * itself — so the module reads each of them once per window instead of once per caller. A fresh array
 * is handed out every time because callers sort and filter what they are given, and an in-place
 * `sort` on the cached array would quietly reorder it for everybody else.
 */
export const listEApprovalDepartmentMaster = (force = false) =>
  cachedRead('master:departments', () => readWholeCollection('departments'), { force }).then((rows) => rows.slice());

export const listEApprovalProjectMaster = (force = false) =>
  cachedRead('master:projects', () => readWholeCollection('projects'), { force }).then((rows) => rows.slice());

export const listEApprovalRoleMaster = (force = false) =>
  cachedRead('master:roles', () => readWholeCollection('roles'), { force }).then((rows) => rows.slice());

/* ------------------------------------------------------------------------------------------------
 * Settings, types, templates, rules, routing, delegations
 * ---------------------------------------------------------------------------------------------- */

/**
 * Loads an organisation's settings, merged over the defaults.
 *
 * Merged field by field rather than spread wholesale, for the reason `loadHrSettings` gives: a
 * settings document saved before an option existed must resolve that option to its default, not to
 * `undefined` — which is how a missing `maxVerificationDepth` becomes an unbounded one.
 */
export async function loadEApprovalSettings(organizationId?: string): Promise<EApprovalSettingsRecord> {
  const key = organizationId || 'default';
  return cachedRead(`settings:${key}`, async () => {
    const snapshot = await getDoc(doc(db, E_APPROVAL_COLLECTIONS.settings, key));
    const saved = snapshot.exists() ? (snapshot.data() as Partial<EApprovalSettingsRecord>) : {};
    const base = DEFAULT_E_APPROVAL_SETTINGS_RECORD;
    return {
      ...base,
      ...saved,
      organizationId,
      numbering: { ...base.numbering, ...(saved.numbering || {}) },
      materialFields: saved.materialFields?.length ? saved.materialFields : base.materialFields,
      escalationLadder: saved.escalationLadder?.length ? saved.escalationLadder : base.escalationLadder,
      confidentialRoles: saved.confidentialRoles ?? base.confidentialRoles,
    };
  });
}

export async function saveEApprovalSettings(
  settings: Partial<EApprovalSettingsRecord>,
  actor: EApprovalServiceActor,
): Promise<void> {
  const who = requireActor(actor);
  const key = who.organizationId || 'default';
  await setDoc(
    doc(db, E_APPROVAL_COLLECTIONS.settings, key),
    pruneUndefined({ ...settings, organizationId: who.organizationId, ...withUpdateAudit(who) }),
    { merge: true },
  );
  invalidateEApprovalCache();
  await logEApprovalActivity(who, 'Update Settings', {}, { recordId: key });
}

/**
 * A scoped configuration collection, cached.
 *
 * Handed out as a fresh array on every call: `listEApprovalTypes` below sorts what it is given, and
 * both the matrix and template panels sort their rows in place — an in-place `sort` on the cached
 * array would reorder it under every other caller.
 */
const listCollection = async <T>(name: string, organizationId?: string): Promise<T[]> => {
  const rows = await cachedRead(`list:${name}:${organizationId ?? ''}`, async () => {
    const snapshot = await getDocs(query(collection(db, name), ...scopeQuery(organizationId)));
    return snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }) as T);
  });
  return rows.slice();
};

export const listEApprovalTypes = (organizationId?: string) =>
  listCollection<EApprovalType>(E_APPROVAL_COLLECTIONS.types, organizationId).then((rows) =>
    rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name)),
  );

export const listEApprovalTemplates = (organizationId?: string) =>
  listCollection<EApprovalTemplateRecord>(E_APPROVAL_COLLECTIONS.templates, organizationId);

export const listEApprovalRules = (organizationId?: string) =>
  listCollection<EApprovalRuleRecord>(E_APPROVAL_COLLECTIONS.rules, organizationId);

export const listEApprovalDepartmentRouting = (organizationId?: string) =>
  listCollection<EApprovalDepartmentRouting>(E_APPROVAL_COLLECTIONS.departmentRouting, organizationId);

export const listEApprovalProjectRouting = (organizationId?: string) =>
  listCollection<EApprovalProjectRouting>(E_APPROVAL_COLLECTIONS.projectRouting, organizationId);

export const listEApprovalDelegations = (organizationId?: string) =>
  listCollection<EApprovalDelegationRecord>(E_APPROVAL_COLLECTIONS.delegations, organizationId);

/** Upsert for the administration screens. Returns the document id. */
async function upsertConfigRecord<T extends { id?: string }>(
  collectionName: string,
  record: T,
  actor: EApprovalServiceActor,
  action: string,
): Promise<string> {
  const who = requireActor(actor);
  const { id, ...rest } = record as T & { id?: string };
  const payload = pruneUndefined({ ...rest, organizationId: who.organizationId } as Record<string, unknown>);
  if (id) {
    await setDoc(doc(db, collectionName, id), { ...payload, ...withUpdateAudit(who) }, { merge: true });
    invalidateEApprovalCache();
    await logEApprovalActivity(who, action, { id }, { recordId: id });
    return id;
  }
  const created = await addDoc(collection(db, collectionName), { ...payload, ...withCreateAudit(who) });
  invalidateEApprovalCache();
  await logEApprovalActivity(who, action, { id: created.id }, { recordId: created.id });
  return created.id;
}

export const saveEApprovalType = (record: Partial<EApprovalType>, actor: EApprovalServiceActor) =>
  upsertConfigRecord(E_APPROVAL_COLLECTIONS.types, record as EApprovalType, actor, 'Save Approval Type');

export const saveEApprovalTemplate = (record: Partial<EApprovalTemplateRecord>, actor: EApprovalServiceActor) =>
  upsertConfigRecord(E_APPROVAL_COLLECTIONS.templates, record as EApprovalTemplateRecord, actor, 'Save Workflow Template');

export const saveEApprovalRule = (record: Partial<EApprovalRuleRecord>, actor: EApprovalServiceActor) =>
  upsertConfigRecord(E_APPROVAL_COLLECTIONS.rules, record as EApprovalRuleRecord, actor, 'Save Approval Matrix Rule');

/**
 * Saves a delegation, refusing one that hands away somebody else's approvals unless the actor holds
 * `Delegations → Manage Others`.
 *
 * The permission arrives as a flag from the caller, the same way `undoEApprovalAction` takes
 * `canReverse` — the service layer has no access to the role resolver, which is a React hook. That
 * makes this the same trust model the rest of the module already runs on, not a stronger one: it
 * stops the ordinary path and any accidental misuse, and puts the rule in one place both the screen
 * and the write agree on.
 */
export async function saveEApprovalDelegation(
  record: Partial<EApprovalDelegationRecord>,
  actor: EApprovalServiceActor,
  options: { canManageOthers?: boolean } = {},
): Promise<void> {
  const who = requireActor(actor);
  if (!canManageEApprovalDelegationFor(who, record.fromUserId, options)) {
    throw new EApprovalServiceError(
      'You can only delegate your own approvals. Delegating somebody else’s needs the "Manage Others" permission.',
    );
  }
  if (record.fromUserId && record.fromUserId === record.toUserId) {
    throw new EApprovalServiceError('A delegation has to be to somebody else.');
  }
  await upsertConfigRecord(
    E_APPROVAL_COLLECTIONS.delegations,
    record as EApprovalDelegationRecord,
    who,
    'Save Delegation',
  );
}

/** Removing a delegation is the same authority as creating one — see `saveEApprovalDelegation`. */
export async function deleteEApprovalDelegation(
  record: EApprovalDelegationRecord,
  actor: EApprovalServiceActor,
  options: { canManageOthers?: boolean } = {},
): Promise<void> {
  const who = requireActor(actor);
  if (!canManageEApprovalDelegationFor(who, record.fromUserId, options)) {
    throw new EApprovalServiceError(
      'You can only remove delegations of your own approvals. Removing somebody else’s needs the "Manage Others" permission.',
    );
  }
  await deleteEApprovalConfigRecord(E_APPROVAL_COLLECTIONS.delegations, record.id, who);
}

/** Department routing is keyed by department id, so it upserts rather than appending. */
export async function saveEApprovalDepartmentRouting(
  record: EApprovalDepartmentRouting,
  actor: EApprovalServiceActor,
): Promise<void> {
  const who = requireActor(actor);
  if (!record.departmentId) throw new EApprovalServiceError('Choose a department.');
  await setDoc(
    doc(db, E_APPROVAL_COLLECTIONS.departmentRouting, record.departmentId),
    pruneUndefined({
      ...record,
      id: record.departmentId,
      organizationId: who.organizationId,
      ...withUpdateAudit(who),
    } as Record<string, unknown>),
    { merge: true },
  );
  invalidateEApprovalCache();
  await logEApprovalActivity(who, 'Save Department Routing', { departmentId: record.departmentId });
}

/** Project routing is keyed by project id, so it upserts rather than appending. */
export async function saveEApprovalProjectRouting(
  record: EApprovalProjectRouting,
  actor: EApprovalServiceActor,
): Promise<void> {
  const who = requireActor(actor);
  if (!record.projectId) throw new EApprovalServiceError('Choose a project.');
  const roleHolders = (record.roleHolders ?? []).filter((entry) => entry.role?.trim() && entry.userId);
  const duplicate = roleHolders.find(
    (entry, index) =>
      roleHolders.findIndex((other) => other.role.trim().toLowerCase() === entry.role.trim().toLowerCase()) !== index,
  );
  // A post held by two people is not a parallel approval, it is an unanswerable question about which
  // of them a stage means — so it is refused here rather than resolved arbitrarily at build time.
  if (duplicate) {
    throw new EApprovalServiceError(`“${duplicate.role.trim()}” is listed twice — each post can have one holder.`);
  }
  await setDoc(
    doc(db, E_APPROVAL_COLLECTIONS.projectRouting, record.projectId),
    pruneUndefined({
      ...record,
      id: record.projectId,
      roleHolders: roleHolders.map((entry) => ({ ...entry, role: entry.role.trim() })),
      organizationId: who.organizationId,
      ...withUpdateAudit(who),
    } as Record<string, unknown>),
    { merge: true },
  );
  invalidateEApprovalCache();
  await logEApprovalActivity(who, 'Save Project Routing', { projectId: record.projectId });
}

export async function deleteEApprovalConfigRecord(
  collectionName: string,
  id: string,
  actor: EApprovalServiceActor,
): Promise<void> {
  const who = requireActor(actor);
  await deleteDoc(doc(db, collectionName, id));
  invalidateEApprovalCache();
  await logEApprovalActivity(who, 'Delete Configuration', { collection: collectionName, id }, { recordId: id });
}

/**
 * Writes the seed workflows of spec section 12, for a new organisation.
 *
 * Two passes, because the seeds reference each other: a sub-workflow node holds the *seed* id of the
 * workflow it calls, which only becomes a real document id once that workflow has been written. The
 * first pass allocates a document reference for every seed, the second rewrites the references and
 * commits — so Purchase Approval lands already pointing at the Finance Clearance beside it rather
 * than at a string that means nothing. A seed whose sub-workflow was skipped as already-present is
 * pointed at the existing one, by name.
 */
export async function seedEApprovalTemplates(actor: EApprovalServiceActor): Promise<number> {
  const who = requireActor(actor);
  const existing = await listEApprovalTemplates(who.organizationId);
  const existingByName = new Map(existing.map((template) => [template.name, template]));

  const planned = SEED_E_APPROVAL_TEMPLATES.filter((template) => !existingByName.has(template.name)).map(
    (template) => ({ template, ref: doc(collection(db, E_APPROVAL_COLLECTIONS.templates)) }),
  );
  if (!planned.length) return 0;

  const idBySeedId = new Map<string, string>();
  for (const seed of SEED_E_APPROVAL_TEMPLATES) {
    const plannedEntry = planned.find((entry) => entry.template.id === seed.id);
    const resolvedId = plannedEntry?.ref.id ?? existingByName.get(seed.name)?.id;
    if (resolvedId) idBySeedId.set(seed.id, resolvedId);
  }

  const batch = writeBatch(db);
  for (const { template, ref } of planned) {
    batch.set(ref, {
      name: template.name,
      description: template.description ?? null,
      isSubWorkflow: template.isSubWorkflow ?? false,
      steps: template.steps.map((step) =>
        step.subWorkflowId
          ? { ...step, subWorkflowId: idBySeedId.get(step.subWorkflowId) ?? step.subWorkflowId }
          : step,
      ),
      active: true,
      organizationId: who.organizationId ?? null,
      ...withCreateAudit(who),
    });
  }
  await batch.commit();
  invalidateEApprovalCache();
  return planned.length;
}

/* ------------------------------------------------------------------------------------------------
 * Actor context — departments, headship and delegations (spec sections 11 and 23)
 * ---------------------------------------------------------------------------------------------- */

/**
 * Builds the engine's view of the signed-in user.
 *
 * The engine needs three things the auth session does not carry: which departments this person acts
 * for, whether they head any of them, and which delegations are pointed at them. All three come from
 * this module's own configuration rather than from the user record, so "who may act" is a stated
 * fact rather than an inference — see `EApprovalDepartmentRouting`.
 */
export async function loadEApprovalActorContext(
  actor: EApprovalServiceActor,
  options: { force?: boolean } = {},
): Promise<EApprovalActor> {
  const who = requireActor(actor);
  return cachedRead(
    `actor:${who.userId}:${who.organizationId ?? ''}:${who.departmentId ?? ''}:${who.role ?? ''}`,
    () => buildEApprovalActorContext(who),
    { force: options.force },
  );
}

/** The uncached body of `loadEApprovalActorContext`. */
async function buildEApprovalActorContext(who: EApprovalServiceActor): Promise<EApprovalActor> {
  const [routing, projectRouting, delegations, departments] = await Promise.all([
    listEApprovalDepartmentRouting(who.organizationId),
    listEApprovalProjectRouting(who.organizationId),
    listEApprovalDelegations(who.organizationId),
    listEApprovalDepartmentMaster(),
  ]);
  const mine = routing.filter(
    (row) => row.active !== false && (row.headUserId === who.userId || (row.memberUserIds ?? []).includes(who.userId)),
  );
  // Holding a named post on a project counts as membership: a Site In-Charge is on the project
  // whether or not somebody also remembered to list them under members.
  const myProjects = projectRouting.filter(
    (row) =>
      row.active !== false &&
      (row.headUserId === who.userId ||
        (row.memberUserIds ?? []).includes(who.userId) ||
        (row.roleHolders ?? []).some((holder) => holder.userId === who.userId)),
  );
  // Fallback: departments this user heads according to the organisation's own department master.
  // Without it, a request addressed to a department reaches nobody until an administrator has
  // configured routing — and "send it to Finance" has to work on day one, before anybody has
  // configured anything. A configured routing document still wins; this only fills the gap.
  const headedByMe = departments
    .filter((entry) => (entry as { head?: string }).head === who.userId)
    .map((entry) => entry.id);

  return {
    userId: who.userId,
    userName: who.userName,
    designation: who.designation,
    departmentId: who.departmentId,
    departmentIds: Array.from(
      new Set(
        [who.departmentId, ...mine.map((row) => row.departmentId), ...headedByMe].filter(Boolean) as string[],
      ),
    ),
    role: who.role,
    isDepartmentHead: mine.some((row) => row.headUserId === who.userId) || headedByMe.length > 0,
    projectIds: Array.from(new Set(myProjects.map((row) => row.projectId).filter(Boolean))),
    isProjectHead: myProjects.some((row) => row.headUserId === who.userId),
    delegations: delegations
      .filter((row) => row.active !== false)
      .map(
        (row): EApprovalDelegation => ({
          id: row.id,
          fromUserId: row.fromUserId,
          fromUserName: row.fromUserName,
          toUserId: row.toUserId,
          toUserName: row.toUserName,
          fromDate: row.fromDate,
          toDate: row.toDate ?? null,
          reason: row.reason,
          approvalTypeIds: row.approvalTypeIds,
          active: row.active,
        }),
      ),
  };
}

/**
 * Concrete users behind a department assignment, for notification delivery.
 *
 * Falls back to the department master's own `head` when no routing document exists, so a request
 * sent to a department is never delivered to nobody. An unconfigured department reaching its head is
 * the safe failure; reaching silence is not.
 */
async function resolveDepartmentUserIds(departmentIds: string[]): Promise<string[]> {
  if (!departmentIds.length) return [];
  const rows = await Promise.all(
    // Cached like the rest of the routing configuration: an approver clearing a queue of files that
    // all sit with the same department otherwise re-read that department's routing document — and
    // sometimes the department master behind it — once per file.
    departmentIds.map((departmentId) =>
      cachedRead(`deptRecipients:${departmentId}`, async () => {
        const snapshot = await getDoc(doc(db, E_APPROVAL_COLLECTIONS.departmentRouting, departmentId));
        if (snapshot.exists()) {
          const routing = snapshot.data() as EApprovalDepartmentRouting;
          const members =
            // A 'Head' step notifies only the head; other modes notify everybody who could pick it up.
            routing.mode === 'Head'
              ? ([routing.headUserId].filter(Boolean) as string[])
              : ([routing.headUserId, ...(routing.memberUserIds ?? [])].filter(Boolean) as string[]);
          if (members.length) return members;
        }
        const department = await getDoc(doc(db, 'departments', departmentId));
        const head = (department.data() as { head?: string } | undefined)?.head;
        return head ? [head] : [];
      }),
    ),
  );
  return Array.from(new Set(rows.flat()));
}

/**
 * Concrete users behind a project assignment, for notification delivery.
 *
 * Named post-holders are included alongside the head and the listed members, because a stage
 * addressed to the project as a whole is exactly the case where "who is actually on this site" means
 * everybody the routing document knows about — leaving the Site In-Charge off a project-wide notice
 * because they happen to be listed under `roleHolders` rather than `memberUserIds` is a distinction
 * only this codebase makes.
 */
async function resolveProjectUserIds(projectIds: string[]): Promise<string[]> {
  if (!projectIds.length) return [];
  const rows = await Promise.all(
    // Cached for the same reason as `resolveDepartmentUserIds` above.
    projectIds.map((projectId) =>
      cachedRead(`projectRecipients:${projectId}`, async () => {
        const snapshot = await getDoc(doc(db, E_APPROVAL_COLLECTIONS.projectRouting, projectId));
        if (!snapshot.exists()) return [] as string[];
        const routing = snapshot.data() as EApprovalProjectRouting;
        if (routing.active === false) return [] as string[];
        if (routing.mode === 'Head') return [routing.headUserId].filter(Boolean) as string[];
        return [
          routing.headUserId,
          ...(routing.memberUserIds ?? []),
          ...(routing.roleHolders ?? []).map((holder) => holder.userId),
        ].filter(Boolean) as string[];
      }),
    ),
  );
  return Array.from(new Set(rows.flat()));
}

/* ------------------------------------------------------------------------------------------------
 * Reference numbering (spec section 24)
 * ---------------------------------------------------------------------------------------------- */

const counterKey = (organizationId: string, financialYear: string, departmentCode: string) =>
  `${organizationId || 'default'}__${financialYear}__${departmentCode || 'ALL'}`;

/**
 * Allocates the next reference number.
 *
 * Inside a transaction, and on its own so a retry allocates a fresh number rather than reusing one:
 * two people submitting at the same instant is the ordinary case in an organisation where a whole
 * department raises note-sheets each morning, and duplicate reference numbers on approved documents
 * are not recoverable after the fact.
 */
export async function allocateEApprovalReference(
  organizationId: string | undefined,
  departmentName: string | undefined,
  settings: EApprovalSettingsRecord,
  departmentCodeOverride?: string,
): Promise<string> {
  const financialYear = financialYearForEApprovalDate(new Date());
  const departmentCode = settings.numbering.includeDepartmentCode
    ? (departmentCodeOverride || eApprovalDepartmentCode(departmentName))
    : '';
  const key = counterKey(organizationId || 'default', financialYear, departmentCode);
  const counterRef = doc(db, E_APPROVAL_COLLECTIONS.counters, key);
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(counterRef);
    const sequence = Number(snapshot.data()?.nextSequence || 1);
    transaction.set(
      counterRef,
      {
        organizationId: organizationId ?? null,
        financialYear,
        departmentCode,
        nextSequence: sequence + 1,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    return eApprovalReference(sequence, { settings: settings.numbering, departmentCode });
  });
}

/* ------------------------------------------------------------------------------------------------
 * Routing resolution (spec sections 12 and 13)
 * ---------------------------------------------------------------------------------------------- */

export interface ResolvedEApprovalRouting {
  /** The chain as it will actually run: sub-workflows expanded, dynamic approvers bound. */
  steps: EApprovalTemplateStep[];
  /** The same chain before expansion, for a builder that wants to show what was configured. */
  configuredSteps?: EApprovalTemplateStep[];
  templateId?: string;
  ruleId?: string;
  source: 'Ad-hoc' | 'Template' | 'Matrix Rule' | 'Approval Type Default' | 'None';
  ruleName?: string;
  /** Why the chain looks the way it does — expansions, skipped stages, unresolved approvers. */
  notes?: EApprovalWorkflowNote[];
  /** Sub-workflows that contributed stages. */
  subWorkflowIds?: string[];
}

/**
 * The other workflows and the project routing an expansion resolves against.
 *
 * Loaded once and threaded through, because the create form previews a chain on every keystroke that
 * changes the amount — re-reading the whole template collection each time is the difference between a
 * preview that keeps up and one that lags a character behind.
 */
export async function loadEApprovalWorkflowLibrary(
  organizationId?: string,
): Promise<EApprovalWorkflowLibrary & { templates: EApprovalTemplateRecord[] }> {
  const [templates, projectRouting] = await Promise.all([
    listEApprovalTemplates(organizationId),
    listEApprovalProjectRouting(organizationId),
  ]);
  return { templates, projectRouting };
}

/**
 * The chain a request will run through, resolved in priority order.
 *
 * Explicit ad-hoc routing beats an explicitly chosen template, which beats the approval matrix,
 * which beats the approval type's default. Deliberately in that order: an employee who has named the
 * approver on the form has made a decision, and silently overriding it with a matrix rule is how a
 * file ends up somewhere nobody expected. Exposed separately from `submitEApproval` so the create
 * form can preview the chain before anybody commits to it.
 */
export async function resolveEApprovalRoutingForDraft(
  draft: Pick<
    EApprovalRequestDraft,
    'adHocSteps' | 'templateId' | 'approvalTypeId' | 'departmentId' | 'projectId' | 'amount'
  > & { departmentName?: string; projectName?: string; priority?: EApprovalPriority },
  organizationId?: string,
  preloaded?: { library?: EApprovalWorkflowLibrary & { templates: EApprovalTemplateRecord[] }; rules?: EApprovalRuleRecord[]; types?: EApprovalType[] },
): Promise<ResolvedEApprovalRouting> {
  const context: EApprovalWorkflowContext = {
    approvalTypeId: draft.approvalTypeId,
    departmentId: draft.departmentId,
    departmentName: draft.departmentName,
    projectId: draft.projectId,
    projectName: draft.projectName,
    amount: draft.amount,
    priority: draft.priority,
  };
  const library = preloaded?.library ?? (await loadEApprovalWorkflowLibrary(organizationId));

  // Expansion runs on every branch, ad-hoc included: an approver named on the form can be "the
  // Project Manager" just as legitimately as one named in a template, and a chain that resolved
  // dynamic approvers only when it came from a template would be a rule with an arbitrary exception.
  const expand = (
    steps: EApprovalTemplateStep[],
    rest: Omit<ResolvedEApprovalRouting, 'steps' | 'configuredSteps' | 'notes' | 'subWorkflowIds'>,
  ): ResolvedEApprovalRouting => {
    const expanded = expandEApprovalWorkflow(steps, context, library);
    return {
      ...rest,
      steps: expanded.steps,
      configuredSteps: steps,
      notes: expanded.notes,
      subWorkflowIds: expanded.subWorkflowIds,
    };
  };

  if (draft.adHocSteps?.length) return expand(draft.adHocSteps, { source: 'Ad-hoc' });

  const [rules, types] = await Promise.all([
    preloaded?.rules ? Promise.resolve(preloaded.rules) : listEApprovalRules(organizationId),
    preloaded?.types ? Promise.resolve(preloaded.types) : listEApprovalTypes(organizationId),
  ]);
  const templateById = new Map(library.templates.map((template) => [template.id, template]));

  if (draft.templateId && templateById.has(draft.templateId)) {
    const template = templateById.get(draft.templateId) as EApprovalTemplateRecord;
    return expand(template.steps ?? [], { templateId: template.id, source: 'Template' });
  }

  const rule = resolveEApprovalRouting(
    rules.map((row) => ({ ...row, id: row.id })),
    {
      approvalTypeId: draft.approvalTypeId,
      departmentId: draft.departmentId,
      projectId: draft.projectId,
      amount: draft.amount,
    },
  );
  if (rule) {
    const fromTemplate = rule.templateId ? templateById.get(rule.templateId) : undefined;
    const steps = rule.steps?.length ? rule.steps : (fromTemplate?.steps ?? []);
    if (steps.length) {
      return expand(steps, {
        templateId: fromTemplate?.id,
        ruleId: rule.id,
        ruleName: rule.name || fromTemplate?.name,
        source: 'Matrix Rule',
      });
    }
  }

  const type = types.find((row) => row.id === draft.approvalTypeId);
  const defaultTemplate = type?.defaultTemplateId ? templateById.get(type.defaultTemplateId) : undefined;
  if (defaultTemplate?.steps?.length) {
    return expand(defaultTemplate.steps, { templateId: defaultTemplate.id, source: 'Approval Type Default' });
  }
  return { steps: [], configuredSteps: [], source: 'None', notes: [], subWorkflowIds: [] };
}

/**
 * The chain a given set of stages would produce for a given project, department, type and amount —
 * without saving anything.
 *
 * This is what the workflow builder's tester calls. An approval matrix's mistakes are invisible until
 * a real note-sheet takes the wrong route, and stage overrides and sub-workflows multiply the ways a
 * configuration can be subtly wrong; being able to enter "Ranchi Metro, ₹6,00,000" and watch the
 * expanded chain appear turns "I think this is right" into "this is what will happen".
 */
export async function previewEApprovalWorkflow(
  steps: EApprovalTemplateStep[],
  context: EApprovalWorkflowContext,
  organizationId?: string,
  preloaded?: EApprovalWorkflowLibrary & { templates: EApprovalTemplateRecord[] },
): Promise<ReturnType<typeof expandEApprovalWorkflow>> {
  const library = preloaded ?? (await loadEApprovalWorkflowLibrary(organizationId));
  return expandEApprovalWorkflow(steps, context, library);
}

/* ------------------------------------------------------------------------------------------------
 * Reads
 * ---------------------------------------------------------------------------------------------- */

const mapDocs = <T>(docs: Array<{ id: string; data: () => Record<string, unknown> }>): T[] =>
  docs.map((entry) => ({ id: entry.id, ...entry.data() }) as T);

export async function getEApprovalRequest(approvalId: string): Promise<EApprovalRequest | null> {
  const snapshot = await getDoc(doc(db, E_APPROVAL_COLLECTIONS.requests, approvalId));
  return snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as EApprovalRequest) : null;
}

export async function listEApprovalSteps(approvalId: string): Promise<EApprovalStep[]> {
  const snapshot = await getDocs(
    query(collection(db, E_APPROVAL_COLLECTIONS.steps), where('approvalId', '==', approvalId)),
  );
  return mapDocs<EApprovalStep>(snapshot.docs).sort(
    (a, b) => a.sequence - b.sequence || a.depth - b.depth || String(a.id).localeCompare(String(b.id)),
  );
}

/** Everything the detail screen renders, in one call (spec sections 16–17). */
export async function loadEApprovalDetail(approvalId: string): Promise<EApprovalDetail | null> {
  const request = await getEApprovalRequest(approvalId);
  if (!request) return null;
  const [steps, history, comments, attachments, versions] = await Promise.all([
    listEApprovalSteps(approvalId),
    getDocs(query(collection(db, E_APPROVAL_COLLECTIONS.history), where('approvalId', '==', approvalId))).then(
      (snapshot) =>
        mapDocs<EApprovalHistoryEntry>(snapshot.docs).sort((a, b) => String(a.at).localeCompare(String(b.at))),
    ),
    getDocs(query(collection(db, E_APPROVAL_COLLECTIONS.comments), where('approvalId', '==', approvalId))).then(
      (snapshot) =>
        mapDocs<EApprovalComment>(snapshot.docs).sort(
          (a, b) => (a.createdAt?.toMillis() ?? 0) - (b.createdAt?.toMillis() ?? 0),
        ),
    ),
    getDocs(query(collection(db, E_APPROVAL_COLLECTIONS.attachments), where('approvalId', '==', approvalId))).then(
      (snapshot) => mapDocs<EApprovalAttachment>(snapshot.docs),
    ),
    getDocs(query(collection(db, E_APPROVAL_COLLECTIONS.versions), where('approvalId', '==', approvalId))).then(
      (snapshot) => mapDocs<EApprovalVersionRecord>(snapshot.docs).sort((a, b) => a.version - b.version),
    ),
  ]);
  return { request, steps, history, comments, attachments, versions };
}

/**
 * Everything one person has done, across every approval — the personal log behind the "My Activity"
 * screen. One query against `eApprovalHistory` by `actorId`, made possible by denormalising
 * `referenceNo`/`subject` onto each entry at write time (see `commitEApprovalTransition`); reading
 * this the other way — one `eApprovalRequests` lookup per matching entry — is exactly the N+1 this
 * module avoids everywhere else.
 *
 * Bounded rather than paginated, like `loadEApprovalAnalyticsData`: `truncated` tells the caller
 * whether the limit was hit, so a screen can say "showing the most recent 500" instead of silently
 * looking complete when it is not.
 */
export async function listEApprovalMyActivity(
  userId: string,
  organizationId?: string,
  limit = 500,
): Promise<{ entries: EApprovalHistoryEntry[]; truncated: boolean }> {
  const snapshot = await getDocs(
    query(
      collection(db, E_APPROVAL_COLLECTIONS.history),
      ...scopeQuery(organizationId),
      where('actorId', '==', userId),
      orderBy('recordedAt', 'desc'),
      fsLimit(limit),
    ),
  );
  return { entries: mapDocs<EApprovalHistoryEntry>(snapshot.docs), truncated: snapshot.size >= limit };
}

export interface EApprovalListFilter {
  organizationId?: string;
  /** Pending with this user — their own assignments only. */
  assigneeId?: string;
  /** Pending with any of these departments. */
  departmentIds?: string[];
  /** Pending with this role. */
  role?: string;
  requesterId?: string;
  statuses?: EApprovalStatus[];
  approvalTypeId?: string;
  projectId?: string;
  limit?: number;
}

/**
 * The one list query every register, inbox and report goes through.
 *
 * Status is filtered in memory when it cannot be combined with the array predicate — Firestore allows
 * one `array-contains`/`array-contains-any` and one `in` per query, and the department inbox needs
 * both. Filtering the smaller side in memory keeps every screen on one round trip instead of making
 * each of them invent a different compromise.
 */
export async function listEApprovals(filter: EApprovalListFilter): Promise<EApprovalRequest[]> {
  const { firestoreQuery, narrow } = buildEApprovalListQuery(filter);
  const snapshot = await getDocs(firestoreQuery);
  return narrow(snapshot.docs);
}

/**
 * The query behind `listEApprovals`, plus the in-memory narrowing it needs — shared with the live
 * subscription so a screen cannot show one set of rows on first paint and a different set on update.
 */
function buildEApprovalListQuery(filter: EApprovalListFilter): {
  firestoreQuery: Query<DocumentData>;
  narrow: (docs: QueryDocumentSnapshot<DocumentData>[]) => EApprovalRequest[];
} {
  const constraints: QueryConstraint[] = [...scopeQuery(filter.organizationId)];
  // Any array predicate pushes the status filter in memory. Firestore's rules on combining
  // `array-contains-any` with `in` differ from those for `array-contains`, and a query that works in
  // one branch and fails in another at runtime is worse than one extra client-side pass over a list
  // that is, by construction, one user's workload.
  let filterStatusInMemory = false;

  if (filter.assigneeId) {
    constraints.push(where('currentAssigneeIds', 'array-contains', filter.assigneeId));
    filterStatusInMemory = true;
  } else if (filter.departmentIds?.length) {
    constraints.push(where('currentDepartmentIds', 'array-contains-any', filter.departmentIds.slice(0, 30)));
    filterStatusInMemory = true;
  } else if (filter.role) {
    constraints.push(where('currentRoles', 'array-contains', filter.role));
    filterStatusInMemory = true;
  }

  if (filter.requesterId) constraints.push(where('requesterId', '==', filter.requesterId));
  if (filter.approvalTypeId) constraints.push(where('approvalTypeId', '==', filter.approvalTypeId));
  if (filter.projectId) constraints.push(where('projectId', '==', filter.projectId));

  const statuses = filter.statuses ?? [];
  if (statuses.length && statuses.length <= 10 && !filterStatusInMemory) {
    constraints.push(where('status', 'in', statuses));
  } else if (statuses.length) {
    filterStatusInMemory = true;
  }

  constraints.push(orderBy('createdAt', 'desc'));
  if (filter.limit) constraints.push(fsLimit(filter.limit));

  const allowed = new Set(statuses);
  return {
    firestoreQuery: query(collection(db, E_APPROVAL_COLLECTIONS.requests), ...constraints),
    narrow: (docs) => {
      let rows = mapDocs<EApprovalRequest>(docs).filter((row) => row.isDeleted !== true);
      if (filterStatusInMemory && statuses.length) rows = rows.filter((row) => allowed.has(row.status));
      return rows;
    },
  };
}

/**
 * `listEApprovals`, but live.
 *
 * Returns the unsubscribe function. `onRows` fires on every server change, so an approval somebody
 * else acts on while the inbox is open moves out of the inbox on its own — the alternative, a Refresh
 * button, is how an approver comes to act on a file that a colleague has already forwarded.
 */
export function subscribeEApprovals(
  filter: EApprovalListFilter,
  onRows: (rows: EApprovalRequest[]) => void,
  onError?: (error: Error) => void,
): () => void {
  const { firestoreQuery, narrow } = buildEApprovalListQuery(filter);
  return onSnapshot(
    firestoreQuery,
    (snapshot) => onRows(narrow(snapshot.docs)),
    (error) => {
      console.error('[e-approval] live query failed', error);
      onError?.(error);
    },
  );
}

/**
 * Everything the dashboard counts, fetched once.
 *
 * Three queries merged by id rather than nine counted server-side: a file that moves between two of
 * the nine would be counted twice or not at all, and a dashboard that cannot agree with itself stops
 * being used. See `summarizeEApprovalDashboard`, which does the counting.
 */
export async function loadEApprovalWorkload(
  actor: EApprovalActor,
  organizationId?: string,
): Promise<EApprovalRequest[]> {
  const [mine, byDepartment, byRole, created] = await Promise.all([
    listEApprovals({ organizationId, assigneeId: actor.userId, limit: 300 }),
    actor.departmentIds?.length
      ? listEApprovals({ organizationId, departmentIds: actor.departmentIds, limit: 300 })
      : Promise.resolve([]),
    actor.role ? listEApprovals({ organizationId, role: actor.role, limit: 300 }) : Promise.resolve([]),
    listEApprovals({ organizationId, requesterId: actor.userId, limit: 300 }),
  ]);
  const byId = new Map<string, EApprovalRequest>();
  [...mine, ...byDepartment, ...byRole, ...created].forEach((row) => byId.set(row.id, row));
  return Array.from(byId.values());
}

/**
 * `loadEApprovalWorkload`, but live.
 *
 * The same four queries, each subscribed, merged by id on every change. `onRows` is first called once
 * every source has reported (so the dashboard never paints a partial workload and then "grows"), and
 * thereafter on any change to any of them. Returns the unsubscribe for all four.
 */
export function subscribeEApprovalWorkload(
  actor: EApprovalActor,
  organizationId: string | undefined,
  onRows: (rows: EApprovalRequest[]) => void,
  onError?: (error: Error) => void,
): () => void {
  const sources: EApprovalListFilter[] = [
    { organizationId, assigneeId: actor.userId, limit: 300 },
    ...(actor.departmentIds?.length ? [{ organizationId, departmentIds: actor.departmentIds, limit: 300 }] : []),
    ...(actor.role ? [{ organizationId, role: actor.role, limit: 300 }] : []),
    { organizationId, requesterId: actor.userId, limit: 300 },
  ];
  const latest = new Map<number, EApprovalRequest[]>();
  const emit = () => {
    if (latest.size < sources.length) return;
    const byId = new Map<string, EApprovalRequest>();
    for (const rows of latest.values()) rows.forEach((row) => byId.set(row.id, row));
    onRows(Array.from(byId.values()));
  };
  const unsubscribes = sources.map((filter, index) =>
    subscribeEApprovals(
      filter,
      (rows) => {
        latest.set(index, rows);
        emit();
      },
      onError,
    ),
  );
  return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
}

/* ------------------------------------------------------------------------------------------------
 * Drafts (spec section 15)
 * ---------------------------------------------------------------------------------------------- */

const materialSnapshotOf = (
  request: Pick<
    EApprovalRequest,
    'subject' | 'body' | 'amount' | 'departmentId' | 'projectId' | 'approvalTypeId' | 'vendorId' | 'costCentre' | 'budgetHead' | 'requiredBy'
  >,
  attachmentsFingerprint = '',
): EApprovalMaterialSnapshot => ({
  subject: request.subject,
  body: request.body,
  amount: request.amount,
  departmentId: request.departmentId,
  projectId: request.projectId,
  approvalTypeId: request.approvalTypeId,
  vendorId: request.vendorId,
  costCentre: request.costCentre,
  budgetHead: request.budgetHead,
  requiredBy: request.requiredBy ?? null,
  attachmentsFingerprint,
});

/** Names and sizes of the live attachments — enough that swapping a quotation counts as a change. */
const attachmentsFingerprintOf = (attachments: EApprovalAttachment[], version: number): string =>
  attachments
    .filter((attachment) => (attachment.version ?? 1) <= version)
    .map((attachment) => `${attachment.name}:${attachment.size ?? 0}`)
    .sort()
    .join('|');

/**
 * Keeps the proposal's two representations in step on the way to Firestore.
 *
 * `bodyHtml` carries the formatting and `body` is its plain-text rendition — and `body` is what
 * `eApprovalMaterialFingerprint` hashes, so the two drifting apart would mean change control
 * comparing a stale sentence against a live document. Rather than trust every caller to send a
 * matching pair, whenever HTML is present the text is derived from it here. One source of truth, at
 * the last point before the write.
 *
 * Returns only the keys it actually decides, so it can be spread over a partial draft without
 * inventing fields the caller never mentioned.
 */
function reconcileEApprovalProposal(
  draft: Partial<Pick<EApprovalRequestDraft, 'body' | 'bodyHtml'>>,
): { body?: string; bodyHtml?: string } {
  if (draft.bodyHtml != null) {
    if (!eApprovalHtmlWithinLimit(draft.bodyHtml)) {
      throw new EApprovalServiceError(
        'The proposal is too large to store. Paste it in parts, or attach the document and summarise it here.',
      );
    }
    // An editor left empty still reports markup (`<p><br></p>`), which would store as a proposal
    // that looks present and reads blank.
    if (eApprovalHtmlIsEmpty(draft.bodyHtml)) return { body: '', bodyHtml: '' };
    return { body: eApprovalHtmlToText(draft.bodyHtml), bodyHtml: draft.bodyHtml };
  }
  if (draft.body != null) return { body: draft.body.trim() };
  return {};
}

export async function createEApprovalDraft(
  draft: EApprovalRequestDraft,
  actor: EApprovalServiceActor,
): Promise<string> {
  const who = requireActor(actor);
  if (!draft.subject?.trim()) throw new EApprovalServiceError('A subject is required.');
  const proposal = reconcileEApprovalProposal(draft);
  if (!proposal.body) throw new EApprovalServiceError('A proposal is required.');

  const created = await addDoc(
    collection(db, E_APPROVAL_COLLECTIONS.requests),
    pruneUndefined({
      ...draft,
      ...proposal,
      subject: draft.subject.trim(),
      priority: draft.priority ?? ('Normal' as EApprovalPriority),
      status: 'Draft' as EApprovalStatus,
      version: 1,
      requesterId: who.userId,
      requesterName: who.userName,
      requesterDesignation: who.designation,
      requesterDepartmentId: who.departmentId,
      organizationId: who.organizationId,
      participantUserIds: draft.ccUserIds ?? [],
      attachmentCount: 0,
      commentCount: 0,
      ...withCreateAudit(who),
    } as Record<string, unknown>),
  );
  await logEApprovalActivity(who, 'Create Draft', { subject: draft.subject }, { recordId: created.id });
  return created.id;
}

export async function updateEApprovalDraft(
  approvalId: string,
  draft: Partial<EApprovalRequestDraft>,
  actor: EApprovalServiceActor,
): Promise<void> {
  const who = requireActor(actor);
  const request = await getEApprovalRequest(approvalId);
  if (!request) throw new EApprovalServiceError('This approval no longer exists.');
  if (request.requesterId !== who.userId) {
    throw new EApprovalServiceError('Only the requester can edit this approval.');
  }
  // A returned request is editable — that is the point of returning it — but a live one is not: an
  // approver must not find the proposal changed underneath them mid-approval.
  if (request.status !== 'Draft' && request.status !== 'Returned') {
    throw new EApprovalServiceError(`A ${request.status.toLowerCase()} approval cannot be edited.`);
  }
  await updateDoc(
    doc(db, E_APPROVAL_COLLECTIONS.requests, approvalId),
    pruneUndefined({
      ...draft,
      ...reconcileEApprovalProposal(draft),
      ...withUpdateAudit(who),
    } as Record<string, unknown>),
  );
  await logEApprovalActivity(who, 'Edit Request', { status: request.status }, {
    recordId: approvalId,
    recordRef: request.referenceNo,
  });
}

/** A draft is the only thing that can be deleted; anything submitted is cancelled instead. */
export async function deleteEApprovalDraft(approvalId: string, actor: EApprovalServiceActor): Promise<void> {
  const who = requireActor(actor);
  const request = await getEApprovalRequest(approvalId);
  if (!request) return;
  if (request.requesterId !== who.userId) throw new EApprovalServiceError('Only the requester can delete this draft.');
  if (request.status !== 'Draft') throw new EApprovalServiceError('Only a draft can be deleted. Cancel it instead.');
  await updateDoc(doc(db, E_APPROVAL_COLLECTIONS.requests, approvalId), {
    isDeleted: true,
    ...withUpdateAudit(who),
  });
  await logEApprovalActivity(who, 'Delete Draft', {}, { recordId: approvalId });
}

/* ------------------------------------------------------------------------------------------------
 * Submission
 * ---------------------------------------------------------------------------------------------- */

/**
 * Submits a draft: resolves the chain, allocates the reference number, writes the steps and runs the
 * engine's `Submit`.
 *
 * The chain is resolved *now* rather than at draft time, so a matrix rule keyed on amount routes the
 * figure that was actually submitted. A draft saved at ₹20,000 and submitted at ₹9,00,000 must go to
 * the board, not to the ₹25,000 chain it would have matched last week.
 */
export async function submitEApproval(
  approvalId: string,
  actor: EApprovalServiceActor,
  options: { comment?: string } = {},
): Promise<void> {
  const who = requireActor(actor);
  const request = await getEApprovalRequest(approvalId);
  if (!request) throw new EApprovalServiceError('This approval no longer exists.');
  if (request.status !== 'Draft') throw new EApprovalServiceError('Only a draft can be submitted.');
  if (request.requesterId !== who.userId) {
    throw new EApprovalServiceError('Only the requester can submit this approval.');
  }

  const settings = await loadEApprovalSettings(who.organizationId);
  const routing = await resolveEApprovalRoutingForDraft(
    {
      // The approvers the requester named on the form, saved with the draft. Dropping these here is
      // what made an ad-hoc request — the ordinary "send this to Finance" case — fail at submission
      // with "no approver could be determined" despite an approver having been chosen.
      adHocSteps: request.adHocSteps,
      templateId: request.templateId,
      approvalTypeId: request.approvalTypeId,
      departmentId: request.departmentId,
      departmentName: request.departmentName,
      projectId: request.projectId,
      projectName: request.projectName,
      amount: request.amount,
      priority: request.priority,
    },
    who.organizationId,
  );
  const existingSteps = await listEApprovalSteps(approvalId);
  if (!routing.steps.length && !existingSteps.length) {
    throw new EApprovalServiceError(
      'No approver could be determined. Choose an approver on the form, or ask an administrator to configure a workflow for this approval type.',
    );
  }
  // A stage that resolves to nobody strands the file there with no way forward but an administrator.
  // Caught here, where the requester can be told which stage and why, rather than discovered days
  // later by whoever is waiting on an approval that was never going to arrive. Only checked for a
  // freshly built chain — a request already carrying steps has been through this once.
  if (!existingSteps.length) {
    const blocking = eApprovalWorkflowBlockingIssues(routing);
    if (blocking.length) {
      throw new EApprovalServiceError(
        `This workflow cannot run as configured: ${blocking.join(' ')} Ask an administrator to set an approver${
          request.projectName ? ` for ${request.projectName}` : ''
        }, or name the approvers on the form.`,
      );
    }
  }

  const attachments = await getDocs(
    query(collection(db, E_APPROVAL_COLLECTIONS.attachments), where('approvalId', '==', approvalId)),
  ).then((snapshot) => mapDocs<EApprovalAttachment>(snapshot.docs));

  const referenceNo =
    request.referenceNo ||
    (await allocateEApprovalReference(who.organizationId, request.departmentName, settings));

  const nextId = firestoreIdFactory();
  const steps = existingSteps.length
    ? existingSteps
    : (buildEApprovalSteps(routing.steps, {
        priority: request.priority,
        settings,
        version: 1,
        nextId,
      }) as EApprovalStep[]);

  const fingerprint = eApprovalMaterialFingerprint(
    materialSnapshotOf(request, attachmentsFingerprintOf(attachments, 1)),
    settings.materialFields,
  );

  await commitEApprovalTransition({
    request: { ...request, referenceNo },
    steps,
    actor: who,
    settings,
    input: {
      kind: 'Submit',
      actor: await loadEApprovalActorContext(who),
      comment: options.comment,
      now: nowIso(),
      nextId,
      settings,
      materialChange: { changed: false, fields: [], fingerprint },
    },
    extraRequestFields: {
      referenceNo,
      templateId: routing.templateId ?? null,
      ruleId: routing.ruleId ?? null,
      materialFingerprint: fingerprint,
    },
    versionSnapshot: {
      version: 1,
      snapshot: materialSnapshotOf(request, attachmentsFingerprintOf(attachments, 1)),
      fingerprint,
    },
    activityAction: 'Submit',
  });
}

export interface CreateMirroredEApprovalInput {
  source: EApprovalSourceLink;
  subject: string;
  body: string;
  /** The chain, already resolved by the source module against its own workflow and assignees. */
  steps: EApprovalTemplateStep[];
  /** Per-step mirror pointers, applied to the built records in chain order. */
  decorateSteps?: (records: EApprovalStepRecord[]) => EApprovalStepRecord[];
  approvalTypeId?: string;
  approvalTypeName?: string;
  departmentId?: string;
  departmentName?: string;
  projectId?: string;
  projectName?: string;
  externalRef?: string;
  priority?: EApprovalPriority;
  requiredBy?: string | null;
  amount?: number;
  vendorName?: string;
  costCentre?: string;
  budgetHead?: string;
  confidential?: boolean;
  /** The person the approval is raised on behalf of — the payment's owner, not whoever tripped the sync. */
  requester: { userId: string; userName?: string };
  ccUserIds?: string[];
}

/**
 * Raises a request that mirrors another module's workflow, already submitted and running.
 *
 * Deliberately not `createEApprovalDraft` + `submitEApproval`. Those two exist for a person filling
 * in a form: they resolve the chain from E-Approval's own templates and approval matrix, and they
 * refuse a submission from anybody but the requester. Neither is right here. The chain has already
 * been decided — by the source module's own configuration, which is the whole point of a mirror —
 * and the caller is a background reconcile, not the requester. Routing it through the form's path
 * would either overwrite the source module's chain with an unrelated one or fail on the requester
 * check, depending on how the organization happens to have E-Approval configured.
 *
 * There is no draft state: the payment is already in somebody's queue, so an approval sitting in
 * Drafts would be a second, invisible copy of work that has visibly started.
 */
export async function createMirroredEApproval(
  input: CreateMirroredEApprovalInput,
  actor: EApprovalServiceActor,
): Promise<{ approvalId: string; referenceNo: string }> {
  const who = requireActor(actor);
  if (!input.steps.length) throw new EApprovalServiceError('A mirrored approval needs at least one stage.');

  const settings = await loadEApprovalSettings(who.organizationId);
  const referenceNo = await allocateEApprovalReference(who.organizationId, input.departmentName, settings);
  const priority = input.priority ?? 'Normal';
  const nextId = firestoreIdFactory();

  const requestRef = doc(collection(db, E_APPROVAL_COLLECTIONS.requests));
  const built = buildEApprovalSteps(input.steps, { priority, settings, version: 1, nextId });
  const steps = (input.decorateSteps ? input.decorateSteps(built) : built) as EApprovalStep[];

  const request: EApprovalRequest = {
    id: requestRef.id,
    organizationId: who.organizationId,
    referenceNo,
    subject: input.subject,
    body: input.body,
    approvalTypeId: input.approvalTypeId,
    approvalTypeName: input.approvalTypeName,
    departmentId: input.departmentId,
    departmentName: input.departmentName,
    projectId: input.projectId,
    projectName: input.projectName,
    externalRef: input.externalRef,
    priority,
    requiredBy: input.requiredBy ?? null,
    amount: input.amount,
    vendorName: input.vendorName,
    costCentre: input.costCentre,
    budgetHead: input.budgetHead,
    requesterId: input.requester.userId,
    requesterName: input.requester.userName,
    confidential: input.confidential,
    ccUserIds: input.ccUserIds ?? [],
    participantUserIds: input.ccUserIds ?? [],
    status: 'Draft',
    version: 1,
    attachmentCount: 0,
    commentCount: 0,
    source: input.source,
  };

  // Written before the transition so the batch below merges onto a document that exists; the
  // transition immediately overwrites `status` with whatever the engine produces.
  await setDoc(
    requestRef,
    pruneUndefined({ ...request, ...withCreateAudit(who) } as unknown as Record<string, unknown>),
  );

  await commitEApprovalTransition({
    request,
    steps,
    actor: who,
    settings,
    input: {
      kind: 'Submit',
      // The requester submits their own file, even though a reconcile is what triggered it: the
      // engine's Submit refuses anybody else, and rightly — this approval is raised *for* them.
      actor: { userId: input.requester.userId, userName: input.requester.userName },
      now: nowIso(),
      nextId,
      settings,
      materialChange: { changed: false, fields: [], fingerprint: '' },
    },
    extraRequestFields: { source: pruneUndefined(input.source as unknown as Record<string, unknown>) },
    activityAction: 'Submit',
  });

  return { approvalId: requestRef.id, referenceNo };
}

/** Refreshes the denormalised source pointer — the label, the path, which stage is current. */
export async function updateEApprovalSourceLink(
  approvalId: string,
  source: EApprovalSourceLink,
  actor: EApprovalServiceActor,
): Promise<void> {
  await updateDoc(doc(db, E_APPROVAL_COLLECTIONS.requests, approvalId), {
    source: pruneUndefined(source as unknown as Record<string, unknown>),
    ...withUpdateAudit(requireActor(actor)),
  });
}

/* ------------------------------------------------------------------------------------------------
 * Actions
 * ---------------------------------------------------------------------------------------------- */

export interface PerformEApprovalActionInput {
  kind: EApprovalActionKind;
  stepId?: string;
  comment?: string;
  instruction?: string;
  reason?: string;
  targets?: EApprovalAssignment[];
  returnTo?: string;
  outcome?: string;
  slaHours?: number;
  participantUserIds?: string[];
  /** Approve / Approve And Complete on a request with an amount: the figure to sanction, if not the amount requested. */
  approvedAmount?: number;
}

/**
 * Applies one workflow action.
 *
 * Loads the request and its steps, hands them to the engine, and persists the result atomically. The
 * engine decides everything; this function's only judgement is the resubmission case, where it has to
 * compute the material change (spec section 6) because that needs the stored fingerprint and the
 * current attachment list — neither of which the engine can reach.
 */
export async function performEApprovalAction(
  approvalId: string,
  input: PerformEApprovalActionInput,
  actor: EApprovalServiceActor,
): Promise<void> {
  const who = requireActor(actor);
  const [request, steps, settings, engineActor] = await Promise.all([
    getEApprovalRequest(approvalId),
    listEApprovalSteps(approvalId),
    loadEApprovalSettings(who.organizationId),
    loadEApprovalActorContext(who),
  ]);
  if (!request) throw new EApprovalServiceError('This approval no longer exists.');

  let materialChange: EApprovalActionInput['materialChange'];
  let versionSnapshot: { version: number; snapshot: EApprovalMaterialSnapshot; fingerprint: string } | undefined;

  if (input.kind === 'Resubmit') {
    const attachments = await getDocs(
      query(collection(db, E_APPROVAL_COLLECTIONS.attachments), where('approvalId', '==', approvalId)),
    ).then((snapshot) => mapDocs<EApprovalAttachment>(snapshot.docs));
    const snapshot = materialSnapshotOf(
      request,
      attachmentsFingerprintOf(attachments, request.version + 1),
    );
    const fingerprint = eApprovalMaterialFingerprint(snapshot, settings.materialFields);
    // Compared against the fingerprint stored at the last submission — the only faithful record of
    // what the approvers actually saw. Field-by-field rather than `detectEApprovalMaterialChange`,
    // because the stored side is a fingerprint, not a snapshot: the original values are gone, and
    // reconstructing them to feed the detector would compare normalised text against itself.
    const changedFields = request.materialFingerprint
      ? fingerprintDifference(request.materialFingerprint, fingerprint, settings.materialFields)
      : [];
    materialChange = { changed: changedFields.length > 0, fields: changedFields, fingerprint };

    if (changedFields.includes('amount')) {
      const before = Number(fieldFromFingerprint(request.materialFingerprint, 'amount') || 0);
      const now = Number(request.amount ?? 0);
      const pct = before === 0 ? 100 : Math.abs(((now - before) / before) * 100);
      materialChange.amountChange = { from: before, to: now, pct: Math.round(pct * 100) / 100 };
      // Inside tolerance an amount edit is a correction, not a new proposal.
      if (pct <= (settings.amountTolerancePct ?? 0)) {
        materialChange.fields = changedFields.filter((field) => field !== 'amount');
        materialChange.changed = materialChange.fields.length > 0;
      }
    }

    if (materialChange.changed) {
      versionSnapshot = {
        version: request.version,
        snapshot,
        fingerprint: materialChange.fingerprint,
      };
    }
  }

  await commitEApprovalTransition({
    request,
    steps,
    actor: who,
    settings,
    input: {
      kind: input.kind,
      actor: engineActor,
      stepId: input.stepId,
      comment: input.comment,
      instruction: input.instruction,
      reason: input.reason,
      targets: input.targets,
      returnTo: input.returnTo,
      outcome: input.outcome as EApprovalActionInput['outcome'],
      slaHours: input.slaHours,
      participantUserIds: input.participantUserIds,
      approvedAmount: input.approvedAmount,
      materialChange,
      now: nowIso(),
      nextId: firestoreIdFactory(),
      settings,
    },
    extraRequestFields: materialChange?.changed ? { materialFingerprint: materialChange.fingerprint } : {},
    versionSnapshot,
    activityAction: input.kind,
  });

  await propagateToSource(request, who);
}

/**
 * Pushes a decision taken here back to the module whose workflow this request mirrors.
 *
 * Imported dynamically, and only when a request actually carries a source link. Statically, this
 * would make the approval engine depend on every module that ever mirrors into it — the wrong way
 * round, and a cycle: the bridge imports this file. Loading it on demand keeps E-Approval ignorant
 * of what a payment obligation is until the moment a payment obligation is in front of it.
 *
 * Failures are swallowed on purpose. The approver's decision is committed; refusing to acknowledge
 * it because the other module could not be updated would be the wrong trade, and the bridge is
 * idempotent — the next reconcile from either side picks it up, and the error is recorded on the
 * source record meanwhile.
 */
async function propagateToSource(request: EApprovalRequest, actor: EApprovalServiceActor): Promise<void> {
  const source = request.source;
  if (!source?.recordId || source.detachedAt) return;
  if (source.module !== 'Recurring Payments') return;
  try {
    const bridge = await import('@/lib/recurring-payments-e-approval-service');
    await bridge.syncRecurringPaymentApproval(source.recordId, actor);
  } catch {
    // Deliberately silent — see above.
  }
}

/**
 * Applies an action to a *mirrored* request on behalf of whoever completed the equivalent step in
 * the source module (see `e-approval-link.ts`).
 *
 * Exists because the two chains can drift. A mirrored stage is built from the source module's own
 * assignee resolution, so the person who acts there is normally the person the stage names here —
 * but not always: an amount-based assignment re-resolves when the bill comes in at three times the
 * estimate, a backup approver covers for the primary, an administrator edits the workflow mid-flight.
 * When that happens the engine is right to refuse the action, and swallowing the refusal would leave
 * the approval permanently one stage behind the payment.
 *
 * So the stage is moved to the person who actually acted, with a reassignment recorded, *before* the
 * action is applied — which is what happened. The alternative, passing the assignee as the actor,
 * would write "approved by Nandini" into an approval Ravi gave, and an approval trail that names the
 * wrong person is worse than no approval trail.
 */
export async function applyMirroredEApprovalAction(
  approvalId: string,
  input: PerformEApprovalActionInput & { stepId: string },
  actor: EApprovalServiceActor,
  onBehalfOfNote?: string,
): Promise<void> {
  const who = requireActor(actor);
  const steps = await listEApprovalSteps(approvalId);
  const step = steps.find((candidate) => candidate.id === input.stepId);
  if (!step) throw new EApprovalServiceError('That approval stage no longer exists.');

  const alreadyTheirs =
    step.assignment.kind === 'User' && step.assignment.userId === who.userId;
  if (!alreadyTheirs) {
    const to: EApprovalAssignment = { kind: 'User', userId: who.userId, userName: who.userName };
    await updateDoc(doc(db, E_APPROVAL_COLLECTIONS.steps, step.id), {
      assignment: pruneUndefined(to as unknown as Record<string, unknown>),
      reassignments: [
        ...(step.reassignments ?? []),
        {
          at: nowIso(),
          kind: 'Reassign' as const,
          byUserId: who.userId,
          byName: who.userName,
          from: step.assignment,
          to,
          reason: onBehalfOfNote || 'Actioned in the source module by this user.',
        },
      ],
      ...withUpdateAudit(who),
    });
  }
  await performEApprovalAction(approvalId, input, who);
}

/* ------------------------------------------------------------------------------------------------
 * Analytics data loading
 * ---------------------------------------------------------------------------------------------- */

export interface EApprovalAnalyticsData {
  requests: EApprovalRequest[];
  steps: EApprovalStep[];
  events: EApprovalHistoryEntry[];
  loadedAt: string;
  /** True when a collection hit its cap, so a screen can say the numbers are partial. */
  truncated: boolean;
}

/**
 * Every row the reporting layer needs, in three collection queries.
 *
 * Three, not one-per-approval. The obvious implementation — fetch the requests, then fetch each one's
 * steps — is four hundred round trips for four hundred approvals, and it gets slower exactly as the
 * organisation it is reporting on grows. Steps and history are queried directly and joined in memory
 * by `approvalId`.
 *
 * `truncated` is returned rather than silently capping, because a bottleneck report that quietly
 * omits the oldest third of the backlog is worse than one that admits it is partial.
 */
export async function loadEApprovalAnalyticsData(
  organizationId?: string,
  options: {
    requestLimit?: number;
    stepLimit?: number;
    eventLimit?: number;
    includeEvents?: boolean;
    /** Bypass the cache — what a report page's Refresh button asks for. */
    force?: boolean;
  } = {},
): Promise<EApprovalAnalyticsData> {
  const requestLimit = options.requestLimit ?? 2000;
  const stepLimit = options.stepLimit ?? 8000;
  const eventLimit = options.eventLimit ?? 8000;

  // Keyed on the caps as well as the organisation, so a caller asking for a narrower slice is never
  // handed a wider one that happens to be in the cache under the same organisation.
  return cachedRead(
    `analytics:${organizationId ?? ''}:${requestLimit}:${stepLimit}:${eventLimit}:${options.includeEvents === false ? 'norefs' : 'events'}`,
    () => fetchEApprovalAnalyticsData({ organizationId, requestLimit, stepLimit, eventLimit, includeEvents: options.includeEvents }),
    { ttlMs: E_APPROVAL_ANALYTICS_TTL_MS, force: options.force },
  );
}

/** The uncached body of `loadEApprovalAnalyticsData`. */
async function fetchEApprovalAnalyticsData(options: {
  organizationId?: string;
  requestLimit: number;
  stepLimit: number;
  eventLimit: number;
  includeEvents?: boolean;
}): Promise<EApprovalAnalyticsData> {
  const { organizationId, requestLimit, stepLimit, eventLimit } = options;

  const [requestSnap, stepSnap, eventSnap] = await Promise.all([
    getDocs(
      query(
        collection(db, E_APPROVAL_COLLECTIONS.requests),
        ...scopeQuery(organizationId),
        orderBy('createdAt', 'desc'),
        fsLimit(requestLimit),
      ),
    ),
    getDocs(query(collection(db, E_APPROVAL_COLLECTIONS.steps), ...scopeQuery(organizationId), fsLimit(stepLimit))),
    options.includeEvents === false
      ? Promise.resolve(null)
      : getDocs(
          query(collection(db, E_APPROVAL_COLLECTIONS.history), ...scopeQuery(organizationId), fsLimit(eventLimit)),
        ),
  ]);

  const requests = mapDocs<EApprovalRequest>(requestSnap.docs).filter((row) => row.isDeleted !== true);
  // Steps and events are scoped to the requests actually loaded, so a rollup can never count a step
  // whose parent request fell outside the window and thus is not in any denominator.
  const requestIds = new Set(requests.map((row) => row.id));
  const steps = mapDocs<EApprovalStep>(stepSnap.docs).filter((step) => requestIds.has(step.approvalId));
  const events = eventSnap
    ? mapDocs<EApprovalHistoryEntry>(eventSnap.docs).filter((event) => requestIds.has(event.approvalId))
    : [];

  return {
    requests,
    steps,
    events,
    loadedAt: nowIso(),
    truncated:
      requestSnap.size >= requestLimit || stepSnap.size >= stepLimit || (eventSnap?.size ?? 0) >= eventLimit,
  };
}

/* ------------------------------------------------------------------------------------------------
 * Recall and reverse
 * ---------------------------------------------------------------------------------------------- */

/** One history entry, judged for undoability against the live rules. */
export interface EApprovalUndoOption {
  entry: EApprovalHistoryEntry;
  recall: EApprovalUndoEligibility;
  reverse: EApprovalUndoEligibility;
}

/**
 * Whether the given history entry can be taken back, and by which power.
 *
 * Returns both verdicts rather than one, because the screen has to explain the difference: the same
 * entry is often recallable by its author for another eight minutes *and* reversible by a supervisor
 * for another twenty hours, and collapsing that into a single boolean is what makes an undo button
 * feel arbitrary.
 */
export async function evaluateEApprovalUndo(
  approvalId: string,
  entry: EApprovalHistoryEntry,
  actor: EApprovalServiceActor,
  options: { canReverse: boolean; history?: EApprovalHistoryEntry[]; settings?: EApprovalSettingsRecord },
): Promise<EApprovalUndoOption> {
  const who = requireActor(actor);
  const [settings, engineActor] = await Promise.all([
    options.settings ? Promise.resolve(options.settings) : loadEApprovalSettings(who.organizationId),
    loadEApprovalActorContext(who),
  ]);
  const history: EApprovalHistoryEntry[] =
    options.history ??
    (await getDocs(
      query(collection(db, E_APPROVAL_COLLECTIONS.history), where('approvalId', '==', approvalId)),
    ).then((snapshot) => mapDocs<EApprovalHistoryEntry>(snapshot.docs)));

  const { isLatestAction, alreadyUndone } = eApprovalUndoState(
    history.map((row) => ({ eventId: row.id, at: row.at, kind: row.kind, undo: row.undo, undidEventId: row.undidEventId })),
    entry.id,
  );

  if (alreadyUndone) {
    const done = { allowed: false, reason: 'This action has already been undone.' };
    return { entry, recall: done, reverse: done };
  }

  const candidate = {
    eventId: entry.id,
    at: entry.at,
    actorId: entry.actorId,
    actorName: entry.actorName,
    kind: entry.kind,
    summary: entry.summary,
    undo: entry.undo,
  };
  return {
    entry,
    recall: canRecallEApprovalAction(candidate, engineActor, { settings, isLatestAction }),
    reverse: canReverseEApprovalAction(candidate, engineActor, {
      settings,
      isLatestAction,
      hasPermission: options.canReverse,
    }),
  };
}

/**
 * Takes an action back, restoring the file to the state the snapshot on the history entry records.
 *
 * Eligibility is re-checked here rather than trusted from the UI: the recall window may well have
 * closed between the button rendering and the tap, and a client that decides its own permissions is
 * not a permission.
 */
export async function undoEApprovalAction(
  approvalId: string,
  historyEntryId: string,
  input: { kind: 'Recall' | 'Reverse'; reason?: string; canReverse?: boolean },
  actor: EApprovalServiceActor,
): Promise<void> {
  const who = requireActor(actor);
  const [request, steps, settings, engineActor, history] = await Promise.all([
    getEApprovalRequest(approvalId),
    listEApprovalSteps(approvalId),
    loadEApprovalSettings(who.organizationId),
    loadEApprovalActorContext(who),
    getDocs(query(collection(db, E_APPROVAL_COLLECTIONS.history), where('approvalId', '==', approvalId))).then(
      (snapshot) => mapDocs<EApprovalHistoryEntry>(snapshot.docs),
    ),
  ]);
  if (!request) throw new EApprovalServiceError('This approval no longer exists.');

  const entry = history.find((row) => row.id === historyEntryId);
  if (!entry) throw new EApprovalServiceError('That history entry no longer exists.');

  const verdict = await evaluateEApprovalUndo(approvalId, entry, who, {
    canReverse: input.canReverse ?? false,
    history,
    settings,
  });
  const eligibility = input.kind === 'Recall' ? verdict.recall : verdict.reverse;
  if (!eligibility.allowed) {
    throw new EApprovalServiceError(eligibility.reason || 'This action can no longer be undone.');
  }

  await commitEApprovalTransition({
    request,
    steps,
    actor: who,
    settings,
    input: {
      kind: input.kind,
      actor: engineActor,
      undo: entry.undo,
      undidEventId: entry.id,
      reason: input.reason,
      now: nowIso(),
      nextId: firestoreIdFactory(),
      settings,
    },
    activityAction: input.kind,
  });
}

/** `subject=x|amount=1` → `{ subject: 'x', amount: '1' }`, for comparing against a stored print. */
const parseFingerprint = (fingerprint?: string): Record<string, string> =>
  Object.fromEntries(
    String(fingerprint || '')
      .split('|')
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');
        return [part.slice(0, index), part.slice(index + 1)];
      }),
  );

const fieldFromFingerprint = (fingerprint: string | undefined, field: string): string | undefined =>
  parseFingerprint(fingerprint)[field];

/** Which material fields differ between two fingerprints. */
const fingerprintDifference = (before: string, after: string, fields: string[]): string[] => {
  const left = parseFingerprint(before);
  const right = parseFingerprint(after);
  return fields.filter((field) => (left[field] ?? '') !== (right[field] ?? ''));
};

/* ------------------------------------------------------------------------------------------------
 * Persisting a transition
 * ---------------------------------------------------------------------------------------------- */

interface CommitTransitionParams {
  request: EApprovalRequest;
  steps: EApprovalStep[];
  actor: EApprovalServiceActor;
  settings: EApprovalSettingsRecord;
  input: EApprovalActionInput;
  extraRequestFields?: Record<string, unknown>;
  versionSnapshot?: { version: number; snapshot: EApprovalMaterialSnapshot; fingerprint: string };
  activityAction: string;
}

/**
 * Runs the engine and writes the result in one batch.
 *
 * One batch, because a transition that updated the steps but not the request — or wrote the request
 * without its history entry — is a file in a state no screen can explain. Notifications and the
 * activity log are sent *after* the commit: a failed notification must not roll back an approval, and
 * an approval that committed without its notification is recoverable (the file is still in the
 * assignee's inbox) in a way the reverse is not.
 */
async function commitEApprovalTransition(params: CommitTransitionParams): Promise<void> {
  const { request, steps, actor, input, extraRequestFields, versionSnapshot, activityAction } = params;

  const state: EApprovalRequestState = {
    id: request.id,
    referenceNo: request.referenceNo,
    subject: request.subject,
    status: request.status,
    version: request.version ?? 1,
    requesterId: request.requesterId,
    requesterName: request.requesterName,
    departmentId: request.departmentId,
    departmentName: request.departmentName,
    projectId: request.projectId,
    approvalTypeId: request.approvalTypeId,
    priority: request.priority,
    amount: request.amount,
    approvedAmount: request.approvedAmount,
    confidential: request.confidential,
    ccUserIds: request.ccUserIds,
    ccDepartmentIds: request.ccDepartmentIds,
    participantUserIds: request.participantUserIds,
    currentStepIds: request.currentStepIds,
    currentAssigneeIds: request.currentAssigneeIds,
    currentDepartmentIds: request.currentDepartmentIds,
    currentRoles: request.currentRoles,
    pendingLabel: request.pendingLabel,
    currentDueAt: request.currentDueAt,
    requiredBy: request.requiredBy,
    submittedAt: request.submittedAt,
    completedAt: request.completedAt,
    returnResumeStepId: request.returnResumeStepId,
    returnedByStepId: request.returnedByStepId,
    returnReason: request.returnReason,
    materialFingerprint: request.materialFingerprint,
    supersededCount: request.supersededCount,
    holdReason: request.holdReason,
    rejectionReason: request.rejectionReason,
    cancelReason: request.cancelReason,
  };

  const transition = applyEApprovalAction(state, steps as EApprovalStepRecord[], input);

  const batch = writeBatch(db);
  const previousById = new Map(steps.map((step) => [step.id, step]));
  const activeStep = transition.steps.find((step) => step.status === 'Active');

  // A recall removes the steps its action created, so a step can legitimately disappear from the
  // transition. Deleting it rather than leaving it behind is the difference between "that request was
  // withdrawn" and a cancelled step sitting in somebody's history for a dispatch that was taken back
  // within two minutes.
  const survivingIds = new Set(transition.steps.map((step) => step.id));
  steps.forEach((step) => {
    if (!survivingIds.has(step.id)) batch.delete(doc(db, E_APPROVAL_COLLECTIONS.steps, step.id));
  });

  transition.steps.forEach((step) => {
    const previous = previousById.get(step.id);
    if (previous && JSON.stringify(stripAudit(previous)) === JSON.stringify(step)) return;
    batch.set(
      doc(db, E_APPROVAL_COLLECTIONS.steps, step.id),
      pruneUndefined({
        ...step,
        approvalId: request.id,
        organizationId: actor.organizationId ?? null,
        referenceNo: transition.request.referenceNo ?? request.referenceNo ?? null,
        subject: request.subject,
        requesterId: request.requesterId,
        priority: transition.request.priority,
        amount: request.amount ?? null,
        ...(previous ? withUpdateAudit(actor) : withCreateAudit(actor)),
      } as Record<string, unknown>),
      { merge: true },
    );
  });

  batch.set(
    doc(db, E_APPROVAL_COLLECTIONS.requests, request.id),
    pruneUndefined({
      status: transition.request.status,
      version: transition.request.version,
      // `?? null` rather than left out entirely: a material-change resubmission clears this by
      // setting it to `undefined`, and the merge write below must carry that null through, or the
      // old figure survives in Firestore untouched.
      approvedAmount: transition.request.approvedAmount ?? null,
      currentStepIds: transition.request.currentStepIds ?? [],
      currentAssigneeIds: transition.request.currentAssigneeIds ?? [],
      currentDepartmentIds: transition.request.currentDepartmentIds ?? [],
      currentRoles: transition.request.currentRoles ?? [],
      currentStepType: activeStep?.type ?? null,
      currentStepName: activeStep?.name ?? null,
      currentDueAt: transition.request.currentDueAt ?? null,
      pendingLabel: transition.request.pendingLabel ?? null,
      participantUserIds: transition.request.participantUserIds ?? [],
      submittedAt: transition.request.submittedAt ?? null,
      completedAt: transition.request.completedAt ?? null,
      returnResumeStepId: transition.request.returnResumeStepId ?? null,
      returnedByStepId: transition.request.returnedByStepId ?? null,
      returnReason: transition.request.returnReason ?? null,
      holdReason: transition.request.holdReason ?? null,
      rejectionReason: transition.request.rejectionReason ?? null,
      cancelReason: transition.request.cancelReason ?? null,
      supersededCount: transition.request.supersededCount ?? 0,
      ...(extraRequestFields || {}),
      ...withUpdateAudit(actor),
    } as Record<string, unknown>),
    { merge: true },
  );

  transition.events.forEach((event) => {
    batch.set(doc(collection(db, E_APPROVAL_COLLECTIONS.history)), {
      ...pruneUndefined(event as unknown as Record<string, unknown>),
      approvalId: request.id,
      organizationId: actor.organizationId ?? null,
      // Denormalised so a person's own activity log (every action they have taken, across every
      // approval) is one query rather than one read per approval a matching entry belongs to — the
      // same reasoning `referenceNo`/`subject` are copied onto each step a few lines above.
      referenceNo: transition.request.referenceNo ?? request.referenceNo ?? null,
      subject: request.subject ?? null,
      requesterId: request.requesterId ?? null,
      requesterName: request.requesterName ?? null,
      departmentName: request.departmentName ?? null,
      recordedAt: serverTimestamp(),
    });
  });

  if (versionSnapshot) {
    batch.set(doc(collection(db, E_APPROVAL_COLLECTIONS.versions)), {
      approvalId: request.id,
      organizationId: actor.organizationId ?? null,
      version: versionSnapshot.version,
      snapshot: pruneUndefined(versionSnapshot.snapshot as Record<string, unknown>),
      fingerprint: versionSnapshot.fingerprint,
      supersededAt: nowIso(),
      supersededReason: transition.events.find((event) => event.kind === 'Superseded')?.reason ?? null,
      approvals: steps
        .filter((step) => step.outcome && step.actedByUserId)
        .map((step) => ({
          stepName: step.name,
          assignee: step.actedByName || step.actedByUserId || '',
          outcome: String(step.outcome),
          at: step.completedAt ?? null,
        })),
      ...withCreateAudit(actor),
    });
  }

  await batch.commit();

  await Promise.all([
    deliverEApprovalNotifications(transition.notifications, transition.request.referenceNo || request.referenceNo, request.id),
    logEApprovalActivity(
      actor,
      activityAction,
      {
        status: transition.request.status,
        pendingWith: transition.request.pendingLabel,
        version: transition.request.version,
      },
      { recordId: request.id, recordRef: transition.request.referenceNo || request.referenceNo },
    ),
  ]);
}

/** Audit stamps are written by this service, not produced by the engine; ignore them when diffing. */
const stripAudit = (step: EApprovalStep): Record<string, unknown> => {
  const {
    createdAt,
    createdBy,
    createdByName,
    updatedAt,
    updatedBy,
    updatedByName,
    approvalId,
    organizationId,
    referenceNo,
    subject,
    requesterId,
    priority,
    amount,
    ...rest
  } = step;
  return rest;
};

/**
 * Delivers the engine's notification intents through the central notification system.
 *
 * Department targets are resolved to concrete users here rather than in the engine, because
 * membership is a Firestore read — and resolved at delivery time rather than stored, so a notification
 * reflects who was in the department when the event happened.
 */
async function deliverEApprovalNotifications(
  intents: EApprovalNotificationIntent[],
  referenceNo: string | undefined,
  approvalId: string,
): Promise<void> {
  // In parallel, not one intent at a time. A single transition routinely produces three or four
  // intents — the new assignee, the requester, a CC list, an escalation — and each carries its own
  // membership resolution and dispatch. Run serially they add up in front of the approver, who is
  // waiting on this before their screen refreshes; they are independent of one another, so nothing
  // is gained by making the second wait for the first.
  await Promise.all(
    intents.map(async (intent) => {
      const [departmentUserIds, projectUserIds] = await Promise.all([
        resolveDepartmentUserIds(intent.departmentIds ?? []),
        resolveProjectUserIds(intent.projectIds ?? []),
      ]);
      const userIds = Array.from(
        new Set([...(intent.userIds ?? []), ...departmentUserIds, ...projectUserIds]),
      ).filter(Boolean);
      if (!userIds.length && !intent.roles?.length) return;
      await dispatchNotification(
        { userIds, roles: intent.roles },
        {
          // 'Moved' is the requester being kept informed, not somebody being asked to act, so it does
          // not carry the type the bell renders as a call to action.
          type: intent.kind === 'Moved' ? 'record_assigned' : 'approval_required',
          title: intent.title,
          body: intent.body,
          module: ACTIVITY_MODULES.E_APPROVAL,
          severity: intent.severity ?? 'INFO',
          itemId: approvalId,
          itemRef: referenceNo,
          link: `${E_APPROVAL_BASE_PATH}/${approvalId}`,
        },
      );
    }),
  );
}

async function logEApprovalActivity(
  actor: EApprovalServiceActor,
  action: string,
  details: Record<string, unknown> = {},
  target: { recordId?: string; recordRef?: string } = {},
): Promise<void> {
  await logUserActivity({
    userId: actor.userId,
    userName: actor.userName,
    userEmail: actor.userEmail ?? undefined,
    module: E_APPROVAL_ACTIVITY_MODULE,
    action,
    details,
    recordId: target.recordId,
    recordRef: target.recordRef,
    sessionId: typeof window !== 'undefined' ? (localStorage.getItem('sessionId') ?? undefined) : undefined,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
  });
}

/* ------------------------------------------------------------------------------------------------
 * Comments (spec section 7)
 * ---------------------------------------------------------------------------------------------- */

export async function addEApprovalComment(
  approvalId: string,
  input: {
    body: string;
    stepId?: string | null;
    stepName?: string;
    parentCommentId?: string | null;
    mentionUserIds?: string[];
    attachmentIds?: string[];
  },
  actor: EApprovalServiceActor,
): Promise<string> {
  const who = requireActor(actor);
  if (!input.body?.trim()) throw new EApprovalServiceError('Write something first.');
  const request = await getEApprovalRequest(approvalId);
  if (!request) throw new EApprovalServiceError('This approval no longer exists.');

  const created = await addDoc(
    collection(db, E_APPROVAL_COLLECTIONS.comments),
    pruneUndefined({
      approvalId,
      organizationId: who.organizationId,
      stepId: input.stepId ?? null,
      stepName: input.stepName ?? null,
      parentCommentId: input.parentCommentId ?? null,
      body: input.body.trim(),
      mentionUserIds: input.mentionUserIds ?? [],
      attachmentIds: input.attachmentIds ?? [],
      authorId: who.userId,
      authorName: who.userName,
      authorDesignation: who.designation,
      version: request.version,
      editHistory: [],
      ...withCreateAudit(who),
    } as Record<string, unknown>),
  );

  await updateDoc(doc(db, E_APPROVAL_COLLECTIONS.requests, approvalId), {
    commentCount: (request.commentCount ?? 0) + 1,
    ...withUpdateAudit(who),
  });

  // Everyone with a stake hears about a comment; @-mentions additionally get a direct one, so being
  // named is louder than the thread's own traffic.
  const stakeholders = Array.from(
    new Set(
      [
        request.requesterId,
        ...(request.currentAssigneeIds ?? []),
        ...(request.participantUserIds ?? []),
        ...(request.ccUserIds ?? []),
      ].filter((userId) => userId && userId !== who.userId) as string[],
    ),
  );
  await Promise.all([
    stakeholders.length
      ? dispatchNotification(
          { userIds: stakeholders },
          {
            type: 'approval_required',
            title: 'New comment on an approval',
            body: `${who.userName} commented on ${request.referenceNo || request.subject}.`,
            module: E_APPROVAL_ACTIVITY_MODULE,
            itemId: approvalId,
            itemRef: request.referenceNo,
            link: `${E_APPROVAL_BASE_PATH}/${approvalId}`,
          },
        )
      : Promise.resolve(0),
    input.mentionUserIds?.length
      ? dispatchNotification(
          { userIds: input.mentionUserIds.filter((userId) => userId !== who.userId) },
          {
            type: 'approval_required',
            title: 'You were mentioned',
            body: `${who.userName} mentioned you on ${request.referenceNo || request.subject}.`,
            module: E_APPROVAL_ACTIVITY_MODULE,
            severity: 'WARNING',
            itemId: approvalId,
            itemRef: request.referenceNo,
            link: `${E_APPROVAL_BASE_PATH}/${approvalId}`,
          },
        )
      : Promise.resolve(0),
    logEApprovalActivity(who, 'Comment', {}, { recordId: approvalId, recordRef: request.referenceNo }),
  ]);
  return created.id;
}

/**
 * Edits a comment by appending to its history.
 *
 * The previous text is kept and the comment is marked edited (spec section 7). Only the author, and
 * only their own comment: an approval thread whose entries can be rewritten by somebody else is not
 * evidence of anything.
 */
export async function editEApprovalComment(
  commentId: string,
  body: string,
  actor: EApprovalServiceActor,
): Promise<void> {
  const who = requireActor(actor);
  if (!body?.trim()) throw new EApprovalServiceError('Write something first.');
  const snapshot = await getDoc(doc(db, E_APPROVAL_COLLECTIONS.comments, commentId));
  if (!snapshot.exists()) throw new EApprovalServiceError('This comment no longer exists.');
  const comment = snapshot.data() as EApprovalComment;
  if (comment.authorId !== who.userId) throw new EApprovalServiceError('Only the author can edit a comment.');
  await updateDoc(doc(db, E_APPROVAL_COLLECTIONS.comments, commentId), {
    body: body.trim(),
    editHistory: [
      ...(comment.editHistory ?? []),
      { at: nowIso(), byUserId: who.userId, byName: who.userName, previousBody: comment.body },
    ],
    ...withUpdateAudit(who),
  });
  await logEApprovalActivity(who, 'Edit Comment', {}, { recordId: comment.approvalId });
}

/** Retracts rather than deletes — the entry stays, struck through, with its reason. */
export async function retractEApprovalComment(
  commentId: string,
  reason: string,
  actor: EApprovalServiceActor,
): Promise<void> {
  const who = requireActor(actor);
  const snapshot = await getDoc(doc(db, E_APPROVAL_COLLECTIONS.comments, commentId));
  if (!snapshot.exists()) return;
  const comment = snapshot.data() as EApprovalComment;
  if (comment.authorId !== who.userId) throw new EApprovalServiceError('Only the author can retract a comment.');
  await updateDoc(doc(db, E_APPROVAL_COLLECTIONS.comments, commentId), {
    retracted: true,
    retractedReason: reason || null,
    ...withUpdateAudit(who),
  });
  await logEApprovalActivity(who, 'Retract Comment', { reason }, { recordId: comment.approvalId });
}

/* ------------------------------------------------------------------------------------------------
 * Attachments (spec section 8)
 * ---------------------------------------------------------------------------------------------- */

/**
 * Uploads a file and records it against the step it was added at.
 *
 * The storage path carries the request version, so a revised quotation lands beside the original
 * rather than on top of it — "never overwrite the original file" is the whole point of section 8.
 * Storage is imported dynamically for the reason `firebase-storage.ts` documents: only a handful of
 * screens upload, and the SDK should stay out of the app shell's bundle.
 */
export async function uploadEApprovalAttachment(
  approvalId: string,
  file: File,
  actor: EApprovalServiceActor,
  options: { stepId?: string | null; stepName?: string; description?: string; supersedesAttachmentId?: string } = {},
): Promise<EApprovalAttachment> {
  const who = requireActor(actor);
  const request = await getEApprovalRequest(approvalId);
  if (!request) throw new EApprovalServiceError('This approval no longer exists.');

  const [{ storage }, { getDownloadURL, ref, uploadBytes }] = await Promise.all([
    import('@/lib/firebase-storage'),
    import('firebase/storage'),
  ]);
  const safeName = file.name.replace(/[^\w.\-() ]+/g, '_');
  const storagePath = `${E_APPROVAL_STORAGE_PREFIX}/${approvalId}/v${request.version}/${Date.now()}-${safeName}`;
  const storageRef = ref(storage, storagePath);
  await uploadBytes(storageRef, file, { contentType: file.type || 'application/octet-stream' });
  const url = await getDownloadURL(storageRef);

  const record = pruneUndefined({
    approvalId,
    organizationId: who.organizationId,
    name: file.name,
    url,
    storagePath,
    contentType: file.type || null,
    size: file.size,
    stepId: options.stepId ?? null,
    stepName: options.stepName ?? null,
    version: request.version,
    description: options.description ?? null,
    supersedesAttachmentId: options.supersedesAttachmentId ?? null,
    uploadedById: who.userId,
    uploadedByName: who.userName,
    uploadedAt: nowIso(),
    ...withCreateAudit(who),
  } as Record<string, unknown>);

  const created = await addDoc(collection(db, E_APPROVAL_COLLECTIONS.attachments), record);
  await updateDoc(doc(db, E_APPROVAL_COLLECTIONS.requests, approvalId), {
    attachmentCount: (request.attachmentCount ?? 0) + 1,
    ...withUpdateAudit(who),
  });
  await logEApprovalActivity(who, 'Upload Attachment', { name: file.name }, {
    recordId: approvalId,
    recordRef: request.referenceNo,
  });
  return { id: created.id, ...(record as unknown as Omit<EApprovalAttachment, 'id'>) };
}

/* ------------------------------------------------------------------------------------------------
 * Signatures — a saved image, burned into an uploaded PDF on request
 * ---------------------------------------------------------------------------------------------- */

/** The signed-in user's saved signature, or null if they have never saved one. */
export async function loadEApprovalSignature(
  userId: string,
): Promise<EApprovalSignatureRecord | null> {
  const snapshot = await getDoc(doc(db, E_APPROVAL_COLLECTIONS.signatures, userId));
  if (!snapshot.exists()) return null;
  return { id: snapshot.id, ...(snapshot.data() as Omit<EApprovalSignatureRecord, 'id'>) };
}

/**
 * Saves (or replaces) the actor's signature image, one per user.
 *
 * Overwriting is correct here in a way it is not for an approval attachment: a signature is a
 * personal setting, not part of any approval's record, so there is nothing that needs a version kept
 * of the old one. A document already signed keeps the copy that was burned into it at the time —
 * changing your saved signature tomorrow does not reach back and alter what you signed yesterday.
 */
export async function saveEApprovalSignature(
  imageBlob: Blob,
  dimensions: { width: number; height: number },
  actor: EApprovalServiceActor,
): Promise<EApprovalSignatureRecord> {
  const who = requireActor(actor);
  const [{ storage }, { getDownloadURL, ref, uploadBytes }] = await Promise.all([
    import('@/lib/firebase-storage'),
    import('firebase/storage'),
  ]);
  const storagePath = `${E_APPROVAL_STORAGE_PREFIX}/signatures/${who.userId}.png`;
  const storageRef = ref(storage, storagePath);
  await uploadBytes(storageRef, imageBlob, { contentType: 'image/png' });
  // Cache-bust the URL so a browser that already fetched the old signature (e.g. the sign dialog,
  // left open across a re-save) does not silently keep using it from HTTP cache.
  const url = `${await getDownloadURL(storageRef)}&_v=${Date.now()}`;

  const existing = await loadEApprovalSignature(who.userId);
  const record = pruneUndefined({
    organizationId: who.organizationId,
    url,
    storagePath,
    width: dimensions.width,
    height: dimensions.height,
    ...(existing ? withUpdateAudit(who) : withCreateAudit(who)),
  } as Record<string, unknown>);
  await setDoc(doc(db, E_APPROVAL_COLLECTIONS.signatures, who.userId), record, { merge: true });
  return { id: who.userId, ...(record as unknown as Omit<EApprovalSignatureRecord, 'id'>) };
}

/**
 * Routes a Firebase Storage download URL through this app's own server instead of fetching it
 * directly from the browser.
 *
 * A plain `fetch(storageUrl)` from client code fails with "Failed to fetch" — Firebase Storage's
 * download host does not send the browser a permissive `Access-Control-Allow-Origin` for a
 * script-initiated request, only for a full navigation (an `<a href>` click, an `<img src>`). See
 * `src/app/api/e-approval/fetch-attachment/route.ts` for what actually fetches the bytes and why a
 * proxy, rather than bucket CORS configuration, is the fix here.
 */
export const proxiedEApprovalFileUrl = (url: string): string =>
  `/api/e-approval/fetch-attachment?url=${encodeURIComponent(url)}`;

export interface SignEApprovalAttachmentOptions {
  /** 0-based. */
  pageIndex: number;
  position: EApprovalSignaturePosition;
  widthPct: number;
  offsetX?: number;
  offsetY?: number;
}

/**
 * Signs one PDF attachment: fetches its bytes and the actor's saved signature, burns the signature
 * in at the chosen spot, and uploads the result as a *new* attachment pointing back at the original
 * via `signedFromAttachmentId` — the original is never touched, the rule every attachment in this
 * module already follows for a revised quotation or a corrected drawing.
 */
export async function signEApprovalAttachment(
  approvalId: string,
  attachment: EApprovalAttachment,
  options: SignEApprovalAttachmentOptions,
  actor: EApprovalServiceActor,
): Promise<EApprovalAttachment> {
  const who = requireActor(actor);
  const signature = await loadEApprovalSignature(who.userId);
  if (!signature) {
    throw new EApprovalServiceError('Save a signature first — draw one or upload an image of it.');
  }
  const request = await getEApprovalRequest(approvalId);
  if (!request) throw new EApprovalServiceError('This approval no longer exists.');
  // Checked here and not only in the UI: this is the single write path, so it is the only place the
  // rule cannot be got around. A signature landing on a document after the file was decided is
  // precisely what the trail exists to make impossible.
  if (!canSignEApprovalDocument(request)) {
    throw new EApprovalServiceError(
      `This approval is ${request.status.toLowerCase()} — its documents can no longer be signed.`,
    );
  }

  const [{ embedEApprovalSignatureIntoPdf }, pdfResponse, signatureResponse] = await Promise.all([
    import('@/lib/e-approval-pdf-signing'),
    fetch(proxiedEApprovalFileUrl(attachment.url)),
    fetch(proxiedEApprovalFileUrl(signature.url)),
  ]);
  if (!pdfResponse.ok) throw new EApprovalServiceError('Could not read the original document to sign it.');
  if (!signatureResponse.ok) throw new EApprovalServiceError('Could not read your saved signature.');

  const signedBytes = await embedEApprovalSignatureIntoPdf(
    await pdfResponse.arrayBuffer(),
    await signatureResponse.arrayBuffer(),
    options,
  );

  const [{ storage }, { getDownloadURL, ref, uploadBytes }] = await Promise.all([
    import('@/lib/firebase-storage'),
    import('firebase/storage'),
  ]);
  const signedName = `${attachment.name.replace(/\.pdf$/i, '')} (signed).pdf`;
  const safeName = signedName.replace(/[^\w.\-() ]+/g, '_');
  const storagePath = `${E_APPROVAL_STORAGE_PREFIX}/${approvalId}/v${request.version}/${Date.now()}-${safeName}`;
  const storageRef = ref(storage, storagePath);
  // `signedBytes` is a plain Uint8Array; Blob needs an ArrayBuffer-backed view to construct from.
  const signedBlob = new Blob([signedBytes as BlobPart], { type: 'application/pdf' });
  await uploadBytes(storageRef, signedBlob, { contentType: 'application/pdf' });
  const url = await getDownloadURL(storageRef);

  const record = pruneUndefined({
    approvalId,
    organizationId: who.organizationId,
    name: signedName,
    url,
    storagePath,
    contentType: 'application/pdf',
    size: signedBlob.size,
    stepId: null,
    stepName: null,
    version: request.version,
    description: `Signed copy of "${attachment.name}"`,
    signedFromAttachmentId: attachment.id,
    signedByUserId: who.userId,
    signedByName: who.userName,
    signedAt: nowIso(),
    signedPage: options.pageIndex + 1,
    uploadedById: who.userId,
    uploadedByName: who.userName,
    uploadedAt: nowIso(),
    ...withCreateAudit(who),
  } as Record<string, unknown>);

  const created = await addDoc(collection(db, E_APPROVAL_COLLECTIONS.attachments), record);
  await updateDoc(doc(db, E_APPROVAL_COLLECTIONS.requests, approvalId), {
    attachmentCount: (request.attachmentCount ?? 0) + 1,
    ...withUpdateAudit(who),
  });
  await logEApprovalActivity(
    who,
    'Sign Attachment',
    { name: attachment.name, page: options.pageIndex + 1 },
    { recordId: approvalId, recordRef: request.referenceNo },
  );
  return { id: created.id, ...(record as unknown as Omit<EApprovalAttachment, 'id'>) };
}

/* ------------------------------------------------------------------------------------------------
 * Reminders and escalation (spec section 22)
 * ---------------------------------------------------------------------------------------------- */

export interface EApprovalEscalationResult {
  requestsChecked: number;
  notificationsSent: number;
  escalationsRaised: number;
}

/**
 * Fires the ladder rules that have come due, and records that they fired.
 *
 * Idempotent by design — `escalationsSent` on each step is the record — so this is safe to call from
 * a cron, from a page load, or twice by accident. Recording the send *before* dispatching would risk
 * a silent miss; dispatching first risks a duplicate. A duplicate reminder is the better failure, so
 * the notification goes first.
 */
export async function runEApprovalEscalations(
  actor: EApprovalServiceActor,
  options: { limit?: number } = {},
): Promise<EApprovalEscalationResult> {
  const who = requireActor(actor);
  const settings = await loadEApprovalSettings(who.organizationId);

  const open = await listEApprovals({
    organizationId: who.organizationId,
    statuses: ['Pending Approval', 'Pending Verification', 'Pending Clarification', 'Partially Approved', 'Resubmitted'],
    limit: options.limit ?? 200,
  });

  const result: EApprovalEscalationResult = { requestsChecked: open.length, notificationsSent: 0, escalationsRaised: 0 };

  for (const request of open) {
    const steps = await listEApprovalSteps(request.id);
    const due = resolveDueEApprovalEscalations(
      steps as EApprovalStepRecord[],
      settings.escalationLadder,
      nowIso(),
      request.approvalTypeId,
    );
    if (!due.length) continue;

    for (const entry of due) {
      const step = steps.find((candidate) => candidate.id === entry.stepId);
      if (!step) continue;
      const extraTargets = await resolveDepartmentUserIds(
        (entry.rule.targets ?? []).map((target) => target.departmentId).filter(Boolean) as string[],
      );
      const recipients = new Set<string>([
        ...(step.assignment.kind === 'User' && step.assignment.userId ? [step.assignment.userId] : []),
        ...(step.ownedByUserId ? [step.ownedByUserId] : []),
        ...(step.delegatedToUserId ? [step.delegatedToUserId] : []),
        ...((entry.rule.targets ?? []).map((target) => target.userId).filter(Boolean) as string[]),
        ...extraTargets,
        ...(entry.rule.kind === 'Notify Requester' ? [request.requesterId] : []),
      ]);
      if (step.assignment.kind === 'Department' && step.assignment.departmentId) {
        (await resolveDepartmentUserIds([step.assignment.departmentId])).forEach((userId) => recipients.add(userId));
      }
      if (step.assignment.kind === 'Project' && step.assignment.projectId) {
        (await resolveProjectUserIds([step.assignment.projectId])).forEach((userId) => recipients.add(userId));
      }
      if (!recipients.size && !step.assignment.role) continue;

      const sent = await dispatchNotification(
        {
          userIds: Array.from(recipients),
          roles: step.assignment.kind === 'Role' && step.assignment.role ? [step.assignment.role] : undefined,
        },
        {
          type: entry.rule.kind === 'Escalation' ? 'tat_escalation' : 'approval_required',
          title:
            entry.rule.kind === 'Escalation'
              ? 'Approval escalated — overdue'
              : entry.rule.kind === 'Notify Requester'
                ? 'Approval still pending'
                : 'Approval reminder',
          body: `${request.referenceNo || request.subject} has been pending at "${step.name}" for ${Math.round(
            entry.pendingHours,
          )}h.`,
          module: E_APPROVAL_ACTIVITY_MODULE,
          severity: entry.rule.kind === 'Reminder' ? 'INFO' : 'WARNING',
          itemId: request.id,
          itemRef: request.referenceNo,
          stepName: step.name,
          link: `${E_APPROVAL_BASE_PATH}/${request.id}`,
        },
      );
      result.notificationsSent += sent;
      if (entry.rule.kind === 'Escalation') result.escalationsRaised += 1;
    }

    const batch = writeBatch(db);
    const byStep = new Map<string, string[]>();
    due.forEach((entry) => {
      byStep.set(entry.stepId, [...(byStep.get(entry.stepId) ?? []), entry.rule.id]);
    });
    byStep.forEach((ruleIds, stepId) => {
      const step = steps.find((candidate) => candidate.id === stepId);
      batch.set(
        doc(db, E_APPROVAL_COLLECTIONS.steps, stepId),
        { escalationsSent: Array.from(new Set([...(step?.escalationsSent ?? []), ...ruleIds])) },
        { merge: true },
      );
      batch.set(doc(collection(db, E_APPROVAL_COLLECTIONS.history)), {
        approvalId: request.id,
        organizationId: who.organizationId ?? null,
        at: nowIso(),
        actorId: 'system',
        actorName: 'System',
        kind: 'Escalation Fired',
        stepId,
        stepName: step?.name ?? null,
        summary: `Reminder/escalation sent for "${step?.name ?? stepId}" (${ruleIds.join(', ')})`,
        recordedAt: serverTimestamp(),
      });
    });
    await batch.commit();
  }

  return result;
}

/* ------------------------------------------------------------------------------------------------
 * Convenience selectors used by more than one screen
 * ---------------------------------------------------------------------------------------------- */

export const OPEN_E_APPROVAL_STATUSES: EApprovalStatus[] = [
  'Submitted',
  'Pending Approval',
  'Pending Verification',
  'Pending Clarification',
  'Returned',
  'Resubmitted',
  'On Hold',
  'Partially Approved',
];

export const isEApprovalOpen = (status: EApprovalStatus) => isOpenEApprovalStatus(status);
export const isEApprovalClosed = (status: EApprovalStatus) => isTerminalEApprovalStatus(status);

/** SLA hours a step would get, for the create form's preview of the chain. */
export const previewEApprovalStepSla = (
  templateStep: EApprovalTemplateStep,
  priority: EApprovalPriority,
  settings: EApprovalSettingsRecord,
) => eApprovalStepSla(templateStep.slaHours, priority, settings);

export type { EApprovalEvent };

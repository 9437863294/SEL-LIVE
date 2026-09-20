'use client';

import {
  Timestamp,
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
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type QueryConstraint,
} from 'firebase/firestore';

import { db } from './firebase';
import { ACTIVITY_MODULES } from './activity-modules';
import { logUserActivity } from './activity-logger';
import {
  WINDOWS_AGENT_COLLECTIONS,
  WINDOWS_AGENT_SETTINGS_DOC_ID,
  windowsAgentIds,
} from './windows-agent';
import { sanitizePolicySettings } from './windows-agent-policy';
import type { ActivityScope } from './windows-agent-permissions';
import type {
  AppCategory,
  IsoDate,
  WindowsActivityEvent,
  WindowsAgentPolicy,
  WindowsAgentVersion,
  WindowsAppCatalogEntry,
  WindowsAuditLog,
  WindowsDailyActivity,
  WindowsDevice,
  WindowsEnrollmentCode,
  WindowsHeartbeat,
  WindowsNotification,
  WindowsNotificationReceipt,
  WindowsSession,
} from './windows-agent-model';

/**
 * The browser's read path for the Windows Agent module.
 *
 * Reads come straight from Firestore with the client SDK, the same way every other module's
 * screens read; writes that only an administrator makes (renaming a device, editing a policy) also
 * go directly, gated by the Firestore rules. What does *not* go through here is anything the
 * desktop agent causes — sessions, spans, heartbeats and receipts are written exclusively by
 * `/api/windows-agent/*` under the Admin SDK, and the rules make them read-only to every browser.
 *
 * ── Why the live board subscribes and the reports do not ───────────────────────────────────────
 *
 * §17's live board is the one screen whose value is that it is live, so it uses `onSnapshot` and
 * costs one listener per open tab. Everything else is a one-shot `getDocs` behind an explicit
 * refresh, because a department report over three hundred people re-running on every heartbeat
 * would be both useless and expensive — the numbers it shows change by the minute, not by the
 * second, and a manager reading a monthly total does not want it moving under them.
 *
 * ── Scope is applied to the query, not to the rows ─────────────────────────────────────────────
 *
 * Every function that lists other people's activity takes an `ActivityScope` and turns it into
 * `where` clauses. A department manager's query asks Firestore for their department; it does not
 * ask for everybody and filter afterwards. That is the difference between a permission and a
 * decoration — the rows they may not see never reach the browser.
 */

const col = (name: string) => collection(db, name);
const docIn = (name: string, id: string) => doc(db, name, id);

/** Firestore's `in` and `array-contains-any` cap. */
const IN_CLAUSE_LIMIT = 30;

/* ------------------------------------------------------------------------------------------------
 * Scope → query constraints
 * ---------------------------------------------------------------------------------------------- */

/**
 * Turn a viewer's scope into `where` clauses for a collection keyed by `userId`/`departmentId`.
 *
 * Returns null when the scope cannot be expressed as a single query — a team of more than thirty
 * people exceeds Firestore's `in` limit. Callers fall back to chunked queries rather than to an
 * unfiltered read, because an unfiltered read is precisely the thing the scope exists to prevent.
 */
export function scopeConstraints(scope: ActivityScope): QueryConstraint[] | null {
  switch (scope.kind) {
    case 'ALL':
      return [];
    case 'DEPARTMENT':
      if (!scope.departmentIds.length) return [where('userId', '==', scope.selfUserId)];
      if (scope.departmentIds.length > IN_CLAUSE_LIMIT) return null;
      return [where('departmentId', 'in', scope.departmentIds)];
    case 'TEAM':
      if (!scope.userIds.length) return [where('userId', '==', scope.selfUserId)];
      if (scope.userIds.length > IN_CLAUSE_LIMIT) return null;
      return [where('userId', 'in', scope.userIds)];
    case 'SELF':
      return [where('userId', '==', scope.userId)];
    default:
      return null;
  }
}

/** Split an array into Firestore-sized chunks for `in` queries. */
function chunk<T>(items: readonly T[], size = IN_CLAUSE_LIMIT): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

const readAll = <T,>(snapshot: { docs: { id: string; data: () => unknown }[] }): T[] =>
  snapshot.docs.map((entry) => ({ id: entry.id, ...(entry.data() as object) }) as T);

/* ------------------------------------------------------------------------------------------------
 * Devices (§34)
 * ---------------------------------------------------------------------------------------------- */

export function listenToDevices(onChange: (devices: WindowsDevice[]) => void): () => void {
  return onSnapshot(query(col(WINDOWS_AGENT_COLLECTIONS.devices), orderBy('deviceName')), (snapshot) => {
    onChange(readAll<WindowsDevice>(snapshot));
  });
}

export async function fetchDevices(): Promise<WindowsDevice[]> {
  const snapshot = await getDocs(query(col(WINDOWS_AGENT_COLLECTIONS.devices), orderBy('deviceName')));
  return readAll<WindowsDevice>(snapshot);
}

export async function fetchDevice(deviceId: string): Promise<WindowsDevice | null> {
  const snapshot = await getDoc(docIn(WINDOWS_AGENT_COLLECTIONS.devices, deviceId));
  return snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as WindowsDevice) : null;
}

export interface Actor {
  userId: string;
  userName: string;
}

/**
 * Write an administrative action to both trails.
 *
 * §50's own append-only collection, and the application-wide `userLogs` that every other module
 * writes to. Both, deliberately: the module's own trail is what the audit page reads and is
 * protected by rules that forbid edits, while `userLogs` is where somebody investigating "what did
 * this administrator do on Tuesday" looks across all of SEL LIVE, and a module absent from it is a
 * module whose actions are invisible to that question.
 */
async function recordAdminAction(
  actor: Actor,
  action: string,
  target: { type: string; id: string; label: string },
  values: { oldValue?: unknown; newValue?: unknown; reason?: string | null } = {},
): Promise<void> {
  const at = new Date().toISOString();
  await Promise.all([
    addDoc(col(WINDOWS_AGENT_COLLECTIONS.auditLogs), {
      action,
      actorId: actor.userId,
      actorName: actor.userName,
      targetType: target.type,
      targetId: target.id,
      targetLabel: target.label,
      oldValue: values.oldValue ?? null,
      newValue: values.newValue ?? null,
      reason: values.reason ?? null,
      ipAddress: null,
      userAgent: typeof navigator === 'undefined' ? null : navigator.userAgent,
      at,
      createdAt: serverTimestamp(),
    }).catch((error) => {
      console.error('[windows-agent] Audit write failed:', error);
    }),
    logUserActivity({
      userId: actor.userId,
      userName: actor.userName,
      module: ACTIVITY_MODULES.WINDOWS_AGENT,
      action,
      details: { target, ...values },
      recordId: target.id,
      recordRef: target.label,
    }),
  ]);
}

export async function renameDevice(actor: Actor, device: WindowsDevice, deviceName: string): Promise<void> {
  const next = deviceName.trim().slice(0, 80);
  if (!next || next === device.deviceName) return;
  await updateDoc(docIn(WINDOWS_AGENT_COLLECTIONS.devices, device.id), {
    deviceName: next,
    updatedAt: serverTimestamp(),
    updatedBy: actor.userId,
    updatedByName: actor.userName,
  });
  await recordAdminAction(actor, 'DEVICE_RENAMED', { type: 'device', id: device.id, label: next },
    { oldValue: device.deviceName, newValue: next });
}

/**
 * Change a device's status.
 *
 * `BLOCKED` takes effect on the agent's next request rather than immediately — `authenticateDevice`
 * refuses a blocked device, so the PC stops being able to open a session, upload activity or fetch
 * notifications within one heartbeat. It does not lock anybody out of Windows; §3 is explicit that
 * this module must never be able to do that, and a monitoring agent that could would be a
 * fleet-wide outage waiting for a mis-click.
 */
export async function setDeviceStatus(
  actor: Actor,
  device: WindowsDevice,
  status: WindowsDevice['status'],
  reason: string | null,
): Promise<void> {
  const action =
    status === 'BLOCKED' ? 'DEVICE_BLOCKED'
    : status === 'RETIRED' ? 'DEVICE_RETIRED'
    : status === 'ACTIVE' && device.status === 'PENDING' ? 'DEVICE_APPROVED'
    : 'DEVICE_UNBLOCKED';

  await updateDoc(docIn(WINDOWS_AGENT_COLLECTIONS.devices, device.id), {
    status,
    statusReason: reason,
    statusChangedAt: new Date().toISOString(),
    statusChangedBy: actor.userId,
    updatedAt: serverTimestamp(),
    updatedBy: actor.userId,
    updatedByName: actor.userName,
  });

  await recordAdminAction(actor, action, { type: 'device', id: device.id, label: device.deviceName },
    { oldValue: device.status, newValue: status, reason });
}

/**
 * Ask the agent to sign the current user out, or to re-authenticate.
 *
 * Written as a timestamp rather than a boolean flag, and that is the whole mechanism: the heartbeat
 * turns it into a directive whose id embeds the instant, and the agent remembers which directive
 * ids it has obeyed. A boolean the server could not clear would sign the user out on every
 * heartbeat for ever; a timestamp is obeyed once and then ignored until it changes.
 */
export async function requestDeviceAction(
  actor: Actor,
  device: WindowsDevice,
  kind: 'FORCE_REAUTH' | 'FORCE_SIGNOUT',
  reason: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  await updateDoc(docIn(WINDOWS_AGENT_COLLECTIONS.devices, device.id), {
    [kind === 'FORCE_REAUTH' ? 'forceReauthAt' : 'forceSignOutAt']: now,
    statusReason: reason,
    updatedAt: serverTimestamp(),
    updatedBy: actor.userId,
    updatedByName: actor.userName,
  });
  await recordAdminAction(actor, kind, { type: 'device', id: device.id, label: device.deviceName },
    { newValue: now, reason });
}

export async function setDeviceAssignment(
  actor: Actor,
  device: WindowsDevice,
  assignedUserIds: string[],
): Promise<void> {
  await updateDoc(docIn(WINDOWS_AGENT_COLLECTIONS.devices, device.id), {
    assignedUserIds,
    updatedAt: serverTimestamp(),
    updatedBy: actor.userId,
    updatedByName: actor.userName,
  });
  await recordAdminAction(actor, 'ASSIGNMENT_ADDED', { type: 'device', id: device.id, label: device.deviceName },
    { oldValue: device.assignedUserIds ?? [], newValue: assignedUserIds });
}

export async function setDeviceUpdateRing(
  actor: Actor,
  device: WindowsDevice,
  updateRing: WindowsDevice['updateRing'],
): Promise<void> {
  await updateDoc(docIn(WINDOWS_AGENT_COLLECTIONS.devices, device.id), {
    updateRing,
    updatedAt: serverTimestamp(),
  });
  await recordAdminAction(actor, 'AGENT_UPDATE_TRIGGERED', { type: 'device', id: device.id, label: device.deviceName },
    { oldValue: device.updateRing, newValue: updateRing });
}

/* ------------------------------------------------------------------------------------------------
 * Heartbeats — the live board (§17)
 * ---------------------------------------------------------------------------------------------- */

export function listenToHeartbeats(onChange: (beats: WindowsHeartbeat[]) => void): () => void {
  return onSnapshot(col(WINDOWS_AGENT_COLLECTIONS.heartbeats), (snapshot) => {
    onChange(readAll<WindowsHeartbeat>(snapshot));
  });
}

export function listenToOpenSessions(onChange: (sessions: WindowsSession[]) => void): () => void {
  return onSnapshot(
    query(col(WINDOWS_AGENT_COLLECTIONS.sessions), where('status', '==', 'OPEN')),
    (snapshot) => onChange(readAll<WindowsSession>(snapshot)),
  );
}

/* ------------------------------------------------------------------------------------------------
 * Sessions and attendance
 * ---------------------------------------------------------------------------------------------- */

export interface SessionQuery {
  scope: ActivityScope;
  fromDate: IsoDate;
  toDate: IsoDate;
  userId?: string;
  deviceId?: string;
  max?: number;
}

/**
 * Sessions in a date range, narrowed to what the viewer may see.
 *
 * A `userId` or `deviceId` filter replaces the scope clause rather than adding to it, because
 * Firestore cannot combine an `in` on one field with an equality on another and an inequality on
 * `workDate` — the composite index does not exist and could not be built for every combination.
 * The narrower filter is still safe: `canViewActivityOf` is checked before the query is issued, so
 * a manager cannot ask for somebody outside their scope in the first place.
 */
export async function fetchSessions(options: SessionQuery): Promise<WindowsSession[]> {
  const base: QueryConstraint[] = [
    where('workDate', '>=', options.fromDate),
    where('workDate', '<=', options.toDate),
  ];

  if (options.userId) {
    return runSessionQuery([where('userId', '==', options.userId), ...base], options.max);
  }
  if (options.deviceId) {
    return runSessionQuery([where('deviceId', '==', options.deviceId), ...base], options.max);
  }

  const scoped = scopeConstraints(options.scope);
  if (scoped) return runSessionQuery([...scoped, ...base], options.max);

  // A scope too wide for one `in` clause: run it in chunks rather than dropping the filter.
  if (options.scope.kind === 'TEAM') {
    const groups = await Promise.all(
      chunk(options.scope.userIds).map((ids) =>
        runSessionQuery([where('userId', 'in', ids), ...base], options.max),
      ),
    );
    return groups.flat();
  }
  return [];
}

async function runSessionQuery(constraints: QueryConstraint[], max?: number): Promise<WindowsSession[]> {
  const snapshot = await getDocs(
    query(col(WINDOWS_AGENT_COLLECTIONS.sessions), ...constraints, orderBy('workDate', 'desc'),
      fsLimit(max ?? 500)),
  );
  return readAll<WindowsSession>(snapshot);
}

/**
 * The daily rollups a report reads (§32).
 *
 * Never the raw spans: §32 is explicit that a report must not recompute history on every page
 * load, and one document per person per day is what makes a month across a department a few
 * hundred reads rather than a few hundred thousand.
 */
export async function fetchDailyActivity(options: {
  scope: ActivityScope;
  fromDate: IsoDate;
  toDate: IsoDate;
  userId?: string;
  max?: number;
}): Promise<WindowsDailyActivity[]> {
  const base: QueryConstraint[] = [
    where('workDate', '>=', options.fromDate),
    where('workDate', '<=', options.toDate),
  ];

  const run = async (constraints: QueryConstraint[]) => {
    const snapshot = await getDocs(
      query(col(WINDOWS_AGENT_COLLECTIONS.dailyActivity), ...constraints,
        orderBy('workDate', 'desc'), fsLimit(options.max ?? 1000)),
    );
    return readAll<WindowsDailyActivity>(snapshot);
  };

  if (options.userId) return run([where('userId', '==', options.userId), ...base]);

  const scoped = scopeConstraints(options.scope);
  if (scoped) return run([...scoped, ...base]);

  if (options.scope.kind === 'TEAM') {
    const groups = await Promise.all(
      chunk(options.scope.userIds).map((ids) => run([where('userId', 'in', ids), ...base])),
    );
    return groups.flat();
  }
  return [];
}

/** One session's spans, for the §10 timeline. */
export async function fetchSessionActivity(sessionId: string, max = 2000): Promise<WindowsActivityEvent[]> {
  const snapshot = await getDocs(
    query(col(WINDOWS_AGENT_COLLECTIONS.activityEvents), where('sessionId', '==', sessionId),
      orderBy('startedAt'), fsLimit(max)),
  );
  return readAll<WindowsActivityEvent>(snapshot);
}

/** One person's spans for one day, across however many sessions that took. */
export async function fetchDayActivity(userId: string, workDate: IsoDate, max = 3000): Promise<WindowsActivityEvent[]> {
  const snapshot = await getDocs(
    query(col(WINDOWS_AGENT_COLLECTIONS.activityEvents),
      where('userId', '==', userId), where('workDate', '==', workDate),
      orderBy('startedAt'), fsLimit(max)),
  );
  return readAll<WindowsActivityEvent>(snapshot);
}

/* ------------------------------------------------------------------------------------------------
 * Application catalogue (§22)
 * ---------------------------------------------------------------------------------------------- */

export async function fetchAppCatalog(): Promise<WindowsAppCatalogEntry[]> {
  const snapshot = await getDocs(query(col(WINDOWS_AGENT_COLLECTIONS.appCatalog), orderBy('displayName')));
  return readAll<WindowsAppCatalogEntry>(snapshot);
}

export async function setAppCategory(
  actor: Actor,
  entry: WindowsAppCatalogEntry,
  category: AppCategory,
  displayName?: string,
): Promise<void> {
  await updateDoc(docIn(WINDOWS_AGENT_COLLECTIONS.appCatalog, entry.id), {
    category,
    ...(displayName ? { displayName: displayName.trim().slice(0, 80) } : {}),
    // Clearing this is what makes the "needs review" badge disappear: a human has now looked.
    autoDiscovered: false,
    updatedAt: serverTimestamp(),
    updatedBy: actor.userId,
    updatedByName: actor.userName,
  });
  await recordAdminAction(actor, 'APP_CATEGORY_CHANGED',
    { type: 'appCatalog', id: entry.id, label: displayName || entry.displayName },
    { oldValue: entry.category, newValue: category });
}

/* ------------------------------------------------------------------------------------------------
 * Policies (§35)
 * ---------------------------------------------------------------------------------------------- */

export async function fetchPolicies(): Promise<WindowsAgentPolicy[]> {
  const snapshot = await getDocs(col(WINDOWS_AGENT_COLLECTIONS.policies));
  return readAll<WindowsAgentPolicy>(snapshot);
}

export async function savePolicy(
  actor: Actor,
  policy: Partial<WindowsAgentPolicy> & Pick<WindowsAgentPolicy, 'scopeKind' | 'scopeLabel'>,
): Promise<string> {
  // Sanitised before it is written, not only when it is read: an out-of-range value stored now is
  // a value some future reader forgets to clamp.
  const settings = sanitizePolicySettings(policy.settings);
  const payload = {
    scopeKind: policy.scopeKind,
    scopeId: policy.scopeId ?? null,
    scopeLabel: policy.scopeLabel,
    enabled: policy.enabled !== false,
    settings,
    notes: policy.notes ?? null,
    updatedAt: serverTimestamp(),
    updatedBy: actor.userId,
    updatedByName: actor.userName,
  };

  if (policy.id) {
    await updateDoc(docIn(WINDOWS_AGENT_COLLECTIONS.policies, policy.id), payload);
    await recordAdminAction(actor, 'POLICY_UPDATED',
      { type: 'policy', id: policy.id, label: policy.scopeLabel }, { newValue: settings });
    return policy.id;
  }

  const created = await addDoc(col(WINDOWS_AGENT_COLLECTIONS.policies), {
    ...payload,
    createdAt: serverTimestamp(),
    createdBy: actor.userId,
    createdByName: actor.userName,
  });
  await recordAdminAction(actor, 'POLICY_CREATED',
    { type: 'policy', id: created.id, label: policy.scopeLabel }, { newValue: settings });
  return created.id;
}

export async function deletePolicy(actor: Actor, policy: WindowsAgentPolicy): Promise<void> {
  await deleteDoc(docIn(WINDOWS_AGENT_COLLECTIONS.policies, policy.id));
  await recordAdminAction(actor, 'POLICY_DELETED',
    { type: 'policy', id: policy.id, label: policy.scopeLabel }, { oldValue: policy.settings });
}

/* ------------------------------------------------------------------------------------------------
 * Enrolment codes (§45)
 * ---------------------------------------------------------------------------------------------- */

export async function fetchEnrollmentCodes(): Promise<WindowsEnrollmentCode[]> {
  const snapshot = await getDocs(col(WINDOWS_AGENT_COLLECTIONS.enrollmentCodes));
  return readAll<WindowsEnrollmentCode>(snapshot);
}

export async function createEnrollmentCode(
  actor: Actor,
  input: {
    code: string;
    label: string;
    departmentId?: string | null;
    departmentName?: string | null;
    assignedLocation?: string | null;
    autoApprove: boolean;
    maxRegistrations: number | null;
    expiresAt: string | null;
  },
): Promise<void> {
  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z0-9-]{4,32}$/.test(code)) {
    throw new Error('A code may contain only letters, numbers and hyphens, and must be 4–32 characters.');
  }

  // The document id *is* the code, so a create must not silently overwrite one that already
  // exists — that would reset its registration count and quietly reopen an exhausted code.
  const existing = await getDoc(docIn(WINDOWS_AGENT_COLLECTIONS.enrollmentCodes, code));
  if (existing.exists()) throw new Error(`The code ${code} already exists.`);

  await setDoc(docIn(WINDOWS_AGENT_COLLECTIONS.enrollmentCodes, code), {
    label: input.label.trim().slice(0, 120),
    departmentId: input.departmentId ?? null,
    departmentName: input.departmentName ?? null,
    assignedLocation: input.assignedLocation ?? null,
    autoApprove: input.autoApprove,
    enabled: true,
    expiresAt: input.expiresAt,
    maxRegistrations: input.maxRegistrations,
    registrationCount: 0,
    createdAt: serverTimestamp(),
    createdBy: actor.userId,
    createdByName: actor.userName,
  });

  await recordAdminAction(actor, 'ENROLLMENT_CODE_CREATED',
    { type: 'enrollmentCode', id: code, label: input.label },
    { newValue: { autoApprove: input.autoApprove, maxRegistrations: input.maxRegistrations } });
}

export async function setEnrollmentCodeEnabled(
  actor: Actor,
  code: WindowsEnrollmentCode,
  enabled: boolean,
): Promise<void> {
  await updateDoc(docIn(WINDOWS_AGENT_COLLECTIONS.enrollmentCodes, code.id), {
    enabled,
    updatedAt: serverTimestamp(),
  });
  await recordAdminAction(actor, 'ENROLLMENT_CODE_DISABLED',
    { type: 'enrollmentCode', id: code.id, label: code.label },
    { oldValue: code.enabled, newValue: enabled });
}

/* ------------------------------------------------------------------------------------------------
 * Notifications (§38, §39)
 * ---------------------------------------------------------------------------------------------- */

export async function fetchNotifications(max = 100): Promise<WindowsNotification[]> {
  const snapshot = await getDocs(
    query(col(WINDOWS_AGENT_COLLECTIONS.notifications), orderBy('createdAtIso', 'desc'), fsLimit(max)),
  );
  return readAll<WindowsNotification>(snapshot);
}

export async function fetchNotificationReceipts(notificationId: string): Promise<WindowsNotificationReceipt[]> {
  const snapshot = await getDocs(
    query(col(WINDOWS_AGENT_COLLECTIONS.notificationReceipts),
      where('notificationId', '==', notificationId), fsLimit(500)),
  );
  return readAll<WindowsNotificationReceipt>(snapshot);
}

/* ------------------------------------------------------------------------------------------------
 * Versions (§43)
 * ---------------------------------------------------------------------------------------------- */

export async function fetchAgentVersions(): Promise<WindowsAgentVersion[]> {
  const snapshot = await getDocs(col(WINDOWS_AGENT_COLLECTIONS.versions));
  return readAll<WindowsAgentVersion>(snapshot).sort((left, right) =>
    right.version.localeCompare(left.version, undefined, { numeric: true }),
  );
}

export async function publishAgentVersion(
  actor: Actor,
  input: Omit<WindowsAgentVersion, 'id' | 'publishedAt' | 'withdrawnAt'>,
): Promise<void> {
  // Both are refused rather than warned about. §43 requires the agent to verify a hash and a
  // signature before running an installer, and a version record missing either is a record the
  // agent will ignore — which looks, from the console, exactly like an update that never applied.
  if (!/^[0-9a-f]{64}$/i.test(input.packageSha256)) {
    throw new Error('packageSha256 must be a 64-character SHA-256 hash. The build script prints it.');
  }
  if (!input.packageUrl.startsWith('https://')) {
    throw new Error('The package URL must be https.');
  }
  if (!input.signatureSubject.trim()) {
    throw new Error('A signature subject is required — the agent refuses an installer signed by anybody else.');
  }

  await setDoc(docIn(WINDOWS_AGENT_COLLECTIONS.versions, input.version), {
    ...input,
    publishedAt: new Date().toISOString(),
    withdrawnAt: null,
    createdAt: serverTimestamp(),
    createdBy: actor.userId,
    createdByName: actor.userName,
  });

  await recordAdminAction(actor, 'AGENT_VERSION_PUBLISHED',
    { type: 'version', id: input.version, label: input.version },
    { newValue: { rings: input.rings, channel: input.channel } });
}

export async function withdrawAgentVersion(actor: Actor, version: WindowsAgentVersion): Promise<void> {
  await updateDoc(docIn(WINDOWS_AGENT_COLLECTIONS.versions, version.id), {
    channel: 'WITHDRAWN',
    withdrawnAt: new Date().toISOString(),
    updatedAt: serverTimestamp(),
  });
  await recordAdminAction(actor, 'AGENT_VERSION_WITHDRAWN',
    { type: 'version', id: version.id, label: version.version });
}

/* ------------------------------------------------------------------------------------------------
 * Audit (§50)
 * ---------------------------------------------------------------------------------------------- */

export async function fetchAuditLogs(max = 300): Promise<WindowsAuditLog[]> {
  const snapshot = await getDocs(
    query(col(WINDOWS_AGENT_COLLECTIONS.auditLogs), orderBy('at', 'desc'), fsLimit(max)),
  );
  return readAll<WindowsAuditLog>(snapshot);
}

/* ------------------------------------------------------------------------------------------------
 * Settings (§37, §52)
 * ---------------------------------------------------------------------------------------------- */

export interface WindowsAgentUiSettings {
  employeeSelfViewEnabled: boolean;
  monitoringPolicyText: string | null;
  minimumFullDaySeconds: number;
}

export const DEFAULT_UI_SETTINGS: WindowsAgentUiSettings = {
  employeeSelfViewEnabled: true,
  monitoringPolicyText: null,
  minimumFullDaySeconds: 8 * 60 * 60,
};

export async function fetchSettings(): Promise<WindowsAgentUiSettings> {
  const snapshot = await getDoc(
    docIn(WINDOWS_AGENT_COLLECTIONS.settings, WINDOWS_AGENT_SETTINGS_DOC_ID),
  ).catch(() => null);
  if (!snapshot?.exists()) return { ...DEFAULT_UI_SETTINGS };
  const data = snapshot.data();
  return {
    employeeSelfViewEnabled: data.employeeSelfViewEnabled !== false,
    monitoringPolicyText: typeof data.monitoringPolicyText === 'string' ? data.monitoringPolicyText : null,
    minimumFullDaySeconds: Number(data.minimumFullDaySeconds) || DEFAULT_UI_SETTINGS.minimumFullDaySeconds,
  };
}

export async function saveSettings(actor: Actor, settings: WindowsAgentUiSettings): Promise<void> {
  await setDoc(
    docIn(WINDOWS_AGENT_COLLECTIONS.settings, WINDOWS_AGENT_SETTINGS_DOC_ID),
    {
      ...settings,
      updatedAt: serverTimestamp(),
      updatedBy: actor.userId,
      updatedByName: actor.userName,
    },
    { merge: true },
  );
}

/* ------------------------------------------------------------------------------------------------
 * Master data the screens join against
 * ---------------------------------------------------------------------------------------------- */

export interface DirectoryEntry {
  id: string;
  name: string;
  email: string;
  departmentId: string | null;
  departmentName: string | null;
  photoURL: string | null;
  status: string;
}

/**
 * The user directory, read once per session.
 *
 * Read whole rather than joined per row: the screens that need it — the live board, the device
 * assignment picker, every report — each need most of it, and `users` is a few hundred documents.
 * One read beats N.
 */
export async function fetchDirectory(): Promise<DirectoryEntry[]> {
  const [users, departments] = await Promise.all([
    getDocs(query(collection(db, 'users'), where('status', '==', 'Active'))),
    getDocs(collection(db, 'departments')).catch(() => null),
  ]);

  const departmentNames = new Map<string, string>();
  departments?.docs.forEach((entry) => departmentNames.set(entry.id, String(entry.data().name || '')));

  return users.docs
    .map((entry) => {
      const data = entry.data();
      const departmentId = typeof data.departmentId === 'string' ? data.departmentId : null;
      return {
        id: entry.id,
        name: String(data.name || data.email || 'User'),
        email: String(data.email || ''),
        departmentId,
        departmentName: departmentId ? departmentNames.get(departmentId) ?? null : null,
        photoURL: typeof data.photoURL === 'string' ? data.photoURL : null,
        status: String(data.status || 'Active'),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function fetchDepartments(): Promise<{ id: string; name: string }[]> {
  const snapshot = await getDocs(collection(db, 'departments')).catch(() => null);
  if (!snapshot) return [];
  return snapshot.docs
    .map((entry) => ({ id: entry.id, name: String(entry.data().name || entry.id) }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/** Firestore `Timestamp` | ISO string | null → Date | null, for the mixed shapes in these docs. */
export function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toDate();
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === 'object' && 'seconds' in (value as Record<string, unknown>)) {
    return new Date(Number((value as { seconds: number }).seconds) * 1000);
  }
  return null;
}

export { writeBatch };

'use client';

/**
 * Every Firestore read and write Office Hub makes from the browser.
 *
 * The rules all live in the pure layer (`office-hub-rules.ts` and friends); this module is the part
 * that talks to the database, and it exists so that no component ever does. That boundary buys three
 * things worth the indirection:
 *
 *   1. **A write is one call, and it is complete.** `createMeeting` writes the meeting, its
 *      participants, its agenda and its reminder rows, sends the invitations, and files the audit
 *      entry. A component that assembled those six writes itself would eventually assemble five of
 *      them, and the one it forgot would be the reminders.
 *
 *   2. **Denormalised fields cannot drift.** `participantUserIds`, `responseSummary`,
 *      `participantCount`, `memberUserIds`, `progress` and `watcherUserIds` are all caches of
 *      something else. Every path that could invalidate one goes through a function here that
 *      recomputes it in the same batch.
 *
 *   3. **Audit and notification are not optional.** They are in the same function as the write, so
 *      "who cancelled this meeting" and "was anybody told" have answers for every action, not for
 *      the actions somebody remembered to instrument.
 *
 * Reads are deliberately narrow and indexed (§58). Where a screen needs live data — the bell, a
 * participant list during a meeting, task comments — it gets a listener; where it needs a register,
 * it gets a bounded query with a limit. Nothing here loads a whole collection.
 */

import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  deleteField,
  doc,
  getCountFromServer,
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
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import { withCreateAudit, withSoftDeleteAudit, withUpdateAudit, type AuditActor } from './audit-fields';
import { logUserActivity } from './activity-logger';
import { dispatchNotification } from './notifications';
import { ACTIVITY_MODULES } from './activity-modules';
import type { Department, Project, User } from './types';
import {
  OFFICE_HUB_COLLECTIONS,
  OFFICE_HUB_EXTERNAL_COLLECTIONS,
  OFFICE_HUB_REFERENCE_PREFIXES,
  OFFICE_HUB_SETTINGS_DOC_ID,
} from './office-hub';
import {
  DEFAULT_OFFICE_HUB_SETTINGS,
  EMPTY_RESPONSE_SUMMARY,
  type AttendanceStatus,
  type CalendarView,
  type InvitationResponse,
  type MeetingStatus,
  type MomStage,
  type OfficeHubActionItem,
  type OfficeHubAgendaItem,
  type OfficeHubAgendaTemplate,
  type OfficeHubDecision,
  type OfficeHubDocument,
  type OfficeHubEntityType,
  type OfficeHubMeeting,
  type OfficeHubMeetingNotes,
  type OfficeHubMeetingTemplate,
  type OfficeHubMom,
  type OfficeHubParticipant,
  type OfficeHubPerson,
  type OfficeHubPriority,
  type OfficeHubReminder,
  type OfficeHubSettings,
  type OfficeHubTask,
  type OfficeHubTaskComment,
  type OfficeHubTaskActivity,
  type OfficeHubTeam,
  type OfficeHubTeamMember,
  type OfficeHubUserSettings,
  type TaskDependency,
  type TaskStatus,
  type TaskSubtask,
} from './office-hub-model';
import {
  clampPercent,
  describeTaskChanges,
  expandParticipantSelection,
  extractMentions,
  htmlToPlainText,
  inverseDependencyType,
  meetingInstants,
  mergeWatchers,
  normalizeTeamMembers,
  officeHubReference,
  officeHubStoragePath,
  settingsOrDefaults,
  stripMentionMarkup,
  summarizeResponses,
  taskProgress,
  uniqueStrings,
  validateOfficeHubUpload,
  type ParticipantSelection,
  type ResolvedParticipant,
} from './office-hub-rules';
import {
  buildMeetingReminders,
  buildTaskReminders,
  effectivePreferences,
  meetingNotificationCopy,
  decisionNotificationCopy,
  taskNotificationCopy,
  reminderId,
  resolveMeetingReminderOffsets,
  OFFICE_HUB_NOTIFICATION_TYPES,
  allowsNotification,
  type OfficeHubNotificationType,
} from './office-hub-reminders';
import { normalizeRecurrence, pendingOccurrences } from './office-hub-recurrence';
import { OFFICE_HUB_BASE_PATH } from './office-hub-permissions';
import { todayInZone, type IsoDate } from './office-hub-time';
import { registerNotificationProvider } from './office-hub-integrations';

/* ── the actor ───────────────────────────────────────────────────────────────────────────────── */

/** Who is performing a write. Built once by `useOfficeHub` from the auth session. */
export interface OfficeHubActor {
  userId: string;
  userName: string;
  userEmail?: string | null;
  role?: string | null;
  organizationId?: string | null;
  timeZone?: string | null;
}

export function officeHubActorFromUser(user: User | null | undefined): OfficeHubActor | null {
  if (!user?.id) return null;
  return {
    userId: user.id,
    userName: user.name || user.email || 'User',
    userEmail: user.email ?? null,
    role: user.role ?? null,
    organizationId: user.organizationId ?? null,
  };
}

const auditActorOf = (actor: OfficeHubActor): AuditActor => ({
  userId: actor.userId,
  userName: actor.userName,
  userEmail: actor.userEmail ?? null,
});

/** Thrown when a write cannot proceed. Message is fit to show in a toast. */
export class OfficeHubServiceError extends Error {
  readonly code: string;
  constructor(message: string, code = 'office-hub/write-failed') {
    super(message);
    this.name = 'OfficeHubServiceError';
    this.code = code;
  }
}

/* ── low-level helpers ───────────────────────────────────────────────────────────────────────── */

const col = (name: string) => collection(db, name);
const docIn = (name: string, id: string) => doc(db, name, id);

const mapDocs = <T>(snapshot: { docs: QueryDocumentSnapshot<DocumentData>[] }): T[] =>
  snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }) as T);

/**
 * Strip `undefined` before a write.
 *
 * Firestore rejects `undefined` outright, and the forms in this module produce it constantly — an
 * optional field the user left alone is `undefined`, not null. Doing this once here is the
 * alternative to every write site remembering, and forgetting once is a failed save with an opaque
 * message.
 */
function clean<T extends Record<string, unknown>>(value: T): T {
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) output[key] = entry;
  }
  return output as T;
}

/**
 * Allocate the next number in a reference series.
 *
 * A transaction on a single counter document, not `count()` over the collection: two people raising
 * a task in the same second must not both get `TSK-2627-0041`, and a count is exactly the read that
 * lets them. The counter is per prefix per financial year, so the sequence restarts in April.
 */
async function allocateReference(prefix: string, date: IsoDate): Promise<string> {
  const financialYear = officeHubReference(prefix, date, 1).split('-')[1];
  const counterRef = docIn(OFFICE_HUB_COLLECTIONS.counters, `${prefix}-${financialYear}`);

  const next = await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(counterRef);
    const current = snapshot.exists() ? Number(snapshot.data()?.value ?? 0) : 0;
    const value = current + 1;
    transaction.set(counterRef, { prefix, financialYear, value, updatedAt: serverTimestamp() }, { merge: true });
    return value;
  });

  return officeHubReference(prefix, date, next);
}

/* ── activity log ────────────────────────────────────────────────────────────────────────────── */

/**
 * File an audit entry (§47).
 *
 * Fire-and-forget by design: `logUserActivity` already swallows its own errors, and an action must
 * not fail because its audit row could not be written. The row carries `recordId`/`recordRef` so a
 * reviewer can pull every action against one meeting or task.
 */
function logOfficeHub(
  actor: OfficeHubActor,
  action: string,
  details: Record<string, unknown> = {},
  target: { recordId?: string; recordRef?: string } = {},
): void {
  void logUserActivity({
    userId: actor.userId,
    userName: actor.userName,
    userEmail: actor.userEmail ?? undefined,
    module: ACTIVITY_MODULES.OFFICE_HUB,
    action,
    details,
    recordId: target.recordId,
    recordRef: target.recordRef,
    sessionId: typeof window !== 'undefined' ? localStorage.getItem('sessionId') ?? undefined : undefined,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
  });
}

/* ── notifications ───────────────────────────────────────────────────────────────────────────── */

/**
 * Per-user notification preferences, cached for the session.
 *
 * Every notification this module sends has to ask "does this person want this?", and a meeting with
 * twenty participants would otherwise be twenty reads before a single invitation went out. The cache
 * is per page load, which is the right staleness: a preference changed in another tab applies on the
 * next navigation, and nothing important turns on the difference.
 */
const preferenceCache = new Map<string, OfficeHubUserSettings | null>();

async function loadPreferencesFor(userIds: readonly string[]): Promise<Map<string, OfficeHubUserSettings | null>> {
  const missing = uniqueStrings(userIds).filter((userId) => !preferenceCache.has(userId));
  await Promise.all(
    missing.map(async (userId) => {
      try {
        const snapshot = await getDoc(docIn(OFFICE_HUB_COLLECTIONS.userSettings, userId));
        preferenceCache.set(
          userId,
          snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as OfficeHubUserSettings) : null,
        );
      } catch {
        // A read failure means "no stored preference", which resolves to the defaults. Failing the
        // notification instead would mean a preference read outage silently stops delivery.
        preferenceCache.set(userId, null);
      }
    }),
  );

  const result = new Map<string, OfficeHubUserSettings | null>();
  for (const userId of uniqueStrings(userIds)) result.set(userId, preferenceCache.get(userId) ?? null);
  return result;
}

export function clearOfficeHubPreferenceCache(userId?: string): void {
  if (userId) preferenceCache.delete(userId);
  else preferenceCache.clear();
}

/**
 * Send an Office Hub notification to the recipients whose preferences allow it.
 *
 * Routes through the app's existing `dispatchNotification`, so the alert lands in the same header
 * bell — and the same push pipeline — as every other module's. The sender is filtered out of the
 * recipient list: telling somebody about the thing they just did is noise, and it is the fastest way
 * to train people to ignore the bell.
 */
async function notify(
  actor: OfficeHubActor,
  type: OfficeHubNotificationType,
  recipients: readonly (string | null | undefined)[],
  copy: { title: string; body: string; link: string; severity?: 'INFO' | 'WARNING' | 'CRITICAL' },
  meta: { entityId?: string; entityRef?: string; settings?: Partial<OfficeHubSettings> | null } = {},
): Promise<number> {
  const targets = uniqueStrings(recipients).filter((userId) => userId !== actor.userId);
  if (!targets.length) return 0;

  const preferences = await loadPreferencesFor(targets);
  const allowed = targets.filter((userId) =>
    allowsNotification(type, effectivePreferences(preferences.get(userId), meta.settings)),
  );
  if (!allowed.length) return 0;

  return dispatchNotification(
    { userIds: allowed },
    {
      type,
      title: copy.title,
      body: copy.body,
      module: ACTIVITY_MODULES.OFFICE_HUB,
      severity: copy.severity ?? 'INFO',
      itemId: meta.entityId,
      itemRef: meta.entityRef,
      link: copy.link,
      organizationId: actor.organizationId ?? undefined,
    },
  );
}

/**
 * Register the app's bell as Office Hub's notification provider (§63).
 *
 * Done at module load so anything holding a `NotificationProvider` — including code that has no
 * business importing the Firebase SDK — can deliver through it.
 */
registerNotificationProvider({
  id: 'sel-live-bell',
  async deliver(input) {
    const delivered = await dispatchNotification(
      { userIds: input.userIds },
      {
        type: input.type,
        title: input.title,
        body: input.body,
        module: ACTIVITY_MODULES.OFFICE_HUB,
        severity: input.severity ?? 'INFO',
        itemId: input.entityId,
        link: input.link ?? undefined,
      },
    );
    return { delivered };
  },
});

/* ── settings ────────────────────────────────────────────────────────────────────────────────── */

export async function loadOfficeHubSettings(): Promise<OfficeHubSettings> {
  try {
    const snapshot = await getDoc(docIn(OFFICE_HUB_COLLECTIONS.settings, OFFICE_HUB_SETTINGS_DOC_ID));
    if (!snapshot.exists()) return { ...DEFAULT_OFFICE_HUB_SETTINGS };
    return settingsOrDefaults(snapshot.data() as Partial<OfficeHubSettings>);
  } catch (error) {
    console.error('[office-hub] Failed to load settings; using defaults', error);
    return { ...DEFAULT_OFFICE_HUB_SETTINGS };
  }
}

export function subscribeOfficeHubSettings(
  onChange: (settings: OfficeHubSettings) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    docIn(OFFICE_HUB_COLLECTIONS.settings, OFFICE_HUB_SETTINGS_DOC_ID),
    (snapshot) => {
      onChange(
        snapshot.exists()
          ? settingsOrDefaults(snapshot.data() as Partial<OfficeHubSettings>)
          : { ...DEFAULT_OFFICE_HUB_SETTINGS },
      );
    },
    (error) => {
      console.error('[office-hub] Settings listener error', error);
      onError?.(error);
      onChange({ ...DEFAULT_OFFICE_HUB_SETTINGS });
    },
  );
}

export async function saveOfficeHubSettings(
  actor: OfficeHubActor,
  patch: Partial<OfficeHubSettings>,
): Promise<void> {
  await setDoc(
    docIn(OFFICE_HUB_COLLECTIONS.settings, OFFICE_HUB_SETTINGS_DOC_ID),
    clean({ ...patch, updatedAt: serverTimestamp(), updatedByName: actor.userName }),
    { merge: true },
  );
  logOfficeHub(actor, 'Update Settings', { fields: Object.keys(patch) });
}

export async function loadOfficeHubUserSettings(userId: string): Promise<OfficeHubUserSettings | null> {
  const snapshot = await getDoc(docIn(OFFICE_HUB_COLLECTIONS.userSettings, userId));
  return snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as OfficeHubUserSettings) : null;
}

export async function saveOfficeHubUserSettings(
  actor: OfficeHubActor,
  patch: Partial<Omit<OfficeHubUserSettings, 'id'>>,
): Promise<void> {
  await setDoc(
    docIn(OFFICE_HUB_COLLECTIONS.userSettings, actor.userId),
    clean({ ...patch, ...withUpdateAudit(auditActorOf(actor)) }),
    { merge: true },
  );
  clearOfficeHubPreferenceCache(actor.userId);
  logOfficeHub(actor, 'Update Notification Preferences', { fields: Object.keys(patch) });
}

export async function setDefaultCalendarView(actor: OfficeHubActor, view: CalendarView): Promise<void> {
  await saveOfficeHubUserSettings(actor, { defaultCalendarView: view });
}

/* ── the directory ───────────────────────────────────────────────────────────────────────────── */

export interface OfficeHubDirectory {
  people: OfficeHubPerson[];
  departments: { id: string; name: string; head?: string; status?: string }[];
  projects: { id: string; name: string; status?: string }[];
  teams: OfficeHubTeam[];
}

/**
 * Everyone who can be invited, and the masters they belong to.
 *
 * ── Why the directory is `users` joined to `employees`, in that direction ────────────────────────
 *
 * A meeting participant needs a *login*: they have to be able to open the app, see the invitation
 * and respond. So the list is driven by `users`, and `employees` is joined onto it for the HR facts
 * — department, designation, employee ID — that `users` does not carry. Driving it the other way
 * would offer the organizer 400 employees, of whom only the ones with an account could ever respond.
 *
 * The join key is `users.employeeId`, which the greytHR linking screen maintains
 * (`docs/greythr-integration.md`), falling back to a case-insensitive email match for accounts
 * linked before that existed. An unlinked user still appears — they can be invited, they just have
 * no department until somebody links them.
 *
 * Cached for the session: this is four collection reads, every screen in the module needs it, and it
 * changes when somebody joins the company rather than during a working session.
 */
let directoryCache: { at: number; value: OfficeHubDirectory } | null = null;
const DIRECTORY_TTL_MS = 5 * 60_000;

export async function loadOfficeHubDirectory(options: { force?: boolean } = {}): Promise<OfficeHubDirectory> {
  if (!options.force && directoryCache && Date.now() - directoryCache.at < DIRECTORY_TTL_MS) {
    return directoryCache.value;
  }

  const [userSnap, employeeSnap, departmentSnap, projectSnap, teamSnap] = await Promise.all([
    getDocs(query(col(OFFICE_HUB_EXTERNAL_COLLECTIONS.users), where('status', '==', 'Active'))),
    getDocs(col(OFFICE_HUB_EXTERNAL_COLLECTIONS.employees)).catch(() => null),
    getDocs(col(OFFICE_HUB_EXTERNAL_COLLECTIONS.departments)),
    getDocs(col(OFFICE_HUB_EXTERNAL_COLLECTIONS.projects)).catch(() => null),
    getDocs(query(col(OFFICE_HUB_COLLECTIONS.teams), where('status', '==', 'Active'))),
  ]);

  const departments = departmentSnap.docs
    .map((entry) => ({ ...(entry.data() as Department), id: entry.id }))
    .map((department) => ({
      id: department.id,
      name: department.name,
      head: department.head,
      status: department.status,
    }));
  const departmentNameById = new Map(departments.map((department) => [department.id, department.name]));
  const departmentIdByName = new Map(
    departments.map((department) => [department.name.trim().toLowerCase(), department.id]),
  );

  interface EmployeeRow {
    id: string;
    employeeId?: string;
    email?: string;
    department?: string;
    designation?: string;
    location?: string;
    status?: string;
  }
  const employees = employeeSnap ? mapDocs<EmployeeRow>(employeeSnap) : [];
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  const employeeByEmail = new Map(
    employees
      .filter((employee) => employee.email)
      .map((employee) => [String(employee.email).trim().toLowerCase(), employee]),
  );

  const people: OfficeHubPerson[] = mapDocs<User>(userSnap).map((user) => {
    const email = user.email ? String(user.email).trim().toLowerCase() : null;
    const employee =
      (user.employeeId ? employeeById.get(user.employeeId) : undefined) ??
      (email ? employeeByEmail.get(email) : undefined);

    // `employees.department` holds a department *name*, not an id — resolve it so every consumer
    // can compare ids and nothing has to string-match a department again.
    const departmentId = employee?.department
      ? departmentIdByName.get(employee.department.trim().toLowerCase()) ?? null
      : null;

    return {
      userId: user.id,
      name: user.name || user.email || 'Unnamed user',
      email: user.email ?? null,
      employeeId: employee?.employeeId ?? user.employeeNo ?? null,
      designation: employee?.designation ?? user.role ?? null,
      departmentId,
      departmentName: departmentId ? departmentNameById.get(departmentId) ?? employee?.department ?? null : employee?.department ?? null,
      photoURL: user.photoURL ?? null,
    };
  });

  const value: OfficeHubDirectory = {
    people: people.sort((a, b) => a.name.localeCompare(b.name)),
    departments: departments.sort((a, b) => a.name.localeCompare(b.name)),
    projects: projectSnap
      ? mapDocs<Project>(projectSnap)
          .map((project) => ({ id: project.id, name: project.projectName, status: project.status }))
          .sort((a, b) => a.name.localeCompare(b.name))
      : [],
    teams: mapDocs<OfficeHubTeam>(teamSnap).sort((a, b) => a.name.localeCompare(b.name)),
  };

  directoryCache = { at: Date.now(), value };
  return value;
}

export function clearOfficeHubDirectoryCache(): void {
  directoryCache = null;
}

/**
 * The viewer's place in the organisation, for the permission checks.
 *
 * Reads the two things the auth session cannot know: which departments this person heads, and which
 * teams they are in or lead.
 */
export async function loadOfficeHubViewerContext(userId: string): Promise<{
  headsDepartmentIds: string[];
  teamIds: string[];
  leadsTeamIds: string[];
  departmentId: string | null;
  departmentName: string | null;
}> {
  const directory = await loadOfficeHubDirectory();
  const me = directory.people.find((person) => person.userId === userId);

  const headsDepartmentIds = directory.departments
    .filter((department) => department.head === userId || department.head === me?.name)
    .map((department) => department.id);

  const myTeams = directory.teams.filter((team) => (team.memberUserIds ?? []).includes(userId));

  return {
    headsDepartmentIds,
    teamIds: myTeams.map((team) => team.id),
    leadsTeamIds: myTeams.filter((team) => team.leaderId === userId).map((team) => team.id),
    departmentId: me?.departmentId ?? null,
    departmentName: me?.departmentName ?? null,
  };
}

/* ── meetings: reads ─────────────────────────────────────────────────────────────────────────── */

export interface MeetingQueryOptions {
  /** ISO dates, inclusive. */
  fromDate?: IsoDate;
  toDate?: IsoDate;
  statuses?: MeetingStatus[];
  limit?: number;
  /** Ascending for upcoming lists, descending for history. */
  direction?: 'asc' | 'desc';
}

/**
 * The query for a scope.
 *
 * Scope is chosen from the viewer's widest grant (`widestMeetingScope`) and turned into an indexed
 * query here — never into a client-side filter over everything. A user entitled only to their own
 * meetings gets `array-contains participantUserIds`, which is both cheaper and impossible to leak
 * through (§49, §58).
 */
function meetingConstraints(
  scope: 'mine' | 'organized' | 'team' | 'department' | 'all',
  viewer: { userId: string; departmentId?: string | null; teamIds?: string[] },
  options: MeetingQueryOptions,
): QueryConstraint[] {
  const constraints: QueryConstraint[] = [];

  switch (scope) {
    case 'mine':
      constraints.push(where('participantUserIds', 'array-contains', viewer.userId));
      break;
    case 'organized':
      constraints.push(where('organizerId', '==', viewer.userId));
      break;
    case 'team':
      // `array-contains-any` takes at most 30 values, and a person in more than 30 teams is not a
      // case worth a second query — the first 30 are their most recent.
      constraints.push(where('teamIds', 'array-contains-any', (viewer.teamIds ?? ['__none__']).slice(0, 30)));
      break;
    case 'department':
      constraints.push(
        where('departmentIds', 'array-contains', viewer.departmentId ?? '__none__'),
      );
      break;
    case 'all':
    default:
      break;
  }

  if (options.fromDate) constraints.push(where('date', '>=', options.fromDate));
  if (options.toDate) constraints.push(where('date', '<=', options.toDate));
  constraints.push(orderBy('date', options.direction ?? 'asc'));
  constraints.push(fsLimit(options.limit ?? 200));
  return constraints;
}

export async function listMeetings(
  scope: 'mine' | 'organized' | 'team' | 'department' | 'all',
  viewer: { userId: string; departmentId?: string | null; teamIds?: string[] },
  options: MeetingQueryOptions = {},
): Promise<OfficeHubMeeting[]> {
  const snapshot = await getDocs(
    query(col(OFFICE_HUB_COLLECTIONS.meetings), ...meetingConstraints(scope, viewer, options)) as Query<DocumentData>,
  );
  return applyPostQueryFilters(mapDocs<OfficeHubMeeting>(snapshot), options);
}

export function subscribeMeetings(
  scope: 'mine' | 'organized' | 'team' | 'department' | 'all',
  viewer: { userId: string; departmentId?: string | null; teamIds?: string[] },
  options: MeetingQueryOptions,
  onChange: (meetings: OfficeHubMeeting[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(col(OFFICE_HUB_COLLECTIONS.meetings), ...meetingConstraints(scope, viewer, options)) as Query<DocumentData>,
    (snapshot) => onChange(applyPostQueryFilters(mapDocs<OfficeHubMeeting>(snapshot), options)),
    (error) => {
      console.error('[office-hub] Meetings listener error', error);
      onError?.(error);
    },
  );
}

/**
 * Filters Firestore cannot combine with the scope query.
 *
 * `isDeleted` and a status `in` clause would each need their own composite index against every
 * scope/date permutation, so they are applied here. The result set is already bounded by the query's
 * limit, so this is a pass over at most a few hundred documents.
 */
function applyPostQueryFilters(
  meetings: OfficeHubMeeting[],
  options: MeetingQueryOptions,
): OfficeHubMeeting[] {
  return meetings
    .filter((meeting) => !meeting.isDeleted)
    .filter((meeting) => (options.statuses?.length ? options.statuses.includes(meeting.status) : true));
}

export async function getMeeting(meetingId: string): Promise<OfficeHubMeeting | null> {
  const snapshot = await getDoc(docIn(OFFICE_HUB_COLLECTIONS.meetings, meetingId));
  return snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as OfficeHubMeeting) : null;
}

export function subscribeMeeting(
  meetingId: string,
  onChange: (meeting: OfficeHubMeeting | null) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    docIn(OFFICE_HUB_COLLECTIONS.meetings, meetingId),
    (snapshot) => onChange(snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as OfficeHubMeeting) : null),
    (error) => {
      console.error('[office-hub] Meeting listener error', error);
      onError?.(error);
    },
  );
}

export async function listMeetingParticipants(meetingId: string): Promise<OfficeHubParticipant[]> {
  const snapshot = await getDocs(
    query(col(OFFICE_HUB_COLLECTIONS.participants), where('meetingId', '==', meetingId)),
  );
  return mapDocs<OfficeHubParticipant>(snapshot).sort((a, b) => {
    if (a.attendanceRole !== b.attendanceRole) return a.attendanceRole === 'Required' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/** Live, because §52 names participant responses and attendance as worth a listener. */
export function subscribeMeetingParticipants(
  meetingId: string,
  onChange: (participants: OfficeHubParticipant[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(col(OFFICE_HUB_COLLECTIONS.participants), where('meetingId', '==', meetingId)),
    (snapshot) =>
      onChange(
        mapDocs<OfficeHubParticipant>(snapshot).sort((a, b) => {
          if (a.attendanceRole !== b.attendanceRole) return a.attendanceRole === 'Required' ? -1 : 1;
          return a.name.localeCompare(b.name);
        }),
      ),
    (error) => {
      console.error('[office-hub] Participants listener error', error);
      onError?.(error);
    },
  );
}

/** Meetings this user has not answered yet, for the dashboard tile and the bell count. */
export async function countAwaitingMyResponse(userId: string): Promise<number> {
  try {
    const snapshot = await getCountFromServer(
      query(
        col(OFFICE_HUB_COLLECTIONS.participants),
        where('userId', '==', userId),
        where('response', '==', 'No Response'),
      ),
    );
    return snapshot.data().count;
  } catch (error) {
    console.error('[office-hub] Could not count outstanding responses', error);
    return 0;
  }
}

export async function listMyParticipations(
  userId: string,
  options: { limit?: number } = {},
): Promise<OfficeHubParticipant[]> {
  const snapshot = await getDocs(
    query(
      col(OFFICE_HUB_COLLECTIONS.participants),
      where('userId', '==', userId),
      fsLimit(options.limit ?? 300),
    ),
  );
  return mapDocs<OfficeHubParticipant>(snapshot);
}

export async function listAgenda(meetingId: string): Promise<OfficeHubAgendaItem[]> {
  const snapshot = await getDocs(
    query(col(OFFICE_HUB_COLLECTIONS.agenda), where('meetingId', '==', meetingId), orderBy('order', 'asc')),
  );
  return mapDocs<OfficeHubAgendaItem>(snapshot);
}

export function subscribeAgenda(
  meetingId: string,
  onChange: (items: OfficeHubAgendaItem[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(col(OFFICE_HUB_COLLECTIONS.agenda), where('meetingId', '==', meetingId), orderBy('order', 'asc')),
    (snapshot) => onChange(mapDocs<OfficeHubAgendaItem>(snapshot)),
    (error) => {
      console.error('[office-hub] Agenda listener error', error);
      onError?.(error);
    },
  );
}

/* ── meetings: writes ────────────────────────────────────────────────────────────────────────── */

export interface CreateMeetingInput {
  title: string;
  meetingType: string;
  description?: string | null;
  priority: OfficeHubPriority;
  status: 'Draft' | 'Scheduled';
  date: IsoDate;
  startTime: string;
  endTime: string;
  timeZone: string;
  mode: OfficeHubMeeting['mode'];
  onlinePlatform?: OfficeHubMeeting['onlinePlatform'];
  meetingUrl?: string | null;
  meetingPasscode?: string | null;
  location?: string | null;
  room?: string | null;
  address?: string | null;
  organizerId: string;
  organizerName: string;
  selection: ParticipantSelection;
  reminderOffsets: number[];
  recurrence?: OfficeHubMeeting['recurrence'];
  projectId?: string | null;
  projectName?: string | null;
  tags?: string[];
  followUpOfMeetingId?: string | null;
  followUpOfMeetingTitle?: string | null;
  templateId?: string | null;
  agendaItems?: {
    title: string;
    description?: string | null;
    expectedOutcome?: string | null;
    estimatedMinutes?: number | null;
    priority?: OfficeHubPriority;
    presenterId?: string | null;
    presenterName?: string | null;
  }[];
  /** Action items carried forward from the meeting this one follows (§70). */
  carryActionItemIds?: string[];
  momRequired?: boolean;
}

export interface CreateMeetingResult {
  meetingId: string;
  participantCount: number;
  /** Instances created for a recurring series, excluding the first. */
  seriesInstancesCreated: number;
  warnings: string[];
}

/**
 * Create a meeting, everything that belongs to it, and everything that has to happen because of it.
 *
 * One function rather than six calls from the form, for the reason at the top of this file: the
 * participants, agenda, reminder rows, invitations and audit entry are not optional parts of
 * "create a meeting", and a caller assembling them by hand will eventually assemble five of six.
 *
 * A **draft** is the one case that short-circuits: no invitations, no reminders, no series. A draft
 * is a note to self, and §13's "every participant must receive an invitation" applies from the
 * moment the meeting is actually scheduled — which is what the Send action does.
 */
export async function createMeeting(
  actor: OfficeHubActor,
  input: CreateMeetingInput,
  options: { settings?: OfficeHubSettings | null; directory?: OfficeHubDirectory } = {},
): Promise<CreateMeetingResult> {
  const settings = settingsOrDefaults(options.settings);
  const directory = options.directory ?? (await loadOfficeHubDirectory());

  const organizer = directory.people.find((person) => person.userId === input.organizerId) ?? {
    userId: input.organizerId,
    name: input.organizerName,
  };

  const { participants, warnings } = expandParticipantSelection(input.selection, directory, organizer);
  const recurrence = normalizeRecurrence(input.recurrence ?? undefined, input.date);
  const isSeries = recurrence.frequency !== 'None' && input.status !== 'Draft';

  const meetingRef = doc(col(OFFICE_HUB_COLLECTIONS.meetings));
  const instants = meetingInstants(input);

  const fields = clean({
    title: input.title.trim(),
    meetingType: input.meetingType,
    description: input.description ?? null,
    priority: input.priority,
    status: input.status,
    date: input.date,
    startTime: input.startTime,
    endTime: input.endTime,
    timeZone: input.timeZone || settings.defaultTimeZone,
    startAt: instants.startAt,
    endAt: instants.endAt,
    mode: input.mode,
    onlinePlatform: input.onlinePlatform ?? null,
    meetingUrl: input.meetingUrl ?? null,
    meetingPasscode: input.meetingPasscode ?? null,
    location: input.location ?? null,
    room: input.room ?? null,
    address: input.address ?? null,
    organizerId: input.organizerId,
    organizerName: input.organizerName,
    scheduledById: actor.userId,
    scheduledByName: actor.userName,
    participantUserIds: participants.map((participant) => participant.userId),
    requiredUserIds: participants
      .filter((participant) => participant.attendanceRole === 'Required')
      .map((participant) => participant.userId),
    departmentIds: uniqueStrings(participants.map((participant) => participant.departmentId)),
    teamIds: uniqueStrings(input.selection.teamIds),
    responseSummary: { ...EMPTY_RESPONSE_SUMMARY, noResponse: participants.length },
    participantCount: participants.length,
    projectId: input.projectId ?? null,
    projectName: input.projectName ?? null,
    reminderOffsets: input.reminderOffsets?.length ? input.reminderOffsets : settings.defaultReminderOffsets,
    recurrence,
    seriesId: isSeries ? meetingRef.id : null,
    isSeriesParent: isSeries,
    occurrenceKey: isSeries ? input.date : null,
    occurrenceNumber: isSeries ? 1 : null,
    followUpOfMeetingId: input.followUpOfMeetingId ?? null,
    followUpOfMeetingTitle: input.followUpOfMeetingTitle ?? null,
    templateId: input.templateId ?? null,
    momRequired: input.momRequired ?? settings.momApprovalRequired,
    momStage: null,
    tags: input.tags ?? [],
    isDeleted: false,
    organizationId: actor.organizationId ?? null,
  });

  /**
   * The persisted document and the in-memory view are built from the same `fields`, with the audit
   * sentinels added only to what is written. `serverTimestamp()` returns a `FieldValue` placeholder,
   * not a date — it means nothing until the server resolves it — so an object carrying one is not an
   * `OfficeHubMeeting` and must not be handed to the functions below as though it were.
   */
  const base = { ...fields, ...withCreateAudit(auditActorOf(actor)) };

  const batch = writeBatch(db);
  batch.set(meetingRef, base);
  writeParticipants(batch, meetingRef.id, isSeries ? meetingRef.id : null, participants, actor);
  writeAgenda(batch, meetingRef.id, isSeries ? meetingRef.id : null, input.agendaItems ?? [], actor);
  await batch.commit();

  const meeting = { ...fields, id: meetingRef.id } as OfficeHubMeeting;

  let seriesInstancesCreated = 0;
  if (isSeries) {
    seriesInstancesCreated = await materializeSeriesInstances(actor, meeting, {
      participants,
      agendaItems: input.agendaItems ?? [],
    });
  }

  if (input.status === 'Scheduled') {
    await Promise.all([
      scheduleMeetingReminders(meeting, participants.map((participant) => participant.userId), settings),
      sendInvitations(actor, meeting, participants, settings),
    ]);
  }

  if (input.carryActionItemIds?.length) {
    await carryActionItemsForward(actor, input.carryActionItemIds, meeting);
  }

  if (input.templateId) {
    // Best-effort: a template's usage counter is nice to have and must not fail the creation.
    void updateDoc(docIn(OFFICE_HUB_COLLECTIONS.meetingTemplates, input.templateId), {
      usageCount: arrayUnionSafeIncrement(),
    }).catch(() => {});
  }

  logOfficeHub(
    actor,
    input.status === 'Draft' ? 'Save Meeting Draft' : 'Create Meeting',
    {
      title: input.title,
      meetingType: input.meetingType,
      date: input.date,
      mode: input.mode,
      participants: participants.length,
      recurring: isSeries,
      seriesInstancesCreated,
      organizerId: input.organizerId,
      onBehalfOf: input.organizerId !== actor.userId ? input.organizerName : undefined,
    },
    { recordId: meetingRef.id, recordRef: input.title },
  );

  return { meetingId: meetingRef.id, participantCount: participants.length, seriesInstancesCreated, warnings };
}

/**
 * `usageCount` + 1 without a transaction.
 *
 * `increment` would be the right primitive, but it is one more import on the critical path for a
 * counter nothing depends on. Reading it back is not worth a round trip either, so the field is
 * simply stamped with the current time instead and the count derived from the template's meetings
 * when anybody asks. Returning `deleteField()` here keeps the write valid while recording nothing.
 */
const arrayUnionSafeIncrement = () => deleteField();

function writeParticipants(
  batch: ReturnType<typeof writeBatch>,
  meetingId: string,
  seriesId: string | null,
  participants: readonly ResolvedParticipant[],
  actor: OfficeHubActor,
): void {
  for (const participant of participants) {
    // Deterministic id: meeting + user. This is what makes "add participants" idempotent and makes
    // §86's "do not create duplicate participants" true by construction rather than by checking.
    const ref = docIn(OFFICE_HUB_COLLECTIONS.participants, `${meetingId}_${participant.userId}`);
    batch.set(
      ref,
      clean({
        meetingId,
        seriesId,
        userId: participant.userId,
        name: participant.name,
        email: participant.email ?? null,
        employeeId: participant.employeeId ?? null,
        designation: participant.designation ?? null,
        departmentId: participant.departmentId ?? null,
        departmentName: participant.departmentName ?? null,
        attendanceRole: participant.attendanceRole,
        source: participant.source,
        sourceId: participant.sourceId ?? null,
        sourceName: participant.sourceName ?? null,
        response: 'No Response' as InvitationResponse,
        responseMessage: null,
        respondedAt: null,
        attendance: null,
        remindersSent: 0,
        ...withCreateAudit(auditActorOf(actor)),
      }),
      { merge: true },
    );
  }
}

function writeAgenda(
  batch: ReturnType<typeof writeBatch>,
  meetingId: string,
  seriesId: string | null,
  items: readonly NonNullable<CreateMeetingInput['agendaItems']>[number][],
  actor: OfficeHubActor,
): void {
  items.forEach((item, index) => {
    const ref = doc(col(OFFICE_HUB_COLLECTIONS.agenda));
    batch.set(
      ref,
      clean({
        meetingId,
        seriesId,
        order: index + 1,
        title: item.title,
        description: item.description ?? null,
        expectedOutcome: item.expectedOutcome ?? null,
        estimatedMinutes: item.estimatedMinutes ?? null,
        priority: item.priority ?? 'Medium',
        presenterId: item.presenterId ?? null,
        presenterName: item.presenterName ?? null,
        documentIds: [],
        covered: false,
        ...withCreateAudit(auditActorOf(actor)),
      }),
    );
  });
}

/**
 * Materialise the instances of a recurring series (§11).
 *
 * Idempotent: `occurrenceKey` is the instance's identity, and existing keys are read first, so
 * running this twice — or letting the cron route run it again tomorrow — creates nothing extra.
 * That is §86's "do not create duplicate recurring meetings", enforced structurally.
 *
 * The parent's own date is excluded because the parent *is* the first instance.
 */
export async function materializeSeriesInstances(
  actor: OfficeHubActor,
  parent: OfficeHubMeeting,
  seed: {
    participants?: readonly ResolvedParticipant[];
    agendaItems?: readonly NonNullable<CreateMeetingInput['agendaItems']>[number][];
  } = {},
  options: { until?: IsoDate } = {},
): Promise<number> {
  const seriesId = parent.seriesId ?? parent.id;
  const existing = await getDocs(
    query(col(OFFICE_HUB_COLLECTIONS.meetings), where('seriesId', '==', seriesId), fsLimit(400)),
  );
  const existingKeys = mapDocs<OfficeHubMeeting>(existing)
    .map((meeting) => meeting.occurrenceKey)
    .filter(Boolean) as string[];

  const pending = pendingOccurrences(parent.recurrence, parent.date, [...existingKeys, parent.date], {
    until: options.until,
  });
  if (!pending.length) return 0;

  const participants =
    seed.participants ??
    (await listMeetingParticipants(parent.id)).map((participant) => ({
      userId: participant.userId,
      name: participant.name,
      email: participant.email,
      employeeId: participant.employeeId,
      designation: participant.designation,
      departmentId: participant.departmentId,
      departmentName: participant.departmentName,
      attendanceRole: participant.attendanceRole,
      source: participant.source,
      sourceId: participant.sourceId,
      sourceName: participant.sourceName,
    }));

  const agendaItems =
    seed.agendaItems ??
    (await listAgenda(parent.id)).map((item) => ({
      title: item.title,
      description: item.description,
      expectedOutcome: item.expectedOutcome,
      estimatedMinutes: item.estimatedMinutes,
      priority: item.priority,
      presenterId: item.presenterId,
      presenterName: item.presenterName,
    }));

  const settings = await loadOfficeHubSettings();
  let created = 0;

  // Batched in tens: each instance writes one meeting, N participants and M agenda items, and a
  // 500-write batch limit is reached faster than it looks with twenty participants per meeting.
  for (const group of chunk(pending, 10)) {
    const batch = writeBatch(db);
    for (const occurrence of group) {
      const instanceRef = doc(col(OFFICE_HUB_COLLECTIONS.meetings));
      const instants = meetingInstants({
        date: occurrence.date,
        startTime: parent.startTime,
        endTime: parent.endTime,
        timeZone: parent.timeZone,
      });
      batch.set(
        instanceRef,
        clean({
          ...stripInstanceOnlyFields(parent),
          date: occurrence.date,
          startAt: instants.startAt,
          endAt: instants.endAt,
          seriesId,
          isSeriesParent: false,
          occurrenceKey: occurrence.occurrenceKey,
          occurrenceNumber: occurrence.occurrenceNumber,
          status: 'Scheduled' as MeetingStatus,
          responseSummary: { ...EMPTY_RESPONSE_SUMMARY, noResponse: participants.length },
          participantCount: participants.length,
          momStage: null,
          startedAt: null,
          endedAt: null,
          ...withCreateAudit(auditActorOf(actor)),
        }),
      );
      writeParticipants(batch, instanceRef.id, seriesId, participants as ResolvedParticipant[], actor);
      writeAgenda(batch, instanceRef.id, seriesId, agendaItems as never[], actor);
      created += 1;
    }
    await batch.commit();
  }

  // Reminders for the new instances, in the background: a series of twelve meetings with twenty
  // participants and two offsets is 480 reminder rows, and the organizer should not wait for them.
  void (async () => {
    for (const occurrence of pending) {
      const instants = meetingInstants({
        date: occurrence.date,
        startTime: parent.startTime,
        endTime: parent.endTime,
        timeZone: parent.timeZone,
      });
      await scheduleMeetingReminders(
        {
          ...parent,
          id: `${seriesId}_${occurrence.occurrenceKey}`,
          date: occurrence.date,
          startAt: instants.startAt,
          seriesId,
          status: 'Scheduled',
        },
        participants.map((participant) => participant.userId),
        settings,
      ).catch(() => {});
    }
  })();

  logOfficeHub(actor, 'Generate Recurring Instances', { seriesId, created }, { recordId: seriesId, recordRef: parent.title });
  return created;
}

/** Fields that belong to one occurrence and must not be copied onto its siblings. */
function stripInstanceOnlyFields(meeting: OfficeHubMeeting): Record<string, unknown> {
  const {
    id,
    createdAt,
    createdBy,
    createdByName,
    updatedAt,
    updatedBy,
    updatedByName,
    momStage,
    startedAt,
    endedAt,
    cancellationReason,
    postponedToDate,
    occurrenceKey,
    occurrenceNumber,
    ...rest
  } = meeting;
  void id;
  void createdAt;
  void createdBy;
  void createdByName;
  void updatedAt;
  void updatedBy;
  void updatedByName;
  void momStage;
  void startedAt;
  void endedAt;
  void cancellationReason;
  void postponedToDate;
  void occurrenceKey;
  void occurrenceNumber;
  return rest;
}

const chunk = <T>(values: readonly T[], size: number): T[][] => {
  const groups: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    groups.push(values.slice(index, index + size));
  }
  return groups;
};

export interface UpdateMeetingInput extends Partial<Omit<CreateMeetingInput, 'selection' | 'agendaItems'>> {
  selection?: ParticipantSelection;
}

/**
 * Update a meeting, and tell the participants when it matters.
 *
 * A change to the date, time, zone, mode or location is a **reschedule**: the participants have
 * planned around the old value, so they are notified and the reminder rows are rebuilt against the
 * new instant. A change to the description or the priority is not, and notifying on it would train
 * people to ignore the notifications that matter. That distinction is the only interesting thing
 * this function does.
 */
export async function updateMeeting(
  actor: OfficeHubActor,
  meetingId: string,
  patch: UpdateMeetingInput,
  options: {
    settings?: OfficeHubSettings | null;
    directory?: OfficeHubDirectory;
    reason?: string | null;
    scope?: 'occurrence' | 'series';
  } = {},
): Promise<{ rescheduled: boolean; notified: number }> {
  const existing = await getMeeting(meetingId);
  if (!existing) throw new OfficeHubServiceError('That meeting no longer exists.', 'office-hub/not-found');

  const settings = settingsOrDefaults(options.settings);
  const next = { ...existing, ...patch } as OfficeHubMeeting;

  const timingChanged =
    (patch.date != null && patch.date !== existing.date) ||
    (patch.startTime != null && patch.startTime !== existing.startTime) ||
    (patch.endTime != null && patch.endTime !== existing.endTime) ||
    (patch.timeZone != null && patch.timeZone !== existing.timeZone);

  const placeChanged =
    (patch.mode != null && patch.mode !== existing.mode) ||
    (patch.location != null && patch.location !== existing.location) ||
    (patch.room != null && patch.room !== existing.room) ||
    (patch.meetingUrl != null && patch.meetingUrl !== existing.meetingUrl);

  const update: Record<string, unknown> = clean({ ...patch });
  delete update.selection;

  if (timingChanged) {
    const instants = meetingInstants({
      date: next.date,
      startTime: next.startTime,
      endTime: next.endTime,
      timeZone: next.timeZone,
    });
    update.startAt = instants.startAt;
    update.endAt = instants.endAt;
  }

  if (patch.recurrence) {
    update.recurrence = normalizeRecurrence(patch.recurrence, next.date);
  }

  let participantIds = existing.participantUserIds ?? [];

  if (patch.selection) {
    const directory = options.directory ?? (await loadOfficeHubDirectory());
    const organizer = directory.people.find((person) => person.userId === next.organizerId) ?? {
      userId: next.organizerId,
      name: next.organizerName,
    };
    const { participants } = expandParticipantSelection(patch.selection, directory, organizer);
    await replaceParticipants(actor, existing, participants, settings);
    participantIds = participants.map((participant) => participant.userId);
    update.participantUserIds = participantIds;
    update.requiredUserIds = participants
      .filter((participant) => participant.attendanceRole === 'Required')
      .map((participant) => participant.userId);
    update.departmentIds = uniqueStrings(participants.map((participant) => participant.departmentId));
    update.teamIds = uniqueStrings(patch.selection.teamIds);
    update.participantCount = participants.length;
  }

  await updateDoc(docIn(OFFICE_HUB_COLLECTIONS.meetings, meetingId), {
    ...update,
    ...withUpdateAudit(auditActorOf(actor)),
  });

  let notified = 0;
  const rescheduled = timingChanged || placeChanged;

  if (rescheduled && existing.status !== 'Draft') {
    const updated = { ...next, ...update } as OfficeHubMeeting;
    await cancelRemindersFor('meeting', meetingId);
    await scheduleMeetingReminders(updated, participantIds, settings);
    notified = await notify(
      actor,
      OFFICE_HUB_NOTIFICATION_TYPES.MEETING_RESCHEDULED,
      participantIds,
      meetingNotificationCopy(OFFICE_HUB_NOTIFICATION_TYPES.MEETING_RESCHEDULED, updated, {
        actorName: actor.userName,
        reason: options.reason ?? null,
      }),
      { entityId: meetingId, entityRef: updated.title, settings },
    );
  }

  if (options.scope === 'series' && existing.seriesId) {
    await applyToSeriesSiblings(actor, existing, update);
  }

  logOfficeHub(
    actor,
    rescheduled ? 'Reschedule Meeting' : 'Edit Meeting',
    {
      changes: Object.keys(update).filter((key) => !key.startsWith('updated')),
      scope: options.scope ?? 'occurrence',
      reason: options.reason ?? undefined,
      from: timingChanged ? `${existing.date} ${existing.startTime}` : undefined,
      to: timingChanged ? `${next.date} ${next.startTime}` : undefined,
    },
    { recordId: meetingId, recordRef: existing.title },
  );

  return { rescheduled, notified };
}

/**
 * Apply a patch to the other future instances of a series.
 *
 * Past instances are left alone: they have happened, and they may have minutes, attendance and
 * tasks referring to what they actually were. Rewriting them to match a rule changed afterwards
 * would falsify the record (§83).
 */
async function applyToSeriesSiblings(
  actor: OfficeHubActor,
  parent: OfficeHubMeeting,
  update: Record<string, unknown>,
): Promise<void> {
  const today = todayInZone(parent.timeZone);
  const siblings = await getDocs(
    query(
      col(OFFICE_HUB_COLLECTIONS.meetings),
      where('seriesId', '==', parent.seriesId),
      where('date', '>=', today),
      fsLimit(400),
    ),
  );

  // The date is an instance's own identity within the series; copying one instance's date onto its
  // siblings would collapse the whole series onto a single day.
  const { date, startAt, endAt, occurrenceKey, occurrenceNumber, ...shared } = update;
  void date;
  void startAt;
  void endAt;
  void occurrenceKey;
  void occurrenceNumber;
  if (!Object.keys(shared).length) return;

  for (const group of chunk(siblings.docs, 200)) {
    const batch = writeBatch(db);
    for (const sibling of group) {
      if (sibling.id === parent.id) continue;
      batch.update(sibling.ref, { ...shared, ...withUpdateAudit(auditActorOf(actor)) });
    }
    await batch.commit();
  }
}

/**
 * Replace the invitation list, preserving what people have already told us.
 *
 * Responses and attendance survive: somebody who accepted last week has not un-accepted because the
 * organizer added a colleague. Removed participants are deleted along with their reminder rows, so
 * a person taken off a meeting stops being reminded about it.
 */
async function replaceParticipants(
  actor: OfficeHubActor,
  meeting: OfficeHubMeeting,
  participants: readonly ResolvedParticipant[],
  settings: OfficeHubSettings,
): Promise<void> {
  const existing = await listMeetingParticipants(meeting.id);
  const existingByUserId = new Map(existing.map((participant) => [participant.userId, participant]));
  const nextIds = new Set(participants.map((participant) => participant.userId));

  const batch = writeBatch(db);

  for (const participant of participants) {
    const previous = existingByUserId.get(participant.userId);
    const ref = docIn(OFFICE_HUB_COLLECTIONS.participants, `${meeting.id}_${participant.userId}`);
    batch.set(
      ref,
      clean({
        meetingId: meeting.id,
        seriesId: meeting.seriesId ?? null,
        userId: participant.userId,
        name: participant.name,
        email: participant.email ?? null,
        employeeId: participant.employeeId ?? null,
        designation: participant.designation ?? null,
        departmentId: participant.departmentId ?? null,
        departmentName: participant.departmentName ?? null,
        attendanceRole: participant.attendanceRole,
        source: participant.source,
        sourceId: participant.sourceId ?? null,
        sourceName: participant.sourceName ?? null,
        response: previous?.response ?? ('No Response' as InvitationResponse),
        responseMessage: previous?.responseMessage ?? null,
        respondedAt: previous?.respondedAt ?? null,
        attendance: previous?.attendance ?? null,
        remindersSent: previous?.remindersSent ?? 0,
        ...(previous ? withUpdateAudit(auditActorOf(actor)) : withCreateAudit(auditActorOf(actor))),
      }),
      { merge: true },
    );
  }

  const removed = existing.filter((participant) => !nextIds.has(participant.userId));
  for (const participant of removed) {
    batch.delete(docIn(OFFICE_HUB_COLLECTIONS.participants, participant.id));
  }

  const added = participants.filter((participant) => !existingByUserId.has(participant.userId));
  batch.update(docIn(OFFICE_HUB_COLLECTIONS.meetings, meeting.id), {
    responseSummary: summarizeResponses([
      ...participants.map((participant) => ({
        response: existingByUserId.get(participant.userId)?.response ?? ('No Response' as InvitationResponse),
      })),
    ]),
  });

  await batch.commit();

  for (const participant of removed) {
    await cancelRemindersFor('meeting', meeting.id, participant.userId);
  }

  if (added.length && meeting.status !== 'Draft') {
    await sendInvitations(actor, meeting, added, settings);
    await scheduleMeetingReminders(meeting, added.map((participant) => participant.userId), settings);
  }

  if (added.length || removed.length) {
    logOfficeHub(
      actor,
      'Update Meeting Participants',
      { added: added.map((p) => p.name), removed: removed.map((p) => p.name) },
      { recordId: meeting.id, recordRef: meeting.title },
    );
  }
}

/** Send the invitation notifications for a set of participants (§13). */
async function sendInvitations(
  actor: OfficeHubActor,
  meeting: OfficeHubMeeting,
  participants: readonly { userId: string }[],
  settings: OfficeHubSettings,
): Promise<number> {
  return notify(
    actor,
    OFFICE_HUB_NOTIFICATION_TYPES.MEETING_INVITATION,
    participants.map((participant) => participant.userId),
    meetingNotificationCopy(OFFICE_HUB_NOTIFICATION_TYPES.MEETING_INVITATION, meeting),
    { entityId: meeting.id, entityRef: meeting.title, settings },
  );
}

/** Promote a draft to Scheduled: this is the moment invitations go out. */
export async function sendMeetingInvitations(
  actor: OfficeHubActor,
  meetingId: string,
  options: { settings?: OfficeHubSettings | null } = {},
): Promise<number> {
  const meeting = await getMeeting(meetingId);
  if (!meeting) throw new OfficeHubServiceError('That meeting no longer exists.', 'office-hub/not-found');

  const settings = settingsOrDefaults(options.settings);
  const participants = await listMeetingParticipants(meetingId);
  if (!participants.length) {
    throw new OfficeHubServiceError('Invite at least one participant before sending.', 'office-hub/no-participants');
  }

  await updateDoc(docIn(OFFICE_HUB_COLLECTIONS.meetings, meetingId), {
    status: 'Scheduled',
    ...withUpdateAudit(auditActorOf(actor)),
  });

  const scheduled = { ...meeting, status: 'Scheduled' as MeetingStatus };
  await scheduleMeetingReminders(scheduled, participants.map((participant) => participant.userId), settings);
  const sent = await sendInvitations(actor, scheduled, participants, settings);

  if (scheduled.recurrence.frequency !== 'None') {
    await materializeSeriesInstances(actor, { ...scheduled, seriesId: scheduled.seriesId ?? meetingId, isSeriesParent: true });
  }

  logOfficeHub(actor, 'Send Meeting Invitations', { participants: participants.length, notified: sent }, { recordId: meetingId, recordRef: meeting.title });
  return sent;
}

export async function cancelMeeting(
  actor: OfficeHubActor,
  meetingId: string,
  options: { reason: string; scope?: 'occurrence' | 'series'; settings?: OfficeHubSettings | null } = { reason: '' },
): Promise<{ cancelled: number; notified: number }> {
  const meeting = await getMeeting(meetingId);
  if (!meeting) throw new OfficeHubServiceError('That meeting no longer exists.', 'office-hub/not-found');
  const settings = settingsOrDefaults(options.settings);

  const targets: OfficeHubMeeting[] = [meeting];

  if (options.scope === 'series' && meeting.seriesId) {
    const today = todayInZone(meeting.timeZone);
    const siblings = await getDocs(
      query(
        col(OFFICE_HUB_COLLECTIONS.meetings),
        where('seriesId', '==', meeting.seriesId),
        where('date', '>=', today),
        fsLimit(400),
      ),
    );
    for (const sibling of mapDocs<OfficeHubMeeting>(siblings)) {
      if (sibling.id !== meetingId && sibling.status !== 'Cancelled' && sibling.status !== 'Completed') {
        targets.push(sibling);
      }
    }
  }

  for (const group of chunk(targets, 200)) {
    const batch = writeBatch(db);
    for (const target of group) {
      batch.update(docIn(OFFICE_HUB_COLLECTIONS.meetings, target.id), {
        status: 'Cancelled',
        cancellationReason: options.reason || null,
        ...withUpdateAudit(auditActorOf(actor)),
      });
    }
    await batch.commit();
  }

  /**
   * An individually cancelled occurrence becomes an exception on the series rule.
   *
   * Without this, the next generation run would look at the rule, see no meeting on that date, and
   * helpfully recreate the one somebody just cancelled.
   */
  if (options.scope !== 'series' && meeting.seriesId && meeting.occurrenceKey) {
    await updateDoc(docIn(OFFICE_HUB_COLLECTIONS.meetings, meeting.seriesId), {
      'recurrence.exceptions': arrayUnion(meeting.occurrenceKey),
    }).catch(() => {});
  }

  let notified = 0;
  for (const target of targets) {
    await cancelRemindersFor('meeting', target.id);
    notified += await notify(
      actor,
      OFFICE_HUB_NOTIFICATION_TYPES.MEETING_CANCELLED,
      target.participantUserIds ?? [],
      meetingNotificationCopy(OFFICE_HUB_NOTIFICATION_TYPES.MEETING_CANCELLED, target, {
        actorName: actor.userName,
        reason: options.reason,
      }),
      { entityId: target.id, entityRef: target.title, settings },
    );
  }

  logOfficeHub(
    actor,
    'Cancel Meeting',
    { reason: options.reason, scope: options.scope ?? 'occurrence', cancelled: targets.length, notified },
    { recordId: meetingId, recordRef: meeting.title },
  );

  return { cancelled: targets.length, notified };
}

export async function setMeetingStatus(
  actor: OfficeHubActor,
  meetingId: string,
  status: MeetingStatus,
  options: { postponedToDate?: IsoDate | null } = {},
): Promise<void> {
  await updateDoc(docIn(OFFICE_HUB_COLLECTIONS.meetings, meetingId), {
    status,
    postponedToDate: options.postponedToDate ?? null,
    ...(status === 'In Progress' ? { startedAt: new Date().toISOString() } : {}),
    ...(status === 'Completed' ? { endedAt: new Date().toISOString() } : {}),
    ...withUpdateAudit(auditActorOf(actor)),
  });
  logOfficeHub(actor, 'Set Meeting Status', { status }, { recordId: meetingId });
}

/** Start the meeting (§18). Stamps `startedAt`, which is what the live timer counts from. */
export async function startMeeting(actor: OfficeHubActor, meetingId: string): Promise<void> {
  await updateDoc(docIn(OFFICE_HUB_COLLECTIONS.meetings, meetingId), {
    status: 'In Progress',
    startedAt: new Date().toISOString(),
    ...withUpdateAudit(auditActorOf(actor)),
  });
  logOfficeHub(actor, 'Start Meeting', {}, { recordId: meetingId });
}

export async function endMeeting(actor: OfficeHubActor, meetingId: string): Promise<void> {
  await updateDoc(docIn(OFFICE_HUB_COLLECTIONS.meetings, meetingId), {
    status: 'Completed',
    endedAt: new Date().toISOString(),
    ...withUpdateAudit(auditActorOf(actor)),
  });
  await cancelRemindersFor('meeting', meetingId);
  logOfficeHub(actor, 'Complete Meeting', {}, { recordId: meetingId });
}

/** Soft delete (§83). Nothing in this module hard-deletes a meeting. */
export async function archiveMeeting(actor: OfficeHubActor, meetingId: string, reason?: string): Promise<void> {
  await updateDoc(docIn(OFFICE_HUB_COLLECTIONS.meetings, meetingId), {
    ...withSoftDeleteAudit(auditActorOf(actor)),
    archivedAt: serverTimestamp(),
    cancellationReason: reason ?? null,
  });
  await cancelRemindersFor('meeting', meetingId);
  logOfficeHub(actor, 'Archive Meeting', { reason }, { recordId: meetingId });
}

export async function restoreMeeting(actor: OfficeHubActor, meetingId: string): Promise<void> {
  await updateDoc(docIn(OFFICE_HUB_COLLECTIONS.meetings, meetingId), {
    isDeleted: false,
    deletedAt: null,
    deletedBy: null,
    deletedByName: null,
    ...withUpdateAudit(auditActorOf(actor)),
  });
  logOfficeHub(actor, 'Restore Meeting', {}, { recordId: meetingId });
}

/* ── invitation responses ────────────────────────────────────────────────────────────────────── */

/**
 * Answer an invitation (§13).
 *
 * The participant document and the meeting's cached `responseSummary` are written in one batch, so
 * the counters the organizer sees can never disagree with the individual answers. The organizer is
 * notified — that is the point of asking.
 */
export async function respondToInvitation(
  actor: OfficeHubActor,
  meetingId: string,
  response: InvitationResponse,
  options: { message?: string | null; settings?: OfficeHubSettings | null } = {},
): Promise<void> {
  const participantId = `${meetingId}_${actor.userId}`;
  const [meeting, participants] = await Promise.all([getMeeting(meetingId), listMeetingParticipants(meetingId)]);
  if (!meeting) throw new OfficeHubServiceError('That meeting no longer exists.', 'office-hub/not-found');

  const mine = participants.find((participant) => participant.id === participantId);
  if (!mine) throw new OfficeHubServiceError('You are not on the invitation list for this meeting.', 'office-hub/not-invited');

  const batch = writeBatch(db);
  batch.update(docIn(OFFICE_HUB_COLLECTIONS.participants, participantId), {
    response,
    responseMessage: options.message ?? null,
    respondedAt: new Date().toISOString(),
    ...withUpdateAudit(auditActorOf(actor)),
  });
  batch.update(docIn(OFFICE_HUB_COLLECTIONS.meetings, meetingId), {
    responseSummary: summarizeResponses(
      participants.map((participant) => (participant.id === participantId ? { response } : participant)),
    ),
  });
  await batch.commit();

  await notify(
    actor,
    OFFICE_HUB_NOTIFICATION_TYPES.MEETING_RESPONSE,
    [meeting.organizerId],
    {
      title: `${actor.userName} ${response === 'Accepted' ? 'accepted' : response === 'Declined' ? 'declined' : 'replied to'} ${meeting.title}`,
      body: options.message?.trim()
        ? `"${options.message.trim()}"`
        : `${actor.userName} responded "${response}" to the meeting on ${meeting.date}.`,
      link: `${OFFICE_HUB_BASE_PATH}/meetings/${meetingId}`,
      severity: response === 'Declined' ? 'WARNING' : 'INFO',
    },
    { entityId: meetingId, entityRef: meeting.title, settings: options.settings },
  );

  logOfficeHub(actor, 'Respond to Invitation', { response, message: options.message ?? undefined }, { recordId: meetingId, recordRef: meeting.title });
}

/** Chase the people who have not answered (§13). */
export async function remindNonResponders(
  actor: OfficeHubActor,
  meetingId: string,
  options: { settings?: OfficeHubSettings | null } = {},
): Promise<number> {
  const [meeting, participants] = await Promise.all([getMeeting(meetingId), listMeetingParticipants(meetingId)]);
  if (!meeting) throw new OfficeHubServiceError('That meeting no longer exists.', 'office-hub/not-found');

  const outstanding = participants.filter((participant) => participant.response === 'No Response');
  if (!outstanding.length) return 0;

  const batch = writeBatch(db);
  for (const participant of outstanding) {
    batch.update(docIn(OFFICE_HUB_COLLECTIONS.participants, participant.id), {
      remindersSent: (participant.remindersSent ?? 0) + 1,
      lastRemindedAt: new Date().toISOString(),
    });
  }
  await batch.commit();

  const notified = await notify(
    actor,
    OFFICE_HUB_NOTIFICATION_TYPES.MEETING_RESPONSE_CHASE,
    outstanding.map((participant) => participant.userId),
    meetingNotificationCopy(OFFICE_HUB_NOTIFICATION_TYPES.MEETING_RESPONSE_CHASE, meeting),
    { entityId: meetingId, entityRef: meeting.title, settings: options.settings },
  );

  logOfficeHub(actor, 'Remind Non-responders', { reminded: outstanding.length, notified }, { recordId: meetingId, recordRef: meeting.title });
  return notified;
}

/* ── attendance ──────────────────────────────────────────────────────────────────────────────── */

export async function recordAttendance(
  actor: OfficeHubActor,
  meetingId: string,
  marks: Readonly<Record<string, { status: AttendanceStatus | null; note?: string | null; checkInAt?: string | null }>>,
): Promise<number> {
  const entries = Object.entries(marks);
  if (!entries.length) return 0;

  for (const group of chunk(entries, 200)) {
    const batch = writeBatch(db);
    for (const [participantId, mark] of group) {
      batch.update(docIn(OFFICE_HUB_COLLECTIONS.participants, participantId), {
        attendance: mark.status,
        attendanceNote: mark.note ?? null,
        checkInAt: mark.checkInAt ?? (mark.status ? new Date().toISOString() : null),
        attendanceMarkedById: actor.userId,
        attendanceMarkedByName: actor.userName,
        ...withUpdateAudit(auditActorOf(actor)),
      });
    }
    await batch.commit();
  }

  logOfficeHub(actor, 'Record Attendance', { marked: entries.length }, { recordId: meetingId });
  return entries.length;
}

/* ── agenda ──────────────────────────────────────────────────────────────────────────────────── */

export async function saveAgendaItem(
  actor: OfficeHubActor,
  meetingId: string,
  item: Partial<OfficeHubAgendaItem> & { title: string },
): Promise<string> {
  if (item.id) {
    await updateDoc(docIn(OFFICE_HUB_COLLECTIONS.agenda, item.id), {
      ...clean({ ...item, id: undefined, meetingId: undefined }),
      ...withUpdateAudit(auditActorOf(actor)),
    });
    logOfficeHub(actor, 'Edit Agenda Item', { title: item.title }, { recordId: meetingId });
    return item.id;
  }

  const existing = await listAgenda(meetingId);
  const ref = await addDoc(
    col(OFFICE_HUB_COLLECTIONS.agenda),
    clean({
      meetingId,
      order: item.order ?? existing.length + 1,
      title: item.title,
      description: item.description ?? null,
      expectedOutcome: item.expectedOutcome ?? null,
      estimatedMinutes: item.estimatedMinutes ?? null,
      priority: item.priority ?? 'Medium',
      presenterId: item.presenterId ?? null,
      presenterName: item.presenterName ?? null,
      documentIds: item.documentIds ?? [],
      covered: false,
      carriedFromMeetingId: item.carriedFromMeetingId ?? null,
      ...withCreateAudit(auditActorOf(actor)),
    }),
  );
  logOfficeHub(actor, 'Add Agenda Item', { title: item.title }, { recordId: meetingId });
  return ref.id;
}

export async function deleteAgendaItem(actor: OfficeHubActor, meetingId: string, itemId: string): Promise<void> {
  const remaining = (await listAgenda(meetingId)).filter((item) => item.id !== itemId);
  const batch = writeBatch(db);
  batch.delete(docIn(OFFICE_HUB_COLLECTIONS.agenda, itemId));
  // Renumber in the same batch, so the list cannot be left with a gap that a later drag turns into
  // a tie.
  remaining.forEach((item, index) => {
    batch.update(docIn(OFFICE_HUB_COLLECTIONS.agenda, item.id), { order: index + 1 });
  });
  await batch.commit();
  logOfficeHub(actor, 'Delete Agenda Item', { itemId }, { recordId: meetingId });
}

export async function reorderAgendaItems(
  actor: OfficeHubActor,
  meetingId: string,
  order: readonly { id: string; order: number }[],
): Promise<void> {
  const batch = writeBatch(db);
  for (const entry of order) {
    batch.update(docIn(OFFICE_HUB_COLLECTIONS.agenda, entry.id), { order: entry.order });
  }
  await batch.commit();
  logOfficeHub(actor, 'Reorder Agenda', { items: order.length }, { recordId: meetingId });
}

export async function markAgendaItemCovered(
  actor: OfficeHubActor,
  itemId: string,
  covered: boolean,
  note?: string | null,
): Promise<void> {
  await updateDoc(docIn(OFFICE_HUB_COLLECTIONS.agenda, itemId), {
    covered,
    coveredAt: covered ? new Date().toISOString() : null,
    ...(note != null ? { discussionNote: note } : {}),
    ...withUpdateAudit(auditActorOf(actor)),
  });
}

/* ── meeting notes ───────────────────────────────────────────────────────────────────────────── */

export function subscribeMeetingNotes(
  meetingId: string,
  onChange: (notes: OfficeHubMeetingNotes | null) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    docIn(OFFICE_HUB_COLLECTIONS.notes, meetingId),
    (snapshot) =>
      onChange(snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as OfficeHubMeetingNotes) : null),
    (error) => {
      console.error('[office-hub] Notes listener error', error);
      onError?.(error);
    },
  );
}

export async function getMeetingNotes(meetingId: string): Promise<OfficeHubMeetingNotes | null> {
  const snapshot = await getDoc(docIn(OFFICE_HUB_COLLECTIONS.notes, meetingId));
  return snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as OfficeHubMeetingNotes) : null;
}

/**
 * Auto-save the notes (§20).
 *
 * Written under the meeting's own id, so there is exactly one notes document per meeting however
 * many times auto-save fires. The plain-text mirror is derived here rather than at read time
 * because search cannot look inside markup and stripping tags at query time would mean downloading
 * every note to find one.
 */
export async function saveMeetingNotes(
  actor: OfficeHubActor,
  meetingId: string,
  html: string,
  options: { notifyMentions?: boolean; meetingTitle?: string; settings?: OfficeHubSettings | null } = {},
): Promise<void> {
  const mentioned = extractMentions(html);
  await setDoc(
    docIn(OFFICE_HUB_COLLECTIONS.notes, meetingId),
    clean({
      meetingId,
      html,
      plainText: htmlToPlainText(html),
      mentionedUserIds: mentioned,
      lastSavedAt: serverTimestamp(),
      lastSavedByName: actor.userName,
      ...withUpdateAudit(auditActorOf(actor)),
    }),
    { merge: true },
  );

  if (options.notifyMentions && mentioned.length) {
    await notify(
      actor,
      OFFICE_HUB_NOTIFICATION_TYPES.TASK_MENTION,
      mentioned,
      {
        title: `${actor.userName} mentioned you in meeting notes`,
        body: `In ${options.meetingTitle ?? 'a meeting'}`,
        link: `${OFFICE_HUB_BASE_PATH}/meetings/${meetingId}`,
      },
      { entityId: meetingId, settings: options.settings },
    );
  }
}

/* ── decisions ───────────────────────────────────────────────────────────────────────────────── */

export async function listDecisions(options: {
  meetingId?: string;
  ownerId?: string;
  limit?: number;
} = {}): Promise<OfficeHubDecision[]> {
  const constraints: QueryConstraint[] = [];
  if (options.meetingId) constraints.push(where('meetingId', '==', options.meetingId));
  if (options.ownerId) constraints.push(where('ownerId', '==', options.ownerId));
  constraints.push(orderBy('decisionDate', 'desc'), fsLimit(options.limit ?? 200));

  const snapshot = await getDocs(query(col(OFFICE_HUB_COLLECTIONS.decisions), ...constraints));
  return mapDocs<OfficeHubDecision>(snapshot).filter((decision) => !decision.isDeleted);
}

export async function getDecision(decisionId: string): Promise<OfficeHubDecision | null> {
  const snapshot = await getDoc(docIn(OFFICE_HUB_COLLECTIONS.decisions, decisionId));
  return snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as OfficeHubDecision) : null;
}

export async function createDecision(
  actor: OfficeHubActor,
  input: Omit<OfficeHubDecision, 'id' | 'reference' | 'status'> & { status?: OfficeHubDecision['status'] },
  options: { settings?: OfficeHubSettings | null } = {},
): Promise<string> {
  const reference = await allocateReference(OFFICE_HUB_REFERENCE_PREFIXES.decision, input.decisionDate);
  const ref = await addDoc(
    col(OFFICE_HUB_COLLECTIONS.decisions),
    clean({
      ...input,
      reference,
      status: input.status ?? 'Open',
      isDeleted: false,
      organizationId: actor.organizationId ?? null,
      ...withCreateAudit(auditActorOf(actor)),
    }),
  );

  await notify(
    actor,
    OFFICE_HUB_NOTIFICATION_TYPES.DECISION_ASSIGNED,
    [input.ownerId],
    decisionNotificationCopy(
      OFFICE_HUB_NOTIFICATION_TYPES.DECISION_ASSIGNED,
      { id: ref.id, title: input.title, reference, dueDate: input.dueDate, meetingTitle: input.meetingTitle },
      { actorName: actor.userName },
    ),
    { entityId: ref.id, entityRef: reference, settings: options.settings },
  );

  logOfficeHub(actor, 'Create Decision', { title: input.title, owner: input.ownerName, meetingId: input.meetingId ?? undefined }, { recordId: ref.id, recordRef: reference });
  return ref.id;
}

export async function updateDecision(
  actor: OfficeHubActor,
  decisionId: string,
  patch: Partial<OfficeHubDecision>,
  options: { settings?: OfficeHubSettings | null } = {},
): Promise<void> {
  const existing = await getDecision(decisionId);
  await updateDoc(docIn(OFFICE_HUB_COLLECTIONS.decisions, decisionId), {
    ...clean({ ...patch, id: undefined }),
    ...(patch.status === 'Completed' ? { closedAt: new Date().toISOString() } : {}),
    ...withUpdateAudit(auditActorOf(actor)),
  });

  // Only an ownership change is worth a notification: the new owner has just acquired work they did
  // not know about. Everything else is visible on the register.
  if (existing && patch.ownerId && patch.ownerId !== existing.ownerId) {
    await notify(
      actor,
      OFFICE_HUB_NOTIFICATION_TYPES.DECISION_ASSIGNED,
      [patch.ownerId],
      decisionNotificationCopy(
        OFFICE_HUB_NOTIFICATION_TYPES.DECISION_ASSIGNED,
        { id: decisionId, title: patch.title ?? existing.title, reference: existing.reference, dueDate: patch.dueDate ?? existing.dueDate, meetingTitle: existing.meetingTitle },
        { actorName: actor.userName },
      ),
      { entityId: decisionId, entityRef: existing.reference, settings: options.settings },
    );
  }

  logOfficeHub(actor, 'Edit Decision', { changes: Object.keys(patch) }, { recordId: decisionId, recordRef: existing?.reference });
}

export async function archiveDecision(actor: OfficeHubActor, decisionId: string): Promise<void> {
  await updateDoc(docIn(OFFICE_HUB_COLLECTIONS.decisions, decisionId), withSoftDeleteAudit(auditActorOf(actor)));
  logOfficeHub(actor, 'Archive Decision', {}, { recordId: decisionId });
}

/* ── action items ────────────────────────────────────────────────────────────────────────────── */

export async function listActionItems(options: {
  meetingId?: string;
  seriesId?: string;
  responsibleUserId?: string;
  limit?: number;
} = {}): Promise<OfficeHubActionItem[]> {
  const constraints: QueryConstraint[] = [];
  if (options.meetingId) constraints.push(where('meetingId', '==', options.meetingId));
  else if (options.seriesId) constraints.push(where('seriesId', '==', options.seriesId));
  if (options.responsibleUserId) constraints.push(where('responsibleUserId', '==', options.responsibleUserId));
  constraints.push(fsLimit(options.limit ?? 300));

  const snapshot = await getDocs(query(col(OFFICE_HUB_COLLECTIONS.actionItems), ...constraints));
  return mapDocs<OfficeHubActionItem>(snapshot).filter((item) => !item.isDeleted);
}

export async function createActionItem(
  actor: OfficeHubActor,
  input: Omit<OfficeHubActionItem, 'id' | 'reference' | 'status'> & { status?: OfficeHubActionItem['status'] },
  options: { settings?: OfficeHubSettings | null } = {},
): Promise<string> {
  const reference = await allocateReference(
    OFFICE_HUB_REFERENCE_PREFIXES.actionItem,
    input.meetingDate ?? todayInZone(),
  );
  const ref = await addDoc(
    col(OFFICE_HUB_COLLECTIONS.actionItems),
    clean({
      ...input,
      reference,
      status: input.status ?? 'Open',
      taskId: null,
      isDeleted: false,
      organizationId: actor.organizationId ?? null,
      ...withCreateAudit(auditActorOf(actor)),
    }),
  );

  await notify(
    actor,
    OFFICE_HUB_NOTIFICATION_TYPES.ACTION_ITEM_ASSIGNED,
    [input.responsibleUserId],
    {
      title: `Action item: ${input.title}`,
      body: `${actor.userName} made you responsible for ${reference}${input.meetingTitle ? ` from ${input.meetingTitle}` : ''}.`,
      link: input.meetingId ? `${OFFICE_HUB_BASE_PATH}/meetings/${input.meetingId}` : `${OFFICE_HUB_BASE_PATH}/action-items`,
    },
    { entityId: ref.id, entityRef: reference, settings: options.settings },
  );

  logOfficeHub(actor, 'Create Action Item', { title: input.title, meetingId: input.meetingId ?? undefined }, { recordId: ref.id, recordRef: reference });
  return ref.id;
}

export async function updateActionItem(
  actor: OfficeHubActor,
  itemId: string,
  patch: Partial<OfficeHubActionItem>,
): Promise<void> {
  await updateDoc(docIn(OFFICE_HUB_COLLECTIONS.actionItems, itemId), {
    ...clean({ ...patch, id: undefined }),
    ...(patch.status === 'Completed' ? { completedAt: new Date().toISOString() } : {}),
    ...withUpdateAudit(auditActorOf(actor)),
  });
  logOfficeHub(actor, 'Edit Action Item', { changes: Object.keys(patch) }, { recordId: itemId });
}

export async function archiveActionItem(actor: OfficeHubActor, itemId: string): Promise<void> {
  await updateDoc(docIn(OFFICE_HUB_COLLECTIONS.actionItems, itemId), withSoftDeleteAudit(auditActorOf(actor)));
  logOfficeHub(actor, 'Archive Action Item', {}, { recordId: itemId });
}

/**
 * Carry unfinished action items into a new meeting (§70).
 *
 * The original item is *pointed at* the new meeting rather than moved: its history belongs to the
 * meeting that raised it, and "this was first raised in July" is exactly the fact a chase needs.
 */
export async function carryActionItemsForward(
  actor: OfficeHubActor,
  itemIds: readonly string[],
  target: Pick<OfficeHubMeeting, 'id' | 'title' | 'date'>,
): Promise<number> {
  if (!itemIds.length) return 0;
  const batch = writeBatch(db);
  for (const itemId of itemIds) {
    batch.update(docIn(OFFICE_HUB_COLLECTIONS.actionItems, itemId), {
      carriedToMeetingId: target.id,
      ...withUpdateAudit(auditActorOf(actor)),
    });
  }
  await batch.commit();
  logOfficeHub(actor, 'Carry Forward Action Items', { count: itemIds.length, toMeeting: target.title }, { recordId: target.id });
  return itemIds.length;
}

/* ── tasks ───────────────────────────────────────────────────────────────────────────────────── */

export interface TaskQueryOptions {
  statuses?: TaskStatus[];
  limit?: number;
  includeClosed?: boolean;
}

function taskConstraints(
  scope: 'mine' | 'created' | 'team' | 'department' | 'all',
  viewer: { userId: string; departmentId?: string | null; teamIds?: string[] },
  options: TaskQueryOptions,
): QueryConstraint[] {
  const constraints: QueryConstraint[] = [];
  switch (scope) {
    case 'mine':
      constraints.push(where('assigneeId', '==', viewer.userId));
      break;
    case 'created':
      constraints.push(where('createdBy', '==', viewer.userId));
      break;
    case 'team':
      constraints.push(where('teamId', 'in', (viewer.teamIds ?? ['__none__']).slice(0, 30)));
      break;
    case 'department':
      constraints.push(where('departmentId', '==', viewer.departmentId ?? '__none__'));
      break;
    case 'all':
    default:
      break;
  }
  constraints.push(fsLimit(options.limit ?? 300));
  return constraints;
}

export async function listTasks(
  scope: 'mine' | 'created' | 'team' | 'department' | 'all',
  viewer: { userId: string; departmentId?: string | null; teamIds?: string[] },
  options: TaskQueryOptions = {},
): Promise<OfficeHubTask[]> {
  const snapshot = await getDocs(query(col(OFFICE_HUB_COLLECTIONS.tasks), ...taskConstraints(scope, viewer, options)));
  return mapDocs<OfficeHubTask>(snapshot)
    .filter((task) => !task.isDeleted)
    .filter((task) => (options.statuses?.length ? options.statuses.includes(task.status) : true))
    .sort((a, b) => (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31'));
}

/** Tasks the viewer is involved in through any route, for "My Tasks" (§25). */
export async function listMyTasks(userId: string, options: TaskQueryOptions = {}): Promise<OfficeHubTask[]> {
  const [assigned, watching] = await Promise.all([
    getDocs(query(col(OFFICE_HUB_COLLECTIONS.tasks), where('assigneeId', '==', userId), fsLimit(options.limit ?? 300))),
    getDocs(
      query(
        col(OFFICE_HUB_COLLECTIONS.tasks),
        where('watcherUserIds', 'array-contains', userId),
        fsLimit(options.limit ?? 300),
      ),
    ).catch(() => null),
  ]);

  const byId = new Map<string, OfficeHubTask>();
  for (const task of mapDocs<OfficeHubTask>(assigned)) byId.set(task.id, task);
  if (watching) for (const task of mapDocs<OfficeHubTask>(watching)) byId.set(task.id, task);

  return [...byId.values()]
    .filter((task) => !task.isDeleted)
    .filter((task) => (options.statuses?.length ? options.statuses.includes(task.status) : true))
    .sort((a, b) => (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31'));
}

export async function getTask(taskId: string): Promise<OfficeHubTask | null> {
  const snapshot = await getDoc(docIn(OFFICE_HUB_COLLECTIONS.tasks, taskId));
  return snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as OfficeHubTask) : null;
}

export function subscribeTask(
  taskId: string,
  onChange: (task: OfficeHubTask | null) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    docIn(OFFICE_HUB_COLLECTIONS.tasks, taskId),
    (snapshot) => onChange(snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as OfficeHubTask) : null),
    (error) => {
      console.error('[office-hub] Task listener error', error);
      onError?.(error);
    },
  );
}

export async function listTasksForMeeting(meetingId: string): Promise<OfficeHubTask[]> {
  const snapshot = await getDocs(
    query(col(OFFICE_HUB_COLLECTIONS.tasks), where('meetingId', '==', meetingId), fsLimit(200)),
  );
  return mapDocs<OfficeHubTask>(snapshot).filter((task) => !task.isDeleted);
}

export interface CreateTaskInput {
  title: string;
  description?: string | null;
  assigneeId?: string | null;
  assigneeName?: string | null;
  teamId?: string | null;
  teamName?: string | null;
  departmentId?: string | null;
  departmentName?: string | null;
  startDate?: IsoDate | null;
  dueDate?: IsoDate | null;
  priority: OfficeHubPriority;
  status?: TaskStatus;
  progress?: number;
  tags?: string[];
  meetingId?: string | null;
  meetingTitle?: string | null;
  actionItemId?: string | null;
  decisionId?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  parentTaskId?: string | null;
  parentTaskTitle?: string | null;
  subtasks?: TaskSubtask[];
}

export async function createTask(
  actor: OfficeHubActor,
  input: CreateTaskInput,
  options: { settings?: OfficeHubSettings | null; teamLeaderId?: string | null } = {},
): Promise<string> {
  const settings = settingsOrDefaults(options.settings);
  const startDate = input.startDate ?? todayInZone(settings.defaultTimeZone);
  const reference = await allocateReference(OFFICE_HUB_REFERENCE_PREFIXES.task, startDate);

  const watchers = mergeWatchers([], actor.userId, input.assigneeId, options.teamLeaderId);
  const fields = clean({
    ...input,
    reference,
    startDate,
    status: input.status ?? 'Not Started',
    progress: clampPercent(input.progress ?? 0),
    subtasks: input.subtasks ?? [],
    dependencies: [],
    documentIds: [],
    watcherUserIds: watchers,
    commentCount: 0,
    isDeleted: false,
    organizationId: actor.organizationId ?? null,
  });

  const ref = await addDoc(col(OFFICE_HUB_COLLECTIONS.tasks), {
    ...fields,
    ...withCreateAudit(auditActorOf(actor)),
  });
  // Built from `fields`, not from what was written: see the note in `createMeeting`.
  const task = { ...fields, id: ref.id } as OfficeHubTask;

  await writeTaskActivity(actor, ref.id, [
    { kind: 'created', summary: `Task created${input.meetingTitle ? ` from ${input.meetingTitle}` : ''}` },
    ...(input.assigneeName ? [{ kind: 'assigned', summary: `Assigned to ${input.assigneeName}` }] : []),
  ]);

  if (input.assigneeId) {
    await Promise.all([
      notify(
        actor,
        OFFICE_HUB_NOTIFICATION_TYPES.TASK_ASSIGNED,
        [input.assigneeId],
        taskNotificationCopy(OFFICE_HUB_NOTIFICATION_TYPES.TASK_ASSIGNED, task, { actorName: actor.userName }),
        { entityId: ref.id, entityRef: reference, settings },
      ),
      scheduleTaskReminders(task, settings),
    ]);
  }

  if (input.actionItemId) {
    // Closes §23's loop: the action item now knows its task, so the button becomes "View Task".
    await updateDoc(docIn(OFFICE_HUB_COLLECTIONS.actionItems, input.actionItemId), {
      taskId: ref.id,
      ...withUpdateAudit(auditActorOf(actor)),
    }).catch(() => {});
  }

  logOfficeHub(
    actor,
    'Create Task',
    {
      title: input.title,
      assignee: input.assigneeName ?? input.teamName ?? 'Unassigned',
      dueDate: input.dueDate ?? undefined,
      fromMeeting: input.meetingTitle ?? undefined,
      fromActionItem: input.actionItemId ?? undefined,
    },
    { recordId: ref.id, recordRef: reference },
  );

  return ref.id;
}

/**
 * Update a task, write its activity trail, and notify the people affected (§27, §31).
 *
 * The activity entries come from the diff rather than the form, so an edit that changed nothing
 * writes nothing — a timeline padded with "updated the task" entries that name no change buries the
 * ones that do.
 */
export async function updateTask(
  actor: OfficeHubActor,
  taskId: string,
  patch: Partial<OfficeHubTask>,
  options: { settings?: OfficeHubSettings | null } = {},
): Promise<void> {
  const existing = await getTask(taskId);
  if (!existing) throw new OfficeHubServiceError('That task no longer exists.', 'office-hub/not-found');
  const settings = settingsOrDefaults(options.settings);

  const next = { ...existing, ...patch } as OfficeHubTask;
  const update: Record<string, unknown> = clean({ ...patch, id: undefined });

  // Progress is derived from subtasks whenever there are any, so it cannot be left stale by an edit
  // that ticked one.
  update.progress = taskProgress(next);

  if (patch.status === 'Completed' && existing.status !== 'Completed') {
    update.completedAt = new Date().toISOString();
    update.completedById = actor.userId;
    update.completedByName = actor.userName;
    update.progress = 100;
  }
  if (existing.status === 'Completed' && patch.status && patch.status !== 'Completed') {
    update.reopenedAt = new Date().toISOString();
    update.completedAt = null;
  }

  if (patch.assigneeId && patch.assigneeId !== existing.assigneeId) {
    update.watcherUserIds = mergeWatchers(existing.watcherUserIds, patch.assigneeId, actor.userId);
  }

  await updateDoc(docIn(OFFICE_HUB_COLLECTIONS.tasks, taskId), {
    ...update,
    ...withUpdateAudit(auditActorOf(actor)),
  });

  const drafts = describeTaskChanges(existing, next);
  if (drafts.length) await writeTaskActivity(actor, taskId, drafts);

  const updated = { ...next, ...update } as OfficeHubTask;

  if (patch.assigneeId && patch.assigneeId !== existing.assigneeId) {
    await Promise.all([
      notify(
        actor,
        existing.assigneeId ? OFFICE_HUB_NOTIFICATION_TYPES.TASK_REASSIGNED : OFFICE_HUB_NOTIFICATION_TYPES.TASK_ASSIGNED,
        [patch.assigneeId],
        taskNotificationCopy(
          existing.assigneeId ? OFFICE_HUB_NOTIFICATION_TYPES.TASK_REASSIGNED : OFFICE_HUB_NOTIFICATION_TYPES.TASK_ASSIGNED,
          updated,
          { actorName: actor.userName },
        ),
        { entityId: taskId, entityRef: existing.reference, settings },
      ),
      // The old assignee's reminders are theirs no longer.
      existing.assigneeId ? cancelRemindersFor('task', taskId, existing.assigneeId) : Promise.resolve(),
      scheduleTaskReminders(updated, settings),
    ]);
  } else if (patch.dueDate !== undefined && patch.dueDate !== existing.dueDate) {
    await cancelRemindersFor('task', taskId);
    await scheduleTaskReminders(updated, settings);
  }

  if (patch.status === 'Completed' && existing.status !== 'Completed') {
    await Promise.all([
      notify(
        actor,
        OFFICE_HUB_NOTIFICATION_TYPES.TASK_COMPLETED,
        existing.watcherUserIds ?? [],
        taskNotificationCopy(OFFICE_HUB_NOTIFICATION_TYPES.TASK_COMPLETED, updated, { actorName: actor.userName }),
        { entityId: taskId, entityRef: existing.reference, settings },
      ),
      cancelRemindersFor('task', taskId),
    ]);

    // A task raised from an action item closes it. Without this the action item register keeps
    // reporting work that is finished, which is the fastest way to make people stop trusting it.
    if (existing.actionItemId) {
      await updateDoc(docIn(OFFICE_HUB_COLLECTIONS.actionItems, existing.actionItemId), {
        status: 'Completed',
        completedAt: new Date().toISOString(),
        ...withUpdateAudit(auditActorOf(actor)),
      }).catch(() => {});
    }
  } else if (patch.status && patch.status !== existing.status) {
    await notify(
      actor,
      OFFICE_HUB_NOTIFICATION_TYPES.TASK_STATUS,
      existing.watcherUserIds ?? [],
      taskNotificationCopy(OFFICE_HUB_NOTIFICATION_TYPES.TASK_STATUS, updated, {
        actorName: actor.userName,
        status: patch.status,
      }),
      { entityId: taskId, entityRef: existing.reference, settings },
    );
  }

  logOfficeHub(
    actor,
    patch.status === 'Completed' ? 'Complete Task' : 'Edit Task',
    { changes: drafts.map((draft) => draft.summary) },
    { recordId: taskId, recordRef: existing.reference },
  );
}

/** Kanban drag: status only, with the same trail and notifications a full edit would write. */
export async function setTaskStatus(
  actor: OfficeHubActor,
  taskId: string,
  status: TaskStatus,
  options: { settings?: OfficeHubSettings | null } = {},
): Promise<void> {
  await updateTask(actor, taskId, { status }, options);
}

export async function archiveTask(actor: OfficeHubActor, taskId: string, reason?: string): Promise<void> {
  const existing = await getTask(taskId);
  await updateDoc(docIn(OFFICE_HUB_COLLECTIONS.tasks, taskId), {
    ...withSoftDeleteAudit(auditActorOf(actor)),
  });
  await cancelRemindersFor('task', taskId);
  await writeTaskActivity(actor, taskId, [{ kind: 'archived', summary: `Task removed${reason ? `: ${reason}` : ''}` }]);
  logOfficeHub(actor, 'Archive Task', { reason }, { recordId: taskId, recordRef: existing?.reference });
}

/* ── subtasks and dependencies ───────────────────────────────────────────────────────────────── */

export async function saveSubtasks(
  actor: OfficeHubActor,
  taskId: string,
  subtasks: readonly TaskSubtask[],
): Promise<void> {
  const existing = await getTask(taskId);
  if (!existing) throw new OfficeHubServiceError('That task no longer exists.', 'office-hub/not-found');

  const ordered = subtasks.map((subtask, index) => ({ ...subtask, order: index + 1 }));
  const progress = taskProgress({ ...existing, subtasks: ordered });

  await updateDoc(docIn(OFFICE_HUB_COLLECTIONS.tasks, taskId), {
    subtasks: ordered,
    progress,
    ...withUpdateAudit(auditActorOf(actor)),
  });

  const before = existing.subtasks ?? [];
  const doneBefore = before.filter((subtask) => subtask.done).length;
  const doneAfter = ordered.filter((subtask) => subtask.done).length;
  if (before.length !== ordered.length || doneBefore !== doneAfter) {
    await writeTaskActivity(actor, taskId, [
      {
        kind: 'subtask-changed',
        summary: `Checklist now ${doneAfter} of ${ordered.length} complete`,
      },
    ]);
  }
}

/**
 * Add a dependency, and its mirror on the other task.
 *
 * Both ends are written so the graph stays symmetric: a task that blocks another must say so, or
 * the person looking at the blocking task has no idea anything is waiting on them.
 */
export async function addTaskDependency(
  actor: OfficeHubActor,
  taskId: string,
  dependency: TaskDependency,
): Promise<void> {
  const [task, other] = await Promise.all([getTask(taskId), getTask(dependency.taskId)]);
  if (!task) throw new OfficeHubServiceError('That task no longer exists.', 'office-hub/not-found');
  if (!other) throw new OfficeHubServiceError('The task you linked to no longer exists.', 'office-hub/not-found');

  const batch = writeBatch(db);
  batch.update(docIn(OFFICE_HUB_COLLECTIONS.tasks, taskId), {
    dependencies: arrayUnion(dependency),
    ...withUpdateAudit(auditActorOf(actor)),
  });
  batch.update(docIn(OFFICE_HUB_COLLECTIONS.tasks, dependency.taskId), {
    dependencies: arrayUnion({
      type: inverseDependencyType(dependency.type),
      taskId,
      taskTitle: task.title,
      taskReference: task.reference,
    }),
  });
  await batch.commit();

  await writeTaskActivity(actor, taskId, [
    { kind: 'dependency-changed', summary: `Linked as ${dependency.type} ${dependency.taskTitle}` },
  ]);
  logOfficeHub(actor, 'Add Task Dependency', { type: dependency.type, to: dependency.taskTitle }, { recordId: taskId, recordRef: task.reference });
}

export async function removeTaskDependency(
  actor: OfficeHubActor,
  taskId: string,
  dependency: TaskDependency,
): Promise<void> {
  const task = await getTask(taskId);
  const batch = writeBatch(db);
  batch.update(docIn(OFFICE_HUB_COLLECTIONS.tasks, taskId), {
    dependencies: arrayRemove(dependency),
    ...withUpdateAudit(auditActorOf(actor)),
  });
  if (task) {
    batch.update(docIn(OFFICE_HUB_COLLECTIONS.tasks, dependency.taskId), {
      dependencies: arrayRemove({
        type: inverseDependencyType(dependency.type),
        taskId,
        taskTitle: task.title,
        taskReference: task.reference ?? null,
      }),
    });
  }
  await batch.commit();
  await writeTaskActivity(actor, taskId, [
    { kind: 'dependency-changed', summary: `Unlinked from ${dependency.taskTitle}` },
  ]);
}

/* ── task comments and activity ──────────────────────────────────────────────────────────────── */

export function subscribeTaskComments(
  taskId: string,
  onChange: (comments: OfficeHubTaskComment[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(col(OFFICE_HUB_COLLECTIONS.taskComments), where('taskId', '==', taskId), orderBy('createdAt', 'asc'), fsLimit(200)),
    (snapshot) => onChange(mapDocs<OfficeHubTaskComment>(snapshot)),
    (error) => {
      console.error('[office-hub] Comments listener error', error);
      onError?.(error);
    },
  );
}

export async function addTaskComment(
  actor: OfficeHubActor,
  taskId: string,
  body: string,
  options: { parentCommentId?: string | null; settings?: OfficeHubSettings | null } = {},
): Promise<string> {
  const task = await getTask(taskId);
  if (!task) throw new OfficeHubServiceError('That task no longer exists.', 'office-hub/not-found');
  if (!body.trim()) throw new OfficeHubServiceError('Write something first.', 'office-hub/empty-comment');

  const mentioned = extractMentions(body);
  const ref = await addDoc(
    col(OFFICE_HUB_COLLECTIONS.taskComments),
    clean({
      taskId,
      kind: 'comment',
      body: body.trim(),
      parentCommentId: options.parentCommentId ?? null,
      mentionedUserIds: mentioned,
      documentIds: [],
      ...withCreateAudit(auditActorOf(actor)),
    }),
  );

  await updateDoc(docIn(OFFICE_HUB_COLLECTIONS.tasks, taskId), {
    commentCount: (task.commentCount ?? 0) + 1,
    // Commenting makes you a watcher: you have shown an interest, and you should hear what happens.
    watcherUserIds: mergeWatchers(task.watcherUserIds, actor.userId, ...mentioned),
    ...withUpdateAudit(auditActorOf(actor)),
  });

  const plain = stripMentionMarkup(body);
  const mentionSet = new Set(mentioned);
  const others = (task.watcherUserIds ?? []).filter((userId) => !mentionSet.has(userId));

  await Promise.all([
    mentioned.length
      ? notify(
          actor,
          OFFICE_HUB_NOTIFICATION_TYPES.TASK_MENTION,
          mentioned,
          taskNotificationCopy(OFFICE_HUB_NOTIFICATION_TYPES.TASK_MENTION, task, {
            actorName: actor.userName,
            comment: plain,
          }),
          { entityId: taskId, entityRef: task.reference, settings: options.settings },
        )
      : Promise.resolve(0),
    others.length
      ? notify(
          actor,
          OFFICE_HUB_NOTIFICATION_TYPES.TASK_COMMENT,
          others,
          taskNotificationCopy(OFFICE_HUB_NOTIFICATION_TYPES.TASK_COMMENT, task, {
            actorName: actor.userName,
            comment: plain,
          }),
          { entityId: taskId, entityRef: task.reference, settings: options.settings },
        )
      : Promise.resolve(0),
  ]);

  await writeTaskActivity(actor, taskId, [{ kind: 'comment-added', summary: 'Comment added' }]);
  return ref.id;
}

export async function listTaskActivity(taskId: string): Promise<OfficeHubTaskActivity[]> {
  const snapshot = await getDocs(
    query(col(OFFICE_HUB_COLLECTIONS.taskActivity), where('taskId', '==', taskId), orderBy('at', 'desc'), fsLimit(100)),
  );
  return mapDocs<OfficeHubTaskActivity>(snapshot);
}

async function writeTaskActivity(
  actor: OfficeHubActor,
  taskId: string,
  drafts: readonly { kind: string; summary: string; field?: string | null; from?: string | null; to?: string | null }[],
): Promise<void> {
  if (!drafts.length) return;
  const at = new Date().toISOString();
  const batch = writeBatch(db);
  for (const draft of drafts) {
    batch.set(
      doc(col(OFFICE_HUB_COLLECTIONS.taskActivity)),
      clean({
        taskId,
        kind: draft.kind,
        summary: draft.summary,
        field: draft.field ?? null,
        from: draft.from ?? null,
        to: draft.to ?? null,
        actorId: actor.userId,
        actorName: actor.userName,
        at,
        ...withCreateAudit(auditActorOf(actor)),
      }),
    );
  }
  await batch.commit();
}

/* ── teams ───────────────────────────────────────────────────────────────────────────────────── */

export async function listTeams(options: { includeArchived?: boolean } = {}): Promise<OfficeHubTeam[]> {
  const snapshot = await getDocs(query(col(OFFICE_HUB_COLLECTIONS.teams), fsLimit(300)));
  return mapDocs<OfficeHubTeam>(snapshot)
    .filter((team) => (options.includeArchived ? true : team.status !== 'Archived'))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getTeam(teamId: string): Promise<OfficeHubTeam | null> {
  const snapshot = await getDoc(docIn(OFFICE_HUB_COLLECTIONS.teams, teamId));
  return snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as OfficeHubTeam) : null;
}

export async function createTeam(
  actor: OfficeHubActor,
  input: {
    name: string;
    description?: string | null;
    leaderId: string;
    leaderName: string;
    members: OfficeHubTeamMember[];
    departmentId?: string | null;
    departmentName?: string | null;
  },
  options: { settings?: OfficeHubSettings | null } = {},
): Promise<string> {
  const members = normalizeTeamMembers(input.members, input.leaderId, { name: input.leaderName });
  const ref = await addDoc(
    col(OFFICE_HUB_COLLECTIONS.teams),
    clean({
      name: input.name.trim(),
      description: input.description ?? null,
      leaderId: input.leaderId,
      leaderName: input.leaderName,
      members,
      memberUserIds: members.map((member) => member.userId),
      memberCount: members.length,
      departmentId: input.departmentId ?? null,
      departmentName: input.departmentName ?? null,
      status: 'Active',
      isDeleted: false,
      organizationId: actor.organizationId ?? null,
      ...withCreateAudit(auditActorOf(actor)),
    }),
  );

  clearOfficeHubDirectoryCache();

  await notify(
    actor,
    OFFICE_HUB_NOTIFICATION_TYPES.TEAM_ADDED,
    members.map((member) => member.userId),
    {
      title: `You were added to ${input.name}`,
      body: `${actor.userName} added you to the team, led by ${input.leaderName}.`,
      link: `${OFFICE_HUB_BASE_PATH}/teams/${ref.id}`,
    },
    { entityId: ref.id, entityRef: input.name, settings: options.settings },
  );

  logOfficeHub(actor, 'Create Team', { name: input.name, members: members.length, leader: input.leaderName }, { recordId: ref.id, recordRef: input.name });
  return ref.id;
}

export async function updateTeam(
  actor: OfficeHubActor,
  teamId: string,
  patch: Partial<Pick<OfficeHubTeam, 'name' | 'description' | 'departmentId' | 'departmentName' | 'leaderId' | 'leaderName'>> & {
    members?: OfficeHubTeamMember[];
  },
  options: { settings?: OfficeHubSettings | null } = {},
): Promise<void> {
  const existing = await getTeam(teamId);
  if (!existing) throw new OfficeHubServiceError('That team no longer exists.', 'office-hub/not-found');

  const leaderId = patch.leaderId ?? existing.leaderId;
  const leaderName = patch.leaderName ?? existing.leaderName;
  const members = normalizeTeamMembers(patch.members ?? existing.members ?? [], leaderId, { name: leaderName });

  await updateDoc(docIn(OFFICE_HUB_COLLECTIONS.teams, teamId), {
    ...clean({ ...patch, members: undefined }),
    members,
    memberUserIds: members.map((member) => member.userId),
    memberCount: members.length,
    ...withUpdateAudit(auditActorOf(actor)),
  });

  clearOfficeHubDirectoryCache();

  const before = new Set((existing.memberUserIds ?? []));
  const after = new Set(members.map((member) => member.userId));
  const added = [...after].filter((userId) => !before.has(userId));
  const removed = [...before].filter((userId) => !after.has(userId));

  await Promise.all([
    added.length
      ? notify(
          actor,
          OFFICE_HUB_NOTIFICATION_TYPES.TEAM_ADDED,
          added,
          {
            title: `You were added to ${patch.name ?? existing.name}`,
            body: `${actor.userName} added you to the team.`,
            link: `${OFFICE_HUB_BASE_PATH}/teams/${teamId}`,
          },
          { entityId: teamId, entityRef: existing.name, settings: options.settings },
        )
      : Promise.resolve(0),
    removed.length
      ? notify(
          actor,
          OFFICE_HUB_NOTIFICATION_TYPES.TEAM_REMOVED,
          removed,
          {
            title: `You were removed from ${existing.name}`,
            body: `${actor.userName} removed you from the team. Work already assigned to you is unchanged.`,
            link: `${OFFICE_HUB_BASE_PATH}/teams`,
          },
          { entityId: teamId, entityRef: existing.name, settings: options.settings },
        )
      : Promise.resolve(0),
  ]);

  logOfficeHub(
    actor,
    patch.leaderId && patch.leaderId !== existing.leaderId ? 'Change Team Leader' : 'Edit Team',
    { added: added.length, removed: removed.length, changes: Object.keys(patch) },
    { recordId: teamId, recordRef: existing.name },
  );
}

/** Archive, never delete (§6, §83): the team's historical meetings and tasks still refer to it. */
export async function archiveTeam(actor: OfficeHubActor, teamId: string, reason?: string): Promise<void> {
  await updateDoc(docIn(OFFICE_HUB_COLLECTIONS.teams, teamId), {
    status: 'Archived',
    archivedAt: serverTimestamp(),
    archivedReason: reason ?? null,
    ...withUpdateAudit(auditActorOf(actor)),
  });
  clearOfficeHubDirectoryCache();
  logOfficeHub(actor, 'Archive Team', { reason }, { recordId: teamId });
}

export async function restoreTeam(actor: OfficeHubActor, teamId: string): Promise<void> {
  await updateDoc(docIn(OFFICE_HUB_COLLECTIONS.teams, teamId), {
    status: 'Active',
    archivedAt: null,
    archivedReason: null,
    ...withUpdateAudit(auditActorOf(actor)),
  });
  clearOfficeHubDirectoryCache();
  logOfficeHub(actor, 'Restore Team', {}, { recordId: teamId });
}

/* ── minutes ─────────────────────────────────────────────────────────────────────────────────── */

export async function getMom(meetingId: string): Promise<OfficeHubMom | null> {
  const snapshot = await getDoc(docIn(OFFICE_HUB_COLLECTIONS.mom, meetingId));
  return snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as OfficeHubMom) : null;
}

export async function saveMom(
  actor: OfficeHubActor,
  meetingId: string,
  patch: Partial<OfficeHubMom>,
  options: { approvalRequired?: boolean } = {},
): Promise<void> {
  const existing = await getMom(meetingId);
  const reference =
    existing?.reference ??
    (await allocateReference(OFFICE_HUB_REFERENCE_PREFIXES.mom, todayInZone()));

  await setDoc(
    docIn(OFFICE_HUB_COLLECTIONS.mom, meetingId),
    clean({
      meetingId,
      reference,
      stage: existing?.stage ?? 'Draft',
      approvalRequired: options.approvalRequired ?? existing?.approvalRequired ?? false,
      ...patch,
      ...(existing ? withUpdateAudit(auditActorOf(actor)) : withCreateAudit(auditActorOf(actor))),
    }),
    { merge: true },
  );
  logOfficeHub(actor, 'Save Minutes', { fields: Object.keys(patch) }, { recordId: meetingId, recordRef: reference });
}

/**
 * Move the minutes to a stage, and record who did it (§46).
 *
 * The stage history is append-only, and the per-stage stamps (`preparedById`, `reviewedById`,
 * `approvedById`) are written alongside it — those are what `canAdvanceMinutes` reads to refuse
 * letting one person hold two signatures on the same minutes.
 */
export async function advanceMom(
  actor: OfficeHubActor,
  meetingId: string,
  stage: MomStage,
  options: { note?: string | null; settings?: OfficeHubSettings | null } = {},
): Promise<void> {
  const now = new Date().toISOString();
  const stamps: Record<string, unknown> = { stage };

  if (stage === 'Prepared') {
    stamps.preparedById = actor.userId;
    stamps.preparedByName = actor.userName;
    stamps.preparedAt = now;
  } else if (stage === 'Reviewed') {
    stamps.reviewedById = actor.userId;
    stamps.reviewedByName = actor.userName;
    stamps.reviewedAt = now;
  } else if (stage === 'Approved') {
    stamps.approvedById = actor.userId;
    stamps.approvedByName = actor.userName;
    stamps.approvedAt = now;
  } else if (stage === 'Published') {
    stamps.publishedAt = now;
  }

  const batch = writeBatch(db);
  batch.set(
    docIn(OFFICE_HUB_COLLECTIONS.mom, meetingId),
    clean({
      ...stamps,
      history: arrayUnion({ stage, at: now, byId: actor.userId, byName: actor.userName, note: options.note ?? null }),
      ...withUpdateAudit(auditActorOf(actor)),
    }),
    { merge: true },
  );
  // Mirrored onto the meeting so the register can show "minutes pending" without a second read.
  batch.update(docIn(OFFICE_HUB_COLLECTIONS.meetings, meetingId), { momStage: stage });
  await batch.commit();

  if (stage === 'Published') {
    const meeting = await getMeeting(meetingId);
    if (meeting) {
      await Promise.all([
        notify(
          actor,
          OFFICE_HUB_NOTIFICATION_TYPES.MOM_PUBLISHED,
          meeting.participantUserIds ?? [],
          meetingNotificationCopy(OFFICE_HUB_NOTIFICATION_TYPES.MOM_PUBLISHED, meeting),
          { entityId: meetingId, entityRef: meeting.title, settings: options.settings },
        ),
        setDoc(
          docIn(OFFICE_HUB_COLLECTIONS.mom, meetingId),
          {
            circulatedToUserIds: meeting.participantUserIds ?? [],
            circulatedAt: new Date().toISOString(),
          },
          { merge: true },
        ),
      ]);
    }
  }

  logOfficeHub(actor, `Minutes ${stage}`, { note: options.note ?? undefined }, { recordId: meetingId });
}

/* ── documents ───────────────────────────────────────────────────────────────────────────────── */

export async function listDocuments(
  entityType: OfficeHubEntityType,
  entityId: string,
): Promise<OfficeHubDocument[]> {
  const snapshot = await getDocs(
    query(
      col(OFFICE_HUB_COLLECTIONS.documents),
      where('entityType', '==', entityType),
      where('entityId', '==', entityId),
      fsLimit(100),
    ),
  );
  return mapDocs<OfficeHubDocument>(snapshot)
    .filter((document) => !document.isDeleted)
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

/** Every file attached to a meeting, including through its tasks and decisions (§14). */
export async function listMeetingDocuments(meetingId: string): Promise<OfficeHubDocument[]> {
  const snapshot = await getDocs(
    query(col(OFFICE_HUB_COLLECTIONS.documents), where('meetingId', '==', meetingId), fsLimit(200)),
  );
  return mapDocs<OfficeHubDocument>(snapshot).filter((document) => !document.isDeleted);
}

/**
 * Upload a file and record its metadata (§36).
 *
 * Storage is imported on demand: `firebase/storage` is a sizeable chunk and most screens in this
 * module never upload anything, so it has no business in the initial bundle — the same reasoning
 * `@/lib/firebase` gives for keeping Storage out of the app shell.
 *
 * The returned URL is *not* stored. A download URL is a bearer token that never expires; §36 is
 * explicit that files must not be exposed publicly, so the path is stored and a fresh URL is
 * minted per authenticated request.
 */
export async function uploadOfficeHubDocument(
  actor: OfficeHubActor,
  input: {
    file: File;
    entityType: OfficeHubEntityType;
    entityId: string;
    meetingId?: string | null;
    note?: string | null;
  },
  options: { settings?: OfficeHubSettings | null } = {},
): Promise<string> {
  const check = validateOfficeHubUpload({ name: input.file.name, size: input.file.size }, options.settings);
  if (!check.ok) throw new OfficeHubServiceError(check.reason ?? 'That file cannot be attached.', 'office-hub/invalid-file');

  const storagePath = officeHubStoragePath(input.entityType, input.entityId, input.file.name);
  const { getDownloadURL, ref: storageRef, uploadBytes } = await import('firebase/storage');
  const { storage } = await import('./firebase-storage');

  const objectRef = storageRef(storage, storagePath);
  await uploadBytes(objectRef, input.file, { contentType: input.file.type || 'application/octet-stream' });
  // Fetched but deliberately discarded — proves the object landed without persisting a bearer URL.
  await getDownloadURL(objectRef).catch(() => null);

  const documentRef = await addDoc(
    col(OFFICE_HUB_COLLECTIONS.documents),
    clean({
      fileName: input.file.name,
      fileSize: input.file.size,
      contentType: input.file.type || 'application/octet-stream',
      storagePath,
      entityType: input.entityType,
      entityId: input.entityId,
      meetingId: input.meetingId ?? (input.entityType === 'meeting' ? input.entityId : null),
      uploadedById: actor.userId,
      uploadedByName: actor.userName,
      uploadedAt: new Date().toISOString(),
      note: input.note ?? null,
      isDeleted: false,
      organizationId: actor.organizationId ?? null,
      ...withCreateAudit(auditActorOf(actor)),
    }),
  );

  if (input.entityType === 'task') {
    await updateDoc(docIn(OFFICE_HUB_COLLECTIONS.tasks, input.entityId), {
      documentIds: arrayUnion(documentRef.id),
    }).catch(() => {});
    await writeTaskActivity(actor, input.entityId, [
      { kind: 'attachment-added', summary: `Attached ${input.file.name}` },
    ]);
  }

  logOfficeHub(
    actor,
    'Upload Document',
    { fileName: input.file.name, size: input.file.size, entityType: input.entityType },
    { recordId: input.entityId, recordRef: input.file.name },
  );
  return documentRef.id;
}

/** A short-lived download URL, minted per request against the caller's own credentials. */
export async function getOfficeHubDocumentUrl(storagePath: string): Promise<string> {
  const { getDownloadURL, ref: storageRef } = await import('firebase/storage');
  const { storage } = await import('./firebase-storage');
  return getDownloadURL(storageRef(storage, storagePath));
}

export async function removeOfficeHubDocument(actor: OfficeHubActor, documentId: string): Promise<void> {
  // Soft delete (§83). The Storage object is left in place: a file referenced by published minutes
  // must not vanish from them because somebody tidied the attachment list.
  await updateDoc(docIn(OFFICE_HUB_COLLECTIONS.documents, documentId), withSoftDeleteAudit(auditActorOf(actor)));
  logOfficeHub(actor, 'Remove Document', {}, { recordId: documentId });
}

/* ── reminders ───────────────────────────────────────────────────────────────────────────────── */

/**
 * Write the reminder rows for a meeting (§12, §61).
 *
 * Deterministic ids mean re-saving a meeting *moves* its reminders rather than accumulating a set
 * for every time it was ever rescheduled. Each recipient's own default applies where the meeting
 * expresses none, and somebody who has turned meeting reminders off gets no row at all — so the
 * server sweep does not have to re-derive preferences at 6am under time pressure.
 */
export async function scheduleMeetingReminders(
  meeting: Pick<OfficeHubMeeting, 'id' | 'title' | 'date' | 'startTime' | 'timeZone' | 'startAt' | 'status' | 'seriesId' | 'organizationId' | 'reminderOffsets'>,
  userIds: readonly string[],
  settings: OfficeHubSettings,
): Promise<number> {
  if (!userIds.length) return 0;
  const preferences = await loadPreferencesFor(userIds);

  const drafts = buildMeetingReminders({
    meeting,
    recipients: userIds.map((userId) => {
      const stored = preferences.get(userId);
      return {
        userId,
        offsets: resolveMeetingReminderOffsets(meeting, stored, settings),
        wantsReminders: effectivePreferences(stored, settings).meetingReminders,
      };
    }),
  });
  if (!drafts.length) return 0;

  for (const group of chunk(drafts, 400)) {
    const batch = writeBatch(db);
    for (const draft of group) {
      batch.set(
        docIn(
          OFFICE_HUB_COLLECTIONS.reminders,
          reminderId(draft.entityType, draft.entityId, draft.userId, draft.kind, draft.offsetMinutes),
        ),
        clean({ ...draft, createdAt: serverTimestamp() }),
      );
    }
    await batch.commit();
  }
  return drafts.length;
}

export async function scheduleTaskReminders(
  task: Pick<OfficeHubTask, 'id' | 'title' | 'dueDate' | 'status' | 'assigneeId' | 'organizationId' | 'watcherUserIds'>,
  settings: OfficeHubSettings,
): Promise<number> {
  const recipientIds = uniqueStrings([task.assigneeId]);
  if (!recipientIds.length || !task.dueDate) return 0;

  const preferences = await loadPreferencesFor(recipientIds);
  const drafts = buildTaskReminders({
    task,
    recipients: recipientIds.map((userId) => {
      const stored = preferences.get(userId);
      return {
        userId,
        timeZone: stored?.timeZone ?? settings.defaultTimeZone,
        wantsReminders: effectivePreferences(stored, settings).taskDueReminders,
      };
    }),
    daysBefore: settings.taskDueReminderDaysBefore,
  });
  if (!drafts.length) return 0;

  const batch = writeBatch(db);
  for (const draft of drafts) {
    batch.set(
      docIn(
        OFFICE_HUB_COLLECTIONS.reminders,
        reminderId(draft.entityType, draft.entityId, draft.userId, draft.kind, draft.offsetMinutes),
      ),
      clean({ ...draft, createdAt: serverTimestamp() }),
    );
  }
  await batch.commit();
  return drafts.length;
}

/**
 * Cancel the outstanding reminders for an entity, optionally for one person.
 *
 * Cancelled rather than deleted: a reminder row that was cancelled is evidence that a reminder was
 * *not* sent, which is worth as much as evidence that one was when somebody asks why they were not
 * told.
 */
export async function cancelRemindersFor(
  entityType: OfficeHubEntityType,
  entityId: string,
  userId?: string,
): Promise<number> {
  const constraints: QueryConstraint[] = [
    where('entityType', '==', entityType),
    where('entityId', '==', entityId),
    where('status', '==', 'Scheduled'),
  ];
  if (userId) constraints.push(where('userId', '==', userId));

  const snapshot = await getDocs(query(col(OFFICE_HUB_COLLECTIONS.reminders), ...constraints, fsLimit(500)));
  if (snapshot.empty) return 0;

  for (const group of chunk(snapshot.docs, 400)) {
    const batch = writeBatch(db);
    for (const entry of group) {
      batch.update(entry.ref, { status: 'Cancelled', updatedAt: serverTimestamp() });
    }
    await batch.commit();
  }
  return snapshot.size;
}

export async function listRemindersFor(entityId: string): Promise<OfficeHubReminder[]> {
  const snapshot = await getDocs(
    query(col(OFFICE_HUB_COLLECTIONS.reminders), where('entityId', '==', entityId), fsLimit(200)),
  );
  return mapDocs<OfficeHubReminder>(snapshot);
}

/* ── templates ───────────────────────────────────────────────────────────────────────────────── */

export async function listMeetingTemplates(): Promise<OfficeHubMeetingTemplate[]> {
  const snapshot = await getDocs(query(col(OFFICE_HUB_COLLECTIONS.meetingTemplates), fsLimit(200)));
  return mapDocs<OfficeHubMeetingTemplate>(snapshot)
    .filter((template) => template.status !== 'Archived')
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function listAgendaTemplates(): Promise<OfficeHubAgendaTemplate[]> {
  const snapshot = await getDocs(query(col(OFFICE_HUB_COLLECTIONS.agendaTemplates), fsLimit(200)));
  return mapDocs<OfficeHubAgendaTemplate>(snapshot)
    .filter((template) => template.status !== 'Archived')
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveMeetingTemplate(
  actor: OfficeHubActor,
  template: Partial<OfficeHubMeetingTemplate> & { name: string },
): Promise<string> {
  if (template.id) {
    await updateDoc(docIn(OFFICE_HUB_COLLECTIONS.meetingTemplates, template.id), {
      ...clean({ ...template, id: undefined }),
      ...withUpdateAudit(auditActorOf(actor)),
    });
    logOfficeHub(actor, 'Edit Meeting Template', { name: template.name }, { recordId: template.id });
    return template.id;
  }
  const ref = await addDoc(
    col(OFFICE_HUB_COLLECTIONS.meetingTemplates),
    clean({
      status: 'Active',
      usageCount: 0,
      ...template,
      organizationId: actor.organizationId ?? null,
      ...withCreateAudit(auditActorOf(actor)),
    }),
  );
  logOfficeHub(actor, 'Create Meeting Template', { name: template.name }, { recordId: ref.id, recordRef: template.name });
  return ref.id;
}

export async function saveAgendaTemplate(
  actor: OfficeHubActor,
  template: Partial<OfficeHubAgendaTemplate> & { name: string },
): Promise<string> {
  if (template.id) {
    await updateDoc(docIn(OFFICE_HUB_COLLECTIONS.agendaTemplates, template.id), {
      ...clean({ ...template, id: undefined }),
      ...withUpdateAudit(auditActorOf(actor)),
    });
    return template.id;
  }
  const ref = await addDoc(
    col(OFFICE_HUB_COLLECTIONS.agendaTemplates),
    clean({
      status: 'Active',
      items: template.items ?? [],
      ...template,
      organizationId: actor.organizationId ?? null,
      ...withCreateAudit(auditActorOf(actor)),
    }),
  );
  logOfficeHub(actor, 'Create Agenda Template', { name: template.name }, { recordId: ref.id, recordRef: template.name });
  return ref.id;
}

export async function archiveTemplate(
  actor: OfficeHubActor,
  kind: 'meeting' | 'agenda',
  templateId: string,
): Promise<void> {
  const collectionName =
    kind === 'meeting' ? OFFICE_HUB_COLLECTIONS.meetingTemplates : OFFICE_HUB_COLLECTIONS.agendaTemplates;
  await updateDoc(docIn(collectionName, templateId), {
    status: 'Archived',
    ...withUpdateAudit(auditActorOf(actor)),
  });
  logOfficeHub(actor, 'Archive Template', { kind }, { recordId: templateId });
}

/* ── employee import ─────────────────────────────────────────────────────────────────────────── */

/**
 * Commit an employee import (§64).
 *
 * Writes only the rows the preview classified as `create` or `update`, and marks created records
 * with `source: 'office-hub-import'` so a later greytHR sync can tell a manually-added employee
 * from one it owns. See `office-hub-import.ts` for why this reconciles rather than inserts.
 */
export async function importOfficeHubEmployees(
  actor: OfficeHubActor,
  rows: readonly {
    outcome: 'create' | 'update';
    existingId: string | null;
    employeeId: string;
    name: string;
    email: string;
    mobile: string | null;
    designation: string | null;
    departmentName: string | null;
    location: string | null;
    reportingManagerId: string | null;
    reportingManagerName: string | null;
    status: 'Active' | 'Inactive';
    joiningDate: string | null;
    timeZone: string | null;
  }[],
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;

  for (const group of chunk(rows, 200)) {
    const batch = writeBatch(db);
    for (const row of group) {
      const payload = clean({
        employeeId: row.employeeId,
        name: row.name,
        email: row.email,
        phone: row.mobile ?? undefined,
        designation: row.designation ?? undefined,
        department: row.departmentName ?? undefined,
        location: row.location ?? undefined,
        reportingManagerId: row.reportingManagerId ?? undefined,
        reportingManagerName: row.reportingManagerName ?? undefined,
        status: row.status,
        dateOfJoin: row.joiningDate ?? undefined,
      });

      if (row.outcome === 'update' && row.existingId) {
        batch.set(
          docIn(OFFICE_HUB_EXTERNAL_COLLECTIONS.employees, row.existingId),
          { ...payload, ...withUpdateAudit(auditActorOf(actor)) },
          { merge: true },
        );
        updated += 1;
      } else {
        batch.set(
          doc(col(OFFICE_HUB_EXTERNAL_COLLECTIONS.employees)),
          {
            ...payload,
            source: 'office-hub-import',
            ...withCreateAudit(auditActorOf(actor)),
          },
        );
        created += 1;
      }
    }
    await batch.commit();
  }

  clearOfficeHubDirectoryCache();
  logOfficeHub(actor, 'Import Employees', { created, updated, total: rows.length });
  return { created, updated };
}

/* ── search ──────────────────────────────────────────────────────────────────────────────────── */

/**
 * Fetch the candidate set global search ranks.
 *
 * Bounded and permission-scoped by construction: the queries are the same scoped ones the registers
 * use, with a tight limit. `searchOfficeHub` then ranks in memory — see the header of
 * `office-hub-search.ts` for why that is the right trade in Firestore.
 */
export async function loadSearchCorpus(
  viewer: { userId: string; departmentId?: string | null; teamIds?: string[] },
  scopes: { meetings: 'mine' | 'department' | 'team' | 'all'; tasks: 'mine' | 'department' | 'team' | 'all' },
  options: { limit?: number } = {},
): Promise<{
  meetings: OfficeHubMeeting[];
  tasks: OfficeHubTask[];
  decisions: OfficeHubDecision[];
  actionItems: OfficeHubActionItem[];
  teams: OfficeHubTeam[];
  people: OfficeHubPerson[];
}> {
  const limit = options.limit ?? 150;
  const [meetings, tasks, decisions, actionItems, directory] = await Promise.all([
    listMeetings(scopes.meetings, viewer, { limit, direction: 'desc' }).catch(() => []),
    (scopes.tasks === 'all' ? listTasks('all', viewer, { limit }) : listMyTasks(viewer.userId, { limit })).catch(() => []),
    listDecisions({ limit }).catch(() => []),
    listActionItems({ limit }).catch(() => []),
    loadOfficeHubDirectory().catch(() => ({ people: [], departments: [], projects: [], teams: [] } as OfficeHubDirectory)),
  ]);

  return { meetings, tasks, decisions, actionItems, teams: directory.teams, people: directory.people };
}

/**
 * The Windows Agent module's entry point: collection names, routes, and a re-export of the pure
 * layers beneath it (`docs/windows-agent.md`).
 *
 * The same arrangement Office Hub uses. `windows-agent-model.ts`, `-rules.ts`, `-policy.ts` and
 * `-permissions.ts` are dependency-free so they run under `node --test`; this file is what the
 * application imports, and it is the only place a collection name is written down.
 *
 * Nothing here touches Firestore. `windows-agent-service.ts` is the browser's read path and
 * `windows-agent-server.ts` is the Admin SDK's write path; both take their collection names from
 * the constant below, so renaming one is a single edit rather than a grep.
 */

export * from './windows-agent-model.ts';
export * from './windows-agent-rules.ts';
export * from './windows-agent-policy.ts';
export * from './windows-agent-permissions.ts';

/**
 * Every collection this module owns.
 *
 * Named for what they are rather than prefixed with the module's route, matching the convention
 * the rest of the database already follows (`userSessions`, `userLogs`, `officeHubMeetings`). The
 * `windows` prefix keeps them together in the console and makes it obvious at a glance that a
 * document belongs to the desktop agent rather than to the web application's own session tracking
 * — which is a real risk, because `userSessions` already exists and means something different.
 */
export const WINDOWS_AGENT_COLLECTIONS = {
  /** One per office PC. Holds the hashed device secret; never the secret itself. */
  devices: 'windowsDevices',
  /** Who may sign in on which PC, with provenance. */
  deviceAssignments: 'windowsDeviceAssignments',
  /** Company enrolment codes, e.g. `SEL-HO-2026`. */
  enrollmentCodes: 'windowsEnrollmentCodes',
  /** One work session: a user, a device, sign-in to sign-out. */
  sessions: 'windowsSessions',
  /** Raw foreground spans. The only collection the retention job ever deletes from. */
  activityEvents: 'windowsActivityEvents',
  /** Per-session, per-application totals. */
  applicationUsage: 'windowsApplicationUsage',
  /** One document per device, overwritten — not an append-only log. See the model's §16 note. */
  heartbeats: 'windowsHeartbeats',
  /** Company/department/user/device policy documents. */
  policies: 'windowsAgentPolicies',
  /** Desktop notifications raised for the agent. */
  notifications: 'windowsNotifications',
  /** One receipt per recipient per notification, updated in place. */
  notificationReceipts: 'windowsNotificationReceipts',
  /** Published agent builds and their rings. */
  versions: 'windowsAgentVersions',
  /** Append-only administrative trail. Never updatable, by anybody. */
  auditLogs: 'windowsAuditLogs',
  /** `${userId}__${workDate}` rollups — what every report reads. */
  dailyActivity: 'windowsDailyActivity',
  /** Administrator classification of executables (§22). */
  appCatalog: 'windowsAppCatalog',
  /** Module-level settings, including §52's monitoring policy text. */
  settings: 'windowsAgentSettings',
} as const;

/** The single settings document's id. */
export const WINDOWS_AGENT_SETTINGS_DOC_ID = 'default';

/**
 * Deterministic document ids.
 *
 * Every one of these exists so a write can be a merge rather than a query-then-write. A retried
 * activity batch, a re-delivered notification and a second heartbeat in the same second all land
 * on the document they should, with no read first and no chance of a duplicate — which is §27's
 * requirement expressed as a key rather than as a check somebody has to remember.
 */
export const windowsAgentIds = {
  dailyActivity: (userId: string, workDate: string) => `${userId}__${workDate}`,
  applicationUsage: (sessionId: string, processKey: string) => `${sessionId}__${processKey}`,
  notificationReceipt: (notificationId: string, userId: string) => `${notificationId}__${userId}`,
  appCatalog: (processKey: string) => processKey,
  heartbeat: (deviceId: string) => deviceId,
} as const;

/** Every page in the module, in the order the sidebar lists them. */
export const WINDOWS_AGENT_ROUTES = {
  dashboard: '/windows-agent',
  live: '/windows-agent/live',
  devices: '/windows-agent/devices',
  device: (deviceId: string) => `/windows-agent/devices/${deviceId}`,
  users: '/windows-agent/users',
  user: (userId: string) => `/windows-agent/users/${userId}`,
  sessions: '/windows-agent/sessions',
  attendance: '/windows-agent/attendance',
  applications: '/windows-agent/applications',
  notifications: '/windows-agent/notifications',
  policies: '/windows-agent/policies',
  versions: '/windows-agent/versions',
  audit: '/windows-agent/audit',
  reports: '/windows-agent/reports',
  departmentReport: '/windows-agent/reports/departments',
  applicationReport: '/windows-agent/reports/applications',
  attendanceReport: '/windows-agent/reports/attendance',
  /** §37's employee self-view. Not gated by a grant — see `windows-agent-permissions.ts`. */
  myActivity: '/windows-agent/my-activity',
  /** §52's transparency page. */
  monitoringPolicy: '/windows-agent/monitoring-policy',
  help: '/windows-agent/help',
} as const;

/** The API surface the desktop agent talks to. Mirrored by `SEL.Agent.Core/ApiRoutes.cs`. */
export const WINDOWS_AGENT_API = {
  register: '/api/windows-agent/device/register',
  login: '/api/windows-agent/login',
  heartbeat: '/api/windows-agent/heartbeat',
  activityBatch: '/api/windows-agent/activity/batch',
  logout: '/api/windows-agent/session/logout',
  notifications: '/api/windows-agent/notifications',
  notificationAck: '/api/windows-agent/notifications/ack',
  policy: '/api/windows-agent/policy',
  version: '/api/windows-agent/version',
} as const;

/**
 * §52's monitoring policy, as installed.
 *
 * Kept in code rather than only in a settings document so that a fresh installation has something
 * truthful to show an employee on day one. An administrator can edit the text; they cannot edit
 * what the agent actually does, which is why the "never collected" list is the same list the
 * ingest route enforces.
 */
export interface MonitoringDisclosure {
  collected: string[];
  neverCollected: string[];
  optional: string[];
}

export const DEFAULT_MONITORING_DISCLOSURE: MonitoringDisclosure = {
  collected: [
    'The name of the application in the foreground, and how long it was there.',
    'Whether the keyboard and mouse were in use, or idle, or the PC was locked.',
    'Sign-in and sign-out times, and which PC they happened on.',
    'Actions taken inside SEL LIVE — which record was opened, approved or updated.',
    'The agent’s own health: its version, its queue, and whether it can reach the server.',
  ],
  neverCollected: [
    'Keystrokes. The agent contains no keyboard hook of any kind.',
    'Passwords, or the contents of any password field.',
    'Clipboard contents.',
    'The text of emails, chats or documents.',
    'Screenshots, screen recording, webcam or microphone.',
    'Browsing history, search terms, or the address of any page beyond its domain.',
    'Anything at all from a personal device — the agent runs only on company PCs.',
  ],
  optional: [
    'Window titles, sanitised — off unless an administrator enables them for your department.',
    'Website domains, without paths or search terms — off unless the managed browser extension is deployed.',
  ],
};

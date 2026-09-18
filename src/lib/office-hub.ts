/**
 * Office Hub — the module's single import point.
 *
 * Everything a screen needs comes from here: `import { … } from '@/lib/office-hub'`. The pure
 * layers are re-exported so that no component has to know which of them a given helper lives in,
 * exactly as `e-approval.ts` re-exports its policy module.
 *
 * ── The layering, and why it is this way ────────────────────────────────────────────────────────
 *
 *   office-hub-time.ts         zone arithmetic and formatting          — no imports at all
 *   office-hub-model.ts        types, enums, defaults                  — imports time
 *   office-hub-rules.ts        business rules                          — imports time + model
 *   office-hub-recurrence.ts   series expansion                        — imports time + model
 *   office-hub-reminders.ts    reminder scheduling + notification copy — imports the above
 *   office-hub-permissions.ts  authorization                           — imports access-control
 *   office-hub-reports.ts      report aggregation                      — imports the above
 *   office-hub-search.ts       search ranking and grouping             — imports the above
 *   office-hub-import.ts       employee CSV parsing                    — imports time
 *   office-hub-integrations.ts provider interfaces                     — imports time + model
 *   office-hub-google.ts       Google Meet request/response shaping    — imports model + integrations
 *   ─────────────────────────────────────────────────────────────────────────────────────────────
 *   office-hub.ts              this file: collections + re-exports     — imports firebase types
 *   office-hub-service.ts      every Firestore read and write          — imports the browser SDK
 *   office-hub-server.ts       the same, through the Admin SDK         — server only
 *   office-hub-google-server.ts Google OAuth, tokens, Calendar calls   — server only
 *   office-hub-google-client.ts registers the Meet provider            — browser only
 *
 * The line in the middle is the one that matters. Everything above it runs under
 * `node --experimental-strip-types --test` with no Firebase installed, which is why the rules are
 * tested directly rather than through a mock, and why the cron route can reach exactly the same
 * conclusions about a document as the browser does.
 */

import type { Timestamp } from 'firebase/firestore';

export * from './office-hub-time.ts';
export * from './office-hub-model.ts';
export * from './office-hub-rules.ts';
export * from './office-hub-recurrence.ts';
export * from './office-hub-reminders.ts';
export * from './office-hub-permissions.ts';
export * from './office-hub-reports.ts';
export * from './office-hub-search.ts';
export * from './office-hub-integrations.ts';
export * from './office-hub-google.ts';

/**
 * Every Firestore collection Office Hub owns.
 *
 * Prefixed `officeHub` so the module's data is legible in the console without a schema, and so
 * nothing here can ever collide with another module's collection. Three collections the spec lists
 * are deliberately absent, and their absence is the integration §89 asks for:
 *
 *   • **`notifications`** is the existing central `userNotifications` (`@/lib/notifications`), so
 *     Office Hub's alerts appear in the same header bell as every other module's rather than in a
 *     second inbox nobody checks.
 *   • **`auditLogs`** is the existing `userLogs` (`@/lib/activity-logger`), so an administrator
 *     reviewing "what did this person do" sees meetings alongside approvals and payments.
 *   • **`employees` / `departments` / `projects` / `users` / `roles`** are the app's existing
 *     masters. Office Hub reads them and stores their ids; it never becomes a second directory.
 *
 * `teamMembers` and `taskSubtasks` are absent for a different reason — they are embedded arrays on
 * their parent, because both are small, bounded, and read whenever the parent is read.
 */
export const OFFICE_HUB_COLLECTIONS = {
  meetings: 'officeHubMeetings',
  participants: 'officeHubParticipants',
  agenda: 'officeHubAgenda',
  notes: 'officeHubNotes',
  attendanceLog: 'officeHubAttendanceLog',

  decisions: 'officeHubDecisions',
  actionItems: 'officeHubActionItems',

  tasks: 'officeHubTasks',
  taskComments: 'officeHubTaskComments',
  taskActivity: 'officeHubTaskActivity',

  teams: 'officeHubTeams',
  documents: 'officeHubDocuments',
  reminders: 'officeHubReminders',
  mom: 'officeHubMom',

  meetingTemplates: 'officeHubMeetingTemplates',
  agendaTemplates: 'officeHubAgendaTemplates',

  settings: 'officeHubSettings',
  userSettings: 'officeHubUserSettings',
  counters: 'officeHubCounters',

  /**
   * Per-user Google authorisations. **Server-only, by rule.**
   *
   * `firestore.rules` denies every client read and write here, which is unlike every other
   * collection in this map: the documents hold encrypted Google refresh tokens, and a refresh token
   * is a standing grant to act as that person in Google Calendar. Nothing in `office-hub-service.ts`
   * reads it; `office-hub-google-server.ts` is the only accessor, and the browser learns the
   * connection state from `/api/office-hub/google/status` as a redacted view.
   */
  googleConnections: 'officeHubGoogleConnections',
} as const;

/** The masters Office Hub reads but does not own. Named so the dependency is explicit. */
export const OFFICE_HUB_EXTERNAL_COLLECTIONS = {
  users: 'users',
  roles: 'roles',
  employees: 'employees',
  departments: 'departments',
  projects: 'projects',
  notifications: 'userNotifications',
  activityLogs: 'userLogs',
} as const;

/** The single settings document. */
export const OFFICE_HUB_SETTINGS_DOC_ID = 'global';

/** Reference prefixes, one per numbered entity. */
export const OFFICE_HUB_REFERENCE_PREFIXES = {
  task: 'TSK',
  decision: 'DEC',
  actionItem: 'ACT',
  mom: 'MOM',
} as const;

export const OFFICE_HUB_STORAGE_ROOT = 'office-hub';

/**
 * Records as they come back off a Firestore read.
 *
 * The pure model types audit stamps as `OfficeHubTimestampLike`, which a Firestore `Timestamp`
 * satisfies. These aliases exist so a screen can be explicit that it is holding a read document
 * rather than a draft, without the model layer having to import the SDK.
 */
export interface OfficeHubFirestoreStamps {
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
  deletedAt?: Timestamp | null;
}

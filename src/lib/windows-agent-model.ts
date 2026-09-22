/**
 * The Windows Agent data model — devices, work sessions, foreground-application activity, idle and
 * lock state, heartbeats, policies, desktop notifications and agent releases
 * (`docs/windows-agent.md`).
 *
 * Dependency-free on purpose, exactly as `office-hub-model.ts` and `access-control.ts` are. The
 * rules in `windows-agent-rules.ts` and the policy resolver in `windows-agent-policy.ts` both run
 * under `node --test` with no Firebase installed, the ingest routes run them against Admin-SDK
 * documents, and the admin screens run them in the browser. So every instant this module carries is
 * a plain ISO-8601 string and every calendar date is `yyyy-MM-dd`; the only Firestore-shaped values
 * are the shared audit stamps, typed loosely as `WindowsAgentTimestampLike` so this file still
 * imports nothing. `src/lib/windows-agent.ts` is the Firestore-facing entry point that layers the
 * collection names on top and re-exports all of this.
 *
 * ── Six structural decisions worth knowing before reading the interfaces ────────────────────────
 *
 *  1. **The agent never writes Firestore directly, so these shapes are a wire contract as well as a
 *     schema.** §41 rules out giving a desktop executable Firestore credentials. Everything arrives
 *     through `/api/windows-agent/*`, is validated against the `*Input` types below, and is written
 *     server-side. The C# DTOs in `windows/SEL.Agent.Core/Contracts` are a transcription of these
 *     interfaces and must change with them.
 *
 *  2. **A device identity is a server-issued secret, not a machine fingerprint.** §4 explicitly
 *     rules out MAC-address identity. `windowsDevices/{deviceId}` holds only a *hash* of the device
 *     secret (`deviceSecretHash`); the secret itself is returned exactly once, at enrolment, and
 *     lives from then on in Windows DPAPI storage on that PC. A leaked Firestore export therefore
 *     does not let anybody impersonate a device.
 *
 *  3. **Activity is aggregated before it is uploaded, and again after.** §31 forbids per-second
 *     writes. The agent coalesces foreground-window changes into `AgentActivitySpan`s locally and
 *     ships them in batches of 2–5 minutes; the ingest route folds each batch into the session
 *     counters and the `windowsDailyActivity` rollup in the same transaction. The raw spans are
 *     kept for the timeline and are the only thing §51's retention job ever deletes.
 *
 *  4. **Every span carries the id the agent generated for it.** `spanId` is a client-side UUID, and
 *     it is the document id. A retried batch after a flaky upload therefore overwrites rather than
 *     duplicates — §27's "prevent duplicate events using event IDs" is enforced by the key, not by
 *     remembering to check first.
 *
 *  5. **Window titles and browser domains are absent unless a policy turned them on.** §12 makes
 *     them off by default, so they are optional fields that the ingest route *strips* when the
 *     effective policy does not permit them, rather than fields the agent is trusted not to send.
 *     A misconfigured or tampered agent cannot cause title capture.
 *
 *  6. **Nothing here judges anybody.** §19 and §22 both say so. `AppCategory` classifies software,
 *     not people; there is no productivity score, no rating and no ranking anywhere in the model,
 *     and reports expose raw seconds alongside every derived figure.
 */

/* ------------------------------------------------------------------------------------------------
 * Primitive aliases
 * ---------------------------------------------------------------------------------------------- */

/** A full ISO-8601 instant, e.g. `2026-09-20T09:02:16.000Z`. Always UTC on the wire. */
export type IsoInstant = string;

/** A calendar date in the *organisation's* timezone, `yyyy-MM-dd`. The key of a daily rollup. */
export type IsoDate = string;

/**
 * A Firestore `Timestamp`, an Admin-SDK timestamp, or a plain date/millis value.
 *
 * The same union as `AuditStamps` in `@/lib/audit-fields`, so every Windows Agent record is
 * structurally assignable to it and `formatCreatedBy` / `formatUpdatedBy` work without a cast.
 */
export type WindowsAgentTimestampLike =
  | { toMillis: () => number }
  | { seconds: number }
  | Date
  | number
  | null
  | undefined;

/** The shared stamps written by `withCreateAudit` / `withUpdateAudit`. */
export interface WindowsAgentAuditStamps {
  createdAt?: WindowsAgentTimestampLike;
  createdBy?: string | null;
  createdByName?: string | null;
  updatedAt?: WindowsAgentTimestampLike;
  updatedBy?: string | null;
  updatedByName?: string | null;
}

/* ------------------------------------------------------------------------------------------------
 * Devices (§4, §34, §45)
 * ---------------------------------------------------------------------------------------------- */

/**
 * Why a device is or is not allowed to run the agent.
 *
 * `PENDING` exists because §45 lets an organisation require an administrator to approve a machine
 * after it presents a valid enrolment code. An installation that does not require approval skips
 * straight to `ACTIVE`; one that does leaves the PC able to authenticate its *device* identity and
 * nothing else until somebody approves it.
 */
export type DeviceStatus =
  | 'PENDING'
  | 'ACTIVE'
  | 'BLOCKED'
  | 'DISABLED'
  | 'MAINTENANCE'
  | 'RETIRED';

/** Device statuses that permit a user to sign in and open a session on the machine. */
export const DEVICE_STATUSES_ALLOWING_LOGIN: readonly DeviceStatus[] = ['ACTIVE', 'MAINTENANCE'];

/** What the agent reports about the machine it is running on. Refreshed on every startup. */
export interface DeviceMachineFacts {
  hostname: string;
  /** Windows' own `MachineGuid`. Corroborating evidence, never the identity itself (§4). */
  machineGuid: string | null;
  windowsVersion: string | null;
  /** `x64`, `arm64`, … */
  architecture: string | null;
  manufacturer?: string | null;
  model?: string | null;
  /** Serial from SMBIOS where readable; absent on machines that do not expose it. */
  serialNumber?: string | null;
  totalMemoryMb?: number | null;
  /** Logged so a report can say which timezone a device's local clock was in. */
  timeZoneId?: string | null;
}

export interface WindowsDevice extends WindowsAgentAuditStamps {
  id: string;
  /** Human label an administrator can change: `SEL-HO-PC-023`. Defaults to the hostname. */
  deviceName: string;
  status: DeviceStatus;
  facts: DeviceMachineFacts;

  /**
   * Argon2id/scrypt hash of the device secret issued at enrolment. Never the secret.
   * Rotated by "Force Re-authentication"; a rotation invalidates every stored agent credential.
   */
  deviceSecretHash: string;
  /** Bumped on every rotation so a stale agent credential is rejected rather than silently reused. */
  secretVersion: number;

  /** The enrolment code the machine registered with, kept for the audit trail (§45). */
  enrollmentCode: string | null;
  departmentId: string | null;
  departmentName: string | null;
  /** Free text: "Head Office — 3rd floor", "Bhubaneswar site office". */
  assignedLocation: string | null;

  /**
   * Who may sign in here. Empty means "anybody with an active SEL LIVE account", which is the
   * sensible default for a shared/shop-floor PC; a populated list makes the machine personal.
   */
  assignedUserIds: string[];

  agentVersion: string | null;
  /** Where this device sits in a staged rollout (§43). */
  updateRing: AgentUpdateRing;
  updateStatus: AgentUpdateStatus;

  firstRegisteredAt: IsoInstant | null;
  lastHeartbeatAt: IsoInstant | null;
  lastLoginAt: IsoInstant | null;
  lastLogoutAt: IsoInstant | null;
  lastSeenUserId: string | null;
  lastSeenUserName: string | null;
  ipAddress: string | null;

  /** Set when an administrator blocks or retires the machine; shown on the gate. */
  statusReason?: string | null;
  statusChangedAt?: IsoInstant | null;
  statusChangedBy?: string | null;

  /**
   * Raised by an administrator to make the agent drop its cached user session and show the gate
   * again at the next heartbeat. Compared by value, so re-raising it is a no-op for an agent that
   * has already complied.
   */
  forceReauthAt?: IsoInstant | null;
  /** Raised to sign the current user out without touching the device credential. */
  forceSignOutAt?: IsoInstant | null;
}

/**
 * One user's assignment to one device, with provenance.
 *
 * A separate collection rather than only the array on the device, for the same reason Office Hub
 * keeps participants separate: "which devices may this person use?" has to be an indexed query, and
 * an array of objects on the other side of the relation cannot answer it.
 */
export interface WindowsDeviceAssignment extends WindowsAgentAuditStamps {
  id: string;
  deviceId: string;
  deviceName: string;
  userId: string;
  userName: string;
  /** `PRIMARY` is the person the machine belongs to; `SHARED` is everyone else allowed on it. */
  kind: 'PRIMARY' | 'SHARED';
  assignedBy: string;
  assignedByName: string;
  assignedAt: IsoInstant;
  reason?: string | null;
  /** Set instead of deleting, so the history of who used which machine survives (§50). */
  revokedAt?: IsoInstant | null;
  revokedBy?: string | null;
  revokedByName?: string | null;
}

/**
 * Which computers one person may sign in on.
 *
 * The user-side half of device access, and the reason it exists is worth stating: the device's
 * own `assignedUserIds` can only answer "who may use this PC". It cannot express "Priya may use
 * only these two computers", because every PC she is *not* named on is still open to everybody.
 * Naming her on two machines restricts those machines, not her.
 *
 * So access is decided by two independent allow-lists, each defaulting to "no restriction":
 *
 *   • `windowsDevices.assignedUserIds` — empty means the PC is shared.
 *   • `windowsUserAccess.allowedDeviceIds` — empty means the person may use any PC.
 *
 * A sign-in must satisfy both. That gives four sensible configurations rather than one: an open
 * fleet, personal machines, a roaming employee limited to a few sites, and a locked pairing of
 * one person to one desk — all without a mode switch.
 */
export interface WindowsUserDeviceAccess extends WindowsAgentAuditStamps {
  /** The user id. Also the document id, so a check is a single `get` with no query. */
  id: string;
  userId: string;
  userName: string;
  /** Empty or absent means "any computer". A populated list is exhaustive. */
  allowedDeviceIds: string[];
  /** Why the restriction exists, shown on the access screen and in the audit trail. */
  reason?: string | null;
  updatedAtIso?: IsoInstant | null;
}

/** A company enrolment code as issued on `/windows-agent/devices` (§45). */
export interface WindowsEnrollmentCode extends WindowsAgentAuditStamps {
  /** The code itself is the document id, uppercased: `SEL-HO-2026`. */
  id: string;
  label: string;
  departmentId: string | null;
  departmentName: string | null;
  assignedLocation: string | null;
  /** `false` puts newly enrolled machines in `PENDING` until an administrator approves them. */
  autoApprove: boolean;
  enabled: boolean;
  expiresAt: IsoInstant | null;
  /** Null means unlimited. Decremented, never reset, so an exhausted code cannot be reused. */
  maxRegistrations: number | null;
  registrationCount: number;
}

/* ------------------------------------------------------------------------------------------------
 * Sessions (§7, §28)
 * ---------------------------------------------------------------------------------------------- */

export type SessionStatus =
  /** The user is signed in to the agent; heartbeats are arriving. */
  | 'OPEN'
  /** Closed by an orderly sign-out, Windows logoff, shutdown or restart. */
  | 'CLOSED'
  /**
   * The agent stopped reporting and never closed the session — a crash, a power cut, a pulled
   * network cable across a shutdown. §28: the end time is *estimated* from the last heartbeat and
   * flagged, never manufactured.
   */
  | 'UNCLEAN_END';

/** How a session ended. Retained even on `UNCLEAN_END`, where it is the reason it was reaped. */
export type SessionEndReason =
  | 'USER_SIGNOUT'
  | 'WINDOWS_LOGOFF'
  | 'WINDOWS_SHUTDOWN'
  | 'WINDOWS_RESTART'
  | 'ADMIN_SIGNOUT'
  | 'DEVICE_BLOCKED'
  | 'SESSION_SUPERSEDED'
  | 'HEARTBEAT_TIMEOUT'
  | 'AGENT_STOPPED';

/** What the agent last reported the machine to be doing. Drives the live board's colour (§17). */
export type PresenceState = 'ACTIVE' | 'IDLE' | 'EXTENDED_IDLE' | 'LOCKED' | 'OFFLINE';

/**
 * A work session: one user, on one device, from sign-in to sign-out.
 *
 * The counters are *denormalised totals*, folded forward by each activity batch rather than
 * recomputed from the spans. §32's "do not calculate entire historical reports every page load" is
 * the reason; the spans remain available for the timeline and for a rebuild if the totals are ever
 * doubted.
 */
export interface WindowsSession extends WindowsAgentAuditStamps {
  id: string;
  userId: string;
  userName: string;
  userEmail: string | null;
  /** The HR employee this login belongs to, copied from `users.employeeId` when there is one. */
  employeeId: string | null;
  employeeNo: string | null;
  departmentId: string | null;
  departmentName: string | null;

  deviceId: string;
  deviceName: string;

  /** Organisation-local calendar date of `loginAt`. The partition key for every daily report. */
  workDate: IsoDate;

  loginAt: IsoInstant;
  logoutAt: IsoInstant | null;
  lastHeartbeatAt: IsoInstant | null;
  /** The last instant covered by an accepted activity batch. Bounds the counters. */
  lastActivityAt: IsoInstant | null;

  status: SessionStatus;
  endReason: SessionEndReason | null;
  /** True when `logoutAt` was inferred from `lastHeartbeatAt` rather than observed (§28). */
  logoutEstimated: boolean;

  presence: PresenceState;
  /** Process name of the foreground application at the last heartbeat, for the live board. */
  currentProcessName: string | null;
  currentApplicationName: string | null;

  /** Wall-clock from login to logout (or to now, for an open session). */
  totalSeconds: number;
  /** Time at the keyboard: spans whose idle classification was `ACTIVE`. */
  activeSeconds: number;
  idleSeconds: number;
  extendedIdleSeconds: number;
  lockedSeconds: number;
  /** Time the agent was recording but could not reach the server (§27). */
  offlineSeconds: number;

  agentVersion: string | null;
  ipAddress: string | null;
  /** True when the login was accepted against the offline grace policy rather than Firebase. */
  offlineLogin: boolean;
  /** Login later than the policy's expected start; surfaced as "Late" on the attendance report. */
  lateLogin: boolean;
  /** Minutes past the expected start. Zero when on time, so the column always sorts. */
  lateByMinutes: number;
}

/* ------------------------------------------------------------------------------------------------
 * Activity (§8, §10, §11, §30)
 * ---------------------------------------------------------------------------------------------- */

/**
 * What a recorded span of time represents.
 *
 * `APP_ACTIVE` is the workhorse — one foreground application, one uninterrupted stretch. The rest
 * are state transitions the timeline needs in order to explain the gaps between them.
 */
export type ActivityEventType =
  | 'APP_ACTIVE'
  | 'IDLE_START'
  | 'IDLE_END'
  | 'LOCK'
  | 'UNLOCK'
  | 'SLEEP'
  | 'RESUME'
  | 'LOGIN'
  | 'LOGOUT';

/** How the span's seconds count towards the session totals. Derived, never sent by the agent. */
export type ActivityClassification = 'ACTIVE' | 'IDLE' | 'EXTENDED_IDLE' | 'LOCKED' | 'OFFLINE';

/**
 * Categories for software, configurable per installation (§22).
 *
 * Deliberately *not* "productive"/"unproductive". The module refuses to ship that judgement: an
 * estimator lives in Excel, a designer lives in Chrome, and a category list that pretends otherwise
 * produces confident nonsense. `UNCLASSIFIED` is the honest default for anything an administrator
 * has not yet placed.
 */
export type AppCategory =
  | 'ERP'
  | 'OFFICE'
  | 'COMMUNICATION'
  | 'DEVELOPMENT'
  | 'REFERENCE'
  | 'WORK'
  | 'SYSTEM'
  | 'UNCLASSIFIED';

export const APP_CATEGORIES: readonly AppCategory[] = [
  'ERP',
  'OFFICE',
  'COMMUNICATION',
  'DEVELOPMENT',
  'REFERENCE',
  'WORK',
  'SYSTEM',
  'UNCLASSIFIED',
];

/**
 * One span of foreground time, as the agent recorded it, before the server has classified it.
 *
 * This is the wire shape of §31's batched upload. `spanId` is generated on the PC and becomes the
 * Firestore document id, which is what makes a retry idempotent.
 */
export interface AgentActivitySpan {
  spanId: string;
  eventType: ActivityEventType;
  /** `EXCEL.EXE`. Lower-cased by the server before storage so grouping is stable. */
  processName: string | null;
  /** `Microsoft Excel` — the executable's FileDescription, not a guess from the filename. */
  applicationName: string | null;
  /** Full path of the executable, used to tell a real `chrome.exe` from one in a temp folder. */
  executablePath?: string | null;
  startedAt: IsoInstant;
  endedAt: IsoInstant;
  /** Seconds of `startedAt`→`endedAt` during which the user gave no input (§11). */
  idleSeconds: number;
  /** True when the span was recorded while the agent could not reach the server. */
  recordedOffline?: boolean;
  /**
   * Only ever populated when the effective policy has window-title tracking switched on, and
   * stripped by the ingest route when it does not (§12). Sanitised on the agent side first.
   */
  windowTitle?: string | null;
  /** Host only, never a full URL, and only under the optional browser-domain policy (§14). */
  browserDomain?: string | null;
  /**
   * The file open in front — `Q3 Budget.xlsx` — under the document-name policy (§13).
   *
   * A name, never contents. The agent derives it from the window title of a known document
   * application and the server strips it when the policy is off, exactly as it does for titles.
   */
  documentName?: string | null;
}

/** A stored span, after the server has attributed and classified it. */
export interface WindowsActivityEvent {
  id: string;
  userId: string;
  deviceId: string;
  sessionId: string;
  workDate: IsoDate;

  eventType: ActivityEventType;
  processName: string | null;
  applicationName: string | null;
  /** Resolved through `windowsAppCatalog` at ingest so reports never re-derive it per page load. */
  category: AppCategory;

  startedAt: IsoInstant;
  endedAt: IsoInstant;
  durationSeconds: number;
  idleSeconds: number;
  /** `durationSeconds - idleSeconds`, precomputed because every report sums it. */
  activeSeconds: number;
  classification: ActivityClassification;

  windowTitle: string | null;
  browserDomain: string | null;
  /** §13's document name, or null when the policy is off or the application is not one. */
  documentName: string | null;
  recordedOffline: boolean;
  /** When the server accepted the batch this span arrived in. */
  ingestedAt: IsoInstant;
}

/** Per-session, per-application totals. The source of the §9 daily application report. */
export interface WindowsApplicationUsage {
  /** `${sessionId}__${processKey}` — deterministic, so a batch folds into it with a merge write. */
  id: string;
  userId: string;
  deviceId: string;
  sessionId: string;
  workDate: IsoDate;
  /** Lower-cased process name. The grouping key everywhere in the module. */
  processKey: string;
  processName: string;
  applicationName: string;
  category: AppCategory;
  /** Foreground seconds, idle included. */
  totalSeconds: number;
  /** Foreground seconds with input. The figure §9 means by "active". */
  activeSeconds: number;
  idleSeconds: number;
  firstSeenAt: IsoInstant;
  lastSeenAt: IsoInstant;
  /** How many times the user switched into this application. A cheap proxy for fragmentation. */
  focusCount: number;
}

/**
 * An administrator's classification of one executable (§22).
 *
 * Seeded from `DEFAULT_APP_CATALOG` in `windows-agent-rules.ts` for the software everybody has, and
 * extended automatically — the ingest route creates an `UNCLASSIFIED` entry the first time it sees
 * an unknown process, so the settings screen is a list of what is actually in use rather than a
 * blank form.
 */
export interface WindowsAppCatalogEntry extends WindowsAgentAuditStamps {
  /** Lower-cased process name, e.g. `excel.exe`. Also the document id. */
  id: string;
  processName: string;
  /** The display name reports use; an administrator may override what the executable reported. */
  displayName: string;
  category: AppCategory;
  /** `true` for the rows seeded from the built-in catalogue, so a reset can tell them apart. */
  isBuiltIn: boolean;
  /** Set when the entry was created by ingest rather than by a person. Drives a "review" badge. */
  autoDiscovered: boolean;
  firstSeenAt: IsoInstant | null;
  lastSeenAt: IsoInstant | null;
}

/* ------------------------------------------------------------------------------------------------
 * Daily rollup (§32)
 * ---------------------------------------------------------------------------------------------- */

/**
 * One user's whole day, precomputed.
 *
 * Every report in §18–§21 reads this and not the spans. The document id is `${userId}__${workDate}`
 * so the ingest route can fold a batch into it with a single merge write and no query.
 */
export interface WindowsDailyActivity {
  id: string;
  userId: string;
  userName: string;
  employeeId: string | null;
  departmentId: string | null;
  departmentName: string | null;
  workDate: IsoDate;

  firstLoginAt: IsoInstant | null;
  lastLogoutAt: IsoInstant | null;
  sessionCount: number;
  deviceIds: string[];

  sessionSeconds: number;
  activeSeconds: number;
  idleSeconds: number;
  extendedIdleSeconds: number;
  lockedSeconds: number;
  offlineSeconds: number;

  /** `{ 'excel.exe': 11520, 'chrome.exe': 7920 }` — foreground seconds per process. */
  applicationSummary: Record<string, number>;
  /** The same totals folded up to `AppCategory`. What the department report charts. */
  categorySummary: Partial<Record<AppCategory, number>>;

  lateLogin: boolean;
  lateByMinutes: number;
  /** True when any of the day's sessions ended uncleanly — the report shows it rather than hides it. */
  hasUncleanSession: boolean;
  updatedAt: IsoInstant;
}

/* ------------------------------------------------------------------------------------------------
 * Heartbeat (§16)
 * ---------------------------------------------------------------------------------------------- */

/** What the agent sends every heartbeat interval. Deliberately tiny — it runs all day. */
export interface AgentHeartbeatInput {
  sessionId: string | null;
  /** The agent's own clock, so a skewed PC is detectable rather than silently wrong. */
  sentAt: IsoInstant;
  presence: PresenceState;
  processName: string | null;
  applicationName: string | null;
  agentVersion: string;
  /** Spans still waiting to upload. A backlog is how §47 spots a failing agent. */
  queuedSpanCount: number;
  /** Seconds since the last user input, as `GetLastInputInfo` reports it. */
  idleSeconds: number;
}

/**
 * The latest heartbeat per device. One document, overwritten — not an append-only collection.
 *
 * A 90-second heartbeat from 200 PCs is 192,000 writes a day if each one is a new document, for
 * data nobody reads twice. The live board only ever wants the newest, and the historical record of
 * what a machine was doing lives in the spans.
 */
export interface WindowsHeartbeat {
  /** The device id. */
  id: string;
  deviceId: string;
  deviceName: string;
  userId: string | null;
  userName: string | null;
  sessionId: string | null;
  receivedAt: IsoInstant;
  sentAt: IsoInstant;
  /** `receivedAt - sentAt` in seconds. Large values mean a badly set PC clock. */
  clockSkewSeconds: number;
  presence: PresenceState;
  processName: string | null;
  applicationName: string | null;
  category: AppCategory;
  agentVersion: string;
  queuedSpanCount: number;
  ipAddress: string | null;
}

/* ------------------------------------------------------------------------------------------------
 * Policy (§35)
 * ---------------------------------------------------------------------------------------------- */

/** The four levels a policy can be written at, most general first. */
export type PolicyScopeKind = 'COMPANY' | 'DEPARTMENT' | 'USER' | 'DEVICE';

export const POLICY_SCOPE_ORDER: readonly PolicyScopeKind[] = [
  'COMPANY',
  'DEPARTMENT',
  'USER',
  'DEVICE',
];

/** How the agent presents incoming notifications (§23). */
export type NotificationMode = 'TOAST_AND_TRAY' | 'TRAY_ONLY' | 'CRITICAL_ONLY' | 'OFF';

/**
 * Every knob, all optional.
 *
 * Optionality *is* the inheritance mechanism: a department policy that sets only `idleThreshold`
 * changes only that, and keeps inheriting the rest. A resolver that merged whole objects would
 * silently reset every unset field to its default the moment somebody created a narrower policy —
 * which is how a department ends up with tracking switched off because an administrator adjusted
 * its idle threshold.
 */
export interface AgentPolicySettings {
  /** Show the access gate at Windows startup. §60: off until a fleet is ready for it. */
  requireMorningLogin?: boolean;
  /** Show it again after a restart within the same working day. */
  requireLoginAfterRestart?: boolean;
  /** Seconds of no input before a span is classified `IDLE`. */
  idleThresholdSeconds?: number;
  /** Seconds before it becomes `EXTENDED_IDLE`. Must exceed the idle threshold. */
  extendedIdleThresholdSeconds?: number;
  /** How long the agent may accept a cached login with no server (§27). Zero forbids it. */
  offlineGraceMinutes?: number;
  heartbeatIntervalSeconds?: number;
  /** How often the agent flushes its span queue. */
  activityBatchIntervalSeconds?: number;
  /** Master switch for foreground-application monitoring. */
  applicationTrackingEnabled?: boolean;
  /** §12: off by default, and enforced server-side, not by trusting the agent. */
  windowTitleTrackingEnabled?: boolean;
  /**
   * §14: time per website. Off by default.
   *
   * The agent reads the host from the browser's address bar through the accessibility API — no
   * extension to deploy — and sends the host only. The path and query never leave the PC, which
   * is what keeps §N's ban on search-box contents, tokens and shared-document links intact:
   * `google.com`, never `google.com/search?q=…`.
   */
  browserDomainTrackingEnabled?: boolean;
  /**
   * §13: which document is open, by name. Off by default.
   *
   * A file name from a fixed list of document applications — Excel, Word, PowerPoint, AutoCAD,
   * PDF readers — taken from the window title. Never contents: §H rules out cells, formulas and
   * values, and nothing here can reach them.
   *
   * Separate from `windowTitleTrackingEnabled` because the two are different disclosures. A
   * window title can be an email subject or a chat message; this is only ever a file name. An
   * installation can reasonably want document names and not titles, and most will.
   */
  documentNameTrackingEnabled?: boolean;
  notificationMode?: NotificationMode;
  autoUpdateEnabled?: boolean;
  /** `HH:mm`, organisation-local. A login after this is flagged late — never blocked. */
  workdayStart?: string;
  workdayEnd?: string;
  /** Minutes of grace before `workdayStart` counts as late. */
  lateLoginGraceMinutes?: number;
  /**
   * Whether the tray menu's "Pause tracking" is offered at all. §26: an employee may not silently
   * stop a mandatory session, but an organisation that wants to allow it can.
   */
  allowUserPauseTracking?: boolean;

  /* ── Session lifecycle ────────────────────────────────────────────────────────────────────
   *
   * Turning an unattended desk into a locked one, and making the SEL LIVE sign-in the way back
   * in. All three default to off or generous, for the same reason as `requireMorningLogin`:
   * these are the settings that can stop somebody working, and §60 puts enforcement after
   * monitoring rather than alongside it.
   *
   * Locking is `LockWorkStation` — the ordinary Windows lock screen, which the person clears
   * with their own Windows password. It is not a second authentication surface the agent
   * invented, and it does not touch Ctrl+Alt+Delete.
   */

  /** Lock the PC after {@link idleLockSeconds} of no input, having warned first. */
  lockOnIdleEnabled?: boolean;
  /**
   * Seconds of no keyboard or mouse before the lock countdown starts.
   *
   * Distinct from `idleThresholdSeconds`, which only classifies recorded time and never acts.
   * Conflating them would mean the number that decides what a timesheet says also decides when
   * somebody's screen goes dark, and neither could then be tuned without disturbing the other.
   */
  idleLockSeconds?: number;
  /** How long the "still working?" prompt counts down before locking. Any input cancels it. */
  idleLockWarningSeconds?: number;

  /**
   * Closing the embedded SEL LIVE window locks the PC.
   *
   * For installations where that window *is* the working session. Off by default, because with
   * it on a misplaced click on the X costs somebody their unlocked desktop.
   */
  lockOnErpWindowClose?: boolean;

  /**
   * Signing out of SEL LIVE also locks the PC.
   *
   * Without this, signing out leaves somebody at an unlocked desktop with nothing being
   * recorded — which is the one way to work unmonitored that needs no administrator and no
   * Task Manager. Pair it with `requireMorningLogin`: locking decides how the session *ends*,
   * and the gate decides whether the next one can be dismissed.
   */
  lockOnSignOut?: boolean;

  /**
   * Seconds locked beyond which unlocking Windows also requires a fresh SEL LIVE sign-in.
   *
   * Zero means every unlock asks. A very large value means it never does. The default sits
   * between: a walk to the printer resumes silently, a lunch break does not.
   */
  reauthAfterLockSeconds?: number;

  /**
   * Whether closing the agent needs a SEL LIVE administrator's approval.
   *
   * On by default, which is the behaviour §26 asks for. An installation running the agent
   * purely for its own reporting — no attendance enforcement — can turn it off and let people
   * close it, rather than having the setting be a fact of the build.
   */
  requireAdminToExit?: boolean;

  /**
   * The longest a single activity span may run before it is closed and a new one opened.
   *
   * This is the granularity of the record. Ten minutes means a two-hour stretch in one
   * application appears as twelve rows rather than one, which is what makes an hour-by-hour
   * timeline possible. Lower it for finer detail at the cost of more documents; raise it on a
   * large fleet to cut Firestore writes.
   */
  maxSpanMinutes?: number;

  /**
   * How long the agent waits for a reply from SEL LIVE before giving up on one request.
   *
   * A fixed thirty seconds is wrong in both directions: generous on a head-office LAN, and too
   * short on a site office behind a satellite link, where every heartbeat timing out looks like
   * the server being down. Failed requests are retried from the offline queue, so a longer
   * value costs patience rather than data.
   */
  requestTimeoutSeconds?: number;
  /** Days of raw spans to keep. The rollups outlive them (§51). */
  rawActivityRetentionDays?: number;
}

/** One stored policy document. */
export interface WindowsAgentPolicy extends WindowsAgentAuditStamps {
  id: string;
  scopeKind: PolicyScopeKind;
  /** Null for `COMPANY`; a department, user or device id otherwise. */
  scopeId: string | null;
  /** Denormalised for the policy list, which would otherwise be N reads. */
  scopeLabel: string;
  enabled: boolean;
  settings: AgentPolicySettings;
  notes?: string | null;
}

/** A fully-resolved policy: every field present, with where each value came from. */
export interface ResolvedAgentPolicy {
  settings: Required<AgentPolicySettings>;
  /** Per setting key, the scope that supplied the winning value. Shown on the policy screen. */
  sources: Record<keyof AgentPolicySettings, PolicyScopeKind | 'DEFAULT'>;
  /** The policy documents that contributed, most general first. */
  appliedPolicyIds: string[];
}

/* ------------------------------------------------------------------------------------------------
 * Notifications (§23, §38, §39)
 * ---------------------------------------------------------------------------------------------- */

export type AgentNotificationType =
  | 'TASK'
  | 'APPROVAL'
  | 'REMINDER'
  | 'MEETING'
  | 'HR'
  | 'FINANCE'
  | 'PROJECT'
  | 'ANNOUNCEMENT'
  | 'DOCUMENT'
  | 'SYSTEM';

export type AgentNotificationPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';

/** Who a notification is addressed to (§38). Resolved to concrete users when it is dispatched. */
export interface AgentNotificationTarget {
  userIds?: string[];
  roles?: string[];
  departmentIds?: string[];
  projectIds?: string[];
  deviceIds?: string[];
  /** Mutually exclusive with everything else; requires the broadcast permission. */
  allEmployees?: boolean;
}

export interface WindowsNotification extends WindowsAgentAuditStamps {
  id: string;
  type: AgentNotificationType;
  priority: AgentNotificationPriority;
  title: string;
  message: string;
  /**
   * Where clicking the toast lands. §23 is emphatic that this is the exact record —
   * `/e-approval/PR-2026-0098`, not `/`. Validated as a same-origin path before it is stored.
   */
  deepLink: string | null;
  /** Extra buttons beyond OPEN, e.g. `[{ label: 'Remind later', action: 'SNOOZE' }]`. */
  actions: AgentNotificationAction[];
  target: AgentNotificationTarget;
  /** Concrete recipients, resolved at dispatch so delivery stays one indexed query. */
  recipientUserIds: string[];
  /** The ERP module that raised it, from `ACTIVITY_MODULES`. */
  module: string;
  /** The record it is about, for grouping and for the delivery report. */
  itemId: string | null;
  itemRef: string | null;
  /** Not delivered before this instant. Drives the §25 meeting reminders. */
  startAt: IsoInstant;
  /** Dropped, undelivered, after this. A reminder for a meeting that has finished is noise. */
  expiresAt: IsoInstant | null;
  requireAcknowledgement: boolean;
  createdAtIso: IsoInstant;
  /** Rolling counts, updated by receipts, so the §39 report is a read of one document. */
  deliveryCounts: NotificationDeliveryCounts;
}

export interface AgentNotificationAction {
  /** Button text: `Open`, `Remind later`, `Join`, `View agenda`. */
  label: string;
  action: 'OPEN' | 'SNOOZE' | 'ACKNOWLEDGE' | 'DISMISS' | 'LINK';
  /** For `LINK`, the path to open instead of `deepLink`. */
  deepLink?: string | null;
  /** For `SNOOZE`, how long to wait before re-raising it. */
  snoozeMinutes?: number;
}

export interface NotificationDeliveryCounts {
  recipients: number;
  delivered: number;
  displayed: number;
  clicked: number;
  acknowledged: number;
  expired: number;
  failed: number;
}

/** §39's lifecycle. Monotonic: a receipt never moves backwards. */
export type NotificationReceiptStatus =
  | 'CREATED'
  | 'SENT'
  | 'DELIVERED'
  | 'DISPLAYED'
  | 'CLICKED'
  | 'ACKNOWLEDGED'
  | 'SNOOZED'
  | 'DISMISSED'
  | 'EXPIRED'
  | 'FAILED';

/** How far through the lifecycle each status is. Used to reject out-of-order receipt updates. */
export const NOTIFICATION_RECEIPT_RANK: Record<NotificationReceiptStatus, number> = {
  CREATED: 0,
  SENT: 1,
  DELIVERED: 2,
  DISPLAYED: 3,
  SNOOZED: 3,
  DISMISSED: 4,
  CLICKED: 5,
  ACKNOWLEDGED: 6,
  EXPIRED: 7,
  FAILED: 7,
};

export interface WindowsNotificationReceipt {
  /** `${notificationId}__${userId}` — one receipt per person, updated in place. */
  id: string;
  notificationId: string;
  userId: string;
  userName: string;
  deviceId: string | null;
  status: NotificationReceiptStatus;
  createdAt: IsoInstant;
  sentAt: IsoInstant | null;
  deliveredAt: IsoInstant | null;
  displayedAt: IsoInstant | null;
  clickedAt: IsoInstant | null;
  acknowledgedAt: IsoInstant | null;
  snoozedUntil: IsoInstant | null;
  failureReason: string | null;
}

/* ------------------------------------------------------------------------------------------------
 * Agent releases (§43)
 * ---------------------------------------------------------------------------------------------- */

export type AgentUpdateRing = 'PILOT' | 'EARLY' | 'BROAD' | 'HELD';

export type AgentUpdateStatus =
  | 'UP_TO_DATE'
  | 'UPDATE_AVAILABLE'
  | 'DOWNLOADING'
  | 'PENDING_RESTART'
  | 'FAILED';

export type AgentVersionChannel = 'STABLE' | 'BETA' | 'WITHDRAWN';

export interface WindowsAgentVersion extends WindowsAgentAuditStamps {
  /** The semantic version, e.g. `1.4.2`. Also the document id. */
  id: string;
  version: string;
  channel: AgentVersionChannel;
  releaseNotes: string;
  /** HTTPS URL of the signed installer. */
  packageUrl: string;
  /** SHA-256 of the package, verified by the agent before it runs the installer (§43). */
  packageSha256: string;
  /** Authenticode subject the installer must be signed by. The agent refuses anything else. */
  signatureSubject: string;
  packageSizeBytes: number | null;
  /** Which rings this version is released to. A ring not listed keeps its current version. */
  rings: AgentUpdateRing[];
  /** Devices below this are told to update; used to force a security fix past a held ring. */
  minimumSupportedVersion: string | null;
  publishedAt: IsoInstant | null;
  withdrawnAt: IsoInstant | null;
}

/* ------------------------------------------------------------------------------------------------
 * Audit (§50)
 * ---------------------------------------------------------------------------------------------- */

export type WindowsAuditAction =
  | 'DEVICE_REGISTERED'
  | 'DEVICE_APPROVED'
  | 'DEVICE_BLOCKED'
  | 'DEVICE_UNBLOCKED'
  | 'DEVICE_RETIRED'
  | 'DEVICE_RENAMED'
  | 'DEVICE_SECRET_ROTATED'
  | 'ASSIGNMENT_ADDED'
  | 'ASSIGNMENT_REVOKED'
  | 'FORCE_REAUTH'
  | 'FORCE_SIGNOUT'
  | 'POLICY_CREATED'
  | 'POLICY_UPDATED'
  | 'POLICY_DELETED'
  | 'APP_CATEGORY_CHANGED'
  | 'NOTIFICATION_SENT'
  | 'AGENT_VERSION_PUBLISHED'
  | 'AGENT_VERSION_WITHDRAWN'
  | 'AGENT_UPDATE_TRIGGERED'
  | 'ENROLLMENT_CODE_CREATED'
  | 'ENROLLMENT_CODE_DISABLED'
  | 'SESSION_EDITED'
  | 'RETENTION_PURGE'
  /**
   * A SEL LIVE administrator authorised closing the agent on one computer.
   *
   * Recorded because it is the one action that deliberately stops monitoring, so "the agent was
   * off between 2pm and 5pm" needs to be answerable without guessing. The trail names who
   * approved it, not just that somebody did.
   */
  | 'AGENT_EXIT_APPROVED'
  /**
   * A SEL LIVE administrator authorised removing the agent from one computer.
   *
   * Separate from `AGENT_EXIT_APPROVED` because the two are not the same event and the
   * difference matters months later: closing the agent stops recording until the next sign-in,
   * whereas uninstalling it stops recording permanently and leaves a PC that looks like one that
   * was never enrolled. "Why has this machine no data since March" needs to be answerable.
   */
  | 'AGENT_UNINSTALL_APPROVED';

/**
 * One administrative action. Append-only — §50 is explicit that an audit trail an administrator can
 * edit is not an audit trail, and the Firestore rules enforce it rather than relying on the UI.
 */
export interface WindowsAuditLog {
  id: string;
  action: WindowsAuditAction;
  actorId: string;
  actorName: string;
  /** `device`, `policy`, `notification`, `version`, `session`, `appCatalog`. */
  targetType: string;
  targetId: string;
  targetLabel: string;
  oldValue: unknown;
  newValue: unknown;
  reason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  at: IsoInstant;
}

/* ------------------------------------------------------------------------------------------------
 * Wire contracts — the exact shapes `/api/windows-agent/*` accepts and returns
 * ---------------------------------------------------------------------------------------------- */

export interface DeviceRegisterInput {
  enrollmentCode: string;
  facts: DeviceMachineFacts;
  agentVersion: string;
  /** Present on a re-registration (reinstall over an existing identity); absent on a fresh PC. */
  deviceId?: string;
}

export interface DeviceRegisterResult {
  deviceId: string;
  /** Returned exactly once. The agent stores it under DPAPI and it is never retrievable again. */
  deviceSecret: string;
  secretVersion: number;
  deviceName: string;
  status: DeviceStatus;
  /** False when the code requires administrator approval; the agent then polls until approved. */
  approved: boolean;
}

export interface AgentLoginInput {
  /** Firebase ID token obtained by the agent's embedded sign-in. */
  idToken: string;
  /** The agent's own clock at sign-in, for skew detection. */
  sentAt: IsoInstant;
  agentVersion: string;
  facts: DeviceMachineFacts;
}

/** Why a sign-in attempt was refused. The gate shows the message; the code drives its behaviour. */
export type LoginRejectionCode =
  | 'DEVICE_UNKNOWN'
  | 'DEVICE_NOT_APPROVED'
  | 'DEVICE_BLOCKED'
  | 'DEVICE_RETIRED'
  | 'USER_INACTIVE'
  | 'USER_NOT_REGISTERED'
  | 'USER_NOT_ASSIGNED'
  | 'OUTSIDE_WORKING_HOURS'
  | 'OFFLINE_NOT_PERMITTED'
  | 'AGENT_TOO_OLD';

export interface AgentLoginResult {
  sessionId: string;
  userId: string;
  userName: string;
  employeeId: string | null;
  departmentName: string | null;
  photoURL: string | null;
  loginAt: IsoInstant;
  /** True when this call resumed today's existing open session rather than opening a new one (§7). */
  resumed: boolean;
  lateLogin: boolean;
  policy: ResolvedAgentPolicy;
  /** What the morning dashboard shows before the user is released into Windows (§6). */
  morningSummary: MorningSummary;
}

/** §6's counts. Assembled server-side from the modules that already own each number. */
export interface MorningSummary {
  greeting: string;
  checkInAt: IsoInstant;
  pendingTasks: number;
  overdueTasks: number;
  pendingApprovals: number;
  meetingsToday: number;
  reminders: number;
  unreadNotifications: number;
  /** The next few meetings, so the dashboard can name them rather than only count them. */
  nextMeetings: { id: string; title: string; startAt: IsoInstant; link: string }[];
}

export interface ActivityBatchInput {
  sessionId: string;
  spans: AgentActivitySpan[];
  /** The agent's clock when the batch was assembled. */
  sentAt: IsoInstant;
}

export interface ActivityBatchResult {
  accepted: number;
  /** Spans rejected as malformed or outside the session, with the reason, so the agent can log it. */
  rejected: { spanId: string; reason: string }[];
  /** Spans the server had already stored. The agent drops them from its queue. */
  duplicates: string[];
  sessionTotals: Pick<
    WindowsSession,
    'totalSeconds' | 'activeSeconds' | 'idleSeconds' | 'extendedIdleSeconds' | 'lockedSeconds'
  >;
}

export interface SessionLogoutInput {
  sessionId: string;
  endReason: SessionEndReason;
  endedAt: IsoInstant;
  /** A final flush, so the last minutes before a shutdown are not lost. */
  finalSpans?: AgentActivitySpan[];
}

export interface HeartbeatResult {
  /** Echoed so the agent can detect and log a skewed clock. */
  serverTime: IsoInstant;
  /** Re-sent every heartbeat: a policy change reaches a PC without it restarting. */
  policy: ResolvedAgentPolicy;
  /** Commands the agent must obey before its next heartbeat. */
  directives: AgentDirective[];
  /** Notifications waiting for this user, oldest first. */
  pendingNotificationIds: string[];
  /** Set when a newer version applies to this device's ring. */
  availableVersion: { version: string; packageUrl: string; packageSha256: string } | null;
}

/** A server→agent instruction, delivered on the heartbeat because the agent may be behind a NAT. */
export interface AgentDirective {
  /** Deterministic per cause, so obeying it twice is harmless. */
  directiveId: string;
  kind:
    | 'SIGN_OUT'
    | 'FORCE_REAUTH'
    | 'LOCK_WORKSTATION'
    | 'SYNC_NOW'
    | 'RESTART_AGENT'
    | 'APPLY_UPDATE'
    | 'SHOW_MESSAGE';
  issuedAt: IsoInstant;
  reason: string | null;
  /** For `SHOW_MESSAGE`. */
  message?: string | null;
}

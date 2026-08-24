/**
 * Tower Progress — the tower-wise execution core hosted inside Project Management → Erection.
 *
 * A transmission line is not really built "by BOQ line"; it is built tower by tower, through seven
 * activities in a fixed order, and the only thing that makes a completion claim trustworthy is a
 * photograph taken at that tower on that date. So the model here is deliberately narrow:
 *
 *     project → tower → activity → progress update → photographs
 *
 * Everything the dashboard, the status matrix and the reporting engine show is derived from those
 * four levels. Nobody assembles a progress report by hand; a report is a projection of this data.
 *
 * Two shape decisions worth knowing before reading further:
 *
 *  1. Each tower document carries a denormalised `activities` map holding the *current* state of all
 *     seven activities, including evidence counters. A 186-tower project therefore renders its
 *     dashboard, tower-status matrix and every exception report from one collection read, with no
 *     per-tower fan-out. The append-only `towerProgressUpdates` register remains the source of truth
 *     for history, photographs and the audit trail, and the map is recomputed from it on every write.
 *
 *  2. Progress is a weighted roll-up, not a count of ticked boxes. The default weights below
 *     reproduce the percentages in the module specification exactly (see DEFAULT_ACTIVITY_WEIGHTS)
 *     and are editable per project, because the balance between foundation and stringing genuinely
 *     differs between a 132kV line and a 765kV one.
 *
 * Pure — no Firebase, no React — so every rule in here is unit-testable with `node --test`.
 * The Firestore/Storage write side lives in project-management-tower-service.ts, and the report
 * projections in project-management-tower-reports.ts.
 */

/* ── Collections & permissions ──────────────────────────────────────────────────────────────── */

/** Tower master, under the global project: `projects/{globalProjectId}/towers/{towerId}`. */
export const TOWER_COLLECTION = "towers";

/** Append-only progress/evidence register: `projects/{globalProjectId}/towerProgressUpdates/{id}`. */
export const TOWER_UPDATE_COLLECTION = "towerProgressUpdates";

/** Per-project configuration: `projects/{globalProjectId}/towerProgressSettings/config`. */
export const TOWER_SETTINGS_COLLECTION = "towerProgressSettings";
export const TOWER_SETTINGS_DOC_ID = "config";

export const TOWER_PROGRESS_PERMISSION_RESOURCE = "Project Management.Tower Progress";

/** Where the screens live. Kept here so links cannot drift from the routes. */
export const TOWER_PROGRESS_BASE_PATH = "/project-management/erection/tower-progress";

/** Builds an in-module href that carries the `?project={mappingId}` the whole module runs on. */
export function towerProgressHref(mappingId: string, sub = ""): string {
  const suffix = sub ? `/${sub.replace(/^\/+/, "")}` : "";
  return `${TOWER_PROGRESS_BASE_PATH}${suffix}?project=${encodeURIComponent(mappingId)}`;
}

/* ── Activities ─────────────────────────────────────────────────────────────────────────────── */

/** The seven construction activities, in execution order. Order is load-bearing: it drives the
 *  status matrix columns, the prerequisite chain, and the photo timeline. */
export const TOWER_ACTIVITIES = [
  "survey",
  "row",
  "foundation",
  "structure",
  "erection",
  "stringing",
  "opgw",
] as const;

export type TowerActivity = (typeof TOWER_ACTIVITIES)[number];

/**
 * Photograph kinds. These are the evidence slots a completion claim is checked against, so they are
 * named after what a site engineer actually photographs rather than after a database concept.
 */
export const TOWER_PHOTO_KINDS = [
  "survey-location",
  "benchmark",
  "row-before",
  "row-cleared",
  "excavation",
  "reinforcement",
  "concreting",
  "foundation-complete",
  "material-assembly",
  "structure-assembled",
  "erection-progress",
  "tower-complete",
  "conductor-pulling",
  "span-complete",
  "opgw-installation",
  "opgw-complete",
  "other",
] as const;

export type TowerPhotoKind = (typeof TOWER_PHOTO_KINDS)[number];

export const TOWER_PHOTO_KIND_LABELS: Record<TowerPhotoKind, string> = {
  "survey-location": "Survey location",
  benchmark: "Benchmark / reference pillar",
  "row-before": "ROW before clearing",
  "row-cleared": "ROW cleared",
  excavation: "Excavation",
  reinforcement: "Reinforcement / stub setting",
  concreting: "Concreting",
  "foundation-complete": "Foundation completed",
  "material-assembly": "Material / ground assembly",
  "structure-assembled": "Assembled structure",
  "erection-progress": "Erection in progress",
  "tower-complete": "Complete tower",
  "conductor-pulling": "Conductor pulling",
  "span-complete": "Completed span",
  "opgw-installation": "OPGW installation",
  "opgw-complete": "OPGW completed",
  other: "Other",
};

export interface TowerActivityDefinition {
  key: TowerActivity;
  /** Report and dashboard heading. */
  label: string;
  /** Status-matrix column heading, where horizontal space is scarce. */
  shortLabel: string;
  /** Whether the activity is counted once per tower or once per span between towers. Stringing and
   *  OPGW are span activities, which is why the dashboard reports them as "185 spans" on a
   *  186-tower line and why they carry a length in metres. */
  measure: "tower" | "span";
  /** The activity that must be complete before this one sensibly starts. */
  prerequisite?: TowerActivity;
  /** Photographs that must exist before this activity may be marked Completed. */
  requiredPhotoKinds: TowerPhotoKind[];
  /** Photographs the form offers but does not insist on. */
  optionalPhotoKinds: TowerPhotoKind[];
  /** Tailwind classes for the activity's accent, so dashboard and reports stay visually consistent. */
  accent: string;
}

/**
 * The minimum evidence set per activity. Foundation carries four because it is the one activity
 * that becomes invisible once backfilled — excavation, reinforcement/stub and concreting cannot be
 * re-photographed after the fact, so a completion claim without them is unverifiable forever.
 */
export const TOWER_ACTIVITY_DEFINITIONS: Record<TowerActivity, TowerActivityDefinition> = {
  survey: {
    key: "survey",
    label: "Survey",
    shortLabel: "Survey",
    measure: "tower",
    requiredPhotoKinds: ["survey-location"],
    optionalPhotoKinds: ["benchmark", "other"],
    accent: "from-sky-500 to-cyan-600",
  },
  row: {
    key: "row",
    label: "ROW",
    shortLabel: "ROW",
    measure: "tower",
    prerequisite: "survey",
    requiredPhotoKinds: ["row-cleared"],
    optionalPhotoKinds: ["row-before", "other"],
    accent: "from-lime-500 to-green-600",
  },
  foundation: {
    key: "foundation",
    label: "Foundation",
    shortLabel: "Foundation",
    measure: "tower",
    prerequisite: "row",
    requiredPhotoKinds: ["excavation", "reinforcement", "concreting", "foundation-complete"],
    optionalPhotoKinds: ["other"],
    accent: "from-stone-500 to-stone-700",
  },
  structure: {
    key: "structure",
    label: "Tower Structure",
    shortLabel: "Structure",
    measure: "tower",
    prerequisite: "foundation",
    requiredPhotoKinds: ["material-assembly", "structure-assembled"],
    optionalPhotoKinds: ["other"],
    accent: "from-amber-500 to-orange-600",
  },
  erection: {
    key: "erection",
    label: "Tower Erection",
    shortLabel: "Erection",
    measure: "tower",
    prerequisite: "structure",
    requiredPhotoKinds: ["erection-progress", "tower-complete"],
    optionalPhotoKinds: ["other"],
    accent: "from-orange-500 to-red-600",
  },
  stringing: {
    key: "stringing",
    label: "Stringing",
    shortLabel: "Stringing",
    measure: "span",
    prerequisite: "erection",
    requiredPhotoKinds: ["conductor-pulling", "span-complete"],
    optionalPhotoKinds: ["other"],
    accent: "from-violet-500 to-purple-600",
  },
  opgw: {
    key: "opgw",
    label: "OPGW",
    shortLabel: "OPGW",
    measure: "span",
    prerequisite: "stringing",
    requiredPhotoKinds: ["opgw-installation", "opgw-complete"],
    optionalPhotoKinds: ["other"],
    accent: "from-fuchsia-500 to-pink-600",
  },
};

export const TOWER_ACTIVITY_LIST: TowerActivityDefinition[] = TOWER_ACTIVITIES.map(
  (activity) => TOWER_ACTIVITY_DEFINITIONS[activity],
);

/**
 * URL segment per activity, for the per-activity working screens and reports.
 *
 * Only `structure` differs from its key: the route reads `tower-structure`, because that is what the
 * activity is called on site and in the specification's route list. Keeping the mapping here means a
 * link and a lookup can never disagree about it.
 */
export const ACTIVITY_ROUTE_SEGMENTS: Record<TowerActivity, string> = {
  survey: "survey",
  row: "row",
  foundation: "foundation",
  structure: "tower-structure",
  erection: "erection",
  stringing: "stringing",
  opgw: "opgw",
};

export function activityFromRouteSegment(segment: string): TowerActivity | undefined {
  return TOWER_ACTIVITIES.find((activity) => ACTIVITY_ROUTE_SEGMENTS[activity] === segment);
}

/** Photograph kinds the update form should offer for an activity, required ones first. */
export function photoKindsForActivity(activity: TowerActivity): TowerPhotoKind[] {
  const definition = TOWER_ACTIVITY_DEFINITIONS[activity];
  return [...definition.requiredPhotoKinds, ...definition.optionalPhotoKinds];
}

/** Whether an activity is one of the seven. Guards data read back from Firestore. */
export function isTowerActivity(value: unknown): value is TowerActivity {
  return TOWER_ACTIVITIES.includes(value as TowerActivity);
}

export function isTowerPhotoKind(value: unknown): value is TowerPhotoKind {
  return TOWER_PHOTO_KINDS.includes(value as TowerPhotoKind);
}

/* ── Statuses ───────────────────────────────────────────────────────────────────────────────── */

/**
 * Nine statuses rather than a done/not-done flag, because "where is this stuck?" is the question
 * management actually asks. Blocked and Hold are distinct on purpose: Blocked means an external
 * dependency (ROW, material, crane) is stopping work that has not usefully begun, Hold means work
 * started and was paused. That distinction is what makes the exception reports actionable — and it
 * is why they earn different progress credit below.
 */
export const TOWER_ACTIVITY_STATUSES = [
  "Not Started",
  "Ready",
  "In Progress",
  "Completed",
  "Under Verification",
  "Approved",
  "Hold",
  "Blocked",
  "Rejected",
] as const;

export type TowerActivityStatus = (typeof TOWER_ACTIVITY_STATUSES)[number];

/** Statuses whose work is physically finished on the ground. */
const COMPLETE_STATUSES: readonly TowerActivityStatus[] = [
  "Completed",
  "Under Verification",
  "Approved",
];

/** Statuses where work has begun but is not finished. */
const IN_FLIGHT_STATUSES: readonly TowerActivityStatus[] = ["In Progress", "Hold"];

/** Statuses that need somebody's attention rather than more time. */
const EXCEPTION_STATUSES: readonly TowerActivityStatus[] = ["Hold", "Blocked", "Rejected"];

/** Statuses that require a written reason before they can be saved. */
const REASON_REQUIRED_STATUSES: readonly TowerActivityStatus[] = ["Hold", "Blocked", "Rejected"];

export function isActivityComplete(status: TowerActivityStatus): boolean {
  return COMPLETE_STATUSES.includes(status);
}

export function isActivityInFlight(status: TowerActivityStatus): boolean {
  return IN_FLIGHT_STATUSES.includes(status);
}

export function isActivityException(status: TowerActivityStatus): boolean {
  return EXCEPTION_STATUSES.includes(status);
}

export function activityStatusNeedsReason(status: TowerActivityStatus): boolean {
  return REASON_REQUIRED_STATUSES.includes(status);
}

/**
 * Fraction of an activity's weight a status earns.
 *
 * Finished work earns full credit even while it waits for verification — the tower is built whether
 * or not a signature has landed, and hiding that would make the dashboard lag reality by days.
 * Blocked and Rejected earn nothing: a blocked ROW has produced nothing usable, and rejected work
 * has to be redone, so crediting either would overstate the line. Hold earns half, because work was
 * genuinely under way when it paused.
 */
export function activityStatusCredit(status: TowerActivityStatus): number {
  if (isActivityComplete(status)) return 1;
  if (status === "In Progress" || status === "Hold") return 0.5;
  return 0;
}

/**
 * Which status changes are allowed. Status moves through explicit actions, never by editing a
 * dropdown to an arbitrary value: a Completed activity cannot quietly become Not Started, and an
 * Approved one cannot be edited at all without being reopened first.
 */
const ALLOWED_ACTIVITY_TRANSITIONS: Record<TowerActivityStatus, TowerActivityStatus[]> = {
  "Not Started": ["Ready", "In Progress", "Hold", "Blocked"],
  Ready: ["In Progress", "Hold", "Blocked", "Not Started"],
  "In Progress": ["Completed", "Hold", "Blocked"],
  Completed: ["Under Verification", "Approved", "In Progress"],
  "Under Verification": ["Approved", "Rejected", "Completed"],
  Approved: ["Under Verification"],
  Hold: ["In Progress", "Ready", "Blocked"],
  Blocked: ["Ready", "In Progress", "Hold"],
  Rejected: ["In Progress"],
};

export function canTransitionActivity(from: TowerActivityStatus, to: TowerActivityStatus): boolean {
  if (from === to) return true;
  return ALLOWED_ACTIVITY_TRANSITIONS[from].includes(to);
}

export function nextActivityStatuses(from: TowerActivityStatus): TowerActivityStatus[] {
  return ALLOWED_ACTIVITY_TRANSITIONS[from];
}

export const activityStatusStyles: Record<TowerActivityStatus, string> = {
  "Not Started": "bg-slate-100 text-slate-700",
  Ready: "bg-sky-100 text-sky-700",
  "In Progress": "bg-blue-100 text-blue-700",
  Completed: "bg-emerald-100 text-emerald-700",
  "Under Verification": "bg-amber-100 text-amber-800",
  Approved: "bg-emerald-200 text-emerald-900",
  Hold: "bg-orange-100 text-orange-700",
  Blocked: "bg-red-100 text-red-700",
  Rejected: "bg-rose-200 text-rose-900",
};

/** Compact status token for the tower-status matrix, where a full badge per cell is unreadable. */
export const activityStatusToken: Record<TowerActivityStatus, string> = {
  "Not Started": "—",
  Ready: "RDY",
  "In Progress": "WIP",
  Completed: "✓",
  "Under Verification": "UV",
  Approved: "✓✓",
  Hold: "HOLD",
  Blocked: "BLK",
  Rejected: "REJ",
};

/* ── Verification ───────────────────────────────────────────────────────────────────────────── */

export const TOWER_VERIFICATION_STATES = ["Pending", "Approved", "Rejected"] as const;
export type TowerVerificationState = (typeof TOWER_VERIFICATION_STATES)[number];

export const verificationStateStyles: Record<TowerVerificationState, string> = {
  Pending: "bg-amber-100 text-amber-800",
  Approved: "bg-emerald-100 text-emerald-700",
  Rejected: "bg-red-100 text-red-700",
};

/* ── Records ────────────────────────────────────────────────────────────────────────────────── */

export interface TowerGpsFix {
  latitude: number;
  longitude: number;
  /** Reported accuracy in metres, when the device supplies one. */
  accuracyM?: number;
  /** ISO timestamp of the fix, which is not always the upload time. */
  capturedAt?: string;
}

export interface TowerPhoto {
  id: string;
  kind: TowerPhotoKind;
  fileName: string;
  url: string;
  storagePath: string;
  mimeType: string;
  fileSize: number;
  gps?: TowerGpsFix | null;
  /** Marks the single photograph this activity contributes to official reports. */
  isReportPhoto?: boolean;
  caption?: string;
}

export interface TowerProgressUpdate {
  id: string;
  towerId: string;
  /** Denormalised so the daily/weekly reports and the verification queue need no tower join. */
  towerNo: string;
  towerType?: string;
  location?: string;
  contractor?: string;
  activity: TowerActivity;
  fromStatus: TowerActivityStatus;
  toStatus: TowerActivityStatus;
  /** The date the work happened, which is not always the date it was entered. */
  progressDate: string;
  remarks?: string;
  /** Reason for a Hold / Blocked / Rejected status. */
  reason?: string;
  /** Length strung or laid, for the two span activities. */
  quantityM?: number;
  gps?: TowerGpsFix | null;
  photos: TowerPhoto[];
  verificationState: TowerVerificationState;
  verifiedById?: string;
  verifiedByName?: string;
  verifiedAt?: string;
  verificationRemarks?: string;
  /** True when the update was saved despite missing evidence, under `warn` enforcement. */
  evidenceShortfall?: boolean;
  createdBy: string;
  createdByName: string;
  createdAt?: unknown;
}

export interface TowerActivityState {
  status: TowerActivityStatus;
  plannedStartDate?: string;
  plannedEndDate?: string;
  startedDate?: string;
  completedDate?: string;
  remarks?: string;
  reason?: string;
  /** Cumulative metres for span activities. */
  quantityM?: number;
  /** Evidence counters, denormalised so no report has to fan out over update documents. */
  photoCount: number;
  approvedPhotoCount: number;
  /** Which required kinds have at least one photograph. Lets the missing-evidence report name the
   *  actual gap rather than just flagging a count mismatch. */
  presentPhotoKinds: TowerPhotoKind[];
  reportPhotoUrl?: string;
  reportPhotoDate?: string;
  reportPhotoUpdateId?: string;
  verificationState?: TowerVerificationState;
  /** Date the activity entered its current status — what "pending since / N days" is measured from. */
  statusSince?: string;
  /** Progress date of the most recent update on this activity, not a wall-clock write time. */
  lastUpdatedAt?: string;
  lastUpdatedByName?: string;
}

export interface ProjectTower {
  id: string;
  /** Unique within a project. Displayed everywhere, so it is stored exactly as entered. */
  towerNo: string;
  towerType?: string;
  section?: string;
  location?: string;
  latitude?: number;
  longitude?: number;
  contractor?: string;
  /** Span to the next tower in metres — what turns "5 spans strung" into "2.8 km". */
  spanToNextM?: number;
  /** Numeric part of the tower number, for ordering and for drawing the route in sequence. */
  sequence: number;
  activities: Record<TowerActivity, TowerActivityState>;
  /** Denormalised weighted roll-up, recomputed on every progress write. */
  overallProgressPct: number;
  createdAt?: unknown;
  createdBy?: string;
  createdByName?: string;
  updatedAt?: unknown;
  updatedBy?: string;
  updatedByName?: string;
}

export type ProjectTowerDraft = Pick<
  ProjectTower,
  | "towerNo"
  | "towerType"
  | "section"
  | "location"
  | "latitude"
  | "longitude"
  | "contractor"
  | "spanToNextM"
>;

/* ── Settings ───────────────────────────────────────────────────────────────────────────────── */

/**
 * Whether a completion claim without its minimum photographs is refused or merely flagged.
 *
 * `block` is the stronger control and the one to aim for. `warn` exists because a site on a 2G link
 * in the middle of a line corridor sometimes genuinely cannot upload four photographs before the
 * crew moves on, and refusing the status update in that situation does not produce evidence — it
 * produces a WhatsApp message and an out-of-date system. Under `warn` the tower is flagged, excluded
 * from client reports, and listed in the No Evidence report until the photographs arrive.
 */
export const EVIDENCE_ENFORCEMENT_MODES = ["block", "warn"] as const;
export type EvidenceEnforcementMode = (typeof EVIDENCE_ENFORCEMENT_MODES)[number];

export interface TowerProgressSettings {
  evidenceEnforcement: EvidenceEnforcementMode;
  /** Require a GPS fix alongside the photographs. */
  requireGps: boolean;
  /** Route completions through the verification queue before they count as Approved. */
  requireVerification: boolean;
  /** Only verified photographs may appear in client-facing reports. */
  clientReportsRequireApprovedPhotos: boolean;
  /** Days an activity may sit in a non-complete status before the Delayed report picks it up. */
  delayThresholdDays: number;
  /** Per-activity contribution to a tower's overall progress; must total 100. */
  activityWeights: Record<TowerActivity, number>;
  /** Company name burnt into the report photograph caption. */
  watermarkOrganisation: string;
  updatedAt?: unknown;
  updatedBy?: string;
  updatedByName?: string;
}

/**
 * Default weights.
 *
 * These are not invented: they are the weights that reproduce the specification's own worked
 * example exactly, with in-progress work credited at half weight —
 *
 *   T-01  all seven complete                                     → 100%
 *   T-02  through erection complete, stringing + OPGW in progress →  85%
 *   T-03  through structure complete, erection in progress        →  65%
 *   T-04  survey complete only                                    →  15%
 *
 * Solving those four cases pins survey at 15, erection at 10, the ROW→structure band at 45 and the
 * stringing+OPGW band at 30. They are editable per project because the balance shifts with voltage
 * class and terrain; anything summing to 100 is valid.
 */
export const DEFAULT_ACTIVITY_WEIGHTS: Record<TowerActivity, number> = {
  survey: 15,
  row: 10,
  foundation: 25,
  structure: 10,
  erection: 10,
  stringing: 20,
  opgw: 10,
};

export const DEFAULT_TOWER_PROGRESS_SETTINGS: TowerProgressSettings = {
  evidenceEnforcement: "block",
  requireGps: false,
  requireVerification: true,
  clientReportsRequireApprovedPhotos: true,
  delayThresholdDays: 7,
  activityWeights: { ...DEFAULT_ACTIVITY_WEIGHTS },
  watermarkOrganisation: "SIDHARTHA ENGINEERING LIMITED",
};

const finiteNumber = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : undefined;
};

/** Tolerant read of a stored settings document, so a project configured before a field existed —
 *  or one with a hand-edited document — still resolves to a complete, usable configuration. */
export function resolveTowerProgressSettings(raw: unknown): TowerProgressSettings {
  const stored = (raw ?? {}) as Partial<TowerProgressSettings> & Record<string, unknown>;
  const weights = { ...DEFAULT_ACTIVITY_WEIGHTS };
  const storedWeights = (stored.activityWeights ?? {}) as Record<string, unknown>;
  TOWER_ACTIVITIES.forEach((activity) => {
    const weight = finiteNumber(storedWeights[activity]);
    if (weight !== undefined && weight >= 0) weights[activity] = weight;
  });
  const delay = finiteNumber(stored.delayThresholdDays);
  return {
    evidenceEnforcement: EVIDENCE_ENFORCEMENT_MODES.includes(
      stored.evidenceEnforcement as EvidenceEnforcementMode,
    )
      ? (stored.evidenceEnforcement as EvidenceEnforcementMode)
      : DEFAULT_TOWER_PROGRESS_SETTINGS.evidenceEnforcement,
    requireGps:
      typeof stored.requireGps === "boolean"
        ? stored.requireGps
        : DEFAULT_TOWER_PROGRESS_SETTINGS.requireGps,
    requireVerification:
      typeof stored.requireVerification === "boolean"
        ? stored.requireVerification
        : DEFAULT_TOWER_PROGRESS_SETTINGS.requireVerification,
    clientReportsRequireApprovedPhotos:
      typeof stored.clientReportsRequireApprovedPhotos === "boolean"
        ? stored.clientReportsRequireApprovedPhotos
        : DEFAULT_TOWER_PROGRESS_SETTINGS.clientReportsRequireApprovedPhotos,
    delayThresholdDays:
      delay !== undefined && delay > 0
        ? Math.round(delay)
        : DEFAULT_TOWER_PROGRESS_SETTINGS.delayThresholdDays,
    activityWeights: weights,
    watermarkOrganisation:
      String(stored.watermarkOrganisation ?? "").trim() ||
      DEFAULT_TOWER_PROGRESS_SETTINGS.watermarkOrganisation,
    updatedAt: stored.updatedAt,
    updatedBy: stored.updatedBy as string | undefined,
    updatedByName: stored.updatedByName as string | undefined,
  };
}

export interface SettingsValidationError {
  field: keyof TowerProgressSettings | TowerActivity;
  message: string;
}

export function validateTowerProgressSettings(
  settings: TowerProgressSettings,
): SettingsValidationError[] {
  const errors: SettingsValidationError[] = [];
  TOWER_ACTIVITIES.forEach((activity) => {
    const weight = settings.activityWeights[activity];
    if (!Number.isFinite(weight) || weight < 0) {
      errors.push({ field: activity, message: `${TOWER_ACTIVITY_DEFINITIONS[activity].label} weight must be zero or more.` });
    }
  });
  const total = TOWER_ACTIVITIES.reduce(
    (sum, activity) => sum + (Number(settings.activityWeights[activity]) || 0),
    0,
  );
  // Rounded before comparing so 33.33 × 3 does not read as invalid.
  if (Math.round(total * 100) / 100 !== 100) {
    errors.push({
      field: "activityWeights",
      message: `Activity weights must total 100. They currently total ${Math.round(total * 100) / 100}.`,
    });
  }
  if (!Number.isFinite(settings.delayThresholdDays) || settings.delayThresholdDays < 1) {
    errors.push({ field: "delayThresholdDays", message: "The delay threshold must be at least one day." });
  }
  if (!settings.watermarkOrganisation.trim()) {
    errors.push({ field: "watermarkOrganisation", message: "The report watermark needs an organisation name." });
  }
  return errors;
}

/* ── Reading stored towers ──────────────────────────────────────────────────────────────────── */

export function emptyActivityState(): TowerActivityState {
  return { status: "Not Started", photoCount: 0, approvedPhotoCount: 0, presentPhotoKinds: [] };
}

export function emptyTowerActivities(): Record<TowerActivity, TowerActivityState> {
  return TOWER_ACTIVITIES.reduce(
    (map, activity) => {
      map[activity] = emptyActivityState();
      return map;
    },
    {} as Record<TowerActivity, TowerActivityState>,
  );
}

const optionalText = (value: unknown): string | undefined => {
  const text = String(value ?? "").trim();
  return text || undefined;
};

/** Tolerant read of one stored activity state. Anything unrecognised degrades to Not Started rather
 *  than throwing, so one malformed document cannot take down a 186-tower register. */
export function readActivityState(raw: unknown): TowerActivityState {
  const stored = (raw ?? {}) as Record<string, unknown>;
  const status = TOWER_ACTIVITY_STATUSES.includes(stored.status as TowerActivityStatus)
    ? (stored.status as TowerActivityStatus)
    : "Not Started";
  const presentKinds = Array.isArray(stored.presentPhotoKinds)
    ? stored.presentPhotoKinds.filter(isTowerPhotoKind)
    : [];
  return {
    status,
    plannedStartDate: optionalText(stored.plannedStartDate),
    plannedEndDate: optionalText(stored.plannedEndDate),
    startedDate: optionalText(stored.startedDate),
    completedDate: optionalText(stored.completedDate),
    remarks: optionalText(stored.remarks),
    reason: optionalText(stored.reason),
    quantityM: finiteNumber(stored.quantityM),
    photoCount: finiteNumber(stored.photoCount) ?? 0,
    approvedPhotoCount: finiteNumber(stored.approvedPhotoCount) ?? 0,
    presentPhotoKinds: presentKinds,
    reportPhotoUrl: optionalText(stored.reportPhotoUrl),
    reportPhotoDate: optionalText(stored.reportPhotoDate),
    reportPhotoUpdateId: optionalText(stored.reportPhotoUpdateId),
    verificationState: TOWER_VERIFICATION_STATES.includes(
      stored.verificationState as TowerVerificationState,
    )
      ? (stored.verificationState as TowerVerificationState)
      : undefined,
    statusSince: optionalText(stored.statusSince),
    lastUpdatedAt: optionalText(stored.lastUpdatedAt),
    lastUpdatedByName: optionalText(stored.lastUpdatedByName),
  };
}

/**
 * Numeric ordering key for a tower number. "T-37", "T037", "AP-37/A" and "37" all sort as 37, so a
 * project can label its towers however the client's schedule does and still get a route in order.
 * Returns a large sentinel when there is no number at all, keeping such towers at the end rather
 * than silently at the front.
 */
export function parseTowerSequence(towerNo: string): number {
  const match = String(towerNo ?? "").match(/\d+/);
  return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER;
}

/** Sorts by numeric sequence, then by label, so "T-37" and "T-37/A" stay adjacent and in order. */
export function compareTowers(
  a: Pick<ProjectTower, "sequence" | "towerNo">,
  b: Pick<ProjectTower, "sequence" | "towerNo">,
): number {
  if (a.sequence !== b.sequence) return a.sequence - b.sequence;
  return a.towerNo.localeCompare(b.towerNo, undefined, { numeric: true, sensitivity: "base" });
}

/** Tolerant read of a stored tower document. */
export function readTower(id: string, raw: unknown): ProjectTower {
  const stored = (raw ?? {}) as Record<string, unknown>;
  const towerNo = String(stored.towerNo ?? "").trim();
  const storedActivities = (stored.activities ?? {}) as Record<string, unknown>;
  const activities = TOWER_ACTIVITIES.reduce(
    (map, activity) => {
      map[activity] = readActivityState(storedActivities[activity]);
      return map;
    },
    {} as Record<TowerActivity, TowerActivityState>,
  );
  const sequence = finiteNumber(stored.sequence) ?? parseTowerSequence(towerNo);
  return {
    id,
    towerNo,
    towerType: optionalText(stored.towerType),
    section: optionalText(stored.section),
    location: optionalText(stored.location),
    latitude: finiteNumber(stored.latitude),
    longitude: finiteNumber(stored.longitude),
    contractor: optionalText(stored.contractor),
    spanToNextM: finiteNumber(stored.spanToNextM),
    sequence,
    activities,
    overallProgressPct: finiteNumber(stored.overallProgressPct) ?? 0,
    createdAt: stored.createdAt,
    createdBy: optionalText(stored.createdBy),
    createdByName: optionalText(stored.createdByName),
    updatedAt: stored.updatedAt,
    updatedBy: optionalText(stored.updatedBy),
    updatedByName: optionalText(stored.updatedByName),
  };
}

/* ── Progress ───────────────────────────────────────────────────────────────────────────────── */

/**
 * A tower's weighted progress, rounded to a whole percent.
 *
 * Weights are normalised by their own total rather than assumed to be 100, so a project that has
 * been misconfigured — or one deliberately zeroing an activity it does not run, such as OPGW on a
 * line without a fibre scope — still reports a sane 0–100 figure.
 */
export function computeTowerProgressPct(
  tower: Pick<ProjectTower, "activities">,
  weights: Record<TowerActivity, number> = DEFAULT_ACTIVITY_WEIGHTS,
): number {
  let earned = 0;
  let available = 0;
  TOWER_ACTIVITIES.forEach((activity) => {
    const weight = Number(weights[activity]) || 0;
    if (weight <= 0) return;
    available += weight;
    earned += weight * activityStatusCredit(tower.activities[activity].status);
  });
  if (available <= 0) return 0;
  return Math.round((earned / available) * 100);
}

/** Days an activity has sat in its current status. Returns undefined when nothing is recorded. */
export function daysInCurrentStatus(
  state: Pick<TowerActivityState, "statusSince">,
  today: Date = new Date(),
): number | undefined {
  if (!state.statusSince) return undefined;
  const since = parseIsoDate(state.statusSince);
  if (!since) return undefined;
  const days = Math.floor((startOfDay(today).getTime() - since.getTime()) / 86_400_000);
  return days < 0 ? 0 : days;
}

/* ── Evidence ───────────────────────────────────────────────────────────────────────────────── */

/** Required photograph kinds an activity is still missing. */
export function missingRequiredPhotoKinds(
  activity: TowerActivity,
  presentKinds: readonly TowerPhotoKind[],
): TowerPhotoKind[] {
  const present = new Set(presentKinds);
  return TOWER_ACTIVITY_DEFINITIONS[activity].requiredPhotoKinds.filter(
    (kind) => !present.has(kind),
  );
}

/** Whether an activity's stored state satisfies its minimum evidence set. */
export function hasCompleteEvidence(
  activity: TowerActivity,
  state: Pick<TowerActivityState, "presentPhotoKinds">,
): boolean {
  return missingRequiredPhotoKinds(activity, state.presentPhotoKinds).length === 0;
}

/**
 * Whether an activity's evidence may be shown to a client.
 *
 * Two gates: the minimum photograph set must be present, and — when the project requires it — the
 * update carrying those photographs must have been verified. A rejected photograph never reaches a
 * client report, which is the entire point of the verification step.
 */
export function isEvidenceClientReady(
  activity: TowerActivity,
  state: Pick<TowerActivityState, "presentPhotoKinds" | "verificationState">,
  settings: Pick<TowerProgressSettings, "clientReportsRequireApprovedPhotos">,
): boolean {
  if (!hasCompleteEvidence(activity, state)) return false;
  if (!settings.clientReportsRequireApprovedPhotos) return true;
  return state.verificationState === "Approved";
}

/* ── Validation ─────────────────────────────────────────────────────────────────────────────── */

export interface TowerProgressUpdateInput {
  activity: TowerActivity;
  fromStatus: TowerActivityStatus;
  toStatus: TowerActivityStatus;
  progressDate: string;
  remarks: string;
  reason: string;
  quantityM?: number;
  gps?: TowerGpsFix | null;
  /** Photograph kinds attached to this update, plus those the activity already holds. */
  photoKinds: TowerPhotoKind[];
}

export interface TowerProgressValidation {
  /** Conditions that must be fixed before the update can be saved. */
  errors: string[];
  /** Conditions worth telling the user about that do not stop the save. */
  warnings: string[];
  /** True when Completed was claimed without the full evidence set under `warn` enforcement — the
   *  update saves, and the tower is flagged for the No Evidence report. */
  evidenceShortfall: boolean;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseIsoDate(value?: string): Date | null {
  if (!value || !DATE_PATTERN.test(value)) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

export function toDateKey(value: Date): string {
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${value.getFullYear()}-${month}-${day}`;
}

/**
 * Every rule a progress update has to clear, in one place, so the update form, the import path and
 * the service layer cannot disagree about what a valid update is.
 *
 * Prerequisites are reported as warnings rather than errors on purpose. Lines really are built out
 * of order — ROW gets cleared ahead of a survey approval, a crane arrives early and a tower goes up
 * before its structure record was closed out — and refusing those updates would push the site back
 * to recording progress outside the system, which costs far more than an out-of-order timestamp.
 */
export function validateTowerProgressUpdate(
  input: TowerProgressUpdateInput,
  options: {
    tower: Pick<ProjectTower, "activities" | "towerNo">;
    settings: Pick<TowerProgressSettings, "evidenceEnforcement" | "requireGps">;
    today?: Date;
  },
): TowerProgressValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { tower, settings } = options;
  const today = options.today ?? new Date();
  const definition = TOWER_ACTIVITY_DEFINITIONS[input.activity];

  if (!canTransitionActivity(input.fromStatus, input.toStatus)) {
    errors.push(
      `${definition.label} cannot move from ${input.fromStatus} to ${input.toStatus}. Allowed: ${nextActivityStatuses(input.fromStatus).join(", ")}.`,
    );
  }

  const progressDate = parseIsoDate(input.progressDate);
  if (!progressDate) {
    errors.push("A valid progress date is required.");
  } else if (progressDate.getTime() > startOfDay(today).getTime()) {
    errors.push("The progress date cannot be in the future.");
  }

  if (activityStatusNeedsReason(input.toStatus) && !input.reason.trim()) {
    errors.push(`Record why ${definition.label} is ${input.toStatus.toLowerCase()} before saving.`);
  }

  if (input.toStatus === "Rejected" && !input.reason.trim()) {
    errors.push("A rejection needs a reason the site can act on.");
  }

  if (definition.measure === "span" && isActivityComplete(input.toStatus)) {
    if (input.quantityM === undefined || !Number.isFinite(input.quantityM) || input.quantityM <= 0) {
      errors.push(`${definition.label} is measured per span — record the length completed in metres.`);
    }
  }

  if (settings.requireGps && !input.gps) {
    errors.push("This project requires a GPS fix with every progress update.");
  }

  // Evidence is only checked at the point a completion is claimed; nobody should need four
  // photographs to say work has started.
  let evidenceShortfall = false;
  if (isActivityComplete(input.toStatus)) {
    const existing = tower.activities[input.activity]?.presentPhotoKinds ?? [];
    const combined = [...existing, ...input.photoKinds];
    const missing = missingRequiredPhotoKinds(input.activity, combined);
    if (missing.length) {
      const names = missing.map((kind) => TOWER_PHOTO_KIND_LABELS[kind]).join(", ");
      if (settings.evidenceEnforcement === "block") {
        errors.push(
          `${definition.label} cannot be completed without photographic evidence. Missing: ${names}.`,
        );
      } else {
        evidenceShortfall = true;
        warnings.push(
          `Saved without the full evidence set. ${tower.towerNo} will appear in the No Evidence report until these are uploaded: ${names}.`,
        );
      }
    }
  }

  // Out-of-order execution: a warning, never a block.
  if (definition.prerequisite && isActivityComplete(input.toStatus)) {
    const previous = tower.activities[definition.prerequisite];
    if (previous && !isActivityComplete(previous.status)) {
      warnings.push(
        `${TOWER_ACTIVITY_DEFINITIONS[definition.prerequisite].label} is still ${previous.status.toLowerCase()} on ${tower.towerNo}. Recording ${definition.label} as complete out of sequence.`,
      );
    }
  }

  return { errors, warnings, evidenceShortfall };
}

export interface TowerValidationError {
  field: keyof ProjectTowerDraft;
  message: string;
}

/**
 * Tower master rules. The tower number is the only truly mandatory field, because a tower schedule
 * often arrives with numbers and locations first and GPS/type filled in after the survey walk.
 * Coordinates, when given, are checked against real bounds — a transposed lat/long pair is otherwise
 * only noticed when the map report puts the line in the sea.
 */
export function validateTowerDraft(
  draft: ProjectTowerDraft,
  existingTowerNos: readonly string[] = [],
): TowerValidationError[] {
  const errors: TowerValidationError[] = [];
  const towerNo = draft.towerNo?.trim() ?? "";
  if (!towerNo) {
    errors.push({ field: "towerNo", message: "Tower number is required." });
  } else if (towerNo.length > 40) {
    errors.push({ field: "towerNo", message: "Tower number must be 40 characters or fewer." });
  } else if (
    existingTowerNos.some((existing) => existing.trim().toLowerCase() === towerNo.toLowerCase())
  ) {
    errors.push({ field: "towerNo", message: `Tower ${towerNo} already exists in this project.` });
  }
  if (draft.latitude !== undefined) {
    if (!Number.isFinite(draft.latitude) || draft.latitude < -90 || draft.latitude > 90) {
      errors.push({ field: "latitude", message: "Latitude must be between -90 and 90." });
    }
  }
  if (draft.longitude !== undefined) {
    if (!Number.isFinite(draft.longitude) || draft.longitude < -180 || draft.longitude > 180) {
      errors.push({ field: "longitude", message: "Longitude must be between -180 and 180." });
    }
  }
  if ((draft.latitude === undefined) !== (draft.longitude === undefined)) {
    errors.push({
      field: draft.latitude === undefined ? "latitude" : "longitude",
      message: "Give both latitude and longitude, or neither.",
    });
  }
  if (draft.spanToNextM !== undefined) {
    if (!Number.isFinite(draft.spanToNextM) || draft.spanToNextM < 0) {
      errors.push({ field: "spanToNextM", message: "Span length cannot be negative." });
    } else if (draft.spanToNextM > 5000) {
      errors.push({ field: "spanToNextM", message: "Span length over 5 km looks like a unit mix-up." });
    }
  }
  return errors;
}

/* ── Project roll-up ────────────────────────────────────────────────────────────────────────── */

export interface ActivitySummary {
  activity: TowerActivity;
  label: string;
  measure: "tower" | "span";
  /** Denominator: towers for tower activities, spans (towers − 1) for span activities. */
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
  blocked: number;
  hold: number;
  underVerification: number;
  /** Completions still missing their minimum evidence set. */
  missingEvidence: number;
  completionPct: number;
  /** Metres recorded, for span activities. */
  quantityM: number;
}

export interface TowerProgressSummary {
  totalTowers: number;
  totalSpans: number;
  /** Towers with all seven activities complete. */
  fullyCompletedTowers: number;
  /** Towers where at least one activity is Blocked. */
  blockedTowers: number;
  towersWithoutEvidence: number;
  overallProgressPct: number;
  activities: ActivitySummary[];
}

/**
 * The dashboard roll-up.
 *
 * Span activities are counted against spans rather than towers: on a 186-tower line there are 185
 * spans to string, and reporting stringing as "92 of 186" would understate it by a whole span every
 * time. Overall progress is the mean of the towers' own weighted progress, so it moves smoothly as
 * work advances instead of jumping when an activity finishes across the whole line.
 */
export function calculateTowerProgressSummary(
  towers: readonly ProjectTower[],
  settings: Pick<TowerProgressSettings, "activityWeights"> = DEFAULT_TOWER_PROGRESS_SETTINGS,
): TowerProgressSummary {
  const totalTowers = towers.length;
  const totalSpans = totalTowers > 0 ? totalTowers - 1 : 0;

  const activities = TOWER_ACTIVITY_LIST.map((definition) => {
    const total = definition.measure === "span" ? totalSpans : totalTowers;
    const summary: ActivitySummary = {
      activity: definition.key,
      label: definition.label,
      measure: definition.measure,
      total,
      completed: 0,
      inProgress: 0,
      pending: 0,
      blocked: 0,
      hold: 0,
      underVerification: 0,
      missingEvidence: 0,
      completionPct: 0,
      quantityM: 0,
    };
    towers.forEach((tower) => {
      const state = tower.activities[definition.key];
      summary.quantityM += state.quantityM ?? 0;
      if (isActivityComplete(state.status)) {
        summary.completed += 1;
        if (state.status === "Under Verification") summary.underVerification += 1;
        if (!hasCompleteEvidence(definition.key, state)) summary.missingEvidence += 1;
      } else if (state.status === "In Progress") {
        summary.inProgress += 1;
      } else {
        summary.pending += 1;
      }
      if (state.status === "Blocked") summary.blocked += 1;
      if (state.status === "Hold") summary.hold += 1;
    });
    // Span activities are recorded on the tower at the near end of the span, so the last tower on
    // the line carries no span of its own and its state must not count against the denominator.
    if (definition.measure === "span" && summary.completed > totalSpans) {
      summary.completed = totalSpans;
    }
    summary.completionPct = total > 0 ? Math.round((summary.completed / total) * 100) : 0;
    return summary;
  });

  const fullyCompletedTowers = towers.filter((tower) =>
    TOWER_ACTIVITIES.every((activity) => isActivityComplete(tower.activities[activity].status)),
  ).length;

  const blockedTowers = towers.filter((tower) =>
    TOWER_ACTIVITIES.some((activity) => tower.activities[activity].status === "Blocked"),
  ).length;

  const towersWithoutEvidence = towers.filter((tower) =>
    TOWER_ACTIVITIES.some(
      (activity) =>
        isActivityComplete(tower.activities[activity].status) &&
        !hasCompleteEvidence(activity, tower.activities[activity]),
    ),
  ).length;

  const overallProgressPct = totalTowers
    ? Math.round(
        towers.reduce(
          (sum, tower) => sum + computeTowerProgressPct(tower, settings.activityWeights),
          0,
        ) / totalTowers,
      )
    : 0;

  return {
    totalTowers,
    totalSpans,
    fullyCompletedTowers,
    blockedTowers,
    towersWithoutEvidence,
    overallProgressPct,
    activities,
  };
}

/* ── Formatting helpers shared by screens and reports ───────────────────────────────────────── */

/** `10-Aug-2026`, the form every progress report in this business uses. */
export function formatTowerDate(value?: string): string {
  const date = parseIsoDate(value);
  if (!date) return value?.trim() || "—";
  return date
    .toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    .replace(/ /g, "-");
}

/** Metres rendered as kilometres to two decimals — how stringing and OPGW are always quoted. */
export function formatKm(metres: number): string {
  return `${(metres / 1000).toFixed(2)} KM`;
}

export function formatGps(gps?: TowerGpsFix | null): string {
  if (!gps) return "—";
  return `${gps.latitude.toFixed(4)}, ${gps.longitude.toFixed(4)}`;
}

/** ISO week number, for the weekly report's "Week 34" heading. */
export function isoWeekNumber(value: Date): number {
  const target = new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  const dayNumber = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil(((target.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

/** Monday of the week containing `value`, as a date key. Weeks run Monday–Sunday on site. */
export function weekStartKey(value: Date): string {
  const start = startOfDay(value);
  const offset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - offset);
  return toDateKey(start);
}

/** Adds days to a date key, staying in local time so no shift crosses a day boundary. */
export function addDaysToKey(key: string, days: number): string {
  const date = parseIsoDate(key);
  if (!date) return key;
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

export { parseIsoDate, startOfDay };

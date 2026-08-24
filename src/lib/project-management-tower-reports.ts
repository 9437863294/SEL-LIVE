/**
 * The Tower Progress reporting engine.
 *
 * Every report in this module is a pure projection of two inputs: the tower register and the
 * append-only progress-update register. Nothing is stored per report, nothing is assembled by hand,
 * and no report can disagree with the dashboard — they all read the same two arrays through the
 * functions below.
 *
 * That is the whole design goal. A site engineer records a tower activity with photographs; the
 * daily, weekly, monthly, activity-wise, exception and photographic reports all change as a
 * consequence, because they are queries rather than documents.
 *
 * Pure — no Firebase, no React — so the aggregation rules are unit-testable with `node --test`.
 */

import {
  TOWER_ACTIVITIES,
  TOWER_ACTIVITY_DEFINITIONS,
  TOWER_ACTIVITY_LIST,
  TOWER_PHOTO_KIND_LABELS,
  activityStatusToken,
  addDaysToKey,
  compareTowers,
  computeTowerProgressPct,
  daysInCurrentStatus,
  hasCompleteEvidence,
  isActivityComplete,
  isEvidenceClientReady,
  missingRequiredPhotoKinds,
  parseIsoDate,
  startOfDay,
  toDateKey,
  type ProjectTower,
  type TowerActivity,
  type TowerActivityState,
  type TowerActivityStatus,
  type TowerPhoto,
  type TowerProgressSettings,
  type TowerProgressUpdate,
} from "./project-management-tower-progress.ts";

/* ── Report registry ────────────────────────────────────────────────────────────────────────── */

/**
 * How a report renders. Kept small on purpose: fifteen reports share six renderers, so a new report
 * is a registry entry plus a builder rather than another page component to keep in step.
 */
export type TowerReportKind =
  | "summary"
  | "matrix"
  | "rows"
  | "period"
  | "daily"
  | "photo-pages"
  | "photo-rows"
  | "before-after"
  | "timeline"
  | "map";

export type TowerReportGroup = "Executive" | "Activity" | "Photo" | "Exception";

export interface TowerReportDefinition {
  /** Route segment under `.../tower-progress/reports/`. */
  id: string;
  title: string;
  group: TowerReportGroup;
  description: string;
  kind: TowerReportKind;
  /** Set on the activity-wise and per-activity exception reports. */
  activity?: TowerActivity;
  /** Whether the report is meaningful to hand to a client. Drives the evidence gate. */
  clientFacing?: boolean;
}

const activityReport = (activity: TowerActivity, id: string): TowerReportDefinition => ({
  id,
  title: `${TOWER_ACTIVITY_DEFINITIONS[activity].label} Report`,
  group: "Activity",
  description: `Every tower's ${TOWER_ACTIVITY_DEFINITIONS[activity].label.toLowerCase()} status, dates, contractor and photograph.`,
  kind: "rows",
  activity,
  clientFacing: true,
});

const pendingReport = (activity: TowerActivity, id: string): TowerReportDefinition => ({
  id,
  title: `${TOWER_ACTIVITY_DEFINITIONS[activity].label} Pending`,
  group: "Exception",
  description: `Towers whose preceding work is done but ${TOWER_ACTIVITY_DEFINITIONS[activity].label.toLowerCase()} has not started or finished, with how long they have waited.`,
  kind: "rows",
  activity,
});

/**
 * Every report the module offers, in the order the reports hub lists them. Ids double as route
 * segments, so `/reports/tower-status` and this table can never drift apart.
 */
export const TOWER_REPORTS: TowerReportDefinition[] = [
  {
    id: "project-summary",
    title: "Project Summary",
    group: "Executive",
    description: "Headline counts per activity, overall progress, and where the line stands today.",
    kind: "summary",
    clientFacing: true,
  },
  {
    id: "tower-status",
    title: "Tower Status",
    group: "Executive",
    description: "One row per tower, one column per activity — the module's main report.",
    kind: "matrix",
    clientFacing: true,
  },
  {
    id: "daily-progress",
    title: "Daily Progress",
    group: "Executive",
    description: "What was completed on a chosen date, with the photographs recorded against it.",
    kind: "daily",
    clientFacing: true,
  },
  {
    id: "weekly-progress",
    title: "Weekly Progress",
    group: "Executive",
    description: "Opening, this week, cumulative and balance per activity, with the week's photographs.",
    kind: "period",
    clientFacing: true,
  },
  {
    id: "monthly-progress",
    title: "Monthly Progress",
    group: "Executive",
    description: "The formal management and client report for a calendar month.",
    kind: "period",
    clientFacing: true,
  },
  activityReport("survey", "survey"),
  activityReport("row", "row"),
  activityReport("foundation", "foundation"),
  activityReport("structure", "tower-structure"),
  activityReport("erection", "erection"),
  activityReport("stringing", "stringing"),
  activityReport("opgw", "opgw"),
  {
    id: "photo-progress",
    title: "Tower Photo Report",
    group: "Photo",
    description: "A page per tower: details, activity status, and the site photographs for each activity.",
    kind: "photo-pages",
    clientFacing: true,
  },
  {
    id: "latest-photos",
    title: "Latest Photos",
    group: "Photo",
    description: "The most recent photograph per tower, so progress is visible without opening each one.",
    kind: "photo-rows",
    clientFacing: true,
  },
  {
    id: "before-after",
    title: "Before / After",
    group: "Photo",
    description: "Survey location beside the completed tower, with total construction time.",
    kind: "before-after",
    clientFacing: true,
  },
  {
    id: "photo-timeline",
    title: "Photo Timeline",
    group: "Photo",
    description: "Every photograph in date order, tower by tower — visual proof from survey to stringing.",
    kind: "timeline",
    clientFacing: true,
  },
  {
    id: "map",
    title: "Map Progress",
    group: "Photo",
    description: "The route drawn from tower coordinates, colour-coded by progress, with a status legend.",
    kind: "map",
    clientFacing: true,
  },
  {
    id: "pending",
    title: "Pending Towers",
    group: "Exception",
    description: "Every activity that is ready to run but has not finished, and how long it has waited.",
    kind: "rows",
  },
  {
    id: "delayed",
    title: "Delayed Towers",
    group: "Exception",
    description: "Activities past their planned finish or stalled beyond the project's delay threshold.",
    kind: "rows",
  },
  {
    id: "missing-evidence",
    title: "No Photo Evidence",
    group: "Exception",
    description: "Completions recorded without their minimum photographs — the false-completion check.",
    kind: "rows",
  },
  {
    id: "row-blocked",
    title: "ROW Blocked",
    group: "Exception",
    description: "Towers where right-of-way is blocked or on hold, with the reason recorded on site.",
    kind: "rows",
    activity: "row",
  },
  pendingReport("foundation", "foundation-pending"),
  pendingReport("structure", "structure-pending"),
  pendingReport("erection", "erection-pending"),
  pendingReport("stringing", "stringing-pending"),
  {
    id: "completed-towers",
    title: "Completed Towers",
    group: "Exception",
    description: "Towers with all seven activities complete — the handover list.",
    kind: "rows",
    clientFacing: true,
  },
];

export function towerReportById(id: string): TowerReportDefinition | undefined {
  return TOWER_REPORTS.find((report) => report.id === id);
}

export const TOWER_REPORT_GROUPS: TowerReportGroup[] = [
  "Executive",
  "Activity",
  "Photo",
  "Exception",
];

/* ── Filters ────────────────────────────────────────────────────────────────────────────────── */

export interface TowerReportFilters {
  search?: string;
  section?: string;
  towerType?: string;
  contractor?: string;
  status?: TowerActivityStatus | "All";
  /** Inclusive tower-number range, by numeric sequence. */
  fromTowerNo?: string;
  toTowerNo?: string;
  /** Restricts date-sensitive reports. */
  fromDate?: string;
  toDate?: string;
}

const matchesText = (value: string | undefined, term: string): boolean =>
  String(value ?? "").toLowerCase().includes(term);

/**
 * Applies the shared filter bar to the tower register. Tower ranges are compared on the parsed
 * numeric sequence rather than the label, so `T-001` to `T-050` behaves as a range and not as a
 * string comparison that would exclude `T-9`.
 */
export function filterTowers(
  towers: readonly ProjectTower[],
  filters: TowerReportFilters,
  activity?: TowerActivity,
): ProjectTower[] {
  const term = filters.search?.trim().toLowerCase() ?? "";
  const from = filters.fromTowerNo?.trim()
    ? Number(filters.fromTowerNo.match(/\d+/)?.[0] ?? Number.NaN)
    : Number.NaN;
  const to = filters.toTowerNo?.trim()
    ? Number(filters.toTowerNo.match(/\d+/)?.[0] ?? Number.NaN)
    : Number.NaN;

  return towers
    .filter((tower) => {
      if (filters.section && filters.section !== "All" && tower.section !== filters.section) return false;
      if (filters.towerType && filters.towerType !== "All" && tower.towerType !== filters.towerType) {
        return false;
      }
      if (
        filters.contractor &&
        filters.contractor !== "All" &&
        tower.contractor !== filters.contractor
      ) {
        return false;
      }
      if (Number.isFinite(from) && tower.sequence < from) return false;
      if (Number.isFinite(to) && tower.sequence > to) return false;
      if (filters.status && filters.status !== "All") {
        const statuses = activity
          ? [tower.activities[activity].status]
          : TOWER_ACTIVITIES.map((key) => tower.activities[key].status);
        if (!statuses.includes(filters.status)) return false;
      }
      if (!term) return true;
      return (
        matchesText(tower.towerNo, term) ||
        matchesText(tower.location, term) ||
        matchesText(tower.towerType, term) ||
        matchesText(tower.section, term) ||
        matchesText(tower.contractor, term)
      );
    })
    .sort(compareTowers);
}

/** Distinct values for a filter dropdown, blanks dropped and sorted for a stable list. */
export function distinctValues(
  towers: readonly ProjectTower[],
  key: "section" | "towerType" | "contractor",
): string[] {
  return Array.from(
    new Set(towers.map((tower) => tower[key]?.trim()).filter((value): value is string => Boolean(value))),
  ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/* ── Photograph selection ───────────────────────────────────────────────────────────────────── */

export interface ReportPhoto {
  towerId: string;
  towerNo: string;
  activity: TowerActivity;
  activityLabel: string;
  photo: TowerPhoto;
  progressDate: string;
  uploadedByName: string;
  verified: boolean;
  updateId: string;
}

const updateComparatorDesc = (a: TowerProgressUpdate, b: TowerProgressUpdate): number =>
  b.progressDate.localeCompare(a.progressDate);

/**
 * The one photograph an activity contributes to a report.
 *
 * Twenty photographs of the same foundation make a report unreadable, so the rule is explicit:
 * a photograph a site marked as the report photo wins; otherwise the most recent verified one;
 * otherwise the most recent at all. Under a project that requires approval for client-facing
 * reports, unverified photographs are skipped entirely rather than quietly demoted — a rejected
 * photograph must never reach a client.
 */
export function selectReportPhoto(
  updates: readonly TowerProgressUpdate[],
  towerId: string,
  activity: TowerActivity,
  options: { requireApproved?: boolean } = {},
): ReportPhoto | undefined {
  const candidates = updates
    .filter(
      (update) =>
        update.towerId === towerId &&
        update.activity === activity &&
        update.verificationState !== "Rejected" &&
        update.photos.length > 0,
    )
    .filter((update) => (options.requireApproved ? update.verificationState === "Approved" : true))
    .sort(updateComparatorDesc);

  const toReportPhoto = (update: TowerProgressUpdate, photo: TowerPhoto): ReportPhoto => ({
    towerId,
    towerNo: update.towerNo,
    activity,
    activityLabel: TOWER_ACTIVITY_DEFINITIONS[activity].label,
    photo,
    progressDate: update.progressDate,
    uploadedByName: update.createdByName,
    verified: update.verificationState === "Approved",
    updateId: update.id,
  });

  for (const update of candidates) {
    const marked = update.photos.find((photo) => photo.isReportPhoto);
    if (marked) return toReportPhoto(update, marked);
  }
  const verified = candidates.find((update) => update.verificationState === "Approved");
  if (verified) return toReportPhoto(verified, verified.photos[0]);
  const first = candidates[0];
  return first ? toReportPhoto(first, first.photos[0]) : undefined;
}

/** Every photograph on a tower, newest first — what the tower page's photo tab shows. */
export function towerPhotos(
  updates: readonly TowerProgressUpdate[],
  towerId: string,
): ReportPhoto[] {
  return updates
    .filter((update) => update.towerId === towerId && update.photos.length > 0)
    .sort(updateComparatorDesc)
    .flatMap((update) =>
      update.photos.map((photo) => ({
        towerId,
        towerNo: update.towerNo,
        activity: update.activity,
        activityLabel: TOWER_ACTIVITY_DEFINITIONS[update.activity].label,
        photo,
        progressDate: update.progressDate,
        uploadedByName: update.createdByName,
        verified: update.verificationState === "Approved",
        updateId: update.id,
      })),
    );
}

/* ── Tower Status matrix ────────────────────────────────────────────────────────────────────── */

export interface TowerStatusCell {
  activity: TowerActivity;
  status: TowerActivityStatus;
  token: string;
  completedDate?: string;
  evidenceComplete: boolean;
}

export interface TowerStatusRow {
  towerId: string;
  towerNo: string;
  location: string;
  towerType: string;
  section: string;
  contractor: string;
  cells: TowerStatusCell[];
  overallPct: number;
  /** True when at least one recorded completion is missing its minimum photographs. */
  evidenceGap: boolean;
}

export function buildTowerStatusRows(
  towers: readonly ProjectTower[],
  settings: TowerProgressSettings,
): TowerStatusRow[] {
  return towers.map((tower) => {
    const cells = TOWER_ACTIVITIES.map((activity) => {
      const state = tower.activities[activity];
      return {
        activity,
        status: state.status,
        token: activityStatusToken[state.status],
        completedDate: state.completedDate,
        evidenceComplete: hasCompleteEvidence(activity, state),
      };
    });
    return {
      towerId: tower.id,
      towerNo: tower.towerNo,
      location: tower.location ?? "",
      towerType: tower.towerType ?? "",
      section: tower.section ?? "",
      contractor: tower.contractor ?? "",
      cells,
      overallPct: computeTowerProgressPct(tower, settings.activityWeights),
      evidenceGap: cells.some(
        (cell) => isActivityComplete(cell.status) && !cell.evidenceComplete,
      ),
    };
  });
}

/* ── Activity-wise register ─────────────────────────────────────────────────────────────────── */

export interface ActivityRegisterRow {
  towerId: string;
  towerNo: string;
  location: string;
  towerType: string;
  contractor: string;
  status: TowerActivityStatus;
  startedDate: string;
  completedDate: string;
  quantityM?: number;
  reason: string;
  remarks: string;
  photoCount: number;
  evidenceComplete: boolean;
  clientReady: boolean;
  photo?: ReportPhoto;
  daysInStatus?: number;
}

export function buildActivityRegisterRows(
  towers: readonly ProjectTower[],
  updates: readonly TowerProgressUpdate[],
  activity: TowerActivity,
  settings: TowerProgressSettings,
  today: Date = new Date(),
): ActivityRegisterRow[] {
  return towers.map((tower) => {
    const state = tower.activities[activity];
    return {
      towerId: tower.id,
      towerNo: tower.towerNo,
      location: tower.location ?? "",
      towerType: tower.towerType ?? "",
      contractor: tower.contractor ?? "",
      status: state.status,
      startedDate: state.startedDate ?? "",
      completedDate: state.completedDate ?? "",
      quantityM: state.quantityM,
      reason: state.reason ?? "",
      remarks: state.remarks ?? "",
      photoCount: state.photoCount,
      evidenceComplete: hasCompleteEvidence(activity, state),
      clientReady: isEvidenceClientReady(activity, state, settings),
      photo: selectReportPhoto(updates, tower.id, activity, {
        requireApproved: settings.clientReportsRequireApprovedPhotos,
      }),
      daysInStatus: daysInCurrentStatus(state, today),
    };
  });
}

/* ── Daily progress ─────────────────────────────────────────────────────────────────────────── */

export interface DailyActivityLine {
  activity: TowerActivity;
  label: string;
  measure: "tower" | "span";
  /** Tower numbers completed on the day. */
  towerNos: string[];
  count: number;
  /** Metres recorded on the day, for span activities. */
  quantityM: number;
}

export interface DailyProgressReport {
  date: string;
  completions: DailyActivityLine[];
  /** Activities that merely started or changed status, so the day never reads as empty when work
   *  genuinely happened but nothing finished. */
  otherUpdates: Array<{ towerNo: string; activityLabel: string; status: TowerActivityStatus; remarks: string }>;
  photos: ReportPhoto[];
  totalUpdates: number;
}

/** Updates that represent a fresh completion — a move *into* a complete status. Re-saves of an
 *  already-complete activity are excluded so the daily count cannot be inflated by edits. */
function isFreshCompletion(update: TowerProgressUpdate): boolean {
  return isActivityComplete(update.toStatus) && !isActivityComplete(update.fromStatus);
}

export function buildDailyProgressReport(
  updates: readonly TowerProgressUpdate[],
  dateKey: string,
): DailyProgressReport {
  const dayUpdates = updates.filter((update) => update.progressDate === dateKey);
  const completions = TOWER_ACTIVITY_LIST.map((definition) => {
    const relevant = dayUpdates.filter(
      (update) => update.activity === definition.key && isFreshCompletion(update),
    );
    const towerNos = Array.from(new Set(relevant.map((update) => update.towerNo))).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
    return {
      activity: definition.key,
      label: definition.label,
      measure: definition.measure,
      towerNos,
      count: towerNos.length,
      quantityM: relevant.reduce((sum, update) => sum + (update.quantityM ?? 0), 0),
    };
  }).filter((line) => line.count > 0 || line.quantityM > 0);

  const otherUpdates = dayUpdates
    .filter((update) => !isFreshCompletion(update))
    .map((update) => ({
      towerNo: update.towerNo,
      activityLabel: TOWER_ACTIVITY_DEFINITIONS[update.activity].label,
      status: update.toStatus,
      remarks: update.reason || update.remarks || "",
    }));

  const photos = dayUpdates
    .filter((update) => update.verificationState !== "Rejected")
    .flatMap((update) =>
      update.photos.map((photo) => ({
        towerId: update.towerId,
        towerNo: update.towerNo,
        activity: update.activity,
        activityLabel: TOWER_ACTIVITY_DEFINITIONS[update.activity].label,
        photo,
        progressDate: update.progressDate,
        uploadedByName: update.createdByName,
        verified: update.verificationState === "Approved",
        updateId: update.id,
      })),
    );

  return { date: dateKey, completions, otherUpdates, photos, totalUpdates: dayUpdates.length };
}

/* ── Weekly / monthly period progress ───────────────────────────────────────────────────────── */

export interface PeriodActivityLine {
  activity: TowerActivity;
  label: string;
  measure: "tower" | "span";
  total: number;
  /** Completed before the period began. */
  opening: number;
  /** Completed during the period. */
  thisPeriod: number;
  /** Completed to date. */
  cumulative: number;
  /** Still outstanding. */
  balance: number;
  quantityThisPeriodM: number;
  towerNos: string[];
}

export interface PeriodProgressReport {
  fromDate: string;
  toDate: string;
  label: string;
  lines: PeriodActivityLine[];
  photos: ReportPhoto[];
  /** Activities that went to Blocked or Hold during the period — the constraints section. */
  constraints: Array<{ towerNo: string; activityLabel: string; status: TowerActivityStatus; reason: string; date: string }>;
  overallProgressPct: number;
}

/**
 * Opening / this period / cumulative / balance per activity.
 *
 * Cumulative is read from the tower register rather than accumulated from updates, and opening is
 * derived as `cumulative − thisPeriod`. Doing it that way means the closing figure always agrees
 * with the dashboard, even for towers whose history predates this module or was corrected later —
 * which is exactly the kind of discrepancy that makes a client query a monthly report.
 */
export function buildPeriodProgressReport(
  towers: readonly ProjectTower[],
  updates: readonly TowerProgressUpdate[],
  range: { fromDate: string; toDate: string; label: string },
  settings: TowerProgressSettings,
): PeriodProgressReport {
  const totalTowers = towers.length;
  const totalSpans = totalTowers > 0 ? totalTowers - 1 : 0;
  const towerIds = new Set(towers.map((tower) => tower.id));
  const inRange = (dateKey: string) => dateKey >= range.fromDate && dateKey <= range.toDate;

  const periodUpdates = updates.filter(
    (update) => towerIds.has(update.towerId) && inRange(update.progressDate),
  );

  const lines = TOWER_ACTIVITY_LIST.map((definition) => {
    const total = definition.measure === "span" ? totalSpans : totalTowers;
    const cumulative = Math.min(
      total,
      towers.filter((tower) => isActivityComplete(tower.activities[definition.key].status)).length,
    );
    const completedThisPeriod = periodUpdates.filter(
      (update) => update.activity === definition.key && isFreshCompletion(update),
    );
    const towerNos = Array.from(new Set(completedThisPeriod.map((update) => update.towerNo))).sort(
      (a, b) => a.localeCompare(b, undefined, { numeric: true }),
    );
    // Clamped: a correction that completed and reopened the same activity inside the window could
    // otherwise report more completions in the period than exist in total.
    const thisPeriod = Math.min(towerNos.length, cumulative);
    return {
      activity: definition.key,
      label: definition.label,
      measure: definition.measure,
      total,
      opening: cumulative - thisPeriod,
      thisPeriod,
      cumulative,
      balance: Math.max(0, total - cumulative),
      quantityThisPeriodM: completedThisPeriod.reduce(
        (sum, update) => sum + (update.quantityM ?? 0),
        0,
      ),
      towerNos,
    };
  });

  const photos = periodUpdates
    .filter((update) => update.verificationState !== "Rejected")
    .filter((update) =>
      settings.clientReportsRequireApprovedPhotos ? update.verificationState === "Approved" : true,
    )
    // One photograph per tower/activity keeps a monthly report to a readable length rather than
    // reproducing every frame the site uploaded.
    .reduce<ReportPhoto[]>((collected, update) => {
      const key = `${update.towerId}:${update.activity}`;
      if (collected.some((entry) => `${entry.towerId}:${entry.activity}` === key)) return collected;
      const photo = update.photos.find((candidate) => candidate.isReportPhoto) ?? update.photos[0];
      if (!photo) return collected;
      collected.push({
        towerId: update.towerId,
        towerNo: update.towerNo,
        activity: update.activity,
        activityLabel: TOWER_ACTIVITY_DEFINITIONS[update.activity].label,
        photo,
        progressDate: update.progressDate,
        uploadedByName: update.createdByName,
        verified: update.verificationState === "Approved",
        updateId: update.id,
      });
      return collected;
    }, []);

  const constraints = periodUpdates
    .filter((update) => update.toStatus === "Blocked" || update.toStatus === "Hold")
    .map((update) => ({
      towerNo: update.towerNo,
      activityLabel: TOWER_ACTIVITY_DEFINITIONS[update.activity].label,
      status: update.toStatus,
      reason: update.reason || update.remarks || "—",
      date: update.progressDate,
    }));

  const overallProgressPct = totalTowers
    ? Math.round(
        towers.reduce(
          (sum, tower) => sum + computeTowerProgressPct(tower, settings.activityWeights),
          0,
        ) / totalTowers,
      )
    : 0;

  return { ...range, lines, photos, constraints, overallProgressPct };
}

/** Calendar-month range for the month containing `dateKey`. */
export function monthRange(dateKey: string): { fromDate: string; toDate: string; label: string } {
  const date = parseIsoDate(dateKey) ?? startOfDay(new Date());
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return {
    fromDate: toDateKey(first),
    toDate: toDateKey(last),
    label: first.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
  };
}

/** Monday–Sunday range for the week starting at `weekStart`. */
export function weekRange(weekStart: string, weekNumber: number): {
  fromDate: string;
  toDate: string;
  label: string;
} {
  return {
    fromDate: weekStart,
    toDate: addDaysToKey(weekStart, 6),
    label: `Week ${weekNumber}`,
  };
}

/* ── Exception reports ──────────────────────────────────────────────────────────────────────── */

export interface ExceptionRow {
  towerId: string;
  towerNo: string;
  location: string;
  contractor: string;
  activity: TowerActivity;
  activityLabel: string;
  status: TowerActivityStatus;
  /** Preceding activities' statuses, so a reader can see the work really is ready to run. */
  predecessorStatuses: string;
  daysWaiting?: number;
  plannedEndDate: string;
  reason: string;
  detail: string;
}

const predecessorSummary = (tower: ProjectTower, activity: TowerActivity): string => {
  const index = TOWER_ACTIVITIES.indexOf(activity);
  return TOWER_ACTIVITIES.slice(0, index)
    .map((key) => `${TOWER_ACTIVITY_DEFINITIONS[key].shortLabel}: ${activityStatusToken[tower.activities[key].status]}`)
    .join(" · ");
};

/**
 * Work that is ready to run but has not finished.
 *
 * "Pending" deliberately excludes activities whose predecessor is still outstanding: a tower that
 * cannot be erected because its foundation is not cast is a foundation problem, and listing it under
 * erection would bury the towers that genuinely are waiting on a crane. Survey, having no
 * predecessor, is always considered ready.
 */
export function buildPendingReport(
  towers: readonly ProjectTower[],
  activity: TowerActivity | "All",
  today: Date = new Date(),
): ExceptionRow[] {
  const activities = activity === "All" ? TOWER_ACTIVITIES : [activity];
  const rows: ExceptionRow[] = [];
  towers.forEach((tower) => {
    activities.forEach((key) => {
      const state = tower.activities[key];
      if (isActivityComplete(state.status)) return;
      const definition = TOWER_ACTIVITY_DEFINITIONS[key];
      if (definition.prerequisite && !isActivityComplete(tower.activities[definition.prerequisite].status)) {
        return;
      }
      rows.push({
        towerId: tower.id,
        towerNo: tower.towerNo,
        location: tower.location ?? "",
        contractor: tower.contractor ?? "",
        activity: key,
        activityLabel: definition.label,
        status: state.status,
        predecessorStatuses: predecessorSummary(tower, key),
        daysWaiting: daysInCurrentStatus(state, today),
        plannedEndDate: state.plannedEndDate ?? "",
        reason: state.reason ?? "",
        detail: state.remarks ?? "",
      });
    });
  });
  return rows.sort((a, b) => (b.daysWaiting ?? 0) - (a.daysWaiting ?? 0));
}

/**
 * Activities that are late: past their planned finish, or stalled in one status longer than the
 * project's delay threshold. Both tests are applied because many projects never load planned dates
 * per activity, and a threshold on time-in-status still catches a stalled tower without them.
 */
export function buildDelayedReport(
  towers: readonly ProjectTower[],
  settings: TowerProgressSettings,
  today: Date = new Date(),
): ExceptionRow[] {
  const todayKey = toDateKey(startOfDay(today));
  const rows: ExceptionRow[] = [];
  towers.forEach((tower) => {
    TOWER_ACTIVITIES.forEach((activity) => {
      const state = tower.activities[activity];
      if (isActivityComplete(state.status)) return;
      const days = daysInCurrentStatus(state, today);
      const pastPlanned = Boolean(state.plannedEndDate && state.plannedEndDate < todayKey);
      const stalled = days !== undefined && days >= settings.delayThresholdDays;
      if (!pastPlanned && !stalled) return;
      rows.push({
        towerId: tower.id,
        towerNo: tower.towerNo,
        location: tower.location ?? "",
        contractor: tower.contractor ?? "",
        activity,
        activityLabel: TOWER_ACTIVITY_DEFINITIONS[activity].label,
        status: state.status,
        predecessorStatuses: predecessorSummary(tower, activity),
        daysWaiting: days,
        plannedEndDate: state.plannedEndDate ?? "",
        reason: state.reason ?? "",
        detail: pastPlanned
          ? `Past planned finish${stalled ? ` and stalled ${days} days` : ""}`
          : `Stalled ${days} days in ${state.status}`,
      });
    });
  });
  return rows.sort((a, b) => (b.daysWaiting ?? 0) - (a.daysWaiting ?? 0));
}

/** Activities in Blocked or Hold, optionally narrowed to one activity (the ROW Blocked report). */
export function buildBlockedReport(
  towers: readonly ProjectTower[],
  activity: TowerActivity | "All",
  today: Date = new Date(),
): ExceptionRow[] {
  const activities = activity === "All" ? TOWER_ACTIVITIES : [activity];
  const rows: ExceptionRow[] = [];
  towers.forEach((tower) => {
    activities.forEach((key) => {
      const state = tower.activities[key];
      if (state.status !== "Blocked" && state.status !== "Hold") return;
      rows.push({
        towerId: tower.id,
        towerNo: tower.towerNo,
        location: tower.location ?? "",
        contractor: tower.contractor ?? "",
        activity: key,
        activityLabel: TOWER_ACTIVITY_DEFINITIONS[key].label,
        status: state.status,
        predecessorStatuses: predecessorSummary(tower, key),
        daysWaiting: daysInCurrentStatus(state, today),
        plannedEndDate: state.plannedEndDate ?? "",
        reason: state.reason ?? "No reason recorded",
        detail: state.remarks ?? "",
      });
    });
  });
  return rows.sort((a, b) => (b.daysWaiting ?? 0) - (a.daysWaiting ?? 0));
}

export interface MissingEvidenceRow {
  towerId: string;
  towerNo: string;
  location: string;
  contractor: string;
  activity: TowerActivity;
  activityLabel: string;
  status: TowerActivityStatus;
  completedDate: string;
  photoCount: number;
  /** Human-readable list of the photographs that should exist and do not. */
  missing: string;
  missingCount: number;
  /** Set when photographs exist but have not been verified. */
  awaitingVerification: boolean;
  reportedByName: string;
}

/**
 * Completions recorded without their minimum photographs — the false-completion check.
 *
 * Under `block` enforcement this should only ever list history: towers completed before the rule was
 * switched on, or imported from a previous system. Under `warn` it is the live queue the site has to
 * clear. Activities whose photographs exist but are still unverified are listed too, flagged
 * separately, because an unverified photograph cannot back a client-facing claim either.
 */
export function buildMissingEvidenceReport(
  towers: readonly ProjectTower[],
  settings: TowerProgressSettings,
): MissingEvidenceRow[] {
  const rows: MissingEvidenceRow[] = [];
  towers.forEach((tower) => {
    TOWER_ACTIVITIES.forEach((activity) => {
      const state = tower.activities[activity];
      if (!isActivityComplete(state.status)) return;
      const missing = missingRequiredPhotoKinds(activity, state.presentPhotoKinds);
      const awaitingVerification =
        missing.length === 0 &&
        settings.clientReportsRequireApprovedPhotos &&
        state.verificationState !== "Approved";
      if (!missing.length && !awaitingVerification) return;
      rows.push({
        towerId: tower.id,
        towerNo: tower.towerNo,
        location: tower.location ?? "",
        contractor: tower.contractor ?? "",
        activity,
        activityLabel: TOWER_ACTIVITY_DEFINITIONS[activity].label,
        status: state.status,
        completedDate: state.completedDate ?? "",
        photoCount: state.photoCount,
        missing: missing.length
          ? missing.map((kind) => TOWER_PHOTO_KIND_LABELS[kind]).join(", ")
          : "Awaiting verification",
        missingCount: missing.length,
        awaitingVerification,
        reportedByName: state.lastUpdatedByName ?? "",
      });
    });
  });
  return rows.sort(
    (a, b) => b.missingCount - a.missingCount || a.towerNo.localeCompare(b.towerNo, undefined, { numeric: true }),
  );
}

export interface CompletedTowerRow {
  towerId: string;
  towerNo: string;
  location: string;
  towerType: string;
  contractor: string;
  surveyDate: string;
  finalDate: string;
  /** Calendar days from survey to the last activity completed. */
  constructionDays?: number;
  evidenceComplete: boolean;
}

/** Towers with all seven activities complete — the handover list (§12). */
export function buildCompletedTowerReport(towers: readonly ProjectTower[]): CompletedTowerRow[] {
  return towers
    .filter((tower) =>
      TOWER_ACTIVITIES.every((activity) => isActivityComplete(tower.activities[activity].status)),
    )
    .map((tower) => {
      const dates = TOWER_ACTIVITIES.map((activity) => tower.activities[activity].completedDate)
        .filter((value): value is string => Boolean(value))
        .sort();
      const surveyDate = tower.activities.survey.completedDate ?? dates[0] ?? "";
      const finalDate = dates[dates.length - 1] ?? "";
      return {
        towerId: tower.id,
        towerNo: tower.towerNo,
        location: tower.location ?? "",
        towerType: tower.towerType ?? "",
        contractor: tower.contractor ?? "",
        surveyDate,
        finalDate,
        constructionDays: daysBetween(surveyDate, finalDate),
        evidenceComplete: TOWER_ACTIVITIES.every((activity) =>
          hasCompleteEvidence(activity, tower.activities[activity]),
        ),
      };
    });
}

function daysBetween(fromKey: string, toKey: string): number | undefined {
  const from = parseIsoDate(fromKey);
  const to = parseIsoDate(toKey);
  if (!from || !to) return undefined;
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86_400_000));
}

/* ── Photographic reports ───────────────────────────────────────────────────────────────────── */

export interface TowerPhotoPage {
  tower: ProjectTower;
  overallPct: number;
  activities: Array<{
    activity: TowerActivity;
    label: string;
    status: TowerActivityStatus;
    completedDate: string;
    photo?: ReportPhoto;
    evidenceComplete: boolean;
  }>;
  photos: ReportPhoto[];
}

/** One page per tower: details, activity table, and the site photographs (§3 and §16). */
export function buildTowerPhotoPages(
  towers: readonly ProjectTower[],
  updates: readonly TowerProgressUpdate[],
  settings: TowerProgressSettings,
): TowerPhotoPage[] {
  return towers.map((tower) => {
    const activities = TOWER_ACTIVITY_LIST.map((definition) => {
      const state = tower.activities[definition.key];
      const photo = selectReportPhoto(updates, tower.id, definition.key, {
        requireApproved: settings.clientReportsRequireApprovedPhotos,
      });
      return {
        activity: definition.key,
        label: definition.label,
        status: state.status,
        completedDate: state.completedDate ?? "",
        photo,
        evidenceComplete: hasCompleteEvidence(definition.key, state),
      };
    });
    return {
      tower,
      overallPct: computeTowerProgressPct(tower, settings.activityWeights),
      activities,
      photos: activities
        .map((entry) => entry.photo)
        .filter((photo): photo is ReportPhoto => Boolean(photo)),
    };
  });
}

export interface LatestPhotoRow {
  towerId: string;
  towerNo: string;
  location: string;
  activity: TowerActivity;
  activityLabel: string;
  status: TowerActivityStatus;
  progressDate: string;
  photo?: TowerPhoto;
  uploadedByName: string;
  verified: boolean;
}

/** The most recent photograph per tower, so management sees the line without opening each tower. */
export function buildLatestPhotoRows(
  towers: readonly ProjectTower[],
  updates: readonly TowerProgressUpdate[],
): LatestPhotoRow[] {
  const byTower = new Map<string, TowerProgressUpdate>();
  updates
    .filter((update) => update.photos.length > 0 && update.verificationState !== "Rejected")
    .forEach((update) => {
      const current = byTower.get(update.towerId);
      if (!current || update.progressDate > current.progressDate) byTower.set(update.towerId, update);
    });

  return towers
    .map((tower): LatestPhotoRow | undefined => {
      const update = byTower.get(tower.id);
      if (!update) return undefined;
      const state = tower.activities[update.activity];
      return {
        towerId: tower.id,
        towerNo: tower.towerNo,
        location: tower.location ?? "",
        activity: update.activity,
        activityLabel: TOWER_ACTIVITY_DEFINITIONS[update.activity].label,
        status: state.status,
        progressDate: update.progressDate,
        photo: update.photos.find((photo) => photo.isReportPhoto) ?? update.photos[0],
        uploadedByName: update.createdByName,
        verified: update.verificationState === "Approved",
      };
    })
    .filter((row): row is LatestPhotoRow => Boolean(row))
    .sort((a, b) => b.progressDate.localeCompare(a.progressDate));
}

export interface BeforeAfterRow {
  towerId: string;
  towerNo: string;
  location: string;
  before?: ReportPhoto;
  after?: ReportPhoto;
  surveyDate: string;
  erectionDate: string;
  constructionDays?: number;
}

/**
 * Survey location beside the completed tower (§14). Only towers that have both photographs appear —
 * a "before and after" with one panel empty reads as a mistake rather than as progress.
 */
export function buildBeforeAfterRows(
  towers: readonly ProjectTower[],
  updates: readonly TowerProgressUpdate[],
  settings: TowerProgressSettings,
): BeforeAfterRow[] {
  const requireApproved = settings.clientReportsRequireApprovedPhotos;
  return towers
    .map((tower) => {
      const before = selectReportPhoto(updates, tower.id, "survey", { requireApproved });
      const after = selectReportPhoto(updates, tower.id, "erection", { requireApproved });
      const surveyDate = tower.activities.survey.completedDate ?? before?.progressDate ?? "";
      const erectionDate = tower.activities.erection.completedDate ?? after?.progressDate ?? "";
      return {
        towerId: tower.id,
        towerNo: tower.towerNo,
        location: tower.location ?? "",
        before,
        after,
        surveyDate,
        erectionDate,
        constructionDays: daysBetween(surveyDate, erectionDate),
      };
    })
    .filter((row) => row.before && row.after);
}

export interface TimelineEntry {
  updateId: string;
  towerId: string;
  towerNo: string;
  progressDate: string;
  activity: TowerActivity;
  activityLabel: string;
  status: TowerActivityStatus;
  remarks: string;
  reason: string;
  photos: TowerPhoto[];
  uploadedByName: string;
  verificationState: TowerProgressUpdate["verificationState"];
  verifiedByName: string;
  gps: TowerProgressUpdate["gps"];
  quantityM?: number;
}

/** Chronological history for one tower, oldest first — the tower page's timeline tab (§13). */
export function buildTowerTimeline(
  updates: readonly TowerProgressUpdate[],
  towerId: string,
): TimelineEntry[] {
  return updates
    .filter((update) => update.towerId === towerId)
    .sort((a, b) => a.progressDate.localeCompare(b.progressDate))
    .map((update) => ({
      updateId: update.id,
      towerId: update.towerId,
      towerNo: update.towerNo,
      progressDate: update.progressDate,
      activity: update.activity,
      activityLabel: TOWER_ACTIVITY_DEFINITIONS[update.activity].label,
      status: update.toStatus,
      remarks: update.remarks ?? "",
      reason: update.reason ?? "",
      photos: update.photos,
      uploadedByName: update.createdByName,
      verificationState: update.verificationState,
      verifiedByName: update.verifiedByName ?? "",
      gps: update.gps,
      quantityM: update.quantityM,
    }));
}

/* ── Verification queue ─────────────────────────────────────────────────────────────────────── */

/** Updates awaiting a decision, oldest first so nothing sits at the bottom of the queue forever. */
export function pendingVerificationUpdates(
  updates: readonly TowerProgressUpdate[],
): TowerProgressUpdate[] {
  return updates
    .filter((update) => update.verificationState === "Pending")
    .sort((a, b) => a.progressDate.localeCompare(b.progressDate));
}

/* ── Recomputing a tower's activity state from its history ──────────────────────────────────── */

/**
 * Rebuilds one activity's denormalised state from the update register.
 *
 * Called after every write — including verification decisions and deletions — so the counters the
 * dashboard and every report read can never drift from the history that justifies them. Doing it as
 * a full recompute rather than an incremental adjustment means a corrected or removed update leaves
 * no residue, which an increment/decrement scheme cannot promise.
 */
export function recomputeActivityState(
  activity: TowerActivity,
  updates: readonly TowerProgressUpdate[],
  previous: TowerActivityState,
): TowerActivityState {
  const relevant = updates
    .filter((update) => update.activity === activity)
    .sort((a, b) => a.progressDate.localeCompare(b.progressDate));

  if (!relevant.length) {
    return {
      ...previous,
      photoCount: 0,
      approvedPhotoCount: 0,
      presentPhotoKinds: [],
      reportPhotoUrl: undefined,
      reportPhotoDate: undefined,
      reportPhotoUpdateId: undefined,
    };
  }

  const latest = relevant[relevant.length - 1];
  // Rejected photographs are not evidence, so they are excluded from every counter — otherwise a
  // rejected upload would silently satisfy a required photograph slot.
  const usable = relevant.filter((update) => update.verificationState !== "Rejected");
  const photos = usable.flatMap((update) => update.photos);
  const approvedPhotos = usable
    .filter((update) => update.verificationState === "Approved")
    .flatMap((update) => update.photos);
  const presentPhotoKinds = Array.from(new Set(photos.map((photo) => photo.kind)));

  const firstStart = relevant.find(
    (update) => update.toStatus === "In Progress" || isActivityComplete(update.toStatus),
  );
  const completion = [...relevant]
    .reverse()
    .find((update) => isActivityComplete(update.toStatus));
  const statusChange = [...relevant]
    .reverse()
    .find((update) => update.toStatus !== update.fromStatus);

  const reportPhoto = selectReportPhoto(usable, latest.towerId, activity);
  const quantityM = usable.reduce((sum, update) => sum + (update.quantityM ?? 0), 0);

  return {
    ...previous,
    status: latest.toStatus,
    startedDate: firstStart?.progressDate ?? previous.startedDate,
    completedDate: isActivityComplete(latest.toStatus)
      ? completion?.progressDate ?? latest.progressDate
      : undefined,
    remarks: latest.remarks || undefined,
    reason: latest.reason || undefined,
    quantityM: quantityM > 0 ? quantityM : undefined,
    photoCount: photos.length,
    approvedPhotoCount: approvedPhotos.length,
    presentPhotoKinds,
    reportPhotoUrl: reportPhoto?.photo.url,
    reportPhotoDate: reportPhoto?.progressDate,
    reportPhotoUpdateId: reportPhoto?.updateId,
    verificationState: latest.verificationState,
    statusSince: (statusChange ?? latest).progressDate,
    // Taken from the history rather than the clock, so recomputing an unchanged activity produces an
    // identical document. A wall-clock stamp here would rewrite all seven activities on every write
    // to any one of them, and would report "last updated today" for work recorded weeks ago.
    lastUpdatedAt: latest.progressDate,
    lastUpdatedByName: latest.createdByName,
  };
}


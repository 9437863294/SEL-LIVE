"use client";

/**
 * Tower Progress write side — the only place Firestore and Storage are touched for this feature.
 *
 * Two invariants this module exists to hold:
 *
 *  1. **A photograph is never orphaned from its claim.** Photographs upload first; only if every
 *     upload succeeds is the progress update written. A failed upload therefore leaves no status
 *     change behind, which is the safe direction to fail in — a missing update gets re-entered,
 *     whereas a completion recorded without its evidence is exactly what this feature exists to
 *     prevent.
 *
 *  2. **The denormalised tower state is always derivable from the update register.** Every write
 *     path — new update, verification decision, deletion — re-reads that tower's updates and
 *     recomputes all seven activity states from scratch, then commits the tower document in a
 *     transaction. No incremental counter arithmetic, so a corrected or deleted update leaves no
 *     residue in the counters the dashboard and reports read.
 *
 * Pure rules live in project-management-tower-progress.ts; the report projections in
 * project-management-tower-reports.ts. This file is the plumbing between them and the database.
 */

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { db } from "@/lib/firebase";
import { storage } from "@/lib/firebase-storage";
import { logUserActivity } from "@/lib/activity-logger";
import { PM_PROJECT_COLLECTION } from "@/lib/project-management-projects";
import {
  TOWER_ACTIVITIES,
  TOWER_COLLECTION,
  TOWER_SETTINGS_COLLECTION,
  TOWER_SETTINGS_DOC_ID,
  TOWER_UPDATE_COLLECTION,
  computeTowerProgressPct,
  emptyTowerActivities,
  isTowerActivity,
  isTowerPhotoKind,
  parseTowerSequence,
  readTower,
  resolveTowerProgressSettings,
  toDateKey,
  type ProjectTower,
  type ProjectTowerDraft,
  type TowerActivity,
  type TowerActivityState,
  type TowerActivityStatus,
  type TowerGpsFix,
  type TowerPhoto,
  type TowerPhotoKind,
  type TowerProgressSettings,
  type TowerProgressUpdate,
  type TowerVerificationState,
} from "@/lib/project-management-tower-progress";
import { recomputeActivityState } from "@/lib/project-management-tower-reports";

/** Raised when the tower document changed under an edit. Callers show "refresh and try again". */
export const TOWER_CONCURRENT_UPDATE = "TOWER_CONCURRENT_UPDATE";

/** Raised when a delete would destroy recorded evidence. */
export const TOWER_HAS_HISTORY = "TOWER_HAS_HISTORY";

export interface TowerActor {
  id: string;
  name: string;
  email?: string;
}

export interface TowerProjectContext {
  mappingId: string;
  globalProjectId: string;
  projectName: string;
  globalProjectName: string;
}

/* ── Paths ──────────────────────────────────────────────────────────────────────────────────── */

const towersRef = (globalProjectId: string) =>
  collection(db, "projects", globalProjectId, TOWER_COLLECTION);

const towerRef = (globalProjectId: string, towerId: string) =>
  doc(db, "projects", globalProjectId, TOWER_COLLECTION, towerId);

const updatesRef = (globalProjectId: string) =>
  collection(db, "projects", globalProjectId, TOWER_UPDATE_COLLECTION);

const updateRef = (globalProjectId: string, updateId: string) =>
  doc(db, "projects", globalProjectId, TOWER_UPDATE_COLLECTION, updateId);

const settingsRef = (globalProjectId: string) =>
  doc(db, "projects", globalProjectId, TOWER_SETTINGS_COLLECTION, TOWER_SETTINGS_DOC_ID);

/* ── Reading ────────────────────────────────────────────────────────────────────────────────── */

/** Resolves `?project={mappingId}` into the project context every screen runs against. */
export async function resolveTowerProjectContext(
  mappingId: string,
): Promise<TowerProjectContext | null> {
  if (!mappingId) return null;
  const snapshot = await getDoc(doc(db, PM_PROJECT_COLLECTION, mappingId));
  if (!snapshot.exists()) return null;
  const data = snapshot.data() as Record<string, unknown>;
  const globalProjectId = String(data.globalProjectId ?? "");
  if (!globalProjectId) return null;
  return {
    mappingId,
    globalProjectId,
    projectName: String(data.projectName ?? ""),
    globalProjectName: String(data.globalProjectName ?? data.projectName ?? ""),
  };
}

const readGps = (raw: unknown): TowerGpsFix | null => {
  if (!raw || typeof raw !== "object") return null;
  const stored = raw as Record<string, unknown>;
  const latitude = Number(stored.latitude);
  const longitude = Number(stored.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const accuracy = Number(stored.accuracyM);
  return {
    latitude,
    longitude,
    accuracyM: Number.isFinite(accuracy) ? accuracy : undefined,
    capturedAt: stored.capturedAt ? String(stored.capturedAt) : undefined,
  };
};

const readPhotos = (raw: unknown): TowerPhoto[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry, index): TowerPhoto | undefined => {
      const stored = (entry ?? {}) as Record<string, unknown>;
      const url = String(stored.url ?? "");
      if (!url) return undefined;
      return {
        id: String(stored.id ?? `photo-${index}`),
        kind: isTowerPhotoKind(stored.kind) ? stored.kind : ("other" as TowerPhotoKind),
        fileName: String(stored.fileName ?? "photo"),
        url,
        storagePath: String(stored.storagePath ?? ""),
        mimeType: String(stored.mimeType ?? "image/jpeg"),
        fileSize: Number(stored.fileSize ?? 0) || 0,
        gps: readGps(stored.gps),
        isReportPhoto: stored.isReportPhoto === true,
        caption: stored.caption ? String(stored.caption) : undefined,
      };
    })
    .filter((photo): photo is TowerPhoto => Boolean(photo));
};

/** Tolerant read of a stored progress update. */
export function readTowerProgressUpdate(id: string, raw: unknown): TowerProgressUpdate {
  const stored = (raw ?? {}) as Record<string, unknown>;
  const activity = isTowerActivity(stored.activity) ? stored.activity : "survey";
  const quantity = Number(stored.quantityM);
  return {
    id,
    towerId: String(stored.towerId ?? ""),
    towerNo: String(stored.towerNo ?? ""),
    towerType: stored.towerType ? String(stored.towerType) : undefined,
    location: stored.location ? String(stored.location) : undefined,
    contractor: stored.contractor ? String(stored.contractor) : undefined,
    activity,
    fromStatus: String(stored.fromStatus ?? "Not Started") as TowerActivityStatus,
    toStatus: String(stored.toStatus ?? "Not Started") as TowerActivityStatus,
    progressDate: String(stored.progressDate ?? ""),
    remarks: stored.remarks ? String(stored.remarks) : undefined,
    reason: stored.reason ? String(stored.reason) : undefined,
    quantityM: Number.isFinite(quantity) && quantity > 0 ? quantity : undefined,
    gps: readGps(stored.gps),
    photos: readPhotos(stored.photos),
    verificationState: (["Pending", "Approved", "Rejected"] as const).includes(
      stored.verificationState as TowerVerificationState,
    )
      ? (stored.verificationState as TowerVerificationState)
      : "Approved",
    verifiedById: stored.verifiedById ? String(stored.verifiedById) : undefined,
    verifiedByName: stored.verifiedByName ? String(stored.verifiedByName) : undefined,
    verifiedAt: stored.verifiedAt ? String(stored.verifiedAt) : undefined,
    verificationRemarks: stored.verificationRemarks ? String(stored.verificationRemarks) : undefined,
    evidenceShortfall: stored.evidenceShortfall === true,
    createdBy: String(stored.createdBy ?? ""),
    createdByName: String(stored.createdByName ?? ""),
    createdAt: stored.createdAt,
  };
}

export interface TowerProgressWorkspace {
  towers: ProjectTower[];
  updates: TowerProgressUpdate[];
  settings: TowerProgressSettings;
}

/**
 * One read for the whole feature.
 *
 * Three collection reads serve the dashboard, the register, every report and the verification queue,
 * because all of them are projections of the same two arrays. A 186-tower project with a couple of
 * thousand updates is a few hundred kilobytes — cheaper and far simpler than per-screen queries that
 * would each need their own composite index and could each disagree with the others.
 */
export async function loadTowerProgressWorkspace(
  globalProjectId: string,
): Promise<TowerProgressWorkspace> {
  const [towerSnapshot, updateSnapshot, settingsSnapshot] = await Promise.all([
    getDocs(towersRef(globalProjectId)),
    getDocs(updatesRef(globalProjectId)),
    getDoc(settingsRef(globalProjectId)),
  ]);
  return {
    towers: towerSnapshot.docs.map((towerDoc) => readTower(towerDoc.id, towerDoc.data())),
    updates: updateSnapshot.docs.map((updateDoc) =>
      readTowerProgressUpdate(updateDoc.id, updateDoc.data()),
    ),
    settings: resolveTowerProgressSettings(
      settingsSnapshot.exists() ? settingsSnapshot.data() : undefined,
    ),
  };
}

/* ── Settings ───────────────────────────────────────────────────────────────────────────────── */

export async function saveTowerProgressSettings(
  context: TowerProjectContext,
  settings: TowerProgressSettings,
  actor: TowerActor,
): Promise<void> {
  await setDoc(
    settingsRef(context.globalProjectId),
    {
      evidenceEnforcement: settings.evidenceEnforcement,
      requireGps: settings.requireGps,
      requireVerification: settings.requireVerification,
      clientReportsRequireApprovedPhotos: settings.clientReportsRequireApprovedPhotos,
      delayThresholdDays: settings.delayThresholdDays,
      activityWeights: settings.activityWeights,
      watermarkOrganisation: settings.watermarkOrganisation.trim(),
      updatedAt: serverTimestamp(),
      updatedBy: actor.id,
      updatedByName: actor.name,
    },
    { merge: true },
  );
  void logUserActivity({
    userId: actor.id,
    userName: actor.name,
    userEmail: actor.email,
    module: "Project Management",
    action: "Update Tower Progress Settings",
    details: {
      project: context.projectName,
      evidenceEnforcement: settings.evidenceEnforcement,
      requireVerification: settings.requireVerification,
      delayThresholdDays: settings.delayThresholdDays,
    },
    recordRef: context.projectName,
  });
}

/* ── Tower master ───────────────────────────────────────────────────────────────────────────── */

const towerPayload = (draft: ProjectTowerDraft) => ({
  towerNo: draft.towerNo.trim(),
  towerType: draft.towerType?.trim() ?? "",
  section: draft.section?.trim() ?? "",
  location: draft.location?.trim() ?? "",
  latitude: draft.latitude ?? null,
  longitude: draft.longitude ?? null,
  contractor: draft.contractor?.trim() ?? "",
  spanToNextM: draft.spanToNextM ?? null,
  sequence: parseTowerSequence(draft.towerNo),
});

/** Creates or edits one tower. Activity state is only initialised on create, so editing a tower's
 *  location or contractor can never reset its recorded progress. */
export async function saveTower(
  context: TowerProjectContext,
  draft: ProjectTowerDraft,
  actor: TowerActor,
  existing?: ProjectTower,
): Promise<string> {
  const reference = existing
    ? towerRef(context.globalProjectId, existing.id)
    : doc(towersRef(context.globalProjectId));

  if (existing) {
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists()) throw new Error(TOWER_CONCURRENT_UPDATE);
      transaction.set(
        reference,
        {
          ...towerPayload(draft),
          updatedAt: serverTimestamp(),
          updatedBy: actor.id,
          updatedByName: actor.name,
        },
        { merge: true },
      );
    });
  } else {
    await setDoc(reference, {
      ...towerPayload(draft),
      activities: emptyTowerActivities(),
      overallProgressPct: 0,
      createdAt: serverTimestamp(),
      createdBy: actor.id,
      createdByName: actor.name,
      updatedAt: serverTimestamp(),
      updatedBy: actor.id,
      updatedByName: actor.name,
    });
  }

  void logUserActivity({
    userId: actor.id,
    userName: actor.name,
    userEmail: actor.email,
    module: "Project Management",
    action: `${existing ? "Update" : "Add"} Tower`,
    details: { project: context.projectName, towerNo: draft.towerNo, towerType: draft.towerType },
    recordId: reference.id,
    recordRef: draft.towerNo,
  });
  return reference.id;
}

/** Records planned dates per activity, which is what the Delayed report measures against. */
export async function saveTowerPlannedDates(
  context: TowerProjectContext,
  tower: ProjectTower,
  planned: Partial<Record<TowerActivity, { plannedStartDate?: string; plannedEndDate?: string }>>,
  actor: TowerActor,
): Promise<void> {
  const reference = towerRef(context.globalProjectId, tower.id);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) throw new Error(TOWER_CONCURRENT_UPDATE);
    const current = readTower(snapshot.id, snapshot.data());
    const activities = { ...current.activities };
    TOWER_ACTIVITIES.forEach((activity) => {
      const entry = planned[activity];
      if (!entry) return;
      activities[activity] = {
        ...activities[activity],
        plannedStartDate: entry.plannedStartDate || undefined,
        plannedEndDate: entry.plannedEndDate || undefined,
      };
    });
    transaction.set(
      reference,
      {
        activities: serialiseActivities(activities),
        updatedAt: serverTimestamp(),
        updatedBy: actor.id,
        updatedByName: actor.name,
      },
      { merge: true },
    );
  });
  void logUserActivity({
    userId: actor.id,
    userName: actor.name,
    userEmail: actor.email,
    module: "Project Management",
    action: "Update Tower Planned Dates",
    details: { project: context.projectName, towerNo: tower.towerNo },
    recordId: tower.id,
    recordRef: tower.towerNo,
  });
}

/**
 * Removes a tower, but only while it holds no recorded progress.
 *
 * A tower with updates against it owns photographs that are somebody's evidence of work done and
 * paid for. Cascading a delete through those would destroy that silently, so this refuses and tells
 * the caller to remove the progress updates first — an explicit act, one at a time, each logged.
 */
export async function deleteTower(
  context: TowerProjectContext,
  tower: ProjectTower,
  actor: TowerActor,
): Promise<void> {
  const existing = await getDocs(
    query(updatesRef(context.globalProjectId), where("towerId", "==", tower.id)),
  );
  if (!existing.empty) throw new Error(TOWER_HAS_HISTORY);

  await deleteDoc(towerRef(context.globalProjectId, tower.id));
  void logUserActivity({
    userId: actor.id,
    userName: actor.name,
    userEmail: actor.email,
    module: "Project Management",
    action: "Delete Tower",
    details: { project: context.projectName, towerNo: tower.towerNo },
    recordId: tower.id,
    recordRef: tower.towerNo,
  });
}

/** Firestore's batch ceiling. Import chunks below it so a 500-tower schedule still lands in one go. */
const BATCH_LIMIT = 450;

/** Writes an imported schedule. Callers pass only rows the parser accepted. */
export async function importTowers(
  context: TowerProjectContext,
  drafts: readonly ProjectTowerDraft[],
  actor: TowerActor,
): Promise<number> {
  let written = 0;
  for (let index = 0; index < drafts.length; index += BATCH_LIMIT) {
    const chunk = drafts.slice(index, index + BATCH_LIMIT);
    const batch = writeBatch(db);
    chunk.forEach((draft) => {
      batch.set(doc(towersRef(context.globalProjectId)), {
        ...towerPayload(draft),
        activities: emptyTowerActivities(),
        overallProgressPct: 0,
        createdAt: serverTimestamp(),
        createdBy: actor.id,
        createdByName: actor.name,
        updatedAt: serverTimestamp(),
        updatedBy: actor.id,
        updatedByName: actor.name,
      });
    });
    await batch.commit();
    written += chunk.length;
  }
  void logUserActivity({
    userId: actor.id,
    userName: actor.name,
    userEmail: actor.email,
    module: "Project Management",
    action: "Import Towers",
    details: { project: context.projectName, towerCount: written },
    recordRef: context.projectName,
  });
  return written;
}

/* ── Photograph upload ──────────────────────────────────────────────────────────────────────── */

export interface PhotoUploadInput {
  file: File;
  kind: TowerPhotoKind;
  caption?: string;
  gps?: TowerGpsFix | null;
  isReportPhoto?: boolean;
}

const safeFileName = (name: string) => name.replace(/[^A-Za-z0-9._-]/g, "_").slice(-80);

/** Storage layout mirrors the domain — project / tower / activity — so an object's path alone says
 *  what it is evidence of, which matters when auditing storage outside the app. */
const photoStoragePath = (
  globalProjectId: string,
  towerId: string,
  activity: TowerActivity,
  kind: TowerPhotoKind,
  fileName: string,
) =>
  `project-management/tower-progress/${globalProjectId}/${towerId}/${activity}/${Date.now()}-${kind}-${safeFileName(fileName)}`;

async function uploadPhotos(
  globalProjectId: string,
  towerId: string,
  activity: TowerActivity,
  photos: readonly PhotoUploadInput[],
): Promise<TowerPhoto[]> {
  const uploaded: TowerPhoto[] = [];
  try {
    for (const input of photos) {
      const path = photoStoragePath(globalProjectId, towerId, activity, input.kind, input.file.name);
      const target = storageRef(storage, path);
      await uploadBytes(target, input.file, {
        contentType: input.file.type || "image/jpeg",
      });
      uploaded.push({
        id: path,
        kind: input.kind,
        fileName: input.file.name,
        url: await getDownloadURL(target),
        storagePath: path,
        mimeType: input.file.type || "image/jpeg",
        fileSize: input.file.size,
        gps: input.gps ?? null,
        isReportPhoto: input.isReportPhoto === true,
        caption: input.caption?.trim() || undefined,
      });
    }
    return uploaded;
  } catch (error) {
    // Partial uploads are cleaned up so a retry does not leave the bucket holding unreferenced
    // objects nobody can find their way back to.
    await Promise.all(
      uploaded.map((photo) =>
        deleteObject(storageRef(storage, photo.storagePath)).catch(() => undefined),
      ),
    );
    throw error;
  }
}

/* ── Recompute ──────────────────────────────────────────────────────────────────────────────── */

/** Firestore rejects `undefined`, so optional fields are dropped rather than written as null — a
 *  null `completedDate` would read back as a value and defeat the tolerant readers. */
function serialiseActivityState(state: TowerActivityState): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    status: state.status,
    photoCount: state.photoCount,
    approvedPhotoCount: state.approvedPhotoCount,
    presentPhotoKinds: state.presentPhotoKinds,
  };
  const optional: Array<[string, unknown]> = [
    ["plannedStartDate", state.plannedStartDate],
    ["plannedEndDate", state.plannedEndDate],
    ["startedDate", state.startedDate],
    ["completedDate", state.completedDate],
    ["remarks", state.remarks],
    ["reason", state.reason],
    ["quantityM", state.quantityM],
    ["reportPhotoUrl", state.reportPhotoUrl],
    ["reportPhotoDate", state.reportPhotoDate],
    ["reportPhotoUpdateId", state.reportPhotoUpdateId],
    ["verificationState", state.verificationState],
    ["statusSince", state.statusSince],
    ["lastUpdatedAt", state.lastUpdatedAt],
    ["lastUpdatedByName", state.lastUpdatedByName],
  ];
  optional.forEach(([key, value]) => {
    if (value !== undefined && value !== "") payload[key] = value;
  });
  return payload;
}

function serialiseActivities(
  activities: Record<TowerActivity, TowerActivityState>,
): Record<string, unknown> {
  return TOWER_ACTIVITIES.reduce<Record<string, unknown>>((map, activity) => {
    map[activity] = serialiseActivityState(activities[activity]);
    return map;
  }, {});
}

/**
 * Re-derives every activity state on one tower from its update history and commits it.
 *
 * The history is read from the server rather than from whatever the caller had in memory, so two
 * engineers updating the same tower minutes apart both end up with a state that reflects both of
 * their updates instead of the second overwriting the first.
 */
async function recomputeTower(
  globalProjectId: string,
  towerId: string,
  weights: Record<TowerActivity, number>,
  actor: TowerActor,
): Promise<void> {
  const historySnapshot = await getDocs(
    query(updatesRef(globalProjectId), where("towerId", "==", towerId)),
  );
  const history = historySnapshot.docs.map((updateDoc) =>
    readTowerProgressUpdate(updateDoc.id, updateDoc.data()),
  );

  await runTransaction(db, async (transaction) => {
    const reference = towerRef(globalProjectId, towerId);
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) throw new Error(TOWER_CONCURRENT_UPDATE);
    const current = readTower(snapshot.id, snapshot.data());
    const activities = TOWER_ACTIVITIES.reduce(
      (map, activity) => {
        map[activity] = recomputeActivityState(activity, history, current.activities[activity]);
        return map;
      },
      {} as Record<TowerActivity, TowerActivityState>,
    );
    transaction.set(
      reference,
      {
        activities: serialiseActivities(activities),
        overallProgressPct: computeTowerProgressPct({ activities }, weights),
        updatedAt: serverTimestamp(),
        updatedBy: actor.id,
        updatedByName: actor.name,
      },
      { merge: true },
    );
  });
}

/* ── Progress updates ───────────────────────────────────────────────────────────────────────── */

export interface RecordProgressInput {
  tower: ProjectTower;
  activity: TowerActivity;
  fromStatus: TowerActivityStatus;
  toStatus: TowerActivityStatus;
  progressDate: string;
  remarks: string;
  reason: string;
  quantityM?: number;
  gps?: TowerGpsFix | null;
  photos: PhotoUploadInput[];
  /** True when the update was saved short of its evidence set under `warn` enforcement. */
  evidenceShortfall: boolean;
}

/**
 * The one write a site engineer makes: a status change plus its photographs.
 *
 * Order matters. Photographs upload first, then the update document, then the tower recompute. If
 * the upload fails nothing is recorded; if the recompute fails the update still exists and the next
 * write — or a verification decision — reconciles the tower, because recompute is derived rather
 * than incremental.
 */
export async function recordTowerProgressUpdate(
  context: TowerProjectContext,
  input: RecordProgressInput,
  settings: TowerProgressSettings,
  actor: TowerActor,
): Promise<{ updateId: string; verificationState: TowerVerificationState }> {
  const photos = input.photos.length
    ? await uploadPhotos(context.globalProjectId, input.tower.id, input.activity, input.photos)
    : [];

  // With verification switched off, an update is born approved — otherwise every tower would sit
  // permanently short of client-ready evidence on a project that deliberately runs without a gate.
  const verificationState: TowerVerificationState = settings.requireVerification
    ? "Pending"
    : "Approved";

  const reference = doc(updatesRef(context.globalProjectId));
  const payload: Record<string, unknown> = {
    towerId: input.tower.id,
    towerNo: input.tower.towerNo,
    towerType: input.tower.towerType ?? "",
    location: input.tower.location ?? "",
    contractor: input.tower.contractor ?? "",
    activity: input.activity,
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
    progressDate: input.progressDate,
    remarks: input.remarks.trim(),
    reason: input.reason.trim(),
    photos,
    gps: input.gps ?? null,
    verificationState,
    evidenceShortfall: input.evidenceShortfall,
    createdBy: actor.id,
    createdByName: actor.name,
    createdAt: serverTimestamp(),
  };
  if (input.quantityM !== undefined && Number.isFinite(input.quantityM)) {
    payload.quantityM = input.quantityM;
  }
  if (verificationState === "Approved") {
    payload.verifiedById = actor.id;
    payload.verifiedByName = actor.name;
    payload.verifiedAt = new Date().toISOString();
  }

  try {
    await setDoc(reference, payload);
  } catch (error) {
    await Promise.all(
      photos.map((photo) =>
        deleteObject(storageRef(storage, photo.storagePath)).catch(() => undefined),
      ),
    );
    throw error;
  }

  await recomputeTower(context.globalProjectId, input.tower.id, settings.activityWeights, actor);

  void logUserActivity({
    userId: actor.id,
    userName: actor.name,
    userEmail: actor.email,
    module: "Project Management",
    action: "Record Tower Progress",
    details: {
      project: context.projectName,
      towerNo: input.tower.towerNo,
      activity: input.activity,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      progressDate: input.progressDate,
      photoCount: photos.length,
      evidenceShortfall: input.evidenceShortfall,
      gps: input.gps ? `${input.gps.latitude},${input.gps.longitude}` : null,
    },
    recordId: reference.id,
    recordRef: `${input.tower.towerNo} · ${input.activity}`,
  });

  return { updateId: reference.id, verificationState };
}

/**
 * The verification decision (§19).
 *
 * A rejection does not delete the photographs — the record of what was claimed and why it was
 * refused is the point — but the recompute excludes rejected updates from every evidence counter, so
 * a rejected photograph stops satisfying its required slot and the activity reappears in the No
 * Evidence report.
 */
export async function decideTowerProgressUpdate(
  context: TowerProjectContext,
  update: TowerProgressUpdate,
  decision: Exclude<TowerVerificationState, "Pending">,
  remarks: string,
  settings: TowerProgressSettings,
  actor: TowerActor,
): Promise<void> {
  const reference = updateRef(context.globalProjectId, update.id);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) throw new Error(TOWER_CONCURRENT_UPDATE);
    const current = readTowerProgressUpdate(snapshot.id, snapshot.data());
    if (current.verificationState !== update.verificationState) {
      throw new Error(TOWER_CONCURRENT_UPDATE);
    }
    transaction.set(
      reference,
      {
        verificationState: decision,
        verifiedById: actor.id,
        verifiedByName: actor.name,
        verifiedAt: new Date().toISOString(),
        verificationRemarks: remarks.trim(),
      },
      { merge: true },
    );
  });

  await recomputeTower(context.globalProjectId, update.towerId, settings.activityWeights, actor);

  void logUserActivity({
    userId: actor.id,
    userName: actor.name,
    userEmail: actor.email,
    module: "Project Management",
    action: `${decision} Tower Progress`,
    details: {
      project: context.projectName,
      towerNo: update.towerNo,
      activity: update.activity,
      status: update.toStatus,
      remarks: remarks.trim(),
    },
    recordId: update.id,
    recordRef: `${update.towerNo} · ${update.activity}`,
  });
}

/** Marks which photograph on an update represents it in official reports (§18). */
export async function setReportPhoto(
  context: TowerProjectContext,
  update: TowerProgressUpdate,
  photoId: string,
  settings: TowerProgressSettings,
  actor: TowerActor,
): Promise<void> {
  const photos = update.photos.map((photo) => ({
    ...photo,
    isReportPhoto: photo.id === photoId,
  }));
  await setDoc(updateRef(context.globalProjectId, update.id), { photos }, { merge: true });
  await recomputeTower(context.globalProjectId, update.towerId, settings.activityWeights, actor);
  void logUserActivity({
    userId: actor.id,
    userName: actor.name,
    userEmail: actor.email,
    module: "Project Management",
    action: "Set Tower Report Photo",
    details: { project: context.projectName, towerNo: update.towerNo, activity: update.activity },
    recordId: update.id,
    recordRef: update.towerNo,
  });
}

/**
 * Removes a progress update and its photographs.
 *
 * Kept deliberately narrow — this is for correcting a mis-keyed entry, not for tidying history. The
 * storage objects go with it, since a photograph whose claim no longer exists is unreachable from
 * the app and would otherwise accumulate forever.
 */
export async function deleteTowerProgressUpdate(
  context: TowerProjectContext,
  update: TowerProgressUpdate,
  settings: TowerProgressSettings,
  actor: TowerActor,
): Promise<void> {
  await deleteDoc(updateRef(context.globalProjectId, update.id));
  await Promise.all(
    update.photos
      .filter((photo) => photo.storagePath)
      .map((photo) => deleteObject(storageRef(storage, photo.storagePath)).catch(() => undefined)),
  );
  await recomputeTower(context.globalProjectId, update.towerId, settings.activityWeights, actor);
  void logUserActivity({
    userId: actor.id,
    userName: actor.name,
    userEmail: actor.email,
    module: "Project Management",
    action: "Delete Tower Progress Update",
    details: {
      project: context.projectName,
      towerNo: update.towerNo,
      activity: update.activity,
      progressDate: update.progressDate,
      photoCount: update.photos.length,
    },
    recordId: update.id,
    recordRef: `${update.towerNo} · ${update.activity}`,
  });
}

/* ── Device capture helpers ─────────────────────────────────────────────────────────────────── */

/**
 * Reads a GPS fix from the browser, resolving to null rather than throwing.
 *
 * A refused or unavailable fix must not block a progress update: the project setting decides whether
 * GPS is mandatory, and the caller enforces that. Silently succeeding with no fix, on a project that
 * requires one, would be the worse failure.
 */
export function captureGpsFix(timeoutMs = 12_000): Promise<TowerGpsFix | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyM: Number.isFinite(position.coords.accuracy)
            ? Math.round(position.coords.accuracy)
            : undefined,
          capturedAt: new Date(position.timestamp).toISOString(),
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}

/** Today as a date key, in the device's local timezone — site dates are always local dates. */
export function todayKey(): string {
  return toDateKey(new Date());
}

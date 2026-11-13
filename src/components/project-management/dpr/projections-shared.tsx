"use client";

/**
 * What the three Projections views share: the context they read, the way a new projection is
 * written, and the small figures they all show.
 */

import { collection, doc, serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { logUserActivity } from "@/lib/activity-logger";
import {
  DPR_TARGET_COLLECTION,
  type DprDistribution,
  type DprProjectionPeriod,
  type DprScope,
} from "@/lib/project-management-dpr";
import type { DprActualIndex, DprProjectionCandidate } from "@/lib/project-management-dpr-plan";
import type { DprBoqItem, DprDataState } from "@/components/project-management/dpr/use-dpr-data";
import { formatQtyAt } from "@/components/project-management/dpr/dpr-shell";
import { StatusBadge } from "@/components/shared/status-badge";

export interface ProjectionsUser {
  id?: string;
  name?: string;
  email?: string;
}

/** Everything a Projections view reads. Built once on the page and passed down. */
export interface ProjectionsContext {
  data: DprDataState;
  actuals: DprActualIndex;
  today: string;
  canEdit: boolean;
  canDelete: boolean;
  user: ProjectionsUser | null;
}

/** One projection to create, with the BOQ line it belongs to. */
export interface NewProjection {
  candidate: DprProjectionCandidate;
  item: DprBoqItem;
  remarks: string;
}

/**
 * Writes new projections in one batch. Every field is set explicitly: Firestore refuses a write
 * that carries `undefined` anywhere in it.
 */
export async function createProjections(
  context: ProjectionsContext,
  projections: readonly NewProjection[],
): Promise<void> {
  const { data, user } = context;
  if (!data.globalProjectId || !user || projections.length === 0) return;
  const batch = writeBatch(db);
  for (const { candidate, item, remarks } of projections) {
    const ref = doc(collection(db, "projects", data.globalProjectId, DPR_TARGET_COLLECTION));
    batch.set(ref, {
      scope: candidate.scope,
      boqItemId: item.id,
      boqSlNo: item.boqSlNo ?? "",
      description: item.description ?? "",
      unit: item.unit ?? "",
      periodType: candidate.periodType,
      startDate: candidate.startDate,
      endDate: candidate.endDate,
      plannedQty: candidate.plannedQty,
      baselineQty: candidate.plannedQty,
      revisionNo: 0,
      revisions: [],
      distribution: candidate.distribution,
      remarks: remarks.trim(),
      createdAt: serverTimestamp(),
      createdBy: user.id ?? "",
      createdByName: user.name ?? "",
      updatedAt: serverTimestamp(),
      updatedBy: user.id ?? "",
      updatedByName: user.name ?? "",
    });
  }
  await batch.commit();
  void logUserActivity({
    userId: user.id ?? "",
    userName: user.name ?? "",
    userEmail: user.email ?? "",
    module: "Project Management",
    action: "Create DPR Projection",
    details: {
      project: data.projectName,
      count: projections.length,
      lines: projections.map(({ item, candidate }) => ({
        boqSlNo: item.boqSlNo,
        periodType: candidate.periodType,
        startDate: candidate.startDate,
        endDate: candidate.endDate,
        plannedQty: candidate.plannedQty,
      })),
    },
  });
}

/** A typed quantity: null when blank, NaN when it is not a number. */
export const readQtyText = (text: string): number | null => {
  const cleaned = text.replace(/,/g, "").trim();
  return cleaned === "" ? null : Number(cleaned);
};

/** "0.667 Cum/day over 30d", or "1 to 2 Nos/day over 30d" for a whole-number unit. */
export function worksOutAt(
  qty: number | null,
  unit: string,
  decimals: number,
  workingDays: number,
): string {
  if (qty === null || !Number.isFinite(qty) || qty <= 0) return "—";
  if (workingDays <= 0) return "No working days";
  const perDay = qty / workingDays;
  const rate =
    decimals === 0 && perDay % 1 !== 0
      ? `${Math.floor(perDay)} to ${Math.ceil(perDay)}`
      : formatQtyAt(perDay, 3);
  return `${rate} ${unit}/day over ${workingDays}d`.replace(/\s+\//, "/");
}

export function ScopeBadge({ scope }: { scope: DprScope }) {
  return <StatusBadge status={scope} tone={scope === "Civil" ? "info" : "progress"} />;
}

/** A projection being planned on screen, before it has an id. */
export const candidateFor = (input: {
  item: DprBoqItem;
  periodType: DprProjectionPeriod;
  startDate: string;
  endDate: string;
  qty: number;
  distribution: DprDistribution;
}): DprProjectionCandidate => ({
  scope: input.item.scope,
  boqItemId: input.item.id,
  periodType: input.periodType,
  startDate: input.startDate,
  endDate: input.endDate,
  plannedQty: input.qty,
  distribution: input.distribution,
});

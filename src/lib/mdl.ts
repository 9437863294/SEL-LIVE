export const MDL_PERMISSION_RESOURCE = "Project Management.MDL";

// Stored per project, one doc per BOQ item that has MDL = "Yes", keyed by boqItemId.
export const MDL_COLLECTION = "mdlDrawings";

export const MDL_REVISION_ROUNDS = ["R0", "R1", "R2", "R3"] as const;
export type MdlRevisionRound = (typeof MDL_REVISION_ROUNDS)[number];

export const MDL_REVISION_STATUSES = [
  "Pending",
  "Under Review",
  "Approved",
  "Approved with Comments",
  "Resubmission Required",
  "Rejected",
] as const;
export type MdlRevisionStatus = (typeof MDL_REVISION_STATUSES)[number];

export interface MdlRevision {
  round: MdlRevisionRound;
  submissionDate?: string;
  status?: MdlRevisionStatus;
  comments?: string;
  commentsDate?: string;
  fileUrl?: string;
  fileName?: string;
  filePath?: string;
}

// A round is "rejected" when it needs a fresh submission under the next round.
export const isRevisionRejected = (revision?: MdlRevision): boolean =>
  revision?.status === "Rejected" || revision?.status === "Resubmission Required";

// R0 is always open; each later round only unlocks once the round before it was rejected —
// i.e. submissions cascade R0 -> R1 -> R2 -> R3 only as each prior drawing gets kicked back.
export function isRevisionUnlocked(revisions: MdlRevision[], round: MdlRevisionRound): boolean {
  const index = MDL_REVISION_ROUNDS.indexOf(round);
  if (index <= 0) return true;
  return isRevisionRejected(revisions[index - 1]);
}

export const MDL_OVERALL_STATUSES = [
  "Pending",
  "In Progress",
  "Approved",
  "Approved with Comments",
  "Rejected",
] as const;
export type MdlOverallStatus = (typeof MDL_OVERALL_STATUSES)[number];

export interface MdlDrawing {
  id: string; // == boqItemId
  boqItemId: string;
  boqSlNo: string;
  docNo: string;
  drawingNo: string;
  plannedDate: string;
  revisions: MdlRevision[];
  approveDate: string;
  status: MdlOverallStatus;
  remark: string;
  createdAt?: unknown;
  createdBy?: string;
  createdByName?: string;
  updatedAt?: unknown;
}

export const emptyRevisions = (): MdlRevision[] =>
  MDL_REVISION_ROUNDS.map((round) => ({ round, submissionDate: "", comments: "", commentsDate: "" }));

export const mdlOverallStatusStyles: Record<MdlOverallStatus, string> = {
  Pending: "bg-muted text-muted-foreground",
  "In Progress": "bg-blue-100 text-blue-700",
  Approved: "bg-emerald-100 text-emerald-700",
  "Approved with Comments": "bg-amber-100 text-amber-700",
  Rejected: "bg-red-100 text-red-700",
};

export const mdlRevisionStatusStyles: Record<MdlRevisionStatus, string> = {
  Pending: "bg-muted text-muted-foreground",
  "Under Review": "bg-blue-100 text-blue-700",
  Approved: "bg-emerald-100 text-emerald-700",
  "Approved with Comments": "bg-amber-100 text-amber-700",
  "Resubmission Required": "bg-orange-100 text-orange-700",
  Rejected: "bg-red-100 text-red-700",
};

export const formatMdlDate = (value?: string) => {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const hasRevisionData = (revision?: MdlRevision): boolean =>
  Boolean(revision?.submissionDate || revision?.status || revision?.comments || revision?.fileUrl);

// The latest revision round that has any data entered, for a compact "current stage" summary.
export function getLatestRevision(revisions: MdlRevision[]): MdlRevision | null {
  for (let i = revisions.length - 1; i >= 0; i -= 1) {
    if (hasRevisionData(revisions[i])) return revisions[i];
  }
  return null;
}

// How many revision rounds should be shown/editable: at least R0, plus one more for
// every round already started, so rounds only appear once they're actually needed.
export function countVisibleRevisions(revisions: MdlRevision[]): number {
  let count = 1;
  for (let i = 0; i < revisions.length; i += 1) {
    if (hasRevisionData(revisions[i])) count = Math.min(i + 2, revisions.length);
  }
  return count;
}

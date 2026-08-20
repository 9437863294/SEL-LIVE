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

// The vendor's handover of a drawing to us. Recorded on the Drawing page once a purchase order
// has been placed for the BOQ item; the reviewed copy is then submitted to the client through
// the sub-drawing's own revision rounds back on the MDL register.
export interface MdlVendorCollection {
  receivedOn: string;
  vendorName?: string;
  fileUrl?: string;
  fileName?: string;
  filePath?: string;
  remark?: string;
  receivedBy?: string;
  receivedByName?: string;
}

// Recorded when a review sends the drawing back past us to the vendor: the client rejected it
// and said a fresh copy has to come from the vendor before it can be resubmitted. This is what
// reopens a drawing the vendor had already settled — a rejection on its own does not, because
// most rejections are resubmitted from the copy we already hold. Cleared automatically once the
// replacement is collected.
export interface MdlRecollectionRequest {
  requestedOn: string;
  reason?: string;
  /** The submission round that was kicked back, for context on the Drawing page. */
  afterRound?: MdlRevisionRound;
  requestedBy?: string;
  requestedByName?: string;
}

// One of several drawings needed for a single BOQ item — e.g. a GA drawing, a foundation
// drawing and a schematic all hanging off one isolator. Each carries its own submission
// cycle, so it mirrors MdlDrawing's fields, plus a title and the person responsible for it.
// Stored as an array inside the parent MdlDrawing doc rather than as its own document:
// the register already loads one doc per BOQ item, so nesting keeps it a single read/write.
export interface MdlSubDrawing {
  id: string;
  title: string;
  docNo: string;
  drawingNo: string;
  plannedStartDate: string;
  plannedEndDate: string;
  revisions: MdlRevision[];
  approveDate: string;
  status: MdlOverallStatus;
  remark: string;
  firstSubmittedOn?: string;
  // Set on the Drawing page when the vendor hands the drawing over. Absent until then.
  collection?: MdlVendorCollection;
  // Earlier handovers, kept so replacing a rejected drawing doesn't erase the record of what
  // the vendor supplied the first time.
  previousCollections?: MdlVendorCollection[];
  // Present only while the vendor owes us a replacement — see MdlRecollectionRequest.
  recollectionRequested?: MdlRecollectionRequest;
  // Whoever is responsible for this drawing. Being assigned is itself the authority to edit
  // it — see canEditMdlSubDrawing.
  assignedToId?: string;
  assignedToName?: string;
  // ISO strings, not serverTimestamp() — Firestore rejects sentinel values inside array elements.
  createdAt?: string;
  createdBy?: string;
  createdByName?: string;
  updatedAt?: string;
  updatedBy?: string;
  updatedByName?: string;
}

export interface MdlDrawing {
  id: string; // == boqItemId
  boqItemId: string;
  boqSlNo: string;
  docNo: string;
  drawingNo: string;
  plannedStartDate: string;
  plannedEndDate: string;
  revisions: MdlRevision[];
  approveDate: string;
  status: MdlOverallStatus;
  remark: string;
  subDrawings?: MdlSubDrawing[];
  // Set once, from the earliest revision submission date ever recorded, and never reset by a
  // later revision — cycle age is measured from here, not from the current round, so a drawing
  // stuck across three revisions reads as 140 days pending, not "12 days since last resubmission."
  firstSubmittedOn?: string;
  createdAt?: unknown;
  createdBy?: string;
  createdByName?: string;
  updatedAt?: unknown;
}

export const MDL_CLOSED_STATUSES: MdlOverallStatus[] = ["Approved", "Approved with Comments"];

// Whether a drawing has reached a state that can release downstream work (Manufacturing
// Clearance, construction) — Approved or Approved with Comments. Anything else — including no
// MdlDrawing record at all yet — is not approved.
export const isMdlApproved = (status?: MdlOverallStatus): boolean =>
  status != null && MDL_CLOSED_STATUSES.includes(status);

// A drawing is overdue once its planned end date has passed without reaching an approved state.
export function isMdlOverdue(drawing?: Pick<MdlDrawing, "plannedEndDate" | "status">, today: Date = new Date()): boolean {
  if (!drawing?.plannedEndDate) return false;
  if (MDL_CLOSED_STATUSES.includes(drawing.status)) return false;
  const end = new Date(`${drawing.plannedEndDate}T00:00:00`);
  if (Number.isNaN(end.getTime())) return false;
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return end.getTime() < startOfToday.getTime();
}

// Days elapsed since the drawing's first-ever submission — never resets on a later revision.
// Returns null when there's nothing to measure from yet (no submission recorded).
export function computeMdlCycleAgeDays(
  drawing?: Pick<MdlDrawing, "firstSubmittedOn">,
  today: Date = new Date(),
): number | null {
  if (!drawing?.firstSubmittedOn) return null;
  const start = new Date(`${drawing.firstSubmittedOn}T00:00:00`);
  if (Number.isNaN(start.getTime())) return null;
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.max(0, Math.round((startOfToday.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
}

// The earliest submission date across all revisions — used to seed/backfill firstSubmittedOn
// without ever moving it later once set.
export function earliestSubmissionDate(revisions: MdlRevision[]): string | undefined {
  const dates = revisions.map((r) => r.submissionDate).filter((d): d is string => Boolean(d));
  if (!dates.length) return undefined;
  return dates.reduce((earliest, current) => (current < earliest ? current : earliest));
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

export const emptySubDrawing = (id: string): MdlSubDrawing => ({
  id,
  title: "",
  docNo: "",
  drawingNo: "",
  plannedStartDate: "",
  plannedEndDate: "",
  revisions: emptyRevisions(),
  approveDate: "",
  status: "Pending",
  remark: "",
});

export const getMdlSubDrawings = (drawing?: MdlDrawing): MdlSubDrawing[] => drawing?.subDrawings ?? [];

export const isCollectedFromVendor = (sub: Pick<MdlSubDrawing, "collection">): boolean =>
  Boolean(sub.collection?.receivedOn);

// Whether the parent BOQ item carries a drawing of its own, as opposed to acting purely as a
// container for its sub-drawings. Used by the roll-up so adding sub-drawings to an item that
// already had its own approved drawing never discards that drawing's state.
export const hasOwnDrawingWork = (drawing?: MdlDrawing): boolean =>
  Boolean(drawing?.docNo || drawing?.drawingNo || (drawing?.revisions ?? []).some(hasRevisionData));

// ISO yyyy-mm-dd sorts lexicographically, so plain string compare gives the real min/max.
const earliest = (values: (string | undefined)[]): string =>
  values.filter((v): v is string => Boolean(v)).sort()[0] ?? "";
const latest = (values: (string | undefined)[]): string =>
  values.filter((v): v is string => Boolean(v)).sort().pop() ?? "";

// Collapses a set of statuses into the one status that describes the whole item: anything
// kicked back dominates, otherwise everything must be approved before the item is, and any
// movement at all reads as In Progress.
export function rollUpMdlStatuses(statuses: MdlOverallStatus[]): MdlOverallStatus {
  if (!statuses.length) return "Pending";
  if (statuses.some((status) => status === "Rejected")) return "Rejected";
  if (statuses.every((status) => status === "Approved")) return "Approved";
  if (statuses.every((status) => isMdlApproved(status))) return "Approved with Comments";
  if (statuses.some((status) => status !== "Pending")) return "In Progress";
  return "Pending";
}

// What the register, pending list, calendar and reports should actually display for a BOQ item:
// its own record when it has no sub-drawings (identical to today's behaviour), otherwise the
// item rolled up across its own drawing plus every sub-drawing. Deliberately shaped so
// isMdlOverdue and computeMdlCycleAgeDays accept it directly.
export interface MdlRollup {
  plannedStartDate: string;
  plannedEndDate: string;
  approveDate: string;
  status: MdlOverallStatus;
  remark: string;
  firstSubmittedOn?: string;
  // True when the item's own drawing or any one of its sub-drawings is past its own planned end
  // date unapproved. Read this rather than calling isMdlOverdue on the roll-up: plannedEndDate
  // is the widest window across the item, so a sub-drawing running late into next month would
  // otherwise mask the parent drawing that was due three weeks ago.
  overdue: boolean;
  subTotal: number;
  subApproved: number;
  subCollected: number;
}

export function getMdlRollup(drawing?: MdlDrawing, today: Date = new Date()): MdlRollup {
  const subs = getMdlSubDrawings(drawing);
  const own: MdlRollup = {
    plannedStartDate: drawing?.plannedStartDate ?? "",
    plannedEndDate: drawing?.plannedEndDate ?? "",
    approveDate: drawing?.approveDate ?? "",
    status: drawing?.status ?? "Pending",
    remark: drawing?.remark ?? "",
    firstSubmittedOn: drawing?.firstSubmittedOn,
    overdue: isMdlOverdue(drawing, today),
    subTotal: 0,
    subApproved: 0,
    subCollected: 0,
  };
  if (!subs.length) return own;

  // The parent's own status only counts as a unit when it actually has a drawing of its own;
  // a pure container would otherwise sit at "Pending" forever and hold the whole item back.
  const ownCounts = hasOwnDrawingWork(drawing);
  const statuses = [...(ownCounts ? [own.status] : []), ...subs.map((sub) => sub.status)];
  const status = rollUpMdlStatuses(statuses);
  return {
    // The item spans the widest window across itself and its sub-drawings — a child running
    // three weeks past the parent's own end date means the item isn't done until then either.
    plannedStartDate: earliest([own.plannedStartDate, ...subs.map((sub) => sub.plannedStartDate)]),
    plannedEndDate: latest([own.plannedEndDate, ...subs.map((sub) => sub.plannedEndDate)]),
    approveDate: isMdlApproved(status)
      ? latest([own.approveDate, ...subs.map((sub) => sub.approveDate)])
      : own.approveDate,
    status,
    remark: own.remark,
    firstSubmittedOn: earliest([own.firstSubmittedOn, ...subs.map((sub) => sub.firstSubmittedOn)]) || undefined,
    overdue: (ownCounts && own.overdue) || subs.some((sub) => isMdlOverdue(sub, today)),
    subTotal: subs.length,
    subApproved: subs.filter((sub) => isMdlApproved(sub.status)).length,
    subCollected: subs.filter(isCollectedFromVendor).length,
  };
}

// Where a single sub-drawing has got to, across the whole vendor → us → client chain. Derived
// rather than stored, so it can never contradict the record it describes:
//
//   Planned           the drawing is on the checklist; no purchase order placed for the item yet
//   Awaiting Vendor   a PO is placed, so the vendor owes us this drawing — collect it on the
//                     Drawing page
//   Ready for Review  collected from the vendor, waiting for us to review and submit to client
//   With Client       submitted to the client under at least one revision round
//   Approved          the client cleared it (with or without comments)
//   Rejected          the client kicked it back and it needs a fresh round
export const MDL_DRAWING_STAGES = [
  "Planned",
  "Awaiting Vendor",
  "Re-collect from Vendor",
  "Ready for Review",
  "With Client",
  "Approved",
  "Rejected",
] as const;
export type MdlDrawingStage = (typeof MDL_DRAWING_STAGES)[number];

type MdlDrawingProgress = Pick<
  MdlSubDrawing,
  "status" | "revisions" | "collection" | "recollectionRequested"
>;

export function computeMdlDrawingStage(
  sub: MdlDrawingProgress,
  hasPurchaseOrder: boolean,
): MdlDrawingStage {
  // Checked most-advanced first: whatever the drawing has actually reached wins over what an
  // earlier step would imply.
  //
  // Approval comes before everything, including a re-collection request, so a drawing the client
  // has cleared is settled for good and can never be pulled back into the vendor queue.
  if (isMdlApproved(sub.status)) return "Approved";
  // A live re-collection request outranks the rejection that caused it: the actionable state is
  // "the vendor owes us a replacement", not "the client said no".
  if (sub.recollectionRequested && hasPurchaseOrder) return "Re-collect from Vendor";
  if (sub.status === "Rejected") return "Rejected";
  if ((sub.revisions ?? []).some(hasRevisionData)) return "With Client";
  if (sub.collection?.receivedOn) return "Ready for Review";
  if (hasPurchaseOrder) return "Awaiting Vendor";
  return "Planned";
}

export const mdlDrawingStageStyles: Record<MdlDrawingStage, string> = {
  Planned: "bg-muted text-muted-foreground",
  "Awaiting Vendor": "bg-orange-100 text-orange-700",
  "Re-collect from Vendor": "bg-rose-100 text-rose-700",
  "Ready for Review": "bg-violet-100 text-violet-700",
  "With Client": "bg-blue-100 text-blue-700",
  Approved: "bg-emerald-100 text-emerald-700",
  Rejected: "bg-red-100 text-red-700",
};

// Whether the vendor still owes us this drawing — the one rule the Drawing page's queue runs on.
//
// A purchase order is what makes the vendor owe a drawing, but the obligation is settled for good
// once the client approves it. Approval attaches to the drawing, not to the purchase order, so a
// later PO on the same BOQ item never asks the vendor for the same approved drawing again — that
// standing approval is exactly what the new PO's clearance relies on.
//
// The only way a settled drawing reopens is an explicit re-collection request: the client rejected
// it and the reviewer recorded that a fresh copy must come from the vendor. Rejection alone does
// not reopen it, because most rejections are resubmitted from the copy we already hold.
export function isAwaitingVendorCollection(
  sub: MdlDrawingProgress,
  hasPurchaseOrder: boolean,
): boolean {
  if (!hasPurchaseOrder) return false;
  if (isMdlApproved(sub.status)) return false;
  if (sub.recollectionRequested) return true;
  return !isCollectedFromVendor(sub);
}

// A drawing is outstanding work once somebody has committed to it and it hasn't reached an
// approved state. There are two ways to commit: a purchase order gets placed for the BOQ item
// (procurement is committed, so the drawing has to be ready), or the drawing simply gets planned
// in the register — an item's own record saved, or a sub-drawing added to it. Items that are
// merely flagged MDL = Yes and never touched stay out, so the queue doesn't fill up with
// hundreds of untouched lines.
//
// Shared by the Pending Tasks tab and the sidebar badge so the two can never disagree.
export const isMdlPendingTask = (drawing: MdlDrawing | undefined, hasPurchaseOrder: boolean): boolean =>
  (hasPurchaseOrder || Boolean(drawing)) && !isMdlApproved(getMdlRollup(drawing).status);

// The furthest-along revision round for a whole BOQ item — its own drawing plus every
// sub-drawing — so an item whose sub-drawing has reached R2 doesn't report as sitting at R0.
export function getLatestRevisionAcrossItem(drawing?: MdlDrawing): MdlRevision | null {
  const candidates = [drawing?.revisions ?? [], ...getMdlSubDrawings(drawing).map((sub) => sub.revisions ?? [])]
    .map((revisions) => getLatestRevision(revisions))
    .filter((revision): revision is MdlRevision => revision != null);
  if (!candidates.length) return null;
  return candidates.reduce((furthest, current) =>
    MDL_REVISION_ROUNDS.indexOf(current.round) > MDL_REVISION_ROUNDS.indexOf(furthest.round) ? current : furthest,
  );
}

// Assignment is itself the authority: the person a sub-drawing is assigned to can always edit
// it, whether or not their role carries Edit on the MDL register. Adding, deleting and editing
// anyone else's sub-drawing still needs the role permission.
export const canEditMdlSubDrawing = (
  sub: Pick<MdlSubDrawing, "assignedToId">,
  userId?: string,
  canEditRegister = false,
): boolean => canEditRegister || (Boolean(userId) && sub.assignedToId === userId);

// Outline numbering shared by the register and the pending list, so a row's number means the
// same thing in both views. Takes one index per level: purchase order, then BOQ item, then
// sub-drawing — mdlOutlineNo(0) is "1", mdlOutlineNo(0, 1) is "1.2", mdlOutlineNo(0, 1, 2) is
// "1.2.3".
export const mdlOutlineNo = (...indexes: number[]): string => indexes.map((index) => index + 1).join(".");

// Minimal shape the calendar/report views need from a BOQ item — the actual BOQ item
// type carries many more fields, but it structurally satisfies this.
export interface MdlBoqItem {
  id: string;
  Description?: string;
  "Scope 1"?: string;
  [key: string]: unknown;
}

export interface MdlRow {
  item: MdlBoqItem;
  drawing?: MdlDrawing;
}

// The purchase order a set of drawings hangs off — just the fields the MDL views display.
export interface MdlPoRef {
  poId: string;
  poNumber: string;
  poDate: string;
  vendorName: string;
}

// Generic over the row type so callers keep their own concrete BOQ item shape through grouping
// instead of having it widened to MdlBoqItem.
export interface MdlPoGroup<T extends MdlRow = MdlRow> {
  po: MdlPoRef;
  rows: T[];
}

// Minimal shape groupMdlRowsByPo needs from a purchase order; PurchaseOrder satisfies it.
export interface MdlGroupablePo {
  id: string;
  poNumber: string;
  poDate: string;
  vendorName?: string;
  status?: string;
  items?: { boqItemId?: string }[];
}

// Organises the MDL views as purchase order → BOQ item → sub-drawing, which is the order the work
// actually happens in: procurement commits to a PO, the PO covers BOQ items, and each item needs
// its own set of drawings.
//
// An item ordered on more than one live PO appears under each of them — every one of those POs is
// waiting on those drawings, so filing the item under only the first would understate what a
// later PO is blocked on. Cancelled POs are skipped, and items on no live PO come back as
// `ungrouped` for the caller to present however that view wants.
export function groupMdlRowsByPo<T extends MdlRow>(
  rows: T[],
  purchaseOrders: MdlGroupablePo[],
): { groups: MdlPoGroup<T>[]; ungrouped: T[] } {
  const rowByItemId = new Map(rows.map((row) => [row.item.id, row]));
  // Rows arrive in BOQ SL No order; groups keep that order rather than PO line order so a row
  // sits in the same place in every view.
  const orderByItemId = new Map(rows.map((row, index) => [row.item.id, index]));
  const groupedItemIds = new Set<string>();
  const groups: MdlPoGroup<T>[] = [];

  for (const po of purchaseOrders) {
    if (po.status === "Cancelled") continue;
    const seen = new Set<string>();
    const poRows: T[] = [];
    for (const line of po.items ?? []) {
      const itemId = line.boqItemId;
      // A PO can list the same BOQ item on several lines; the drawings are still one set.
      if (!itemId || seen.has(itemId)) continue;
      const row = rowByItemId.get(itemId);
      if (!row) continue;
      seen.add(itemId);
      poRows.push(row);
      groupedItemIds.add(itemId);
    }
    if (!poRows.length) continue;
    poRows.sort((a, b) => (orderByItemId.get(a.item.id) ?? 0) - (orderByItemId.get(b.item.id) ?? 0));
    groups.push({
      po: {
        poId: po.id,
        poNumber: po.poNumber,
        poDate: po.poDate,
        vendorName: po.vendorName ?? "",
      },
      rows: poRows,
    });
  }

  // Newest purchase order first, so the most recent commitment leads.
  groups.sort(
    (a, b) =>
      (b.po.poDate || "").localeCompare(a.po.poDate || "") || a.po.poNumber.localeCompare(b.po.poNumber),
  );

  return { groups, ungrouped: rows.filter((row) => !groupedItemIds.has(row.item.id)) };
}

// How far a set of drawings has got, for a purchase order group's header line.
export function summariseMdlRows(rows: MdlRow[]): { drawings: number; approved: number } {
  let drawings = 0;
  let approved = 0;
  for (const { drawing } of rows) {
    const subs = getMdlSubDrawings(drawing);
    if (subs.length) {
      drawings += subs.length;
      approved += subs.filter((sub) => isMdlApproved(sub.status)).length;
    } else {
      // No sub-drawings planned yet: the item's own record is the one drawing it has.
      drawings += 1;
      if (isMdlApproved(drawing?.status)) approved += 1;
    }
  }
  return { drawings, approved };
}

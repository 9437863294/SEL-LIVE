/**
 * The six gates a manufactured BOQ item passes through, in order, once it's on an issued
 * purchase order: Manufacturing Clearance -> Inspection -> MDCC (client clearance) -> Dispatch
 * Instruction (SEL's own numbered instruction to the vendor) -> GRN (material received at site)
 * -> MVAC (joint verification & acceptance with the client, the billing trigger). Each is its own
 * project-scoped Firestore collection, one doc per BOQ item (doc id == boqItemId), mirroring
 * MDL's own convention (see src/lib/mdl.ts) — and each stage is gated on the one before it, so
 * the chain can't be skipped: Inspection can't be requested until MC is "Cleared", MDCC can't be
 * issued until Inspection is "Passed", a DI can't be issued until MDCC is "Issued", a GRN can't
 * be recorded until the DI shows "Dispatched", and an MVAC can't be requested until material has
 * actually been accepted at GRN.
 *
 * MDCC and DI were originally one combined record ("DI cum MDCC issued together"). That was
 * wrong: not all dispatches are MDCC-gated (stock/consumable/rate-contract items move without
 * client clearance), and a DI needs its own number — vendors treat a numbered instruction as an
 * obligation and a screen action as an email, and the DI number is what the LR/invoice reference
 * and what makes the GRN four-way match resolvable. So they're now two records: MDCC is purely
 * the client's certificate (number, date, validity); DI (including site readiness — a property of
 * a specific delivery, not of the certificate) is SEL's own instruction to the vendor, gated on
 * MDCC unless the BOQ item's "Inspection Required" flag is explicitly "No" — in which case the DI
 * can be issued directly off the PO (the "direct path", for stock/consumable/rate-contract items
 * that never go through client clearance at all).
 */

export const MC_COLLECTION = "manufacturingClearances";
export const MC_PERMISSION_RESOURCE = "Project Management.Manufacturing Clearance";

export const INSPECTION_COLLECTION = "inspections";
export const INSPECTION_PERMISSION_RESOURCE = "Project Management.Inspections";

export const MDCC_COLLECTION = "mdccRecords";
export const MDCC_PERMISSION_RESOURCE = "Project Management.MDCC";

export const DI_COLLECTION = "dispatchInstructions";
export const DI_PERMISSION_RESOURCE = "Project Management.Dispatch Instructions";

export const GRN_COLLECTION = "grns";
export const GRN_PERMISSION_RESOURCE = "Project Management.GRN";

// Distinct from the unrelated "MVAC" under Billing Recon (a JMC-sibling quantity certification
// for subcontractor billing) — this is the Material Verification & Acceptance Certificate, the
// joint SEL/client sign-off that turns received material into a billable receivable.
export const MVAC_COLLECTION = "mvacRecords";
export const MVAC_PERMISSION_RESOURCE = "Project Management.MVAC";

export const MC_STATUSES = ["Pending", "Cleared", "Rejected"] as const;
export type McStatus = (typeof MC_STATUSES)[number];

export const INSPECTION_STATUSES = ["Not Requested", "Requested", "Passed", "Passed with Punch Items", "Failed"] as const;
export type InspectionStatus = (typeof INSPECTION_STATUSES)[number];

export const PUNCH_SEVERITIES = ["Critical", "Major", "Minor"] as const;
export type PunchSeverity = (typeof PUNCH_SEVERITIES)[number];

export interface PunchItem {
  punchId: string;
  description: string;
  severity: PunchSeverity;
  targetDate?: string;
  closed: boolean;
  closedDate?: string;
  closedBy?: string;
  closedByName?: string;
}

// "Requested" is the state that actually costs money — fully manufactured, inspected material
// sitting immobilised while the request sits with the client. Separating it from "Pending"
// (not yet requested) is what makes the aging/value-immobilised view in the MDCC page possible.
export const MDCC_STATUSES = ["Pending", "Requested", "Issued"] as const;
export type MdccStatus = (typeof MDCC_STATUSES)[number];

export interface SiteReadinessCheck {
  key: string;
  label: string;
  confirmed: boolean;
}

// Deliberately short — the spec's own framing is "half a screen, not a separate workflow."
export const SITE_READINESS_ITEMS: Array<{ key: string; label: string }> = [
  { key: "access", label: "Access road & unloading equipment available" },
  { key: "storage", label: "Storage space identified" },
  { key: "manpower", label: "Manpower & supervision arranged" },
];

export const emptySiteReadiness = (): SiteReadinessCheck[] =>
  SITE_READINESS_ITEMS.map((item) => ({ key: item.key, label: item.label, confirmed: false }));

/** A DI can't be issued until every site readiness item is confirmed — the gate that stops
 * fully-inspected material being authorised to arrive somewhere that can't actually receive it.
 * Readiness is a property of a specific delivery (the DI), not of the client's MDCC certificate. */
export const isSiteReady = (checks?: SiteReadinessCheck[]): boolean =>
  Boolean(checks?.length) && checks!.every((check) => check.confirmed);

// Shared identity fields every gate record carries, so a row can always be traced back to its
// BOQ item and the PO it was ordered on.
interface GateRecordBase {
  id: string; // == boqItemId
  boqItemId: string;
  boqSlNo: string;
  description: string;
  poId: string;
  poNumber: string;
  remarks?: string;
  updatedAt?: unknown;
}

export interface ManufacturingClearance extends GateRecordBase {
  vendorName: string;
  status: McStatus;
  clearedDate?: string;
  clearedBy?: string;
  clearedByName?: string;
}

export interface InspectionRecord extends GateRecordBase {
  status: InspectionStatus;
  requestedDate?: string;
  inspectionDate?: string;
  inspectorName?: string;
  reportDocumentId?: string;
  reportFileName?: string;
  reportFileUrl?: string;
  qtyOffered?: number;
  qtyAccepted?: number;
  qtyRejected?: number;
  punchItems?: PunchItem[];
  // Serials of the accepted units — optional (not every item is serial-tracked). Downstream
  // stages (DI, GRN, MVAC) validate their own serial lists as a subset of this one; see
  // src/lib/serial-tracking.ts.
  serials?: string[];
}

export interface MdccRecord extends GateRecordBase {
  status: MdccStatus;
  requestedDate?: string;
  mdccNumber?: string;
  mdccDate?: string;
  validUntil?: string;
  issuedBy?: string;
  issuedByName?: string;
}

// "Issued" is the point a vendor obligation actually exists — before that it's just a screen
// draft. "Dispatched" is what gates GRN: material can't be "received" before the DI even shows
// it left the vendor's works. Acknowledged/Dispatched are simple flag-forward steps in this slice
// (no in-transit/delivered/lapsed/cancelled/amended states yet — see the module note above).
export const DI_STATUSES = ["Pending", "Issued", "Acknowledged", "Dispatched"] as const;
export type DiStatus = (typeof DI_STATUSES)[number];

export interface DiRecord extends GateRecordBase {
  status: DiStatus;
  // Which precondition set this DI was issued under — recorded at issue time so the register
  // stays honest even if the item's "Inspection Required" flag changes later.
  path?: "mdcc_gated" | "direct";
  diNumber?: string;
  dispatchQty?: number;
  // The serials actually being dispatched on this DI — validated as a subset of Inspection's
  // serials (when Inspection recorded any) before issue.
  dispatchSerials?: string[];
  consignee?: string;
  deliveryAddress?: string;
  siteContact?: string;
  siteContactPhone?: string;
  dispatchByDate?: string;
  expectedArrival?: string;
  transportArrangedBy?: string;
  freightBasis?: string;
  documentsRequired?: string;
  siteReadiness?: SiteReadinessCheck[];
  siteReadinessConfirmedBy?: string;
  siteReadinessConfirmedByName?: string;
  siteReadinessConfirmedOn?: string;
  issuedBy?: string;
  issuedByName?: string;
  issuedOn?: string;
  acknowledgedOn?: string;
  dispatchedOn?: string;
}

// Auto-derived from the qty breakdown below, not manually chosen — see computeGrnStatus().
export const GRN_STATUSES = ["Not Received", "Received Clean", "Received with Discrepancy"] as const;
export type GrnStatus = (typeof GRN_STATUSES)[number];

export interface GrnRecord extends GateRecordBase {
  status: GrnStatus;
  grnNumber?: string;
  receivedDate?: string;
  receivedQty?: number;
  acceptedQty?: number;
  rejectedQty?: number;
  shortQty?: number;
  damagedQty?: number;
  receivedBy?: string;
  receivedByName?: string;
  // The serials actually received — validated as a subset of the DI's dispatchSerials (when the
  // DI recorded any). A received serial the DI never dispatched is the "unauthorised receipt"
  // exception the spec calls out, not a remark.
  receivedSerials?: string[];
}

// No record exists until a request is raised — "Pending" is shown for that state, same
// convention as MDCC. "Held" covers a Critical open observation blocking acceptance outright.
export const MVAC_STATUSES = ["Pending", "Requested", "Signed", "Held"] as const;
export type MvacStatus = (typeof MVAC_STATUSES)[number];

export interface MvacRecord extends GateRecordBase {
  status: MvacStatus;
  requestedDate?: string;
  clientRepName?: string;
  qtyAccepted?: number;
  qtyHeld?: number;
  // Reuses the same shape (and severities) as Inspection's punch items — the spec's own framing
  // of MVAC observations (Critical/Major/Minor) is identical to a punch list.
  observations?: PunchItem[];
  outcome?: "Accepted" | "Accepted with Observations" | "Held";
  // The serials jointly verified with the client — validated as a subset of GRN's
  // receivedSerials (when GRN recorded any). Nameplate check is a single confirmation covering
  // the batch, not per-serial — see the module note in serial-tracking.ts for why this stays a
  // list-and-subset-check rather than a full per-unit lifecycle record.
  verifiedSerials?: string[];
  nameplateVerified?: boolean;
  signedBy?: string;
  signedByName?: string;
  signedOn?: string;
  billingReleasedOn?: string;
  billingReleasedBy?: string;
  billingReleasedByName?: string;
}

export const mcStatusStyles: Record<McStatus, string> = {
  Pending: "bg-muted text-muted-foreground",
  Cleared: "bg-emerald-100 text-emerald-700",
  Rejected: "bg-red-100 text-red-700",
};

export const inspectionStatusStyles: Record<InspectionStatus, string> = {
  "Not Requested": "bg-muted text-muted-foreground",
  Requested: "bg-blue-100 text-blue-700",
  Passed: "bg-emerald-100 text-emerald-700",
  "Passed with Punch Items": "bg-amber-100 text-amber-700",
  Failed: "bg-red-100 text-red-700",
};

export const punchSeverityStyles: Record<PunchSeverity, string> = {
  Critical: "bg-red-100 text-red-700",
  Major: "bg-amber-100 text-amber-700",
  Minor: "bg-muted text-muted-foreground",
};

/** Whether any Critical or Major punch item is still open — these are the only severities that
 * block MDCC; Minor items may be carried forward to site. */
export const hasOpenBlockingPunch = (punchItems: PunchItem[] = []): boolean =>
  punchItems.some((item) => !item.closed && (item.severity === "Critical" || item.severity === "Major"));

export const mdccStatusStyles: Record<MdccStatus, string> = {
  Pending: "bg-muted text-muted-foreground",
  Requested: "bg-blue-100 text-blue-700",
  Issued: "bg-emerald-100 text-emerald-700",
};

export const diStatusStyles: Record<DiStatus, string> = {
  Pending: "bg-muted text-muted-foreground",
  Issued: "bg-blue-100 text-blue-700",
  Acknowledged: "bg-indigo-100 text-indigo-700",
  Dispatched: "bg-emerald-100 text-emerald-700",
};

export const grnStatusStyles: Record<GrnStatus, string> = {
  "Not Received": "bg-muted text-muted-foreground",
  "Received Clean": "bg-emerald-100 text-emerald-700",
  "Received with Discrepancy": "bg-amber-100 text-amber-700",
};

export const mvacStatusStyles: Record<MvacStatus, string> = {
  Pending: "bg-muted text-muted-foreground",
  Requested: "bg-blue-100 text-blue-700",
  Signed: "bg-emerald-100 text-emerald-700",
  Held: "bg-red-100 text-red-700",
};

/** Inspection can only be requested once Manufacturing Clearance has actually cleared. */
export const canRequestInspection = (mcStatus?: McStatus): boolean => mcStatus === "Cleared";

/** MDCC can only be issued once the item has passed Inspection outright, or passed with only
 * Minor punch items open (nothing Critical/Major left blocking). */
export function canIssueMdcc(inspectionStatus?: InspectionStatus, punchItems: PunchItem[] = []): boolean {
  if (inspectionStatus === "Passed") return true;
  if (inspectionStatus === "Passed with Punch Items") return !hasOpenBlockingPunch(punchItems);
  return false;
}

/** The BOQ "Inspection Required" flag defaults to required — absence of the column, or any value
 * other than an explicit "No", means inspection/MDCC still applies. Direct-path eligibility is a
 * deliberate opt-out per validation rule D6 ("must be explicitly not-required"), never an
 * accidental one from a blank cell. */
export const isInspectionRequired = (value: unknown): boolean =>
  String(value ?? "yes").trim().toLowerCase() !== "no";

/** A DI can be issued once the client's MDCC has actually been issued (the gated path) — SEL
 * can't instruct a vendor to move material that hasn't cleared with the client yet — OR, for a
 * BOQ item explicitly flagged as not requiring inspection/client clearance, directly off the PO
 * (the "direct" path: stock, consumables, rate-contract supplies). */
export const canIssueDi = (mdccStatus?: MdccStatus, inspectionRequired = true): boolean =>
  !inspectionRequired || mdccStatus === "Issued";

/** Which precondition set a DI is actually being issued under — recorded on the record itself so
 * the register stays honest if the BOQ flag changes later. */
export const computeDiPath = (inspectionRequired: boolean): "mdcc_gated" | "direct" =>
  inspectionRequired ? "mdcc_gated" : "direct";

/** A GRN can only be recorded once the DI shows the material has actually been dispatched —
 * material can't be "received" at site before it's even left the vendor's works. This now gates
 * on the DI, not the MDCC directly: the MDCC only says the client has cleared it, the DI says it
 * has actually moved. */
export const canReceiveGrn = (diStatus?: DiStatus): boolean => diStatus === "Dispatched";

/** GRN status is derived from the qty breakdown, never chosen directly — any shortage, rejection,
 * or damage found at receipt makes it "Received with Discrepancy" so it surfaces in the
 * discrepancy-aware views without a separate manual flag that could drift out of sync. */
export function computeGrnStatus(
  receivedQty: number,
  rejectedQty: number,
  shortQty: number,
  damagedQty: number,
): GrnStatus {
  if (!receivedQty) return "Not Received";
  return rejectedQty > 0 || shortQty > 0 || damagedQty > 0 ? "Received with Discrepancy" : "Received Clean";
}

/** Signing is blocked only by an open Critical observation — the spec's own severity routing
 * (Critical blocks acceptance outright; Major still allows signing but blocks billing release;
 * Minor blocks neither). */
export const canSignMvac = (observations: PunchItem[] = []): boolean =>
  !observations.some((item) => !item.closed && item.severity === "Critical");

/** Billing can only be released once signed with nothing Critical or Major still open — reuses
 * the same open-blocking-punch check MDCC uses for Passed-with-Punch-Items. */
export const canReleaseMvacBilling = (status?: MvacStatus, observations: PunchItem[] = []): boolean =>
  status === "Signed" && !hasOpenBlockingPunch(observations);

export interface ReadinessCheck {
  key: string;
  label: string;
  status: "ok" | "gap";
  detail: string;
}

/** The readiness checks the system can verify automatically before an inspection call goes out —
 * §3 of the blueprint's list, narrowed to what's actually tracked here: MC actually cleared, the
 * item's drawing (if MDL-tracked) still approved, and the quantity offered not exceeding what was
 * ordered/cleared. A hard gap here should stop the call before it reaches the client, not after. */
export function checkInspectionReadiness(input: {
  mcStatus?: McStatus;
  mdlRequired: boolean;
  mdlApproved: boolean;
  qtyOffered: number;
  poQty: number;
}): ReadinessCheck[] {
  const checks: ReadinessCheck[] = [
    {
      key: "mc",
      label: "Manufacturing Clearance",
      status: input.mcStatus === "Cleared" ? "ok" : "gap",
      detail: input.mcStatus === "Cleared" ? "Cleared" : `Currently ${input.mcStatus ?? "Pending"}`,
    },
  ];
  if (input.mdlRequired) {
    checks.push({
      key: "drawing",
      label: "Drawing Approval",
      status: input.mdlApproved ? "ok" : "gap",
      detail: input.mdlApproved ? "Approved" : "Not yet approved",
    });
  }
  checks.push({
    key: "qty",
    label: "Quantity Offered",
    status: input.qtyOffered > 0 && input.qtyOffered <= input.poQty ? "ok" : "gap",
    detail: `${input.qtyOffered || 0} offered vs ${input.poQty} ordered`,
  });
  return checks;
}

/** An MVAC can only be requested once something has actually been accepted at GRN, and the
 * inspection that covers it is itself closed out (reuses the exact same bar MDCC issue applies —
 * passed outright, or passed with only Minor punch items open). Whether the GRN carries a
 * shortage/damage discrepancy is surfaced in checkMvacReadiness() below but deliberately does not
 * block the request here — unlike MC/Inspection status, discrepancy *resolution* isn't a fact
 * this system can verify (there's no resolution register), so it can't be a hard gate; it's the
 * requester's judgement call, same as PO's flow-down gaps. */
export function canRequestMvac(
  grnAcceptedQty: number | undefined,
  inspectionStatus?: InspectionStatus,
  inspectionPunchItems: PunchItem[] = [],
): boolean {
  return Boolean(grnAcceptedQty && grnAcceptedQty > 0) && canIssueMdcc(inspectionStatus, inspectionPunchItems);
}

/** The §2 readiness checklist, narrowed to what's actually tracked here: GRN posted with an
 * accepted quantity, inspection closed out, and — informational only, not blocking (see
 * canRequestMvac) — whether the GRN carries an unresolved discrepancy. */
export function checkMvacReadiness(input: {
  grnStatus?: GrnStatus;
  grnAcceptedQty?: number;
  inspectionStatus?: InspectionStatus;
  inspectionPunchItems?: PunchItem[];
}): ReadinessCheck[] {
  const inspectionReady = canIssueMdcc(input.inspectionStatus, input.inspectionPunchItems);
  const checks: ReadinessCheck[] = [
    {
      key: "grn",
      label: "GRN Posted & Accepted",
      status: input.grnAcceptedQty && input.grnAcceptedQty > 0 ? "ok" : "gap",
      detail: input.grnAcceptedQty && input.grnAcceptedQty > 0 ? `${input.grnAcceptedQty} accepted` : "Nothing accepted yet",
    },
    {
      key: "inspection",
      label: "Inspection Closed Out",
      status: inspectionReady ? "ok" : "gap",
      detail: inspectionReady ? "Passed" : `Currently ${input.inspectionStatus ?? "Not Requested"}`,
    },
  ];
  if (input.grnStatus === "Received with Discrepancy") {
    checks.push({
      key: "discrepancy",
      label: "GRN Discrepancy",
      status: "gap",
      detail: "Shortage/damage recorded at receipt — confirm it's resolved or documented before requesting",
    });
  }
  return checks;
}

export const formatGateDate = (value?: string) => {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

/** Days elapsed since a date (e.g. an MDCC request's requestedDate) — how long something has
 * been sitting with the client, in plain days, not "12 days since the last follow-up." */
export function gateDaysSince(value?: string, today: Date = new Date()): number | null {
  if (!value) return null;
  const start = new Date(`${value}T00:00:00`);
  if (Number.isNaN(start.getTime())) return null;
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.max(0, Math.round((startOfToday.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
}

/** Days remaining until a date (e.g. an MDCC's validUntil) — negative once it's passed. */
export function gateDaysUntil(value?: string, today: Date = new Date()): number | null {
  if (!value) return null;
  const end = new Date(`${value}T00:00:00`);
  if (Number.isNaN(end.getTime())) return null;
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((end.getTime() - startOfToday.getTime()) / (1000 * 60 * 60 * 24));
}

// One row per BOQ item that has been placed on an issued/received PO — the shared universe all
// three gate pages (and the PO detail page) build their tables from.
export interface PoPlacedItem {
  boqItemId: string;
  boqSlNo: string;
  description: string;
  unit: string;
  qty: number;
  poId: string;
  poNumber: string;
  vendorName: string;
}

const PLACED_PO_STATUSES = new Set(["Issued", "Received"]);

/** Flattens issued/received POs into one row per BOQ line item, keeping the most recent PO
 * reference when the same BOQ item was split across more than one PO. */
export function buildPoPlacedItems(
  purchaseOrders: Array<{
    id: string;
    poNumber: string;
    poDate?: string;
    vendorName: string;
    status: string;
    items?: Array<{ boqItemId?: string; description: string; unit: string; qty: number }>;
  }>,
): Map<string, PoPlacedItem> {
  const placed = new Map<string, PoPlacedItem>();
  const sorted = [...purchaseOrders]
    .filter((po) => PLACED_PO_STATUSES.has(po.status))
    .sort((a, b) => (a.poDate ?? "").localeCompare(b.poDate ?? ""));
  for (const po of sorted) {
    for (const item of po.items ?? []) {
      if (!item.boqItemId) continue;
      placed.set(item.boqItemId, {
        boqItemId: item.boqItemId,
        boqSlNo: "",
        description: item.description,
        unit: item.unit,
        qty: item.qty,
        poId: po.id,
        poNumber: po.poNumber,
        vendorName: po.vendorName,
      });
    }
  }
  return placed;
}

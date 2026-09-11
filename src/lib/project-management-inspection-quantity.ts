/**
 * The Inspection quantity ledger.
 *
 * Same document shape as Manufacturing Clearance — one inspection call covers many PO lines, one
 * PO line is inspected by a succession of calls — but with two differences that matter, both of
 * which fall out of where inspection sits in the supply chain.
 *
 * **1. The ceiling is cleared quantity, not ordered quantity.** `canRequestInspection` in
 * supply-gates.ts already says inspection cannot be requested until MC reads "Cleared"; expressed
 * as quantity, you may only offer for inspection what has actually been cleared for manufacturing.
 * So the ledger's ceiling is the *approved MC quantity* for the line, which is itself capped by
 * the PO. Offering 100 against a PO of 100 where only 40 has been cleared is the mistake this
 * prevents — and it is invisible in a status-only model, where "MC: Cleared" looks like a green
 * light for the whole line.
 *
 * **2. Rejected quantity comes back.** In MC, rejecting releases the reservation and the story
 * ends. In inspection, failed material is still cleared-for-manufacturing material — it goes back
 * to the vendor for rework and is re-offered. So rejected quantity is *not* deducted from what is
 * available to offer; only accepted quantity is. A model that consumed rejected quantity would
 * strand it: the vendor reworks 20 tonnes and there is no balance left to offer them under.
 *
 * Three quantities per line, therefore, where MC had one:
 *
 *     offered   — entered when the call is raised, and reserved from that moment
 *     accepted  — entered when the result is recorded; this is what flows on to MDCC
 *     rejected  — offered − accepted, derived rather than stored so the two cannot disagree
 *
 * Pure (no Firebase, no React) so every rule here is unit-testable with `node --test`.
 */

import { hasOpenBlockingPunch, type PunchItem } from "./supply-gates.ts";

/** Project-level register: `projects/{globalProjectId}/inspectionCalls`. */
export const INSPECTION_CALL_COLLECTION = "inspectionCalls";
/** Project-level register: `projects/{globalProjectId}/inspectionCallItems`. */
export const INSPECTION_CALL_ITEM_COLLECTION = "inspectionCallItems";
/**
 * Project-level concurrency guard: `projects/{globalProjectId}/inspectionPoLineBalances`, doc id
 * `${poId}__${poLineId}`.
 *
 * Exists for the same reason as MC's: the client SDK cannot run a query inside a transaction, so
 * two people offering the same cleared quantity would both read a stale balance and both pass.
 * Derived from the items and rebuildable — see `rebuildInspectionPoLineBalance`.
 */
export const INSPECTION_PO_LINE_BALANCE_COLLECTION = "inspectionPoLineBalances";

export const inspectionPoLineBalanceId = (poId: string, poLineId: string): string =>
  `${poId}__${poLineId}`;

export const generateInspectionCallNumber = (callDate: string, docId: string): string =>
  `IC-${callDate.replace(/-/g, "")}-${docId.slice(0, 5).toUpperCase()}`;

/* ── Statuses ───────────────────────────────────────────────────────────────────────────────── */

export const INSPECTION_CALL_STATUSES = [
  "Draft",
  "Called",
  "Partially Inspected",
  "Completed",
  "Cancelled",
] as const;
export type InspectionCallStatus = (typeof INSPECTION_CALL_STATUSES)[number];

/**
 * Item outcome. `Passed with Punch Items` is a real accept — the quantity flows on — but MDCC is
 * blocked while a Critical or Major punch stays open, which `canIssueMdccForItem` enforces.
 */
export const INSPECTION_ITEM_STATUSES = [
  "Pending",
  "Passed",
  "Passed with Punch Items",
  "Failed",
  "Cancelled",
] as const;
export type InspectionItemStatus = (typeof INSPECTION_ITEM_STATUSES)[number];

/** A PO line's inspection position against its cleared quantity, derived rather than stored. */
export const INSPECTION_LINE_STATUSES = [
  "Not Inspected",
  "Partially Inspected",
  "Fully Inspected",
] as const;
export type InspectionLineStatus = (typeof INSPECTION_LINE_STATUSES)[number];

/** Header states whose pending items hold offered quantity against the cleared balance. */
const RESERVING_CALL_STATUSES = new Set<InspectionCallStatus>(["Called", "Partially Inspected"]);
/** Item states awaiting a result, so still holding their offered quantity. */
const RESERVING_ITEM_STATUSES = new Set<InspectionItemStatus>(["Pending"]);
/** Item states that have consumed cleared quantity for good. */
const ACCEPTED_ITEM_STATUSES = new Set<InspectionItemStatus>([
  "Passed",
  "Passed with Punch Items",
]);
const VOID_CALL_STATUSES = new Set<InspectionCallStatus>(["Cancelled"]);

/* ── Records ────────────────────────────────────────────────────────────────────────────────── */

export interface InspectionCall {
  id: string;
  callNumber: string;
  globalProjectId: string;
  vendorId: string;
  vendorName: string;
  /** Date the material is offered for inspection. */
  callDate: string;
  /** Date it was actually inspected, once known. */
  inspectionDate?: string;
  /** Who inspects — SEL QA, the client, or a third-party agency. */
  inspectorName?: string;
  agency?: string;
  status: InspectionCallStatus;
  revision: number;
  remarks?: string;
  createdAt?: unknown;
  createdBy?: string;
  createdByName?: string;
  updatedAt?: unknown;
  updatedBy?: string;
  updatedByName?: string;
}

export interface InspectionCallItem {
  id: string;
  callId: string;
  poId: string;
  poNumber: string;
  /** The PO line being inspected. Never PO number plus description — a PO may list one item twice. */
  poLineId: string;
  boqItemId?: string;
  itemDescription: string;
  unit: string;
  /** Quantity presented for inspection. Entered when the call is raised. */
  offeredQty: number;
  /** Quantity that passed. Entered when the result is recorded; absent until then. */
  acceptedQty?: number;
  status: InspectionItemStatus;
  punchItems?: PunchItem[];
  /** Serials of the accepted units, where the item is serial-tracked. */
  serials?: string[];
  reportDocumentId?: string;
  remarks?: string;
}

/**
 * The PO line being inspected, with its cleared quantity.
 *
 * `mcApprovedQty` is the ceiling and comes from the MC ledger (`PoLineLedger.approvedQty`). A line
 * with nothing cleared has nothing inspectable, which is the quantity-level statement of the
 * existing MC → Inspection gate.
 */
export interface InspectablePoLine {
  poId: string;
  poNumber: string;
  poLineId: string;
  boqItemId?: string;
  itemDescription: string;
  unit: string;
  /** Ordered quantity, for context on screen. Not the ceiling. */
  orderedQty: number;
  /** Approved MC quantity — the ceiling on what may ever be offered. */
  mcApprovedQty: number;
}

/* ── The ledger ─────────────────────────────────────────────────────────────────────────────── */

export interface InspectionLedger {
  poId: string;
  poNumber: string;
  poLineId: string;
  itemDescription: string;
  unit: string;
  orderedQty: number;
  /** The ceiling: what MC has approved for this line. */
  clearedQty: number;
  /** Σ accepted quantity on live calls. This is what may proceed to MDCC. */
  acceptedQty: number;
  /** Σ offered quantity on called-but-undecided items — held, not yet resolved. */
  offeredPendingQty: number;
  /** Σ rejected quantity, i.e. offered − accepted on failed items. Available to re-offer. */
  rejectedQty: number;
  /** Σ offered quantity on Draft calls. Reported, but NOT deducted from `availableQty`. */
  draftQty: number;
  /** cleared − accepted − offeredPending. The most a new call may offer. */
  availableQty: number;
  /** availableQty − draftQty, floored at zero. Advisory, so a screen can warn before submitting. */
  availableAfterDraftsQty: number;
  status: InspectionLineStatus;
  /** accepted ÷ cleared, as a percentage. */
  acceptedPct: number;
  /** True once accepted quantity has reached the cleared quantity. */
  fullyInspected: boolean;
  /** True when nothing has been cleared yet — the line is not inspectable at all. */
  awaitingClearance: boolean;
}

const num = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

const EPSILON = 0.0005;
const round3 = (value: number): number => Math.round(value * 1000) / 1000;

export const inspectionPoLineKey = (poId: string, poLineId: string): string =>
  `${poId}::${poLineId}`;

/** Rejected quantity on a decided item. Derived, never stored, so the two cannot drift. */
export function rejectedQtyOf(item: Pick<InspectionCallItem, "offeredQty" | "acceptedQty" | "status">): number {
  if (item.status !== "Failed" && !ACCEPTED_ITEM_STATUSES.has(item.status)) return 0;
  return Math.max(0, round3(num(item.offeredQty) - num(item.acceptedQty)));
}

/**
 * How one inspection item counts, given its own status and its call's.
 *
 * A cancelled call voids its items whatever they say — otherwise a passed line on a cancelled
 * call would keep consuming cleared quantity nobody can use.
 */
function classifyInspectionItem(
  item: Pick<InspectionCallItem, "status">,
  call: Pick<InspectionCall, "status">,
): "decided" | "reserved" | "draft" | "void" {
  if (VOID_CALL_STATUSES.has(call.status)) return "void";
  if (item.status === "Cancelled") return "void";
  // Passed, Passed with Punch Items and Failed are one case for the ledger: the accepted
  // quantity consumes cleared balance and the remainder returns for rework. A Failed item is
  // simply one where the accepted quantity is zero.
  if (ACCEPTED_ITEM_STATUSES.has(item.status) || item.status === "Failed") return "decided";
  if (call.status === "Draft") return "draft";
  if (RESERVING_CALL_STATUSES.has(call.status) && RESERVING_ITEM_STATUSES.has(item.status)) {
    return "reserved";
  }
  // A completed call with a still-pending item shouldn't occur, but holding the quantity is the
  // safe reading — it has not been resolved.
  return "reserved";
}

/**
 * Builds one PO line's inspection ledger from every call item raised against it.
 *
 * `excludeCallId` lets a call being edited see the balance *without* its own contribution.
 */
export function buildInspectionLedger(
  line: InspectablePoLine,
  items: readonly InspectionCallItem[],
  callsById: ReadonlyMap<string, Pick<InspectionCall, "status">>,
  options: { excludeCallId?: string } = {},
): InspectionLedger {
  const clearedQty = Math.max(0, round3(num(line.mcApprovedQty)));
  let acceptedQty = 0;
  let offeredPendingQty = 0;
  let rejectedQty = 0;
  let draftQty = 0;

  for (const item of items) {
    if (item.poId !== line.poId || item.poLineId !== line.poLineId) continue;
    if (options.excludeCallId && item.callId === options.excludeCallId) continue;
    const call = callsById.get(item.callId);
    // An item whose call is missing is not counted — guessing its status mis-states the balance
    // either way, and both are worse than reporting only what is known.
    if (!call) continue;

    switch (classifyInspectionItem(item, call)) {
      case "decided":
        acceptedQty += num(item.acceptedQty);
        // Rejected quantity is tracked but never deducted — it goes back for rework and is
        // re-offered under the same cleared balance.
        rejectedQty += rejectedQtyOf(item);
        break;
      case "reserved":
        offeredPendingQty += num(item.offeredQty);
        break;
      case "draft":
        draftQty += num(item.offeredQty);
        break;
      default:
        break;
    }
  }

  acceptedQty = round3(acceptedQty);
  offeredPendingQty = round3(offeredPendingQty);
  rejectedQty = round3(rejectedQty);
  draftQty = round3(draftQty);

  const availableQty = Math.max(0, round3(clearedQty - acceptedQty - offeredPendingQty));
  const fullyInspected = clearedQty > 0 && acceptedQty >= clearedQty - EPSILON;

  return {
    poId: line.poId,
    poNumber: line.poNumber,
    poLineId: line.poLineId,
    itemDescription: line.itemDescription,
    unit: line.unit,
    orderedQty: round3(num(line.orderedQty)),
    clearedQty,
    acceptedQty,
    offeredPendingQty,
    rejectedQty,
    draftQty,
    availableQty,
    availableAfterDraftsQty: Math.max(0, round3(availableQty - draftQty)),
    status: fullyInspected
      ? "Fully Inspected"
      : acceptedQty > EPSILON
        ? "Partially Inspected"
        : "Not Inspected",
    acceptedPct: clearedQty > 0 ? Math.round((acceptedQty / clearedQty) * 100) : 0,
    fullyInspected,
    awaitingClearance: clearedQty <= EPSILON,
  };
}

export function buildInspectionLedgers(
  lines: readonly InspectablePoLine[],
  items: readonly InspectionCallItem[],
  calls: readonly Pick<InspectionCall, "id" | "status">[],
  options: { excludeCallId?: string } = {},
): Map<string, InspectionLedger> {
  const callsById = new Map(calls.map((call) => [call.id, call]));
  const out = new Map<string, InspectionLedger>();
  for (const line of lines) {
    out.set(
      inspectionPoLineKey(line.poId, line.poLineId),
      buildInspectionLedger(line, items, callsById, options),
    );
  }
  return out;
}

/** A line may be offered only when it has cleared quantity left to offer. */
export const canOfferPoLine = (ledger: InspectionLedger): boolean =>
  !ledger.awaitingClearance && !ledger.fullyInspected && ledger.availableQty > EPSILON;

/* ── Validation ─────────────────────────────────────────────────────────────────────────────── */

export interface QtyCheck {
  ok: boolean;
  message?: string;
}

export interface InspectionValidationError {
  /** The item this concerns, or "" for a call-level problem. */
  itemId: string;
  message: string;
}

/**
 * Whether a requested offer quantity fits the line's cleared balance.
 *
 * The two refusals are deliberately different sentences: "nothing cleared yet" sends the user to
 * Manufacturing Clearance, while "exceeds the cleared balance" tells them the number to use.
 */
export function validateOfferQty(requestedQty: number, ledger: InspectionLedger): QtyCheck {
  const qty = num(requestedQty);
  if (qty <= 0) return { ok: false, message: "Offered quantity must be greater than zero." };
  if (ledger.awaitingClearance) {
    return {
      ok: false,
      message: `${ledger.poNumber} · ${ledger.itemDescription} has no approved Manufacturing Clearance quantity yet, so nothing can be offered for inspection.`,
    };
  }
  if (ledger.fullyInspected) {
    return {
      ok: false,
      message: `${ledger.poNumber} · ${ledger.itemDescription} has already been inspected for its whole cleared quantity of ${ledger.clearedQty} ${ledger.unit}.`,
    };
  }
  if (qty > ledger.availableQty + EPSILON) {
    return {
      ok: false,
      message: `Offered quantity exceeds the cleared balance available for inspection. Maximum quantity available: ${ledger.availableQty}.`,
    };
  }
  return { ok: true };
}

/**
 * Validates a whole inspection call before it is raised.
 *
 * Rejects two items pointing at the same PO line, which would each look valid alone while
 * together exceeding the balance.
 */
export function validateInspectionItems(
  items: readonly Pick<
    InspectionCallItem,
    "id" | "poId" | "poNumber" | "poLineId" | "itemDescription" | "offeredQty"
  >[],
  ledgers: ReadonlyMap<string, InspectionLedger>,
): InspectionValidationError[] {
  const errors: InspectionValidationError[] = [];
  if (!items.length) {
    return [{ itemId: "", message: "Add at least one purchase order line to offer for inspection." }];
  }

  const seenLines = new Map<string, string>();
  for (const item of items) {
    const key = inspectionPoLineKey(item.poId, item.poLineId);

    if (seenLines.get(key)) {
      errors.push({
        itemId: item.id,
        message: `${item.poNumber} · ${item.itemDescription} is on this call twice. Combine the quantities into one line.`,
      });
    } else {
      seenLines.set(key, item.id);
    }

    const ledger = ledgers.get(key);
    if (!ledger) {
      errors.push({
        itemId: item.id,
        message: `${item.poNumber} · ${item.itemDescription} is no longer a line on that purchase order.`,
      });
      continue;
    }
    const check = validateOfferQty(item.offeredQty, ledger);
    if (!check.ok) errors.push({ itemId: item.id, message: check.message! });
  }
  return errors;
}

/**
 * Whether a recorded result is coherent.
 *
 * Accepted cannot exceed offered — the inspector cannot pass more than was presented. Failing
 * everything is legitimate (accepted 0); passing everything is the common case.
 */
export function validateInspectionResult(
  offeredQty: number,
  acceptedQty: number,
): QtyCheck {
  const offered = num(offeredQty);
  const accepted = num(acceptedQty);
  if (accepted < 0) return { ok: false, message: "Accepted quantity cannot be negative." };
  if (accepted > offered + EPSILON) {
    return {
      ok: false,
      message: `Accepted quantity cannot exceed the ${offered} offered for inspection.`,
    };
  }
  return { ok: true };
}

/**
 * The outcome implied by a result, so the status and the numbers cannot disagree.
 *
 * Accepting nothing is a Failure. Accepting part of what was offered is still a Pass — the
 * accepted quantity proceeds and the rest goes back for rework, which is exactly what the
 * rejected figure records. Punch items are what distinguish a clean pass from a conditional one.
 */
export function resultStatusFor(
  acceptedQty: number,
  punchItems: PunchItem[] = [],
): InspectionItemStatus {
  if (num(acceptedQty) <= EPSILON) return "Failed";
  return punchItems.length > 0 ? "Passed with Punch Items" : "Passed";
}

/** MDCC may be issued for an item once it passed and no Critical or Major punch remains open. */
export function canIssueMdccForItem(
  item: Pick<InspectionCallItem, "status" | "punchItems">,
): boolean {
  if (item.status === "Passed") return true;
  if (item.status === "Passed with Punch Items") return !hasOpenBlockingPunch(item.punchItems ?? []);
  return false;
}

/* ── Per-item view figures ──────────────────────────────────────────────────────────────────── */

export interface InspectionItemView {
  poNumber: string;
  itemDescription: string;
  unit: string;
  /** The ceiling for this line. */
  clearedQty: number;
  /** Accepted before this call. */
  previouslyAcceptedQty: number;
  offeredQty: number;
  acceptedQty: number;
  rejectedQty: number;
  /** previouslyAccepted + accepted on this call. */
  cumulativeAcceptedQty: number;
  balanceQty: number;
}

/**
 * The row the call detail screen shows.
 *
 * The ledger must have been built with `excludeCallId` set to this call, so
 * `previouslyAcceptedQty` is genuinely previous.
 */
export function buildInspectionItemView(
  item: InspectionCallItem,
  ledger: InspectionLedger,
): InspectionItemView {
  const offeredQty = round3(num(item.offeredQty));
  const acceptedQty = round3(num(item.acceptedQty));
  const previouslyAcceptedQty = ledger.acceptedQty;
  const cumulativeAcceptedQty = round3(previouslyAcceptedQty + acceptedQty);
  return {
    poNumber: ledger.poNumber,
    itemDescription: ledger.itemDescription,
    unit: ledger.unit,
    clearedQty: ledger.clearedQty,
    previouslyAcceptedQty,
    offeredQty,
    acceptedQty,
    rejectedQty: rejectedQtyOf(item),
    cumulativeAcceptedQty,
    balanceQty: Math.max(0, round3(ledger.clearedQty - cumulativeAcceptedQty)),
  };
}

/* ── Header status ──────────────────────────────────────────────────────────────────────────── */

/**
 * The call status implied by its items.
 *
 * Derived rather than stored so the two can never disagree. A call explicitly Cancelled keeps
 * that status — it is a decision about the call as a whole.
 */
export function deriveInspectionCallStatus(
  items: readonly Pick<InspectionCallItem, "status">[],
  current: InspectionCallStatus,
): InspectionCallStatus {
  if (current === "Draft" || VOID_CALL_STATUSES.has(current)) return current;
  if (!items.length) return current;

  const live = items.filter((item) => item.status !== "Cancelled");
  if (!live.length) return "Cancelled";

  const decided = live.filter((item) => item.status !== "Pending");
  if (decided.length === 0) return "Called";
  if (decided.length === live.length) return "Completed";
  return "Partially Inspected";
}

/* ── Concurrency guard ──────────────────────────────────────────────────────────────────────── */

export interface InspectionPoLineBalance {
  poId: string;
  poLineId: string;
  poNumber: string;
  clearedQty: number;
  acceptedQty: number;
  offeredPendingQty: number;
  updatedAt?: unknown;
}

/** What a guard document should hold, given the items. Used to seed and to repair. */
export function rebuildInspectionPoLineBalance(ledger: InspectionLedger): InspectionPoLineBalance {
  return {
    poId: ledger.poId,
    poLineId: ledger.poLineId,
    poNumber: ledger.poNumber,
    clearedQty: ledger.clearedQty,
    acceptedQty: ledger.acceptedQty,
    offeredPendingQty: ledger.offeredPendingQty,
  };
}

/**
 * The atomic check, run inside the transaction against the guard document.
 *
 * `balance` is null when no guard exists yet — the first offer against that line — in which case
 * the whole cleared quantity is free.
 */
export function checkBalanceForOffer(
  requestedQty: number,
  clearedQty: number,
  balance: InspectionPoLineBalance | null,
): QtyCheck {
  const accepted = balance ? num(balance.acceptedQty) : 0;
  const offeredPending = balance ? num(balance.offeredPendingQty) : 0;
  const available = Math.max(0, round3(clearedQty - accepted - offeredPending));
  const qty = num(requestedQty);

  if (qty <= 0) return { ok: false, message: "Offered quantity must be greater than zero." };
  if (clearedQty <= EPSILON) {
    return {
      ok: false,
      message:
        "No approved Manufacturing Clearance quantity remains for this line, so nothing can be offered for inspection.",
    };
  }
  if (qty > available + EPSILON) {
    return {
      ok: false,
      message: `Offered quantity exceeds the cleared balance available for inspection. Maximum quantity available: ${available}.`,
    };
  }
  return { ok: true };
}

/* ── Register roll-ups ──────────────────────────────────────────────────────────────────────── */

export interface InspectionRegisterRow {
  callId: string;
  callNumber: string;
  vendorName: string;
  status: InspectionCallStatus;
  callDate: string;
  inspectionDate?: string;
  inspectorName?: string;
  poCount: number;
  itemCount: number;
  offeredQty: number;
  acceptedQty: number;
  rejectedQty: number;
  /** Open Critical or Major punch items across the call — these block MDCC. */
  blockingPunchCount: number;
}

/** One row per call for the register. */
export function buildInspectionRegisterRows(
  calls: readonly InspectionCall[],
  items: readonly InspectionCallItem[],
): InspectionRegisterRow[] {
  const byCall = new Map<string, InspectionCallItem[]>();
  for (const item of items) {
    const list = byCall.get(item.callId) ?? [];
    list.push(item);
    byCall.set(item.callId, list);
  }

  return calls.map((call) => {
    const own = byCall.get(call.id) ?? [];
    const live = own.filter((item) => item.status !== "Cancelled");
    return {
      callId: call.id,
      callNumber: call.callNumber,
      vendorName: call.vendorName,
      status: call.status,
      callDate: call.callDate,
      inspectionDate: call.inspectionDate,
      inspectorName: call.inspectorName,
      poCount: new Set(live.map((item) => item.poId)).size,
      itemCount: live.length,
      offeredQty: round3(live.reduce((sum, item) => sum + num(item.offeredQty), 0)),
      acceptedQty: round3(live.reduce((sum, item) => sum + num(item.acceptedQty), 0)),
      rejectedQty: round3(live.reduce((sum, item) => sum + rejectedQtyOf(item), 0)),
      blockingPunchCount: live.filter((item) => hasOpenBlockingPunch(item.punchItems ?? [])).length,
    };
  });
}

export const inspectionCallStatusStyles: Record<InspectionCallStatus, string> = {
  Draft: "bg-muted text-muted-foreground",
  Called: "bg-blue-100 text-blue-700",
  "Partially Inspected": "bg-amber-100 text-amber-800",
  Completed: "bg-emerald-100 text-emerald-700",
  Cancelled: "bg-slate-200 text-slate-700",
};

export const inspectionItemStatusStyles: Record<InspectionItemStatus, string> = {
  Pending: "bg-blue-100 text-blue-700",
  Passed: "bg-emerald-100 text-emerald-700",
  "Passed with Punch Items": "bg-amber-100 text-amber-800",
  Failed: "bg-red-100 text-red-700",
  Cancelled: "bg-slate-200 text-slate-700",
};

export const inspectionLineStatusStyles: Record<InspectionLineStatus, string> = {
  "Not Inspected": "bg-muted text-muted-foreground",
  "Partially Inspected": "bg-amber-100 text-amber-800",
  "Fully Inspected": "bg-emerald-100 text-emerald-700",
};

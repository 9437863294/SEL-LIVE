/**
 * The Manufacturing Clearance quantity ledger.
 *
 * MC is many-to-many with PO lines: one MC clears quantity across several POs and several lines,
 * and one PO line is cleared by a succession of MCs until the cumulative approved quantity reaches
 * the effective PO quantity. Neither side is a container for the other, so the quantity lives on
 * the join — the MC *item* — and every figure a screen shows is derived from summing those.
 *
 * Two structural prerequisites, both of which the codebase does not satisfy today:
 *
 *  1. **`PurchaseOrderItem` has no line id.** It is a positional array element carrying
 *     `description`, `unit`, `qty` and an optional `boqItemId`. A PO may legitimately list the same
 *     material twice — `groupMdlRowsByPo` says so explicitly — and today those two lines are
 *     indistinguishable. Clearing against "PO-001 / Tower Structure" would silently pool them.
 *     So `poLineId` is required here, and the PO must start minting one per line.
 *  2. **The MC record is one document per BOQ item** (`id == boqItemId` in supply-gates.ts), which
 *     structurally cannot hold a second clearance against the same line. MC needs its own header
 *     and item collections.
 *
 * The reservation rule is the part that prevents real money going wrong. Two buyers looking at the
 * same 200 remaining will both raise 150 unless a submitted MC holds its quantity, so:
 *
 *     available = effective PO qty − approved − reserved
 *
 * A Draft holds nothing (it is a scratchpad, and holding quantity for an abandoned draft is how a
 * PO ends up permanently unclearable), but its quantity is reported separately so the screen can
 * warn before someone submits into a shortfall. Submission reserves; approval converts the
 * reservation to approved; rejection or cancellation releases it.
 *
 * Pure (no Firebase, no React) so every rule here is unit-testable with `node --test`.
 */

/** Project-level register: `projects/{globalProjectId}/mcClearances`. */
export const MC_HEADER_COLLECTION = "mcClearances";
/** Project-level register: `projects/{globalProjectId}/mcClearanceItems`. */
export const MC_ITEM_COLLECTION = "mcClearanceItems";
/**
 * Project-level concurrency guard: `projects/{globalProjectId}/mcPoLineBalances`, doc id
 * `${poId}__${poLineId}`.
 *
 * The MC items are the ledger of record — `buildPoLineLedger` derives every figure from them.
 * This collection exists only because the client SDK cannot run a *query* inside a transaction,
 * so two people submitting against the same PO line simultaneously would both read a stale
 * balance and both pass. Transacting on one document per PO line makes the check atomic, exactly
 * as `inventoryBalances` does for stock. It is rebuildable from the items at any time —
 * see `rebuildPoLineBalance`.
 */
export const MC_PO_LINE_BALANCE_COLLECTION = "mcPoLineBalances";

export const mcPoLineBalanceId = (poId: string, poLineId: string): string =>
  `${poId}__${poLineId}`;

export const generateMcNumber = (mcDate: string, docId: string): string =>
  `MC-${mcDate.replace(/-/g, "")}-${docId.slice(0, 5).toUpperCase()}`;

/**
 * The guard document's shape.
 *
 * `effectiveQty` is copied here so the transaction can check against it without also reading the
 * PO; it is refreshed whenever the balance is written, and `rebuildPoLineBalance` re-derives it.
 */
export interface McPoLineBalance {
  poId: string;
  poLineId: string;
  poNumber: string;
  effectiveQty: number;
  approvedQty: number;
  reservedQty: number;
  updatedAt?: unknown;
}

/** What a balance document should hold, given the items. Used to seed and to repair. */
export function rebuildPoLineBalance(ledger: PoLineLedger): McPoLineBalance {
  return {
    poId: ledger.poId,
    poLineId: ledger.poLineId,
    poNumber: ledger.poNumber,
    effectiveQty: ledger.effectiveQty,
    approvedQty: ledger.approvedQty,
    reservedQty: ledger.reservedQty,
  };
}

/**
 * The atomic check, run inside the transaction against the guard document rather than the
 * client's possibly-stale view.
 *
 * `balance` is null when no guard document exists yet — the first clearance against that line —
 * in which case the whole effective quantity is free.
 */
export function checkBalanceForReservation(
  requestedQty: number,
  effectiveQty: number,
  balance: McPoLineBalance | null,
): QtyCheck {
  const approved = balance ? num(balance.approvedQty) : 0;
  const reserved = balance ? num(balance.reservedQty) : 0;
  const available = Math.max(0, round3(effectiveQty - approved - reserved));
  const qty = num(requestedQty);

  if (qty <= 0) return { ok: false, message: "Clearance quantity must be greater than zero." };
  if (available <= 0) {
    return {
      ok: false,
      message: `MC quantity exceeds available PO balance. Maximum clearance quantity available: 0.`,
    };
  }
  if (qty > available + EPSILON) {
    return {
      ok: false,
      message: `MC quantity exceeds available PO balance. Maximum clearance quantity available: ${available}.`,
    };
  }
  return { ok: true };
}

/* ── Statuses ───────────────────────────────────────────────────────────────────────────────── */

export const MC_HEADER_STATUSES = [
  "Draft",
  "Submitted",
  "Partially Approved",
  "Approved",
  "Rejected",
  "Cancelled",
] as const;
export type McHeaderStatus = (typeof MC_HEADER_STATUSES)[number];

/**
 * Item status is tracked separately from the header so a workflow can approve line by line — an
 * MC covering four PO lines can pass three and return one without blocking the other three.
 * Whether that is permitted is a workflow setting; the ledger supports it either way.
 */
export const MC_ITEM_STATUSES = ["Pending", "Approved", "Returned", "Rejected", "Cancelled"] as const;
export type McItemStatus = (typeof MC_ITEM_STATUSES)[number];

/** A PO line's own clearance position, derived from the ledger rather than stored. */
export const MC_LINE_STATUSES = ["Not Cleared", "Partially Cleared", "Fully Cleared"] as const;
export type McLineStatus = (typeof MC_LINE_STATUSES)[number];

/** Header states whose pending items hold quantity against the PO. */
const RESERVING_HEADER_STATUSES = new Set<McHeaderStatus>(["Submitted", "Partially Approved"]);
/** Item states that are still awaiting a decision, so still hold their quantity. */
const RESERVING_ITEM_STATUSES = new Set<McItemStatus>(["Pending", "Returned"]);
/** Header states that void everything beneath them. */
const VOID_HEADER_STATUSES = new Set<McHeaderStatus>(["Rejected", "Cancelled"]);

/* ── Records ────────────────────────────────────────────────────────────────────────────────── */

export interface McHeader {
  id: string;
  mcNumber: string;
  globalProjectId: string;
  vendorId: string;
  vendorName: string;
  /** Optional grouping dimension — see `validateMcGrouping`. */
  packageId?: string;
  mcDate: string;
  status: McHeaderStatus;
  /** Amendment chain: 0 for the original, incrementing per amendment. */
  revision: number;
  supersedesMcId?: string;
  remarks?: string;
  createdAt?: unknown;
  createdBy?: string;
  createdByName?: string;
  updatedAt?: unknown;
  updatedBy?: string;
  updatedByName?: string;
}

export interface McItem {
  id: string;
  mcId: string;
  poId: string;
  poNumber: string;
  /** The PO line this clears against. **Not** the BOQ item — a PO can list one material twice. */
  poLineId: string;
  boqItemId?: string;
  itemCode?: string;
  itemDescription: string;
  unit: string;
  /** Quantity this MC item clears. The only figure a user enters. */
  currentMcQty: number;
  status: McItemStatus;
  drawingId?: string;
  qapId?: string;
  remarks?: string;
}

/** The PO line being cleared against, as the ledger needs it. */
export interface McPoLine {
  poId: string;
  poNumber: string;
  poLineId: string;
  boqItemId?: string;
  itemDescription: string;
  unit: string;
  /** Ordered quantity, including any PO amendment already applied. */
  orderedQty: number;
  /** Quantity cancelled on the PO. Reduces what may ever be cleared. */
  cancelledQty?: number;
}

/* ── The ledger ─────────────────────────────────────────────────────────────────────────────── */

export interface PoLineLedger {
  poId: string;
  poNumber: string;
  poLineId: string;
  itemDescription: string;
  unit: string;
  orderedQty: number;
  cancelledQty: number;
  /** ordered − cancelled. The ceiling on cumulative clearance. */
  effectiveQty: number;
  /** Σ currentMcQty of approved items on live MCs. */
  approvedQty: number;
  /** Σ currentMcQty of undecided items on submitted MCs — held, not yet granted. */
  reservedQty: number;
  /** Σ currentMcQty on Draft MCs. Reported, but NOT deducted from `availableQty`. */
  draftQty: number;
  /** effective − approved − reserved. The most a new MC may claim. */
  availableQty: number;
  /** availableQty − draftQty, floored at zero. Advisory: what is left if every open draft is
   *  submitted as it stands. Lets a screen warn before a submission fails. */
  availableAfterDraftsQty: number;
  status: McLineStatus;
  /** approved ÷ effective, as a percentage. */
  clearedPct: number;
  /** True once approved clearance has reached the effective quantity — the line may no longer be
   *  selected into a new MC. */
  fullyCleared: boolean;
}

const num = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Quantities carry up to 3 decimals across the app, matching `boq-quantity-control`. */
const EPSILON = 0.0005;
const round3 = (value: number): number => Math.round(value * 1000) / 1000;

export function effectivePoQty(line: Pick<McPoLine, "orderedQty" | "cancelledQty">): number {
  return Math.max(0, round3(num(line.orderedQty) - num(line.cancelledQty)));
}

/**
 * How one MC item counts, given its own status and its header's.
 *
 * A rejected or cancelled header voids its items whatever they say — otherwise an approved line on
 * a cancelled MC would keep holding quantity nobody can use.
 */
function classifyMcItem(
  item: Pick<McItem, "status">,
  header: Pick<McHeader, "status">,
): "approved" | "reserved" | "draft" | "void" {
  if (VOID_HEADER_STATUSES.has(header.status)) return "void";
  if (item.status === "Rejected" || item.status === "Cancelled") return "void";
  if (item.status === "Approved") return "approved";
  if (header.status === "Draft") return "draft";
  if (RESERVING_HEADER_STATUSES.has(header.status) && RESERVING_ITEM_STATUSES.has(item.status)) {
    return "reserved";
  }
  // Approved header with a still-pending item shouldn't occur, but holding the quantity is the
  // safe reading — it has not been released.
  return "reserved";
}

/**
 * Builds one PO line's ledger from every MC item raised against it.
 *
 * `excludeMcId` lets an MC being edited see the balance *without* its own contribution, which is
 * what makes "you may claim up to N" correct on an edit rather than only on a new MC.
 */
export function buildPoLineLedger(
  line: McPoLine,
  items: readonly McItem[],
  headersById: ReadonlyMap<string, Pick<McHeader, "status">>,
  options: { excludeMcId?: string } = {},
): PoLineLedger {
  const effectiveQty = effectivePoQty(line);
  let approvedQty = 0;
  let reservedQty = 0;
  let draftQty = 0;

  for (const item of items) {
    // Keyed on the PO line, never on PO number plus description.
    if (item.poId !== line.poId || item.poLineId !== line.poLineId) continue;
    if (options.excludeMcId && item.mcId === options.excludeMcId) continue;
    const header = headersById.get(item.mcId);
    // An item whose header is missing is not counted — guessing its status either over- or
    // under-states the balance, and both are worse than reporting only what is known.
    if (!header) continue;

    const qty = num(item.currentMcQty);
    switch (classifyMcItem(item, header)) {
      case "approved":
        approvedQty += qty;
        break;
      case "reserved":
        reservedQty += qty;
        break;
      case "draft":
        draftQty += qty;
        break;
      default:
        break;
    }
  }

  approvedQty = round3(approvedQty);
  reservedQty = round3(reservedQty);
  draftQty = round3(draftQty);

  const availableQty = Math.max(0, round3(effectiveQty - approvedQty - reservedQty));
  const fullyCleared = effectiveQty > 0 && approvedQty >= effectiveQty - EPSILON;

  return {
    poId: line.poId,
    poNumber: line.poNumber,
    poLineId: line.poLineId,
    itemDescription: line.itemDescription,
    unit: line.unit,
    orderedQty: round3(num(line.orderedQty)),
    cancelledQty: round3(num(line.cancelledQty)),
    effectiveQty,
    approvedQty,
    reservedQty,
    draftQty,
    availableQty,
    availableAfterDraftsQty: Math.max(0, round3(availableQty - draftQty)),
    status: fullyCleared
      ? "Fully Cleared"
      : approvedQty > EPSILON
        ? "Partially Cleared"
        : "Not Cleared",
    clearedPct: effectiveQty > 0 ? Math.round((approvedQty / effectiveQty) * 100) : 0,
    fullyCleared,
  };
}

/** Every PO line's ledger, keyed `poId::poLineId`. */
export const poLineKey = (poId: string, poLineId: string): string => `${poId}::${poLineId}`;

export function buildPoLineLedgers(
  lines: readonly McPoLine[],
  items: readonly McItem[],
  headers: readonly Pick<McHeader, "id" | "status">[],
  options: { excludeMcId?: string } = {},
): Map<string, PoLineLedger> {
  const headersById = new Map(headers.map((header) => [header.id, header]));
  const out = new Map<string, PoLineLedger>();
  for (const line of lines) {
    out.set(poLineKey(line.poId, line.poLineId), buildPoLineLedger(line, items, headersById, options));
  }
  return out;
}

/** A fully cleared line may not be selected into another MC. */
export const canSelectPoLine = (ledger: PoLineLedger): boolean =>
  !ledger.fullyCleared && ledger.availableQty > EPSILON;

/* ── Quantity validation ────────────────────────────────────────────────────────────────────── */

export interface QtyCheck {
  ok: boolean;
  message?: string;
}

/**
 * Whether a requested clearance quantity fits the line's balance.
 *
 * The message names the maximum, because "too much" without the number sends the user back to do
 * arithmetic the system already did.
 */
export function validateMcItemQty(requestedQty: number, ledger: PoLineLedger): QtyCheck {
  const qty = num(requestedQty);
  if (qty <= 0) return { ok: false, message: "Clearance quantity must be greater than zero." };
  if (ledger.fullyCleared) {
    return {
      ok: false,
      message: `${ledger.poNumber} · ${ledger.itemDescription} is already fully cleared for its ${ledger.effectiveQty} ${ledger.unit}.`,
    };
  }
  if (qty > ledger.availableQty + EPSILON) {
    return {
      ok: false,
      message: `MC quantity exceeds available PO balance. Maximum clearance quantity available: ${ledger.availableQty}.`,
    };
  }
  return { ok: true };
}

export interface McValidationError {
  /** The MC item this concerns, or "" for a header-level problem. */
  itemId: string;
  message: string;
}

/**
 * Validates a whole MC before it is submitted.
 *
 * Checks every line against its own balance, and rejects two items in one MC pointing at the same
 * PO line — the two would each look valid alone while together exceeding the balance.
 */
export function validateMcItems(
  items: readonly McItem[],
  ledgers: ReadonlyMap<string, PoLineLedger>,
): McValidationError[] {
  const errors: McValidationError[] = [];
  if (!items.length) {
    return [{ itemId: "", message: "Add at least one PO line to clear." }];
  }

  const seenLines = new Map<string, string>();
  for (const item of items) {
    const key = poLineKey(item.poId, item.poLineId);

    const duplicate = seenLines.get(key);
    if (duplicate) {
      errors.push({
        itemId: item.id,
        message: `${item.poNumber} · ${item.itemDescription} is on this MC twice. Combine the quantities into one line.`,
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
    const check = validateMcItemQty(item.currentMcQty, ledger);
    if (!check.ok) errors.push({ itemId: item.id, message: check.message! });
  }
  return errors;
}

/* ── Per-item view figures ──────────────────────────────────────────────────────────────────── */

export interface McItemView {
  poNumber: string;
  itemDescription: string;
  unit: string;
  poQty: number;
  /** Approved before this MC. */
  previousMcQty: number;
  currentMcQty: number;
  /** previous + current. */
  cumulativeMcQty: number;
  balanceQty: number;
}

/**
 * The row the MC detail screen shows: PO qty, previously approved, this MC, cumulative, balance.
 *
 * The ledger must have been built with `excludeMcId` set to this MC, so `previousMcQty` is
 * genuinely *previous* rather than including the line being looked at.
 */
export function buildMcItemView(item: McItem, ledger: PoLineLedger): McItemView {
  const currentMcQty = round3(num(item.currentMcQty));
  const previousMcQty = ledger.approvedQty;
  const cumulativeMcQty = round3(previousMcQty + currentMcQty);
  return {
    poNumber: ledger.poNumber,
    itemDescription: ledger.itemDescription,
    unit: ledger.unit,
    poQty: ledger.effectiveQty,
    previousMcQty,
    currentMcQty,
    cumulativeMcQty,
    balanceQty: Math.max(0, round3(ledger.effectiveQty - cumulativeMcQty)),
  };
}

/* ── Header status ──────────────────────────────────────────────────────────────────────────── */

/**
 * The header status implied by its items, for workflows that approve line by line.
 *
 * Derived rather than stored so the two can never disagree. A header the user has explicitly
 * Cancelled or Rejected keeps that status — those are decisions about the MC as a whole.
 */
export function deriveMcHeaderStatus(
  items: readonly Pick<McItem, "status">[],
  current: McHeaderStatus,
): McHeaderStatus {
  if (current === "Draft" || VOID_HEADER_STATUSES.has(current)) return current;
  if (!items.length) return current;

  const live = items.filter((item) => item.status !== "Cancelled");
  if (!live.length) return "Cancelled";

  if (live.every((item) => item.status === "Approved")) return "Approved";
  if (live.every((item) => item.status === "Rejected")) return "Rejected";
  if (live.some((item) => item.status === "Approved")) return "Partially Approved";
  return "Submitted";
}

/* ── PO amendment guard ─────────────────────────────────────────────────────────────────────── */

/**
 * Whether a PO line's quantity may be revised to `newQty`.
 *
 * Reducing a PO below what has already been cleared would leave approved clearance with no
 * ordered quantity behind it, so it is refused and the message says what has to happen first.
 */
export function validatePoQtyRevision(newQty: number, ledger: PoLineLedger): QtyCheck {
  const qty = num(newQty);
  if (qty < 0) return { ok: false, message: "PO quantity cannot be negative." };
  const floor = round3(ledger.approvedQty + ledger.cancelledQty);
  if (qty < floor - EPSILON) {
    return {
      ok: false,
      message: `PO quantity cannot be reduced below the already approved Manufacturing Clearance quantity of ${ledger.approvedQty} unless the related MC is amended or reversed first.`,
    };
  }
  return { ok: true };
}

/* ── Amendment ──────────────────────────────────────────────────────────────────────────────── */

export interface McAmendment {
  itemId: string;
  poNumber: string;
  itemDescription: string;
  originalQty: number;
  revisedQty: number;
  /** original − revised; positive means quantity returns to the PO balance. */
  releasedQty: number;
}

/**
 * An approved MC is never edited in place — it is superseded by a revision, so the audit trail
 * keeps what was actually approved. This computes what an amendment would release.
 */
export function computeMcAmendment(
  items: readonly McItem[],
  revisedQtyByItemId: Readonly<Record<string, number>>,
): { amendments: McAmendment[]; totalReleasedQty: number; errors: McValidationError[] } {
  const amendments: McAmendment[] = [];
  const errors: McValidationError[] = [];

  for (const item of items) {
    if (!(item.id in revisedQtyByItemId)) continue;
    const revisedQty = num(revisedQtyByItemId[item.id]);
    const originalQty = num(item.currentMcQty);

    if (revisedQty < 0) {
      errors.push({ itemId: item.id, message: "Revised quantity cannot be negative." });
      continue;
    }
    // An amendment reduces or cancels. Increasing means clearing more, which has to go through
    // the balance check as a new MC rather than around it.
    if (revisedQty > originalQty + EPSILON) {
      errors.push({
        itemId: item.id,
        message: `An amendment cannot increase cleared quantity above the approved ${originalQty}. Raise a new MC for the additional quantity.`,
      });
      continue;
    }
    if (Math.abs(revisedQty - originalQty) <= EPSILON) continue;

    amendments.push({
      itemId: item.id,
      poNumber: item.poNumber,
      itemDescription: item.itemDescription,
      originalQty: round3(originalQty),
      revisedQty: round3(revisedQty),
      releasedQty: round3(originalQty - revisedQty),
    });
  }

  return {
    amendments,
    totalReleasedQty: round3(amendments.reduce((sum, entry) => sum + entry.releasedQty, 0)),
    errors,
  };
}

/* ── Grouping rule ──────────────────────────────────────────────────────────────────────────── */

export interface McGroupingRule {
  /** Always true in practice — one MC authorises one vendor to build. */
  sameVendor: boolean;
  sameProject: boolean;
  /** Configurable: some organisations clear a whole vendor's scope in one MC, others per package. */
  samePackage: boolean;
}

export const DEFAULT_MC_GROUPING_RULE: McGroupingRule = {
  sameVendor: true,
  sameProject: true,
  samePackage: false,
};

/** The PO attributes an MC line must agree on, for the grouping check. */
export interface McGroupingCandidate {
  poId: string;
  poNumber: string;
  vendorId: string;
  globalProjectId: string;
  packageId?: string;
}

/**
 * Whether a set of PO lines may share one MC.
 *
 * Without this, materials from unrelated vendors or projects can end up on one clearance, which
 * makes the document meaningless to the vendor it is issued to.
 */
export function validateMcGrouping(
  candidates: readonly McGroupingCandidate[],
  rule: McGroupingRule = DEFAULT_MC_GROUPING_RULE,
): McValidationError[] {
  const errors: McValidationError[] = [];
  if (candidates.length < 2) return errors;

  const distinct = (pick: (candidate: McGroupingCandidate) => string | undefined) =>
    [...new Set(candidates.map((candidate) => pick(candidate) ?? ""))].filter(Boolean);

  if (rule.sameVendor) {
    const vendors = distinct((candidate) => candidate.vendorId);
    if (vendors.length > 1) {
      errors.push({
        itemId: "",
        message: "One Manufacturing Clearance covers one vendor. These purchase orders span more than one.",
      });
    }
  }
  if (rule.sameProject) {
    const projects = distinct((candidate) => candidate.globalProjectId);
    if (projects.length > 1) {
      errors.push({
        itemId: "",
        message: "These purchase orders belong to different projects, which cannot share one clearance.",
      });
    }
  }
  if (rule.samePackage) {
    const packages = distinct((candidate) => candidate.packageId);
    if (packages.length > 1) {
      errors.push({
        itemId: "",
        message: "These purchase orders belong to different packages. Raise one clearance per package, or relax the rule in Settings.",
      });
    }
  }
  return errors;
}

/* ── Register roll-ups ──────────────────────────────────────────────────────────────────────── */

export interface McRegisterRow {
  mcId: string;
  mcNumber: string;
  vendorName: string;
  status: McHeaderStatus;
  mcDate: string;
  poCount: number;
  itemCount: number;
  currentMcQty: number;
}

/** One row per MC for the register: how many POs and lines it covers, and its total quantity. */
export function buildMcRegisterRows(
  headers: readonly McHeader[],
  items: readonly McItem[],
): McRegisterRow[] {
  const byMc = new Map<string, McItem[]>();
  for (const item of items) {
    const list = byMc.get(item.mcId) ?? [];
    list.push(item);
    byMc.set(item.mcId, list);
  }

  return headers.map((header) => {
    const own = byMc.get(header.id) ?? [];
    const live = own.filter((item) => item.status !== "Cancelled");
    return {
      mcId: header.id,
      mcNumber: header.mcNumber,
      vendorName: header.vendorName,
      status: header.status,
      mcDate: header.mcDate,
      poCount: new Set(live.map((item) => item.poId)).size,
      itemCount: live.length,
      currentMcQty: round3(live.reduce((sum, item) => sum + num(item.currentMcQty), 0)),
    };
  });
}

export const mcHeaderStatusStyles: Record<McHeaderStatus, string> = {
  Draft: "bg-muted text-muted-foreground",
  Submitted: "bg-blue-100 text-blue-700",
  "Partially Approved": "bg-amber-100 text-amber-800",
  Approved: "bg-emerald-100 text-emerald-700",
  Rejected: "bg-red-100 text-red-700",
  Cancelled: "bg-slate-200 text-slate-700",
};

export const mcItemStatusStyles: Record<McItemStatus, string> = {
  Pending: "bg-blue-100 text-blue-700",
  Approved: "bg-emerald-100 text-emerald-700",
  Returned: "bg-amber-100 text-amber-800",
  Rejected: "bg-red-100 text-red-700",
  Cancelled: "bg-slate-200 text-slate-700",
};

export const mcLineStatusStyles: Record<McLineStatus, string> = {
  "Not Cleared": "bg-muted text-muted-foreground",
  "Partially Cleared": "bg-amber-100 text-amber-800",
  "Fully Cleared": "bg-emerald-100 text-emerald-700",
};

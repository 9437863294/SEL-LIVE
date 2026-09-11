/**
 * The shared quantity ledger for the downstream supply gates: MDCC, DI, GRN and MVAC.
 *
 * MC and Inspection each got their own ledger because each has genuinely singular rules — MC has
 * vendor/project grouping, Inspection has punch items and the offered/accepted/rejected split.
 * These four do not. Every one of them has the same shape:
 *
 *     present a quantity  →  a decision accepts some or all of it  →  the accepted part flows on
 *
 * MDCC presents a quantity for client clearance and the client issues some of it. A DI presents a
 * quantity for dispatch and the vendor dispatches it. A GRN presents what arrived and site accepts
 * part of it. MVAC presents what is up for joint verification and the client accepts part. Four
 * copies of that would be roughly eighteen hundred lines of near-identical code, so it is one
 * engine parameterised by stage instead.
 *
 * The chain of ceilings is the part worth reading carefully, because it is what stops quantity
 * being invented as it moves downstream:
 *
 *     MC approved → Inspection accepted → MDCC issued → DI dispatched → GRN accepted → MVAC accepted
 *
 * Each stage may only ever present what the stage above it has passed down. `MVAC accepted` is the
 * billing trigger, so an error anywhere up that chain becomes an invoice for material that was
 * never delivered — which is why the ceiling is enforced per PO line rather than per BOQ item.
 *
 * One exception is load-bearing: a BOQ item explicitly flagged `Inspection Required = No` takes
 * the "direct" path (stock, consumables, rate-contract supplies) and skips Inspection *and* MDCC.
 * Its DI ceiling is therefore the MC-approved quantity. `canIssueDi` in supply-gates.ts already
 * encodes that for the status model; `resolveUpstreamQty` is its quantity counterpart.
 *
 * Rejected quantity returns to the available pool, as in Inspection: material the client declined
 * to clear, or site declined to accept, can be re-presented once the reason is fixed. Consuming it
 * would strand the quantity with no way to move it.
 *
 * Pure (no Firebase, no React) so every rule here is unit-testable with `node --test`.
 */

import { hasOpenBlockingPunch, type PunchItem } from "./supply-gates.ts";

/* ── Stages ─────────────────────────────────────────────────────────────────────────────────── */

export const SUPPLY_LEDGER_STAGES = ["mdcc", "di", "grn", "mvac"] as const;
export type SupplyLedgerStage = (typeof SUPPLY_LEDGER_STAGES)[number];

/** Where a stage's ceiling comes from. `mc` and `inspection` are upstream of this module. */
export type UpstreamSource = "mc" | "inspection" | "mdcc" | "di" | "grn";

export interface SupplyStageDefinition {
  stage: SupplyLedgerStage;
  /** Short name, as a screen titles it. */
  label: string;
  /** What one document of this stage is called, lowercase, for sentences. */
  docNoun: string;
  /** Document number prefix, matching `generatePoNumber`'s convention. */
  numberPrefix: string;
  headerCollection: string;
  itemCollection: string;
  balanceCollection: string;
  permissionResource: string;
  /** Permission action that raises a document of this stage. */
  raiseAction: string;
  /** Permission action that records its outcome. */
  completeAction: string;
  /** The ceiling's source on the normal path. */
  upstream: UpstreamSource;
  /**
   * The ceiling's source for a BOQ item that does not require inspection.
   *
   * Only DI differs — it may be raised straight off the cleared PO quantity. The other stages
   * have no direct path, so they fall back to their normal upstream.
   */
  directUpstream?: UpstreamSource;
  /** What the presented quantity is called on screen, e.g. "Requested" / "Dispatch qty". */
  presentedLabel: string;
  /** What the accepted quantity is called, e.g. "Issued" / "Dispatched" / "Accepted". */
  acceptedLabel: string;
  /** Whether the decision can accept less than was presented. */
  splitsOnDecision: boolean;
}

/**
 * The four stages, in chain order.
 *
 * `splitsOnDecision: false` for DI because a dispatch is not partially accepted — the vehicle
 * either leaves with the quantity on the instruction or the instruction is amended. Short delivery
 * surfaces at GRN, which is where it can actually be observed.
 */
export const SUPPLY_STAGE_DEFINITIONS: Record<SupplyLedgerStage, SupplyStageDefinition> = {
  mdcc: {
    stage: "mdcc",
    label: "MDCC",
    docNoun: "client clearance",
    numberPrefix: "MDCC",
    headerCollection: "mdccCertificates",
    itemCollection: "mdccCertificateItems",
    balanceCollection: "mdccPoLineBalances",
    permissionResource: "Project Management.MDCC",
    raiseAction: "Request",
    completeAction: "Issue",
    upstream: "inspection",
    presentedLabel: "Submitted",
    acceptedLabel: "Cleared",
    splitsOnDecision: true,
  },
  di: {
    stage: "di",
    label: "Dispatch Instruction",
    docNoun: "dispatch instruction",
    numberPrefix: "DI",
    headerCollection: "diInstructions",
    itemCollection: "diInstructionItems",
    balanceCollection: "diPoLineBalances",
    permissionResource: "Project Management.Dispatch Instructions",
    raiseAction: "Issue",
    completeAction: "Dispatch",
    upstream: "mdcc",
    // The direct path: an item explicitly not requiring inspection dispatches off cleared PO
    // quantity without ever visiting Inspection or MDCC.
    directUpstream: "mc",
    presentedLabel: "Instructed",
    acceptedLabel: "Dispatched",
    splitsOnDecision: false,
  },
  grn: {
    stage: "grn",
    label: "GRN",
    docNoun: "goods receipt",
    numberPrefix: "GRN",
    headerCollection: "grnReceipts",
    itemCollection: "grnReceiptItems",
    balanceCollection: "grnPoLineBalances",
    permissionResource: "Project Management.GRN",
    raiseAction: "Record",
    completeAction: "Record",
    upstream: "di",
    presentedLabel: "Received",
    acceptedLabel: "Accepted",
    splitsOnDecision: true,
  },
  mvac: {
    stage: "mvac",
    label: "MVAC",
    docNoun: "joint acceptance",
    numberPrefix: "MVAC",
    headerCollection: "mvacCertificates",
    itemCollection: "mvacCertificateItems",
    balanceCollection: "mvacPoLineBalances",
    permissionResource: "Project Management.MVAC",
    raiseAction: "Request",
    completeAction: "Sign",
    upstream: "grn",
    presentedLabel: "Submitted",
    acceptedLabel: "Accepted",
    splitsOnDecision: true,
  },
};

export const supplyStage = (stage: SupplyLedgerStage): SupplyStageDefinition =>
  SUPPLY_STAGE_DEFINITIONS[stage];

/* ── Statuses ───────────────────────────────────────────────────────────────────────────────── */

/**
 * Header statuses, shared across the four stages.
 *
 * Deliberately generic rather than per-stage vocabulary ("Issued", "Dispatched", "Signed"): the
 * lifecycle is identical, and four parallel status unions would mean four parallel style maps and
 * four sets of transition rules for no behavioural difference. The stage definition supplies the
 * per-stage wording for the *quantities*, which is where the vocabulary actually differs.
 */
export const SUPPLY_DOC_STATUSES = [
  "Draft",
  "Open",
  "Partially Completed",
  "Completed",
  "Cancelled",
] as const;
export type SupplyDocStatus = (typeof SUPPLY_DOC_STATUSES)[number];

export const SUPPLY_ITEM_STATUSES = ["Pending", "Accepted", "Rejected", "Cancelled"] as const;
export type SupplyItemStatus = (typeof SUPPLY_ITEM_STATUSES)[number];

export const SUPPLY_LINE_STATUSES = ["Not Started", "Partial", "Complete"] as const;
export type SupplyLineStatus = (typeof SUPPLY_LINE_STATUSES)[number];

const RESERVING_DOC_STATUSES = new Set<SupplyDocStatus>(["Open", "Partially Completed"]);
const VOID_DOC_STATUSES = new Set<SupplyDocStatus>(["Cancelled"]);

/* ── Records ────────────────────────────────────────────────────────────────────────────────── */

export interface SupplyDoc {
  id: string;
  stage: SupplyLedgerStage;
  docNumber: string;
  globalProjectId: string;
  /** The vendor the material came from. Carried on every stage for traceability. */
  vendorId?: string;
  vendorName?: string;
  docDate: string;
  /** Date the decision was taken — issued / dispatched / received / signed. */
  decidedDate?: string;
  status: SupplyDocStatus;
  revision: number;
  /** Party who decides: the client for MDCC and MVAC, the vendor for DI, site for GRN. */
  counterparty?: string;
  /** Stage-specific fields kept in one bag rather than four record types. */
  meta?: Record<string, unknown>;
  remarks?: string;
  createdAt?: unknown;
  createdBy?: string;
  createdByName?: string;
  updatedAt?: unknown;
  updatedBy?: string;
  updatedByName?: string;
}

export interface SupplyDocItem {
  id: string;
  docId: string;
  stage: SupplyLedgerStage;
  poId: string;
  poNumber: string;
  /** The PO line. Never PO number plus description — a PO may list one item twice. */
  poLineId: string;
  boqItemId?: string;
  itemDescription: string;
  unit: string;
  /** Quantity put forward. Entered when the document is raised. */
  presentedQty: number;
  /** Quantity that passed. Entered on the decision; absent until then. */
  acceptedQty?: number;
  status: SupplyItemStatus;
  /** Observations, where the stage records them (MVAC especially). */
  observations?: PunchItem[];
  serials?: string[];
  /**
   * GRN's discrepancy split, recorded alongside the rejection rather than instead of it.
   *
   * `rejectedQty` is derived (presented − accepted) and covers everything not accepted; these two
   * say *why*, which is what `computeGrnStatus` needs to mark a receipt as discrepant. Short and
   * damaged are not deducted separately — doing so would double-count against `acceptedQty`.
   */
  shortQty?: number;
  damagedQty?: number;
  remarks?: string;
}

/** A PO line at one stage, with the ceiling already resolved. */
export interface SupplyPoLine {
  poId: string;
  poNumber: string;
  poLineId: string;
  boqItemId?: string;
  itemDescription: string;
  unit: string;
  orderedQty: number;
  /** The ceiling: what the upstream stage has passed down. See `resolveUpstreamQty`. */
  upstreamQty: number;
  /** True when the BOQ item is explicitly flagged as not requiring inspection. */
  directPath?: boolean;
}

/* ── The ledger ─────────────────────────────────────────────────────────────────────────────── */

export interface SupplyLedger {
  stage: SupplyLedgerStage;
  poId: string;
  poNumber: string;
  poLineId: string;
  itemDescription: string;
  unit: string;
  orderedQty: number;
  /** The ceiling handed down by the stage above. */
  upstreamQty: number;
  /** Σ accepted quantity. This is what the next stage may present. */
  acceptedQty: number;
  /** Σ presented quantity on open, undecided items. */
  inFlightQty: number;
  /** Σ presented − accepted on decided items. Returns to the pool, so never deducted. */
  rejectedQty: number;
  /** Σ presented on Draft documents. Reported, but NOT deducted. */
  draftQty: number;
  /** upstream − accepted − inFlight. The most a new document may present. */
  availableQty: number;
  /** availableQty − draftQty, floored at zero. Advisory. */
  availableAfterDraftsQty: number;
  status: SupplyLineStatus;
  /** accepted ÷ upstream, as a percentage. */
  acceptedPct: number;
  complete: boolean;
  /** True when the upstream stage has passed nothing down — this stage cannot start. */
  awaitingUpstream: boolean;
  /** Open Critical or Major observations, which block the stage's own downstream release. */
  blockingObservationCount: number;
}

const num = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

const EPSILON = 0.0005;
const round3 = (value: number): number => Math.round(value * 1000) / 1000;

export const supplyPoLineKey = (poId: string, poLineId: string): string => `${poId}::${poLineId}`;

export const generateSupplyDocNumber = (
  stage: SupplyLedgerStage,
  docDate: string,
  docId: string,
): string =>
  `${supplyStage(stage).numberPrefix}-${docDate.replace(/-/g, "")}-${docId.slice(0, 5).toUpperCase()}`;

/**
 * The ceiling for one PO line at one stage, given every upstream stage's accepted quantity.
 *
 * `upstreamQtys` is keyed by source, so a caller assembles it once per line from the MC,
 * Inspection and earlier supply ledgers. A direct-path line takes the stage's `directUpstream`
 * where one is defined, which is what lets a box of bolts dispatch without a client certificate.
 */
export function resolveUpstreamQty(
  stage: SupplyLedgerStage,
  upstreamQtys: Partial<Record<UpstreamSource, number>>,
  options: { directPath?: boolean } = {},
): number {
  const definition = supplyStage(stage);
  const source =
    options.directPath && definition.directUpstream ? definition.directUpstream : definition.upstream;
  return Math.max(0, round3(num(upstreamQtys[source])));
}

/** Rejected quantity on a decided item. Derived, never stored. */
export function supplyRejectedQtyOf(
  item: Pick<SupplyDocItem, "presentedQty" | "acceptedQty" | "status">,
): number {
  if (item.status !== "Accepted" && item.status !== "Rejected") return 0;
  return Math.max(0, round3(num(item.presentedQty) - num(item.acceptedQty)));
}

function classifySupplyItem(
  item: Pick<SupplyDocItem, "status">,
  doc: Pick<SupplyDoc, "status">,
): "decided" | "reserved" | "draft" | "void" {
  if (VOID_DOC_STATUSES.has(doc.status)) return "void";
  if (item.status === "Cancelled") return "void";
  // Accepted and Rejected are one case: the accepted part consumes ceiling and the remainder
  // returns. A Rejected item is simply one where nothing was accepted.
  if (item.status === "Accepted" || item.status === "Rejected") return "decided";
  if (doc.status === "Draft") return "draft";
  if (RESERVING_DOC_STATUSES.has(doc.status)) return "reserved";
  // A completed document with a still-pending item shouldn't occur, but holding the quantity is
  // the safe reading — it has not been resolved.
  return "reserved";
}

export function buildSupplyLedger(
  stage: SupplyLedgerStage,
  line: SupplyPoLine,
  items: readonly SupplyDocItem[],
  docsById: ReadonlyMap<string, Pick<SupplyDoc, "status">>,
  options: { excludeDocId?: string } = {},
): SupplyLedger {
  const upstreamQty = Math.max(0, round3(num(line.upstreamQty)));
  let acceptedQty = 0;
  let inFlightQty = 0;
  let rejectedQty = 0;
  let draftQty = 0;
  let blockingObservationCount = 0;

  for (const item of items) {
    if (item.stage !== stage) continue;
    if (item.poId !== line.poId || item.poLineId !== line.poLineId) continue;
    if (options.excludeDocId && item.docId === options.excludeDocId) continue;
    const doc = docsById.get(item.docId);
    // An item whose document is missing is not counted — guessing mis-states the balance either
    // way, and both are worse than reporting only what is known.
    if (!doc) continue;

    switch (classifySupplyItem(item, doc)) {
      case "decided":
        acceptedQty += num(item.acceptedQty);
        rejectedQty += supplyRejectedQtyOf(item);
        if (hasOpenBlockingPunch(item.observations ?? [])) blockingObservationCount += 1;
        break;
      case "reserved":
        inFlightQty += num(item.presentedQty);
        break;
      case "draft":
        draftQty += num(item.presentedQty);
        break;
      default:
        break;
    }
  }

  acceptedQty = round3(acceptedQty);
  inFlightQty = round3(inFlightQty);
  rejectedQty = round3(rejectedQty);
  draftQty = round3(draftQty);

  const availableQty = Math.max(0, round3(upstreamQty - acceptedQty - inFlightQty));
  const complete = upstreamQty > 0 && acceptedQty >= upstreamQty - EPSILON;

  return {
    stage,
    poId: line.poId,
    poNumber: line.poNumber,
    poLineId: line.poLineId,
    itemDescription: line.itemDescription,
    unit: line.unit,
    orderedQty: round3(num(line.orderedQty)),
    upstreamQty,
    acceptedQty,
    inFlightQty,
    rejectedQty,
    draftQty,
    availableQty,
    availableAfterDraftsQty: Math.max(0, round3(availableQty - draftQty)),
    status: complete ? "Complete" : acceptedQty > EPSILON ? "Partial" : "Not Started",
    acceptedPct: upstreamQty > 0 ? Math.round((acceptedQty / upstreamQty) * 100) : 0,
    complete,
    awaitingUpstream: upstreamQty <= EPSILON,
    blockingObservationCount,
  };
}

export function buildSupplyLedgers(
  stage: SupplyLedgerStage,
  lines: readonly SupplyPoLine[],
  items: readonly SupplyDocItem[],
  docs: readonly Pick<SupplyDoc, "id" | "status">[],
  options: { excludeDocId?: string } = {},
): Map<string, SupplyLedger> {
  const docsById = new Map(docs.map((doc) => [doc.id, doc]));
  const out = new Map<string, SupplyLedger>();
  for (const line of lines) {
    out.set(
      supplyPoLineKey(line.poId, line.poLineId),
      buildSupplyLedger(stage, line, items, docsById, options),
    );
  }
  return out;
}

export const canPresentPoLine = (ledger: SupplyLedger): boolean =>
  !ledger.awaitingUpstream && !ledger.complete && ledger.availableQty > EPSILON;

/* ── Validation ─────────────────────────────────────────────────────────────────────────────── */

export interface QtyCheck {
  ok: boolean;
  message?: string;
}

export interface SupplyValidationError {
  itemId: string;
  message: string;
}

/** Human wording for the stage a ceiling came from, used in refusals. */
const UPSTREAM_LABELS: Record<UpstreamSource, string> = {
  mc: "Manufacturing Clearance",
  inspection: "Inspection",
  mdcc: "MDCC",
  di: "Dispatch Instruction",
  grn: "GRN",
};

export function validatePresentedQty(
  stage: SupplyLedgerStage,
  requestedQty: number,
  ledger: SupplyLedger,
  options: { directPath?: boolean } = {},
): QtyCheck {
  const definition = supplyStage(stage);
  const qty = num(requestedQty);
  if (qty <= 0) {
    return { ok: false, message: `${definition.presentedLabel} quantity must be greater than zero.` };
  }
  if (ledger.awaitingUpstream) {
    const source =
      options.directPath && definition.directUpstream
        ? definition.directUpstream
        : definition.upstream;
    return {
      ok: false,
      message: `${ledger.poNumber} · ${ledger.itemDescription} has no ${UPSTREAM_LABELS[source]} quantity yet, so nothing can go on a ${definition.docNoun}.`,
    };
  }
  if (ledger.complete) {
    return {
      ok: false,
      message: `${ledger.poNumber} · ${ledger.itemDescription} is already complete for its whole ${ledger.upstreamQty} ${ledger.unit}.`,
    };
  }
  if (qty > ledger.availableQty + EPSILON) {
    return {
      ok: false,
      message: `${definition.presentedLabel} quantity exceeds the available balance. Maximum quantity available: ${ledger.availableQty}.`,
    };
  }
  return { ok: true };
}

export function validateSupplyItems(
  stage: SupplyLedgerStage,
  items: readonly Pick<
    SupplyDocItem,
    "id" | "poId" | "poNumber" | "poLineId" | "itemDescription" | "presentedQty"
  >[],
  ledgers: ReadonlyMap<string, SupplyLedger>,
): SupplyValidationError[] {
  const definition = supplyStage(stage);
  const errors: SupplyValidationError[] = [];
  if (!items.length) {
    return [
      { itemId: "", message: `Add at least one purchase order line to this ${definition.docNoun}.` },
    ];
  }

  const seen = new Map<string, string>();
  for (const item of items) {
    const key = supplyPoLineKey(item.poId, item.poLineId);
    if (seen.get(key)) {
      errors.push({
        itemId: item.id,
        message: `${item.poNumber} · ${item.itemDescription} is on this ${definition.docNoun} twice. Combine the quantities into one line.`,
      });
    } else {
      seen.set(key, item.id);
    }

    const ledger = ledgers.get(key);
    if (!ledger) {
      errors.push({
        itemId: item.id,
        message: `${item.poNumber} · ${item.itemDescription} is no longer a line on that purchase order.`,
      });
      continue;
    }
    const check = validatePresentedQty(stage, item.presentedQty, ledger);
    if (!check.ok) errors.push({ itemId: item.id, message: check.message! });
  }
  return errors;
}

/**
 * Whether a decision is coherent.
 *
 * A stage that does not split must accept exactly what was presented — a dispatch instruction for
 * 40 tonnes is not "half dispatched", it is amended or cancelled.
 */
export function validateSupplyDecision(
  stage: SupplyLedgerStage,
  presentedQty: number,
  acceptedQty: number,
): QtyCheck {
  const definition = supplyStage(stage);
  const presented = num(presentedQty);
  const accepted = num(acceptedQty);

  if (accepted < 0) {
    return { ok: false, message: `${definition.acceptedLabel} quantity cannot be negative.` };
  }
  if (accepted > presented + EPSILON) {
    return {
      ok: false,
      message: `${definition.acceptedLabel} quantity cannot exceed the ${presented} ${definition.presentedLabel.toLowerCase()}.`,
    };
  }
  if (!definition.splitsOnDecision && Math.abs(accepted - presented) > EPSILON) {
    return {
      ok: false,
      message: `A ${definition.docNoun} is accepted in full or not at all. Amend the quantity instead of accepting ${accepted} of ${presented}.`,
    };
  }
  return { ok: true };
}

export function supplyItemStatusFor(acceptedQty: number): SupplyItemStatus {
  return num(acceptedQty) <= EPSILON ? "Rejected" : "Accepted";
}

/* ── Document status ────────────────────────────────────────────────────────────────────────── */

export function deriveSupplyDocStatus(
  items: readonly Pick<SupplyDocItem, "status">[],
  current: SupplyDocStatus,
): SupplyDocStatus {
  if (current === "Draft" || VOID_DOC_STATUSES.has(current)) return current;
  if (!items.length) return current;

  const live = items.filter((item) => item.status !== "Cancelled");
  if (!live.length) return "Cancelled";

  const decided = live.filter((item) => item.status !== "Pending");
  if (decided.length === 0) return "Open";
  if (decided.length === live.length) return "Completed";
  return "Partially Completed";
}

/* ── Per-item view figures ──────────────────────────────────────────────────────────────────── */

export interface SupplyItemView {
  poNumber: string;
  itemDescription: string;
  unit: string;
  upstreamQty: number;
  previouslyAcceptedQty: number;
  presentedQty: number;
  acceptedQty: number;
  rejectedQty: number;
  cumulativeAcceptedQty: number;
  balanceQty: number;
}

/** The ledger must have been built with `excludeDocId` set to this document. */
export function buildSupplyItemView(
  item: SupplyDocItem,
  ledger: SupplyLedger,
): SupplyItemView {
  const presentedQty = round3(num(item.presentedQty));
  const acceptedQty = round3(num(item.acceptedQty));
  const previouslyAcceptedQty = ledger.acceptedQty;
  const cumulativeAcceptedQty = round3(previouslyAcceptedQty + acceptedQty);
  return {
    poNumber: ledger.poNumber,
    itemDescription: ledger.itemDescription,
    unit: ledger.unit,
    upstreamQty: ledger.upstreamQty,
    previouslyAcceptedQty,
    presentedQty,
    acceptedQty,
    rejectedQty: supplyRejectedQtyOf(item),
    cumulativeAcceptedQty,
    balanceQty: Math.max(0, round3(ledger.upstreamQty - cumulativeAcceptedQty)),
  };
}

/* ── Concurrency guard ──────────────────────────────────────────────────────────────────────── */

export interface SupplyPoLineBalance {
  poId: string;
  poLineId: string;
  poNumber: string;
  upstreamQty: number;
  acceptedQty: number;
  inFlightQty: number;
  updatedAt?: unknown;
}

export function rebuildSupplyPoLineBalance(ledger: SupplyLedger): SupplyPoLineBalance {
  return {
    poId: ledger.poId,
    poLineId: ledger.poLineId,
    poNumber: ledger.poNumber,
    upstreamQty: ledger.upstreamQty,
    acceptedQty: ledger.acceptedQty,
    inFlightQty: ledger.inFlightQty,
  };
}

/**
 * The atomic check, run inside the transaction against the guard document.
 *
 * `balance` is null when no guard exists yet — the first document against that line — in which
 * case the whole upstream quantity is free.
 */
export function checkSupplyBalance(
  stage: SupplyLedgerStage,
  requestedQty: number,
  upstreamQty: number,
  balance: SupplyPoLineBalance | null,
): QtyCheck {
  const definition = supplyStage(stage);
  const accepted = balance ? num(balance.acceptedQty) : 0;
  const inFlight = balance ? num(balance.inFlightQty) : 0;
  const available = Math.max(0, round3(upstreamQty - accepted - inFlight));
  const qty = num(requestedQty);

  if (qty <= 0) {
    return { ok: false, message: `${definition.presentedLabel} quantity must be greater than zero.` };
  }
  if (upstreamQty <= EPSILON) {
    return {
      ok: false,
      message: `No ${UPSTREAM_LABELS[definition.upstream]} quantity remains for this line, so nothing can go on a ${definition.docNoun}.`,
    };
  }
  if (qty > available + EPSILON) {
    return {
      ok: false,
      message: `${definition.presentedLabel} quantity exceeds the available balance. Maximum quantity available: ${available}.`,
    };
  }
  return { ok: true };
}

/* ── Register roll-ups ──────────────────────────────────────────────────────────────────────── */

export interface SupplyRegisterRow {
  docId: string;
  docNumber: string;
  stage: SupplyLedgerStage;
  vendorName: string;
  counterparty?: string;
  status: SupplyDocStatus;
  docDate: string;
  decidedDate?: string;
  poCount: number;
  itemCount: number;
  presentedQty: number;
  acceptedQty: number;
  rejectedQty: number;
  blockingObservationCount: number;
}

export function buildSupplyRegisterRows(
  docs: readonly SupplyDoc[],
  items: readonly SupplyDocItem[],
): SupplyRegisterRow[] {
  const byDoc = new Map<string, SupplyDocItem[]>();
  for (const item of items) {
    const list = byDoc.get(item.docId) ?? [];
    list.push(item);
    byDoc.set(item.docId, list);
  }

  return docs.map((doc) => {
    const own = byDoc.get(doc.id) ?? [];
    const live = own.filter((item) => item.status !== "Cancelled");
    return {
      docId: doc.id,
      docNumber: doc.docNumber,
      stage: doc.stage,
      vendorName: doc.vendorName ?? "",
      counterparty: doc.counterparty,
      status: doc.status,
      docDate: doc.docDate,
      decidedDate: doc.decidedDate,
      poCount: new Set(live.map((item) => item.poId)).size,
      itemCount: live.length,
      presentedQty: round3(live.reduce((sum, item) => sum + num(item.presentedQty), 0)),
      acceptedQty: round3(live.reduce((sum, item) => sum + num(item.acceptedQty), 0)),
      rejectedQty: round3(live.reduce((sum, item) => sum + supplyRejectedQtyOf(item), 0)),
      blockingObservationCount: live.filter((item) =>
        hasOpenBlockingPunch(item.observations ?? []),
      ).length,
    };
  });
}

/**
 * Whether an MVAC line may release billing.
 *
 * MVAC is the billing trigger, so this is the last quantity check before money. It reuses
 * `hasOpenBlockingPunch` — the same Critical/Major bar MDCC applies — because an observation
 * serious enough to block a clearance is serious enough to block an invoice.
 */
export function canReleaseBillingForItem(
  item: Pick<SupplyDocItem, "stage" | "status" | "acceptedQty" | "observations">,
): boolean {
  if (item.stage !== "mvac") return false;
  if (item.status !== "Accepted") return false;
  if (num(item.acceptedQty) <= EPSILON) return false;
  return !hasOpenBlockingPunch(item.observations ?? []);
}

export const supplyDocStatusStyles: Record<SupplyDocStatus, string> = {
  Draft: "bg-muted text-muted-foreground",
  Open: "bg-blue-100 text-blue-700",
  "Partially Completed": "bg-amber-100 text-amber-800",
  Completed: "bg-emerald-100 text-emerald-700",
  Cancelled: "bg-slate-200 text-slate-700",
};

export const supplyItemStatusStyles: Record<SupplyItemStatus, string> = {
  Pending: "bg-blue-100 text-blue-700",
  Accepted: "bg-emerald-100 text-emerald-700",
  Rejected: "bg-red-100 text-red-700",
  Cancelled: "bg-slate-200 text-slate-700",
};

export const supplyLineStatusStyles: Record<SupplyLineStatus, string> = {
  "Not Started": "bg-muted text-muted-foreground",
  Partial: "bg-amber-100 text-amber-800",
  Complete: "bg-emerald-100 text-emerald-700",
};

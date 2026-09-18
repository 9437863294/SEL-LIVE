/**
 * The contract between E-Approval and a module whose own workflow it mirrors.
 *
 * Deliberately dependency-free — no Firestore SDK, no React, no import of either module — so both
 * sides can describe the link without importing each other. E-Approval must not learn what a payment
 * obligation is, and Recurring Payments must not pull in the approval engine to render a badge; a
 * third module wiring itself up later adds one entry to `E_APPROVAL_SOURCE_MODULES` and nothing else
 * moves.
 *
 * The shape it describes is a *mirror*, not a hand-off. Both sides stay live and either may act:
 *
 *   - Every stage of the source workflow gets a stage in the approval chain, in the same order, with
 *     the same people on it. One approval request per record, not one per step — "who is this with?"
 *     has a single answer, and the trail reads as one file rather than five.
 *   - Whichever side acts first wins, and the other is brought into line by a reconcile that is
 *     idempotent and safe to run from anywhere (see `syncMirroredEApproval`). There is no lock and no
 *     "authoritative side" flag, because both of those turn a lag into a deadlock.
 *   - A stage the source module cannot delegate — one whose completion needs data only its own form
 *     can collect, a bill number or a UTR — is marked `'Visibility'`. It still appears in E-Approval
 *     with everything the approver needs to read, and it still notifies them; it just links back to
 *     the source form to be completed rather than offering an Approve button that could not honour
 *     the source module's own validation.
 */

/* ------------------------------------------------------------------------------------------------
 * Source modules
 * ---------------------------------------------------------------------------------------------- */

export const E_APPROVAL_SOURCE_MODULES = ['Recurring Payments'] as const;

export type EApprovalSourceModule = (typeof E_APPROVAL_SOURCE_MODULES)[number];

/**
 * How the mirrored stage behaves in E-Approval.
 *
 * 'Decision'   — the approver may Approve / Reject / Return here, and the source module follows.
 * 'Visibility' — the task is shown and notified here, but completed on the source module's own form.
 */
export type EApprovalMirrorMode = 'Decision' | 'Visibility';

/**
 * The pointer an approval request carries back to the record it mirrors.
 *
 * Denormalised on purpose: `recordLabel` and `recordPath` are written at link time so an E-Approval
 * screen can render the source chip and its link without reading a collection it knows nothing
 * about. They are refreshed on every sync, so a renamed payment does not leave a stale label.
 */
export interface EApprovalSourceLink {
  module: EApprovalSourceModule;
  /** Document id in the source module's own collection. */
  recordId: string;
  /** Human reference — the payment title, an obligation number. Shown on the chip. */
  recordLabel?: string;
  /** In-app route to the source record, so the chip is clickable. */
  recordPath?: string;
  /** Which stage of the source workflow the request is currently mirroring. */
  stepId?: string;
  stepName?: string;
  /** Mode of the *current* stage. Recomputed on each sync as the chain moves. */
  mirrorMode?: EApprovalMirrorMode;
  /** Set once the mirror is broken — by an unlink, or by the approval being cancelled. */
  detachedAt?: string;
  detachedReason?: string;
}

/* ------------------------------------------------------------------------------------------------
 * Sync planning
 * ---------------------------------------------------------------------------------------------- */

/**
 * Where each side currently stands, expressed as a position in the shared stage list.
 *
 * Both sides are reduced to one integer before anything is compared. The two workflows have
 * different vocabularies — one has `currentStepId` plus an approval level, the other has active step
 * records — and comparing them field by field is how a sync ends up with a branch for every pair.
 * `-1` means "not on the chain": finished, rejected, or not started.
 */
export interface EApprovalMirrorPosition {
  /** Index into the ordered stage list, or -1. */
  index: number;
  /** True once the side has reached a terminal state rather than simply run out of stages. */
  closed: boolean;
  /** Terminal outcome, when `closed`. */
  outcome?: 'Approved' | 'Rejected' | 'Cancelled';
  /**
   * Whether this side arrived at `index` by going *backwards* — somebody returned the file.
   *
   * Stated by the caller rather than inferred from the indices, because the two cases are
   * indistinguishable from position alone: an approval chain that has not started sits at stage 0
   * while the payment is at stage 2, and so does one that was just sent back from stage 2 to stage 0.
   * Reading the first as a return would send a perfectly good payment back two steps every time a
   * mirror was created late.
   */
  returned?: boolean;
}

export type EApprovalMirrorAction =
  /** Nothing to do — the two sides agree. */
  | { kind: 'In Sync' }
  /** E-Approval has moved ahead: apply `steps` decisions in the source module, oldest first. */
  | { kind: 'Advance Source'; steps: Array<{ stepId: string; action: string; level?: number }> }
  /**
   * The source module has moved ahead: complete these approval stages to catch up, oldest first.
   *
   * Grouped by stage rather than a flat list of step ids, because a stage can hold several people —
   * a primary and their backup — of whom exactly one needs to act. The caller has to choose which,
   * and can only do that if it knows which ids belong together.
   */
  | { kind: 'Advance Approval'; stages: Array<{ stepId: string; approvalStepIds: string[] }> }
  /** One side returned the file; put the other back to `index`. */
  | { kind: 'Return Source'; stepId: string }
  /** A terminal state on one side that the other has not reached. */
  | { kind: 'Close Source'; outcome: 'Approved' | 'Rejected' | 'Cancelled' }
  | { kind: 'Close Approval'; outcome: 'Approved' | 'Rejected' | 'Cancelled' };

/**
 * Decides what has to happen to bring the two sides back into agreement.
 *
 * Pure, and the only place the reconciliation rules live: the service around it does Firestore reads
 * and writes and no thinking. That split is what makes "an approver approved while the accountant was
 * submitting the bill" a case with a test rather than a case somebody hopes about.
 *
 * Precedence when both sides have moved:
 *
 *   1. **A close beats a move.** If either side has rejected or cancelled, that is applied to the
 *      other and nothing else is; a rejection that races an approval must not be half-applied.
 *   2. **A return beats an advance.** A return is somebody saying "this is wrong"; letting a
 *      simultaneous approval carry the file forward past it loses the objection.
 *   3. **Otherwise the further-ahead side wins**, and the other is walked forward to meet it. Walked
 *      rather than jumped, so every intermediate stage gets its own completion in the trail — the
 *      record has to show each stage was passed, not that the file teleported.
 */
export function planEApprovalMirrorSync(
  source: EApprovalMirrorPosition,
  approval: EApprovalMirrorPosition,
  stages: Array<{ stepId: string; action: string; level?: number; approvalStepIds: string[] }>,
): EApprovalMirrorAction {
  // 1. Closes first, in severity order — a cancellation of the mirror is not a decision about the
  //    work, so it never propagates as one.
  if (approval.closed && !source.closed) {
    return { kind: 'Close Source', outcome: approval.outcome ?? 'Approved' };
  }
  if (source.closed && !approval.closed) {
    return { kind: 'Close Approval', outcome: source.outcome ?? 'Approved' };
  }
  if (source.closed && approval.closed) return { kind: 'In Sync' };

  if (source.index === approval.index) return { kind: 'In Sync' };

  // 2. A return: the approval side says it went backwards, and it is behind. The payment follows it
  //    back, because "this is wrong, fix it" must not be overtaken by an approval given in parallel.
  //    (Only this direction. A return raised in the source module moves the payment itself, and the
  //    approval chain catching up to it is an ordinary advance from the chain's point of view.)
  if (approval.returned && approval.index >= 0 && approval.index < source.index && stages[approval.index]) {
    return { kind: 'Return Source', stepId: stages[approval.index].stepId };
  }

  // 3. Walk the laggard forward.
  if (approval.index > source.index) {
    const steps = stages
      .slice(Math.max(0, source.index), approval.index)
      .map((stage) => ({ stepId: stage.stepId, action: stage.action, level: stage.level }));
    return steps.length ? { kind: 'Advance Source', steps } : { kind: 'In Sync' };
  }
  const behind = stages
    .slice(Math.max(0, approval.index), source.index)
    .filter((stage) => stage.approvalStepIds.length)
    .map((stage) => ({ stepId: stage.stepId, approvalStepIds: stage.approvalStepIds }));
  return behind.length ? { kind: 'Advance Approval', stages: behind } : { kind: 'In Sync' };
}

/* ------------------------------------------------------------------------------------------------
 * Presentation
 * ---------------------------------------------------------------------------------------------- */

/** "Recurring Payments · Office Rent — Aug 2026", for the chip on an approval row. */
export function describeEApprovalSource(link: EApprovalSourceLink | null | undefined): string {
  if (!link) return '';
  return link.recordLabel ? `${link.module} · ${link.recordLabel}` : link.module;
}

/** Whether a request is a live mirror — linked, and not detached. */
export function isMirroredEApproval(link: EApprovalSourceLink | null | undefined): boolean {
  return Boolean(link?.recordId && !link.detachedAt);
}

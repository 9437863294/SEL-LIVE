/**
 * Planning a project's Billing Recon data separation — what gets copied out of the shared project
 * register into Billing Recon's own collections, and what (if anything) is removed from the
 * project register afterwards. The Firestore reads and writes live in the Data Separation page;
 * this file only decides, so the rules stay unit-testable (tests/billing-recon-register.test.mjs).
 *
 * The rules:
 *  - **BOQ** — every item is copied with its document id, so anything referencing an item by id or
 *    by Sl. No. still resolves. The project register keeps its BOQ; Project Management, Store &
 *    Stock and Subcontractors all depend on it.
 *  - **JMC** — the register is genuinely mixed (Billing Recon, Project Management and
 *    Subcontractors all wrote to it, and nothing on a document says which), so the person
 *    separating chooses which entries are Billing Recon's. Chosen entries are copied with their ids.
 *    Optionally they are then removed from the project register, *except* entries a subcontractor
 *    bill or proforma bill still points at — deleting those would break the bill.
 *  - **MVAC** — only Billing Recon ever wrote `mvacEntries`, so every entry is copied.
 *  - **Serial numbers** — the project's JMC counters are copied to `projectJmcSerialConfigs` so
 *    Project Management carries on from the shared counter; Billing Recon keeps the originals.
 *  - Anything already present in the destination (a re-run after a failed attempt) is skipped,
 *    never overwritten — Billing Recon may have edited it since.
 */

export interface SeparationInput {
  boqIds: string[];
  existingBillingReconBoqIds: string[];
  jmcIds: string[];
  /** JMC entries the person ticked as Billing Recon's. */
  selectedJmcIds: string[];
  existingBillingReconJmcIds: string[];
  mvacIds: string[];
  existingBillingReconMvacIds: string[];
  /** This project's ids in `billingReconSerialConfigs`. */
  serialConfigIds: string[];
  existingProjectSerialConfigIds: string[];
  /** Whether the copied JMC entries are then removed from the project register. */
  removeCopiedJmcFromProjectRegister: boolean;
  /** JMC ids a subcontractor bill or proforma bill references; never removed. */
  referencedJmcIds: string[];
}

export interface SeparationPlan {
  boqToCopy: string[];
  boqAlreadyCopied: number;
  jmcToCopy: string[];
  jmcAlreadyCopied: number;
  /** Copied (now or earlier) and safe to remove from the project register. */
  jmcToRemoveFromProjectRegister: string[];
  /** Chosen for removal but kept, because a subcontractor bill points at them. */
  jmcKeptBecauseReferenced: string[];
  mvacToCopy: string[];
  mvacAlreadyCopied: number;
  serialConfigsToCopy: string[];
  /** Total document writes, for the progress bar. */
  totalWrites: number;
}

const unique = (ids: string[]) => [...new Set(ids.filter((id) => typeof id === 'string' && id.length > 0))];

function split(ids: string[], existing: string[]) {
  const have = new Set(existing);
  const all = unique(ids);
  return { toCopy: all.filter((id) => !have.has(id)), already: all.filter((id) => have.has(id)).length };
}

export function planSeparation(input: SeparationInput): SeparationPlan {
  const boq = split(input.boqIds, input.existingBillingReconBoqIds);

  // Only ids that really are in the register can be chosen.
  const known = new Set(input.jmcIds);
  const selected = unique(input.selectedJmcIds).filter((id) => known.has(id));
  const jmc = split(selected, input.existingBillingReconJmcIds);

  const referenced = new Set(input.referencedJmcIds);
  const removable = input.removeCopiedJmcFromProjectRegister ? selected : [];
  const jmcToRemoveFromProjectRegister = removable.filter((id) => !referenced.has(id));
  const jmcKeptBecauseReferenced = removable.filter((id) => referenced.has(id));

  const mvac = split(input.mvacIds, input.existingBillingReconMvacIds);
  const serials = split(input.serialConfigIds, input.existingProjectSerialConfigIds);

  return {
    boqToCopy: boq.toCopy,
    boqAlreadyCopied: boq.already,
    jmcToCopy: jmc.toCopy,
    jmcAlreadyCopied: jmc.already,
    jmcToRemoveFromProjectRegister,
    jmcKeptBecauseReferenced,
    mvacToCopy: mvac.toCopy,
    mvacAlreadyCopied: mvac.already,
    serialConfigsToCopy: serials.toCopy,
    totalWrites:
      boq.toCopy.length +
      jmc.toCopy.length +
      jmcToRemoveFromProjectRegister.length +
      mvac.toCopy.length +
      serials.toCopy.length,
  };
}

/** JMC ids named by subcontractor bill / proforma bill line items (`items[].jmcEntryId`). */
export function referencedJmcIds(bills: Array<{ items?: unknown }>): string[] {
  const ids = new Set<string>();
  for (const bill of bills) {
    if (!Array.isArray(bill.items)) continue;
    for (const item of bill.items) {
      const id = (item as { jmcEntryId?: unknown } | null)?.jmcEntryId;
      if (typeof id === 'string' && id) ids.add(id);
    }
  }
  return [...ids];
}

/** Splits a list into Firestore-batch-sized chunks (a batch holds at most 500 writes). */
export function chunk<T>(items: T[], size = 400): T[][] {
  const out: T[][] = [];
  const step = Math.max(1, Math.floor(size));
  for (let i = 0; i < items.length; i += step) out.push(items.slice(i, i + step));
  return out;
}

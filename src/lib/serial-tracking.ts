/**
 * Shared serial-number infrastructure for the supply gate chain (see src/lib/supply-gates.ts).
 *
 * Serials are captured as a simple string list on each stage's own gate record — Inspection's
 * accepted-unit serials, the DI's dispatch serials, GRN's received serials, MVAC's verified
 * serials — rather than as a separate per-unit lifecycle collection. That keeps the existing
 * one-doc-per-boqItemId gate records as the single source of truth (qty fields already live
 * there) and adds serial identity as one more field per stage, not a parallel system to keep in
 * sync.
 *
 * The chain invariant the specs call out repeatedly — verified ⊆ received ⊆ dispatched ⊆
 * inspected — is enforced the same way at every stage via computeSerialSubsetCheck(), and only
 * when the upstream stage actually recorded serials: an item with no serial tracking (sold by
 * length, bulk hardware, etc.) shouldn't be forced to invent serials just to pass a downstream
 * gate.
 */

/** Splits free-text serial entry (comma, newline, or space separated) into a clean, deduplicated,
 * order-preserving list. Free text rather than a repeatable-row editor because real consignments
 * can run to dozens or hundreds of units — pasting a list is how this is actually done. */
export function parseSerialList(text: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of text.split(/[,\n\r\t]+/)) {
    const value = raw.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

/** Joins a serial list back into editable free text, one per line. */
export const formatSerialList = (serials: string[] = []): string => serials.join("\n");

export interface SerialSubsetCheck {
  valid: boolean;
  /** Entries in `subset` that don't appear in `superset` — the actual exception list. */
  extra: string[];
}

/** Whether every serial in `subset` also appears in `superset` (case/whitespace-insensitive).
 * Returns valid: true whenever `superset` is empty — an upstream stage that never recorded
 * serials for this item imposes no constraint downstream. */
export function computeSerialSubsetCheck(subset: string[], superset: string[]): SerialSubsetCheck {
  if (!superset.length) return { valid: true, extra: [] };
  const supersetKeys = new Set(superset.map((s) => s.trim().toLowerCase()));
  const extra = subset.filter((s) => !supersetKeys.has(s.trim().toLowerCase()));
  return { valid: extra.length === 0, extra };
}

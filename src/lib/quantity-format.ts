/**
 * Reading and writing quantities, in one place.
 *
 * `toNumber` and `formatQuantity` had three byte-identical copies — `purchase-orders.ts`,
 * `rfq.ts` and `vendor-management.ts` — and every supply screen imported whichever one its
 * neighbour happened to import. Three copies of a parser is three chances for "1,250" to be read
 * as 1250 in one register and 1 in another, so they live here and those modules re-export them
 * under the names their callers already use.
 *
 * Pure — no Firebase, no React.
 */

/**
 * A quantity or a rate as it is actually stored: a number, or a string that has been through a
 * spreadsheet. Grouping commas are stripped; anything that is not a finite number reads as 0,
 * because a register that shows NaN is worse than one that shows nothing.
 */
export const toNumber = (value: unknown): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

/** "1,250", "1,250.5" — Indian grouping, three decimals at most. */
export const formatQuantity = (value: number) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(value);

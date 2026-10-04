/**
 * Money arithmetic for Bill Tracking.
 *
 * Amounts are stored as rupees with at most two decimals (the legacy sheet carries paise on taxable
 * values such as 1688145.42). Adding those as floats drifts — 0.1 + 0.2 — and a register that
 * sums 1,000 bills would show a ₹0.0000001 "outstanding" on a fully paid book. Every sum here goes
 * through integer paise and comes back rounded to the paisa, so totals compare exactly.
 *
 * Signs are never touched: credit notes, reversals and the legacy negative deductions all keep the
 * sign they were entered with.
 */

export const toPaise = (rupees: number | null | undefined): number => {
  const value = Number(rupees ?? 0);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100);
};

export const fromPaise = (paise: number): number => paise / 100;

/** Rounds to the paisa. `-0` is normalised so it never renders as "-₹0". */
export const roundMoney = (rupees: number | null | undefined): number => {
  const value = fromPaise(toPaise(rupees));
  return Object.is(value, -0) ? 0 : value;
};

export const sumMoney = (values: readonly (number | null | undefined)[]): number =>
  roundMoney(fromPaise(values.reduce<number>((total, value) => total + toPaise(value), 0)));

export const sumBy = <T>(items: readonly T[], pick: (item: T) => number | null | undefined): number =>
  sumMoney(items.map(pick));

export const subtractMoney = (a: number | null | undefined, b: number | null | undefined): number =>
  roundMoney(fromPaise(toPaise(a) - toPaise(b)));

/** True when the two amounts are within `tolerance` rupees of each other. */
export const withinTolerance = (a: number, b: number, tolerance: number): boolean =>
  Math.abs(toPaise(a) - toPaise(b)) <= toPaise(Math.abs(tolerance));

/* ── display ─────────────────────────────────────────────────────────────── */

const fullFormatter = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
const fullFormatterPaise = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 });

/** `₹1,25,00,000` — Indian digit grouping, paise shown only when present. */
export const formatINR = (rupees: number | null | undefined, options: { paise?: boolean } = {}): string => {
  const value = roundMoney(rupees);
  const formatter = options.paise || !Number.isInteger(value) ? fullFormatterPaise : fullFormatter;
  const text = formatter.format(Math.abs(value));
  return `${value < 0 ? '-' : ''}₹${text}`;
};

/**
 * `₹12.43 Cr`, `₹76.25 L`, `₹85,430` — the dashboard format. Below a lakh the full figure is short
 * enough to show as is; the full value always goes in the element's `title`.
 */
export const formatINRCompact = (rupees: number | null | undefined): string => {
  const value = roundMoney(rupees);
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1e7) return `${sign}₹${trim(abs / 1e7)} Cr`;
  if (abs >= 1e5) return `${sign}₹${trim(abs / 1e5)} L`;
  return `${sign}₹${fullFormatter.format(Math.round(abs))}`;
};

const trim = (value: number): string => value.toFixed(2).replace(/\.?0+$/, '');

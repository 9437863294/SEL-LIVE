/**
 * The plain `YYYY-MM-DD` dates the Project Management registers store, read and written in one
 * place.
 *
 * `today()` and `formatDate()` had a copy in every screen that has a date field — a dozen in
 * Project Management alone, all identical. They are one-liners, which is exactly why they drifted
 * unnoticed: a register that renders "02 Nov 2026" beside one that renders "11/2/2026" is a
 * difference nobody files a bug about and everybody reads twice.
 *
 * Why a date-only string and not a Date: these fields are calendar days chosen by a person — a
 * GRN date, a dispatch date — not instants. Parsing them at local midnight (`T00:00:00`) keeps
 * them on the day that was typed, whatever the machine's timezone.
 *
 * Pure — no Firebase, no React.
 */

/** Today as the forms store it: `YYYY-MM-DD` in the machine's own timezone. */
export const todayIso = (): string => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
};

/**
 * "02 Nov 2026" — how every Project Management register prints a stored date.
 *
 * An empty value reads as "—"; anything unparseable is returned as it was stored, because showing
 * the raw value is more useful than showing "Invalid Date" when a record holds something odd.
 */
export const formatIsoDate = (value?: string): string => {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

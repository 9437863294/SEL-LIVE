/**
 * Daily Progress — what the Projection list should flag, from the projections on screen and the
 * BOQ lines they belong to. Real findings only, worst first:
 *
 *  - **danger** — a projection asks for more than its BOQ line's whole quantity (a typo, most often:
 *    50 Nos against a BOQ of 2);
 *  - **warning** — the latest revision moved the quantity, so the period's target is not the one
 *    first agreed;
 *  - **info** — a scope has BOQ lines but none of them is projected at all.
 *
 * Quantities are only ever compared within one line, at that line's unit precision; nothing here
 * adds quantities of different lines.
 *
 * Pure — no Firebase, no React — so it is tested with `node --experimental-strip-types --test`.
 */

import { dprNumber, type DprScope, type DprTarget } from "./project-management-dpr.ts";

export type DprProjectionCheckTone = "danger" | "warning" | "success" | "info";

export interface DprProjectionCheck {
  key: string;
  tone: DprProjectionCheckTone;
  /** Short text for the finding's chip: the SL No, or the revision ("R1"). */
  mark: string;
  title: string;
  detail: string;
  /** The projections it is about. */
  ids: string[];
}

export interface DprProjectionCheckLine {
  boqSlNo: string;
  unit: string;
  boqQty: number;
  scope: DprScope;
}

export interface DprProjectionCheckContext {
  /** The BOQ lines projections are set against, by id. */
  items: ReadonlyMap<string, DprProjectionCheckLine>;
  /** The scope shown. Coverage across scopes is only judged when every scope is shown. */
  scope: DprScope | "All";
  decimalsFor: (unit: string) => number;
  /** Working days in a projection's period, by the project calendar. */
  workingDays: (target: DprTarget) => number;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const PERIOD_WORD: Record<string, string> = { Day: "day's", Week: "week's", Month: "month's", Custom: "period's" };

/** At most this many findings of one kind are listed; the rest are summed into one. */
const PER_KIND = 3;
const CAP = 6;

const qtyText = (value: number, decimals: number): string =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: decimals }).format(
    Math.round(value * 10 ** decimals) / 10 ** decimals,
  );

const listSlNos = (slNos: readonly string[]): string =>
  slNos.length <= 3 ? slNos.join(", ") : `${slNos.slice(0, 3).join(", ")} and ${slNos.length - 3} more`;

export function buildDprProjectionChecks(
  targets: readonly DprTarget[],
  context: DprProjectionCheckContext,
): DprProjectionCheck[] {
  const { items, scope, decimalsFor, workingDays } = context;
  const checks: DprProjectionCheck[] = [];
  const lineOf = (target: DprTarget) => items.get(target.boqItemId);
  const slNoOf = (target: DprTarget) => lineOf(target)?.boqSlNo || target.boqSlNo || "—";
  const unitOf = (target: DprTarget) => lineOf(target)?.unit || target.unit || "";

  // (a) Projected above the BOQ quantity — the further above, the likelier a typo.
  const above = targets
    .map((target) => ({ target, qty: dprNumber(target.plannedQty), boqQty: dprNumber(lineOf(target)?.boqQty) }))
    .filter(({ qty, boqQty }) => boqQty > 0 && qty > boqQty + 1e-9)
    .sort((a, b) => b.qty / b.boqQty - a.qty / a.boqQty);
  for (const { target, qty, boqQty } of above.slice(0, PER_KIND)) {
    const unit = unitOf(target);
    const decimals = decimalsFor(unit);
    const slNo = slNoOf(target);
    checks.push({
      key: `above-boq-${target.id}`,
      tone: "danger",
      mark: slNo,
      title: `${qtyText(qty, decimals)} ${unit} projected for item ${slNo}`.replace(/\s+/g, " "),
      detail: `The BOQ quantity for this line is ${qtyText(boqQty, decimals)} ${unit} — please check whether ${qtyText(qty, decimals)} is correct.`.replace(/\s+/g, " "),
      ids: [target.id],
    });
  }
  if (above.length > PER_KIND) {
    const rest = above.slice(PER_KIND);
    checks.push({
      key: "above-boq-more",
      tone: "danger",
      mark: `+${rest.length}`,
      title: `${rest.length} more projection${rest.length === 1 ? " is" : "s are"} above the BOQ quantity`,
      detail: `Items ${listSlNos(rest.map(({ target }) => slNoOf(target)))}.`,
      ids: rest.map(({ target }) => target.id),
    });
  }

  // (b) The latest revision moved the quantity.
  const revised = targets
    .filter((target) => (target.revisionNo ?? 0) > 0)
    .map((target) => {
      const history = [...(target.revisions ?? [])].sort((a, b) => a.revisionNo - b.revisionNo);
      const last = history[history.length - 1];
      const from = last ? dprNumber(last.fromQty) : dprNumber(target.baselineQty ?? target.plannedQty);
      const to = last ? dprNumber(last.toQty) : dprNumber(target.plannedQty);
      return { target, from, to, revisionNo: last?.revisionNo ?? target.revisionNo ?? 0 };
    })
    .filter(({ from, to }) => Math.abs(from - to) > 1e-9)
    // The largest change, relative to where it started, first.
    .sort((a, b) => Math.abs(b.to - b.from) / Math.max(b.from, 1e-9) - Math.abs(a.to - a.from) / Math.max(a.from, 1e-9));
  for (const { target, from, to, revisionNo } of revised.slice(0, PER_KIND)) {
    const unit = unitOf(target);
    const decimals = decimalsFor(unit);
    const days = workingDays(target);
    const perDay = days > 0 ? `; per day is now ${qtyText(to / days, 3)} ${unit}` : "";
    const lowered = to < from;
    checks.push({
      key: `revised-${target.id}`,
      tone: "warning",
      mark: `R${revisionNo}`,
      title: `Item ${slNoOf(target)} ${lowered ? "cut" : "raised"} from ${qtyText(from, decimals)} to ${qtyText(to, decimals)} ${unit}`.trim(),
      detail: `Revision R${revisionNo} ${lowered ? "lowered" : "raised"} the ${PERIOD_WORD[target.periodType] ?? "period's"} target${perDay}.`.replace(/\s+\./, "."),
      ids: [target.id],
    });
  }
  if (revised.length > PER_KIND) {
    const rest = revised.slice(PER_KIND);
    checks.push({
      key: "revised-more",
      tone: "warning",
      mark: `+${rest.length}`,
      title: `${rest.length} more projection${rest.length === 1 ? " was" : "s were"} revised`,
      detail: `Items ${listSlNos(rest.map(({ target }) => slNoOf(target)))}.`,
      ids: rest.map(({ target }) => target.id),
    });
  }

  // (c) A scope with BOQ lines and no projection at all — judged only when every scope is shown.
  if (scope === "All" && targets.length > 0) {
    const projected = new Set(targets.map((target) => target.scope));
    const withLines = new Set([...items.values()].map((line) => line.scope));
    const missing = [...withLines].filter((candidate) => !projected.has(candidate)).sort();
    if (missing.length > 0) {
      const months = new Set(targets.flatMap((target) => [target.startDate.slice(0, 7), target.endDate.slice(0, 7)]));
      const only = [...months];
      const when =
        only.length === 1 && /^\d{4}-\d{2}$/.test(only[0])
          ? MONTHS[Number(only[0].slice(5, 7)) - 1]
          : "these periods";
      const present = [...projected].sort();
      checks.push({
        key: "scope-coverage",
        tone: "info",
        mark: "i",
        title: present.length === 1 ? `Only ${present[0]} lines are projected` : `${missing.join(" and ")} lines are not projected`,
        detail: `No ${missing.join(" or ")} projection exists for ${when} yet.`,
        ids: [],
      });
    }
  }

  return checks.slice(0, CAP);
}

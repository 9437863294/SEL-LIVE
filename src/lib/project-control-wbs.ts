/**
 * Control accounts — the management reporting level above the BOQ.
 *
 * Project Management treats the BOQ item as the atomic unit of the project, and that is correct:
 * every register, every gate and every quantity check keys off `boqItemId`. But a BOQ can run to
 * thousands of lines, and no manager reviews a project line by line. They review it by
 * Engineering / Supply / Civil / Erection, or by section, or by contract package.
 *
 * The temptation is to build a second WBS with its own items and its own quantities. That would be
 * a mistake — two structures holding the same numbers is two structures that disagree by the next
 * reporting cycle, which is the whole reason this module reads registers rather than copying them.
 *
 * So a control account owns **no quantities and no values of its own**. It is a *grouping*, and
 * membership is decided by rules over dimensions the BOQ already carries (Scope 1/2, Category
 * 1–3), with explicit include/exclude lists for the lines that do not fit any rule. Every number
 * shown against an account is the sum of its BOQ lines, computed at read time.
 *
 * The invariant worth knowing before changing anything here: **every non-header BOQ line belongs
 * to exactly one account.** A line in two accounts is double-counted in EVM; a line in none is
 * missing from it. Both are reported as exceptions rather than resolved silently, because either
 * one makes the project's total wrong and a total that is quietly wrong is worse than a total
 * that is visibly incomplete.
 *
 * Pure (no Firebase, no React) so the assignment rules are unit-testable with `node --test`.
 */

import { isBoqSectionHeader } from "./project-management-boq-columns.ts";

export const CONTROL_ACCOUNT_COLLECTION = "projectControlAccounts";
export const WBS_PERMISSION_RESOURCE = "Project Management.WBS";

/** The BOQ dimensions an account can match on. These are the columns the BOQ import and Add form
 *  already collect (see `PM_FORM_REGISTRY.boqAdd`), so an account rule is expressible in terms a
 *  user has already filled in rather than a new classification they have to apply line by line. */
export const BOQ_DIMENSIONS = [
  "scope1",
  "scope2",
  "category1",
  "category2",
  "category3",
] as const;
export type BoqDimension = (typeof BOQ_DIMENSIONS)[number];

/** The BOQ header each dimension is stored under once §0.5's reserved fields land. Until then the
 *  tolerant reader below also matches the legacy spellings ("Scope 1", "Scope.1", "SCOPE1"). */
const DIMENSION_RESERVED_KEY: Record<BoqDimension, string> = {
  scope1: "scope1",
  scope2: "scope2",
  category1: "category1",
  category2: "category2",
  category3: "category3",
};

/**
 * One matching clause. Every dimension named must match; dimensions left undefined are ignored.
 * So `{ scope2: "Civil" }` takes the whole civil scope, and
 * `{ scope2: "Civil", category1: "Foundation" }` narrows it.
 *
 * An empty rule (no dimensions at all) deliberately matches **nothing** rather than everything —
 * a catch-all account created by leaving a rule blank would silently absorb every line the other
 * accounts missed, which is precisely the unassigned-lines exception we want to see.
 */
export type BoqMatchRule = Partial<Record<BoqDimension, string>>;

export interface ControlAccount {
  id: string;
  /** Short stable identifier used in reports and exports — "WBS-01", "SUP-CONDUCTOR". */
  code: string;
  name: string;
  /** Parent account, for a rolled-up hierarchy. Undefined for a top-level account. */
  parentId?: string;
  order: number;
  matchRules: BoqMatchRule[];
  /** Lines pulled in regardless of the rules — the escape hatch for a line whose dimensions are
   *  wrong or missing. Beats rules, loses to `explicitExcludeBoqItemIds`. */
  explicitIncludeBoqItemIds?: string[];
  /** Lines kept out regardless of everything else. The highest-precedence signal, because it is
   *  the most specific thing a user can say. */
  explicitExcludeBoqItemIds?: string[];
  createdAt?: unknown;
  createdBy?: string;
  createdByName?: string;
  updatedAt?: unknown;
  updatedBy?: string;
  updatedByName?: string;
}

export type ControlAccountDraft = Omit<
  ControlAccount,
  "id" | "createdAt" | "createdBy" | "createdByName" | "updatedAt" | "updatedBy" | "updatedByName"
>;

export interface ControlAccountValidationError {
  field: keyof ControlAccountDraft | "hierarchy";
  message: string;
}

/* ── Reading BOQ dimensions ─────────────────────────────────────────────────────────────────── */

const normalise = (value: unknown): string =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

/** Strips whitespace and dots so "Scope 1", "scope1" and "Scope.1" all collapse to "scope1" —
 *  the same tolerance `readLooseScope` applies in civil-execution.ts, generalised to every
 *  dimension so category columns get the same treatment. */
const collapseKey = (key: string): string => key.toLowerCase().replace(/[\s.]+/g, "");

/**
 * Reads one dimension off a BOQ item. Checks the reserved key first (fast path, and the only path
 * once §0.5 lands), then falls back to a tolerant scan of the item's own keys — BOQ items are
 * dynamic-column documents, so a project imported from a differently-headed spreadsheet still
 * resolves.
 */
export function readBoqDimension(
  item: Record<string, unknown> | null | undefined,
  dimension: BoqDimension,
): string {
  if (!item) return "";
  const reserved = item[DIMENSION_RESERVED_KEY[dimension]];
  if (typeof reserved === "string" && reserved.trim()) return reserved.trim();

  const needle = collapseKey(dimension);
  const match = Object.keys(item).find((key) => collapseKey(key) === needle);
  const value = match ? item[match] : undefined;
  return typeof value === "string" ? value.trim() : "";
}

/** Whether a single rule matches an item. A rule with no dimensions matches nothing (see
 *  `BoqMatchRule`). Comparison is trimmed and case-insensitive, because "Civil" and "civil"
 *  are the same scope to everyone except a string comparison. */
export function ruleMatchesBoqItem(
  rule: BoqMatchRule,
  item: Record<string, unknown>,
): boolean {
  const clauses = BOQ_DIMENSIONS.filter((dimension) => {
    const expected = rule[dimension];
    return typeof expected === "string" && expected.trim() !== "";
  });
  if (!clauses.length) return false;
  return clauses.every(
    (dimension) => normalise(readBoqDimension(item, dimension)) === normalise(rule[dimension]),
  );
}

export function accountMatchesBoqItem(
  account: Pick<ControlAccount, "matchRules">,
  item: Record<string, unknown>,
): boolean {
  return account.matchRules.some((rule) => ruleMatchesBoqItem(rule, item));
}

/* ── Assignment ─────────────────────────────────────────────────────────────────────────────── */

export interface ControlAccountConflict {
  boqItemId: string;
  accountIds: string[];
}

export interface ControlAccountAssignment {
  /** accountId → the BOQ line ids that rolled up to it. */
  byAccount: Map<string, string[]>;
  /** boqItemId → the single account it belongs to. Conflicted lines are absent. */
  accountOfBoqItem: Map<string, string>;
  /** Non-header lines that matched no account. Missing from every account total. */
  unassigned: string[];
  /** Lines that matched more than one account. Excluded from all of them rather than
   *  double-counted, and reported. */
  conflicts: ControlAccountConflict[];
  /** Section headers, skipped by design — they carry no unit and no quantity. */
  skippedHeaderCount: number;
}

/**
 * Assigns every BOQ line to at most one control account.
 *
 * Precedence, most specific first: explicit exclude → explicit include → matching rules. A line
 * excluded by one account and matched by another lands in the other; a line excluded by the only
 * account that wanted it becomes unassigned, which is visible rather than silent.
 *
 * Conflicted lines are deliberately excluded from *all* candidate accounts. Picking one (the
 * first, the lowest `order`) would make the project total right by luck while showing the line
 * under an account somebody did not intend, and the exception would never surface.
 */
export function assignBoqItemsToControlAccounts(
  boqItems: readonly Record<string, unknown>[],
  accounts: readonly ControlAccount[],
): ControlAccountAssignment {
  const byAccount = new Map<string, string[]>();
  const accountOfBoqItem = new Map<string, string>();
  const unassigned: string[] = [];
  const conflicts: ControlAccountConflict[] = [];
  let skippedHeaderCount = 0;

  for (const account of accounts) byAccount.set(account.id, []);

  for (const item of boqItems) {
    const boqItemId = String(item.id ?? "").trim();
    if (!boqItemId) continue;

    if (isBoqSectionHeader(item as { Unit?: unknown; QTY?: unknown })) {
      skippedHeaderCount += 1;
      continue;
    }

    const candidates = accounts
      .filter((account) => {
        if (account.explicitExcludeBoqItemIds?.includes(boqItemId)) return false;
        if (account.explicitIncludeBoqItemIds?.includes(boqItemId)) return true;
        return accountMatchesBoqItem(account, item);
      })
      .map((account) => account.id);

    if (candidates.length === 0) {
      unassigned.push(boqItemId);
    } else if (candidates.length === 1) {
      const accountId = candidates[0]!;
      byAccount.get(accountId)!.push(boqItemId);
      accountOfBoqItem.set(boqItemId, accountId);
    } else {
      conflicts.push({ boqItemId, accountIds: candidates });
    }
  }

  return { byAccount, accountOfBoqItem, unassigned, conflicts, skippedHeaderCount };
}

/** Whether the assignment is clean enough to compute a project total from. A project with
 *  unassigned lines or conflicts still reports, but its totals do not add up to the BOQ, so the
 *  Control Centre shows the shortfall rather than a confident wrong number. */
export function isAssignmentComplete(assignment: ControlAccountAssignment): boolean {
  return assignment.unassigned.length === 0 && assignment.conflicts.length === 0;
}

/* ── Hierarchy ──────────────────────────────────────────────────────────────────────────────── */

/** Accounts in display order: parents before children, siblings by `order` then `code`. */
export function sortControlAccounts(accounts: readonly ControlAccount[]): ControlAccount[] {
  const byParent = new Map<string, ControlAccount[]>();
  for (const account of accounts) {
    const key = account.parentId ?? "";
    const siblings = byParent.get(key) ?? [];
    siblings.push(account);
    byParent.set(key, siblings);
  }
  for (const siblings of byParent.values()) {
    siblings.sort((a, b) => a.order - b.order || a.code.localeCompare(b.code));
  }

  const ordered: ControlAccount[] = [];
  const walk = (parentKey: string, depth: number) => {
    // Depth guard: a cycle would otherwise recurse forever. validateControlAccounts() rejects
    // cycles, but this function must stay safe on data that predates that check.
    if (depth > 32) return;
    for (const account of byParent.get(parentKey) ?? []) {
      ordered.push(account);
      walk(account.id, depth + 1);
    }
  };
  walk("", 0);

  // Anything unreachable from a root (orphaned parentId, or inside a cycle) is appended rather
  // than dropped, so a broken hierarchy still shows every account.
  if (ordered.length < accounts.length) {
    const seen = new Set(ordered.map((account) => account.id));
    for (const account of accounts) if (!seen.has(account.id)) ordered.push(account);
  }
  return ordered;
}

/** Depth of an account, 0 for top level. Returns -1 if it sits in a cycle. */
export function controlAccountDepth(
  accounts: readonly ControlAccount[],
  accountId: string,
): number {
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const seen = new Set<string>();
  let depth = 0;
  let current = byId.get(accountId);
  while (current?.parentId) {
    if (seen.has(current.id)) return -1;
    seen.add(current.id);
    current = byId.get(current.parentId);
    depth += 1;
    if (depth > 32) return -1;
  }
  return depth;
}

/** Every descendant account id, for rolling a parent's total up from its children. */
export function descendantAccountIds(
  accounts: readonly ControlAccount[],
  accountId: string,
): string[] {
  const children = new Map<string, string[]>();
  for (const account of accounts) {
    if (!account.parentId) continue;
    const siblings = children.get(account.parentId) ?? [];
    siblings.push(account.id);
    children.set(account.parentId, siblings);
  }

  const out: string[] = [];
  const stack = [...(children.get(accountId) ?? [])];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    stack.push(...(children.get(id) ?? []));
  }
  return out;
}

/* ── Validation ─────────────────────────────────────────────────────────────────────────────── */

export function validateControlAccount(
  draft: ControlAccountDraft,
  existingCodes: readonly string[] = [],
): ControlAccountValidationError[] {
  const errors: ControlAccountValidationError[] = [];

  if (!draft.code?.trim()) {
    errors.push({ field: "code", message: "A code is required." });
  } else if (!/^[A-Za-z0-9/_-]+$/.test(draft.code.trim())) {
    errors.push({
      field: "code",
      message: "Code may only contain letters, numbers, and - _ / characters.",
    });
  } else if (existingCodes.some((code) => normalise(code) === normalise(draft.code))) {
    errors.push({ field: "code", message: `Code ${draft.code.trim()} is already in use.` });
  }

  if (!draft.name?.trim()) {
    errors.push({ field: "name", message: "A name is required." });
  }

  const usableRules = draft.matchRules.filter((rule) =>
    BOQ_DIMENSIONS.some((dimension) => (rule[dimension] ?? "").trim() !== ""),
  );
  const hasExplicit = Boolean(draft.explicitIncludeBoqItemIds?.length);
  if (!usableRules.length && !hasExplicit) {
    errors.push({
      field: "matchRules",
      message: "Add at least one match rule, or pick BOQ lines explicitly — an account with neither collects nothing.",
    });
  }

  return errors;
}

/** Whole-set rules that a single draft cannot see: duplicate codes across the set, and cycles. */
export function validateControlAccounts(
  accounts: readonly ControlAccount[],
): ControlAccountValidationError[] {
  const errors: ControlAccountValidationError[] = [];

  const seenCodes = new Map<string, string>();
  for (const account of accounts) {
    const key = normalise(account.code);
    if (!key) continue;
    const existing = seenCodes.get(key);
    if (existing) {
      errors.push({
        field: "code",
        message: `Code ${account.code} is used by more than one account (${existing}, ${account.name}).`,
      });
    } else {
      seenCodes.set(key, account.name);
    }
  }

  const ids = new Set(accounts.map((account) => account.id));
  for (const account of accounts) {
    if (account.parentId && !ids.has(account.parentId)) {
      errors.push({
        field: "parentId",
        message: `${account.name} points at a parent that no longer exists.`,
      });
    }
    if (account.parentId === account.id) {
      errors.push({ field: "parentId", message: `${account.name} cannot be its own parent.` });
    } else if (controlAccountDepth(accounts, account.id) === -1) {
      errors.push({
        field: "hierarchy",
        message: `${account.name} is part of a circular parent chain.`,
      });
    }
  }

  return errors;
}

/** Human-readable summary of a rule, for the register and for exports. */
export function describeMatchRule(rule: BoqMatchRule): string {
  const parts = BOQ_DIMENSIONS.filter((dimension) => (rule[dimension] ?? "").trim() !== "").map(
    (dimension) => `${DIMENSION_LABELS[dimension]} = ${rule[dimension]!.trim()}`,
  );
  return parts.length ? parts.join(" and ") : "No dimensions set (matches nothing)";
}

export const DIMENSION_LABELS: Record<BoqDimension, string> = {
  scope1: "Scope 1",
  scope2: "Scope 2",
  category1: "Category 1",
  category2: "Category 2",
  category3: "Category 3",
};

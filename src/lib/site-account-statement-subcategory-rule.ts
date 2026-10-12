/**
 * When an expense must name a sub-category.
 *
 * Two sources can demand one:
 *   - Field Control, for every category at once ("Sub-Category: mandatory");
 *   - the category itself, set on Settings → Expense Categories ("Sub-category required"), for the
 *     categories where the breakdown is the point — Labour split by trade, Material by item.
 *
 * One condition suspends both: the category having no active sub-categories. A requirement that
 * offers nothing to choose would make the expense impossible to save, and the person filling in
 * the form can do nothing about it — that is an administrator's gap to close, not a clerk's error
 * to be shown. So the rule is reported as `unsatisfiable` (for the settings screen to flag) and
 * the form lets the expense through.
 *
 * Importless, like the module's other domain files, so `node --test` loads it directly. Every
 * form that records an expense asks this one function — the Site Expenses form, the dashboard
 * quick-add and the Excel import — so the rule cannot hold on one and not another.
 */

export interface RuleCategory {
  id: string;
  name: string;
  /** Set on a sub-category: the id of its main category. */
  parentId?: string | null;
  isActive?: boolean;
  /** Set on a main category: its expenses must name one of its sub-categories. */
  requireSubCategory?: boolean;
}

export interface SubCategoryRequirement {
  required: boolean;
  /** What asked for it: this category's own rule, Field Control for all categories, or nothing. */
  source: 'category' | 'all' | null;
  /** The active sub-categories of the chosen category, by name, in their stored order. */
  options: string[];
  /** A sub-category is demanded but there is none to choose, so the demand is suspended. */
  unsatisfiable: boolean;
}

const NONE: SubCategoryRequirement = { required: false, source: null, options: [], unsatisfiable: false };

/** The main category with this name, matched the way the import matches it — trimmed, any case. */
export function findMainCategory<T extends RuleCategory>(categories: T[], name: string | null | undefined): T | null {
  const wanted = (name ?? '').trim().toLowerCase();
  if (!wanted) return null;
  return categories.find(c => !c.parentId && c.name.trim().toLowerCase() === wanted) ?? null;
}

/** Active sub-categories of a main category. An inactive one cannot be chosen, so it cannot count. */
export function activeSubCategories<T extends RuleCategory>(categories: T[], main: RuleCategory): T[] {
  return categories.filter(c => c.parentId === main.id && c.isActive !== false);
}

export function subCategoryRequirement({
  category,
  categories,
  requiredEverywhere,
}: {
  /** The chosen main category's name. */
  category: string | null | undefined;
  categories: RuleCategory[];
  /** Field Control's "Sub-Category: mandatory", which applies to every category. */
  requiredEverywhere: boolean;
}): SubCategoryRequirement {
  const main = findMainCategory(categories, category);
  if (!main) return NONE;

  const options = activeSubCategories(categories, main).map(c => c.name);
  // The category's own rule is named first: it is the more specific reason, and the one an
  // administrator set deliberately for this category.
  const source: SubCategoryRequirement['source'] = main.requireSubCategory === true
    ? 'category'
    : requiredEverywhere ? 'all' : null;

  if (source && options.length === 0) return { required: false, source, options, unsatisfiable: true };
  return { required: source !== null, source, options, unsatisfiable: false };
}

export interface SubCategoryCheck {
  ok: boolean;
  reason?: string;
}

function listOf(names: string[]): string {
  if (names.length <= 4) return names.join(', ');
  return `${names.slice(0, 4).join(', ')} or ${names.length - 4} more`;
}

/**
 * Checks the sub-category recorded with an expense.
 *
 * Refuses a missing one only when it is required, and an unknown one always: a sub-category that
 * does not belong to the chosen category matches no filter and no budget, so it is a mistake
 * whether or not one was required. Messages name the category and what can be picked, because
 * "Sub-category is required" on a form that showed it as optional yesterday reads as a bug.
 */
export function validateSubCategoryChoice({
  category,
  subCategory,
  categories,
  requiredEverywhere,
}: {
  category: string | null | undefined;
  subCategory: string | null | undefined;
  categories: RuleCategory[];
  requiredEverywhere: boolean;
}): SubCategoryCheck {
  const main = findMainCategory(categories, category);
  if (!main) return { ok: true };
  const requirement = subCategoryRequirement({ category, categories, requiredEverywhere });
  const chosen = (subCategory ?? '').trim();

  if (!chosen) {
    if (!requirement.required) return { ok: true };
    return {
      ok: false,
      reason: requirement.source === 'category'
        ? `${main.name} needs a sub-category — choose ${listOf(requirement.options)}.`
        : 'Sub-category is required.',
    };
  }

  const known = requirement.options.some(o => o.trim().toLowerCase() === chosen.toLowerCase());
  if (!known) return { ok: false, reason: `"${chosen}" is not a sub-category of ${main.name}.` };
  return { ok: true };
}

/** Main categories carrying the rule, and which of those cannot be satisfied — for the settings screen. */
export function subCategoryRuleSummary(categories: RuleCategory[]): { required: string[]; unsatisfiable: string[] } {
  const required: string[] = [];
  const unsatisfiable: string[] = [];
  for (const main of categories) {
    if (main.parentId || main.requireSubCategory !== true) continue;
    required.push(main.name);
    if (activeSubCategories(categories, main).length === 0) unsatisfiable.push(main.name);
  }
  return { required, unsatisfiable };
}

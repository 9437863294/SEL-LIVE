/**
 * Main categories and sub categories of bills.
 *
 *   Main category  — one list for the whole company (Supply, Erection, Civil, F&I, …). Each says
 *                    which column of the legacy month-wise summary its billing is reported under.
 *   Sub category   — the legacy "Type of Bill Status" (SUPPLY-60%, CIVIL-PV, …). It belongs to one
 *                    main category and is enabled per project; an empty project list means every
 *                    project.
 *
 * A bill is entered by choosing the project, then the main category, then one of the sub categories
 * of that main category enabled for that project. The same rule is applied on the server, so a
 * sub category that is not enabled for a project cannot be posted to it.
 *
 * Pure — shared by the bill form, the settings page, the importer and the API.
 */

import { SUMMARY_COLUMNS, type BillCategoryMaster, type BillTypeMaster, type SummaryColumn } from './types.ts';

/** Case, spacing and punctuation insensitive key (same rule as the importer's). */
const normaliseToken = (value: unknown): string =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/** Whether a sub category may be used on a project. */
export const isEnabledForProject = (type: Pick<BillTypeMaster, 'projectIds'>, projectId: string | undefined): boolean =>
  !type.projectIds?.length || (projectId !== undefined && type.projectIds.includes(projectId));

/** The sub categories offered for a main category on a project, active ones only (plus `keepId`). */
export function subCategoriesFor(types: readonly BillTypeMaster[], categoryId: string | undefined, projectId: string | undefined, keepId?: string): BillTypeMaster[] {
  if (!categoryId) return [];
  return types
    .filter((type) => type.categoryId === categoryId && ((type.active && isEnabledForProject(type, projectId)) || type.id === keepId))
    .sort((a, b) => a.name.localeCompare(b.name, 'en-IN', { numeric: true }));
}

/** Main categories in display order. */
export const sortedCategories = (categories: readonly BillCategoryMaster[]): BillCategoryMaster[] =>
  [...categories].sort((a, b) => a.sequence - b.sequence || a.name.localeCompare(b.name));

/** The legacy-summary column for a main category id, falling back sensibly for deleted ones. */
export function summaryColumnOf(categoryId: string, categories: readonly Pick<BillCategoryMaster, 'id' | 'summaryColumn'>[] = []): SummaryColumn {
  const found = categories.find((category) => category.id === categoryId);
  if (found) return found.summaryColumn;
  return (SUMMARY_COLUMNS as readonly string[]).includes(categoryId) ? (categoryId as SummaryColumn) : 'other';
}

export const categoryName = (categoryId: string | undefined, categories: readonly Pick<BillCategoryMaster, 'id' | 'name'>[], fallback?: string): string =>
  categories.find((category) => category.id === categoryId)?.name ?? fallback ?? categoryId ?? '—';

/**
 * Legacy category id from a sub-category name, by the workbook's naming convention (the part before
 * the first `-`): `SUPPLY-60%` → supply, `CIVIL-PV` → civil, `CROP COMPENSATION` → compensation.
 */
export function inferBillCategory(name: string): string {
  const text = name.toUpperCase();
  if (text.startsWith('F&I') || text.startsWith('F & I') || text.startsWith('FI-')) return 'fi';
  if (text.includes('COMPENSATION')) return 'compensation';
  if (text.startsWith('SUPPLY') || text.includes('SUPPLY-STAGE') || text.startsWith('INCEPTION')) return 'supply';
  if (text.startsWith('ERECTION')) return 'erection';
  if (text.startsWith('CIVIL')) return 'civil';
  return 'other';
}

/**
 * The main category a new sub-category name belongs to, among the configured ones: a main category
 * whose name or code equals the part before the first `-`, else the legacy inference if that id
 * exists, else the "Other"-column category, else the first one.
 */
export function inferCategoryId(name: string, categories: readonly BillCategoryMaster[]): string {
  if (!categories.length) return inferBillCategory(name);
  const prefix = normaliseToken(name.split('-')[0]);
  const byPrefix = categories.find((category) => normaliseToken(category.name) === prefix || normaliseToken(category.code) === prefix);
  if (byPrefix) return byPrefix.id;
  const legacy = inferBillCategory(name);
  if (categories.some((category) => category.id === legacy)) return legacy;
  return (categories.find((category) => category.summaryColumn === 'other') ?? sortedCategories(categories)[0]).id;
}

/** Brings a stored sub category up to the current shape (older configs had a fixed `category`). */
export function normaliseBillType(stored: Partial<BillTypeMaster> & { category?: string; id: string; name: string }): BillTypeMaster {
  return {
    id: stored.id,
    name: stored.name,
    code: stored.code ?? stored.name,
    categoryId: stored.categoryId ?? stored.category ?? inferBillCategory(stored.name),
    projectIds: Array.isArray(stored.projectIds) ? stored.projectIds : [],
    isRetentionBill: Boolean(stored.isRetentionBill),
    isPriceVariation: Boolean(stored.isPriceVariation),
    active: stored.active !== false,
  };
}

const overlaps = (a: readonly string[], b: readonly string[]) => !a.length || !b.length || a.some((id) => b.includes(id));

/**
 * Configuration errors, or `null`. Main category names are unique; every sub category belongs to a
 * main category that exists; and two sub categories of the same main category may share a name only
 * when they are enabled for different projects (so a bill's sub category is never ambiguous).
 */
export function validateCategoryConfig(categories: readonly BillCategoryMaster[], types: readonly BillTypeMaster[]): string | null {
  if (!categories.length) return 'Add at least one main category.';
  const names = new Map<string, string>();
  for (const category of categories) {
    if (!category.name.trim()) return 'Every main category needs a name.';
    const key = normaliseToken(category.name);
    if (names.has(key)) return `Main category “${category.name}” appears twice.`;
    names.set(key, category.id);
  }
  for (const type of types) {
    if (!type.name.trim()) return 'Every sub category needs a name.';
    const parent = categories.find((category) => category.id === type.categoryId);
    if (!parent) return `Sub category “${type.name}” has no main category — choose one or delete it.`;
    const clash = types.find(
      (other) => other !== type && other.id !== type.id && other.categoryId === type.categoryId && normaliseToken(other.name) === normaliseToken(type.name) && overlaps(other.projectIds, type.projectIds),
    );
    if (clash) return `Sub category “${type.name}” is defined twice under ${parent.name} for the same project(s).`;
  }
  return null;
}

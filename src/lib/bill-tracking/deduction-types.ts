/**
 * Deduction heads per project (Settings → Deduction types).
 *
 * The deduction type master is the default every project uses. A project can set its own figures for
 * any head — whether it is offered, how it is worked out (fixed or %), its default %, what the % is
 * taken of and less, and the GST on it — stored on the project's profile as overrides
 * (`ProjectProfile.deductionTypes`). Everything else, name, code, kind and order, stays the master's,
 * so reports, the importer and the retention ledger read every project alike.
 *
 * A head switched off in the master and on for one project is that project's own head.
 *
 * Every place that works out or reads back a bill's deductions takes the bill's project view
 * (`projectDeductionTypes`): the bill and certification forms, the server's save, note rules and the
 * retention slabs. Pure: the server, the browser and the tests share it.
 */

import type { BillTrackingConfig, DeductionTypeMaster, DeductionTypeOverride, ProjectProfile } from './types';

/** The fields a project may set for itself, in the order the settings table shows them. */
export const OVERRIDABLE_DEDUCTION_FIELDS = ['calculation', 'defaultPercent', 'percentBase', 'baseLessTypeIds', 'gstApplicable', 'gstRate', 'active'] as const;
export type OverridableDeductionField = (typeof OVERRIDABLE_DEDUCTION_FIELDS)[number];

type Masters = Pick<BillTrackingConfig, 'deductionTypes' | 'projectProfiles'>;

/** A project's overrides, by head id. */
export const projectOverrides = (profiles: readonly ProjectProfile[], projectId: string | null | undefined): readonly DeductionTypeOverride[] =>
  (projectId ? profiles.find((profile) => profile.projectId === projectId)?.deductionTypes : undefined) ?? [];

/** One head as an override sets it; `null` clears an optional figure. */
export function applyOverride(type: DeductionTypeMaster, override: DeductionTypeOverride | undefined): DeductionTypeMaster {
  if (!override) return type;
  const next: DeductionTypeMaster = { ...type };
  for (const field of OVERRIDABLE_DEDUCTION_FIELDS) {
    const value = override[field];
    if (value === undefined) continue;
    if (value === null) delete (next as Partial<DeductionTypeMaster>)[field];
    else (next as unknown as Record<string, unknown>)[field] = Array.isArray(value) ? [...value] : value;
  }
  return next;
}

/** The deduction heads as `projectId` uses them: the master, with the project's own settings over it. */
export function projectDeductionTypes(config: Masters, projectId: string | null | undefined): DeductionTypeMaster[] {
  const overrides = projectOverrides(config.projectProfiles, projectId);
  if (!overrides.length) return config.deductionTypes;
  return config.deductionTypes.map((type) => applyOverride(type, overrides.find((entry) => entry.deductionTypeId === type.id)));
}

/** The configuration with the deduction heads as one project uses them — for code that takes the whole config. */
export const withProjectDeductions = <C extends Masters>(config: C, projectId: string | null | undefined): C =>
  projectOverrides(config.projectProfiles, projectId).length ? { ...config, deductionTypes: projectDeductionTypes(config, projectId) } : config;

/** A reader for code that spans projects (the retention bifurcation): each bill's project view. */
export function deductionTypesByProject(config: Masters): (projectId: string | null | undefined) => readonly DeductionTypeMaster[] {
  const cache = new Map<string, DeductionTypeMaster[]>();
  return (projectId) => {
    if (!projectId) return config.deductionTypes;
    let types = cache.get(projectId);
    if (!types) cache.set(projectId, (types = projectDeductionTypes(config, projectId)));
    return types;
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const sortedIds = (ids: readonly string[] | undefined) => [...new Set(ids ?? [])].sort();

/** Whether a field's override actually differs from the master — what the settings table marks. */
export function differsFromMaster(type: DeductionTypeMaster, override: DeductionTypeOverride | undefined, field: OverridableDeductionField): boolean {
  const value = override?.[field];
  if (value === undefined) return false;
  if (field === 'baseLessTypeIds') return !same(sortedIds(value as string[]), sortedIds(type.baseLessTypeIds));
  return !same(value, type[field]);
}

/**
 * The overrides with one head's fields set: a value equal to the master's is dropped (it follows the
 * master again), and a head left with nothing of its own is dropped altogether.
 */
export function setOverride(overrides: readonly DeductionTypeOverride[], type: DeductionTypeMaster, patch: Partial<Omit<DeductionTypeOverride, 'deductionTypeId'>>): DeductionTypeOverride[] {
  const current = overrides.find((entry) => entry.deductionTypeId === type.id) ?? { deductionTypeId: type.id };
  const merged: DeductionTypeOverride = { ...current, ...patch };
  const kept: DeductionTypeOverride = { deductionTypeId: type.id };
  for (const field of OVERRIDABLE_DEDUCTION_FIELDS) {
    if (differsFromMaster(type, merged, field)) (kept as unknown as Record<string, unknown>)[field] = merged[field];
  }
  const others = overrides.filter((entry) => entry.deductionTypeId !== type.id);
  return Object.keys(kept).length > 1 ? [...others, kept] : others;
}

/**
 * Overrides as saved: only heads still in the master, once each; "less" only of other known heads; a
 * figure equal to the master's dropped; and heads left with nothing of their own dropped.
 */
export function normaliseDeductionOverrides(overrides: readonly DeductionTypeOverride[] | undefined, types: readonly DeductionTypeMaster[]): DeductionTypeOverride[] {
  let result: DeductionTypeOverride[] = [];
  for (const override of overrides ?? []) {
    const type = types.find((entry) => entry.id === override.deductionTypeId);
    if (!type || result.some((entry) => entry.deductionTypeId === type.id)) continue;
    const fields: Partial<Omit<DeductionTypeOverride, 'deductionTypeId'>> = {};
    for (const field of OVERRIDABLE_DEDUCTION_FIELDS) {
      if (override[field] !== undefined) (fields as Record<string, unknown>)[field] = override[field];
    }
    if (fields.baseLessTypeIds) fields.baseLessTypeIds = sortedIds(fields.baseLessTypeIds).filter((id) => id !== type.id && types.some((entry) => entry.id === id));
    result = setOverride(result, type, fields);
  }
  return result;
}

/**
 * Which projects have deduction settings of their own — heads and value basis rules — and how many of
 * each, for the settings summary.
 */
export const projectsWithOwnDeductions = (profiles: readonly ProjectProfile[]): { projectId: string; heads: number; basisRules: number }[] =>
  profiles
    .filter((profile) => profile.deductionTypes?.length || profile.valueBasisRules?.length)
    .map((profile) => ({ projectId: profile.projectId, heads: profile.deductionTypes?.length ?? 0, basisRules: profile.valueBasisRules?.length ?? 0 }));

/** "2 heads, 1 value basis rule" — what a project sets for itself, counted. */
export const ownSettingsCount = (entry: { heads: number; basisRules: number }): string =>
  [entry.heads ? `${entry.heads} head${entry.heads === 1 ? '' : 's'}` : null, entry.basisRules ? `${entry.basisRules} value basis rule${entry.basisRules === 1 ? '' : 's'}` : null].filter(Boolean).join(', ');

/** The column names the settings table gives the fields a project can set. */
export const DEDUCTION_FIELD_LABELS: Record<OverridableDeductionField, string> = {
  calculation: 'Calculation',
  defaultPercent: 'Default %',
  percentBase: '% of',
  baseLessTypeIds: 'Less (base)',
  gstApplicable: 'GST on it',
  gstRate: 'GST %',
  active: 'Active',
};

/** How one field of a head reads on screen ("10%", "Gross", "− Mobilisation Advance", "off"…). */
export function deductionFieldText(type: DeductionTypeMaster, field: OverridableDeductionField, types: readonly DeductionTypeMaster[]): string {
  switch (field) {
    case 'active':
      return type.active ? 'on' : 'off';
    case 'calculation':
      return type.calculation === 'percentage' ? 'Percentage' : 'Fixed amount';
    case 'defaultPercent':
      return type.defaultPercent === undefined ? 'blank' : `${type.defaultPercent}%`;
    case 'percentBase':
      return type.percentBase === 'gross' ? 'Gross' : type.percentBase === 'value' ? 'Value' : 'Taxable';
    case 'baseLessTypeIds':
      return type.baseLessTypeIds?.length ? `− ${type.baseLessTypeIds.map((id) => types.find((entry) => entry.id === id)?.name ?? id).join(', ')}` : '− Nothing';
    case 'gstApplicable':
      return type.gstApplicable ? 'on' : 'off';
    case 'gstRate':
      return type.gstRate === undefined ? 'blank' : `${type.gstRate}%`;
  }
}

/** One field a project sets differently: what the project uses and what the default is. */
export interface DeductionFieldChange {
  field: OverridableDeductionField;
  label: string;
  value: string;
  defaultValue: string;
}

/** One head a project sets for itself. `ownHead`: off in the default, on for this project. */
export interface ProjectDeductionHead {
  deductionTypeId: string;
  name: string;
  ownHead: boolean;
  changes: DeductionFieldChange[];
}

/**
 * What a project sets differently from the default, head by head and field by field — in the master's
 * order, for the settings summary and the notices on the bill and certification forms. Empty when the
 * project uses the default throughout.
 */
export function projectDeductionChanges(config: Masters, projectId: string | null | undefined): ProjectDeductionHead[] {
  const overrides = projectOverrides(config.projectProfiles, projectId);
  if (!overrides.length) return [];
  const heads: ProjectDeductionHead[] = [];
  for (const master of [...config.deductionTypes].sort((a, b) => a.sequence - b.sequence)) {
    const override = overrides.find((entry) => entry.deductionTypeId === master.id);
    if (!override) continue;
    const own = applyOverride(master, override);
    const changes = OVERRIDABLE_DEDUCTION_FIELDS.filter((field) => differsFromMaster(master, override, field)).map((field) => ({
      field,
      label: DEDUCTION_FIELD_LABELS[field],
      value: deductionFieldText(own, field, config.deductionTypes),
      defaultValue: deductionFieldText(master, field, config.deductionTypes),
    }));
    if (changes.length) heads.push({ deductionTypeId: master.id, name: master.name || master.code || master.id, ownHead: !master.active && own.active, changes });
  }
  return heads;
}

/** How one change reads in a sentence: "Default % 5%", "switched off", "offered on this project only". */
export const deductionChangeText = (change: DeductionFieldChange): string =>
  change.field === 'active' ? (change.value === 'off' ? 'switched off' : 'offered on this project only') : `${change.label} ${change.value}`;

/** A change with the default beside it, for lists: "Default % 5% (default 10%)", "switched off". */
export const deductionChangeWithDefault = (change: DeductionFieldChange): string =>
  change.field === 'active' ? deductionChangeText(change) : `${deductionChangeText(change)} (default ${change.defaultValue})`;

/** One line for all heads, e.g. "Income TDS: Less (base) − Nothing; Building Cess: switched off". */
export const describeDeductionChanges = (heads: readonly ProjectDeductionHead[]): string =>
  heads.map((head) => `${head.name}: ${head.changes.map(deductionChangeText).join(', ')}`).join('; ');

/** The projects that set one head for themselves — the master table's "Projects" column. */
export const projectsOverridingHead = (profiles: readonly ProjectProfile[], deductionTypeId: string): string[] =>
  profiles.filter((profile) => profile.deductionTypes?.some((entry) => entry.deductionTypeId === deductionTypeId)).map((profile) => profile.projectId);

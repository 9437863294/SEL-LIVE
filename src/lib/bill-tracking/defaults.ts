/**
 * Default configuration for Bill Tracking, seeded from the legacy workbook.
 *
 * The bill types are exactly the values the `Bill Tracking` sheet uses in "Type of Bill Status",
 * plus the ones its month-wise summary QUERY formulas name (INCEPTION, F&I, the `- F` variants).
 * The deduction types are the sheet's eleven deduction columns in sheet order, with the codes the
 * importer posts to. All of it is editable in Settings; these only apply until an administrator
 * saves the configuration for the first time, and `withConfigDefaults` back-fills anything a saved
 * configuration lacks (a deduction type added in a later release, for example).
 */

import { DEFAULT_AGEING_BUCKETS } from './calculations.ts';
import { normaliseWorkflowSteps } from './workflow.ts';
import { inferBillCategory, normaliseBillType } from './categories.ts';
import { LEGACY_RETENTION_BILL_TYPES } from './import.ts';
import type {
  BillCategoryMaster,
  BillStageMaster,
  BillTrackingConfig,
  BillTrackingSettings,
  BillTypeMaster,
  DeductionTypeMaster,
} from './types';

const LEGACY_BILL_TYPES = [
  'SUPPLY',
  'SUPPLY-PV',
  'SUPPLY-80%',
  'SUPPLY-70%',
  'SUPPLY-60%',
  'SUPPLY-40%',
  'SUPPLY-30%',
  'SUPPLY-25%',
  'SUPPLY-20%',
  'SUPPLY-15%',
  'SUPPLY-10%',
  'SUPPLY-10% - F',
  'SUPPLY-5%',
  'INCEPTION-5% (SUPPLY-STAGE-I)',
  'INCEPTION-5% (SUPPLY-STAGE-II)',
  'ERECTION',
  'ERECTION-PV',
  'ERECTION-20%',
  'ERECTION-10%',
  'ERECTION-10% - F',
  'ERECTION-10%-GST',
  'ERECTION-5%',
  'ERECTION-5%-GST',
  'CIVIL',
  'CIVIL-PV',
  'CIVIL-80%',
  'CIVIL-10%',
  'CIVIL-10% - F',
  'CIVIL-5%',
  'F&I',
  'CROP COMPENSATION',
];

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/%/g, 'pct')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * Main categories. Ids are the legacy category keys so bills saved before categories became
 * configurable still resolve; Compensation reports under the summary's "Other" column.
 */
export const DEFAULT_BILL_CATEGORIES: BillCategoryMaster[] = [
  { id: 'supply', name: 'Supply', code: 'SUPPLY', summaryColumn: 'supply', sequence: 1, active: true },
  { id: 'erection', name: 'Erection', code: 'ERECTION', summaryColumn: 'erection', sequence: 2, active: true },
  { id: 'civil', name: 'Civil', code: 'CIVIL', summaryColumn: 'civil', sequence: 3, active: true },
  { id: 'fi', name: 'F&I', code: 'F&I', summaryColumn: 'fi', sequence: 4, active: true },
  { id: 'compensation', name: 'Compensation', code: 'COMPENSATION', summaryColumn: 'other', sequence: 5, active: true },
  { id: 'other', name: 'Other', code: 'OTHER', summaryColumn: 'other', sequence: 6, active: true },
];

/** Sub categories seeded from the workbook; enabled for every project until an admin narrows them. */
export const DEFAULT_BILL_TYPES: BillTypeMaster[] = LEGACY_BILL_TYPES.map((name) => ({
  id: `bt-${slug(name)}`,
  name,
  code: name.replace(/[^A-Z0-9%&]+/g, '-'),
  categoryId: inferBillCategory(name),
  projectIds: [],
  isRetentionBill: LEGACY_RETENTION_BILL_TYPES.includes(name),
  isPriceVariation: /-PV$/.test(name),
  active: true,
}));

export const DEFAULT_DEDUCTION_TYPES: DeductionTypeMaster[] = [
  { id: 'dt-bcess', code: 'BCESS', name: 'Building Cess', kind: 'statutory', calculation: 'percentage', percentBase: 'taxable', defaultPercent: 1, sequence: 1, active: true },
  // Income TDS is taken of the taxable value less the mobilisation advance recovered on the bill.
  { id: 'dt-itds', code: 'ITDS', name: 'Income TDS', kind: 'statutory', calculation: 'percentage', percentBase: 'taxable', baseLessTypeIds: ['dt-mobadv'], defaultPercent: 2, sequence: 2, active: true },
  { id: 'dt-cgsttds', code: 'CGSTTDS', name: 'CGST TDS', kind: 'statutory', calculation: 'percentage', percentBase: 'taxable', defaultPercent: 1, sequence: 3, active: true },
  { id: 'dt-sgsttds', code: 'SGSTTDS', name: 'SGST TDS', kind: 'statutory', calculation: 'percentage', percentBase: 'taxable', defaultPercent: 1, sequence: 4, active: true },
  { id: 'dt-mobadv', code: 'MOBADV', name: 'Mobilization Advance', kind: 'mobilization_advance', calculation: 'fixed', percentBase: 'taxable', sequence: 5, active: true },
  { id: 'dt-mobint', code: 'MOBINT', name: 'Interest on Mobilization Advance', kind: 'mobilization_interest', calculation: 'fixed', percentBase: 'taxable', sequence: 6, active: true },
  { id: 'dt-ret-cpbg', code: 'RET_CPBG', name: 'Retention Against CPBG', kind: 'retention_cpbg', calculation: 'percentage', percentBase: 'taxable', defaultPercent: 10, sequence: 7, active: true },
  { id: 'dt-ret-inv', code: 'RET_INV', name: 'Retention Against Invoice', kind: 'retention_invoice', calculation: 'percentage', percentBase: 'taxable', defaultPercent: 10, sequence: 8, active: true },
  { id: 'dt-ret-te', code: 'RET_TE', name: 'Retention – Time Extension', kind: 'retention_time_extension', calculation: 'fixed', percentBase: 'taxable', sequence: 9, active: true },
  { id: 'dt-lccomm', code: 'LCCOMM', name: 'LC Commission', kind: 'lc_commission', calculation: 'fixed', percentBase: 'gross', sequence: 10, active: true },
  { id: 'dt-other', code: 'OTHER', name: 'Other', kind: 'other', calculation: 'fixed', percentBase: 'taxable', sequence: 11, active: true },
];

export const DEFAULT_STAGES: BillStageMaster[] = [
  'Measurement',
  'Bill Preparation',
  'Submitted to Client',
  'Client Verification',
  'Bill Passed',
  'Payment Processing',
  'Payment Released',
].map((name, index) => ({ id: `st-${slug(name)}`, name, sequence: index + 1, active: true }));

export const DEFAULT_SETTINGS: BillTrackingSettings = {
  tolerance: 1,
  roundNetToRupee: true,
  defaultGstRate: 18,
  roundDeductionsToRupee: true,
  defaultCreditDays: 45,
  defaultAgeingBasis: 'billDate',
  ageingBuckets: DEFAULT_AGEING_BUCKETS,
  noFollowUpDays: 15,
  oldOutstandingDays: 180,
  highValueThreshold: 5000000,
  numbering: { enabled: true, pattern: 'SEL/BILL/{FY}/{SEQ}', padding: 6 },
  // Payment follows the client's certification of an invoice or retention bill; migrated bills were
  // certified on paper before SEL LIVE, so they are left out.
  certificationBeforeReceipt: { enabled: true, transactionTypes: ['invoice', 'retention_bill'], exemptImported: true },
  // Every stage in use and left to permission holders until people are named in Settings → Workflow.
  workflowSteps: normaliseWorkflowSteps(undefined),
  closedMonths: [],
  piMarker: 'PI',
};

export const DEFAULT_CONFIG: BillTrackingConfig = {
  settings: DEFAULT_SETTINGS,
  billCategories: DEFAULT_BILL_CATEGORIES,
  billTypes: DEFAULT_BILL_TYPES,
  deductionTypes: DEFAULT_DEDUCTION_TYPES,
  stages: DEFAULT_STAGES,
  projectMappings: [],
  projectProfiles: [],
};

/**
 * Merges a stored configuration over the defaults. Lists are taken whole from storage once saved
 * (an administrator deleting a stage must stay deleted), except deduction types, where a code the
 * stored list lacks is appended inactive-safe — the importer posts to codes, so every code it knows
 * must resolve to a type.
 */
export function withConfigDefaults(stored: Partial<BillTrackingConfig> | null | undefined): BillTrackingConfig {
  const settings = { ...DEFAULT_SETTINGS, ...(stored?.settings ?? {}) };
  settings.numbering = { ...DEFAULT_SETTINGS.numbering, ...(stored?.settings?.numbering ?? {}) };
  settings.certificationBeforeReceipt = { ...DEFAULT_SETTINGS.certificationBeforeReceipt, ...(stored?.settings?.certificationBeforeReceipt ?? {}) };
  settings.workflowSteps = normaliseWorkflowSteps(stored?.settings?.workflowSteps);
  if (!settings.ageingBuckets?.length) settings.ageingBuckets = DEFAULT_AGEING_BUCKETS;
  const deductionTypes = stored?.deductionTypes?.length ? [...stored.deductionTypes] : [...DEFAULT_DEDUCTION_TYPES];
  for (const type of DEFAULT_DEDUCTION_TYPES) {
    if (!deductionTypes.some((entry) => entry.code === type.code)) deductionTypes.push(type);
  }
  // A type saved before the base formula existed takes the default formula (Income TDS: less the
  // mobilisation advance); one an administrator has configured keeps its own, even if empty.
  for (const [index, type] of deductionTypes.entries()) {
    const fallback = DEFAULT_DEDUCTION_TYPES.find((entry) => entry.code === type.code);
    if (type.baseLessTypeIds === undefined && fallback?.baseLessTypeIds) deductionTypes[index] = { ...type, baseLessTypeIds: fallback.baseLessTypeIds };
  }
  return {
    settings,
    billCategories: stored?.billCategories?.length ? stored.billCategories : DEFAULT_BILL_CATEGORIES,
    // Older configurations stored a fixed `category` per bill type and no project list.
    billTypes: (stored?.billTypes?.length ? stored.billTypes : DEFAULT_BILL_TYPES).map((type) => normaliseBillType(type)),
    deductionTypes: deductionTypes.sort((a, b) => a.sequence - b.sequence),
    stages: stored?.stages?.length ? stored.stages : DEFAULT_STAGES,
    projectMappings: stored?.projectMappings ?? [],
    projectProfiles: stored?.projectProfiles ?? [],
  };
}

/** Formats the next generated bill number. Imported bills keep their own numbers. */
export function formatBillNumber(pattern: string, financialYear: string, sequence: number, padding: number): string {
  return pattern.replace('{FY}', financialYear).replace('{SEQ}', String(sequence).padStart(Math.max(1, padding), '0'));
}

/**
 * The contract, as a versioned record.
 *
 * Project Management already knows what the project *is* (`projectManagementProjects`) and what
 * the work *is* (the BOQ). What it has never held is what the project is worth and on what terms:
 * contract value, retention, mobilisation advance and its recovery, LD rate and cap, performance
 * BG, interest, labour cess. Every calculation in the Control layer — earned revenue, deductions
 * on a client bill, LD exposure, capital employed — needs those numbers, and none of them exist
 * anywhere in the application today.
 *
 * The one rule that shapes this file: **terms are versioned and never overwritten.**
 *
 * A contract is amended. Quantities get varied, completion dates get extended, and each of those
 * changes the numbers a bill is computed from — but only for bills raised *after* it. A bill
 * raised in June must still be reconstructible in December against June's retention percentage,
 * not against the percentage a September amendment introduced. Storing one mutable terms document
 * would make every historical bill silently wrong the first time somebody signed an amendment,
 * and the error would be invisible: the numbers would simply stop tying and nobody could say why.
 *
 * So `resolveContractTermsAsOf(versions, date)` is the only supported way to read terms, and
 * every caller has to say *as of when*. There is deliberately no `getCurrentTerms()` — a caller
 * that does not know its own effective date is a caller that is about to compute something
 * against the wrong contract.
 *
 * Pure (no Firebase, no React) so the resolution and validation rules are unit-testable with
 * `node --test`.
 */

export const CONTRACT_VERSION_COLLECTION = "projectContractVersions";
export const CONTROL_SETUP_PERMISSION_RESOURCE = "Project Management.Control Setup";

/**
 * Why a version exists. `Original` is the contract as awarded and there is exactly one; the rest
 * each trace back to a document — an amendment, an approved variation, or a granted EOT — so a
 * change in value or completion date can always be attributed to the instrument that caused it.
 */
export const CONTRACT_SOURCE_TYPES = ["Original", "Amendment", "Variation", "EOT"] as const;
export type ContractSourceType = (typeof CONTRACT_SOURCE_TYPES)[number];

/**
 * The commercial terms in force at a point in time.
 *
 * Everything except `contractValue` is optional, because a project record is often created before
 * the contract is fully read — but `canActivateContract()` below is where the real bar sits, the
 * same split `validatePmProject` / `canActivateProject` already uses for the project itself.
 *
 * Percentages are stored as percentages (5 means 5%), not fractions, matching every other
 * percentage field in the application (`variationTolerancePct`, `retentionPct`, `ldRatePct`).
 */
export interface ContractTerms {
  /** Contract value excluding GST. GST is carried separately because it is a pass-through. */
  contractValue: number;
  gstPct?: number;
  /** Contractual commencement — what the completion period is measured from. */
  zeroDate?: string;
  /** Completion date under *this* version. An EOT version is how this moves. */
  contractCompletionDate?: string;
  retentionPct?: number;
  mobilisationAdvancePct?: number;
  /** Percentage of each bill applied against the outstanding advance. */
  advanceRecoveryPct?: number;
  ldPctPerWeek?: number;
  /** Ceiling on total LD, as a percentage of contract value. */
  ldCapPct?: number;
  performanceBgPct?: number;
  /** Used to cost delay (idle capital) and to compute ROI's financing charge. */
  interestRatePct?: number;
  labourCessPct?: number;
  insurancePct?: number;
}

export interface ContractVersion {
  id: string;
  globalProjectId: string;
  /** 0 for the original, incrementing thereafter. Ordering key alongside `effectiveFrom`. */
  version: number;
  /** What a user would call this revision — "Amendment 01", "EOT 01". */
  label: string;
  /** yyyy-mm-dd. The date these terms start applying. */
  effectiveFrom: string;
  sourceType: ContractSourceType;
  terms: ContractTerms;
  /** The e-approval request that sanctioned this version (§7.1). Absent on the original. */
  approvedVia?: string;
  note?: string;
  createdAt?: unknown;
  createdBy?: string;
  createdByName?: string;
  updatedAt?: unknown;
  updatedBy?: string;
  updatedByName?: string;
}

export type ContractVersionDraft = Omit<
  ContractVersion,
  "id" | "createdAt" | "createdBy" | "createdByName" | "updatedAt" | "updatedBy" | "updatedByName"
>;

export interface ContractValidationError {
  field: keyof ContractVersionDraft | keyof ContractTerms;
  message: string;
}

/* ── Reading terms ──────────────────────────────────────────────────────────────────────────── */

/** Ordering: by `effectiveFrom`, then by `version` so two amendments effective the same day
 *  resolve deterministically to the later one. */
function compareVersions(a: ContractVersion, b: ContractVersion): number {
  if (a.effectiveFrom !== b.effectiveFrom) return a.effectiveFrom < b.effectiveFrom ? -1 : 1;
  return a.version - b.version;
}

export function sortContractVersions(versions: readonly ContractVersion[]): ContractVersion[] {
  return [...versions].sort(compareVersions);
}

/**
 * The version in force on `asOfDate`, or null when the contract had not started by then.
 *
 * A version effective *on* the date counts — an amendment effective 01-Jun applies to a bill
 * dated 01-Jun. Versions with a future `effectiveFrom` are ignored, which is what makes it safe
 * to enter an amendment in advance of it taking effect.
 */
export function resolveContractVersionAsOf(
  versions: readonly ContractVersion[],
  asOfDate: string,
): ContractVersion | null {
  let winner: ContractVersion | null = null;
  for (const version of versions) {
    if (version.effectiveFrom > asOfDate) continue;
    if (!winner || compareVersions(version, winner) > 0) winner = version;
  }
  return winner;
}

/** The terms in force on `asOfDate`. Null rather than a default object: silently computing a
 *  bill against zeroed terms is the failure this whole module exists to prevent. */
export function resolveContractTermsAsOf(
  versions: readonly ContractVersion[],
  asOfDate: string,
): ContractTerms | null {
  return resolveContractVersionAsOf(versions, asOfDate)?.terms ?? null;
}

/** The original contract value — the denominator for "how much has this contract grown". */
export function originalContractValue(versions: readonly ContractVersion[]): number {
  const original = versions.find((version) => version.sourceType === "Original");
  if (original) return original.terms.contractValue;
  // No Original recorded (a mapping set up mid-project): fall back to the earliest version there
  // is, rather than reporting a growth figure measured from zero.
  return sortContractVersions(versions)[0]?.terms.contractValue ?? 0;
}

/** Contract value as most recently agreed, ignoring versions not yet in force. */
export function revisedContractValue(
  versions: readonly ContractVersion[],
  asOfDate: string,
): number {
  return resolveContractTermsAsOf(versions, asOfDate)?.contractValue ?? 0;
}

export interface ContractGrowth {
  originalValue: number;
  revisedValue: number;
  /** revised − original; negative when scope has been descoped. */
  varianceValue: number;
  variancePct: number;
}

export function computeContractGrowth(
  versions: readonly ContractVersion[],
  asOfDate: string,
): ContractGrowth {
  const originalValue = originalContractValue(versions);
  const revisedValue = revisedContractValue(versions, asOfDate);
  const varianceValue = Math.round((revisedValue - originalValue) * 100) / 100;
  return {
    originalValue,
    revisedValue,
    varianceValue,
    variancePct: originalValue
      ? Math.round((varianceValue / originalValue) * 1000) / 10
      : 0,
  };
}

/**
 * The completion date in force, and how far it has moved from the original.
 *
 * Kept here rather than in the baseline module because a contractual completion date is a term of
 * the contract; the baseline's *forecast* completion is a different number arrived at a different
 * way, and conflating the two is how a project ends up reporting an EOT it never received.
 */
export interface ContractCompletion {
  originalDate: string | null;
  currentDate: string | null;
  /** Days the contractual date has been extended by. 0 when no EOT has been granted. */
  extendedByDays: number;
}

export function computeContractCompletion(
  versions: readonly ContractVersion[],
  asOfDate: string,
): ContractCompletion {
  const sorted = sortContractVersions(versions);
  const originalDate =
    sorted.find((version) => version.sourceType === "Original")?.terms.contractCompletionDate ??
    sorted[0]?.terms.contractCompletionDate ??
    null;
  const currentDate = resolveContractTermsAsOf(versions, asOfDate)?.contractCompletionDate ?? null;
  return {
    originalDate: originalDate ?? null,
    currentDate: currentDate ?? null,
    extendedByDays: originalDate && currentDate ? wholeDaysBetween(originalDate, currentDate) : 0,
  };
}

/* ── Writing versions ───────────────────────────────────────────────────────────────────────── */

/** The next version number. Deliberately max+1 rather than length, so a deleted draft cannot
 *  cause a number to be reused. */
export function nextContractVersionNumber(versions: readonly ContractVersion[]): number {
  return versions.reduce((highest, version) => Math.max(highest, version.version), -1) + 1;
}

const PERCENT_FIELDS: Array<{ key: keyof ContractTerms; label: string }> = [
  { key: "gstPct", label: "GST" },
  { key: "retentionPct", label: "Retention" },
  { key: "mobilisationAdvancePct", label: "Mobilisation advance" },
  { key: "advanceRecoveryPct", label: "Advance recovery" },
  { key: "ldPctPerWeek", label: "LD per week" },
  { key: "ldCapPct", label: "Maximum LD" },
  { key: "performanceBgPct", label: "Performance BG" },
  { key: "interestRatePct", label: "Interest rate" },
  { key: "labourCessPct", label: "Labour cess" },
  { key: "insurancePct", label: "Insurance" },
];

/** Rules that apply at every save. Light, so a contract record can be started before every clause
 *  has been read out of the agreement. */
export function validateContractVersion(draft: ContractVersionDraft): ContractValidationError[] {
  const errors: ContractValidationError[] = [];

  if (!draft.label?.trim()) {
    errors.push({ field: "label", message: "Give this version a label, e.g. Amendment 01." });
  }
  if (!draft.effectiveFrom) {
    errors.push({ field: "effectiveFrom", message: "An effective-from date is required." });
  }
  if (!(draft.terms.contractValue > 0)) {
    errors.push({ field: "contractValue", message: "Contract value must be greater than zero." });
  }

  for (const field of PERCENT_FIELDS) {
    const value = draft.terms[field.key];
    if (value == null) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      errors.push({ field: field.key, message: `${field.label} must be a number.` });
    } else if (value < 0 || value > 100) {
      errors.push({ field: field.key, message: `${field.label} must be between 0 and 100%.` });
    }
  }

  const { zeroDate, contractCompletionDate } = draft.terms;
  if (zeroDate && contractCompletionDate && contractCompletionDate < zeroDate) {
    errors.push({
      field: "contractCompletionDate",
      message: "Completion date cannot be before the zero date.",
    });
  }

  // An advance with no recovery percentage is money that is never recovered. It is a real
  // configuration, but almost always a mistake, and it silently overstates every future bill.
  const advance = draft.terms.mobilisationAdvancePct ?? 0;
  const recovery = draft.terms.advanceRecoveryPct ?? 0;
  if (advance > 0 && recovery <= 0) {
    errors.push({
      field: "advanceRecoveryPct",
      message: "An advance is recorded but no recovery rate, so it would never be recovered.",
    });
  }

  return errors;
}

/**
 * The additional bar before terms are used to compute money. A version that will price a client
 * bill needs the deduction terms present — a blank retention percentage is indistinguishable from
 * a genuine zero once it reaches a bill, and the bill is the wrong place to discover it.
 */
export function canActivateContract(draft: ContractVersionDraft): ContractValidationError[] {
  const errors = validateContractVersion(draft);

  if (!draft.terms.zeroDate) {
    errors.push({ field: "zeroDate", message: "A zero date is required before activation." });
  }
  if (!draft.terms.contractCompletionDate) {
    errors.push({
      field: "contractCompletionDate",
      message: "A contract completion date is required before activation.",
    });
  }
  if (draft.terms.retentionPct == null) {
    errors.push({
      field: "retentionPct",
      message: "Set retention explicitly, as 0 if the contract has none.",
    });
  }

  return errors;
}

/**
 * Whether a new version may be added with this effective date.
 *
 * Backdating a version behind one already in force would retroactively change bills computed
 * against the later version — exactly the rewrite this module exists to prevent. Entering one
 * *ahead* of time is fine and expected.
 */
export function canAddContractVersion(
  versions: readonly ContractVersion[],
  effectiveFrom: string,
): { ok: boolean; reason?: string } {
  if (!effectiveFrom) return { ok: false, reason: "An effective-from date is required." };
  const latest = sortContractVersions(versions).at(-1);
  if (!latest) return { ok: true };
  if (effectiveFrom < latest.effectiveFrom) {
    return {
      ok: false,
      reason: `${latest.label} is already effective from ${latest.effectiveFrom}. A new version cannot take effect before it.`,
    };
  }
  return { ok: true };
}

/** The original version is the contract itself and is never removable; later versions are only
 *  removable while nothing has been computed against them, which the caller checks. */
export function canDeleteContractVersion(version: ContractVersion): boolean {
  return version.sourceType !== "Original";
}

/* ── Helpers ────────────────────────────────────────────────────────────────────────────────── */

const parseLocalDate = (value?: string): Date | null => {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function wholeDaysBetween(from: string, to: string): number {
  const start = parseLocalDate(from);
  const end = parseLocalDate(to);
  if (!start || !end) return 0;
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

export const contractSourceTypeStyles: Record<ContractSourceType, string> = {
  Original: "bg-slate-100 text-slate-700",
  Amendment: "bg-blue-100 text-blue-700",
  Variation: "bg-amber-100 text-amber-700",
  EOT: "bg-purple-100 text-purple-700",
};

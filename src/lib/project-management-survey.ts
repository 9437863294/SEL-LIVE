/**
 * The deviation engine — narrowest possible slice of the Survey module spec: record a surveyed
 * quantity per BOQ item and classify the deviation against the configured tolerance, without the
 * separate request/assignment workflow, offline capture, or evidence rules the full spec
 * describes. Surveyed quantities are stored directly on the BOQ item document (mirroring how
 * `variationApprovedQty` already works — see project-management-variations.ts) rather than in a
 * dedicated collection, since there's no survey-request lifecycle to track yet.
 */

export const SURVEY_PERMISSION_RESOURCE = "Project Management.Survey";

export const DEFAULT_PLAUSIBILITY_LIMIT_PCT = 200;

export const SURVEY_CLASSIFICATIONS = [
  "Not Surveyed",
  "Accepted Variance",
  "Variation Required",
  "Scope Reduction",
  "Suspected Error",
] as const;

export type SurveyClassification = (typeof SURVEY_CLASSIFICATIONS)[number];

export interface SurveyDeviation {
  deviation: number;
  deviationPct: number;
  classification: SurveyClassification;
}

/**
 * deviation      = surveyedQty − boqQty
 * deviationPct   = deviation / boqQty × 100
 *
 *   |dev%| ≤ tolerance            → Accepted Variance   (no action needed)
 *   dev%  > tolerance             → Variation Required   (claimable — raise a variation)
 *   dev%  < −tolerance            → Scope Reduction       (guard against over-procurement)
 *   |dev%| > plausibility limit   → Suspected Error       (blocked — re-survey, don't approve)
 */
export function classifySurveyDeviation(
  surveyedQty: number | null | undefined,
  boqQty: number,
  tolerancePct: number,
  plausibilityPct: number = DEFAULT_PLAUSIBILITY_LIMIT_PCT,
): SurveyDeviation {
  if (surveyedQty == null) {
    return { deviation: 0, deviationPct: 0, classification: "Not Surveyed" };
  }
  const deviation = surveyedQty - boqQty;
  const deviationPct = boqQty ? (deviation / boqQty) * 100 : surveyedQty > 0 ? 100 : 0;
  if (Math.abs(deviationPct) > plausibilityPct) {
    return { deviation, deviationPct, classification: "Suspected Error" };
  }
  if (deviationPct > tolerancePct) {
    return { deviation, deviationPct, classification: "Variation Required" };
  }
  if (deviationPct < -tolerancePct) {
    return { deviation, deviationPct, classification: "Scope Reduction" };
  }
  return { deviation, deviationPct, classification: "Accepted Variance" };
}

export const surveyClassificationStyles: Record<SurveyClassification, string> = {
  "Not Surveyed": "bg-muted text-muted-foreground",
  "Accepted Variance": "bg-emerald-100 text-emerald-700",
  "Variation Required": "bg-amber-100 text-amber-700",
  "Scope Reduction": "bg-blue-100 text-blue-700",
  "Suspected Error": "bg-red-100 text-red-700",
};

export const formatDeviationPct = (value: number) => `${value > 0 ? "+" : ""}${Math.round(value * 10) / 10}%`;

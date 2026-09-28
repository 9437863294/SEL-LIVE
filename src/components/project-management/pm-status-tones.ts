import type { StatusTone } from "@/lib/status-tone";

/**
 * The Project Management status words that mean more (or otherwise) than the app-wide vocabulary
 * reads them as. Everything not listed here takes its tone from the word itself; pass the result as
 * `StatusBadge`'s `tone`:
 *
 *   <StatusBadge status={po.status} tone={pmStatusTone(po.status)} />
 */
const PM_STATUS_TONE: Readonly<Record<string, StatusTone>> = {
  // RFQ / MVAC / DI outcomes the generic vocabulary does not know.
  Awarded: "success",
  Signed: "success",
  Held: "danger",
  Acknowledged: "info",
  // Inspection call and MDL stages.
  Called: "info",
  "With Client": "info",
  "Re-collect from Vendor": "danger",
  // An approval or pass that carries conditions is still something to act on.
  "Approved with Comments": "warning",
  "Passed with Punch Items": "warning",
  "Resubmission Required": "warning",
  "Received with Discrepancy": "warning",
  // Words that contain a positive term but mean its absence.
  "Not Received": "neutral",
  "Not Requested": "neutral",
  // Survey classifications.
  "Variation Required": "warning",
  "Scope Reduction": "info",
};

export function pmStatusTone(status: string | null | undefined): StatusTone | undefined {
  return status ? PM_STATUS_TONE[status] : undefined;
}

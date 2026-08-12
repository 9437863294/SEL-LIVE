/**
 * useRenewalPrefill — reads either
 *   ?renew=<docId>&vid=<vehicleId>&vnum=<vehicleNumber>&dname=<driverName>  (Renew Now flow)
 * or
 *   ?add=1&vid=<vehicleId>&vnum=<vehicleNumber>  (Add Now flow, for a vehicle with no record
 *   at all yet — e.g. the "Missing" badge on Vehicle Health)
 * from the URL and returns prefill data + the old doc ID to archive after save (renew only).
 *
 * Used by Insurance, PUC, Fitness, Road Tax, Permit, Driver, and Documents pages
 * to implement the Renewals Hub "Renew Now" flow and the Vehicle Health "Add Now" flow.
 */
'use client';

import { useSearchParams } from 'next/navigation';
import { useMemo } from 'react';

export type RenewalPrefill = {
  /** key→value map to pre-fill the Add form */
  prefill: Record<string, string> | undefined;
  /** Firestore doc ID of the old expired record to archive after save (unset for Add Now) */
  renewingFromId: string | undefined;
  /** Optional insurance workflow case closed after a successful renewal save. */
  workflowCaseId: string | undefined;
};

export function useRenewalPrefill(): RenewalPrefill {
  const searchParams = useSearchParams();

  return useMemo<RenewalPrefill>(() => {
    const renew = searchParams?.get('renew') || '';
    const addNew = searchParams?.get('add') === '1';
    const vid = searchParams?.get('vid') || '';
    const vnum = searchParams?.get('vnum') || '';
    const dname = searchParams?.get('dname') || '';
    const workflowCaseId = searchParams?.get('case') || '';

    if (!renew && !(addNew && vid)) {
      return { prefill: undefined, renewingFromId: undefined, workflowCaseId: workflowCaseId || undefined };
    }

    const prefill: Record<string, string> = {};

    // vehicleId → pre-selects the vehicle dropdown
    if (vid) {
      prefill.vehicleId = vid;
      prefill.assignedVehicleId = vid;
    }
    // vehicleNumber → display fallback (read-only computed field)
    if (vnum) prefill.vehicleNumber = vnum;
    // driverName → for Driver License renewal
    if (dname) prefill.driverName = dname;

    // Add Now has no prior record to archive, so renewingFromId stays unset.
    return { prefill, renewingFromId: renew || undefined, workflowCaseId: workflowCaseId || undefined };
  }, [searchParams]);
}

/**
 * useRenewalPrefill — reads ?renew=<docId>&vid=<vehicleId>&vnum=<vehicleNumber>&dname=<driverName>
 * from the URL and returns prefill data + the old doc ID to archive after save.
 *
 * Used by Insurance, PUC, Fitness, Road Tax, Permit, Driver, and Documents pages
 * to implement the Renewals Hub "Renew Now" flow.
 */
'use client';

import { useSearchParams } from 'next/navigation';
import { useMemo } from 'react';

export type RenewalPrefill = {
  /** key→value map to pre-fill the Add form */
  prefill: Record<string, string> | undefined;
  /** Firestore doc ID of the old expired record to archive after save */
  renewingFromId: string | undefined;
};

export function useRenewalPrefill(): RenewalPrefill {
  const searchParams = useSearchParams();

  return useMemo<RenewalPrefill>(() => {
    const renew = searchParams?.get('renew') || '';
    const vid = searchParams?.get('vid') || '';
    const vnum = searchParams?.get('vnum') || '';
    const dname = searchParams?.get('dname') || '';

    if (!renew) return { prefill: undefined, renewingFromId: undefined };

    const prefill: Record<string, string> = {};

    // vehicleId → pre-selects the vehicle dropdown
    if (vid) prefill.vehicleId = vid;
    // vehicleNumber → display fallback (read-only computed field)
    if (vnum) prefill.vehicleNumber = vnum;
    // driverName → for Driver License renewal
    if (dname) prefill.driverName = dname;

    return { prefill, renewingFromId: renew };
  }, [searchParams]);
}

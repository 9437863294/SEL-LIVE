'use client';

import { collection, doc, getDocs, query, updateDoc, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { computeRenewalMeta, VEHICLE_COLLECTIONS } from '@/lib/vehicle-management';

const checks = [
  { collectionName: VEHICLE_COLLECTIONS.insurance, expiryKey: 'expiryDate' },
  { collectionName: VEHICLE_COLLECTIONS.puc, expiryKey: 'expiryDate' },
  { collectionName: VEHICLE_COLLECTIONS.fitness, expiryKey: 'expiryDate' },
  { collectionName: VEHICLE_COLLECTIONS.roadTax, expiryKey: 'validTill' },
  { collectionName: VEHICLE_COLLECTIONS.permit, expiryKey: 'validTill' },
  { collectionName: VEHICLE_COLLECTIONS.documents, expiryKey: 'expiryDate' },
] as const;

export const syncVehicleComplianceStatus = async (vehicleId: string) => {
  if (!vehicleId) return;

  let expiredCount = 0;
  let dueSoonCount = 0;
  let validCount = 0;

  for (const check of checks) {
    const q = query(collection(db, check.collectionName), where('vehicleId', '==', vehicleId));
    const snapshot = await getDocs(q);
    snapshot.docs.forEach((entry) => {
      const expiry = String(entry.data()?.[check.expiryKey] || '');
      const meta = computeRenewalMeta(expiry);
      if (meta.complianceStatus === 'Expired') expiredCount += 1;
      else if (meta.complianceStatus === 'Due Soon') dueSoonCount += 1;
      else if (meta.complianceStatus === 'Valid') validCount += 1;
    });
  }

  const documentHealthStatus =
    expiredCount > 0 ? 'Expired' : dueSoonCount > 0 ? 'Due Soon' : validCount > 0 ? 'Valid' : 'Missing';

  await updateDoc(doc(db, VEHICLE_COLLECTIONS.vehicleMaster, vehicleId), {
    documentHealthStatus,
    hasExpiredDocuments: expiredCount > 0,
    documentAlertCount: expiredCount + dueSoonCount,
  });
};


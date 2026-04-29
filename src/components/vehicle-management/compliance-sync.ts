'use client';

import { collection, doc, getDoc, getDocs, query, updateDoc, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  computeRenewalMeta,
  getVehicleComplianceRequirements,
  VEHICLE_COLLECTIONS,
} from '@/lib/vehicle-management';

const checks = [
  { category: 'Insurance', collectionName: VEHICLE_COLLECTIONS.insurance, expiryKeys: ['expiryDate', 'validTill'] },
  { category: 'PUC', collectionName: VEHICLE_COLLECTIONS.puc, expiryKeys: ['expiryDate', 'validTill'] },
  { category: 'Fitness', collectionName: VEHICLE_COLLECTIONS.fitness, expiryKeys: ['expiryDate', 'validTill'] },
  { category: 'Road Tax', collectionName: VEHICLE_COLLECTIONS.roadTax, expiryKeys: ['validTill', 'expiryDate'] },
  { category: 'Permit', collectionName: VEHICLE_COLLECTIONS.permit, expiryKeys: ['validTill', 'expiryDate'] },
  { category: 'Documents', collectionName: VEHICLE_COLLECTIONS.documents, expiryKeys: ['expiryDate'] },
] as const;

export const syncVehicleComplianceStatus = async (vehicleId: string) => {
  if (!vehicleId) return;

  const vehicleSnap = await getDoc(doc(db, VEHICLE_COLLECTIONS.vehicleMaster, vehicleId));
  const vehicle = vehicleSnap.exists() ? (vehicleSnap.data() as Record<string, any>) : {};
  const required = getVehicleComplianceRequirements(vehicle);

  let expiredCount = 0;
  let dueSoonCount = 0;
  let validCount = 0;

  for (const check of checks) {
    const isRequired =
      check.category === 'Insurance'
        ? required.insurance
        : check.category === 'PUC'
        ? required.puc
        : check.category === 'Fitness'
        ? required.fitness
        : check.category === 'Road Tax'
        ? required.roadTax
        : check.category === 'Permit'
        ? required.permit
        : true;

    if (!isRequired) continue;

    const q = query(collection(db, check.collectionName), where('vehicleId', '==', vehicleId));
    const snapshot = await getDocs(q);
    if (snapshot.empty) continue;

    let latestExpiry = '';
    let latestStamp = 0;
    snapshot.docs.forEach((entry) => {
      const data = entry.data() as Record<string, any>;
      const expiry =
        check.expiryKeys
          .map((key) => String(data[key] || '').trim())
          .find((value) => value.length > 0) || '';
      const stamp = Number.isNaN(new Date(expiry).getTime())
        ? typeof data.createdAt?.seconds === 'number'
          ? Number(data.createdAt.seconds) * 1000
          : 0
        : new Date(expiry).getTime();
      if (stamp >= latestStamp) {
        latestStamp = stamp;
        latestExpiry = expiry;
      }
    });

    const meta = computeRenewalMeta(latestExpiry);
    if (meta.complianceStatus === 'Expired') expiredCount += 1;
    else if (meta.complianceStatus === 'Due Soon') dueSoonCount += 1;
    else if (meta.complianceStatus === 'Valid') validCount += 1;
  }

  const documentHealthStatus =
    expiredCount > 0 ? 'Expired' : dueSoonCount > 0 ? 'Due Soon' : validCount > 0 ? 'Valid' : 'Missing';

  await updateDoc(doc(db, VEHICLE_COLLECTIONS.vehicleMaster, vehicleId), {
    documentHealthStatus,
    hasExpiredDocuments: expiredCount > 0,
    documentAlertCount: expiredCount + dueSoonCount,
  });
};

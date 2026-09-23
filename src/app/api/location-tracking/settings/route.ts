import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import {
  LOCATION_SETTINGS_COLLECTION,
  locationErrorResponse,
  LocationAccessError,
  requireLocationOtpSession,
} from '@/lib/location-tracking-admin';

export const runtime = 'nodejs';

const MIN_INTERVAL_SECONDS = 30;
const MAX_INTERVAL_SECONDS = 3600;
const DEFAULT_INTERVAL_SECONDS = 60;

const timestampToIso = (value: unknown) => {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }
  return null;
};

export async function GET(request: Request) {
  try {
    await requireLocationOtpSession(request, 'View');
    const firestore = getFirebaseAdminFirestore();
    const [usersSnapshot, settingsSnapshot, locationsSnapshot, employeesSnapshot] = await Promise.all([
      firestore.collection('users').get(),
      firestore.collection(LOCATION_SETTINGS_COLLECTION).get(),
      firestore.collection('userLocations').get(),
      // The greytHR mirror, for each row's job title. The client renders it under the name where it
      // used to render `role`, which is a permission bundle and says nothing about who the person
      // is. Failing soft: a row with no HR record falls back to its role, as it always did.
      firestore.collection('employees').get().catch(() => null),
    ]);

    const settingsByUser = new Map(settingsSnapshot.docs.map((snapshot) => [snapshot.id, snapshot.data()]));
    const locationsByUser = new Map(locationsSnapshot.docs.map((snapshot) => [snapshot.id, snapshot.data()]));

    /*
     * The employee master keyed every way the join can arrive: `users.employeeId` has been written
     * from the document id, greytHR's numeric id and the employee number, and email is the fallback
     * for accounts created before the linking screen existed. Mirrors `buildEmployeeFactsIndex` in
     * `src/lib/people-directory.ts`, which this route cannot import because it runs on the Admin SDK.
     */
    const designationByKey = new Map<string, string>();
    for (const snapshot of employeesSnapshot?.docs ?? []) {
      const employee = snapshot.data();
      const designation = String(employee.designation || '').trim();
      if (!designation) continue;
      for (const key of [snapshot.id, employee.employeeId, employee.employeeNo]) {
        const id = String(key ?? '').trim();
        if (id && !designationByKey.has(id)) designationByKey.set(id, designation);
      }
      const email = String(employee.email || '').trim().toLowerCase();
      if (email && !designationByKey.has(email)) designationByKey.set(email, designation);
    }
    const users = usersSnapshot.docs
      .map((snapshot) => {
        const data = snapshot.data();
        const setting = settingsByUser.get(snapshot.id);
        const location = locationsByUser.get(snapshot.id);
        const latitude = Number(location?.latitude);
        const longitude = Number(location?.longitude);
        return {
          id: snapshot.id,
          name: String(data.name || ''),
          email: String(data.email || ''),
          role: String(data.role || ''),
          designation:
            designationByKey.get(String(data.employeeId ?? '').trim()) ??
            designationByKey.get(String(data.employeeNo ?? '').trim()) ??
            designationByKey.get(String(data.email || '').trim().toLowerCase()) ??
            '',
          status: data.status === 'Inactive' ? 'Inactive' : 'Active',
          photoURL: typeof data.photoURL === 'string' ? data.photoURL : '',
          enabled: setting?.enabled === true,
          intervalSeconds: Math.min(
            MAX_INTERVAL_SECONDS,
            Math.max(MIN_INTERVAL_SECONDS, Number(setting?.intervalSeconds) || DEFAULT_INTERVAL_SECONDS)
          ),
          location: Number.isFinite(latitude) && Number.isFinite(longitude)
            ? {
                latitude,
                longitude,
                accuracy: Number.isFinite(Number(location?.accuracy)) ? Number(location?.accuracy) : null,
                platform: typeof location?.platform === 'string' ? location.platform : null,
                lastFetchRequestId:
                  typeof location?.lastFetchRequestId === 'string' ? location.lastFetchRequestId : null,
                updatedAtIso:
                  (typeof location?.updatedAtIso === 'string' ? location.updatedAtIso : null) ||
                  timestampToIso(location?.updatedAt),
              }
            : null,
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name));

    return Response.json({ users });
  } catch (error) {
    return locationErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await requireLocationOtpSession(request, 'Edit');
    const body = await request.json();
    const userId = String(body?.userId || '').trim();
    const action = String(body?.action || '').trim();
    const enabled = body?.enabled;
    const intervalSeconds = Math.round(Number(body?.intervalSeconds));
    if (!userId) throw new LocationAccessError('User is required.', 400);

    const firestore = getFirebaseAdminFirestore();
    const userSnapshot = await firestore.collection('users').doc(userId).get();
    if (!userSnapshot.exists) throw new LocationAccessError('Selected user was not found.', 404);

    if (action === 'fetch-current') {
      const settingRef = firestore.collection(LOCATION_SETTINGS_COLLECTION).doc(userId);
      const settingSnapshot = await settingRef.get();
      if (settingSnapshot.data()?.enabled !== true) {
        throw new LocationAccessError('Enable Required before fetching this user’s location.', 409);
      }

      const fetchRequestId = randomUUID();
      const requestedAtMs = Date.now();
      await settingRef.set({
        userId,
        fetchRequestId,
        fetchRequestedAtMs: requestedAtMs,
        fetchRequestedAt: FieldValue.serverTimestamp(),
        fetchRequestedBy: actor.id,
        fetchRequestedByName: actor.name,
      }, { merge: true });

      return Response.json({ request: { userId, fetchRequestId, requestedAtMs } });
    }

    if (!userId || typeof enabled !== 'boolean') {
      throw new LocationAccessError('User and tracking status are required.', 400);
    }
    if (
      !Number.isFinite(intervalSeconds) ||
      intervalSeconds < MIN_INTERVAL_SECONDS ||
      intervalSeconds > MAX_INTERVAL_SECONDS
    ) {
      throw new LocationAccessError('Capture interval must be between 30 seconds and 60 minutes.', 400);
    }

    await firestore.collection(LOCATION_SETTINGS_COLLECTION).doc(userId).set({
      userId,
      enabled,
      intervalSeconds,
      updatedBy: actor.id,
      updatedByName: actor.name,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return Response.json({ setting: { userId, enabled, intervalSeconds } });
  } catch (error) {
    return locationErrorResponse(error);
  }
}

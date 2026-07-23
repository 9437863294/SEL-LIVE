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
    const [usersSnapshot, settingsSnapshot, locationsSnapshot] = await Promise.all([
      firestore.collection('users').get(),
      firestore.collection(LOCATION_SETTINGS_COLLECTION).get(),
      firestore.collection('userLocations').get(),
    ]);

    const settingsByUser = new Map(settingsSnapshot.docs.map((snapshot) => [snapshot.id, snapshot.data()]));
    const locationsByUser = new Map(locationsSnapshot.docs.map((snapshot) => [snapshot.id, snapshot.data()]));
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
    const enabled = body?.enabled;
    const intervalSeconds = Math.round(Number(body?.intervalSeconds));

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

    const firestore = getFirebaseAdminFirestore();
    const userSnapshot = await firestore.collection('users').doc(userId).get();
    if (!userSnapshot.exists) throw new LocationAccessError('Selected user was not found.', 404);

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

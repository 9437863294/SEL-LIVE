import { getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import {
  locationErrorResponse,
  LocationAccessError,
  requireLocationOtpSession,
} from '@/lib/location-tracking-admin';

export const runtime = 'nodejs';

const timestampToIso = (value: unknown) => {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }
  return null;
};

const serializeLocation = (id: string, data: Record<string, unknown>, latestSnapshot = false) => {
  const latitude = Number(data.latitude);
  const longitude = Number(data.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  return {
    id,
    latitude,
    longitude,
    accuracy: Number.isFinite(Number(data.accuracy)) ? Number(data.accuracy) : null,
    heading: Number.isFinite(Number(data.heading)) ? Number(data.heading) : null,
    speed: Number.isFinite(Number(data.speed)) ? Number(data.speed) : null,
    platform: typeof data.platform === 'string' ? data.platform : null,
    capturedAtIso:
      (typeof data.capturedAtIso === 'string' ? data.capturedAtIso : null) ||
      timestampToIso(data.capturedAt) ||
      (typeof data.updatedAtIso === 'string' ? data.updatedAtIso : null) ||
      timestampToIso(data.updatedAt),
    latestSnapshot,
  };
};

export async function GET(request: Request) {
  try {
    await requireLocationOtpSession(request, 'View');
    const url = new URL(request.url);
    const userId = String(url.searchParams.get('userId') || '').trim();
    const requestedLimit = Number(url.searchParams.get('limit') || 200);
    const resultLimit = Math.min(500, Math.max(1, Math.round(requestedLimit) || 200));
    if (!userId) throw new LocationAccessError('User is required.', 400);

    const firestore = getFirebaseAdminFirestore();
    const userRef = firestore.collection('users').doc(userId);
    const latestRef = firestore.collection('userLocations').doc(userId);
    const [userSnapshot, latestSnapshot, historySnapshot] = await Promise.all([
      userRef.get(),
      latestRef.get(),
      latestRef.collection('history').orderBy('capturedAt', 'desc').limit(resultLimit).get(),
    ]);

    if (!userSnapshot.exists) throw new LocationAccessError('Selected user was not found.', 404);

    const history = historySnapshot.docs
      .map((snapshot) => serializeLocation(snapshot.id, snapshot.data()))
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

    if (!history.length && latestSnapshot.exists) {
      const latest = serializeLocation('latest', latestSnapshot.data() || {}, true);
      if (latest) history.push(latest);
    }

    return Response.json({
      user: {
        id: userSnapshot.id,
        name: String(userSnapshot.data()?.name || ''),
        email: String(userSnapshot.data()?.email || ''),
      },
      history,
    });
  } catch (error) {
    return locationErrorResponse(error);
  }
}

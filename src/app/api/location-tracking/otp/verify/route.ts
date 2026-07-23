import { timingSafeEqual } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import {
  authenticateLocationAdmin,
  hashLocationOtp,
  hashOpaqueToken,
  LOCATION_ACCESS_TTL_MS,
  LOCATION_OTP_CHALLENGES_COLLECTION,
  LOCATION_OTP_MAX_ATTEMPTS,
  LOCATION_OTP_SESSIONS_COLLECTION,
  locationErrorResponse,
  LocationAccessError,
  newOpaqueToken,
} from '@/lib/location-tracking-admin';

export const runtime = 'nodejs';

const safeHashEqual = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

export async function POST(request: Request) {
  try {
    const actor = await authenticateLocationAdmin(request, 'View');
    const body = await request.json();
    const challengeId = String(body?.challengeId || '').trim();
    const otp = String(body?.otp || '').replace(/\D/g, '').slice(0, 6);
    if (!challengeId || otp.length !== 6) {
      throw new LocationAccessError('Enter the complete 6-digit verification code.', 400);
    }

    const firestore = getFirebaseAdminFirestore();
    const accessToken = newOpaqueToken();
    const expiresAtMs = Date.now() + LOCATION_ACCESS_TTL_MS;
    const challengeRef = firestore.collection(LOCATION_OTP_CHALLENGES_COLLECTION).doc(challengeId);
    const sessionRef = firestore
      .collection(LOCATION_OTP_SESSIONS_COLLECTION)
      .doc(hashOpaqueToken(accessToken));

    const outcome = await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(challengeRef);
      const data = snapshot.data();
      if (!snapshot.exists || data?.userId !== actor.id) {
        return { ok: false, message: 'Verification request was not found.', status: 400 };
      }
      if (data?.consumed === true || Number(data?.expiresAtMs || 0) <= Date.now()) {
        return { ok: false, message: 'This verification code has expired. Request a new one.', status: 400 };
      }

      const attempts = Number(data?.attempts || 0);
      if (attempts >= LOCATION_OTP_MAX_ATTEMPTS) {
        return { ok: false, message: 'Too many incorrect attempts. Request a new code.', status: 429 };
      }

      const expectedHash = String(data?.codeHash || '');
      const providedHash = hashLocationOtp(challengeId, otp);
      if (!expectedHash || !safeHashEqual(expectedHash, providedHash)) {
        transaction.update(challengeRef, { attempts: attempts + 1 });
        return {
          ok: false,
          message: `Incorrect code. ${LOCATION_OTP_MAX_ATTEMPTS - attempts - 1} attempt(s) remaining.`,
          status: 400,
        };
      }

      transaction.update(challengeRef, {
        consumed: true,
        consumedAt: FieldValue.serverTimestamp(),
      });
      transaction.set(sessionRef, {
        userId: actor.id,
        email: actor.email,
        createdAt: FieldValue.serverTimestamp(),
        expiresAtMs,
        revoked: false,
      });
      return { ok: true, message: '', status: 200 };
    });

    if (!outcome.ok) throw new LocationAccessError(outcome.message, outcome.status);
    return Response.json({ accessToken, expiresAtMs });
  } catch (error) {
    return locationErrorResponse(error);
  }
}

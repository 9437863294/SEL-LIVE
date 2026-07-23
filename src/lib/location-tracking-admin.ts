import 'server-only';

import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { getFirebaseAdminAuth, getFirebaseAdminFirestore } from '@/lib/firebase-admin';

export const LOCATION_SETTINGS_COLLECTION = 'userLocationSettings';
export const LOCATION_OTP_CHALLENGES_COLLECTION = 'locationTrackingOtpChallenges';
export const LOCATION_OTP_SESSIONS_COLLECTION = 'locationTrackingAccessSessions';
export const LOCATION_OTP_RATE_LIMITS_COLLECTION = 'locationTrackingOtpRateLimits';
export const LOCATION_OTP_TTL_MS = 10 * 60 * 1000;
export const LOCATION_ACCESS_TTL_MS = 15 * 60 * 1000;
export const LOCATION_OTP_RESEND_MS = 60 * 1000;
export const LOCATION_OTP_MAX_ATTEMPTS = 5;

export class LocationAccessError extends Error {
  constructor(message: string, public status = 403) {
    super(message);
  }
}

function bearerToken(request: Request) {
  const authorization = request.headers.get('authorization') || '';
  return authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
}

function otpSecret() {
  const secret =
    process.env.LOCATION_OTP_SECRET ||
    process.env.FIREBASE_PRIVATE_KEY ||
    process.env.SMTP_PASS;
  if (!secret) throw new LocationAccessError('Location OTP service is not configured.', 503);
  return secret;
}

export function hashLocationOtp(challengeId: string, otp: string) {
  return createHmac('sha256', otpSecret()).update(`${challengeId}:${otp}`).digest('hex');
}

export function newOpaqueToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function hashOpaqueToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function verifyLocationAdminPassword(password: string) {
  const encodedHash = String(process.env.LOCATION_TRACKING_ADMIN_PASSWORD_HASH || '').trim();
  if (!encodedHash) {
    throw new LocationAccessError('Location administrator password is not configured.', 503);
  }

  const [algorithm, salt, expectedHex] = encodedHash.split('$');
  if (
    algorithm !== 'scrypt' ||
    !/^[a-f0-9]{32}$/i.test(salt || '') ||
    !/^[a-f0-9]{128}$/i.test(expectedHex || '')
  ) {
    throw new LocationAccessError('Location administrator password configuration is invalid.', 503);
  }

  const expected = Buffer.from(expectedHex, 'hex');
  const provided = scryptSync(password, salt, expected.length);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

async function resolveAppUser(decodedToken: DecodedIdToken) {
  const firestore = getFirebaseAdminFirestore();
  let userSnapshot = await firestore.collection('users').doc(decodedToken.uid).get();

  if (!userSnapshot.exists) {
    const normalizedEmail = String(decodedToken.email || '').trim().toLowerCase();
    if (normalizedEmail) {
      const emailUsers = await firestore
        .collection('users')
        .where('email', '==', normalizedEmail)
        .limit(1)
        .get();
      if (!emailUsers.empty) userSnapshot = emailUsers.docs[0];
    }
  }

  if (!userSnapshot.exists) {
    throw new LocationAccessError('Authenticated account is not linked to an application user.', 401);
  }

  return {
    id: userSnapshot.id,
    name: String(userSnapshot.data()?.name || 'Administrator'),
    email: String(userSnapshot.data()?.email || decodedToken.email || '').trim().toLowerCase(),
    role: String(userSnapshot.data()?.role || ''),
  };
}

export async function authenticateLocationAdmin(request: Request, action: 'View' | 'Edit') {
  const token = bearerToken(request);
  if (!token) throw new LocationAccessError('Unauthorized.', 401);

  let decodedToken: DecodedIdToken;
  try {
    decodedToken = await getFirebaseAdminAuth().verifyIdToken(token);
  } catch {
    throw new LocationAccessError('Your sign-in session is invalid or expired.', 401);
  }

  const actor = await resolveAppUser(decodedToken);
  if (!actor.email || !actor.role) {
    throw new LocationAccessError('Your account requires an email address and assigned role.', 403);
  }

  const roles = await getFirebaseAdminFirestore()
    .collection('roles')
    .where('name', '==', actor.role)
    .limit(1)
    .get();
  const permissions = (roles.docs[0]?.data()?.permissions || {}) as Record<string, string[]>;
  if (!permissions['Settings.Location Tracking']?.includes(action)) {
    throw new LocationAccessError(`Location Tracking ${action.toLowerCase()} permission is required.`, 403);
  }

  return actor;
}

export async function requireLocationOtpSession(request: Request, action: 'View' | 'Edit') {
  const actor = await authenticateLocationAdmin(request, action);
  const accessToken = String(request.headers.get('x-location-otp-token') || '').trim();
  if (!accessToken) throw new LocationAccessError('Email OTP verification is required.', 401);

  const session = await getFirebaseAdminFirestore()
    .collection(LOCATION_OTP_SESSIONS_COLLECTION)
    .doc(hashOpaqueToken(accessToken))
    .get();
  const data = session.data();
  if (
    !session.exists ||
    data?.userId !== actor.id ||
    Number(data?.expiresAtMs || 0) <= Date.now() ||
    data?.revoked === true
  ) {
    throw new LocationAccessError('Email OTP session has expired. Verify again.', 401);
  }

  return actor;
}

export function locationErrorResponse(error: unknown) {
  const status = error instanceof LocationAccessError ? error.status : 500;
  const message = error instanceof Error ? error.message : 'Unexpected location tracking error.';
  if (status >= 500) console.error('[location-tracking]', error);
  return Response.json({ error: message }, { status });
}

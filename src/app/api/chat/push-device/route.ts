import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import { getFirebaseAdminAuth, getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import { resolveAuthenticatedAppUserId } from '@/lib/chat-push-server';

export const runtime = 'nodejs';

/** Device platforms push delivery knows how to tailor a message for. */
const PLATFORMS = new Set(['android', 'ios', 'web']);

function getBearerToken(request: Request) {
  const authorization = request.headers.get('authorization') || '';
  return authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
}

function deviceDocumentId(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * The server cannot check credentials at all — as opposed to the caller's being bad.
 *
 * Distinguished from an authentication failure because the two need opposite responses: one is
 * "sign in again", the other is "an environment variable is missing on the server". Collapsing them
 * into a single 401 sent developers hunting through auth code for a config problem.
 */
class AdminUnavailableError extends Error {}

async function authenticate(request: Request) {
  const bearerToken = getBearerToken(request);
  if (!bearerToken) throw new Error('Missing authorization token.');

  // Getting the Admin SDK is separated from verifying the token: `getAdminApp()` throws when the
  // service-account variables are missing, which is the normal state of a local checkout.
  let adminAuth: ReturnType<typeof getFirebaseAdminAuth>;
  try {
    adminAuth = getFirebaseAdminAuth();
  } catch (error) {
    throw new AdminUnavailableError(
      error instanceof Error ? error.message : 'Firebase Admin is not configured.',
    );
  }

  const decodedToken = await adminAuth.verifyIdToken(bearerToken);
  const userId = await resolveAuthenticatedAppUserId(decodedToken);
  return { decodedToken, userId };
}

/**
 * Whether the "Admin is not configured" notice has already been printed this process.
 *
 * Every page load attempts a push registration, so without this a local checkout prints a
 * stack-traced error on every navigation for a condition that is static, expected, and already
 * understood. It is a configuration state, not an incident — worth saying once, not forty times.
 */
let warnedAdminUnavailable = false;

/** Shared failure response, so POST and DELETE cannot drift apart on what a status code means. */
function deviceErrorResponse(error: unknown, action: 'registration' | 'removal') {
  if (error instanceof AdminUnavailableError) {
    if (!warnedAdminUnavailable) {
      warnedAdminUnavailable = true;
      console.warn(
        '[push] Firebase Admin credentials are not configured — push device registration is '
          + 'disabled. Run `npm run firebase:admin-check`, then '
          + '`npm run firebase:admin-env <service-account.json>`. Nothing else is affected.',
      );
    }
    return NextResponse.json(
      {
        error: 'Push notifications are unavailable: Firebase Admin credentials are not configured '
          + 'on the server. Run `npm run firebase:admin-check` to see what is missing, then '
          + '`npm run firebase:admin-env <service-account.json>` to set it. Nothing else is affected.',
      },
      { status: 503 },
    );
  }

  // A genuine failure still gets the full stack — that one does need debugging.
  console.error(`Push device ${action} failed:`, error);
  return NextResponse.json(
    { error: `Unauthorized or invalid device ${action}.` },
    { status: 401 },
  );
}

export async function POST(request: Request) {
  try {
    const { userId } = await authenticate(request);
    const body = await request.json();
    const token = String(body?.token || '').trim();
    if (!token || token.length > 4096) {
      return NextResponse.json({ error: 'A valid push token is required.' }, { status: 400 });
    }

    const deviceRef = getFirebaseAdminFirestore()
      .collection('users')
      .doc(userId)
      .collection('pushDevices')
      .doc(deviceDocumentId(token));

    await deviceRef.set({
      token,
      // 'web' joins the native platforms now that browsers register here too. The
      // value drives per-platform FCM options (APNs headers, Android channel,
      // webpush link) in lib/push-server.ts, so an unrecognised value would silently
      // get Android treatment — hence the explicit allowlist rather than a passthrough.
      platform: PLATFORMS.has(body?.platform) ? body.platform : 'android',
      enabled: true,
      // Whether this device should receive chat pushes specifically. Module alerts go
      // to every enabled device; chat is suppressed for users who cannot see it,
      // which is how the old "unregister the device entirely" behaviour is preserved
      // without also cutting off every other module's notifications.
      chatEnabled: body?.chatEnabled !== false,
      updatedAt: FieldValue.serverTimestamp(),
      registeredAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return NextResponse.json({ success: true });
  } catch (error) {
    return deviceErrorResponse(error, 'registration');
  }
}

export async function DELETE(request: Request) {
  try {
    const { userId } = await authenticate(request);
    const body = await request.json();
    const token = String(body?.token || '').trim();
    if (!token) return NextResponse.json({ success: true });

    await getFirebaseAdminFirestore()
      .collection('users')
      .doc(userId)
      .collection('pushDevices')
      .doc(deviceDocumentId(token))
      .delete();

    return NextResponse.json({ success: true });
  } catch (error) {
    return deviceErrorResponse(error, 'removal');
  }
}


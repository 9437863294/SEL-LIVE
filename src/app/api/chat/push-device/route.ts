import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import { getFirebaseAdminAuth, getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import { resolveAuthenticatedAppUserId } from '@/lib/chat-push-server';

export const runtime = 'nodejs';

function getBearerToken(request: Request) {
  const authorization = request.headers.get('authorization') || '';
  return authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
}

function deviceDocumentId(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

async function authenticate(request: Request) {
  const bearerToken = getBearerToken(request);
  if (!bearerToken) throw new Error('Missing authorization token.');
  const decodedToken = await getFirebaseAdminAuth().verifyIdToken(bearerToken);
  const userId = await resolveAuthenticatedAppUserId(decodedToken);
  return { decodedToken, userId };
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
      platform: body?.platform === 'ios' ? 'ios' : 'android',
      enabled: true,
      updatedAt: FieldValue.serverTimestamp(),
      registeredAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Push device registration failed:', error);
    return NextResponse.json({ error: 'Unauthorized or invalid device registration.' }, { status: 401 });
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
    console.error('Push device removal failed:', error);
    return NextResponse.json({ error: 'Unauthorized device removal.' }, { status: 401 });
  }
}


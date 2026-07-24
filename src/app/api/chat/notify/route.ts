import { type DocumentReference } from 'firebase-admin/firestore';
import { after, NextResponse } from 'next/server';
import {
  getFirebaseAdminAuth,
  getFirebaseAdminDatabase,
  getFirebaseAdminFirestore,
  getFirebaseAdminMessaging,
} from '@/lib/firebase-admin';
import { resolveAuthenticatedAppUserId } from '@/lib/chat-push-server';

export const runtime = 'nodejs';

type PushDevice = {
  token: string;
  ref: DocumentReference;
};

const INVALID_TOKEN_CODES = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
]);

function bearerToken(request: Request) {
  const authorization = request.headers.get('authorization') || '';
  return authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
}

async function deliverChatNotification(
  token: string,
  conversationId: string,
  messageId: string
) {
    const decodedToken = await getFirebaseAdminAuth().verifyIdToken(token);
    const senderUserId = await resolveAuthenticatedAppUserId(decodedToken);
    const realtimeDatabase = getFirebaseAdminDatabase();
    const conversationRef = realtimeDatabase.ref(`chatConversations/${conversationId}`);
    const messageRef = realtimeDatabase.ref(`chatMessages/${conversationId}/${messageId}`);
    const [conversationSnapshot, messageSnapshot] = await Promise.all([
      conversationRef.once('value'),
      messageRef.once('value'),
    ]);

    if (!conversationSnapshot.exists() || !messageSnapshot.exists()) {
      throw new Error('Chat message not found.');
    }

    const conversation = conversationSnapshot.val() || {};
    const message = messageSnapshot.val() || {};
    const memberIds: string[] = Array.isArray(conversation.memberIds)
      ? conversation.memberIds.filter((id: unknown): id is string => typeof id === 'string')
      : Object.entries(conversation.memberIds || {})
          .filter(([, included]) => included)
          .map(([memberId]) => memberId);
    if (!memberIds.includes(senderUserId) || message.senderId !== senderUserId) {
      throw new Error('Not permitted to notify this conversation.');
    }

    if (message.pushNotifiedAt) return;

    const firestore = getFirebaseAdminFirestore();
    const recipientIds: string[] = memberIds.filter((memberId: string) => memberId !== senderUserId);
    const deviceSnapshots = await Promise.all(
      recipientIds.map((recipientId) =>
        firestore
          .collection('users')
          .doc(recipientId)
          .collection('pushDevices')
          .where('enabled', '==', true)
          .get()
      )
    );

    const devicesByToken = new Map<string, PushDevice>();
    deviceSnapshots.forEach((snapshot) => {
      snapshot.docs.forEach((deviceDocument) => {
        const pushToken = String(deviceDocument.data().token || '').trim();
        if (pushToken) devicesByToken.set(pushToken, { token: pushToken, ref: deviceDocument.ref });
      });
    });
    const devices = Array.from(devicesByToken.values()).slice(0, 500);

    if (!devices.length) {
      await messageRef.update({ pushNotifiedAt: Date.now(), pushDeliveryCount: 0 });
      return;
    }

    const senderName = String(message.senderName || 'New message').slice(0, 100);
    const firstAttachment = Array.isArray(message.attachments) ? message.attachments[0] : undefined;
    const attachmentLabels: Record<string, string> = {
      image: '📷 Photo',
      video: '🎥 Video',
      audio: '🎤 Voice message',
      file: `📎 ${String(firstAttachment?.name || 'Document')}`,
    };
    const messageText = String(
      message.text || attachmentLabels[String(message.type)] || 'You received a new message.'
    ).slice(0, 240);
    const response = await getFirebaseAdminMessaging().sendEach(
      devices.map((device) => ({
        token: device.token,
        notification: {
          title: conversation.type === 'group'
            ? `${senderName} · ${String(conversation.name || 'Group')}`
            : senderName,
          body: messageText,
        },
        data: {
          type: 'chat_message',
          conversationId,
          messageId,
          senderId: senderUserId,
        },
        android: {
          priority: 'high' as const,
          notification: {
            channelId: 'sel_chat_messages',
            sound: 'default',
            tag: conversationId,
            visibility: 'private' as const,
          },
        },
      }))
    );

    const invalidDeviceDeletes: Promise<unknown>[] = [];
    response.responses.forEach((sendResponse, index) => {
      if (!sendResponse.success && sendResponse.error?.code && INVALID_TOKEN_CODES.has(sendResponse.error.code)) {
        invalidDeviceDeletes.push(devices[index].ref.delete());
      }
    });
    await Promise.allSettled(invalidDeviceDeletes);
    await messageRef.update({
      pushNotifiedAt: Date.now(),
      pushDeliveryCount: response.successCount,
      pushFailureCount: response.failureCount,
    });
}

export async function POST(request: Request) {
  const token = bearerToken(request);
  if (!token) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const conversationId = String(body?.conversationId || '').trim();
  const messageId = String(body?.messageId || '').trim();
  if (!conversationId || !messageId) {
    return NextResponse.json(
      { error: 'Conversation and message are required.' },
      { status: 400 }
    );
  }

  after(async () => {
    try {
      await deliverChatNotification(token, conversationId, messageId);
    } catch (error) {
      console.error('Asynchronous chat push delivery failed:', error);
    }
  });

  return NextResponse.json({ success: true, queued: true }, { status: 202 });
}

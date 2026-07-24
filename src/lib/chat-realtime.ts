import {
  get,
  increment,
  limitToLast,
  onValue,
  orderByChild,
  push,
  query,
  ref,
  runTransaction,
  serverTimestamp,
  update,
  type Unsubscribe,
} from 'firebase/database';
import { realtimeDb } from '@/lib/firebase';
import type { ChatConversation, ChatMessage } from '@/lib/chat';

type RealtimeConversation = Omit<ChatConversation, 'id' | 'memberIds'> & {
  memberIds?: Record<string, boolean> | string[];
};

const conversationPath = (conversationId: string) => `chatConversations/${conversationId}`;
const messagesPath = (conversationId: string) => `chatMessages/${conversationId}`;
const userConversationPath = (userId: string, conversationId: string) =>
  `chatUserConversations/${userId}/${conversationId}`;

function memberMap(memberIds: string[]) {
  return Object.fromEntries(memberIds.map((memberId) => [memberId, true]));
}

function normalizeMemberIds(value: RealtimeConversation['memberIds']) {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return Object.entries(value || {})
    .filter(([, isMember]) => isMember)
    .map(([memberId]) => memberId);
}

function normalizeConversation(id: string, value: RealtimeConversation): ChatConversation {
  return {
    ...value,
    id,
    memberIds: normalizeMemberIds(value.memberIds),
  };
}

export function newRealtimeKey(path: string) {
  const key = push(ref(realtimeDb, path)).key;
  if (!key) throw new Error('Unable to allocate a Realtime Database key.');
  return key;
}

export function listenToUserConversations(
  userId: string,
  onConversations: (conversations: ChatConversation[]) => void,
  onError: (error: Error) => void
) {
  const conversationValues = new Map<string, ChatConversation>();
  const conversationListeners = new Map<string, Unsubscribe>();

  const emit = () => onConversations(Array.from(conversationValues.values()));
  const stopIndexListener = onValue(
    ref(realtimeDb, `chatUserConversations/${userId}`),
    (indexSnapshot) => {
      const indexedIds = new Set(
        Object.entries(indexSnapshot.val() || {})
          .filter(([, included]) => included)
          .map(([conversationId]) => conversationId)
      );

      let removedConversation = false;
      conversationListeners.forEach((unsubscribe, conversationId) => {
        if (!indexedIds.has(conversationId)) {
          unsubscribe();
          conversationListeners.delete(conversationId);
          conversationValues.delete(conversationId);
          removedConversation = true;
        }
      });

      let addedConversation = false;
      indexedIds.forEach((conversationId) => {
        if (conversationListeners.has(conversationId)) return;
        addedConversation = true;
        const unsubscribe = onValue(
          ref(realtimeDb, conversationPath(conversationId)),
          (conversationSnapshot) => {
            if (conversationSnapshot.exists()) {
              conversationValues.set(
                conversationId,
                normalizeConversation(conversationId, conversationSnapshot.val())
              );
            } else {
              conversationValues.delete(conversationId);
            }
            emit();
          },
          onError
        );
        conversationListeners.set(conversationId, unsubscribe);
      });
      if (!indexedIds.size || (removedConversation && !addedConversation)) emit();
    },
    onError
  );

  return () => {
    stopIndexListener();
    conversationListeners.forEach((unsubscribe) => unsubscribe());
  };
}

export function listenToMessages(
  conversationId: string,
  onMessages: (messages: ChatMessage[]) => void,
  onError: (error: Error) => void
) {
  const messagesQuery = query(
    ref(realtimeDb, messagesPath(conversationId)),
    orderByChild('clientCreatedAt'),
    limitToLast(200)
  );
  return onValue(
    messagesQuery,
    (snapshot) => {
      const value = snapshot.val() || {};
      const messages = Object.entries(value)
        .map(([id, message]) => ({
          ...(message as Omit<ChatMessage, 'id' | 'conversationId'>),
          id,
          conversationId,
        }))
        .sort((a, b) => (a.clientCreatedAt || 0) - (b.clientCreatedAt || 0));
      onMessages(messages);
    },
    onError
  );
}

export async function getRealtimeConversation(conversationId: string) {
  const snapshot = await get(ref(realtimeDb, conversationPath(conversationId)));
  return snapshot.exists()
    ? normalizeConversation(conversationId, snapshot.val())
    : null;
}

export async function createRealtimeConversation(
  conversationId: string,
  conversation: Omit<ChatConversation, 'id' | 'memberIds'> & { memberIds: string[] },
  initialMessage?: Omit<ChatMessage, 'id' | 'conversationId'>
) {
  const updates: Record<string, unknown> = {
    [conversationPath(conversationId)]: {
      ...conversation,
      memberIds: memberMap(conversation.memberIds),
    },
  };
  conversation.memberIds.forEach((memberId) => {
    updates[userConversationPath(memberId, conversationId)] = true;
  });
  if (initialMessage) {
    const messageId = conversation.lastMessageId || newRealtimeKey(messagesPath(conversationId));
    updates[`${messagesPath(conversationId)}/${messageId}`] = initialMessage;
  }
  await update(ref(realtimeDb), updates);
}

export async function updateRealtimePaths(updates: Record<string, unknown>) {
  await update(ref(realtimeDb), updates);
}

export async function updateConversation(
  conversationId: string,
  values: Record<string, unknown>
) {
  await update(ref(realtimeDb, conversationPath(conversationId)), values);
}

export async function updateMessage(
  conversationId: string,
  messageId: string,
  values: Record<string, unknown>
) {
  await update(ref(realtimeDb, `${messagesPath(conversationId)}/${messageId}`), values);
}

export async function persistRealtimeMessage(
  conversation: ChatConversation,
  message: Omit<ChatMessage, 'id' | 'conversationId'>,
  senderId: string,
  preparedMessageId?: string,
  lastMessageText?: string,
  incrementUnread = true
) {
  const messageId = preparedMessageId || newRealtimeKey(messagesPath(conversation.id));
  const updates: Record<string, unknown> = {
    [`${messagesPath(conversation.id)}/${messageId}`]: message,
    [`${conversationPath(conversation.id)}/updatedAt`]: serverTimestamp(),
    [`${conversationPath(conversation.id)}/lastMessageAt`]: serverTimestamp(),
    [`${conversationPath(conversation.id)}/lastMessageId`]: messageId,
    [`${conversationPath(conversation.id)}/lastMessageText`]: lastMessageText ?? message.text,
    [`${conversationPath(conversation.id)}/lastMessageSenderId`]: message.senderId,
    [`${conversationPath(conversation.id)}/lastMessageSenderName`]: message.senderName,
    [`${conversationPath(conversation.id)}/unreadCounts/${senderId}`]: 0,
    [`${conversationPath(conversation.id)}/lastReadAt/${senderId}`]: serverTimestamp(),
    [`${conversationPath(conversation.id)}/deliveredAt/${senderId}`]: serverTimestamp(),
    [`${conversationPath(conversation.id)}/typing/${senderId}`]: null,
  };
  if (incrementUnread) {
    conversation.memberIds.forEach((memberId) => {
      if (memberId !== senderId) {
        updates[`${conversationPath(conversation.id)}/unreadCounts/${memberId}`] = increment(1);
      }
    });
  }
  await updateRealtimePaths(updates);
  return messageId;
}

export async function transactMessageReactions(
  conversationId: string,
  messageId: string,
  mutate: (reactions: Record<string, string[]>) => Record<string, string[]>
) {
  await runTransaction(
    ref(realtimeDb, `${messagesPath(conversationId)}/${messageId}/reactions`),
    (current) => mutate({ ...(current || {}) })
  );
}

export async function transactMessageStars(
  conversationId: string,
  messageId: string,
  userId: string
) {
  await runTransaction(
    ref(realtimeDb, `${messagesPath(conversationId)}/${messageId}/starredBy`),
    (current) => {
      const starredBy = Array.isArray(current) ? current.filter((id) => typeof id === 'string') : [];
      return starredBy.includes(userId)
        ? starredBy.filter((id) => id !== userId)
        : [...starredBy, userId];
    }
  );
}

export { serverTimestamp as realtimeServerTimestamp };

import {
  endBefore,
  get,
  increment,
  limitToLast,
  onDisconnect,
  onValue,
  orderByChild,
  push,
  query,
  ref,
  runTransaction,
  serverTimestamp,
  getDatabase,
  update,
  type Unsubscribe,
} from 'firebase/database';
import { app } from '@/lib/firebase';

// Owned here rather than in @/lib/firebase so the Realtime Database SDK ships in
// the chat route's chunk instead of the app shell's initial bundle. Consumers on
// non-chat pages (the header's unread badge) import this module dynamically.
const realtimeDb = getDatabase(app);
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

/**
 * Realtime Database throws if any value in the payload is `undefined`, which
 * turns one optional field into a failed send. Drop those keys before writing.
 */
function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripUndefined) as unknown as T;
  if (value === null || typeof value !== 'object') return value;
  // Sentinels such as serverTimestamp()/increment() must be passed through as-is.
  if ('.sv' in (value as Record<string, unknown>)) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, stripUndefined(entry)])
  ) as T;
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
          (error) => {
            // A single unreadable entry (stale index row, revoked membership)
            // should drop that conversation, not fail the whole list — this used
            // to surface as "Could not load chat" with nothing rendered.
            console.warn(`Skipping unreadable conversation ${conversationId}:`, error);
            conversationValues.delete(conversationId);
            emit();
          }
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

export const MESSAGE_PAGE_SIZE = 50;

function snapshotToMessages(conversationId: string, value: unknown): ChatMessage[] {
  return Object.entries((value || {}) as Record<string, unknown>)
    .map(([id, message]) => ({
      ...(message as Omit<ChatMessage, 'id' | 'conversationId'>),
      id,
      conversationId,
    }))
    .sort((a, b) => (a.clientCreatedAt || 0) - (b.clientCreatedAt || 0));
}

export function listenToMessages(
  conversationId: string,
  onMessages: (messages: ChatMessage[]) => void,
  onError: (error: Error) => void,
  pageSize: number = MESSAGE_PAGE_SIZE
) {
  const messagesQuery = query(
    ref(realtimeDb, messagesPath(conversationId)),
    orderByChild('clientCreatedAt'),
    limitToLast(pageSize)
  );

  // `onValue` hands back the whole window on every change. Rebuilding each object
  // gave every row a new prop identity, so a single incoming message re-rendered
  // the entire list. Reuse the previous object whenever its raw value is unchanged
  // so React.memo can skip the rows that didn't actually move.
  const cache = new Map<string, { raw: string; message: ChatMessage }>();

  return onValue(
    messagesQuery,
    (snapshot) => {
      const value = (snapshot.val() || {}) as Record<string, unknown>;
      const seen = new Set<string>();
      const messages: ChatMessage[] = [];

      for (const [id, raw] of Object.entries(value)) {
        seen.add(id);
        const serialized = JSON.stringify(raw);
        const cached = cache.get(id);
        if (cached && cached.raw === serialized) {
          messages.push(cached.message);
          continue;
        }
        const message = {
          ...(raw as Omit<ChatMessage, 'id' | 'conversationId'>),
          id,
          conversationId,
        } as ChatMessage;
        cache.set(id, { raw: serialized, message });
        messages.push(message);
      }

      for (const id of cache.keys()) {
        if (!seen.has(id)) cache.delete(id);
      }

      messages.sort((a, b) => (a.clientCreatedAt || 0) - (b.clientCreatedAt || 0));
      onMessages(messages);
    },
    onError
  );
}

/**
 * One-shot fetch of the page immediately older than `beforeClientCreatedAt`.
 * The live listener stays pinned to the newest page; older history is appended
 * client-side so scrolling back doesn't widen the realtime subscription.
 */
export async function fetchOlderMessages(
  conversationId: string,
  beforeClientCreatedAt: number,
  pageSize: number = MESSAGE_PAGE_SIZE
): Promise<ChatMessage[]> {
  const olderQuery = query(
    ref(realtimeDb, messagesPath(conversationId)),
    orderByChild('clientCreatedAt'),
    endBefore(beforeClientCreatedAt),
    limitToLast(pageSize)
  );
  const snapshot = await get(olderQuery);
  return snapshotToMessages(conversationId, snapshot.val());
}

/**
 * Registers a server-side cleanup so an abrupt disconnect (tab close, crash,
 * network drop) clears this user's typing flag instead of leaving peers with a
 * permanent "typing…" indicator.
 */
export function clearTypingOnDisconnect(conversationId: string, userId: string) {
  const typingRef = ref(realtimeDb, `${conversationPath(conversationId)}/typing/${userId}`);
  onDisconnect(typingRef).remove().catch(() => {});
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

/**
 * Archive state lives per member on the shared conversation node. Unarchiving
 * writes `null` rather than `false` so the map only ever lists the members who
 * currently have the chat tucked away.
 */
export async function setConversationArchived(
  conversationId: string,
  userId: string,
  archived: boolean
) {
  await updateConversation(conversationId, {
    [`archived/${userId}`]: archived ? true : null,
  });
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
    [`${messagesPath(conversation.id)}/${messageId}`]: stripUndefined(message),
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

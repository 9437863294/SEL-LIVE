'use client';

/**
 * A single, process-wide subscription to the signed-in user's conversations.
 *
 * The header (unread badge) and the chat module both need this list. Subscribing
 * independently meant two full listener trees over identical data — one `onValue`
 * on the user index plus one per conversation, doubled. This store keeps exactly
 * one tree alive and fans the results out to every consumer, tearing down when
 * the last one unsubscribes.
 *
 * It also owns the "delivered" receipt for this device, so the write happens once
 * per new message rather than once per consumer per snapshot.
 */

import {
  listenToUserConversations,
  updateConversation,
  realtimeServerTimestamp,
} from '@/lib/chat-realtime';
import { timestampMillis, type ChatConversation } from '@/lib/chat';

type Listener = {
  onConversations: (conversations: ChatConversation[]) => void;
  onError: (error: Error) => void;
};

type Subscription = {
  userId: string;
  listeners: Set<Listener>;
  stop: () => void;
  /** Last emitted value, replayed to consumers that join late. */
  value: ChatConversation[] | null;
  /** conversationId -> lastMessageAt we've already sent a receipt for. */
  deliveredMarks: Map<string, number>;
};

let active: Subscription | null = null;

function markDelivered(subscription: Subscription, conversations: ChatConversation[]) {
  const { userId, deliveredMarks } = subscription;

  for (const conversation of conversations) {
    if (conversation.lastMessageSenderId === userId) continue;

    const lastMessageAt = timestampMillis(conversation.lastMessageAt);
    if (!lastMessageAt) continue;

    const deliveredAt = timestampMillis(conversation.deliveredAt?.[userId]);
    if (lastMessageAt <= deliveredAt) continue;

    // The receipt write updates the conversation, which re-fires this listener
    // before the server timestamp resolves. Without this guard each hydration
    // snapshot re-issued a write for every conversation it had seen so far.
    if (deliveredMarks.get(conversation.id) === lastMessageAt) continue;
    deliveredMarks.set(conversation.id, lastMessageAt);

    updateConversation(conversation.id, {
      [`deliveredAt/${userId}`]: realtimeServerTimestamp(),
    }).catch(() => {
      // Allow a retry on the next snapshot if the write failed.
      deliveredMarks.delete(conversation.id);
    });
  }
}

function teardown() {
  if (!active) return;
  active.stop();
  active = null;
}

export function subscribeToUserConversations(
  userId: string,
  listener: Listener
): () => void {
  if (active && active.userId !== userId) teardown();

  if (!active) {
    const subscription: Subscription = {
      userId,
      listeners: new Set(),
      stop: () => {},
      value: null,
      deliveredMarks: new Map(),
    };
    active = subscription;

    subscription.stop = listenToUserConversations(
      userId,
      (conversations) => {
        const sorted = [...conversations].sort(
          (a, b) =>
            timestampMillis(b.lastMessageAt || b.updatedAt || b.createdAt) -
            timestampMillis(a.lastMessageAt || a.updatedAt || a.createdAt)
        );
        subscription.value = sorted;
        markDelivered(subscription, sorted);
        subscription.listeners.forEach((l) => l.onConversations(sorted));
      },
      (error) => {
        subscription.listeners.forEach((l) => l.onError(error));
      }
    );
  }

  const subscription = active;
  subscription.listeners.add(listener);

  // A consumer mounting after hydration should not wait for the next event.
  if (subscription.value) listener.onConversations(subscription.value);

  return () => {
    subscription.listeners.delete(listener);
    if (subscription.listeners.size === 0 && active === subscription) {
      teardown();
    }
  };
}

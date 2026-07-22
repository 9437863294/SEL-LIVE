'use client';

import { auth } from '@/lib/firebase';

const STORED_TOKEN_KEY = 'sel_chat_push_token';

async function authorizedRequest(url: string, init: RequestInit) {
  const firebaseUser = auth.currentUser;
  if (!firebaseUser) throw new Error('No authenticated Firebase user.');
  const idToken = await firebaseUser.getIdToken();
  return fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
      ...(init.headers || {}),
    },
  });
}

export async function registerChatPushDevice(token: string) {
  const response = await authorizedRequest('/api/chat/push-device', {
    method: 'POST',
    body: JSON.stringify({ token, platform: 'android' }),
  });
  if (!response.ok) throw new Error(`Push-device registration failed (${response.status}).`);
  localStorage.setItem(STORED_TOKEN_KEY, token);
}

export async function unregisterCurrentChatPushDevice() {
  if (typeof window === 'undefined') return;
  const token = localStorage.getItem(STORED_TOKEN_KEY);
  if (!token || !auth.currentUser) return;

  try {
    await authorizedRequest('/api/chat/push-device', {
      method: 'DELETE',
      body: JSON.stringify({ token }),
      keepalive: true,
    });
    localStorage.removeItem(STORED_TOKEN_KEY);
  } catch (error) {
    console.warn('Unable to unregister chat push device:', error);
  }
}

export async function notifyChatRecipients(conversationId: string, messageId: string) {
  const response = await authorizedRequest('/api/chat/notify', {
    method: 'POST',
    body: JSON.stringify({ conversationId, messageId }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Chat notification failed (${response.status})${detail ? `: ${detail}` : ''}`);
  }
}


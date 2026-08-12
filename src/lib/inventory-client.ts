'use client';

import { auth } from '@/lib/firebase';

export async function inventoryCommand<T = Record<string, unknown>>(payload: Record<string, unknown>): Promise<T> {
  const isLocalInventoryCommand = [
    'saveItem',
    'saveLocation',
    'setInventoryScopeStatus',
    'postMovement',
    'buildPack',
    'unbuildPack',
    'createTransfer',
    'transitionTransfer',
    'createStockCount',
    'submitStockCount',
    'postStockCount',
  ].includes(String(payload.action || ''));

  // Local development intentionally has no Firebase Admin service-account key.
  // These setup writes follow the application's existing authenticated client
  // write model, avoiding a slow applicationDefault() lookup on every save.
  if (process.env.NODE_ENV === 'development' && isLocalInventoryCommand) {
    const { runLocalInventorySetupCommand } = await import('@/lib/inventory-client-fallback');
    return await runLocalInventorySetupCommand(payload) as T;
  }

  const user = auth.currentUser;
  if (!user) throw new Error('Your session has expired. Please sign in again.');
  const token = await user.getIdToken();
  const response = await fetch('/api/inventory', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    if (
      data.code === 'FIREBASE_ADMIN_CREDENTIALS_UNAVAILABLE'
      && process.env.NODE_ENV === 'development'
    ) {
      const { runLocalInventorySetupCommand } = await import('@/lib/inventory-client-fallback');
      return await runLocalInventorySetupCommand(payload) as T;
    }
    throw new Error(data.error || 'The inventory request failed.');
  }
  return data.result as T;
}

export const inventoryRequestId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `inventory-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

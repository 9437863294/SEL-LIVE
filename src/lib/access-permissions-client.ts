import { auth } from '@/lib/firebase';

/**
 * Ask the server to rewrite `userPermissions/{authUid}`, the resolved permissions the Firestore
 * rules read (see `access-rules-permissions.ts`). The browser only says *whose* documents to
 * refresh; what goes into them is always resolved on the server.
 *
 *   refreshRulesPermissions()                                — the signed-in user (every app load)
 *   refreshRulesPermissions({ scope: 'users', userIds })     — after changing those users' access
 *   refreshRulesPermissions({ scope: 'all' })                — after changing a role or scope rule
 */
export type RulesPermissionRefresh =
  | { scope: 'self' }
  | { scope: 'users'; userIds: string[] }
  | { scope: 'all' };

export async function refreshRulesPermissions(payload: RulesPermissionRefresh = { scope: 'self' }): Promise<void> {
  const firebaseUser = auth.currentUser;
  if (!firebaseUser) throw new Error('Not signed in.');
  const idToken = await firebaseUser.getIdToken();
  const res = await fetch('/api/access/sync-permissions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Permission refresh failed (${res.status}).`);
  }
}

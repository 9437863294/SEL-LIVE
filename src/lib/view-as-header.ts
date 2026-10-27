/**
 * Switch User, for requests: the header a Switch User session sends — the id of the user the
 * administrator is viewing as (src/lib/view-as.ts sets it) — and the rule the server applies to it
 * (`authenticateAccessViewingAs`). Shared by browser and server, so it imports nothing.
 */
export const VIEW_AS_HEADER = 'x-view-as';

export type ViewAsDecision =
  | { kind: 'self' }
  | { kind: 'view'; userId: string }
  | { kind: 'refuse'; status: 403; message: string };

/**
 * Whom a request is answered as. No header, or the caller's own id: the caller. Another user's id:
 * that user — when the caller may switch users (Settings › User Management › Switch User, as the
 * switch itself requires), and only to read: a change is refused rather than recorded under the
 * other person's name ("You are now viewing as …").
 */
export function viewAsDecision(input: { callerUserId: string; canSwitchUsers: boolean; target: string | null | undefined; method: string }): ViewAsDecision {
  const target = String(input.target ?? '').trim();
  if (!target || target === input.callerUserId) return { kind: 'self' };
  if (!input.canSwitchUsers) return { kind: 'refuse', status: 403, message: 'Viewing as another user needs Settings › User Management › Switch User.' };
  const method = input.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return { kind: 'refuse', status: 403, message: 'You are viewing as another user — switch back to your own account to make changes.' };
  return { kind: 'view', userId: target };
}

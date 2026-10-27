/**
 * Switch User, for requests to the server. The switch is kept in the browser
 * (`impersonationUserId` and `originalAdminUser` in localStorage, set by SwitchUserDialog) while the
 * Firebase session stays the administrator's. AuthProvider honours it only while the signed-in
 * account is that administrator, and so does this. A module whose screens read through its API
 * sends `viewAsHeaders()`, and its server answers as that user (`authenticateAccessViewingAs`,
 * reads only).
 */

import { auth } from '@/lib/firebase';
import { VIEW_AS_HEADER } from '@/lib/view-as-header';

/** The id of the user being viewed as, or null outside a Switch User session. */
export function viewingAsUserId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const id = window.localStorage.getItem('impersonationUserId');
    const original = window.localStorage.getItem('originalAdminUser');
    if (!id || !original) return null;
    const admin = JSON.parse(original) as { id?: string } | null;
    return admin?.id && auth.currentUser?.uid === admin.id && id !== admin.id ? id : null;
  } catch {
    return null;
  }
}

/** The header that tells the server whom the screen is showing; empty outside Switch User. */
export function viewAsHeaders(): Record<string, string> {
  const id = viewingAsUserId();
  return id ? { [VIEW_AS_HEADER]: id } : {};
}

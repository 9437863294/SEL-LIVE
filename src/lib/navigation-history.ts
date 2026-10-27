/**
 * Which page each page in this browser tab was opened from — so a page's own back arrow can return
 * people to where they actually were, rather than to a list chosen when the page was written.
 *
 * `AppShell` reports every pathname change here. A change is one of three things:
 *
 *   - **A push.** The page we were on is where the new page was opened from, and it is also the
 *     history entry directly behind it — so a back arrow pointing there can simply go back.
 *   - **A replace made through `markNextNavigationAsReplace`.** The replaced page is gone from the
 *     history, so the new page inherits the replaced page's origin: that is the entry now behind it.
 *     (Submitting a new request replaces the form with the request, and the request's back arrow
 *     must then lead to wherever the form was opened from — not to a blank form.)
 *   - **A browser Back or Forward.** Nothing new is learnt. Where the page was first opened from is
 *     still the entry behind it, so its recorded origin stands.
 *
 * In memory only, on purpose. A reload or a new tab starts with nothing recorded, and every page
 * then falls back to its own default. Remembering an origin across a new tab would be worse than
 * forgetting it: there is no history entry behind the first page of a tab, and "go back" would
 * leave the app.
 */

let currentPath: string | null = null;
let currentHref: string | null = null;
/** pathname → the href (path and query) of the page it was last opened from. */
const openedFrom = new Map<string, string>();
let traversing = false;
let replacing = false;
let listening = false;
const listeners = new Set<() => void>();

function onPopState() {
  // A Back or Forward that changes only the query or the hash does not move between pages.
  if (window.location.pathname !== currentPath) traversing = true;
}

/** Called by `AppShell` whenever the pathname changes. */
export function noteNavigation(pathname: string): void {
  if (typeof window === 'undefined') return;
  if (!listening) {
    window.addEventListener('popstate', onPopState);
    listening = true;
  }
  if (pathname === currentPath) return;

  if (traversing) {
    // Leave the destination's recorded origin alone (see the file comment).
  } else if (replacing) {
    const inherited = currentPath ? openedFrom.get(currentPath) : undefined;
    if (inherited && inherited.split(/[?#]/)[0] !== pathname) openedFrom.set(pathname, inherited);
    else openedFrom.delete(pathname);
  } else if (currentHref) {
    openedFrom.set(pathname, currentHref);
  }
  traversing = false;
  replacing = false;

  currentPath = pathname;
  currentHref = `${pathname}${window.location.search}`;
  listeners.forEach((listener) => listener());
}

/** Call immediately before a `router.replace` that leaves the current page. */
export function markNextNavigationAsReplace(): void {
  replacing = true;
}

/**
 * Call after changing the current page's query in place (`history.replaceState`, as a tab strip
 * that keeps its tab in `?tab=` does), so a page opened next records the address as it now is —
 * the Users tab rather than the address the page was first opened at.
 */
export function noteAddressChange(): void {
  if (typeof window === 'undefined' || window.location.pathname !== currentPath) return;
  currentHref = `${currentPath}${window.location.search}`;
}

/**
 * Where the page at `pathname` was opened from: an href that is also the history entry directly
 * behind it. `null` when that is not known — and always `null` for a page other than the current
 * one, including during the first render of a page this module has not been told about yet.
 */
export function navigationOrigin(pathname: string): string | null {
  if (pathname !== currentPath) return null;
  return openedFrom.get(pathname) ?? null;
}

/** For `useSyncExternalStore`: notified after each recorded page change. */
export function subscribeNavigation(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

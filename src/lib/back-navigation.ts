/**
 * Where a page's back arrow leads — the rules every module shares.
 *
 * Back arrows used to be fixed links chosen when each page was written: every Settings page led to
 * the Settings hub, so somebody who had opened Departments from HR Settings, or their Profile from
 * the avatar menu in Expenses, was sent somewhere they had never been. A back arrow now resolves,
 * in order:
 *
 *   1. **The page it was opened from in this tab**, when that is known (`navigation-history.ts`).
 *      That page is the history entry directly behind, so the arrow simply goes back, and the
 *      browser's own Back button agrees with it.
 *   2. **`?returnTo=`**, when the link that opened the page carried one, so the answer survives a
 *      reload or a link opened in a new tab.
 *   3. **The page's own default**, for a page opened from a bookmark, an email or a fresh tab.
 *
 * Neither of the first two may be a form — a page whose last segment is `new`, `create` or
 * `edit`, which was saved or abandoned on the way here — or the page being left.
 *
 * Free of React so the rules can be tested on their own. `e-approval-navigation.ts` builds on these.
 */

/** The query parameter naming the page a link was followed from. */
export const RETURN_TO_PARAM = 'returnTo';

/** The path of an href, without its query, its hash or a trailing slash. */
export const hrefPath = (href: string): string => href.split(/[?#]/)[0].replace(/\/+$/, '') || '/';

/** An in-app path, or `null` — never another site, and never a protocol-relative `//host`. */
export function safeReturnTo(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null;
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  return value;
}

/** `href` carrying `returnTo`, or `href` unchanged when there is nothing safe to carry. */
export function withReturnTo(href: string, returnTo: string | null | undefined): string {
  const safe = safeReturnTo(returnTo);
  // A page never sends people back to itself.
  if (!safe || hrefPath(safe) === hrefPath(href)) return href;
  const hashAt = href.indexOf('#');
  const path = hashAt === -1 ? href : href.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : href.slice(hashAt);
  return `${path}${path.includes('?') ? '&' : '?'}${RETURN_TO_PARAM}=${encodeURIComponent(safe)}${hash}`;
}

/** The `returnTo` of a query string (`location.search`), if it is safe to follow. */
export function returnToFromSearch(search: string): string | null {
  try {
    return safeReturnTo(new URLSearchParams(search).get(RETURN_TO_PARAM));
  } catch {
    return null;
  }
}

/** A form: a page that was saved or abandoned once somebody has left it. */
export function isFormPath(href: string): boolean {
  return /\/(new|create|edit)$/.test(hrefPath(href));
}

/** Whether a back arrow on `leaving` may lead to `href`: never to a form, never to the page itself. */
export function isBackDestination(href: string, leaving: string): boolean {
  return hrefPath(href) !== hrefPath(leaving) && !isFormPath(href);
}

/**
 * Where a back arrow leads, by the rules in the file comment. `origin` is the page this one was
 * opened from (`navigationOrigin`), `returnTo` the safe `?returnTo=`, `fallback` the page's default.
 * `isDestination` replaces `isBackDestination` for a module with rules of its own.
 */
export function resolveBack(input: {
  leaving: string;
  origin: string | null;
  returnTo: string | null;
  fallback: string;
  isDestination?: (href: string, leaving: string) => boolean;
}): { href: string; viaHistory: boolean } {
  const { leaving, origin, returnTo, fallback, isDestination = isBackDestination } = input;
  if (origin && isDestination(origin, leaving)) return { href: origin, viaHistory: true };
  return { href: returnTo && isDestination(returnTo, leaving) ? returnTo : fallback, viaHistory: false };
}

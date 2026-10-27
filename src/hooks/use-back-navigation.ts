'use client';

import { useCallback, useSyncExternalStore, type MouseEvent } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { buildCrumbs, looksLikeId } from '@/components/app/Breadcrumbs';
import { hrefPath, resolveBack, returnToFromSearch } from '@/lib/back-navigation';
import { markNextNavigationAsReplace, navigationOrigin, subscribeNavigation } from '@/lib/navigation-history';

/*
 * `returnTo` is read from the address bar rather than through `useSearchParams`, which would make
 * every page that uses this hook wait on a Suspense boundary to be prerendered. The address bar can
 * lag a client navigation by a render, which is why it is read as an external store: the page
 * re-renders once `AppShell` has recorded the move (see navigation-history.ts).
 */
const readReturnTo = () => returnToFromSearch(window.location.search);
const nothingOnTheServer = () => null;

/**
 * "Back to Settings", "Back to Access Management", "Back to HR & Recruitment › Settings": the page
 * named as the breadcrumb bar names it, with its module when that is not the one being left. A
 * record (`/users/{id}`) is just "Back" — its path does not say what it is.
 */
export function backLabelFor(href: string, leaving: string): string {
  const path = hrefPath(href);
  const crumbs = buildCrumbs(path);
  if (crumbs.length === 1) return 'Back to Home';
  if (looksLikeId(path.slice(path.lastIndexOf('/') + 1))) return 'Back';
  const page = crumbs[crumbs.length - 1].label;
  if (crumbs.length === 2) return `Back to ${page}`;
  const sameModule = path.split('/')[1] === hrefPath(leaving).split('/')[1];
  return `Back to ${sameModule ? page : `${crumbs[1].label} › ${page}`}`;
}

export interface BackNavigationOptions {
  /** Leave by replacing this page in the history — for a form, or anything not worth returning to. */
  replace?: boolean;
  /**
   * `false` for a page beneath a record — its edit or print view — whose `?returnTo=` is the
   * *record's* way back, carried through so the record still knows it. Such a page goes back to the
   * record (its `fallback`, which carries the parameter on), never straight to the list.
   */
  followReturnTo?: boolean;
  /** What the arrow says when it leads to `fallback`'s page, where the path alone says too little. */
  fallbackLabel?: string;
  /** A module's own rule for where an arrow may lead (`back-navigation.ts` has the shared one). */
  isDestination?: (href: string, leaving: string) => boolean;
  /** A module's own names for its pages. */
  label?: (href: string, leaving: string) => string;
}

export interface BackNavigation {
  href: string;
  /** Where the arrow leads, for its tooltip and screen readers: "Back to Settings". */
  label: string;
  /** For a `<Link onClick>`. A plain click is handled by `go`; a Ctrl- or middle-click still opens a tab. */
  onClick: (event: MouseEvent<HTMLAnchorElement>) => void;
  /** Leave the page the way the arrow would. `replace` drops this page from the history, as after a save. */
  go: (options?: { replace?: boolean }) => void;
}

/**
 * A page's back arrow: to the page it was opened from, else `?returnTo=`, else `fallback` — see
 * `back-navigation.ts` for the rules and why. Pass the result to `PageHeader` as `backHref`,
 * `backLabel` and `onBackClick`.
 */
export function useBackNavigation(fallback: string, options: BackNavigationOptions = {}): BackNavigation {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const { replace: replaceByDefault = false, followReturnTo = true, fallbackLabel, isDestination, label: labelFor = backLabelFor } = options;
  const origin = useSyncExternalStore(subscribeNavigation, () => navigationOrigin(pathname), nothingOnTheServer);
  const urlReturnTo = useSyncExternalStore(subscribeNavigation, readReturnTo, nothingOnTheServer);
  const { href } = resolveBack({
    leaving: pathname,
    origin,
    returnTo: followReturnTo ? urlReturnTo : null,
    fallback,
    isDestination,
  });
  const label = fallbackLabel && hrefPath(href) === hrefPath(fallback) ? fallbackLabel : labelFor(href, pathname);

  const go = useCallback(
    (overrides: { replace?: boolean } = {}) => {
      // Resolved again rather than taken from the render: the click is what counts.
      const target = resolveBack({
        leaving: pathname,
        origin: navigationOrigin(pathname),
        returnTo: followReturnTo ? readReturnTo() : null,
        fallback,
        isDestination,
      });
      // The page this one was opened from is the history entry behind it, so going back is the same
      // as following the link — except that it does not leave this page in the history to be
      // returned to by the browser's own Back button.
      if (target.viaHistory) {
        router.back();
      } else if (overrides.replace ?? replaceByDefault) {
        markNextNavigationAsReplace();
        router.replace(target.href);
      } else {
        router.push(target.href);
      }
    },
    [pathname, fallback, followReturnTo, isDestination, replaceByDefault, router],
  );

  const onClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      go();
    },
    [go],
  );

  return { href, label, onClick, go };
}

/**
 * `onClick` for a `<Link replace>` that leaves the page — a section tab, a form swapped for another
 * — so the next page inherits this one's origin (`markNextNavigationAsReplace`). Not for a click
 * that opens a new tab, or a link to the page already on screen: no navigation would consume it.
 */
export function markReplaceOnPlainClick(event: MouseEvent<HTMLAnchorElement>): void {
  if (event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  if (event.currentTarget.pathname === window.location.pathname) return;
  markNextNavigationAsReplace();
}

/** The `?returnTo=` of the current page — for a link onward that should lead back the same way. */
export function useReturnTo(): string | null {
  return useSyncExternalStore(subscribeNavigation, readReturnTo, nothingOnTheServer);
}

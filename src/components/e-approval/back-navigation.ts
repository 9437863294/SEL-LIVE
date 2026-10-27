'use client';

import { useCallback, useSyncExternalStore, type MouseEvent } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { markNextNavigationAsReplace, navigationOrigin, subscribeNavigation } from '@/lib/navigation-history';
import { eApprovalRequestHref, eApprovalReturnToFromSearch, resolveEApprovalBack } from '@/lib/e-approval-navigation';

/*
 * `returnTo` is read from the address bar rather than through `useSearchParams`, which would make
 * every page that uses this hook wait on a Suspense boundary to be prerendered. The address bar can
 * lag a client navigation by a render, which is why it is read as an external store: the page
 * re-renders once `AppShell` has recorded the move (see navigation-history.ts).
 */
const readReturnTo = () => eApprovalReturnToFromSearch(window.location.search);
const nothingOnTheServer = () => null;

export interface EApprovalBack {
  href: string;
  /** Where the arrow leads, for its tooltip and screen readers: "My Inbox", "Back to the approval". */
  label: string;
  /** For a `<Link onClick>`. A plain click is handled by `go`; a Ctrl- or middle-click still opens a tab. */
  onClick: (event: MouseEvent<HTMLAnchorElement>) => void;
  /** Leave the page the way the arrow would. `replace` drops this page from the history, as after a delete. */
  go: (options?: { replace?: boolean }) => void;
}

/**
 * The back arrow of an E-Approval page — see `e-approval-navigation.ts` for where it leads and why.
 *
 * `fallback` is where the page goes when neither the history of this tab nor `?returnTo=` says where
 * the person came from. `replace` suits pages nobody should be returned to by the browser's own
 * Back button once they have left them: a form, or the print view.
 *
 * `followReturnTo: false` is for a page beneath a request — Edit, the Approval Note — whose
 * `?returnTo=` is the *request's* way back, carried through so the request still knows it. Such a
 * page goes back to the request (its `fallback`, which carries the parameter on), never straight to
 * the list: opened from a link or after a reload, saving an edit used to land on the list.
 */
export function useEApprovalBack(
  fallback: string,
  options: { replace?: boolean; followReturnTo?: boolean } = {},
): EApprovalBack {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const followReturnTo = options.followReturnTo ?? true;
  const origin = useSyncExternalStore(subscribeNavigation, () => navigationOrigin(pathname), nothingOnTheServer);
  const urlReturnTo = useSyncExternalStore(subscribeNavigation, readReturnTo, nothingOnTheServer);
  const returnTo = followReturnTo ? urlReturnTo : null;
  const { href, label } = resolveEApprovalBack({ leaving: pathname, origin, returnTo, fallback });
  const replaceByDefault = options.replace ?? false;

  const go = useCallback(
    (overrides: { replace?: boolean } = {}) => {
      // Resolved again rather than taken from the render: the click is what counts.
      const target = resolveEApprovalBack({
        leaving: pathname,
        origin: navigationOrigin(pathname),
        returnTo: followReturnTo ? readReturnTo() : null,
        fallback,
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
    [pathname, fallback, followReturnTo, replaceByDefault, router],
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
 * Links to requests from the current page, naming it as `returnTo` — so the request's back arrow
 * still leads here after a reload, or when the request was opened in a new tab.
 */
export function useEApprovalRequestHref(): (approvalId: string) => string {
  const pathname = usePathname() ?? '';
  return useCallback((approvalId: string) => eApprovalRequestHref(approvalId, pathname), [pathname]);
}

/** The `?returnTo=` of the current page — for a link onward that should lead back the same way. */
export function useEApprovalReturnTo(): string | null {
  return useSyncExternalStore(subscribeNavigation, readReturnTo, nothingOnTheServer);
}

'use client';

import { useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { useBackNavigation, useReturnTo, type BackNavigation } from '@/hooks/use-back-navigation';
import { eApprovalBackLabel, eApprovalRequestHref, isEApprovalBackDestination } from '@/lib/e-approval-navigation';

/** `label` here is a page's name — "My Inbox", "Back to the approval" — not "Back to …". */
export type EApprovalBack = BackNavigation;

const labelFor = (href: string) => eApprovalBackLabel(href);

/**
 * The back arrow of an E-Approval page — see `e-approval-navigation.ts` for where it leads and why.
 * The app-wide `useBackNavigation`, with the module's own names for its pages and its rule that an
 * arrow never leads into a page beneath the one being left.
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
  return useBackNavigation(fallback, { ...options, isDestination: isEApprovalBackDestination, label: labelFor });
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
export const useEApprovalReturnTo = useReturnTo;

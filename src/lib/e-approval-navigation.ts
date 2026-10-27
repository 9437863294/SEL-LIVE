/**
 * Where an E-Approval page's back arrow leads.
 *
 * The request screen's arrow used to lead to My Inbox whoever pressed it, so somebody who had
 * opened a file from All Approvals, Created by Me, Copied to Me, a report or a notification was
 * sent somewhere they had never been. A back arrow now resolves, in order:
 *
 *   1. **The page it was opened from in this tab**, when that is known (`navigation-history.ts`).
 *      That page is the history entry directly behind, so the arrow simply goes back, and the
 *      browser's own Back button agrees with it.
 *   2. **`?returnTo=`**, which links inside the module carry, so the answer survives a reload, a
 *      link opened in a new tab, and a round trip through Edit or the Approval Note.
 *   3. **The list the request belongs in for this viewer** (`eApprovalHomeList`): the inbox for
 *      the person it is waiting on, Drafts or Created by Me for its requester, and so on — for a
 *      file opened from an email, a bookmark or a notification in a fresh tab.
 *
 * Free of React and Firestore so the rules can be tested on their own. The rules every module
 * shares — `returnTo`, forms — are `back-navigation.ts`; what is E-Approval's own is here.
 */
import {
  isEApprovalRowWithActor,
  isTerminalEApprovalStatus,
  type EApprovalActor,
  type EApprovalInboxRow,
  type EApprovalStepRecord,
} from './e-approval-policy.ts';
import {
  RETURN_TO_PARAM,
  hrefPath as pathOf,
  isBackDestination,
  resolveBack,
  returnToFromSearch,
  safeReturnTo,
  withReturnTo,
} from './back-navigation.ts';

/** `E_APPROVAL_BASE_PATH`. Repeated, because `e-approval.ts` cannot be loaded by the test runner. */
const BASE = '/e-approval';

/** The query parameter naming the page a link was followed from. */
export const E_APPROVAL_RETURN_PARAM = RETURN_TO_PARAM;

/** An in-app path, or `null` — never another site, and never a protocol-relative `//host`. */
export const safeEApprovalReturnTo = safeReturnTo;

/** `href` carrying `returnTo`, or `href` unchanged when there is nothing safe to carry. */
export const withEApprovalReturnTo = withReturnTo;

/** A request's screen, opened from `from` (a list, a report) so that its back arrow leads there. */
export function eApprovalRequestHref(approvalId: string, from?: string | null): string {
  return withEApprovalReturnTo(`${BASE}/${approvalId}`, from);
}

/** The `returnTo` of a query string (`location.search`), if it is safe to follow. */
export const eApprovalReturnToFromSearch = returnToFromSearch;

/**
 * Whether a back arrow may lead to `href`. Never to a form — a blank New Approval, or an edit
 * screen that was already saved or abandoned — and never to a page beneath the one being left
 * (from a request back into its own Approval Note).
 */
export function isEApprovalBackDestination(href: string, leaving: string): boolean {
  const from = pathOf(leaving);
  return isBackDestination(href, leaving) && !pathOf(href).startsWith(`${from}/`);
}

const PAGE_LABELS: ReadonlyArray<readonly [string, string]> = [
  ['inbox', 'My Inbox'],
  ['created-by-me', 'Created by Me'],
  ['copied-to-me', 'Copied to Me'],
  ['drafts', 'Drafts'],
  ['my-activity', 'My Activity'],
  ['department', 'Department Inbox'],
  ['all', 'All Approvals'],
  ['completed', 'Completed'],
  ['rejected', 'Rejected'],
  ['delegations', 'Delegations'],
  ['reports', 'Reports'],
  ['settings', 'Settings'],
  ['help', 'Guide'],
];

/** What the arrow says it goes to — its tooltip and its name for a screen reader. */
export function eApprovalBackLabel(href: string): string {
  const path = pathOf(href);
  if (path === BASE) return 'Dashboard';
  if (!path.startsWith(`${BASE}/`)) return 'Back';
  const section = path.slice(BASE.length + 1).split('/')[0];
  const known = PAGE_LABELS.find(([segment]) => segment === section);
  if (known) return known[1];
  // Anything else under the module is a request: `/e-approval/{id}`, or a page of it.
  return 'Back to the approval';
}

/** The same destination written for a button: "Back to My Inbox", "Back to the approval". */
export function eApprovalBackButtonText(label: string): string {
  return /^back\b/i.test(label) ? label : `Back to ${label}`;
}

/** What the request screen needs to decide which list a request belongs in. */
export type EApprovalHomeRequest = EApprovalInboxRow & {
  ccUserIds?: string[];
  participantUserIds?: string[];
};

/**
 * The list this request belongs in for this viewer, used when nothing records where they came from.
 *
 * In the order a person would look for it: a draft among their drafts; a file waiting on them in
 * their inbox (a return to its requester included, which the inbox lists); their own request among
 * the ones they raised; one they were copied on under Copied to Me; one they once acted on under
 * My Activity; and otherwise the full register if they may see it, or the dashboard.
 */
export function eApprovalHomeList(
  request: EApprovalHomeRequest,
  steps: Pick<EApprovalStepRecord, 'actedByUserId' | 'assignment'>[],
  viewer: { actor: EApprovalActor | null | undefined; canViewAll?: boolean },
): string {
  const actor = viewer.actor;
  const userId = actor?.userId;
  if (!actor || !userId) return BASE;
  const mine = request.requesterId === userId;
  const fallback = viewer.canViewAll ? `${BASE}/all` : BASE;

  if (request.status === 'Draft') return mine ? `${BASE}/drafts` : fallback;
  if (!isTerminalEApprovalStatus(request.status) && isEApprovalRowWithActor(request, actor)) return `${BASE}/inbox`;
  if (mine) return `${BASE}/created-by-me`;
  if ((request.ccUserIds ?? []).includes(userId) || (request.participantUserIds ?? []).includes(userId)) {
    return `${BASE}/copied-to-me`;
  }
  if (steps.some((step) => step.actedByUserId === userId || step.assignment?.userId === userId)) {
    return `${BASE}/my-activity`;
  }
  return fallback;
}

/**
 * Where a back arrow leads, by the rules in the file comment. `origin` is the page this one was
 * opened from (`navigationOrigin`), `returnTo` the safe `?returnTo=`, `fallback` the page's default.
 */
export function resolveEApprovalBack(input: {
  leaving: string;
  origin: string | null;
  returnTo: string | null;
  fallback: string;
}): { href: string; label: string; viaHistory: boolean } {
  const { href, viaHistory } = resolveBack({ ...input, isDestination: isEApprovalBackDestination });
  return { href, label: eApprovalBackLabel(href), viaHistory };
}

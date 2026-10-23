import 'server-only';

/**
 * Notifications and the audit trail for trip claims, sent after the response.
 *
 * Both are side effects of a change already committed: the person acting should not wait for a
 * push to three phones, and neither may ever undo or fail the change (`dispatchNotificationServer`
 * and `logServerActivity` never throw).
 */

import { after } from 'next/server';

import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { logServerActivity } from '@/lib/activity-logger-server';
import { dispatchNotificationServer } from '@/lib/notifications-server';
import { formatINR } from '../rates.ts';
import { formatKm, type TripClaim } from '../types.ts';
import type { TripContext } from './context';

const MODULE = ACTIVITY_MODULES.DRIVER_MANAGEMENT;

const claimLink = (claim: Pick<TripClaim, 'id'>) => `/driver-management/claims/${claim.id}`;

export interface ClaimNotice {
  userIds: string[];
  title: string;
  body: string;
  type?: string;
  severity?: 'INFO' | 'WARNING';
}

/** Queue notifications about a claim and one audit row, to run once the response is sent. */
export function afterClaimChange(
  context: TripContext,
  claim: Pick<TripClaim, 'id' | 'claimNumber' | 'organizationId'>,
  audit: { action: string; details?: Record<string, unknown> },
  notices: ClaimNotice[],
): void {
  after(async () => {
    await Promise.all([
      ...notices
        .map((notice) => ({ ...notice, userIds: [...new Set(notice.userIds.filter((id) => id && id !== context.userId))] }))
        .filter((notice) => notice.userIds.length)
        .map((notice) =>
          dispatchNotificationServer(
            { userIds: notice.userIds },
            {
              type: notice.type ?? 'approval_required',
              title: notice.title,
              body: notice.body,
              module: MODULE,
              severity: notice.severity ?? 'INFO',
              itemId: claim.id,
              itemRef: claim.claimNumber,
              link: claimLink(claim),
              organizationId: claim.organizationId,
            },
          ),
        ),
      logServerActivity({
        userId: context.userId,
        userName: context.userName,
        userEmail: context.userEmail ?? undefined,
        module: MODULE,
        action: audit.action,
        details: audit.details ?? {},
        recordId: claim.id,
        recordRef: claim.claimNumber,
        source: 'api',
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      }),
    ]);
  });
}

/** One audit row for a change with no claim (a trip, the settings). */
export function afterAudit(context: TripContext, action: string, details: Record<string, unknown>, recordId?: string): void {
  after(() =>
    logServerActivity({
      userId: context.userId,
      userName: context.userName,
      userEmail: context.userEmail ?? undefined,
      module: MODULE,
      action,
      details,
      recordId,
      source: 'api',
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    }),
  );
}

export const claimSummary = (claim: Pick<TripClaim, 'employeeName' | 'totals'>, amount = claim.totals.claimedAmount) =>
  `${claim.employeeName} · ${claim.totals.tripCount} trip${claim.totals.tripCount === 1 ? '' : 's'} · ${formatKm(claim.totals.distanceKm)} · ${formatINR(amount)}`;

'use client';

import { Clock, UserRound } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import {
  activeEApprovalSteps,
  describeEApprovalAssignment,
  eApprovalSlaState,
  findEApprovalStep,
  isTerminalEApprovalStatus,
  type EApprovalRequest,
  type EApprovalStep,
} from '@/lib/e-approval';
import { EApprovalStatusBadge } from './shared';
import { formatEApprovalDateTime } from './hooks';

/**
 * The permanent "Current Responsibility" box of spec section 32.
 *
 * It exists to answer one question without anybody having to ask it: the file is pending with whom,
 * since when, for what, and how long they have left. Every other panel on the detail screen is
 * history; this one is the present.
 */
export function ResponsibilityCard({
  request,
  steps,
}: {
  request: EApprovalRequest;
  steps: EApprovalStep[];
}) {
  const active = activeEApprovalSteps(steps);
  const terminal = isTerminalEApprovalStatus(request.status);

  if (terminal) {
    return (
      <Card className="border-emerald-200 bg-emerald-50/50">
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-1 px-3 py-2.5 sm:px-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Final status</p>
            <div className="mt-0.5"><EApprovalStatusBadge status={request.status} /></div>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Closed</p>
            <p className="mt-0.5 text-sm font-medium">{formatEApprovalDateTime(request.completedAt)}</p>
          </div>
          {request.rejectionReason && (
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Reason</p>
              <p className="mt-0.5 truncate text-sm">{request.rejectionReason}</p>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-sky-200 bg-gradient-to-r from-sky-50 to-indigo-50/60">
      <CardContent className="grid gap-3 px-3 py-2.5 sm:grid-cols-2 sm:px-4 lg:grid-cols-4">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Pending with</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm font-semibold">
            <UserRound className="h-3.5 w-3.5 shrink-0 text-sky-600" />
            <span className="truncate">
              {active.length
                ? active.map((step) => describeEApprovalAssignment(step.assignment)).join(', ')
                : request.status === 'Returned'
                  ? request.requesterName || 'Requester'
                  : '—'}
            </span>
          </p>
        </div>

        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Pending since</p>
          <p className="mt-0.5 text-sm font-medium">
            {formatEApprovalDateTime(active[0]?.startedAt ?? request.submittedAt)}
          </p>
        </div>

        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Current action</p>
          <p className="mt-0.5 text-sm font-medium">
            {active.length === 0
              ? 'Correction by requester'
              : active[0].type === 'VERIFICATION' || active[0].type === 'REVIEW'
                ? 'Verification'
                : active[0].type === 'CLARIFICATION'
                  ? 'Clarification'
                  : 'Approval'}
          </p>
          {active[0] && active[0].originStepId && (
            <p className="text-[11px] text-muted-foreground">
              Requested by{' '}
              {describeEApprovalAssignment(findEApprovalStep(steps, active[0].originStepId)?.assignment)}
            </p>
          )}
        </div>

        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">SLA remaining</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm font-medium">
            <Clock className="h-3.5 w-3.5 shrink-0 text-sky-600" />
            {active[0] ? eApprovalSlaState(active[0]).label : '—'}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

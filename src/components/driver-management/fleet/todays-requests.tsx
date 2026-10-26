'use client';

/**
 * Today's over-limit requests, with their answers. A waiting request can be withdrawn; an approved
 * one offers "Start now", which reopens the start with what was asked for. The home screen polls
 * while anything is waiting, so the answer appears here without the driver refreshing.
 */

import { useState } from 'react';
import { Hourglass, Loader2, Play, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { useToast } from '@/hooks/use-toast';
import { istTimeLabel } from '@/lib/fleet/dates';
import { formatKm, type FleetApproval } from '@/lib/fleet/types';
import { fleetErrorMessage, fleetFetch } from '@/components/fleet/fleet-api';
import { ApprovalStatusBadge } from '@/components/fleet/fleet-ui';

export function TodaysRequests({ approvals, onChanged, onStartNow, startDisabled }: { approvals: FleetApproval[]; onChanged: () => void; onStartNow: (approval: FleetApproval) => void; startDisabled: boolean }) {
  const { toast } = useToast();
  const [withdrawing, setWithdrawing] = useState<FleetApproval | null>(null);
  const [busy, setBusy] = useState(false);

  if (!approvals.length) return null;
  const waiting = approvals.some((approval) => approval.status === 'pending');

  async function withdraw(approval: FleetApproval) {
    setBusy(true);
    try {
      await fleetFetch<{ approval: FleetApproval }>(`approvals/${approval.id}`, { method: 'POST', body: { action: 'cancel' } });
      toast({ title: 'Request withdrawn' });
      onChanged();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Not withdrawn', description: fleetErrorMessage(error) });
      throw error;
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="w-full">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Hourglass className="h-4 w-4 text-amber-600" aria-hidden />
          Today&apos;s requests
          {waiting && (
            <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              watching for an answer
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 pb-2">
        <ul className="divide-y divide-slate-100">
          {approvals.map((approval) => (
            <li key={approval.id} className="flex min-w-0 flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-slate-800">{approval.vehicleNumber}</span>
                  <ApprovalStatusBadge status={approval.status} />
                  <span className="text-xs text-muted-foreground">asked {istTimeLabel(approval.createdAt)}</span>
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {formatKm(approval.requestedKm)} more · {formatKm(approval.usedKm)} of {formatKm(approval.limitKm)} used · {approval.purposeName}
                  {approval.projectName ? ` · ${approval.projectName}` : ''}
                </p>
                {approval.status === 'approved' && (
                  <p className="text-xs text-emerald-700">
                    {approval.decidedByName} allowed {formatKm(approval.allowedKm)} today{approval.decisionNote ? ` — ${approval.decisionNote}` : ''}
                  </p>
                )}
                {approval.status === 'rejected' && <p className="break-words text-xs text-rose-700">{approval.decidedByName}: {approval.decisionNote}</p>}
                {approval.status === 'pending' && approval.level > 1 && <p className="text-xs text-amber-700">Moved up to level {approval.level} — nobody answered in time.</p>}
              </div>
              <div className="flex shrink-0 gap-2">
                {approval.status === 'approved' && (
                  <Button type="button" size="sm" onClick={() => onStartNow(approval)} disabled={startDisabled}>
                    <Play className="mr-1.5 h-4 w-4" aria-hidden />
                    Start now
                  </Button>
                )}
                {approval.status === 'pending' && (
                  <Button type="button" size="sm" variant="outline" onClick={() => setWithdrawing(approval)}>
                    <Undo2 className="mr-1.5 h-4 w-4" aria-hidden />
                    Withdraw
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
      <ConfirmDialog
        open={Boolean(withdrawing)}
        onOpenChange={(open) => !open && setWithdrawing(null)}
        title="Withdraw this request?"
        description="Your approver will no longer see it. You can ask again later."
        confirmLabel="Withdraw"
        loading={busy}
        onConfirm={() => (withdrawing ? withdraw(withdrawing) : undefined)}
      />
    </Card>
  );
}

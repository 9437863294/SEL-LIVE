'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AlertTriangle, ExternalLink, Link2Off, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { PaymentObligation } from '@/lib/recurring-payments';
import { isRecurringMirrorClosed, recurringMirrorLabel } from '@/lib/recurring-payments-e-approval';
import {
  detachRecurringPaymentApproval,
  recurringPaymentEApprovalActor,
  syncRecurringPaymentApproval,
} from '@/lib/recurring-payments-e-approval-service';

/**
 * The payment's view of its mirrored approval.
 *
 * Shown wherever somebody might be about to act on the payment — the workflow queue's dialog and the
 * payment detail screen — because the single most confusing thing about a mirror is not knowing one
 * exists. An approver who has already signed in E-Approval and then finds the payment apparently
 * untouched will sign again; a colleague who sees "pending with Finance" here and cannot find it in
 * their own queue needs to be told where it actually is.
 *
 * Both sides remain actionable. This card does not stop anybody working the payment here — it says
 * where the other copy is and who is holding it, and offers the two operations a person might
 * genuinely need: force a re-sync, and break the link when a mirror has gone wrong.
 */
export function PaymentEApprovalCard({
  payment,
  compact = false,
  onChanged,
}: {
  payment: PaymentObligation;
  /** Trimmed down for the workflow action dialog, where space is tight. */
  compact?: boolean;
  onChanged?: () => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const mirror = payment.eApproval;
  if (!mirror?.requestId) return null;

  const detached = Boolean(mirror.detachedAt);
  const closed = isRecurringMirrorClosed(mirror);
  // The payment module's own word for where the mirror stands — the step name while the workflow is
  // running, 'Completed' once every step is done. E-Approval's "Approved" is true of the approval
  // and misleading on a payment that still has four steps to go.
  const label = recurringMirrorLabel(mirror);

  async function resync() {
    const actor = recurringPaymentEApprovalActor(user);
    if (!actor) return;
    setBusy(true);
    try {
      const result = await syncRecurringPaymentApproval(payment.id, actor);
      toast(
        result.error
          ? { title: 'The approval could not be synchronised', description: result.error, variant: 'destructive' }
          : { title: result.summary || 'Already in step', description: result.summary ? undefined : 'The payment and its approval agree.' },
      );
      onChanged?.();
    } finally {
      setBusy(false);
    }
  }

  async function detach() {
    const actor = recurringPaymentEApprovalActor(user);
    if (!actor) return;
    setBusy(true);
    try {
      await detachRecurringPaymentApproval(payment.id, `Detached by ${actor.userName}.`, actor);
      toast({ title: 'Approval unlinked', description: 'The payment now runs on its own workflow. The approval keeps its record.' });
      onChanged?.();
    } catch (error) {
      toast({ title: 'Could not unlink', description: error instanceof Error ? error.message : undefined, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`rounded-xl border ${detached ? 'border-dashed bg-muted/30' : 'border-indigo-200 bg-indigo-50/60'} p-3`}>
      <div className="flex flex-wrap items-start gap-3">
        <ShieldCheck className={`mt-0.5 h-5 w-5 shrink-0 ${detached ? 'text-muted-foreground' : 'text-indigo-600'}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">
              {detached ? 'Unlinked from E-Approval' : 'Also running in E-Approval'}
            </p>
            {mirror.referenceNo && (
              <Badge variant="outline" className="font-mono text-[10px]">{mirror.referenceNo}</Badge>
            )}
            {label && <Badge variant={closed ? 'secondary' : 'default'} className="text-[10px]">{label}</Badge>}
            {mirror.mode === 'Visibility' && !detached && (
              <Badge variant="outline" className="text-[10px]">Complete here, not there</Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {detached
              ? mirror.detachedReason || 'This payment no longer follows its approval.'
              : mirror.mode === 'Visibility'
                ? `This step needs details only this form collects, so E-Approval shows it without offering a decision. ${mirror.pendingLabel || ''}`.trim()
                : mirror.pendingLabel || 'Either side can act — whichever moves first brings the other with it.'}
          </p>
          {mirror.lastError && (
            <p className="mt-1 flex items-start gap-1.5 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {mirror.lastError}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          <Button asChild size="sm" variant="outline" className="h-8 gap-1.5">
            <Link href={`/e-approval/${mirror.requestId}`}>
              <ExternalLink className="h-3.5 w-3.5" /> Open
            </Link>
          </Button>
          {!compact && !detached && (
            <>
              <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={resync} disabled={busy}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Sync
              </Button>
              <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-muted-foreground" onClick={detach} disabled={busy}>
                <Link2Off className="h-3.5 w-3.5" /> Unlink
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

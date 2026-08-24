'use client';

import { useEffect, useState } from 'react';
import { Loader2, RotateCcw, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { formatEApprovalDuration, type EApprovalHistoryEntry } from '@/lib/e-approval';
import { eApprovalDialogClass } from './shared';
import {
  evaluateEApprovalUndo,
  undoEApprovalAction,
  type EApprovalServiceActor,
  type EApprovalUndoOption,
} from '@/lib/e-approval-service';

/**
 * Take-back controls on a history entry (recall and reverse).
 *
 * Two separate powers, shown as two separate buttons, because they mean different things and the
 * record has to say which was used:
 *
 *   **Recall** — you take back your own dispatch, within minutes, before anyone has acted on it. The
 *   step it created is removed outright, because within that window nothing happened worth recording
 *   beyond the recall itself.
 *
 *   **Reverse** — somebody with the permission undoes a *completed* action, within hours. Used when
 *   an approval was given against the wrong figure, or a rejection needs reopening.
 *
 * Neither is a delete. Both append to the trail: the original action stays, and the undo sits after
 * it saying who undid what and why.
 */
export function EApprovalUndoButtons({
  approvalId,
  entry,
  history,
  serviceActor,
  canReverse,
  onDone,
}: {
  approvalId: string;
  entry: EApprovalHistoryEntry;
  history: EApprovalHistoryEntry[];
  serviceActor: EApprovalServiceActor | null;
  canReverse: boolean;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [verdict, setVerdict] = useState<EApprovalUndoOption | null>(null);
  const [dialog, setDialog] = useState<'Recall' | 'Reverse' | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  // Only entries carrying a snapshot can be undone at all, so the rest never cost a check.
  useEffect(() => {
    if (!serviceActor || !entry.undo) {
      setVerdict(null);
      return;
    }
    let cancelled = false;
    void evaluateEApprovalUndo(approvalId, entry, serviceActor, { canReverse, history })
      .then((result) => {
        if (!cancelled) setVerdict(result);
      })
      .catch(() => {
        if (!cancelled) setVerdict(null);
      });
    return () => {
      cancelled = true;
    };
  }, [approvalId, entry, history, serviceActor, canReverse]);

  const submit = async () => {
    if (!serviceActor || !dialog) return;
    setBusy(true);
    try {
      await undoEApprovalAction(
        approvalId,
        entry.id,
        { kind: dialog, reason: reason.trim() || undefined, canReverse },
        serviceActor,
      );
      toast({ title: dialog === 'Recall' ? 'Request withdrawn' : 'Action reversed' });
      setDialog(null);
      setReason('');
      onDone();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: dialog === 'Recall' ? 'Could not recall' : 'Could not reverse',
        description: error instanceof Error ? error.message : 'Something went wrong.',
      });
    } finally {
      setBusy(false);
    }
  };

  if (!verdict) return null;
  const { recall, reverse } = verdict;
  if (!recall.allowed && !reverse.allowed) return null;

  return (
    <>
      <span className="flex shrink-0 flex-wrap items-center gap-1">
        {recall.allowed && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 gap-1 px-2 text-[11px]"
            onClick={() => setDialog('Recall')}
            title={
              recall.remainingMs != null
                ? `${formatEApprovalDuration(recall.remainingMs)} left to take this back`
                : undefined
            }
          >
            <Undo2 className="h-3 w-3" /> Recall
            {recall.remainingMs != null && (
              <span className="text-muted-foreground">· {formatEApprovalDuration(recall.remainingMs)}</span>
            )}
          </Button>
        )}
        {/* Only offered where recall is not — otherwise the author sees two buttons for one intent. */}
        {!recall.allowed && reverse.allowed && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 gap-1 px-2 text-[11px] text-amber-800"
            onClick={() => setDialog('Reverse')}
          >
            <RotateCcw className="h-3 w-3" /> Reverse
          </Button>
        )}
      </span>

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className={eApprovalDialogClass.content}>
          <DialogHeader className={eApprovalDialogClass.header}>
            <DialogTitle>{dialog === 'Recall' ? 'Recall this request' : 'Reverse this action'}</DialogTitle>
            <DialogDescription className="text-xs">
              {dialog === 'Recall'
                ? 'The file comes straight back to you and whoever it was sent to is told it has been withdrawn. The recall is recorded — the original action is not erased.'
                : 'The file returns to exactly the state it was in before this action. Both the action and your reversal stay on the record.'}
            </DialogDescription>
          </DialogHeader>

          <div className={eApprovalDialogClass.body}>
            <p className="rounded-md border bg-muted/30 px-2.5 py-2 text-xs">
              <span className="font-medium">Undoing:</span> {entry.summary}
            </p>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Reason{dialog === 'Reverse' && <span className="text-rose-600"> *</span>}
              </label>
              <Textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={2}
                className="text-sm"
                placeholder={dialog === 'Recall' ? 'Sent to the wrong person.' : 'Approved against the wrong budget head.'}
              />
            </div>
          </div>

          <DialogFooter className={eApprovalDialogClass.footer}>
            <Button variant="outline" onClick={() => setDialog(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              onClick={() => void submit()}
              disabled={busy || (dialog === 'Reverse' && !reason.trim())}
            >
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {dialog === 'Recall' ? 'Recall' : 'Reverse'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

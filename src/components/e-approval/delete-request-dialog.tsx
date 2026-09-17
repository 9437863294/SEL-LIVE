'use client';

import { useEffect, useState } from 'react';
import { Loader2, Trash2, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { canDeleteEApprovalRequest, type EApprovalDetail, type EApprovalRequest } from '@/lib/e-approval';
import {
  deleteEApprovalRequest,
  loadEApprovalDetail,
  type EApprovalServiceActor,
} from '@/lib/e-approval-service';
import { eApprovalDialogClass, eApprovalDialogGuard } from './shared';

/** What the dialog lists as "deleted with it". Only the parts that exist are named. */
function describeContents(detail: EApprovalDetail): string[] {
  return (
    [
      [detail.steps.length, detail.steps.length === 1 ? 'workflow stage' : 'workflow stages'],
      [detail.history.length, detail.history.length === 1 ? 'audit entry' : 'audit entries'],
      [detail.comments.length, detail.comments.length === 1 ? 'comment' : 'comments'],
      [detail.attachments.length, detail.attachments.length === 1 ? 'attachment' : 'attachments'],
      [detail.versions.length, detail.versions.length === 1 ? 'superseded version' : 'superseded versions'],
    ] as Array<[number, string]>
  )
    .filter(([count]) => count > 0)
    .map(([count, noun]) => `${count} ${noun}`);
}

export interface DeleteApprovalAuthority {
  serviceActor: EApprovalServiceActor | null;
  canDeleteDraft: boolean;
  canDeleteAny: boolean;
}

/**
 * The confirmation itself, mounted only while a request is actually being deleted.
 *
 * Separate from the button because the register puts a delete control on as many as four hundred
 * rows, and a dialog per row would be four hundred component subtrees — on the one table in this
 * module whose render cost is already commented about. The register renders a cheap button per row
 * and exactly one of these, keyed by the row being deleted; mounting fresh each time is also what
 * lets the reason field and the content counts start clean with no reset effect.
 *
 * Two authorities behind it (`canDeleteEApprovalRequest` decides which):
 *
 *   **A draft** — the requester binning something never submitted. One line of confirmation, because
 *   nothing has been seen and nothing was approved.
 *
 *   **Anything submitted** — somebody holding `Requests → Delete` removing a file that has been
 *   through approvers. This destroys approvals that were actually given, so the dialog says plainly
 *   what is about to stop existing, counts it, and will not proceed without a reason.
 *
 * Cancel is the default-focused action and the confirm is destructive-red — this is the one dialog in
 * the module where the safe choice should be the easy one.
 */
export function DeleteApprovalDialog({
  request,
  detail,
  serviceActor,
  canDeleteDraft,
  canDeleteAny,
  onClose,
  onDeleted,
}: DeleteApprovalAuthority & {
  request: EApprovalRequest;
  /** Supplied by screens that have already loaded it; otherwise fetched on mount. */
  detail?: EApprovalDetail;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { toast } = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [contents, setContents] = useState<string[] | null>(detail ? describeContents(detail) : null);
  const [countFailed, setCountFailed] = useState(false);

  const decision = canDeleteEApprovalRequest(request, serviceActor, { canDeleteDraft, canDeleteAny });
  const administrative = decision.kind === 'Administrative';

  useEffect(() => {
    if (detail) return;
    // Opened from a register row: one read for the "deleted with it" list. A failure is reported
    // rather than fatal — the deletion does not depend on it, and refusing to let somebody delete
    // because we could not *describe* the thing would be the wrong trade.
    let cancelled = false;
    void loadEApprovalDetail(request.id)
      .then((loaded) => {
        if (cancelled) return;
        if (loaded) setContents(describeContents(loaded));
        else setCountFailed(true);
      })
      .catch(() => {
        if (!cancelled) setCountFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [detail, request.id]);

  const submit = async () => {
    if (!serviceActor) return;
    setBusy(true);
    try {
      const removed = await deleteEApprovalRequest(request.id, serviceActor, {
        canDeleteDraft,
        canDeleteAny,
        reason: reason.trim() || undefined,
      });
      const total = removed.steps + removed.history + removed.comments + removed.attachments + removed.versions;
      toast({
        title: administrative ? 'Approval deleted' : 'Draft deleted',
        description: total
          ? `${request.referenceNo || 'The draft'} and ${total} related record${total === 1 ? '' : 's'} removed.`
          : undefined,
      });
      onDeleted();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Could not delete',
        description: error instanceof Error ? error.message : 'Something went wrong.',
      });
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !busy && !next && onClose()}>
      <DialogContent
        className={eApprovalDialogClass.content}
        {...eApprovalDialogGuard(busy || reason.trim() !== '')}
      >
        <DialogHeader className={eApprovalDialogClass.header}>
          <DialogTitle className="text-destructive">
            {administrative ? 'Delete this approval and its workflow' : 'Delete this draft'}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {administrative
              ? 'The request and everything belonging to it stop existing. This cannot be undone — there will be nothing left to undo it from.'
              : 'It was never submitted, so nothing has seen it. This cannot be undone.'}
          </DialogDescription>
        </DialogHeader>

        <div className={eApprovalDialogClass.body}>
          <p className="rounded-md border bg-muted/30 px-2.5 py-2 text-xs">
            <span className="font-medium">{request.referenceNo || 'No reference yet'}</span>
            {' — '}
            {request.subject}
          </p>

          {administrative && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-xs text-destructive">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0">
                <p className="font-semibold">
                  This approval is {request.status.toLowerCase()} — approvers have already acted on it.
                </p>
                <p className="mt-0.5 leading-snug text-destructive/90">
                  Cancelling it instead closes it and keeps the record. Delete only where the request should never
                  have existed.
                </p>
              </div>
            </div>
          )}

          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Deleted with it
            </p>
            {countFailed ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900">
                Could not read what belongs to this approval. Deleting still removes all of it — its stages, audit
                trail, comments, attachments and superseded versions.
              </p>
            ) : contents === null ? (
              <p className="flex items-center gap-1.5 rounded-md border px-2.5 py-2 text-[11px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Checking what belongs to this approval…
              </p>
            ) : contents.length ? (
              <ul className="space-y-0.5 rounded-md border px-2.5 py-2">
                {contents.map((entry) => (
                  <li key={entry} className="text-xs text-muted-foreground">
                    {entry}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-md border px-2.5 py-2 text-[11px] text-muted-foreground">
                Nothing else — it has no stages, comments or attachments yet.
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Reason{administrative && <span className="text-destructive"> *</span>}
            </label>
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              className="text-sm"
              placeholder={
                administrative
                  ? 'Raised against the wrong company; re-raised as EA/FIN/2026-27/00212.'
                  : 'Optional.'
              }
            />
            {administrative && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Recorded in the activity log along with who deleted it and what was removed. That entry is the only
                part of this approval that will still exist.
              </p>
            )}
          </div>
        </div>

        <DialogFooter className={eApprovalDialogClass.footer}>
          <Button variant="outline" onClick={onClose} disabled={busy} autoFocus>
            Keep it
          </Button>
          <Button
            variant="destructive"
            onClick={() => void submit()}
            disabled={busy || (administrative && !reason.trim())}
          >
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Trash2 className="mr-1.5 h-4 w-4" />}
            {administrative ? 'Delete permanently' : 'Delete draft'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Whether to offer deletion of this row at all, and what to call it.
 *
 * Exported so the register can render a bare button per row without mounting a dialog with it — the
 * decision is pure and takes only the status and the requester, both of which a register row already
 * carries, so four hundred rows cost four hundred comparisons and no reads.
 */
export function eApprovalDeleteLabel(
  request: EApprovalRequest,
  authority: DeleteApprovalAuthority,
): string | null {
  const decision = canDeleteEApprovalRequest(request, authority.serviceActor, {
    canDeleteDraft: authority.canDeleteDraft,
    canDeleteAny: authority.canDeleteAny,
  });
  if (!decision.allowed) return null;
  return decision.kind === 'Administrative' ? 'Delete approval' : 'Delete draft';
}

/** A trailing icon button for one register row. Opening it is the parent's business. */
export function DeleteApprovalRowButton({
  request,
  authority,
  onSelect,
}: {
  request: EApprovalRequest;
  authority: DeleteApprovalAuthority;
  onSelect: (request: EApprovalRequest) => void;
}) {
  const label = eApprovalDeleteLabel(request, authority);
  if (!label) return null;
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="h-7 w-7 shrink-0 p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
      aria-label={`${label} — ${request.referenceNo || request.subject}`}
      title={label}
      onClick={() => onSelect(request)}
    >
      <Trash2 className="h-3.5 w-3.5" />
    </Button>
  );
}

/**
 * Button plus dialog, for the screens that show one approval.
 *
 * The dialog is mounted only once opened, so this costs a button until somebody means it.
 */
export function DeleteApprovalButton({
  detail,
  serviceActor,
  canDeleteDraft,
  canDeleteAny,
  onDeleted,
}: DeleteApprovalAuthority & {
  detail: EApprovalDetail;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const authority = { serviceActor, canDeleteDraft, canDeleteAny };
  const label = eApprovalDeleteLabel(detail.request, authority);
  if (!label) return null;

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8 gap-1.5 text-destructive hover:bg-destructive/5"
        onClick={() => setOpen(true)}
      >
        <Trash2 className="h-3.5 w-3.5" />
        {label === 'Delete approval' ? 'Delete' : 'Delete draft'}
      </Button>

      {open && (
        <DeleteApprovalDialog
          request={detail.request}
          detail={detail}
          {...authority}
          onClose={() => setOpen(false)}
          onDeleted={onDeleted}
        />
      )}
    </>
  );
}

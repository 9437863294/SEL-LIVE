'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  describeEApprovalAssignment,
  E_APPROVAL_BASE_PATH,
  isPositiveEApprovalOutcome,
  type EApprovalDetail,
} from '@/lib/e-approval';
import { loadEApprovalDetail } from '@/lib/e-approval-service';
import { EApprovalRichText } from '@/components/e-approval/rich-text-editor';
import {
  formatEApprovalAmount,
  formatEApprovalDate,
  formatEApprovalDateTime,
  useEApprovalPermissions,
} from '@/components/e-approval/hooks';

/**
 * The final approval note of spec section 25.
 *
 * Printed from the record rather than composed by hand: the approval history *is* the signature
 * block, so a note-sheet that has been through five desks needs no retyping and cannot disagree with
 * the file it came from. Verification steps are listed alongside the approvals, indented, because a
 * note that shows only the approvals hides the checks the approvals relied on.
 */
export default function EApprovalNotePage() {
  const params = useParams<{ approvalId: string }>();
  const approvalId = String(params?.approvalId ?? '');
  const permissions = useEApprovalPermissions();
  const [detail, setDetail] = useState<EApprovalDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const printRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!approvalId) return;
    setIsLoading(true);
    setDetail(await loadEApprovalDetail(approvalId));
    setIsLoading(false);
  }, [approvalId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (isLoading) return <Skeleton className="h-96 w-full" />;

  if (!detail) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Approval not found</CardTitle>
        </CardHeader>
      </Card>
    );
  }

  if (!permissions.canPrint) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Not permitted</CardTitle>
          <CardDescription>You do not have permission to print approval notes.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const { request, steps, attachments, comments } = detail;
  const acted = steps
    .filter((step) => step.completedAt && step.outcome)
    .sort((a, b) => String(a.completedAt).localeCompare(String(b.completedAt)));
  /**
   * The stages still to come, printed after the ones that have acted.
   *
   * Without these the note showed only what had happened, so a part-approved sheet gave no way to
   * tell whether it was finished or still moving — and "who is it with now" is the first question
   * anybody asks of a note-sheet in circulation. Skipped and cancelled steps stay out: they are not
   * outstanding, and listing them would imply the file is still waiting on somebody it is not.
   */
  const outstanding = steps
    .filter((step) => !step.completedAt && step.status !== 'Skipped' && step.status !== 'Cancelled')
    .sort((a, b) => a.sequence - b.sequence || a.depth - b.depth);
  /** Retracted comments are struck through in the app; on paper they are simply not part of the record. */
  const printableComments = comments
    .filter((comment) => !comment.retracted)
    .sort((a, b) => (a.createdAt?.toMillis() ?? 0) - (b.createdAt?.toMillis() ?? 0));

  return (
    <div className="space-y-3">
      <Card className="print:hidden">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:px-4">
          <Button asChild size="sm" variant="ghost" className="-ml-2 h-8 gap-1 px-1.5 text-xs">
            <Link href={`${E_APPROVAL_BASE_PATH}/${request.id}`}>
              <ArrowLeft className="h-3.5 w-3.5" /> Back to the approval
            </Link>
          </Button>
          <Button size="sm" className="h-8 gap-1.5" onClick={() => window.print()}>
            <Printer className="h-3.5 w-3.5" /> Print
          </Button>
        </CardHeader>
      </Card>

      <div
        ref={printRef}
        className="ea-approval-note mx-auto max-w-3xl rounded-lg border bg-white p-6 text-slate-900 shadow-sm"
      >
        <div className="border-b-2 border-slate-800 pb-3 text-center">
          <h1 className="text-lg font-bold uppercase tracking-wide">Sidhartha Engineering Limited</h1>
          <p className="mt-0.5 text-sm font-semibold uppercase tracking-widest text-slate-600">
            {request.status === 'Approved' ? 'Approval Note' : 'E-Approval'}
          </p>
          {/* Marked on the paper, not just on the screen. A confidential note-sheet that prints
              looking like any other is how one ends up read off a shared printer tray. */}
          {request.confidential && (
            <p className="mt-1.5 inline-block border-2 border-slate-800 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.2em]">
              Confidential
            </p>
          )}
        </div>

        <table className="mt-4 w-full text-sm">
          <tbody>
            <tr>
              <td className="w-40 py-1 align-top font-semibold">Reference</td>
              <td className="py-1 font-mono">{request.referenceNo || '—'}</td>
            </tr>
            <tr>
              <td className="py-1 align-top font-semibold">Subject</td>
              <td className="py-1">{request.subject}</td>
            </tr>
            <tr>
              <td className="py-1 align-top font-semibold">Requested by</td>
              <td className="py-1">
                {request.requesterName || '—'}
                {request.requesterDesignation ? `, ${request.requesterDesignation}` : ''}
                {request.departmentName ? ` · ${request.departmentName}` : ''}
              </td>
            </tr>
            {request.projectName && (
              <tr>
                <td className="py-1 align-top font-semibold">Project / Site</td>
                <td className="py-1">{request.projectName}</td>
              </tr>
            )}
            <tr>
              <td className="py-1 align-top font-semibold">Date</td>
              <td className="py-1">{formatEApprovalDate(request.submittedAt)}</td>
            </tr>
            {request.amount != null && (
              <tr>
                <td className="py-1 align-top font-semibold">
                  {request.approvedAmount != null && request.approvedAmount !== request.amount
                    ? 'Amount sanctioned'
                    : 'Amount'}
                </td>
                <td className="py-1 font-semibold">
                  {formatEApprovalAmount(request.approvedAmount ?? request.amount)}
                </td>
              </tr>
            )}
            {request.approvedAmount != null && request.approvedAmount !== request.amount && (
              <tr>
                <td className="py-1 align-top font-semibold text-muted-foreground">Amount requested</td>
                <td className="py-1 text-muted-foreground">{formatEApprovalAmount(request.amount)}</td>
              </tr>
            )}
            {request.vendorName && (
              <tr>
                <td className="py-1 align-top font-semibold">Vendor / party</td>
                <td className="py-1">{request.vendorName}</td>
              </tr>
            )}
            {/* The filing details a paper note-sheet carries in its header block. Each is omitted
                when unset rather than printed as a dash, so the note stays as short as its content. */}
            {request.approvalTypeName && (
              <tr>
                <td className="py-1 align-top font-semibold">Kind of approval</td>
                <td className="py-1">{request.approvalTypeName}</td>
              </tr>
            )}
            {request.priority !== 'Normal' && (
              <tr>
                <td className="py-1 align-top font-semibold">Priority</td>
                <td className="py-1 font-semibold uppercase">{request.priority}</td>
              </tr>
            )}
            {request.requiredBy && (
              <tr>
                <td className="py-1 align-top font-semibold">Required by</td>
                <td className="py-1">{formatEApprovalDate(request.requiredBy)}</td>
              </tr>
            )}
            {request.externalRef && (
              <tr>
                <td className="py-1 align-top font-semibold">Your reference</td>
                <td className="py-1">{request.externalRef}</td>
              </tr>
            )}
            {(request.costCentre || request.budgetHead) && (
              <tr>
                <td className="py-1 align-top font-semibold">Cost centre / budget head</td>
                <td className="py-1">{[request.costCentre, request.budgetHead].filter(Boolean).join(' · ')}</td>
              </tr>
            )}
            {request.version > 1 && (
              <tr>
                <td className="py-1 align-top font-semibold">Version</td>
                <td className="py-1">
                  {request.version}{' '}
                  <span className="text-xs text-slate-500">
                    (earlier versions superseded; approvals below relate to this version)
                  </span>
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="mt-4">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-600">Proposal</p>
          {/*
            The formatting matters most here of all: this is the sheet that gets signed and filed, so
            a pasted comparative statement has to print as the table it was, not as a run of
            tab-separated text. `ea-rich-text`'s print rules keep tables whole across a page break.
          */}
          {request.bodyHtml ? (
            <EApprovalRichText html={request.bodyHtml} className="mt-1" />
          ) : (
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{request.body}</p>
          )}
        </div>

        <div className="mt-5">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-600">Approval History</p>
          <table className="mt-1 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-300 text-left text-xs uppercase text-slate-500">
                <th className="py-1">Stage</th>
                <th className="py-1">Acted by</th>
                <th className="py-1">Action</th>
                <th className="py-1">Date</th>
              </tr>
            </thead>
            <tbody>
              {acted.map((step) => (
                <tr key={step.id} className="border-b border-slate-100 align-top">
                  <td className={step.depth > 0 ? 'py-1 pl-4 text-slate-600' : 'py-1 font-medium'}>
                    {step.depth > 0 && <span className="mr-1 text-slate-400">↳</span>}
                    {step.name}
                  </td>
                  <td className="py-1">
                    {step.actedByName || describeEApprovalAssignment(step.assignment)}
                    {step.onBehalfOfName && (
                      <span className="block text-xs text-slate-500">on behalf of {step.onBehalfOfName}</span>
                    )}
                  </td>
                  <td className={isPositiveEApprovalOutcome(step.outcome) ? 'py-1 font-medium' : 'py-1'}>
                    {step.outcome}
                    {step.comment && <span className="block text-xs italic text-slate-500">“{step.comment}”</span>}
                  </td>
                  <td className="whitespace-nowrap py-1 text-xs">{formatEApprovalDateTime(step.completedAt)}</td>
                </tr>
              ))}
              {outstanding.map((step) => (
                <tr key={step.id} className="border-b border-slate-100 align-top text-slate-500">
                  <td className={step.depth > 0 ? 'py-1 pl-4' : 'py-1 font-medium'}>
                    {step.depth > 0 && <span className="mr-1 text-slate-400">↳</span>}
                    {step.name}
                  </td>
                  <td className="py-1">{describeEApprovalAssignment(step.assignment)}</td>
                  <td className="py-1 italic">
                    {step.status === 'Active' ? 'Awaiting action' : step.status}
                    {step.groupMode && step.groupMode !== 'Single' && (
                      <span className="block text-xs">
                        {step.groupMode === 'All'
                          ? 'all must approve'
                          : step.groupMode === 'Any'
                            ? 'any one may approve'
                            : `${step.groupRequiredCount ?? 2} of the group must approve`}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap py-1 text-xs">—</td>
                </tr>
              ))}
              {acted.length === 0 && outstanding.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-3 text-center text-xs text-slate-500">
                    No action has been recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/*
          Comments. A paper note-sheet carries its remarks in the margin, and they are frequently the
          part that explains a decision the outcome column only names — so a printed record that drops
          them is missing the reasoning behind itself. They were already being loaded and thrown away.
        */}
        {printableComments.length > 0 && (
          <div className="mt-5">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-600">Remarks</p>
            <ol className="mt-1 space-y-2 text-sm">
              {printableComments.map((comment) => (
                <li key={comment.id} className="border-l-2 border-slate-200 pl-2.5">
                  <p className="text-xs text-slate-500">
                    <span className="font-semibold text-slate-700">{comment.authorName || 'Unknown'}</span>
                    {comment.authorDesignation ? `, ${comment.authorDesignation}` : ''}
                    {' · '}
                    {formatEApprovalDateTime(
                      comment.createdAt ? new Date(comment.createdAt.toMillis()).toISOString() : null,
                    )}
                    {comment.stepName ? ` · at ${comment.stepName}` : ''}
                    {comment.editHistory?.length ? ' · edited' : ''}
                  </p>
                  <p className="whitespace-pre-wrap">{comment.body}</p>
                </li>
              ))}
            </ol>
          </div>
        )}

        {attachments.length > 0 && (
          <div className="mt-5">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-600">Attachments</p>
            <ol className="mt-1 list-decimal pl-5 text-sm">
              {attachments.map((attachment) => (
                <li key={attachment.id}>
                  {attachment.name}
                  <span className="text-xs text-slate-500">
                    {' '}
                    — {attachment.uploadedByName || 'uploaded'}, {formatEApprovalDate(attachment.uploadedAt)}
                    {attachment.version ? ` (v${attachment.version})` : ''}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}

        <div className="mt-6 flex items-end justify-between border-t-2 border-slate-800 pt-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Final status</p>
            <p className="text-base font-bold uppercase">{request.status}</p>
            {request.completedAt && (
              <p className="text-xs text-slate-500">{formatEApprovalDateTime(request.completedAt)}</p>
            )}
          </div>
          <div className="max-w-[55%] text-right text-xs text-slate-500">
            {/* Whichever reason applies to how the file came to rest. Only rejection was printed
                before, so a returned or cancelled note carried no explanation of either. */}
            {(request.rejectionReason || request.cancelReason || request.returnReason || request.holdReason) && (
              <p className="mb-1 text-slate-700">
                Reason: {request.rejectionReason || request.cancelReason || request.returnReason || request.holdReason}
              </p>
            )}
            <p>
              Generated from the E-Approval record on {formatEApprovalDateTime(new Date().toISOString())}. This is a
              system-generated note; approvals are recorded electronically above.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

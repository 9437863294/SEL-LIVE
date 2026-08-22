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
  primaryEApprovalSteps,
  type EApprovalDetail,
} from '@/lib/e-approval';
import { loadEApprovalDetail } from '@/lib/e-approval-service';
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

  const { request, steps, attachments } = detail;
  const acted = steps
    .filter((step) => step.completedAt && step.outcome)
    .sort((a, b) => String(a.completedAt).localeCompare(String(b.completedAt)));

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

      <div ref={printRef} className="mx-auto max-w-3xl rounded-lg border bg-white p-6 text-slate-900 shadow-sm print:border-0 print:shadow-none">
        <div className="border-b-2 border-slate-800 pb-3 text-center">
          <h1 className="text-lg font-bold uppercase tracking-wide">Sidhartha Engineering Limited</h1>
          <p className="mt-0.5 text-sm font-semibold uppercase tracking-widest text-slate-600">E-Approval</p>
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
                <td className="py-1 align-top font-semibold">Amount</td>
                <td className="py-1 font-semibold">{formatEApprovalAmount(request.amount)}</td>
              </tr>
            )}
            {request.vendorName && (
              <tr>
                <td className="py-1 align-top font-semibold">Vendor / party</td>
                <td className="py-1">{request.vendorName}</td>
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
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{request.body}</p>
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
              {acted.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-3 text-center text-xs text-slate-500">
                    No action has been recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

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
          {(primaryEApprovalSteps(steps).length > 0 || request.rejectionReason) && (
            <div className="max-w-[50%] text-right text-xs text-slate-500">
              {request.rejectionReason && <p>Reason: {request.rejectionReason}</p>}
              <p>
                Generated from the E-Approval record on {formatEApprovalDateTime(new Date().toISOString())}. This is a
                system-generated note; signatures are recorded electronically above.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

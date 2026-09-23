'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  describeEApprovalAssignment,
  E_APPROVAL_BASE_PATH,
  E_APPROVAL_REASSIGNMENT_VERBS,
  isPositiveEApprovalOutcome,
  type EApprovalDetail,
  type EApprovalStep,
} from '@/lib/e-approval';
import { loadEApprovalDetail } from '@/lib/e-approval-service';
import {
  describeEApprovalPrintFit,
  E_APPROVAL_PAGE_MARGIN_CSS,
  eApprovalPrintFit,
  type EApprovalPrintFit,
  type PrintOrientation,
} from '@/lib/e-approval-print-fit';
import { EApprovalRichText } from '@/components/e-approval/rich-text-editor';
import {
  formatEApprovalAmount,
  formatEApprovalDate,
  formatEApprovalDateTime,
  useEApprovalPermissions,
} from '@/components/e-approval/hooks';

/**
 * How a stage came to be where it is: every forward, delegation and escalation it went through.
 *
 * This is on the workflow tab and was missing from the note entirely, and the omission was worse
 * than a missing detail. Forwarding is how a file is actually routed here — and the covering
 * sentence a person writes when they forward it ("Dear Sir, please approve Rs 1,429 towards the
 * electricity bill…") is carried as the *reason* on the move, not as the stage's comment. A stage
 * that has been forwarded twice and not yet acted on therefore printed as one line naming its
 * current holder, with the entire substance of the request left on screen.
 *
 * Rendered for outstanding stages as much as for completed ones, for that reason: an unacted stage
 * is exactly the case where the trail is the only thing on the row worth reading.
 */
function StepMovements({ step, columns }: { step: EApprovalStep; columns: number }) {
  const moves = step.reassignments ?? [];
  if (!moves.length && !step.instruction) return null;
  return (
    <tr className="border-b border-slate-100">
      <td colSpan={columns} className="py-1 pl-4 text-xs text-slate-600">
        {step.instruction && (
          <p className="mb-0.5">
            <span className="font-medium text-slate-700">Instruction:</span> {step.instruction}
          </p>
        )}
        {moves.map((move, index) => (
          <p key={`${move.at}-${index}`} className="mb-0.5 last:mb-0">
            <span className="text-slate-400">↳ </span>
            <span className="font-medium text-slate-700">{E_APPROVAL_REASSIGNMENT_VERBS[move.kind]}</span> from{' '}
            {describeEApprovalAssignment(move.from)} to {describeEApprovalAssignment(move.to)}
            {move.byName && ` by ${move.byName}`} · {formatEApprovalDateTime(move.at)}
            {move.reason && ` — ${move.reason}`}
          </p>
        ))}
      </td>
    </tr>
  );
}

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
  const fitInnerRef = useRef<HTMLDivElement>(null);
  /** 'auto' lets the content decide; the other two are the manual override on the print bar. */
  const [orientation, setOrientation] = useState<'auto' | PrintOrientation>('auto');
  const [fit, setFit] = useState<EApprovalPrintFit | null>(null);
  /** The same decision the print handler reads — a listener must not close over stale state. */
  const fitRef = useRef<EApprovalPrintFit | null>(null);

  const load = useCallback(async () => {
    if (!approvalId) return;
    setIsLoading(true);
    setDetail(await loadEApprovalDetail(approvalId));
    setIsLoading(false);
  }, [approvalId]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * What the proposal wants to be, in CSS pixels. Reads only — never mutates.
   *
   * Measured rather than assumed: a table pasted from Excel carries its own column widths, and the
   * only way to know what it needs is to let it lay out and look. The widest table counts as well as
   * the block itself, because the table is what overflows while the block around it sits happily
   * clipped to its container.
   */
  const measureProposalWidth = useCallback((): number => {
    const inner = fitInnerRef.current;
    if (!inner) return 0;
    return Array.from(inner.querySelectorAll('table')).reduce(
      (max, table) => Math.max(max, table.scrollWidth),
      inner.scrollWidth,
    );
  }, []);

  /**
   * Keep the decision current as the proposal settles.
   *
   * A `ResizeObserver` rather than a measurement on mount, because `EApprovalRichText` renders a
   * 64px placeholder until DOMPurify has finished sanitising, asynchronously. Measuring once on
   * mount measured that placeholder — which is how the note came out with the approval history
   * printed on top of the proposal table: the height reserved for a scaled block was the height of
   * a spinner, and the real table overflowed it by several hundred pixels.
   *
   * The decision is mirrored into a ref as well as state. The `<style>` that turns the page
   * landscape is rendered from the state, so it has to be in the DOM *before* the print starts —
   * computing it inside `beforeprint` would be one React render too late for this print job.
   */
  useEffect(() => {
    const inner = fitInnerRef.current;
    if (isLoading || !detail || !inner) return;
    const update = () => {
      const next = eApprovalPrintFit(
        measureProposalWidth(),
        orientation === 'auto' ? {} : { force: orientation },
      );
      fitRef.current = next;
      setFit(next);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [measureProposalWidth, orientation, isLoading, detail]);

  /**
   * Apply the fit for the duration of the print, and only then.
   *
   * **`zoom`, not `transform: scale()`.** The two look identical on screen and behave completely
   * differently on paper: a transform is a paint-time effect, so a transformed block taller than
   * one sheet is *clipped* at the page boundary rather than continuing onto the next. A twelve-row
   * rate table would have come out fitted to the width and then cut off. `zoom` is a layout
   * property — the content genuinely becomes smaller, paginates like any other block, and needs no
   * height compensation, because the space it occupies shrinks with it.
   *
   * The width is set to what the content wants, not to the paper: `zoom` multiplies the layout box,
   * so a natural 1000px at `zoom: 0.7` occupies 700px. Pinning the width to the paper first and
   * then zooming would shrink it twice.
   *
   * On screen the proposal stays exactly as written — a wide table scrolls, as it does everywhere
   * else in the module. Bound to `beforeprint`/`afterprint` rather than to the Print button, because
   * Ctrl+P and the browser's own menu never touch our button.
   */
  useEffect(() => {
    if (isLoading || !detail) return;

    const clear = () => {
      const inner = fitInnerRef.current;
      if (!inner) return;
      inner.style.removeProperty('zoom');
      inner.style.removeProperty('width');
    };

    const apply = () => {
      const inner = fitInnerRef.current;
      if (!inner) return;
      clear();
      const next = fitRef.current;
      if (!next || next.scale >= 1) return;
      const natural = measureProposalWidth();
      if (natural > 0) inner.style.width = `${natural}px`;
      // `setProperty` rather than `style.zoom`: it is absent from the CSSStyleDeclaration typings
      // in this TypeScript version, and this is a plain string assignment either way.
      inner.style.setProperty('zoom', String(next.scale));
    };

    window.addEventListener('beforeprint', apply);
    window.addEventListener('afterprint', clear);
    return () => {
      window.removeEventListener('beforeprint', apply);
      window.removeEventListener('afterprint', clear);
      clear();
    };
  }, [isLoading, detail, measureProposalWidth]);

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
          <div className="flex flex-wrap items-center gap-2">
            {fit && (
              <span
                className={
                  fit.clipped
                    ? 'text-[11px] font-medium text-destructive'
                    : 'text-[11px] text-muted-foreground'
                }
              >
                {describeEApprovalPrintFit(fit)}
              </span>
            )}
            <Select value={orientation} onValueChange={(next) => setOrientation(next as typeof orientation)}>
              <SelectTrigger className="h-8 w-[130px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Fit automatically</SelectItem>
                <SelectItem value="portrait">Portrait</SelectItem>
                <SelectItem value="landscape">Landscape</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" className="h-8 gap-1.5" onClick={() => window.print()}>
              <Printer className="h-3.5 w-3.5" /> Print
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/*
        The note's own page setup, rather than the app-wide `@page` in globals.css.

        Neither size nor margin can be set from a class, so this has to be a real stylesheet — and it
        is rendered by React rather than pushed into document.head so React owns its lifetime: a
        stray landscape rule left behind after navigating away would silently rotate the next thing
        printed. Scoped to this page for the same reason, since `@page` is document-wide and the
        other modules' print views are built around the margins they already have.

        The margin comes from the same constant the fit is calculated against. A margin set here and
        a width assumed there that disagree by a few millimetres give a note scaled to *almost* fit,
        and the symptom is a last column shaved off the right edge with nothing to explain it.
      */}
      <style>
        {`@page { size: A4 ${fit?.orientation ?? 'portrait'}; margin: ${E_APPROVAL_PAGE_MARGIN_CSS}; }`}
      </style>

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
            tab-separated text.

            One wrapper, not two: `zoom` shrinks the layout box along with the content, so there is
            nothing to compensate for and the block paginates like any other — a tall table simply
            runs onto the next sheet, with its header row repeated. See the beforeprint effect above.
          */}
          <div ref={fitInnerRef} className="ea-print-fit mt-1">
            {request.bodyHtml ? (
              <EApprovalRichText html={request.bodyHtml} />
            ) : (
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{request.body}</p>
            )}
          </div>
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
                <Fragment key={step.id}>
                  <tr className="border-b border-slate-100 align-top">
                    <td className={step.depth > 0 ? 'py-1 pl-4 text-slate-600' : 'py-1 font-medium'}>
                      {step.depth > 0 && <span className="mr-1 text-slate-400">↳</span>}
                      {step.name}
                      {/* Why a stage configured as "Project Manager" prints a person's name. */}
                      {step.assignment?.resolvedFrom && (
                        <span className="block text-xs font-normal text-slate-500">
                          resolved from {step.assignment.resolvedFrom}
                        </span>
                      )}
                    </td>
                    <td className="py-1">
                      {step.actedByName || describeEApprovalAssignment(step.assignment)}
                      {step.onBehalfOfName && (
                        <span className="block text-xs text-slate-500">on behalf of {step.onBehalfOfName}</span>
                      )}
                      {step.delegatedToName && (
                        <span className="block text-xs text-slate-500">delegated to {step.delegatedToName}</span>
                      )}
                      {step.ownedByName && step.ownedByName !== step.actedByName && (
                        <span className="block text-xs text-slate-500">taken by {step.ownedByName}</span>
                      )}
                    </td>
                    <td className={isPositiveEApprovalOutcome(step.outcome) ? 'py-1 font-medium' : 'py-1'}>
                      {step.outcome}
                      {/* What this desk actually sanctioned, which can differ from the figure asked for
                          and from what a later desk settled on. The screen shows it per stage; the note
                          showed only the request-level total, so a part-sanction printed as unanimous. */}
                      {step.approvedAmount != null && (
                        <span className="block text-xs font-medium">
                          sanctioned {formatEApprovalAmount(step.approvedAmount)}
                        </span>
                      )}
                      {step.comment && <span className="block text-xs italic text-slate-500">“{step.comment}”</span>}
                    </td>
                    <td className="whitespace-nowrap py-1 text-xs">{formatEApprovalDateTime(step.completedAt)}</td>
                  </tr>
                  <StepMovements step={step} columns={4} />
                </Fragment>
              ))}
              {outstanding.map((step) => (
                <Fragment key={step.id}>
                  <tr className="border-b border-slate-100 align-top text-slate-500">
                    <td className={step.depth > 0 ? 'py-1 pl-4' : 'py-1 font-medium'}>
                      {step.depth > 0 && <span className="mr-1 text-slate-400">↳</span>}
                      {step.name}
                      {step.assignment?.resolvedFrom && (
                        <span className="block text-xs font-normal">resolved from {step.assignment.resolvedFrom}</span>
                      )}
                    </td>
                    <td className="py-1">
                      {describeEApprovalAssignment(step.assignment)}
                      {step.delegatedToName && (
                        <span className="block text-xs">delegated to {step.delegatedToName}</span>
                      )}
                      {step.ownedByName && <span className="block text-xs">taken by {step.ownedByName}</span>}
                    </td>
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
                    {/* "Pending since", not a dash. On a note-sheet in circulation the age of the
                        stage it is sitting at is the whole question being asked of the printout. */}
                    <td className="whitespace-nowrap py-1 text-xs">
                      {step.startedAt ? `since ${formatEApprovalDateTime(step.startedAt)}` : '—'}
                    </td>
                  </tr>
                  <StepMovements step={step} columns={4} />
                </Fragment>
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

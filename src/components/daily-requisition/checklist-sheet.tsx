'use client';

/**
 * One payment checklist, laid out as Settings › Printing Setup says (src/lib/daily-requisition-print.ts).
 *
 * The checklist print page prints it; Printing Setup previews the very same component on a sample
 * requisition, so the preview is the print. On paper the page margins come from `@page`; the
 * callers draw them as padding on screen.
 */

import type { ReactNode } from 'react';
import { format } from 'date-fns';

import { CompanyLetterhead, SignatureBlock } from '@/components/shared/company-letterhead';
import { Separator } from '@/components/ui/separator';
import { useUiText } from '@/hooks/use-company-profile';
import {
  amountInWords,
  copyLabel,
  DEFAULT_SIGNATURE_LABELS,
  FONT_SCALE,
  pageSizeMm,
  watermarkFor,
  type DRPrintSettings,
} from '@/lib/daily-requisition-print';
import type { DailyRequisitionEntry, ExpenseRequest } from '@/lib/types';

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (value: unknown) => inr.format(Number(value) || 0);

const toDateSafe = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const maybe = value as { toDate?: () => Date; seconds?: number };
  if (typeof maybe.toDate === 'function') return maybe.toDate();
  if (typeof maybe.seconds === 'number') return new Date(maybe.seconds * 1000);
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
};
const formatDate = (value: unknown) => {
  const date = toDateSafe(value);
  return date ? format(date, 'dd MMM yyyy') : 'N/A';
};
const formatWhen = (value: unknown) => {
  const date = toDateSafe(value);
  return date ? format(date, 'dd MMM yyyy, HH:mm') : '—';
};

function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-w-0">
      <span className={`${wide ? 'w-36' : 'w-32'} shrink-0 font-medium`}>{label}</span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

export interface ChecklistSheetProps {
  entry: DailyRequisitionEntry;
  projectName?: string;
  expenseRequest?: Pick<ExpenseRequest, 'headOfAccount' | 'subHeadOfAccount'>;
  printedBy: string;
  printedAt: string;
  settings: DRPrintSettings;
  /** Which copy of the requisition this sheet is (0-based), when several print. */
  copyIndex?: number;
  /** Its place in everything printed at once, for the footer's sheet numbers. */
  sheet?: { index: number; total: number };
  /** A user's name, for the trail. */
  nameOf?: (id: string) => string;
}

/** Who received, verified and paid it, and what happened at Verification steps — oldest first. */
function trailRows(entry: DailyRequisitionEntry, nameOf: (id: string) => string): Array<{ step: string; by: string; when: unknown }> {
  const rows: Array<{ step: string; by: string; when: unknown }> = [];
  if (entry.receivedAt) rows.push({ step: 'Received at Finance', by: entry.receivedById ? nameOf(entry.receivedById) : '—', when: entry.receivedAt });
  for (const event of entry.flowTrail ?? []) {
    const what =
      event.action === 'Handed over'
        ? `${event.stepName}: handed to ${(event.toUserNames ?? []).join(', ')}`
        : event.action === 'Taken early'
          ? `Taken early into ${event.stepName}`
          : event.action === 'Sent back'
            ? `${event.stepName}: sent back to ${event.toStep ?? 'the step before'}`
            : event.action === 'Rejected'
              ? `${event.stepName}: rejected`
              : `${event.stepName}: verified`;
    rows.push({ step: what, by: event.userName, when: event.at });
  }
  if (entry.verifiedAt) rows.push({ step: 'GST & TDS verified', by: '—', when: entry.verifiedAt });
  if (entry.paidAt) {
    const vouchers = [...new Set((entry.payments ?? []).map((p) => p.voucherNo).filter(Boolean))];
    rows.push({
      step: entry.manualPaid ? 'Marked paid' : vouchers.length ? `Paid · voucher ${vouchers.join(', ')}` : 'Paid',
      by: entry.paidByName || '—',
      when: entry.paidAt,
    });
  }
  return rows.sort((a, b) => (toDateSafe(a.when)?.getTime() ?? 0) - (toDateSafe(b.when)?.getTime() ?? 0));
}

export function ChecklistSheet({
  entry,
  projectName,
  expenseRequest,
  printedBy,
  printedAt,
  settings,
  copyIndex = 0,
  sheet,
  nameOf = (id) => id,
}: ChecklistSheetProps) {
  const t = useUiText();
  const s = settings.sections;
  const copy = copyLabel(copyIndex, settings.copies);
  const watermark = watermarkFor(settings.watermark, entry.status);
  // A short sheet (A5, or landscape) cannot spare the tall gaps an A4 page leaves for signing.
  const roomy = pageSizeMm(settings).height >= 279;
  const labels = settings.signatureLabels.length
    ? settings.signatureLabels
    : [
        t('preparedBy', DEFAULT_SIGNATURE_LABELS[0]),
        DEFAULT_SIGNATURE_LABELS[1],
        t('checkedBy', DEFAULT_SIGNATURE_LABELS[2]),
        t('approvedBy', DEFAULT_SIGNATURE_LABELS[3]),
        DEFAULT_SIGNATURE_LABELS[4],
        DEFAULT_SIGNATURE_LABELS[5],
      ];
  const trail = s.trail ? trailRows(entry, nameOf) : [];
  const footerBits = [settings.footer.note.trim()].filter(Boolean);

  return (
    <div className="relative bg-white font-sans text-black" style={{ zoom: FONT_SCALE[settings.fontScale] }}>
      {watermark && (
        <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
          <span className="-rotate-[30deg] select-none whitespace-nowrap text-7xl font-black tracking-[0.1em] text-rose-600/10">{watermark}</span>
        </div>
      )}
      {copy && (
        <div className="absolute right-0 top-0 z-10 rounded border border-slate-400 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600">
          {copy}
        </div>
      )}

      <CompanyLetterhead
        title={settings.documentTitle}
        align={settings.letterheadAlign === 'profile' ? undefined : settings.letterheadAlign}
        className="mb-4"
      />

      {s.details && (
        <div className="mb-4 grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
          <Field label="Reception No:">{entry.receptionNo}</Field>
          <Field label="Reception Date:">{formatDate(entry.date)}</Field>
          <Field label="DEP No:">{entry.depNo || 'N/A'}</Field>
          <Field label="Project Name:">{projectName || 'N/A'}</Field>
        </div>
      )}

      {(s.amounts || s.accounts) && (
        <>
          <Separator className="my-4 bg-gray-400" />
          <div className="mb-4 grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
            {s.amounts && (
              <>
                <Field label="Name of the party:" wide>
                  <span className="font-semibold">{entry.partyName}</span>
                </Field>
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  <div className="flex">
                    <span className="w-28 shrink-0 font-medium">Gross Amount:</span>
                    <span className="tabular-nums">{money(entry.grossAmount)}</span>
                  </div>
                  <div className="flex">
                    <span className="w-28 shrink-0 font-medium">Net Amount:</span>
                    <span className="tabular-nums">{money(entry.netAmount)}</span>
                  </div>
                </div>
              </>
            )}
            {s.accounts && (
              <>
                <Field label="Head of A/c:" wide>{expenseRequest?.headOfAccount || 'N/A'}</Field>
                <Field label="Sub-Head of A/c:">{expenseRequest?.subHeadOfAccount || 'N/A'}</Field>
              </>
            )}
          </div>
        </>
      )}

      {s.amountInWords && (
        <p className="mb-4 rounded bg-slate-50 px-3 py-1.5 text-sm">
          <span className="font-medium">In words:</span> {amountInWords(Number(entry.netAmount) || 0)}
        </p>
      )}

      {s.description && (
        <div className="mb-6 space-y-2 text-sm">
          <p className="font-medium">Description:</p>
          <p className="min-h-[50px] border-l-2 border-gray-200 pl-4">{entry.description}</p>
        </div>
      )}

      {s.trail && (
        <div className="mb-4 text-xs">
          <p className="mb-1 font-medium">Trail:</p>
          {trail.length === 0 ? (
            <p className="text-slate-500">Nothing recorded yet.</p>
          ) : (
            <table className="w-full border-collapse">
              <tbody>
                {trail.map((row, i) => (
                  <tr key={i} className="border-b border-slate-200">
                    <td className="py-1 pr-3">{row.step}</td>
                    <td className="py-1 pr-3 text-slate-700">{row.by}</td>
                    <td className="whitespace-nowrap py-1 text-right tabular-nums text-slate-600">{formatWhen(row.when)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {s.signatures && <SignatureBlock className={roomy ? 'mt-24' : 'mt-10'} labels={labels} />}

      {(settings.footer.printedBy || settings.footer.sheetNumbers || footerBits.length > 0) && (
        <div className={`${roomy ? 'mt-24' : 'mt-8'} flex flex-wrap justify-between gap-2 text-xs text-gray-500`}>
          <div className="space-x-4">
            {settings.footer.printedBy && (
              <>
                <span>
                  <span className="font-medium">Printed By:</span> {printedBy}
                </span>
                <span>
                  <span className="font-medium">Timestamp:</span> {printedAt}
                </span>
              </>
            )}
            {footerBits.map((bit) => (
              <span key={bit}>{bit}</span>
            ))}
          </div>
          {settings.footer.sheetNumbers && sheet && (
            <span>
              Sheet {sheet.index + 1} of {sheet.total}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** A made-up requisition for the preview and the test print — never saved anywhere. */
export function sampleChecklistEntry(): DailyRequisitionEntry & { id: string } {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const at = (ms: number) => ({ toDate: () => new Date(ms) }) as unknown as DailyRequisitionEntry['createdAt'];
  return {
    id: 'sample',
    receptionNo: 'SAMPLE/0001',
    depNo: 'DEP/SAMPLE/0001',
    date: new Date(now - 3 * day).toISOString(),
    projectId: 'sample',
    departmentId: 'sample',
    description: 'Transport of cable drums to site, with loading and unloading.',
    partyName: 'Sample Transport Co.',
    grossAmount: 27500,
    netAmount: 27500,
    createdAt: at(now - 3 * day),
    status: 'Received',
    receivedAt: at(now - 2 * day),
    receivedById: 'sample-receiver',
    documentStatus: 'Uploaded',
    flowTrail: [
      {
        action: 'Verified',
        stepKey: 'sample',
        stepName: 'Verification',
        userId: 'sample',
        userName: 'A. Verifier',
        at: at(now - day),
      },
    ],
  } as DailyRequisitionEntry & { id: string };
}

export const SAMPLE_EXPENSE_HEADS = { headOfAccount: 'Site Expenses', subHeadOfAccount: 'Transport' };
export const SAMPLE_PROJECT_NAME = 'Sample Project';

'use client';

/**
 * Full details of one expense request — and where it has got to since.
 *
 * Remarks and Description are free text — a sentence or a paragraph — and in a twelve-column
 * register they either blow the column out to the width of the longest note or get clipped with no
 * way to read the rest. The register now shows the first few words and defers the whole thing to
 * here, where it can wrap. Shared by the consolidated and department registers so the two cannot
 * drift into showing different fields for the same record.
 *
 * A request is only the start of the story: Daily Requisition receives it (its Dep No is our
 * Request No), sends it through the workflow, and Bank Balance pays it, in full or in part. The
 * registers' Stage and Paid / Balance columns and the Progress section below all read that through
 * `src/lib/requisition-progress.ts` — the reading Daily Requisition and Bank Balance use — so the
 * three modules cannot disagree about where a request stands.
 */

import type { ReactNode } from 'react';
import Link from 'next/link';
import { format, isValid, parseISO } from 'date-fns';
import { ExternalLink, Pencil, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusBadge } from '@/components/shared/status-badge';
import { RecordActivity } from '@/components/shared/record-history';
import { useToast } from '@/hooks/use-toast';
import { formatInr } from '@/lib/bank-balance-ledger';
import { openPrintWindow } from '@/lib/open-print-window';
import {
  requisitionHref,
  requisitionProgress,
  voucherHref,
  type ProgressStage,
  type ProgressTone,
} from '@/lib/requisition-progress';
import type { DailyRequisitionEntry, ExpenseRequest } from '@/lib/types';
import { cn } from '@/lib/utils';
import { TDS_SECTIONS } from '@/lib/statutory';

/** How much of a remark the register shows before it becomes "open the details". */
export const REMARKS_PREVIEW_WORDS = 5;

/**
 * The first few words of a remark, ellipsised. Word-counted rather than CSS-truncated so the
 * column's width is predictable instead of being set by whoever wrote the longest note.
 */
export function remarksPreview(value: string | undefined): string {
  const words = (value ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  if (words.length <= REMARKS_PREVIEW_WORDS) return words.join(' ');
  return `${words.slice(0, REMARKS_PREVIEW_WORDS).join(' ')}…`;
}

/**
 * A stored date as a Date. `yyyy-MM-dd` is a calendar day, so it is read in local time — `new Date`
 * would read it as midnight UTC, which is the previous day anywhere west of Greenwich.
 */
function parseStoredDate(value: string): Date | null {
  const iso = parseISO(value);
  if (isValid(iso)) return iso;
  const loose = new Date(value);
  return Number.isNaN(loose.getTime()) ? null : loose;
}

/**
 * Reception dates are stored as free text, so a value recorded before the import validation may
 * not parse — show it as it was recorded rather than the words "Invalid Date". Every calendar date
 * in the registers and this dialog reads `dd MMM yyyy`, the format Bank Balance uses.
 */
export function formatReceptionDate(value: string | undefined): string {
  if (!value) return '—';
  const parsed = parseStoredDate(value);
  return parsed ? format(parsed, 'dd MMM yyyy') : value;
}

/** Same guard for `createdAt`, which older records do not always carry. */
export function formatExpenseTimestamp(value: string | undefined): string {
  if (!value) return '—';
  const parsed = parseStoredDate(value);
  return parsed ? format(parsed, 'dd MMM yyyy, HH:mm') : value;
}

/** A requisition's `date` (a Timestamp, or text on imported rows) as `yyyy-MM-dd` text. */
function calendarDayOf(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  const date =
    value instanceof Date
      ? value
      : typeof (value as { toDate?: unknown }).toDate === 'function'
        ? (value as { toDate: () => Date }).toDate()
        : null;
  return date && isValid(date) ? format(date, 'yyyy-MM-dd') : '';
}

/* ── progress: the request's life after it leaves Expenses ─────────────────── */

/** The requisition a request turned into, looked up the way every module links them. */
export function requisitionOf<T>(byRequestNo: Map<string, T>, expense: Pick<ExpenseRequest, 'requestNo'>): T | undefined {
  return byRequestNo.get((expense.requestNo || '').trim());
}

/**
 * The reception number and date a request goes by. Daily Requisition writes them back onto the
 * request when its entry sheet receives it — but a requisition brought in by import does not, so a
 * live requisition's own number stands in for a blank one. A cancelled requisition does not: the
 * request is no longer received.
 */
export function receptionOf(
  expense: Pick<ExpenseRequest, 'receptionNo' | 'receptionDate'>,
  requisition?: Pick<DailyRequisitionEntry, 'receptionNo' | 'status' | 'date'> | null,
): { receptionNo: string; receptionDate: string } {
  const live = requisition && requisition.status !== 'Cancelled' ? requisition : null;
  const receptionNo = (expense.receptionNo || '').trim() || (live?.receptionNo || '').trim();
  if (!receptionNo) return { receptionNo: '', receptionDate: '' };
  const receptionDate = (expense.receptionDate || '').trim() || (requisition ? calendarDayOf(requisition.date) : '');
  return { receptionNo, receptionDate };
}

/**
 * The two columns the registers add. The column layout is configured in Expenses › Settings, and
 * its column list (`EXPENSE_REGISTER_COLUMNS` in src/lib/expenses-settings.ts) does not know these
 * yet — so they are always shown, right after the reception columns. Once the settings list them,
 * the configured order and visibility win.
 */
export const PROGRESS_COLUMNS = ['Stage', 'Paid / Balance'] as const;

export function withProgressColumns(order: readonly string[], visibility: Record<string, boolean>): string[] {
  const visible = order.filter(key => visibility[key]);
  const missing = PROGRESS_COLUMNS.filter(key => !order.includes(key));
  if (!missing.length) return visible;
  const anchor = Math.max(visible.indexOf('Reception Date'), visible.indexOf('Reception No'));
  const at = anchor === -1 ? visible.length : anchor + 1;
  return [...visible.slice(0, at), ...missing, ...visible.slice(at)];
}

/** The registers' stage filter: the workflow's own steps folded into what a department asks about. */
export type StageFilter =
  | 'all'
  | 'not-received'
  | 'in-workflow'
  | 'awaiting-payment'
  | 'part-paid'
  | 'paid'
  | 'cancelled';

export const STAGE_FILTERS: ReadonlyArray<{ value: StageFilter; label: string }> = [
  { value: 'all', label: 'All stages' },
  { value: 'not-received', label: 'Not received' },
  { value: 'in-workflow', label: 'In workflow' },
  { value: 'awaiting-payment', label: 'Awaiting payment' },
  { value: 'part-paid', label: 'Part paid' },
  { value: 'paid', label: 'Paid' },
  { value: 'cancelled', label: 'Cancelled' },
];

/** At finance, received, needs review and verified are all "in workflow" to the department. */
export function stageFilterOf(stage: ProgressStage): Exclude<StageFilter, 'all'> {
  switch (stage) {
    case 'not-received':
    case 'awaiting-payment':
    case 'part-paid':
    case 'paid':
    case 'cancelled':
      return stage;
    default:
      return 'in-workflow';
  }
}

export function matchesStageFilter(filter: StageFilter, requisition: DailyRequisitionEntry | undefined): boolean {
  return filter === 'all' || stageFilterOf(requisitionProgress(requisition).stage) === filter;
}

export function StageFilterSelect({
  value,
  onChange,
  disabled,
}: {
  value: StageFilter;
  onChange: (value: StageFilter) => void;
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={next => onChange(next as StageFilter)} disabled={disabled}>
      <SelectTrigger aria-label="Stage">
        <SelectValue placeholder="All stages" />
      </SelectTrigger>
      <SelectContent>
        {STAGE_FILTERS.map(option => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const UNAVAILABLE = 'Daily Requisition could not be loaded';

function Dash({ title }: { title?: string }) {
  return (
    <span className="text-muted-foreground/60" title={title}>
      —
    </span>
  );
}

/** The Stage column. `unavailable` is "we could not look", which is not the same as "not received". */
export function StageCell({
  requisition,
  unavailable,
}: {
  requisition: DailyRequisitionEntry | undefined;
  unavailable?: boolean;
}) {
  if (unavailable) return <Dash title={UNAVAILABLE} />;
  const progress = requisitionProgress(requisition);
  return (
    <StatusBadge
      tone={progress.tone}
      title={
        requisition
          ? `${requisition.receptionNo || 'Requisition'} · ${requisition.status || 'Pending'}`
          : 'Not yet received in Daily Requisition'
      }
    >
      {progress.label}
    </StatusBadge>
  );
}

/** The Paid / Balance column: what Bank Balance has paid, and what is still due. */
export function PaidBalanceCell({
  requisition,
  unavailable,
}: {
  requisition: DailyRequisitionEntry | undefined;
  unavailable?: boolean;
}) {
  if (unavailable) return <Dash title={UNAVAILABLE} />;
  if (!requisition) return <Dash title="Not yet received in Daily Requisition" />;
  const { paid, balance } = requisitionProgress(requisition);
  return (
    <span className="tabular-nums" title={`Paid ${formatInr(paid)} · Balance ${formatInr(balance)}`}>
      {formatInr(paid)}
      <span className="text-muted-foreground"> / {formatInr(balance)}</span>
    </span>
  );
}

/* ── register cells ────────────────────────────────────────────────────────── */

/**
 * The Remarks cell: the first few words, and nothing more. Reading the rest is the row's job —
 * clicking anywhere on it opens this dialog — so the cell itself is plain text.
 *
 * `max-w` backs up the word count for the case it cannot handle, a remark that is one very long
 * unbroken string.
 */
export function RemarksCell({ remarks }: { remarks: string | undefined }) {
  const preview = remarksPreview(remarks);
  if (!preview) return <span className="italic text-muted-foreground/50">—</span>;
  return (
    <span className="block max-w-[240px] truncate" title={remarks}>
      {preview}
    </span>
  );
}

/**
 * The Request No cell, as a real button.
 *
 * The row as a whole is clickable, but a `<tr>` cannot be given that behaviour without either
 * taking it away from the keyboard or dressing the row up as `role="button"` and losing the
 * column-header association screen readers rely on in a twelve-column register. Putting the one
 * focusable control on the row's own identifier keeps the table a table and still gives everyone a
 * way in.
 */
export function RequestNoCell({
  expense,
  onOpen,
}: {
  expense: ExpenseRequest;
  onOpen: (expense: ExpenseRequest) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(expense)}
      className="text-left font-medium underline-offset-2 hover:text-primary hover:underline"
      aria-label={`View full details of expense request ${expense.requestNo}`}
    >
      {expense.requestNo || '—'}
    </button>
  );
}

/* ── test entries ──────────────────────────────────────────────────────────── */

const TEST_WORD = /\btest(ing)?\b/i;

/**
 * Why a request looks like one raised to try the system out — a description that is only "test" /
 * "testing", or a project or party with "test" in its name — or null. Only ever a hint: the
 * registers offer to hide such rows and this dialog says so; nothing is removed.
 */
export function testEntryReason(
  expense: Pick<ExpenseRequest, 'description' | 'partyName'>,
  projectName: string,
): string | null {
  const description = (expense.description || '').trim();
  if (/^test(ing)?$/i.test(description)) return `Description says “${description}”`;
  if (TEST_WORD.test(projectName)) return `The project is “${projectName}”`;
  const party = (expense.partyName || '').trim();
  if (TEST_WORD.test(party)) return `The party is “${party}”`;
  return null;
}

/* ── the dialog ────────────────────────────────────────────────────────────── */

const LABEL = 'text-[10.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground';

function Field({ label, value, className }: { label: string; value: string | undefined; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <p className={cn(LABEL, 'mb-0.5')}>{label}</p>
      {value?.trim() ? (
        <p className="whitespace-pre-wrap break-words text-[13px] font-semibold">{value}</p>
      ) : (
        <p className="text-[13px] font-semibold text-muted-foreground/60">—</p>
      )}
    </div>
  );
}

function Figure({ label, value, tone }: { label: string; value: number; tone?: 'paid' | 'due' }) {
  return (
    <div className="min-w-0 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
      <p className={LABEL}>{label}</p>
      <p
        className={cn(
          'break-words text-sm font-semibold tabular-nums',
          tone === 'paid' && 'text-emerald-600 dark:text-emerald-400',
          tone === 'due' && 'text-amber-700 dark:text-amber-400',
        )}
      >
        {formatInr(value)}
      </p>
    </div>
  );
}

/** The stage's own colour, for the Status line under Daily Requisition. */
const TONE_TEXT: Record<ProgressTone, string> = {
  neutral: 'text-slate-600 dark:text-slate-300',
  info: 'text-sky-700 dark:text-sky-400',
  progress: 'text-violet-700 dark:text-violet-400',
  success: 'text-emerald-700 dark:text-emerald-400',
  warning: 'text-amber-700 dark:text-amber-400',
  danger: 'text-rose-700 dark:text-rose-400',
};

/**
 * The path a request takes, as the step bar shows it. Daily Requisition's own statuses, in order:
 * Pending is "At finance", Received for Payment is "For payment"; Part paid sits on For payment
 * with Paid still to come.
 */
const STEPS = ['Raised', 'At finance', 'Received', 'Verified', 'For payment', 'Paid'] as const;

/** The last step a request has reached. A cancelled one got no further than being raised. */
function stepReached(stage: ProgressStage): number {
  switch (stage) {
    case 'not-received':
    case 'cancelled':
      return 0;
    case 'pending':
      return 1;
    case 'received':
    case 'needs-review':
      return 2;
    case 'verified':
      return 3;
    case 'awaiting-payment':
    case 'part-paid':
      return 4;
    case 'paid':
      return 5;
  }
}

function ProgressSteps({ stage }: { stage: ProgressStage }) {
  const reached = stepReached(stage);
  // Needs review holds the request where it is, so the step it is waiting on reads red, not amber.
  const held = stage === 'needs-review';
  return (
    <ol aria-label="Progress" className="mx-5 mt-3 flex gap-1">
      {STEPS.map((label, i) => {
        const done = i <= reached;
        const next = i === reached + 1 && stage !== 'cancelled';
        return (
          <li
            key={label}
            aria-current={i === reached ? 'step' : undefined}
            className={cn(
              'min-w-0 flex-1 text-center text-[10.5px] font-bold leading-tight',
              done
                ? 'text-slate-600 dark:text-slate-300'
                : next
                  ? held
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-amber-700 dark:text-amber-400'
                  : 'text-muted-foreground/70',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'mb-1 block h-1 rounded-full',
                done ? 'bg-emerald-600' : next ? (held ? 'bg-rose-500' : 'bg-amber-500') : 'bg-slate-200 dark:bg-slate-700',
              )}
            />
            {label}
            <span className="sr-only">{done ? ' (done)' : next ? ' (next)' : ''}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Note({ tone, children }: { tone: 'amber' | 'rose'; children: ReactNode }) {
  return (
    <p
      className={cn(
        'mx-5 mt-3 rounded-[10px] border-l-[3px] px-3 py-2 text-xs',
        tone === 'amber'
          ? 'border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200'
          : 'border-rose-500 bg-rose-50 text-rose-900 dark:bg-rose-500/10 dark:text-rose-200',
      )}
    >
      {children}
    </p>
  );
}

/** GST & TDS recorded when the request was raised (src/lib/statutory.ts). */
function StatutoryDetails({ statutory }: { statutory: NonNullable<ExpenseRequest['statutory']> }) {
  const gstLabel =
    statutory.gstType === 'igst'
      ? 'IGST @ ' + statutory.gstRate + '%'
      : statutory.gstType === 'cgst-sgst'
        ? 'CGST + SGST @ ' + statutory.gstRate / 2 + '% + ' + statutory.gstRate / 2 + '%'
        : 'No GST';
  const section = TDS_SECTIONS.find((entry) => entry.code === statutory.tdsSection);
  return (
    <section aria-label="Statutory" className="space-y-3 border-t pt-4">
      <h3 className={LABEL}>Statutory — GST &amp; TDS</h3>
      <div className="grid grid-cols-1 gap-x-5 gap-y-3 sm:grid-cols-2">
        <Field label="Invoice" value={[statutory.invoiceNo, statutory.invoiceDate ? formatReceptionDate(statutory.invoiceDate) : ''].filter(Boolean).join(' · ')} />
        <Field label="Supplier GSTIN" value={statutory.gstNo} />
        <Field label="GST" value={gstLabel + (statutory.reverseCharge ? ' · reverse charge' : '')} />
        <Field label="PAN" value={statutory.panNo} />
        <Field label="TDS" value={section && section.code !== 'none' ? section.label + ' @ ' + statutory.tdsRate + '%' : 'No TDS'} />
        <Field label="HSN / SAC" value={statutory.hsnSac} />
        {statutory.otherDeductionReason && <Field label="Other deduction for" value={statutory.otherDeductionReason} className="sm:col-span-2" />}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Figure label="Taxable" value={statutory.taxableAmount} />
        <Figure label="GST" value={statutory.gstAmount} />
        <Figure label="Invoice" value={statutory.invoiceAmount} />
        <Figure label="TDS" value={statutory.tdsAmount} />
        {statutory.retentionAmount > 0 && <Figure label="Retention" value={statutory.retentionAmount} />}
        {statutory.otherDeduction > 0 && <Figure label="Other" value={statutory.otherDeduction} />}
        <Figure label="Net payable" value={statutory.netPayable} tone="paid" />
      </div>
    </section>
  );
}

/** The account the request is paid into (src/lib/expenses-bank.ts). */
function BankDetails({ bank }: { bank: NonNullable<ExpenseRequest['bankDetails']> }) {
  const from =
    bank.source === 'employee'
      ? 'From the Employee module' + (bank.employeeNo ? ' · ' + bank.employeeNo : '') + (bank.edited ? ' · changed on the request' : '')
      : 'Entered on the request';
  return (
    <section aria-label="Bank details" className="space-y-3 border-t pt-4">
      <h3 className={LABEL}>Bank details <span className="font-semibold normal-case tracking-normal">— {from}</span></h3>
      <div className="grid grid-cols-1 gap-x-5 gap-y-3 sm:grid-cols-2">
        <Field label="Account holder" value={bank.accountHolderName} className="sm:col-span-2" />
        <Field label="Account number" value={bank.accountNumber} />
        <Field label="IFSC" value={bank.ifscCode} />
        <Field label="Bank" value={bank.bankName} />
        <Field label="Branch" value={bank.branchName} />
      </div>
    </section>
  );
}

/** A link into another module, wrapping inside a narrow dialog rather than widening it. */
function ModuleLink({ href, children }: { href: string; children: string }) {
  return (
    <Link
      href={href}
      className="inline-flex max-w-full items-center gap-1 text-[13px] font-semibold text-primary underline-offset-2 hover:underline"
    >
      <span className="break-all">{children}</span>
      <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    </Link>
  );
}

function paymentDetail(payment: { mode?: string; instrumentNo?: string; instrumentDate?: string }): string {
  const parts = [
    payment.mode,
    payment.instrumentNo ? `No. ${payment.instrumentNo}` : '',
    payment.instrumentDate ? `dated ${formatReceptionDate(payment.instrumentDate)}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : '—';
}

/** Where Daily Requisition and Bank Balance have got with it: status, reception, payments. */
function RequisitionSection({
  expense,
  requisition,
  unavailable,
}: {
  expense: ExpenseRequest;
  requisition: DailyRequisitionEntry | undefined;
  unavailable: boolean;
}) {
  const progress = requisitionProgress(requisition);
  const { receptionNo, receptionDate } = receptionOf(expense, requisition);
  // The requisition's own number when there is one — it is what Daily Requisition searches by.
  const linkNo = (requisition?.receptionNo || receptionNo || '').trim();
  const payments = requisition?.payments ?? [];

  return (
    <section aria-label="Daily Requisition" className="space-y-3 border-t pt-4">
      <h3 className={LABEL}>Daily Requisition</h3>

      <div className="grid grid-cols-1 gap-x-5 gap-y-3 sm:grid-cols-3">
        <div className="min-w-0">
          <p className={cn(LABEL, 'mb-0.5')}>Status</p>
          {unavailable ? (
            <p className="text-[13px] font-semibold text-muted-foreground/60" title={UNAVAILABLE}>—</p>
          ) : (
            <p className={cn('text-[13px] font-semibold', TONE_TEXT[progress.tone])}>{progress.label}</p>
          )}
        </div>
        <div className="min-w-0">
          <p className={cn(LABEL, 'mb-0.5')}>Reception no.</p>
          {linkNo ? (
            <ModuleLink href={requisitionHref(linkNo)}>{linkNo}</ModuleLink>
          ) : (
            <p className="text-[13px] font-semibold text-muted-foreground/60">—</p>
          )}
        </div>
        <Field label="Reception date" value={receptionDate ? formatReceptionDate(receptionDate) : undefined} />
      </div>

      {unavailable ? null : !requisition ? (
        receptionNo ? (
          <p className="text-xs text-muted-foreground">
            Recorded as received ({receptionNo}), but Daily Requisition has no requisition with Dep No{' '}
            {expense.requestNo || '—'}.
          </p>
        ) : null
      ) : (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Figure label="Net" value={progress.net} />
            <Figure label="Paid" value={progress.paid} tone={progress.paid > 0 ? 'paid' : undefined} />
            <Figure label="Balance" value={progress.balance} tone={progress.balance > 0 ? 'due' : undefined} />
          </div>

          {payments.length > 0 ? (
            <div className="space-y-1.5">
              <p className={LABEL}>Payments</p>
              <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
                {payments.map((payment, index) => (
                  <li
                    key={`${payment.bankPaymentId}:${payment.lineId}:${index}`}
                    className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-3 py-2"
                  >
                    <div className="min-w-0 space-y-0.5">
                      {payment.bankPaymentId ? (
                        <ModuleLink href={voucherHref(payment.bankPaymentId)}>
                          {payment.voucherNo || 'Payment voucher'}
                        </ModuleLink>
                      ) : (
                        <span className="text-sm font-medium">{payment.voucherNo || 'Payment'}</span>
                      )}
                      <p className="break-words text-xs text-muted-foreground">{paymentDetail(payment)}</p>
                    </div>
                    <span className="text-sm font-semibold tabular-nums">{formatInr(payment.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : progress.stage === 'paid' ? (
            <p className="text-xs text-muted-foreground">
              Marked paid in Daily Requisition{requisition.manualPaid ? ' (paid outside Bank Balance)' : ''} — no
              payment voucher is recorded against it.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

/**
 * The request on a printable sheet — the app's one print layout (src/lib/print-table-report.ts),
 * in its own window. False when a pop-up blocker stopped the window.
 */
function printExpenseRequest({
  expense,
  projectName,
  requisition,
  unavailable,
  raisedBy,
}: {
  expense: ExpenseRequest;
  projectName: string;
  requisition: DailyRequisitionEntry | undefined;
  unavailable: boolean;
  raisedBy: string;
}): boolean {
  const progress = requisitionProgress(requisition);
  const { receptionNo, receptionDate } = receptionOf(expense, requisition);
  const statutory = expense.statutory;
  const statutoryLines: Array<[string, string]> = statutory
    ? [
        ['Invoice', [statutory.invoiceNo, statutory.invoiceDate ? formatReceptionDate(statutory.invoiceDate) : ''].filter(Boolean).join(' · ')],
        ['GST', formatInr(statutory.gstAmount)],
        ['TDS', formatInr(statutory.tdsAmount)],
        ['Net payable', formatInr(statutory.netPayable)],
      ]
    : [];
  const paymentLines: Array<[string, string]> =
    requisition && !unavailable
      ? [
          ['Paid', formatInr(progress.paid)],
          ['Balance', formatInr(progress.balance)],
        ]
      : [];
  const lines: Array<[string, string]> = [
    ['Request no', expense.requestNo],
    ['Timestamp', expense.createdAt ? formatExpenseTimestamp(expense.createdAt) : ''],
    ['Department', expense.generatedByDepartment],
    ['Raised by', expense.generatedByUser],
    ['Project name', projectName],
    ['Head of A/c', expense.headOfAccount],
    ['Sub-head of A/c', expense.subHeadOfAccount],
    ['Name of the party', expense.partyName],
    ['Amount', formatInr(expense.amount)],
    ...statutoryLines,
    ['Description', expense.description],
    ['Remarks', expense.remarks],
    ['Stage', unavailable ? 'Not available' : progress.label],
    ['Reception no', receptionNo],
    ['Reception date', receptionDate ? formatReceptionDate(receptionDate) : ''],
    ...paymentLines,
  ];
  return openPrintWindow({
    title: `Expense request ${expense.requestNo || ''}`.trim(),
    subtitle: raisedBy,
    columns: [
      { key: 'field', label: 'Field' },
      { key: 'value', label: 'Value' },
    ],
    rows: lines.map(([field, value]) => ({ field, value: value?.trim() ? value : '—' })),
    generatedOn: format(new Date(), 'dd MMM yyyy, HH:mm'),
  });
}

export function ExpenseDetailsDialog({
  expense,
  projectName,
  open,
  onOpenChange,
  requisition,
  requisitionsUnavailable = false,
  onEdit,
}: {
  expense: ExpenseRequest | null;
  /** Resolved by the caller, which is the side that holds the project list. */
  projectName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The requisition this request became, once Daily Requisition has received it. */
  requisition?: DailyRequisitionEntry;
  /** Daily Requisition could not be read — progress is unknown, which is not "not received". */
  requisitionsUnavailable?: boolean;
  /**
   * Adds Edit to the footer. Pass it only where this user may edit this request — the register
   * that can edit decides, and owns the edit dialog it opens.
   */
  onEdit?: (expense: ExpenseRequest) => void;
}) {
  const { toast } = useToast();
  const progress = requisitionProgress(requisition);
  const raisedBy = expense?.generatedByDepartment
    ? `Raised by ${expense.generatedByDepartment}${expense.generatedByUser ? ` · ${expense.generatedByUser}` : ''}`
    : 'Full details of this request.';
  const testReason = expense ? testEntryReason(expense, projectName) : null;

  const handlePrint = () => {
    if (!expense) return;
    const opened = printExpenseRequest({ expense, projectName, requisition, unavailable: requisitionsUnavailable, raisedBy });
    if (!opened) {
      toast({
        title: 'Could not open the print window',
        description: 'Allow pop-ups for this site, then try again.',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Edge to edge: the colour strip, header and footer span the dialog and the body between
          them scrolls. No scrollbar gutter on the shell, which would inset the strip. */}
      <DialogContent size="lg" className="max-h-[90dvh] gap-0 p-0 sm:rounded-[18px]" style={{ scrollbarGutter: 'auto' }}>
        <div aria-hidden="true" className="h-1 shrink-0 bg-[linear-gradient(90deg,#7c3aed,#ec4899,#f59e0b,#10b981)]" />

        {/* `pr-24` keeps the title clear of the window controls and the close button. */}
        <DialogHeader className="shrink-0 flex-row items-start gap-2.5 space-y-0 px-5 pb-3 pr-24 pt-4 text-left">
          <span
            aria-hidden="true"
            className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[10px] bg-violet-50 text-base font-extrabold text-violet-600 dark:bg-violet-500/15 dark:text-violet-300"
          >
            ₹
          </span>
          <div className="min-w-0">
            <DialogTitle className="break-words text-[15px] font-bold leading-snug">
              Expense request <span className="text-violet-600 dark:text-violet-400">{expense?.requestNo || '—'}</span>
            </DialogTitle>
            <DialogDescription className="text-xs">{raisedBy}</DialogDescription>
          </div>
        </DialogHeader>

        {expense && (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto pb-4">
              {/* What it is for, and where it has got to. */}
              <div className="mx-5 flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-muted/40 px-3.5 py-3">
                <div className="min-w-0">
                  <p className="text-[22px] font-extrabold leading-tight tabular-nums text-emerald-700 dark:text-emerald-400">
                    {formatInr(expense.amount)}
                  </p>
                  {expense.statutory && (
                    <p className="text-[11.5px] text-muted-foreground">
                      Net payable{' '}
                      <span className="font-semibold tabular-nums text-foreground">{formatInr(expense.statutory.netPayable)}</span>{' '}
                      after GST &amp; TDS
                    </p>
                  )}
                </div>
                {!requisitionsUnavailable && <StatusBadge tone={progress.tone}>{progress.label}</StatusBadge>}
              </div>

              {requisitionsUnavailable ? (
                <Note tone="amber">{UNAVAILABLE}, so where this request has got to is not shown.</Note>
              ) : (
                <ProgressSteps stage={progress.stage} />
              )}
              {!requisitionsUnavailable && progress.stage === 'needs-review' && (
                <Note tone="rose">Daily Requisition has marked this request “Needs review”.</Note>
              )}
              {!requisitionsUnavailable && progress.stage === 'cancelled' && (
                <Note tone="rose">Cancelled in Daily Requisition — nothing more will be paid against it.</Note>
              )}
              {testReason && (
                <Note tone="amber">{testReason}. If this was only a test, it still counts in every total.</Note>
              )}

              <div className="grid grid-cols-1 gap-x-5 gap-y-3 px-5 pt-4 sm:grid-cols-2">
                <Field label="Timestamp" value={expense.createdAt ? formatExpenseTimestamp(expense.createdAt) : undefined} />
                <Field label="Department" value={expense.generatedByDepartment} />
                <Field label="Project name" value={projectName} className="sm:col-span-2" />
                <Field label="Head of A/c" value={expense.headOfAccount} />
                <Field label="Sub-head of A/c" value={expense.subHeadOfAccount} />
                <Field label="Name of the party" value={expense.partyName} className="sm:col-span-2" />
                <Field label="Description" value={expense.description} />
                <Field label="Remarks" value={expense.remarks} />
              </div>

              <div className="space-y-4 px-5 pt-4">
                {expense.bankDetails && <BankDetails bank={expense.bankDetails} />}
                {expense.statutory && <StatutoryDetails statutory={expense.statutory} />}

                <RequisitionSection expense={expense} requisition={requisition} unavailable={requisitionsUnavailable} />

                {/* Who did what to this request. Keyed so another request opens closed. */}
                <RecordActivity
                  key={expense.id}
                  recordId={expense.id}
                  recordRef={expense.requestNo}
                  sectionClassName="border-t pt-3"
                  headingClassName={LABEL}
                />
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2 border-t bg-muted/40 px-5 py-3">
              {onEdit && (
                <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => onEdit(expense)}>
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  Edit
                </Button>
              )}
              <span className="flex-1" />
              <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={handlePrint}>
                <Printer className="h-3.5 w-3.5" aria-hidden="true" />
                Print
              </Button>
              <DialogClose asChild>
                <Button type="button" size="sm">
                  Close
                </Button>
              </DialogClose>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

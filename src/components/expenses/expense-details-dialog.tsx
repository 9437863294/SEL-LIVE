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

import Link from 'next/link';
import { format, isValid, parseISO } from 'date-fns';
import { ExternalLink, Receipt } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusBadge } from '@/components/shared/status-badge';
import { formatInr } from '@/lib/bank-balance-ledger';
import {
  requisitionHref,
  requisitionProgress,
  voucherHref,
  type ProgressStage,
} from '@/lib/requisition-progress';
import type { DailyRequisitionEntry, ExpenseRequest } from '@/lib/types';
import { cn } from '@/lib/utils';

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

/* ── the dialog ────────────────────────────────────────────────────────────── */

const LABEL = 'text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';

function Field({
  label,
  value,
  className,
  emphasis,
}: {
  label: string;
  value: string | undefined;
  className?: string;
  emphasis?: boolean;
}) {
  return (
    <div className={cn('min-w-0 space-y-1', className)}>
      <p className={LABEL}>{label}</p>
      {value ? (
        <p
          className={cn(
            'text-sm whitespace-pre-wrap break-words',
            emphasis && 'font-semibold text-emerald-600 dark:text-emerald-400',
          )}
        >
          {value}
        </p>
      ) : (
        <p className="text-sm italic text-muted-foreground/60">—</p>
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

/** A link into another module, wrapping inside a narrow dialog rather than widening it. */
function ModuleLink({ href, children }: { href: string; children: string }) {
  return (
    <Link
      href={href}
      className="inline-flex max-w-full items-center gap-1 text-sm font-medium text-primary underline-offset-2 hover:underline"
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

function ProgressSection({
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
    <section aria-label="Progress" className="mt-4 space-y-3 border-t border-border/60 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={LABEL}>Progress</h3>
        {!unavailable && <StatusBadge tone={progress.tone}>{progress.label}</StatusBadge>}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="min-w-0 space-y-1">
          <p className={LABEL}>Reception No</p>
          {linkNo ? (
            <ModuleLink href={requisitionHref(linkNo)}>{linkNo}</ModuleLink>
          ) : (
            <p className="text-sm italic text-muted-foreground/60">—</p>
          )}
        </div>
        <Field label="Reception Date" value={receptionDate ? formatReceptionDate(receptionDate) : undefined} />
      </div>

      {unavailable ? (
        <p className="text-sm text-muted-foreground">
          {UNAVAILABLE}, so the stage and payments are not shown.
        </p>
      ) : !requisition ? (
        <p className="text-sm text-muted-foreground">
          {receptionNo
            ? `Recorded as received (${receptionNo}), but Daily Requisition has no requisition with Dep No ${expense.requestNo || '—'}.`
            : 'Not yet received in Daily Requisition.'}
        </p>
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
            <p className="text-sm text-muted-foreground">
              Marked paid in Daily Requisition{requisition.manualPaid ? ' (paid outside Bank Balance)' : ''} — no
              payment voucher is recorded against it.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

export function ExpenseDetailsDialog({
  expense,
  projectName,
  open,
  onOpenChange,
  requisition,
  requisitionsUnavailable = false,
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
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="text-left">
          <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
            <Receipt className="h-4 w-4 shrink-0 text-primary" />
            Expense request
            <span className="text-primary">{expense?.requestNo || '—'}</span>
          </DialogTitle>
          <DialogDescription className="text-xs">
            {expense?.generatedByDepartment
              ? `Raised by ${expense.generatedByDepartment}${expense.generatedByUser ? ` · ${expense.generatedByUser}` : ''}`
              : 'Full details of this request.'}
          </DialogDescription>
        </DialogHeader>

        {/* DialogContent is a flex column with no gap, so the body sets its own separation. */}
        {expense && (
          <>
            <div className="mt-4 grid grid-cols-1 gap-4 border-t border-border/60 pt-4 sm:grid-cols-2">
              <Field
                label="Timestamp"
                value={expense.createdAt ? formatExpenseTimestamp(expense.createdAt) : undefined}
              />
              <Field label="Department" value={expense.generatedByDepartment} />
              <Field label="Project Name" value={projectName} />
              <Field label="Amount" value={formatInr(expense.amount)} emphasis />
              <Field label="Head of A/c" value={expense.headOfAccount} />
              <Field label="Sub-Head of A/c" value={expense.subHeadOfAccount} />
              <Field label="Name of the party" value={expense.partyName} className="sm:col-span-2" />
              <Field label="Description" value={expense.description} className="sm:col-span-2" />
              <Field label="Remarks" value={expense.remarks} className="sm:col-span-2" />
            </div>

            <ProgressSection
              expense={expense}
              requisition={requisition}
              unavailable={requisitionsUnavailable}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

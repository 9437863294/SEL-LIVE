'use client';

/**
 * Full details of one expense request.
 *
 * Remarks and Description are free text — a sentence or a paragraph — and in a twelve-column
 * register they either blow the column out to the width of the longest note or get clipped with no
 * way to read the rest. The register now shows the first few words and defers the whole thing to
 * here, where it can wrap. Shared by the consolidated and department registers so the two cannot
 * drift into showing different fields for the same record.
 */

import { format } from 'date-fns';
import { Receipt } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { ExpenseRequest } from '@/lib/types';
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
 * Reception dates are stored as free text, so a value recorded before the import validation may
 * not parse — show it as it was recorded rather than the words "Invalid Date".
 */
export function formatReceptionDate(value: string | undefined): string {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : format(parsed, 'dd MMM, yyyy');
}

/** Same guard for `createdAt`, which older records do not always carry. */
export function formatExpenseTimestamp(value: string | undefined): string {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : format(parsed, 'dd MMM yyyy, HH:mm');
}

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
    <div className={cn('space-y-1', className)}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
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

export function ExpenseDetailsDialog({
  expense,
  projectName,
  open,
  onOpenChange,
}: {
  expense: ExpenseRequest | null;
  /** Resolved by the caller, which is the side that holds the project list. */
  projectName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
          <div className="mt-4 grid gap-4 border-t border-border/60 pt-4 sm:grid-cols-2">
            <Field label="Timestamp" value={formatExpenseTimestamp(expense.createdAt)} />
            <Field label="Department" value={expense.generatedByDepartment} />
            <Field label="Project Name" value={projectName} />
            <Field
              label="Amount"
              value={`₹${(expense.amount || 0).toLocaleString('en-IN')}`}
              emphasis
            />
            <Field label="Head of A/c" value={expense.headOfAccount} />
            <Field label="Sub-Head of A/c" value={expense.subHeadOfAccount} />
            <Field label="Name of the party" value={expense.partyName} className="sm:col-span-2" />
            <Field label="Description" value={expense.description} className="sm:col-span-2" />
            <Field label="Remarks" value={expense.remarks} className="sm:col-span-2" />
            <Field label="Reception No" value={expense.receptionNo || undefined} />
            <Field
              label="Reception Date"
              value={expense.receptionDate ? formatReceptionDate(expense.receptionDate) : undefined}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

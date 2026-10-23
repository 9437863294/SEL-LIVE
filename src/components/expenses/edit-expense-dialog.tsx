'use client';

/**
 * Editing an expense request from its department register. The dialog is the New Request form
 * itself — ExpenseRequestFields and the GST & TDS section — opened on the request as it stands, so
 * the two screens show the same fields, under the same Field Control labels and rules.
 *
 * What may change is the page's call (`lock`, worked out from Daily Requisition): this dialog shows
 * it and checks the form the way New Request does before handing the values over. The page's save
 * is still the gate — it re-reads the request and its requisition before writing.
 */

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Edit, Loader2, Lock, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Form } from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { useBillRegistration } from '@/components/expenses/bill-registration';
import {
  StatutorySection,
  FORM_LABEL as LABEL,
  FORM_READ_ONLY as READ_ONLY,
  type StatutoryValue,
} from '@/components/expenses/statutory-section';
import {
  ExpenseRequestFields,
  ExpenseRequestTotals,
  buildExpenseFormSchema,
  findRecordedParty,
  type ExpenseFormValues,
  type LockableExpenseField,
} from '@/components/expenses/expense-request-fields';
import { formatExpenseTimestamp } from '@/components/expenses/expense-details-dialog';
import type { ExpensesModuleSettings } from '@/lib/expenses-settings';
import { computeStatutory, hasStatutory, statutoryErrors, statutoryInputFrom } from '@/lib/statutory';
import type { AccountHead, ExpenseRequest, Project, SubAccountHead } from '@/lib/types';
import { cn } from '@/lib/utils';

export interface EditLock {
  /** Nothing may change: received, and the data rules keep received requests closed. */
  locked: boolean;
  /** Amount, party and project may not change: the requisition has been paid, in part or in full. */
  paymentLocked: boolean;
  /**
   * GST, TDS and deductions may not change: paid, or received while Data Control keeps them fixed
   * after reception ("Allow GST & TDS editing after reception").
   */
  statutoryLocked: boolean;
  /** Why, in the words the row's button and the dialog show. */
  reason: string;
  /** Why the GST & TDS are fixed, when they are. */
  statutoryReason: string;
  receptionNo: string;
}

/** Once money has gone out against the requisition, these belong to the payment record. */
export const PAYMENT_LOCKED_FIELDS: readonly LockableExpenseField[] = ['amount', 'partyName', 'projectId'];

/** The request's GST & TDS as the section edits them, with the registration chosen on the bill. */
const statutoryValueOf = (expense: ExpenseRequest): StatutoryValue => ({
  ...statutoryInputFrom(expense.statutory),
  gstRegistrationId: expense.gstRegistrationId ?? '',
});

/**
 * Whether the section now says something other than what the request carries. Compared field by
 * field against the stored block read back the way the section was filled, so opening and saving
 * an untouched request never rewrites its GST & TDS.
 */
export function statutoryChanged(expense: ExpenseRequest, value: StatutoryValue): boolean {
  const opened = statutoryValueOf(expense);
  return (Object.keys(opened) as (keyof StatutoryValue)[]).some(key => opened[key] !== value[key]);
}

const text = (value: unknown) => (value === undefined || value === null ? '' : String(value));

export function EditExpenseDialog({
  expense,
  lock,
  open,
  onOpenChange,
  departmentName,
  settings,
  projects,
  accountHeads,
  subAccountHeads,
  recordedParties,
  isSaving,
  onSave,
}: {
  expense: ExpenseRequest | null;
  lock: EditLock | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  departmentName: string;
  settings: ExpensesModuleSettings;
  projects: readonly Project[];
  accountHeads: readonly AccountHead[];
  subAccountHeads: readonly SubAccountHead[];
  recordedParties: readonly string[];
  isSaving: boolean;
  /** `statutory` is null when the GST & TDS were left as they were. */
  onSave: (values: ExpenseFormValues, statutory: StatutoryValue | null) => void | Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={next => { if (!isSaving) onOpenChange(next); }}>
      <DialogContent size="2xl">
        {/* Mounted per opening (the content unmounts when closed), so the form starts from the
            request as it is now, never from an edit that was cancelled. */}
        {expense && lock && (
          <EditExpenseForm
            expense={expense}
            lock={lock}
            departmentName={departmentName}
            settings={settings}
            projects={projects}
            accountHeads={accountHeads}
            subAccountHeads={subAccountHeads}
            recordedParties={recordedParties}
            isSaving={isSaving}
            onSave={onSave}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditExpenseForm({
  expense,
  lock,
  departmentName,
  settings,
  projects,
  accountHeads,
  subAccountHeads,
  recordedParties,
  isSaving,
  onSave,
}: {
  expense: ExpenseRequest;
  lock: EditLock;
  departmentName: string;
  settings: ExpensesModuleSettings;
  projects: readonly Project[];
  accountHeads: readonly AccountHead[];
  subAccountHeads: readonly SubAccountHead[];
  recordedParties: readonly string[];
  isSaving: boolean;
  onSave: (values: ExpenseFormValues, statutory: StatutoryValue | null) => void | Promise<void>;
}) {
  const { toast } = useToast();
  const locked: readonly LockableExpenseField[] = lock.paymentLocked ? PAYMENT_LOCKED_FIELDS : [];
  const openedAmount = Number(expense.amount) || 0;

  const form = useForm<ExpenseFormValues>({
    resolver: zodResolver(buildExpenseFormSchema(settings, recordedParties, { locked, openedAmount })),
    defaultValues: {
      departmentId: text(expense.departmentId),
      projectId: text(expense.projectId),
      amount: openedAmount,
      headOfAccount: text(expense.headOfAccount),
      subHeadOfAccount: text(expense.subHeadOfAccount),
      remarks: text(expense.remarks),
      description: text(expense.description),
      partyName: text(expense.partyName),
    },
  });

  const [statutory, setStatutory] = useState<StatutoryValue>(() => statutoryValueOf(expense));
  const [showStatutoryErrors, setShowStatutoryErrors] = useState(false);

  /**
   * Shown wherever New Request would show it, and also on a request that already carries GST & TDS
   * — turning capture off for new requests does not hide what an older one recorded.
   */
  const showStatutory = settings.data.gstTdsCapture || !!expense.statutory;
  const watchedAmount = Number(form.watch('amount')) || 0;
  const withStatutoryNow = showStatutory && hasStatutory(statutory);
  const netPayableNow = withStatutoryNow ? computeStatutory(watchedAmount, statutory).net : watchedAmount;

  const bill = useBillRegistration({
    gstRegistrationId: statutory.gstRegistrationId,
    projectId: form.watch('projectId'),
    departmentId: expense.departmentId,
  });

  const submit = (data: ExpenseFormValues) => {
    const changed = showStatutory && !lock.statutoryLocked && statutoryChanged(expense, statutory);
    // Judged only when they were changed here: a block an earlier version of the form accepted
    // should not stop the remarks from being corrected.
    if (changed && hasStatutory(statutory)) {
      const problems = Object.values(statutoryErrors(Number(data.amount) || 0, statutory, bill.companyStateCode));
      if (problems.length) {
        setShowStatutoryErrors(true);
        toast({ title: 'Check the GST & TDS details', description: problems[0], variant: 'destructive' });
        return;
      }
    }
    // With parties restricted, a name typed in another case or spacing is saved in the spelling
    // already on record, as New Request does.
    const partyName =
      (settings.data.restrictPartyToExisting && data.partyName
        ? findRecordedParty(data.partyName, recordedParties)
        : undefined) ?? data.partyName;
    void onSave({ ...data, partyName }, changed ? statutory : null);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="flex min-h-0 flex-1 flex-col gap-4">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <Edit className="h-4 w-4 text-primary" />
            Edit Expense: <span className="text-primary">{expense.requestNo}</span>
          </DialogTitle>
          <DialogDescription>Update the details of this expense request.</DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-3">
          {lock.locked ? (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{lock.reason}. Nothing here can be saved.</span>
            </div>
          ) : lock.paymentLocked ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                {lock.reason}
                {showStatutory && ', nor the GST & TDS'}. Reverse the payment in Bank Balance first to change them.
              </span>
            </div>
          ) : lock.receptionNo ? (
            <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              Received in Daily Requisition as <span className="font-medium text-foreground">{lock.receptionNo}</span>.
              Changes made here do not update the requisition — correct it in Daily Requisition as well.
              {lock.statutoryLocked && showStatutory && <> {lock.statutoryReason}.</>}
            </div>
          ) : null}

          <ExpenseRequestFields
            form={form}
            settings={settings}
            projects={projects}
            accountHeads={accountHeads}
            subAccountHeads={subAccountHeads}
            recordedParties={recordedParties}
            requestNo={expense.requestNo || '—'}
            timestamp={formatExpenseTimestamp(expense.createdAt)}
            netPayable={netPayableNow}
            withStatutory={withStatutoryNow}
            locked={locked}
            department={
              // A request stays in the department that numbered it.
              <div className="min-w-0 space-y-1.5">
                <p className={LABEL}>Department</p>
                <div className={cn(READ_ONLY, 'font-medium text-slate-800')}>
                  <span className="truncate">{departmentName || expense.generatedByDepartment || '—'}</span>
                </div>
              </div>
            }
            statutory={
              showStatutory && (
                // A disabled fieldset turns every control inside off — inputs, pickers and the
                // bill-type pills — without the section needing a read-only mode of its own. The
                // pickers open on pointer-down, which a disabled fieldset does not stop, hence
                // pointer-events as well.
                <fieldset disabled={lock.statutoryLocked} className={cn('min-w-0', lock.statutoryLocked && 'pointer-events-none')}>
                  <StatutorySection
                    amount={watchedAmount}
                    value={statutory}
                    onChange={setStatutory}
                    showErrors={showStatutoryErrors}
                    projectId={form.watch('projectId')}
                    departmentId={expense.departmentId}
                  />
                </fieldset>
              )
            }
          />
        </DialogBody>

        <DialogFooter className="flex-col gap-3 border-t pt-3 sm:flex-row sm:items-center sm:justify-between sm:space-x-0">
          <ExpenseRequestTotals amount={watchedAmount} netPayable={netPayableNow} withStatutory={withStatutoryNow} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <DialogClose asChild>
              <Button type="button" variant="outline" size="sm" disabled={isSaving}>Cancel</Button>
            </DialogClose>
            <Button type="submit" size="sm" disabled={isSaving || lock.locked} className="min-w-[120px] gap-2">
              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </DialogFooter>
      </form>
    </Form>
  );
}

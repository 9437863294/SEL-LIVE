'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { History, Trash2 } from 'lucide-react';
import { collection, doc, getDocs, runTransaction, Timestamp } from 'firebase/firestore';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/shared/page-header';
import { BANK_PAGE, BankAccessDenied, BankBalanceBackground, BankPageSkeleton, accountLabel } from '@/components/bank-balance/page-kit';
import { DateBankBar, EntryCard, EntryFooter, EntryTable, TD, TH, cellInput, entryRowCard, type FooterNote } from '@/components/bank-balance/entry-grid';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { db } from '@/lib/firebase';
import { balanceAt, buildLedger, dayKey, formatDay, formatInr, isCashCredit, parseDay } from '@/lib/bank-balance-ledger';
import type { BankAccount, BankExpense } from '@/lib/types';
import { useEntryControls } from '@/components/bank-balance/controls/use-entry-controls';
import { useBBFieldControl } from '@/components/bank-balance/controls/use-field-control';

type ReceiptLine = {
  id: string;
  description: string;
  /** Kept as typed so the field can be empty; parsed on use. */
  amount: string;
};

const makeId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const newLine = (): ReceiptLine => ({ id: makeId(), description: '', amount: '' });

const amountOf = (line: ReceiptLine) => {
  const value = Number(line.amount);
  return Number.isFinite(value) ? value : 0;
};

/**
 * New Receipt entry: several receipts into one bank account on one date, entered as rows of a
 * table — the same frame as New Payment. The saved documents are unchanged: one `bankExpenses`
 * Credit per row, all written in one transaction.
 */
export default function NewReceiptPage() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();
  const { log } = useActivityLogger(ACTIVITY_MODULES.BANK_BALANCE);
  // A form that writes receipts is gated on Add, not View.
  const canAdd = !authLoading && can('Add', 'Bank Balance.Receipts');

  const [date, setDate] = useState<Date | undefined>(new Date());
  const [selectedBank, setSelectedBank] = useState('');
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [transactions, setTransactions] = useState<BankExpense[]>([]);
  const [lines, setLines] = useState<ReceiptLine[]>(() => [newLine()]);
  const [showErrors, setShowErrors] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  // Field Control (labels, the description's visibility and requirement) and the Date Control
  // window and Month Closure calendar — the same for every user.
  const fc = useBBFieldControl('receipt');
  const nameOf = (id: string) => accountLabel(bankAccounts.find((account) => account.id === id));
  const controls = useEntryControls('receipt', nameOf);
  const descriptionField = fc.field('description');
  const dateLabel = fc.label('date');

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        // Transactions too, for the balance preview in the footer — as New Payment and New Transfer.
        const [snap, txnSnap] = await Promise.all([getDocs(collection(db, 'bankAccounts')), getDocs(collection(db, 'bankExpenses'))]);
        setBankAccounts(snap.docs.map((d) => ({ id: d.id, ...d.data() } as BankAccount)).sort((a, b) => accountLabel(a).localeCompare(accountLabel(b))));
        setTransactions(txnSnap.docs.map((d) => ({ id: d.id, ...d.data() } as BankExpense)));
      } catch (error) {
        console.error('Error fetching bank accounts:', error);
        toast({ title: 'Error', description: 'Failed to load bank accounts.', variant: 'destructive' });
      } finally {
        setIsLoading(false);
      }
    };
    if (authLoading) return;
    if (canAdd) void load();
    else setIsLoading(false);
  }, [authLoading, canAdd, toast]);

  // Leaving with typed-in receipts loses them; ask first.
  const isDirty = lines.some((line) => line.description || line.amount);
  useEffect(() => {
    if (!isDirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isDirty]);

  const activeAccounts = useMemo(() => bankAccounts.filter((account) => account.status === 'Active'), [bankAccounts]);
  const selectedAccount = bankAccounts.find((account) => account.id === selectedBank);
  const total = lines.reduce((sum, line) => sum + amountOf(line), 0);
  const missing = (line: ReceiptLine) => ({
    description: descriptionField.visible && descriptionField.required && !line.description.trim(),
    amount: !(amountOf(line) > 0),
  });
  const incomplete = lines.filter((line) => {
    const m = missing(line);
    return m.description || m.amount;
  });
  const openingDay = selectedAccount ? parseDay(selectedAccount.openingDate) : null;
  const beforeOpening = Boolean(openingDay && date && date < openingDay);
  const dateWindow = controls.windowFor([selectedBank]);
  // The date judged as the save will judge it, so the form says so before Save is pressed.
  const dateCheck = date && !controls.loading ? controls.check(dayKey(date), [selectedBank], { label: dateLabel }) : null;

  // The account's figure at the end of the chosen date, and what these rows make it: receipts add
  // to a current account's balance and repay Cash Credit utilisation.
  const preview = (() => {
    if (!selectedAccount || !date) return null;
    const figure = balanceAt(
      buildLedger(selectedAccount, transactions.filter((txn) => txn.accountId === selectedAccount.id)),
      date,
    );
    const cc = isCashCredit(selectedAccount);
    return { cc, figure, after: cc ? figure - total : figure + total };
  })();

  const update = (id: string, field: 'description' | 'amount', value: string) =>
    setLines((prev) => prev.map((line) => (line.id === id ? { ...line, [field]: value } : line)));
  const addLine = () => setLines((prev) => [...prev, newLine()]);
  const removeLine = (id: string) =>
    setLines((prev) => {
      const rest = prev.filter((line) => line.id !== id);
      return rest.length ? rest : [newLine()];
    });

  const handleSave = async () => {
    if (!canAdd) {
      toast({ title: 'Not allowed', description: 'You do not have permission to add receipts.', variant: 'destructive' });
      return;
    }
    setShowErrors(true);
    if (!date || !selectedBank) {
      toast({ title: 'Check the receipt', description: 'Pick the date and the bank account first.', variant: 'destructive' });
      return;
    }
    if (incomplete.length) {
      toast({
        title: incomplete.length > 1 ? `${incomplete.length} rows are incomplete` : `Row ${lines.indexOf(incomplete[0]) + 1} is incomplete`,
        description: descriptionField.visible && descriptionField.required
          ? `Every row needs ${descriptionField.label.toLowerCase()} and an amount above zero.`
          : 'Every row needs an amount above zero.',
        variant: 'destructive',
      });
      return;
    }
    // A receipt dated before the account opened is already inside its opening figure: the engine
    // would ignore it and no balance would move. New Payment and New Transfer refuse this too.
    if (beforeOpening && openingDay) {
      toast({
        title: 'Date before the account opened',
        description: `${accountLabel(selectedAccount)} opened ${formatDay(openingDay)}. Receipts dated earlier would not count toward its balance.`,
        variant: 'destructive',
      });
      return;
    }

    // Date Control's window and the closed months, checked at the moment of saving. No role
    // lifts either: the window is widened, or the month reopened, in Settings.
    const allowed = controls.check(dayKey(date), [selectedBank], { label: dateLabel });
    if (!allowed.ok) {
      toast({ title: 'Date not allowed', description: allowed.reason, variant: 'destructive' });
      return;
    }

    setIsSaving(true);
    // Ids fixed up front, so the activity log can name the documents written.
    const planned = lines.map((line) => ({ line, ref: doc(collection(db, 'bankExpenses')) }));
    try {
      await runTransaction(db, async (transaction) => {
        for (const { line, ref } of planned) {
          const receiptData: Omit<BankExpense, 'id'> = {
            date: Timestamp.fromDate(date),
            accountId: selectedBank,
            description: descriptionField.visible ? line.description.trim() : '',
            amount: amountOf(line),
            type: 'Credit',
            isContra: false,
            createdAt: Timestamp.now(),
          };
          transaction.set(ref, receiptData);
        }
      });
      toast({
        title: 'Saved',
        description: `${lines.length} receipt${lines.length === 1 ? '' : 's'} of ${formatInr(total)} into ${accountLabel(selectedAccount)} saved.`,
      });
      void log(
        'Add Receipts',
        {
          count: planned.length,
          total,
          accountId: selectedBank,
          account: accountLabel(selectedAccount),
          date: dayKey(date),
          receipts: planned.map(({ line, ref }) => ({ id: ref.id, description: line.description.trim(), amount: amountOf(line) })),
        },
        {
          ...(planned.length === 1 ? { recordId: planned[0].ref.id } : {}),
          recordRef: `${accountLabel(selectedAccount)} · ${dayKey(date)}`,
        },
      );
      // Keep the date and account: the next batch is usually for the same day and bank.
      setLines([newLine()]);
      setShowErrors(false);
    } catch (error) {
      console.error('Error saving receipts:', error);
      toast({ title: 'Save failed', description: 'Nothing was saved. Please try again.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  if (authLoading || (isLoading && canAdd)) return <BankPageSkeleton kpis={0} blocks={1} />;
  if (!canAdd) {
    return <BankAccessDenied title="New Receipt" backHref="/bank-balance/receipts" backLabel="Back to receipts" what="the receipt entry form" />;
  }

  const notes: FooterNote[] = [];
  if (showErrors && incomplete.length)
    notes.push({
      tone: 'error',
      text: `${incomplete.length} row${incomplete.length === 1 ? ' is' : 's are'} missing ${descriptionField.visible && descriptionField.required ? `${descriptionField.label.toLowerCase()} or ` : 'an '}amount (marked in red): ${incomplete
        .map((line) => `row ${lines.indexOf(line) + 1}`)
        .join(', ')}.`,
    });
  if (dateCheck && !dateCheck.ok) notes.push({ tone: 'error', text: dateCheck.reason ?? 'This date cannot be used.' });
  if (beforeOpening && openingDay)
    notes.push({
      tone: 'error',
      text: `This date is before the account's opening date (${formatDay(openingDay)}); the receipts would not count toward its balance. Pick a date on or after it.`,
    });

  return (
    <>
      <BankBalanceBackground tone="green" />
      <div className={BANK_PAGE}>
        <PageHeader
          title="New Receipt"
          description="Record one or more receipts into a bank account on the same date — one row per receipt."
          backHref="/bank-balance/receipts"
          backLabel="Back to receipts"
          actions={
            <Button asChild variant="outline">
              <Link href="/bank-balance/receipts">
                <History className="mr-2 h-4 w-4" />
                Receipts
              </Link>
            </Button>
          }
        />

        <EntryCard>
          <DateBankBar
            kind="receipt"
            date={date}
            onDateChange={setDate}
            accounts={activeAccounts}
            accountId={selectedBank}
            onAccountChange={setSelectedBank}
            showErrors={showErrors}
            minDate={dateWindow.min}
            maxDate={dateWindow.max}
            hint={controls.hintFor([selectedBank])}
            dateLabel={dateLabel}
            accountLabel={fc.label('accountId')}
          />

          <EntryTable
            minWidth={640}
            head={
              <tr>
                <TH className="w-10">#</TH>
                {descriptionField.visible && <TH required={descriptionField.required}>{descriptionField.label}</TH>}
                <TH className="w-48 text-right" required>
                  {fc.label('amount')} (₹)
                </TH>
                <TH className="w-10">
                  <span className="sr-only">Remove</span>
                </TH>
              </tr>
            }
            foot={
              <tr>
                <TD />
                <TD className="py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">{descriptionField.visible ? 'Total' : ''}</TD>
                <TD className="py-2.5 text-right font-bold tabular-nums">{formatInr(total)}</TD>
                <TD />
              </tr>
            }
          >
            {lines.map((line, index) => {
              const m = missing(line);
              return (
                <tr key={line.id} className={`bg-background/60 ${entryRowCard}`}>
                  <TD className="pt-4 text-xs font-semibold text-muted-foreground max-sm:pt-0">
                    <span className="sm:hidden">Row </span>
                    {index + 1}
                  </TD>
                  {descriptionField.visible && (
                  <TD label={descriptionField.label}>
                    <Input
                      aria-label={`Row ${index + 1} description`}
                      placeholder="e.g. Received from Client X — RA bill 12"
                      value={line.description}
                      className={cellInput(showErrors && m.description)}
                      onChange={(e) => update(line.id, 'description', e.target.value)}
                    />
                  </TD>
                  )}
                  <TD label={`${fc.label('amount')} (₹)`}>
                    <Input
                      aria-label={`Row ${index + 1} amount`}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="any"
                      placeholder="0.00"
                      value={line.amount}
                      className={`${cellInput(showErrors && m.amount)} text-right tabular-nums`}
                      onChange={(e) => update(line.id, 'amount', e.target.value)}
                    />
                  </TD>
                  <TD>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 text-destructive hover:text-destructive max-sm:w-full"
                      aria-label={`Remove row ${index + 1}`}
                      onClick={() => removeLine(line.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="ml-1.5 sm:hidden">Remove</span>
                    </Button>
                  </TD>
                </tr>
              );
            })}
          </EntryTable>

          <EntryFooter
            addLabel="Add row"
            onAdd={addLine}
            figures={[
              ...(preview && date
                ? [
                    { label: `${preview.cc ? 'Utilisation' : 'Balance'} at end of ${formatDay(date)}`, value: formatInr(preview.figure) },
                    { label: preview.cc ? 'Utilisation after these receipts' : 'Balance after these receipts', value: formatInr(preview.after) },
                  ]
                : []),
              { label: `Total (${lines.length} receipt${lines.length === 1 ? '' : 's'})`, value: formatInr(total) },
            ]}
            notes={notes}
            saveLabel={`Save ${lines.length > 1 ? `${lines.length} Receipts` : 'Receipt'}`}
            saving={isSaving}
            saveDisabled={activeAccounts.length === 0 || beforeOpening || Boolean(dateCheck && !dateCheck.ok)}
            onSave={() => void handleSave()}
          />
        </EntryCard>
      </div>
    </>
  );
}

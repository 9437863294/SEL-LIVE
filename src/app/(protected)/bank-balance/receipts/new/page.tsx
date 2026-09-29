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
import { DateBankBar, EntryCard, EntryFooter, EntryTable, TD, TH, cellInput, type FooterNote } from '@/components/bank-balance/entry-grid';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { db } from '@/lib/firebase';
import { dayKey, formatDay, formatInr, parseDay } from '@/lib/bank-balance-ledger';
import type { BankAccount, BankExpense } from '@/lib/types';

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
  const [lines, setLines] = useState<ReceiptLine[]>(() => [newLine()]);
  const [showErrors, setShowErrors] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const snap = await getDocs(collection(db, 'bankAccounts'));
        setBankAccounts(snap.docs.map((d) => ({ id: d.id, ...d.data() } as BankAccount)).sort((a, b) => accountLabel(a).localeCompare(accountLabel(b))));
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
  const missing = (line: ReceiptLine) => ({ description: !line.description.trim(), amount: !(amountOf(line) > 0) });
  const incomplete = lines.filter((line) => {
    const m = missing(line);
    return m.description || m.amount;
  });
  const openingDay = selectedAccount ? parseDay(selectedAccount.openingDate) : null;
  const beforeOpening = Boolean(openingDay && date && date < openingDay);

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
        description: 'Every row needs a description and an amount above zero.',
        variant: 'destructive',
      });
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
            description: line.description.trim(),
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
      text: `${incomplete.length} row${incomplete.length === 1 ? ' is' : 's are'} missing a description or amount (marked in red): ${incomplete
        .map((line) => `row ${lines.indexOf(line) + 1}`)
        .join(', ')}.`,
    });
  if (beforeOpening && openingDay)
    notes.push({ tone: 'warning', text: `This date is before the account's opening date (${formatDay(openingDay)}); the receipts will not count toward its balance.` });

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
          />

          <EntryTable
            minWidth={640}
            head={
              <tr>
                <TH className="w-10">#</TH>
                <TH required>Description</TH>
                <TH className="w-48 text-right" required>
                  Amount (₹)
                </TH>
                <TH className="w-10">
                  <span className="sr-only">Remove</span>
                </TH>
              </tr>
            }
            foot={
              <tr>
                <TD />
                <TD className="py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Total</TD>
                <TD className="py-2.5 text-right font-bold tabular-nums">{formatInr(total)}</TD>
                <TD />
              </tr>
            }
          >
            {lines.map((line, index) => {
              const m = missing(line);
              return (
                <tr key={line.id} className="bg-background/60">
                  <TD className="pt-4 text-xs font-semibold text-muted-foreground">{index + 1}</TD>
                  <TD>
                    <Input
                      aria-label={`Row ${index + 1} description`}
                      placeholder="e.g. Received from Client X — RA bill 12"
                      value={line.description}
                      className={cellInput(showErrors && m.description)}
                      onChange={(e) => update(line.id, 'description', e.target.value)}
                    />
                  </TD>
                  <TD>
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
                      className="h-9 w-9 text-destructive hover:text-destructive"
                      aria-label={`Remove row ${index + 1}`}
                      onClick={() => removeLine(line.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TD>
                </tr>
              );
            })}
          </EntryTable>

          <EntryFooter
            addLabel="Add row"
            onAdd={addLine}
            figures={[{ label: `Total (${lines.length} receipt${lines.length === 1 ? '' : 's'})`, value: formatInr(total) }]}
            notes={notes}
            saveLabel={`Save ${lines.length > 1 ? `${lines.length} Receipts` : 'Receipt'}`}
            saving={isSaving}
            saveDisabled={activeAccounts.length === 0}
            onSave={() => void handleSave()}
          />
        </EntryCard>
      </div>
    </>
  );
}

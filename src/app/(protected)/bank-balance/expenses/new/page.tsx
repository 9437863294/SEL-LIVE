'use client';
export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, History, Trash2 } from 'lucide-react';
import { collection, doc, getDoc, getDocs, runTransaction, Timestamp } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageHeader } from '@/components/shared/page-header';
import { BANK_PAGE, BankAccessDenied, BankBalanceBackground, BankPageSkeleton, accountLabel } from '@/components/bank-balance/page-kit';
import {
  DateBankBar,
  EntryCard,
  EntryFooter,
  EntryTable,
  FileCell,
  TD,
  TH,
  cellInput,
  fileSize,
  type FooterFigure,
  type FooterNote,
} from '@/components/bank-balance/entry-grid';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import { db } from '@/lib/firebase';
import { storage } from '@/lib/firebase-storage';
import { getApplicableCcLimit } from '@/lib/bank-balance-limit';
import { balanceAt, buildLedger, formatDay, formatInr, isCashCredit, parseDay, txnDate } from '@/lib/bank-balance-ledger';
import type { BankAccount, BankExpense } from '@/lib/types';

type MandatoryField = 'paymentRequestRefNo' | 'utrNumber' | 'paymentMethod' | 'paymentRefNo' | 'approvalCopy' | 'bankTransferCopy';
type MandatoryFields = Record<MandatoryField, boolean>;

type PaymentLine = {
  id: string;
  description: string;
  /** Kept as typed so the field can be empty; parsed on use. */
  amount: string;
  paymentRequestRefNo: string;
  utrNumber: string;
  paymentMethod: string;
  paymentRefNo: string;
  approvalCopy: File | null;
  bankTransferCopy: File | null;
};

type LineField = keyof Omit<PaymentLine, 'id'>;

const NO_MANDATORY: MandatoryFields = {
  paymentRequestRefNo: false,
  utrNumber: false,
  paymentMethod: false,
  paymentRefNo: false,
  approvalCopy: false,
  bankTransferCopy: false,
};

const FIELD_LABEL: Record<LineField, string> = {
  description: 'Description',
  amount: 'Amount',
  paymentRequestRefNo: 'Payment Request Ref No.',
  utrNumber: 'UTR Number',
  paymentMethod: 'Payment Method',
  paymentRefNo: 'Payment Ref No.',
  approvalCopy: 'Approval Copy',
  bankTransferCopy: 'Bank Transfer Copy',
};

const makeId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const newLine = (): PaymentLine => ({
  id: makeId(),
  description: '',
  amount: '',
  paymentRequestRefNo: '',
  utrNumber: '',
  paymentMethod: '',
  paymentRefNo: '',
  approvalCopy: null,
  bankTransferCopy: null,
});

const amountOf = (line: PaymentLine) => {
  const value = Number(line.amount);
  return Number.isFinite(value) ? value : 0;
};

const hasContent = (line: PaymentLine) =>
  Boolean(line.description || line.amount || line.paymentRequestRefNo || line.utrNumber || line.paymentMethod || line.paymentRefNo || line.approvalCopy || line.bankTransferCopy);

/** The fields a line is still missing, in column order. */
function missingFields(line: PaymentLine, mandatory: MandatoryFields): LineField[] {
  const missing: LineField[] = [];
  if (!line.description.trim()) missing.push('description');
  if (!(amountOf(line) > 0)) missing.push('amount');
  (Object.keys(mandatory) as MandatoryField[]).forEach((field) => {
    if (!mandatory[field]) return;
    const value = line[field];
    if (value === null || (typeof value === 'string' && !value.trim())) missing.push(field);
  });
  return missing;
}

/**
 * New Payment entry: several payments from one bank account on one date, entered as rows of a
 * table and saved together.
 *
 * The saved documents are unchanged (one `bankExpenses` Debit per row, attachments uploaded to
 * Storage first, every document written in one transaction). Available funds, the batch total and
 * what is left sit in the footer beside Save; problems are marked on the cell they belong to.
 */
export default function NewPaymentPage() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();
  const canAdd = !authLoading && can('Add', 'Bank Balance.Expenses');

  const [date, setDate] = useState<Date | undefined>(new Date());
  const [selectedBank, setSelectedBank] = useState('');

  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [allTransactions, setAllTransactions] = useState<BankExpense[]>([]);
  const [mandatory, setMandatory] = useState<MandatoryFields>(NO_MANDATORY);
  const [paymentMethods, setPaymentMethods] = useState<Array<{ id: string; name: string }>>([]);

  const [lines, setLines] = useState<PaymentLine[]>(() => [newLine()]);
  /** Set by the first save attempt; until then empty cells are not marked. */
  const [showErrors, setShowErrors] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [accountsSnap, settingsSnap, methodsSnap, txnSnap] = await Promise.all([
        getDocs(collection(db, 'bankAccounts')),
        getDoc(doc(db, 'bankBalanceSettings', 'paymentEntry')),
        getDocs(collection(db, 'paymentMethods')),
        getDocs(collection(db, 'bankExpenses')),
      ]);
      setBankAccounts(
        accountsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as BankAccount)).sort((a, b) => accountLabel(a).localeCompare(accountLabel(b))),
      );
      setMandatory({ ...NO_MANDATORY, ...(settingsSnap.exists() ? settingsSnap.data().mandatoryFields || {} : {}) });
      setPaymentMethods(methodsSnap.docs.map((d) => ({ id: d.id, name: String(d.data().name ?? '') })).sort((a, b) => a.name.localeCompare(b.name)));
      setAllTransactions(txnSnap.docs.map((d) => ({ id: d.id, ...d.data() } as BankExpense)));
    } catch (error) {
      console.error('Error fetching data:', error);
      toast({ title: 'Error', description: 'Failed to load bank accounts and payment settings.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (authLoading) return;
    if (!canAdd) {
      setIsLoading(false);
      return;
    }
    void load();
  }, [authLoading, canAdd, load]);

  // Leaving with typed-in payments loses them; ask first.
  const isDirty = lines.some(hasContent);
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

  // From the engine, so the opening date is honoured and every entry already on the day counts: a
  // Current Account's balance, or a Cash Credit account's limit in force less its utilisation.
  const available = useMemo(() => {
    if (!selectedAccount || !date) return null;
    const figure = balanceAt(buildLedger(selectedAccount, allTransactions), date);
    return isCashCredit(selectedAccount) ? getApplicableCcLimit(selectedAccount, date) - figure : figure;
  }, [selectedAccount, allTransactions, date]);

  const total = lines.reduce((sum, line) => sum + amountOf(line), 0);
  const remaining = available === null ? null : available - total;
  const overBy = remaining !== null && remaining < 0 ? -remaining : 0;
  const openingDay = selectedAccount ? parseDay(selectedAccount.openingDate) : null;
  const beforeOpening = Boolean(openingDay && date && date < openingDay);

  const missingByLine = useMemo(() => new Map(lines.map((line) => [line.id, missingFields(line, mandatory)])), [lines, mandatory]);
  const incomplete = lines.filter((line) => (missingByLine.get(line.id)?.length ?? 0) > 0);

  // A UTR identifies one bank transfer: the same one twice is almost always a double entry.
  const recordedUtr = useMemo(() => {
    const map = new Map<string, BankExpense>();
    allTransactions.forEach((txn) => {
      const utr = txn.utrNumber?.trim().toLowerCase();
      if (utr && txn.type === 'Debit') map.set(utr, txn);
    });
    return map;
  }, [allTransactions]);
  const utrWarning = (line: PaymentLine): string | null => {
    const utr = line.utrNumber.trim().toLowerCase();
    if (!utr) return null;
    if (lines.some((other) => other.id !== line.id && other.utrNumber.trim().toLowerCase() === utr)) return 'This UTR is on another row of this batch.';
    const existing = recordedUtr.get(utr);
    if (existing) {
      const account = bankAccounts.find((a) => a.id === existing.accountId);
      return `UTR already recorded: ${formatInr(existing.amount)} from ${accountLabel(account)} on ${formatDay(txnDate(existing))}.`;
    }
    return null;
  };

  const update = (id: string, field: LineField, value: PaymentLine[LineField]) =>
    setLines((prev) => prev.map((line) => (line.id === id ? { ...line, [field]: value } : line)));

  const addLine = () => setLines((prev) => [...prev, newLine()]);
  const removeLine = (id: string) =>
    setLines((prev) => {
      const rest = prev.filter((line) => line.id !== id);
      return rest.length ? rest : [newLine()];
    });

  const tooLarge = (file: File) =>
    toast({ title: 'File too large', description: `${file.name} is ${fileSize(file.size)}; the limit is 10 MB.`, variant: 'destructive' });

  const handleSave = async () => {
    if (!canAdd) {
      toast({ title: 'Not allowed', description: 'You do not have permission to add payments.', variant: 'destructive' });
      return;
    }
    setShowErrors(true);
    if (!date || !selectedBank) {
      toast({ title: 'Check the payment', description: 'Pick the date and the bank account first.', variant: 'destructive' });
      return;
    }
    if (incomplete.length) {
      const first = incomplete[0];
      toast({
        title: incomplete.length > 1 ? `${incomplete.length} rows are incomplete` : `Row ${lines.indexOf(first) + 1} is incomplete`,
        description: `Row ${lines.indexOf(first) + 1}: ${(missingByLine.get(first.id) ?? []).map((field) => FIELD_LABEL[field]).join(', ')}.`,
        variant: 'destructive',
      });
      return;
    }
    if (available !== null && total > available) {
      toast({
        title: 'Insufficient funds',
        description: `The batch totals ${formatInr(total)}, but ${accountLabel(selectedAccount)} has ${formatInr(available)} available.`,
        variant: 'destructive',
      });
      return;
    }

    setIsSaving(true);
    try {
      // 1) Upload files first (outside the transaction).
      const prepared = await Promise.all(
        lines.map(async (line) => {
          let approvalCopyUrl = '';
          let bankTransferCopyUrl = '';
          if (line.approvalCopy) {
            const approvalRef = ref(storage, `expenses/${date.toISOString()}/${line.id}-approval-${line.approvalCopy.name}`);
            await uploadBytes(approvalRef, line.approvalCopy);
            approvalCopyUrl = await getDownloadURL(approvalRef);
          }
          if (line.bankTransferCopy) {
            const transferRef = ref(storage, `expenses/${date.toISOString()}/${line.id}-transfer-${line.bankTransferCopy.name}`);
            await uploadBytes(transferRef, line.bankTransferCopy);
            bankTransferCopyUrl = await getDownloadURL(transferRef);
          }
          return { line, approvalCopyUrl, bankTransferCopyUrl };
        }),
      );

      // 2) Write every document in one transaction.
      await runTransaction(db, async (transaction) => {
        prepared.forEach(({ line, approvalCopyUrl, bankTransferCopyUrl }) => {
          const expenseRef = doc(collection(db, 'bankExpenses'));
          const expenseData: Omit<BankExpense, 'id'> = {
            date: Timestamp.fromDate(date),
            accountId: selectedBank,
            description: line.description.trim(),
            amount: amountOf(line),
            type: 'Debit',
            isContra: false,
            paymentRequestRefNo: line.paymentRequestRefNo.trim(),
            utrNumber: line.utrNumber.trim(),
            paymentMethod: line.paymentMethod,
            paymentRefNo: line.paymentRefNo.trim(),
            approvalCopyUrl,
            bankTransferCopyUrl,
            createdAt: Timestamp.now(),
          };
          transaction.set(expenseRef, expenseData);
        });
      });

      toast({
        title: 'Saved',
        description: `${lines.length} payment${lines.length === 1 ? '' : 's'} of ${formatInr(total)} from ${accountLabel(selectedAccount)} saved.`,
      });
      // Keep the date and account: the next batch is usually for the same day and bank.
      setLines([newLine()]);
      setShowErrors(false);
      void load();
    } catch (error) {
      console.error('Error saving payments:', error);
      toast({ title: 'Save failed', description: 'Nothing was saved. Please try again.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  if (authLoading || (isLoading && canAdd)) return <BankPageSkeleton kpis={0} blocks={1} />;
  if (!canAdd) {
    return <BankAccessDenied title="New Payment" backHref="/bank-balance/expenses" backLabel="Back to payments" what="the payment entry form" />;
  }

  const err = (line: PaymentLine, field: LineField) => showErrors && (missingByLine.get(line.id) ?? []).includes(field);

  const figures: FooterFigure[] = [
    ...(available !== null
      ? [{ label: selectedAccount && isCashCredit(selectedAccount) ? 'Available limit' : 'Available balance', value: formatInr(available) }]
      : []),
    { label: `Total (${lines.length} payment${lines.length === 1 ? '' : 's'})`, value: formatInr(total) },
    ...(remaining !== null ? [{ label: 'Left after saving', value: formatInr(remaining), tone: overBy > 0 ? ('bad' as const) : ('good' as const) }] : []),
  ];

  const notes: FooterNote[] = [];
  if (overBy > 0) notes.push({ tone: 'error', text: `Over the available funds by ${formatInr(overBy)} — reduce an amount or pick another account.` });
  if (showErrors && incomplete.length)
    notes.push({
      tone: 'error',
      text: `${incomplete.length} row${incomplete.length === 1 ? ' is' : 's are'} missing required fields (marked in red): ${incomplete
        .map((line) => `row ${lines.indexOf(line) + 1}`)
        .join(', ')}.`,
    });
  if (beforeOpening && openingDay)
    notes.push({ tone: 'warning', text: `This date is before the account's opening date (${formatDay(openingDay)}); the payments will not count toward its balance.` });
  lines.forEach((line, index) => {
    const warning = utrWarning(line);
    if (warning) notes.push({ tone: 'warning', text: `Row ${index + 1}: ${warning}` });
  });
  if (!selectedAccount) notes.push({ tone: 'warning', text: 'Pick a bank account to see the funds available for this batch.' });

  return (
    <>
      <BankBalanceBackground tone="red" />
      <div className={BANK_PAGE}>
        <PageHeader
          title="New Payment"
          description="Record one or more payments from a bank account on the same date — one row per payment."
          backHref="/bank-balance/expenses"
          backLabel="Back to payments"
          actions={
            <Button asChild variant="outline">
              <Link href="/bank-balance/expenses">
                <History className="mr-2 h-4 w-4" />
                Payments
              </Link>
            </Button>
          }
        />

        <EntryCard>
          <DateBankBar
            kind="payment"
            date={date}
            onDateChange={setDate}
            accounts={activeAccounts}
            accountId={selectedBank}
            onAccountChange={setSelectedBank}
            showErrors={showErrors}
          />

          <EntryTable
            minWidth={1380}
            head={
              <tr>
                <TH className="w-10">#</TH>
                <TH required>Description</TH>
                <TH className="w-40 text-right" required>
                  Amount (₹)
                </TH>
                <TH className="w-40" required={mandatory.paymentRequestRefNo}>
                  P.R. Ref No.
                </TH>
                <TH className="w-40" required={mandatory.paymentMethod}>
                  Method
                </TH>
                <TH className="w-40" required={mandatory.paymentRefNo}>
                  Payment Ref No.
                </TH>
                <TH className="w-44" required={mandatory.utrNumber}>
                  UTR No.
                </TH>
                <TH className="w-36" required={mandatory.approvalCopy}>
                  Approval
                </TH>
                <TH className="w-36" required={mandatory.bankTransferCopy}>
                  Transfer copy
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
                <TD className="py-2.5" />
                <TD />
                <TD />
                <TD />
                <TD />
                <TD />
                <TD />
              </tr>
            }
          >
            {lines.map((line, index) => {
              const utrNote = utrWarning(line);
              return (
                <tr key={line.id} className="bg-background/60">
                  <TD className="pt-4 text-xs font-semibold text-muted-foreground">{index + 1}</TD>
                  <TD>
                    <Input
                      aria-label={`Row ${index + 1} description`}
                      placeholder="What the payment is for"
                      value={line.description}
                      className={cellInput(err(line, 'description'))}
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
                      className={`${cellInput(err(line, 'amount'))} text-right tabular-nums`}
                      onChange={(e) => update(line.id, 'amount', e.target.value)}
                    />
                  </TD>
                  <TD>
                    <Input
                      aria-label={`Row ${index + 1} payment request ref no.`}
                      placeholder="Request no."
                      value={line.paymentRequestRefNo}
                      className={cellInput(err(line, 'paymentRequestRefNo'))}
                      onChange={(e) => update(line.id, 'paymentRequestRefNo', e.target.value)}
                    />
                  </TD>
                  <TD>
                    <Select value={line.paymentMethod} onValueChange={(value) => update(line.id, 'paymentMethod', value)}>
                      <SelectTrigger aria-label={`Row ${index + 1} payment method`} className={cellInput(err(line, 'paymentMethod'))}>
                        <SelectValue placeholder={paymentMethods.length ? 'Select' : 'None set up'} />
                      </SelectTrigger>
                      <SelectContent>
                        {paymentMethods.map((method) => (
                          <SelectItem key={method.id} value={method.name}>
                            {method.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TD>
                  <TD>
                    <Input
                      aria-label={`Row ${index + 1} payment ref no.`}
                      placeholder="Cheque / instrument"
                      value={line.paymentRefNo}
                      className={cellInput(err(line, 'paymentRefNo'))}
                      onChange={(e) => update(line.id, 'paymentRefNo', e.target.value)}
                    />
                  </TD>
                  <TD>
                    <div className="relative">
                      <Input
                        aria-label={`Row ${index + 1} UTR number`}
                        placeholder="Bank reference"
                        value={line.utrNumber}
                        title={utrNote ?? undefined}
                        className={`${cellInput(err(line, 'utrNumber'))} font-mono ${utrNote ? 'border-amber-400 pr-8' : ''}`}
                        onChange={(e) => update(line.id, 'utrNumber', e.target.value)}
                      />
                      {utrNote && <AlertTriangle className="pointer-events-none absolute right-2.5 top-2.5 h-4 w-4 text-amber-600" aria-label={utrNote} />}
                    </div>
                  </TD>
                  <TD>
                    <FileCell
                      id={`approval-${line.id}`}
                      label={`Row ${index + 1} approval copy`}
                      file={line.approvalCopy}
                      onChange={(file) => update(line.id, 'approvalCopy', file)}
                      onTooLarge={tooLarge}
                      invalid={err(line, 'approvalCopy')}
                    />
                  </TD>
                  <TD>
                    <FileCell
                      id={`transfer-${line.id}`}
                      label={`Row ${index + 1} bank transfer copy`}
                      file={line.bankTransferCopy}
                      onChange={(file) => update(line.id, 'bankTransferCopy', file)}
                      onTooLarge={tooLarge}
                      invalid={err(line, 'bankTransferCopy')}
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
            figures={figures}
            notes={notes}
            saveLabel={`Save ${lines.length > 1 ? `${lines.length} Payments` : 'Payment'}`}
            saving={isSaving}
            saveDisabled={activeAccounts.length === 0 || overBy > 0}
            onSave={() => void handleSave()}
          />
        </EntryCard>
      </div>
    </>
  );
}

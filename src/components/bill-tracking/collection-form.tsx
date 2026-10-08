'use client';

/**
 * Record a receipt (`/bill-tracking/collections/new`).
 *
 * Opened from a bill (`?bill=`) it is a single-bill receipt with the outstanding pre-filled. Opened
 * on its own it is a bank receipt to split across several bills — "₹25 L from OPTCL: ₹10 L to bill
 * A, ₹8 L to B, ₹7 L to C". The allocation must add up to the receipt unless the user may hold the
 * difference unallocated. The server re-reads every bill in one transaction before posting, so the
 * outstanding shown here is advisory.
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Calculator, Plus, Trash2, Wallet } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/shared/page-header';
import { useToast } from '@/hooks/use-toast';
import { roundMoney, subtractMoney, sumMoney } from '@/lib/bill-tracking/money';
import { PAYMENT_MODES } from '@/lib/bill-tracking/types';

import { btFetch, useBt, useBtQuery, useDebounced, useLookups } from './bt-client';
import { ToolbarSearch, ToolbarSelect } from './bt-toolbar';
import { Amount, BtError, FormField, FormSection, Notice, dateText } from './bt-ui';

interface OpenBill {
  id: string;
  billSerialNumber?: string;
  gstInvoiceNumber?: string;
  billDate: string;
  projectId: string;
  projectNameSnapshot: string;
  clientNameSnapshot?: string;
  netReceivable: number;
  totalReceived: number;
  outstandingAmount: number;
  isRetentionBill: boolean;
}

interface Line {
  bill: OpenBill;
  amount: string;
}

const num = (value: string) => {
  const parsed = Number(String(value).replace(/[,₹\s]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

export default function CollectionForm() {
  const lookups = useLookups();
  const { can } = useBt();
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useToast();
  const preselected = params.get('bill');

  const [receiptDate, setReceiptDate] = useState(lookups.today);
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<string>('RTGS');
  const [utr, setUtr] = useState('');
  const [bankReference, setBankReference] = useState('');
  const [bankAccountName, setBankAccountName] = useState('');
  const [remarks, setRemarks] = useState('');
  const [verifyNow, setVerifyNow] = useState(can('Collections', 'Verify'));
  const [allowUnallocated, setAllowUnallocated] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [search, setSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const debounced = useDebounced(search);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: preset } = useBtQuery<{ bills: OpenBill[] }>(preselected ? `bills/open?ids=${preselected}` : null);
  useEffect(() => {
    const bill = preset?.bills.find((entry) => entry.id === preselected);
    if (bill && lines.length === 0) {
      setLines([{ bill, amount: String(bill.outstandingAmount) }]);
      setAmount(String(bill.outstandingAmount));
    }
    // Only on first load of the preselected bill.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);

  const searchQuery = `bills/open?q=${encodeURIComponent(debounced)}${projectFilter ? `&project=${projectFilter}` : ''}`;
  const { data: candidates, loading: searching } = useBtQuery<{ bills: OpenBill[] }>(searchQuery);

  const allocated = sumMoney(lines.map((line) => num(line.amount)));
  const receipt = num(amount);
  const unallocated = subtractMoney(receipt, allocated);
  const canHold = can('Collections', 'Hold Unallocated');
  const balanced = roundMoney(unallocated) === 0;
  const valid = receipt !== 0 && lines.length > 0 && lines.every((line) => num(line.amount) !== 0) && (balanced || (allowUnallocated && canHold && Math.abs(allocated) < Math.abs(receipt)));

  const addBill = (bill: OpenBill) => {
    if (lines.some((line) => line.bill.id === bill.id)) return;
    const remaining = Math.max(0, Math.min(bill.outstandingAmount, receipt ? subtractMoney(receipt, allocated) : bill.outstandingAmount));
    setLines((current) => [...current, { bill, amount: String(remaining || bill.outstandingAmount) }]);
  };

  /** Fills the receipt across the chosen bills oldest-first, up to each bill's outstanding. */
  const autoAllocate = () => {
    let left = receipt;
    setLines((current) =>
      [...current]
        .sort((a, b) => a.bill.billDate.localeCompare(b.bill.billDate))
        .map((line) => {
          const take = Math.max(0, Math.min(line.bill.outstandingAmount, left));
          left = subtractMoney(left, take);
          return { ...line, amount: String(take) };
        }),
    );
  };

  const overAllocated = lines.filter((line) => num(line.amount) > line.bill.outstandingAmount + lookups.config.settings.tolerance);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await btFetch<{ id: string }>('collections', {
        body: {
          receiptDate,
          amount: receipt,
          allocations: lines.map((line) => ({ billId: line.bill.id, amount: num(line.amount) })),
          paymentMode: mode,
          utrNumber: utr,
          bankReference,
          bankAccountName,
          remarks,
          verifyNow,
          allowUnallocated: allowUnallocated && !balanced,
        },
      });
      toast({ title: verifyNow ? 'Receipt recorded and verified' : 'Receipt recorded — awaiting verification', description: `₹${receipt.toLocaleString('en-IN')} across ${lines.length} bill(s).` });
      router.push(lines.length === 1 ? `/bill-tracking/bills/${lines[0].bill.id}?tab=collections` : `/bill-tracking/collections?highlight=${result.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not record the receipt.');
      setSaving(false);
    }
  };

  const shownCandidates = useMemo(() => (candidates?.bills ?? []).filter((bill) => !lines.some((line) => line.bill.id === bill.id)), [candidates, lines]);

  return (
    <div className="space-y-4">
      <PageHeader icon={Wallet} title="Record receipt" backHref={preselected ? `/bill-tracking/bills/${preselected}` : '/bill-tracking/collections'} backLabel={preselected ? 'Bill' : 'Collections'} description="Enter the bank receipt, then allocate it to one or more bills. Only verified receipts reduce the outstanding." />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <FormSection step={1} title="Receipt" description="As it appears on the bank statement.">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <FormField label="Receipt date *" htmlFor="receipt-date">
                <Input id="receipt-date" type="date" value={receiptDate} max={lookups.today} onChange={(event) => setReceiptDate(event.target.value)} />
              </FormField>
              <FormField label="Amount received (₹) *" htmlFor="receipt-amount">
                <Input id="receipt-amount" inputMode="decimal" className="tabular-nums" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="e.g. 2500000" />
              </FormField>
              <FormField label="Payment mode">
                <Select value={mode} onValueChange={setMode}>
                  <SelectTrigger aria-label="Payment mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_MODES.map((entry) => (
                      <SelectItem key={entry} value={entry}>
                        {entry.replace('_', ' ')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="UTR number" htmlFor="utr">
                <Input id="utr" value={utr} onChange={(event) => setUtr(event.target.value)} />
              </FormField>
              <FormField label="Bank reference" htmlFor="bank-ref">
                <Input id="bank-ref" value={bankReference} onChange={(event) => setBankReference(event.target.value)} />
              </FormField>
              <FormField label="Received in account" htmlFor="bank-account">
                <Input id="bank-account" value={bankAccountName} onChange={(event) => setBankAccountName(event.target.value)} placeholder="e.g. SBI CC A/c" />
              </FormField>
            </div>
            <FormField label="Remarks" htmlFor="receipt-remarks">
              <Textarea id="receipt-remarks" rows={2} value={remarks} onChange={(event) => setRemarks(event.target.value)} />
            </FormField>
          </FormSection>

          <FormSection
            step={2}
            title="Allocation"
            description="Which bills this receipt pays — find them below and add them."
            actions={
              lines.length > 1 && receipt ? (
                <Button size="sm" variant="outline" onClick={autoAllocate}>
                  Allocate oldest first
                </Button>
              ) : null
            }
          >
              {lines.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 px-4 py-5 text-center text-sm text-slate-500">No bills added yet — add the bills this receipt pays from the list below.</div>
              ) : (
                <div className="hidden grid-cols-[minmax(0,1fr)_160px_40px] gap-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 sm:grid">
                  <span>Bill</span>
                  <span className="text-right">Allocated ₹</span>
                  <span className="sr-only">Remove</span>
                </div>
              )}
              <div className="space-y-2">
                {lines.map((line) => (
                  <div key={line.bill.id} className="grid grid-cols-[minmax(0,1fr)_40px] items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 sm:grid-cols-[minmax(0,1fr)_160px_40px]">
                    <div className="min-w-0 text-sm">
                      <p className="truncate font-medium text-slate-800">
                        {line.bill.gstInvoiceNumber || line.bill.billSerialNumber} · {line.bill.projectNameSnapshot}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {dateText(line.bill.billDate)} · net <Amount value={line.bill.netReceivable} /> · outstanding <Amount value={line.bill.outstandingAmount} className="font-medium text-rose-700" />
                        {line.bill.isRetentionBill ? ' · retention bill (posts a retention release)' : ''}
                      </p>
                    </div>
                    <Input inputMode="decimal" aria-label="Allocated amount" className="col-start-1 row-start-2 text-right tabular-nums sm:col-start-auto sm:row-start-auto" value={line.amount} onChange={(event) => setLines((current) => current.map((entry) => (entry.bill.id === line.bill.id ? { ...entry, amount: event.target.value } : entry)))} />
                    <Button variant="ghost" size="icon" className="col-start-2 row-start-1 sm:col-start-auto sm:row-start-auto" aria-label="Remove bill" onClick={() => setLines((current) => current.filter((entry) => entry.bill.id !== line.bill.id))}>
                      <Trash2 className="h-4 w-4 text-rose-600" />
                    </Button>
                  </div>
                ))}
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Find open bills</p>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <ToolbarSearch className="flex-1" placeholder="Invoice, bill no, project, amount" value={search} onChange={setSearch} />
                  <ToolbarSelect label="Project" value={projectFilter} onChange={setProjectFilter} options={lookups.projects.map((project) => ({ value: project.id, label: project.name }))} allLabel="All projects" />
                </div>
                <ul className="mt-2 max-h-72 divide-y divide-slate-100 overflow-y-auto">
                  {searching && !candidates ? <li className="py-2 text-sm text-muted-foreground">Searching…</li> : null}
                  {shownCandidates.length === 0 && !searching ? <li className="py-2 text-sm text-muted-foreground">No open bills match.</li> : null}
                  {shownCandidates.map((bill) => (
                    <li key={bill.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                      <span className="min-w-0 truncate">
                        <b>{bill.gstInvoiceNumber || bill.billSerialNumber}</b> · {bill.projectNameSnapshot} · {dateText(bill.billDate)}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <Amount value={bill.outstandingAmount} className="text-rose-700" />
                        <Button size="sm" variant="outline" className="h-7 gap-1 px-2" onClick={() => addBill(bill)}>
                          <Plus className="h-3.5 w-3.5" /> Add
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
          </FormSection>
        </div>

        <div className="space-y-3 xl:sticky xl:top-[calc(var(--app-header-offset,4rem)+1rem)] xl:self-start">
          <FormSection icon={Calculator} title="Summary" className="border-emerald-200" bodyClassName="space-y-2 p-4 text-sm">
              <div className="flex justify-between">
                <span>Receipt</span>
                <Amount value={receipt} className="font-semibold" />
              </div>
              <div className="flex justify-between">
                <span>Allocated</span>
                <Amount value={allocated} />
              </div>
              <div className={`flex justify-between ${balanced ? 'text-emerald-700' : 'font-semibold text-amber-700'}`}>
                <span>Unallocated</span>
                <Amount value={unallocated} signed />
              </div>
              {!balanced && receipt !== 0 ? (
                canHold ? (
                  <label className="flex items-start gap-2 pt-1 text-xs">
                    <Checkbox checked={allowUnallocated} onCheckedChange={(value) => setAllowUnallocated(Boolean(value))} />
                    Hold the difference as unallocated (to be allocated later)
                  </label>
                ) : (
                  <p className="text-xs text-amber-800">Allocate the full receipt — holding money unallocated needs extra permission.</p>
                )
              ) : null}
              {can('Collections', 'Verify') ? (
                <label className="flex items-start gap-2 border-t pt-2 text-xs">
                  <Checkbox checked={verifyNow} onCheckedChange={(value) => setVerifyNow(Boolean(value))} />
                  Verify now (I have checked the bank credit)
                </label>
              ) : (
                <p className="border-t pt-2 text-xs text-muted-foreground">The receipt will await verification by someone with Verify permission.</p>
              )}
          </FormSection>
          {overAllocated.length ? (
            <Notice tone="amber" title="More than the outstanding">
              {overAllocated.map((line) => line.bill.gstInvoiceNumber || line.bill.billSerialNumber).join(', ')} will show as over received.
            </Notice>
          ) : null}
          <BtError message={error} />
          <Button className="w-full gap-1.5" disabled={!valid || saving || !can('Collections', 'Add')} onClick={() => void submit()}>
            <Wallet className="h-4 w-4" /> {saving ? 'Saving…' : 'Save receipt'}
          </Button>
        </div>
      </div>
    </div>
  );
}

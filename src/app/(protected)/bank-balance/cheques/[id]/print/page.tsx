'use client';

/**
 * A payment voucher on A4 — the paper that goes into the voucher file with the cheque counterfoil
 * or the transfer advice, signed by whoever prepared, checked and approved it.
 *
 * A `/print` route: AppShell drops the app header and the Bank Balance bottom bar hides itself. The
 * Bank Balance sidebar shell still wraps the page on a desktop screen, so the print rules below keep
 * it off the paper.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Printer } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { format } from 'date-fns';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { BankAccessDenied } from '@/components/bank-balance/page-kit';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAppearance } from '@/components/theme/ThemeProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { db } from '@/lib/firebase';
import { formatDay, formatInr } from '@/lib/bank-balance-ledger';
import { displayStatus, modeConfig, type BankPaymentVoucher } from '@/lib/bank-payments';
import { voucherHref } from '@/lib/requisition-progress';
import type { BankAccount } from '@/lib/types';

/* ── Amount in words, Indian numbering (crore / lakh / thousand) ───────────────────────────── */

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

const belowHundred = (n: number): string => (n < 20 ? ONES[n] : [TENS[Math.floor(n / 10)], ONES[n % 10]].filter(Boolean).join(' '));

const belowThousand = (n: number): string =>
  [n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred` : '', belowHundred(n % 100)].filter(Boolean).join(' ');

function indianWords(n: number): string {
  if (n === 0) return 'Zero';
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1000);
  const rest = n % 1000;
  return [
    crore ? `${indianWords(crore)} Crore` : '',
    lakh ? `${belowHundred(lakh)} Lakh` : '',
    thousand ? `${belowHundred(thousand)} Thousand` : '',
    rest ? belowThousand(rest) : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** 123456.78 → "Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Seventy Eight Paise Only". */
function rupeesInWords(amount: number): string {
  const paiseTotal = Math.round(Math.abs(Number(amount) || 0) * 100);
  const rupees = Math.floor(paiseTotal / 100);
  const paise = paiseTotal % 100;
  return paise ? `Rupees ${indianWords(rupees)} and ${belowHundred(paise)} Paise Only` : `Rupees ${indianWords(rupees)} Only`;
}

/* ── Page ─────────────────────────────────────────────────────────────────────────────────── */

const PRINT_CSS = `
@media print {
  @page { size: A4 portrait; margin: 12mm; }
  html, body { background: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  /* The Bank Balance module shell wraps this page too: its sidebar is not part of the document. */
  aside { display: none !important; }
  div:has(> aside):has(> main) { display: block !important; padding: 0 !important; }
  .pv-sheet thead { display: table-header-group; }
  .pv-sheet tr, .pv-sheet .pv-keep { break-inside: avoid; page-break-inside: avoid; }
}
`;

type LoadState = 'loading' | 'ready' | 'missing' | 'error';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 py-0.5">
      <dt className="w-32 shrink-0 text-slate-500">{label}</dt>
      <dd className="min-w-0 break-words font-medium">{children}</dd>
    </div>
  );
}

export default function PaymentVoucherPrintPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id ?? '');
  const { user } = useAuth();
  const { company } = useAppearance();
  const { can, isLoading: authLoading } = useAuthorization();
  const canView = !authLoading && can('View', 'Bank Balance.Expenses');

  const [voucher, setVoucher] = useState<BankPaymentVoucher | null>(null);
  const [account, setAccount] = useState<BankAccount | null>(null);
  const [state, setState] = useState<LoadState>('loading');

  useEffect(() => {
    // No id means nothing to load: the render below treats it as "not found" instead of setting
    // state here.
    if (authLoading || !canView || !id) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'bankPayments', id));
        if (!snap.exists()) {
          if (!cancelled) setState('missing');
          return;
        }
        const found = { id: snap.id, ...snap.data() } as BankPaymentVoucher;
        const accountSnap = found.accountId ? await getDoc(doc(db, 'bankAccounts', found.accountId)) : null;
        if (cancelled) return;
        setVoucher(found);
        setAccount(accountSnap?.exists() ? ({ id: accountSnap.id, ...accountSnap.data() } as BankAccount) : null);
        setState('ready');
      } catch (error) {
        console.error('Error loading the payment voucher:', error);
        if (!cancelled) setState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, canView, id]);

  // The browser offers the document title as the PDF's file name.
  useEffect(() => {
    if (!voucher) return;
    const previous = document.title;
    document.title = `Payment Voucher ${voucher.voucherNo}`;
    return () => {
      document.title = previous;
    };
  }, [voucher]);

  if (authLoading || (canView && id && state === 'loading')) {
    return (
      <div className="mx-auto max-w-[210mm] space-y-3 p-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-[70vh] w-full" />
      </div>
    );
  }
  if (!canView) return <BankAccessDenied title="Payment Voucher" backHref="/bank-balance/cheques" backLabel="Back to register" what="payment vouchers" />;
  if (state !== 'ready' || !voucher) {
    return (
      <div className="mx-auto max-w-xl space-y-3 p-8 text-center">
        <p className="text-lg font-semibold">{state === 'error' ? 'Could not load this voucher' : 'Voucher not found'}</p>
        <p className="text-sm text-muted-foreground">
          {state === 'error' ? 'Check your connection and try again.' : 'This payment voucher does not exist or has been removed.'}
        </p>
        <Button asChild variant="outline">
          <Link href="/bank-balance/cheques">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to register
          </Link>
        </Button>
      </div>
    );
  }

  const today = format(new Date(), 'yyyy-MM-dd');
  const config = modeConfig(voucher.mode);
  const dateLabel = config.kind === 'cheque' ? 'Cheque date' : config.kind === 'draft' ? 'DD date' : 'Transfer date';
  const status = displayStatus(voucher, today);
  const closed = voucher.status === 'Cancelled' || voucher.status === 'Bounced';
  const lines = voucher.lines || [];
  const total = Number(voucher.total) || lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0);
  const companyName = company?.branding?.companyName || 'Siddhartha Engineering Limited';

  return (
    <>
      <style>{PRINT_CSS}</style>
      <div className="min-h-screen bg-muted/40 px-3 py-4 sm:px-6 print:min-h-0 print:bg-white print:p-0">
        <div className="mx-auto mb-3 flex max-w-[210mm] flex-wrap items-center justify-between gap-2 print:hidden">
          <Button asChild variant="ghost" size="sm">
            <Link href={voucherHref(voucher.id)}>
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              Back to register
            </Link>
          </Button>
          <Button size="sm" onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
        </div>

        <article className="pv-sheet keep-light mx-auto max-w-[210mm] bg-white p-5 text-[13px] text-slate-900 shadow-sm ring-1 ring-slate-200 sm:p-10 print:max-w-none print:p-0 print:shadow-none print:ring-0">
          <header className="border-b-2 border-slate-800 pb-3 text-center">
            <h1 className="text-lg font-bold uppercase tracking-wide">{companyName}</h1>
            <p className="text-xs text-slate-600">Nayapalli, Bhubaneswar</p>
            <p className="mt-2 text-base font-semibold uppercase tracking-[0.2em]">Payment Voucher</p>
            {closed && (
              <p className="mt-2 inline-block border-2 border-rose-700 px-3 py-0.5 text-xs font-bold uppercase tracking-[0.25em] text-rose-700">
                {voucher.status}
              </p>
            )}
          </header>

          <dl className="mt-4 grid grid-cols-1 gap-x-8 sm:grid-cols-2 print:grid-cols-2">
            <Field label="Voucher No.">
              <span className="font-mono">{voucher.voucherNo}</span>
            </Field>
            <Field label="Issue date">{formatDay(voucher.issueDate)}</Field>
            <Field label="Mode">{voucher.mode}</Field>
            <Field label={config.instrumentLabel}>
              <span className="font-mono">{voucher.instrumentNo || '—'}</span>
            </Field>
            <Field label={dateLabel}>{formatDay(voucher.instrumentDate)}</Field>
            <Field label="Status">
              {status}
              {voucher.status === 'Cleared' && ` on ${formatDay(voucher.clearedDate)}`}
              {closed && voucher.closedAt ? ` on ${formatDay(voucher.closedAt)}` : ''}
            </Field>
            <div className="sm:col-span-2 print:col-span-2">
              <Field label="Bank account">
                {account ? (
                  <>
                    {account.bankName || account.shortName}
                    {account.shortName && account.shortName !== account.bankName ? ` (${account.shortName})` : ''}
                    {account.accountNumber ? ` · A/c No. ${account.accountNumber}` : ''}
                  </>
                ) : (
                  'Unknown account'
                )}
              </Field>
            </div>
          </dl>

          <div className="mt-4 overflow-x-auto print:overflow-visible">
            <table className="w-full min-w-[640px] border-collapse text-[12px] print:min-w-0">
              <thead>
                <tr className="bg-slate-100 text-left">
                  <th className="border border-slate-400 px-2 py-1.5 font-semibold">#</th>
                  <th className="border border-slate-400 px-2 py-1.5 font-semibold">Reception No.</th>
                  <th className="border border-slate-400 px-2 py-1.5 font-semibold">Payee</th>
                  <th className="border border-slate-400 px-2 py-1.5 font-semibold">Project</th>
                  <th className="border border-slate-400 px-2 py-1.5 font-semibold">Description</th>
                  <th className="border border-slate-400 px-2 py-1.5 font-semibold">UTR</th>
                  <th className="border border-slate-400 px-2 py-1.5 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => (
                  <tr key={line.lineId || index} className="align-top">
                    <td className="border border-slate-400 px-2 py-1.5">{index + 1}</td>
                    <td className="whitespace-nowrap border border-slate-400 px-2 py-1.5 font-mono">{line.receptionNo || '—'}</td>
                    <td className="break-words border border-slate-400 px-2 py-1.5 font-medium">{line.partyName || '—'}</td>
                    <td className="break-words border border-slate-400 px-2 py-1.5">{line.projectName || '—'}</td>
                    <td className="break-words border border-slate-400 px-2 py-1.5">{line.description || '—'}</td>
                    <td className="break-all border border-slate-400 px-2 py-1.5 font-mono">{line.utrNumber || '—'}</td>
                    <td className="whitespace-nowrap border border-slate-400 px-2 py-1.5 text-right tabular-nums">{formatInr(line.amount)}</td>
                  </tr>
                ))}
                {lines.length === 0 && (
                  <tr>
                    <td colSpan={7} className="border border-slate-400 px-2 py-3 text-center text-slate-500">
                      No payee lines on this voucher.
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="font-bold">
                  <td colSpan={6} className="border border-slate-400 px-2 py-1.5 text-right">
                    Total
                  </td>
                  <td className="whitespace-nowrap border border-slate-400 px-2 py-1.5 text-right tabular-nums">{formatInr(total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="pv-keep mt-3 space-y-1.5">
            <p>
              <span className="text-slate-500">Amount in words: </span>
              <span className="font-semibold">{rupeesInWords(total)}</span>
            </p>
            <p className="break-words">
              <span className="text-slate-500">Remarks: </span>
              {voucher.remarks || '—'}
            </p>
            {closed && (
              <p className="break-words text-rose-800">
                <span className="text-slate-500">{voucher.status}: </span>
                {formatDay(voucher.closedAt)}
                {voucher.closedByName ? ` by ${voucher.closedByName}` : ''}
                {voucher.closedReason ? ` — ${voucher.closedReason}` : ''}
              </p>
            )}
            {voucher.status === 'Cleared' && voucher.clearedByName && (
              <p>
                <span className="text-slate-500">Cleared: </span>
                {formatDay(voucher.clearedDate)} · recorded by {voucher.clearedByName}
              </p>
            )}
          </div>

          <div className="pv-keep mt-16 grid grid-cols-2 gap-x-6 gap-y-12 sm:grid-cols-4 print:grid-cols-4">
            {[
              { label: 'Prepared by', name: voucher.createdByName || '' },
              { label: 'Checked by', name: '' },
              { label: 'Approved by', name: '' },
              { label: "Receiver's signature", name: '' },
            ].map((box) => (
              <div key={box.label} className="border-t border-slate-800 pt-1">
                <p className="font-medium">{box.label}</p>
                <p className="min-h-[1.25rem] text-xs text-slate-600">{box.name}</p>
              </div>
            ))}
          </div>

          <footer className="mt-10 flex flex-wrap justify-between gap-2 border-t pt-2 text-[10px] text-slate-500">
            <span>Printed by {user?.name || '—'} on {format(new Date(), 'dd MMM yyyy, HH:mm')}</span>
            <span>System-generated from the Bank Balance Cheque Register.</span>
          </footer>
        </article>
      </div>
    </>
  );
}

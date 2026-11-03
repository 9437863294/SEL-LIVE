'use client';

/**
 * The printable RA bill abstract: the letterhead, the bill's facts, one row per billed JMC / MVAC
 * line (certified, billed up to the previous bill, this bill, up to date, amount), the total in
 * words and the signature boxes.
 *
 * "Up to previous bill" is worked out from the project's bills as they stand — earlier RA numbers
 * that are not cancelled (`billedBefore` in src/lib/billing-recon/ra-bill.ts) — so a bill cancelled
 * after this one was made no longer counts.
 *
 * A4 landscape is requested, but the print dialog can override it, so the sheet is sized in
 * percentages with a fixed-layout table that wraps: it fits a portrait page as well.
 */

import { useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Printer } from 'lucide-react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CompanyLetterhead, PrintedOnLine, SignatureBlock } from '@/components/shared/company-letterhead';
import { useBillingReconData } from '@/components/billing-recon/ra-bills/use-billing-recon-data';
import { periodText } from '@/components/billing-recon/ra-bills/ra-bill-ui';
import { billedBefore, lineRef } from '@/lib/billing-recon/ra-bill';
import { formatIsoDate, formatQty, roundQty } from '@/lib/billing-recon/lines';
import { rupeesInWords } from '@/lib/bank-balance-transfer';

const MONEY = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (value: number) => MONEY.format(Number.isFinite(value) ? value : 0);

const PrintStyles = () => (
  <style>{`
    #ra-bill-sheet table.ra-lines { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 8pt; }
    #ra-bill-sheet .ra-lines th, #ra-bill-sheet .ra-lines td { border: 1px solid #000; padding: 2px 4px; vertical-align: top; overflow-wrap: anywhere; }
    #ra-bill-sheet .ra-lines th { font-weight: 700; text-align: center; vertical-align: middle; background: #f1f5f9; }
    #ra-bill-sheet .ra-lines td.num { text-align: right; font-variant-numeric: tabular-nums; }
    #ra-bill-sheet .ra-lines tfoot td { font-weight: 700; }
    @media print {
      @page { size: A4 landscape; margin: 10mm; }
      html, body { background: #fff !important; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .no-print { display: none !important; }
      #ra-bill-sheet { width: 98% !important; max-width: none !important; margin: 0 2% 0 0 !important; padding: 0 !important; border: 0 !important; box-shadow: none !important; }
      #ra-bill-sheet .ra-lines thead { display: table-header-group; }
      #ra-bill-sheet .ra-lines tr { break-inside: avoid; page-break-inside: avoid; }
      #ra-bill-sheet .ra-keep { break-inside: avoid; page-break-inside: avoid; }
    }
  `}</style>
);

export default function PrintRaBillPage() {
  const { project: projectSlug, billId } = useParams() as { project: string; billId: string };
  const { can, isLoading: authLoading } = useAuthorization();
  const canView = can('View', 'Billing Recon.Billing');

  const { project, bills, loading, error } = useBillingReconData(projectSlug, { bills: true }, !authLoading && canView);
  const bill = useMemo(() => bills.find((b) => b.id === billId) ?? null, [bills, billId]);

  const lines = useMemo(() => {
    if (!bill) return [];
    const before = billedBefore(bill, bills);
    const sequenced = Number(bill.raSequence) > 0;
    return (bill.items ?? []).map((item) => {
      const previous = sequenced ? before.get(lineRef(item.source, item.entryId, item.itemIndex)) ?? 0 : Number(item.previouslyBilledQty) || 0;
      const billedQty = Number(item.billedQty) || 0;
      return { item, previous, billedQty, upToDate: roundQty(previous + billedQty) };
    });
  }, [bill, bills]);

  const ready = !authLoading && canView && !loading && Boolean(bill);

  useEffect(() => {
    if (!ready) return;
    const id = window.setTimeout(() => window.print(), 600);
    return () => window.clearTimeout(id);
  }, [ready]);

  if (authLoading || (canView && loading)) {
    return (
      <div className="p-8">
        <Skeleton className="h-[80vh]" />
      </div>
    );
  }

  const message = !canView
    ? 'You do not have permission to view RA bills.'
    : error === 'not-found'
      ? 'Project not found.'
      : error === 'failed'
        ? 'Could not load the bill. Check your connection and reload.'
        : !bill
          ? 'RA bill not found.'
          : null;

  if (message || !bill) {
    return <div className="p-8 text-sm">{message ?? 'RA bill not found.'}</div>;
  }

  const total = Number(bill.totalAmount) || 0;
  const words = rupeesInWords(total);
  const stamp = bill.status === 'Cancelled' ? 'CANCELLED' : bill.status === 'Draft' ? 'DRAFT — NOT SUBMITTED' : undefined;
  const facts: Array<[string, string]> = [
    ['Project', project?.projectDescription || project?.projectName || '—'],
    ['Site', project?.projectSite || '—'],
    ['Order No', project?.woNo || '—'],
    ['RA Bill No', bill.billNo || '—'],
    ['RA No', bill.raSequence ? String(bill.raSequence) : '—'],
    ['Bill Date', formatIsoDate(bill.billDate)],
    ['Period', periodText(bill)],
    ['Bill Tracking ref', bill.billTrackingRef || '—'],
  ];

  return (
    <>
      <PrintStyles />
      <div className="keep-light min-h-screen bg-slate-100 py-6 text-black print:min-h-0 print:bg-white print:py-0">
        <div className="no-print mx-auto mb-4 flex max-w-[297mm] flex-wrap items-center justify-between gap-2 px-4">
          <Button asChild variant="outline" size="sm">
            <Link href={`/billing-recon/${projectSlug}/billing`}>
              <ArrowLeft className="mr-2 h-4 w-4" /> RA bills
            </Link>
          </Button>
          <Button type="button" size="sm" onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" /> Print
          </Button>
        </div>

        <div id="ra-bill-sheet" className="mx-auto max-w-[297mm] bg-white p-6 shadow-sm">
          <CompanyLetterhead
            compact
            title="RA BILL ABSTRACT"
            subtitle={stamp}
            meta={[
              { label: 'Bill No', value: bill.billNo || '—' },
              { label: 'Date', value: formatIsoDate(bill.billDate) },
            ]}
            className="mb-2"
          />

          <div className="ra-keep mb-2 grid grid-cols-1 gap-x-6 gap-y-0.5 border border-black p-2 text-[9pt] sm:grid-cols-2 lg:grid-cols-4 print:grid-cols-4">
            {facts.map(([label, value]) => (
              <div key={label} className="min-w-0">
                <span className="font-semibold">{label}:</span> <span className="break-words">{value}</span>
              </div>
            ))}
          </div>

          <table className="ra-lines">
            <colgroup>
              <col style={{ width: '4%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '6%' }} />
              <col style={{ width: '25%' }} />
              <col style={{ width: '5%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '11%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>Sl.</th>
                <th>JMC / MVAC No</th>
                <th>BOQ Sl No</th>
                <th>Description</th>
                <th>Unit</th>
                <th>Rate</th>
                <th>Certified Qty</th>
                <th>Up to Prev. Bill</th>
                <th>This Bill Qty</th>
                <th>Up to Date Qty</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={11} style={{ textAlign: 'center' }}>
                    This bill has no lines.
                  </td>
                </tr>
              ) : (
                lines.map(({ item, previous, billedQty, upToDate }, index) => (
                  <tr key={`${item.source}-${item.entryId}-${item.itemIndex}-${index}`}>
                    <td style={{ textAlign: 'center' }}>{index + 1}</td>
                    <td>
                      {item.entryNo || '—'}
                      <div style={{ fontSize: '7pt', color: '#475569' }}>{item.source}</div>
                    </td>
                    <td style={{ textAlign: 'center' }}>{item.boqSlNo || '—'}</td>
                    <td>
                      {item.description || '—'}
                      {(item.scope1 || item.scope2) && (
                        <div style={{ fontSize: '7pt', color: '#475569' }}>{[item.scope1, item.scope2].filter(Boolean).join(' / ')}</div>
                      )}
                    </td>
                    <td style={{ textAlign: 'center' }}>{item.unit || '—'}</td>
                    <td className="num">{money(Number(item.rate) || 0)}</td>
                    <td className="num">{formatQty(Number(item.certifiedQty) || 0)}</td>
                    <td className="num">{formatQty(previous)}</td>
                    <td className="num">{formatQty(billedQty)}</td>
                    <td className="num">{formatQty(upToDate)}</td>
                    <td className="num">{money(Number(item.amount) || 0)}</td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={10} style={{ textAlign: 'right' }}>
                  Total (this bill)
                </td>
                <td className="num">{money(total)}</td>
              </tr>
            </tfoot>
          </table>

          <div className="ra-keep mt-2 space-y-1 text-[9pt]">
            {words && (
              <p>
                <span className="font-semibold">Amount in words:</span> {words}
              </p>
            )}
            <p className="text-[8pt] text-slate-600">
              Quantity × rate as certified on the JMC / MVAC entries. GST, retention and other deductions are as per the Bill Tracking bill
              {bill.billTrackingRef ? ` ${bill.billTrackingRef}` : ''}.
            </p>
            {bill.remarks && (
              <p>
                <span className="font-semibold">Remarks:</span> {bill.remarks}
              </p>
            )}
            {bill.status === 'Cancelled' && bill.cancelReason && (
              <p>
                <span className="font-semibold">Cancelled:</span> {bill.cancelReason}
              </p>
            )}
          </div>

          <div className="ra-keep">
            <SignatureBlock className="mt-12 px-4" />
            <PrintedOnLine className="mt-4" />
          </div>
        </div>
      </div>
    </>
  );
}

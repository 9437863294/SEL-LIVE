'use client';

/**
 * "Retention being claimed" on the bill form — retention bills only.
 *
 * Lists the project's bills that still have retention to raise, head by head (held, already raised,
 * received, still to raise), so the retention bill names exactly whose retention it claims. Ticking
 * a head claims what is still to raise; the amount can be lowered for a part claim. Once saved, those
 * bills show their retention as raised, and receipts on this retention bill are credited back to
 * them (`retention.ts`). The server checks every claim against what is still to raise.
 */

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { PiggyBank } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { formatINR, sumMoney, toPaise } from '@/lib/bill-tracking/money';
import type { RetentionHead, RetentionState } from '@/lib/bill-tracking/retention';
import { cn } from '@/lib/utils';

import { useBtQuery } from './bt-client';
import { Amount, BtError, BtLoading, FormSection, RetentionStateBadge, dateText } from './bt-ui';
import { num } from './deduction-editor';

export interface ClaimRow {
  billId: string;
  deductionTypeId: string;
  /** As typed. */
  amount: string;
}

interface Candidate {
  id: string;
  gstInvoiceNumber?: string;
  billSerialNumber?: string;
  billDate: string;
  billTypeName: string;
  state: RetentionState;
  heads: RetentionHead[];
}

const key = (billId: string, deductionTypeId: string) => `${billId}|${deductionTypeId}`;

export function RetentionClaimsSection({
  projectId,
  retentionBillId,
  claims,
  onChange,
  preselectBillId,
  onUseTotal,
}: {
  projectId: string;
  /** The retention bill being edited — its own claims do not count as already raised. */
  retentionBillId?: string;
  claims: ClaimRow[];
  onChange: (claims: ClaimRow[]) => void;
  /** From "Raise retention bill" on a bill: tick everything still to raise on it once loaded. */
  preselectBillId?: string;
  /** Put the claimed total in the bill's taxable amount. */
  onUseTotal: (total: number) => void;
}) {
  const { data, loading, error } = useBtQuery<{ bills: Candidate[] }>(projectId ? `retention/pending?project=${projectId}${retentionBillId ? `&exclude=${retentionBillId}` : ''}` : null);
  const candidates = data?.bills ?? [];

  // "Raise retention bill" from a bill page: claim all of that bill's pending retention, once.
  const preselected = useRef(false);
  useEffect(() => {
    if (preselected.current || !preselectBillId || !data) return;
    preselected.current = true;
    const bill = data.bills.find((entry) => entry.id === preselectBillId);
    if (!bill || claims.length) return;
    onChange(bill.heads.filter((head) => toPaise(head.pendingToRaise) > 0).map((head) => ({ billId: bill.id, deductionTypeId: head.deductionTypeId, amount: String(head.pendingToRaise) })));
  }, [data, preselectBillId, claims.length, onChange]);

  const byKey = new Map(claims.map((claim) => [key(claim.billId, claim.deductionTypeId), claim]));
  const total = sumMoney(claims.map((claim) => num(claim.amount)));
  const toggle = (billId: string, head: RetentionHead, on: boolean) =>
    onChange(on ? [...claims, { billId, deductionTypeId: head.deductionTypeId, amount: String(head.pendingToRaise) }] : claims.filter((claim) => key(claim.billId, claim.deductionTypeId) !== key(billId, head.deductionTypeId)));
  const setAmount = (billId: string, deductionTypeId: string, amount: string) => onChange(claims.map((claim) => (key(claim.billId, claim.deductionTypeId) === key(billId, deductionTypeId) ? { ...claim, amount } : claim)));
  const claimAll = () =>
    onChange(candidates.flatMap((bill) => bill.heads.filter((head) => toPaise(head.pendingToRaise) > 0 || byKey.has(key(bill.id, head.deductionTypeId))).map((head) => byKey.get(key(bill.id, head.deductionTypeId)) ?? { billId: bill.id, deductionTypeId: head.deductionTypeId, amount: String(head.pendingToRaise) })));

  return (
    <FormSection
      icon={PiggyBank}
      title="Retention being claimed"
      description="Choose whose retention this bill claims back. Those bills then show their retention as raised, and receipts on this bill are credited back to them head by head."
      actions={
        candidates.length ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={claimAll}>
              Claim all pending
            </Button>
            {claims.length ? (
              <Button type="button" size="sm" variant="ghost" onClick={() => onChange([])}>
                Clear
              </Button>
            ) : null}
          </div>
        ) : null
      }
      bodyClassName="space-y-3 p-3 sm:p-4"
    >
      {!projectId ? <p className="text-sm text-slate-500">Choose the project first.</p> : null}
      <BtError message={error} />
      {projectId && loading && !data ? <BtLoading className="min-h-[6rem]" label="Finding bills with retention to raise…" /> : null}
      {projectId && data && candidates.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">No bill on this project has retention left to raise.</div>
      ) : null}

      {candidates.length ? (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-2.5 text-left">Bill</th>
                <th className="px-3 py-2.5 text-left">Retention head</th>
                <th className="px-3 py-2.5 text-right">Held</th>
                <th className="px-3 py-2.5 text-right">Raised already</th>
                <th className="px-3 py-2.5 text-right">Still to raise</th>
                <th className="w-44 px-3 py-2.5 text-right">Claim now (₹)</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((bill) => {
                const heads = bill.heads.filter((head) => toPaise(head.held) > 0 || byKey.has(key(bill.id, head.deductionTypeId)));
                return heads.map((head, index) => {
                  const claim = byKey.get(key(bill.id, head.deductionTypeId));
                  const over = claim && toPaise(num(claim.amount)) > toPaise(head.pendingToRaise);
                  const nothingLeft = toPaise(head.pendingToRaise) <= 0 && !claim;
                  return (
                    <tr key={key(bill.id, head.deductionTypeId)} className={cn('border-t border-slate-100', index === 0 && 'border-slate-200', claim && 'bg-emerald-50/60')}>
                      {index === 0 ? (
                        <td rowSpan={heads.length} className="border-r border-slate-100 px-3 py-2 align-top">
                          <Link href={`/bill-tracking/bills/${bill.id}?tab=retention`} target="_blank" className="whitespace-nowrap font-medium text-emerald-700 hover:underline">
                            {bill.gstInvoiceNumber || bill.billSerialNumber || 'Bill'}
                          </Link>
                          <div className="text-[11px] text-slate-500">
                            {dateText(bill.billDate)} · {bill.billTypeName}
                          </div>
                          <div className="mt-1">
                            <RetentionStateBadge state={bill.state} />
                          </div>
                        </td>
                      ) : null}
                      <td className="px-3 py-2">
                        <label className={cn('flex items-center gap-2', nothingLeft && 'text-slate-400')}>
                          <Checkbox checked={Boolean(claim)} disabled={nothingLeft} onCheckedChange={(value) => toggle(bill.id, head, Boolean(value))} aria-label={`Claim ${head.name} of ${bill.gstInvoiceNumber || bill.billSerialNumber}`} />
                          {head.name}
                        </label>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Amount value={head.held} />
                      </td>
                      <td className="px-3 py-2 text-right text-slate-500">{toPaise(head.claimed) || toPaise(head.receivedDirect) ? <Amount value={sumMoney([head.claimed, head.receivedDirect])} /> : '—'}</td>
                      <td className={cn('px-3 py-2 text-right font-medium', toPaise(head.pendingToRaise) > 0 ? 'text-amber-700' : 'text-slate-400')}>
                        <Amount value={head.pendingToRaise} />
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        {claim ? (
                          <Input inputMode="decimal" aria-label={`Amount of ${head.name} claimed`} className={cn('h-9 text-right tabular-nums', over && 'border-rose-400 bg-rose-50')} value={claim.amount} onChange={(event) => setAmount(bill.id, head.deductionTypeId, event.target.value)} />
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                        {over ? <div className="mt-0.5 text-[11px] text-rose-700">More than the {formatINR(head.pendingToRaise)} still to raise</div> : null}
                      </td>
                    </tr>
                  );
                });
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold text-slate-900">
                <td colSpan={5} className="px-3 py-2.5 text-right">
                  Total claimed · {claims.length} head{claims.length === 1 ? '' : 's'}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <Amount value={total} />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : null}

      {claims.length ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <span>The retention claimed adds up to {formatINR(total)}.</span>
          <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => onUseTotal(total)}>
            Use {formatINR(total)} as the taxable amount
          </Button>
        </div>
      ) : null}
    </FormSection>
  );
}

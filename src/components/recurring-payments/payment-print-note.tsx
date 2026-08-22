"use client";

import {
  currency,
  maskAccount,
  type PaymentObligation,
  type PaymentTransaction,
} from "@/lib/recurring-payments";

/**
 * The printable payment note.
 *
 * `window.print()` on the detail page used to render the page as it appears on screen: the module
 * sidebar, a dark gradient header that swallowed a colour cartridge and turned white text
 * invisible, eight tabs of which only the open one printed, and interactive controls that mean
 * nothing on paper. This is a purpose-built document instead — sender, vendor, billing period,
 * amount breakdown, approval trail and sign-off — rendered only for print (`hidden print:block`)
 * while `@media print` in globals.css suppresses the live UI around it.
 *
 * Everything here comes from the obligation itself, so the note is a faithful record of what was
 * approved and paid rather than a screenshot of a UI state.
 */

const line = (label: string, value: string) => ({ label, value });

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="break-inside-avoid">
      <p className="text-[9pt] uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="text-[10.5pt] font-medium text-black">{value || "—"}</p>
    </div>
  );
}

function AmountRow({
  label,
  value,
  strong,
  negative,
}: {
  label: string;
  value: number;
  strong?: boolean;
  negative?: boolean;
}) {
  return (
    <tr className={strong ? "border-t-2 border-black font-bold" : "border-t border-neutral-300"}>
      <td className="py-1.5 pr-3 text-[10.5pt]">{label}</td>
      <td className="py-1.5 text-right text-[10.5pt] tabular-nums">
        {negative && value ? `(${currency(value)})` : currency(value)}
      </td>
    </tr>
  );
}

export default function PaymentPrintNote({
  payment,
  organizationName,
  ownerName,
  approverNames,
  transactions,
}: {
  payment: PaymentObligation;
  organizationName: string;
  ownerName: string;
  approverNames: string[];
  transactions: PaymentTransaction[];
}) {
  const gross = Number(payment.billAmount || payment.expectedAmount || 0);
  const net = Number(payment.netPayableAmount || gross);
  const paid = Number(payment.settledAmount || payment.paidAmount || 0);
  const outstanding = Math.max(0, net - paid);
  const identity = [
    line("Payment reference", payment.id),
    line("Bill number", payment.billNumber || "Not received"),
    line("Bill date", payment.billDate || payment.billReceivedDate || "—"),
    line("Billing period", `${payment.billingPeriodStart} to ${payment.billingPeriodEnd}`),
    line("Due date", payment.dueDate),
    line("Status", payment.status),
  ];
  const parties = [
    line("Vendor", payment.vendorName),
    line("Account reference", maskAccount(payment.accountNumber) || "—"),
    line("Category", payment.category),
    line("Project / branch", payment.projectName || payment.branchName || "Organization-wide"),
    line("Department", payment.department || "—"),
    line("Cost centre / ledger", payment.costCentre || payment.ledger || "—"),
  ];

  return (
    // Hidden on screen; `@media print` reveals it and hides the application chrome.
    <section className="hidden bg-white text-black print:block">
      <header className="mb-4 border-b-2 border-black pb-3">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h1 className="text-[17pt] font-bold leading-tight">{organizationName}</h1>
            <p className="mt-0.5 text-[11pt] font-semibold uppercase tracking-wide">
              Payment Note
            </p>
          </div>
          <div className="text-right text-[9.5pt] leading-snug">
            <p>
              <span className="text-neutral-500">Printed </span>
              {new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
            </p>
            <p className="text-neutral-500">Recurring Payments</p>
          </div>
        </div>
        <p className="mt-2 text-[12pt] font-semibold">{payment.title}</p>
      </header>

      <div className="mb-4 grid grid-cols-3 gap-x-6 gap-y-3">
        {identity.map((item) => (
          <Field key={item.label} {...item} />
        ))}
      </div>

      <h2 className="mb-2 border-b border-neutral-400 pb-1 text-[10pt] font-bold uppercase tracking-wide">
        Vendor and allocation
      </h2>
      <div className="mb-4 grid grid-cols-3 gap-x-6 gap-y-3">
        {parties.map((item) => (
          <Field key={item.label} {...item} />
        ))}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-6">
        <div className="break-inside-avoid">
          <h2 className="mb-2 border-b border-neutral-400 pb-1 text-[10pt] font-bold uppercase tracking-wide">
            Amount breakdown
          </h2>
          <table className="w-full">
            <tbody>
              <AmountRow label="Expected amount" value={Number(payment.expectedAmount || 0)} />
              <AmountRow label="Bill amount" value={gross} />
              <AmountRow label="Tax" value={Number(payment.taxAmount || 0)} />
              <AmountRow label="TDS deducted" value={Number(payment.tdsAmount || 0)} negative />
              <AmountRow
                label="Other deductions"
                value={Number(payment.deductionAmount || 0)}
                negative
              />
              <AmountRow label="Adjustment" value={Number(payment.adjustmentAmount || 0)} />
              <AmountRow label="Net payable" value={net} strong />
              <AmountRow label="Paid to date" value={paid} />
              <AmountRow label="Outstanding" value={outstanding} strong />
            </tbody>
          </table>
        </div>

        <div className="break-inside-avoid">
          <h2 className="mb-2 border-b border-neutral-400 pb-1 text-[10pt] font-bold uppercase tracking-wide">
            Approval trail
          </h2>
          {approverNames.length ? (
            <ol className="ml-4 list-decimal space-y-1 text-[10.5pt]">
              {approverNames.map((name, index) => (
                <li key={`${name}-${index}`}>{name}</li>
              ))}
            </ol>
          ) : (
            <p className="text-[10.5pt] text-neutral-600">
              Approval handled by the configured workflow.
            </p>
          )}
          <div className="mt-3 space-y-1 text-[10.5pt]">
            <p>
              <span className="text-neutral-500">Payment owner: </span>
              {ownerName}
            </p>
            <p>
              <span className="text-neutral-500">Current stage: </span>
              {payment.stage || "—"}
            </p>
          </div>
        </div>
      </div>

      {transactions.length > 0 && (
        <div className="mb-4 break-inside-avoid">
          <h2 className="mb-2 border-b border-neutral-400 pb-1 text-[10pt] font-bold uppercase tracking-wide">
            Recorded transactions
          </h2>
          <table className="w-full">
            <thead>
              <tr className="border-b border-neutral-400 text-left text-[9pt] uppercase text-neutral-500">
                <th className="py-1 pr-3 font-semibold">Date</th>
                <th className="py-1 pr-3 font-semibold">Mode</th>
                <th className="py-1 pr-3 font-semibold">Reference</th>
                <th className="py-1 pr-3 font-semibold">Bank</th>
                <th className="py-1 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((item) => (
                <tr key={item.id} className="border-b border-neutral-200 text-[10pt]">
                  <td className="py-1 pr-3">{item.paymentDate}</td>
                  <td className="py-1 pr-3">{item.mode}</td>
                  <td className="py-1 pr-3">
                    {item.transactionReference || item.chequeNumber || "—"}
                  </td>
                  <td className="py-1 pr-3">{item.bankAccount || "—"}</td>
                  <td className="py-1 text-right tabular-nums">{currency(item.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {payment.description && (
        <div className="mb-4 break-inside-avoid">
          <h2 className="mb-1 border-b border-neutral-400 pb-1 text-[10pt] font-bold uppercase tracking-wide">
            Remarks
          </h2>
          <p className="text-[10.5pt]">{payment.description}</p>
        </div>
      )}

      {/* Three columns of ruled space, so the note works as the physical sign-off sheet it
          replaces rather than needing one stapled to it. */}
      <div className="mt-10 grid grid-cols-3 gap-8 break-inside-avoid">
        {["Prepared by", "Verified by", "Authorised by"].map((role) => (
          <div key={role}>
            <div className="h-10 border-b border-black" />
            <p className="mt-1 text-[9.5pt] font-medium">{role}</p>
            <p className="text-[8.5pt] text-neutral-500">Name, signature &amp; date</p>
          </div>
        ))}
      </div>

      <p className="mt-6 border-t border-neutral-300 pt-2 text-[8.5pt] text-neutral-500">
        System-generated from {organizationName} · Recurring Payments · reference {payment.id}. This
        note reflects the record at the time of printing.
      </p>
    </section>
  );
}

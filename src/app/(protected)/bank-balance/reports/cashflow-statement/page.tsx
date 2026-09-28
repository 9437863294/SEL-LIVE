import { redirect } from 'next/navigation';

/** Merged into the Transaction Summary: its grand-total rows are the cashflow statement. */
export default function Page() {
  redirect('/bank-balance/reports/transaction-summary');
}

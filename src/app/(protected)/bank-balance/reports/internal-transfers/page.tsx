import { redirect } from 'next/navigation';

// The transfer report duplicated the Transfers page; its account filter, description column and
// totals now live there.
export default function Page() {
  redirect('/bank-balance/internal-transaction');
}

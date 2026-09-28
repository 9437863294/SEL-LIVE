import { redirect } from 'next/navigation';

/** Merged into the Daily Log: pick one account in its "By account" view for this report. */
export default function Page() {
  redirect('/bank-balance/daily-log');
}

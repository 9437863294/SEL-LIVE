import { btRoute } from '@/lib/bill-tracking/server/context';
import { invoicesForNote } from '@/lib/bill-tracking/server/queries';

/** Invoices of a project a credit / debit note can be raised against. */
export const GET = btRoute('bills.invoices', async ({ context, url }) => ({ bills: await invoicesForNote(context, url.searchParams) }));

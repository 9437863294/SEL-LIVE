import { redirect } from 'next/navigation';

/**
 * Opening utilisation used to be a second editor for the same two fields the Bank Accounts dialog
 * edits (the opening figure and its date), under a different permission. Bank Accounts is now the
 * only place they are set; this address, still in bookmarks, opens it.
 */
export default function OpeningUtilizationPage() {
  redirect('/bank-balance/accounts');
}

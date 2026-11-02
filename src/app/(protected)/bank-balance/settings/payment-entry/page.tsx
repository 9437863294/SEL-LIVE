import { redirect } from 'next/navigation';

/**
 * Payment Entry Settings no longer has a page of its own. Its mandatory-field switches moved to
 * Field Control's Fields tab, and what was left — payments without a requisition, and the payment
 * methods — is Field Control's Payment options tab. This address redirects there, so bookmarks and
 * old links still land in the right place.
 */
export default function PaymentEntrySettingsPage() {
  redirect('/bank-balance/settings/field-control?tab=payment');
}

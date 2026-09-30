import { redirect } from 'next/navigation';

/**
 * The combined Table & Field Configuration page was split into Field Control (form fields and
 * register columns) and Data Control (the module's data rules). Old links and bookmarks land on
 * Field Control, which holds what this page was mostly used for.
 */
export default function ExpensesTableAndFieldsRedirect(): never {
  redirect('/expenses/settings/field-control');
}

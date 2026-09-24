import { redirect } from 'next/navigation';

export default function MailSettingsIndex() {
  redirect('/mail/settings/accounts');
}

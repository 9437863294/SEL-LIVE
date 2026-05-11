import { redirect } from 'next/navigation';

export default function LegacyLcModuleRedirectPage() {
  redirect('/lc-management');
}


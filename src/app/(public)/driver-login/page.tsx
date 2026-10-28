import { redirect } from 'next/navigation';

/**
 * The separate "Driver App Login" was retired: the app and phones sign in on the main /login
 * (ClientSessionHandler sends them there). Installed apps, bookmarks and history that still open
 * /driver-login land on it, keeping `redirect` and `app=driver` so they return where they were.
 */
export default async function DriverLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
  }
  const search = query.toString();
  redirect(search ? `/login?${search}` : '/login');
}

import { AccessDeniedError } from '@/lib/access-control-server';
import { mailRoute } from '@/lib/mail-hub/route';
import { db } from '@/lib/mail-hub/store';

/** A user picker for adding shared-mailbox members (administrators) — names and emails only. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = mailRoute('users.search', async ({ context, url }) => {
  if (!context.caps.canAdministerConnections) throw new AccessDeniedError('Mail Hub › Settings › Administer is required.');
  const needle = (url.searchParams.get('q') ?? '').trim().toLowerCase();
  const snapshot = await db().collection('users').where('status', '==', 'Active').limit(1000).get();
  return {
    users: snapshot.docs
      .map((doc) => ({ id: doc.id, name: String(doc.get('name') ?? ''), email: String(doc.get('email') ?? '') }))
      .filter((user) => !needle || `${user.name} ${user.email}`.toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 25),
  };
});

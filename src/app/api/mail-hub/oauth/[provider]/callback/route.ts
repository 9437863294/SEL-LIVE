import { NextResponse } from 'next/server';

import { completeOAuthConnection } from '@/lib/mail-hub/accounts-service';
import { consumeOAuthState } from '@/lib/mail-hub/oauth';
import { safeMailReturnTo } from '@/lib/mail-hub/rules';
import { MailHubError } from '@/lib/mail-hub/server';
import { verifyMemberGrant } from '@/lib/mail-hub/workflow-service';
import { runSyncNow } from '@/lib/mail-hub/worker';

/**
 * Where Google and Microsoft send the browser after consent.
 *
 * There is no bearer token on a provider redirect, so identity comes from the **state**: an HMAC-
 * signed nonce naming a server-side record created for an authenticated user by `/authorize`,
 * consumed exactly once here (a replayed callback finds no record). The record also holds the PKCE
 * verifier, so an intercepted authorization code is useless without it. What the user may *do* is
 * re-decided from their current permissions in `completeOAuthConnection`.
 *
 * The outcome goes back as query parameters on a local `/mail` path — `safeMailReturnTo` refuses
 * anything else, because an open redirect on an OAuth callback is a link people trust.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const FALLBACK = '/mail/settings/accounts';

function back(request: Request, path: string, query: Record<string, string | null | undefined>) {
  const target = new URL(safeMailReturnTo(path, FALLBACK), new URL(request.url).origin);
  for (const [key, value] of Object.entries(query)) if (value) target.searchParams.set(key, value.slice(0, 400));
  return NextResponse.redirect(target, { status: 303 });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  let record;
  try {
    record = await consumeOAuthState(params.get('state'));
  } catch (error) {
    console.error('[mail-hub] OAuth state check failed', error);
    return back(request, FALLBACK, { connect: 'failed', message: 'Mail Hub is not configured to complete sign-ins on this server.' });
  }
  if (!record) return back(request, FALLBACK, { connect: 'invalid', message: 'The sign-in request expired or was already used. Start again.' });

  const denied = params.get('error');
  if (denied) {
    return back(request, record.returnTo, {
      connect: 'denied',
      message: denied === 'access_denied' ? 'Access was not granted, so the mailbox was not connected.' : 'The provider did not complete the connection.',
    });
  }
  const code = params.get('code');
  if (!code) return back(request, record.returnTo, { connect: 'denied', message: 'The provider did not return an authorization code.' });

  try {
    const { account, message } = await completeOAuthConnection(record, code);
    if (record.purpose === 'member-verify' && record.sharedMailboxId) {
      await verifyMemberGrant({ userId: record.userId, userName: 'You', isAdmin: false }, record.sharedMailboxId, record.userId, account.id).catch((error) => console.error('[mail-hub] member verify', error));
    }
    await runSyncNow(account.id).catch((error) => console.error('[mail-hub] first sync', error));
    return back(request, record.returnTo, { connect: 'connected', account: account.emailAddress, message });
  } catch (error) {
    const message = error instanceof MailHubError || (error instanceof Error && error.name.startsWith('Provider')) || (error instanceof Error && error.name === 'AccessDeniedError')
      ? error.message + ((error as { detail?: string | null }).detail ? ` (${(error as { detail?: string | null }).detail})` : '')
      : 'The mailbox could not be connected.';
    if (!(error instanceof MailHubError)) console.error('[mail-hub] OAuth completion failed', error);
    return back(request, record.returnTo, { connect: 'failed', message });
  }
}

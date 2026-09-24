import { AccessDeniedError } from '@/lib/access-control-server';
import { oauthConfig } from '@/lib/mail-hub/config';
import { adminSettings, MailHubError, requireMailbox } from '@/lib/mail-hub/server';
import { beginOAuth } from '@/lib/mail-hub/oauth';
import type { OAuthProvider, OAuthPurpose } from '@/lib/mail-hub/oauth-shared';
import { mailRoute } from '@/lib/mail-hub/route';
import { isValidEmail } from '@/lib/mail-hub/rules';
import { secretStoreProblems } from '@/lib/mail-hub/secrets';

/**
 * Start a Google or Microsoft consent flow (`GET /api/mail-hub/oauth/{gmail|microsoft}/authorize`).
 *
 * Returns the consent URL as JSON rather than redirecting: the request carries a bearer token,
 * which a top-level navigation cannot, and a configuration problem can be shown in place.
 *
 * `purpose`:
 *   - `personal`      connect your own mailbox (Accounts › Connect)
 *   - `reconnect`     renew the grant of an account you manage (`accountId`)
 *   - `shared`        connect a shared mailbox for syncing (Settings › Administer, `address`)
 *   - `member-verify` connect/refresh your own account with the delegated scopes a shared
 *                     mailbox membership needs, then verify it (`sharedMailboxId`)
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PURPOSES: OAuthPurpose[] = ['personal', 'reconnect', 'shared', 'member-verify'];

export const GET = mailRoute<{ provider: string }>('oauth.authorize', async ({ context, params, url }) => {
  const provider = params.provider as OAuthProvider;
  if (provider !== 'gmail' && provider !== 'microsoft') throw new MailHubError('Unknown provider.', 404);
  const problems = [...secretStoreProblems(), ...(oauthConfig(provider) ? [] : [`${provider === 'gmail' ? 'Google' : 'Microsoft'} OAuth client is not configured.`])];
  if (problems.length) {
    throw new MailHubError('This provider is not available on this server yet.', 503, context.caps.canAdministerConnections ? problems.join(' ') : null);
  }
  if (!(await adminSettings()).enabledProviders.includes(provider)) throw new MailHubError('This provider has been disabled by your administrator.', 403);

  const purpose = (url.searchParams.get('purpose') ?? 'personal') as OAuthPurpose;
  if (!PURPOSES.includes(purpose)) throw new MailHubError('Unknown purpose.', 400);
  const accountId = url.searchParams.get('accountId');
  const address = url.searchParams.get('address')?.trim().toLowerCase() ?? null;
  let previouslyGranted: string[] = [];
  let loginHint = context.userEmail;

  if (purpose === 'personal' || purpose === 'member-verify') {
    if (!context.caps.canConnectAccount) throw new AccessDeniedError('Connecting a mailbox requires Mail Hub › Accounts › Connect.');
  } else if (purpose === 'reconnect') {
    const resolved = await requireMailbox(context, accountId ?? '', 'manage');
    previouslyGranted = resolved.account.grantedScopes;
    loginHint = resolved.account.loginIdentity ?? resolved.account.emailAddress;
  } else if (purpose === 'shared') {
    if (!context.caps.canAdministerConnections) throw new AccessDeniedError('Connecting a shared mailbox requires Mail Hub › Settings › Administer.');
    if (!address || !isValidEmail(address)) throw new MailHubError('Enter the shared mailbox address.', 400);
    loginHint = provider === 'gmail' ? address : context.userEmail;
  }

  const authorizeUrl = await beginOAuth({
    userId: context.userId,
    provider,
    purpose,
    accountId,
    sharedMailboxId: url.searchParams.get('sharedMailboxId'),
    targetAddress: address,
    loginHint,
    returnTo: url.searchParams.get('returnTo'),
    previouslyGranted,
  });
  return { authorizeUrl };
});

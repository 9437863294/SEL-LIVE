import 'server-only';

/**
 * Mail Hub — OAuth on the server: state records, the code exchange, access-token refresh, and
 * revocation. See `oauth-shared.ts` for the pure half and the scope rationale.
 *
 * Access tokens are never stored. They live in this process's memory for their lifetime (minus a
 * minute) and are re-minted from the sealed refresh token when needed, so the credentials
 * collection holds exactly one long-lived secret per account.
 *
 * Microsoft rotates refresh tokens: a refresh can return a new one, and the old one eventually
 * stops working. When that happens the new token is sealed and stored before the access token is
 * handed out — losing it would silently break the connection a few weeks later.
 */

import { getFirebaseAdminFirestore } from '../firebase-admin';
import { oauthConfig, stateSecret, type OAuthClientConfig } from './config';
import { MAIL_HUB_COLLECTIONS } from './model';
import {
  GOOGLE_REVOKE_ENDPOINT,
  GOOGLE_TOKEN_ENDPOINT,
  OAUTH_STATE_TTL_MS,
  buildAuthorizeUrl,
  createPkcePair,
  decodeIdTokenClaims,
  isRevokedGrantError,
  microsoftTokenEndpoint,
  newNonce,
  scopesFor,
  signState,
  verifyStateSignature,
  type OAuthProvider,
  type OAuthPurpose,
} from './oauth-shared';
import { ProviderAuthError, ProviderRateLimitError, ProviderUnavailableError } from './providers/types';
import { readCredential, storeCredential } from './secrets';
import { safeMailReturnTo } from './rules';

export class OAuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthConfigError';
  }
}

function requireConfig(provider: OAuthProvider): OAuthClientConfig {
  const config = oauthConfig(provider);
  if (!config) throw new OAuthConfigError(`${provider === 'gmail' ? 'Google' : 'Microsoft'} sign-in is not configured on this server.`);
  return config;
}

export interface OAuthStateRecord {
  userId: string;
  provider: OAuthProvider;
  purpose: OAuthPurpose;
  /** Reconnect: the account being re-authorised. Member verification: the shared mailbox. */
  accountId: string | null;
  sharedMailboxId: string | null;
  /** Connecting a shared mailbox: the mailbox address the login is expected to reach. */
  targetAddress: string | null;
  codeVerifier: string;
  scopes: string[];
  returnTo: string;
  expiresAt: number;
}

export async function beginOAuth(input: {
  userId: string;
  provider: OAuthProvider;
  purpose: OAuthPurpose;
  accountId?: string | null;
  sharedMailboxId?: string | null;
  targetAddress?: string | null;
  loginHint?: string | null;
  returnTo?: string | null;
  previouslyGranted?: string[];
}): Promise<string> {
  const config = requireConfig(input.provider);
  const nonce = newNonce();
  const pkce = createPkcePair();
  const scopes = scopesFor(input.provider, input.purpose, input.previouslyGranted ?? []);
  const record: OAuthStateRecord = {
    userId: input.userId,
    provider: input.provider,
    purpose: input.purpose,
    accountId: input.accountId ?? null,
    sharedMailboxId: input.sharedMailboxId ?? null,
    targetAddress: input.targetAddress?.trim().toLowerCase() || null,
    codeVerifier: pkce.verifier,
    scopes,
    returnTo: safeMailReturnTo(input.returnTo),
    expiresAt: Date.now() + OAUTH_STATE_TTL_MS,
  };
  await getFirebaseAdminFirestore().collection(MAIL_HUB_COLLECTIONS.oauthStates).doc(nonce).set(record);
  return buildAuthorizeUrl({
    provider: input.provider,
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    tenant: config.tenant,
    scopes,
    state: signState(nonce, stateSecret()),
    codeChallenge: pkce.challenge,
    loginHint: input.loginHint ?? null,
  });
}

/** Verify and consume a state. Single use: the record is deleted inside the same transaction. */
export async function consumeOAuthState(state: string | null): Promise<OAuthStateRecord | null> {
  const nonce = verifyStateSignature(state, stateSecret());
  if (!nonce) return null;
  const db = getFirebaseAdminFirestore();
  const ref = db.collection(MAIL_HUB_COLLECTIONS.oauthStates).doc(nonce);
  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return null;
    tx.delete(ref);
    const record = snapshot.data() as OAuthStateRecord;
    return record.expiresAt >= Date.now() ? record : null;
  });
}

export interface TokenExchangeResult {
  refreshToken: string;
  accessToken: string;
  expiresIn: number;
  grantedScopes: string[];
  email: string | null;
  name: string | null;
  subject: string | null;
  tenant: string | null;
}

async function tokenRequest(provider: OAuthProvider, config: OAuthClientConfig, body: Record<string, string>) {
  const endpoint = provider === 'gmail' ? GOOGLE_TOKEN_ENDPOINT : microsoftTokenEndpoint(config.tenant);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...body }),
    });
  } catch (error) {
    throw new ProviderUnavailableError('The sign-in service could not be reached.', String(error));
  }
  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  return { response, json };
}

export async function exchangeCode(record: OAuthStateRecord, code: string): Promise<TokenExchangeResult> {
  const config = requireConfig(record.provider);
  const { response, json } = await tokenRequest(record.provider, config, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    code_verifier: record.codeVerifier,
    ...(record.provider === 'microsoft' ? { scope: record.scopes.join(' ') } : {}),
  });
  if (!response.ok || !json) {
    const description = (json?.error_description as string | undefined) ?? (json?.error as string | undefined) ?? `HTTP ${response.status}`;
    console.error('[mail-hub] token exchange failed', record.provider, response.status, json?.error);
    throw new ProviderAuthError('The provider did not complete the sign-in.', description.split('\n')[0]);
  }
  const refreshToken = json.refresh_token as string | undefined;
  if (!refreshToken) {
    throw new ProviderAuthError(
      'The provider did not return a long-lived grant, so the connection would stop working within the hour. ' +
        'Remove the ERP from your account’s connected apps and connect again.',
    );
  }
  const claims = decodeIdTokenClaims(json.id_token as string | undefined);
  return {
    refreshToken,
    accessToken: String(json.access_token ?? ''),
    expiresIn: Number(json.expires_in ?? 3600),
    grantedScopes: String(json.scope ?? '').split(/\s+/).filter(Boolean),
    email: ((claims.email ?? claims.preferred_username) as string | undefined)?.toLowerCase() ?? null,
    name: (claims.name as string | undefined) ?? null,
    subject: ((claims.oid ?? claims.sub) as string | undefined) ?? null,
    tenant: (claims.tid as string | undefined) ?? null,
  };
}

/* ── access tokens ────────────────────────────────────────────────────────────────────────── */

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export function forgetAccessToken(accountId: string) {
  tokenCache.delete(accountId);
}

/**
 * A usable access token for an OAuth account. Throws `ProviderAuthError` when the grant is gone,
 * which the sync engine turns into "reconnect", and `ProviderUnavailableError` for anything
 * transient.
 */
export async function accessTokenFor(account: { id: string; ownerUserId: string; provider: string }): Promise<string> {
  const cached = tokenCache.get(account.id);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const provider = account.provider as OAuthProvider;
  const credential = await readCredential(account.id);
  if (!credential || credential.type !== 'oauth') throw new ProviderAuthError('No stored authorization for this mailbox.');
  const config = requireConfig(provider);

  const { response, json } = await tokenRequest(provider, config, {
    grant_type: 'refresh_token',
    refresh_token: credential.refreshToken,
    ...(provider === 'microsoft' ? { scope: credential.scopes.join(' ') } : {}),
  });
  if (!response.ok || !json) {
    if (response.status === 429) throw new ProviderRateLimitError(Number(response.headers.get('retry-after') ?? 60) * 1000);
    if (isRevokedGrantError(json)) {
      tokenCache.delete(account.id);
      throw new ProviderAuthError(
        'Access to this mailbox was revoked or has expired.',
        (json?.error_description as string | undefined)?.split('\n')[0] ?? null,
      );
    }
    throw new ProviderUnavailableError(`The sign-in service answered HTTP ${response.status}.`);
  }

  const rotated = json.refresh_token as string | undefined;
  if (rotated && rotated !== credential.refreshToken) {
    await storeCredential({
      accountId: account.id,
      ownerUserId: account.ownerUserId,
      provider: provider,
      payload: { ...credential, refreshToken: rotated },
    });
  }
  const token = String(json.access_token ?? '');
  tokenCache.set(account.id, { token, expiresAt: Date.now() + Number(json.expires_in ?? 3600) * 1000 });
  return token;
}

/**
 * Revoke at the provider. Google has a revocation endpoint; Microsoft does not offer one for a
 * single app's delegated grant short of revoking every session the user has, which would sign them
 * out of Outlook everywhere — so for Microsoft the ERP deletes its tokens and subscriptions and
 * the UI tells the user where to remove the app's consent (myapps.microsoft.com).
 */
export async function revokeOAuthGrant(accountId: string, provider: OAuthProvider): Promise<boolean> {
  tokenCache.delete(accountId);
  if (provider !== 'gmail') return false;
  const credential = await readCredential(accountId).catch(() => null);
  if (!credential || credential.type !== 'oauth') return false;
  try {
    const response = await fetch(`${GOOGLE_REVOKE_ENDPOINT}?token=${encodeURIComponent(credential.refreshToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    // 400 invalid_token means it was already revoked — the outcome the user asked for.
    return response.ok || response.status === 400;
  } catch {
    return false;
  }
}

export async function purgeExpiredOAuthStates(): Promise<number> {
  const db = getFirebaseAdminFirestore();
  const stale = await db.collection(MAIL_HUB_COLLECTIONS.oauthStates).where('expiresAt', '<', Date.now()).limit(200).get();
  const batch = db.batch();
  stale.docs.forEach((entry) => batch.delete(entry.ref));
  if (!stale.empty) await batch.commit();
  return stale.size;
}


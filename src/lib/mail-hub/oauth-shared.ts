/**
 * Mail Hub — the pure half of the OAuth flows (Google and Microsoft).
 *
 * Scope lists, authorization URLs, PKCE, and the signed state. Everything that touches a secret
 * at runtime lives in `oauth.ts`; this file only shapes requests, so it is tested directly.
 *
 * ── Least privilege ────────────────────────────────────────────────────────────────────────────
 *
 * Google: `gmail.modify` — read, send, label, trash. Not `https://mail.google.com/`, which adds
 * permanent deletion and IMAP/SMTP access the ERP does not need. (Consequently "Delete forever"
 * is not offered for Gmail accounts; `capabilities.permanentDelete` is false.)
 *
 * Microsoft: `Mail.ReadWrite` + `Mail.Send` for your own mailbox. The `.Shared` variants — which
 * reach mailboxes the user has been delegated — are requested **only** when the user connects a
 * shared mailbox or verifies membership of one, so an ordinary personal connection never asks for
 * access to anybody else's mail. `offline_access` is what returns a refresh token.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type OAuthProvider = 'gmail' | 'microsoft';
export type OAuthPurpose = 'personal' | 'shared' | 'reconnect' | 'member-verify';

export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

export const GMAIL_SCOPES = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/gmail.modify'];

export const MICROSOFT_BASE_SCOPES = ['offline_access', 'openid', 'email', 'profile', 'User.Read', 'Mail.ReadWrite', 'Mail.Send'];
export const MICROSOFT_SHARED_SCOPES = ['Mail.ReadWrite.Shared', 'Mail.Send.Shared'];

export const microsoftAuthEndpoint = (tenant: string) => `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize`;
export const microsoftTokenEndpoint = (tenant: string) => `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`;

export function scopesFor(provider: OAuthProvider, purpose: OAuthPurpose, previouslyGranted: string[] = []): string[] {
  if (provider === 'gmail') return GMAIL_SCOPES;
  const wantsShared =
    purpose === 'shared' ||
    purpose === 'member-verify' ||
    // Reconnecting must not silently drop a shared grant the account already relies on.
    (purpose === 'reconnect' && previouslyGranted.some((scope) => /\.Shared$/i.test(scope)));
  return wantsShared ? [...MICROSOFT_BASE_SCOPES, ...MICROSOFT_SHARED_SCOPES] : MICROSOFT_BASE_SCOPES;
}

/** Does the token response's granted scope cover what the ERP needs? Users can untick boxes. */
export function missingScopes(provider: OAuthProvider, required: string[], granted: string[]): string[] {
  const have = new Set(granted.map((scope) => scope.toLowerCase().replace(/^https:\/\/graph\.microsoft\.com\//, '')));
  return required.filter((scope) => {
    const key = scope.toLowerCase();
    if (['openid', 'email', 'profile', 'offline_access'].includes(key)) return false;
    return !have.has(key);
  });
}

/* ── PKCE ─────────────────────────────────────────────────────────────────────────────────── */

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString('base64url');
  return { verifier, challenge: pkceChallenge(verifier) };
}

export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/* ── signed state ─────────────────────────────────────────────────────────────────────────── */

export const OAUTH_STATE_TTL_MS = 10 * 60_000;

/**
 * The state parameter is `<nonce>.<hmac>`. The nonce names a server-side record holding the user,
 * the PKCE verifier and the purpose, which the callback consumes exactly once — so a state cannot
 * be replayed even inside its lifetime, and nothing about the user travels through the browser.
 * The HMAC lets the callback reject a forged state without a database read.
 */
export function signState(nonce: string, secret: string): string {
  return `${nonce}.${createHmac('sha256', secret).update(`mail-hub-oauth:${nonce}`).digest('base64url')}`;
}

export function verifyStateSignature(state: string | null | undefined, secret: string): string | null {
  const value = (state ?? '').trim();
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return null;
  const nonce = value.slice(0, dot);
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) return null;
  const expected = Buffer.from(signState(nonce, secret));
  const provided = Buffer.from(value);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;
  return nonce;
}

export function newNonce(): string {
  return randomBytes(24).toString('base64url');
}

/* ── URLs ─────────────────────────────────────────────────────────────────────────────────── */

export function buildAuthorizeUrl(input: {
  provider: OAuthProvider;
  clientId: string;
  redirectUri: string;
  tenant?: string;
  scopes: string[];
  state: string;
  codeChallenge: string;
  loginHint?: string | null;
}): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: 'code',
    scope: input.scopes.join(' '),
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: 'S256',
  });
  if (input.loginHint) params.set('login_hint', input.loginHint);
  if (input.provider === 'gmail') {
    // `offline` + `consent` is what reliably returns a refresh token on a repeat connection.
    params.set('access_type', 'offline');
    params.set('prompt', 'consent');
    params.set('include_granted_scopes', 'false');
    return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
  }
  params.set('response_mode', 'query');
  params.set('prompt', 'select_account');
  return `${microsoftAuthEndpoint(input.tenant || 'organizations')}?${params.toString()}`;
}

/** Read the claims of an id_token received directly from the token endpoint over TLS. */
export function decodeIdTokenClaims(idToken: string | null | undefined): Record<string, unknown> {
  const payload = (idToken ?? '').split('.')[1];
  if (!payload) return {};
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** `invalid_grant` means the grant is gone for good — revoked, expired, password changed. */
export function isRevokedGrantError(body: unknown): boolean {
  const error = (body as { error?: string } | null)?.error;
  return error === 'invalid_grant' || error === 'interaction_required' || error === 'consent_required';
}

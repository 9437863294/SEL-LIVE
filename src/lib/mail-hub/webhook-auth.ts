/**
 * Verifying who is calling a webhook.
 *
 * Gmail's push notifications arrive from Google Cloud Pub/Sub. A push subscription configured with
 * an OIDC service account puts a Google-signed JWT in the Authorization header; verifying it —
 * signature against Google's published keys, issuer, audience, expiry and the service account's
 * email — proves the request came from *our* subscription. Without it anyone could POST a
 * notification; that would only cause a harmless extra sync (the sync reads the provider, never
 * the notification body), but an unauthenticated endpoint that makes the server call Google on
 * demand is an amplification tool, so it is refused.
 *
 * Uses only `node:crypto` and an injected fetch, so it is unit-tested with a locally minted key.
 */

import { createPublicKey, createVerify, timingSafeEqual, type JsonWebKey } from 'node:crypto';

const GOOGLE_CERTS = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

let cache: { keys: (JsonWebKey & { kid?: string })[]; at: number } | null = null;

async function googleKeys(fetcher: typeof fetch): Promise<(JsonWebKey & { kid?: string })[]> {
  if (cache && Date.now() - cache.at < 3_600_000) return cache.keys;
  const response = await fetcher(GOOGLE_CERTS);
  if (!response.ok) throw new Error(`Could not fetch Google signing keys (HTTP ${response.status}).`);
  const json = (await response.json()) as { keys: (JsonWebKey & { kid?: string })[] };
  cache = { keys: json.keys, at: Date.now() };
  return json.keys;
}

export function resetKeyCache() {
  cache = null;
}

export async function verifyGoogleOidcToken(
  token: string,
  expected: { audience: string; email: string | null },
  options: { fetcher?: typeof fetch; now?: number; keys?: (JsonWebKey & { kid?: string })[] } = {},
): Promise<{ ok: true; claims: Record<string, unknown> } | { ok: false; reason: string }> {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed token' };
  let header: { alg?: string; kid?: string };
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed token' };
  }
  if (header.alg !== 'RS256') return { ok: false, reason: 'unexpected algorithm' };
  const keys = options.keys ?? (await googleKeys(options.fetcher ?? fetch));
  const jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) return { ok: false, reason: 'unknown signing key' };
  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${parts[0]}.${parts[1]}`);
  if (!verifier.verify(createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'))) {
    return { ok: false, reason: 'bad signature' };
  }
  const now = Math.floor((options.now ?? Date.now()) / 1000);
  if (!ISSUERS.has(String(claims.iss))) return { ok: false, reason: 'wrong issuer' };
  if (claims.aud !== expected.audience) return { ok: false, reason: 'wrong audience' };
  if (typeof claims.exp !== 'number' || claims.exp < now - 60) return { ok: false, reason: 'expired' };
  if (expected.email && (claims.email !== expected.email || claims.email_verified !== true)) return { ok: false, reason: 'wrong service account' };
  return { ok: true, claims };
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Decode a Pub/Sub push body's Gmail payload: `{ emailAddress, historyId }`. */
export function decodeGmailPush(body: unknown): { emailAddress: string; historyId: string } | null {
  const data = (body as { message?: { data?: string } } | null)?.message?.data;
  if (!data) return null;
  try {
    const parsed = JSON.parse(Buffer.from(data, 'base64').toString('utf8')) as { emailAddress?: string; historyId?: string | number };
    if (!parsed.emailAddress) return null;
    return { emailAddress: parsed.emailAddress.toLowerCase(), historyId: String(parsed.historyId ?? '') };
  } catch {
    return null;
  }
}

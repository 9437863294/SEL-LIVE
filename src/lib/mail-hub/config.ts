import 'server-only';

/**
 * Mail Hub — server configuration, read from the environment in one place.
 *
 * Every provider is optional. An installation that only configures the company IMAP server gets
 * exactly that; the Accounts page lists what is available and, for an administrator, what is
 * missing — naming variables, never showing their values. See `.env.mail-hub.example`.
 */

import type { MailProvider } from './model';
import { secretStoreProblems } from './secrets';

export function appBaseUrl(): string {
  const configured = process.env.MAIL_HUB_PUBLIC_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_BASE_URL ?? '';
  if (configured.trim()) return configured.trim().replace(/\/$/, '');
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return `https://${vercel}`;
  return 'http://localhost:3000';
}

export interface OAuthClientConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tenant: string;
}

export const oauthCallbackPath = (provider: 'gmail' | 'microsoft') => `/api/mail-hub/oauth/${provider}/callback`;

export function googleOAuthConfig(): OAuthClientConfig | null {
  // Falls back to Office Hub's Google client: one Google Cloud OAuth client can serve both, with
  // both redirect URIs registered and the Gmail scope added to its consent screen.
  const clientId = (process.env.MAIL_HUB_GOOGLE_CLIENT_ID ?? process.env.GOOGLE_OAUTH_CLIENT_ID)?.trim();
  const clientSecret = (process.env.MAIL_HUB_GOOGLE_CLIENT_SECRET ?? process.env.GOOGLE_OAUTH_CLIENT_SECRET)?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, redirectUri: `${appBaseUrl()}${oauthCallbackPath('gmail')}`, tenant: '' };
}

export function microsoftOAuthConfig(): OAuthClientConfig | null {
  const clientId = process.env.MAIL_HUB_MICROSOFT_CLIENT_ID?.trim();
  const clientSecret = process.env.MAIL_HUB_MICROSOFT_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    redirectUri: `${appBaseUrl()}${oauthCallbackPath('microsoft')}`,
    // A single-tenant app registration should set its tenant id; `organizations` accepts any
    // work account and refuses personal Microsoft accounts, which have no business mail here.
    tenant: process.env.MAIL_HUB_MICROSOFT_TENANT?.trim() || 'organizations',
  };
}

export function oauthConfig(provider: 'gmail' | 'microsoft'): OAuthClientConfig | null {
  return provider === 'gmail' ? googleOAuthConfig() : microsoftOAuthConfig();
}

/**
 * The HMAC key for OAuth state and Graph `clientState`. Its own variable, falling back to a value
 * derived from the token key so a minimal installation does not need one more secret.
 */
export function stateSecret(): string {
  const explicit = process.env.MAIL_HUB_STATE_SECRET?.trim();
  if (explicit) return explicit;
  const derived = process.env.MAIL_HUB_TOKEN_KEY?.trim() || process.env.MAIL_HUB_KMS_KEY_NAME?.trim();
  if (!derived) throw new Error('MAIL_HUB_STATE_SECRET is not set.');
  return `derived:${derived}`;
}

export interface ProviderAvailability {
  provider: MailProvider;
  available: boolean;
  problems: string[];
}

export function providerAvailability(): ProviderAvailability[] {
  const store = secretStoreProblems();
  const google: string[] = [...store];
  if (!googleOAuthConfig()) google.push('MAIL_HUB_GOOGLE_CLIENT_ID / MAIL_HUB_GOOGLE_CLIENT_SECRET (or GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET) are not set.');
  const microsoft: string[] = [...store];
  if (!microsoftOAuthConfig()) microsoft.push('MAIL_HUB_MICROSOFT_CLIENT_ID / MAIL_HUB_MICROSOFT_CLIENT_SECRET are not set.');
  const imap: string[] = [...store];
  return [
    { provider: 'gmail', available: google.length === 0, problems: google },
    { provider: 'microsoft', available: microsoft.length === 0, problems: microsoft },
    // IMAP additionally needs at least one server preset, which is data rather than environment;
    // the accounts route adds that check.
    { provider: 'imap', available: imap.length === 0, problems: imap },
  ];
}

/* ── push notifications ───────────────────────────────────────────────────────────────────── */

/** `projects/<project>/topics/<topic>`; the Gmail API service account must be able to publish to it. */
export const gmailPubSubTopic = () => process.env.MAIL_HUB_GMAIL_PUBSUB_TOPIC?.trim() || null;
/** The audience the Pub/Sub push subscription puts in its OIDC token. */
export const gmailPushAudience = () => process.env.MAIL_HUB_GMAIL_PUSH_AUDIENCE?.trim() || `${appBaseUrl()}/api/mail-hub/webhooks/gmail`;
/** The service account the push subscription authenticates as. */
export const gmailPushServiceAccount = () => process.env.MAIL_HUB_GMAIL_PUSH_SERVICE_ACCOUNT?.trim() || null;

/** Graph can only call a public HTTPS URL; off by default for localhost. */
export function graphNotificationUrl(): string | null {
  const base = appBaseUrl();
  if (!base.startsWith('https://') || process.env.MAIL_HUB_DISABLE_GRAPH_WEBHOOKS === 'true') return null;
  return `${base}/api/mail-hub/webhooks/graph`;
}

/* ── scanning, AI ─────────────────────────────────────────────────────────────────────────── */

/**
 * An optional HTTP malware scanner (for example a ClamAV REST sidecar). POSTed the file bytes;
 * must answer JSON `{ "clean": boolean }`. Unset means files are marked "not scanned" and the UI
 * says so — it never pretends a scan happened.
 */
export const scannerUrl = () => process.env.MAIL_HUB_SCAN_URL?.trim() || null;
export const scannerToken = () => process.env.MAIL_HUB_SCAN_TOKEN?.trim() || null;
export const safeBrowsingKey = () => process.env.MAIL_HUB_SAFE_BROWSING_KEY?.trim() || null;
export const aiConfigured = () => Boolean(process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_GENAI_API_KEY?.trim());

/* ── cron ─────────────────────────────────────────────────────────────────────────────────── */

export function cronAuthorized(request: Request): { ok: true } | { ok: false; status: number; error: string } {
  const secret = process.env.CRON_SECRET;
  if (!secret) return { ok: false, status: 503, error: 'CRON_SECRET is not configured; the Mail Hub worker refuses to run unauthenticated.' };
  const ok =
    request.headers.get('authorization') === `Bearer ${secret}` || request.headers.get('x-vercel-cron-signature') === secret;
  return ok ? { ok: true } : { ok: false, status: 401, error: 'Unauthorized' };
}

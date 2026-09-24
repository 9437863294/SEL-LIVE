/**
 * The HTTP layer shared by the Gmail and Graph adapters.
 *
 * Its job is to turn every way a REST call can fail into one of the typed errors in `types.ts`,
 * because the sync engine's recovery depends on the distinction: a 401 after a fresh token is a
 * revoked grant, a 429 carries a delay to honour, a 5xx or a dropped connection is transient.
 *
 * A 401 is retried exactly once with a freshly minted access token — the cached one may simply
 * have expired a second early — and only a second 401 is treated as a lost grant.
 */

import {
  ProviderAuthError,
  ProviderNotFoundError,
  ProviderRateLimitError,
  ProviderUnavailableError,
  ProviderError,
} from './types.ts';

export interface TokenSource {
  get(): Promise<string>;
  /** Drop the cached token so the next `get` mints a new one. */
  invalidate(): void;
}

export interface RequestOptions {
  method?: string;
  body?: BodyInit | null;
  headers?: Record<string, string>;
  /** Parse JSON (default) or return the raw response for binary bodies. */
  raw?: boolean;
  /** Treat these statuses as a normal response rather than an error. */
  allowStatuses?: number[];
}

export function retryAfterMs(response: Response, fallbackMs = 30_000): number {
  const header = response.headers.get('retry-after');
  if (!header) return fallbackMs;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(1_000, seconds * 1000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(1_000, date - Date.now()) : fallbackMs;
}

function errorText(json: unknown): string {
  const error = (json as { error?: unknown } | null)?.error;
  if (typeof error === 'string') return error;
  const message = (error as { message?: string; code?: string } | undefined)?.message;
  return message ?? '';
}

/** Gmail signals quota with 403 + reason, not 429. */
function isQuota403(json: unknown): boolean {
  const errors = ((json as { error?: { errors?: { reason?: string }[] } } | null)?.error?.errors ?? []).map((entry) => entry.reason);
  return errors.some((reason) => reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded' || reason === 'quotaExceeded');
}

export async function providerRequest<T = unknown>(
  tokens: TokenSource,
  url: string,
  options: RequestOptions = {},
): Promise<{ status: number; data: T; response: Response }> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await tokens.get();
    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method ?? 'GET',
        body: options.body ?? undefined,
        headers: { Authorization: `Bearer ${token}`, ...(options.headers ?? {}) },
      });
    } catch (error) {
      throw new ProviderUnavailableError('The mail provider could not be reached.', String(error));
    }

    if (response.ok || options.allowStatuses?.includes(response.status)) {
      if (options.raw) return { status: response.status, data: undefined as T, response };
      const text = await response.text();
      const data = (text ? JSON.parse(text) : {}) as T;
      return { status: response.status, data, response };
    }

    const json = await response.json().catch(() => null);
    if (response.status === 401) {
      tokens.invalidate();
      if (attempt === 0) continue;
      throw new ProviderAuthError('The mail provider no longer accepts the ERP’s access.', errorText(json) || null);
    }
    if (response.status === 429 || (response.status === 403 && isQuota403(json))) {
      throw new ProviderRateLimitError(retryAfterMs(response));
    }
    if (response.status === 403) {
      throw new ProviderAuthError('The ERP is missing a permission it needs for this mailbox.', errorText(json) || null);
    }
    if (response.status === 404) throw new ProviderNotFoundError(errorText(json) || undefined);
    if (response.status >= 500) throw new ProviderUnavailableError(`The mail provider answered HTTP ${response.status}.`, errorText(json) || null);
    throw new ProviderError(`The mail provider refused the request (HTTP ${response.status}).`, errorText(json) || null);
  }
  throw new ProviderAuthError();
}

/** Run `task` over `items` with at most `limit` in flight. Order of results matches `items`. */
export async function mapLimit<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = { status: 'fulfilled', value: await task(items[index]) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

export const base64UrlDecode = (value: string) => Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
export const base64UrlEncode = (value: Uint8Array) => Buffer.from(value).toString('base64url');

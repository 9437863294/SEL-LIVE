'use client';

/**
 * Browser side of the fleet API (`/api/fleet/*`). Every call carries the signed-in user's ID token;
 * the browser never reads the fleet collections or the `fleet/` Storage prefix directly (both are
 * closed to it). Errors come back as `FleetApiError` with the server's own message, the machine
 * code a screen branches on (`over_limit`, `vehicle_busy`, `driver_busy`, `already_ended`…) and,
 * for a refused form, the message per field.
 */

import { auth } from '@/lib/firebase';
import { viewAsHeaders } from '@/lib/view-as';

export class FleetApiError extends Error {
  status: number;
  /** `details.code` from the server — what a screen switches on (e.g. `over_limit`). */
  code: string | null;
  details: unknown;
  /** Per-field messages (`details.fields`), keyed as the request named them. */
  fields: Record<string, string>;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'FleetApiError';
    this.status = status;
    this.details = details ?? null;
    const shaped = (details ?? {}) as { code?: unknown; fields?: unknown };
    this.code = typeof shaped.code === 'string' ? shaped.code : null;
    this.fields = shaped.fields && typeof shaped.fields === 'object' ? (shaped.fields as Record<string, string>) : {};
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface FleetFetchOptions {
  method?: Method;
  body?: unknown;
  form?: FormData;
  signal?: AbortSignal;
}

const url = (path: string) => `/api/fleet/${path.replace(/^\//, '')}`;

async function authHeader(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) throw new FleetApiError('You are signed out. Sign in again.', 401);
  // Switch User: the server answers as the user being viewed (reads only).
  return { Authorization: `Bearer ${await user.getIdToken()}`, ...viewAsHeaders() };
}

async function failure(response: Response): Promise<FleetApiError> {
  const text = await response.text().catch(() => '');
  let payload: { error?: string; details?: unknown } = {};
  try {
    payload = text ? (JSON.parse(text) as typeof payload) : {};
  } catch {
    payload = {};
  }
  return new FleetApiError(payload.error || `Request failed (${response.status}).`, response.status, payload.details);
}

/** JSON in, JSON out. POST by default when there is a body or a form. */
export async function fleetFetch<T>(path: string, options: FleetFetchOptions = {}): Promise<T> {
  const headers = await authHeader();
  let body: BodyInit | undefined;
  if (options.form) body = options.form;
  else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  const response = await fetch(url(path), { method: options.method ?? (body !== undefined ? 'POST' : 'GET'), headers, body, cache: 'no-store', signal: options.signal });
  if (!response.ok) throw await failure(response);
  const text = await response.text();
  try {
    return (text ? JSON.parse(text) : null) as T;
  } catch {
    throw new FleetApiError('The server sent an unreadable answer.', response.status);
  }
}

export const fleetErrorMessage = (error: unknown, fallback = 'Something went wrong.') => (error instanceof Error && error.message ? error.message : fallback);

/** A file the API serves (a photo, a report), as a Blob — `<img src>` cannot send the token. */
export async function fetchFleetBlob(path: string): Promise<Blob> {
  const response = await fetch(url(path), { headers: await authHeader(), cache: 'no-store' });
  if (!response.ok) throw await failure(response);
  return response.blob();
}

export async function downloadFleetFile(path: string, filename: string): Promise<void> {
  const blob = await fetchFleetBlob(path);
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Some browsers start the download after the click returns; revoking at once can cancel it.
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

/**
 * An id the phone mints for something it may send twice (a start, a point, an end): the server
 * treats a repeat as the same request. Letters, digits, `-` and `_` only — the API's pattern.
 */
export function newClientId(prefix: string): string {
  const safe = prefix.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12) || 'id';
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '')
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  return `${safe}_${random}`.slice(0, 64);
}

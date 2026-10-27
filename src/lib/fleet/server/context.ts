import 'server-only';

/**
 * Request context for every /api/fleet route: who is calling, their fleet grants, and "now".
 *
 * Every signed-in, active user gets a context. Driving and approving need no permission (see
 * ../access.ts); each operation checks what it needs — the vehicle's lock, the driver, the approver.
 */

import { NextResponse } from 'next/server';

import { resolveFleetAccess, type FleetAccess } from '../access.ts';
import { ApprovalError } from '../approvals.ts';
import { istDateKey } from '../dates.ts';
import { FleetRuleError } from '../trips.ts';
import {
  AccessDeniedError,
  accessErrorResponse,
  authenticateAccessViewingAs,
  type AccessRequestContext,
} from '@/lib/access-control-server';
import { getFirebaseAdminFirestore } from '@/lib/firebase-admin';

export interface FleetContext extends AccessRequestContext {
  /** Set when an administrator is viewing as this user (Switch User): reads only. */
  viewedBy?: { userId: string; userName: string };
  fleet: FleetAccess;
  now: string;
  today: string;
  ipAddress?: string;
  userAgent?: string;
}

export async function fleetContext(request: Request): Promise<FleetContext> {
  // Switch User: an administrator viewing as someone sees that person's trips, vehicle and requests.
  const base = await authenticateAccessViewingAs(request);
  const forwarded = request.headers.get('x-forwarded-for');
  const now = new Date().toISOString();
  return {
    ...base,
    fleet: resolveFleetAccess(base.access),
    now,
    today: istDateKey(now),
    ipAddress: forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || undefined,
    userAgent: request.headers.get('user-agent')?.slice(0, 200) ?? undefined,
  };
}

/** A rule the caller broke and can fix; the message is shown as is. (Plain fields for strip-types.) */
export class FleetError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(message: string, status = 400, details?: unknown) {
    super(message);
    this.name = 'FleetError';
    this.status = status;
    this.details = details;
  }
}

interface RouteArgs<P> {
  request: Request;
  context: FleetContext;
  params: P;
  url: URL;
}

/** The status and body an error becomes; shared by the route wrapper and the tests. */
export function fleetErrorResponse(error: unknown): { status: number; body: { error: string; details?: unknown } } | null {
  if (error instanceof FleetError) return { status: error.status, body: { error: error.message, details: error.details } };
  if (error instanceof FleetRuleError) return { status: 400, body: { error: error.message, details: error.field ? { fields: { [error.field]: error.message } } : undefined } };
  if (error instanceof ApprovalError) return { status: 400, body: { error: error.message } };
  if (error && typeof error === 'object' && 'issues' in error && Array.isArray((error as { issues: unknown[] }).issues)) {
    const issues = (error as { issues: { path: (string | number)[]; message: string }[] }).issues;
    const fields = Object.fromEntries(issues.map((issue) => [issue.path.join('.'), issue.message]));
    return { status: 400, body: { error: issues.map((issue) => issue.message).join('; '), details: { fields } } };
  }
  return null;
}

/**
 * Wraps a route handler: authenticates, resolves params, returns JSON and maps errors to statuses.
 * Rule and validation failures say what was wrong; anything unexpected is logged by route name and
 * the caller gets a generic message.
 */
export function fleetRoute<P extends Record<string, string> = Record<string, never>>(name: string, handler: (args: RouteArgs<P>) => Promise<unknown>) {
  return async (request: Request, segment?: { params?: Promise<P> }): Promise<Response> => {
    try {
      const context = await fleetContext(request);
      const params = ((await segment?.params) ?? {}) as P;
      const result = await handler({ request, context, params, url: new URL(request.url) });
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (error) {
      const mapped = fleetErrorResponse(error);
      if (mapped) return NextResponse.json(mapped.body, { status: mapped.status });
      if (error instanceof AccessDeniedError) return NextResponse.json({ error: error.message }, { status: error.status });
      if (!(error instanceof Error && /FIREBASE|credential|auth\//i.test(error.message))) {
        console.error(`[fleet:${name}]`, error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error');
      }
      const { message, status } = accessErrorResponse(error);
      return NextResponse.json({ error: message }, { status });
    }
  };
}

export const db = () => getFirebaseAdminFirestore();

export async function readJson<T = unknown>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new FleetError('The request body is not valid JSON.');
  }
}

/** Fail closed: a cron route without a configured secret would let anyone run it. */
export function cronAuthorised(request: Request): Response | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 503 });
  if (request.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return null;
}

/** The actor for writes made by a scheduled job. */
export const SYSTEM_ACTOR = { id: 'system', name: 'System' } as const;

import 'server-only';

/**
 * Request context for every trip-claims API route: who is calling and what they may do beyond their
 * own trips.
 *
 * Every signed-in, active user gets a context — recording and claiming their own trips needs no
 * permission. The wider grants (`TripAccess`) and workflow naming are checked by each operation.
 */

import { NextResponse } from 'next/server';

import { resolveTripAccess, type TripAccess } from '../access.ts';
import { DecisionError } from '../workflow.ts';
import { indiaToday } from '../types.ts';
import {
  AccessDeniedError,
  accessErrorResponse,
  authenticateAccess,
  type AccessRequestContext,
} from '@/lib/access-control-server';
import { getFirebaseAdminFirestore } from '@/lib/firebase-admin';

export interface TripContext extends AccessRequestContext {
  trip: TripAccess;
  today: string;
  ipAddress?: string;
  userAgent?: string;
}

export async function tripContext(request: Request): Promise<TripContext> {
  const base = await authenticateAccess(request);
  const forwarded = request.headers.get('x-forwarded-for');
  return {
    ...base,
    trip: resolveTripAccess(base.access),
    today: indiaToday(),
    ipAddress: forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || undefined,
    userAgent: request.headers.get('user-agent')?.slice(0, 200) ?? undefined,
  };
}

/**
 * A rule the caller broke and can fix; the message is shown as is. (Plain fields rather than
 * constructor parameter properties, so the flow test can run this file with Node's type stripping.)
 */
export class TripError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(message: string, status = 400, details?: unknown) {
    super(message);
    this.name = 'TripError';
    this.status = status;
    this.details = details;
  }
}

interface RouteArgs<P> {
  request: Request;
  context: TripContext;
  params: P;
  url: URL;
}

/**
 * Wraps a route handler: authenticates, resolves params, returns the result as JSON and turns
 * errors into the right status. Rule and validation failures say exactly what was wrong; anything
 * unexpected is logged with the route name and the caller gets a generic message.
 */
export function tripRoute<P extends Record<string, string> = Record<string, never>>(name: string, handler: (args: RouteArgs<P>) => Promise<unknown>) {
  return async (request: Request, segment?: { params?: Promise<P> }): Promise<Response> => {
    try {
      const context = await tripContext(request);
      const params = ((await segment?.params) ?? {}) as P;
      const result = await handler({ request, context, params, url: new URL(request.url) });
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (error) {
      if (error instanceof TripError) return NextResponse.json({ error: error.message, details: error.details }, { status: error.status });
      if (error instanceof DecisionError) return NextResponse.json({ error: error.message }, { status: 400 });
      if (error && typeof error === 'object' && 'issues' in error && Array.isArray((error as { issues: unknown[] }).issues)) {
        const issues = (error as { issues: { path: (string | number)[]; message: string }[] }).issues;
        return NextResponse.json({ error: issues.map((issue) => issue.message).join('; '), details: issues }, { status: 400 });
      }
      if (error instanceof AccessDeniedError) return NextResponse.json({ error: error.message }, { status: error.status });
      if (!(error instanceof Error && /FIREBASE|credential|auth\//i.test(error.message))) {
        console.error(`[driver-management:${name}]`, error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error');
      }
      const { message, status } = accessErrorResponse(error);
      return NextResponse.json({ error: message }, { status });
    }
  };
}

export const db = () => getFirebaseAdminFirestore();

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new TripError('The request body is not valid JSON.');
  }
}

export const nowIso = () => new Date().toISOString();

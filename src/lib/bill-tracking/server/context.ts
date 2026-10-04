import 'server-only';

/**
 * Request context for every Bill Tracking API route: who is calling, what they may do, and which
 * projects' money they may see.
 *
 * All Bill Tracking data is read and written through the API with the Admin SDK; the browser has
 * no Firestore access to these collections at all. That is what makes the rules below binding
 * rather than advisory — and it means no Firestore security-rule change is needed in the console
 * for the module to be safe (see `firestore.rules`, which denies the collections to clients).
 *
 * Project scope: `Bill Tracking.All Projects · View` sees every project (HO finance, management).
 * Everyone else sees only the projects granted to them in Access Management (`projectIds` on the
 * resolved access). A user with neither sees nothing — an empty scope is never widened to "all".
 */

import { NextResponse } from 'next/server';

import { BT_MODULE, resolveBtAccess, type BtResource } from '../access.ts';
import {
  AccessDeniedError,
  accessErrorResponse,
  authenticateAccess,
  type AccessRequestContext,
} from '@/lib/access-control-server';
import { getFirebaseAdminFirestore } from '@/lib/firebase-admin';

export const MODULE = BT_MODULE;
export type { BtResource };

export interface BtContext extends AccessRequestContext {
  /** `null` = every project. */
  scope: string[] | null;
  can: (resource: BtResource, action: string, projectId?: string) => boolean;
  /** Throws 403 unless the caller holds the permission (on the project, when given). */
  require: (resource: BtResource, action: string, projectId?: string) => void;
  /** Throws 403 unless the project is inside the caller's scope. */
  requireProject: (projectId: string) => void;
  inScope: (projectId: string) => boolean;
  today: string;
  userAgent?: string;
}

/** "Today" in India, whatever timezone the server runs in (production hosts are UTC). */
export function indiaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export async function btContext(request: Request): Promise<BtContext> {
  const base = await authenticateAccess(request);
  const resolved = resolveBtAccess(base.access, base.projectIds);
  if (!resolved.hasModule) throw new AccessDeniedError('Access to Bill Tracking is required.');
  const { scope, inScope, can } = resolved;
  return {
    ...base,
    scope,
    can,
    inScope,
    require: (resource, action, projectId) => {
      if (projectId && !inScope(projectId)) throw new AccessDeniedError('This project is outside your Bill Tracking access.');
      if (!can(resource, action, projectId)) throw new AccessDeniedError(`${action} permission on ${MODULE} · ${resource} is required.`);
    },
    requireProject: (projectId) => {
      if (!inScope(projectId)) throw new AccessDeniedError('This project is outside your Bill Tracking access.');
    },
    today: indiaToday(),
    userAgent: request.headers.get('user-agent')?.slice(0, 200) ?? undefined,
  };
}

export class BtError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'BtError';
  }
}

interface RouteArgs<P> {
  request: Request;
  context: BtContext;
  params: P;
  url: URL;
}

/**
 * Wraps a route handler: authenticates, resolves params, serialises the result as JSON (a handler
 * may return a `Response` itself, e.g. a file download) and turns errors into the right status.
 * Validation and business-rule failures (`BtError`, zod) say exactly what was wrong; anything
 * unexpected is logged with the route name but no financial payload, and the caller gets a generic
 * message.
 */
export function btRoute<P extends Record<string, string> = Record<string, never>>(name: string, handler: (args: RouteArgs<P>) => Promise<unknown>) {
  return async (request: Request, segment?: { params?: Promise<P> }): Promise<Response> => {
    try {
      const context = await btContext(request);
      const params = ((await segment?.params) ?? {}) as P;
      const result = await handler({ request, context, params, url: new URL(request.url) });
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (error) {
      if (error instanceof BtError) return NextResponse.json({ error: error.message, details: error.details }, { status: error.status });
      if (error && typeof error === 'object' && 'issues' in error && Array.isArray((error as { issues: unknown[] }).issues)) {
        const issues = (error as { issues: { path: (string | number)[]; message: string }[] }).issues;
        return NextResponse.json({ error: issues.map((issue) => `${issue.path.join('.') || 'value'}: ${issue.message}`).join('; '), details: issues }, { status: 400 });
      }
      if (error instanceof AccessDeniedError) return NextResponse.json({ error: error.message }, { status: error.status });
      if (!(error instanceof Error && /FIREBASE|credential|auth\//i.test(error.message))) {
        console.error(`[bill-tracking:${name}]`, error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error');
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
    throw new BtError('The request body is not valid JSON.');
  }
}

import 'server-only';

/**
 * Request context for every Master Drawing List API route: who is calling, and what they may do on
 * which drawing list.
 *
 * Both collections (`mdl_projects`, `mdl_items`) are read and written only here, with the Admin SDK;
 * `firestore.rules` lists them as server-only, so a browser or the mobile app cannot reach them.
 * That keeps the derived fields (status, current revision, last dates, held by) trustworthy: they
 * are recalculated by `derive()` on every write and never typed by a user.
 */

import { NextResponse } from 'next/server';

import { AccessDeniedError, accessErrorResponse, authenticateAccess, type AccessRequestContext } from '@/lib/access-control-server';

import { resolveMdlAccess, type MdlAccess, type MdlResource } from '../access.ts';
import { todayIst } from '../derive.ts';
import type { MdlProject } from '../types.ts';

type ScopedProject = Pick<MdlProject, 'projectId'>;

export interface MdlContext extends AccessRequestContext, MdlAccess {
  /** Throws 403 unless the caller holds the permission (on that drawing list, when given). */
  require: (resource: MdlResource, action: string, project?: ScopedProject) => void;
  /** Throws 403 unless the drawing list is inside the caller's scope. */
  requireProject: (project: ScopedProject) => void;
  /** Today in India: the latest date anything may be recorded on. */
  today: string;
}

export class MdlError extends Error {
  readonly status: number;
  // No constructor parameter property: the tests run this file with Node's type stripping.
  constructor(message: string, status: number = 400) {
    super(message);
    this.name = 'MdlError';
    this.status = status;
  }
}

/** The context for a caller whose access is already resolved — the routes, and the flow tests. */
export function contextFor(base: AccessRequestContext, now: Date = new Date()): MdlContext {
  const access = resolveMdlAccess(base.access, base.projectIds);
  if (!access.hasModule) throw new AccessDeniedError('Access to the Master Drawing List is required.');
  return {
    ...base,
    ...access,
    require: (resource, action, project) => {
      if (project && !access.inScope(project)) throw new AccessDeniedError('This drawing list is outside your access.');
      if (!access.can(resource, action, project)) throw new AccessDeniedError(`${action} permission on Master Drawing List · ${resource} is required.`);
    },
    requireProject: (project) => {
      if (!access.inScope(project)) throw new AccessDeniedError('This drawing list is outside your access.');
    },
    today: todayIst(now),
  };
}

interface RouteArgs<P> {
  request: Request;
  context: MdlContext;
  params: P;
  url: URL;
}

/**
 * Wraps a route handler: authenticates, resolves params, returns the result as JSON and turns errors
 * into the right status. Rule and validation failures say what was wrong; anything unexpected is
 * logged with the route name only, and the caller gets a generic message.
 */
export function mdlRoute<P extends Record<string, string> = Record<string, never>>(name: string, handler: (args: RouteArgs<P>) => Promise<unknown>) {
  return async (request: Request, segment?: { params?: Promise<P> }): Promise<Response> => {
    try {
      const context = contextFor(await authenticateAccess(request));
      const params = ((await segment?.params) ?? {}) as P;
      const result = await handler({ request, context, params, url: new URL(request.url) });
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (error) {
      if (error instanceof MdlError) return NextResponse.json({ error: error.message }, { status: error.status });
      if (error && typeof error === 'object' && 'issues' in error && Array.isArray((error as { issues: unknown[] }).issues)) {
        const issues = (error as { issues: { path: (string | number)[]; message: string }[] }).issues;
        return NextResponse.json({ error: issues.map((issue) => issue.message).join(' '), details: issues }, { status: 400 });
      }
      if (error instanceof AccessDeniedError) return NextResponse.json({ error: error.message }, { status: error.status });
      if (!(error instanceof Error && /FIREBASE|credential|auth\//i.test(error.message))) {
        console.error(`[master-drawing-list:${name}]`, error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error');
      }
      const { message, status } = accessErrorResponse(error);
      return NextResponse.json({ error: message }, { status });
    }
  };
}

export { decodeParam } from '../params.ts';

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new MdlError('The request body is not valid JSON.');
  }
}

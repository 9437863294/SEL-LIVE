import 'server-only';

/**
 * The route wrapper for /api/employee/project-links: authenticates, runs the handler, and turns a
 * rule or validation failure into its status with a readable message.
 */

import { NextResponse } from 'next/server';

import { AccessDeniedError, accessErrorResponse, authenticateAccess, type AccessRequestContext } from '@/lib/access-control-server';
import { ProjectLinkError } from './server';

export function projectLinkRoute<P extends Record<string, string> = Record<string, never>>(name: string, handler: (args: { request: Request; context: AccessRequestContext; params: P }) => Promise<unknown>) {
  return async (request: Request, segment?: { params?: Promise<P> }): Promise<Response> => {
    try {
      const context = await authenticateAccess(request);
      const params = ((await segment?.params) ?? {}) as P;
      return NextResponse.json((await handler({ request, context, params })) ?? { ok: true });
    } catch (error) {
      if (error instanceof ProjectLinkError) return NextResponse.json({ error: error.message }, { status: error.status });
      if (error && typeof error === 'object' && 'issues' in error && Array.isArray((error as { issues: unknown[] }).issues)) {
        return NextResponse.json({ error: (error as { issues: { message: string }[] }).issues.map((issue) => issue.message).join('; ') }, { status: 400 });
      }
      if (error instanceof AccessDeniedError) return NextResponse.json({ error: error.message }, { status: error.status });
      console.error(`[employee-projects:${name}]`, error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error');
      const { message, status } = accessErrorResponse(error);
      return NextResponse.json({ error: message }, { status });
    }
  };
}

export async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ProjectLinkError('The request body is not valid JSON.');
  }
}

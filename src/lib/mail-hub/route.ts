import 'server-only';

/**
 * The shape every Mail Hub route handler shares: authenticate, run, map errors. Routes stay a few
 * lines each, and none of them can forget to turn a provider or access error into the right status.
 */

import { MailHubError, mailContext, mailErrorResponse, type MailContext } from './server';

type Params = Record<string, string>;

export function mailRoute<P extends Params = Params>(
  operation: string,
  run: (input: { request: Request; context: MailContext; params: P; url: URL }) => Promise<unknown>,
  options: { requireModule?: boolean } = {},
) {
  return async (request: Request, segment?: { params: Promise<P> }): Promise<Response> => {
    try {
      const context = await mailContext(request, options);
      const params = (segment ? await segment.params : {}) as P;
      const result = await run({ request, context, params, url: new URL(request.url) });
      return result instanceof Response ? result : Response.json(result ?? { ok: true });
    } catch (error) {
      return mailErrorResponse(error, operation);
    }
  };
}

/** Parse a JSON body with a size ceiling. Compose bodies are the largest thing sent, at ~2 MB. */
export async function readJson<T = Record<string, unknown>>(request: Request, maxBytes = 3_000_000): Promise<T> {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > maxBytes) throw new MailHubError('The request is too large.', 413);
  const text = await request.text();
  if (text.length > maxBytes) throw new MailHubError('The request is too large.', 413);
  try {
    return (text ? JSON.parse(text) : {}) as T;
  } catch {
    throw new MailHubError('The request body is not valid JSON.', 400);
  }
}

export const routeConfig = { dynamic: 'force-dynamic', runtime: 'nodejs' } as const;

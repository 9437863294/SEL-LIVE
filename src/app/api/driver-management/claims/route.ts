import { TripError, readJson, tripRoute } from '@/lib/employee-trips/server/context';
import { listClaims, submitClaims, type ClaimScope } from '@/lib/employee-trips/server/claims';

const SCOPES: readonly ClaimScope[] = ['mine', 'inbox', 'processed', 'active', 'all'];

export const GET = tripRoute('claims.list', async ({ context, url }) => {
  const scope = (url.searchParams.get('scope') || 'mine') as ClaimScope;
  if (!SCOPES.includes(scope)) throw new TripError('Unknown list.');
  const financialYear = url.searchParams.get('fy') || undefined;
  return listClaims(context, scope, financialYear && /^\d{4}-\d{2}$/.test(financialYear) ? financialYear : undefined);
});

export const POST = tripRoute('claims.submit', async ({ request, context }) => submitClaims(context, await readJson(request)));

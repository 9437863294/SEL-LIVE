import { readJson, tripRoute } from '@/lib/employee-trips/server/context';
import { actOnClaim, getClaim } from '@/lib/employee-trips/server/claims';

export const GET = tripRoute<{ claimId: string }>('claims.get', async ({ context, params }) => getClaim(context, params.claimId));
export const POST = tripRoute<{ claimId: string }>('claims.action', async ({ request, context, params }) => actOnClaim(context, params.claimId, await readJson(request)));

import { readJson, tripRoute } from '@/lib/employee-trips/server/context';
import { payClaims } from '@/lib/employee-trips/server/claims';

export const POST = tripRoute('claims.pay', async ({ request, context }) => payClaims(context, await readJson(request)));

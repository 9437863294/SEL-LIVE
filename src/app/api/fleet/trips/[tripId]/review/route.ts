import { readJson, fleetRoute } from '@/lib/fleet/server/context';
import { reviewTrip } from '@/lib/fleet/server/trips';

export const POST = fleetRoute<{ tripId: string }>('trips.review', async ({ request, context, params }) => reviewTrip(context, params.tripId, await readJson(request)));

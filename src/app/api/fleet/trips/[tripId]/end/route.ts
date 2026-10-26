import { readJson, fleetRoute } from '@/lib/fleet/server/context';
import { endTrip } from '@/lib/fleet/server/trips';

export const POST = fleetRoute<{ tripId: string }>('trips.end', async ({ request, context, params }) => endTrip(context, params.tripId, await readJson(request)));

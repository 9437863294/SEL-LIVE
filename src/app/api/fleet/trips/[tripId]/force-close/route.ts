import { readJson, fleetRoute } from '@/lib/fleet/server/context';
import { forceCloseTrip } from '@/lib/fleet/server/trips';

export const POST = fleetRoute<{ tripId: string }>('trips.force-close', async ({ request, context, params }) => forceCloseTrip(context, params.tripId, await readJson(request)));

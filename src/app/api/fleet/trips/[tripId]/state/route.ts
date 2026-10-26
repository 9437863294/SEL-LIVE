import { readJson, fleetRoute } from '@/lib/fleet/server/context';
import { changeTrip } from '@/lib/fleet/server/trips';

/** Pause, resume, or cancel a trip started by mistake. */
export const POST = fleetRoute<{ tripId: string }>('trips.state', async ({ request, context, params }) => changeTrip(context, params.tripId, await readJson(request)));

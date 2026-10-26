import { readJson, fleetRoute } from '@/lib/fleet/server/context';
import { addGeofenceEvents } from '@/lib/fleet/server/trips';

export const POST = fleetRoute<{ tripId: string }>('trips.geofence-events', async ({ request, context, params }) => addGeofenceEvents(context, params.tripId, await readJson(request)));

import { readJson, fleetRoute } from '@/lib/fleet/server/context';
import { addPoints } from '@/lib/fleet/server/trips';

export const POST = fleetRoute<{ tripId: string }>('trips.points', async ({ request, context, params }) => addPoints(context, params.tripId, await readJson(request)));

import { readJson, fleetRoute } from '@/lib/fleet/server/context';
import { startTrip } from '@/lib/fleet/server/trips';

export const POST = fleetRoute('trips.start', async ({ request, context }) => startTrip(context, await readJson(request)));

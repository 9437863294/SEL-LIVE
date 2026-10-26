import { readJson, fleetRoute } from '@/lib/fleet/server/context';
import { setProjectGeofences } from '@/lib/fleet/server/masters';

export const PUT = fleetRoute('projects.geofences', async ({ request, context }) => setProjectGeofences(context, await readJson(request)));

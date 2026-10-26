import { readJson, fleetRoute } from '@/lib/fleet/server/context';
import { saveGeofence } from '@/lib/fleet/server/masters';

export const POST = fleetRoute('geofences.create', async ({ request, context }) => saveGeofence(context, await readJson(request)));

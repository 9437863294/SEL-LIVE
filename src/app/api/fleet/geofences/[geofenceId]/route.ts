import { readJson, fleetRoute } from '@/lib/fleet/server/context';
import { deleteGeofence, saveGeofence } from '@/lib/fleet/server/masters';

export const PATCH = fleetRoute<{ geofenceId: string }>('geofences.update', async ({ request, context, params }) => saveGeofence(context, await readJson(request), params.geofenceId));
export const DELETE = fleetRoute<{ geofenceId: string }>('geofences.delete', async ({ context, params }) => deleteGeofence(context, params.geofenceId));

import { readJson, tripRoute } from '@/lib/employee-trips/server/context';
import { deleteTrip, saveTrip } from '@/lib/employee-trips/server/trips';

export const PATCH = tripRoute<{ tripId: string }>('trips.update', async ({ request, context, params }) => saveTrip(context, await readJson(request), params.tripId));
export const DELETE = tripRoute<{ tripId: string }>('trips.delete', async ({ context, params }) => deleteTrip(context, params.tripId));

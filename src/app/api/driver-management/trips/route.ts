import { readJson, tripRoute } from '@/lib/employee-trips/server/context';
import { listMyTrips, saveTrip } from '@/lib/employee-trips/server/trips';

export const GET = tripRoute('trips.list', async ({ context }) => ({ trips: await listMyTrips(context) }));
export const POST = tripRoute('trips.create', async ({ request, context }) => saveTrip(context, await readJson(request)));

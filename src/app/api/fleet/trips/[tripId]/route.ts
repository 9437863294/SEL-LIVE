import { fleetRoute } from '@/lib/fleet/server/context';
import { tripDetail } from '@/lib/fleet/server/trips';

export const GET = fleetRoute<{ tripId: string }>('trips.get', async ({ context, params }) => tripDetail(context, params.tripId));

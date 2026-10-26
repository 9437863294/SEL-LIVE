import { readJson, fleetRoute } from '@/lib/fleet/server/context';
import { setOdometerBaseline } from '@/lib/fleet/server/masters';

export const POST = fleetRoute<{ vehicleId: string }>('vehicles.baseline', async ({ request, context, params }) => setOdometerBaseline(context, params.vehicleId, await readJson(request)));

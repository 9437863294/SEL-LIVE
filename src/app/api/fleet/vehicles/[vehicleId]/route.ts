import { readJson, fleetRoute } from '@/lib/fleet/server/context';
import { saveVehicleFleetFields } from '@/lib/fleet/server/masters';

export const PATCH = fleetRoute<{ vehicleId: string }>('vehicles.update', async ({ request, context, params }) => saveVehicleFleetFields(context, params.vehicleId, await readJson(request)));

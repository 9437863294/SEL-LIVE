import { readJson, fleetRoute } from '@/lib/fleet/server/context';
import { deletePurpose, savePurpose } from '@/lib/fleet/server/masters';

export const PATCH = fleetRoute<{ purposeId: string }>('purposes.update', async ({ request, context, params }) => savePurpose(context, await readJson(request), params.purposeId));
export const DELETE = fleetRoute<{ purposeId: string }>('purposes.delete', async ({ context, params }) => deletePurpose(context, params.purposeId));

import { readJson, fleetRoute } from '@/lib/fleet/server/context';
import { savePurpose } from '@/lib/fleet/server/masters';

export const POST = fleetRoute('purposes.create', async ({ request, context }) => savePurpose(context, await readJson(request)));

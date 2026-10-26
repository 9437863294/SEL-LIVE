import { readJson, fleetRoute } from '@/lib/fleet/server/context';
import { saveFleetSettings } from '@/lib/fleet/server/masters';

export const PUT = fleetRoute('settings.save', async ({ request, context }) => saveFleetSettings(context, await readJson(request)));

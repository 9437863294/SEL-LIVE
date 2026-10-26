import { readJson, fleetRoute } from '@/lib/fleet/server/context';
import { createFuelEntry, listMyFuel } from '@/lib/fleet/server/fuel';

export const GET = fleetRoute('fuel.list', async ({ context }) => ({ entries: await listMyFuel(context) }));
export const POST = fleetRoute('fuel.create', async ({ request, context }) => createFuelEntry(context, await readJson(request)));

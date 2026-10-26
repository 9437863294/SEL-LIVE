import { fleetRoute } from '@/lib/fleet/server/context';
import { fleetMasters } from '@/lib/fleet/server/masters';

export const GET = fleetRoute('masters.get', async ({ context }) => fleetMasters(context));

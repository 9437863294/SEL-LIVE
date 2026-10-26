import { fleetRoute } from '@/lib/fleet/server/context';
import { fleetBootstrap } from '@/lib/fleet/server/overview';

export const GET = fleetRoute('bootstrap', async ({ context }) => fleetBootstrap(context));

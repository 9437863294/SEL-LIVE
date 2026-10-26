import { fleetRoute } from '@/lib/fleet/server/context';
import { fleetExceptions } from '@/lib/fleet/server/overview';

export const GET = fleetRoute('exceptions.list', async ({ context }) => fleetExceptions(context));

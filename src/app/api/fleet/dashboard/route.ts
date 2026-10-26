import { fleetRoute } from '@/lib/fleet/server/context';
import { fleetDashboard } from '@/lib/fleet/server/overview';

export const GET = fleetRoute('dashboard', async ({ context }) => fleetDashboard(context));

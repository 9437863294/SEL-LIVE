import { tripRoute } from '@/lib/employee-trips/server/context';
import { dashboard } from '@/lib/employee-trips/server/overview';

export const GET = tripRoute('dashboard', async ({ context }) => dashboard(context));

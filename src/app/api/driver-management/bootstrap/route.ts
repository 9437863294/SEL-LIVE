import { tripRoute } from '@/lib/employee-trips/server/context';
import { bootstrap } from '@/lib/employee-trips/server/overview';

export const GET = tripRoute('bootstrap', async ({ context }) => bootstrap(context));

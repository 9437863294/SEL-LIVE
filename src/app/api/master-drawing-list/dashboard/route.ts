import { mdlRoute } from '@/lib/master-drawing-list/server/context';
import { dashboard } from '@/lib/master-drawing-list/server/queries';

export const GET = mdlRoute('dashboard', async ({ context }) => dashboard(context));

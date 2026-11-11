import { mdlRoute } from '@/lib/master-drawing-list/server/context';
import { lookups } from '@/lib/master-drawing-list/server/queries';

export const GET = mdlRoute('lookups', async ({ context }) => lookups(context));

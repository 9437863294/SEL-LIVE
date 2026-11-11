import { mdlRoute } from '@/lib/master-drawing-list/server/context';
import { pending } from '@/lib/master-drawing-list/server/queries';

/** Comments to comply, under review and vendor not finalised — every viewable list, or `?project=<code>`. */
export const GET = mdlRoute('pending', async ({ context, url }) => pending(context, url.searchParams.get('project') || null));

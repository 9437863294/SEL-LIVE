import { mdlRoute } from '@/lib/master-drawing-list/server/context';
import { listMappings } from '@/lib/master-drawing-list/server/import';

/** The column mappings remembered from earlier imports. */
export const GET = mdlRoute('import.mappings', async ({ context }) => ({ templates: await listMappings(context) }));

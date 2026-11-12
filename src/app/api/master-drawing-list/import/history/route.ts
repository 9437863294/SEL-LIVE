import { mdlRoute } from '@/lib/master-drawing-list/server/context';
import { importHistory } from '@/lib/master-drawing-list/server/import';

/** The last 30 imports into drawing lists the caller can see. */
export const GET = mdlRoute('import.history', async ({ context }) => ({ imports: await importHistory(context) }));

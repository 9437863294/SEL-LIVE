import { mdlRoute, readJson } from '@/lib/master-drawing-list/server/context';
import { runImport } from '@/lib/master-drawing-list/server/import';
import { importInputSchema } from '@/lib/master-drawing-list/schemas';

export const runtime = 'nodejs';

/**
 * Excel Import: `{ grid, mode: 'preview' | 'import', overwrite }`. Preview (Import · View) parses the
 * workbook's cells and reports what would be written; import (Import · Import) writes it.
 */
export const POST = mdlRoute('import', async ({ request, context }) => runImport(context, importInputSchema.parse(await readJson(request))));

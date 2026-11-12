import { decodeParam, mdlRoute } from '@/lib/master-drawing-list/server/context';
import { undoImport } from '@/lib/master-drawing-list/server/import';

/** Undo an import: remove the items it created that nobody has edited since (Import · Import). */
export const DELETE = mdlRoute<{ importId: string }>('import.undo', async ({ context, params }) => ({ import: await undoImport(context, decodeParam(params.importId)) }));

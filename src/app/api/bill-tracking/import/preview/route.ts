import { btRoute, readJson } from '@/lib/bill-tracking/server/context';
import { importPreviewSchema } from '@/lib/bill-tracking/schemas';
import { previewImport } from '@/lib/bill-tracking/server/import-service';

export const runtime = 'nodejs';

/** Stateless: parses and validates the workbook grid against live masters. Writes nothing. */
export const POST = btRoute('import.preview', async ({ request, context }) => previewImport(context, importPreviewSchema.parse(await readJson(request))));

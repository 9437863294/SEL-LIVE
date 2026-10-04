import { btRoute, readJson } from '@/lib/bill-tracking/server/context';
import { importStartSchema } from '@/lib/bill-tracking/schemas';
import { startImport } from '@/lib/bill-tracking/server/import-service';

export const runtime = 'nodejs';

export const POST = btRoute('import.start', async ({ request, context }) => {
  const body = importStartSchema.parse(await readJson(request));
  return startImport(context, body, { rememberMappings: body.rememberMappings, addUnknownBillTypes: body.addUnknownBillTypes });
});

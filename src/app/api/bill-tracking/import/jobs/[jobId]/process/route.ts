import { btRoute, readJson } from '@/lib/bill-tracking/server/context';
import { importProcessSchema } from '@/lib/bill-tracking/schemas';
import { processImport } from '@/lib/bill-tracking/server/import-service';

export const runtime = 'nodejs';
export const maxDuration = 60;

export const POST = btRoute<{ jobId: string }>('import.process', async ({ request, context, params }) => {
  const body = importProcessSchema.parse(await readJson(request));
  return processImport(context, params.jobId, body.chunkSize, body.retryFailed);
});

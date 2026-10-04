import { btRoute, BtError } from '@/lib/bill-tracking/server/context';
import { storeImportFile } from '@/lib/bill-tracking/server/import-service';

export const runtime = 'nodejs';

/** Keeps the original workbook with the job; its checksum must match the previewed file. */
export const POST = btRoute<{ jobId: string }>('import.file', async ({ request, context, params }) => {
  const file = (await request.formData()).get('file');
  if (!(file instanceof File)) throw new BtError('Attach the workbook.');
  await storeImportFile(context, params.jobId, file);
  return { ok: true };
});

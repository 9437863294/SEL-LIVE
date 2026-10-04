import { btRoute, readJson } from '@/lib/bill-tracking/server/context';
import { importRollbackSchema } from '@/lib/bill-tracking/schemas';
import { rollbackImport } from '@/lib/bill-tracking/server/import-service';

export const runtime = 'nodejs';

export const POST = btRoute<{ jobId: string }>('import.rollback', async ({ request, context, params }) => rollbackImport(context, params.jobId, importRollbackSchema.parse(await readJson(request)).reason));

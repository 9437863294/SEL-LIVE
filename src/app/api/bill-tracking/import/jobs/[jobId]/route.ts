import { btRoute } from '@/lib/bill-tracking/server/context';
import { loadImportJob } from '@/lib/bill-tracking/server/import-service';

export const GET = btRoute<{ jobId: string }>('import.job', async ({ context, params }) => loadImportJob(context, params.jobId));

import { btRoute } from '@/lib/bill-tracking/server/context';
import { reconcileImport } from '@/lib/bill-tracking/server/import-service';

export const GET = btRoute<{ jobId: string }>('import.reconciliation', async ({ context, params }) => reconcileImport(context, params.jobId));

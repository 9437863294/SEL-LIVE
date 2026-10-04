import { btRoute } from '@/lib/bill-tracking/server/context';
import { listImportJobs } from '@/lib/bill-tracking/server/import-service';

export const GET = btRoute('import.jobs', async ({ context }) => ({ jobs: await listImportJobs(context) }));

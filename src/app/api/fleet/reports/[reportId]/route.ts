import { fleetRoute } from '@/lib/fleet/server/context';
import { getReport } from '@/lib/fleet/server/reports';

export const GET = fleetRoute<{ reportId: string }>('reports.get', async ({ context, params }) => ({ report: await getReport(context, params.reportId) }));

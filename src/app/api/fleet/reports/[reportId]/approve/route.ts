import { fleetRoute } from '@/lib/fleet/server/context';
import { approveReport } from '@/lib/fleet/server/reports';

export const POST = fleetRoute<{ reportId: string }>('reports.approve', async ({ context, params }) => approveReport(context, params.reportId));

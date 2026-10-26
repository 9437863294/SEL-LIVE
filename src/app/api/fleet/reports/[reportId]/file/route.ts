import { fleetRoute } from '@/lib/fleet/server/context';
import { reportFile } from '@/lib/fleet/server/reports';

/** `?kind=xlsx|pdf|json`, streamed (Storage under fleet/ is closed to browsers). */
export const GET = fleetRoute<{ reportId: string }>('reports.file', async ({ context, params, url }) => reportFile(context, params.reportId, url.searchParams.get('kind') ?? 'xlsx'));

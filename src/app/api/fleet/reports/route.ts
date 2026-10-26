import { readJson, fleetRoute } from '@/lib/fleet/server/context';
import { generateReportFor, listReports } from '@/lib/fleet/server/reports';

export const GET = fleetRoute('reports.list', async ({ context }) => ({ reports: await listReports(context) }));
export const POST = fleetRoute('reports.generate', async ({ request, context }) => generateReportFor(context, await readJson(request)));

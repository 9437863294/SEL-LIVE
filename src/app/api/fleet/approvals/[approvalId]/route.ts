import { readJson, fleetRoute } from '@/lib/fleet/server/context';
import { actOnApproval, approvalDetail } from '@/lib/fleet/server/approvals';

export const GET = fleetRoute<{ approvalId: string }>('approvals.get', async ({ context, params }) => approvalDetail(context, params.approvalId));
export const POST = fleetRoute<{ approvalId: string }>('approvals.act', async ({ request, context, params }) => actOnApproval(context, params.approvalId, await readJson(request)));

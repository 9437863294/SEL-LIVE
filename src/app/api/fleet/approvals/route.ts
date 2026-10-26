import { readJson, fleetRoute } from '@/lib/fleet/server/context';
import { approvalInbox, myApprovals, requestApproval } from '@/lib/fleet/server/approvals';

/** `view=mine` (default): the caller's own requests. `view=inbox`: requests that have reached them. */
export const GET = fleetRoute('approvals.list', async ({ context, url }) =>
  url.searchParams.get('view') === 'inbox' ? approvalInbox(context) : { approvals: await myApprovals(context) },
);
export const POST = fleetRoute('approvals.request', async ({ request, context }) => requestApproval(context, await readJson(request)));

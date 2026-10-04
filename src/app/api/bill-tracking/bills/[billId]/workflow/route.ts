import { btRoute, readJson } from '@/lib/bill-tracking/server/context';
import { workflowActionSchema } from '@/lib/bill-tracking/schemas';
import { applyWorkflowAction } from '@/lib/bill-tracking/server/bills';

export const POST = btRoute<{ billId: string }>('bills.workflow', async ({ request, context, params }) => {
  const body = workflowActionSchema.parse(await readJson(request));
  return applyWorkflowAction(context, params.billId, body.action, body.remarks);
});

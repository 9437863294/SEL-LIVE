import { btRoute, readJson } from '@/lib/bill-tracking/server/context';
import { commitmentUpdateSchema } from '@/lib/bill-tracking/schemas';
import { updateCommitment } from '@/lib/bill-tracking/server/records';

export const PATCH = btRoute<{ billId: string; followUpId: string }>('followups.commitment', async ({ request, context, params }) => {
  await updateCommitment(context, params.billId, params.followUpId, commitmentUpdateSchema.parse(await readJson(request)));
  return { ok: true };
});

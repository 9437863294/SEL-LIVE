import { decodeParam, mdlRoute, readJson } from '@/lib/master-drawing-list/server/context';
import { recordStep } from '@/lib/master-drawing-list/server/items';
import { stepOf } from '@/lib/master-drawing-list/server/queries';
import { datedInputSchema, submissionInputSchema } from '@/lib/master-drawing-list/schemas';

/** Record a submission, the client's comments, or the approval: POST …/items/<id>/<submission|comments|approval>. */
export const POST = mdlRoute<{ itemId: string; step: string }>('items.step', async ({ request, context, params }) => {
  const step = stepOf(params.step);
  const body = await readJson(request);
  const input = step === 'submission' ? submissionInputSchema.parse(body) : datedInputSchema.parse(body);
  return { item: await recordStep(context, decodeParam(params.itemId), step, input) };
});

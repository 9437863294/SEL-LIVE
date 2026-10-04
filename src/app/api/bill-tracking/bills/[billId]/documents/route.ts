import { btRoute, BtError } from '@/lib/bill-tracking/server/context';
import { documentMetaSchema } from '@/lib/bill-tracking/schemas';
import { uploadDocument } from '@/lib/bill-tracking/server/records';

export const runtime = 'nodejs';

export const POST = btRoute<{ billId: string }>('documents.upload', async ({ request, context, params }) => {
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File) || !file.size) throw new BtError('Choose a file to upload.');
  const { category } = documentMetaSchema.parse({ category: form.get('category') });
  return uploadDocument(context, params.billId, file, category);
});

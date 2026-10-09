import { btRoute, readJson } from '@/lib/bill-tracking/server/context';
import { certificationInputSchema, deleteSchema } from '@/lib/bill-tracking/schemas';
import { recordCertification, removeCertification } from '@/lib/bill-tracking/server/certification';

type Params = { billId: string };

/** Record or change the client's certification of a bill. */
export const PUT = btRoute<Params>('bills.certification.record', async ({ request, context, params }) => recordCertification(context, params.billId, certificationInputSchema.parse(await readJson(request))));

/** Remove it (with a reason, kept in the audit trail). */
export const DELETE = btRoute<Params>('bills.certification.remove', async ({ request, context, params }) => {
  await removeCertification(context, params.billId, deleteSchema.parse(await readJson(request)).reason);
  return { ok: true };
});

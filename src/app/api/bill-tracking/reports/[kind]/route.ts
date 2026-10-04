import { btRoute, BtError } from '@/lib/bill-tracking/server/context';
import { report, REPORT_KINDS, type ReportKind } from '@/lib/bill-tracking/server/queries';

export const GET = btRoute<{ kind: string }>('reports', async ({ context, params, url }) => {
  if (!(REPORT_KINDS as readonly string[]).includes(params.kind)) throw new BtError('Unknown report.', 404);
  return report(context, params.kind as ReportKind, url.searchParams);
});

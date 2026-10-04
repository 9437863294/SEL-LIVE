import { btRoute } from '@/lib/bill-tracking/server/context';
import { report } from '@/lib/bill-tracking/server/queries';

/** Post-migration clean-up list for Settings · Data Quality (every FY, every in-scope bill). */
export const GET = btRoute('config.dataQuality', async ({ context, url }) => {
  const params = new URLSearchParams(url.searchParams);
  params.set('fy', 'all');
  return report(context, 'data-quality', params, ['Settings', 'View']);
});

import AllRequestsTab from '@/components/site-fund-request/AllRequestsTab';
import { PageHeader } from '@/components/shared/page-header';

export default function SiteFundRequestsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Site Fund Request"
        title="All Requests"
        description="View and manage all fund requests."
      />
      <AllRequestsTab />
    </>
  );
}

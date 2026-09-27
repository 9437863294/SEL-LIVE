import AllPoliciesTab from '@/components/insurance/AllPoliciesTab';
import { PageHeader } from '@/components/shared/page-header';

export default function AllPoliciesPage() {
    return (
        <>
            <PageHeader title="All Policies" description="Browse insurance policies by category." />
            <AllPoliciesTab />
        </>
    );
}

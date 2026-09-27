
'use client';

import AllRequisitionsTab from '@/components/site-fund-requisition/AllRequisitionsTab2';
import { PageHeader } from '@/components/shared/page-header';

export default function RequisitionsPage() {
    return (
        <div className="flex min-h-screen w-full min-w-0 flex-col overflow-hidden px-3 py-4 sm:px-4 lg:px-6 xl:px-8">
            <PageHeader
                eyebrow="Site Fund Requisition 2"
                title="Requisition Requests"
                description="Create, review, and track requests with stage and status visibility."
            />
            <div className="min-w-0 flex-1">
              <AllRequisitionsTab />
            </div>
        </div>
    );
}

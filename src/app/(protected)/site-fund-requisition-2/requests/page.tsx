
'use client';

import AllRequisitionsTab from '@/components/AllRequisitionsTab';

export default function RequisitionsPage() {
    return (
        <div className="flex flex-col h-full p-4 sm:p-6 lg:p-8">
            <h1 className="text-3xl font-bold mb-6">Requisition Requests</h1>
            <AllRequisitionsTab />
        </div>
    );
}

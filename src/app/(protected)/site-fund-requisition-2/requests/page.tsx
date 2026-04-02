
'use client';

import AllRequisitionsTab from '@/components/AllRequisitionsTab2';

export default function RequisitionsPage() {
    return (
        <div className="flex h-full w-full flex-col px-3 py-4 sm:px-4 lg:px-6 xl:px-8">
            <div className="mb-4">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                    Site Fund Requisition 2
                </p>
                <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
                    Requisition Requests
                </h1>
                <p className="mt-1 text-sm text-slate-600">
                    Create, review, and track requests with stage and status visibility.
                </p>
            </div>
            <AllRequisitionsTab />
        </div>
    );
}

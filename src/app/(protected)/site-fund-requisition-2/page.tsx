
'use client';

import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { FileText } from 'lucide-react';
import Link from 'next/link';

export default function SiteFundRequisition2Page() {
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <h1 className="text-3xl font-bold mb-6">Site Fund Requisition 2</h1>
      <div className="max-w-sm">
        <Link href="/site-fund-requisition-2/requests" className="block hover:shadow-lg transition-shadow rounded-xl">
            <Card>
              <CardHeader className="flex flex-row items-start gap-4 space-y-0">
                  <div className="bg-primary/10 p-2 rounded-lg">
                    <FileText className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1">
                      <CardTitle className="text-base font-bold">Manage Requests</CardTitle>
                      <CardDescription className="text-xs">Manage all requests for this module.</CardDescription>
                  </div>
              </CardHeader>
            </Card>
        </Link>
      </div>
    </div>
  );
}
